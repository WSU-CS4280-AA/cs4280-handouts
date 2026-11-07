---
title: Module 05 — Surface Shading
toc: true
---

```js
import * as vec2 from "./components/vec2.js";
import * as mat2 from "./components/mat2.js";
import * as mat4 from "./lib/math/mat4.js";
import * as transforms from "./lib/math/transforms.js";
import * as geometry from "./components/geometry.js";
import {initializeWebGPU, createBuffer} from "./lib/webgpu.js";
import {plane, drawArrow, dragVectors} from "./components/vectorField.js";
import * as Inputs from "npm:@observablehq/inputs";
import {html} from "npm:htl";
```

# Module 05 · Surface Shading and Illumination

Module 04 rendered a flat-colored triangle: geometry with no sense of
light. This module is about the second question: given a shape, *what
does it look like*?

| Topic | Question it answers |
|---|---|
| **Light and appearance** | What inputs decide a surface's color, and how do normals transform? |
| **Illumination models** | How do Lambert, Phong, and Blinn-Phong compute brightness? |
| **Shading in WebGPU** | Where in the pipeline is lighting evaluated: per face, per vertex, or per fragment? |

The WebGPU section reuses Module 04's seven-step skeleton; only the
shaders change, growing to carry normals and evaluate an illumination
equation. The page requests a GPU device at the top and needs **Chrome
or Edge 113+**. This handout teaches the *techniques* behind the module;
it is not a walkthrough of any graded assignment. The code is part of the
reading: lighting code and shaders are shown in small pieces, while plots,
sliders, and repeated setup stay out of sight.

Module 04 wrote every WebGPU step out by hand. From here on, the setup and
data uploads use the course library, `lib/webgpu.js`, the same file as
`src/lib/webgpu.js` in the starter repository that the activities and
assignments use:

- `initializeWebGPU(canvas)` requests the adapter and device and configures
  the canvas. It takes a canvas or a canvas ID. Passing `{device}` reuses a
  device, so all the canvases on a page can share one.
- `createBuffer(device, data, usage)` creates a buffer of the right size, adds
  `COPY_DST`, and writes `data` into it. Buffers that start empty, such as
  uniforms filled in later, still use `device.createBuffer`.

```js echo
// A blank canvas: each demo adds its own below.
const {device, format: canvasFormat} =
  await initializeWebGPU(document.createElement("canvas"));
```

Most WebGPU mistakes, such as a bad buffer size or a bind group that
does not match its pipeline's layout, do not throw a JavaScript
exception. The call quietly fails validation and reports it
*asynchronously* to `device`'s `"uncapturederror"` event, the same way
`device.lost` reports a driver reset. Listening for that event once, here,
makes any such error appear on the page instead of only in the browser
console:

```js echo
const deviceErrorLog =
  html`<pre style="display: none; color: #e5484d"></pre>`;
device.addEventListener("uncapturederror", (event) => {
  deviceErrorLog.textContent += `WebGPU error: ${event.error.message}\n`;
  deviceErrorLog.style.display = "block";
});
```

```js
deviceErrorLog
```

## Light and Appearance

### Geometry vs. appearance

**Geometry** (vertex positions and connectivity) answers "what is the
shape?" **Appearance** answers "what does it look like under light?",
combining geometry (normals), light, material, and viewer position.
**Local illumination** (this module) computes a point's color from direct
light only; **global illumination** (ray tracing, later) accounts for
light bouncing between surfaces. Classical real-time graphics patches the
missing indirect term with a constant **ambient** fill.

| Light type | Defined by | Behavior |
|---|---|---|
| Ambient | Nothing | Uniform fill, no direction |
| Point | Position | Radiates in all directions, attenuates with distance |
| Directional | Direction only | Parallel rays (sunlight) |
| Spotlight | Position, direction, cone | Falls off near the cone edge |
| Area | Extended shape | Soft shadows; needs Monte Carlo sampling (later) |

For a point light, direction must be recomputed at every surface point:

${tex.block`\mathbf{L} = \widehat{\mathbf{p}_{light}-\mathbf{p}}`}

### Normals, and why transforming them is not free

A **surface normal** is a unit vector perpendicular to the surface. It
is the most important geometric input to lighting, since every
illumination equation depends on the angle between normal and light.
Positions transform as ${tex`\mathbf p' = M\mathbf p`}, and it is
tempting to transform normals the same way, but that only works for
rotation and *uniform* scaling. Under **non-uniform** scaling, applying
**M** directly can leave a normal no longer perpendicular to the
transformed surface. The fix is the **inverse-transpose**:

${tex.block`\mathbf{n}' = M^{-T}\mathbf{n}\ \text{(then re-normalize)}`}

To test this, start with a tilted edge and its normal, which are perpendicular by
construction. Then scale them with Module 01's `mat2` toolkit, using the sliders
below for ${tex`M`}:

```js echo
const tiltAngle = (35 * Math.PI) / 180;
const edgeDir = {x: Math.cos(tiltAngle), y: Math.sin(tiltAngle)};
const normalDir = {x: -Math.sin(tiltAngle), y: Math.cos(tiltAngle)};
const M2 = mat2.scaling(normalForm.sx, normalForm.sy);
const edgeT = mat2.apply(M2, edgeDir);
```

