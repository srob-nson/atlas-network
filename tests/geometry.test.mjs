import test from 'node:test';
import assert from 'node:assert/strict';
import { rotatePoint, unrotatePoint, projectPoint, unprojectPoint } from '../dist/geometry.js';

test('plan and angled coordinates round trip through all view rotations', () => {
  for (const view of ['plan', '3d']) for (let rotation = 0; rotation < 4; rotation++) {
    for (const [x, y] of [[0, 0], [12.5, 78.2], [100, 100]]) {
      const [a, b] = rotatePoint(x, y, rotation);
      assert.deepEqual(unrotatePoint(a, b, rotation).map(n => Math.round(n * 100) / 100), [x, y]);
      const [px, py] = projectPoint(x, y, 0, rotation, view);
      const [rx, ry] = unprojectPoint(px, py, rotation, view);
      assert.ok(Math.abs(rx - x) < 1e-9 && Math.abs(ry - y) < 1e-9);
    }
  }
});
