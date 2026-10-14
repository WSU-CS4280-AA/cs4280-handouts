---
title: Module 04 — Graphics Pipeline & WebGPU
toc: true
---

```js echo
import * as mat4 from "./components/mat4.js";
import * as webgpu from "./components/webgpu.js";
import * as Inputs from "npm:@observablehq/inputs";
import {html} from "npm:htl";
```

# Module 04 · The Graphics Pipeline and WebGPU

Modules 01–03 built the math (vectors, matrices, homogeneous
coordinates, and the MVP transform) in plain JavaScript. This module
asks *where* that math actually runs: inside a highly parallel, partly
programmable **pipeline** implemented by GPU hardware and driven from the
browser by **WebGPU**.

| Topic | Question it answers |
|---|---|
| **The pipeline** | Which stages does every vertex and fragment pass through, and which can we program? |
| **Resources and shaders** | Where does data live on the GPU, and how is a shader written? |
| **Drawing in WebGPU** | What is the smallest complete program, and how does a matrix reach the shader? |

By the end of the page your own GPU renders a triangle, and every line of
code that got it there traces back to a pipeline stage. The whole page
uses WebGPU and needs **Chrome or Edge 113+**; Firefox and Safari have
only partial support. This handout teaches the *techniques* behind the
module; it is not a walkthrough of any graded assignment.

## The Pipeline and the GPU

### Why a pipeline?

A GPU is optimized for **throughput**, not latency: thousands of simple
execution units apply the *same* instruction to thousands of data
elements simultaneously, a model called **SIMT** (single instruction,
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
      arrow.textContent = "→";
      arrow.style.opacity = "0.5";
      div.appendChild(arrow);
    }
  });
  return div;
})()
```

The two **blue** stages are *programmable*: you supply the code, written
in **WGSL**. Everything else is **fixed-function**: configurable through
pipeline state, but not replaceable with arbitrary code. Module 03's model,
view, and projection matrices run entirely inside the **vertex shader**
stage; the fixed-function stages after it clip the triangle and then
perform the perspective divide.

### Meet your GPU

Every WebGPU program starts by requesting an **adapter** (a physical GPU)
and a logical **device** connected to it. This is not a simulated
example; it queries *your* browser and hardware:

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

`device` is the object nearly everything below is created from:
`device.createBuffer`, `device.createShaderModule`,
`device.createRenderPipeline`. A device can be **lost** (for example, after a
driver reset or when the browser reclaims GPU resources); production code listens for `device.lost`
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
    row.textContent = `${a}  →  ${b}`;
    row.style.opacity = "0.8";
    div.appendChild(row);
  }
  return div;
})()
```

## Resources and Shaders

### Buffers, textures, and samplers

| Resource | Holds |
|---|---|
| **Buffer** | Untyped linear memory: vertex data, index data, small uniform data, or larger read-write storage data |
| **Texture** | Multidimensional, format-aware image data: color maps, depth buffers, render targets |
| **Sampler** | *How* to read a texture (filtering, addressing); holds no image data itself |

A `usage` flag combination declares which roles a buffer may play,
catching misuse at *creation* time rather than at draw time. This is
one instance of a theme that runs through the whole API: **declare
pipeline state up front, validate once**, instead of re-checking on every
call as older implicit APIs such as OpenGL had to.

### WGSL: a shader for every stage

WGSL (WebGPU Shading Language) is portable (compiles to Metal/HLSL/SPIR-V
internally), strongly typed, and memory-safe. A shader cannot read
arbitrary GPU memory, which is a real security requirement for code
running inside a web page. A minimal vertex/fragment pair, authored directly in
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
`@builtin(position)` is pipeline-defined: clip-space position leaving
the vertex shader, framebuffer (pixel) position entering the fragment shader.
`vs_main` runs once per **vertex**, and `fs_main` runs once per
**fragment**. Rasterization interpolates `color` across the triangle with
**barycentric coordinates**, which is why the triangle below comes out a
smooth gradient from three flat input colors.

## Drawing in WebGPU

### Building the triangle

Every step below maps to one WebGPU object already introduced. First,
three vertices, with position and color interleaved, and a `GPUBuffer` to
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

Next, the WGSL shader above is compiled into a `GPUShaderModule` and
wired to the vertex layout and canvas pixel format inside one
**immutable** `GPURenderPipeline`. The pipeline is created once, never
inside a render loop, because creating it is when the browser compiles
and validates everything:

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

Finally, a `GPUCommandEncoder` records one **render pass** (clear the
canvas, bind the pipeline and vertex buffer, draw 3 vertices), and
`device.queue.submit` hands the finished command buffer to the GPU. The
browser presents the result to the canvas once the GPU is done:

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

That is a complete WebGPU program: request device → configure canvas →
vertex buffer → shader module → pipeline → render pass → submit. Every
object traces back to the pipeline diagram or the resource table above.

### Extending it: an MVP uniform

