import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInventory, autoPlace, safeManagementUrl, restoreProject, placeAsset } from '../dist/model.js';

test('inventory import accepts quoted fields, matches zones, and reports unsupported types', () => {
  const zones = [{ id: 'z1', name: 'Network Room' }];
  const result = parseInventory('name,type,zone,ip,management_url\n"Core, A",switch,Network Room,10.0.0.1,https://10.0.0.1\nUnknown,printer,Network Room,,', zones);
  assert.equal(result.assets.length, 1);
  assert.equal(result.assets[0].name, 'Core, A');
  assert.equal(result.assets[0].zoneId, 'z1');
  assert.equal(result.assets[0].managementUrl, 'https://10.0.0.1/');
  assert.match(result.errors[0], /printer/i);
});

test('automatic placement uses the assigned zone without moving placed equipment', () => {
  const zones = [{ id: 'z1', name: 'Network Room', x: 10, y: 20, w: 30, h: 40 }];
  const assets = [
    { id: 'a', zoneId: 'z1', x: 12, y: 22, placed: true },
    { id: 'b', zoneId: 'z1', placed: false },
    { id: 'c', zoneId: '', placed: false }
  ];
  const placed = autoPlace(assets, zones);
  assert.deepEqual([placed[0].x, placed[0].y], [12, 22]);
  assert.equal(placed[1].placed, true);
  assert.ok(placed[1].x > 10 && placed[1].x < 40);
  assert.ok(placed[1].y > 20 && placed[1].y < 60);
  assert.equal(placed[2].placed, false);
});

test('management links reject executable schemes and allow web addresses', () => {
  assert.equal(safeManagementUrl('javascript:alert(1)'), '');
  assert.equal(safeManagementUrl('https://192.168.1.1'), 'https://192.168.1.1/');
  assert.equal(safeManagementUrl('not a url'), '');
});

test('project import rejects malformed geometry and removes unsafe management links', () => {
  assert.throws(() => restoreProject({ name: 'Bad', zones: [{ x: 'oops' }], assets: [], cables: [] }), /invalid/i);
  const result = restoreProject({ name: 'Example', zones: [], assets: [{ id: 'a', name: 'Switch', type: 'switch', managementUrl: 'javascript:alert(1)', placed: false }], cables: [] });
  assert.equal(result.assets[0].managementUrl, '');
});

test('moving equipment stays on the floor and assigns the smallest containing zone', () => {
  const zones = [
    { id: 'floor', x: 0, y: 0, w: 100, h: 100 },
    { id: 'room', x: 20, y: 20, w: 30, h: 30 }
  ];
  const asset = { id: 'a', zoneId: '', placed: false };
  assert.deepEqual(placeAsset(asset, zones, 25, 30), { id: 'a', zoneId: 'room', placed: true, x: 25, y: 30 });
  assert.deepEqual(placeAsset(asset, zones, -5, 120), { id: 'a', zoneId: 'floor', placed: true, x: 0, y: 100 });
  assert.equal(asset.placed, false);
});

test('cable waypoints round trip and reject invalid geometry', () => {
  const input = { name: 'Routes', zones: [], assets: [
    { id: 'a', name: 'A', type: 'switch', placed: true, x: 12, y: 18 },
    { id: 'b', name: 'B', type: 'router', placed: true, x: 90, y: 80 }
  ], cables: [{ id: 'c', from: 'a', to: 'b' }] };
  assert.deepEqual(restoreProject(input).cables[0].waypoints, []);
  input.cables[0].waypoints = [{ x: 5, y: 10 }, { x: 100, y: 0 }];
  assert.deepEqual(restoreProject(JSON.parse(JSON.stringify(input))).cables[0].waypoints, input.cables[0].waypoints);
  for (const waypoints of [null, {}, [{ x: '5', y: 0 }], [{ x: Infinity, y: 0 }], [{ x: -5, y: 0 }], [{ x: 101, y: 0 }], [{ x: 2, y: 0 }]]) {
    assert.throws(() => restoreProject({ ...input, cables: [{ ...input.cables[0], waypoints }] }), /invalid/i);
  }
});

