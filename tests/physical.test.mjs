import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateRoute, reviewRoute, routeStatus, compassAngle } from '../dist/physical.js';
import { restoreHierarchy, serializeProject } from '../dist/model.js';

const design = () => ({
  buildings: [{ id: 'b', floors: [{ id: 'f1', scale: { widthMeters: 10, heightMeters: 20 } }, { id: 'f2', scale: { widthMeters: 10, heightMeters: 20 } }] }],
  devices: [{ id: 'a', floorId: 'f1', x: 0, y: 0, placed: true }, { id: 'b', floorId: 'f2', x: 100, y: 0, placed: true }], racks: [],
  ports: [{ id: 'pa', deviceId: 'a', name: '1', media: 'copper' }, { id: 'pb', deviceId: 'b', name: '1', media: 'copper' }],
  pathways: [{ id: 'p1', name: 'Ground tray', floorId: 'f1', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }, { id: 'p2', name: 'Upper tray', floorId: 'f2', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }],
  risers: [{ id: 'r', name: 'Riser', from: { floorId: 'f1', x: 100, y: 0 }, to: { floorId: 'f2', x: 0, y: 0 }, lengthMeters: 4 }]
});
const cable = () => ({ id: 'c', from: { deviceId: 'a', portId: 'pa' }, to: { deviceId: 'b', portId: 'pb' }, route: { pathwayIds: ['p1', 'p2'], riserIds: ['r'], extraMeters: 3, review: null } });

test('a documented cross-floor route estimates measured pathways, riser and allowance', () => {
  const result = estimateRoute(design(), cable());
  assert.equal(result.complete, true);
  assert.equal(result.meters, 27);
  assert.equal(routeStatus(design(), cable()), 'documented');
});

test('same-floor routes need no riser and use the entered floor scale', () => {
  const project = design(), connection = cable();
  project.devices[1].floorId = 'f1';
  connection.route = { pathwayIds: ['p1'], riserIds: [], extraMeters: 0, review: null };
  assert.equal(estimateRoute(project, connection).meters, 10);
});

test('two devices in the same rack can use a documented loop', () => {
  const project = design(), connection = cable();
  project.devices.forEach(device => { device.floorId = 'f1'; device.rackId = 'rack'; });
  project.racks = [{ id: 'rack', floorId: 'f1', placed: true, x: 0, y: 0 }];
  project.pathways[0].points = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 0, y: 0 }];
  connection.route = { pathwayIds: ['p1'], riserIds: [], extraMeters: 2, review: null };
  assert.equal(estimateRoute(project, connection).meters, 6);
  reviewRoute(project, connection, 'Checked rack');
  project.racks[0].model = 'Different cabinet';
  assert.equal(routeStatus(project, connection), 'documented');
});

test('unknown measurements and disconnected floor paths never invent a length', () => {
  const project = design(), connection = cable();
  project.buildings[0].floors[1].scale = null;
  assert.equal(estimateRoute(project, connection).meters, null);
  assert.match(estimateRoute(project, connection).issues.join(' '), /scale/i);
  project.risers[0].lengthMeters = null;
  assert.match(estimateRoute(project, connection).issues.join(' '), /riser/i);
  connection.route.riserIds = [];
  assert.equal(estimateRoute(project, connection).complete, false);
  assert.throws(() => reviewRoute(project, connection, 'Reviewed on site'), /complete/i);
  connection.route.riserIds = ['r', 'missing'];
  assert.equal(estimateRoute(project, connection).complete, false);
});

test('an overflowing measurement never displays an infinite cable length', () => {
  const project = design(), connection = cable();
  project.buildings[0].floors.forEach(floor => { floor.scale.widthMeters = Number.MAX_VALUE; });
  const result = estimateRoute(project, connection);
  assert.equal(result.meters, null);
  assert.match(result.issues.join(' '), /large/i);
});

test('manual review becomes stale after route, scale or endpoint changes', () => {
  const project = design(), connection = cable();
  assert.throws(() => reviewRoute(project, connection, '  '), /note/i);
  connection.to.portId = null;
  assert.throws(() => reviewRoute(project, connection, 'Surveyed'), /interface/i);
  connection.to.portId = 'pb';
  reviewRoute(project, connection, 'Surveyed by engineer');
  assert.equal(routeStatus(project, connection), 'reviewed');
  project.buildings[0].floors.push({ id: 'unrelated', scale: null });
  assert.equal(routeStatus(project, connection), 'reviewed');
  project.ports[0].media = 'fiber';
  assert.equal(routeStatus(project, connection), 'documented');
  reviewRoute(project, connection, 'Reviewed fiber route');
  project.pathways[0].points.splice(1, 0, { x: 50, y: 5 });
  assert.equal(routeStatus(project, connection), 'documented');
  reviewRoute(project, connection, 'Surveyed again');
  project.buildings[0].floors[0].layoutRevision = 1;
  assert.equal(routeStatus(project, connection), 'documented');
  reviewRoute(project, connection, 'Surveyed updated plan');
  project.buildings[0].floors[0].scale.widthMeters = 11;
  assert.equal(routeStatus(project, connection), 'documented');
  reviewRoute(project, connection, 'Surveyed updated scale');
  project.devices[0].x = 1;
  assert.equal(routeStatus(project, connection), 'documented');
});

