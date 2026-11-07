---
title: Module 08 — Texture Mapping
toc: true
---

```js
import * as d3 from "npm:d3";
import * as mat4 from "./lib/math/mat4.js";
import * as transforms from "./lib/math/transforms.js";
import * as geometry from "./components/geometry.js";
import * as obj from "./lib/obj-mtl.js";
import * as objMesh from "./components/objMesh.js";
import * as mipmaps from "./components/mipmaps.js";
import {initializeWebGPU, createBuffer, Mesh} from "./lib/webgpu.js";
import * as raster from "./components/raster.js";
import * as Inputs from "npm:@observablehq/inputs";
import {html} from "npm:htl";
```

# Module 08 · Texture Mapping

Almost no real surface is featureless. **Texture mapping** stores
spatially varying detail in an image and maps it onto a surface. Every
use of texture mapping has to solve two problems:

1. **Texture coordinates:** which point of the texture belongs to each
   point of the surface?
2. **Antialiasing:** how do we look up texture values without aliasing?

This page works through both, then applies textures to shading
parameters, normals, shadows, and reflections, and finally builds 3D
procedural textures. Most demos are plain JavaScript. The ones that need
the GPU use WebGPU and need **Chrome or Edge 113+**. The WebGPU API calls
are explained in the last section. The code is part of the reading: each lookup,
filter, and shader is built in small, tested steps, while the code that only prepares
and draws the demos stays out of sight. This handout teaches the *techniques*; it is
not a walkthrough of any graded assignment.

```js
const {device, format: canvasFormat} = await initializeWebGPU(document.createElement("canvas"));   // a blank canvas: each demo adds its own below

const deviceErrorLog = document.createElement("pre");
deviceErrorLog.style.cssText = "display: none; color: #e5484d; background: #2a1214; border: 1px solid #e5484d; border-radius: 6px; padding: 8px 12px; font-size: 12px; white-space: pre-wrap;";
device.addEventListener("uncapturederror", (event) => {
  deviceErrorLog.textContent += `WebGPU error: ${event.error.message}\n`;
  deviceErrorLog.style.display = "block";
});

async function makeCanvas(size) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  canvas.style.borderRadius = "8px";
  const {context} = await initializeWebGPU(canvas, {device});
  const depthTexture = device.createTexture({size: [size, size], format: "depth24plus", usage: GPUTextureUsage.RENDER_ATTACHMENT});
  return {canvas, context, depthTexture};
}
function renderPass(target, draw, clear = {r: 0.05, g: 0.05, b: 0.08, a: 1}) {
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [{view: target.context.getCurrentTexture().createView(), clearValue: clear, loadOp: "clear", storeOp: "store"}],
    depthStencilAttachment: {view: target.depthTexture.createView(), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store"}
  });
  draw(pass);
  pass.end();
  device.queue.submit([encoder.finish()]);
}
function orbitEye(azimuthDeg, elevationDeg, dist, target = [0, 0, 0]) {
  const az = (azimuthDeg * Math.PI) / 180, el = (elevationDeg * Math.PI) / 180;
  return [target[0] + dist * Math.cos(el) * Math.sin(az), target[1] + dist * Math.sin(el), target[2] + dist * Math.cos(el) * Math.cos(az)];
}
// Draws an RGBA Uint8ClampedArray (or a function (x, y) -> [r, g, b]) into a canvas.
function imageCanvas(width, height, pixel, scale = 1) {
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  canvas.style.width = `${width * scale}px`;
  canvas.style.imageRendering = scale > 1 ? "pixelated" : "auto";
  canvas.style.borderRadius = "6px";
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const [r, g, b] = pixel(x, y), i = 4 * (y * width + x);
    img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
```

```js
deviceErrorLog
```

## Texture Coordinates

### Looking up a texture value

A **texture** is an image with ${tex`n_u \times n_v`} texels addressed by
${tex`(u, v) \in [0,1]^2`}. The simplest lookup returns the nearest
texel. A shader asks the surface for the texture coordinates of its
shading point, then uses the looked-up color, for example as the diffuse
color:

We store a texture as plain data: its width, its height, and an RGB array in scanline
order, the layout from Module 02. `pixel(i, j)` supplies the color of each texel:

```js echo
function makeTexture(width, height, pixel) {
  const data = new Float32Array(width * height * 3);
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
    data.set(pixel(i, j), 3 * (j * width + i));
  }
  return {width, height, data};
}
```

Reading a texel returns its three values:

```js echo
const texel = (t, i, j) => {
  const start = 3 * (j * t.width + i);
  return t.data.subarray(start, start + 3);
};
```

The reading's `texture_lookup` finds the nearest texel. Texel ${tex`i`}'s center is at
${tex`u = (i + \tfrac12)/n_u`}, so we solve for ${tex`i`} and round, clamping at the
borders:

```js echo
const clampIndex = (i, n) => Math.min(n - 1, Math.max(0, i));
function textureLookup(t, u, v) {
  const i = clampIndex(Math.round(u * t.width - 0.5), t.width);
  const j = clampIndex(Math.round(v * t.height - 0.5), t.height);
  return texel(t, i, j);
}
```

Test it on a 2 × 2 texture whose red channel holds the texel's number. The point
${tex`(0.75, 0.25)`} is the center of the texel in column 1, row 0, which is number 1:

```js echo
textureLookup(makeTexture(2, 2, (i, j) => [j * 2 + i, 0, 0]), 0.75, 0.25)
```

Our test texture is a **numbered grid**, the standard tool for seeing
how a mapping stretches a texture. Each cell is colored by its row and
column, and a few cells carry a marker so that you can tell up from down:

```js
const gridTexture = makeTexture(128, 128, (i, j) => {
  const cu = Math.floor(i / 16), cv = Math.floor(j / 16);
  const base = d3.rgb(d3.interpolateRainbow(cu / 8));
  const shade = 0.55 + 0.45 * (cv / 7);
  const line = i % 16 === 0 || j % 16 === 0;
  const marker = (cu + cv) % 4 === 0 && Math.hypot((i % 16) - 8, (j % 16) - 8) < 3.5;
  return line ? [30, 30, 30] : marker ? [255, 255, 255] : [base.r * shade, base.g * shade, base.b * shade];
});
```

```js
imageCanvas(
  128, 128,
  (x, y) => textureLookup(gridTexture, (x + 0.5) / 128, 1 - (y + 0.5) / 128),
  1.5
)
```

(Here ${tex`v = 0`} is the bottom row, as in the reading.)

### Geometrically determined coordinates

The **texture coordinate function** ${tex`\phi : S \to T`} maps each
surface point to texture space. Four classic choices compute it from the
point's position. Here ${tex`y`} is "up", so the poles of the spherical
map are at ${tex`y = \pm 1`}:

The planar map simply drops ${tex`z`} and rescales ${tex`x`} and ${tex`y`} from
${tex`[-1, 1]`} to ${tex`[0, 1]`}, an orthographic projection along ${tex`z`}:

```js echo
const planarMap = (p) => [(p.x + 1) / 2, (p.y + 1) / 2];
```

The spherical map uses longitude and latitude. Longitude runs around the ${tex`y`}
axis, and latitude comes from the angle down from the pole. Both are rescaled to
${tex`[0, 1]`}:

```js echo
const longitude = (p) => (Math.PI + Math.atan2(p.z, p.x)) / (2 * Math.PI);
const sphericalMap = (p) => [
  longitude(p),
  (Math.PI - Math.acos(p.y / Math.hypot(p.x, p.y, p.z))) / Math.PI
];
```

The cylindrical map keeps that longitude, and ${tex`v`} simply follows the height:

```js echo
const cylindricalMap = (p) => [longitude(p), (1 + p.y) / 2];
```

The cube map picks the face whose axis has the largest absolute value, then divides the
other two coordinates by it. It also returns which face it chose:

```js echo
function cubeMap(p) {
  const ax = Math.abs(p.x), ay = Math.abs(p.y), az = Math.abs(p.z);
  const uv = (a, b, m) => [0.5 * (1 + a / m), 0.5 * (1 + b / m)];
  if (ax >= ay && ax >= az) return [...uv(p.z, p.y, ax), p.x > 0 ? 0 : 1];
  if (ay >= az) return [...uv(p.x, p.z, ay), p.y > 0 ? 2 : 3];
  return [...uv(p.x, p.y, az), p.z > 0 ? 4 : 5];
}
```

We can check these on points whose answers we know. The north pole has ${tex`v = 1`} on
the sphere, at any longitude. The point (0, 0, 1) is the center of cube face 4, so it
should give ${tex`(0.5, 0.5)`} and then the face number:

```js echo
[sphericalMap({x: 0, y: 1, z: 0}), cubeMap({x: 0, y: 0, z: 1})]
  .map((r) => r.join(", "))
```

```js
const mappings = {
  planar: planarMap, spherical: sphericalMap,
  cylindrical: cylindricalMap, "cube map": cubeMap
};
```

The renderer below casts one orthographic ray per pixel at an ellipsoid,
finds the hit point ${tex`\mathbf p`}, evaluates ${tex`\phi(\mathbf p)`},
and looks up the grid texture. (For the cube map, each face is tinted
differently.) Try each mapping on a sphere, a tall "vase", and a flat
"disk":

```js
const mapForm = view(Inputs.form({
  mapping: Inputs.radio(Object.keys(mappings), {value: "spherical", label: "φ"}),
  shape: Inputs.radio(["sphere", "tall", "flat"], {value: "sphere", label: "object"}),
  azimuth: Inputs.range([-180, 180], {value: 30, step: 1, label: "view azimuth"}),
  elevation: Inputs.range([-80, 80], {value: 20, step: 1, label: "view elevation"})
}));
```

```js
// Orthographic ray casting against the ellipsoid (x/a)² + (y/b)² + (z/a)² = 1.
function castEllipsoid(size, {a, b, azimuth, elevation}, shadePoint) {
  const az = (azimuth * Math.PI) / 180, el = (elevation * Math.PI) / 180;
  const w = [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];   // toward the viewer
  const u = [Math.cos(az), 0, -Math.sin(az)];
  const v = [w[1] * u[2] - w[2] * u[1], w[2] * u[0] - w[0] * u[2], w[0] * u[1] - w[1] * u[0]];
  const ext = 1.25 * Math.max(a, b);
  return imageCanvas(size, size, (px, py) => {
    const s = ((px + 0.5) / size * 2 - 1) * ext, t = (1 - (py + 0.5) / size * 2) * ext;
    const o = [s * u[0] + t * v[0] + 5 * w[0], s * u[1] + t * v[1] + 5 * w[1], s * u[2] + t * v[2] + 5 * w[2]];
    const d = [-w[0], -w[1], -w[2]];
    // scale to the unit sphere, then solve the quadratic
    const O = [o[0] / a, o[1] / b, o[2] / a], D = [d[0] / a, d[1] / b, d[2] / a];
    const A = D[0] ** 2 + D[1] ** 2 + D[2] ** 2, B = O[0] * D[0] + O[1] * D[1] + O[2] * D[2], C = O[0] ** 2 + O[1] ** 2 + O[2] ** 2 - 1;
    const disc = B * B - A * C;
    if (disc < 0) return [245, 245, 245];
    const tHit = (-B - Math.sqrt(disc)) / A;
    const p = {x: o[0] + tHit * d[0], y: o[1] + tHit * d[1], z: o[2] + tHit * d[2]};
    let n = [p.x / (a * a), p.y / (b * b), p.z / (a * a)];
    const nl = Math.hypot(...n);
    n = n.map((c) => c / nl);
    const light = Math.max(0, n[0] * 0.4 + n[1] * 0.7 + n[2] * 0.6) * 0.65 + 0.35;
    return shadePoint(p).map((c) => c * light);
  });
}
const shapeSize = {sphere: [1, 1], tall: [0.55, 1.2], flat: [1.2, 0.5]};
```

```js
(() => {
  const [a, b] = shapeSize[mapForm.shape];
  const faceTint = [
    [1, 0.6, 0.6], [0.6, 1, 0.6], [0.6, 0.6, 1], [1, 1, 0.5], [0.5, 1, 1],
    [1, 0.5, 1]
  ];
  return castEllipsoid(260, {a, b, azimuth: mapForm.azimuth, elevation: mapForm.elevation}, (p) => {
    // normalize the point into the [-1, 1] box the formulas assume
    const q = {
      x: p.x / Math.max(a, b), y: p.y / Math.max(a, b),
      z: p.z / Math.max(a, b)
    };
    const [uu, vv, face] = mappings[mapForm.mapping](q);
    const c = textureLookup(gridTexture, uu, vv);
    return face === undefined ? c : c.map((x, k) => x * faceTint[face][k]);
  });
})()
```

- **Planar** works for nearly flat objects. On a closed object, the front
  and back get the same texels, and the texture smears where the surface
  turns parallel to the projection direction.
- **Spherical** covers the whole object with one seam, but the cells
  **pinch at the poles**. On the flat disk the area distortion is extreme.
- **Cylindrical** suits the tall vase: rows stay evenly spaced along the
  axis.
- **Cube map** keeps distortion low, at the cost of seams along all 12
  cube edges. Choosing a face takes a few comparisons, and projecting onto
  it takes one division.

### Interpolated texture coordinates

On a mesh, we store ${tex`(u,v)`} at each vertex and interpolate it
across each triangle. Interpolation must be **perspective-correct**.
Screen-space barycentric weights ${tex`\lambda_i`} are linear in the
image, not on the surface, so interpolate ${tex`u/w`} and ${tex`1/w`}
instead and divide:

${tex.block`u = \frac{\sum_i \lambda_i\, u_i / w_i}{\sum_i \lambda_i / w_i}`}

That formula fits in a small function. `lambda` holds the three screen-space weights,
and `values` and `w` hold one number per corner. With `correct` off, it is an ordinary
weighted average:

```js echo
function interpolate(lambda, values, w, correct) {
  const sum = (f) => d3.sum(lambda, (l, i) => l * f(i));
  if (!correct) return sum((i) => values[i]);
  return sum((i) => values[i] / w[i]) / sum((i) => 1 / w[i]);
}
```

