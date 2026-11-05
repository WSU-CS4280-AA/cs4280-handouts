// GENERATED FILE: do not edit directly.
// Synced from starter/src/lib/math/mat4.js by scripts/sync-starter.js
// (runs automatically before dev/build/deploy). Edit the source file in
// starter/src/lib/ and re-run `npm run sync-starter` instead.

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