The two candidates for the transformed normal differ only in the matrix they use.
The inverse-transpose is built exactly as its name says:

```js echo
const naiveNormalT = vec2.normalize(mat2.apply(M2, normalDir));
const inverseTranspose = mat2.transpose(mat2.invert(M2));
const correctNormalT =
  vec2.normalize(mat2.apply(inverseTranspose, normalDir));
```

A true normal has a dot product of 0 with the edge, and that is our test:

```js echo
const dotNaive = vec2.dot(vec2.normalize(edgeT), naiveNormalT);
const dotCorrect = vec2.dot(vec2.normalize(edgeT), correctNormalT);
```

Below, the edge (gray) is scaled non-uniformly. The naive transform
${tex`M\mathbf n`} (orange) and the correct ${tex`M^{-T}\mathbf n`} (green)
start identical at `sx = sy` but diverge the moment scaling turns non-uniform.

```js
const normalForm = view(Inputs.form({
  sx: Inputs.range([0.3, 2.5], {value: 1.8, step: 0.05, label: "scale sx"}),
  sy: Inputs.range([0.3, 2.5], {value: 0.6, step: 0.05, label: "scale sy"})
}));
```

```js
(() => {
  const scene = plane({domain: 2.2});
  const edgeExtent = vec2.scale(vec2.normalize(edgeT), 2);
  scene.svg.append("line")
    .attr("x1", scene.x(-edgeExtent.x)).attr("y1", scene.y(-edgeExtent.y))
    .attr("x2", scene.x(edgeExtent.x)).attr("y2", scene.y(edgeExtent.y))
    .attr("stroke", "gray").attr("stroke-width", 3);
  drawArrow(scene, {x: 0, y: 0}, vec2.scale(naiveNormalT, 1.3), {color: "orangered", label: "naive: M·n"});
  drawArrow(scene, {x: 0, y: 0}, vec2.scale(correctNormalT, 1.3), {color: "seagreen", label: "correct: M⁻ᵀ·n"});
  return scene.svg.node();
})()
```

`edge · naive normal` = ${dotNaive.toFixed(3)}, but a true normal needs
0. `edge · correct normal` = ${dotCorrect.toFixed(3)}, which stays zero to
floating-point precision *regardless* of how non-uniform the scale gets.
Set `sx = sy` and the orange arrow snaps back onto the green one. The
naive shortcut looks correct under uniform scaling, which is why this bug
can hide for a long time in a real project.

## Illumination Models

### Lambert's cosine law

**Diffuse** reflection scatters incoming light equally in every outgoing
direction, so brightness depends only on how much energy arrives, which
depends on the angle of incidence:

${tex.block`I_d = k_d\,\max(\mathbf{N}\cdot\mathbf{L},\ 0)\,I_L`}

The `max(·, 0)` clamp matters: a negative dot product means the light
is behind the surface, contributing zero, never negative, light. Since we will
compute this in several dimensions, we write the dot product for 3D `{x, y, z}`
vectors, and the equation follows in one line:

```js echo
const dot3 = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const lambert = (kd, N, L, IL = 1) => kd * Math.max(dot3(N, L), 0) * IL;
```

A quick check against a worked example with N=(0,0,1),
L=(0.577,0.577,0.577), I_L=1.0, and k_d=0.8. The expected answer is 0.462:

```js echo
lambert(0.8, {x: 0, y: 0, z: 1}, {x: 0.577, y: 0.577, z: 0.577})
```

Now in 2D, with vectors you can drag. Both are normalized first, because the dot
product equals ${tex`\cos\theta`} only for unit vectors. Drag
**N** or **L** below and watch `I_d` track cos θ directly.

```js
const lambertVectorsWidget = dragVectors(
  {N: {x: 0, y: 2}, L: {x: 1.4, y: 1.4}},
  {colors: ["steelblue", "#ffd34d"], domain: 3}
);
const lambertVectors = view(lambertVectorsWidget);
```

```js echo
const Nvec = vec2.normalize(lambertVectors.N);
const Lvec = vec2.normalize(lambertVectors.L);
const NdotL = Math.max(vec2.dot(Nvec, Lvec), 0);
const kd = 0.8;
```

```js
{
lambertVectorsWidget.redecorate((scene) => {
  scene.svg.append("line")
    .attr("x1", scene.x(-Nvec.y * 2)).attr("y1", scene.y(Nvec.x * 2))
    .attr("x2", scene.x(Nvec.y * 2)).attr("y2", scene.y(-Nvec.x * 2))
    .attr("stroke", "gray").attr("stroke-dasharray", "4,3"); // the surface N is perpendicular to
});
}
```

**N** · **L** = ${NdotL.toFixed(3)}, so with `k_d` = ${kd}:
`I_d` = ${kd} × ${NdotL.toFixed(3)} = **${(kd * NdotL).toFixed(3)}**.
Drag **L** past grazing, behind the (dashed) surface line, and `I_d`
clamps to exactly 0 rather than going negative.

### Phong and Blinn-Phong

Phong (1975) sums three independently-motivated terms:

${tex.block`I = \underbrace{k_aI_a}_{\text{ambient}} + \underbrace{k_d\max(\mathbf N\cdot\mathbf L,0)I_L}_{\text{diffuse}} + \underbrace{k_s\max(\mathbf R\cdot\mathbf V,0)^{n}I_L}_{\text{specular}}`}

**Ambient** is a constant fill, blind to orientation: a crude stand-in
for missing indirect light. **Specular** depends on the *viewer*, through
the mirror-reflection vector ${tex`\mathbf R = 2(\mathbf N\cdot\mathbf
L)\mathbf N - \mathbf L`}. In code, it reads like the formula:

```js echo
const reflect = (N, L) => {
  const k = 2 * dot3(N, L);
  return {x: k * N.x - L.x, y: k * N.y - L.y, z: k * N.z - L.z};
};
```

The specular factor raises the alignment of **R** and **V** to the power `n`,
which is what makes the highlight tight. The total is then the sum of the three
terms in the equation:

```js echo
const specularPhong = (N, L, V, n) =>
  Math.max(dot3(reflect(N, L), V), 0) ** n;
const phong = ({ka, kd, ks, n}, N, L, V) =>
  ka + lambert(kd, N, L) + ks * specularPhong(N, L, V, n);
```

Here is the implementation checked against a worked example with N=(0,0,1),
L=(0.5,0,0.866), V=(0,0,1), k_a=0.1, k_d=0.7, k_s=0.5, and n=8. The expected
total is 0.864:

```js echo
const exampleN = {x: 0, y: 0, z: 1}, exampleV = {x: 0, y: 0, z: 1};
const exampleL = {x: 0.5, y: 0, z: 0.866};
```

```js echo
phong({ka: 0.1, kd: 0.7, ks: 0.5, n: 8}, exampleN, exampleL, exampleV)
```

**Blinn-Phong** (1977) replaces **R** with the **half-vector**
${tex`\mathbf H = \widehat{\mathbf L+\mathbf V}`} and
${tex`I_s = k_s\max(\mathbf N\cdot\mathbf H,0)^{n}I_L`}. It is cheaper,
with no reflection vector to build, and better behaved at grazing angles.
Only the alignment term changes:

```js echo
function specularBlinn(N, L, V, n) {
  const s = {x: L.x + V.x, y: L.y + V.y, z: L.z + V.z};
  const len = Math.hypot(s.x, s.y, s.z);
  const H = {x: s.x / len, y: s.y / len, z: s.z / len};
  return Math.max(dot3(N, H), 0) ** n;
}
```

The two exponents are not interchangeable. For the same geometry and
shininess `n`, the table compares `specularPhong` with `specularBlinn`:

```js
html`<pre>${[8, 32].map((n) => `n=${n.toString().padEnd(3)} Phong (R·V)^n = ${specularPhong(exampleN, exampleL, exampleV, n).toFixed(3)}   Blinn-Phong (N·H)^n = ${specularBlinn(exampleN, exampleL, exampleV, n).toFixed(3)}`).join("\n")}</pre>`
```

Blinn-Phong reads noticeably brighter at both exponents, so engines
typically use a higher `n` for Blinn-Phong to match the visual size of a
Phong highlight.

## Shading in WebGPU

### Warm-up: a Sierpinski gasket (still no lighting)

Module 04 built one shape: a hand-placed triangle. Before adding normals
and lighting to that skeleton, we reuse the same seven-step recipe
(device, canvas, buffer, shader, pipeline, pass, submit) on a shape
nobody placed by hand. The **chaos game** builds the Sierpinski gasket from three fixed
corners and pure randomness: start anywhere, then repeatedly jump
halfway toward a *randomly chosen* corner, plotting each new point.

${tex.block`\mathbf p_{i+1} = \tfrac12\left(\mathbf p_i + \mathbf c_{\text{random}}\right)`}

No triangle is ever subdivided, and no point is tested for being inside
the fractal. The fractal emerges from the recursion above and is drawn
as thousands of single-pixel points with `topology: "point-list"`
(Module 04 used only `"triangle-list"`). The vertex shader is even
simpler than Module 04's: positions are authored directly
in NDC and every point gets the same fixed fragment color, so there is
no per-vertex color attribute at all.

One jump is the recursion above, written out:

```js echo
function chaosStep(p, corners) {
  const corner = corners[Math.floor(Math.random() * 3)];
  return [(p[0] + corner[0]) / 2, (p[1] + corner[1]) / 2];
}
```

From the origin, one jump toward a corner lands halfway there. With only one corner
to choose from, repeated in all three slots, (1, 0) should give (0.5, 0):

```js echo
chaosStep([0, 0], [[1, 0], [1, 0], [1, 0]])
```

To build the point list, we run that jump in a loop and store each result in a flat
array of `x, y` pairs. The first 10 jumps are thrown away, which lets the point
settle onto the fractal from its arbitrary start:

```js echo
function sierpinskiPoints(count, corners) {
  const points = new Float32Array(count * 2);
  let p = [0, 0];
  for (let i = -10; i < count; i++) {
    p = chaosStep(p, corners);
    if (i >= 0) points.set(p, i * 2);
  }
  return points;
}
```