Halfway across the screen between a near corner (${tex`w = 1`}) and a far corner
(${tex`w = 3`}), an affine lookup says ${tex`u = 0.5`}. Perspective-correct
interpolation says the point is much closer to the near corner on the surface, at
0.25:

```js echo
[
  interpolate([0.5, 0.5], [0, 1], [1, 3], false),
  interpolate([0.5, 0.5], [0, 1], [1, 3], true)
]
```

The small software rasterizer below draws a floor quad seen at an angle, once in each
mode, finding each pixel's weights exactly as in Module 09's barycentric coordinates:

```js
function rasterizeQuad(size, {perspectiveCorrect, tilt}) {
  const view = transforms.lookAt([0, 1.2 + tilt, -0.2], [0, 0, 3], [0, 1, 0]);
  const mvp = mat4.multiply(transforms.perspective(1.0, 1, 0.1, 20), view);
  const corners = [[-1.5, 0, 0.5, 0, 0], [1.5, 0, 0.5, 1, 0], [1.5, 0, 5, 1, 1], [-1.5, 0, 5, 0, 1]];
  const verts = corners.map(([x, y, z, u, v]) => {
    const c = mat4.transformPoint(mvp, [x, y, z]);
    return {sx: (c[0] / c[3] * 0.5 + 0.5) * size, sy: (1 - (c[1] / c[3] * 0.5 + 0.5)) * size, w: c[3], u, v};
  });
  const buffer = new Uint8ClampedArray(size * size * 3).fill(245);
  for (const [i0, i1, i2] of [[0, 1, 2], [0, 2, 3]]) {
    const tri = [verts[i0], verts[i1], verts[i2]], [a, b, c] = tri;
    const area = (b.sx - a.sx) * (c.sy - a.sy) - (c.sx - a.sx) * (b.sy - a.sy);
    const w = tri.map((p) => p.w), us = tri.map((p) => p.u), vs = tri.map((p) => p.v);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const px = x + 0.5, py = y + 0.5;
      const l0 = ((b.sx - px) * (c.sy - py) - (c.sx - px) * (b.sy - py)) / area;
      const l1 = ((c.sx - px) * (a.sy - py) - (a.sx - px) * (c.sy - py)) / area;
      const l2 = 1 - l0 - l1;
      if (l0 < 0 || l1 < 0 || l2 < 0) continue;
      const lambda = [l0, l1, l2];
      const u = interpolate(lambda, us, w, perspectiveCorrect), v = interpolate(lambda, vs, w, perspectiveCorrect);
      buffer.set(textureLookup(gridTexture, u, v), 3 * (y * size + x));
    }
  }
  return imageCanvas(size, size, (x, y) => buffer.subarray(3 * (y * size + x), 3 * (y * size + x) + 3));
}
```

```js
const tilt = view(Inputs.range([0, 2], {value: 0.4, step: 0.05, label: "camera height above the floor"}));
```

```js
raster.sideBySide([
  ["screen-space (affine) interpolation", rasterizeQuad(220, {perspectiveCorrect: false, tilt})],
  ["perspective-correct interpolation", rasterizeQuad(220, {perspectiveCorrect: true, tilt})]
])
```

The affine version bends the grid lines along the diagonal shared by the
two triangles, and the far rows are as tall as the near ones. The
perspective-correct version keeps straight lines straight. GPUs do this
division for every interpolated attribute automatically.

### Tiling and wrapping modes

A **wrapping mode** decides what a lookup outside ${tex`[0,1]^2`}
returns. The rule is applied to the **texel index**:

```js echo
const positiveModulo = (i, n) => ((i % n) + n) % n;
const wrapModes = {
  repeat: positiveModulo,
  "clamp-to-edge": (i, n) => Math.max(0, Math.min(n - 1, i)),
  "mirror-repeat": (i, n) => {
    const m = positiveModulo(i, 2 * n);
    return m < n ? m : 2 * n - 1 - m;
  }
};
```

Check them on a 4-texel row. Index 5 is one past the end of the second copy. Repeat
wraps it to 1, clamp stops at the last texel, 3, and mirror reflects it back to 2:

```js echo
Object.values(wrapModes).map((wrap) => wrap(5, 4))
```

A lookup applies the rule to both indices. Unlike `textureLookup`, it must not clamp
first:

```js echo
function lookupWrapped(t, u, v, mode) {
  const wrap = wrapModes[mode];
  const i = wrap(Math.floor(u * t.width), t.width);
  const j = wrap(Math.floor(v * t.height), t.height);
  return texel(t, i, j);
}
```

```js
const photo = (() => {
  const img = raster.toImageData(raster.createTestImage(64, 48));
  return makeTexture(64, 48, (i, j) => { const k = 4 * ((47 - j) * 64 + i); return [img.data[k], img.data[k + 1], img.data[k + 2]]; });
})();
```

```js
raster.sideBySide(Object.keys(wrapModes).map((mode) => [mode,
  imageCanvas(192, 144, (x, y) => {
    const u = -1 + 3 * (x + 0.5) / 192, v = -1 + 3 * (1 - (y + 0.5) / 144);   // u, v in [-1, 2]
    const c = lookupWrapped(photo, u, v, mode);
    const inside = u >= 0 && u <= 1 && v >= 0 && v <= 1;
    return inside ? c : Array.from(c, (x) => 0.75 * x + 30);
  })]))
```

The original image is the bright center tile. **Repeat** suits bricks and
tiles, **clamp** extends the edge texels (good for a logo on a plain
background), and **mirror-repeat** hides the jump at tile borders.

### Seams

For a closed surface, no continuous one-to-one map to the plane exists,
so **seams are unavoidable**. With interpolated coordinates, a triangle
that crosses the seam interpolates the **long way** around. The fix is to
**duplicate** the seam vertices: same 3D position, different
${tex`(u,v)`}. Below, a UV sphere is drawn with a checkerboard computed
from ${tex`(u,v)`} in the fragment shader. Turn off the duplicated seam
vertices to see the artifact:

```js echo
const uvVertexLayout = {
  arrayStride: 8 * 4,
  attributes: [
    {shaderLocation: 0, offset: 0, format: "float32x3"},
    {shaderLocation: 1, offset: 3 * 4, format: "float32x3"},
    {shaderLocation: 2, offset: 6 * 4, format: "float32x2"}
  ]
};
```

Each vertex now has a third attribute, the texture coordinate. The shader needs no
texture at all. It computes a checkerboard directly from the interpolated
${tex`(u,v)`}, by counting which cell the point falls in and checking whether that
count is odd:

```js echo
const wgslChecker = `
fn checkerParity(uv: vec2<f32>, density: f32) -> f32 {
  let cell = floor(uv.x * density * 2.0) + floor(uv.y * density);
  return cell - 2.0 * floor(cell / 2.0);
}`;
```

```js
const checkerModule = device.createShaderModule({code: `${wgslChecker}
struct Uniforms { mvp: mat4x4<f32>, params: vec4<f32> };
@group(0) @binding(0) var<uniform> u: Uniforms;
struct VertexOut {
  @builtin(position) position: vec4<f32>, @location(0) normal: vec3<f32>,
  @location(1) uv: vec2<f32>
};
@vertex
fn vs_main(@location(0) inPos: vec3<f32>, @location(1) inNormal: vec3<f32>, @location(2) inUV: vec2<f32>) -> VertexOut {
  return VertexOut(u.mvp * vec4<f32>(inPos, 1.0), inNormal, inUV);
}
@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  let base = mix(vec3<f32>(0.9, 0.75, 0.3), vec3<f32>(0.15, 0.25, 0.5), checkerParity(in.uv, u.params.x));
  let ndotl = max(dot(normalize(in.normal), normalize(vec3<f32>(0.4, 0.8, 0.5))), 0.0);
  return vec4<f32>(base * (0.35 + 0.65 * ndotl), 1.0);
}`});
const checkerPipeline = device.createRenderPipeline({
  layout: "auto",
  vertex: {module: checkerModule, entryPoint: "vs_main", buffers: [uvVertexLayout]},
  fragment: {module: checkerModule, entryPoint: "fs_main", targets: [{format: canvasFormat}]},
  primitive: {topology: "triangle-list", cullMode: "back"},
  depthStencil: {format: "depth24plus", depthWriteEnabled: true, depthCompare: "less"}
});
```

`createSphere` duplicates the vertices along the seam, one copy at ${tex`u = 0`} and
one at ${tex`u = 1`}, by listing longitude columns 0 through 32. Each row therefore has 33
vertices, and index `i` is in the last column when `i % 33 === 32`:

```js echo
const uvSphere = geometry.createSphere(24, 32);
const uvSphereVB = createBuffer(
  device,
  geometry.interleave(uvSphere.positions, uvSphere.normals, uvSphere.uvs),
  GPUBufferUsage.VERTEX
);
const uvSphereIB =
  createBuffer(device, uvSphere.indices, GPUBufferUsage.INDEX);
```

To see why the duplicates matter, a second index buffer redirects the last column to the
first column's vertices. It has the same triangles, with ${tex`u = 0`} where
${tex`u = 1`} should be:

```js echo
const sharedSeamIndices =
  uvSphere.indices.map((i) => (i % 33 === 32 ? i - 32 : i));
const sharedSeamIB =
  createBuffer(device, sharedSeamIndices, GPUBufferUsage.INDEX);
```

```js
const checkerUniforms = device.createBuffer({size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
const checkerBindGroup = device.createBindGroup({layout: checkerPipeline.getBindGroupLayout(0), entries: [{binding: 0, resource: {buffer: checkerUniforms}}]});
const checkerTarget = await makeCanvas(300);
```

```js
const seamForm = view(Inputs.form({
  duplicated: Inputs.toggle({value: true, label: "duplicate seam vertices"}),
  density: Inputs.range([2, 16], {value: 8, step: 1, label: "checker density"}),
  azimuth: Inputs.range([-180, 180], {value: -90, step: 1, label: "orbit azimuth"}),
  elevation: Inputs.range([-80, 80], {value: 15, step: 1, label: "orbit elevation"})
}));
```

The toggle chooses which index buffer the draw uses, and nothing else changes:

```js echo
function drawUVSphere(pass) {
  pass.setPipeline(checkerPipeline);
  pass.setBindGroup(0, checkerBindGroup);
  pass.setVertexBuffer(0, uvSphereVB);
  const indexBuffer = seamForm.duplicated ? uvSphereIB : sharedSeamIB;
  pass.setIndexBuffer(indexBuffer, "uint16");
  pass.drawIndexed(uvSphere.indices.length);
}
```

```js
{
  const mvp = mat4.multiply(
    transforms.perspective(0.73, 1, 0.1, 20),
    transforms.lookAt(orbitEye(seamForm.azimuth, seamForm.elevation, 3.2), [0, 0, 0], [0, 1, 0])
  );
  device.queue.writeBuffer(checkerUniforms, 0, new Float32Array([...mvp, seamForm.density, 0, 0, 0]));
  renderPass(checkerTarget, drawUVSphere);
}
```

```js
checkerTarget.canvas
```

With shared seam vertices, the last column of triangles interpolates
${tex`u`} from about 0.97 **back to 0**, squeezing a backward copy of
the whole checkerboard into one thin strip. Orbit toward a pole as well:
the cells pinch, which is the spherical mapping's area distortion.

## Antialiasing Texture Lookups

Rendering a textured surface samples a 2D signal at the pixels, so the
lessons of Module 06 apply. **Magnification** (a footprint smaller than a
texel) needs interpolation. **Minification** (a footprint covering many
texels) needs averaging.

### Bilinear reconstruction

When magnifying, blend the **four nearest texels** with weights given by
the distances to their centers. This is the reading's
`tex_sample_bilinear`, with clamping at the edges:

First, find the texel coordinates. `up` is the position measured in texels, shifted so
that a texel center is at a whole number. The two neighbors are the integers around it,
and the weights say how close each one is:

```js echo
function bilinearWeights(position) {
  const i0 = Math.floor(position);
  const a = i0 + 1 - position;   // weight of i0
  return {i0, i1: i0 + 1, a, b: 1 - a};
}
```

A point exactly halfway between two texel centers should weigh them equally:

```js echo
bilinearWeights(2.5)
```

The sample blends all four combinations, per channel:

```js echo
function sampleBilinear(t, u, v) {
  const U = bilinearWeights(u * t.width - 0.5);
  const V = bilinearWeights(v * t.height - 0.5);
  const T = (i, j) =>
    texel(t, clampIndex(i, t.width), clampIndex(j, t.height));
  return [0, 1, 2].map((k) =>
    U.a * V.a * T(U.i0, V.i0)[k] + U.a * V.b * T(U.i0, V.i1)[k]
    + U.b * V.a * T(U.i1, V.i0)[k] + U.b * V.b * T(U.i1, V.i1)[k]);
}
```

At the very center of a 2 × 2 texture, it should average all four texels. With red values
0, 1, 2, and 3, that is 1.5:

```js echo
sampleBilinear(makeTexture(2, 2, (i, j) => [j * 2 + i, 0, 0]), 0.5, 0.5)
```

```js
const tiny = makeTexture(
  8, 8,
  (i, j) => d3.rgb(
    d3.interpolateViridis(((i * 3 + j * 5) % 8) / 7)
  ).toString().match(/\d+/g).map(Number)
);
```

```js
raster.sideBySide([
  ["8 × 8 texture, nearest", imageCanvas(200, 200, (x, y) => textureLookup(tiny, (x + 0.5) / 200, 1 - (y + 0.5) / 200))],
  ["8 × 8 texture, bilinear", imageCanvas(200, 200, (x, y) => sampleBilinear(tiny, (x + 0.5) / 200, 1 - (y + 0.5) / 200))]
])
```

Lookups land at irregular points, so the filter cannot be applied
separably as in Module 06, and a larger filter would be expensive.
That is why GPUs use bilinear filtering in dedicated hardware.

### The pixel footprint