test('routes connect fixed points with orthogonal elbows', async () => {
  const { cableRoute } = await import('../dist/model.js');
  assert.deepEqual(cableRoute({ x: 12, y: 18 }, [{ x: 30, y: 40 }, { x: 60, y: 40 }], { x: 83, y: 72 }), [
    [12, 18], [30, 18], [30, 40], [60, 40], [83, 40], [83, 72]
  ]);
});

test('rack assignments and connection details survive project restore', async () => {
  const { assignRacks } = await import('../dist/model.js');
  const assets = assignRacks([
    { id: 'r', name: 'Rack', type: 'cabinet', zoneId: 'z' },
    { id: 's', name: 'Switch', type: 'switch', zoneId: 'z' },
    { id: 'a', name: 'AP', type: 'access_point', zoneId: 'z' }
  ]);
  assert.equal(assets[1].rackId, 'r');
  assert.equal(assets[2].rackId, '');
  const project = restoreProject({ name: 'Rack', zones: [{ id: 'z', name: 'Room', x: 0, y: 0, w: 100, h: 100 }], assets, cables: [{ id: 'c', from: 's', to: 'a', fromPort: '1', toPort: 'WAN', label: 'Uplink', color: '#123456' }] });
  assert.equal(project.assets[1].rackId, 'r');
  assert.deepEqual([project.cables[0].fromPort, project.cables[0].toPort, project.cables[0].label, project.cables[0].color], ['1', 'WAN', 'Uplink', '#123456']);
});

test('ports default by device type and survive restoration with legacy connections', async () => {
  const { defaultPorts } = await import('../dist/model.js');
  assert.equal(defaultPorts('switch').length, 48);
  assert.equal(defaultPorts('router').length, 4);
  assert.equal(defaultPorts('firewall').length, 4);
  const input = { name: 'Ports', zones: [], assets: [
    { id: 'a', name: 'A', type: 'switch', ports: [{ name: 'SFP', speed: '10 Gbps' }] },
    { id: 'b', name: 'B', type: 'router' }
  ], cables: [{ id: 'c', from: 'a', to: 'b', fromPort: 'SFP', toPort: 'WAN' }] };
  const project = restoreProject(input);
  assert.deepEqual(project.assets[0].ports, [{ name: 'SFP', speed: '10 Gbps' }]);
  assert.ok(project.assets[1].ports.some(port => port.name === 'WAN'));
  assert.deepEqual(restoreProject(project).assets[0].ports, project.assets[0].ports);
});

test('rack connections require different devices and free existing ports', async () => {
  const { canConnectPorts } = await import('../dist/model.js');
  const assets = [{ id: 'a', rackId: 'r', ports: [{ name: '1' }, { name: '2' }] }, { id: 'b', rackId: 'r', ports: [{ name: '1' }] }, { id: 'c', rackId: 'other', ports: [{ name: '1' }] }];
  const cables = [{ from: 'a', fromPort: '1', to: 'b', toPort: '1' }];
  assert.equal(canConnectPorts(assets, [], 'r', 'a', '2', 'b', '1'), true);
  assert.equal(canConnectPorts(assets, cables, 'r', 'a', '2', 'b', '1'), false);
  assert.equal(canConnectPorts(assets, [], 'r', 'a', '2', 'a', '1'), false);
  assert.equal(canConnectPorts(assets, [], 'r', 'a', '2', 'c', '1'), false);
  assert.equal(canConnectPorts(assets, [], 'r', 'a', 'missing', 'b', '1'), false);
});

