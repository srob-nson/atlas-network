import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInventory, autoPlace, safeManagementUrl, restoreProject } from '../dist/model.js';

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
