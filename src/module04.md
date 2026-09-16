---
title: Week 04 — Graphics Pipeline & WebGPU
toc: true
---

```js echo
import * as mat4 from "./components/mat4.js";
import * as webgpu from "./components/webgpu.js";
import * as Inputs from "npm:@observablehq/inputs";
import {html} from "npm:htl";
```

# Module 04 · The Graphics Pipeline and WebGPU

Weeks 1–3 built the math — vectors, matrices, homogeneous coordinates,
the MVP pipeline — entirely in plain JavaScript. This week asks *where*
that math actually runs: inside a highly parallel, partly-programmable
**pipeline** implemented by real GPU hardware, driven from the browser by
**WebGPU**. By the end of this page a real GPU renders a real triangle,
and every line of code that got it there will be traceable back to a
specific pipeline stage.

This handout needs **Chrome or Edge 113+** (WebGPU enabled by default) —
Firefox and Safari have only partial support as of 2026. It teaches the
**techniques** behind the pipeline and the API; it is not a walkthrough of
any graded assignment.

## Why a Pipeline?

A GPU is optimized for **throughput**, not latency: thousands of simple
execution units apply the *same* instruction to thousands of data
elements simultaneously — a model called **SIMT** (single instruction,
multiple threads). Rendering hands the GPU exactly the kind of work this
suits: transform a million vertices, shade two million fragments, all
independent of one another. The pipeline is the fixed sequence every one
of them flows through:

```js echo
(() => {
  const stages = ["Application (CPU)", "Input Assembler", "Vertex Shader", "Primitive Assembly", "Clipping", "Rasterization", "Fragment Shader", "Per-Fragment Ops", "Framebuffer"];
  const programmable = new Set(["Vertex Shader", "Fragment Shader"]);
  const div = document.createElement("div");
  div.style.display = "flex"; div.style.flexWrap = "wrap"; div.style.gap = "6px"; div.style.alignItems = "center";
  stages.forEach((label, i) => {
    const chip = document.createElement("span");
    chip.textContent = label;
    chip.style.padding = "4px 10px";
    chip.style.borderRadius = "999px";
    chip.style.fontSize = "13px";
    chip.style.background = programmable.has(label) ? "#3d6fc4" : "var(--theme-background-alt, #f5f5f5)";
    chip.style.color = programmable.has(label) ? "white" : "inherit";
    div.appendChild(chip);
    if (i < stages.length - 1) {
      const arrow = document.createElement("span");
      arrow\.textContent = "→";
      arrow\.style.opacity = "0.5";
      div.appendChild(arrow);
    }
  });
  return div;
})()
```

The two **blue** stages are *programmable* — you supply the code, written
in **WGSL**. Everything else is **fixed-function**: configurable through
pipeline state, but not replaceable with arbitrary code. Week 3's model,
view, and projection matrices run entirely inside the **vertex shader**
stage; the perspective divide happens as part of clipping.

## Meet Your GPU

Every WebGPU program starts by requesting an **adapter** (a physical GPU)
and a logical **device** connected to it. This isn't a simulated example
— it queries *your* actual browser and hardware, right now:

```js echo
const {adapter, device} = await webgpu.requestDevice();
```

```js echo
(() => {
  const info = adapter.info ?? {};
  const lim = adapter.limits;
  return html`<pre>vendor        ${info.vendor || "(not reported)"}
architecture  ${info.architecture || "(not reported)"}
device        ${info.device || "(not reported)"}
description   ${info.description || "(not reported)"}
maxTextureDimension2D  ${lim.maxTextureDimension2D}
maxBindGroups          ${lim.maxBindGroups}
maxVertexBuffers       ${lim.maxVertexBuffers}
maxVertexAttributes    ${lim.maxVertexAttributes}
maxColorAttachments    ${lim.maxColorAttachments}
features (${[...adapter.features].length}): ${[...adapter.features].join(", ") || "(none)"}</pre>`;
})()
```

`device` is the object nearly everything below is created from —
`device.createBuffer`, `device.createShaderModule`,
`device.createRenderPipeline`. A device can be **lost** (a driver reset, a
crashed tab reclaiming memory); production code listens for `device.lost`
and is ready to recreate it. `adapter`, `device`, and `queue` are the hub
of the whole object graph:

