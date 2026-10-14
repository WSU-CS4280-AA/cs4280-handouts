---
title: Module 05 — Surface Shading
toc: true
---

```js echo
import * as vec2 from "./components/vec2.js";
import * as mat2 from "./components/mat2.js";
import * as mat4 from "./components/mat4.js";
import * as geometry from "./components/geometry.js";
import * as webgpu from "./components/webgpu.js";
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
it is not a walkthrough of any graded assignment.

```js echo
const {adapter, device} = await webgpu.requestDevice();
```

Most WebGPU mistakes, such as a bad buffer size or a bind group that
does not match its pipeline's layout, do not throw a JavaScript
exception. The call quietly fails validation and reports it
*asynchronously* to `device`'s `"uncapturederror"` event, the same way
`device.lost` reports a driver reset. Listening for that event once, here,
makes any such error appear on the page instead of only in the browser
console:

```js echo
const deviceErrorLog = document.createElement("pre");
deviceErrorLog.style.cssText = "display: none; color: #e5484d; background: #2a1214; border: 1px solid #e5484d; border-radius: 6px; padding: 8px 12px; font-size: 12px; white-space: pre-wrap;";
device.addEventListener("uncapturederror", (event) => {
  deviceErrorLog.textContent += `WebGPU error: ${event.error.message}\n`;
  deviceErrorLog.style.display = "block";
});
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

Below, a tilted edge (gray) is scaled non-uniformly. The naive transform
${tex`M\mathbf n`} (orange) and the correct ${tex`M^{-T}\mathbf n`} (green)
start identical at `sx = sy` but diverge the moment scaling turns non-uniform.

```js echo
const normalForm = view(Inputs.form({
  sx: Inputs.range([0.3, 2.5], {value: 1.8, step: 0.05, label: "scale sx"}),
  sy: Inputs.range([0.3, 2.5], {value: 0.6, step: 0.05, label: "scale sy"})
}));
```

```js echo
const tiltAngle = (35 * Math.PI) / 180;
const edgeDir = {x: Math.cos(tiltAngle), y: Math.sin(tiltAngle)};
const normalDir = {x: -Math.sin(tiltAngle), y: Math.cos(tiltAngle)};
const M2 = mat2.scaling(normalForm.sx, normalForm.sy);
const edgeT = mat2.apply(M2, edgeDir);
const naiveNormalT = vec2.normalize(mat2.apply(M2, normalDir));
const correctNormalT = vec2.normalize(mat2.apply(mat2.transpose(mat2.invert(M2)), normalDir));
const dotNaive = vec2.dot(vec2.normalize(edgeT), naiveNormalT);
const dotCorrect = vec2.dot(vec2.normalize(edgeT), correctNormalT);
```

```js echo
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
is behind the surface, contributing zero, never negative, light. Drag
**N** or **L** below and watch `I_d` track cos θ directly.

```js echo
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

```js echo
lambertVectorsWidget.redecorate((scene) => {
  scene.svg.append("line")
    .attr("x1", scene.x(-Nvec.y * 2)).attr("y1", scene.y(Nvec.x * 2))
    .attr("x2", scene.x(Nvec.y * 2)).attr("y2", scene.y(-Nvec.x * 2))
    .attr("stroke", "gray").attr("stroke-dasharray", "4,3"); // the surface N is perpendicular to
});
```

**N** · **L** = ${NdotL.toFixed(3)}, so with `k_d` = ${kd}:
`I_d` = ${kd} × ${NdotL.toFixed(3)} = **${(kd * NdotL).toFixed(3)}**.
Drag **L** past grazing, behind the (dashed) surface line, and `I_d`
clamps to exactly 0 rather than going negative.

A quick check against a worked example with N=(0,0,1),
L=(0.577,0.577,0.577), I_L=1.0, and k_d=0.8:

