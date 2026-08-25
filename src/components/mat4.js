// GENERATED FILE — do not edit directly.
// Synced from reference/lib/math/mat4.js, reference/lib/math/transforms.js by scripts/sync-math.js
// (runs automatically before dev/build/deploy). Edit the source files in
// reference/lib/math/ and re-run `npm run sync-math` instead.

import * as vec3 from "./vec3.js";

/**
 * Generic 4x4 matrix arithmetic. Matrices are `Float32Array(16)` in
 * **column-major** order — `m[col * 4 + row]` — matching WGSL's
 * `mat4x4<f32>` memory layout, so these can be written directly into a
 * uniform buffer with no repacking.
 *
 * This file only covers generic linear algebra (identity, multiply,
 * transpose, invert). Building the actual transform matrices you need for
 * a scene (translate/rotate/scale/lookAt/perspective) is the subject of
 * `transforms.js` — that's the graphics content, this is just arithmetic.
 */

function get(m, row, col) {
  return m[col * 4 + row];
}

function set(m, row, col, value) {
  m[col * 4 + row] = value;
}

export function identity() {
  // biome-ignore format: visually align the matrix as a 4x4 grid
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

export function clone(m) {
  return Float32Array.from(m);
}

/** Returns `a * b` (column-vector convention: `(a * b) * v === a * (b * v)`). */
export function multiply(a, b) {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += a[k * 4 + row] * b[col * 4 + k];
      }
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

/** Transforms a homogeneous `[x, y, z, w]` vector by `m`. */
export function multiplyVec4(m, v) {
  const out = [0, 0, 0, 0];
  for (let row = 0; row < 4; row++) {
    out[row] = m[row] * v[0] + m[4 + row] * v[1] + m[8 + row] * v[2] + m[12 + row] * v[3];
  }
  return out;
}

/** Left-to-right `reduce` of `multiply` over a list of matrices. */
export function multiplyAll(matrices) {
  return matrices.reduce((acc, m) => multiply(acc, m));
}

/** Transforms a 3-component point `[x, y, z]` (implicit `w = 1`) by `m`, returning the full `[x, y, z, w]` quadruple *before* any perspective divide. */
export function transformPoint(m, p) {
  return multiplyVec4(m, [p[0], p[1], p[2], 1]);
}

/** Divides `[x, y, z, w]` by `w` — clip space to normalized device coordinates. */
export function perspectiveDivide(v) {
  return [v[0] / v[3], v[1] / v[3], v[2] / v[3]];
}

export function transpose(m) {
  const out = new Float32Array(16);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      set(out, col, row, get(m, row, col));
    }
  }
  return out;
}

function swapRows(m, r1, r2) {
  for (let c = 0; c < 4; c++) {
    const tmp = get(m, r1, c);
    set(m, r1, c, get(m, r2, c));
    set(m, r2, c, tmp);
  }
}

function scaleRow(m, r, s) {
  for (let c = 0; c < 4; c++) {
    set(m, r, c, get(m, r, c) * s);
  }
}

function addScaledRow(m, targetRow, sourceRow, factor) {
  for (let c = 0; c < 4; c++) {
    set(m, targetRow, c, get(m, targetRow, c) + factor * get(m, sourceRow, c));
  }
}

/**
 * General 4x4 inverse via Gauss-Jordan elimination with partial pivoting.
 * Throws if `m` is singular (or numerically too close to singular).
 * Used for normal matrices (`transpose(invert(modelMatrix))`) and similar —
 * a generic linear-algebra tool, not itself a "graphics algorithm".
 */