```js echo
(() => {
  const edges = [
    ["GPUAdapter", "GPUDevice"], ["GPUDevice", "GPUQueue"], ["GPUDevice", "GPUBuffer"],
    ["GPUDevice", "GPUTexture"], ["GPUDevice", "GPUSampler"], ["GPUDevice", "GPUShaderModule"],
    ["GPUShaderModule", "GPURenderPipeline"], ["GPUBuffer", "GPURenderPipeline"],
    ["GPURenderPipeline", "GPUQueue"]
  ];
  const div = document.createElement("div");
  div.style.display = "flex"; div.style.flexDirection = "column"; div.style.gap = "3px"; div.style.font = "13px var(--monospace, monospace)";
  for (const [a, b] of edges) {
    const row = document.createElement("div");
    row\.textContent = `${a}  →  ${b}`;
    row\.style.opacity = "0.8";
    div.appendChild(row);
  }
  return div;
})()
```

## Buffers, Textures, and Samplers

| Resource | Holds |
|---|---|
| **Buffer** | Untyped linear memory — vertex data, index data, small uniform data, or larger read-write storage data |
| **Texture** | Multidimensional, format-aware image data — color maps, depth buffers, render targets |
| **Sampler** | *How* to read a texture (filtering, addressing) — holds no image data itself |

A `usage` flag combination declares which roles a buffer may play,
catching misuse at *creation* time rather than at draw time — one
instance of a theme that runs through the whole API: **declare pipeline state up front, validate once**, instead of re-checking on every call, as
older implicit APIs like OpenGL had to.

## WGSL: a Shader for Every Stage

WGSL (WebGPU Shading Language) is portable (compiles to Metal/HLSL/SPIR-V
internally), strongly typed, and memory-safe — a shader cannot be used to
read arbitrary GPU memory, a real security requirement for code running
inside a web page. A minimal vertex/fragment pair, authored directly in
NDC (no MVP matrix yet):

```wgsl
struct VertexOut {
  @builtin(position) position : vec4<f32>,
  @location(0) color : vec3<f32>,
};

@vertex
fn vs_main(
  @location(0) inPos: vec2<f32>,
  @location(1) inColor: vec3<f32>
) -> VertexOut {
  var out: VertexOut;
  out.position = vec4<f32>(inPos, 0.0, 1.0);
  out.color = inColor;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  return vec4<f32>(in.color, 1.0);
}
```

`@location(n)` marks per-vertex inputs and interpolated outputs;
`@builtin(position)` is pipeline-defined — clip-space position leaving
the vertex shader, screen-space position entering the fragment shader.
`vs_main` runs once per **vertex**; `fs_main` runs once per **fragment**,
with `color` automatically interpolated across the triangle by
**barycentric coordinates** during rasterization — which is exactly why
the triangle below comes out a smooth gradient from three flat input
colors.

## Building the Triangle

Every step below maps to one WebGPU object already introduced. First,
three vertices — position and color interleaved — and a `GPUBuffer` to
hold them on the GPU:

```js echo
const vertices = new Float32Array([
  //  x,    y,    r,   g,   b
     0.0,  0.5,  1.0, 0.0, 0.0,
    -0.5, -0.5,  0.0, 1.0, 0.0,
     0.5, -0.5,  0.0, 0.0, 1.0
]);
const vertexBuffer = device.createBuffer({
  size: vertices.byteLength,
  usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  mappedAtCreation: true
});
new Float32Array(vertexBuffer.getMappedRange()).set(vertices);
vertexBuffer.unmap();
```

The shader from §4, compiled into a `GPUShaderModule`, then wired to the
vertex layout and canvas pixel format inside one **immutable**
`GPURenderPipeline` — created once, never inside a render loop, because
creating it is exactly when the browser compiles and validates
everything:

```js echo
const shaderSource = `
struct VertexOut {
  @builtin(position) position : vec4<f32>,
  @location(0) color : vec3<f32>,
};

