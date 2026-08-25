// A minimal raster-image toolkit for Week 2: procedural test image
// generation, pixel-level access, point operations, convolution, gamma
// encode/decode, and a histogram — everything built directly on the
// Canvas 2D API's `ImageData`, which is itself the interleaved RGBA byte
// layout described in lecture (R,G,B,A per pixel, row-major).

export function clamp255(v) {
  return Math.max(0, Math.min(255, v));
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

// A small procedural "photo" — a gradient sky, a sun, a hill, and a tree —
// so every operation below has real gradients, flat regions, and edges to
// act on, with no external image asset to load.
export function createTestImage(width = 160, height = 120) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  const sky = ctx.createLinearGradient(0, 0, 0, height * 0.62);
  sky.addColorStop(0, "#3d6fc4");
  sky.addColorStop(1, "#bfe0f5");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height * 0.62);

  ctx.fillStyle = "#4a9c3f";
  ctx.fillRect(0, height * 0.6, width, height * 0.4);

  ctx.fillStyle = "#ffd34d";
  ctx.beginPath();
  ctx.arc(width * 0.78, height * 0.22, height * 0.13, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#2f6e2a";
  ctx.beginPath();
  ctx.arc(width * 0.22, height * 0.52, height * 0.16, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#5c3d2e";
  ctx.fillRect(width * 0.205, height * 0.58, width * 0.03, height * 0.3);

  return canvas;
}

export function toImageData(canvas) {
  return canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
}

// Draws a loaded <img> (e.g. from `FileAttachment(...).image()`) onto an
// offscreen canvas at the given size and reads back its ImageData —
// how a real photo or sprite enters this same pixel-level toolkit.
export function imageToImageData(img, {width, height} = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = width ?? img.naturalWidth;
  canvas.height = height ?? img.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return toImageData(canvas);
}

// Composites `src` over `dst` (must be the same width/height) using each
// source pixel's own alpha, scaled by `alphaMultiplier` — the source-over
// formula applied per pixel across a whole image rather than one swatch.
export function compositeImageData(src, dst, alphaMultiplier = 1) {
  const out = cloneImageData(dst);
  const od = out.data, sd = src.data, dd = dst.data;
  for (let p = 0; p < od.length; p += 4) {
    const srcAlpha = (sd[p + 3] / 255) * alphaMultiplier;
    od[p] = clamp255(sd[p] * srcAlpha + dd[p] * (1 - srcAlpha));
    od[p + 1] = clamp255(sd[p + 1] * srcAlpha + dd[p + 1] * (1 - srcAlpha));
    od[p + 2] = clamp255(sd[p + 2] * srcAlpha + dd[p + 2] * (1 - srcAlpha));
    od[p + 3] = 255;
  }
  return out;
}

export function cloneImageData(imageData) {
  return new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
}

// Renders an ImageData to a fresh, nearest-neighbor-scaled <canvas> — the
// scaling keeps pixels visibly blocky when a diagram wants to show
// individual samples rather than a smooth photo.
export function renderImageData(imageData, {scale = 1} = {}) {
  const source = document.createElement("canvas");
  source.width = imageData.width;
  source.height = imageData.height;
  source.getContext("2d").putImageData(imageData, 0, 0);

  if (scale === 1) return source;

  const out = document.createElement("canvas");
  out.width = imageData.width * scale;
  out.height = imageData.height * scale;
  const ctx = out.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, 0, 0, out.width, out.height);
  return out;
}

// The row-major byte offset of pixel (x, y) in a width-W RGBA image —
// exactly the formula from lecture: (y * W + x) * bytesPerPixel.
export function pixelIndex(x, y, width) {
  return (y * width + x) * 4;
}

export function getPixel(imageData, x, y) {
  const i = pixelIndex(x, y, imageData.width);
  const d = imageData.data;
  return {r: d[i], g: d[i + 1], b: d[i + 2], a: d[i + 3]};
}

// A hover/click-to-inspect view of an image: a nearest-neighbor-scaled
// canvas with a highlight box around whichever source pixel the pointer
// is over. Returns a DOM node with `.value = {x, y}` (in source-pixel
// coordinates) that dispatches "input" events — the shape `view()` wants.
export function pixelInspector(imageData, {scale = 6} = {}) {
  const {width, height} = imageData;
  const source = document.createElement("canvas");
  source.width = width;
  source.height = height;
  source.getContext("2d").putImageData(imageData, 0, 0);

  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  canvas.style.cursor = "crosshair";
  canvas.style.borderRadius = "6px";
  canvas.style.maxWidth = "100%";
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  canvas.value = {x: Math.floor(width / 2), y: Math.floor(height / 2)};

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    const {x, y} = canvas.value;
    ctx.strokeStyle = "white";
    ctx.lineWidth = 2;
    ctx.strokeRect(x * scale + 1, y * scale + 1, scale - 2, scale - 2);
    ctx.strokeStyle = "black";
    ctx.lineWidth = 1;
    ctx.strokeRect(x * scale, y * scale, scale, scale);
  }

  function updateFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    const x = Math.min(width - 1, Math.max(0, Math.floor(((event.clientX - rect.left) / rect.width) * width)));
    const y = Math.min(height - 1, Math.max(0, Math.floor(((event.clientY - rect.top) / rect.height) * height)));
    if (x === canvas.value.x && y === canvas.value.y) return;
    canvas.value = {x, y};
    draw();
    canvas.dispatchEvent(new Event("input"));
  }

  canvas.addEventListener("mousemove", updateFromEvent);
  canvas.addEventListener("click", updateFromEvent);
  draw();
  return canvas;
}

