const known = value => typeof value === 'string' && value.trim() && value.trim().toLowerCase() !== 'unknown';
const target = (kind, id, deviceId) => ({ kind, id, ...(deviceId ? { deviceId } : {}) });
const finding = (code, severity, message, targets) => ({ code, severity, message, targets });
const watts = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;

function address(value) {
  if (typeof value !== 'string') return null;
  const ip = value.trim();
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    const parts = ip.split('.');
    return parts.every(p => Number(p) <= 255 && String(Number(p)) === p) ? parts.join('.') : null;
  }
  if (/^[0-9a-f:.]+$/i.test(ip) && ip.includes(':')) {
    try { return new URL(`http://[${ip}]/`).hostname.toLowerCase(); } catch { return null; }
  }
  return null;
}

function speed(value) {
  if (!known(value)) return null;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(g|m|k)?(?:b(?:it)?(?:ps|\/s)?)?$/i);
  if (!match || (!match[2] && !/b/i.test(value)) || Number(match[1]) <= 0) return null;
  return Number(match[1]) * ({ g: 1e9, m: 1e6, k: 1e3, '': 1 }[match[2]?.toLowerCase() || '']);
}
function media(value) {
  if (!known(value)) return null;
  if (/fiber|fibre|optical/i.test(value)) return 'fiber';
  if (/copper|twisted\s*pair|rj-?45|cat\s*[3-8]/i.test(value)) return 'copper';
  return null;
}

function networkRule(project) {
  const findings = [], seen = new Map();
  for (const device of project.devices) {
    const ref = target('device', device.id), missing = [];
    if (!known(device.ip)) missing.push('IP address');
    if (!known(device.network)) missing.push('network');
    if (!known(device.vrf)) missing.push('VRF');
    if (missing.length) findings.push(finding('network-metadata', 'missing', `${device.name}: ${missing.join(', ')} not specified.`, [ref]));
    if (!known(device.ip)) continue;
    const normalized = address(device.ip);
    if (!normalized) { findings.push(finding('invalid-ip', 'error', `${device.name}: IP address “${device.ip}” is invalid.`, [ref])); continue; }
    if (!known(device.network) || !known(device.vrf)) continue;
    const key = JSON.stringify([device.network.trim(), device.vrf.trim(), normalized]);
    if (seen.has(key)) {
      const other = seen.get(key);
      findings.push(finding('duplicate-ip', 'error', `${device.name} and ${other.name} use ${device.ip} in the same network and VRF.`, [target('device', other.id), ref]));
    } else seen.set(key, device);
  }
  return findings;
}

function connectionRule(project, context) {
  const findings = [], uses = new Map(), connected = new Set();
  for (const connection of project.connections) {
    const link = target('connection', connection.id), endpoints = [connection.from, connection.to];
    const devices = endpoints.map(e => context.devices.get(e?.deviceId));
    if (devices[0] && devices[1] && devices[0] !== devices[1]) devices.forEach(d => connected.add(d.id));
    const ports = endpoints.map((endpoint, i) => {
      const device = devices[i], port = context.ports.get(endpoint?.portId);
      if (!device) { findings.push(finding('dangling-endpoint', 'error', `Connection ${connection.id} refers to a missing device.`, [link])); return null; }
      const deviceRef = target('device', device.id);
      if (endpoint.portId == null) { findings.push(finding('interface-unspecified', 'missing', `Connection on ${device.name} has no interface specified.`, [link, deviceRef])); return null; }
      if (!port || port.deviceId !== device.id) { findings.push(finding('dangling-endpoint', 'error', `Connection on ${device.name} refers to a missing or unrelated interface.`, [link, deviceRef])); return null; }
      const key = JSON.stringify([device.id, port.id]);
      if (!uses.has(key)) uses.set(key, []);
      uses.get(key).push(connection.id);
      return port;
    });
    if (!ports[0] || !ports[1]) continue;
    const refs = [link, ...ports.map(p => target('port', p.id, p.deviceId))];
    const [leftMedia, rightMedia] = ports.map(p => media(p.media));
    if (leftMedia && rightMedia && leftMedia !== rightMedia) findings.push(finding('media-mismatch', 'error', `${devices[0].name} ${ports[0].name} uses ${leftMedia}; ${devices[1].name} ${ports[1].name} uses ${rightMedia}.`, refs));
    else if (!leftMedia || !rightMedia) findings.push(finding('link-media', 'missing', `Connection ${connection.id}: media compatibility cannot be determined.`, refs));
    const [leftSpeed, rightSpeed] = ports.map(p => speed(p.speed));
    if (leftSpeed !== null && rightSpeed !== null && leftSpeed !== rightSpeed) findings.push(finding('speed-mismatch', 'warning', `${devices[0].name} ${ports[0].name} is ${ports[0].speed}; ${devices[1].name} ${ports[1].name} is ${ports[1].speed}. Verify speed negotiation.`, refs));
    else if (leftSpeed === null || rightSpeed === null) findings.push(finding('link-speed', 'missing', `Connection ${connection.id}: speed compatibility cannot be determined.`, refs));
  }
  for (const [key, ids] of uses) if (ids.length > 1) {
    const [deviceId, portId] = JSON.parse(key), device = context.devices.get(deviceId), port = context.ports.get(portId);
    findings.push(finding('port-conflict', 'error', `${device.name} ${port.name} is used by ${ids.length} connection endpoints.`, [target('port', portId, deviceId), ...ids.map(id => target('connection', id))]));
  }
  for (const device of project.devices) if (!connected.has(device.id)) findings.push(finding('disconnected', 'warning', `${device.name} has no connection to another device.`, [target('device', device.id)]));
  return findings;
}

