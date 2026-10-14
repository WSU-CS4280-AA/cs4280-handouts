---
title: Tutorial — Making Textures with Canvas 2D
toc: true
---

```js echo
import * as webgpu from "./components/webgpu.js";
import * as raster from "./components/raster.js";
import * as Inputs from "npm:@observablehq/inputs";
```

# Tutorial · Making Textures with Canvas 2D

A texture doesn't have to start as an image file. Any `<canvas>` you draw
on with the browser's **Canvas 2D** API can be uploaded to a WebGPU
texture with one call, `copyExternalImageToTexture`. That makes Canvas
2D a quick way to create textures in code: checkerboards, bricks, wood,
noise, debug grids, and labels. There are no files to ship and no
licensing questions, and every parameter can be a slider.

This tutorial covers:

1. How canvas pixels map to texture coordinates.
2. The Canvas 2D drawing toolkit.
3. Four recipes: checkerboard, bricks, wood, and pixel-level noise.
4. How to make a texture **tile seamlessly**.
5. Texture size, mipmaps, and why thin lines disappear.
6. Uploading canvases to WebGPU, including texture arrays.
7. Using real image files through the same pipeline.

Sections 1–5 are plain JavaScript. Section 6 uses WebGPU and needs
**Chrome or Edge 113+**.

## Helpers

Three small helpers are used throughout. `show` makes a *copy* of a
canvas for display. A DOM node can only be in one place on the page, so
appending the same canvas twice would move it rather than duplicate it.
`tiled` previews a texture repeated 2 × 2, with dashed lines on the
tile borders, which is the quickest way to spot a seam. It uses Canvas
2D's own `createPattern`, the same repeat behavior a GPU sampler gives
you with `addressMode: "repeat"`.

```js echo
function makeCanvas(width, height = width) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

// A display-only copy of `canvas`, `px` CSS pixels wide (pixelated when enlarged).
function show(canvas, px = 256) {
  const copy = makeCanvas(canvas.width, canvas.height);
  copy.getContext("2d").drawImage(canvas, 0, 0);
  copy.style.width = `${px}px`;
  copy.style.imageRendering = px > canvas.width ? "pixelated" : "auto";
  copy.style.borderRadius = "6px";
  return copy;
}

// `canvas` repeated tiles x tiles via createPattern, with the tile borders dashed.
function tiled(canvas, {tiles = 2, px = 256, outline = true} = {}) {
  const out = makeCanvas(canvas.width * tiles, canvas.height * tiles);
  const ctx = out.getContext("2d");
  ctx.fillStyle = ctx.createPattern(canvas, "repeat");
  ctx.fillRect(0, 0, out.width, out.height);
  if (outline) {
    ctx.strokeStyle = "rgba(255, 0, 255, 0.7)";
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 8]);
    for (let i = 1; i < tiles; i++) {
      ctx.beginPath();
      ctx.moveTo(i * canvas.width, 0);
      ctx.lineTo(i * canvas.width, out.height);
      ctx.moveTo(0, i * canvas.height);
      ctx.lineTo(out.width, i * canvas.height);
      ctx.stroke();
    }
  }
  out.style.width = `${px}px`;
  out.style.borderRadius = "6px";
  return out;
}
```

## 1. A canvas is an image

`canvas.getContext("2d")` returns a drawing context. Its coordinate
system has **(0, 0) at the top-left, x pointing right, and y pointing
down**, measured in pixels. When the canvas is uploaded to a WebGPU
texture, the top-left pixel becomes texture coordinate (0, 0) and the
bottom-right becomes (1, 1). That gives a direct correspondence:

| Canvas pixel | Texture coordinate |
|---|---|
| `(x, y)` on a `W × H` canvas | `(u, v) = (x / W, y / H)` |
| top-left corner | `(0, 0)` |
| bottom-right corner | `(1, 1)` |

Note that **v points down**, the opposite of a math-class graph. A UV
debug texture makes the orientation visible: red increases with u and
green increases with v. Put it on a mesh and you can read the mesh's
UVs straight off the screen. It is a good first texture for any new
model.