```js echo
(() => {
  const N3 = {x: 0, y: 0, z: 1};
  const L3 = {x: 0.577, y: 0.577, z: 0.577};
  const dot3 = N3.x * L3.x + N3.y * L3.y + N3.z * L3.z;
  const Id = 0.8 * Math.max(dot3, 0) * 1.0;
  return `N·L = ${dot3.toFixed(3)}, I_d = ${Id.toFixed(3)} (expected: 0.462)`;
})()
```

### Phong and Blinn-Phong

Phong (1975) sums three independently-motivated terms:

${tex.block`I = \underbrace{k_aI_a}_{\text{ambient}} + \underbrace{k_d\max(\mathbf N\cdot\mathbf L,0)I_L}_{\text{diffuse}} + \underbrace{k_s\max(\mathbf R\cdot\mathbf V,0)^{n}I_L}_{\text{specular}}`}

**Ambient** is a constant fill, blind to orientation: a crude stand-in
for missing indirect light. **Specular** depends on the *viewer*, through
the mirror-reflection vector ${tex`\mathbf R = 2(\mathbf N\cdot\mathbf
L)\mathbf N - \mathbf L`}. Here is the implementation checked against a
worked example with N=(0,0,1), L=(0.5,0,0.866), V=(0,0,1), k_a=0.1,
k_d=0.7, k_s=0.5, and n=8:

```js echo
(() => {
  const N = {x: 0, y: 0, z: 1};
  const L = {x: 0.5, y: 0, z: 0.866};
  const V = {x: 0, y: 0, z: 1};
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const NdotL2 = Math.max(dot(N, L), 0);
  const R = {x: 2 * NdotL2 * N.x - L.x, y: 2 * NdotL2 * N.y - L.y, z: 2 * NdotL2 * N.z - L.z};
  const ambient = 0.1;
  const diffuse = 0.7 * NdotL2;
  const specular = 0.5 * Math.pow(Math.max(dot(R, V), 0), 8);
  const total = ambient + diffuse + specular;
  return html`<pre>ambient  = ${ambient.toFixed(3)}
diffuse  = ${diffuse.toFixed(3)}
R        = (${R.x.toFixed(3)}, ${R.y.toFixed(3)}, ${R.z.toFixed(3)})
specular = ${specular.toFixed(3)}
total    = ${total.toFixed(3)}  (expected: 0.864)</pre>`;
})()
```

**Blinn-Phong** (1977) replaces **R** with the **half-vector**
${tex`\mathbf H = \widehat{\mathbf L+\mathbf V}`} and
${tex`I_s = k_s\max(\mathbf N\cdot\mathbf H,0)^{n}I_L`}. It is cheaper,
with no reflection vector to build, and better behaved at grazing angles.
The two exponents are not interchangeable. For the same geometry and
shininess `n`:

```js echo
(() => {
  const N = {x: 0, y: 0, z: 1};
  const L = {x: 0.5, y: 0, z: 0.866};
  const V = {x: 0, y: 0, z: 1};
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const NdotL2 = Math.max(dot(N, L), 0);
  const R = {x: 2 * NdotL2 * N.x - L.x, y: 2 * NdotL2 * N.y - L.y, z: 2 * NdotL2 * N.z - L.z};
  const Hlen = Math.hypot(L.x + V.x, L.y + V.y, L.z + V.z);
  const H = {x: (L.x + V.x) / Hlen, y: (L.y + V.y) / Hlen, z: (L.z + V.z) / Hlen};
  const rows = [8, 32].map((n) => {
    const phong = Math.pow(Math.max(dot(R, V), 0), n);
    const blinn = Math.pow(Math.max(dot(N, H), 0), n);
    return `n=${n.toString().padEnd(3)} Phong (R·V)^n = ${phong.toFixed(3)}   Blinn-Phong (N·H)^n = ${blinn.toFixed(3)}`;
  });
  return html`<pre>${rows.join("\n")}</pre>`;
})()
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

```js echo
function sierpinskiPoints(count, corners) {
  const points = new Float32Array(count * 2);
  let p = [0, 0];
  const discard = 10; // let the first few jumps settle onto the fractal
  for (let i = -discard; i < count; i++) {
    const corner = corners[Math.floor(Math.random() * 3)];
    p = [(p[0] + corner[0]) / 2, (p[1] + corner[1]) / 2];
    if (i >= 0) {
      points[i * 2] = p[0];
      points[i * 2 + 1] = p[1];
    }
  }
  return points;
}
```

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

```js echo
const gasketCanvas = document.createElement("canvas");
gasketCanvas.width = 420;
gasketCanvas.height = 420;
gasketCanvas.style.borderRadius = "8px";
const {context: gasketContext, format: gasketFormat} = webgpu.configureCanvas(gasketCanvas, device);

