---
title: Module 11 — Ray Tracing
toc: true
---

```js echo
import * as d3 from "npm:d3";
import * as vec3 from "./components/vec3.js";
import * as webgpu from "./components/webgpu.js";
import {plane, drawPoint, dragPoints} from "./components/vectorField.js";
import * as Inputs from "npm:@observablehq/inputs";
import {html} from "npm:htl";
```

# Module 11 · Ray Tracing

A **ray tracer** renders in **image order**: for each pixel, it generates
a viewing ray, finds the first object the ray hits, and shades that point.
This handout builds a complete ray tracer in JavaScript one piece at a
time (camera, intersection, groups, shading, shadows, and mirror
reflection) and then moves the same algorithm to a WebGPU compute shader.
The last section needs **Chrome or Edge 113+**. This handout teaches the
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
  const w = vec3.normalize(vec3.sub(eye, target));     // backward: the camera looks along −w
  const u = vec3.normalize(vec3.cross(up, w));         // right
  const v = vec3.cross(w, u);                          // true up: in the plane of up and w
  return {e: eye, u, v, w};
}

// Pixel (i, j) → its center (u, v) on the image rectangle [l, r] × [b, t].
const pixelUV = ({l, r, b, t}, i, j, nx, ny) => [l + (r - l) * (i + 0.5) / nx, b + (t - b) * (j + 0.5) / ny];

function viewingRay(cam, i, j, nx, ny) {
  const [us, vs] = pixelUV(cam, i, j, nx, ny);
  const offset = vec3.add(vec3.scale(cam.u, us), vec3.scale(cam.v, vs));
  return cam.perspective
    ? {o: cam.e, d: vec3.add(vec3.scale(cam.w, -cam.d), offset)}   // shared origin
    : {o: vec3.add(cam.e, offset), d: vec3.scale(cam.w, -1)};       // shared direction
}
const at = (ray, t) => vec3.add(ray.o, vec3.scale(ray.d, t));
```

### Orthographic and perspective rays

A top view of the same idea: the eye sits at the bottom, the image
rectangle (with ${tex`n_x`} pixel centers) is a distance ${tex`d`} in
front of it, and each ray stops at the first circle it hits.

```js echo
const rayFanForm = view(Inputs.form({
  kind: Inputs.radio(["perspective", "orthographic"], {value: "perspective", label: "projection"}),
  nx: Inputs.range([3, 24], {value: 9, step: 1, label: "pixels nₓ"}),
  d: Inputs.range([0.5, 3], {value: 1.2, step: 0.1, label: "image plane distance d"})
}));
```

```js echo
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
    const o = rayFanForm.kind === "perspective" ? eye : {x: us, y: eye.y};
    const d = rayFanForm.kind === "perspective" ? {x: us, y: rayFanForm.d} : {x: 0, y: 1};
    const t = hit2D(o, d);
    scene.svg.append("line").attr("x1", scene.x(o.x)).attr("y1", scene.y(o.y)).attr("x2", scene.x(o.x + t * d.x)).attr("y2", scene.y(o.y + t * d.y))
      .attr("stroke", "orange").attr("stroke-width", 1.4);
    drawPoint(scene, {x: us, y: yImage}, {color: "black", r: 2.5});
  }
  drawPoint(scene, eye, {color: "crimson", r: 5, label: "e"});
  return scene.svg.node();
})()
```

Perspective rays share the **origin** ${tex`\mathbf e`} and fan out, and
a smaller ${tex`d`} gives a wider field of view. Orthographic rays share
the **direction** ${tex`-\mathbf w`}. No perspective matrix is needed:
rays from the eye produce perspective directly.

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
  const A = vec3.dot(ray.d, ray.d), B = vec3.dot(ray.d, ec), C = vec3.dot(ec, ec) - radius * radius;
  const disc = B * B - A * C;
  if (disc < 0) return Infinity;                        // miss: no more work
  const sq = Math.sqrt(disc);
  let t = (-B - sq) / A;                                // smaller root first
  if (t < t0 || t > t1) t = (-B + sq) / A;
  return t < t0 || t > t1 ? Infinity : t;
}
```

```js echo
html`<pre>debug case: e = (1, 1, 1), d = (−1, −1, −1), unit sphere at the origin
  first hit  t = ${hitSphereT({o: [1, 1, 1], d: [-1, -1, -1]}, [0, 0, 0], 1, 0, Infinity).toFixed(4)}   (expected 1 − √3/3 ≈ 0.4226)
  from inside (t₀ = 0.5): t = ${hitSphereT({o: [1, 1, 1], d: [-1, -1, -1]}, [0, 0, 0], 1, 0.5, Infinity).toFixed(4)}   (expected 1 + √3/3 ≈ 1.5774)</pre>`
```

