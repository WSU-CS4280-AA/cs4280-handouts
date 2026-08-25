// A minimal 2D vector toolkit, used throughout the Week 1 handout.
//
// Vectors here are plain {x, y} objects rather than typed arrays — at this
// stage we care about reading the arithmetic directly off the object, not
// about the packed-buffer layout WebGPU will demand starting Week 4.

export function add(a, b) {
  return {x: a.x + b.x, y: a.y + b.y};
}

export function sub(a, b) {
  return {x: a.x - b.x, y: a.y - b.y};
}

export function scale(a, k) {
  return {x: a.x * k, y: a.y * k};
}

export function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

// The 2D analogue of the cross product: it has no vector result in the
// plane, only a scalar equal to the z-component the full 3D cross product
// would produce if a and b were embedded in the xy-plane. Its sign tells
// you whether b is counter-clockwise (+) or clockwise (-) from a — exactly
// the test used for triangle winding order.
export function cross(a, b) {
  return a.x * b.y - a.y * b.x;
}

export function length(a) {
  return Math.sqrt(dot(a, a));
}

export function normalize(a) {
  const len = length(a);
  if (len < 1e-10) throw new Error("vec2.normalize: cannot normalize the zero vector");
  return scale(a, 1 / len);
}

export function angleBetween(a, b) {
  const cosTheta = dot(a, b) / (length(a) * length(b));
  // Clamp against floating-point drift pushing |cosTheta| slightly past 1.
  return Math.acos(Math.max(-1, Math.min(1, cosTheta)));
}

// The component of a that points along b (a's "shadow" cast onto b).
export function projectOnto(a, b) {
  return scale(b, dot(a, b) / dot(b, b));
}

export function lerp(a, b, t) {
  return {x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t};
}