The shader needs no matrix, since positions are already in NDC, and it paints every
point the same color:

```js echo
const gasketShaderSource = `
struct VertexOut {
  @builtin(position) position: vec4<f32>,
};

@vertex
fn vs_main(@location(0) inPos: vec2<f32>) -> VertexOut {
  var out: VertexOut;
  out.position = vec4<f32>(inPos, 0.0, 1.0);
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  return vec4<f32>(0.95, 0.65, 0.2, 1.0);
}
`;
```

```js
const gasketCanvas = document.createElement("canvas");
gasketCanvas.width = 420;
gasketCanvas.height = 420;
gasketCanvas.style.borderRadius = "8px";
const {context: gasketContext, format: gasketFormat} =
  await initializeWebGPU(gasketCanvas, {device});
```

The pipeline has the shape you know from Module 04, with two changes for this shape:
each vertex is only two floats, and the topology is `"point-list"`.

```js echo
const gasketShaderModule =
  device.createShaderModule({code: gasketShaderSource});
const gasketPipeline = device.createRenderPipeline({
  layout: "auto",
  vertex: {
    module: gasketShaderModule,
    entryPoint: "vs_main",
    buffers: [{
      arrayStride: 2 * 4,
      attributes: [{shaderLocation: 0, offset: 0, format: "float32x2"}]
    }]
  },
  fragment: {
    module: gasketShaderModule, entryPoint: "fs_main",
    targets: [{format: gasketFormat}]
  },
  primitive: {topology: "point-list"}
});
```

The vertex buffer comes from `createBuffer`, as described at the top of the page. The
slider below decides how many points to generate, and regenerating them re-runs this
cell and the draw after it:

```js
const gasketForm = view(Inputs.form({
  iterations: Inputs.range([100, 30000], {value: 6000, step: 100, label: "chaos-game iterations"})
}));
```

```js echo
const gasketCorners = [[0, 0.85], [-0.85, -0.7], [0.85, -0.7]];
const gasketPointData =
  sierpinskiPoints(gasketForm.iterations, gasketCorners);
const gasketVertexBuffer =
  createBuffer(device, gasketPointData, GPUBufferUsage.VERTEX);
```

```js
(() => {
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: gasketContext.getCurrentTexture().createView(),
      clearValue: {r: 0.05, g: 0.05, b: 0.08, a: 1},
      loadOp: "clear",
      storeOp: "store"
    }]
  });
  pass.setPipeline(gasketPipeline);
  pass.setVertexBuffer(0, gasketVertexBuffer);
  pass.draw(gasketForm.iterations);
  pass.end();
  device.queue.submit([encoder.finish()]);
  return gasketCanvas;
})()
```

Drag `iterations` from its low end toward 30,000. A few hundred points
look like scattered noise, but past a few thousand the gasket appears
with no code change; the shape was always latent in the recursion. Every
point is flat-colored and shaded identically. Nothing here has a surface,
a normal, or a light, which is the gap the rest of this section fills.

### Flat, Gouraud, and Phong shading

The three shading algorithms differ only in **when** lighting is
evaluated. Each uses the same Blinn-Phong equation, pushed later and later
into the pipeline:

| Algorithm | Normals | Lighting evaluated | Highlight |
|---|---|---|---|
| Flat | One per face | Per polygon | None (faceted) |
| Gouraud | Averaged, per vertex | Per vertex, colors interpolated | Often smeared |
| Phong | Per vertex, interpolated | **Per fragment** | Accurate |

All three render the *same* sphere below, driven by the *same* light and
material controls; only the pipeline differs. `device` is the same object
requested once at the top of the page.

The difference between smooth and flat starts in the geometry. `geometry.createSphere`
builds an indexed sphere whose vertices are shared between triangles, each with one
averaged normal. `geometry.flatten` un-shares them, giving each triangle its own three
vertices, all carrying that face's normal. `geometry.interleave` packs positions and
normals into one array:

```js echo
const sphereSmooth = geometry.createSphere(24, 32);
const sphereFlat = geometry.flatten(sphereSmooth);
const smoothVertexData =
  geometry.interleave(sphereSmooth.positions, sphereSmooth.normals);
const flatVertexData =
  geometry.interleave(sphereFlat.positions, sphereFlat.normals);
```

Un-sharing costs memory. Compare the vertex counts, smooth first, then flat:

```js echo
[sphereSmooth.positions.length / 3, sphereFlat.positions.length / 3]
```

The smooth version draws through an index buffer, and the flat version does not:

```js echo
const {VERTEX, INDEX} = GPUBufferUsage;
const smoothVertexBuffer = createBuffer(device, smoothVertexData, VERTEX);
const smoothIndexBuffer = createBuffer(device, sphereSmooth.indices, INDEX);
const flatVertexBuffer = createBuffer(device, flatVertexData, VERTEX);
const flatVertexCount = sphereFlat.positions.length / 3;
```

The camera and model matrix are fixed. Nothing here needs the general
inverse-transpose from the normals section, since this sphere never
scales non-uniformly:

```js echo
const eyePosition = [2.4, 1.7, 3.2];
const sphereView = transforms.lookAt(eyePosition, [0, 0, 0], [0, 1, 0]);
const sphereProjection =
  transforms.perspective((42 * Math.PI) / 180, 1, 0.1, 20);
const sphereModel = mat4.identity();
const sphereMVP =
  mat4.multiplyAll([sphereProjection, sphereView, sphereModel]);
```

Lighting needs four groups of uniforms, each in its own buffer. A small helper keeps
them readable. Their sizes come from the structs below, and each is a multiple of
16 bytes, since `vec3`s are padded to `vec4`s in uniform buffers:

```js echo
const uniformBuffer = (size) => device.createBuffer({
  size, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
});
const transformBuffer = uniformBuffer(128);   // two 64-byte matrices
const lightBuffer = uniformBuffer(32);
const materialBuffer = uniformBuffer(64);
const cameraBuffer = uniformBuffer(16);
```

The transforms and camera never change, so we write them once. Light and material are
written later, whenever the sliders move:

```js echo
const transformData = new Float32Array(32);
transformData.set(sphereMVP, 0);
transformData.set(sphereModel, 16);
device.queue.writeBuffer(transformBuffer, 0, transformData);
const cameraData = new Float32Array([...eyePosition, 0]);
device.queue.writeBuffer(cameraBuffer, 0, cameraData);
```

We need two shaders. One evaluates lighting **per vertex** and outputs a color
and is shared by Flat and Gouraud, which differ only in *which* geometry
feeds it (face normals or vertex normals). The other evaluates lighting
**per fragment** (Phong shading). Both declare the same uniforms:

```js echo
const wgslTransform = `
struct Transform { mvp: mat4x4<f32>, model: mat4x4<f32> };
@group(0) @binding(0) var<uniform> transform: Transform;`;
const wgslCamera = `
@group(0) @binding(3) var<uniform> cameraPosition: vec4<f32>;`;
```

```js echo
const wgslLight = `
struct Light { position: vec4<f32>, color: vec4<f32> };
@group(0) @binding(1) var<uniform> light: Light;`;
const wgslMaterial = `
struct Material {
  ambient: vec4<f32>, diffuse: vec4<f32>,
  specular: vec4<f32>, params: vec4<f32>
};
@group(0) @binding(2) var<uniform> material: Material;`;
```

**Per-vertex lighting** does the work in `vs_main`. First come the same vectors as our
JavaScript version, in world space. Multiplying the normal with `w = 0` leaves out
translation, and as noted above, this sphere needs no inverse-transpose:

```js echo
const wgslVertexVectors = `
fn lightingVectors(inPos: vec3<f32>, inNormal: vec3<f32>) -> mat3x3<f32> {
  let worldPos = (transform.model * vec4<f32>(inPos, 1.0)).xyz;
  let N = normalize((transform.model * vec4<f32>(inNormal, 0.0)).xyz);
  let L = normalize(light.position.xyz - worldPos);
  let V = normalize(cameraPosition.xyz - worldPos);
  return mat3x3<f32>(N, L, V);
}`;
```

Then comes the Blinn-Phong sum. `select` drops the specular term when the light is
behind the surface, so a highlight cannot appear on the unlit side:

```js echo
const wgslVertexColor = `
fn vertexColor(N: vec3<f32>, L: vec3<f32>, V: vec3<f32>) -> vec3<f32> {
  let NdotL = max(dot(N, L), 0.0);
  let spec = pow(max(dot(N, normalize(L + V)), 0.0), material.params.x);
  let lit = NdotL > 0.0;
  return (material.ambient.rgb + material.diffuse.rgb * NdotL
    + material.specular.rgb * select(0.0, spec, lit)) * light.color.rgb;
}`;
```

The vertex shader passes that color to the rasterizer, which interpolates it. The
fragment shader only outputs the result. So no lighting calculation happens between
vertices, and this is the whole of what limits Gouraud shading:

```js echo
const wgslVertexOutColor = `
struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec3<f32>,
};
@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  return vec4<f32>(in.color, 1.0);
}`;
```

```js echo
const wgslVertexLitMain = `
@vertex
fn vs_main(
  @location(0) inPos: vec3<f32>, @location(1) inNormal: vec3<f32>
) -> VertexOut {
  let v = lightingVectors(inPos, inNormal);
  return VertexOut(transform.mvp * vec4<f32>(inPos, 1.0),
    vertexColor(v[0], v[1], v[2]));
}`;
const vertexLitSource = [wgslTransform, wgslLight, wgslMaterial, wgslCamera,
  wgslVertexVectors, wgslVertexColor, wgslVertexOutColor, wgslVertexLitMain
].join("\n");
```

**Per-fragment lighting** moves all of that into `fs_main`. The vertex shader now does
almost nothing. It passes the world position and normal along, and the rasterizer
interpolates those instead of a color:

```js echo
const wgslFragmentLitVertex = `
struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) worldNormal: vec3<f32>,
};
@vertex
fn vs_main(
  @location(0) inPos: vec3<f32>, @location(1) inNormal: vec3<f32>
) -> VertexOut {
  return VertexOut(transform.mvp * vec4<f32>(inPos, 1.0),
    (transform.model * vec4<f32>(inPos, 1.0)).xyz,
    (transform.model * vec4<f32>(inNormal, 0.0)).xyz);
}`;
```