The next step is a **uniform**: data shared by every invocation in a
draw call, bound through a `@group`/`@binding` pair. Here it is the kind
of matrix Module 03 built, with `mat4.js`'s `translate`, `rotateZ`, and
`scale` composed and uploaded as a WGSL `mat4x4<f32>`. The shader changes
by one line, and the rest of the pipeline keeps the same shape as the
triangle's.

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
bytes) and re-records a fresh render pass. This "create once, update per
frame" discipline is the difference between a real renderer and a
slideshow of recreated pipelines. Nothing here runs on a timer, either:
the canvas redraws only when a slider changes, not in a busy
`requestAnimationFrame` loop, since nothing animates on its own.

## Check Your Understanding

1. Which pipeline stages are programmable, and in what language?
2. `pass.draw(3)` draws the triangle above. How many times does `vs_main` run? About how many times does `fs_main` run?
3. Each vertex above holds a `vec2<f32>` position and a `vec3<f32>` color. What are the `arrayStride` and the color attribute's `offset`?
4. The vertices have flat red, green, and blue colors. Why is the triangle a smooth gradient?
5. In which coordinate space is `@builtin(position)` when it leaves the vertex shader? Which stage performs the perspective divide?
6. Why is the render pipeline created once and not on every slider change?
7. How many bytes does a uniform buffer need for one `mat4x4<f32>`?
8. What does `GPUBufferUsage.COPY_DST` allow, and what happens without it?
9. A buffer, a texture, and a sampler all relate to data a shader reads. What does each one hold?
10. When `device.queue.submit` returns, has the GPU finished drawing?
11. How does the JavaScript side connect `uniformBuffer` to `@group(0) @binding(0)` in the shader?

<details>
<summary>Answers</summary>

1. The vertex and fragment shaders, written in WGSL. The rest of the pipeline is fixed-function and only configurable.
2. 3 times, once per vertex. `fs_main` runs once per fragment, which is roughly the number of pixels the triangle covers.
3. `arrayStride` is ${5 * 4} bytes (five floats). The color starts after two floats, at offset ${2 * 4}.
4. The rasterizer interpolates the vertex shader's `color` output across the triangle with barycentric coordinates, so each fragment gets a blend of the three colors.
5. Clip space. The fixed-function stages clip the triangle and then divide by ${tex`w`}.
6. Creating a pipeline compiles and validates the shaders, which is expensive. A slider change only needs new uniform data, uploaded with `queue.writeBuffer`.
7. ${4 * 4 * 4} bytes: 16 floats of 4 bytes each.
8. It allows the buffer to be the destination of a copy, including `queue.writeBuffer`. Without it, the write fails validation.
9. A buffer holds untyped linear memory. A texture holds format-aware image data with dimensions and mip levels. A sampler holds no data, only the rules for filtering and addressing a texture.
10. No. `submit` only queues the work; the GPU runs it asynchronously.
11. A bind group built with `xformPipeline.getBindGroupLayout(0)` lists `{binding: 0, resource: {buffer: uniformBuffer}}`, and `pass.setBindGroup(0, ...)` attaches it to group 0 for the draw.

</details>

## Common Pitfalls

- **Confusing buffers and textures.** A `GPUBuffer` is untyped linear
  memory; a `GPUTexture` carries explicit dimensions, format, and mip
  structure.
- **Recreating pipelines every frame.** Pipeline creation compiles and
  validates shaders. Do it once, during setup, as both examples above do.
- **Uploading data inefficiently.** Reuse persistent buffers and update
  only the changed bytes with `queue.writeBuffer`, as the uniform example
  does, instead of recreating buffers on each change.
- **Mismatching the vertex layout and the shader.** `arrayStride`,
  `offset`, and `format` must agree with the data in the buffer and with
  the shader's `@location` inputs, or the vertices read garbage.
- **Forgetting a usage flag.** A buffer written with `queue.writeBuffer`
  needs `COPY_DST`, and a uniform buffer needs `UNIFORM`.
- **Assuming GPU execution is synchronous with JavaScript.**
  `queue.submit` returns immediately, and the GPU executes later.
- **Mixing CPU and GPU responsibilities.** Per-vertex and per-fragment
  computation belongs in WGSL, not JavaScript.

## Summary

- **The pipeline:** **programmable** stages (vertex and fragment, written
  in WGSL) and **fixed-function** stages (assembly, clipping,
  rasterization, per-fragment tests) that are configurable but not
  replaceable.
- **WebGPU objects:** the adapter, device, queue, buffers, textures, and
  samplers form one object graph, and nearly everything is created from
  `device`.
- **A complete program:** request device → configure canvas → vertex
  buffer → shader module → render pipeline → render pass → submit.
- **Uniforms:** pipelines are immutable and created once. Uniforms, bound
  through `@group`/`@binding`, carry per-draw data such as Module 03's MVP
  matrix to a shader without rebuilding the pipeline.