```js echo
const uvGrid = (() => {
  const size = 256;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext("2d");

  // Per-pixel color via ImageData (section 3.4 explains this API).
  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = 4 * (y * size + x);
      image.data[i] = (255 * x) / (size - 1); // red = u
      image.data[i + 1] = (255 * y) / (size - 1); // green = v
      image.data[i + 2] = 40;
      image.data[i + 3] = 255; // alpha: opaque
    }
  }
  ctx.putImageData(image, 0, 0);

  // Grid lines and corner labels on top.
  ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
  ctx.lineWidth = 1;
  for (let i = 1; i < 8; i++) {
    const p = (i * size) / 8 + 0.5; // +0.5 centers a 1px line on a pixel row
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }
  ctx.fillStyle = "white";
  ctx.font = "bold 16px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("(0, 0)", 6, 6);
  ctx.textAlign = "right";
  ctx.fillText("u →", size - 6, 6);
  ctx.textBaseline = "bottom";
  ctx.fillText("(1, 1)", size - 6, size - 6);
  ctx.textAlign = "left";
  ctx.fillText("v ↓", 6, size - 6);
  return canvas;
})();
display(show(uvGrid));
```

## 2. The drawing toolkit

A few calls cover almost everything a texture needs:

| Goal | Canvas 2D calls |
|---|---|
| Solid rectangles | `ctx.fillStyle = color; ctx.fillRect(x, y, w, h)` |
| Colors | any CSS color: `"#8b5a2b"`, `"rgb(200 120 40)"`, `"hsl(28 50% 35%)"`, `"rgba(0, 0, 0, 0.3)"` |
| Lines and shapes | `beginPath()`, `moveTo`, `lineTo`, `arc`, `closePath()`, then `fill()` and/or `stroke()` |
| Line style | `lineWidth`, `strokeStyle`, `lineCap`, `setLineDash` |
| Gradients | `createLinearGradient`, `createRadialGradient`, then `addColorStop(t, color)` and use as a `fillStyle` |
| Text | `font`, `textAlign`, `textBaseline`, `fillText(text, x, y)` |
| Transparency | `rgba(...)` colors or `globalAlpha` |
| Transforms | `save()`, `translate`, `rotate`, `scale`, `restore()` |
| Images | `drawImage(source, x, y, w, h)` (another canvas, an `<img>`, an `ImageBitmap`) |
| Individual pixels | `createImageData`, `getImageData`, `putImageData` |

Shapes are drawn in order, each painted over what is already there. A
small badge uses most of the table:

```js echo
const badge = (() => {
  const size = 256;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext("2d");

  // 1. A vertical linear gradient as the background.
  const background = ctx.createLinearGradient(0, 0, 0, size);
  background.addColorStop(0, "#1e3a5f");
  background.addColorStop(1, "#0b1622");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, size, size);

  // 2. A radial glow that fades to fully transparent at its edge.
  const glow = ctx.createRadialGradient(size / 2, size / 2, 10, size / 2, size / 2, size / 2);
  glow.addColorStop(0, "rgba(255, 220, 120, 0.8)");
  glow.addColorStop(1, "rgba(255, 220, 120, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  // 3. A path: a five-pointed star, alternating outer and inner points.
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? 80 : 34;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = size / 2 + radius * Math.cos(angle);
    const y = size / 2 - 10 + radius * Math.sin(angle);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = "#f6c344";
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#7a4b00";
  ctx.stroke();

  // 4. Transforms: slightly rotated text. save()/restore() undo the
  //    translate and rotate so later drawing isn't affected.
  ctx.save();
  ctx.translate(size / 2, size - 34);
  ctx.rotate(-0.06);
  ctx.font = "bold 30px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "white";
  ctx.fillText("CS 4280", 0, 0);
  ctx.restore();
  return canvas;
})();
display(show(badge));
```

Text is useful for **debug textures**, for example a number on every
face of a cube or every tile of a floor, so you can see which way
each one is mapped.