Drag the ray's origin **e** and the point **e + d** to see the three
cases of the discriminant:

```js echo
const discWidget = dragPoints({"e": {x: -3.2, y: -1.4}, "e + d": {x: -1.6, y: -0.6}}, {width: 380, height: 380, domain: 4, colors: ["crimson", "orange"]});
const discPts = view(discWidget);
```

```js echo
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
  scene.svg.append("text").attr("x", 10).attr("y", 20).attr("font-size", 13).attr("font-family", "var(--sans-serif)").text(label);
})
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

```js echo
function hitTriangle(ray, A, B, C, t0, t1) {
  // Column by column, as in the reading: (a, b, c) = A − B, (d, e, f) = A − C, (g, h, i) = d.
  const [a, b, c] = vec3.sub(A, B), [d, e, f] = vec3.sub(A, C), [g, h, i] = ray.d;
  const [j, k, l] = vec3.sub(A, ray.o);
  const eihf = e * i - h * f, gfdi = g * f - d * i, dheg = d * h - e * g;
  const akjb = a * k - j * b, jcal = j * c - a * l, blkc = b * l - k * c;
  const M = a * eihf + b * gfdi + c * dheg;
  if (Math.abs(M) < 1e-12) return null;                       // parallel to the plane
  const t = -(f * akjb + e * jcal + d * blkc) / M;
  if (t < t0 || t > t1) return null;
  const gamma = (i * akjb + h * jcal + g * blkc) / M;
  if (gamma < 0 || gamma > 1) return null;
  const beta = (j * eihf + k * gfdi + l * dheg) / M;
  if (beta < 0 || beta > 1 - gamma) return null;
  return {t, beta, gamma};
}
```

```js echo
(() => {
  const h = hitTriangle({o: [1, 1, 1], d: [-1, -1, -1]}, [1, 0, 0], [0, 1, 0], [0, 0, 1], 0, Infinity);
  return html`<pre>debug case: e = (1, 1, 1), d = (−1, −1, −1), triangle (1,0,0), (0,1,0), (0,0,1)
  t = ${h.t.toFixed(4)}, β = ${h.beta.toFixed(4)}, γ = ${h.gamma.toFixed(4)}   (expected 2/3, 1/3, 1/3)
  hit point = (${at({o: [1, 1, 1], d: [-1, -1, -1]}, h.t).map((v) => v.toFixed(4)).join(", ")})</pre>`;
})()
```

### Surfaces, hit records, and groups

Anything a ray can hit implements `hit(ray, t0, t1)` and returns a
**hit record** (or `null` for a miss). A **group** is also a surface: it
keeps the closest hit by **shrinking** ${tex`t_1`} after each one, so
only closer surfaces can win.

```js echo
class Sphere {
  constructor(center, radius, material) { Object.assign(this, {center, radius, material}); }
  hit(ray, t0, t1) {
    const t = hitSphereT(ray, this.center, this.radius, t0, t1);
    if (t === Infinity) return null;
    const p = at(ray, t);
    return {t, p, n: vec3.scale(vec3.sub(p, this.center), 1 / this.radius), surface: this};
  }
}
class Triangle {
  constructor(a, b, c, material) { Object.assign(this, {a, b, c, material}); this.normal = vec3.normalize(vec3.cross(vec3.sub(b, a), vec3.sub(c, a))); }
  hit(ray, t0, t1) {
    const h = hitTriangle(ray, this.a, this.b, this.c, t0, t1);
    return h && {t: h.t, p: at(ray, h.t), n: this.normal, beta: h.beta, gamma: h.gamma, surface: this};
  }
}
class Group {
  constructor(surfaces) { this.surfaces = surfaces; }
  hit(ray, t0, t1) {
    let closest = null;
    for (const s of this.surfaces) {
      const rec = s.hit(ray, t0, t1);
      if (rec) { closest = rec; t1 = rec.t; }               // shrink the interval
    }
    return closest;
  }
}
```

## Shading, Shadows, and Reflection

### Lights, materials, and shading a ray

**Lights** compute illumination; **materials** say how the surface
reflects it. Each point light contributes
${tex`k\,\max(0, \mathbf n\cdot\mathbf l)\,I/r^2`}, with ${tex`k`} the
Blinn–Phong reflectance from Module 05, and the ambient light adds
${tex`k_a I_a`}. A **shadow ray** toward each light, over
${tex`[\epsilon, r]`}, decides whether that light counts. Mirror
reflection **recurses** along
${tex`\mathbf r = \mathbf d - 2(\mathbf d\cdot\mathbf n)\mathbf n`},
weighted by the color ${tex`k_m`}, up to a maximum depth.

```js echo
const checker = (p) => ((Math.floor(p[0]) + Math.floor(p[2])) & 1 ? [0.75, 0.75, 0.72] : [0.25, 0.25, 0.3]);
function material({kd = [0.7, 0.7, 0.7], ks = 0.3, shininess = 60, km = [0, 0, 0], texture = null} = {}) {
  return {kd, ks, shininess, km, texture,
    evaluate(l, v, n, p) {                                    // Blinn–Phong reflectance k
      const h = vec3.normalize(vec3.add(l, v));
      const spec = this.ks * Math.max(0, vec3.dot(n, h)) ** this.shininess;
      return (this.texture ? this.texture(p) : this.kd).map((c) => c + spec);
    }};
}
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
const rtLights = [{p: [3, 5, 3], I: 28}, {p: [-4, 3, 2], I: 10}];
const ambient = 0.12, background = [0.6, 0.7, 0.9], EPS = 1e-4;

