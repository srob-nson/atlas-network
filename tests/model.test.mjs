import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInventory, autoPlace, safeManagementUrl, restoreProject, placeAsset, canAssignRack } from '../dist/model.js';

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

const rackProject = () => ({ name: 'Rack', zones: [], assets: [
  { id: 'rack', name: 'Rack', type: 'cabinet', capacity: 12 },
  { id: 'a', name: 'Switch', type: 'switch', cabinetId: 'rack', rackUnit: 2, rackHeight: 2, ports: [{ id: 'p1', label: 'LAN' }] },
  { id: 'b', name: 'Router', type: 'router', ports: [{ id: 'p2', label: 'WAN' }] }
], cables: [{ id: 'c', from: 'a', to: 'b', fromPort: 'p1', toPort: 'p2', waypoints: [{ x: 10, y: 20 }] }] });

test('project import round trips rack, port and cable data and supplies old defaults', () => {
  const project = restoreProject(rackProject());
  assert.equal(project.assets[0].capacity, 12);
  assert.equal(project.assets[1].cabinetId, 'rack');
  assert.equal(project.assets[1].rackUnit, 2);
  assert.deepEqual(project.assets[1].ports, [{ id: 'p1', label: 'LAN' }]);
  assert.deepEqual(project.cables[0].waypoints, [{ x: 10, y: 20 }]);
  assert.equal(project.cables[0].fromPort, 'p1');
  assert.deepEqual(restoreProject(JSON.parse(JSON.stringify(project))), project);
  const legacy = restoreProject({ name: 'Old', zones: [], assets: [{ id: 'r', name: 'Rack', type: 'cabinet' }, { id: 's', name: 'Switch', type: 'switch' }], cables: [{ id: 'c', from: 'r', to: 's' }] });
  assert.equal(legacy.assets[0].capacity, 42);
  assert.equal(legacy.assets[1].rackHeight, 1);
  assert.equal(legacy.assets[1].cabinetId, '');
  assert.deepEqual(legacy.assets[1].ports, []);
  assert.deepEqual(legacy.cables[0].waypoints, []);
});

test('project import rejects invalid rack placements, port references and waypoint geometry', () => {
  for (const mutate of [
    p => { p.assets[1].rackUnit = 12; },
    p => { p.assets[2].cabinetId = 'rack'; p.assets[2].rackUnit = 3; },
    p => { p.assets[1].cabinetId = 'missing'; },
    p => { p.assets[1].ports[0].label = ''; },
    p => { p.cables[0].fromPort = 'missing'; },
    p => { p.cables[0].waypoints[0].x = 101; },
    p => { p.cables[0].waypoints = 'bad'; }
  ]) {
    const project = rackProject(); mutate(project);
    assert.throws(() => restoreProject(project), /invalid/i);
  }
});


test('rack assignment checks bounds and occupancy while allowing moves and unassignment', () => {
  const assets = restoreProject(rackProject()).assets;
  assert.equal(canAssignRack(assets, 'b', 'rack', 3, 1), false);
  assert.equal(canAssignRack(assets, 'b', 'rack', 12, 2), false);
  assert.equal(canAssignRack(assets, 'a', 'rack', 2, 2), true);
  assert.equal(canAssignRack(assets, 'b', 'rack', 4, 1), true);
  assert.equal(canAssignRack(assets, 'a', '', null, 2), true);
});
