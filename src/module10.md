---
title: Module 10 — Ray Tracing
toc: true
---

```js
import * as vec3 from "./lib/math/vec3.js";
import {initializeWebGPU} from "./lib/webgpu.js";
import {plane, drawPoint, dragPoints} from "./components/vectorField.js";
import * as Inputs from "npm:@observablehq/inputs";
import {html} from "npm:htl";
```

# Module 10 · Ray Tracing

A **ray tracer** renders in **image order**: for each pixel, it generates
a viewing ray, finds the first object the ray hits, and shades that point.
This handout builds a complete ray tracer in JavaScript one piece at a
time (camera, intersection with spheres, triangles, and boxes, groups,
bounding boxes, shading, shadows, and mirror reflection). It then builds
a **progressive** CPU tracer, with two-sided surfaces and an image that
fills in a few rows per frame through WebGPU, and finally moves the
algorithm to a WebGPU compute shader. The WebGPU sections need
**Chrome or Edge 113+**. The code is part of the reading: each step is built and tested
here, while the code that only draws the demos stays out of sight. This handout teaches the
*techniques*; it is not a walkthrough of any graded assignment.

## Image-Order Rendering

| | Object order (rasterization) | Image order (ray tracing) |
|---|---|---|
| outer loop | objects: find the pixels each one covers | pixels: find the object each one sees |
| visibility | z-buffer | closest hit along the ray |
| shadows, mirrors | extra passes and approximations | more rays from the hit point |
| perspective | projection matrix | rays fan out from the eye |

The basic algorithm has three parts:

```
for each pixel do
  compute the viewing ray                     // ray generation
  find the first object hit by the ray        // ray intersection
  set the pixel color from the hit            // shading
```

## Generating Viewing Rays

### Rays, the camera frame, and pixel positions

A ray is ${tex`\mathbf p(t) = \mathbf e + t\,\mathbf d`}. The camera is an
orthonormal frame ${tex`\mathbf u`} (right), ${tex`\mathbf v`} (up),
${tex`\mathbf w`} (backward) at the eye ${tex`\mathbf e`}, built from a
view direction and an up vector:

```js echo
function cameraFrame(eye, target, up = [0, 1, 0]) {
  const w = vec3.normalize(vec3.sub(eye, target));   // backward
  const u = vec3.normalize(vec3.cross(up, w));       // right
  const v = vec3.cross(w, u);                        // true up
  return {e: eye, u, v, w};
}
```

A camera at ${tex`z = 5`} looking at the origin should get the standard axes, with
${tex`\mathbf w = (0, 0, 1)`} pointing back toward it:

```js echo
Object.values(cameraFrame([0, 0, 5], [0, 0, 0])).slice(1)
  .map((axis) => axis.join(", "))
```

Each pixel's center lies on the image rectangle ${tex`[l, r] \times [b, t]`}. The
${tex`+0.5`} moves from the pixel's corner to its center:

```js echo
const pixelUV = ({l, r, b, t}, i, j, nx, ny) => [
  l + (r - l) * (i + 0.5) / nx,
  b + (t - b) * (j + 0.5) / ny
];
```

On a window from −1 to 1 with 2 × 2 pixels, the first pixel's center should be at
(−0.5, −0.5):

```js echo
pixelUV({l: -1, r: 1, b: -1, t: 1}, 0, 0, 2, 2)
```

That point in the image gives the ray. A perspective ray starts at the eye and passes through
the point, which lies a distance ${tex`d`} along ${tex`-\mathbf w`}. An orthographic ray starts at
the point, and every such ray runs in the same direction:

```js echo
function viewingRay(cam, i, j, nx, ny) {
  const [us, vs] = pixelUV(cam, i, j, nx, ny);
  const offset = vec3.add(vec3.scale(cam.u, us), vec3.scale(cam.v, vs));
  return cam.perspective
    ? {o: cam.e, d: vec3.add(vec3.scale(cam.w, -cam.d), offset)}
    : {o: vec3.add(cam.e, offset), d: vec3.scale(cam.w, -1)};
}
```

Finally, a small function evaluates a ray at ${tex`t`}:

```js echo
const at = (ray, t) => vec3.add(ray.o, vec3.scale(ray.d, t));
```

### Orthographic and perspective rays

A top view of the same idea: the eye sits at the bottom, the image
rectangle (with ${tex`n_x`} pixel centers) is a distance ${tex`d`} in
front of it, and each ray stops at the first circle it hits.

```js
const rayFanForm = view(Inputs.form({
  kind: Inputs.radio(["perspective", "orthographic", "oblique"], {value: "perspective", label: "projection"}),
  nx: Inputs.range([3, 24], {value: 9, step: 1, label: "pixels nₓ"}),
  d: Inputs.range([0.5, 3], {value: 1.2, step: 0.1, label: "image plane distance d"})
}));
```

```js
(() => {
  const scene = plane({width: 380, height: 380, domain: 4.6});
  const eye = {x: 0, y: -4}, half = 1.6;                       // camera looks along +y, so −w = (0, 1)
  const circles = [{c: {x: -1.6, y: 1.4}, r: 0.8, color: "steelblue"}, {c: {x: 1.4, y: 0.3}, r: 1, color: "seagreen"}, {c: {x: 0.2, y: 3}, r: 0.6, color: "purple"}];
  const hit2D = (o, d) => {
    let best = 12;
    for (const {c, r} of circles) {
      const ec = {x: o.x - c.x, y: o.y - c.y}, A = d.x * d.x + d.y * d.y, B = d.x * ec.x + d.y * ec.y, C = ec.x * ec.x + ec.y * ec.y - r * r;
      const disc = B * B - A * C;
      if (disc >= 0) { const t = (-B - Math.sqrt(disc)) / A; if (t > 0 && t < best) best = t; }
    }
    return best;
  };
  for (const {c, r, color} of circles) scene.svg.append("circle").attr("cx", scene.x(c.x)).attr("cy", scene.y(c.y)).attr("r", scene.x(r) - scene.x(0)).attr("fill", color).attr("fill-opacity", 0.35);
  const yImage = eye.y + rayFanForm.d;
  scene.svg.append("line").attr("x1", scene.x(-half)).attr("x2", scene.x(half)).attr("y1", scene.y(yImage)).attr("y2", scene.y(yImage)).attr("stroke", "black").attr("stroke-width", 2);
  for (let i = 0; i < rayFanForm.nx; i++) {
    const us = -half + 2 * half * (i + 0.5) / rayFanForm.nx;
    const kind = rayFanForm.kind;
    const o = kind === "perspective" ? eye : {x: us, y: eye.y};                        // parallel: origins on the line through e
    const d = kind === "perspective" ? {x: us, y: rayFanForm.d} : kind === "oblique" ? {x: 0.5, y: 1} : {x: 0, y: 1};
    const t = hit2D(o, d), s = (yImage - o.y) / d.y;                                     // s: where the ray crosses the image line
    scene.svg.append("line").attr("x1", scene.x(o.x)).attr("y1", scene.y(o.y)).attr("x2", scene.x(o.x + t * d.x)).attr("y2", scene.y(o.y + t * d.y))
      .attr("stroke", "orange").attr("stroke-width", 1.4);
    drawPoint(scene, {x: o.x + s * d.x, y: yImage}, {color: "black", r: 2.5});
  }
  drawPoint(scene, eye, {color: "crimson", r: 5, label: "e"});
  return scene.svg.node();
})()
```

Perspective rays share the **origin** ${tex`\mathbf e`} and fan out, and
a smaller ${tex`d`} gives a wider field of view. Orthographic rays share
the **direction** ${tex`-\mathbf w`}, and start on the plane through
${tex`\mathbf e`} (not at infinity, so you can still view the inside of a
room). Both are **parallel** projections; an **oblique** view keeps the
same origins but uses a direction other than ${tex`-\mathbf w`}, as in
the third option. No perspective matrix is needed: rays from the eye
produce perspective directly.

## Ray–Object Intersection

### Spheres and the discriminant

Substituting the ray into ${tex`(\mathbf p - \mathbf c)\cdot(\mathbf p - \mathbf c) - R^2 = 0`}
gives a quadratic ${tex`At^2 + 2Bt + C = 0`} with
${tex`A = \mathbf d\cdot\mathbf d`},
${tex`B = \mathbf d\cdot(\mathbf e - \mathbf c)`}, and
${tex`C = (\mathbf e - \mathbf c)\cdot(\mathbf e - \mathbf c) - R^2`}.
Check the discriminant first, then take the smaller root in
${tex`[t_0, t_1]`}, else the larger one:

```js echo
function hitSphereT(ray, center, radius, t0, t1) {
  const ec = vec3.sub(ray.o, center);
  const A = vec3.dot(ray.d, ray.d);
  const B = vec3.dot(ray.d, ec);
  const C = vec3.dot(ec, ec) - radius * radius;
  const disc = B * B - A * C;
  if (disc < 0) return Infinity;              // miss: no more work
  const sq = Math.sqrt(disc);
  let t = (-B - sq) / A;                      // smaller root first
  if (t < t0 || t > t1) t = (-B + sq) / A;
  return t < t0 || t > t1 ? Infinity : t;
}
```

A debugging case with a known answer: a ray from (1, 1, 1) toward the center of the unit sphere
should first hit it at ${tex`t = 1 - \sqrt3/3 \approx 0.4226`}:

```js echo
const towardCenter = {o: [1, 1, 1], d: [-1, -1, -1]};
```

```js echo
hitSphereT(towardCenter, [0, 0, 0], 1, 0, Infinity)
```

If we only accept ${tex`t \ge 0.5`}, as for a ray that starts inside the sphere, the first root is
out of range. So we should get the larger root, ${tex`1 + \sqrt3/3 \approx 1.5774`}:

```js echo
hitSphereT(towardCenter, [0, 0, 0], 1, 0.5, Infinity)
```

Drag the ray's origin **e** and the point **e + d** to see the three
cases of the discriminant:

```js
const discWidget = dragPoints({"e": {x: -3.2, y: -1.4}, "e + d": {x: -1.6, y: -0.6}}, {width: 380, height: 380, domain: 4, colors: ["crimson", "orange"]});
const discPts = view(discWidget);
```

```js
{
discWidget.redecorate((scene) => {
  const c = {x: 0.6, y: 0.4}, R = 1.5, e = discPts["e"], dpt = discPts["e + d"];
  const d = {x: dpt.x - e.x, y: dpt.y - e.y};
  scene.svg.append("circle").attr("cx", scene.x(c.x)).attr("cy", scene.y(c.y)).attr("r", scene.x(R) - scene.x(0)).attr("fill", "steelblue").attr("fill-opacity", 0.2).attr("stroke", "steelblue");
  const ec = {x: e.x - c.x, y: e.y - c.y}, A = d.x * d.x + d.y * d.y, B = d.x * ec.x + d.y * ec.y, C = ec.x * ec.x + ec.y * ec.y - R * R;
  const disc = B * B - A * C, far = 20;
  scene.svg.append("line").attr("x1", scene.x(e.x)).attr("y1", scene.y(e.y)).attr("x2", scene.x(e.x + far * d.x)).attr("y2", scene.y(e.y + far * d.y)).attr("stroke", "orange").attr("stroke-width", 1.5);
  const label = disc < 0 ? "discriminant < 0: miss" : `discriminant = ${(disc).toFixed(2)}`;
  if (disc >= 0) {
    [(-B - Math.sqrt(disc)) / A, (-B + Math.sqrt(disc)) / A].forEach((t, k) => {
      const p = {x: e.x + t * d.x, y: e.y + t * d.y};
      drawPoint(scene, p, {color: t < 0 ? "#aaa" : k === 0 ? "crimson" : "purple", r: 5, label: `t = ${t.toFixed(2)}${t < 0 ? " (behind)" : ""}`});
    });
  }
  scene.svg.append("text").attr("x", 10).attr("y", 20).attr("font-size", 13).attr("font-family", "var(--sans-serif)").attr("fill", "currentColor").text(label);
});
}
```

Move **e** inside the circle: the smaller root becomes negative (behind
the eye), so the hit is the larger root. That is exactly the "try the
larger root" step.

### Triangles with Cramer's rule

Setting ${tex`\mathbf e + t\mathbf d = \mathbf a + \beta(\mathbf b - \mathbf a) + \gamma(\mathbf c - \mathbf a)`}
gives a ${tex`3\times3`} system in ${tex`\beta, \gamma, t`}. Cramer's
rule solves it with shared subterms, and the test **terminates early**:
compute ${tex`t`}, then ${tex`\gamma`}, then ${tex`\beta`}, rejecting as
soon as one is out of range.

The names below follow the reading: the matrix columns are ${tex`(a, b, c) = A - B`},
${tex`(d, e, f) = A - C`}, and ${tex`(g, h, i) = \mathbf d`}, and the right-hand side is
${tex`(j, k, l) = A - \mathbf e`}. The products that Cramer's rule needs repeatedly are computed
once, and notice how each test can stop the work early:

```js echo
function hitTriangle(ray, A, B, C, t0, t1) {
  const [a, b, c] = vec3.sub(A, B), [d, e, f] = vec3.sub(A, C);
  const [g, h, i] = ray.d, [j, k, l] = vec3.sub(A, ray.o);
  const eihf = e * i - h * f, gfdi = g * f - d * i, dheg = d * h - e * g;
  const akjb = a * k - j * b, jcal = j * c - a * l, blkc = b * l - k * c;
  const M = a * eihf + b * gfdi + c * dheg;
  if (Math.abs(M) < 1e-12) return null;       // parallel to the plane
  const t = -(f * akjb + e * jcal + d * blkc) / M;
  if (t < t0 || t > t1) return null;
  const gamma = (i * akjb + h * jcal + g * blkc) / M;
  if (gamma < 0 || gamma > 1) return null;
  const beta = (j * eihf + k * gfdi + l * dheg) / M;
  if (beta < 0 || beta > 1 - gamma) return null;
  return {t, beta, gamma};
}
```

The same ray from before aims at the center of the triangle (1, 0, 0), (0, 1, 0), (0, 0, 1). It
should hit at ${tex`t = \tfrac23`} with ${tex`\beta = \gamma = \tfrac13`}:

```js echo
hitTriangle(towardCenter, [1, 0, 0], [0, 1, 0], [0, 0, 1], 0, Infinity)
```

### Surfaces, hit records, and groups

Anything a ray can hit implements `hit(ray, t0, t1)` and returns a
**hit record** (or `null` for a miss). A **group** is also a surface: it
keeps the closest hit by **shrinking** ${tex`t_1`} after each one, so
only closer surfaces can win.

```js echo
class Sphere {
  constructor(center, radius, material) {
    Object.assign(this, {center, radius, material});
  }
  hit(ray, t0, t1) {
    const t = hitSphereT(ray, this.center, this.radius, t0, t1);
    if (t === Infinity) return null;
    const p = at(ray, t);
    const n = vec3.scale(vec3.sub(p, this.center), 1 / this.radius);
    return {t, p, n, surface: this};
  }
}
```

A triangle wraps `hitTriangle` the same way. Its normal comes from the cross product of two edges,
so it is the same at every point of the triangle:

```js echo
class Triangle {
  constructor(a, b, c, material) {
    Object.assign(this, {a, b, c, material});
    this.normal = vec3.normalize(vec3.cross(vec3.sub(b, a), vec3.sub(c, a)));
  }
  hit(ray, t0, t1) {
    const h = hitTriangle(ray, this.a, this.b, this.c, t0, t1);
    return h && {...h, p: at(ray, h.t), n: this.normal, surface: this};
  }
}
```

A group holds other surfaces and is itself a surface. After each hit, it shrinks `t1` so that later
surfaces only count if they are closer:

```js echo
class Group {
  constructor(surfaces) { this.surfaces = surfaces; }
  hit(ray, t0, t1) {
    let closest = null;
    for (const s of this.surfaces) {
      const rec = s.hit(ray, t0, t1);
      if (rec) { closest = rec; t1 = rec.t; }
    }
    return closest;
  }
}
```

Two spheres on a line test the order independence. The ray from the origin along ${tex`+z`} should
report the nearer sphere's surface, at ${tex`t = 4`}, even though it is listed second:

```js echo
new Group([new Sphere([0, 0, 9], 1), new Sphere([0, 0, 5], 1)])
  .hit({o: [0, 0, 0], d: [0, 0, 1]}, 0, Infinity).t
```

### Boxes with the slab method

Boxes play two roles: as **surfaces** (a room seen from inside, a bed,
a cube; one box replaces twelve triangles) and as **bounding volumes**
around a mesh (next section). The same test serves both. An axis-aligned box is two corners, ${tex`\text{min}`} and
${tex`\text{max}`}. The ray is between the two ${tex`x`} planes for one
interval of ${tex`t`}, between the ${tex`y`} planes for another, and
between the ${tex`z`} planes for a third. It hits the box where all three
overlap: from ${tex`t_{\text{near}}`}, the largest entry, to
${tex`t_{\text{far}}`}, the smallest exit. A ray that starts **inside**
the box has ${tex`t_{\text{near}} < 0`} and hits where it leaves, at
${tex`t_{\text{far}}`}. Drag **e** inside the box to see it:

```js
const slabWidget = dragPoints({"e": {x: -3.4, y: -1.6}, "e + d": {x: -2.2, y: -1.1}}, {width: 380, height: 380, domain: 4, colors: ["crimson", "orange"]});
const slabPts = view(slabWidget);
```

```js
{
slabWidget.redecorate((scene) => {
  const min = {x: -1, y: -1.2}, max = {x: 1.8, y: 1}, e = slabPts["e"], q = slabPts["e + d"];
  const d = {x: q.x - e.x, y: q.y - e.y}, far = 20;
  for (const x of [min.x, max.x]) scene.svg.append("line").attr("x1", scene.x(x)).attr("x2", scene.x(x)).attr("y1", scene.y(-4)).attr("y2", scene.y(4)).attr("stroke", "#999").attr("stroke-dasharray", "4 4");
  for (const y of [min.y, max.y]) scene.svg.append("line").attr("x1", scene.x(-4)).attr("x2", scene.x(4)).attr("y1", scene.y(y)).attr("y2", scene.y(y)).attr("stroke", "#999").attr("stroke-dasharray", "4 4");
  scene.svg.append("rect").attr("x", scene.x(min.x)).attr("y", scene.y(max.y)).attr("width", scene.x(max.x) - scene.x(min.x)).attr("height", scene.y(min.y) - scene.y(max.y))
    .attr("fill", "steelblue").attr("fill-opacity", 0.2).attr("stroke", "steelblue");
  scene.svg.append("line").attr("x1", scene.x(e.x)).attr("y1", scene.y(e.y)).attr("x2", scene.x(e.x + far * d.x)).attr("y2", scene.y(e.y + far * d.y)).attr("stroke", "orange").attr("stroke-width", 1.5);
  const slab = (lo, hi, o, dk) => { const a = (lo - o) / dk, b = (hi - o) / dk; return [Math.min(a, b), Math.max(a, b)]; };
  const [x0, x1] = slab(min.x, max.x, e.x, d.x), [y0, y1] = slab(min.y, max.y, e.y, d.y);
  const tNear = Math.max(x0, y0), tFar = Math.min(x1, y1), pt = (t) => ({x: e.x + t * d.x, y: e.y + t * d.y});
  let label = "miss: the intervals do not overlap, or the box is behind e";
  if (tNear <= tFar && tFar > 0) {
    if (tNear > 0) {
      label = "from outside: the hit is at t_near";
      drawPoint(scene, pt(tNear), {color: "crimson", r: 5, label: `t_near = ${tNear.toFixed(2)}`});
      drawPoint(scene, pt(tFar), {color: "#888", r: 4, label: `t_far = ${tFar.toFixed(2)}`});
    } else {
      label = "from inside: t_near < 0, so the hit is at t_far";
      drawPoint(scene, pt(tFar), {color: "crimson", r: 5, label: `t_far = ${tFar.toFixed(2)}`});
    }
  }
  scene.svg.append("text").attr("x", 10).attr("y", 20).attr("font-size", 13).attr("font-family", "var(--sans-serif)").attr("fill", "currentColor").text(label);
});
}
```

