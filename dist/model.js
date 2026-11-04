export const TYPES = ['cabinet', 'switch', 'router', 'firewall', 'access_point', 'patch_panel', 'plc', 'rtu', 'hmi', 'engineering_workstation', 'server', 'workstation', 'ip_camera', 'nvr', 'access_controller', 'sensor', 'meter', 'drive', 'ied', 'gateway', 'printer', 'other'];

export function placeAsset(asset, zones, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new TypeError('Position must be finite.');
  x = Math.round(Math.max(0, Math.min(100, x)) * 100) / 100;
  y = Math.round(Math.max(0, Math.min(100, y)) * 100) / 100;
  const zone = zones.filter(z => x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h).sort((a, b) => a.w * a.h - b.w * b.h)[0];
  return { ...asset, x, y, placed: true, zoneId: zone?.id || '' };
}

export function safeManagementUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}

function csvRows(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"' && quoted && text[i + 1] === '"') { field += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { row.push(field.trim()); field = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = []; field = '';
    } else field += char;
  }
  if (quoted) throw new Error('The CSV contains an unclosed quoted field.');
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

export function parseInventory(text, zones, reportZones = true) {
  const rows = csvRows(text);
  const headers = (rows.shift() || []).map(value => value.toLowerCase().replace(/[\s-]+/g, '_'));
  if (new Set(headers).size !== headers.length) throw new Error('CSV contains duplicate column names.');
  if (!headers.includes('name') || !headers.includes('type')) throw new Error('CSV needs name and type columns.');
  const assets = [], errors = [];
  rows.forEach((values, index) => {
    const row = Object.fromEntries(headers.map((header, i) => [header, values[i] || '']));
    let type = row.type.toLowerCase().replace(/[\s-]+/g, '_');
    if (type === 'rack') type = 'cabinet';
    if (type === 'ap') type = 'access_point';
    if (!row.name || !TYPES.includes(type)) {
      errors.push(`Row ${index + 2}: ${!row.name ? 'name is required' : `unsupported type “${row.type}”`}.`);
      return;
    }
    const tooLong = [['name', 80], ['vendor', 120], ['model', 120], ['ip', 80], ['management_url', 500], ['url', 500]].find(([key, limit]) => (row[key] || '').length > limit);
    if (tooLong) { errors.push(`Row ${index + 2}: ${tooLong[0]} exceeds ${tooLong[1]} characters.`); return; }
    const zone = zones.find(z => z.name.toLowerCase() === (row.zone || '').toLowerCase());
    const link = row.management_url || row.url || '';
    if (reportZones && row.zone && !zone) errors.push(`Row ${index + 2}: zone “${row.zone}” was not found; assign it after import.`);
    if (link && !safeManagementUrl(link)) errors.push(`Row ${index + 2}: invalid management URL was omitted.`);
    assets.push({ id: crypto.randomUUID(), name: row.name, type, zoneId: zone?.id || '', ip: row.ip || '', managementUrl: safeManagementUrl(link), vendor: row.vendor || '', model: row.model || '', placed: false, rackId: '', ports: [] });
  });
  return { assets, errors };
}

export function assignRacks(assets) {
  return assets.map(asset => {
    if (asset.type === 'cabinet') return { ...asset, rackId: '' };
    if (asset.rackId !== undefined) return { ...asset };
    if (!['switch', 'router', 'firewall', 'patch_panel'].includes(asset.type)) return { ...asset, rackId: '' };
    const cabinets = assets.filter(a => a.type === 'cabinet');
    const rack = cabinets.find(a => a.zoneId && a.zoneId === asset.zoneId) || (cabinets.length === 1 ? cabinets[0] : null);
    return { ...asset, rackId: rack?.id || '' };
  });
}

export function initializePorts(assets, cables) {
  for (const asset of assets) {
    if (!asset.ports) asset.ports = [];
    for (const port of asset.ports) { port.id ||= crypto.randomUUID(); port.media ??= 'Unknown'; port.poe ??= 'unknown'; }
    for (const cable of cables) {
      const name = cable.from === asset.id ? cable.fromPort : cable.to === asset.id ? cable.toPort : '';
      if (name && !asset.ports.some(port => port.name.toLowerCase() === name.toLowerCase())) asset.ports.push({ id: crypto.randomUUID(), name, speed: 'Unknown', media: 'Unknown', poe: 'unknown' });
    }
  }
  return assets;
}