export function invert(m) {
  const a = Float32Array.from(m);
  const inv = identity();

  for (let col = 0; col < 4; col++) {
    let pivotRow = col;
    let maxAbs = Math.abs(get(a, col, col));
    for (let row = col + 1; row < 4; row++) {
      const candidate = Math.abs(get(a, row, col));
      if (candidate > maxAbs) {
        maxAbs = candidate;
        pivotRow = row;
      }
    }
    if (maxAbs < 1e-8) {
      throw new Error("mat4.invert: matrix is singular and cannot be inverted");
    }
    if (pivotRow !== col) {
      swapRows(a, col, pivotRow);
      swapRows(inv, col, pivotRow);
    }

    const pivot = get(a, col, col);
    scaleRow(a, col, 1 / pivot);
    scaleRow(inv, col, 1 / pivot);

    for (let row = 0; row < 4; row++) {
      if (row === col) continue;
      const factor = get(a, row, col);
      if (factor !== 0) {
        addScaledRow(a, row, col, -factor);
        addScaledRow(inv, row, col, -factor);
      }
    }
  }

  return inv;
}

// --- Transform-matrix construction (from transforms.js) ---

export function translate(tx, ty, tz) {
  const m = identity();
  m[12] = tx;
  m[13] = ty;
  m[14] = tz;
  return m;
}

export function scale(sx, sy, sz) {
  const m = identity();
  m[0] = sx;
  m[5] = sy;
  m[10] = sz;
  return m;
}

export function rotateX(radians) {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  const m = identity();
  m[5] = c;
  m[6] = s;
  m[9] = -s;
  m[10] = c;
  return m;
}

export function rotateY(radians) {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  const m = identity();
  m[0] = c;
  m[2] = -s;
  m[8] = s;
  m[10] = c;
  return m;
}

export function rotateZ(radians) {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  const m = identity();
  m[0] = c;
  m[1] = s;
  m[4] = -s;
  m[5] = c;
  return m;
}

/** A view matrix placing the camera at `eye`, looking toward `target`. */
export function lookAt(eye, target, up) {
  const forward = vec3.normalize(vec3.sub(target, eye));
  const right = vec3.normalize(vec3.cross(forward, up));
  const trueUp = vec3.cross(right, forward);

  // The rotation part is the (right, trueUp, -forward) basis, stored as
  // rows (i.e. transposed) since this matrix maps world space into that
  // basis; the translation part moves `eye` to the origin.
  const m = identity();
  m[0] = right[0];
  m[4] = right[1];
  m[8] = right[2];
  m[1] = trueUp[0];
  m[5] = trueUp[1];
  m[9] = trueUp[2];
  m[2] = -forward[0];
  m[6] = -forward[1];
  m[10] = -forward[2];
  m[12] = -vec3.dot(right, eye);
  m[13] = -vec3.dot(trueUp, eye);
  m[14] = vec3.dot(forward, eye);
  return m;
}

/**
 * A perspective projection matrix for WebGPU's `z` in `[0, 1]` clip-space
 * depth range (unlike OpenGL's `[-1, 1]`).
 */
export function perspective(fovYRadians, aspect, near, far) {
  const f = 1 / Math.tan(fovYRadians / 2);
  const rangeInv = 1 / (near - far);
  const m = new Float32Array(16); // starts at all zeros, not identity — m[15] must stay 0
  m[0] = f / aspect;
  m[5] = f;
  m[10] = far * rangeInv;
  m[11] = -1;
  m[14] = near * far * rangeInv;
  return m;
}

// Intrinsic Z-Y-X Euler angles (yaw * pitch * roll) — a common convention
// and a direct source of gimbal lock when pitch approaches +/-90 degrees.
export function fromEulerZYX(yaw, pitch, roll) {
  return multiplyAll([rotateZ(yaw), rotateY(pitch), rotateX(roll)]);
}

/** An orthographic projection matrix, same `z` in `[0, 1]` convention as `perspective`. */
export function ortho(left, right, bottom, top, near, far) {
  const m = identity();
  m[0] = 2 / (right - left);
  m[5] = 2 / (top - bottom);
  const rangeInv = 1 / (near - far);
  m[10] = rangeInv;
  m[12] = -(right + left) / (right - left);
  m[13] = -(top + bottom) / (top - bottom);
  m[14] = near * rangeInv;
  return m;
}
