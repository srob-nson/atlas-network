const pointKey = (floor, point) => JSON.stringify([floor, point?.x, point?.y]);
const measured = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const floorsOf = project => project.buildings.flatMap(building => building.floors);

function endpoint(project, ref) {
  const device = project.devices.find(item => item.id === ref?.deviceId);
  const marker = device?.rackId ? project.racks.find(rack => rack.id === device.rackId) : device;
  return marker?.placed && Number.isFinite(marker.x) && Number.isFinite(marker.y) ? { floorId: device.floorId, x: marker.x, y: marker.y } : null;
}

export function estimateRoute(project, connection) {
  const route = connection.route || {}, paths = project.pathways || [], risers = project.risers || [], floors = floorsOf(project);
  const selectedPaths = (route.pathwayIds || []).map(id => paths.find(path => path.id === id));
  const selectedRisers = (route.riserIds || []).map(id => risers.find(riser => riser.id === id));
  const issues = [], graph = new Map(); let meters = 0, validStructure = true;
  const validPoint = point => point && ['x', 'y'].every(key => measured(point[key]) && point[key] <= 100);
  const link = (a, b) => { if (!graph.has(a)) graph.set(a, []); if (!graph.has(b)) graph.set(b, []); graph.get(a).push(b); graph.get(b).push(a); };
  if (!selectedPaths.length || selectedPaths.some(path => !path) || selectedRisers.some(riser => !riser)) { validStructure = false; issues.push('Select existing pathways and risers.'); }
  if (new Set(route.pathwayIds || []).size !== selectedPaths.length || new Set(route.riserIds || []).size !== selectedRisers.length) { validStructure = false; issues.push('A pathway or riser is selected more than once.'); }
  for (const path of selectedPaths.filter(Boolean)) {
    const floor = floors.find(item => item.id === path.floorId), scale = floor?.scale;
    if (!floor || !Array.isArray(path.points) || path.points.length < 2 || !path.points.every(validPoint)) { validStructure = false; issues.push(`Pathway ${path.name || path.id} has incomplete geometry.`); continue; }
    link(pointKey(path.floorId, path.points[0]), pointKey(path.floorId, path.points.at(-1)));
    if (!(scale && measured(scale.widthMeters) && scale.widthMeters > 0 && measured(scale.heightMeters) && scale.heightMeters > 0)) { issues.push(`Set the floor scale for ${path.name}.`); continue; }
    for (let i = 1; i < path.points.length; i++) meters += Math.hypot((path.points[i].x - path.points[i - 1].x) / 100 * scale.widthMeters, (path.points[i].y - path.points[i - 1].y) / 100 * scale.heightMeters);
  }
  for (const riser of selectedRisers.filter(Boolean)) {
    if (!validPoint(riser.from) || !validPoint(riser.to) || !floors.some(f => f.id === riser.from.floorId) || !floors.some(f => f.id === riser.to.floorId) || riser.from.floorId === riser.to.floorId) { validStructure = false; issues.push(`Riser ${riser.name || riser.id} has incomplete endpoints.`); continue; }
    link(pointKey(riser.from.floorId, riser.from), pointKey(riser.to.floorId, riser.to));
    if (!measured(riser.lengthMeters)) issues.push(`Set the length of riser ${riser.name}.`);
    else meters += riser.lengthMeters;
  }
  const start = endpoint(project, connection.from), end = endpoint(project, connection.to);
  const startKey = start && pointKey(start.floorId, start), endKey = end && pointKey(end.floorId, end);
  let complete = !!(validStructure && startKey && endKey && graph.has(startKey) && graph.has(endKey));
  if (complete) {
    const visited = new Set(), queue = [startKey];
    while (queue.length) { const key = queue.pop(); if (visited.has(key)) continue; visited.add(key); queue.push(...(graph.get(key) || [])); }
    complete = visited.has(endKey) && visited.size === graph.size && [...graph].every(([key, edges]) => edges.length === (startKey !== endKey && (key === startKey || key === endKey) ? 1 : 2));
  }
  if (!complete) issues.push('Connect placed equipment through a continuous, unbranched chain of pathway and riser endpoints.');
  if (!measured(route.extraMeters)) issues.push('Enter the measured allowance for leads and slack.');
  else meters += route.extraMeters;
  if (!Number.isFinite(meters)) issues.push('The calculated length is too large to represent.');
  return { complete, meters: complete && !issues.length ? meters : null, issues };
}