@vertex
fn vs_main(
  @location(0) inPos: vec2<f32>,
  @location(1) inColor: vec3<f32>
) -> VertexOut {
  var out: VertexOut;
  out.position = vec4<f32>(inPos, 0.0, 1.0);
  out.color = inColor;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  return vec4<f32>(in.color, 1.0);
}
`;
const shaderModule = device.createShaderModule({code: shaderSource});
```

```js echo
const triangleCanvas = document.createElement("canvas");
triangleCanvas.width = 400;
triangleCanvas.height = 300;
triangleCanvas.style.borderRadius = "8px";
const {context: triangleContext, format: triangleFormat} = webgpu.configureCanvas(triangleCanvas, device);
const pipeline = device.createRenderPipeline({
  layout: "auto",
  vertex: {
    module: shaderModule,
    entryPoint: "vs_main",
    buffers: [{
      arrayStride: 5 * 4,
      attributes: [
        {shaderLocation: 0, offset: 0, format: "float32x2"}, // position
        {shaderLocation: 1, offset: 2 * 4, format: "float32x3"} // color
      ]
    }]
  },
  fragment: {module: shaderModule, entryPoint: "fs_main", targets: [{format: triangleFormat}]},
  primitive: {topology: "triangle-list"}
});
```

Finally, a `GPUCommandEncoder` records one **render pass** — clear the
canvas, bind the pipeline and vertex buffer, draw 3 vertices — and
`device.queue.submit` hands the finished command buffer to the GPU. The
browser presents the result to the canvas automatically once it's done:

```js echo
(() => {
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: triangleContext.getCurrentTexture().createView(),
      clearValue: {r: 0.05, g: 0.05, b: 0.08, a: 1.0},
      loadOp: "clear",
      storeOp: "store"
    }]
  });
  pass.setPipeline(pipeline);
  pass.setVertexBuffer(0, vertexBuffer);
  pass.draw(3);
  pass.end();
  device.queue.submit([encoder.finish()]);
  return triangleCanvas;
})()
```

That's a complete WebGPU program: request device → configure canvas →
vertex buffer → shader module → pipeline → render pass → submit. Every
object above traces back to §1's pipeline diagram or §3's resource table
— nothing here is unexplained magic.

## Extending It: an MVP Uniform, Live

The lecture's own next step is a **uniform** — data shared by every
invocation in a draw call, bound through a `@group`/`@binding` pair. Here
it's exactly the kind of matrix Week 3 built: `mat4.js`'s `translate`,
`rotateZ`, and `scale`, composed and uploaded as a WGSL
`mat4x4<f32>`. The shader changes by exactly one line; everything else
about the pipeline stays the same shape as §5.

```wgsl
struct Uniforms {
  transform : mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> u : Uniforms;

@vertex
fn vs_main(
  @location(0) inPos: vec2<f32>,
  @location(1) inColor: vec3<f32>
) -> VertexOut {
  var out: VertexOut;
  out.position = u.transform * vec4<f32>(inPos, 0.0, 1.0); // ← the only change
  out.color = inColor;
  return out;
}
```

