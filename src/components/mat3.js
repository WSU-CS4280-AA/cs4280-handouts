// Homogeneous 2D transforms for Week 3: 3x3 matrices acting on (x, y, w)
// triples. This is the direct extension of Week 1's mat2.js — the only
// new idea is the third row/column, which is what finally lets
// translation join the matrix-multiplication framework.
//
//   M = | m00  m01  m02 |
//       | m10  m11  m12 |
//       | m20  m21  m22 |

export function identity() {
  return {m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0, m20: 0, m21: 0, m22: 1};
}

// Applies M to a homogeneous (x, y, w) triple.
export function apply(M, p) {
  return {
    x: M.m00 * p.x + M.m01 * p.y + M.m02 * p.w,
    y: M.m10 * p.x + M.m11 * p.y + M.m12 * p.w,
    w: M.m20 * p.x + M.m21 * p.y + M.m22 * p.w
  };
}

// w = 1: a location. Translation moves it, as expected.
export function transformPoint(M, p) {
  const out = apply(M, {x: p.x, y: p.y, w: 1});
  return {x: out.x, y: out.y};
}

// w = 0: a direction. Translation's t_x/t_y terms are multiplied by w,
// so they vanish here — a vector passes through translation unchanged,
// exactly the physically correct behavior for "a displacement."
export function transformVector(M, v) {
  const out = apply(M, {x: v.x, y: v.y, w: 0});
  return {x: out.x, y: out.y};
}

export function multiply(A, B) {
  const out = {};
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += A[`m${row}${k}`] * B[`m${k}${col}`];
      out[`m${row}${col}`] = sum;
    }
  }
  return out;
}

export function translation(tx, ty) {
  return {m00: 1, m01: 0, m02: tx, m10: 0, m11: 1, m12: ty, m20: 0, m21: 0, m22: 1};
}

export function scaling(sx, sy) {
  return {m00: sx, m01: 0, m02: 0, m10: 0, m11: sy, m12: 0, m20: 0, m21: 0, m22: 1};
}

export function rotation(theta) {
  const c = Math.cos(theta), s = Math.sin(theta);
  return {m00: c, m01: -s, m02: 0, m10: s, m11: c, m12: 0, m20: 0, m21: 0, m22: 1};
}

export function shearX(lambda) {
  return {m00: 1, m01: lambda, m02: 0, m10: 0, m11: 1, m12: 0, m20: 0, m21: 0, m22: 1};
}

// Rotates about an arbitrary pivot: translate the pivot to the origin,
// rotate, translate back — T(pivot) * R(theta) * T(-pivot).
export function rotateAbout(pivot, theta) {
  return multiply(multiply(translation(pivot.x, pivot.y), rotation(theta)), translation(-pivot.x, -pivot.y));
}

export function multiplyAll(matrices) {
  return matrices.reduce((acc, m) => multiply(acc, m));
}