test('floor auto-placement does not require zones or move existing equipment', async () => {
  const { autoPlaceFloor } = await import('../dist/model.js');
  const assets = [{ id: 'a', placed: true, x: 15, y: 20, zoneId: 'old' }, { id: 'b', placed: false, zoneId: '' }, { id: 'c', placed: false, rackId: 'r' }];
  const result = autoPlaceFloor(assets);
  assert.deepEqual(result[0], assets[0]);
  assert.equal(result[1].placed, true);
  assert.equal(result[1].zoneId, '');
  assert.equal(result[2].placed, false);
});

test('rack assignment works without zones when there is a single cabinet', async () => {
  const { assignRacks } = await import('../dist/model.js');
  const assets = [{ id: 'r', type: 'cabinet' }, { id: 's', type: 'switch' }, { id: 'a', type: 'access_point' }];
  assert.equal(assignRacks(assets)[1].rackId, 'r');
  assert.equal(assignRacks([...assets, { id: 'r2', type: 'cabinet' }])[1].rackId, '');
  assert.equal(assignRacks([{ ...assets[1], rackId: '' }, assets[0]])[0].rackId, '');
});

test('project hierarchy migrates legacy data and validates cross-floor connections', async () => {
  const { restoreHierarchy } = await import('../dist/model.js');
  const old = { name: 'Office', floorName: 'Ground', zones: [], assets: [{ id: 'a', name: 'A', type: 'switch', placed: false }], cables: [] };
  const migrated = restoreHierarchy(old);
  assert.equal(migrated.buildings[0].floors[0].floorName, 'Ground');
  assert.equal(migrated.buildings[0].floors[0].assets[0].id, 'a');
  const floor = { id: 'f2', floorName: 'Upper', zones: [], assets: [{ id: 'b', name: 'B', type: 'switch', placed: false }] };
  migrated.buildings[0].floors.push(floor);
  migrated.cables.push({ id: 'c', from: 'a', to: 'b', fromPort: '1', toPort: '2', waypoints: [] });
  const restored = restoreHierarchy(JSON.parse(JSON.stringify(migrated)));
  assert.equal(restored.cables[0].to, 'b');
  assert.throws(() => restoreHierarchy({ ...migrated, cables: [{ id: 'x', from: 'a', to: 'missing' }] }), /invalid/i);
});

test('moving equipment between floors preserves connections and clears floor-specific placement', async () => {
  const { moveAssetToFloor } = await import('../dist/model.js');
  const device = { id: 'a', type: 'switch', rackId: 'r', zoneId: 'z', placed: true, x: 10, y: 20 };
  const source = { assets: [device, { id: 'r', type: 'cabinet' }] }, target = { assets: [] };
  const cables = [{ from: 'a', to: 'r', waypoints: [{ x: 10, y: 10 }] }];
  moveAssetToFloor(source, target, device, cables);
  assert.equal(source.assets.length, 1);
  assert.equal(target.assets[0].id, 'a');
  assert.equal(device.placed, false);
  assert.equal(device.rackId, '');
  assert.equal(device.zoneId, '');
  assert.deepEqual(cables[0].waypoints, []);
});

test('deploying rack-mounted equipment creates a floor rack without changing other devices', async () => {
  const { deployAsset } = await import('../dist/model.js');
  for (const type of ['switch', 'firewall', 'router']) {
    const device = { id: type, name: type, type, placed: false, rackId: '' };
    const assets = [device];
    deployAsset(assets, device, 30, 40);
    assert.equal(assets.length, 2);
    assert.equal(assets[1].type, 'cabinet');
    assert.equal(assets[1].placed, true);
    assert.equal(assets[1].x, 30);
    assert.equal(assets[1].y, 40);
    assert.equal(device.rackId, assets[1].id);
    assert.equal(device.placed, false);
  }
  const ap = { id: 'ap', name: 'AP', type: 'access_point', placed: false };
  const assets = [ap]; deployAsset(assets, ap, 10, 20);
  assert.equal(assets.length, 1);
  assert.equal(ap.placed, true);
});
