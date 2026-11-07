---
title: Module 04 — Graphics Pipeline & WebGPU
toc: true
---

```js
import * as mat4 from "./lib/math/mat4.js";
import * as transforms from "./lib/math/transforms.js";
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
code that got it there traces back to a pipeline stage. The code is part of
the reading, so nearly all of it is shown and built one step at a time. The
whole page uses WebGPU and needs **Chrome or Edge 113+**; Firefox and Safari
have only partial support. This handout teaches the *techniques* behind the
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

```js
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

Every WebGPU program starts the same way. We ask the browser for an
**adapter**, which represents a physical GPU, and then ask the adapter for a
logical **device**, our private connection to it. Either request can fail,
because a browser may not support WebGPU or may have no usable GPU, so each
one gets a check. Both requests are asynchronous, hence the `await`. This is
not a simulated example; it queries *your* browser and hardware:

```js echo
if (!navigator.gpu) throw new Error("WebGPU is not supported here.");
const adapter = await navigator.gpu.requestAdapter();
if (!adapter) throw new Error("No suitable GPU adapter found.");
const device = await adapter.requestDevice();
```

The adapter also reports what the hardware can do. For example,
`adapter.limits.maxBindGroups` says how many groups of shader resources can be
bound at once. WebGPU guarantees at least 4, and this number will matter when
we meet `@group` later on the page:

```js echo
adapter.limits.maxBindGroups
```

Here is more of what your adapter reports, read from `adapter.info`,
`adapter.limits`, and `adapter.features`:

```js
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
and is ready to recreate it. The device also owns a `queue`, the channel that
carries our finished work to the GPU. `adapter`, `device`, and `queue` are the
hub of the whole object graph:

```js
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
running inside a web page.

From JavaScript's point of view, a shader is just text that we hand to the
device, so we keep it in strings. We will write a minimal vertex/fragment pair,
authored directly in NDC (no MVP matrix yet), one piece at a time.

The two programmable stages need a way to pass data along. This struct is the
vertex shader's output and, after rasterization, the fragment shader's input:

```js echo
const wgslVertexOut = `
struct VertexOut {
  @builtin(position) position : vec4<f32>,
  @location(0) color : vec3<f32>,
};`;
```

`@builtin(position)` is pipeline-defined: clip-space position leaving the vertex
shader, framebuffer (pixel) position entering the fragment shader. A `@location`
value has no built-in meaning, and the rasterizer simply interpolates it.

The vertex shader runs once per **vertex**. Its two parameters arrive from the
vertex buffer, and we will soon tell the pipeline how to find them. Because the
positions are already in NDC, it only needs to widen each 2D point to a
`vec4`, with ${tex`z = 0`} and ${tex`w = 1`}, and pass the color along.
`VertexOut(...)` builds the struct, giving its fields in order:

```js echo
const wgslVertexShader = `
@vertex
fn vs_main(
  @location(0) inPos: vec2<f32>,
  @location(1) inColor: vec3<f32>
) -> VertexOut {
  return VertexOut(vec4<f32>(inPos, 0.0, 1.0), inColor);
}`;
```

Later modules use a longer form of the same thing, which suits shaders with more
to compute: declare `var out: VertexOut;`, assign its fields one by one, and
`return out;`.

The fragment shader runs once per **fragment** and returns its color, with
alpha added:

```js echo
const wgslFragmentShader = `
@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  return vec4<f32>(in.color, 1.0);
}`;
```

Notice that `@location` has now appeared in three different roles:

| Where | `@location(n)` means |
|---|---|
| Vertex shader parameter | Attribute `n` from the vertex buffer |
| `VertexOut` field | Interpolated value `n`, passed from vertex to fragment shader |
| Fragment shader return value | Color target `n` of the render pass |

Rasterization interpolates `color` across the triangle with **barycentric
coordinates**, which is why the triangle below comes out a smooth gradient from
three flat input colors. Joining the pieces gives the complete shader:

```js echo
const shaderSource =
  [wgslVertexOut, wgslVertexShader, wgslFragmentShader].join("\n");
```

## Drawing in WebGPU

### Building the triangle

We already have the device, the first step of the seven in a complete WebGPU
program. Now for the other six, and every one maps to an object already
introduced.

**Step 2: configure a canvas.** The GPU needs somewhere to draw. First, ask the
browser which pixel format is most efficient on this machine:

```js echo
const format = navigator.gpu.getPreferredCanvasFormat();
```

```js echo
format
```

You will typically see `bgra8unorm` or `rgba8unorm`: 8 bits per channel, in one
of two byte orders. Since we need a second canvas later, we wrap the setup in a
function. Asking for the `"webgpu"` context connects the canvas to WebGPU, and
`configure` tells it which device will draw into it and in what format.
`alphaMode: "opaque"` means the canvas does not blend with the page behind it.

```js echo
function createWebGPUCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("webgpu");
  context.configure({device, format, alphaMode: "opaque"});
  return {canvas, context};
}
```

```js echo
const {canvas: triangleCanvas, context: triangleContext} =
  createWebGPUCanvas(400, 300);
```

**Step 3: create a vertex buffer.** Our triangle has three vertices, with
position and color **interleaved** in one array, five floats per vertex. The
positions are in NDC, where ${tex`x`} and ${tex`y`} run from −1 to 1. The top
vertex is red, and the bottom two are green and blue:

```js echo
const vertices = new Float32Array([
  //  x,    y,    r,   g,   b
     0.0,  0.5,  1.0, 0.0, 0.0,
    -0.5, -0.5,  0.0, 1.0, 0.0,
     0.5, -0.5,  0.0, 0.0, 1.0
]);
```

That array is in JavaScript memory, so the GPU cannot use it yet. We need a
`GPUBuffer` of the same size, with `usage` flags saying it holds vertices and
can receive copied data. `mappedAtCreation` gives JavaScript temporary access
to the new buffer's memory. We copy the data through `getMappedRange`, then
`unmap` to hand the memory over to the GPU:

```js echo
const vertexBuffer = device.createBuffer({
  size: vertices.byteLength,
  usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  mappedAtCreation: true
});
new Float32Array(vertexBuffer.getMappedRange()).set(vertices);
vertexBuffer.unmap();
```

Check what we made. We expect 60 bytes, from 3 vertices × 5 floats × 4 bytes.
The usage is a set of bit flags, so `VERTEX` (32) and `COPY_DST` (8) combine
to 40:

```js echo
[vertexBuffer.size, vertexBuffer.usage]
```

**Step 4: compile the shader.** `createShaderModule` hands our WGSL text to the
device:

```js echo
const shaderModule = device.createShaderModule({code: shaderSource});
```

The module can report any errors or warnings from compiling the WGSL. An empty
list means the shader is clean:

```js echo
(await shaderModule.getCompilationInfo()).messages
```

**Step 5: create the pipeline.** The buffer is only bytes, and the shader expects
`inPos` and `inColor`, so something must connect them. A **vertex layout**
describes one vertex: its total size (`arrayStride`), and where each attribute
starts, in what format, and which `@location` receives it:

```js echo
const vertexLayout = {
  arrayStride: 5 * 4,   // 5 floats, 4 bytes each
  attributes: [
    {shaderLocation: 0, offset: 0, format: "float32x2"},      // position
    {shaderLocation: 1, offset: 2 * 4, format: "float32x3"}   // color
  ]
};
```

This is exactly the arithmetic the **input assembler** stage performs. We can
do it by hand: vertex 1 starts at byte 20, and its color starts 8 bytes after
that. Reading three floats there should give the second vertex's color, green,
or `[0, 1, 0]`:

```js echo
new Float32Array(vertices.buffer, 1 * 20 + 8, 3)
```

Now the **pipeline** ties everything together: the shader's two entry points,
the vertex layout, the canvas format, and how to assemble vertices into
primitives (`"triangle-list"` means every three vertices form a triangle).
`layout: "auto"` asks WebGPU to work out the resource layout from the shader.
Since the uniform example below needs the same pipeline with another shader, this
is a function of the shader module:

```js echo
function createTrianglePipeline(module) {
  return device.createRenderPipeline({
    layout: "auto",
    vertex: {module, entryPoint: "vs_main", buffers: [vertexLayout]},
    fragment: {module, entryPoint: "fs_main", targets: [{format}]},
    primitive: {topology: "triangle-list"}
  });
}
```

```js echo
const pipeline = createTrianglePipeline(shaderModule);
```

A `GPURenderPipeline` is **immutable**. It is created once, never inside a
render loop, because creating it is when the browser compiles and validates
everything.

**Step 6: record a render pass.** WebGPU never draws at the moment you ask.
Instead, a `GPUCommandEncoder` records commands into a list. A **render pass**
is a group of drawing commands aimed at one target. Each frame, the target is the
canvas's current texture, and this helper starts a pass that first clears it to
a dark color (`loadOp`), then keeps what we draw (`storeOp`):

```js echo
function beginClearPass(encoder, context) {
  return encoder.beginRenderPass({colorAttachments: [{
    view: context.getCurrentTexture().createView(),
    clearValue: {r: 0.05, g: 0.05, b: 0.08, a: 1.0},
    loadOp: "clear",
    storeOp: "store"
  }]});
}
```

**Step 7: submit.** We bind the pipeline and vertex buffer, draw 3 vertices, and
close the pass. `encoder.finish()` produces a command buffer, and
`device.queue.submit` hands it to the GPU. Nothing is drawn until this last line,
and even then `submit` returns before the GPU finishes. The browser presents the
result to the canvas once the GPU is done:

```js echo
const encoder = device.createCommandEncoder();
const pass = beginClearPass(encoder, triangleContext);
pass.setPipeline(pipeline);
pass.setVertexBuffer(0, vertexBuffer);
pass.draw(3);
pass.end();
device.queue.submit([encoder.finish()]);
```

```js
Object.assign(triangleCanvas, {style: "border-radius: 8px"})
```

That is a complete WebGPU program: request device → configure canvas →
vertex buffer → shader module → pipeline → render pass → submit. Every
object traces back to the pipeline diagram or the resource table above:

| Code | Pipeline stage it controls |
|---|---|
| `vertexBuffer`, `vertexLayout` | Input assembler: finds each vertex's attributes |
| `vs_main` | Vertex shader: runs 3 times, once per vertex |
| `topology: "triangle-list"` | Primitive assembly: forms one triangle from the 3 vertices |
| *(no code)* | Clipping and rasterization: find the covered pixels and interpolate `color` |
| `fs_main` | Fragment shader: runs once per covered pixel |
| `targets: [{format}]`, `loadOp`, `storeOp` | Framebuffer: where and how the color is written |

Let's check the gradient by doing the rasterizer's job for a single point.
A fragment's barycentric coordinates weight the three vertex colors:

```js echo
function interpolatedColor(weights) {
  const colorOf = (v) => vertices.slice(v * 5 + 2, v * 5 + 5);
  return [0, 1, 2].map((c) => d3.sum(weights, (w, v) => w * colorOf(v)[c]));
}
```

A fragment near the top vertex should be almost pure red:

```js echo
interpolatedColor([0.9, 0.05, 0.05])
```

One at the center, with equal weights, should be an even mix, the gray you can
see in the middle of the triangle:

```js echo
interpolatedColor([1 / 3, 1 / 3, 1 / 3])
```

### Extending it: an MVP uniform

The next step is a **uniform**: data shared by every invocation in a
draw call, bound through a `@group`/`@binding` pair. Here it is the kind
of matrix Module 03 built. The shader declares the matrix, in group 0 and
binding 0:

```js echo
const wgslUniforms = `
struct Uniforms {
  transform : mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> u : Uniforms;`;
```

The vertex shader changes by one line, where the position is now multiplied by
`u.transform`. The fragment shader does not change at all:

```js echo
const wgslXformVertexShader = `
@vertex
fn vs_main(
  @location(0) inPos: vec2<f32>,
  @location(1) inColor: vec3<f32>
) -> VertexOut {
  return VertexOut(u.transform * vec4<f32>(inPos, 0.0, 1.0), inColor);
}`;
```

The rest keeps the same shape as the triangle's. We reuse the earlier struct and
fragment shader, and `createTrianglePipeline` needs only the new module:

```js echo
const xformShaderSource = [wgslUniforms, wgslVertexOut,
  wgslXformVertexShader, wgslFragmentShader
].join("\n");
const xformShaderModule =
  device.createShaderModule({code: xformShaderSource});
const xformPipeline = createTrianglePipeline(xformShaderModule);
```

```js echo
const {canvas: xformCanvas, context: xformContext} =
  createWebGPUCanvas(320, 320);
```

The new part is getting the matrix to the shader, which takes two objects. The
**uniform buffer** holds the data. A 4x4 `f32` matrix is 64 bytes, and `COPY_DST`
lets `queue.writeBuffer` update it after creation, instead of recreating the
buffer on every change:

```js echo
const uniformBuffer = device.createBuffer({
  size: 64,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
});
```

The **bind group** connects that buffer to the shader's declaration. The entry's
`binding: 0` matches `@binding(0)`, and the layout for group 0 comes from the
pipeline, which worked it out from the shader because of `layout: "auto"`:

```js echo
const xformBindGroup = device.createBindGroup({
  layout: xformPipeline.getBindGroupLayout(0),
  entries: [{binding: 0, resource: {buffer: uniformBuffer}}]
});
```

Drawing looks just like the triangle, with one new call, `pass.setBindGroup(0, ...)`,
which matches `@group(0)`:

```js echo
function drawTransformed() {
  const encoder = device.createCommandEncoder();
  const pass = beginClearPass(encoder, xformContext);
  pass.setPipeline(xformPipeline);
  pass.setBindGroup(0, xformBindGroup);
  pass.setVertexBuffer(0, vertexBuffer);
  pass.draw(3);
  pass.end();
  device.queue.submit([encoder.finish()]);
}
```

Now for the matrix itself. We compose `translate`, `rotateZ`, and `scale` from
`transforms.js`, as in Module 03. The rightmost matrix applies first, so the
triangle is scaled, then rotated, then translated:

```js echo
const xformMatrix = mat4.multiplyAll([
  transforms.translate(xformForm.tx, xformForm.ty, 0),
  transforms.rotateZ((xformForm.rotate * Math.PI) / 180),
  transforms.scale(xformForm.scale, xformForm.scale, 1)
]);
```

Whenever the sliders change the matrix, this cell uploads the new 64 bytes and
redraws. `xformMatrix` is already a `Float32Array` in the column-major order WGSL
expects, so it can be written directly:

```js echo
device.queue.writeBuffer(uniformBuffer, 0, xformMatrix);
drawTransformed();
```

```js
Object.assign(xformCanvas, {style: "border-radius: 8px"})
```

```js
const xformForm = view(Inputs.form({
  rotate: Inputs.range([-180, 180], {value: 15, step: 1, label: "rotate θ (degrees)"}),
  scale: Inputs.range([0.3, 2], {value: 1, step: 0.05, label: "scale"}),
  tx: Inputs.range([-0.6, 0.6], {value: 0, step: 0.02, label: "translate x"}),
  ty: Inputs.range([-0.6, 0.6], {value: 0, step: 0.02, label: "translate y"})
}));
```

The GPU's work for each vertex is the same matrix multiplication we did on the
CPU in Module 03. We can compute it here too. This is where the top vertex,
`(0, 0.5)`, lands in NDC. Drag the sliders and watch it change along with the
top of the triangle. The result is `[x, y, z, w]`, and at the starting 15°
rotation it should be about `[-0.129, 0.483, 0, 1]`:

```js echo
mat4.transformPoint(xformMatrix, [0, 0.5, 0])
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
