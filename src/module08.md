---
title: Module 08 — Texture Mapping
toc: true
---

```js echo
import * as d3 from "npm:d3";
import * as mat4 from "./components/mat4.js";
import * as geometry from "./components/geometry.js";
import * as obj from "./components/obj.js";
import * as webgpu from "./components/webgpu.js";
import {createBuffer, Mesh} from "./components/lib/webgpu.js";
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
are explained in the last section. This handout teaches the *techniques*;
it is not a walkthrough of any graded assignment.

```js echo
const {adapter, device} = await webgpu.requestDevice();
const canvasFormat = navigator.gpu.getPreferredCanvasFormat();

const deviceErrorLog = document.createElement("pre");
deviceErrorLog.style.cssText = "display: none; color: #e5484d; background: #2a1214; border: 1px solid #e5484d; border-radius: 6px; padding: 8px 12px; font-size: 12px; white-space: pre-wrap;";
device.addEventListener("uncapturederror", (event) => {
  deviceErrorLog.textContent += `WebGPU error: ${event.error.message}\n`;
  deviceErrorLog.style.display = "block";
});

function makeVertexBuffer(data) {
  const buffer = device.createBuffer({size: data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, mappedAtCreation: true});
  new Float32Array(buffer.getMappedRange()).set(data);
  buffer.unmap();
  return buffer;
}
function makeIndexBuffer(data) {
  const padded = new Uint16Array(Math.ceil(data.length / 2) * 2);   // keep the size a multiple of 4 bytes
  padded.set(data);
  const buffer = device.createBuffer({size: padded.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST, mappedAtCreation: true});
  new Uint16Array(buffer.getMappedRange()).set(padded);
  buffer.unmap();
  return buffer;
}
function makeCanvas(size) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  canvas.style.borderRadius = "8px";
  const {context} = webgpu.configureCanvas(canvas, device);
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

```js echo
deviceErrorLog
```

## Texture Coordinates

### Looking up a texture value

A **texture** is an image with ${tex`n_u \times n_v`} texels addressed by
${tex`(u, v) \in [0,1]^2`}. The simplest lookup returns the nearest
texel. A shader asks the surface for the texture coordinates of its
shading point, then uses the looked-up color, for example as the diffuse
color:

```js echo
// A texture as plain data: width, height, and an RGB array.
function makeTexture(width, height, pixel) {
  const data = new Float32Array(width * height * 3);
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) data.set(pixel(i, j), 3 * (j * width + i));
  return {width, height, data};
}
const texel = (t, i, j) => t.data.subarray(3 * (j * t.width + i), 3 * (j * t.width + i) + 3);

// The reading's texture_lookup: round to the nearest texel center.
function textureLookup(t, u, v) {
  const i = Math.min(t.width - 1, Math.max(0, Math.round(u * t.width - 0.5)));
  const j = Math.min(t.height - 1, Math.max(0, Math.round(v * t.height - 0.5)));
  return texel(t, i, j);
}
```

Our test texture is a **numbered grid**, the standard tool for seeing
how a mapping stretches a texture. Each cell is colored by its row and
column, and a few cells carry a marker so that you can tell up from down:

```js echo
const gridTexture = makeTexture(128, 128, (i, j) => {
  const cu = Math.floor(i / 16), cv = Math.floor(j / 16);
  const base = d3.rgb(d3.interpolateRainbow(cu / 8));
  const shade = 0.55 + 0.45 * (cv / 7);
  const line = i % 16 === 0 || j % 16 === 0;
  const marker = (cu + cv) % 4 === 0 && Math.hypot((i % 16) - 8, (j % 16) - 8) < 3.5;
  return line ? [30, 30, 30] : marker ? [255, 255, 255] : [base.r * shade, base.g * shade, base.b * shade];
});
```

```js echo
imageCanvas(128, 128, (x, y) => textureLookup(gridTexture, (x + 0.5) / 128, 1 - (y + 0.5) / 128), 1.5)
```

(Here ${tex`v = 0`} is the bottom row, as in the reading.)

### Geometrically determined coordinates

The **texture coordinate function** ${tex`\phi : S \to T`} maps each
surface point to texture space. Four classic choices compute it from the
point's position. Here ${tex`y`} is "up", so the poles of the spherical
map are at ${tex`y = \pm 1`}:

```js echo
const mappings = {
  planar: (p) => [(p.x + 1) / 2, (p.y + 1) / 2],                      // orthographic projection along z
  spherical: (p) => [(Math.PI + Math.atan2(p.z, p.x)) / (2 * Math.PI),
                     (Math.PI - Math.acos(p.y / Math.hypot(p.x, p.y, p.z))) / Math.PI],
  cylindrical: (p) => [(Math.PI + Math.atan2(p.z, p.x)) / (2 * Math.PI), (1 + p.y) / 2],
  "cube map": (p) => {                                                  // pick the face, then divide
    const ax = Math.abs(p.x), ay = Math.abs(p.y), az = Math.abs(p.z);
    if (ax >= ay && ax >= az) return [0.5 * (1 + p.z / ax), 0.5 * (1 + p.y / ax), p.x > 0 ? 0 : 1];
    if (ay >= az) return [0.5 * (1 + p.x / ay), 0.5 * (1 + p.z / ay), p.y > 0 ? 2 : 3];
    return [0.5 * (1 + p.x / az), 0.5 * (1 + p.y / az), p.z > 0 ? 4 : 5];
  }
};
```

The renderer below casts one orthographic ray per pixel at an ellipsoid,
finds the hit point ${tex`\mathbf p`}, evaluates ${tex`\phi(\mathbf p)`},
and looks up the grid texture. (For the cube map, each face is tinted
differently.) Try each mapping on a sphere, a tall "vase", and a flat
"disk":

```js echo
const mapForm = view(Inputs.form({
  mapping: Inputs.radio(Object.keys(mappings), {value: "spherical", label: "φ"}),
  shape: Inputs.radio(["sphere", "tall", "flat"], {value: "sphere", label: "object"}),
  azimuth: Inputs.range([-180, 180], {value: 30, step: 1, label: "view azimuth"}),
  elevation: Inputs.range([-80, 80], {value: 20, step: 1, label: "view elevation"})
}));
```

