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