## 3. Recipes

Each recipe is a function `draw(ctx, size, params)` that paints a
`size × size` texture. Keeping the drawing separate from canvas creation
means the same function can paint a texture of any size, or a layer of a
texture array.

Every recipe below uses a **seeded** random number generator instead of
`Math.random()`. `Math.random()` gives a different texture on every page
load, and a different one on every slider change, which makes bugs hard
to reproduce. A seeded generator returns the same sequence for the same
seed.

```js echo
// mulberry32: a tiny, fast, seeded pseudo-random generator returning floats in [0, 1).
function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

### 3.1 Checkerboard

The simplest repeating pattern: `cells × cells` squares, alternating
colors. Try an **odd** number of cells and look at the 2 × 2 preview.
Same-colored squares meet across the tile border, because the pattern's
period (2 cells) no longer divides the texture.

```js echo
const checkerCells = view(Inputs.range([2, 16], {value: 8, step: 1, label: "cells per side"}));
const checkerColorA = view(Inputs.color({value: "#e2e8f0", label: "color A"}));
const checkerColorB = view(Inputs.color({value: "#475569", label: "color B"}));
```

```js echo
function drawChecker(ctx, size, {cells, colorA, colorB}) {
  const cell = size / cells;
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? colorA : colorB;
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
}

const checker = makeCanvas(256);
drawChecker(checker.getContext("2d"), 256, {cells: checkerCells, colorA: checkerColorA, colorB: checkerColorB});
display(raster.sideBySide([["texture", show(checker)], ["2 × 2 tiled", tiled(checker)]]));
```

### 3.2 Bricks

Bricks add two new ideas:

- **Offset rows.** Every other row is shifted by half a brick. The
  shifted row has a brick that crosses the right edge. To tile, its
  left half must appear on the left edge in the *same* color, so colors
  are chosen per brick index **modulo** the bricks per row. The
  half-brick at `c = -1` and the one at `c = perRow - 1` are the same
  brick.
- **Mortar** is the background color showing through. Each brick is
  inset by half the mortar width on every side, so mortar is the same
  width between bricks and across tile borders.

An odd number of rows breaks the vertical tiling for the same reason
the odd checkerboard does: the pattern repeats every 2 rows.

```js echo
const brickRows = view(Inputs.range([1, 16], {value: 8, step: 1, label: "rows"}));
const bricksPerRow = view(Inputs.range([1, 8], {value: 4, step: 1, label: "bricks per row"}));
const brickMortar = view(Inputs.range([0, 12], {value: 4, step: 1, label: "mortar (px)"}));
const brickSeed = view(Inputs.range([1, 100], {value: 7, step: 1, label: "seed"}));
```

```js echo
function drawBricks(ctx, size, {rows, perRow, mortar, seed}) {
  const random = seededRandom(seed);
  const h = size / rows;
  const w = size / perRow;
  ctx.fillStyle = "#c9c3b5"; // the mortar
  ctx.fillRect(0, 0, size, size);

  for (let r = 0; r < rows; r++) {
    // One color per brick in this row, chosen up front so a brick split across the edge matches.
    const colors = Array.from(
      {length: perRow},
      () => `hsl(${8 + random() * 10} ${45 + random() * 15}% ${30 + random() * 12}%)`,
    );
    const offset = r % 2 === 1 ? w / 2 : 0;
    for (let c = offset > 0 ? -1 : 0; c < perRow; c++) {
      ctx.fillStyle = colors[(c + perRow) % perRow];
      ctx.fillRect(c * w + offset + mortar / 2, r * h + mortar / 2, w - mortar, h - mortar);
    }
  }
}