export function configurePorts(device, count, cables) {
  if (!Number.isInteger(count) || count < 0 || count > 512) throw new Error('Port count must be between 0 and 512.');
  const ports = device.ports || [];
  if (ports.slice(count).some(port => cables.some(c => (c.from === device.id && (c.fromPortId === port.id || c.fromPort?.toLowerCase() === port.name.toLowerCase())) || (c.to === device.id && (c.toPortId === port.id || c.toPort?.toLowerCase() === port.name.toLowerCase()))))) throw new Error('Connected ports cannot be removed.');
  const next = ports.slice(0, count);
  while (next.length < count) {
    let n = next.length + 1;
    while (next.some(port => port.name.toLowerCase() === String(n).toLowerCase())) n++;
    next.push({ id: crypto.randomUUID(), name: String(n), speed: 'Unknown', media: 'Unknown', poe: 'unknown' });
  }
  device.ports = next;
}

export function assignRack(assets, device, rackId, start, height) {
  if (!rackId) { Object.assign(device, { rackId: '', rackStart: null, rackHeight: null }); return; }
  const rack = assets.find(a => a.id === rackId && a.type === 'cabinet');
  if (!rack || device.type === 'cabinet' || device.id === rackId) throw new Error('Choose a valid rack.');
  if (!Number.isInteger(rack.rackUnits) || rack.rackUnits < 1) throw new Error('Set the rack capacity first.');
  if (!Number.isInteger(start) || !Number.isInteger(height) || start < 1 || height < 1 || start + height - 1 > rack.rackUnits) throw new Error('Position exceeds rack capacity.');
  for (const other of assets.filter(a => a.id !== device.id && a.rackId === rackId)) {
    if (!Number.isInteger(other.rackStart) || !Number.isInteger(other.rackHeight)) throw new Error('Rack occupancy is unknown; set existing positions first.');
    if (start < other.rackStart + other.rackHeight && other.rackStart < start + height) throw new Error('Rack units are occupied.');
  }
  Object.assign(device, { rackId, rackStart: start, rackHeight: height });
}

export function canConnectPorts(assets, cables, rackId, from, fromPort, to, toPort) {
  const a = assets.find(asset => asset.id === from), b = assets.find(asset => asset.id === to);
  const free = (id, name) => !cables.some(c => (c.from === id && c.fromPort?.toLowerCase() === name.toLowerCase()) || (c.to === id && c.toPort?.toLowerCase() === name.toLowerCase()));
  return !!(a && b && from !== to && a.rackId === rackId && b.rackId === rackId && a.ports.some(p => p.name === fromPort) && b.ports.some(p => p.name === toPort) && free(from, fromPort) && free(to, toPort));
}

export function autoPlace(assets, zones) {
  const result = assets.map(asset => ({ ...asset }));
  for (const zone of zones) {
    const pending = result.filter(asset => asset.zoneId === zone.id && !asset.placed);
    const occupied = result.filter(asset => asset.zoneId === zone.id && asset.placed);
    if (!pending.length || zone.w <= 0 || zone.h <= 0) continue;
    const count = pending.length + occupied.length;
    const columns = Math.max(1, Math.ceil(Math.sqrt(count * zone.w / zone.h)));
    const rows = Math.ceil((count + occupied.length + 1) / columns);
    const minDistance = Math.min(zone.w / (columns + 1), zone.h / (rows + 1)) * 0.4;
    let slot = 0;
    for (const asset of pending) {
      while (slot < columns * rows) {
        const x = zone.x + zone.w * ((slot % columns) + 1) / (columns + 1);
        const y = zone.y + zone.h * (Math.floor(slot / columns) + 1) / (rows + 1);
        slot++;
        if (occupied.some(other => Math.hypot(other.x - x, other.y - y) < minDistance)) continue;
        Object.assign(asset, { x, y, placed: true });
        occupied.push(asset);
        break;
      }
    }
  }
  return result;
}

export function autoPlaceFloor(assets) {
  const visible = assets.filter(asset => !asset.rackId);
  const placed = autoPlace(visible.map(asset => ({ ...asset, zoneId: 'floor' })), [{ id: 'floor', x: 0, y: 0, w: 100, h: 100 }]);
  const byId = new Map(placed.map(asset => [asset.id, asset]));
  return assets.map(asset => {
    const next = byId.get(asset.id);
    return next && !asset.placed && next.placed ? { ...asset, x: next.x, y: next.y, placed: true } : { ...asset };
  });
}