In code, the three intervals come from one loop. Multiplying by
${tex`1/d_k`} swaps the bounds for a negative direction automatically and
gives ${tex`\pm\infty`} for a ray parallel to a slab. If the origin lies
exactly on a slab plane, ${tex`0\cdot\infty`} is NaN, which
`Math.max` passes along, so the overlap test treats NaN as a miss:

```js echo
function boxInterval(ray, min, max) {
  let tNear = -Infinity, tFar = Infinity;
  for (let k = 0; k < 3; k++) {
    const inv = 1 / ray.d[k];
    const a = (min[k] - ray.o[k]) * inv, b = (max[k] - ray.o[k]) * inv;
    tNear = Math.max(tNear, Math.min(a, b));   // the last slab it enters
    tFar = Math.min(tFar, Math.max(a, b));     // the first slab it leaves
  }
  return tNear <= tFar ? [tNear, tFar] : null; // false for NaN too: a miss
}
```

A ray along ${tex`+x`} from ${tex`x = -3`} through a box spanning ${tex`\pm 1`} should enter at
${tex`t = 2`} and leave at ${tex`t = 4`}:

```js echo
boxInterval({o: [-3, 0, 0], d: [1, 0, 0]}, [-1, -1, -1], [1, 1, 1])
```

As a surface, the box also returns the **normal of the face that was
hit**. Measured in half-sizes from the box's center, the hit point is
${tex`\pm 1`} along the axis of that face and less along the other two,
so the face is the axis with the largest offset, and its sign says which
of the two faces it is. Then check ${tex`t_1`}: without it, a room wall
beyond a closer hit (or beyond the light, for a shadow ray) would still
count.

```js echo
function faceNormal(p, min, max) {
  const offset = [0, 1, 2].map(
    (k) => (p[k] - (min[k] + max[k]) / 2) / ((max[k] - min[k]) / 2)
  );
  const axis = d3.maxIndex(offset, Math.abs);
  return [0, 1, 2].map((k) => (k === axis ? Math.sign(offset[k]) : 0));
}
```

A hit picks ${tex`t_{\text{near}}`} when it is in front of the ray. Otherwise the ray started
inside, and the hit is where it leaves:

```js echo
function hitBox(ray, min, max, t0 = 1e-4, t1 = Infinity) {
  const iv = boxInterval(ray, min, max);
  if (!iv) return null;
  const t = iv[0] > t0 ? iv[0] : iv[1];
  if (t <= t0 || t > t1) return null;    // behind the ray, or beyond t1
  return {t, n: faceNormal(at(ray, t), min, max)};
}
```

Here are several debugging cases, including a ray from inside and a shadow ray stopped by
${tex`t_1`}:

```js
(() => {
  const show = (h) => (h ? `t = ${h.t.toFixed(3)}, n = (${h.n.join(", ")})` : "no hit");
  const inside = {o: [0.5, 0.5, 0.5], d: [1, 0, 0]}, hIn = hitBox(inside, [0, 0, 0], [1, 1, 1]);
  const flipped = vec3.dot(hIn.n, inside.d) > 0 ? vec3.scale(hIn.n, -1) : hIn.n;   // two-sided: face the ray
  return html`<pre>debug cases, unit box (0,0,0) → (1,1,1), d = (1, 0, 0):
  from outside, e = (−2, 0.5, 0.5):  ${show(hitBox({o: [-2, 0.5, 0.5], d: [1, 0, 0]}, [0, 0, 0], [1, 1, 1]))}   (expected t = 2, n = (−1, 0, 0))
  from inside,  e = (0.5, 0.5, 0.5): ${show(hitBox({o: [0.5, 0.5, 0.5], d: [1, 0, 0]}, [0, 0, 0], [1, 1, 1]))}   (expected t = 0.5, n = (1, 0, 0): outward)
  parallel, above, e = (−2, 2, 0.5): ${show(hitBox({o: [-2, 2, 0.5], d: [1, 0, 0]}, [0, 0, 0], [1, 1, 1]))}   (expected no hit)
  from inside, flipped toward the ray: n = (${flipped.join(", ")})   (expected (−1, 0, 0): the face seen from inside)</pre>`;
})()
```

The last line flips the outward normal to face the ray, because a ray
from inside sees the **back** of the face. *Two-sided surfaces*, in the
progressive tracer below, explains why that matters.

## Bounding Boxes

### A bounding box around a mesh

A mesh of ${tex`N`} triangles costs ${tex`N`} triangle tests per ray. A
**bounding box**, the minimum and maximum of the mesh's vertex
coordinates, computed once, lets most rays skip all of them: test the
box first, and if the ray misses it, it misses every triangle inside.
If it hits, test the triangles as usual. The image is the same either
way.

One case needs care: a ray that **starts inside** the box, such as a
shadow ray leaving the mesh's surface, must still test the triangles. So
the bounding test uses the **interval overlap**
(${tex`t_{\text{near}} \le t_{\text{far}}`},
${tex`t_{\text{far}} \ge t_0`}, ${tex`t_{\text{near}} \le t_1`}), not
`hitBox`'s single surface hit.

A mesh's box is the smallest and largest of its vertex coordinates, per axis:

```js echo
function meshBounds(triangles) {
  const pts = triangles.flatMap((tr) => [tr.a, tr.b, tr.c]);
  const along = (k) => pts.map((p) => p[k]);
  return {
    min: [0, 1, 2].map((k) => Math.min(...along(k))),
    max: [0, 1, 2].map((k) => Math.max(...along(k)))
  };
}
```

`BoundedMesh` is a surface, like `Sphere` and `Group`. It tests its one box first and only then visits
its triangles. The overlap test is also true for a ray that starts inside. The two counters are only
for the demo below:

```js echo
class BoundedMesh {
  constructor(triangles) {
    this.triangles = new Group(triangles);
    Object.assign(this, meshBounds(triangles));
    this.useBox = true;
    this.rays = 0; this.tests = 0;
  }
  hit(ray, t0, t1) {
    this.rays++;
    if (this.useBox) {
      const iv = boxInterval(ray, this.min, this.max);
      if (!iv || iv[1] < t0 || iv[0] > t1) return null;
    }
    this.tests += this.triangles.surfaces.length;
    return this.triangles.hit(ray, t0, t1);
  }
}
```

```js
// a sphere as 4·rings² − 4·rings flat triangles
function sphereMesh(c, R, rings, material) {
  const nu = 2 * rings, nv = rings;
  const P = (i, j) => {
    const th = (Math.PI * j) / nv, ph = (2 * Math.PI * i) / nu;
    return [c[0] + R * Math.sin(th) * Math.cos(ph), c[1] + R * Math.cos(th), c[2] + R * Math.sin(th) * Math.sin(ph)];
  };
  const tris = [];
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = P(i, j), b = P(i + 1, j), cc = P(i + 1, j + 1), d = P(i, j + 1);
    if (j > 0) tris.push(new Triangle(a, b, cc, material));
    if (j < nv - 1) tris.push(new Triangle(a, cc, d, material));
  }
  return tris;
}
```

The mesh below, a sphere made of flat triangles, sits on the floor and is rendered with the shading
code from the next section. Each ray that reaches the mesh, primary or shadow, is counted:

```js
const bboxForm = view(Inputs.form({
  useBox: Inputs.toggle({value: true, label: "test the bounding box first"}),
  rings: Inputs.range([4, 16], {value: 10, step: 1, label: "mesh rings"})
}));
```

```js
(() => {
  const mesh = new BoundedMesh(sphereMesh([0, 1, 0], 1, bboxForm.rings, material({kd: [0.25, 0.45, 0.8], ks: 0.4})));
  mesh.useBox = bboxForm.useBox;
  const scene = new Group([...rtScene.surfaces.slice(0, 2), mesh]);   // the checkered floor and the mesh
  const nx = 200, ny = 125, t = 0.4, r = (t * nx) / ny;
  const cam = {...cameraFrame([2.2, 2.4, 5.2], [0, 0.8, 0]), perspective: true, d: 1, l: -r, r, b: -t, t};
  const canvas = document.createElement("canvas");
  canvas.width = nx; canvas.height = ny;
  canvas.style.cssText = "width: 480px; max-width: 100%; border-radius: 8px; image-rendering: pixelated";
  const ctx = canvas.getContext("2d"), img = ctx.createImageData(nx, ny);
  const start = performance.now();
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = shadeRay(viewingRay(cam, i, j, nx, ny), 0, Infinity, 0, {shading: true, shadows: true, maxDepth: 0}, scene);
    const k = 4 * ((ny - 1 - j) * nx + i);
    for (let q = 0; q < 3; q++) img.data[k + q] = 255 * Math.min(1, c[q]) ** (1 / 2.2);
    img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const N = mesh.triangles.surfaces.length, skipped = mesh.rays - mesh.tests / N;
  return html`<div>${canvas}<pre>${N} triangles · ${mesh.rays.toLocaleString()} rays reached the mesh · ${(performance.now() - start).toFixed(0)} ms
triangle tests: ${mesh.tests.toLocaleString()} (${(mesh.tests / mesh.rays).toFixed(1)} per ray)
rays the box let skip the mesh: ${skipped.toLocaleString()}</pre></div>`;
})()
```

Turn the box off: the image doesn't change, but every ray tests all
${tex`N`} triangles. With the box on, the rays that miss it cost
nothing, and the rays that hit it cost **one box test more** than before.
Raise the ring count to see the gap grow.