const gasketShaderModule = device.createShaderModule({code: gasketShaderSource});
const gasketPipeline = device.createRenderPipeline({
  layout: "auto",
  vertex: {
    module: gasketShaderModule,
    entryPoint: "vs_main",
    buffers: [{arrayStride: 2 * 4, attributes: [{shaderLocation: 0, offset: 0, format: "float32x2"}]}]
  },
  fragment: {module: gasketShaderModule, entryPoint: "fs_main", targets: [{format: gasketFormat}]},
  primitive: {topology: "point-list"}
});
```

```js echo
const gasketForm = view(Inputs.form({
  iterations: Inputs.range([100, 30000], {value: 6000, step: 100, label: "chaos-game iterations"})
}));
```

```js echo
const gasketCorners = [[0, 0.85], [-0.85, -0.7], [0.85, -0.7]];
const gasketPointData = sierpinskiPoints(gasketForm.iterations, gasketCorners);
const gasketVertexBuffer = device.createBuffer({
  size: gasketPointData.byteLength,
  usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  mappedAtCreation: true
});
new Float32Array(gasketVertexBuffer.getMappedRange()).set(gasketPointData);
gasketVertexBuffer.unmap();
```

```js echo
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

```js echo
const sphereSmooth = geometry.createSphere(24, 32);
const sphereFlat = geometry.flatten(sphereSmooth);
const smoothVertexData = geometry.interleave(sphereSmooth.positions, sphereSmooth.normals);
const flatVertexData = geometry.interleave(sphereFlat.positions, sphereFlat.normals);

function makeVertexBuffer(data) {
  const buffer = device.createBuffer({size: data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, mappedAtCreation: true});
  new Float32Array(buffer.getMappedRange()).set(data);
  buffer.unmap();
  return buffer;
}
function makeIndexBuffer(data) {
  const buffer = device.createBuffer({size: data.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST, mappedAtCreation: true});
  new Uint16Array(buffer.getMappedRange()).set(data);
  buffer.unmap();
  return buffer;
}

const smoothVertexBuffer = makeVertexBuffer(smoothVertexData);
const smoothIndexBuffer = makeIndexBuffer(sphereSmooth.indices);
const flatVertexBuffer = makeVertexBuffer(flatVertexData);
const flatVertexCount = sphereFlat.positions.length / 3;
```

The camera and model matrix are fixed. Nothing here needs the general
inverse-transpose from the normals section, since this sphere never
scales non-uniformly:

```js echo
const sphereView = mat4.lookAt([2.4, 1.7, 3.2], [0, 0, 0], [0, 1, 0]);
const sphereProjection = mat4.perspective((42 * Math.PI) / 180, 1, 0.1, 20);
const sphereModel = mat4.identity();
const sphereMVP = mat4.multiplyAll([sphereProjection, sphereView, sphereModel]);

const transformData = new Float32Array(32);
transformData.set(sphereMVP, 0);
transformData.set(sphereModel, 16);

const transformBuffer = device.createBuffer({size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
device.queue.writeBuffer(transformBuffer, 0, transformData);

const lightBuffer = device.createBuffer({size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
const materialBuffer = device.createBuffer({size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
const cameraBuffer = device.createBuffer({size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
device.queue.writeBuffer(cameraBuffer, 0, new Float32Array([2.4, 1.7, 3.2, 0]));
```

