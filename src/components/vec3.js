// GENERATED FILE — do not edit directly.
// Synced from reference/lib/math/vec3.js by scripts/sync-math.js
// (runs automatically before dev/build/deploy). Edit the source files in
// reference/lib/math/ and re-run `npm run sync-math` instead.

/**
 * Minimal 3D vector utilities. Vectors are plain `[x, y, z]` arrays so they
 * are trivial to log, destructure, and spread into typed arrays for GPU
 * buffers (e.g. `new Float32Array([...position, ...color])`).
 */

export function create(x = 0, y = 0, z = 0) {
  return [x, y, z];
}

export function clone(a) {
  return [a[0], a[1], a[2]];
}

export function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function length(a) {
  return Math.hypot(a[0], a[1], a[2]);
}

export function normalize(a) {
  const len = length(a);
  if (len === 0) return [0, 0, 0];
  return [a[0] / len, a[1] / len, a[2] / len];
}

export function lerp(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function negate(a) {
  return [-a[0], -a[1], -a[2]];
}

// Outward-facing normal of the triangle (p0, p1, p2), right-hand rule:
// normal = (p1 - p0) x (p2 - p0), normalized.
export function triangleNormal(p0, p1, p2) {
  return normalize(cross(sub(p1, p0), sub(p2, p0)));
}

// Volume of the parallelepiped spanned by a, b, c — zero exactly when the
// three vectors are coplanar.
export function scalarTriple(a, b, c) {
  return dot(a, cross(b, c));
}