function rackRule(project) {
  const findings = [];
  for (const rack of project.racks) {
    const rackRef = target('rack', rack.id), devices = project.devices.filter(d => d.rackId === rack.id);
    const capacityKnown = Number.isInteger(rack.rackUnits) && rack.rackUnits > 0;
    if (rack.rackUnits == null) findings.push(finding('rack-metadata', 'missing', `${rack.name}: rack capacity is unspecified.`, [rackRef]));
    else if (!capacityKnown) findings.push(finding('rack-capacity', 'error', `${rack.name}: rack capacity must be a positive whole number.`, [rackRef]));
    for (const [i, device] of devices.entries()) {
      const refs = [rackRef, target('device', device.id)];
      if (device.rackStart == null || device.rackHeight == null) { findings.push(finding('rack-metadata', 'missing', `${device.name}: rack position or height is unspecified.`, refs)); continue; }
      if (!Number.isInteger(device.rackStart) || device.rackStart < 1 || !Number.isInteger(device.rackHeight) || device.rackHeight < 1) { findings.push(finding('rack-position', 'error', `${device.name}: rack position and height must be positive whole numbers.`, refs)); continue; }
      if (capacityKnown && device.rackStart + device.rackHeight - 1 > rack.rackUnits) findings.push(finding('rack-capacity', 'error', `${device.name} exceeds ${rack.name}'s ${rack.rackUnits}U capacity.`, refs));
      for (const other of devices.slice(i + 1)) if (Number.isInteger(other.rackStart) && other.rackStart > 0 && Number.isInteger(other.rackHeight) && other.rackHeight > 0 && device.rackStart < other.rackStart + other.rackHeight && other.rackStart < device.rackStart + device.rackHeight) findings.push(finding('rack-overlap', 'error', `${device.name} overlaps ${other.name} in ${rack.name}.`, [...refs, target('device', other.id)]));
    }
  }
  for (const device of project.devices) if (device.rackId && !project.racks.some(r => r.id === device.rackId && r.floorId === device.floorId)) findings.push(finding('dangling-rack', 'error', `${device.name} refers to a missing rack on its floor.`, [target('device', device.id)]));
  return findings;
}

function powerRule(project, context) {
  const findings = [], links = [];
  for (const cable of project.connections) {
    const a = context.ports.get(cable.from?.portId), b = context.ports.get(cable.to?.portId);
    if (!a || !b || a.deviceId !== cable.from.deviceId || b.deviceId !== cable.to.deviceId) continue;
    const aDevice = context.devices.get(a.deviceId), bDevice = context.devices.get(b.deviceId);
    if (!aDevice || !bDevice) continue;
    const refs = [target('connection', cable.id), target('port', a.id, a.deviceId), target('port', b.id, b.deviceId)];
    const interested = ['source', 'powered'].includes(a.poe) || ['source', 'powered'].includes(b.poe) || watts(aDevice.poeBudget) || watts(aDevice.poeDemand) || watts(bDevice.poeBudget) || watts(bDevice.poeDemand);
    if (interested && (!known(a.poe) || !known(b.poe))) findings.push(finding('poe-metadata', 'missing', `Connection ${cable.id}: PoE roles are unspecified, so power delivery is unknown.`, refs));
    if ((a.poe === 'powered' && ['none', 'powered'].includes(b.poe)) || (b.poe === 'powered' && a.poe === 'none')) findings.push(finding('poe-role-mismatch', 'warning', `Connection ${cable.id}: a powered interface has no specified PoE source.`, refs));
    for (const [source, powered] of [[a, b], [b, a]]) {
      if (source.poe !== 'source') continue;
      const sourceDevice = context.devices.get(source.deviceId), poweredDevice = context.devices.get(powered.deviceId);
      if (!sourceDevice || !poweredDevice) continue;
      if (powered.poe === 'powered') links.push({ source: sourceDevice, powered: poweredDevice, cable });
    }
  }
  const sources = new Map();
  for (const link of links) { if (!sources.has(link.powered.id)) sources.set(link.powered.id, new Set()); sources.get(link.powered.id).add(link.source.id); }
  for (const device of project.devices) {
    const supplied = links.filter(link => link.source.id === device.id), hasSource = project.ports.some(p => p.deviceId === device.id && p.poe === 'source');
    if (!hasSource) continue;
    const refs = [target('device', device.id)];
    if (!watts(device.poeBudget)) { findings.push(finding('poe-metadata', 'missing', `${device.name}: PoE budget is unspecified.`, refs)); continue; }
    const unique = [...new Map(supplied.map(link => [link.powered.id, link.powered])).values()];
    let demand = 0; const counted = [];
    for (const powered of unique) {
      if (sources.get(powered.id).size > 1) findings.push(finding('poe-metadata', 'missing', `${powered.name} has multiple PoE sources; the load on each source is unknown.`, [target('device', powered.id), ...refs]));
      else if (!watts(powered.poeDemand)) findings.push(finding('poe-metadata', 'missing', `${powered.name}: PoE demand is unspecified.`, [target('device', powered.id), ...refs]));
      else { demand += powered.poeDemand; counted.push(powered); }
    }
    if (demand > device.poeBudget) findings.push(finding('poe-over-budget', 'error', `${device.name}: known PoE demand ${demand} W exceeds its ${device.poeBudget} W budget.`, [...refs, ...counted.map(d => target('device', d.id))]));
  }
  return findings;
}

export const validationRules = [networkRule, connectionRule, rackRule, powerRule];
export function validateProject(project, rules = validationRules) {
  const data = { ...project, devices: project.devices || [], racks: project.racks || [], ports: project.ports || [], connections: project.connections || [] };
  const context = { devices: new Map(data.devices.map(d => [d.id, d])), ports: new Map(data.ports.map(p => [p.id, p])) };
  return rules.flatMap(rule => rule(data, context));
}