```js echo
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

```js echo
(() => {
  const [a, b] = shapeSize[mapForm.shape];
  const faceTint = [[1, 0.6, 0.6], [0.6, 1, 0.6], [0.6, 0.6, 1], [1, 1, 0.5], [0.5, 1, 1], [1, 0.5, 1]];
  return castEllipsoid(260, {a, b, azimuth: mapForm.azimuth, elevation: mapForm.elevation}, (p) => {
    // normalize the point into the [-1, 1] box the formulas assume
    const q = {x: p.x / Math.max(a, b), y: p.y / Math.max(a, b), z: p.z / Math.max(a, b)};
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

The small software rasterizer below draws a floor quad seen at an angle,
once with plain screen-space interpolation and once perspective-correct:

```js echo
function rasterizeQuad(size, {perspectiveCorrect, tilt}) {
  const view = mat4.lookAt([0, 1.2 + tilt, -0.2], [0, 0, 3], [0, 1, 0]);
  const mvp = mat4.multiply(mat4.perspective(1.0, 1, 0.1, 20), view);
  const corners = [[-1.5, 0, 0.5, 0, 0], [1.5, 0, 0.5, 1, 0], [1.5, 0, 5, 1, 1], [-1.5, 0, 5, 0, 1]];
  const verts = corners.map(([x, y, z, u, v]) => {
    const c = mat4.transformPoint(mvp, [x, y, z]);
    return {sx: (c[0] / c[3] * 0.5 + 0.5) * size, sy: (1 - (c[1] / c[3] * 0.5 + 0.5)) * size, w: c[3], u, v};
  });
  const buffer = new Uint8ClampedArray(size * size * 3).fill(245);
  for (const [i0, i1, i2] of [[0, 1, 2], [0, 2, 3]]) {
    const [a, b, c] = [verts[i0], verts[i1], verts[i2]];
    const area = (b.sx - a.sx) * (c.sy - a.sy) - (c.sx - a.sx) * (b.sy - a.sy);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const px = x + 0.5, py = y + 0.5;
      const l0 = ((b.sx - px) * (c.sy - py) - (c.sx - px) * (b.sy - py)) / area;
      const l1 = ((c.sx - px) * (a.sy - py) - (a.sx - px) * (c.sy - py)) / area;
      const l2 = 1 - l0 - l1;
      if (l0 < 0 || l1 < 0 || l2 < 0) continue;
      let u, v;
      if (perspectiveCorrect) {
        const iw = l0 / a.w + l1 / b.w + l2 / c.w;
        u = (l0 * a.u / a.w + l1 * b.u / b.w + l2 * c.u / c.w) / iw;
        v = (l0 * a.v / a.w + l1 * b.v / b.w + l2 * c.v / c.w) / iw;
      } else {
        u = l0 * a.u + l1 * b.u + l2 * c.u;
        v = l0 * a.v + l1 * b.v + l2 * c.v;
      }
      buffer.set(textureLookup(gridTexture, u, v), 3 * (y * size + x));
    }
  }
  return imageCanvas(size, size, (x, y) => buffer.subarray(3 * (y * size + x), 3 * (y * size + x) + 3));
}
```

```js echo
const tilt = view(Inputs.range([0, 2], {value: 0.4, step: 0.05, label: "camera height above the floor"}));
```

```js echo
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
const wrapModes = {
  repeat: (i, n) => ((i % n) + n) % n,
  "clamp-to-edge": (i, n) => Math.max(0, Math.min(n - 1, i)),
  "mirror-repeat": (i, n) => { const m = ((i % (2 * n)) + 2 * n) % (2 * n); return m < n ? m : 2 * n - 1 - m; }
};
const photo = (() => {
  const img = raster.toImageData(raster.createTestImage(64, 48));
  return makeTexture(64, 48, (i, j) => { const k = 4 * ((47 - j) * 64 + i); return [img.data[k], img.data[k + 1], img.data[k + 2]]; });
})();
function lookupWrapped(t, u, v, mode) {
  const i = wrapModes[mode](Math.floor(u * t.width), t.width), j = wrapModes[mode](Math.floor(v * t.height), t.height);
  return texel(t, i, j);
}
```

```js echo
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
const checkerModule = device.createShaderModule({code: `
struct Uniforms { mvp: mat4x4<f32>, params: vec4<f32> };
@group(0) @binding(0) var<uniform> u: Uniforms;

struct VertexOut { @builtin(position) position: vec4<f32>, @location(0) normal: vec3<f32>, @location(1) uv: vec2<f32> };

@vertex
fn vs_main(@location(0) inPos: vec3<f32>, @location(1) inNormal: vec3<f32>, @location(2) inUV: vec2<f32>) -> VertexOut {
  var out: VertexOut;
  out.position = u.mvp * vec4<f32>(inPos, 1.0);
  out.normal = inNormal;
  out.uv = inUV;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  let cell = floor(in.uv.x * u.params.x * 2.0) + floor(in.uv.y * u.params.x);
  let parity = cell - 2.0 * floor(cell / 2.0);
  let base = mix(vec3<f32>(0.9, 0.75, 0.3), vec3<f32>(0.15, 0.25, 0.5), parity);
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
const uvSphere = geometry.createSphere(24, 32);   // createSphere duplicates the seam column (lon = 0 and lon = 32)
const uvSphereVB = makeVertexBuffer(geometry.interleave(uvSphere.positions, uvSphere.normals, uvSphere.uvs));
const uvSphereIB = makeIndexBuffer(uvSphere.indices);
// The same triangles, but the last column reuses the first column's vertices (u = 0) instead of the duplicates (u = 1).
const sharedSeamIB = makeIndexBuffer(uvSphere.indices.map((i) => (i % 33 === 32 ? i - 32 : i)));
const checkerUniforms = device.createBuffer({size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
const checkerBindGroup = device.createBindGroup({layout: checkerPipeline.getBindGroupLayout(0), entries: [{binding: 0, resource: {buffer: checkerUniforms}}]});
const checkerTarget = makeCanvas(300);
```

```js echo
const seamForm = view(Inputs.form({
  duplicated: Inputs.toggle({value: true, label: "duplicate seam vertices"}),
  density: Inputs.range([2, 16], {value: 8, step: 1, label: "checker density"}),
  azimuth: Inputs.range([-180, 180], {value: -90, step: 1, label: "orbit azimuth"}),
  elevation: Inputs.range([-80, 80], {value: 15, step: 1, label: "orbit elevation"})
}));
```

```js echo
{
  const mvp = mat4.multiply(mat4.perspective(0.73, 1, 0.1, 20), mat4.lookAt(orbitEye(seamForm.azimuth, seamForm.elevation, 3.2), [0, 0, 0], [0, 1, 0]));
  device.queue.writeBuffer(checkerUniforms, 0, new Float32Array([...mvp, seamForm.density, 0, 0, 0]));
  renderPass(checkerTarget, (pass) => {
    pass.setPipeline(checkerPipeline);
    pass.setBindGroup(0, checkerBindGroup);
    pass.setVertexBuffer(0, uvSphereVB);
    pass.setIndexBuffer(seamForm.duplicated ? uvSphereIB : sharedSeamIB, "uint16");
    pass.drawIndexed(uvSphere.indices.length);
  });
}
```

```js echo
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

```js echo
function sampleBilinear(t, u, v) {
  const up = u * t.width - 0.5, vp = v * t.height - 0.5;
  const iu0 = Math.floor(up), iv0 = Math.floor(vp), iu1 = iu0 + 1, iv1 = iv0 + 1;
  const au = iu1 - up, bu = 1 - au, av = iv1 - vp, bv = 1 - av;
  const T = (i, j) => texel(t, Math.max(0, Math.min(t.width - 1, i)), Math.max(0, Math.min(t.height - 1, j)));
  const out = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    out[k] = au * av * T(iu0, iv0)[k] + au * bv * T(iu0, iv1)[k] + bu * av * T(iu1, iv0)[k] + bu * bv * T(iu1, iv1)[k];
  }
  return out;
}
const tiny = makeTexture(8, 8, (i, j) => d3.rgb(d3.interpolateViridis(((i * 3 + j * 5) % 8) / 7)).toString().match(/\d+/g).map(Number));
```

```js echo
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

For a floor plane seen from a camera, we can compute ${tex`(u,v)`} at
every pixel by ray casting, then take finite differences between
neighboring pixels to get ${tex`J`}:

```js echo
const footprintForm = view(Inputs.form({
  height: Inputs.range([0.3, 3], {value: 1.1, step: 0.05, label: "camera height"}),
  texSize: Inputs.select([64, 256, 1024], {value: 256, label: "texture size (texels)"}),
  show: Inputs.radio(["mip level k", "anisotropy ‖long‖/‖short‖"], {value: "mip level k", label: "show"})
}));
```

```js echo
const footprint = (() => {
  const size = 180, eye = [0, footprintForm.height, -2.4];
  const target = [0, 0, 9];
  const fwd = target.map((c, i) => c - eye[i]), fl = Math.hypot(...fwd); fwd.forEach((_, i) => (fwd[i] /= fl));
  const right = [fwd[2], 0, -fwd[0]], rl = Math.hypot(...right); right.forEach((_, i) => (right[i] /= rl));
  const up = [fwd[1] * right[2] - fwd[2] * right[1], fwd[2] * right[0] - fwd[0] * right[2], fwd[0] * right[1] - fwd[1] * right[0]];   // fwd × right
  const f = 1 / Math.tan(0.87 / 2);
  const uvAt = (px, py) => {                       // (u, v) on the floor y = 0, in texels; 4 texture repeats per world unit
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
    k[py * size + px] = Math.log2(Math.max(ux, uy));
    aniso[py * size + px] = Math.max(ux, uy) / Math.min(ux, uy);
  }
  return {size, k, aniso};
})();
```

```js echo
(() => {
  const {size, k, aniso} = footprint;
  const showK = footprintForm.show === "mip level k";
  const color = showK ? d3.scaleSequential(d3.interpolateTurbo).domain([-2, 8]) : d3.scaleSequential(d3.interpolateMagma).domain([1, 12]);
  const canvas = imageCanvas(size, size, (x, y) => {
    const val = (showK ? k : aniso)[y * size + x];
    if (Number.isNaN(val)) return [235, 240, 248];
    const c = d3.rgb(color(val));
    return [c.r, c.g, c.b];
  }, 1.6);
  const finite = Array.from(showK ? k : aniso).filter(Number.isFinite);
  return html`<div style="display:flex; gap:16px; align-items:flex-start">${canvas}<div style="font:13px var(--sans-serif)">
    ${Plot.legend({color: {type: "sequential", scheme: showK ? "turbo" : "magma", domain: showK ? [-2, 8] : [1, 12], label: footprintForm.show}})}
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
function buildMipmap(t) {
  const levels = [t];
  while (levels.at(-1).width > 1) {
    const p = levels.at(-1), w = p.width >> 1, h = Math.max(1, p.height >> 1);
    levels.push(makeTexture(w, h, (i, j) => [0, 1, 2].map((c) =>
      (texel(p, 2 * i, 2 * j)[c] + texel(p, 2 * i + 1, 2 * j)[c] + texel(p, 2 * i, Math.min(p.height - 1, 2 * j + 1))[c] + texel(p, 2 * i + 1, Math.min(p.height - 1, 2 * j + 1))[c]) / 4)));
  }
  return levels;
}
const checker = makeTexture(64, 64, (i, j) => (((i >> 2) + (j >> 2)) % 2 ? [40, 50, 90] : [240, 220, 160]));
const checkerMips = buildMipmap(checker);
```

```js echo
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
  const k = Math.max(0, Math.min(mips.length - 1, Math.log2(Math.max(D, 1e-6))));
  const k0 = Math.floor(k), k1 = Math.min(mips.length - 1, k0 + 1), f = k - k0;
  const c0 = sampleBilinear(mips[k0], u, v), c1 = sampleBilinear(mips[k1], u, v);
  return c0.map((c, i) => (1 - f) * c + f * c1[i]);
}
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

```js echo
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

```js echo
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

```js echo
const bumpForm = view(Inputs.form({
  pattern: Inputs.radio(["planks", "rivets", "noise"], {value: "rivets", label: "height field"}),
  strength: Inputs.range([0.5, 8], {value: 3, step: 0.5, label: "bump strength"})
}));
```

```js echo
const bumpHeight = {
  planks: (u, v) => { const l = (v * 6) % 1; return Math.max(0, 0.4 - Math.min(l, 1 - l) * 4); },
  rivets: (u, v) => { const du = (u * 4) % 1 - 0.5, dv = (v * 4) % 1 - 0.5; return Math.max(0, 0.18 - (du * du + dv * dv)); },
  noise: (u, v) => 0.2 * perlinNoise(u * 6, v * 6, 0.5)
}[bumpForm.pattern];
function normalFromHeight(h, u, v, strength, e = 1 / 256) {
  const dhdu = (h(u + e, v) - h(u - e, v)) / (2 * e), dhdv = (h(u, v + e) - h(u, v - e)) / (2 * e);
  const n = [-strength * dhdu * 0.05, -strength * dhdv * 0.05, 1], l = Math.hypot(...n);
  return n.map((c) => c / l);
}
```

```js echo
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
  ${tex`\mathbf r = \mathbf v - 2(\mathbf v\cdot\mathbf n)\mathbf n`}.

Both are built with WebGPU at the end of this page.

## Procedural 3D Textures

### Stripes

A **solid texture** defines color at every point in 3D, so there is no
mapping, no distortion, and no seam. The simplest examples are stripes:

```js echo
const c0 = [37, 99, 170], c1 = [245, 225, 180];
const stripes = {
  "sin(x) > 0": (p, w) => (Math.sin(p.x) > 0 ? c0 : c1),
  "width w": (p, w) => (Math.sin(Math.PI * p.x / w) > 0 ? c0 : c1),
  "smooth": (p, w) => { const t = (1 + Math.sin(Math.PI * p.x / w)) / 2; return c0.map((c, k) => (1 - t) * c + t * c1[k]); }
};
const stripeWidth = view(Inputs.range([0.1, 2], {value: 0.5, step: 0.05, label: "stripe width w"}));
```

```js echo
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
    const v = [2 * rand() - 1, 2 * rand() - 1, 2 * rand() - 1], l2 = v[0] ** 2 + v[1] ** 2 + v[2] ** 2;
    if (l2 > 0 && l2 < 1) G.push(v.map((c) => c / Math.sqrt(l2)));     // keep points inside the sphere only
  }
  return {P, G};
})();
const phiIndex = (i) => perlinTables.P[((i % 256) + 256) % 256];
const omega = (t) => (Math.abs(t) < 1 ? 2 * Math.abs(t) ** 3 - 3 * t * t + 1 : 0);

function perlinNoise(x, y, z) {
  let n = 0;
  for (let i = Math.floor(x); i <= Math.floor(x) + 1; i++)
    for (let j = Math.floor(y); j <= Math.floor(y) + 1; j++)
      for (let k = Math.floor(z); k <= Math.floor(z) + 1; k++) {
        const g = perlinTables.G[phiIndex(i + phiIndex(j + phiIndex(k)))];
        const u = x - i, v = y - j, w = z - k;
        n += omega(u) * omega(v) * omega(w) * (g[0] * u + g[1] * v + g[2] * w);
      }
  return n;
}

// Turbulence: |n| summed over octaves, each half the size and half the weight.
function turbulence(x, y, z, octaves = 6) {
  let t = 0;
  for (let i = 0; i < octaves; i++) t += Math.abs(perlinNoise(2 ** i * x, 2 ** i * y, 2 ** i * z)) / 2 ** i;
  return t;
}
```

```js echo
const noiseForm = view(Inputs.form({
  scale: Inputs.range([1, 12], {value: 4, step: 0.5, label: "frequency"}),
  octaves: Inputs.range([1, 8], {value: 6, step: 1, label: "turbulence octaves"}),
  k2: Inputs.range([0, 8], {value: 3, step: 0.25, label: "turbulence in the stripes"})
}));
```

```js echo
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

```js echo
const solidForm = view(Inputs.form({
  shape: Inputs.radio(["sphere", "tall", "flat"], {value: "tall", label: "object"}),
  azimuth: Inputs.range([-180, 180], {value: 20, step: 1, label: "view azimuth"})
}));
```

```js echo
(() => {
  const [a, b] = shapeSize[solidForm.shape];
  return castEllipsoid(240, {a, b, azimuth: solidForm.azimuth, elevation: 15}, (p) => {
    const t = (1 + Math.sin(3 * p.z * noiseForm.scale / 2 + noiseForm.k2 * turbulence(p.x * 2, p.y * 2, p.z * 2, 5))) / 2;
    return [245 - 140 * t, 238 - 150 * t, 230 - 150 * t];
  });
})()
```

The veins continue smoothly around the object, and changing its shape
does not stretch them.

## Textures in WebGPU

### Creating a texture with mipmaps

A texture is a `GPUTexture` with a format, a size, and a number of mip
levels. Color data uses `rgba8unorm-srgb`, while data maps use
`rgba8unorm`. WebGPU has **no built-in mipmap generator**:
`webgpu.generateMipCanvases` builds the levels on the CPU by repeatedly
halving a canvas, and `webgpu.textureFromMipCanvases` copies each level
in with `copyExternalImageToTexture`. (Production code fills levels with
a short render or compute pass that averages the level below.)

The textures on this page are drawn on a Canvas 2D canvas before they are
uploaded. To learn how to draw your own, including bricks, wood, noise,
seamless tiling, and texture arrays, see the
[Making Textures with Canvas 2D](/tutorial-canvas2d-textures) tutorial.

```js echo
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
const floorTexture = webgpu.textureFromMipCanvases(device, webgpu.generateMipCanvases(makeCheckerCanvas(256, 16)), {label: "floor checker"});

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

```js echo
const floorVB = makeVertexBuffer(new Float32Array([
  -4, 0, 0.5, 0, 0,   4, 0, 0.5, 6, 0,   4, 0, 14, 6, 16,
  -4, 0, 0.5, 0, 0,   4, 0, 14, 6, 16,  -4, 0, 14, 0, 16
]));
const floorModule = device.createShaderModule({code: `
@group(0) @binding(0) var<uniform> mvp: mat4x4<f32>;
@group(0) @binding(1) var tex: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

struct VertexOut { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> };

@vertex
fn vs_main(@location(0) inPos: vec3<f32>, @location(1) inUV: vec2<f32>) -> VertexOut {
  var out: VertexOut;
  out.position = mvp * vec4<f32>(inPos, 1.0);
  out.uv = inUV;
  return out;
}

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  return textureSample(tex, samp, uv);   // the GPU estimates the footprint from screen-space derivatives of uv
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
const repeat = {addressModeU: "repeat", addressModeV: "repeat"};
const floorVariants = [
  ["point sampling, level 0 only", floorTexture, {magFilter: "nearest", minFilter: "nearest", mipmapFilter: "nearest", lodMaxClamp: 0, ...repeat}],
  ["bilinear, no mipmaps", floorTexture, {magFilter: "linear", minFilter: "linear", lodMaxClamp: 0, ...repeat}],
  ["trilinear", floorTexture, {magFilter: "linear", minFilter: "linear", mipmapFilter: "linear", ...repeat}],
  ["trilinear + anisotropic (16×)", floorTexture, {magFilter: "linear", minFilter: "linear", mipmapFilter: "linear", maxAnisotropy: 16, ...repeat}],
  ["which level? (trilinear)", levelTexture, {magFilter: "linear", minFilter: "linear", mipmapFilter: "linear", ...repeat}],
  ["which level? (anisotropic)", levelTexture, {magFilter: "linear", minFilter: "linear", mipmapFilter: "linear", maxAnisotropy: 16, ...repeat}]
].map(([label, texture, samplerDesc]) => ({
  label, target: makeCanvas(240),
  bindGroup: device.createBindGroup({layout: floorPipeline.getBindGroupLayout(0), entries: [
    {binding: 0, resource: {buffer: floorMVPBuffer}}, {binding: 1, resource: texture.createView()},
    {binding: 2, resource: device.createSampler(samplerDesc)}]})
}));
```

```js echo
const floorHeight = view(Inputs.range([0.2, 3], {value: 1.1, step: 0.05, label: "camera height"}));
```

```js echo
{
  device.queue.writeBuffer(floorMVPBuffer, 0, mat4.multiply(mat4.perspective(0.87, 1, 0.1, 30), mat4.lookAt([0, floorHeight, -2.4], [0, 0, 9], [0, 1, 0])));
  for (const {target, bindGroup} of floorVariants) {
    renderPass(target, (pass) => { pass.setPipeline(floorPipeline); pass.setBindGroup(0, bindGroup); pass.setVertexBuffer(0, floorVB); pass.draw(6); });
  }
}
```

```js echo
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
| `f` | a face: one `p/t/n` reference per corner | `f 1/1/2 2/2/2 6/3/2 5/4/2` |
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
f 1/1/2 2/2/2 6/3/2 5/4/2
f 3/1/3 4/2/3 8/3/3 7/4/3
f 1/1/4 4/2/4 8/3/4 5/4/4
f 2/1/5 3/2/5 7/3/5 6/4/5
usemtl Roof
f 5/1/6 6/2/6 9/5/6
f 6/1/9 7/2/9 9/5/9
f 7/1/7 8/2/7 9/5/7
f 8/1/8 5/2/8 9/5/8
`;
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

**Step 1: parse the text.** `obj.parseOBJ` (in `components/obj.js`)
reads the file line by line. `v`, `vt`, and `vn` lines are appended to
three separate lists. Each `f` corner such as `6/3/2` becomes
`{p: 5, t: 2, n: 1}`, with 1 subtracted from every index. A polygon with
corners ${tex`c_0, c_1, \dots, c_{m-1}`} is **fan-triangulated** into
${tex`(c_0, c_1, c_2), (c_0, c_2, c_3), \dots`}, so a quad becomes two
triangles. The current `usemtl` name is recorded for each triangle.
`obj.parseMTL` turns the MTL text into a lookup table by material name:

```js echo
const hutParsed = obj.parseOBJ(hutOBJText);
const hutMTL = obj.parseMTL(hutMTLText);
```

The first `f` line, a quad, became the first two triangles. Note the
0-based indices and the shared corner ${tex`c_0`}:

```js echo
Inputs.table(hutParsed.faces.slice(0, 2).flatMap((tri, k) => tri.map((c, j) => ({
  triangle: k, corner: j, "position p": c.p, "texcoord t": c.t, "normal n": c.n, material: hutParsed.faceMaterials[k]
}))))
```

**Step 2: one GPU vertex per distinct `p/t/n`.** `obj.buildIndexedMesh`
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
const hutGroups = [...obj.groupFacesByMaterial(hutParsed)].map(([name, faces]) => ({
  name, material: hutMTL[name], ...obj.buildIndexedMesh(hutParsed, faces)
}));
```

```js echo
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
device.queue.copyExternalImageToTexture({source: bitmap}, {texture}, [bitmap.width, bitmap.height]);
```

This page has no image files, so it maps each file name to a canvas
drawn in code. `textureFromCanvas` copies a canvas into a new texture,
exactly as it would copy a decoded image. Color textures use the
`-srgb` format, as explained in the normal-mapping section below. A
material with no `map_Kd` gets a **1 × 1 white** texture, so the shader
can always compute `Kd × texture` without a special case:

```js echo
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


function textureFromCanvas(canvas, format) {
  const texture = device.createTexture({size: [canvas.width, canvas.height], format,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT});
  device.queue.copyExternalImageToTexture({source: canvas}, {texture}, [canvas.width, canvas.height]);
  return texture;
}

// Stand-ins for the image files named by map_Kd.
const imageFiles = {"planks.png": plankCanvas, "shingles.png": shingleCanvas};
const textureForMaterial = (m) => textureFromCanvas(imageFiles[m?.map_Kd] ?? whiteCanvas, "rgba8unorm-srgb");
```

**Step 4: one textured pipeline.** Each vertex is 8 floats: position,
normal, and UV. The fragment shader samples the material's texture,
multiplies by `Kd`, and applies Lambert lighting. Lighting happens in
linear space, so the last line re-encodes the color for the non-sRGB
canvas:

```js echo
const VERTEX_FLOATS = 8;   // 3 position + 3 normal + 2 uv

function packVertices(positions, normals, uvs) {
  const data = new Float32Array(positions.length * VERTEX_FLOATS);
  positions.forEach((p, i) => {
    const n = normals[i], uv = uvs[i];
    data.set([p.x, p.y, p.z, n.x, n.y, n.z, uv.u, uv.v], i * VERTEX_FLOATS);
  });
  return data;
}

const modelModule = device.createShaderModule({code: `
struct Uniforms { mvp: mat4x4<f32>, kd: vec4<f32> };
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var diffuseTex: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

struct VertexOut { @builtin(position) position: vec4<f32>, @location(0) normal: vec3<f32>, @location(1) uv: vec2<f32> };

@vertex
fn vs_main(@location(0) inPos: vec3<f32>, @location(1) inNormal: vec3<f32>, @location(2) inUV: vec2<f32>) -> VertexOut {
  var out: VertexOut;
  out.position = u.mvp * vec4<f32>(inPos, 1.0);
  out.normal = inNormal;
  out.uv = inUV;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  let albedo = u.kd.rgb * textureSample(diffuseTex, samp, in.uv).rgb;   // Kd x map_Kd
  let ndotl = max(dot(normalize(in.normal), normalize(vec3<f32>(0.4, 0.7, 0.55))), 0.0);
  let linearColor = albedo * (0.3 + 0.7 * ndotl);
  return vec4<f32>(pow(linearColor, vec3<f32>(1.0 / 2.2)), 1.0);
}`});

const modelPipeline = device.createRenderPipeline({
  layout: "auto",
  vertex: {module: modelModule, entryPoint: "vs_main", buffers: [{arrayStride: VERTEX_FLOATS * 4, attributes: [
    {shaderLocation: 0, offset: 0, format: "float32x3"},        // position
    {shaderLocation: 1, offset: 3 * 4, format: "float32x3"},    // normal
    {shaderLocation: 2, offset: 6 * 4, format: "float32x2"}]}]},  // uv
  fragment: {module: modelModule, entryPoint: "fs_main", targets: [{format: canvasFormat}]},
  primitive: {topology: "triangle-list", cullMode: "none"},
  depthStencil: {format: "depth24plus", depthWriteEnabled: true, depthCompare: "less"}
});
const modelSampler = device.createSampler({magFilter: "linear", minFilter: "linear", addressModeU: "repeat", addressModeV: "repeat"});
```

**Step 5: one draw per material.** Each `usemtl` group becomes a
**part**: its geometry, a uniform buffer (its matrix and `Kd`), and a
bind group that points at its texture. The geometry uses the buffer
helpers from the course library, `reference/src/lib/webgpu.js` (copied
into `components/lib/webgpu.js`), the same ones the assignments use:

- An **indexed** part becomes a `Mesh`. `new Mesh(device, {vertices,
  indices})` uploads both buffers, and `mesh.draw(pass)` binds them and
  calls `drawIndexed` with the right count and index format.
- A **non-indexed** part (the flat-shaded city below) is just a vertex
  buffer from `createBuffer(device, data, GPUBufferUsage.VERTEX)`, drawn
  with `pass.draw(count)`.

Drawing the model means drawing every part:

```js echo
function makeModelPart({vertices, indices = null, count, material}) {
  const uniforms = device.createBuffer({size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
  return {
    mesh: indices ? new Mesh(device, {vertices, indices}) : null,                // indexed
    vertexBuffer: indices ? null : createBuffer(device, vertices, GPUBufferUsage.VERTEX),  // non-indexed
    count,
    kd: material?.Kd ?? [0.8, 0.8, 0.8],
    uniforms,
    bindGroup: device.createBindGroup({layout: modelPipeline.getBindGroupLayout(0), entries: [
      {binding: 0, resource: {buffer: uniforms}},
      {binding: 1, resource: textureForMaterial(material).createView()},
      {binding: 2, resource: modelSampler}]})
  };
}

function drawModel(target, parts, mvp) {
  for (const part of parts) device.queue.writeBuffer(part.uniforms, 0, new Float32Array([...mvp, ...part.kd, 1]));
  renderPass(target, (pass) => {
    pass.setPipeline(modelPipeline);
    for (const part of parts) {
      pass.setBindGroup(0, part.bindGroup);
      if (part.mesh) part.mesh.draw(pass);                                       // drawIndexed
      else { pass.setVertexBuffer(0, part.vertexBuffer); pass.draw(part.count); }
    }
  });
}
```

```js echo
const hutParts = hutGroups.map((g) => makeModelPart({
  vertices: packVertices(g.positions, g.normals, g.uvs), indices: g.indices, count: g.indices.length, material: g.material
}));
const hutModelTarget = makeCanvas(300);
```

```js echo
const hutModelAzimuth = view(Inputs.range([-180, 180], {value: 40, step: 1, label: "orbit azimuth"}));
```

```js echo
drawModel(hutModelTarget, hutParts,
  mat4.multiply(mat4.perspective(0.7, 1, 0.1, 30), mat4.lookAt(orbitEye(hutModelAzimuth, 25, 5.2, [0, 1, 0]), [0, 1, 0], [0, 1, 0])));
```

```js echo
raster.sideBySide([
  ["planks.png", (() => { plankCanvas.style.width = "128px"; return plankCanvas; })()],
  ["shingles.png", (() => { shingleCanvas.style.width = "128px"; return shingleCanvas; })()],
  [`${hutParts.length} materials → ${hutParts.length} draw calls`, hutModelTarget.canvas]
])
```

**A real asset.** `data/city.obj` is a Blender export. It has **no
`vn` or `vt` lines**, and its materials have `Kd` colors but no
`map_Kd`. Loading it starts the same way:

```js echo
const cityOBJ = obj.parseOBJ(await FileAttachment("./data/city.obj").text());
const cityMTL = obj.parseMTL(await FileAttachment("./data/city.mtl").text());
const cityGroups = obj.groupFacesByMaterial(cityOBJ);
```

Without normals in the file, we **flat-shade**: every corner of a
triangle gets that triangle's face normal, the normalized cross product
of two edges. The same position needs a different normal in each
triangle that touches it, so corners can no longer be shared, and the
result is **separate triangles**, drawn with `draw` instead of
`drawIndexed`. Exporters sometimes leave **zero-area** triangles (three
collinear corners). Their cross product is zero, so they have no normal,
and we skip them. With no `vt` lines, every UV is ${tex`(0,0)`}, which is
fine because these materials use the white texture:

```js echo
function triangleCross(p0, p1, p2) {           // (p1 - p0) × (p2 - p0)
  const ux = p1.x - p0.x, uy = p1.y - p0.y, uz = p1.z - p0.z;
  const vx = p2.x - p0.x, vy = p2.y - p0.y, vz = p2.z - p0.z;
  return {x: uy * vz - uz * vy, y: uz * vx - ux * vz, z: ux * vy - uy * vx};
}

function flatShade(positions, faces) {
  const out = {positions: [], normals: [], uvs: []};
  for (const tri of faces) {
    const [p0, p1, p2] = tri.map((corner) => positions[corner.p]);
    const c = triangleCross(p0, p1, p2), len = Math.hypot(c.x, c.y, c.z);
    if (len < 1e-8) continue;                                   // degenerate: no normal
    const n = {x: c.x / len, y: c.y / len, z: c.z / len};
    for (const p of [p0, p1, p2]) { out.positions.push(p); out.normals.push(n); out.uvs.push({u: 0, v: 0}); }
  }
  return out;
}

const cityParts = [...cityGroups].map(([name, faces]) => {
  const flat = flatShade(cityOBJ.positions, faces);
  return makeModelPart({vertices: packVertices(flat.positions, flat.normals, flat.uvs), count: flat.positions.length, material: cityMTL[name]});
});
const cityTarget = makeCanvas(360);
```

We don't know the model's units or size in advance, so the camera is
fitted to its **bounding box**: aim at the box's center, and orbit at a
distance proportional to its largest side:

```js echo
const cityExtent = ["x", "y", "z"].map((k) => d3.extent(cityOBJ.positions, (p) => p[k]));  // [min, max] per axis
const cityCenter = cityExtent.map(([lo, hi]) => (lo + hi) / 2);
const cityRadius = d3.max(cityExtent, ([lo, hi]) => hi - lo) / 2;
```

```js echo
const cityOrbit = view(Inputs.range([-180, 180], {value: -35, step: 1, label: "orbit azimuth"}));
```

```js echo
drawModel(cityTarget, cityParts, mat4.multiply(
  mat4.perspective(Math.PI / 4, 1, cityRadius * 0.01, cityRadius * 8),
  mat4.lookAt(orbitEye(cityOrbit, 40, cityRadius * 2.1, cityCenter), cityCenter, [0, 1, 0])));
```

```js echo
raster.sideBySide([[`${cityOBJ.faces.length.toLocaleString()} triangles, ${cityParts.length} materials → ${cityParts.length} draw calls`, cityTarget.canvas]])
```

### Sampling in WGSL and normal mapping

The vertex buffer gains a UV attribute (and a tangent for normal
mapping). In the fragment shader, `textureSample(tex, samp, uv)` does
the filtering. It works only in the **fragment** stage, because it needs
screen-space derivatives. A vertex shader, for example one doing
displacement, uses `textureSampleLevel` with an explicit level.

For normal mapping, build the frame ${tex`[\mathbf T\ \mathbf B\ \mathbf N]`}
at each fragment, decode ${tex`\mathbf n = 2\mathbf c - 1`}, and rotate it
into world space. `obj.computeTangents` computes the per-vertex tangent
${tex`\mathbf T`} (the direction of increasing ${tex`u`}) from each
triangle's positions and UVs. We reuse the hut and its plank texture
from the previous section, as one indexed mesh:

```js echo
const hutMesh = obj.buildIndexedMesh(hutParsed, hutParsed.faces);
const hutTangents = obj.computeTangents(hutMesh.positions, hutMesh.uvs, hutMesh.indices);

// The normal map derived from the planks' groove height field.
const plankHeight = (u, v) => { const l = (v * 6) % 1; return Math.max(0, 0.4 - Math.min(l, 1 - l) * 4); };
const plankNormalCanvas = imageCanvas(128, 128, (x, y) => normalFromHeight(plankHeight, x / 128, y / 128, 2).map((c) => 255 * (c * 0.5 + 0.5)));

const hutAlbedo = textureFromCanvas(plankCanvas, "rgba8unorm-srgb");      // color: sRGB
const hutNormalMap = textureFromCanvas(plankNormalCanvas, "rgba8unorm");  // data: linear
const hutSampler = device.createSampler({magFilter: "linear", minFilter: "linear", addressModeU: "repeat", addressModeV: "repeat"});

const hutData = new Float32Array(hutMesh.positions.length * 11);
hutMesh.positions.forEach((p, i) => {
  const n = hutMesh.normals[i], uv = hutMesh.uvs[i], t = hutTangents[i];
  hutData.set([p.x, p.y, p.z, n.x, n.y, n.z, uv.u, uv.v, t.x, t.y, t.z], i * 11);
});
const hutVB = makeVertexBuffer(hutData);
const hutIB = makeIndexBuffer(hutMesh.indices);

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
  var out: VertexOut;
  out.position = u.mvp * vec4<f32>(inPos, 1.0);
  out.worldNormal = inNormal;    // the model matrix is the identity here
  out.worldTangent = inTangent;
  out.uv = inUV;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  let N0 = normalize(in.worldNormal);
  let T = normalize(in.worldTangent - N0 * dot(in.worldTangent, N0));   // re-orthogonalize after interpolation
  let B = cross(N0, T);
  let c = textureSample(normalTex, samp, in.uv).rgb;
  let mapped = normalize(mat3x3<f32>(T, B, N0) * (2.0 * c - 1.0));       // [T B N] (2c - 1)
  let N = select(N0, mapped, u.params.x > 0.5);
  let albedo = textureSample(albedoTex, samp, in.uv).rgb;
  let ndotl = max(dot(N, normalize(vec3<f32>(0.4, 0.7, 0.55))), 0.0);
  let linearColor = albedo * (0.25 + 0.75 * ndotl);
  return vec4<f32>(pow(linearColor, vec3<f32>(1.0 / 2.2)), 1.0);   // encode for the non-sRGB canvas
}`});
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
const hutTarget = makeCanvas(300);
```

```js echo
const hutForm = view(Inputs.form({
  normalMap: Inputs.toggle({value: true, label: "use normal map"}),
  azimuth: Inputs.range([-180, 180], {value: 40, step: 1, label: "orbit azimuth"})
}));
```

```js echo
{
  const mvp = mat4.multiply(mat4.perspective(0.7, 1, 0.1, 30), mat4.lookAt(orbitEye(hutForm.azimuth, 25, 5.2, [0, 1, 0]), [0, 1, 0], [0, 1, 0]));
  device.queue.writeBuffer(hutUniforms, 0, new Float32Array([...mvp, hutForm.normalMap ? 1 : 0, 0, 0, 0]));
  renderPass(hutTarget, (pass) => {
    pass.setPipeline(hutPipeline); pass.setBindGroup(0, hutBindGroup);
    pass.setVertexBuffer(0, hutVB); pass.setIndexBuffer(hutIB, "uint16"); pass.drawIndexed(hutMesh.indices.length);
  });
}
```

```js echo
raster.sideBySide([["normal map", (() => { plankNormalCanvas.style.width = "128px"; return plankNormalCanvas; })()], ["normal-mapped hut", hutTarget.canvas]])
```

Turn the normal map off and the walls flatten to their face normals:
same geometry, same albedo, only the lighting normal changes. Note the
last line of the shader: the albedo texture is `rgba8unorm-srgb`, so
sampling **decodes** it to linear values, lighting is computed in linear
space, and the result must be **re-encoded** (approximately
${tex`c^{1/2.2}`}) because the canvas format is not sRGB.

### Environment maps with cube textures

A cube texture has **six layers**, viewed with `dimension: "cube"`, and
is sampled with a 3D **direction** rather than ${tex`(u,v)`}. The GPU
picks the face. Each face below is a canvas painted with a sky gradient
and its own label:

```js echo
const faceNames = ["+X", "−X", "+Y", "−Y", "+Z", "−Z"];
const envTexture = (() => {
  const size = 256;
  const texture = device.createTexture({size: [size, size, 6], format: "rgba8unorm-srgb",
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
const envModule = device.createShaderModule({code: `
struct Uniforms { mvp: mat4x4<f32>, eye: vec4<f32>, params: vec4<f32> };
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var envTex: texture_cube<f32>;
@group(0) @binding(2) var envSamp: sampler;

struct VertexOut { @builtin(position) position: vec4<f32>, @location(0) worldPos: vec3<f32>, @location(1) normal: vec3<f32> };

@vertex
fn vs_main(@location(0) inPos: vec3<f32>, @location(1) inNormal: vec3<f32>) -> VertexOut {
  var out: VertexOut;
  out.position = u.mvp * vec4<f32>(inPos, 1.0);
  out.worldPos = inPos;
  out.normal = inNormal;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  let v = normalize(in.worldPos - u.eye.xyz);   // view ray direction
  let n = normalize(in.normal);
  let r = reflect(v, n);                        // r = v - 2 (v·n) n
  let dir = select(r, v, u.params.x > 0.5);     // params.x = 1: look straight through (a window, not a mirror)
  return vec4<f32>(pow(textureSample(envTex, envSamp, dir).rgb, vec3<f32>(1.0 / 2.2)), 1.0);   // sRGB texture -> linear -> re-encode
}`});
const envPipeline = device.createRenderPipeline({
  layout: "auto",
  vertex: {module: envModule, entryPoint: "vs_main", buffers: [{arrayStride: 24, attributes: [
    {shaderLocation: 0, offset: 0, format: "float32x3"}, {shaderLocation: 1, offset: 12, format: "float32x3"}]}]},
  fragment: {module: envModule, entryPoint: "fs_main", targets: [{format: canvasFormat}]},
  primitive: {topology: "triangle-list", cullMode: "back"},
  depthStencil: {format: "depth24plus", depthWriteEnabled: true, depthCompare: "less"}
});
const envSphere = geometry.createSphere(40, 56);
const envVB = makeVertexBuffer(geometry.interleave(envSphere.positions, envSphere.normals));
const envIB = makeIndexBuffer(envSphere.indices);
const envUniforms = device.createBuffer({size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
const envBindGroup = device.createBindGroup({layout: envPipeline.getBindGroupLayout(0), entries: [
  {binding: 0, resource: {buffer: envUniforms}}, {binding: 1, resource: envTexture.createView({dimension: "cube"})},
  {binding: 2, resource: device.createSampler({magFilter: "linear", minFilter: "linear"})}]});
const envTarget = makeCanvas(300);
```

```js echo
const envForm = view(Inputs.form({
  azimuth: Inputs.range([-180, 180], {value: 0, step: 1, label: "orbit azimuth"}),
  elevation: Inputs.range([-80, 80], {value: 10, step: 1, label: "orbit elevation"}),
  through: Inputs.toggle({value: false, label: "show the view direction instead of the reflection"})
}));
```

```js echo
{
  const eye = orbitEye(envForm.azimuth, envForm.elevation, 3);
  const mvp = mat4.multiply(mat4.perspective(0.8, 1, 0.1, 20), mat4.lookAt(eye, [0, 0, 0], [0, 1, 0]));
  device.queue.writeBuffer(envUniforms, 0, new Float32Array([...mvp, ...eye, 1, envForm.through ? 1 : 0, 0, 0, 0]));
  renderPass(envTarget, (pass) => {
    pass.setPipeline(envPipeline); pass.setBindGroup(0, envBindGroup);
    pass.setVertexBuffer(0, envVB); pass.setIndexBuffer(envIB, "uint16"); pass.drawIndexed(envSphere.indices.length);
  });
}
```

```js echo
envTarget.canvas
```

The mirror ball shows the environment **behind the viewer** in its
center and the whole surrounding sky toward its rim, squeezed by the
reflection. Orbit around and the face labels change. The ball reflects
only the environment, never other objects in the scene. The toggle
replaces ${tex`\mathbf r`} with the view direction itself, which shows
the face directly behind the sphere.

### Shadow maps

Shadow mapping takes **two passes**. Pass 1 renders the scene from the
light into a `depth32float` texture, with no color at all. Pass 2
renders from the camera and compares each fragment's depth in the
light's view with the stored depth, using a **comparison sampler**:

```js echo
const SHADOW_SIZE = 1024;
const shadowMap = device.createTexture({size: [SHADOW_SIZE, SHADOW_SIZE], format: "depth32float",
  usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING});

const sceneLayout = device.createBindGroupLayout({entries: [{binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {type: "uniform"}}]});
const objectLayout = device.createBindGroupLayout({entries: [{binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {type: "uniform"}}]});
const shadowLayout = device.createBindGroupLayout({entries: [
  {binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {sampleType: "depth"}},
  {binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {type: "comparison"}}]});

const shadowModule = device.createShaderModule({code: `
struct Scene { camVP: mat4x4<f32>, lightVP: mat4x4<f32>, lightDir: vec4<f32>, params: vec4<f32> };  // params: bias, pcf, texel
struct Object { model: mat4x4<f32>, color: vec4<f32> };
@group(0) @binding(0) var<uniform> scene: Scene;
@group(1) @binding(0) var<uniform> object: Object;
@group(2) @binding(0) var shadowTex: texture_depth_2d;
@group(2) @binding(1) var shadowSmp: sampler_comparison;

// Pass 1: depth only, seen from the light.
@vertex
fn vs_depth(@location(0) pos: vec3<f32>) -> @builtin(position) vec4<f32> {
  return scene.lightVP * object.model * vec4<f32>(pos, 1.0);
}

struct VertexOut { @builtin(position) position: vec4<f32>, @location(0) normal: vec3<f32>, @location(1) lightClip: vec4<f32> };

// Pass 2: from the camera.
@vertex
fn vs_main(@location(0) pos: vec3<f32>, @location(1) normal: vec3<f32>) -> VertexOut {
  let world = object.model * vec4<f32>(pos, 1.0);
  var out: VertexOut;
  out.position = scene.camVP * world;
  out.normal = (object.model * vec4<f32>(normal, 0.0)).xyz;
  out.lightClip = scene.lightVP * world;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  let ndc = in.lightClip.xyz / in.lightClip.w;
  let uv = ndc.xy * vec2<f32>(0.5, -0.5) + 0.5;   // NDC -> texture coordinates (v points down)
  let refDepth = ndc.z - scene.params.x;          // d - bias
  var lit = 0.0;
  if (scene.params.y > 0.5) {                     // 5 x 5 percentage-closer filtering
    for (var dy = -2; dy <= 2; dy++) {
      for (var dx = -2; dx <= 2; dx++) {
        lit += textureSampleCompareLevel(shadowTex, shadowSmp, uv + vec2<f32>(f32(dx), f32(dy)) * scene.params.z, refDepth);
      }
    }
    lit /= 25.0;
  } else {
    lit = textureSampleCompareLevel(shadowTex, shadowSmp, uv, refDepth);   // 1 = lit, 0 = shadowed
  }
  let ndotl = max(dot(normalize(in.normal), -scene.lightDir.xyz), 0.0);
  return vec4<f32>(object.color.rgb * (0.25 + 0.75 * ndotl * lit), 1.0);
}`});
const meshLayout = {arrayStride: 24, attributes: [{shaderLocation: 0, offset: 0, format: "float32x3"}, {shaderLocation: 1, offset: 12, format: "float32x3"}]};
const depthPipeline = device.createRenderPipeline({
  layout: device.createPipelineLayout({bindGroupLayouts: [sceneLayout, objectLayout]}),
  vertex: {module: shadowModule, entryPoint: "vs_depth", buffers: [meshLayout]},   // no fragment stage: depth only
  primitive: {topology: "triangle-list", cullMode: "back"},
  depthStencil: {format: "depth32float", depthWriteEnabled: true, depthCompare: "less"}
});
const shadedPipeline = device.createRenderPipeline({
  layout: device.createPipelineLayout({bindGroupLayouts: [sceneLayout, objectLayout, shadowLayout]}),
  vertex: {module: shadowModule, entryPoint: "vs_main", buffers: [meshLayout]},
  fragment: {module: shadowModule, entryPoint: "fs_main", targets: [{format: canvasFormat}]},
  primitive: {topology: "triangle-list", cullMode: "back"},
  depthStencil: {format: "depth24plus", depthWriteEnabled: true, depthCompare: "less"}
});
const comparisonSampler = device.createSampler({compare: "less", magFilter: "linear", minFilter: "linear"});  // linear: 2 × 2 hardware PCF
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
  {mesh: boxMesh, model: mat4.multiply(mat4.translate(0, -0.05, 0), mat4.scale(4, 0.05, 4)), color: [0.75, 0.75, 0.72]},
  {mesh: shadowSphere, model: mat4.multiply(mat4.translate(-0.9, 0.7, 0.3), mat4.scale(0.7, 0.7, 0.7)), color: [0.85, 0.35, 0.25]},
  {mesh: boxMesh, model: mat4.multiply(mat4.translate(1.0, 0.55, -0.6), mat4.multiply(mat4.rotateY(0.6), mat4.scale(0.45, 0.55, 0.45))), color: [0.25, 0.45, 0.8]}
].map((o) => {
  const uniforms = device.createBuffer({size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
  device.queue.writeBuffer(uniforms, 0, new Float32Array([...o.model, ...o.color, 1]));
  return {...o, vb: makeVertexBuffer(geometry.interleave(o.mesh.positions, o.mesh.normals)), ib: makeIndexBuffer(o.mesh.indices),
    bindGroup: device.createBindGroup({layout: objectLayout, entries: [{binding: 0, resource: {buffer: uniforms}}]})};
});
const shadowTarget = makeCanvas(340);
```

```js echo
const shadowForm = view(Inputs.form({
  azimuth: Inputs.range([-180, 180], {value: 50, step: 1, label: "light azimuth"}),
  elevation: Inputs.range([15, 85], {value: 45, step: 1, label: "light elevation"}),
  bias: Inputs.range([0, 0.02], {value: 0.003, step: 0.0005, label: "shadow bias ε"}),
  pcf: Inputs.toggle({value: true, label: "percentage-closer filtering (5 × 5)"})
}));
```

```js echo
{
  const lightPos = orbitEye(shadowForm.azimuth, shadowForm.elevation, 8);
  const lightDir = lightPos.map((c) => -c / Math.hypot(...lightPos));       // direction the light travels
  const lightVP = mat4.multiply(mat4.ortho(-4.5, 4.5, -4.5, 4.5, 1, 16), mat4.lookAt(lightPos, [0, 0, 0], [0, 1, 0]));
  const camVP = mat4.multiply(mat4.perspective(0.8, 1, 0.1, 40), mat4.lookAt([3.2, 4.2, 6.5], [0, 0.3, 0], [0, 1, 0]));
  device.queue.writeBuffer(sceneUniforms, 0, new Float32Array([...camVP, ...lightVP, ...lightDir, 0, shadowForm.bias, shadowForm.pcf ? 1 : 0, 1 / SHADOW_SIZE, 0]));

  const encoder = device.createCommandEncoder();
  // Pass 1: render depth from the light into the shadow map.
  const depthPass = encoder.beginRenderPass({colorAttachments: [],
    depthStencilAttachment: {view: shadowMap.createView(), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store"}});
  depthPass.setPipeline(depthPipeline);
  depthPass.setBindGroup(0, sceneBindGroup);
  for (const o of sceneObjects) {
    depthPass.setBindGroup(1, o.bindGroup); depthPass.setVertexBuffer(0, o.vb); depthPass.setIndexBuffer(o.ib, "uint16");
    depthPass.drawIndexed(o.mesh.indices.length);
  }
  depthPass.end();
  // Pass 2: render from the camera, reading the shadow map.
  const mainPass = encoder.beginRenderPass({
    colorAttachments: [{view: shadowTarget.context.getCurrentTexture().createView(), clearValue: {r: 0.05, g: 0.05, b: 0.08, a: 1}, loadOp: "clear", storeOp: "store"}],
    depthStencilAttachment: {view: shadowTarget.depthTexture.createView(), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store"}});
  mainPass.setPipeline(shadedPipeline);
  mainPass.setBindGroup(0, sceneBindGroup);
  mainPass.setBindGroup(2, shadowBindGroup);
  for (const o of sceneObjects) {
    mainPass.setBindGroup(1, o.bindGroup); mainPass.setVertexBuffer(0, o.vb); mainPass.setIndexBuffer(o.ib, "uint16");
    mainPass.drawIndexed(o.mesh.indices.length);
  }
  mainPass.end();
  device.queue.submit([encoder.finish()]);
}
```

```js echo
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
`textureSampleCompare` but with an explicit level. It is valid anywhere
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
10. Two triangles, from fan triangulation: ${tex`(c_0,c_1,c_2)`} and ${tex`(c_0,c_2,c_3)`}. Both share position index 2 (OBJ's 3, minus 1).
11. The GPU has one index per vertex, which selects position, normal, and UV together. A hut corner touches faces with different normals and texture coordinates, so each distinct `p/t/n` combination needs its own vertex. These duplicates are exactly the seam vertices.

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
- **WebGPU:** textures with mip levels, samplers that select the
  filtering, `textureSample`, `texture_cube`, and depth textures with
  comparison samplers.