export function restoreProject(input) {
  const invalid = () => { throw new Error('Invalid project file.'); };
  if (!input || typeof input.name !== 'string' || !Array.isArray(input.zones) || !Array.isArray(input.assets) || !Array.isArray(input.cables)) invalid();
  const ids = new Set();
  const zones = input.zones.map(zone => {
    if (!zone || typeof zone.id !== 'string' || !zone.id || ids.has(zone.id) || typeof zone.name !== 'string' || !['x', 'y', 'w', 'h'].every(key => Number.isFinite(zone[key])) || zone.x < 0 || zone.y < 0 || zone.w <= 0 || zone.h <= 0 || zone.x + zone.w > 100 || zone.y + zone.h > 100) invalid();
    ids.add(zone.id);
    return { id: zone.id, name: zone.name, x: zone.x, y: zone.y, w: zone.w, h: zone.h };
  });
  ids.clear();
  const assets = input.assets.map(asset => {
    if (!asset || typeof asset.id !== 'string' || !asset.id || ids.has(asset.id) || typeof asset.name !== 'string' || !TYPES.includes(asset.type) || (asset.placed && (!Number.isFinite(asset.x) || !Number.isFinite(asset.y) || asset.x < 0 || asset.y < 0 || asset.x > 100 || asset.y > 100))) invalid();
    ids.add(asset.id);
    for (const key of ['rackUnits', 'rackStart', 'rackHeight']) if (asset[key] != null && (!Number.isInteger(asset[key]) || asset[key] < 1 || asset[key] > 512)) invalid();
    for (const key of ['poeBudget', 'poeDemand']) if (asset[key] != null && (typeof asset[key] !== 'number' || !Number.isFinite(asset[key]) || asset[key] < 0)) invalid();
    for (const key of ['network', 'vrf']) if (asset[key] != null && (typeof asset[key] !== 'string' || asset[key].length > 120)) invalid();
    return { id: asset.id, name: asset.name, type: asset.type, zoneId: zones.some(zone => zone.id === asset.zoneId) ? asset.zoneId : '', ip: String(asset.ip || ''), network: asset.network || '', vrf: asset.vrf || '', poeBudget: asset.poeBudget ?? null, poeDemand: asset.poeDemand ?? null, vendor: String(asset.vendor || ''), model: String(asset.model || ''), managementUrl: safeManagementUrl(asset.managementUrl), placed: !!asset.placed, x: asset.placed ? asset.x : null, y: asset.placed ? asset.y : null, rackUnits: asset.rackUnits ?? null, rackStart: asset.rackStart ?? null, rackHeight: asset.rackHeight ?? null };
  });
  for (const asset of assets) {
    const original = input.assets.find(a => a.id === asset.id);
    if (original.ports !== undefined) {
      if (!Array.isArray(original.ports) || original.ports.length > 512 || original.ports.some(p => !p || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 80 || typeof p.speed !== 'string' || p.speed.length > 80 || (p.id !== undefined && (typeof p.id !== 'string' || !p.id)) || (p.media !== undefined && (typeof p.media !== 'string' || p.media.length > 80)) || (p.poe !== undefined && !['unknown', 'source', 'powered', 'none'].includes(p.poe))) || new Set(original.ports.map(p => p.name.toLowerCase())).size !== original.ports.length) invalid();
      asset.ports = original.ports.map(({ id, name, speed, media, poe }) => ({ id: id || crypto.randomUUID(), name, speed, media: media ?? 'Unknown', poe: poe ?? 'unknown' }));
    }
    if (original.rackId !== undefined) asset.rackId = assets.some(a => a.id === original.rackId && a.type === 'cabinet' && a.id !== asset.id) ? original.rackId : '';
  }
  const assignedAssets = assignRacks(assets);
  const cables = input.cables.map(cable => {
    if (!cable || typeof cable.id !== 'string' || !ids.has(cable.from) || !ids.has(cable.to) || cable.from === cable.to) invalid();
    if (['fromPort', 'toPort'].some(key => cable[key] != null && (typeof cable[key] !== 'string' || cable[key].length > 80))) invalid();
    const waypoints = cable.waypoints === undefined ? [] : cable.waypoints;
    if (!Array.isArray(waypoints) || !waypoints.every(p => p && ['x', 'y'].every(k => Number.isFinite(p[k]) && p[k] >= 0 && p[k] <= 100 && p[k] % 5 === 0))) invalid();
    const route = cable.route ?? { pathwayIds: [], riserIds: [], extraMeters: null, review: null };
    if (!route || !Array.isArray(route.pathwayIds) || !Array.isArray(route.riserIds) || (route.extraMeters != null && (typeof route.extraMeters !== 'number' || !Number.isFinite(route.extraMeters) || route.extraMeters < 0)) || (route.review != null && (typeof route.review.note !== 'string' || !route.review.note.trim() || route.review.note.length > 1000 || typeof route.review.signature !== 'string'))) invalid();
    return { id: cable.id, from: cable.from, to: cable.to, waypoints: waypoints.map(({ x, y }) => ({ x, y })), fromPort: String(cable.fromPort || '').slice(0, 80), toPort: String(cable.toPort || '').slice(0, 80), fromPortId: cable.fromPortId || null, toPortId: cable.toPortId || null, label: String(cable.label || '').slice(0, 80), color: /^#[0-9a-f]{6}$/i.test(cable.color) ? cable.color : '#d9a667', route: { pathwayIds: [...route.pathwayIds], riserIds: [...route.riserIds], extraMeters: route.extraMeters ?? null, review: route.review ? { note: route.review.note, signature: route.review.signature } : null } };
  });
  initializePorts(assignedAssets, cables);
  const outline = input.outline === undefined ? [] : input.outline;
  if (!Array.isArray(outline) || (outline.length && outline.length < 3) || outline.length > 200 || !outline.every(p => Array.isArray(p) && p.length === 2 && p.every(n => Number.isFinite(n) && n >= 0 && n <= 100))) invalid();
  const planImage = typeof input.planImage === 'string' && /^data:image\/(png|jpeg|webp);base64,/i.test(input.planImage) ? input.planImage : '';
  const scale = input.scale ?? null, northDegrees = input.northDegrees ?? null;
  const layoutRevision = input.layoutRevision ?? 0;
  if (scale !== null && (!scale || !['widthMeters', 'heightMeters'].every(key => typeof scale[key] === 'number' && Number.isFinite(scale[key]) && scale[key] > 0))) invalid();
  if (northDegrees !== null && (typeof northDegrees !== 'number' || !Number.isFinite(northDegrees) || northDegrees < 0 || northDegrees >= 360)) invalid();
  if (!Number.isSafeInteger(layoutRevision) || layoutRevision < 0) invalid();
  return { name: input.name, outline: outline.map(p => [...p]), floorName: typeof input.floorName === 'string' ? input.floorName : 'Ground floor', planImage, demo: !!input.demo && !planImage, scale: scale && { widthMeters: scale.widthMeters, heightMeters: scale.heightMeters }, northDegrees, layoutRevision, zones, assets: assignedAssets, cables };
}

export function cableRoute(from, waypoints, to) {
  const route = [[from.x, from.y]];
  for (const next of [...waypoints, to]) {
    const [x, y] = route.at(-1);
    if (x !== next.x) route.push([next.x, y]);
    if (y !== next.y) route.push([next.x, next.y]);
  }
  return route;
}

export function serializeProject(project) {
  const devices = [], racks = [], ports = [];
  const buildings = project.buildings.map(building => ({ ...building, floors: building.floors.map(floor => {
    for (const asset of floor.assets) {
      const { ports: interfaces = [], ...entity } = asset;
      (asset.type === 'cabinet' ? racks : devices).push({ ...entity, floorId: floor.id });
      ports.push(...interfaces.map(port => ({ ...port, deviceId: asset.id })));
    }
    const { assets, ...rest } = floor;
    return rest;
  }) }));
  const endpoint = (deviceId, portId, name) => ({ deviceId, portId: portId || ports.find(p => p.deviceId === deviceId && p.name.toLowerCase() === (name || '').toLowerCase())?.id || null });
  const connections = project.cables.map(({ from, to, fromPort, toPort, fromPortId, toPortId, route, ...cable }) => ({ ...cable, from: endpoint(from, fromPortId, fromPort), to: endpoint(to, toPortId, toPort), route: route ?? { pathwayIds: [], riserIds: [], extraMeters: null, review: null } }));
  return { schemaVersion: 4, name: project.name, buildings, devices, racks, ports, connections, pathways: project.pathways || [], risers: project.risers || [] };
}

function restoreEntities(input) {
  const invalid = () => { throw new Error('Invalid project file.'); };
  if (![input.buildings, input.devices, input.racks, input.ports, input.connections].every(Array.isArray)) invalid();
  if (input.schemaVersion === 4 && (!Array.isArray(input.pathways) || !Array.isArray(input.risers) || input.connections.some(connection => !connection?.route))) invalid();
  const entities = [...input.devices, ...input.racks];
  if (input.devices.some(a => a.type === 'cabinet') || input.racks.some(a => a.type !== 'cabinet')) invalid();
  if (new Set(entities.map(a => a.id)).size !== entities.length) invalid();
  const floorIds = new Set(input.buildings.flatMap(b => Array.isArray(b.floors) ? b.floors.map(f => f.id) : []));
  if (entities.some(a => !floorIds.has(a.floorId))) invalid();
  for (const device of input.devices) {
    if (!device.rackId) continue;
    const rack = input.racks.find(r => r.id === device.rackId && r.floorId === device.floorId);
    if (!rack || ((device.rackStart == null) !== (device.rackHeight == null))) invalid();
    if (device.rackStart != null) {
      if (!Number.isInteger(device.rackStart) || !Number.isInteger(device.rackHeight) || device.rackStart < 1 || device.rackHeight < 1 || (rack.rackUnits != null && device.rackStart + device.rackHeight - 1 > rack.rackUnits)) invalid();
      if (input.devices.some(other => other !== device && other.rackId === device.rackId && other.rackStart != null && other.rackHeight != null && device.rackStart < other.rackStart + other.rackHeight && other.rackStart < device.rackStart + device.rackHeight)) invalid();
    }
  }
  const portIds = new Set();
  for (const port of input.ports) {
    if (!port || typeof port.id !== 'string' || !port.id || portIds.has(port.id) || !entities.some(a => a.id === port.deviceId)) invalid();
    portIds.add(port.id);
  }
  const buildings = input.buildings.map(b => ({ ...b, floors: b.floors.map(f => ({ ...f, assets: entities.filter(a => a.floorId === f.id).map(({ floorId, ...asset }) => ({ ...asset, ports: input.ports.filter(p => p.deviceId === asset.id).map(({ deviceId, ...port }) => port) })) })) }));
  const connections = input.connections.map(({ from, to, ...cable }) => {
    const endpoint = value => {
      if (!value || !entities.some(a => a.id === value.deviceId)) invalid();
      const port = value.portId === null ? null : input.ports.find(p => p.id === value.portId && p.deviceId === value.deviceId);
      if (value.portId !== null && !port) invalid();
      return { device: value.deviceId, id: value.portId, name: port?.name || '' };
    };
    const a = endpoint(from), b = endpoint(to);
    return { ...cable, from: a.device, to: b.device, fromPort: a.name, toPort: b.name, fromPortId: a.id, toPortId: b.id };
  });
  return { schemaVersion: 1, name: input.name, buildings, cables: connections, pathways: input.pathways ?? [], risers: input.risers ?? [] };
}

export function restoreHierarchy(input) {
  const invalid = () => { throw new Error('Invalid project file.'); };
  if ([2, 3, 4].includes(input?.schemaVersion)) input = restoreEntities(input);
  if (input?.schemaVersion !== undefined && input.schemaVersion !== 1) throw new Error('Unsupported project schema version.');
  if (!input?.buildings) {
    const legacy = restoreProject(input);
    const { name, cables, ...floor } = legacy;
    input = { schemaVersion: 1, name, buildings: [{ id: 'building-1', name: 'Building 1', floors: [{ id: 'floor-1', ...floor }] }], cables };
  }
  if (typeof input.name !== 'string' || !Array.isArray(input.buildings) || !input.buildings.length || !Array.isArray(input.cables)) invalid();
  const buildingIds = new Set(), floorIds = new Set(), assetIds = new Set();
  const buildings = input.buildings.map(building => {
    if (!building || typeof building.id !== 'string' || !building.id || buildingIds.has(building.id) || typeof building.name !== 'string' || !Array.isArray(building.floors) || !building.floors.length) invalid();
    buildingIds.add(building.id);
    const floors = building.floors.map(floor => {
      if (!floor || typeof floor.id !== 'string' || !floor.id || floorIds.has(floor.id)) invalid();
      floorIds.add(floor.id);
      const normalized = restoreProject({ ...floor, name: input.name, cables: [] });
      for (const asset of normalized.assets) { if (assetIds.has(asset.id)) invalid(); assetIds.add(asset.id); }
      const { name, cables, ...rest } = normalized;
      return { id: floor.id, ...rest };
    });
    return { id: building.id, name: building.name, floors };
  });
  const assets = buildings.flatMap(b => b.floors.flatMap(f => f.assets));
  const cables = restoreProject({ name: input.name, zones: [], assets, cables: input.cables }).cables;
  const cableIds = new Set();
  for (const cable of cables) {
    if (!cable.id || cableIds.has(cable.id)) invalid();
    cableIds.add(cable.id);

  }
  for (const building of buildings) for (const floor of building.floors) initializePorts(floor.assets, cables);
  const allPorts = assets.flatMap(asset => asset.ports);
  if (new Set(allPorts.map(port => port.id)).size !== allPorts.length) invalid();
  for (const cable of cables) for (const side of ['from', 'to']) {
    const portId = cable[`${side}PortId`];
    if (portId && !assets.find(asset => asset.id === cable[side])?.ports.some(port => port.id === portId && (!cable[`${side}Port`] || port.name.toLowerCase() === cable[`${side}Port`].toLowerCase()))) invalid();
  }
  const pathways = input.pathways ?? [], risers = input.risers ?? [];
  const validPoint = point => point && ['x', 'y'].every(key => typeof point[key] === 'number' && Number.isFinite(point[key]) && point[key] >= 0 && point[key] <= 100);
  if (!Array.isArray(pathways) || !Array.isArray(risers)) invalid();
  const pathIds = new Set(), riserIds = new Set();
  for (const path of pathways) {
    if (!path || typeof path.id !== 'string' || !path.id || pathIds.has(path.id) || typeof path.name !== 'string' || !path.name.trim() || path.name.length > 80 || !floorIds.has(path.floorId) || !Array.isArray(path.points) || path.points.length < 2 || path.points.length > 200 || !path.points.every(validPoint)) invalid();
    pathIds.add(path.id);
  }
  for (const riser of risers) {
    if (!riser || typeof riser.id !== 'string' || !riser.id || riserIds.has(riser.id) || typeof riser.name !== 'string' || !riser.name.trim() || riser.name.length > 80 || !riser.from || !riser.to || !floorIds.has(riser.from.floorId) || !floorIds.has(riser.to.floorId) || riser.from.floorId === riser.to.floorId || !validPoint(riser.from) || !validPoint(riser.to) || (riser.lengthMeters != null && (typeof riser.lengthMeters !== 'number' || !Number.isFinite(riser.lengthMeters) || riser.lengthMeters < 0))) invalid();
    riserIds.add(riser.id);
  }
  for (const cable of cables) if (new Set(cable.route.pathwayIds).size !== cable.route.pathwayIds.length || new Set(cable.route.riserIds).size !== cable.route.riserIds.length || cable.route.pathwayIds.some(id => !pathIds.has(id)) || cable.route.riserIds.some(id => !riserIds.has(id))) invalid();
  return { schemaVersion: 1, name: input.name, buildings, cables, pathways: structuredClone(pathways), risers: structuredClone(risers) };
}

export function moveAssetToFloor(source, target, asset, cables) {
  if (source === target || !source.assets.includes(asset)) return;
  source.assets = source.assets.filter(item => item !== asset);
  source.assets.forEach(item => { if (item.rackId === asset.id) Object.assign(item, { rackId: '', rackStart: null, rackHeight: null }); });
  Object.assign(asset, { rackId: '', rackStart: null, rackHeight: null, zoneId: '', placed: false, x: null, y: null });
  target.assets.push(asset);
  cables.forEach(cable => { if (cable.from === asset.id || cable.to === asset.id) cable.waypoints = []; });
}

export function deployAsset(assets, asset, x, y) {
  Object.assign(asset, { ...placeAsset(asset, [], x, y), zoneId: asset.zoneId || '' });
}