The fragment shader computes the specular alignment by either formula. A slider-driven
value in `material.params.y` chooses Blinn-Phong or Phong:

```js echo
const wgslSpecularAngle = `
fn specularAngle(N: vec3<f32>, L: vec3<f32>, V: vec3<f32>) -> f32 {
  if (material.params.y > 0.5) {
    return max(dot(N, normalize(L + V)), 0.0);
  }
  return max(dot(2.0 * dot(N, L) * N - L, V), 0.0);
}`;
```

The main function normalizes the interpolated normal, because interpolation shortens
it. `isFront` flips the normal for a two-sided surface. A closed solid like this sphere
never shows its back, since `cullMode: "back"` removes it before this shader even runs,
so it matters only for shapes such as an open sheet:

```js echo
const wgslFragmentLitMain = `
@fragment
fn fs_main(
  @location(0) worldPos: vec3<f32>,
  @location(1) worldNormal: vec3<f32>,
  @builtin(front_facing) isFront: bool
) -> @location(0) vec4<f32> {
  let n = normalize(worldNormal);
  let N = select(-n, n, isFront);
  let L = normalize(light.position.xyz - worldPos);
  let V = normalize(cameraPosition.xyz - worldPos);
  let NdotL = max(dot(N, L), 0.0);
  let angle = specularAngle(N, L, V);
  let spec = select(0.0, pow(angle, material.params.x), NdotL > 0.0);
  let c = material.ambient.rgb + material.diffuse.rgb * NdotL
    + material.specular.rgb * spec;
  return vec4<f32>(c * light.color.rgb, 1.0);
}`;
const fragmentLitSource = [wgslTransform, wgslLight, wgslMaterial,
  wgslCamera, wgslFragmentLitVertex, wgslSpecularAngle, wgslFragmentLitMain
].join("\n");
```

The rest is Module 04's setup. Each vertex now holds a position and a normal, six floats:

```js echo
const vertexLayout = {
  arrayStride: 6 * 4,
  attributes: [
    {shaderLocation: 0, offset: 0, format: "float32x3"},
    {shaderLocation: 1, offset: 3 * 4, format: "float32x3"}
  ]
};
```

The pipeline adds two things. `cullMode: "back"` skips triangles facing away from the
camera. A **depth buffer** keeps nearer fragments in front of farther ones, which matters
now that we draw a solid:

```js echo
function makePipeline(source, canvasFormat, cullMode = "back") {
  const module = device.createShaderModule({code: source});
  return device.createRenderPipeline({
    layout: "auto",
    vertex: {module, entryPoint: "vs_main", buffers: [vertexLayout]},
    fragment: {
      module, entryPoint: "fs_main", targets: [{format: canvasFormat}]
    },
    primitive: {topology: "triangle-list", cullMode},
    depthStencil: {
      format: "depth24plus", depthWriteEnabled: true, depthCompare: "less"
    }
  });
}
```

Each canvas gets its own depth texture, of the same size:

```js echo
async function makeCanvas(size) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  canvas.style.borderRadius = "8px";
  const {context, format} = await initializeWebGPU(canvas, {device});
  const depthTexture = device.createTexture({
    size: [size, size], format: "depth24plus",
    usage: GPUTextureUsage.RENDER_ATTACHMENT
  });
  return {canvas, context, format, depthTexture};
}
```

We make three canvases but only two pipelines, because Flat and Gouraud share one:

```js echo
const flatTarget = await makeCanvas(240);
const gouraudTarget = await makeCanvas(240);
const phongTarget = await makeCanvas(240);
const vertexLitPipeline = makePipeline(vertexLitSource, flatTarget.format);
const phongPipeline = makePipeline(fragmentLitSource, phongTarget.format);
```

With `layout: "auto"`, each pipeline has its own bind group layout, so each gets its own
bind group, built from the same four buffers:

```js echo
function makeBindGroup(pipeline) {
  const buffers =
    [transformBuffer, lightBuffer, materialBuffer, cameraBuffer];
  return device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: buffers.map((buffer, binding) =>
      ({binding, resource: {buffer}}))
  });
}
const vertexLitBindGroup = makeBindGroup(vertexLitPipeline);
const phongBindGroup = makeBindGroup(phongPipeline);
```

Drawing follows the familiar pattern, with a depth attachment and, for indexed geometry,
`drawIndexed` instead of `draw`:

```js echo
function drawSphere(
  target, pipeline, bindGroup, vertexBuffer, indexBuffer, count
) {
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: target.context.getCurrentTexture().createView(),
      clearValue: {r: 0.05, g: 0.05, b: 0.08, a: 1},
      loadOp: "clear", storeOp: "store"
    }],
    depthStencilAttachment: {
      view: target.depthTexture.createView(), depthClearValue: 1.0,
      depthLoadOp: "clear", depthStoreOp: "store"
    }
  });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.setVertexBuffer(0, vertexBuffer);
  if (indexBuffer) {
    pass.setIndexBuffer(indexBuffer, "uint16");
    pass.drawIndexed(count);
  } else {
    pass.draw(count);
  }
  pass.end();
  device.queue.submit([encoder.finish()]);
}
```