### From one box to many

With one box, a ray that hits it still tests all ${tex`N`} triangles. A
box around **each part** of the mesh, and a box around those boxes,
gives a tree: a **bounding volume hierarchy** (BVH). A ray that misses a
box skips everything below it, so with a well-built BVH a ray typically
visits close to ${tex`O(\log N)`} boxes (more when boxes overlap) and
tests only the triangles in the few leaves it reaches. A BVH node is
just another surface whose `hit` tests its box and then its children,
so it plugs into the same `hit(ray, t0, t1)` interface.

## Shading, Shadows, and Reflection

### Lights, materials, and shading a ray

**Lights** compute illumination; **materials** say how the surface
reflects it. Each **point** light contributes
${tex`k\,\max(0, \mathbf n\cdot\mathbf l)\,I/r^2`}, with ${tex`k`} the
Blinn–Phong reflectance from Module 05. A **directional** light (the sun)
has one direction ${tex`\mathbf l`} everywhere and no ${tex`1/r^2`}
falloff, and the **ambient** light adds ${tex`k_a I_a`}. A **shadow ray**
toward each light, over ${tex`[\epsilon, r]`} for a point light or
${tex`[\epsilon, \infty)`} for a directional one, decides whether that
light counts; ambient light needs none. Here ${tex`\epsilon = 10^{-3}`}
is the only guard against a ray hitting the surface it starts on, which
suits a scene a few units across. Mirror
reflection **recurses** along
${tex`\mathbf r = \mathbf d - 2(\mathbf d\cdot\mathbf n)\mathbf n`},
weighted by the color ${tex`k_m`}, up to a maximum depth.

A checker pattern gives the floor some detail. Adding the floored coordinates and testing the lowest
bit alternates between two colors:

```js echo
const checker = (p) => (Math.floor(p[0]) + Math.floor(p[2])) & 1
  ? [0.75, 0.75, 0.72] : [0.25, 0.25, 0.3];
```

A material bundles the coefficients with `evaluate`, the Blinn–Phong reflectance ${tex`k`} for given
light, view, and normal directions:

```js echo
function material({
  kd = [0.7, 0.7, 0.7], ks = 0.3, shininess = 60,
  km = [0, 0, 0], texture = null
} = {}) {
  const evaluate = (l, v, n, p) => {
    const h = vec3.normalize(vec3.add(l, v));
    const spec = ks * Math.max(0, vec3.dot(n, h)) ** shininess;
    return (texture ? texture(p) : kd).map((c) => c + spec);
  };
  return {kd, ks, shininess, km, texture, evaluate};
}
```

With the light, viewer, and normal all aligned, the highlight is at full strength, so the reflectance
should be ${tex`k_d + k_s`}. A default material should give 0.7 + 0.3 = 1 in each channel:

```js echo
material().evaluate([0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 0])
```

The scene below uses these materials on a few spheres and a floor. It has one point light and one
directional light, and a few constants:

```js
const rtScene = (() => {
  const floorMat = material({texture: checker, ks: 0.1, km: [0.08, 0.08, 0.08]});
  const F = 6;
  return new Group([
    new Triangle([-F, 0, -F], [-F, 0, F], [F, 0, F], floorMat),
    new Triangle([-F, 0, -F], [F, 0, F], [F, 0, -F], floorMat),
    new Sphere([-1.3, 0.7, 0], 0.7, material({kd: [0.8, 0.2, 0.2]})),
    new Sphere([0.3, 0.9, -1.2], 0.9, material({kd: [0.05, 0.05, 0.05], ks: 0.6, km: [0.8, 0.8, 0.8]})),   // mirror
    new Sphere([1.5, 0.5, 0.4], 0.5, material({kd: [0.4, 0.3, 0.05], ks: 0.8, shininess: 120, km: [0.7, 0.55, 0.15]})),   // gold
    new Triangle([-2.6, 0, -1.6], [-1.4, 0, -2.4], [-2.2, 1.8, -2.2], material({kd: [0.2, 0.6, 0.3]}))
  ]);
})();
```

```js echo
const rtLights = [
  {p: [3, 5, 3], I: 28},                         // a point light
  {dir: vec3.normalize([-2, 1.5, 1]), I: 0.35}   // a directional light
];
const ambient = 0.12, background = [0.6, 0.7, 0.9], EPS = 1e-3;

```

One light's contribution follows the first formula above. The direction and distance depend on the
kind of light. The shadow ray runs from the hit point toward the light and stops at the light. `EPS`
keeps it from hitting its own starting surface:

```js echo
function directLight(rec, m, v, light, opts, scene) {
  const toL = light.dir ?? vec3.sub(light.p, rec.p);
  const r = light.dir ? Infinity : vec3.length(toL);
  const l = light.dir ?? vec3.scale(toL, 1 / r);
  if (opts.shadows && scene.hit({o: rec.p, d: l}, EPS, r)) return [0, 0, 0];
  const I = light.dir ? light.I : light.I / (r * r);
  const E = Math.max(0, vec3.dot(rec.n, l)) * I;
  return m.evaluate(l, v, rec.n, rec.p).map((k) => k * E);
}
```

The mirror direction is the reflection formula:

```js echo
const mirrorDirection = (d, n) =>
  vec3.sub(d, vec3.scale(n, 2 * vec3.dot(d, n)));
```

A ray going down and to the right off a floor should go up and to the right:

```js echo
mirrorDirection([1, -1, 0], [0, 1, 0])
```

`shadeRay` is the whole renderer. It finds the closest hit and adds ambient light plus each light's
contribution. With lighting turned off, it shows the flat surface color. If the material is reflective
and depth remains, it calls itself along the mirror direction:

```js echo
function shadeRay(ray, t0, t1, depth, opts, scene = rtScene) {
  const rec = scene.hit(ray, t0, t1);
  if (!rec) return background;
  const m = rec.surface.material, kd = m.texture ? m.texture(rec.p) : m.kd;
  const v = vec3.normalize(vec3.scale(ray.d, -1));
  const lights = !opts.shading ? [] : rtLights.map((light) =>
    directLight(rec, m, v, light, opts, scene));
  let c = opts.shading
    ? kd.map((k, q) => k * ambient + d3.sum(lights, (e) => e[q])) : kd;
  if (depth < opts.maxDepth && m.km.some((k) => k > 0)) {
    const mirrored = {o: rec.p, d: mirrorDirection(ray.d, rec.n)};
    const reflected =
      shadeRay(mirrored, EPS, Infinity, depth + 1, opts, scene);
    c = c.map((ci, q) => ci + m.km[q] * reflected[q]);
  }
  return c;
}
```

```js
const rtForm = view(Inputs.form({
  projection: Inputs.radio(["perspective", "orthographic"], {value: "perspective", label: "projection"}),
  shading: Inputs.toggle({value: true, label: "light the scene (off = flat colors)"}),
  shadows: Inputs.toggle({value: true, label: "shadow rays"}),
  maxDepth: Inputs.range([0, 6], {value: 3, step: 1, label: "max reflection depth"}),
  azimuth: Inputs.range([-180, 180], {value: 20, step: 1, label: "camera azimuth"})
}));
```

```js
(() => {
  const nx = 320, ny = 200, a = (rtForm.azimuth * Math.PI) / 180;
  const frame = cameraFrame([6 * Math.sin(a), 2.6, 6 * Math.cos(a)], [0, 0.6, -0.3]);
  const perspective = rtForm.projection === "perspective";
  const t = perspective ? 0.4 : 2.2, r = t * nx / ny;          // window: d = 1 with a 44° vertical field of view, or 4.4 units tall
  const cam = {...frame, perspective, d: 1, l: -r, r, b: -t, t};
  const canvas = document.createElement("canvas");
  canvas.width = nx; canvas.height = ny;
  canvas.style.cssText = "width: 640px; max-width: 100%; border-radius: 8px; image-rendering: pixelated";
  const ctx = canvas.getContext("2d"), img = ctx.createImageData(nx, ny);
  const start = performance.now();
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = shadeRay(viewingRay(cam, i, j, nx, ny), 0, Infinity, 0, rtForm);
    const k = 4 * ((ny - 1 - j) * nx + i);                       // canvas rows go down; j goes up
    for (let q = 0; q < 3; q++) img.data[k + q] = 255 * Math.min(1, c[q]) ** (1 / 2.2);
    img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const f = (v) => `(${v.map((x) => x.toFixed(2)).join(", ")})`;
  return html`<div>${canvas}<pre>u = ${f(cam.u)}   v = ${f(cam.v)}   w = ${f(cam.w)}
${nx}×${ny} rays in ${(performance.now() - start).toFixed(0)} ms on the CPU</pre></div>`;
})()
```

Things to try:

- Turn off **shadow rays**: the spheres seem to float above the floor.
- Set the **max reflection depth** to 0, then 1, then 2. The mirror sphere
  first reflects nothing, then the scene, then the scene's reflections.
  The gold sphere tints its reflection because ${tex`k_m`} is a color.
- Switch to **orthographic**: parallel lines stay parallel and spheres
  keep their size with distance. Only ray generation changed.