```js echo
const xformShaderSource = `
struct Uniforms {
  transform : mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> u : Uniforms;

struct VertexOut {
  @builtin(position) position : vec4<f32>,
  @location(0) color : vec3<f32>,
};

@vertex
fn vs_main(
  @location(0) inPos: vec2<f32>,
  @location(1) inColor: vec3<f32>
) -> VertexOut {
  var out: VertexOut;
  out.position = u.transform * vec4<f32>(inPos, 0.0, 1.0);
  out.color = inColor;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  return vec4<f32>(in.color, 1.0);
}
`;
const xformCanvas = document.createElement("canvas");
xformCanvas.width = 320;
xformCanvas.height = 320;
xformCanvas.style.borderRadius = "8px";
const {context: xformContext, format: xformFormat} = webgpu.configureCanvas(xformCanvas, device);
const xformShaderModule = device.createShaderModule({code: xformShaderSource});
const xformPipeline = device.createRenderPipeline({
  layout: "auto",
  vertex: {
    module: xformShaderModule,
    entryPoint: "vs_main",
    buffers: [{
      arrayStride: 5 * 4,
      attributes: [
        {shaderLocation: 0, offset: 0, format: "float32x2"},
        {shaderLocation: 1, offset: 2 * 4, format: "float32x3"}
      ]
    }]
  },
  fragment: {module: xformShaderModule, entryPoint: "fs_main", targets: [{format: xformFormat}]},
  primitive: {topology: "triangle-list"}
});

// 4x4 f32 matrix = 64 bytes. COPY_DST lets queue.writeBuffer update it
// after creation, instead of recreating the buffer every change.
const uniformBuffer = device.createBuffer({
  size: 64,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
});
const xformBindGroup = device.createBindGroup({
  layout: xformPipeline.getBindGroupLayout(0),
  entries: [{binding: 0, resource: {buffer: uniformBuffer}}]
});

function drawTransformed() {
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: xformContext.getCurrentTexture().createView(),
      clearValue: {r: 0.05, g: 0.05, b: 0.08, a: 1.0},
      loadOp: "clear",
      storeOp: "store"
    }]
  });
  pass.setPipeline(xformPipeline);
  pass.setBindGroup(0, xformBindGroup);
  pass.setVertexBuffer(0, vertexBuffer);
  pass.draw(3);
  pass.end();
  device.queue.submit([encoder.finish()]);
}
```

```js echo
xformCanvas
```

```js echo
const xformForm = view(Inputs.form({
  rotate: Inputs.range([-180, 180], {value: 15, step: 1, label: "rotate θ (degrees)"}),
  scale: Inputs.range([0.3, 2], {value: 1, step: 0.05, label: "scale"}),
  tx: Inputs.range([-0.6, 0.6], {value: 0, step: 0.02, label: "translate x"}),
  ty: Inputs.range([-0.6, 0.6], {value: 0, step: 0.02, label: "translate y"})
}));
```

```js echo
const xformMatrix = mat4.multiplyAll([
  mat4.translate(xformForm.tx, xformForm.ty, 0),
  mat4.rotateZ((xformForm.rotate * Math.PI) / 180),
  mat4.scale(xformForm.scale, xformForm.scale, 1)
]);
device.queue.writeBuffer(uniformBuffer, 0, xformMatrix);
drawTransformed();
```

The pipeline, shader module, and both buffers were created **once**,
above; dragging a slider only calls `queue.writeBuffer` (upload 64 new
bytes) and re-records a fresh render pass — the exact "create once,
update per frame" discipline the lecture calls out as the difference
between a real renderer and a slideshow of recreated pipelines. Nothing
here runs on a timer, either: it redraws only when a slider actually
changes, not in a busy `requestAnimationFrame` loop, since nothing is
animating on its own.

`mat4.js` is generated from `reference/lib/math/{mat4,transforms}.js` —
the same array-based matrix functions Assignment 2's starter code
composes into its own MVP uniform, not just the same math.

## Common Pitfalls

\- ****Confusing buffers and textures**** — a `GPUBuffer` is untyped linear
  memory; a `GPUTexture` carries explicit dimensionality, format, and mip
  structure.
\- ****Recreating pipelines every frame**** — pipeline creation compiles and
  validates shaders; do it once, during setup, exactly like §5 and §6
  above.
\- ****Uploading data inefficiently**** — reuse persistent buffers and update
  only changed bytes via `queue.writeBuffer`, as §6's uniform does,
  instead of recreating buffers each change.
\- ****Assuming GPU execution is synchronous with JavaScript**** —
  `queue.submit` returns immediately; the GPU executes asynchronously.
\- ****Mixing CPU and GPU responsibilities**** — per-vertex and per-fragment
  computation belongs in WGSL, not JavaScript.

## Summary

\- The graphics pipeline has **programmable** stages (vertex, fragment —
  written in WGSL) and **fixed-function** stages (assembly, clipping,
  rasterization, per-fragment tests) — configurable, not replaceable.
\- WebGPU's core objects — **adapter, device, queue, buffer, texture,
  sampler** — form one object graph, everything ultimately created from
  `device`.
\- A complete program is seven traceable steps: request device → configure
  canvas → vertex buffer → shader module → render pipeline → render pass
  → submit.
\- **Pipelines are immutable** and created once; **uniforms**, bound
  through `@group`/`@binding`, are how per-draw data — like Week 3's MVP
  matrix — reaches a shader without rebuilding the pipeline.