A pixel's **footprint** is the region of the texture it covers, under
${tex`\psi = \phi\circ\pi^{-1}`}. Linearizing ${tex`\psi`} gives the
Jacobian ${tex`J`}, whose columns ${tex`\mathbf u_x = (\partial u/\partial x, \partial v/\partial x)`}
and ${tex`\mathbf u_y`} span a parallelogram that approximates the
footprint. A mipmap level is then chosen by

${tex.block`D = \max\{\lVert\mathbf u_x\rVert, \lVert\mathbf u_y\rVert\}\ \text{(in texels)}, \qquad k = \log_2 D`}

Given the texture coordinates, in texels, at a pixel and its two neighbors, the rest is
a few lines. The finite differences are the columns of ${tex`J`}:

```js echo
function mipLevel(at, right, down) {
  const ux = Math.hypot(right[0] - at[0], right[1] - at[1]);
  const uy = Math.hypot(down[0] - at[0], down[1] - at[1]);
  return Math.log2(Math.max(ux, uy));
}
```

If one pixel step moves 8 texels in one direction and 2 in the other, the footprint's
longer side is 8 texels, so ${tex`k = \log_2 8 = 3`}:

```js echo
mipLevel([0, 0], [8, 0], [0, 2])
```

For a floor plane seen from a camera, we can compute ${tex`(u,v)`} at every pixel by ray
casting, which gives those three inputs everywhere in the image:

```js
const footprintForm = view(Inputs.form({
  height: Inputs.range([0.3, 3], {value: 1.1, step: 0.05, label: "camera height"}),
  texSize: Inputs.select([64, 256, 1024], {value: 256, label: "texture size (texels)"}),
  show: Inputs.radio(["mip level k", "anisotropy ‖long‖/‖short‖"], {value: "mip level k", label: "show"})
}));
```

```js
const footprint = (() => {
  const size = 180, eye = [0, footprintForm.height, -2.4];
  const target = [0, 0, 9];
  const fwd = target.map((c, i) => c - eye[i]), fl = Math.hypot(...fwd); fwd.forEach((_, i) => (fwd[i] /= fl));
  const right = [fwd[2], 0, -fwd[0]], rl = Math.hypot(...right); right.forEach((_, i) => (right[i] /= rl));
  const up = [fwd[1] * right[2] - fwd[2] * right[1], fwd[2] * right[0] - fwd[0] * right[2], fwd[0] * right[1] - fwd[1] * right[0]];   // fwd × right
  const f = 1 / Math.tan(0.87 / 2);
  const uvAt = (px, py) => {                       // (u, v) on the floor y = 0, in texels; one texture repeat per 4 world units
    const sx = (px / size) * 2 - 1, sy = 1 - (py / size) * 2;
    const d = [0, 1, 2].map((k) => f * fwd[k] + sx * right[k] + sy * up[k]);
    if (d[1] >= -1e-6) return null;
    const t = -eye[1] / d[1];
    return [(eye[0] + t * d[0]) * 0.25 * footprintForm.texSize, (eye[2] + t * d[2]) * 0.25 * footprintForm.texSize];
  };
  const k = new Float32Array(size * size).fill(NaN), aniso = new Float32Array(size * size).fill(NaN);
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const p = uvAt(px + 0.5, py + 0.5), px1 = uvAt(px + 1.5, py + 0.5), py1 = uvAt(px + 0.5, py + 1.5);
    if (!p || !px1 || !py1) continue;
    const ux = Math.hypot(px1[0] - p[0], px1[1] - p[1]), uy = Math.hypot(py1[0] - p[0], py1[1] - p[1]);
    k[py * size + px] = mipLevel(p, px1, py1);
    aniso[py * size + px] = Math.max(ux, uy) / Math.min(ux, uy);
  }
  return {size, k, aniso};
})();
```

```js
(() => {
  const {size, k, aniso} = footprint;
  const showK = footprintForm.show === "mip level k";
  const color = showK ? d3.scaleSequential(
    d3.interpolateTurbo
  ).domain([-2, 8]) : d3.scaleSequential(d3.interpolateMagma).domain([1, 12]);
  const canvas = imageCanvas(size, size, (x, y) => {
    const val = (showK ? k : aniso)[y * size + x];
    if (Number.isNaN(val)) return [235, 240, 248];
    const c = d3.rgb(color(val));
    return [c.r, c.g, c.b];
  }, 1.6);
  const finite = Array.from(showK ? k : aniso).filter(Number.isFinite);
  return html`<div style="display:flex; gap:16px; align-items:flex-start">${canvas}<div style="font:13px var(--sans-serif)">
    ${
      Plot.legend(
        {color: {type: "sequential", scheme: showK ? "turbo" : "magma", domain: showK ? [-2, 8] : [1, 12], label: footprintForm.show}}
      )
    }
    <p>range on screen: ${d3.min(finite).toFixed(2)} to ${d3.max(finite).toFixed(2)}</p></div></div>`;
})()
```

Near the bottom of the image the footprint is smaller than a texel
(${tex`k < 0`}: magnification, use level 0 with bilinear filtering).
Toward the horizon ${tex`k`} grows, and coarser levels are needed.
Switch to **anisotropy**: far away, the footprint becomes long and thin,
which a square mipmap texel cannot match. A bigger texture shifts every
${tex`k`} up by ${tex`\log_2`} of the size ratio.

### Mipmaps

A **mipmap** stores the texture at a series of lower resolutions. Each
level averages ${tex`2\times2`} texels of the level below:

```js echo
function averageBlock(p, i, j) {
  const j1 = Math.min(p.height - 1, 2 * j + 1), i0 = 2 * i, j0 = 2 * j;
  const corners = [[i0, j0], [i0 + 1, j0], [i0, j1], [i0 + 1, j1]];
  return [0, 1, 2].map((c) =>
    d3.mean(corners, ([a, b]) => texel(p, a, b)[c]));
}
```

Each new level halves the size and averages the blocks of the one before, until a single
texel remains:

```js echo
function buildMipmap(t) {
  const levels = [t];
  while (levels.at(-1).width > 1) {
    const p = levels.at(-1);
    const w = p.width >> 1, h = Math.max(1, p.height >> 1);
    levels.push(makeTexture(w, h, (i, j) => averageBlock(p, i, j)));
  }
  return levels;
}
```

Here it is on a checker with squares 4 texels wide:

```js echo
const checker = makeTexture(64, 64, (i, j) =>
  (((i >> 2) + (j >> 2)) % 2 ? [40, 50, 90] : [240, 220, 160]));
const checkerMips = buildMipmap(checker);
```

```js
raster.sideBySide(checkerMips.map((lv, k) => [`level ${k}: ${lv.width}×${lv.height}`,
  imageCanvas(lv.width, lv.height, (x, y) => texel(lv, x, lv.height - 1 - y), Math.max(1, 64 / lv.width) * (k === 0 ? 1.5 : 1))]))
```

Total storage: ${d3.sum(checkerMips, (l) => l.width * l.height)} texels
vs. ${64 * 64} for level 0 alone, a factor of
${(d3.sum(checkerMips, (l) => l.width * l.height) / 4096).toFixed(3)}, close
to ${tex`1 + \tfrac14 + \tfrac1{16} + \cdots = \tfrac43`}. The 4-texel
checker squares survive to level 2, then average to a uniform color. That
gray is exactly what a pixel covering many squares *should* show.

**Trilinear** filtering samples levels ${tex`\lfloor k\rfloor`} and
${tex`\lfloor k\rfloor+1`} bilinearly and blends them by the fractional
part of ${tex`k`}:

```js echo
function sampleTrilinear(mips, u, v, D) {
  const last = mips.length - 1;
  const k = Math.max(0, Math.min(last, Math.log2(Math.max(D, 1e-6))));
  const k0 = Math.floor(k), k1 = Math.min(last, k0 + 1), f = k - k0;
  const c0 = sampleBilinear(mips[k0], u, v);
  const c1 = sampleBilinear(mips[k1], u, v);
  return c0.map((c, i) => (1 - f) * c + f * c1[i]);
}
```

With a footprint of 64 texels or more, the sample comes entirely from the last level, the
average of the whole checker. The two colors cover equal areas, so its red should be
${tex`(40 + 240)/2 = 140`}:

```js echo
sampleTrilinear(checkerMips, 0.3, 0.7, 64)
```

The WebGPU section below runs the same comparison on the GPU: point
sampling, trilinear, and **anisotropic** filtering on a receding floor,
plus a texture whose mip levels are painted different colors so that you
can *see* which level each pixel uses.

## Applications of Texture Mapping

### Controlling shading parameters

Any parameter of the shading model can come from a texture: diffuse
color, specular reflectance, roughness. Maps are often **correlated**, and
single-channel maps are commonly **packed** into the channels of one
image. glTF's **ORM** texture stores occlusion in red, roughness in green,
and metallic in blue:

```js
const ormData = new ImageData(64, 64);
for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
  const i = (y * 64 + x) * 4, u = x / 64, v = y / 64;
  ormData.data[i] = 255 * Math.max(0, 1 - 1.6 * Math.hypot(u - 0.5, v - 0.5));    // occlusion
  ormData.data[i + 1] = 255 * u;                                                   // roughness
  ormData.data[i + 2] = Math.floor(u * 8) % 2 === 0 && Math.floor(v * 8) % 2 === 0 ? 255 : 0;   // metallic rivets
  ormData.data[i + 3] = 255;
}
const isolateChannel = (imageData, channel) => raster.mapPixels(imageData, (r, g, b) => { const c = [r, g, b][channel]; return [c, c, c, 255]; });
```

```js
raster.sideBySide([
  ["packed ORM", raster.renderImageData(ormData, {scale: 3})],
  ["R: occlusion", raster.renderImageData(isolateChannel(ormData, 0), {scale: 3})],
  ["G: roughness", raster.renderImageData(isolateChannel(ormData, 1), {scale: 3})],
  ["B: metallic", raster.renderImageData(isolateChannel(ormData, 2), {scale: 3})]
])
```

Color maps are stored **sRGB** encoded. Data maps (normal, roughness,
metallic) must be read as **linear** values, or an sRGB decode distorts
them.

### Bump maps → normal maps

A **bump map** is a height field ${tex`h(u,v)`}. In the tangent frame,
the normal of the bumpy surface comes from the height's **derivatives**:

${tex.block`\mathbf n_{\text{tangent}} \propto \left(-\frac{\partial h}{\partial u},\ -\frac{\partial h}{\partial v},\ 1\right), \qquad \text{color} = \tfrac12(\mathbf n + 1)`}

```js
const bumpForm = view(Inputs.form({
  pattern: Inputs.radio(["planks", "rivets", "noise"], {value: "rivets", label: "height field"}),
  strength: Inputs.range([0.5, 8], {value: 3, step: 0.5, label: "bump strength"})
}));
```

The normal comes from central differences of the height. The factor `0.05` only scales
these heights to a pleasant slope:

```js echo
function normalFromHeight(h, u, v, strength, e = 1 / 256) {
  const dhdu = (h(u + e, v) - h(u - e, v)) / (2 * e);
  const dhdv = (h(u, v + e) - h(u, v - e)) / (2 * e);
  const n = [-strength * dhdu * 0.05, -strength * dhdv * 0.05, 1];
  const l = Math.hypot(...n);
  return n.map((c) => c / l);
}
```

On flat ground, every difference is 0, so the normal should be straight up in tangent
space, (0, 0, 1):

```js echo
normalFromHeight(() => 0.5, 0.3, 0.3, 3)
```

A rising slope should tilt the normal back against the slope, giving a negative
${tex`x`}:

```js echo
normalFromHeight((u, v) => u, 0.3, 0.3, 3)
```

The patterns below are three height fields, each just a function of ${tex`(u, v)`}:

```js
const bumpHeight = {
  planks: (u, v) => {
    const l = (v * 6) % 1;
    return Math.max(0, 0.4 - Math.min(l, 1 - l) * 4);
  },
  rivets: (u, v) => {
    const du = (u * 4) % 1 - 0.5, dv = (v * 4) % 1 - 0.5;
    return Math.max(0, 0.18 - (du * du + dv * dv));
  },
  noise: (u, v) => 0.2 * perlinNoise(u * 6, v * 6, 0.5)
}[bumpForm.pattern];
```

```js
raster.sideBySide([
  ["height h(u, v)", imageCanvas(128, 128, (x, y) => { const g = 255 * Math.min(1, bumpHeight(x / 128, 1 - y / 128) * 3); return [g, g, g]; }, 1.5)],
  ["tangent-space normal map", imageCanvas(128, 128, (x, y) => normalFromHeight(bumpHeight, x / 128, 1 - y / 128, bumpForm.strength).map((c) => 255 * (c * 0.5 + 0.5)), 1.5)],
  ["lit with that normal", imageCanvas(128, 128, (x, y) => {
    const n = normalFromHeight(bumpHeight, x / 128, 1 - y / 128, bumpForm.strength);
    const g = 255 * Math.max(0, n[0] * -0.5 + n[1] * 0.4 + n[2] * 0.77);
    return [g * 0.85, g * 0.7, g * 0.55];
  }, 1.5)]
])
```

Flat areas are the neutral light blue ${tex`(0.5, 0.5, 1)`}, the
encoding of ${tex`(0,0,1)`}. The lit image is a perfectly flat square:
only the normals change. Silhouettes stay smooth and there is no
parallax, which is the difference from a **displacement map**, which
actually moves vertices. The WebGPU section applies a normal map to a
mesh.

### Shadow maps and environment maps

- **Shadow maps:** a point is lit if and only if the light can see it.
  Render depth **from the light** into a texture, then, for each fragment,
  compare its distance to the light with the stored depth, using a
  **bias** ${tex`\epsilon`} and averaging several 0/1 tests (**PCF**).
- **Environment maps:** light from far away depends only on direction,
  so store it as a texture over directions, usually a **cube map**, and
  look it up with the reflected view direction
  ${tex`\mathbf r = \mathbf v - 2(\mathbf v\cdot\mathbf n)\mathbf n`},
  where ${tex`\mathbf v`} points from the eye toward the surface.
  The two common layouts are **latitude–longitude** (one image; it wastes
  resolution near the poles, where a whole row of texels maps to a single
  point) and the **cube map** (six square faces with nearly uniform
  sampling, the usual choice in interactive programs).