- Swing the **camera azimuth** to about 180° to see the back of the green
  triangle: it gets only ambient light, because this tracer (like the
  book's) shades with the normal as stored, which points away from the
  camera there. The progressive tracer below fixes this by flipping the
  normal toward the ray (*two-sided surfaces*).

## A Progressive CPU Tracer: A Sphere and a Cube on a Checkered Floor

The first tracer computes its whole image in one go, which blocks the
page while it runs. This section builds a second, smaller tracer the way
a larger program is organized: pixels counted from the **top-left**,
**two-sided** surfaces with an offset start for new rays, materials
chosen **from the hit point**, a simpler shading model, and an image that
fills in **a few rows per frame** and is shown through WebGPU. The scene
is a mirror sphere and a cube (a box from *Boxes with the slab method*)
on a checkered floor.

### Pixel centers counted from the top-left

Images and textures count rows **down** from the top-left, so this
tracer does too. Pixel ${tex`(i, j)`}, with row ${tex`j`} counted down
from the top, is the image point
${tex`(s_x, s_y) = (i + 0.5,\ j + 0.5)`}, its center, in pixels. (The
names ${tex`s_x, s_y`} keep it apart from the hit point
${tex`\mathbf x`}.) With the image plane at distance 1, the window is
${tex`t = \tan(\text{fovy}/2)`} and ${tex`r = (n_x/n_y)\,t`}, which
keeps spheres round in a wide image, and

${tex.block`u = \Big(\frac{2s_x}{n_x} - 1\Big)\,r, \qquad v = \Big(1 - \frac{2s_y}{n_y}\Big)\,t, \qquad \mathbf d = \operatorname{normalize}(u\,\mathbf u + v\,\mathbf v - \mathbf w)`}

This is the earlier window with ${tex`l = -r`} and ${tex`b = -t`}.
Because ${tex`s_y`} grows down while ${tex`\mathbf v`} points up,
${tex`v`} uses ${tex`1 - 2s_y/n_y`}. Row 0 of the image is then its top,
and nothing needs flipping later.

```js echo
function topLeftCamera(eye, target, fovDeg, width, height) {
  const t = Math.tan((fovDeg * Math.PI) / 360);
  const r = (t * width) / height;
  return {...cameraFrame(eye, target), t, r, width, height};
}
```

`pixelRay` follows the formula. The arguments `sx` and `sy` are in pixels from the top-left:

```js echo
function pixelRay(cam, sx, sy) {
  const u = ((2 * sx) / cam.width - 1) * cam.r;
  const v = (1 - (2 * sy) / cam.height) * cam.t;
  const sideways = vec3.add(vec3.scale(cam.u, u), vec3.scale(cam.v, v));
  return {o: cam.e, d: vec3.normalize(vec3.sub(sideways, cam.w))};
}
```

The center of the image should look straight along ${tex`-\mathbf w`}, and a point on the top row
should look upward:

```js echo
{
  const cam = topLeftCamera([0, 0, 5], [0, 0, 0], 90, 200, 100);
  display([pixelRay(cam, 100, 50), pixelRay(cam, 100, 0)]
    .map(({d}) => d.map((c) => c.toFixed(3)).join(", ")));
}
```

### Two-sided surfaces, materials from the hit point, and shading

The box's normal points **out** of the box, and a triangle's normal
depends on its vertex order, but a ray can meet either side. So after the
closest hit, flip the normal to **face the ray**
(${tex`\mathbf n \cdot \mathbf d > 0 \Rightarrow \mathbf n \leftarrow -\mathbf n`}),
and use that flipped normal for shading **and** for the offset that
starts shadow and reflected rays just off the surface. This tracer uses
**both** guards against self-hits: new rays start at
${tex`\mathbf x + \delta\,\mathbf n`} (${tex`\delta = 10^{-3}`}),
and every intersection test still requires ${tex`t > \varepsilon`}
(${tex`\varepsilon = 10^{-4}`}, smaller than the first tracer's because
of the offset).

A material here is either a fixed set of values or a **function of the
hit point and the flipped normal**. The floor is a slab whose top face
is a checkerboard and whose sides are plain. JavaScript's `%` keeps the
sign (`-3 % 2` is `-1`), so the parity test compares with `0`.

The shading is simpler than the first tracer's: no ${tex`1/r^2`}
falloff, an **ambient fraction** ${tex`\alpha`} (not the first
tracer's ${tex`k_a`} coefficient), and reflection as a **blend** with a
scalar reflectivity ${tex`\rho`}:

${tex.block`c = k_d\big(\alpha + (1 - \alpha)\max(0, \mathbf n\cdot\mathbf l)\big) + k_s \max(0, \mathbf n\cdot\mathbf h)^p, \qquad c \leftarrow (1-\rho)\,c + \rho\,c_{\text{reflected}}`}

The diffuse part tops out at exactly ${tex`k_d`}; a point in shadow or
facing away from the light keeps only ${tex`\alpha\,k_d`}.

```js
// checker square size
const SQUARE = 1;
```

```js
const checkerFloor = (p, n) => ({
  color: n[1] > 0.5 && (Math.floor(p[0] / SQUARE) + Math.floor(p[2] / SQUARE)) % 2 === 0 ? [0.9, 0.88, 0.8] : [0.18, 0.22, 0.3],
  ks: 0.05, p: 8, refl: 0
});
const boxScene = {
  light: [3, 5, 4],
  spheres: [{center: [-0.9, 0.8, 0.2], radius: 0.8, material: {color: [0.9, 0.9, 0.95], ks: 1, p: 200, refl: 0.7}}],
  boxes: [
    {min: [-6, -0.2, -6], max: [6, 0, 6], material: checkerFloor},                                     // the floor: a thin slab
    {min: [0.3, 0, -1.2], max: [1.5, 1.2, 0], material: {color: [0.85, 0.35, 0.2], ks: 0.4, p: 32, refl: 0.25}}   // the cube, a little glossy
  ]
};
```

The constants below control the shading. `ALPHA` is the ambient fraction, `OFFSET` is ${tex`\delta`},
and `EPS2` is ${tex`\varepsilon`}. A ray that misses everything sees a sky color that deepens with
height:

```js echo
const ALPHA = 0.15, OFFSET = 1e-3, EPS2 = 1e-4;
const sky = (d) =>
  vec3.lerp([0.85, 0.9, 1], [0.35, 0.55, 0.9], Math.max(0, d[1]));
```

`boxScene` holds a sphere and two boxes, the floor and the cube. The closest hit over them is the same
shrinking-`t1` idea as `Group`:

```js echo
function boxSceneHit(ray, t1 = Infinity) {
  let best = null;
  for (const s of boxScene.spheres) {
    const t = hitSphereT(ray, s.center, s.radius, EPS2, t1);
    if (t === Infinity) continue;
    const n = vec3.scale(vec3.sub(at(ray, t), s.center), 1 / s.radius);
    best = {t, n, material: s.material};
    t1 = t;
  }
  for (const b of boxScene.boxes) {
    const h = hitBox(ray, b.min, b.max, EPS2, t1);
    if (h) { best = {...h, material: b.material}; t1 = h.t; }
  }
  return best;
}
```

The two-sided flip is a single test:

```js echo
const faceRay = (n, d) => (vec3.dot(n, d) > 0 ? vec3.scale(n, -1) : n);
```

A normal pointing along the ray should flip, and one facing it should stay:

```js echo
[faceRay([0, 0, 1], [0, 0, 1]), faceRay([0, 0, 1], [0, 0, -1])]
  .map((n) => n.join(", "))
```

The light's contribution is ${tex`\max(0, \mathbf n\cdot\mathbf l)`}, zeroed by a shadow ray. The shadow
ray starts from the offset point and stops at the light:

```js echo
function diffuseAt(p, n, start, opts) {
  const toLight = vec3.sub(boxScene.light, p), dist = vec3.length(toLight);
  const l = vec3.scale(toLight, 1 / dist);
  let diffuse = Math.max(0, vec3.dot(n, l));
  if (diffuse > 0 && opts.shadows) {
    opts.rays++;
    if (boxSceneHit({o: start, d: l}, dist)) diffuse = 0;
  }
  return {diffuse, l};
}
```

`traceBox` follows the same steps as `shadeRay`, using this tracer's shading formula. At the maximum
depth, the shaded color is used as is:

```js echo
function traceBox(ray, depth, opts) {
  opts.rays++;
  const hit = boxSceneHit(ray);
  if (!hit) return sky(ray.d);
  const p = at(ray, hit.t), n = faceRay(hit.n, ray.d);
  const m = typeof hit.material === "function"
    ? hit.material(p, n) : hit.material;
  const start = vec3.add(p, vec3.scale(n, OFFSET));   // off the surface
  const {diffuse, l} = diffuseAt(p, n, start, opts);
  const halfway = vec3.normalize(vec3.sub(l, ray.d));
  const nh = Math.max(0, vec3.dot(n, halfway));
  const spec = diffuse > 0 ? m.ks * nh ** m.p : 0;
  const c = m.color.map((k) => k * (ALPHA + (1 - ALPHA) * diffuse) + spec);
  if (m.refl === 0 || depth >= opts.maxDepth) return c;
  const mirrored = {o: start, d: mirrorDirection(ray.d, n)};
  const reflected = traceBox(mirrored, depth + 1, opts);
  return c.map((ci, q) => (1 - m.refl) * ci + m.refl * reflected[q]);
}
```

### Showing a CPU image through WebGPU

The traced colors go into a `Uint8Array` of RGBA bytes, which
`device.queue.writeTexture` copies into an `rgba8unorm` texture. One
**full-screen triangle**, built in the vertex shader from `vertex_index`
with no vertex buffer, covers the canvas and samples the texture through
`uv = (x, 1 - y)`. **Nearest** filtering shows a low resolution as clear
blocks. Sampling with `uv` works for any image size, unlike `textureLoad`
at the fragment's pixel position, which only works when the image is
exactly canvas-sized. `writeTexture` takes the typed array directly, with
no 256-byte row alignment (unlike `copyBufferToTexture`). Clamp each
channel before scaling by 255 (a `Uint8Array` wraps 256 to 0), and set
alpha to 255.

```js
const {device, format: canvasFormat} = await initializeWebGPU(document.createElement("canvas"));   // a blank canvas: each demo adds its own below
const deviceErrorLog = document.createElement("pre");
deviceErrorLog.style.cssText = "display: none; color: #e5484d; background: #2a1214; border: 1px solid #e5484d; border-radius: 6px; padding: 8px 12px; font-size: 12px; white-space: pre-wrap;";
device.addEventListener("uncapturederror", (e) => { deviceErrorLog.textContent += `WebGPU error: ${e.error.message}\n`; deviceErrorLog.style.display = "block"; });
```

```js
deviceErrorLog
```

```js
const boxDisplayModule = device.createShaderModule({code: `
struct Out { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@group(0) @binding(0) var smp: sampler;
@group(0) @binding(1) var img: texture_2d<f32>;

@vertex fn vs(@builtin(vertex_index) i: u32) -> Out {
  let c = vec2f(f32((i << 1u) & 2u), f32(i & 2u));               // (0,0), (2,0), (0,2)
  return Out(vec4f(c * 2.0 - 1.0, 0.0, 1.0), vec2f(c.x, 1.0 - c.y));   // texture rows go down
}
@fragment fn fs(o: Out) -> @location(0) vec4f {
  return textureSample(img, smp, o.uv);
}`});
// This page's render pass has no depth attachment. If yours does, add
// depthStencil: {format: "depth24plus", depthWriteEnabled: false, depthCompare: "always"}.
const boxPipeline = device.createRenderPipeline({layout: "auto",
  vertex: {module: boxDisplayModule, entryPoint: "vs"},
  fragment: {module: boxDisplayModule, entryPoint: "fs", targets: [{format: canvasFormat}]}});
const nearestSampler = device.createSampler({magFilter: "nearest", minFilter: "nearest"});

const boxCanvas = document.createElement("canvas");
boxCanvas.width = 640; boxCanvas.height = 400;
boxCanvas.style.cssText = "width: 640px; max-width: 100%; border-radius: 8px";
const {context: boxContext} = await initializeWebGPU(boxCanvas, {device});
const boxProgress = html`<pre style="margin: 4px 0">starting…</pre>`;
const boxRun = {generation: 0, texture: null};
```

### A few rows per frame

Each animation frame traces **whole rows** until about 12 ms have
passed, copies **only the new rows** into the texture, and draws it, so the page
stays responsive and the image fills in from the top. Any change to the
controls starts a **new render**: a new image and texture, row 0, and
counters at zero. The old render notices that it is no longer current
and stops.

Tracing one row fills four bytes per pixel. One ray goes through each pixel's center. Row 0 is the top
of the image, so nothing needs flipping. Each channel is clamped before scaling, because a `Uint8Array`
wraps 256 around to 0:

```js echo
function traceRow(y, pixels, cam, width, opts) {
  for (let x = 0; x < width; x++) {
    const c = traceBox(pixelRay(cam, x + 0.5, y + 0.5), 0, opts);
    const bytes =
      c.map((v) => Math.round(255 * Math.min(1, Math.max(0, v))));
    pixels.set([...bytes, 255], 4 * (y * width + x));
  }
}
```

The time budget decides how many rows a frame can afford:

```js echo
function traceRowsForFrame(job, height, traceOneRow) {
  const frameStart = performance.now();
  while (job.row < height && performance.now() - frameStart < 12) {
    traceOneRow(job.row++);
  }
}
```

`writeTexture` then copies just those rows. `offset` says where they start in the byte array, and
`origin` says where they go in the texture:

```js echo
function uploadRows(texture, pixels, width, firstRow, lastRow) {
  device.queue.writeTexture(
    {texture, origin: [0, firstRow]}, pixels,
    {offset: firstRow * width * 4, bytesPerRow: width * 4},
    [width, lastRow - firstRow]
  );
}
```

```js
const boxForm = view(Inputs.form({
  scale: Inputs.range([0.1, 1], {value: 0.5, step: 0.05, label: "resolution scale"}),
  azimuth: Inputs.range([-180, 180], {value: 30, step: 1, label: "camera azimuth"}),
  maxDepth: Inputs.range([0, 4], {value: 2, step: 1, label: "max reflection depth"}),
  shadows: Inputs.toggle({value: true, label: "shadow rays"})
}));
```

```js
{
  const generation = ++boxRun.generation;                         // any older render stops at its next frame
  const width = Math.max(1, Math.round(boxCanvas.width * boxForm.scale));
  const height = Math.max(1, Math.round(boxCanvas.height * boxForm.scale));
  const pixels = new Uint8Array(width * height * 4);
  boxRun.texture?.destroy();
  const texture = (boxRun.texture = device.createTexture({size: [width, height], format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST}));
  const bindGroup = device.createBindGroup({layout: boxPipeline.getBindGroupLayout(0), entries: [
    {binding: 0, resource: nearestSampler}, {binding: 1, resource: texture.createView()}]});
  const a = (boxForm.azimuth * Math.PI) / 180;
  const cam = topLeftCamera([5.5 * Math.sin(a), 2.2, 5.5 * Math.cos(a)], [0.2, 0.6, -0.4], 45, width, height);
  const opts = {maxDepth: boxForm.maxDepth, shadows: boxForm.shadows, rays: 0};
  const job = {row: 0}, started = performance.now();

  const draw = () => {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({colorAttachments: [{view: boxContext.getCurrentTexture().createView(),
      clearValue: {r: 0, g: 0, b: 0, a: 1}, loadOp: "clear", storeOp: "store"}]});
    pass.setPipeline(boxPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);                                                 // three vertices, no vertex buffer
    pass.end();
    device.queue.submit([encoder.finish()]);
  };

  const frame = () => {
    if (generation !== boxRun.generation || !boxCanvas.isConnected) return;   // replaced by a newer render
    const firstRow = job.row;
    traceRowsForFrame(job, height, (y) => traceRow(y, pixels, cam, width, opts));
    if (job.row > firstRow) {
      uploadRows(texture, pixels, width, firstRow, job.row);
      draw();
    }
    boxProgress.textContent = `${width}×${height}: row ${job.row} of ${height} · ${opts.rays.toLocaleString()} rays · ${((performance.now() - started) / 1000).toFixed(2)} s`;
    if (job.row < height) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
```

```js
html`<div>${boxCanvas}${boxProgress}</div>`
```

**Inside a render loop that clears every frame.** This page draws only on
frames that traced new rows, because nothing else touches its canvas. A
loop such as the course's `animate` clears the canvas at the start of
every frame, so there the order is: trace rows and `writeTexture` only
while rows remain, but `setPipeline`, `setBindGroup`, and `draw(3)` on
**every** frame, even after the image is finished, or it vanishes. Start
a new render when a setting changes **or** when `canvas.width` or
`canvas.height` differs from the last render's, since `animate` resizes
the canvas with the window. Its render pass also has a depth attachment,
so the display pipeline needs the `depthStencil` line noted in the code
above.

Things to try:

- Set the **resolution scale** to 1 and watch the rows fill in while the
  page stays responsive. At 0.1 the nearest filter shows each pixel as a
  block.
- Swing the **camera azimuth** around: the cube's faces are lit and
  shadowed correctly from every side because the box returns the normal
  of the face that was hit. (Every surface here is seen from outside, so
  the two-sided flip never changes anything in this scene; the last debug
  case above shows where it matters, a box seen from inside.)
- Set the **max reflection depth** to 0 and then 1: at 0 the sphere and
  the cube show only their own shading; at 1 the sphere reflects the cube
  and the floor. Swing the azimuth to about −150° to see the glossy cube
  faintly reflect the sphere. Going from 1 to 2 changes subtler
  details, paths that bounce twice: the cube's reflection *inside the
  sphere* picks up the cube's own gloss, and at −150° the sphere seen in
  the cube becomes a mirror itself.
- Turn off **shadow rays**: the cube and sphere float above the floor.

This tracer writes its colors to bytes as they are, without the
${tex`1/2.2`} gamma step the first tracer (and the GPU tracer) use. Either choice is fine;
just encode **once** (an assignment that asks you to clamp and convert
to bytes means no gamma step).

## Ray Tracing in WebGPU

### Architecture

Each pixel is independent, so a **compute shader** runs one invocation
per pixel and writes a **storage texture**. The spheres and lights live
in **storage buffers**, the camera in a **uniform buffer**, and a small
render pass shows the texture with the same full-screen triangle as the
progressive tracer (plus the gamma step), so the texture needs both
`STORAGE_BINDING` and `TEXTURE_BINDING` usage. This tracer follows the
book and the first CPU tracer: bottom-up ${tex`j`}, irradiance
${tex`I/r^2`}, and an additive **RGB** mirror color ${tex`k_m`}. WGSL
does **not allow recursion**, so the recursive `shadeRay` becomes a
**loop** that carries the product of the ${tex`k_m`} colors.

The data comes first. In a storage buffer, each `vec3` is aligned to 16 bytes, so the structs below pack
pairs of `vec3` and `f32` into 16-byte rows:

```js echo
const wgslRTStructs = `
struct Camera {
  e: vec3<f32>, dist: f32,
  u: vec3<f32>, l: f32,
  v: vec3<f32>, r: f32,
  w: vec3<f32>, b: f32,
  t: f32, selected: f32, shadows: f32, maxDepth: f32,
};
struct Sphere {
  center: vec3<f32>, radius: f32, color: vec3<f32>, km: vec3<f32>
};
struct Light { pos: vec3<f32>, intensity: vec3<f32> };
struct Ray { o: vec3<f32>, d: vec3<f32> };
struct Hit { t: f32, n: vec3<f32>, idx: i32 };
@group(0) @binding(0) var<uniform> cam: Camera;
@group(0) @binding(1) var<storage, read> spheres: array<Sphere>;
@group(0) @binding(2) var<storage, read> lights: array<Light>;
@group(0) @binding(3) var outTex: texture_storage_2d<rgba8unorm, write>;
const ambient = vec3<f32>(0.1);
const eps = 1e-3;
const background = vec3<f32>(0.6, 0.7, 0.9);`;
```

Ray generation is the same formula as the JavaScript `viewingRay`, for a perspective camera:

```js echo
const wgslViewingRay = `
fn viewingRay(i: u32, j: u32, nx: u32, ny: u32) -> Ray {
  let us = cam.l + (cam.r - cam.l) * (f32(i) + 0.5) / f32(nx);
  let vs = cam.b + (cam.t - cam.b) * (f32(j) + 0.5) / f32(ny);
  return Ray(cam.e, normalize(-cam.dist * cam.w + us * cam.u + vs * cam.v));
}`;
```

So is the sphere test. WGSL has no `Infinity` to return easily, so a miss is reported as −1:

```js echo
const wgslHitSphere = `
fn hitSphere(s: Sphere, r: Ray, t0: f32, t1: f32) -> f32 {
  let ec = r.o - s.center;
  let A = dot(r.d, r.d);
  let B = dot(r.d, ec);
  let disc = B * B - A * (dot(ec, ec) - s.radius * s.radius);
  if (disc < 0.0) { return -1.0; }
  var t = (-B - sqrt(disc)) / A;
  if (t < t0 || t > t1) { t = (-B + sqrt(disc)) / A; }
  return select(t, -1.0, t < t0 || t > t1);
}`;
```

The closest hit loops over the storage buffer, shrinking the interval as a group does. `arrayLength`
reads the array's size from its buffer:

```js echo
const wgslSceneHit = `
fn sceneHit(r: Ray, t0: f32, t1in: f32) -> Hit {
  var h = Hit(-1.0, vec3<f32>(0.0), -1);
  var t1 = t1in;
  for (var k = 0u; k < arrayLength(&spheres); k++) {
    let t = hitSphere(spheres[k], r, t0, t1);
    if (t >= 0.0) {
      t1 = t;
      let n = (r.o + t * r.d - spheres[k].center) / spheres[k].radius;
      h = Hit(t, n, i32(k));
    }
  }
  return h;
}`;
```

Shading sums the lights, with a shadow ray for each light the surface faces. The `selected` test highlights
a sphere picked with the mouse:

```js echo
const wgslShade = `
fn shade(r: Ray, h: Hit) -> vec3<f32> {
  let s = spheres[h.idx];
  let x = r.o + h.t * r.d;
  var c = s.color * ambient;
  for (var k = 0u; k < arrayLength(&lights); k++) {
    let toL = lights[k].pos - x;
    let dist = length(toL);
    let l = toL / dist;
    let ndl = dot(h.n, l);
    if (ndl <= 0.0) { continue; }
    let blocker = sceneHit(Ray(x, l), eps, dist);
    if (cam.shadows > 0.5 && blocker.idx >= 0) { continue; }
    c += s.color * lights[k].intensity * ndl / (dist * dist);
  }
  if (h.idx == i32(cam.selected)) {
    c = 0.5 * c + vec3<f32>(0.5, 0.4, 0.05);
  }
  return c;
}`;
```

Now the recursion becomes a loop. Instead of calling itself, `trace` keeps `weight`, the product of the
${tex`k_m`} colors so far, and replaces the ray with its reflection. A nonreflective surface or a miss ends the
path:

```js echo
const wgslTrace = `
fn trace(primary: Ray) -> vec3<f32> {
  var ray = primary;
  var color = vec3<f32>(0.0);
  var weight = vec3<f32>(1.0);
  for (var depth = 0; depth <= i32(cam.maxDepth); depth++) {
    let h = sceneHit(ray, eps, 1e30);
    if (h.idx < 0) { color += weight * background; break; }
    color += weight * shade(ray, h);
    let km = spheres[h.idx].km;
    if (all(km == vec3<f32>(0.0))) { break; }
    weight *= km;
    ray = Ray(ray.o + h.t * ray.d, ray.d - 2.0 * dot(ray.d, h.n) * h.n);
  }
  return color;
}`;
```

Each invocation handles one pixel. Texture rows go down and ${tex`j`} goes up, hence the flip. The bounds check skips
the extra invocations of the last, partly filled workgroups:

```js echo
const wgslTraceMain = `
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let dims = textureDimensions(outTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }
  let ray = viewingRay(id.x, dims.y - 1u - id.y, dims.x, dims.y);
  textureStore(outTex, id.xy, vec4<f32>(trace(ray), 1.0));
}`;
```

```js
const gpuRTModule = device.createShaderModule({code: `${wgslRTStructs}${wgslViewingRay}${wgslHitSphere}${wgslSceneHit}${wgslShade}${wgslTrace}${wgslTraceMain}
// Display: the full-screen triangle, sampling the texture with uv, encoded for the screen.
// (Its bindings reuse group 0; that's fine because each entry point has its own layout.)
struct VOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };
@group(0) @binding(0) var smp: sampler;
@group(0) @binding(1) var image: texture_2d<f32>;
@vertex
fn vs_main(@builtin(vertex_index) i: u32) -> VOut {
  let c = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
  return VOut(vec4<f32>(c * 2.0 - 1.0, 0.0, 1.0), vec2<f32>(c.x, 1.0 - c.y));
}
@fragment
fn fs_main(o: VOut) -> @location(0) vec4<f32> {
  let c = textureSample(image, smp, o.uv).rgb;
  return vec4<f32>(pow(c, vec3<f32>(1.0 / 2.2)), 1.0);
}`});
```

The scene data stays out of sight. It is a list of five spheres, including a huge one, radius 1000, that stands
in for the floor, so every object is a sphere. The gold sphere's ${tex`k_m`} is (0.7, 0.55, 0.15), so it reflects
yellow more than blue.

```js
const gpuSpheres = [
  {
    name: "floor", center: [0, -1000, 0], radius: 1000,
    color: [0.5, 0.5, 0.45], km: [0.1, 0.1, 0.1]
  },
  {
    name: "red", center: [-1.3, 0.7, 0], radius: 0.7,
    color: [0.8, 0.15, 0.15], km: [0, 0, 0]
  },
  {
    name: "mirror", center: [0.3, 0.9, -1.2], radius: 0.9,
    color: [0.05, 0.05, 0.05], km: [0.85, 0.85, 0.85]
  },
  // reflects yellow more than blue
  {
    name: "gold", center: [1.5, 0.5, 0.4], radius: 0.5,
    color: [0.6, 0.45, 0.1], km: [0.7, 0.55, 0.15]
  },
  {
    name: "blue", center: [-0.3, 0.35, 1.2], radius: 0.35,
    color: [0.15, 0.3, 0.8], km: [0.1, 0.1, 0.1]
  }
];
const gpuLights = [
  {pos: [3, 5, 3], intensity: [30, 30, 30]},
  {pos: [-4, 3, 2], intensity: [10, 9, 8]}
];
const gpuW = 480, gpuH = 300;

```

The spheres and lights are written to storage buffers. The trace pipeline and bind groups are created in the usual way and stay out of sight.

```js
const sphereBuffer = device.createBuffer({size: gpuSpheres.length * 48, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST});
device.queue.writeBuffer(sphereBuffer, 0, new Float32Array(gpuSpheres.flatMap((s) => [...s.center, s.radius, ...s.color, 0, ...s.km, 0])));
const lightBuffer = device.createBuffer({size: gpuLights.length * 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST});
device.queue.writeBuffer(lightBuffer, 0, new Float32Array(gpuLights.flatMap((l) => [...l.pos, 0, ...l.intensity, 0])));
const cameraBuffer = device.createBuffer({size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
const outTexture = device.createTexture({size: [gpuW, gpuH], format: "rgba8unorm", usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING});

const tracePipeline = device.createComputePipeline({layout: "auto", compute: {module: gpuRTModule, entryPoint: "main"}});
const traceBindGroup = device.createBindGroup({layout: tracePipeline.getBindGroupLayout(0), entries: [
  {binding: 0, resource: {buffer: cameraBuffer}}, {binding: 1, resource: {buffer: sphereBuffer}},
  {binding: 2, resource: {buffer: lightBuffer}}, {binding: 3, resource: outTexture.createView()}]});
const showPipeline = device.createRenderPipeline({layout: "auto",
  vertex: {module: gpuRTModule, entryPoint: "vs_main"},
  fragment: {module: gpuRTModule, entryPoint: "fs_main", targets: [{format: canvasFormat}]}});
const showBindGroup = device.createBindGroup({layout: showPipeline.getBindGroupLayout(0), entries: [
  {binding: 0, resource: nearestSampler}, {binding: 1, resource: outTexture.createView()}]});

const gpuCanvas = document.createElement("canvas");
gpuCanvas.width = gpuW; gpuCanvas.height = gpuH;
gpuCanvas.style.cssText = "border-radius: 8px; cursor: crosshair; max-width: 100%";
const {context: gpuContext} = await initializeWebGPU(gpuCanvas, {device});
const pickLabel = html`<pre style="margin: 4px 0">click a sphere to pick it</pre>`;
const gpuState = {selected: -1, camera: null, draw: () => {}};
```

### Picking with a ray

Ray casting also answers "**what did the user click?**", even in a
rasterizer. The click handler runs the same ray generation and closest-hit
code, in JavaScript, with the camera the GPU used. A click is a
continuous position, not a pixel index, so there is no ${tex`+0.5`}:

```js echo
function pickingRay(cam, px, py, width, height) {
  const us = cam.l + (cam.r - cam.l) * px / width;
  const vs = cam.b + (cam.t - cam.b) * py / height;
  const sideways = vec3.add(vec3.scale(cam.u, us), vec3.scale(cam.v, vs));
  return {o: cam.e, d: vec3.add(vec3.scale(cam.w, -cam.d), sideways)};
}
```

The closest-hit test is the CPU's `Group`, built from the same data the GPU uses. Each sphere carries its index:

```js echo
function pickSphere(ray) {
  const picker = new Group(gpuSpheres.map((s, k) =>
    Object.assign(new Sphere(s.center, s.radius), {k})));
  return picker.hit(ray, 0, Infinity);
}
```

The click handler connects them. Screen ${tex`y`} counts down, and the ray's ${tex`v`} counts up, so `py` measures
from the bottom:

```js echo
gpuCanvas.addEventListener("click", (ev) => {
  const rect = gpuCanvas.getBoundingClientRect();
  const px = ev.clientX - rect.left, py = rect.bottom - ev.clientY;
  const ray = pickingRay(gpuState.camera, px, py, rect.width, rect.height);
  const hit = pickSphere(ray);
  gpuState.selected = hit ? hit.surface.k : -1;
  pickLabel.textContent = hit
    ? `picked: ${gpuSpheres[hit.surface.k].name} at t = ${hit.t.toFixed(3)}`
    : "picked: nothing (background)";
  gpuState.draw();
});
```

In a **rasterizer**, the same picking code needs the ray tracer's camera
from the rasterizer's one: ${tex`t = d\tan(\text{fovy}/2) = -b`} and
${tex`r = \text{aspect}\cdot t = -l`}. ${tex`\mathbf u, \mathbf v, \mathbf w`}
are the **rows** of the view matrix's rotation; in a column-major array
`V` (as in `lib/math/transforms.js`), ${tex`\mathbf u = (V_0, V_4, V_8)`},
${tex`\mathbf v = (V_1, V_5, V_9)`}, and
${tex`\mathbf w = (V_2, V_6, V_{10})`}. The origin ${tex`\mathbf e`} is
the camera's eye, not the matrix's translation.

```js
const gpuForm = view(Inputs.form({
  azimuth: Inputs.range([-180, 180], {value: 20, step: 1, label: "camera azimuth"}),
  elevation: Inputs.range([5, 70], {value: 20, step: 1, label: "camera elevation"}),
  maxDepth: Inputs.range([0, 6], {value: 3, step: 1, label: "max reflection depth"}),
  shadows: Inputs.toggle({value: true, label: "shadow rays"})
}));
```

```js
{
  const az = (gpuForm.azimuth * Math.PI) / 180, el = (gpuForm.elevation * Math.PI) / 180;
  const eye = [6.5 * Math.cos(el) * Math.sin(az), 0.6 + 6.5 * Math.sin(el), 6.5 * Math.cos(el) * Math.cos(az)];
  const t = 0.4, r = t * gpuW / gpuH;
  gpuState.camera = {...cameraFrame(eye, [0, 0.6, -0.3]), perspective: true, d: 1, l: -r, r, b: -t, t};
  gpuState.draw = () => {
    const c = gpuState.camera;
    device.queue.writeBuffer(cameraBuffer, 0, new Float32Array([
      ...c.e, c.d, ...c.u, c.l, ...c.v, c.r, ...c.w, c.b, c.t, gpuState.selected, gpuForm.shadows ? 1 : 0, gpuForm.maxDepth]));
    const encoder = device.createCommandEncoder();
    const compute = encoder.beginComputePass();
    compute.setPipeline(tracePipeline);
    compute.setBindGroup(0, traceBindGroup);
    compute.dispatchWorkgroups(Math.ceil(gpuW / 8), Math.ceil(gpuH / 8));
    compute.end();
    const pass = encoder.beginRenderPass({colorAttachments: [{view: gpuContext.getCurrentTexture().createView(), clearValue: {r: 0, g: 0, b: 0, a: 1}, loadOp: "clear", storeOp: "store"}]});
    pass.setPipeline(showPipeline);
    pass.setBindGroup(0, showBindGroup);
    pass.draw(3);
    pass.end();
    device.queue.submit([encoder.finish()]);
  };
  gpuState.draw();
}
```

```js
html`<div>${gpuCanvas}${pickLabel}</div>`
```

The GPU traces ${(gpuW * gpuH).toLocaleString()} rays per frame
interactively, where the CPU version above needs a noticeable pause.
Drag the camera sliders and the shadows and reflections stay exact from
every angle, with no shadow map. The gold sphere tints what it reflects,
because its ${tex`k_m`} is a color. Click a sphere: the picked one is
highlighted in the GPU image, and in its reflections too.

## Check Your Understanding

1. What are the three parts of the basic ray-tracing algorithm?
2. Given the eye ${tex`(0, 0, 5)`} looking at the origin with up ${tex`(0, 1, 0)`}, what are ${tex`\mathbf u, \mathbf v, \mathbf w`}?
3. How do orthographic, oblique, and perspective viewing rays differ?
4. Why check the discriminant before computing the roots?
5. When is the larger root of the sphere quadratic the hit?
6. What does ${tex`M = 0`} mean in the triangle test, and why compute ${tex`t`} first?
7. Why does a group shrink ${tex`t_1`} as it goes?
8. A ray starts inside a box. Which of ${tex`t_{\text{near}}`} and ${tex`t_{\text{far}}`} is the hit, and why?
9. Why does a bounding box test use the interval overlap rather than the box's single surface hit, and what does a bounding box save?
10. Why do shadow rays start at ${tex`\epsilon`} rather than 0, and end at ${tex`r`} rather than ${tex`\infty`}? What changes for a directional light?
11. Why must the normal be flipped toward the ray *before* offsetting the start of a shadow ray?
12. Why does the progressive tracer trace a few rows per frame instead of the whole image at once?
13. WGSL has no recursion. How does the GPU tracer handle reflection?

<details>
<summary>Answers</summary>

1. Ray generation, ray intersection, and shading.
2. ${tex`\mathbf w = (0,0,1)`}, ${tex`\mathbf u = (1,0,0)`}, ${tex`\mathbf v = (0,1,0)`}.
3. Orthographic rays share the direction ${tex`-\mathbf w`} and start at different points on the plane through ${tex`\mathbf e`}. Oblique rays start at the same points but share a different direction. Perspective rays share the origin ${tex`\mathbf e`} and have different directions.
4. A negative discriminant is a miss, and testing it first avoids a square root and further work for the many rays that miss.
5. When the smaller root is outside ${tex`[t_0, t_1]`}, for example when the ray starts inside the sphere.
6. The ray is parallel to the triangle's plane. ${tex`t`} is often out of range, so testing it first rejects cheaply.
7. So each later surface only counts if it is closer than the closest hit so far.
8. ${tex`t_{\text{far}}`}: ${tex`t_{\text{near}}`} is negative (behind the origin), and the ray meets the box's surface where it leaves.
9. A ray that starts inside the box (a shadow ray leaving the mesh) must still test the triangles, and the overlap ${tex`[t_{\text{near}}, t_{\text{far}}]`} still meets ${tex`[t_0, t_1]`} there. A ray that misses the box skips all ${tex`N`} triangle tests; a ray that hits it pays one extra box test.
10. Starting at 0 would hit the surface the ray leaves (shadow acne). Beyond ${tex`r`}, objects are behind the light and cannot shadow it. A directional light has no position, so its shadow ray goes to ${tex`\infty`}.
11. The offset must move the start to the side the ray came from. Along an outward normal seen from inside (a room's wall), it moves the start outside, and every shadow ray is blocked.
12. Tracing the whole image in one call blocks the page until it finishes. A time budget per frame keeps the page responsive and lets the image fill in.
13. A loop follows the reflected ray, multiplying an RGB weight by ${tex`k_m`} at each bounce, up to a maximum depth.

</details>

## Common Pitfalls

- **Mixing up the frame**: the camera looks along ${tex`-\mathbf w`},
  and ${tex`\mathbf v`} is not the up vector itself.
- **Flipping the image**: if pixel ${tex`j`} counts up from the bottom
  (the first CPU tracer and the GPU tracer), flip it when writing canvas
  or texture rows, which count down. If pixels are counted from the
  top-left (the progressive tracer), row 0 is already the top: don't flip.
- **Taking a negative root** as a hit. Hits must lie in ${tex`[t_0, t_1]`}.
- **Shadow acne** from shadow and reflection rays that start at
  ${tex`t = 0`}.
- **Unbounded recursion** between two mirrors. Cap the depth.
- **Forgetting the closest-hit rule** and keeping the last hit instead.
- **Using the surface hit as a bounding test**: a ray that starts inside
  the bounding box must still test the triangles.
- **Offsetting along the unflipped normal**: flip the normal toward the
  ray first, or shadow and reflected rays start on the wrong side.
- **`textureLoad` at the fragment position** only works when the image is
  exactly canvas-sized. Sample with `uv` from a full-screen triangle.
- **Applying gamma twice**, once on the CPU and once in the shader.
- **Blocking the page** by tracing a whole image in one call.
- **Misaligned WGSL structs**: a `vec3<f32>` is 12 bytes but aligned to
  16, so it leaves a 4-byte gap unless an `f32` follows it. Two `vec3`s
  in a row (a sphere's color and ${tex`k_m`}) each need their own padding.

## Summary

- **Image order:** for each pixel, generate a ray, find the first hit,
  and shade it. Shadows and reflections come naturally.
- **Viewing rays** come from the camera frame ${tex`\mathbf u, \mathbf v, \mathbf w`}
  (built from eye, target, and up) and the pixel position. Orthographic
  and oblique rays share a direction; perspective rays share an origin.
- **Intersection:** a sphere gives a quadratic in ${tex`t`} (check the
  discriminant first). A triangle gives a ${tex`3\times3`} system solved
  by Cramer's rule with early termination. A box is the overlap of three
  slab intervals, hit at ${tex`t_{\text{near}}`} from outside and
  ${tex`t_{\text{far}}`} from inside. A group shrinks ${tex`t_1`} to keep
  the closest hit.
- **Bounding boxes:** one box test can skip all of a mesh's triangles; a
  BVH nests boxes into a tree.
- **Shading:** add up the point, directional, and ambient lights, cast
  shadow rays over ${tex`[\epsilon, r]`}, and recurse for mirror
  reflection with an RGB ${tex`k_m`} up to a maximum depth.
- **Progressive CPU tracer:** pixels from the top-left, normals flipped
  to face the ray, materials that depend on the hit point, a blended
  reflection, and an image that fills in a few rows per frame through
  `writeTexture` and a full-screen triangle.
- **WebGPU:** a compute shader traces one pixel per invocation, the scene
  lives in storage buffers, a loop replaces recursion, and the same rays
  in JavaScript implement picking.
