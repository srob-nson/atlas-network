export const TYPES = ['cabinet', 'switch', 'router', 'firewall', 'access_point', 'patch_panel'];

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
    const zone = zones.find(z => z.name.toLowerCase() === (row.zone || '').toLowerCase());
    const link = row.management_url || row.url || '';
    if (reportZones && row.zone && !zone) errors.push(`Row ${index + 2}: zone “${row.zone}” was not found; assign it after import.`);
    if (link && !safeManagementUrl(link)) errors.push(`Row ${index + 2}: invalid management URL was omitted.`);
    assets.push({ id: crypto.randomUUID(), name: row.name, type, zoneId: zone?.id || '', ip: row.ip || '', managementUrl: safeManagementUrl(link), model: row.model || '', placed: false });
  });
  return { assets, errors };
}

export function assignRacks(assets) {
  return assets.map(asset => {
    if (asset.type === 'cabinet' || asset.type === 'access_point') return { ...asset, rackId: '' };
    if (asset.rackId !== undefined) return { ...asset };
    const cabinets = assets.filter(a => a.type === 'cabinet');
    const rack = cabinets.find(a => a.zoneId && a.zoneId === asset.zoneId) || (cabinets.length === 1 ? cabinets[0] : null);
    return { ...asset, rackId: rack?.id || '' };
  });
}

export function defaultPorts(type) {
  const count = type === 'switch' || type === 'patch_panel' ? 48 : type === 'router' || type === 'firewall' ? 4 : type === 'access_point' ? 1 : 0;
  return Array.from({ length: count }, (_, i) => ({ name: String(i + 1), speed: '1 Gbps' }));
}

export function initializePorts(assets, cables) {
  for (const asset of assets) {
    if (!asset.ports) asset.ports = defaultPorts(asset.type);
    for (const cable of cables) {
      const name = cable.from === asset.id ? cable.fromPort : cable.to === asset.id ? cable.toPort : '';
      if (name && !asset.ports.some(port => port.name.toLowerCase() === name.toLowerCase())) asset.ports.push({ name, speed: '1 Gbps' });
    }
  }
  return assets;
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
    return { id: asset.id, name: asset.name, type: asset.type, zoneId: zones.some(zone => zone.id === asset.zoneId) ? asset.zoneId : '', ip: String(asset.ip || ''), model: String(asset.model || ''), managementUrl: safeManagementUrl(asset.managementUrl), placed: !!asset.placed, x: asset.placed ? asset.x : null, y: asset.placed ? asset.y : null };
  });
  for (const asset of assets) {
    const original = input.assets.find(a => a.id === asset.id);
    if (original.ports !== undefined) {
      if (!Array.isArray(original.ports) || original.ports.length > 512 || original.ports.some(p => !p || typeof p.name !== 'string' || !p.name.trim() || p.name.length > 80 || typeof p.speed !== 'string' || p.speed.length > 80) || new Set(original.ports.map(p => p.name.toLowerCase())).size !== original.ports.length) invalid();
      asset.ports = original.ports.map(({ name, speed }) => ({ name, speed }));
    }
    if (original.rackId !== undefined) asset.rackId = assets.some(a => a.id === original.rackId && a.type === 'cabinet' && a.id !== asset.id) ? original.rackId : '';
  }
  const assignedAssets = assignRacks(assets);
  const cables = input.cables.map(cable => {
    if (!cable || typeof cable.id !== 'string' || !ids.has(cable.from) || !ids.has(cable.to) || cable.from === cable.to) invalid();
    const waypoints = cable.waypoints === undefined ? [] : cable.waypoints;
    if (!Array.isArray(waypoints) || !waypoints.every(p => p && ['x', 'y'].every(k => Number.isFinite(p[k]) && p[k] >= 0 && p[k] <= 100 && p[k] % 5 === 0))) invalid();
    return { id: cable.id, from: cable.from, to: cable.to, waypoints: waypoints.map(({ x, y }) => ({ x, y })), fromPort: String(cable.fromPort || '').slice(0, 80), toPort: String(cable.toPort || '').slice(0, 80), label: String(cable.label || '').slice(0, 80), color: /^#[0-9a-f]{6}$/i.test(cable.color) ? cable.color : '#d9a667' };
  });
  initializePorts(assignedAssets, cables);
  const planImage = typeof input.planImage === 'string' && /^data:image\/(png|jpeg|webp);base64,/i.test(input.planImage) ? input.planImage : '';
  return { name: input.name, floorName: typeof input.floorName === 'string' ? input.floorName : 'Ground floor', planImage, demo: !!input.demo && !planImage, zones, assets: assignedAssets, cables };
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

export function restoreHierarchy(input) {
  const invalid = () => { throw new Error('Invalid project file.'); };
  if (!input?.buildings) {
    const legacy = restoreProject(input);
    const { name, cables, ...floor } = legacy;
    return { name, buildings: [{ id: 'building-1', name: 'Building 1', floors: [{ id: 'floor-1', ...floor }] }], cables };
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
  return { name: input.name, buildings, cables };
}