```js
(() => {
  const row = document.createElement("div");
  row.style.display = "flex"; row.style.gap = "16px"; row.style.flexWrap = "wrap";
  const cell = (label, canvas) => {
    const wrap = document.createElement("div");
    const caption = document.createElement("div");
    caption.textContent = label;
    caption.style.font = "12px var(--sans-serif)"; caption.style.opacity = "0.65"; caption.style.marginBottom = "4px";
    wrap.appendChild(caption); wrap.appendChild(canvas);
    return wrap;
  };
  row.appendChild(cell("Flat", flatTarget.canvas));
  row.appendChild(cell("Gouraud", gouraudTarget.canvas));
  row.appendChild(cell("Phong", phongTarget.canvas));
  return row;
})()
```

The sliders set the light and material. The light's position comes from spherical
coordinates, just like the orbiting camera in Module 03:

```js
const shadingForm = view(Inputs.form({
  azimuth: Inputs.range([-180, 180], {value: 35, step: 1, label: "light azimuth"}),
  elevation: Inputs.range([5, 85], {value: 40, step: 1, label: "light elevation"}),
  ka: Inputs.range([0, 0.6], {value: 0.15, step: 0.01, label: "ka (ambient)"}),
  kd: Inputs.range([0, 1], {value: 0.7, step: 0.01, label: "kd (diffuse)"}),
  ks: Inputs.range([0, 1], {value: 0.6, step: 0.01, label: "ks (specular)"}),
  shininess: Inputs.range([2, 128], {value: 32, step: 1, label: "shininess n"}),
  blinnPhong: Inputs.toggle({value: true, label: "Blinn-Phong specular (Phong canvas only)"})
}));
```

```js echo
const lightAz = (shadingForm.azimuth * Math.PI) / 180;
const lightEl = (shadingForm.elevation * Math.PI) / 180;
const lightDist = 4;
const lightPos = [
  lightDist * Math.cos(lightEl) * Math.sin(lightAz),
  lightDist * Math.sin(lightEl),
  lightDist * Math.cos(lightEl) * Math.cos(lightAz),
  0
];
```

The buffer layouts match the structs in the shaders, four floats at a time. The
material's coefficients scale a base color, its `params` hold the shininess and the
specular choice, and the light is white:

```js echo
const baseColor = [0.25, 0.55, 0.85];
function writeLightAndMaterial() {
  const lightData = new Float32Array([...lightPos, 1, 1, 1, 0]);
  device.queue.writeBuffer(lightBuffer, 0, lightData);
  device.queue.writeBuffer(materialBuffer, 0, new Float32Array([
    ...baseColor.map((c) => c * shadingForm.ka), 0,
    ...baseColor.map((c) => c * shadingForm.kd), 0,
    1, 1, 1, 0,
    shadingForm.shininess, shadingForm.blinnPhong ? 1 : 0, 0, 0
  ]));
}
```

Now look at what actually differs among the three draws. Flat uses the un-shared
geometry, Gouraud shares the same pipeline with shared geometry, and Phong keeps the
geometry but changes the pipeline:

```js echo
writeLightAndMaterial();
const smoothCount = sphereSmooth.indices.length;
drawSphere(flatTarget, vertexLitPipeline, vertexLitBindGroup,
  flatVertexBuffer, null, flatVertexCount);
drawSphere(gouraudTarget, vertexLitPipeline, vertexLitBindGroup,
  smoothVertexBuffer, smoothIndexBuffer, smoothCount);
drawSphere(phongTarget, phongPipeline, phongBindGroup,
  smoothVertexBuffer, smoothIndexBuffer, smoothCount);
```

Flat shading shows every triangle as a visible facet.
Gouraud smooths the *body* of the sphere, but its specular highlight is
unreliable: push `shininess` up and the highlight flickers or vanishes
between vertices instead of forming a clean spot. Only Phong shading
holds a stable highlight, because it evaluates the equation at every
pixel instead of interpolating an already-computed color.

## Check Your Understanding

1. In the chaos game, the current point is ${tex`(0, 0)`} and the randomly chosen corner is ${tex`(0, 0.85)`}. What is the next point?
2. What does local illumination leave out, and what does the ambient term stand in for?
3. Why must the light direction ${tex`\mathbf L`} be recomputed at every surface point for a point light, but not for a directional light?
4. A surface has tangent ${tex`(1, -1)`} and normal ${tex`(1, 1)/\sqrt 2`}. After scaling by ${tex`M = \operatorname{diag}(2, 1)`}, what is the correct unit normal?
5. Why does a pure rotation never need the inverse-transpose?
6. With ${tex`k_d = 0.8`} and ${tex`I_L = 1`}, what is the diffuse intensity when the angle between **N** and **L** is 60°? When it is 120°?
7. For ${tex`\mathbf N = (0, 0, 1)`} and ${tex`\mathbf L = (0.6, 0, 0.8)`}, what is the reflection vector ${tex`\mathbf R`}?
8. With the same **N** and **L** and ${tex`\mathbf V = (0, 0, 1)`}, what is the half-vector ${tex`\mathbf H`} and ${tex`\mathbf N\cdot\mathbf H`}?
9. Why does a Blinn-Phong highlight need a larger exponent than Phong to look the same size?
10. Why can one vertex-lit shader serve both Flat and Gouraud shading?
11. Why does Gouraud shading lose or smear a sharp highlight that Phong shading keeps?
12. Why do both shaders set the specular term to 0 when ${tex`\mathbf N\cdot\mathbf L \le 0`}?