function shadeRay(ray, t0, t1, depth, opts) {
  const rec = rtScene.hit(ray, t0, t1);
  if (!rec) return background;
  const m = rec.surface.material, kd = m.texture ? m.texture(rec.p) : m.kd;
  const v = vec3.normalize(vec3.scale(ray.d, -1));
  let c = kd.map((k) => k * ambient);                       // ambient light: k_a I_a
  if (opts.shading) for (const light of rtLights) {
    const toL = vec3.sub(light.p, rec.p), r = vec3.length(toL), l = vec3.scale(toL, 1 / r);
    if (opts.shadows && rtScene.hit({o: rec.p, d: l}, EPS, r)) continue;   // shadow ray over [ε, r]
    const E = Math.max(0, vec3.dot(rec.n, l)) * light.I / (r * r);
    const k = m.evaluate(l, v, rec.n, rec.p);
    c = c.map((ci, q) => ci + k[q] * E);
  } else c = kd;
  if (depth < opts.maxDepth && m.km.some((k) => k > 0)) {
    const rdir = vec3.sub(ray.d, vec3.scale(rec.n, 2 * vec3.dot(ray.d, rec.n)));
    const reflected = shadeRay({o: rec.p, d: rdir}, EPS, Infinity, depth + 1, opts);   // recursive call
    c = c.map((ci, q) => ci + m.km[q] * reflected[q]);
  }
  return c;
}
```

```js echo
const rtForm = view(Inputs.form({
  projection: Inputs.radio(["perspective", "orthographic"], {value: "perspective", label: "projection"}),
  shading: Inputs.toggle({value: true, label: "light the scene (off = flat colors)"}),
  shadows: Inputs.toggle({value: true, label: "shadow rays"}),
  maxDepth: Inputs.range([0, 6], {value: 3, step: 1, label: "max reflection depth"}),
  azimuth: Inputs.range([-180, 180], {value: 20, step: 1, label: "camera azimuth"})
}));
```

```js echo
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

## Ray Tracing in WebGPU

### Architecture

Each pixel is independent, so a **compute shader** runs one invocation
per pixel and writes a **storage texture**. The spheres and lights live
in **storage buffers**, the camera in a **uniform buffer**, and a small
render pass shows the texture. WGSL does **not allow recursion**, so the
recursive `shadeRay` becomes a **loop** that carries the product of the
${tex`k_m`} values.

```js echo
const {adapter, device} = await webgpu.requestDevice();
const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
const deviceErrorLog = document.createElement("pre");
deviceErrorLog.style.cssText = "display: none; color: #e5484d; background: #2a1214; border: 1px solid #e5484d; border-radius: 6px; padding: 8px 12px; font-size: 12px; white-space: pre-wrap;";
device.addEventListener("uncapturederror", (e) => { deviceErrorLog.textContent += `WebGPU error: ${e.error.message}\n`; deviceErrorLog.style.display = "block"; });
```

```js echo
deviceErrorLog
```