Two shaders: one evaluates lighting **per vertex** and outputs a color
and is shared by Flat and Gouraud, which differ only in *which* geometry
feeds it (face normals or vertex normals). The other evaluates lighting
**per fragment** (Phong shading):

```js echo
const vertexLitSource = `
struct Transform { mvp: mat4x4<f32>, model: mat4x4<f32> };
@group(0) @binding(0) var<uniform> transform: Transform;
struct Light { position: vec4<f32>, color: vec4<f32> };
@group(0) @binding(1) var<uniform> light: Light;
struct Material { ambient: vec4<f32>, diffuse: vec4<f32>, specular: vec4<f32>, params: vec4<f32> };
@group(0) @binding(2) var<uniform> material: Material;
@group(0) @binding(3) var<uniform> cameraPosition: vec4<f32>;

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec3<f32>,
};

@vertex
fn vs_main(@location(0) inPos: vec3<f32>, @location(1) inNormal: vec3<f32>) -> VertexOut {
  var out: VertexOut;
  let worldPos = (transform.model * vec4<f32>(inPos, 1.0)).xyz;
  let N = normalize((transform.model * vec4<f32>(inNormal, 0.0)).xyz);
  let L = normalize(light.position.xyz - worldPos);
  let V = normalize(cameraPosition.xyz - worldPos);
  let H = normalize(L + V);
  let NdotL = max(dot(N, L), 0.0);
  var specFactor = pow(max(dot(N, H), 0.0), material.params.x);
  specFactor = select(0.0, specFactor, NdotL > 0.0);
  out.color = material.ambient.rgb * light.color.rgb
    + material.diffuse.rgb * NdotL * light.color.rgb
    + material.specular.rgb * specFactor * light.color.rgb;
  out.position = transform.mvp * vec4<f32>(inPos, 1.0);
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  return vec4<f32>(in.color, 1.0);
}
`;

const fragmentLitSource = `
struct Transform { mvp: mat4x4<f32>, model: mat4x4<f32> };
@group(0) @binding(0) var<uniform> transform: Transform;
struct Light { position: vec4<f32>, color: vec4<f32> };
@group(0) @binding(1) var<uniform> light: Light;
struct Material { ambient: vec4<f32>, diffuse: vec4<f32>, specular: vec4<f32>, params: vec4<f32> };
@group(0) @binding(2) var<uniform> material: Material;
@group(0) @binding(3) var<uniform> cameraPosition: vec4<f32>;

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) worldNormal: vec3<f32>,
};

@vertex
fn vs_main(@location(0) inPos: vec3<f32>, @location(1) inNormal: vec3<f32>) -> VertexOut {
  var out: VertexOut;
  out.worldPos = (transform.model * vec4<f32>(inPos, 1.0)).xyz;
  out.worldNormal = (transform.model * vec4<f32>(inNormal, 0.0)).xyz;
  out.position = transform.mvp * vec4<f32>(inPos, 1.0);
  return out;
}

@fragment
fn fs_main(@location(0) worldPos: vec3<f32>, @location(1) worldNormal: vec3<f32>, @builtin(front_facing) isFront: bool) -> @location(0) vec4<f32> {
  // Flip the normal on the back side of a fragment. A closed solid like
  // the sphere never shows its back (cullMode "back" removes it before
  // this shader even runs), so isFront is always true there. This only
  // matters for a genuinely two-sided surface, such as an open sheet.
  let N = select(-normalize(worldNormal), normalize(worldNormal), isFront);
  let L = normalize(light.position.xyz - worldPos);
  let V = normalize(cameraPosition.xyz - worldPos);
  let NdotL = max(dot(N, L), 0.0);

  var specAngle: f32;
  if (material.params.y > 0.5) {
    let H = normalize(L + V);
    specAngle = max(dot(N, H), 0.0);
  } else {
    let R = 2.0 * dot(N, L) * N - L;
    specAngle = max(dot(R, V), 0.0);
  }
  var specFactor = pow(specAngle, material.params.x);
  specFactor = select(0.0, specFactor, NdotL > 0.0);

  let ambient = material.ambient.rgb * light.color.rgb;
  let diffuse = material.diffuse.rgb * NdotL * light.color.rgb;
  let specular = material.specular.rgb * specFactor * light.color.rgb;
  return vec4<f32>(ambient + diffuse + specular, 1.0);
}
`;
```