const bricks = makeCanvas(256);
drawBricks(bricks.getContext("2d"), 256, {rows: brickRows, perRow: bricksPerRow, mortar: brickMortar, seed: brickSeed});
display(raster.sideBySide([["texture", show(bricks)], ["2 × 2 tiled", tiled(bricks)]]));
```

### 3.3 Wood grain

Wood combines horizontal bands of slightly different browns with darker
wavy grain lines. Each grain line is a sine wave. For the texture to
tile horizontally, a line must end at the same height it started, which
means a **whole number of waves** across the texture. Set "waves" to a
fractional value like 1.5 and look at the vertical tile border in the
preview.

A line near the top or bottom edge can also stick out of the texture.
It is drawn three times (shifted up by `size`, unshifted, and shifted
down by `size`) so whatever leaves one edge comes back in at the other.
Section 4 explains why this works.

```js echo
const woodLines = view(Inputs.range([0, 30], {value: 14, step: 1, label: "grain lines"}));
const woodWaves = view(Inputs.range([0, 4], {value: 2, step: 0.5, label: "waves across"}));
const woodSeed = view(Inputs.range([1, 100], {value: 1, step: 1, label: "seed"}));
```

```js echo
function drawWood(ctx, size, {lines, waves, seed}) {
  const random = seededRandom(seed);
  // Base: 2-pixel bands with randomly varying lightness.
  for (let y = 0; y < size; y += 2) {
    ctx.fillStyle = `hsl(28 50% ${30 + random() * 12}%)`;
    ctx.fillRect(0, y, size, 2);
  }
  // Grain: sine-wave lines.
  ctx.strokeStyle = "rgba(60, 30, 10, 0.45)";
  for (let i = 0; i < lines; i++) {
    const baseY = random() * size;
    const amplitude = 3 + random() * 8;
    const phase = random() * Math.PI * 2;
    ctx.lineWidth = 1 + random() * 2;
    for (const dy of [-size, 0, size]) {
      ctx.beginPath();
      for (let x = 0; x <= size; x += 4) {
        const y = baseY + dy + amplitude * Math.sin((x / size) * Math.PI * 2 * waves + phase);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
}

const wood = makeCanvas(256);
drawWood(wood.getContext("2d"), 256, {lines: woodLines, waves: woodWaves, seed: woodSeed});
display(raster.sideBySide([["texture", show(wood)], ["2 × 2 tiled", tiled(wood)]]));
```

### 3.4 Pixel-level noise with `ImageData`

Some textures, such as noise, clouds, marble, and height maps, are
easier to compute one pixel at a time than to draw with shapes. For
those, skip the drawing calls and write pixels directly:

1. `ctx.createImageData(w, h)` gives an `ImageData` whose `data` is a
   flat `Uint8ClampedArray` of `w × h × 4` bytes: R, G, B, A for each
   pixel, row by row from the top. Pixel `(x, y)` starts at index
   `4 * (y * w + x)`.
2. Fill in the bytes. Values are 0–255, and writes are clamped to that
   range automatically.
3. `ctx.putImageData(image, 0, 0)` copies the bytes into the canvas.
   This **replaces** pixels (no blending), and it ignores `fillStyle`,
   transforms, and transparency settings.

The noise below is **value noise**. It places random values on a coarse
`cells × cells` lattice and smoothly interpolates between them. Several
**octaves**, each with twice as many cells and half the amplitude, are
summed for detail at every scale. One detail makes it tile: the lattice
index **wraps** with `% c`, so the cell after the last one is the first
one again.

```js echo
const noiseCells = view(Inputs.range([1, 16], {value: 4, step: 1, label: "base cells"}));
const noiseOctaves = view(Inputs.range([1, 6], {value: 4, step: 1, label: "octaves"}));
const noiseSeed = view(Inputs.range([1, 100], {value: 3, step: 1, label: "seed"}));
const noiseLow = view(Inputs.color({value: "#1d3b6e", label: "low color"}));
const noiseHigh = view(Inputs.color({value: "#e8eef7", label: "high color"}));
```

```js echo
// Tileable fractal value noise: a size*size Float32Array of values in [0, 1].
function valueNoise(size, {cells, octaves, seed}) {
  const random = seededRandom(seed);
  const out = new Float32Array(size * size);
  let amplitude = 1;
  let total = 0;
  for (let octave = 0; octave < octaves; octave++) {
    const c = cells * 2 ** octave;
    const lattice = Float32Array.from({length: c * c}, random);
    const at = (i, j) => lattice[(j % c) * c + (i % c)]; // % c: the lattice wraps, so the noise tiles
    for (let y = 0; y < size; y++) {
      const gy = (y / size) * c;
      const j = Math.floor(gy);
      const fy = gy - j;
      const sy = fy * fy * (3 - 2 * fy); // smoothstep: no visible lattice creases
      for (let x = 0; x < size; x++) {
        const gx = (x / size) * c;
        const i = Math.floor(gx);
        const fx = gx - i;
        const sx = fx * fx * (3 - 2 * fx);
        const top = at(i, j) + (at(i + 1, j) - at(i, j)) * sx;
        const bottom = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * sx;
        out[y * size + x] += amplitude * (top + (bottom - top) * sy);
      }
    }
    total += amplitude;
    amplitude /= 2;
  }
  for (let k = 0; k < out.length; k++) out[k] /= total;
  return out;
}

function hexToRgb(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function drawNoise(ctx, size, {cells, octaves, seed, low, high}) {
  const values = valueNoise(size, {cells, octaves, seed});
  const a = hexToRgb(low);
  const b = hexToRgb(high);
  const image = ctx.createImageData(size, size);
  for (let k = 0; k < values.length; k++) {
    const t = values[k];
    image.data[4 * k] = a[0] + (b[0] - a[0]) * t;
    image.data[4 * k + 1] = a[1] + (b[1] - a[1]) * t;
    image.data[4 * k + 2] = a[2] + (b[2] - a[2]) * t;
    image.data[4 * k + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}

const noise = makeCanvas(256);
drawNoise(noise.getContext("2d"), 256, {cells: noiseCells, octaves: noiseOctaves, seed: noiseSeed, low: noiseLow, high: noiseHigh});
display(raster.sideBySide([["texture", show(noise)], ["2 × 2 tiled", tiled(noise)]]));
```

The same noise values can feed anything. Use them as a gray **height
map**, as **roughness**, or remap them through a sine for marble
veins. Module 08's procedural-texture section goes further, to 3D solid
noise.

## 4. Making textures tile

When a sampler uses `addressMode: "repeat"`, texture coordinate 1.0
wraps back to 0.0, so the right edge of the texture sits directly
against its left edge, and the bottom against the top. Any
discontinuity across those edges shows up as a visible seam, repeated
across the whole surface. Floors, walls, and tabletops all depend on
textures that tile.

The spots below are placed at random. Spots near an edge get cut off,
and the cut-off part does not reappear on the opposite edge. Turn on
"draw wrapped copies": each spot is also drawn shifted by `±size` in x
and y (9 copies). The copies are almost entirely off-canvas, but
whatever part of a spot crosses an edge comes back in at the opposite
edge, exactly as wrapping would bring it back.

```js echo
const spotsWrap = view(Inputs.toggle({label: "draw wrapped copies", value: false}));
```

```js echo
function drawSpots(ctx, size, {wrap, seed = 11, count = 28}) {
  const random = seededRandom(seed);
  ctx.fillStyle = "#2f4f3a";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < count; i++) {
    const x = random() * size;
    const y = random() * size;
    const radius = 8 + random() * 26;
    ctx.fillStyle = `hsl(${80 + random() * 60} 45% ${45 + random() * 20}%)`;
    const shifts = wrap ? [-size, 0, size] : [0];
    for (const dx of shifts) {
      for (const dy of shifts) {
        ctx.beginPath();
        ctx.arc(x + dx, y + dy, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

const spots = makeCanvas(256);
drawSpots(spots.getContext("2d"), 256, {wrap: spotsWrap});
display(raster.sideBySide([["texture", show(spots)], ["2 × 2 tiled", tiled(spots)]]));
```

The rules for seamless textures, all seen above:

- **Repeat a whole number of times.** Checker cells, brick rows, and
  sine waves must divide the texture size exactly. A pattern with
  period `p` tiles only if `size / p` is an integer.
- **Wrap anything that crosses an edge.** Draw it again shifted by
  `±size`, as the spots and wood grain do. In pixel code, wrap indices
  with `%`, as the noise lattice does.
- **Split borders across edges.** Mortar, grout, and frame lines go
  half on each side of the tile border (`mortar / 2` in the brick
  recipe), so the border is the same width when two tiles meet.
- **Always check the 2 × 2 preview.** A seam is almost invisible in a
  single tile and obvious in a repeated one.

## 5. Size, mipmaps, and thin lines

**Use power-of-two sizes** such as 128, 256, 512, or 1024. WebGPU allows
any size, but each mip level halves the previous one. With a power of
two, every level halves exactly down to 1 × 1, and features drawn on a
regular grid (cells, bricks) stay aligned at every level. All layers of
a **texture array** must also share one size, so pick one size per
material set.

A texture seen from far away is sampled from a smaller **mip level**
(Module 08 explains why). WebGPU has no built-in mipmap generator. The
shared `webgpu.generateMipCanvases(canvas)` helper builds the chain on
the CPU by drawing each level at half the size of the previous one,
letting the browser's image smoothing do the averaging. Here is the
brick texture's chain, each level enlarged to the same display size:

```js echo
const brickMips = webgpu.generateMipCanvases(bricks);
display(
  raster.sideBySide(
    brickMips.slice(0, 7).map((level, i) => [`level ${i}: ${level.width}×${level.height}`, show(level, 112)]),
  ),
);
```

By level 4 (16 × 16), the 4-pixel mortar lines are less than half a
pixel wide and have blended into the brick color. That is correct
filtering, not a bug: a feature narrower than a pixel can't survive
averaging. Practical consequences:

- **Draw lines at least 2–4 pixels wide** at level 0 if they need to
  stay visible from a distance. A 1-pixel line already blurs at
  level 1.
- **Give the overall texture an average color that looks right.** From
  far away the surface shows only that average. Mostly-mortar bricks
  read as gray, not red.
- **Make the base texture big enough for close-ups** (512 or 1024 for
  a floor the camera gets close to). Mipmaps handle the distant case.

## 6. Uploading to WebGPU

`device.queue.copyExternalImageToTexture` copies a canvas, an
`ImageBitmap`, an `<img>`, or a video frame into a texture. The
destination texture needs three usage flags:

- `TEXTURE_BINDING`, so shaders can sample it.
- `COPY_DST`, so it can be copied into.
- `RENDER_ATTACHMENT`. This one is easy to forget. The browser may
  implement the copy as a GPU render pass, so the texture must allow
  that even though your own code never renders into it.

Choose the format by what the texture holds:

- **Colors** (albedo, wood, bricks): `rgba8unorm-srgb` if your shaders
  light in linear space. The GPU converts the canvas's sRGB-encoded
  bytes to linear values when sampling (see Module 08).
- **Data** (heights, roughness, normal maps): `rgba8unorm`, so the
  bytes are used exactly as stored.
- **Course assignments:** these use `rgba8unorm` for everything and
  treat colors as already displayable, which keeps the shaders simpler.

```js echo
const {device} = await webgpu.requestDevice();
const canvasFormat = navigator.gpu.getPreferredCanvasFormat();

const deviceErrorLog = document.createElement("pre");
deviceErrorLog.style.cssText = "display: none; color: #e5484d; background: #2a1214; border: 1px solid #e5484d; border-radius: 6px; padding: 8px 12px; font-size: 12px; white-space: pre-wrap;";
device.addEventListener("uncapturederror", (event) => {
  deviceErrorLog.textContent += `WebGPU error: ${event.error.message}\n`;
  deviceErrorLog.style.display = "block";
});
display(deviceErrorLog);
```

### One canvas → one texture

```js echo
function textureFromCanvas(canvas, {mipmaps = true, format = "rgba8unorm"} = {}) {
  const levels = mipmaps ? webgpu.generateMipCanvases(canvas) : [canvas];
  const texture = device.createTexture({
    size: [canvas.width, canvas.height],
    format,
    mipLevelCount: levels.length,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  levels.forEach((level, mipLevel) => {
    device.queue.copyExternalImageToTexture({source: level}, {texture, mipLevel}, [level.width, level.height]);
  });
  return texture;
}
```

The copy is a **snapshot**. Drawing on the canvas afterwards does not
change the texture. To update a texture, for example after a slider
changes, redraw the canvas and copy again.

### Many canvases → one texture array

A `texture_2d_array` holds several same-sized images as **layers**. One
bind group then covers every material, and the shader picks a layer per
draw, per instance, or per fragment. The only change from a single
texture is the size's third component (the layer count) and the copy's
`origin.z` (the layer to copy into):

```js echo
function textureArrayFromCanvases(canvases, {format = "rgba8unorm"} = {}) {
  const {width, height} = canvases[0];
  if (canvases.some((c) => c.width !== width || c.height !== height)) {
    throw new Error("Every layer of a texture array must be the same size.");
  }
  const mipLevelCount = webgpu.generateMipCanvases(canvases[0]).length;
  const texture = device.createTexture({
    size: [width, height, canvases.length],
    format,
    mipLevelCount,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  canvases.forEach((canvas, layer) => {
    webgpu.generateMipCanvases(canvas).forEach((level, mipLevel) => {
      device.queue.copyExternalImageToTexture(
        {source: level},
        {texture, mipLevel, origin: [0, 0, layer]},
        [level.width, level.height],
      );
    });
  });
  return texture;
}
```

### Seeing it on the GPU

All six textures from this page go into one texture array, and a small
shader draws the chosen layer on a square, repeated `repeat × repeat`
times with a `"repeat"` sampler. Change any slider above and this
re-uploads. Raise "repeat" to 32 or more with mipmaps off to see the
shimmer and moiré that mipmaps remove.

```js echo
const gpuLayer = view(
  Inputs.select(new Map([["UV grid", 0], ["Badge", 1], ["Checker", 2], ["Bricks", 3], ["Wood", 4], ["Noise", 5], ["Spots", 6]]), {
    value: 3,
    label: "layer",
  }),
);
const gpuRepeat = view(Inputs.range([1, 64], {value: 3, step: 1, label: "repeat"}));
const gpuMipmaps = view(Inputs.toggle({label: "mipmaps", value: true}));
```

```js echo
const materialArray = textureArrayFromCanvases([uvGrid, badge, checker, bricks, wood, noise, spots]);
invalidation.then(() => materialArray.destroy()); // free the old array when a slider rebuilds it

const previewModule = device.createShaderModule({
  code: `
struct Params { repeat: f32, layer: f32 };
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var materials: texture_2d_array<f32>;
@group(0) @binding(2) var materialSampler: sampler;

struct VertexOut { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> };

@vertex
fn vs_main(@builtin(vertex_index) i: u32) -> VertexOut {
  // Two triangles covering the whole canvas; no vertex buffer needed.
  var corners = array<vec2<f32>, 6>(
    vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(1.0, 1.0),
    vec2(-1.0, -1.0), vec2(1.0, 1.0), vec2(-1.0, 1.0));
  let p = corners[i];
  var out: VertexOut;
  out.position = vec4(p, 0.0, 1.0);
  out.uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5); // clip-space y is up; v is down
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  return textureSample(materials, materialSampler, in.uv * params.repeat, u32(params.layer));
}`,
});

const previewPipeline = device.createRenderPipeline({
  layout: "auto",
  vertex: {module: previewModule, entryPoint: "vs_main"},
  fragment: {module: previewModule, entryPoint: "fs_main", targets: [{format: canvasFormat}]},
  primitive: {topology: "triangle-list"},
});
const previewParams = device.createBuffer({size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
const previewCanvas = makeCanvas(384);
previewCanvas.style.borderRadius = "8px";
const {context: previewContext} = webgpu.configureCanvas(previewCanvas, device);
```

```js echo
{
  const sampler = device.createSampler({
    addressModeU: "repeat",
    addressModeV: "repeat",
    magFilter: "linear",
    minFilter: "linear",
    mipmapFilter: "linear",
    lodMaxClamp: gpuMipmaps ? 32 : 0, // 0 = always level 0, i.e. mipmaps off
  });
  const bindGroup = device.createBindGroup({
    layout: previewPipeline.getBindGroupLayout(0),
    entries: [
      {binding: 0, resource: {buffer: previewParams}},
      {binding: 1, resource: materialArray.createView({dimension: "2d-array"})},
      {binding: 2, resource: sampler},
    ],
  });
  device.queue.writeBuffer(previewParams, 0, new Float32Array([gpuRepeat, gpuLayer, 0, 0]));

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [{view: previewContext.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: {r: 0, g: 0, b: 0, a: 1}}],
  });
  pass.setPipeline(previewPipeline);
  pass.setBindGroup(0, bindGroup);
  pass.draw(6);
  pass.end();
  device.queue.submit([encoder.finish()]);
  display(previewCanvas);
}
```

## 7. Real images use the same pipeline

A photo or a downloaded texture goes through the same steps. Draw it
onto a canvas first, then upload the canvas exactly as above. Drawing
onto a canvas of your chosen size also **resizes** the image to that
size, which is what a texture array needs. You can also draw on top of
it before uploading: a label, a decal, a debug grid.

```js run=false
async function canvasFromImage(url, size) {
  const response = await fetch(url);
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = makeCanvas(size);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, size, size); // resize to size x size
  return canvas;
}

const brickPhoto = await canvasFromImage(new URL("./textures/bricks.jpg", import.meta.url).href, 512);
const texture = textureFromCanvas(brickPhoto);
```

Keep the procedural recipe as a **fallback**: if the image fails to load,
`catch` the error and draw the placeholder instead, so the scene still
renders. Images from another domain must be served with CORS headers,
or the canvas becomes "tainted" and the browser refuses to upload it.
Files served by your own dev server don't have this problem. For
textures you can redistribute freely, CC0 libraries such as ambientCG
and Poly Haven provide tileable wood, metal, tile, and plaster.

## Common pitfalls

- **Forgetting `RENDER_ATTACHMENT`** on the destination texture. The
  copy fails with a validation error.
- **Fractional repeats.** A pattern whose period doesn't divide the
  texture size leaves a seam on every tile.
- **Shapes cut off at the edge** instead of wrapped around to the other
  side.
- **`Math.random()`** gives a new texture on every load. Use a seeded
  generator.
- **Editing the canvas after upload** and expecting the texture to
  change. The copy is a snapshot, so re-upload.
- **1-pixel details** that disappear in the first mip levels.
- **Mixed sizes in a texture array.** Every layer must match.
- **Appending the same canvas to the page twice.** The second append
  moves it. Display a copy, as `show()` does.
- **The default font.** Canvas text defaults to `10px sans-serif`. Set
  `ctx.font` before `fillText`.

## Check your understanding

1. Canvas pixel (64, 192) on a 256 × 256 canvas becomes which texture
   coordinate (u, v)? Which corner of the texture is it closest to?
2. A stripe texture has 5 stripes, each 50 pixels tall, on a 256-pixel
   canvas. Will it tile vertically? What is the smallest change that
   fixes it?
3. Why do the bricks pick colors with `colors[(c + perRow) % perRow]`
   instead of calling `random()` for every brick they draw?
4. The noise wraps its lattice with `% c`. What would the 2 × 2 preview
   show without the `%`?
5. A floor uses a 256 × 256 tile texture with 1-pixel grout lines. Up
   close the grout is crisp, but a few meters away the floor looks like
   a flat color with no grout. Explain why, and give two fixes.
6. Why does `copyExternalImageToTexture` need `RENDER_ATTACHMENT` usage
   even though your code never renders into the texture?