```js echo
const gpuRTModule = device.createShaderModule({code: `
struct Camera {                  // vec3 + f32 pairs pack into 16-byte rows
  e: vec3<f32>, d: f32,
  u: vec3<f32>, l: f32,
  v: vec3<f32>, r: f32,
  w: vec3<f32>, b: f32,
  t: f32, selected: f32, shadows: f32, maxDepth: f32,
};
struct Sphere { center: vec3<f32>, radius: f32, color: vec3<f32>, km: f32 };
struct Light { pos: vec3<f32>, intensity: f32 };
struct Ray { o: vec3<f32>, d: vec3<f32> };
struct Hit { t: f32, n: vec3<f32>, idx: i32 };

@group(0) @binding(0) var<uniform> cam: Camera;
@group(0) @binding(1) var<storage, read> spheres: array<Sphere>;
@group(0) @binding(2) var<storage, read> lights: array<Light>;
@group(0) @binding(3) var outTex: texture_storage_2d<rgba8unorm, write>;

const ambient = vec3<f32>(0.1);
const eps = 1e-3;
const background = vec3<f32>(0.6, 0.7, 0.9);

fn viewingRay(i: u32, j: u32, nx: u32, ny: u32) -> Ray {
  let us = cam.l + (cam.r - cam.l) * (f32(i) + 0.5) / f32(nx);
  let vs = cam.b + (cam.t - cam.b) * (f32(j) + 0.5) / f32(ny);
  return Ray(cam.e, -cam.d * cam.w + us * cam.u + vs * cam.v);      // perspective ray
}

fn hitSphere(s: Sphere, r: Ray, t0: f32, t1: f32) -> f32 {           // t, or -1 for a miss
  let ec = r.o - s.center;
  let A = dot(r.d, r.d);
  let B = dot(r.d, ec);
  let C = dot(ec, ec) - s.radius * s.radius;
  let disc = B * B - A * C;
  if (disc < 0.0) { return -1.0; }                                  // check the discriminant first
  let sq = sqrt(disc);
  var t = (-B - sq) / A;
  if (t < t0 || t > t1) { t = (-B + sq) / A; }
  if (t < t0 || t > t1) { return -1.0; }
  return t;
}

fn sceneHit(r: Ray, t0: f32, t1in: f32) -> Hit {
  var h = Hit(-1.0, vec3<f32>(0.0), -1);
  var t1 = t1in;
  for (var k = 0u; k < arrayLength(&spheres); k++) {
    let t = hitSphere(spheres[k], r, t0, t1);
    if (t >= 0.0) {
      t1 = t;                                                       // shrink the interval
      h = Hit(t, (r.o + t * r.d - spheres[k].center) / spheres[k].radius, i32(k));
    }
  }
  return h;
}

fn shade(r: Ray, h: Hit) -> vec3<f32> {
  let s = spheres[h.idx];
  let x = r.o + h.t * r.d;
  var c = s.color * ambient;
  for (var k = 0u; k < arrayLength(&lights); k++) {
    let toL = lights[k].pos - x;
    let dist = length(toL);
    let l = toL / dist;
    if (cam.shadows > 0.5 && sceneHit(Ray(x, l), eps, dist).idx >= 0) { continue; }   // shadow ray
    c += s.color * lights[k].intensity * max(0.0, dot(h.n, l)) / (dist * dist);
  }
  if (h.idx == i32(cam.selected)) { c = 0.5 * c + vec3<f32>(0.5, 0.4, 0.05); }        // picked
  return c;
}

fn trace(primary: Ray) -> vec3<f32> {
  var ray = primary;
  var color = vec3<f32>(0.0);
  var weight = 1.0;                                // product of k_m along the path
  for (var depth = 0; depth <= i32(cam.maxDepth); depth++) {
    let h = sceneHit(ray, eps, 1e30);
    if (h.idx < 0) { color += weight * background; break; }
    color += weight * shade(ray, h);
    let km = spheres[h.idx].km;
    if (km == 0.0) { break; }
    weight *= km;
    let p = ray.o + h.t * ray.d;
    ray = Ray(p, ray.d - 2.0 * dot(ray.d, h.n) * h.n);                // r = d − 2(d·n)n
  }
  return color;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let dims = textureDimensions(outTex);
  if (id.x >= dims.x || id.y >= dims.y) { return; }
  let ray = viewingRay(id.x, dims.y - 1u - id.y, dims.x, dims.y);    // texture rows go down; j goes up
  textureStore(outTex, id.xy, vec4<f32>(trace(ray), 1.0));
}

