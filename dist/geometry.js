export const round = n => Math.round(n * 100) / 100;

export function rotatePoint(x, y, rotation) {
  if (rotation === 1) return [100 - y, x];
  if (rotation === 2) return [100 - x, 100 - y];
  if (rotation === 3) return [y, 100 - x];
  return [x, y];
}

export function unrotatePoint(x, y, rotation) {
  if (rotation === 1) return [y, 100 - x];
  if (rotation === 2) return [100 - x, 100 - y];
  if (rotation === 3) return [100 - y, x];
  return [x, y];
}

export function projectPoint(x, y, z, rotation, view) {
  const [a, b] = rotatePoint(x, y, rotation);
  return view === '3d' ? [500 + (a - b) * 3.25, 138 + (a + b) * 1.48 - z * 2.3] : [180 + a * 6.4, 65 + b * 4.7];
}

export function unprojectPoint(x, y, rotation, view) {
  let a, b;
  if (view === '3d') { const p = (x - 500) / 3.25, q = (y - 138) / 1.48; a = (p + q) / 2; b = (q - p) / 2; }
  else { a = (x - 180) / 6.4; b = (y - 65) / 4.7; }
  return unrotatePoint(a, b, rotation);
}

export function compassAngle(northDegrees, rotation, view) {
  if (northDegrees == null || !Number.isFinite(northDegrees)) return null;
  const radians = northDegrees * Math.PI / 180;
  let x = Math.sin(radians) / 6.4, y = -Math.cos(radians) / 4.7;
  for (let i = 0; i < rotation; i++) [x, y] = [-y, x];
  const [sx, sy] = view === '3d' ? [3.25 * (x - y), 1.48 * (x + y)] : [6.4 * x, 4.7 * y];
  return Math.round(Math.atan2(sx, -sy) * 180 / Math.PI) || 0;
}