test('north direction rotates with the view and stays unknown until specified', () => {
  assert.equal(compassAngle(null, 0, 'plan'), null);
  assert.equal(compassAngle(0, 0, 'plan'), 0);
  assert.equal(compassAngle(45, 0, 'plan'), 45);
  assert.equal(compassAngle(0, 1, 'plan'), 90);
  assert.equal(Math.abs(compassAngle(0, 2, 'plan')), 180);
  assert.notEqual(compassAngle(0, 0, '3d'), compassAngle(0, 1, '3d'));
});

test('physical entities, scale and review survive project JSON and reject broken references', () => {
  const old = { name: 'Physical', zones: [], assets: [{ id: 'a', name: 'A', type: 'switch' }, { id: 'b', name: 'B', type: 'switch' }], cables: [{ id: 'c', from: 'a', to: 'b' }] };
  const runtime = restoreHierarchy(old);
  const floor = runtime.buildings[0].floors[0];
  floor.scale = { widthMeters: 20, heightMeters: 10 }; floor.northDegrees = 45;
  runtime.pathways.push({ id: 'p', name: 'Tray', floorId: floor.id, points: [{ x: 0, y: 0 }, { x: 50, y: 50 }] });
  runtime.cables[0].route = { pathwayIds: ['p'], riserIds: [], extraMeters: 2, review: null };
  const data = serializeProject(runtime);
  assert.equal(data.schemaVersion, 4);
  assert.deepEqual(serializeProject(restoreHierarchy(JSON.parse(JSON.stringify(data)))), data);
  const invalidScale = structuredClone(data); invalidScale.buildings[0].floors[0].scale.widthMeters = 0;
  assert.throws(() => restoreHierarchy(invalidScale), /invalid/i);
  const invalidPoint = structuredClone(data); invalidPoint.pathways[0].points[0].x = 101;
  assert.throws(() => restoreHierarchy(invalidPoint), /invalid/i);
  const missingPaths = structuredClone(data); delete missingPaths.pathways;
  assert.throws(() => restoreHierarchy(missingPaths), /invalid/i);
  data.connections[0].route.pathwayIds.push('missing');
  assert.throws(() => restoreHierarchy(data), /invalid/i);
});

test('new connections export an explicit conceptual route', () => {
  const project = restoreHierarchy({ name: 'Old', zones: [], assets: [{ id: 'a', name: 'A', type: 'switch' }, { id: 'b', name: 'B', type: 'switch' }], cables: [{ id: 'c', from: 'a', to: 'b' }] });
  delete project.cables[0].route;
  const data = serializeProject(project);
  assert.deepEqual(data.connections[0].route, { pathwayIds: [], riserIds: [], extraMeters: null, review: null });
  assert.deepEqual(serializeProject(restoreHierarchy(JSON.parse(JSON.stringify(data)))), data);
  delete data.pathways;
  assert.throws(() => restoreHierarchy(data), /invalid/i);
});

test('version 3 projects migrate without invented scale, orientation or routes', () => {
  const runtime = restoreHierarchy({ name: 'Old', zones: [], assets: [{ id: 'a', name: 'A', type: 'switch' }, { id: 'b', name: 'B', type: 'switch' }], cables: [{ id: 'c', from: 'a', to: 'b' }] });
  const data = serializeProject(runtime); data.schemaVersion = 3;
  delete data.pathways; delete data.risers; delete data.connections[0].route;
  delete data.buildings[0].floors[0].scale; delete data.buildings[0].floors[0].northDegrees; delete data.buildings[0].floors[0].layoutRevision;
  const migrated = serializeProject(restoreHierarchy(data));
  assert.equal(migrated.schemaVersion, 4);
  assert.deepEqual(migrated.pathways, []);
  assert.deepEqual(migrated.risers, []);
  assert.equal(migrated.buildings[0].floors[0].scale, null);
  assert.equal(migrated.buildings[0].floors[0].northDegrees, null);
  assert.equal(routeStatus(migrated, migrated.connections[0]), 'conceptual');
});

test('review of newly created rack equipment remains valid after reload normalization', () => {
  const project = restoreHierarchy({ name: 'New', zones: [], assets: [], cables: [] });
  const floor = project.buildings[0].floors[0];
  floor.scale = { widthMeters: 10, heightMeters: 10 };
  floor.assets.push({ id: 'rack', name: 'Rack', type: 'cabinet', rackUnits: 12, placed: true, x: 0, y: 0, ports: [] });
  floor.assets.push({ id: 'a', name: 'A', type: 'switch', rackId: 'rack', rackStart: 1, rackHeight: 1, ports: [{ id: 'pa', name: '1', speed: 'Unknown', media: 'Unknown', poe: 'unknown' }] });
  floor.assets.push({ id: 'b', name: 'B', type: 'switch', rackId: 'rack', rackStart: 2, rackHeight: 1, ports: [{ id: 'pb', name: '1', speed: 'Unknown', media: 'Unknown', poe: 'unknown' }] });
  project.pathways.push({ id: 'p', name: 'Loop', floorId: floor.id, points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 0, y: 0 }] });
  project.cables.push({ id: 'c', from: 'a', fromPort: '1', fromPortId: 'pa', to: 'b', toPort: '1', toPortId: 'pb', waypoints: [], route: { pathwayIds: ['p'], riserIds: [], extraMeters: 0, review: null } });
  const before = serializeProject(project);
  reviewRoute(before, before.connections[0], 'Checked');
  project.cables[0].route.review = before.connections[0].route.review;
  const after = serializeProject(restoreHierarchy(JSON.parse(JSON.stringify(serializeProject(project)))));
  assert.equal(routeStatus(after, after.connections[0]), 'reviewed');
});
