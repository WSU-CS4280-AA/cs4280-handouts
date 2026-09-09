// A minimal 3D wireframe renderer for Week 3: projects points through a
// supplied MVP matrix (mat4.js), perspective-divides, and draws edges on
// a plain <canvas>. No WebGPU, no hidden-surface removal, no shading —
// just the geometry pipeline itself, made visible.

import * as mat4 from "./mat4.js";

export const cubeVertices = [
  {x: -1, y: -1, z: -1}, {x: 1, y: -1, z: -1}, {x: 1, y: 1, z: -1}, {x: -1, y: 1, z: -1},
  {x: -1, y: -1, z: 1}, {x: 1, y: -1, z: 1}, {x: 1, y: 1, z: 1}, {x: -1, y: 1, z: 1}
];

export const cubeEdges = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7]
];

// Projects a single object-space point through `mvp` to screen pixels,
// via clip space and the perspective divide — returns null if the point
// is behind the eye (w <= 0), where projection is undefined.
export function project(mvp, p, width, height) {
  // mat4.transformPoint/perspectiveDivide take and return plain arrays
  // ([x, y, z] in, [x, y, z, w] out; see mat4.js), not {x, y, z} objects
  // — so the point goes in as an array and the results are read by index.
  const clip = mat4.transformPoint(mvp, [p.x, p.y, p.z]);
  if (clip[3] <= 0) return null;
  const ndc = mat4.perspectiveDivide(clip);
  return {
    x: (ndc[0] * 0.5 + 0.5) * width,
    y: (1 - (ndc[1] * 0.5 + 0.5)) * height,
    z: ndc[2]
  };
}

export function renderWireframe(mvp, {
  width = 380,
  height = 380,
  vertices = cubeVertices,
  edges = cubeEdges,
  color = "#3d6fc4",
  showAxes = true
} = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.style.borderRadius = "8px";
  canvas.style.maxWidth = "100%";
  canvas.style.background = "var(--theme-background-alt, #f5f5f5)";
  const ctx = canvas.getContext("2d");

  if (showAxes) {
    const origin = project(mvp, {x: 0, y: 0, z: 0}, width, height);
    const axes = [
      [{x: 1.4, y: 0, z: 0}, "#c0392b"], // x: red
      [{x: 0, y: 1.4, z: 0}, "#27ae60"], // y: green
      [{x: 0, y: 0, z: 1.4}, "#2f6fb0"] // z: blue
    ];
    if (origin) {
      for (const [tip, axisColor] of axes) {
        const p = project(mvp, tip, width, height);
        if (!p) continue;
        ctx.strokeStyle = axisColor;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(origin.x, origin.y);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
    }
  }

  const projected = vertices.map((v) => project(mvp, v, width, height));
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  for (const [a, b] of edges) {
    const pa = projected[a], pb = projected[b];
    if (!pa || !pb) continue;
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  }
  ctx.fillStyle = color;
  for (const p of projected) {
    if (!p) continue;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  return canvas;
}