```js echo
const vertexLayout = {
  arrayStride: 6 * 4,
  attributes: [
    {shaderLocation: 0, offset: 0, format: "float32x3"},
    {shaderLocation: 1, offset: 3 * 4, format: "float32x3"}
  ]
};

function makePipeline(source, canvasFormat, cullMode = "back") {
  const module = device.createShaderModule({code: source});
  return device.createRenderPipeline({
    layout: "auto",
    vertex: {module, entryPoint: "vs_main", buffers: [vertexLayout]},
    fragment: {module, entryPoint: "fs_main", targets: [{format: canvasFormat}]},
    primitive: {topology: "triangle-list", cullMode},
    depthStencil: {format: "depth24plus", depthWriteEnabled: true, depthCompare: "less"}
  });
}

function makeCanvas(size) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  canvas.style.borderRadius = "8px";
  const {context, format} = webgpu.configureCanvas(canvas, device);
  const depthTexture = device.createTexture({size: [size, size], format: "depth24plus", usage: GPUTextureUsage.RENDER_ATTACHMENT});
  return {canvas, context, format, depthTexture};
}

const flatTarget = makeCanvas(240);
const gouraudTarget = makeCanvas(240);
const phongTarget = makeCanvas(240);

const vertexLitPipeline = makePipeline(vertexLitSource, flatTarget.format);
const phongPipeline = makePipeline(fragmentLitSource, phongTarget.format);

function makeBindGroup(pipeline) {
  return device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      {binding: 0, resource: {buffer: transformBuffer}},
      {binding: 1, resource: {buffer: lightBuffer}},
      {binding: 2, resource: {buffer: materialBuffer}},
      {binding: 3, resource: {buffer: cameraBuffer}}
    ]
  });
}

const vertexLitBindGroup = makeBindGroup(vertexLitPipeline);
const phongBindGroup = makeBindGroup(phongPipeline);

function drawSphere({context, depthTexture}, pipeline, bindGroup, vertexBuffer, indexBuffer, count) {
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [{view: context.getCurrentTexture().createView(), clearValue: {r: 0.05, g: 0.05, b: 0.08, a: 1}, loadOp: "clear", storeOp: "store"}],
    depthStencilAttachment: {view: depthTexture.createView(), depthClearValue: 1.0, depthLoadOp: "clear", depthStoreOp: "store"}
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

```js echo
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

```js echo
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
const baseColor = [0.25, 0.55, 0.85];
device.queue.writeBuffer(lightBuffer, 0, new Float32Array([...lightPos, 1, 1, 1, 0]));
device.queue.writeBuffer(materialBuffer, 0, new Float32Array([
  ...baseColor.map((c) => c * shadingForm.ka), 0,
  ...baseColor.map((c) => c * shadingForm.kd), 0,
  1, 1, 1, 0,
  shadingForm.shininess, shadingForm.blinnPhong ? 1 : 0, 0, 0
]));

drawSphere(flatTarget, vertexLitPipeline, vertexLitBindGroup, flatVertexBuffer, null, flatVertexCount);
drawSphere(gouraudTarget, vertexLitPipeline, vertexLitBindGroup, smoothVertexBuffer, smoothIndexBuffer, sphereSmooth.indices.length);
drawSphere(phongTarget, phongPipeline, phongBindGroup, smoothVertexBuffer, smoothIndexBuffer, sphereSmooth.indices.length);
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