function signature(project, connection) {
  const route = connection.route || {};
  const ends = [connection.from, connection.to].map(ref => {
    const device = project.devices.find(item => item.id === ref?.deviceId);
    const rack = device?.rackId ? project.racks.find(item => item.id === device.rackId) : null;
    const port = (project.ports || []).find(item => item.id === ref?.portId && item.deviceId === ref?.deviceId);
    return { position: endpoint(project, ref), rack: rack ? { id: rack.id, floorId: rack.floorId, name: rack.name, type: rack.type, vendor: rack.vendor || '', model: rack.model || '', rackUnits: rack.rackUnits ?? null, placed: !!rack.placed, x: rack.placed ? rack.x : null, y: rack.placed ? rack.y : null } : null, rackStart: device?.rackStart ?? null, rackHeight: device?.rackHeight ?? null, type: device?.type || '', vendor: device?.vendor || '', model: device?.model || '', port: port ? { id: port.id, deviceId: port.deviceId, name: port.name, speed: port.speed || '', media: port.media ?? 'Unknown', poe: port.poe ?? 'unknown' } : null };
  });
  const pathways = (route.pathwayIds || []).map(id => (project.pathways || []).find(path => path.id === id));
  const risers = (route.riserIds || []).map(id => (project.risers || []).find(riser => riser.id === id));
  const floorIds = new Set([...ends.map(end => end.position?.floorId), ...pathways.map(path => path?.floorId), ...risers.flatMap(riser => [riser?.from?.floorId, riser?.to?.floorId])]);
  return JSON.stringify({ from: connection.from, to: connection.to, ends, pathwayIds: route.pathwayIds, riserIds: route.riserIds, extraMeters: route.extraMeters, pathways, risers, floors: floorsOf(project).filter(floor => floorIds.has(floor.id)).map(({ id, scale, layoutRevision }) => ({ id, scale: scale ?? null, layoutRevision: layoutRevision ?? 0 })) });
}

function interfacesKnown(project, connection) {
  return [connection.from, connection.to].every(ref => ref?.portId && (project.ports || []).some(port => port.id === ref.portId && port.deviceId === ref.deviceId));
}

export function reviewRoute(project, connection, note) {
  if (typeof note !== 'string' || !note.trim() || note.length > 1000) throw new Error('Enter a review note of up to 1000 characters.');
  if (!estimateRoute(project, connection).complete) throw new Error('Complete the physical route before recording a review.');
  if (!interfacesKnown(project, connection)) throw new Error('Specify both connection interfaces before recording a review.');
  connection.route.review = { note: note.trim(), signature: signature(project, connection) };
}

export function routeStatus(project, connection) {
  const route = connection.route;
  if (!route || !(route.pathwayIds?.length || route.riserIds?.length)) return 'conceptual';
  return route.review?.signature === signature(project, connection) && interfacesKnown(project, connection) && estimateRoute(project, connection).complete ? 'reviewed' : 'documented';
}

export function compassAngle(northDegrees, rotation, view) {
  if (northDegrees == null || !Number.isFinite(northDegrees)) return null;
  const radians = northDegrees * Math.PI / 180;
  let x = Math.sin(radians) / 6.4, y = -Math.cos(radians) / 4.7;
  for (let i = 0; i < rotation; i++) [x, y] = [-y, x];
  const [sx, sy] = view === '3d' ? [3.25 * (x - y), 1.48 * (x + y)] : [6.4 * x, 4.7 * y];
  return Math.round(Math.atan2(sx, -sy) * 180 / Math.PI) || 0;
}
