import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProject } from '../dist/validation.js';

const project = () => ({
  devices: [
    { id: 'a', name: 'Switch', ip: '192.0.2.1', network: 'Control', vrf: 'OT', poeBudget: 15 },
    { id: 'b', name: 'Camera', ip: '192.0.2.2', network: 'Control', vrf: 'OT', poeDemand: 20 }
  ], racks: [],
  ports: [
    { id: 'p1', deviceId: 'a', name: '1', speed: '1 Gbps', media: 'copper', poe: 'source' },
    { id: 'p2', deviceId: 'b', name: 'eth0', speed: '100 Mbps', media: 'fiber', poe: 'powered' }
  ], connections: [{ id: 'c', from: { deviceId: 'a', portId: 'p1' }, to: { deviceId: 'b', portId: 'p2' } }]
});
const has = (findings, code) => findings.some(f => f.code === code);

test('duplicate addresses are scoped to an explicitly known network and VRF', () => {
  const data = project(); data.devices[1].ip = data.devices[0].ip;
  let findings = validateProject(data);
  assert.ok(findings.some(f => f.code === 'duplicate-ip' && f.severity === 'error' && f.targets.length === 2));
  data.devices[1].vrf = 'Other';
  assert.equal(has(validateProject(data), 'duplicate-ip'), false);
  data.devices[1].vrf = 'ot';
  assert.equal(has(validateProject(data), 'duplicate-ip'), false);
  data.devices[1].vrf = '';
  findings = validateProject(data);
  assert.equal(has(findings, 'duplicate-ip'), false);
  assert.ok(findings.some(f => f.code === 'network-metadata' && f.severity === 'missing'));
});

test('link conflicts, media and speed mismatches, and PoE overload are explained', () => {
  const data = project();
  data.connections.push({ id: 'c2', from: { deviceId: 'a', portId: 'p1' }, to: { deviceId: 'b', portId: null } });
  const findings = validateProject(data);
  for (const code of ['port-conflict', 'media-mismatch', 'speed-mismatch', 'poe-over-budget']) assert.ok(has(findings, code), code);
  assert.ok(findings.find(f => f.code === 'port-conflict').targets.some(t => t.kind === 'port' && t.id === 'p1'));
});

test('equivalent speeds and unknown values do not imply incompatibility or sufficient power', () => {
  const data = project(); data.ports[1].speed = '1000 Mbps'; data.ports[1].media = 'Unknown'; data.devices[1].poeDemand = null;
  const findings = validateProject(data);
  assert.equal(has(findings, 'speed-mismatch'), false);
  assert.equal(has(findings, 'media-mismatch'), false);
  assert.equal(has(findings, 'poe-over-budget'), false);
  assert.ok(findings.some(f => f.code === 'poe-metadata' && f.severity === 'missing'));
});

test('PoE load with unspecified interface roles remains unknown', () => {
  const data = project(); data.ports.forEach(port => { port.poe = 'unknown'; });
  const findings = validateProject(data);
  assert.ok(findings.some(f => f.code === 'poe-metadata' && f.severity === 'missing'));
  assert.equal(has(findings, 'poe-over-budget'), false);
  data.ports[1].poe = 'powered'; data.ports[0].poe = 'none';
  assert.ok(has(validateProject(data), 'poe-role-mismatch'));
});

test('multiple PoE sources do not double-count an unknown load split', () => {
  const data = project();
  data.devices.push({ id: 's2', name: 'Second source', poeBudget: 1 });
  data.ports.push({ id: 'p3', deviceId: 's2', name: '1', poe: 'source' }, { id: 'p4', deviceId: 'b', name: 'eth1', poe: 'powered' });
  data.connections.push({ id: 'c2', from: { deviceId: 's2', portId: 'p3' }, to: { deviceId: 'b', portId: 'p4' } });
  const findings = validateProject(data);
  assert.equal(has(findings, 'poe-over-budget'), false);
  assert.ok(findings.some(f => f.code === 'poe-metadata' && /multiple/i.test(f.message)));
});

test('equivalent IPv6 addresses compare within the same scope', () => {
  const data = project();
  data.devices[0].ip = '2001:db8::1'; data.devices[1].ip = '2001:0db8:0:0:0:0:0:1';
  assert.ok(has(validateProject(data), 'duplicate-ip'));
});

test('invalid rack dimensions are errors and unitless speeds remain unknown', () => {
  const data = project(); data.ports[0].speed = '1000';
  data.racks.push({ id: 'r', name: 'Rack', rackUnits: -1 });
  data.devices[0].rackId = 'r'; data.devices[0].rackStart = 0; data.devices[0].rackHeight = 1;
  const findings = validateProject(data);
  assert.ok(findings.some(f => f.code === 'rack-capacity' && f.severity === 'error'));
  assert.ok(findings.some(f => f.code === 'rack-position' && f.severity === 'error'));
  assert.ok(findings.some(f => f.code === 'link-speed' && f.severity === 'missing'));
});

test('dangling references, disconnected devices, rack overflow and overlap are found', () => {
  const data = project();
  data.devices.push({ id: 'isolated', name: 'Isolated', rackId: 'r', rackStart: 2, rackHeight: 2 });
  data.devices[0].rackId = 'r'; data.devices[0].rackStart = 3; data.devices[0].rackHeight = 2;
  data.racks.push({ id: 'r', name: 'Rack', rackUnits: 3 });
  data.connections.push({ id: 'bad', from: { deviceId: 'missing', portId: 'p' }, to: { deviceId: 'b', portId: 'missing' } });
  const findings = validateProject(data);
  for (const code of ['dangling-endpoint', 'disconnected', 'rack-overlap', 'rack-capacity']) assert.ok(has(findings, code), code);
});

test('additional rules can be supplied without the DOM', () => {
  const input = { ...project(), name: 'Example', buildings: [{ id: 'building' }] };
  assert.deepEqual(validateProject(input, [data => [{ code: 'custom', severity: 'warning', message: data.name, targets: [data.buildings[0].id] }]])[0], { code: 'custom', severity: 'warning', message: 'Example', targets: ['building'] });
});