In a ray tracer, an environment map is simply the background: when a ray
misses every object, the ray's direction is converted to texture
coordinates and looked up.

```js run=false
function traceRay(ray, scene) {
  const hit = scene.intersect(ray);
  if (hit) return hit.shade(ray);
  // miss: show the environment
  return textureLookup(scene.envMap, directionToUV(ray.direction));
}
```

In a rasterizer, the same lookup adds a **mirror term** to ordinary
shading. With ${tex`\mathbf v`} pointing from the eye toward the surface
(the convention of `reflect`) and a mirror coefficient ${tex`k_m`}:

${tex.block`L = L_\text{diffuse} + L_\text{specular} + k_m\,\text{env}\big(\text{reflect}(\mathbf v, \mathbf n)\big)`}

The surface then shows a mirror image of the environment, but **not** of
other objects in the scene. Going further, **environment lighting** takes
*all* of a surface's illumination from the map, by integrating it over
the hemisphere (Monte Carlo sampling) or by approximating it with many
shadow-mapped lights.

Both are built with WebGPU at the end of this page.

## Procedural 3D Textures

### Stripes

A **solid texture** defines color at every point in 3D, so there is no
mapping, no distortion, and no seam. The simplest examples are stripes:

```js echo
const c0 = [37, 99, 170], c1 = [245, 225, 180];
```

The sign of ${tex`\sin x`} alternates, which gives hard stripes. Dividing by a width
${tex`w`} makes each stripe ${tex`w`} wide. Replacing the sign test with a blend, by a
factor ${tex`t`} that swings between 0 and 1, softens the edges:

```js echo
const stripes = {
  "sin(x) > 0": (p, w) => (Math.sin(p.x) > 0 ? c0 : c1),
  "width w": (p, w) => (Math.sin(Math.PI * p.x / w) > 0 ? c0 : c1),
  "smooth": (p, w) => {
    const t = (1 + Math.sin(Math.PI * p.x / w)) / 2;
    return c0.map((c, k) => (1 - t) * c + t * c1[k]);
  }
};
```

```js
const stripeWidth = view(
  Inputs.range([0.1, 2], {value: 0.5, step: 0.05, label: "stripe width w"})
);
```

```js
raster.sideBySide(Object.entries(stripes).map(([name, f]) => [name, imageCanvas(150, 90, (x) => f({x: x / 150 * 6, y: 0, z: 0}, stripeWidth))]))
```

### Perlin solid noise

**Perlin noise** is smooth but random. As defined in the reading, it sums
eight lattice terms, each a smooth cubic weight times the dot product of
a random unit **gradient** ${tex`\Gamma_{ijk}`} with the offset to that
lattice point:

${tex.block`n(x,y,z) = \sum_{i,j,k} \omega(x-i)\,\omega(y-j)\,\omega(z-k)\;\Gamma_{ijk}\cdot(x-i,\,y-j,\,z-k), \qquad \omega(t) = 2|t|^3 - 3|t|^2 + 1`}

The gradients come from a table of 256 random unit vectors chosen by
**rejection sampling** in the unit sphere, indexed through a random
permutation ${tex`P`}:

```js echo
const perlinTables = (() => {
  const rand = d3.randomLcg(7);
  const P = d3.shuffle(d3.range(256), rand);
  const G = [];
  while (G.length < 256) {
    const v = [2 * rand() - 1, 2 * rand() - 1, 2 * rand() - 1];
    const l2 = v[0] ** 2 + v[1] ** 2 + v[2] ** 2;
    if (l2 > 0 && l2 < 1) G.push(v.map((c) => c / Math.sqrt(l2)));
  }
  return {P, G};
})();
```

Nesting the permutation hashes a lattice point to a table index. `omega` is the smooth
weight from the formula. It equals 1 at the point itself and fades to 0 at distance 1:

```js echo
const phiIndex = (i) => perlinTables.P[((i % 256) + 256) % 256];
const gradientAt = (i, j, k) =>
  perlinTables.G[phiIndex(i + phiIndex(j + phiIndex(k)))];
const omega = (t) =>
  Math.abs(t) < 1 ? 2 * Math.abs(t) ** 3 - 3 * t * t + 1 : 0;
```

The noise visits the eight corners of the point's lattice cell and adds up the terms:

```js echo
function perlinNoise(x, y, z) {
  const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
  return d3.sum([0, 1], (a) => d3.sum([0, 1], (b) => d3.sum([0, 1], (c) => {
    const g = gradientAt(fx + a, fy + b, fz + c);
    const u = x - fx - a, v = y - fy - b, w = z - fz - c;
    return omega(u) * omega(v) * omega(w) * (g[0] * u + g[1] * v + g[2] * w);
  })));
}
```

At a lattice point, the offset to that corner is zero and the other corners have zero
weight, so the noise should be exactly 0 there, while a nearby point should not be:

```js echo
[perlinNoise(3, 5, 2), perlinNoise(3.5, 5.5, 2.5)]
```

**Turbulence** sums ${tex`|n|`} over octaves, each half the size and half the weight:

```js echo
function turbulence(x, y, z, octaves = 6) {
  return d3.sum(d3.range(octaves), (i) =>
    Math.abs(perlinNoise(2 ** i * x, 2 ** i * y, 2 ** i * z)) / 2 ** i);
}
```

```js
const noiseForm = view(Inputs.form({
  scale: Inputs.range([1, 12], {value: 4, step: 0.5, label: "frequency"}),
  octaves: Inputs.range([1, 8], {value: 6, step: 1, label: "turbulence octaves"}),
  k2: Inputs.range([0, 8], {value: 3, step: 0.25, label: "turbulence in the stripes"})
}));
```

```js
(() => {
  const s = noiseForm.scale, N = 140;
  const at = (x, y) => [x / N * s, (1 - y / N) * s];
  return raster.sideBySide([
    ["|n|", imageCanvas(N, N, (x, y) => { const [a, b] = at(x, y); const g = 255 * Math.min(1, 2.2 * Math.abs(perlinNoise(a, b, 0.5))); return [255 - g, 255 - g, 255 - g]; })],
    ["(n + 1) / 2", imageCanvas(N, N, (x, y) => { const [a, b] = at(x, y); const g = 255 * Math.min(1, Math.max(0, (1.6 * perlinNoise(a, b, 0.5) + 1) / 2)); return [g, g, g]; })],
    ["turbulence", imageCanvas(N, N, (x, y) => { const [a, b] = at(x, y); const t = Math.min(1, 1.6 * turbulence(a, b, 0.5, noiseForm.octaves)); return [250 - 213 * t, 248 - 149 * t, 240 - 70 * t]; })],
    ["turbulent stripes", imageCanvas(N, N, (x, y) => {
      const [a, b] = at(x, y);
      const t = (1 + Math.sin(3 * a + noiseForm.k2 * turbulence(a, b, 0.5, noiseForm.octaves))) / 2;
      return [245 - 155 * t, 235 - 165 * t, 220 - 160 * t];
    })]
  ]);
})()
```

Because the function is defined in 3D, the same marble can be **carved**
into any object. The sphere renderer from the start of the page samples
the solid texture at each hit point, with no texture coordinates at all:

```js
const solidForm = view(Inputs.form({
  shape: Inputs.radio(["sphere", "tall", "flat"], {value: "tall", label: "object"}),
  azimuth: Inputs.range([-180, 180], {value: 20, step: 1, label: "view azimuth"})
}));
```

```js
(() => {
  const [a, b] = shapeSize[solidForm.shape];
  return castEllipsoid(240, {a, b, azimuth: solidForm.azimuth, elevation: 15}, (p) => {
    const t = (
      1 + Math.sin(
        3 * p.z * noiseForm.scale / 2 + noiseForm.k2 * turbulence(p.x * 2, p.y * 2, p.z * 2, 5)
      )
    ) / 2;
    return [245 - 140 * t, 238 - 150 * t, 230 - 150 * t];
  });
})()
```

The veins continue smoothly around the object, and changing its shape
does not stretch them.

## Textures in WebGPU

### Creating a texture with mipmaps

A texture is a `GPUTexture` with a format, a size, and a number of mip
levels. Every color texture on this page uses `rgba8unorm`: four 8-bit
channels, read in the shader as values from 0 to 1. WebGPU has **no
built-in mipmap generator**: `mipmaps.generateMipCanvases` builds the levels on the CPU by repeatedly
halving a canvas, and `mipmaps.textureFromMipCanvases` copies each level
in with `copyExternalImageToTexture`. (Production code fills levels with
a short render pass per level that averages the level below.)

The textures on this page are drawn on a Canvas 2D canvas before they are
uploaded. To learn how to draw your own, including bricks, wood, noise,
seamless tiling, and texture arrays, see the
[Making Textures with Canvas 2D](/tutorial-canvas2d-textures) tutorial.

```js
function makeCheckerCanvas(size, cells) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) {
    ctx.fillStyle = (x + y) % 2 === 0 ? "#f2ede3" : "#3a3229";
    ctx.fillRect(x * size / cells, y * size / cells, size / cells, size / cells);
  }
  return canvas;
}
const floorTexture = mipmaps.textureFromMipCanvases(device, mipmaps.generateMipCanvases(makeCheckerCanvas(256, 16)), {label: "floor checker"});

// A texture whose mip levels are painted solid, different colors, to make level selection visible.
const levelColors = [[255, 255, 255], [230, 60, 60], [240, 160, 40], [240, 230, 60], [80, 200, 90], [60, 170, 220], [70, 90, 220], [150, 80, 200], [40, 40, 40]];
const levelTexture = (() => {
  const texture = device.createTexture({size: [256, 256], format: "rgba8unorm", mipLevelCount: 9,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST});
  for (let level = 0; level < 9; level++) {
    const s = 256 >> level, data = new Uint8Array(s * s * 4);
    for (let i = 0; i < s * s; i++) data.set([...levelColors[level], 255], 4 * i);
    device.queue.writeTexture({texture, mipLevel: level}, data, {bytesPerRow: s * 4}, [s, s]);
  }
  return texture;
})();
```

### Samplers: filtering in hardware

A `GPUSampler` holds the filtering and wrapping choices from this
module:

| Concept | Sampler setting |
|---|---|
| nearest vs. bilinear | `magFilter`, `minFilter`: `"nearest"` or `"linear"` |
| nearest level vs. trilinear | `mipmapFilter`: `"nearest"` or `"linear"` |
| anisotropic | `maxAnisotropy` up to 16 (all three filters must be `"linear"`) |
| wrapping | `addressModeU/V`: `"repeat"`, `"clamp-to-edge"`, `"mirror-repeat"` |

The same floor (repeating the checker 6 × 16 times) is drawn with four
samplers, plus the level-colored texture:

Two triangles form the floor quad. Each vertex is a position and a texture coordinate,
five floats. The coordinates run up to 6 and 16, far outside ${tex`[0,1]`}, which is what
makes the wrap mode matter:

```js echo
const floorVB = createBuffer(device, new Float32Array([
  -4, 0, 0.5, 0, 0,   4, 0, 0.5, 6, 0,   4, 0, 14, 6, 16,
  -4, 0, 0.5, 0, 0,   4, 0, 14, 6, 16,  -4, 0, 14, 0, 16
]), GPUBufferUsage.VERTEX);
```

The fragment shader is the smallest possible textured shader. The texture and the sampler
are separate bindings, and `textureSample` combines them. The GPU estimates the footprint
from the screen-space derivatives of `uv`, so all of the filtering above happens inside
this one call:

```js echo
const wgslFloorFragment = `
@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  return textureSample(tex, samp, uv);
}`;
```

