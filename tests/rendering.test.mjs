import test from 'node:test';
import assert from 'node:assert/strict';
import { drawScene } from '../dist/rendering.js';

test('scene rendering shows floor-specific pathways and risers with escaped labels', () => {
  const scene = { setAttribute(name, value) { this[name] = value; }, innerHTML: '' };
  const floor = { id: 'f', assets: [], cables: [], zones: [], outline: [], demo: false };
  const currentProject = { pathways: [{ id: 'p', name: '<tray>', floorId: 'f', points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }], risers: [{ id: 'r', name: 'Riser', from: { floorId: 'f', x: 10, y: 10 }, to: { floorId: 'other', x: 0, y: 0 } }] };
  drawScene({ scene, floor, project: floor, currentProject, selected: {}, view: 'plan', rotation: 0, zoom: 1, pan: { x: 0, y: 0 }, mode: 'select', outlineDraft: [], pathwayDraft: [], pointIndex: null, selectedCable: () => null, assetById: () => null, crossFloor: () => false, globalAsset: () => null, locationName: () => '', physicalAnchors: () => [] });
  assert.match(scene.innerHTML, /data-pathway="p"/);
  assert.match(scene.innerHTML, /data-riser="r"/);
  assert.match(scene.innerHTML, /&lt;tray&gt;/);
  assert.match(scene.viewBox, /^50 35 900 500$/);
});