// Applies a per-pixel function (r, g, b, a) -> [r, g, b, a] to every pixel
// — a point operation: each output depends only on its own input pixel.
export function mapPixels(imageData, fn) {
  const out = cloneImageData(imageData);
  const d = out.data;
  for (let p = 0; p < d.length; p += 4) {
    const [r, g, b, a] = fn(d[p], d[p + 1], d[p + 2], d[p + 3]);
    d[p] = clamp255(r);
    d[p + 1] = clamp255(g);
    d[p + 2] = clamp255(b);
    d[p + 3] = clamp255(a);
  }
  return out;
}

// Applies a square (odd-sized) kernel via convolution — a neighborhood
// operation: each output pixel is a weighted sum of the input pixel and
// its neighbors. Edge pixels clamp to the nearest valid coordinate rather
// than sampling out of bounds.
export function convolve(imageData, kernel, {normalize = true} = {}) {
  const {width, height, data} = imageData;
  const out = cloneImageData(imageData);
  const od = out.data;
  const kSize = Math.round(Math.sqrt(kernel.length));
  const kHalf = Math.floor(kSize / 2);
  const kSum = kernel.reduce((a, b) => a + b, 0);
  const norm = normalize && kSum !== 0 ? kSum : 1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0;
      for (let ky = 0; ky < kSize; ky++) {
        for (let kx = 0; kx < kSize; kx++) {
          const sx = Math.min(width - 1, Math.max(0, x + kx - kHalf));
          const sy = Math.min(height - 1, Math.max(0, y + ky - kHalf));
          const si = pixelIndex(sx, sy, width);
          const kv = kernel[ky * kSize + kx];
          r += data[si] * kv;
          g += data[si + 1] * kv;
          b += data[si + 2] * kv;
        }
      }
      const di = pixelIndex(x, y, width);
      od[di] = clamp255(r / norm);
      od[di + 1] = clamp255(g / norm);
      od[di + 2] = clamp255(b / norm);
    }
  }
  return out;
}

// Gamma encode (linear -> display signal) and decode (display -> linear),
// operating on 0..1 values: C_out = C_in^(1/gamma) and C_in = C_out^gamma.
export function gammaEncode(linear, gamma = 2.2) {
  return Math.pow(clamp01(linear), 1 / gamma);
}

export function gammaDecode(encoded, gamma = 2.2) {
  return Math.pow(clamp01(encoded), gamma);
}

// Per-channel histogram: bins[v] = how many pixels have that channel's
// value exactly v. channel: 0=R, 1=G, 2=B, 3=A.
export function histogram(imageData, channel = 0) {
  const bins = new Array(256).fill(0);
  const d = imageData.data;
  for (let p = channel; p < d.length; p += 4) bins[d[p]]++;
  return bins;
}

// Straight-alpha source-over compositing: a linear interpolation between
// destination and source, weighted by the source's own opacity.
export function compositeOver(src, srcAlpha, dst) {
  return {
    r: src.r * srcAlpha + dst.r * (1 - srcAlpha),
    g: src.g * srcAlpha + dst.g * (1 - srcAlpha),
    b: src.b * srcAlpha + dst.b * (1 - srcAlpha)
  };
}

// Lays out labeled DOM nodes (canvases, swatches, ...) in a row, wrapping
// on narrow screens — the shared "before/after" comparison layout.
export function sideBySide(entries) {
  const row = document.createElement("div");
  row.style.display = "flex";
  row.style.gap = "20px";
  row.style.flexWrap = "wrap";
  row.style.alignItems = "flex-start";
  for (const [label, node] of entries) {
    const cell = document.createElement("div");
    const caption = document.createElement("div");
    caption.textContent = label;
    caption.style.font = "12px var(--sans-serif)";
    caption.style.opacity = "0.65";
    caption.style.marginBottom = "4px";
    cell.appendChild(caption);
    cell.appendChild(node);
    row.appendChild(cell);
  }
  return row;
}