```js
const floorModule = device.createShaderModule({code: `${wgslFloorFragment}
@group(0) @binding(0) var<uniform> mvp: mat4x4<f32>;
struct VertexOut { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex
fn vs_main(@location(0) inPos: vec3<f32>, @location(1) inUV: vec2<f32>) -> VertexOut {
  return VertexOut(mvp * vec4<f32>(inPos, 1.0), inUV);
}`});
const floorPipeline = device.createRenderPipeline({
  layout: "auto",
  vertex: {module: floorModule, entryPoint: "vs_main", buffers: [{arrayStride: 20, attributes: [
    {shaderLocation: 0, offset: 0, format: "float32x3"}, {shaderLocation: 1, offset: 12, format: "float32x2"}]}]},
  fragment: {module: floorModule, entryPoint: "fs_main", targets: [{format: canvasFormat}]},
  primitive: {topology: "triangle-list"},
  depthStencil: {format: "depth24plus", depthWriteEnabled: true, depthCompare: "less"}
});
const floorMVPBuffer = device.createBuffer({size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
```

Everything that varies between the demos lives in the **sampler**. So comparing the filters
needs no change to the shader or the pipeline, only these settings. Clamping `lodMaxClamp`
to 0 forbids every mip level but the first:

```js echo
const repeat = {addressModeU: "repeat", addressModeV: "repeat"};
const nearestNoMips = {
  magFilter: "nearest", minFilter: "nearest", mipmapFilter: "nearest",
  lodMaxClamp: 0, ...repeat
};
const bilinearNoMips = {
  magFilter: "linear", minFilter: "linear", lodMaxClamp: 0, ...repeat
};
```

Trilinear adds linear blending between levels, and anisotropic adds one more setting:

```js echo
const trilinear = {
  magFilter: "linear", minFilter: "linear", mipmapFilter: "linear", ...repeat
};
const anisotropic = {...trilinear, maxAnisotropy: 16};
```

```js
const floorVariants = await Promise.all([
  ["point sampling, level 0 only", floorTexture, nearestNoMips],
  ["bilinear, no mipmaps", floorTexture, bilinearNoMips],
  ["trilinear", floorTexture, trilinear],
  ["trilinear + anisotropic (16×)", floorTexture, anisotropic],
  ["which level? (trilinear)", levelTexture, trilinear],
  ["which level? (anisotropic)", levelTexture, anisotropic]
].map(async ([label, texture, samplerDesc]) => ({
  label, target: await makeCanvas(240),
  bindGroup: device.createBindGroup({layout: floorPipeline.getBindGroupLayout(0), entries: [
    {binding: 0, resource: {buffer: floorMVPBuffer}}, {binding: 1, resource: texture.createView()},
    {binding: 2, resource: device.createSampler(samplerDesc)}]})
})));
```

```js
const floorHeight = view(Inputs.range([0.2, 3], {value: 1.1, step: 0.05, label: "camera height"}));
```

```js
{
  device.queue.writeBuffer(
    floorMVPBuffer, 0,
    mat4.multiply(
      transforms.perspective(0.87, 1, 0.1, 30),
      transforms.lookAt([0, floorHeight, -2.4], [0, 0, 9], [0, 1, 0])
    )
  );
  for (const {target, bindGroup} of floorVariants) {
    renderPass(
      target,
      (pass) => {
        pass.setPipeline(floorPipeline);
        pass.setBindGroup(0, bindGroup);
        pass.setVertexBuffer(0, floorVB);
        pass.draw(6);
      }
    );
  }
}
```

```js
raster.sideBySide(floorVariants.map(({label, target}) => [label, target.canvas]))
```

- **Point sampling** shimmers into moiré near the horizon, and bilinear
  filtering without mipmaps barely helps: both are undersampling.
- **Trilinear** removes the aliasing but blurs the far rows, because it
  picks the level from the footprint's **long** axis.
- **Anisotropic** filtering keeps the far rows sharper by averaging
  several samples along the long axis, at a finer level.
- The level-colored floors show the selection directly: white is level 0
  and each color is one level coarser. With anisotropic filtering, the
  colors move toward the horizon, because finer levels are used. Compare
  them with the ${tex`k`} map from the footprint section.

### Loading textured models: OBJ + MTL

Real models come from files. **OBJ** is the simplest common mesh format,
and it is plain text. Each line starts with a **tag**:

| Tag | Meaning | Example |
|---|---|---|
| `v` | a vertex position | `v 1 1.2 -1` |
| `vt` | a texture coordinate ${tex`(u, v)`} | `vt 0.5 1` |
| `vn` | a normal | `vn 0 0.7071 -0.7071` |
| `f` | a face: one `p/t/n` reference per corner | `f 1/2/2 2/1/2 6/4/2 5/3/2` |
| `mtllib` | the file that holds the materials | `mtllib hut.mtl` |
| `usemtl` | the material for the faces that follow | `usemtl Walls` |

Three details matter when loading it:

- Indices are **1-based**: `f 1/1/1 ...` means the *first* position,
  texture coordinate, and normal.
- Each attribute has **its own index**. A corner says "position 6,
  texture coordinate 3, normal 2". The GPU has only **one** index per
  vertex, which selects a position, a normal, and a UV together.
- Faces may be **polygons**. They must be split into triangles.

The **MTL** file holds the materials named by `usemtl`. The terms are
the Blinn–Phong terms from Module 05, plus a texture:

| MTL | Meaning |
|---|---|
| `Kd` | diffuse color, multiplied by the texture if there is one |
| `Ks`, `Ns` | specular color and Blinn–Phong exponent |
| `map_Kd` | the image file used as the diffuse texture |

Here is a small hut. The walls use one texture coordinate square per
face, and each roof triangle uses ${tex`(0,0), (1,0), (0.5,1)`}:

```js echo
const hutOBJText = `mtllib hut.mtl
v -1 0 -1
v 1 0 -1
v 1 0 1
v -1 0 1
v -1 1.2 -1
v 1 1.2 -1
v 1 1.2 1
v -1 1.2 1
v 0 2.2 0
vt 0 0
vt 1 0
vt 1 1
vt 0 1
vt 0.5 1
vn 0 -1 0
vn 0 0 -1
vn 0 0 1
vn -1 0 0
vn 1 0 0
vn 0 0.7071 -0.7071
vn 0 0.7071 0.7071
vn -0.7071 0.7071 0
vn 0.7071 0.7071 0
usemtl Walls
f 1/1/1 2/2/1 3/3/1 4/4/1
f 1/2/2 2/1/2 6/4/2 5/3/2
f 3/2/3 4/1/3 8/4/3 7/3/3
f 1/1/4 4/2/4 8/3/4 5/4/4
f 2/2/5 3/1/5 7/4/5 6/3/5
usemtl Roof
f 5/2/6 6/1/6 9/5/6
f 6/2/9 7/1/9 9/5/9
f 7/2/7 8/1/7 9/5/7
f 8/2/8 5/1/8 9/5/8
`;
```

The materials it names are in a second text file:

```js echo
const hutMTLText = `newmtl Walls
Kd 1 1 1
Ks 0.05 0.05 0.05
Ns 8
map_Kd planks.png

newmtl Roof
Kd 1 0.85 0.85
Ks 0.1 0.1 0.1
Ns 16
map_Kd shingles.png
`;
```

**Step 1: parse the text.** `obj.parseOBJ` (in `lib/obj-mtl.js`)
reads the file line by line. `v`, `vt`, and `vn` lines are appended to
three separate lists. Each `f` corner such as `6/4/2` becomes
`{p: 5, t: 3, n: 1}`, with 1 subtracted from every index. A polygon with
corners ${tex`c_0, c_1, \dots, c_{m-1}`} is **fan-triangulated** into
${tex`(c_0, c_1, c_2), (c_0, c_2, c_3), \dots`}, so a quad becomes two
triangles. The current `usemtl` name is recorded for each triangle.
`obj.parseMTL` turns the MTL text into a lookup table by material name:

```js echo
const hutParsed = obj.parseOBJ(hutOBJText);
const hutMTL = obj.parseMTL(hutMTLText);
```

Five quads and four triangles should give 14 triangles in all:

```js echo
hutParsed.triangles.length
```

The first `f` line, a quad, became the first two triangles. Note the
0-based indices and the shared corner ${tex`c_0`}:

```js
Inputs.table(hutParsed.triangles.slice(0, 2).flatMap((tri, k) => tri.corners.map((c, j) => ({
  triangle: k, corner: j, "position p": c.p, "texcoord t": c.t, "normal n": c.n, material: tri.material
}))))
```

**Step 2: one GPU vertex per distinct `p/t/n`.** `objMesh.buildIndexedMesh`
walks every triangle corner and builds the key `"p,n,t"`. The first time
a key appears, it creates a new GPU vertex holding that position,
normal, and UV, and remembers its index in a `Map`. Every later corner
with the same key **reuses** that index. This is the indexed mesh from
Module 07, built from a file.

The hut has only 9 positions, but a corner of the hut belongs to
several faces with **different normals and different texture
coordinates**, so it has to be split into several GPU vertices. These
are the **seams** from earlier in this module: wherever the texture
coordinates (or the normals) are discontinuous, vertices are duplicated.

```js echo
const trianglesByMaterial =
  [...objMesh.groupTrianglesByMaterial(hutParsed.triangles)];
const hutGroups = trianglesByMaterial.map(([name, triangles]) => ({
  name,
  material: hutMTL[name],
  ...objMesh.buildIndexedMesh(hutParsed, triangles)
}));
```

```js
Inputs.table(hutGroups.map((g) => ({
  material: g.name, triangles: g.rawVertexCount / 3,
  "triangle corners": g.rawVertexCount, "GPU vertices": g.uniqueVertexCount,
  Kd: g.material.Kd.join(" "), map_Kd: g.material.map_Kd
})))
```

The walls' 10 triangles have 30 corners but only 20 distinct `p/t/n`
triples, 4 per face: the two triangles of each quad share 2 corners,
but neighboring faces share none, because their normals differ.

**Step 3: find the textures.** `map_Kd` is just a **file name**. A real
loader fetches that file next to the OBJ and decodes it:

```js run=false
const response = await fetch(new URL(material.map_Kd, objURL));
const bitmap = await createImageBitmap(await response.blob());
const size = [bitmap.width, bitmap.height];
device.queue.copyExternalImageToTexture({source: bitmap}, {texture}, size);
```

This page has no image files, so it maps each file name to a canvas
drawn in code. `textureFromCanvas` copies a canvas into a new texture,
exactly as it would copy a decoded image. A material with no `map_Kd`
gets a **1 × 1 white** texture, so the shader can always compute
`Kd × texture` without a special case:

```js
// Planks: brown boards separated by dark grooves.
const plankCanvas = (() => {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#8a5a3a"; ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = "#5c3a22"; ctx.lineWidth = 2;
  for (let i = 1; i < 6; i++) { ctx.beginPath(); ctx.moveTo(0, i * 128 / 6); ctx.lineTo(128, i * 128 / 6); ctx.stroke(); }
  return canvas;
})();

// Shingles: rows of tiles, every other row shifted by half a tile.
const shingleCanvas = (() => {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#3b2a24"; ctx.fillRect(0, 0, 128, 128);
  for (let row = 0; row < 8; row++) for (let col = -1; col < 8; col++) {
    const x = col * 16 + (row % 2) * 8;
    ctx.fillStyle = ["#9b4a3c", "#8a4034", "#a8574a"][(row * 3 + col + 3) % 3];
    ctx.fillRect(x + 1, row * 16 + 1, 14, 14);
  }
  return canvas;
})();

const whiteCanvas = (() => {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 1, 1);
  return canvas;
})();


```

```js echo
function textureFromCanvas(canvas, format) {
  const texture = device.createTexture({
    size: [canvas.width, canvas.height], format,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
      | GPUTextureUsage.RENDER_ATTACHMENT
  });
  const size = [canvas.width, canvas.height];
  device.queue.copyExternalImageToTexture({source: canvas}, {texture}, size);
  return texture;
}
```

The canvases stand in for the image files named by `map_Kd`:

```js echo
const imageFiles = {
  "planks.png": plankCanvas, "shingles.png": shingleCanvas
};
const textureForMaterial = (m) =>
  textureFromCanvas(imageFiles[m?.map_Kd] ?? whiteCanvas, "rgba8unorm");
```

**Step 4: one textured pipeline.** Each vertex is 8 floats: position, normal, and UV, the
same layout as `uvVertexLayout` from the seam demo. Packing the mesh's three lists into one
array follows that layout:

```js echo
const VERTEX_FLOATS = 8;   // 3 position + 3 normal + 2 uv
function packVertices(positions, normals, uvs) {
  const data = new Float32Array(positions.length * VERTEX_FLOATS);
  positions.forEach((p, i) => {
    data.set([...p, ...normals[i], ...uvs[i]], i * VERTEX_FLOATS);
  });
  return data;
}
```

The fragment shader samples the material's texture, multiplies by `Kd`, and applies Lambert
lighting. An untextured part simply reads white from its 1 × 1 texture:

```js echo
const wgslModelFragment = `
@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  let albedo = u.kd.rgb * textureSample(diffuseTex, samp, in.uv).rgb;
  let L = normalize(vec3<f32>(0.4, 0.7, 0.55));
  let ndotl = max(dot(normalize(in.normal), L), 0.0);
  return vec4<f32>(albedo * (0.3 + 0.7 * ndotl), 1.0);
}`;
```

```js
const wgslUVVertex = `
struct VertexOut {
  @builtin(position) position: vec4<f32>, @location(0) normal: vec3<f32>,
  @location(1) uv: vec2<f32>
};
@vertex
fn vs_main(@location(0) inPos: vec3<f32>, @location(1) inNormal: vec3<f32>, @location(2) inUV: vec2<f32>) -> VertexOut {
  return VertexOut(u.mvp * vec4<f32>(inPos, 1.0), inNormal, inUV);
}`;
const modelModule = device.createShaderModule({code: `
struct Uniforms { mvp: mat4x4<f32>, kd: vec4<f32> };
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var diffuseTex: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
${wgslUVVertex}${wgslModelFragment}`});
const modelPipeline = device.createRenderPipeline({
  layout: "auto",
  vertex: {module: modelModule, entryPoint: "vs_main", buffers: [uvVertexLayout]},
  fragment: {module: modelModule, entryPoint: "fs_main", targets: [{format: canvasFormat}]},
  primitive: {topology: "triangle-list", cullMode: "none"},
  depthStencil: {format: "depth24plus", depthWriteEnabled: true, depthCompare: "less"}
});
const modelSampler = device.createSampler({magFilter: "linear", minFilter: "linear", ...repeat});
```

**Step 5: one draw per material.** Each `usemtl` group becomes a
**part**: its geometry, a uniform buffer (its matrix and `Kd`), and a
bind group that points at its texture. The geometry is a `Mesh` from
the course library, `lib/webgpu.js`, the same file as `src/lib/webgpu.js` in the starter
repository that the activities and assignments use.
`new Mesh(device, {vertices, indices})` uploads both buffers, and
`mesh.draw(pass)` binds them and calls `drawIndexed` with the right
count and index format.

Drawing the model means drawing every part:

```js echo
function makeModelPart({vertices, indices, material}) {
  const uniforms = device.createBuffer(
    {size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST}
  );
  const bindGroup = device.createBindGroup({
    layout: modelPipeline.getBindGroupLayout(0),
    entries: [
      {binding: 0, resource: {buffer: uniforms}},
      {binding: 1, resource: textureForMaterial(material).createView()},
      {binding: 2, resource: modelSampler}
    ]
  });
  const mesh = new Mesh(device, {vertices, indices});
  return {mesh, kd: material?.Kd ?? [0.8, 0.8, 0.8], uniforms, bindGroup};
}
```

Drawing the model means updating and drawing every part:

```js echo
function drawModel(target, parts, mvp) {
  for (const part of parts) {
    const data = new Float32Array([...mvp, ...part.kd, 1]);
    device.queue.writeBuffer(part.uniforms, 0, data);
  }
  renderPass(target, (pass) => {
    pass.setPipeline(modelPipeline);
    for (const part of parts) {
      pass.setBindGroup(0, part.bindGroup);
      part.mesh.draw(pass);
    }
  });
}
```