// Display: a full-screen triangle that copies the texture, encoded for the screen.
@group(0) @binding(0) var image: texture_2d<f32>;
@vertex
fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  var pos = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  return vec4<f32>(pos[i], 0.0, 1.0);
}
@fragment
fn fs_main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let c = textureLoad(image, vec2<i32>(frag.xy), 0).rgb;
  return vec4<f32>(pow(c, vec3<f32>(1.0 / 2.2)), 1.0);
}`});
```

The scene data: a huge sphere stands in for the floor, so every object is
a sphere.

```js echo
const gpuSpheres = [
  {name: "floor", center: [0, -1000, 0], radius: 1000, color: [0.5, 0.5, 0.45], km: 0.1},
  {name: "red", center: [-1.3, 0.7, 0], radius: 0.7, color: [0.8, 0.15, 0.15], km: 0},
  {name: "mirror", center: [0.3, 0.9, -1.2], radius: 0.9, color: [0.05, 0.05, 0.05], km: 0.85},
  {name: "gold", center: [1.5, 0.5, 0.4], radius: 0.5, color: [0.6, 0.45, 0.1], km: 0.4},
  {name: "blue", center: [-0.3, 0.35, 1.2], radius: 0.35, color: [0.15, 0.3, 0.8], km: 0.1}
];
const gpuLights = [{pos: [3, 5, 3], intensity: 30}, {pos: [-4, 3, 2], intensity: 10}];
const gpuW = 480, gpuH = 300;

const sphereBuffer = device.createBuffer({size: gpuSpheres.length * 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST});
device.queue.writeBuffer(sphereBuffer, 0, new Float32Array(gpuSpheres.flatMap((s) => [...s.center, s.radius, ...s.color, s.km])));
const lightBuffer = device.createBuffer({size: gpuLights.length * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST});
device.queue.writeBuffer(lightBuffer, 0, new Float32Array(gpuLights.flatMap((l) => [...l.pos, l.intensity])));
const cameraBuffer = device.createBuffer({size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
const outTexture = device.createTexture({size: [gpuW, gpuH], format: "rgba8unorm", usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING});

const tracePipeline = device.createComputePipeline({layout: "auto", compute: {module: gpuRTModule, entryPoint: "main"}});
const traceBindGroup = device.createBindGroup({layout: tracePipeline.getBindGroupLayout(0), entries: [
  {binding: 0, resource: {buffer: cameraBuffer}}, {binding: 1, resource: {buffer: sphereBuffer}},
  {binding: 2, resource: {buffer: lightBuffer}}, {binding: 3, resource: outTexture.createView()}]});
const showPipeline = device.createRenderPipeline({layout: "auto",
  vertex: {module: gpuRTModule, entryPoint: "vs_main"},
  fragment: {module: gpuRTModule, entryPoint: "fs_main", targets: [{format: canvasFormat}]}});
const showBindGroup = device.createBindGroup({layout: showPipeline.getBindGroupLayout(0), entries: [{binding: 0, resource: outTexture.createView()}]});

const gpuCanvas = document.createElement("canvas");
gpuCanvas.width = gpuW; gpuCanvas.height = gpuH;
gpuCanvas.style.cssText = "border-radius: 8px; cursor: crosshair; max-width: 100%";
const {context: gpuContext} = webgpu.configureCanvas(gpuCanvas, device);
const pickLabel = html`<pre style="margin: 4px 0">click a sphere to pick it</pre>`;
const gpuState = {selected: -1, camera: null, draw: () => {}};
```

### Picking with a ray

Ray casting also answers "**what did the user click?**", even in a
rasterizer. The click handler runs the same ray generation and closest-hit
code, in JavaScript, with the camera the GPU used:

```js echo
gpuCanvas.addEventListener("click", (ev) => {
  const rect = gpuCanvas.getBoundingClientRect(), cam = gpuState.camera;
  const i = (ev.clientX - rect.left) * gpuW / rect.width;
  const j = (rect.height - (ev.clientY - rect.top)) * gpuH / rect.height;   // j counts up from the bottom
  const ray = viewingRay(cam, Math.floor(i), Math.floor(j), gpuW, gpuH);
  const picker = new Group(gpuSpheres.map((s, k) => Object.assign(new Sphere(s.center, s.radius), {k})));
  const hit = picker.hit(ray, 0, Infinity);                                 // closest hit
  gpuState.selected = hit ? hit.surface.k : -1;
  pickLabel.textContent = hit ? `picked: ${gpuSpheres[hit.surface.k].name} at t = ${hit.t.toFixed(3)}` : "picked: nothing (background)";
  gpuState.draw();
});
```

