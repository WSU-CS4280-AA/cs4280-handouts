// A minimal 2x2 matrix toolkit for Week 1's linear-transformation and SVD
// sections. WebGPU won't enter the picture until Week 4, so there's no
// reason yet to pack these into a column-major Float32Array the way a GPU
// uniform buffer will later demand (see reference implementations from
// Week 4 onward) — a plain {m00, m01, m10, m11} object, indexed exactly the
// way the lecture writes M_ij, is easier to read and to debug.
//
//   M = | m00  m01 |      M * [x, y]^T = | m00 x + m01 y |
//       | m10  m11 |                     | m10 x + m11 y |

export function identity() {
  return {m00: 1, m01: 0, m10: 0, m11: 1};
}

export function fromColumns(c0, c1) {
  return {m00: c0.x, m10: c0.y, m01: c1.x, m11: c1.y};
}

export function columns(M) {
  return [{x: M.m00, y: M.m10}, {x: M.m01, y: M.m11}];
}

// Matrix-vector multiplication: transforms a vector by M.
export function apply(M, v) {
  return {
    x: M.m00 * v.x + M.m01 * v.y,
    y: M.m10 * v.x + M.m11 * v.y
  };
}

// Matrix-matrix multiplication: (A * B) applied to v equals A applied to
// (B applied to v) — B acts first, closest to the vector.
export function multiply(A, B) {
  return {
    m00: A.m00 * B.m00 + A.m01 * B.m10,
    m01: A.m00 * B.m01 + A.m01 * B.m11,
    m10: A.m10 * B.m00 + A.m11 * B.m10,
    m11: A.m10 * B.m01 + A.m11 * B.m11
  };
}

export function transpose(M) {
  return {m00: M.m00, m01: M.m10, m10: M.m01, m11: M.m11};
}

export function determinant(M) {
  return M.m00 * M.m11 - M.m01 * M.m10;
}

export function invert(M) {
  const det = determinant(M);
  if (Math.abs(det) < 1e-10) throw new Error("mat2.invert: matrix is singular");
  const invDet = 1 / det;
  return {
    m00: M.m11 * invDet,
    m01: -M.m01 * invDet,
    m10: -M.m10 * invDet,
    m11: M.m00 * invDet
  };
}

// Q^T Q should equal the identity (within floating-point tolerance) exactly
// when Q's columns are unit length and mutually perpendicular.
export function isOrthonormal(M, tolerance = 1e-6) {
  const QtQ = multiply(transpose(M), M);
  return (
    Math.abs(QtQ.m00 - 1) < tolerance &&
    Math.abs(QtQ.m11 - 1) < tolerance &&
    Math.abs(QtQ.m01) < tolerance &&
    Math.abs(QtQ.m10) < tolerance
  );
}

export function frobeniusDistance(A, B) {
  return Math.sqrt(
    (A.m00 - B.m00) ** 2 + (A.m01 - B.m01) ** 2 + (A.m10 - B.m10) ** 2 + (A.m11 - B.m11) ** 2
  );
}

// --- Named constructors for the four linear transformations covered this
// week (all fix the origin — translation needs homogeneous coordinates,
// which is Week 3's job). ---

export function scaling(sx, sy) {
  return {m00: sx, m01: 0, m10: 0, m11: sy};
}

export function rotation(theta) {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return {m00: c, m01: -s, m10: s, m11: c};
}

export function reflectionX() {
  // Flips y — reflects across the x-axis.
  return {m00: 1, m01: 0, m10: 0, m11: -1};
}

export function reflectionY() {
  // Flips x — reflects across the y-axis.
  return {m00: -1, m01: 0, m10: 0, m11: 1};
}

export function shear(hx, hy) {
  return {m00: 1, m01: hx, m10: hy, m11: 1};
}

// --- 2x2 SVD, computed numerically rather than from a memorized closed
// form, so the derivation stays checkable: ---
//
// 1. Form A = M^T M. It's symmetric and positive semi-definite, so it has
//    a real, orthonormal eigenbasis — that eigenbasis *is* V, and its
//    eigenvalues are the squared singular values.
// 2. For a symmetric 2x2 [[p, q], [q, r]], the eigenvectors sit at angle
//    theta = atan2(2q, p - r) / 2 and its perpendicular.
// 3. Push each v_i through M: since M v_i = sigma_i u_i by definition of
//    the SVD, dividing by its length simultaneously recovers sigma_i and
//    the matching column of U.
export function svd(M) {
  const A = multiply(transpose(M), M); // A.m01 === A.m10, since A is symmetric
  const p = A.m00, q = A.m01, r = A.m11;

  const thetaV = Math.abs(p - r) < 1e-12 && Math.abs(q) < 1e-12 ? 0 : 0.5 * Math.atan2(2 * q, p - r);
  const v0 = {x: Math.cos(thetaV), y: Math.sin(thetaV)};
  const v1 = {x: -Math.sin(thetaV), y: Math.cos(thetaV)};

  const Mv0 = apply(M, v0);
  const Mv1 = apply(M, v1);
  let sigma0 = Math.hypot(Mv0.x, Mv0.y);
  let sigma1 = Math.hypot(Mv1.x, Mv1.y);

  let u0 = sigma0 > 1e-10 ? {x: Mv0.x / sigma0, y: Mv0.y / sigma0} : {x: 1, y: 0};
  let u1 = sigma1 > 1e-10 ? {x: Mv1.x / sigma1, y: Mv1.y / sigma1} : {x: -u0.y, y: u0.x};

  // Guard against a rank-deficient M sending both v0 and v1 near zero.
  if (sigma0 <= 1e-10 && sigma1 <= 1e-10) {
    u0 = {x: 1, y: 0};
    u1 = {x: 0, y: 1};
  }

  return {
    U: fromColumns(u0, u1),
    singularValues: [sigma0, sigma1],
    V: fromColumns(v0, v1)
  };
}