Each material group becomes one part:

```js echo
const hutParts = hutGroups.map((g) => makeModelPart({
  vertices: packVertices(g.positions, g.normals, g.uvs),
  indices: g.indices,
  material: g.material
}));
```

```js
const hutModelTarget = await makeCanvas(300);
```

```js
const hutModelAzimuth = view(Inputs.range([-180, 180], {value: 40, step: 1, label: "orbit azimuth"}));
```

```js
drawModel(hutModelTarget, hutParts,
  mat4.multiply(transforms.perspective(0.7, 1, 0.1, 30), transforms.lookAt(orbitEye(hutModelAzimuth, 25, 5.2, [0, 1, 0]), [0, 1, 0], [0, 1, 0])));
```

```js
raster.sideBySide([
  ["planks.png", (() => { plankCanvas.style.width = "128px"; return plankCanvas; })()],
  ["shingles.png", (() => { shingleCanvas.style.width = "128px"; return shingleCanvas; })()],
  [`${hutParts.length} materials → ${hutParts.length} draw calls`, hutModelTarget.canvas]
])
```

### Texture arrays: one texture, many layers

The hut binds a **different texture** for each part. A **texture
array** holds several same-sized images as **layers** of one texture,
so every part can share one binding and select its image with a layer
index. The view has `dimension: "2d-array"`, WGSL declares the binding
as `texture_2d_array<f32>`, and `textureSample` takes the layer as one
more argument:

```wgsl run=false
textureSample(tex, samp, uv, layer)   // layer: an i32 or u32 index
```

Every layer must have the **same size, format, and number of mip
levels**. The planks and shingles are both 128 × 128, so they can be
the two layers. The mipmaps are built on the CPU, as before:
`mipmaps.generateMipCanvases` halves each canvas down to 1 × 1, and
every level of every layer is copied in. `origin: [0, 0, layer]` picks
the layer, and `mipLevel` picks the level. (The cube texture later in
this module is filled the same way: a cube is six layers with a
different view.)

```js echo
const layerCanvases = [plankCanvas, shingleCanvas];   // layers 0 and 1
const layerMips = layerCanvases.map((c) => mipmaps.generateMipCanvases(c));
const materialArray = device.createTexture({
  size: [128, 128, layerCanvases.length],             // w, h, layers
  format: "rgba8unorm",
  mipLevelCount: layerMips[0].length,                 // 128 → 1 is 8 levels
  usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    | GPUTextureUsage.RENDER_ATTACHMENT
});
```

The copy visits every level of every layer:

```js echo
layerMips.forEach((levels, layer) => levels.forEach((canvas, mipLevel) => {
  device.queue.copyExternalImageToTexture(
    {source: canvas},
    {texture: materialArray, mipLevel, origin: [0, 0, layer]},
    [canvas.width, canvas.height]
  );
}));
```

The view is what tells the shader it is looking at an array:

```js echo
const materialArrayView = materialArray.createView({dimension: "2d-array"});
const arraySampler = device.createSampler({...trilinear});
```

Each layer's mip chain, built on the CPU (level 0 on the left):

```js
function mipStrip(levels) {
  const strip = document.createElement("canvas");
  strip.width = levels.reduce((w, c) => w + c.width + 4, 0);
  strip.height = levels[0].height;
  const ctx = strip.getContext("2d");
  let x = 0;
  for (const c of levels) {
    ctx.drawImage(c, x, strip.height - c.height);
    x += c.width + 4;
  }
  strip.style.width = `${strip.width}px`;
  return strip;
}
display(raster.sideBySide(layerMips.map((levels, layer) => [`layer ${layer}: ${levels.length} levels`, mipStrip(levels)])));
```

**The model** is the hut again. Its two parts keep their meshes from
Step 5, but instead of a `map_Kd` texture each, a part now carries a
**layer**: the loader gives every image file one layer of the array.
The shader is the textured shader from Step 4 with two changes: the
texture is a `texture_2d_array`, and the uniforms carry the part's
layer (a `u32`) next to its matrix and `Kd`. Each part still gets its
own uniform buffer and bind group, but **both bind groups point at the
same texture view**:

The fragment shader has one changed line, where the layer picks the image:

```js echo
const wgslArrayFragment = `
@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  let c = textureSample(materials, samp, in.uv, u.layer).rgb;
  let L = normalize(vec3<f32>(0.4, 0.7, 0.55));
  let ndotl = max(dot(normalize(in.normal), L), 0.0);
  return vec4<f32>(u.kd.rgb * c * (0.3 + 0.7 * ndotl), 1.0);
}`;
```

```js
const arrayModule = device.createShaderModule({code: `
struct Uniforms { mvp: mat4x4<f32>, kd: vec4<f32>, layer: u32 };
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var materials: texture_2d_array<f32>;
@group(0) @binding(2) var samp: sampler;
${wgslUVVertex}${wgslArrayFragment}`});
const arrayPipeline = device.createRenderPipeline({
  layout: "auto",
  vertex: {module: arrayModule, entryPoint: "vs_main", buffers: [uvVertexLayout]},
  fragment: {module: arrayModule, entryPoint: "fs_main", targets: [{format: canvasFormat}]},
  primitive: {topology: "triangle-list", cullMode: "none"},
  depthStencil: {format: "depth24plus", depthWriteEnabled: true, depthCompare: "less"}
});
const arrayTarget = await makeCanvas(300);
```

The uniform struct now holds a matrix (64 bytes), `Kd` (16 bytes), and an integer (4
bytes). WGSL rounds a struct up to a multiple of 16 bytes, so its size is 96, not 84.
Each part records which layer its image file uses, and every bind group shares the same
view:

```js echo
const ARRAY_UNIFORM_BYTES = 96;
const layerOfFile = {"planks.png": 0, "shingles.png": 1};
function makeArrayBindGroup(uniforms) {
  return device.createBindGroup({
    layout: arrayPipeline.getBindGroupLayout(0),
    entries: [
      {binding: 0, resource: {buffer: uniforms}},
      {binding: 1, resource: materialArrayView},
      {binding: 2, resource: arraySampler}
    ]
  });
}
```

```js echo
const hutArrayParts = hutParts.map((part, i) => {
  const uniforms = device.createBuffer({
    size: ARRAY_UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  const layer = layerOfFile[hutGroups[i].material.map_Kd];
  return {...part, layer, uniforms, bindGroup: makeArrayBindGroup(uniforms)};
});
```

```js
const arrayForm = view(Inputs.form({
  azimuth: Inputs.range([-180, 180], {value: 40, step: 1, label: "orbit azimuth"}),
  swap: Inputs.toggle({value: false, label: "swap the layers"})
}));
```

The uniforms mix types, so they are written through two views of one
`ArrayBuffer`: floats for the matrix and `Kd`, and a `Uint32Array` for
the layer:

```js echo
function writeArrayUniforms(part, mvp, layer) {
  const data = new ArrayBuffer(ARRAY_UNIFORM_BYTES);
  new Float32Array(data, 0, 20).set([...mvp, ...part.kd, 1]);
  new Uint32Array(data, 80, 1)[0] = layer;
  device.queue.writeBuffer(part.uniforms, 0, data);
}
```

```js
{
  const mvp = mat4.multiply(
    transforms.perspective(0.7, 1, 0.1, 30),
    transforms.lookAt(orbitEye(arrayForm.azimuth, 25, 5.2, [0, 1, 0]), [0, 1, 0], [0, 1, 0])
  );
  for (const part of hutArrayParts) writeArrayUniforms(part, mvp, arrayForm.swap ? 1 - part.layer : part.layer);
  renderPass(arrayTarget, (pass) => {
    pass.setPipeline(arrayPipeline);
    for (const part of hutArrayParts) {
      pass.setBindGroup(0, part.bindGroup);
      part.mesh.draw(pass);
    }
  });
}
```

```js
raster.sideBySide([[`${hutArrayParts.length} parts, one texture array`, arrayTarget.canvas]])
```

Toggle **swap the layers**: the parts trade images, but no texture or
bind group changes, only the number in each uniform buffer. That is
the point of a texture array. Switching a part's image means changing
an index, which can come from a uniform, a vertex attribute, or the
`@builtin(instance_index)` of an instanced draw, so one draw call can
give every instance its own image.

### Sampling in WGSL and normal mapping

Every shader so far has called `textureSample(tex, samp, uv)`, which
does the filtering. It works only in the **fragment** stage, because it
needs screen-space derivatives to pick the mip level. A vertex shader,
for example one doing displacement, uses `textureSampleLevel` with an
explicit level. Normal mapping adds one more vertex attribute: a
tangent.

For normal mapping, build the frame ${tex`[\mathbf T\ \mathbf B\ \mathbf N]`}
at each fragment, decode ${tex`\mathbf n = 2\mathbf c - 1`}, and rotate it
into world space. `objMesh.computeTangents` computes the per-vertex tangent
${tex`\mathbf T`} (the direction of increasing ${tex`u`}) from each
triangle's positions and UVs. The shader takes
${tex`\mathbf B = \mathbf N \times \mathbf T`}, which is right only if the
UVs are not **mirrored**: seen from outside, ${tex`u`} must increase to
the right when ${tex`v`} increases upward. That is why the hut's faces
list their `vt` indices in the order they do. (A mirrored layout needs a
${tex`\pm 1`} handedness sign on ${tex`\mathbf B`}, which glTF stores in
the tangent's fourth component.) We reuse the hut and its plank texture
from the OBJ section, this time as one indexed mesh:

```js echo
const hutMesh = objMesh.buildIndexedMesh(hutParsed, hutParsed.triangles);
const hutTangents =
  objMesh.computeTangents(hutMesh.positions, hutMesh.uvs, hutMesh.indices);
```

```js
const plankHeight = (u, v) => { const l = (v * 6) % 1; return Math.max(0, 0.4 - Math.min(l, 1 - l) * 4); };
const plankNormalCanvas = imageCanvas(128, 128, (x, y) => normalFromHeight(plankHeight, x / 128, y / 128, 2).map((c) => 255 * (c * 0.5 + 0.5)));
const hutAlbedo = textureFromCanvas(plankCanvas, "rgba8unorm");
const hutNormalMap = textureFromCanvas(plankNormalCanvas, "rgba8unorm");
const hutSampler = device.createSampler({magFilter: "linear", minFilter: "linear", ...repeat});
```

Each vertex now holds 11 floats: position, normal, UV, and the tangent:

```js echo
const hutData = new Float32Array(hutMesh.positions.length * 11);
hutMesh.positions.forEach((p, i) => {
  const n = hutMesh.normals[i], uv = hutMesh.uvs[i], t = hutTangents[i];
  hutData.set([...p, ...n, ...uv, ...t], i * 11);
});
const hutGPUMesh =
  new Mesh(device, {vertices: hutData, indices: hutMesh.indices});
```

A normal map stores directions in colors. The decode ${tex`\mathbf n = 2\mathbf c - 1`}
undoes the encoding from the bump map section, so the neutral color
(0.5, 0.5, 1) should decode to straight along the surface normal, (0, 0, 1):

```js echo
[0.5, 0.5, 1].map((c) => 2 * c - 1)
```

The shader does the same decode, then rotates the result into world space. Interpolation can
leave ${tex`\mathbf T`} no longer perpendicular to ${tex`\mathbf N`}, so the first step
removes the part of ${tex`\mathbf T`} along ${tex`\mathbf N`}:

```js echo
const wgslMappedNormal = `
fn mappedNormal(
  N0: vec3<f32>, tangent: vec3<f32>, uv: vec2<f32>
) -> vec3<f32> {
  let T = normalize(tangent - N0 * dot(tangent, N0));
  let B = cross(N0, T);
  let c = textureSample(normalTex, samp, uv).rgb;
  return normalize(mat3x3<f32>(T, B, N0) * (2.0 * c - 1.0));
}`;
```

The rest of the fragment shader lights the albedo with whichever normal the toggle selects:

```js echo
const wgslHutFragment = `
@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  let N0 = normalize(in.worldNormal);
  let mapped = mappedNormal(N0, in.worldTangent, in.uv);
  let N = select(N0, mapped, u.params.x > 0.5);
  let albedo = textureSample(albedoTex, samp, in.uv).rgb;
  let ndotl = max(dot(N, normalize(vec3<f32>(0.4, 0.7, 0.55))), 0.0);
  return vec4<f32>(albedo * (0.25 + 0.75 * ndotl), 1.0);
}`;
```

```js
const hutModule = device.createShaderModule({code: `
struct Uniforms { mvp: mat4x4<f32>, params: vec4<f32> };
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var albedoTex: texture_2d<f32>;
@group(0) @binding(2) var normalTex: texture_2d<f32>;
@group(0) @binding(3) var samp: sampler;
struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) worldNormal: vec3<f32>, @location(1) worldTangent: vec3<f32>, @location(2) uv: vec2<f32>,
};
@vertex
fn vs_main(@location(0) inPos: vec3<f32>, @location(1) inNormal: vec3<f32>,
           @location(2) inUV: vec2<f32>, @location(3) inTangent: vec3<f32>) -> VertexOut {
  return VertexOut(u.mvp * vec4<f32>(inPos, 1.0), inNormal, inTangent, inUV);
}
${wgslMappedNormal}${wgslHutFragment}`});
```

```js
const hutPipeline = device.createRenderPipeline({
  layout: "auto",
  vertex: {module: hutModule, entryPoint: "vs_main", buffers: [{arrayStride: 44, attributes: [
    {shaderLocation: 0, offset: 0, format: "float32x3"}, {shaderLocation: 1, offset: 12, format: "float32x3"},
    {shaderLocation: 2, offset: 24, format: "float32x2"}, {shaderLocation: 3, offset: 32, format: "float32x3"}]}]},
  fragment: {module: hutModule, entryPoint: "fs_main", targets: [{format: canvasFormat}]},
  primitive: {topology: "triangle-list", cullMode: "none"},
  depthStencil: {format: "depth24plus", depthWriteEnabled: true, depthCompare: "less"}
});
const hutUniforms = device.createBuffer({size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
const hutBindGroup = device.createBindGroup({layout: hutPipeline.getBindGroupLayout(0), entries: [
  {binding: 0, resource: {buffer: hutUniforms}}, {binding: 1, resource: hutAlbedo.createView()},
  {binding: 2, resource: hutNormalMap.createView()}, {binding: 3, resource: hutSampler}]});
const hutTarget = await makeCanvas(300);
```