```js echo
const gpuForm = view(Inputs.form({
  azimuth: Inputs.range([-180, 180], {value: 20, step: 1, label: "camera azimuth"}),
  elevation: Inputs.range([5, 70], {value: 20, step: 1, label: "camera elevation"}),
  maxDepth: Inputs.range([0, 6], {value: 3, step: 1, label: "max reflection depth"}),
  shadows: Inputs.toggle({value: true, label: "shadow rays"})
}));
```

```js echo
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

```js echo
html`<div>${gpuCanvas}${pickLabel}</div>`
```

The GPU traces ${(gpuW * gpuH).toLocaleString()} rays per frame
interactively, where the CPU version above needs a noticeable pause.
Drag the camera sliders and the shadows and reflections stay exact from
every angle, with no shadow map. Click a sphere: the picked one is
highlighted in the GPU image, and in its reflections too.

## Check Your Understanding

1. What are the three parts of the basic ray-tracing algorithm?
2. Given the eye ${tex`(0, 0, 5)`} looking at the origin with up ${tex`(0, 1, 0)`}, what are ${tex`\mathbf u, \mathbf v, \mathbf w`}?
3. How do orthographic and perspective viewing rays differ?
4. Why check the discriminant before computing the roots?
5. When is the larger root of the sphere quadratic the hit?
6. What does ${tex`M = 0`} mean in the triangle test, and why compute ${tex`t`} first?
7. Why does a group shrink ${tex`t_1`} as it goes?
8. Why do shadow rays start at ${tex`\epsilon`} rather than 0, and end at ${tex`r`} rather than ${tex`\infty`}?
9. WGSL has no recursion. How does the GPU tracer handle reflection?

<details>
<summary>Answers</summary>

1. Ray generation, ray intersection, and shading.
2. ${tex`\mathbf w = (0,0,1)`}, ${tex`\mathbf u = (1,0,0)`}, ${tex`\mathbf v = (0,1,0)`}.
3. Orthographic rays share the direction ${tex`-\mathbf w`} and start at different points. Perspective rays share the origin ${tex`\mathbf e`} and have different directions.
4. A negative discriminant is a miss, and testing it first avoids a square root and further work for the many rays that miss.
5. When the smaller root is outside ${tex`[t_0, t_1]`}, for example when the ray starts inside the sphere.
6. The ray is parallel to the triangle's plane. ${tex`t`} is often out of range, so testing it first rejects cheaply.
7. So each later surface only counts if it is closer than the closest hit so far.
8. Starting at 0 would hit the surface the ray leaves (shadow acne). Beyond ${tex`r`}, objects are behind the light and cannot shadow it.
9. A loop follows the reflected ray, multiplying a weight by ${tex`k_m`} at each bounce, up to a maximum depth.

</details>

## Common Pitfalls

- **Mixing up the frame**: the camera looks along ${tex`-\mathbf w`},
  and ${tex`\mathbf v`} is not the up vector itself.
- **Flipping the image**: pixel ${tex`j`} counts up, but canvas and
  texture rows count down.
- **Taking a negative root** as a hit. Hits must lie in ${tex`[t_0, t_1]`}.
- **Shadow acne** from shadow and reflection rays that start at
  ${tex`t = 0`}.
- **Unbounded recursion** between two mirrors. Cap the depth.
- **Forgetting the closest-hit rule** and keeping the last hit instead.
- **Misaligned WGSL structs**: a `vec3<f32>` is 12 bytes but aligned to
  16, so it leaves a 4-byte gap unless an `f32` follows it.

## Summary

- **Image order:** for each pixel, generate a ray, find the first hit,
  and shade it. Shadows and reflections come naturally.
- **Viewing rays** come from the camera frame ${tex`\mathbf u, \mathbf v, \mathbf w`}
  and the pixel position. Orthographic rays share a direction;
  perspective rays share an origin.
- **Intersection:** a sphere gives a quadratic in ${tex`t`} (check the
  discriminant first). A triangle gives a ${tex`3\times3`} system solved
  by Cramer's rule with early termination. A group shrinks ${tex`t_1`} to
  keep the closest hit.
- **Shading:** add up the lights, cast shadow rays over
  ${tex`[\epsilon, r]`}, and recurse for mirror reflection up to a
  maximum depth.
- **WebGPU:** a compute shader traces one pixel per invocation, the scene
  lives in storage buffers, a loop replaces recursion, and the same rays
  in JavaScript implement picking.
