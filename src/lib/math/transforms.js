// The handouts' implementation of the course library's transform functions.
// Names and signatures match starter/src/lib/math/transforms.js, so code moves
// between the handouts and the starter. This file is written for the handouts,
// so scripts/sync-starter.js does not touch it.
//
// All matrices are column-major Float32Array(16), as in mat4.js.

import * as mat4 from "./mat4.js";
import * as vec3 from "./vec3.js";

export function translate(tx, ty, tz) {
  const m = mat4.identity();
  m[12] = tx;
  m[13] = ty;
  m[14] = tz;
  return m;
}

export function scale(sx, sy, sz) {
  const m = mat4.identity();
  m[0] = sx;
  m[5] = sy;
  m[10] = sz;
  return m;
}

export function rotateX(radians) {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  const m = mat4.identity();
  m[5] = c;
  m[6] = s;
  m[9] = -s;
  m[10] = c;
  return m;
}

export function rotateY(radians) {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  const m = mat4.identity();
  m[0] = c;
  m[2] = -s;
  m[8] = s;
  m[10] = c;
  return m;
}

export function rotateZ(radians) {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  const m = mat4.identity();
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

  // The rotation part stores (right, trueUp, -forward) as rows, since this
  // matrix maps world space into that basis. The translation moves `eye` to
  // the origin.
  const m = mat4.identity();
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

/** A perspective projection for WebGPU's `z` in `[0, 1]` clip-space depth range. */
export function perspective(fovYRadians, aspect, near, far) {
  const f = 1 / Math.tan(fovYRadians / 2);
  const rangeInv = 1 / (near - far);
  const m = new Float32Array(16); // all zeros, not identity: m[15] must stay 0
  m[0] = f / aspect;
  m[5] = f;
  m[10] = far * rangeInv;
  m[11] = -1;
  m[14] = near * far * rangeInv;
  return m;
}

// Intrinsic Z-Y-X Euler angles (yaw * pitch * roll), a common convention and a
// direct source of gimbal lock when pitch approaches +/-90 degrees.
export function fromEulerZYX(yaw, pitch, roll) {
  return mat4.multiplyAll([rotateZ(yaw), rotateY(pitch), rotateX(roll)]);
}

/** An orthographic projection, with the same `z` in `[0, 1]` range as `perspective`. */
export function ortho(left, right, bottom, top, near, far) {
  const m = mat4.identity();
  m[0] = 2 / (right - left);
  m[5] = 2 / (top - bottom);
  const rangeInv = 1 / (near - far);
  m[10] = rangeInv;
  m[12] = -(right + left) / (right - left);
  m[13] = -(top + bottom) / (top - bottom);
  m[14] = near * rangeInv;
  return m;
}