<details>
<summary>Answers</summary>

1. ${tex`\tfrac12\big((0, 0) + (0, 0.85)\big) = (0, 0.425)`}.
2. Light that bounces between surfaces (indirect light). The ambient term is a constant that roughly patches in that missing light.
3. A point light sits at a position, so the direction to it changes from point to point. A directional light has parallel rays, so ${tex`\mathbf L`} is the same everywhere.
4. ${tex`M^{-T}\mathbf n \propto (0.5, 1)`}, which normalizes to (${vec2.normalize({x: 0.5, y: 1}).x.toFixed(3)}, ${vec2.normalize({x: 0.5, y: 1}).y.toFixed(3)}). Check: the scaled tangent is ${tex`(2, -1)`}, and ${tex`(2, -1)\cdot(0.5, 1) = 0`}.
5. A rotation is orthonormal, so ${tex`R^{-T} = R`}. Transforming the normal by ${tex`R`} directly already gives the right answer.
6. ${tex`0.8\cos 60^\circ`} = ${(0.8 * Math.cos(Math.PI / 3)).toFixed(2)}. At 120° the dot product is negative, so the clamp gives 0.
7. ${tex`\mathbf R = 2(0.8)(0,0,1) - (0.6, 0, 0.8) = (-0.6, 0, 0.8)`}.
8. ${tex`\mathbf L + \mathbf V = (0.6, 0, 1.8)`}, so ${tex`\mathbf H`} = (${(0.6 / Math.hypot(0.6, 1.8)).toFixed(3)}, 0, ${(1.8 / Math.hypot(0.6, 1.8)).toFixed(3)}) and ${tex`\mathbf N\cdot\mathbf H`} = ${(1.8 / Math.hypot(0.6, 1.8)).toFixed(3)}.
9. The angle between **N** and **H** is about half the angle between **R** and **V**, so ${tex`\mathbf N\cdot\mathbf H`} stays larger and falls off more slowly. A larger exponent tightens the highlight back to the same size.
10. Both compute lighting per vertex and interpolate the color. Flat shading feeds the shader one face normal per triangle, so all three vertices get the same color; Gouraud feeds smooth per-vertex normals.
11. Gouraud computes color only at the vertices. A highlight smaller than a triangle falls between vertices and is either missed or spread across the whole triangle. Phong shading evaluates the equation at every fragment.
12. The light is behind the surface. Without the check, a viewer-facing **H** or **R** could still produce a highlight on the unlit side.

</details>

## Common Pitfalls

- **Forgetting to normalize.** Interpolated normals and vectors such as
  **H** are not unit length after interpolation.
- **Mixing coordinate spaces.** Normal, light, and view directions must
  all be expressed in the same space.
- **Using M instead of M⁻ᵀ for normals.** The mistake hides under uniform
  scaling and breaks under non-uniform scaling.
- **Lighting the back of a surface.** Clamp ${tex`\mathbf N\cdot\mathbf L`}
  at 0 and drop the specular term when the light is behind the surface.
- **Culling a surface that has no "back."** `cullMode: "back"` is correct
  for a closed solid like the sphere, but an open, zero-thickness sheet
  has geometry on only one side. Cull it and the sheet disappears when
  seen from behind; use `cullMode: "none"` and flip the normal with
  `front_facing`.
- **Confusing shading algorithms with illumination models.** *Where*
  lighting is evaluated (Flat, Gouraud, or Phong shading) is independent
  of *how* it is computed (Lambertian, Phong, or Blinn-Phong
  illumination).
- **Treating ambient as physically meaningful.** It is a visual patch for
  missing global illumination, not a simulation.

## Summary

- **Light and appearance:** geometry gives the shape; appearance combines
  normals, lights, material, and viewer position. Local illumination
  uses direct light only, and **ambient** is a crude patch for the
  missing indirect light.
- **Normals:** under non-uniform scaling, normals need the
  **inverse-transpose** of the model matrix, then renormalization. A pure
  rotation is orthonormal and never needs it.
- **Illumination models:** **Lambertian** diffuse follows
  ${tex`\max(\mathbf N\cdot\mathbf L, 0)`}. **Phong** adds a specular
  term from ${tex`\mathbf R\cdot\mathbf V`}, and **Blinn-Phong** uses
  the cheaper half-vector term ${tex`\mathbf N\cdot\mathbf H`}.
- **Shading in WebGPU:** the chaos-game gasket reused Module 04's
  skeleton with a point list. **Flat, Gouraud, and Phong shading** differ
  only in *when* lighting is evaluated (per polygon, per vertex, or per
  fragment), rendered here as WebGPU pipelines sharing one light and one
  material.