```js
const hutForm = view(Inputs.form({
  normalMap: Inputs.toggle({value: true, label: "use normal map"}),
  azimuth: Inputs.range([-180, 180], {value: 40, step: 1, label: "orbit azimuth"})
}));
```

```js
{
  const mvp = mat4.multiply(
    transforms.perspective(0.7, 1, 0.1, 30),
    transforms.lookAt(
      orbitEye(hutForm.azimuth, 25, 5.2, [0, 1, 0]), [0, 1, 0], [0, 1, 0]
    )
  );
  device.queue.writeBuffer(
    hutUniforms, 0,
    new Float32Array([...mvp, hutForm.normalMap ? 1 : 0, 0, 0, 0])
  );
  renderPass(hutTarget, (pass) => {
    pass.setPipeline(hutPipeline); pass.setBindGroup(0, hutBindGroup);
    hutGPUMesh.draw(pass);
  });
}
```

```js
raster.sideBySide([["normal map", (() => { plankNormalCanvas.style.width = "128px"; return plankNormalCanvas; })()], ["normal-mapped hut", hutTarget.canvas]])
```

Turn the normal map off and the walls flatten to their face normals:
same geometry, same albedo, only the lighting normal changes.

### Environment maps with cube textures

A cube texture has **six layers**, viewed with `dimension: "cube"`, and
is sampled with a 3D **direction** rather than ${tex`(u,v)`}. The GPU
picks the face. Each face below is a canvas painted with a sky gradient
and its own label.

```js
const faceNames = ["+X", "−X", "+Y", "−Y", "+Z", "−Z"];
const envTexture = (() => {
  const size = 256;
  const texture = device.createTexture({size: [size, size, 6], format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT});
  faceNames.forEach((name, layer) => {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    const top = layer === 2 ? "#2c5aa0" : layer === 3 ? "#3d5a2a" : "#6fa0dc";
    const bottom = layer === 2 ? "#2c5aa0" : layer === 3 ? "#2a3d1d" : "#c9a76b";
    const grad = ctx.createLinearGradient(0, 0, 0, size);
    grad.addColorStop(0, top); grad.addColorStop(0.5, layer < 2 || layer > 3 ? "#e8eef5" : top); grad.addColorStop(1, bottom);
    ctx.fillStyle = grad; ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    for (let k = 32; k < size; k += 32) { ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k, size); ctx.moveTo(0, k); ctx.lineTo(size, k); ctx.stroke(); }
    ctx.fillStyle = "#c0392b"; ctx.font = "bold 72px sans-serif"; ctx.textAlign = "center"; ctx.fillText(name, size / 2, size / 2 + 26);
    device.queue.copyExternalImageToTexture({source: c}, {texture, origin: [0, 0, layer]}, [size, size]);
  });
  return texture;
})();
```

The formula ${tex`\mathbf r = \mathbf v - 2(\mathbf v\cdot\mathbf n)\mathbf n`} is
easy to test on the CPU. Looking straight at a surface, the reflection should come straight
back. Looking down at 45° onto a floor, it should bounce up at 45°:

```js echo
function reflectVector(v, n) {
  const k = 2 * d3.sum([0, 1, 2], (i) => v[i] * n[i]);
  return v.map((c, i) => c - k * n[i]);
}
```

```js echo
[reflectVector([0, 0, -1], [0, 0, 1]), reflectVector([1, -1, 0], [0, 1, 0])]
  .map((r) => `(${r.join(", ")})`)
```

The shader computes the same thing with WGSL's built-in `reflect`, then samples the cube map
with that **direction**. The toggle below can substitute the view direction itself:

```js echo
const wgslEnvFragment = `
@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  let v = normalize(in.worldPos - u.eye.xyz);
  let r = reflect(v, normalize(in.normal));
  let dir = select(r, v, u.params.x > 0.5);
  return vec4<f32>(textureSample(envTex, envSamp, dir).rgb, 1.0);
}`;
```

```js
const envModule = device.createShaderModule({code: `
struct Uniforms { mvp: mat4x4<f32>, eye: vec4<f32>, params: vec4<f32> };
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var envTex: texture_cube<f32>;
@group(0) @binding(2) var envSamp: sampler;
struct VertexOut {
  @builtin(position) position: vec4<f32>, @location(0) worldPos: vec3<f32>,
  @location(1) normal: vec3<f32>
};
@vertex
fn vs_main(@location(0) inPos: vec3<f32>, @location(1) inNormal: vec3<f32>) -> VertexOut {
  return VertexOut(u.mvp * vec4<f32>(inPos, 1.0), inPos, inNormal);
}
${wgslEnvFragment}`});
```

```js
const envPipeline = device.createRenderPipeline({
  layout: "auto",
  vertex: {module: envModule, entryPoint: "vs_main", buffers: [{arrayStride: 24, attributes: [
    {shaderLocation: 0, offset: 0, format: "float32x3"}, {shaderLocation: 1, offset: 12, format: "float32x3"}]}]},
  fragment: {module: envModule, entryPoint: "fs_main", targets: [{format: canvasFormat}]},
  primitive: {topology: "triangle-list", cullMode: "back"},
  depthStencil: {format: "depth24plus", depthWriteEnabled: true, depthCompare: "less"}
});
const envSphere = geometry.createSphere(40, 56);
const envMesh = new Mesh(device, {vertices: geometry.interleave(envSphere.positions, envSphere.normals), indices: envSphere.indices});
const envUniforms = device.createBuffer({size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
const envBindGroup = device.createBindGroup({layout: envPipeline.getBindGroupLayout(0), entries: [
  {binding: 0, resource: {buffer: envUniforms}}, {binding: 1, resource: envTexture.createView({dimension: "cube"})},
  {binding: 2, resource: device.createSampler({magFilter: "linear", minFilter: "linear"})}]});
const envTarget = await makeCanvas(300);
```

```js
const envForm = view(Inputs.form({
  azimuth: Inputs.range([-180, 180], {value: 0, step: 1, label: "orbit azimuth"}),
  elevation: Inputs.range([-80, 80], {value: 10, step: 1, label: "orbit elevation"}),
  through: Inputs.toggle({value: false, label: "show the view direction instead of the reflection"})
}));
```

```js
{
  const eye = orbitEye(envForm.azimuth, envForm.elevation, 3);
  const mvp = mat4.multiply(
    transforms.perspective(0.8, 1, 0.1, 20),
    transforms.lookAt(eye, [0, 0, 0], [0, 1, 0])
  );
  device.queue.writeBuffer(
    envUniforms, 0,
    new Float32Array([...mvp, ...eye, 1, envForm.through ? 1 : 0, 0, 0, 0])
  );
  renderPass(envTarget, (pass) => {
    pass.setPipeline(envPipeline); pass.setBindGroup(0, envBindGroup);
    envMesh.draw(pass);
  });
}
```

```js
envTarget.canvas
```

The mirror ball shows the environment **behind the viewer** in its
center and the whole surrounding sky toward its rim, squeezed by the
reflection. Orbit around and the face labels change. The ball reflects
only the environment, never other objects in the scene. The toggle
replaces ${tex`\mathbf r`} with the view direction itself, which shows
the face directly behind the sphere.

The demo's shader returns *only* the reflected color, so the sphere is a
perfect mirror. A partly reflective material blends the lookup with the
usual shading, as in the mirror-term formula above. In the fragment
shader, that is one more line (`km` is a uniform or a value read from a
texture, `diffuse` and `specular` come from your lighting code):

```wgsl run=false
let mirror = textureSample(envTex, envSamp, reflect(v, n)).rgb;
let color = diffuse + specular + km * mirror;
```

Note the sign convention: here `v` points from the eye toward the
surface, which is what `reflect` expects. If your lighting code uses a
`viewDir` that points *toward* the eye, negate it first.

### Shadow maps

Shadow mapping takes **two passes**. Pass 1 renders the scene from the
light into a `depth32float` texture, with no color at all. Pass 2
renders from the camera and compares each fragment's depth in the
light's view with the stored depth, using a **comparison sampler**:

```js echo
const SHADOW_SIZE = 1024;
const shadowMap = device.createTexture({
  size: [SHADOW_SIZE, SHADOW_SIZE], format: "depth32float",
  usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
});
```

The shadow map is a depth texture we can both render into and read from. Three bind group
layouts come next, one for what changes per scene, one per object, and one for the shadow map.
The first two are ordinary uniforms:

```js echo
const uniformLayout = () => device.createBindGroupLayout({entries: [{
  binding: 0,
  visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
  buffer: {type: "uniform"}
}]});
const sceneLayout = uniformLayout(), objectLayout = uniformLayout();
```

The third declares a `"depth"` texture and a `"comparison"` sampler:

```js echo
const shadowLayout = device.createBindGroupLayout({entries: [
  {binding: 0, visibility: GPUShaderStage.FRAGMENT,
   texture: {sampleType: "depth"}},
  {binding: 1, visibility: GPUShaderStage.FRAGMENT,
   sampler: {type: "comparison"}}
]});
```

The comparison sampler performs the depth test. `compare: "less"` returns 1 when the reference
depth is less than the stored depth, meaning nothing blocks the light. Linear filtering
averages neighboring results, which is a 2 × 2 hardware PCF:

```js echo
const comparisonSampler = device.createSampler(
  {compare: "less", magFilter: "linear", minFilter: "linear"}
);
```

Both passes share one shader module. The scene's `params` hold the bias, the PCF switch, and
the size of one shadow-map texel:

```js echo
const wgslShadowDecls = `
struct Scene {
  camVP: mat4x4<f32>, lightVP: mat4x4<f32>, lightDir: vec4<f32>,
  params: vec4<f32>
};
struct Object { model: mat4x4<f32>, color: vec4<f32> };
@group(0) @binding(0) var<uniform> scene: Scene;
@group(1) @binding(0) var<uniform> object: Object;
@group(2) @binding(0) var shadowTex: texture_depth_2d;
@group(2) @binding(1) var shadowSmp: sampler_comparison;`;
```

**Pass 1** needs only the light's view of each vertex:

```js echo
const wgslDepthVertex = `
@vertex
fn vs_depth(@location(0) pos: vec3<f32>) -> @builtin(position) vec4<f32> {
  return scene.lightVP * object.model * vec4<f32>(pos, 1.0);
}`;
```

**Pass 2** computes each vertex's position twice, once for the camera and once for the light.
The rasterizer interpolates the light's version across the triangle:

```js echo
const wgslMainVertex = `
struct VertexOut {
  @builtin(position) position: vec4<f32>, @location(0) normal: vec3<f32>,
  @location(1) lightClip: vec4<f32>
};
@vertex
fn vs_main(
  @location(0) pos: vec3<f32>, @location(1) normal: vec3<f32>
) -> VertexOut {
  let world = object.model * vec4<f32>(pos, 1.0);
  return VertexOut(scene.camVP * world,
    (object.model * vec4<f32>(normal, 0.0)).xyz, scene.lightVP * world);
}`;
```

At each fragment, that position must become a shadow-map lookup. Dividing by ${tex`w`} gives NDC.
Texture coordinates run from 0 to 1 with ${tex`v`} pointing down, the opposite of NDC ${tex`y`}.
Here is the mapping on the CPU. NDC (−1, 1), the top-left, should map to texture (0, 0), and the
center (0, 0) to (0.5, 0.5):

```js echo
const ndcToShadowUV = ([x, y]) => [x * 0.5 + 0.5, y * -0.5 + 0.5];
```

```js echo
[ndcToShadowUV([-1, 1]), ndcToShadowUV([0, 0])]
  .map((p) => `(${p.join(", ")})`)
```

PCF repeats the comparison at 25 nearby texels and averages the 0/1 answers. It averages
**answers**, not depths:

```js echo
const wgslPCF = `
fn pcfLit(uv: vec2<f32>, refDepth: f32) -> f32 {
  var lit = 0.0;
  for (var dy = -2; dy <= 2; dy++) { for (var dx = -2; dx <= 2; dx++) {
    let shift = vec2<f32>(f32(dx), f32(dy)) * scene.params.z;
    let at = uv + shift;
    lit += textureSampleCompareLevel(shadowTex, shadowSmp, at, refDepth);
  } }
  return lit / 25.0;
}`;
```

The fragment shader puts these together. Subtracting the bias from the depth is what prevents a
surface from shadowing itself. Shadow scales only the direct light, not the ambient term:

```js echo
const wgslShadowFragment = `
@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  let ndc = in.lightClip.xyz / in.lightClip.w;
  let uv = ndc.xy * vec2<f32>(0.5, -0.5) + 0.5;
  let d = ndc.z - scene.params.x;
  let lit = select(textureSampleCompareLevel(shadowTex, shadowSmp, uv, d),
    pcfLit(uv, d), scene.params.y > 0.5);
  let ndotl = max(dot(normalize(in.normal), -scene.lightDir.xyz), 0.0);
  return vec4<f32>(object.color.rgb * (0.25 + 0.75 * ndotl * lit), 1.0);
}`;
```

```js echo
const shadowModule = device.createShaderModule({code: [wgslShadowDecls,
  wgslDepthVertex, wgslMainVertex, wgslPCF, wgslShadowFragment].join("\n")});
const meshLayout = {
  arrayStride: 24,
  attributes: [
    {shaderLocation: 0, offset: 0, format: "float32x3"},
    {shaderLocation: 1, offset: 12, format: "float32x3"}
  ]
};
```

The depth pipeline has **no fragment stage**, because pass 1 writes only depth:

```js echo
const depthPipeline = device.createRenderPipeline({
  layout: device.createPipelineLayout(
    {bindGroupLayouts: [sceneLayout, objectLayout]}
  ),
  vertex: {
    module: shadowModule, entryPoint: "vs_depth", buffers: [meshLayout]
  },
  primitive: {topology: "triangle-list", cullMode: "back"},
  depthStencil: {
    format: "depth32float", depthWriteEnabled: true, depthCompare: "less"
  }
});
```

The shaded pipeline is a normal one, and it adds the shadow layout:

```js echo
const shadedPipeline = device.createRenderPipeline({
  layout: device.createPipelineLayout(
    {bindGroupLayouts: [sceneLayout, objectLayout, shadowLayout]}
  ),
  vertex: {
    module: shadowModule, entryPoint: "vs_main", buffers: [meshLayout]
  },
  fragment: {
    module: shadowModule, entryPoint: "fs_main",
    targets: [{format: canvasFormat}]
  },
  primitive: {topology: "triangle-list", cullMode: "back"},
  depthStencil: {
    format: "depth24plus", depthWriteEnabled: true, depthCompare: "less"
  }
});
```

```js
const shadowBindGroup = device.createBindGroup({layout: shadowLayout, entries: [
  {binding: 0, resource: shadowMap.createView()}, {binding: 1, resource: comparisonSampler}]});
const sceneUniforms = device.createBuffer({size: 160, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
const sceneBindGroup = device.createBindGroup({layout: sceneLayout, entries: [{binding: 0, resource: {buffer: sceneUniforms}}]});

// Scene: a floor, a sphere, and a box, each with its own model matrix and color.
const boxMesh = (() => {
  const positions = [], normals = [], indices = [];
  const faces = [[[1, 0, 0], [0, 1, 0]], [[-1, 0, 0], [0, 1, 0]], [[0, 1, 0], [0, 0, 1]], [[0, -1, 0], [0, 0, 1]], [[0, 0, 1], [1, 0, 0]], [[0, 0, -1], [1, 0, 0]]];
  for (const [n, a] of faces) {
    const b = [n[1] * a[2] - n[2] * a[1], n[2] * a[0] - n[0] * a[2], n[0] * a[1] - n[1] * a[0]];   // n × a
    const base = positions.length / 3;
    for (const [s, t] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      positions.push(n[0] + s * a[0] + t * b[0], n[1] + s * a[1] + t * b[1], n[2] + s * a[2] + t * b[2]);
      normals.push(...n);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return {positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint16Array(indices)};
})();
const shadowSphere = geometry.createSphere(24, 32);
const sceneObjects = [
  {mesh: boxMesh, model: mat4.multiply(transforms.translate(0, -0.05, 0), transforms.scale(4, 0.05, 4)), color: [0.75, 0.75, 0.72]},
  {mesh: shadowSphere, model: mat4.multiply(transforms.translate(-0.9, 0.7, 0.3), transforms.scale(0.7, 0.7, 0.7)), color: [0.85, 0.35, 0.25]},
  {mesh: boxMesh, model: mat4.multiply(transforms.translate(1.0, 0.55, -0.6), mat4.multiply(transforms.rotateY(0.6), transforms.scale(0.45, 0.55, 0.45))), color: [0.25, 0.45, 0.8]}
].map((o) => {
  const uniforms = device.createBuffer({size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
  device.queue.writeBuffer(uniforms, 0, new Float32Array([...o.model, ...o.color, 1]));
  return {...o, gpuMesh: new Mesh(device, {vertices: geometry.interleave(o.mesh.positions, o.mesh.normals), indices: o.mesh.indices}),
    bindGroup: device.createBindGroup({layout: objectLayout, entries: [{binding: 0, resource: {buffer: uniforms}}]})};
});
const shadowTarget = await makeCanvas(340);
```

```js
const shadowForm = view(Inputs.form({
  azimuth: Inputs.range([-180, 180], {value: 50, step: 1, label: "light azimuth"}),
  elevation: Inputs.range([15, 85], {value: 45, step: 1, label: "light elevation"}),
  bias: Inputs.range([0, 0.02], {value: 0.003, step: 0.0005, label: "shadow bias ε"}),
  pcf: Inputs.toggle({value: true, label: "percentage-closer filtering (5 × 5)"})
}));
```

Both passes draw every object the same way, binding its model matrix and color at group 1:

```js echo
function drawSceneObjects(pass) {
  for (const o of sceneObjects) {
    pass.setBindGroup(1, o.bindGroup);
    o.gpuMesh.draw(pass);
  }
}
```

**Pass 1** renders from the light, with no color attachments at all. Its only output is the
depth in the shadow map:

```js echo
function encodeDepthPass(encoder) {
  const pass = encoder.beginRenderPass({
    colorAttachments: [],
    depthStencilAttachment: {
      view: shadowMap.createView(), depthClearValue: 1,
      depthLoadOp: "clear", depthStoreOp: "store"
    }
  });
  pass.setPipeline(depthPipeline);
  pass.setBindGroup(0, sceneBindGroup);
  drawSceneObjects(pass);
  pass.end();
}
```

**Pass 2** renders from the camera. The only new step is binding the shadow map at group 2, for
the fragment shader to read:

```js echo
function encodeMainPass(encoder) {
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: shadowTarget.context.getCurrentTexture().createView(),
      clearValue: {r: 0.05, g: 0.05, b: 0.08, a: 1},
      loadOp: "clear", storeOp: "store"
    }],
    depthStencilAttachment: {
      view: shadowTarget.depthTexture.createView(), depthClearValue: 1,
      depthLoadOp: "clear", depthStoreOp: "store"
    }
  });
  pass.setPipeline(shadedPipeline);
  pass.setBindGroup(0, sceneBindGroup);
  pass.setBindGroup(2, shadowBindGroup);
  drawSceneObjects(pass);
  pass.end();
}
```

The light uses an orthographic camera, as a distant light should. Its direction points the way
the light travels, from the light toward the scene:

```js echo
const lightPos = orbitEye(shadowForm.azimuth, shadowForm.elevation, 8);
const lightDir = lightPos.map((c) => -c / Math.hypot(...lightPos));
const lightVP = mat4.multiply(
  transforms.ortho(-4.5, 4.5, -4.5, 4.5, 1, 16),
  transforms.lookAt(lightPos, [0, 0, 0], [0, 1, 0])
);
```

A frame writes the scene uniforms, which hold those matrices and the slider settings, then encodes both passes **in order**, so the depth is ready when pass 2 reads it:

```js echo
writeSceneUniforms();
const shadowEncoder = device.createCommandEncoder();
encodeDepthPass(shadowEncoder);
encodeMainPass(shadowEncoder);
device.queue.submit([shadowEncoder.finish()]);
```

```js
function writeSceneUniforms() {
  const camVP = mat4.multiply(
    transforms.perspective(0.8, 1, 0.1, 40),
    transforms.lookAt([3.2, 4.2, 6.5], [0, 0.3, 0], [0, 1, 0])
  );
  device.queue.writeBuffer(sceneUniforms, 0, new Float32Array(
    [...camVP, ...lightVP, ...lightDir, 0, shadowForm.bias, shadowForm.pcf ? 1 : 0, 1 / SHADOW_SIZE, 0]
  ));
}
```

```js
shadowTarget.canvas
```

Things to try:

- Set the **bias** to 0. Surfaces shadow themselves in a striped pattern
  (**shadow acne**), because a surface's own depth is compared with a
  slightly different stored copy of itself.
- Set the bias near its maximum. Shadows **detach** from the objects that
  cast them.
- Turn **PCF** off. Shadow edges show the shadow map's texels. PCF
  averages 25 binary tests (each already a hardware 2 × 2 filter),
  **not** 25 depths, which would be meaningless across a depth jump.
- Lower the light toward the horizon: shadows lengthen, and acne needs a
  larger bias because the light strikes the floor at a grazing angle.

The shader uses `textureSampleCompareLevel`, which is like
`textureSampleCompare` but always samples mip level 0. It is valid anywhere
in the shader, not only in uniform control flow.

## Check Your Understanding

1. Which of the four geometric mappings would you choose for a wine bottle? For a nearly flat leaf?
2. Why does screen-space linear interpolation of ${tex`(u,v)`} bend straight texture lines?
3. A triangle on a globe has vertices at longitudes ${tex`+170^\circ`} and ${tex`-170^\circ`}. What goes wrong with shared vertices, and how do you fix it?
4. A pixel's footprint has ${tex`\lVert\mathbf u_x\rVert = 12`} and ${tex`\lVert\mathbf u_y\rVert = 3`} texels. Which mip level does trilinear filtering choose? What does anisotropic filtering do instead?
5. How much extra memory does a full mipmap need?
6. Why must a normal map use a linear (not sRGB) texture format?
7. What is shadow acne, and what are the two problems with fixing it with a large bias?
8. Why does PCF average comparison results instead of depths?
9. Why does a solid texture need no texture coordinates?
10. An OBJ face line is `f 3/7/2 4/8/2 5/9/2 6/1/2`. How many triangles does it become, and which position index (0-based) does every one of them share?
11. The hut has 9 positions but 32 GPU vertices. Why can't the GPU use the 9 positions directly?
12. In the texture-array hut, what changes when you swap the layers, and what stays the same?

<details>
<summary>Answers</summary>

1. Cylindrical for the bottle (columnar), planar for the leaf, projecting along its average normal.
2. Screen-space weights are linear in the image, not on the surface. Depth varies across the triangle, so equal screen steps are unequal surface steps. Interpolating ${tex`u/w`} and ${tex`1/w`} fixes it.
3. The triangle interpolates through ${tex`0^\circ`}, the long way around, so a backward copy of the map is squeezed into it. Duplicate the seam vertices so that one copy has longitude ${tex`190^\circ`}.
4. ${tex`D = 12`}, so ${tex`k = \log_2 12 \approx`} ${Math.log2(12).toFixed(2)}: a blend of levels 3 and 4. Anisotropic filtering picks the level from the short axis, ${tex`\log_2 3 \approx`} ${Math.log2(3).toFixed(2)}, and averages several samples along the long axis.
5. About one third: ${tex`\tfrac14 + \tfrac1{16} + \cdots = \tfrac13`}.
6. Its values are vector components, not colors. An sRGB decode would apply a gamma curve and bend every vector.
7. Acne is false self-shadowing from comparing a surface's depth with an imprecise copy of itself. A large bias makes shadows detach from their casters and lets thin objects cast no shadow.
8. Depths on either side of a shadow edge belong to different surfaces, so averaging them gives a depth that matches nothing. Averaging 0/1 results gives the fraction of nearby samples that are lit.
9. It is a function of the 3D position itself, so the surface point already is its own "texture coordinate."
10. Two triangles, from fan triangulation: ${tex`(c_0,c_1,c_2)`} and ${tex`(c_0,c_2,c_3)`}. Every triangle of a fan shares the apex ${tex`c_0`}, position index 2 (OBJ's 3, minus 1). For a quad, the two triangles also share ${tex`c_2`}, position index 4.
11. The GPU has one index per vertex, which selects position, normal, and UV together. A hut corner touches faces with different normals and texture coordinates, so each distinct `p/t/n` combination needs its own vertex. The duplicates sit wherever the normals or texture coordinates are discontinuous: the hard edges and the texture seams.
12. Only the `layer` value written into each part's uniform buffer changes. The texture, its view, the sampler, the bind groups, the pipeline, and the meshes stay the same.

</details>

## Common Pitfalls

- **Interpolating texture coordinates affinely** in a software renderer.
  Divide by ${tex`w`}.
- **Sharing vertices across a seam.** Duplicate them with different
  ${tex`(u,v)`}.
- **Flipped ${tex`v`}.** Tools and APIs disagree about whether
  ${tex`v = 0`} is the top or the bottom. Fix it once with ${tex`v \to 1-v`}.
- **sRGB on data textures.** Only color data (albedo, emissive) is sRGB.
- **Forgetting mipmaps.** Point or bilinear sampling of a minified texture
  aliases, exactly as point-sampled downsampling did in Module 06.
- **Wrong channel in a packed texture.** It produces no error, only a
  wrong-looking material.
- **Shadow bias too small or too large**, or averaging depths instead of
  comparison results.
- **Forgetting OBJ's 1-based indices**, or creating a new vertex for
  every face corner instead of sharing repeated `p/t/n` triples.
- **Treating `map_Kd` as an image.** It is a file name, relative to the
  MTL file; the loader must fetch and decode it.
- **Mixed sizes in a texture array.** Every layer must have the same
  size, format, and mip count. Resize the images first.
- **Calling `textureSample` in a vertex shader.** Use
  `textureSampleLevel` there.

## Summary

- **Texture coordinates:** ${tex`\phi`} maps the surface to texture space.
  It is computed geometrically (planar, spherical, cylindrical, cube map)
  or interpolated from vertices in a perspective-correct way. Good maps
  are bijective, have low distortion, and hide their seams. Wrapping modes
  define lookups outside ${tex`[0,1]^2`}.
- **Antialiasing:** the Jacobian ${tex`J`} approximates a pixel's
  footprint. Bilinear filtering handles magnification. Mipmaps with
  trilinear or anisotropic filtering handle minification, with
  ${tex`k = \log_2 D`} choosing the level.
- **Applications:** textures supply shading parameters, normals (bump and
  normal maps), shadows (two-pass shadow maps with bias and PCF), and
  reflections (cube-map environment maps).
- **Procedural textures:** stripes, Perlin's gradient noise, and
  turbulence define color everywhere in 3D, with no distortion and no
  seams.
- **Loading models:** OBJ files index positions, UVs, and normals
  separately; each distinct `p/t/n` triple becomes one GPU vertex, polygons
  are fan-triangulated, and each MTL material (`Kd` times its `map_Kd`
  texture) becomes one draw.
- **Texture arrays:** same-sized images stored as layers of one texture
  (`texture_2d_array`). Parts share one binding and pick their image
  with a layer index.
- **WebGPU:** textures with mip levels, samplers that select the
  filtering, `textureSample`, `texture_2d_array`, `texture_cube`, and depth textures with
  comparison samplers.
