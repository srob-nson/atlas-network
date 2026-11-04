import test from 'node:test';
import assert from 'node:assert/strict';
import { configurePorts, assignRack, serializeProject, restoreHierarchy } from '../dist/model.js';

test('port counts are configurable and connected interfaces cannot be removed', () => {
  const device = { id: 'switch', ports: [] };
  configurePorts(device, 24, []);
  assert.equal(device.ports.length, 24);
  assert.equal(new Set(device.ports.map(port => port.id)).size, 24);
  Object.assign(device.ports[23], { name: 'xe-0/0/23', speed: '10 Gbps', media: 'fiber' });
  const cable = { from: 'switch', fromPortId: device.ports[23].id, to: 'other', toPortId: 'p' };
  assert.throws(() => configurePorts(device, 23, [cable]), /connected/i);
  assert.throws(() => configurePorts(device, 23, [{ from: 'switch', fromPort: 'XE-0/0/23', to: 'other' }]), /connected/i);
  assert.equal(device.ports[23].name, 'xe-0/0/23');
  assert.equal(device.ports[23].media, 'fiber');
  assert.throws(() => configurePorts(device, -1, []), /count/i);
});

test('rack positions reject overlap, overflow and unknown occupancy', () => {
  const rack = { id: 'rack', type: 'cabinet', rackUnits: 12 };
  const first = { id: 'a', type: 'switch', rackId: '', rackStart: null, rackHeight: null };
  const second = { id: 'b', type: 'switch', rackId: '', rackStart: null, rackHeight: null };
  const assets = [rack, first, second];
  assignRack(assets, first, 'rack', 2, 2);
  assert.throws(() => assignRack(assets, second, 'rack', 3, 2), /occupied/i);
  assert.throws(() => assignRack(assets, second, 'rack', 12, 2), /capacity/i);
  assignRack(assets, second, 'rack', 4, 2);
  assert.equal(second.rackStart, 4);
  first.rackStart = null;
  assert.throws(() => assignRack(assets, second, 'rack', 6, 1), /unknown/i);
});

test('legacy connections retain unresolved endpoints and versioned entities round trip', () => {
  const legacy = { name: 'Legacy', zones: [], assets: [
    { id: 'a', name: 'A', type: 'switch', ports: [{ name: 'Gi1', speed: '1 Gbps' }] },
    { id: 'b', name: 'B', type: 'router', ports: [{ name: 'WAN', speed: 'Unknown' }] }
  ], cables: [{ id: 'c1', from: 'a', fromPort: 'Gi1', to: 'b', toPort: 'WAN' }, { id: 'c2', from: 'a', to: 'b' }] };
  const project = restoreHierarchy(legacy);
  const data = serializeProject(project);
  assert.equal(data.schemaVersion, 4);
  assert.equal(data.devices.length, 2);
  assert.equal(data.ports.length, 2);
  assert.ok(data.connections[0].from.portId);
  assert.equal(data.connections[1].from.deviceId, 'a');
  assert.equal(data.connections[1].from.portId, null);
  const roundTrip = serializeProject(restoreHierarchy(JSON.parse(JSON.stringify(data))));
  assert.deepEqual(roundTrip, data);
  const invalid = structuredClone(data);
  invalid.connections[0].from.portId = 'missing';
  assert.throws(() => restoreHierarchy(invalid), /invalid/i);
});

test('entity imports reject overlapping placements and invalid rack references', () => {
  const project = restoreHierarchy({ name: 'Rack', zones: [], assets: [
    { id: 'rack', type: 'cabinet', name: 'Rack', rackUnits: 12 },
    { id: 'a', type: 'switch', name: 'A', rackId: 'rack', rackStart: 2, rackHeight: 2, ports: [] },
    { id: 'b', type: 'switch', name: 'B', rackId: 'rack', rackStart: 4, rackHeight: 1, ports: [] }
  ], cables: [] });
  const data = serializeProject(project);
  assert.deepEqual(serializeProject(restoreHierarchy(JSON.parse(JSON.stringify(data)))), data);
  data.devices[1].rackStart = 3;
  assert.throws(() => restoreHierarchy(data), /invalid/i);
  data.devices[1].rackStart = 4;
  data.devices[1].rackId = 'missing';
  assert.throws(() => restoreHierarchy(data), /invalid/i);
});

test('legacy endpoint names are not silently truncated', () => {
  const legacy = { name: 'Legacy', zones: [], assets: [{ id: 'a', name: 'A', type: 'switch' }, { id: 'b', name: 'B', type: 'switch' }], cables: [{ id: 'c', from: 'a', to: 'b', fromPort: 'x'.repeat(81) }] };
  assert.throws(() => restoreHierarchy(legacy), /invalid/i);
});

test('migration rejects invalid port IDs instead of writing an unreadable project', () => {
  const legacy = { name: 'Legacy', zones: [], assets: [
    { id: 'a', name: 'A', type: 'switch', ports: [{ id: 'pa', name: 'one', speed: 'Unknown' }] },
    { id: 'b', name: 'B', type: 'switch', ports: [{ id: 'pb', name: 'one', speed: 'Unknown' }] }
  ], cables: [{ id: 'c', from: 'a', fromPort: 'one', fromPortId: 'missing', to: 'b', toPort: 'one' }] };
  assert.throws(() => restoreHierarchy(legacy), /invalid/i);
  legacy.cables[0].fromPortId = 'pa';
  legacy.assets[1].ports[0].id = 'pa';
  assert.throws(() => restoreHierarchy(legacy), /invalid/i);
});

test('engineering metadata survives export and old version 2 projects migrate with unknown values', () => {
  const project = restoreHierarchy({ name: 'Engineering', zones: [], assets: [
    { id: 'a', name: 'Switch', type: 'switch', network: 'OT', vrf: 'prod', poeBudget: 0, ports: [{ id: 'p', name: '1', speed: '1 Gbps', media: 'copper', poe: 'source' }] }
  ], cables: [] });
  const exported = serializeProject(project);
  const device = exported.devices[0];
  assert.deepEqual([device.network, device.vrf, device.poeBudget], ['OT', 'prod', 0]);
  assert.equal(exported.ports[0].poe, 'source');
  assert.deepEqual(serializeProject(restoreHierarchy(exported)), exported);
  const old = structuredClone(exported); old.schemaVersion = 2;
  delete old.devices[0].network; delete old.devices[0].vrf; delete old.devices[0].poeBudget; delete old.ports[0].poe;
  const migrated = serializeProject(restoreHierarchy(old));
  assert.equal(migrated.devices[0].poeBudget, null);
  assert.equal(migrated.ports[0].poe, 'unknown');
  const invalid = structuredClone(exported); invalid.devices[0].poeBudget = -1;
  assert.throws(() => restoreHierarchy(invalid), /invalid/i);
  invalid.devices[0].poeBudget = 0; invalid.ports[0].poe = 'invented';
  assert.throws(() => restoreHierarchy(invalid), /invalid/i);
});
