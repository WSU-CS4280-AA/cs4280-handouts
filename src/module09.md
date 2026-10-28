---
title: Module 09 — Curves
toc: true
---

```js echo
import * as d3 from "npm:d3";
import * as vec2 from "./components/vec2.js";
import * as mat2 from "./components/mat2.js";
import * as webgpu from "./components/webgpu.js";
import * as obj from "./components/obj.js";
import {plane, drawPoint, drawArrow, drawPolygon, dragPoints} from "./components/vectorField.js";
import * as Inputs from "npm:@observablehq/inputs";
import {html} from "npm:htl";
```

# Module 09 · Curves

A **free-form curve** can take almost any shape, so we need a compact way
to specify it. This module starts from the simplest parametric curve, the
**line segment** (a lerp), and builds everything else from it: Bézier
curves as repeated lerps, polynomial pieces with basis matrices, splines
(natural, Hermite, cardinal, B-splines), and finally drawing and
animating curves on the GPU and loading a model to move along them. Every
formula becomes a function you can call, and most figures have control
points you can drag. The WebGPU section needs **Chrome or Edge 113+**.
This handout teaches the *techniques*; it is not a walkthrough of any
graded assignment.

A small helper draws a polyline in any `plane` scene:

```js echo
function drawPath(scene, points, {stroke = "steelblue", width = 2, dash = null, opacity = 1, clip = Infinity} = {}) {
  const line = d3.line().x((p) => scene.x(p.x)).y((p) => scene.y(p.y))
    .defined((p) => Math.abs(p.x) < clip && Math.abs(p.y) < clip);      // skip points outside the view
  const path = scene.svg.append("path").attr("d", line(points)).attr("fill", "none")
    .attr("stroke", stroke).attr("stroke-width", width).attr("opacity", opacity);
  if (dash) path.attr("stroke-dasharray", dash);
  return path;
}
const sampleCurve = (f, n = 100, a = 0, b = 1) => d3.range(n + 1).map((i) => f(a + (b - a) * i / n));
```

## Representing Curves

### Explicit, implicit, and parametric

An **explicit** curve gives ${tex`y = g(x)`}. It is easy to draw, but it
allows only one ${tex`y`} per ${tex`x`}: a circle needs two functions, and
a vertical line cannot be written at all. The unit circle is
${tex`f(x,y) = x^2 + y^2 - 1 = 0`} as an **implicit** curve (a **test**:
the sign of ${tex`f`} says inside or outside) and ${tex`(\cos t, \sin t)`}
as a **parametric** curve (a **generator**: stepping ${tex`t`} produces
the points in order). Graphics mostly draws parametric curves.

### Velocity and tangent

The derivative of a parametric curve is taken one coordinate at a time,
${tex`\mathbf f'(t) = (x'(t), y'(t))`}. It is the pen's **velocity**: its
direction is the **tangent**, and its length is the **speed**. The figure
eight below is ${tex`\mathbf f(t) = (2.6\cos t,\ 1.6\sin 2t)`}:

```js echo
const velT = view(Inputs.range([0, 2 * Math.PI], {value: 0.8, step: 0.01, label: "t"}));
```

```js echo
(() => {
  const f = (t) => ({x: 2.6 * Math.cos(t), y: 1.6 * Math.sin(2 * t)});
  const df = (t) => ({x: -2.6 * Math.sin(t), y: 3.2 * Math.cos(2 * t)});   // f'(t), one coordinate at a time
  const scene = plane({domain: 3.6});
  drawPath(scene, sampleCurve(f, 200, 0, 2 * Math.PI), {stroke: "#bbb", width: 3});
  const p = f(velT), v = df(velT);
  drawArrow(scene, p, vec2.add(p, vec2.scale(v, 0.35)), {color: "orangered", label: "f′(t)"});
  drawPoint(scene, p, {color: "steelblue", r: 6, label: "f(t)"});
  return html`${scene.svg.node()}<p style="font:12px var(--sans-serif)">speed ‖f′(t)‖ = ${vec2.length(v).toFixed(2)} (the arrow is drawn at 0.35 × its length)</p>`;
})()
```

The arrow always lies along the curve, but its length changes: the pen
slows down near the left and right ends and speeds up through the
crossing.

### Linear interpolation (lerp)

The simplest parametric curve is the segment from ${tex`\mathbf p_0`} to
${tex`\mathbf p_1`}:
${tex`\mathbf f(u) = (1-u)\,\mathbf p_0 + u\,\mathbf p_1`}. Every curve
in this module is built from this one function:

```js echo
const lerp = (a, b, u) => ({x: (1 - u) * a.x + u * b.x, y: (1 - u) * a.y + u * b.y});
```

```js echo
const lerpWidget = dragPoints({"p₀": {x: -2.5, y: -1}, "p₁": {x: 2, y: 1.5}}, {domain: 3.6});
const lerpPts = view(lerpWidget);
const lerpU = view(Inputs.range([-0.5, 1.5], {value: 0.3, step: 0.01, label: "u"}));
```

```js echo
lerpWidget.redecorate((scene) => {
  const {"p₀": p0, "p₁": p1} = lerpPts;
  drawPath(scene, [lerp(p0, p1, -0.5), lerp(p0, p1, 1.5)], {stroke: "gray", width: 1, dash: "4,3"});
  drawPath(scene, [p0, p1], {stroke: "steelblue", width: 2});
  d3.range(11).forEach((i) => drawPoint(scene, lerp(p0, p1, i / 10), {color: "steelblue", r: 2.5}));
  const outside = lerpU < 0 || lerpU > 1;
  drawPoint(scene, lerp(p0, p1, lerpU), {color: outside ? "crimson" : "orangered", r: 6, label: `f(${lerpU.toFixed(2)})`});
})
```

Weights ${tex`(1-u,\ u)`} = (${(1 - lerpU).toFixed(2)}, ${lerpU.toFixed(2)}).
The small dots are ${tex`u = 0, 0.1, \dots, 1`}: the velocity
${tex`\mathbf p_1 - \mathbf p_0`} is constant, so they are evenly spaced.
Outside ${tex`[0, 1]`} one weight goes negative and the point
**extrapolates** along the dashed line.

### Affine and convex combinations

The lerp weights **sum to 1**. A weighted sum
${tex`\sum_i w_i\,\mathbf p_i`} with ${tex`\sum_i w_i = 1`} is an **affine
combination**, and it moves with the points: translate every point by
${tex`\mathbf d`} and the result moves by ${tex`\mathbf d`} too. If every
${tex`w_i \ge 0`} as well, it is a **convex combination**, and the result
stays inside the **convex hull** of the points. The table translates three
points by ${tex`\mathbf d = (10, -4)`}:

```js echo
(() => {
  const P = [{x: 1, y: 0}, {x: 3, y: 1}, {x: 2, y: 3}], d = {x: 10, y: -4};
  const combo = (w, pts) => pts.reduce((s, p, i) => vec2.add(s, vec2.scale(p, w[i])), {x: 0, y: 0});
  const moved = P.map((p) => vec2.add(p, d));
  return Inputs.table([[0.2, 0.5, 0.3], [-0.5, 1, 0.5], [0.4, 0.5, 0.3]].map((w) => {
    const sum = d3.sum(w), shift = vec2.sub(combo(w, moved), combo(w, P));
    return {
      weights: w.join(", "), sum: sum.toFixed(1),
      "result moves by": `(${shift.x.toFixed(1)}, ${shift.y.toFixed(1)})`,
      kind: Math.abs(sum - 1) > 1e-9 ? "not affine" : w.every((v) => v >= 0) ? "convex" : "affine only"
    };
  }));
})()
```

Only the last row, whose weights sum to 1.2, moves by
${tex`1.2\,\mathbf d`}: its result depends on where the origin is. The
curves in this module blend their control points with weights that sum to 1.

### Reparameterization

The same curve can be traced with different timing. Below, the same
segment is traced by ${tex`(u,u)`}, ${tex`(u^2,u^2)`}, and
${tex`(u^5,u^5)`} at 11 equal steps of ${tex`u`}:

```js echo
const reparamPower = view(Inputs.range([1, 6], {value: 2, step: 0.5, label: "power p in f(u) = (uᵖ, uᵖ)"}));
```

```js echo
Plot.plot({
  height: 120, x: {domain: [0, 1], label: "position along the segment"}, y: {axis: null},
  marks: [
    Plot.ruleY([0], {stroke: "#ccc", strokeWidth: 3}),
    Plot.dot(d3.range(11).map((i) => ({x: (i / 10) ** reparamPower, mid: i === 5})), {x: "x", y: 0, r: (d) => (d.mid ? 7 : 4), fill: (d) => (d.mid ? "orangered" : "steelblue")})
  ]
})
```

The red dot is ${tex`u = 0.5`}, which lands at
${tex`0.5^{p}`} = ${(0.5 ** reparamPower).toFixed(3)} of the way along.
The velocity ${tex`(pu^{p-1}, pu^{p-1})`} is small near ${tex`u = 0`}, so
the dots bunch up there. Parameter space is not distance along the curve.
An **arc-length parameterization** fixes that; we build one in the WebGPU
section.

### Barycentric coordinates

Lerp blends **two** points with one parameter. Blending **three** points
with weights ${tex`\alpha + \beta + \gamma = 1`} covers a triangle:
${tex`\mathbf p = \alpha\,\mathbf a + \beta\,\mathbf b + \gamma\,\mathbf c`}.
Each weight is an **area ratio**: ${tex`\alpha`} is the area of the
sub-triangle opposite ${tex`\mathbf a`} over the whole area. In 2D, the
signed area comes from a cross product:

```js echo
const signedArea = (a, b, c) => ((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
function barycentric(a, b, c, p) {
  const A = signedArea(a, b, c);
  return {alpha: signedArea(p, b, c) / A, beta: signedArea(a, p, c) / A, gamma: signedArea(a, b, p) / A};
}
```

```js echo
const baryWidget = dragPoints({
  a: {x: -2.6, y: -1.8}, b: {x: 2.8, y: -1.2}, c: {x: -0.2, y: 2.6}, p: {x: 0.2, y: 0}
}, {domain: 3.6, colors: ["crimson", "seagreen", "royalblue", "currentColor"]});
const baryPts = view(baryWidget);
```

```js echo
baryWidget.redecorate((scene) => {
  const {a, b, c, p} = baryPts, w = barycentric(a, b, c, p);
  // each sub-triangle is shaded in the color of the corner it is opposite
  drawPolygon(scene, [p, b, c], {stroke: "none", fill: "crimson", opacity: 0.15});
  drawPolygon(scene, [a, p, c], {stroke: "none", fill: "seagreen", opacity: 0.15});
  drawPolygon(scene, [a, b, p], {stroke: "none", fill: "royalblue", opacity: 0.15});
  drawPolygon(scene, [a, b, c], {stroke: "gray"});
  const channel = (v) => Math.round(255 * Math.min(1, Math.max(0, v)));
  scene.svg.append("circle").attr("cx", scene.x(p.x)).attr("cy", scene.y(p.y)).attr("r", 13)
    .attr("fill", `rgb(${channel(w.alpha)}, ${channel(w.beta)}, ${channel(w.gamma)})`);
})
```

```js echo
(() => {
  const {a, b, c, p} = baryPts, {alpha, beta, gamma} = barycentric(a, b, c, p);
  const inside = alpha >= 0 && beta >= 0 && gamma >= 0;
  return html`<pre>α = ${alpha.toFixed(3)}   β = ${beta.toFixed(3)}   γ = ${gamma.toFixed(3)}   sum = ${(alpha + beta + gamma).toFixed(3)}
p is ${inside ? "inside" : "outside"} the triangle</pre>`;
})()
```

The ring around ${tex`p`} has the color
${tex`\alpha\cdot\text{red} + \beta\cdot\text{green} + \gamma\cdot\text{blue}`}:
exactly how the rasterizer interpolates vertex colors (Module 08). Drag
${tex`p`} outside and one weight goes negative. On the edge
${tex`\mathbf{ab}`}, ${tex`\gamma = 0`} and the blend is a lerp.

## Curves from Repeated Lerps

### Lerping lerps: a quadratic curve

To blend three **control points** with **one** parameter, lerp along both
legs of the **control polygon**, then lerp between the results:

${tex.block`\mathbf q_0 = \operatorname{lerp}(\mathbf p_0, \mathbf p_1, u),\quad \mathbf q_1 = \operatorname{lerp}(\mathbf p_1, \mathbf p_2, u),\quad \mathbf f(u) = \operatorname{lerp}(\mathbf q_0, \mathbf q_1, u) = (1-u)^2\mathbf p_0 + 2u(1-u)\,\mathbf p_1 + u^2\mathbf p_2`}

```js echo
const quadWidget = dragPoints({"p₀": {x: -3, y: -1.5}, "p₁": {x: -0.5, y: 2.8}, "p₂": {x: 3, y: -1}}, {domain: 3.6});
const quadPts = view(quadWidget);
const quadU = view(Inputs.range([0, 1], {value: 0.35, step: 0.01, label: "u"}));
```

```js echo
quadWidget.redecorate((scene) => {
  const [p0, p1, p2] = Object.values(quadPts);
  const q0 = lerp(p0, p1, quadU), q1 = lerp(p1, p2, quadU);
  drawPath(scene, [p0, p1, p2], {stroke: "gray", width: 1, dash: "4,3"});
  drawPath(scene, sampleCurve((u) => lerp(lerp(p0, p1, u), lerp(p1, p2, u), u), 80), {stroke: "steelblue", width: 3});
  drawPath(scene, [q0, q1], {stroke: "seagreen", width: 1.5});
  drawPoint(scene, q0, {color: "seagreen", r: 4, label: "q₀"});
  drawPoint(scene, q1, {color: "seagreen", r: 4, label: "q₁"});
  drawPoint(scene, lerp(q0, q1, quadU), {color: "crimson", r: 6, label: "f(u)"});
})
```

The curve starts at ${tex`\mathbf p_0`} and ends at ${tex`\mathbf p_2`},
but only bends toward ${tex`\mathbf p_1`}. The green segment
${tex`\mathbf q_0\mathbf q_1`} touches the curve at ${tex`\mathbf f(u)`}:
it is the **tangent**, and ${tex`\mathbf f'(u) = 2(\mathbf q_1 - \mathbf q_0)`}.

### The de Casteljau algorithm

With more control points, lerp each pair of neighbors and repeat until one
point remains. We keep every level, because the intermediate points are
useful later:

```js echo
function deCasteljauLevels(points, u) {
  const levels = [points];
  while (levels.at(-1).length > 1) {
    const prev = levels.at(-1);
    levels.push(prev.slice(0, -1).map((a, i) => lerp(a, prev[i + 1], u)));
  }
  return levels;
}
const deCasteljau = (points, u) => deCasteljauLevels(points, u).at(-1)[0];
```

```js echo
const dcWidget = dragPoints({P0: {x: -2.8, y: -1}, P1: {x: -1.2, y: 2.2}, P2: {x: 1.2, y: 2.2}, P3: {x: 2.8, y: -1}}, {domain: 3.6});
const dcByLabel = view(dcWidget);
const dcT = view(Inputs.range([0, 1], {value: 0.5, step: 0.01, label: "u"}));
```

```js echo
const dcControls = Object.values(dcByLabel);   // read in its own cell so it updates while dragging
```

```js echo
dcWidget.redecorate((scene) => {
  drawPath(scene, dcControls, {stroke: "gray", width: 1, dash: "4,3"});
  drawPath(scene, sampleCurve((u) => deCasteljau(dcControls, u), 80), {stroke: "steelblue", width: 3});
  const levels = deCasteljauLevels(dcControls, dcT);
  const palette = ["#e07b39", "seagreen", "purple"];
  levels.slice(1, -1).forEach((level, k) => {
    drawPath(scene, level, {stroke: palette[k], width: 1.5});
    level.forEach((p) => drawPoint(scene, p, {color: palette[k], r: 3}));
  });
  drawPoint(scene, levels.at(-1)[0], {color: "crimson", r: 6, label: "f(u)"});
})
```

With four points the levels are ${tex`\mathbf p_0 \ldots \mathbf p_3`}
(gray), ${tex`\mathbf q_0, \mathbf q_1, \mathbf q_2`} (orange),
${tex`\mathbf r_0, \mathbf r_1`} (green), and ${tex`\mathbf f(u)`}. Every
step is a lerp, so the algorithm is simple and numerically stable. Most
figures below reuse these four control points, so come back here to
reshape them.

### Bézier curves and Bernstein polynomials

Expanding the levels of lerps gives the **Bézier curve**. Its weights are
the **Bernstein polynomials**
${tex`b_{k,n}(u) = \binom{n}{k}u^k(1-u)^{n-k}`}, and
${tex`\mathbf f(u) = \sum_k b_{k,n}(u)\,\mathbf p_k`}:

```js echo
function bernsteinPoint(points, u) {
  const n = points.length - 1;
  let x = 0, y = 0, binom = 1;
  points.forEach((p, k) => {
    const b = binom * u ** k * (1 - u) ** (n - k);
    x += b * p.x; y += b * p.y;
    binom = (binom * (n - k)) / (k + 1);
  });
  return {x, y};
}
```

```js echo
const bernDegree = view(Inputs.range([1, 6], {value: 3, step: 1, label: "degree n"}));
```

```js echo
(() => {
  const binom = (n, k) => d3.range(k).reduce((c, j) => (c * (n - j)) / (j + 1), 1);
  const rows = d3.range(0, 1.0001, 0.01).flatMap((u) => d3.range(bernDegree + 1).map((k) =>
    ({u, k: `b${k},${bernDegree}`, b: binom(bernDegree, k) * u ** k * (1 - u) ** (bernDegree - k)})));
  return Plot.plot({height: 200, x: {label: "u"}, y: {label: "b(u)", domain: [0, 1]}, color: {legend: true},
    marks: [Plot.ruleY([0]), Plot.line(rows, {x: "u", y: "b", stroke: "k"})]});
})()
```

The Bernstein polynomials are the terms of
${tex`\big((1-u) + u\big)^n = 1`}, so they **sum to 1**, and they are
${tex`\ge 0`} on ${tex`[0, 1]`}: every curve point is a **convex
combination** of the control points. Degree 1 is the lerp. Both ways of
computing the cubic agree:

```js echo
html`<pre>de Casteljau  f(${dcT.toFixed(2)}) = (${deCasteljau(dcControls, dcT).x.toFixed(6)}, ${deCasteljau(dcControls, dcT).y.toFixed(6)})
Bernstein     f(${dcT.toFixed(2)}) = (${bernsteinPoint(dcControls, dcT).x.toFixed(6)}, ${bernsteinPoint(dcControls, dcT).y.toFixed(6)})</pre>`
```

### The Bézier derivative

The derivative of a degree-${tex`n`} Bézier curve is a degree-${tex`(n-1)`}
Bézier curve whose control points are the scaled **legs**
${tex`n(\mathbf p_{k+1} - \mathbf p_k)`}:

```js echo
function bezierDerivative(points, u) {
  const n = points.length - 1;
  return bernsteinPoint(points.slice(1).map((p, k) => vec2.scale(vec2.sub(p, points[k]), n)), u);
}
```

```js echo
(() => {
  const scene = plane({domain: 3.6});
  drawPath(scene, dcControls, {stroke: "gray", width: 1, dash: "4,3"});
  drawPath(scene, sampleCurve((u) => bernsteinPoint(dcControls, u), 80), {stroke: "steelblue", width: 3});
  d3.range(9).forEach((i) => {
    const p = bernsteinPoint(dcControls, i / 8);
    drawArrow(scene, p, vec2.add(p, vec2.scale(bezierDerivative(dcControls, i / 8), 0.15)), {color: "orangered", width: 1.5});
  });
  const speed = Plot.plot({height: 160, width: 320, x: {label: "u"}, y: {label: "speed ‖f′(u)‖", zero: true},
    marks: [Plot.line(sampleCurve((u) => ({u, s: vec2.length(bezierDerivative(dcControls, u))}), 100), {x: "u", y: "s"})]});
  const levels = deCasteljauLevels(dcControls, dcT), [r0, r1] = levels.at(-2);
  const fromLegs = bezierDerivative(dcControls, dcT), fromLevels = vec2.scale(vec2.sub(r1, r0), 3);
  return html`<div style="display:flex; gap:16px; flex-wrap:wrap; align-items:center">${scene.svg.node()}${speed}</div>
  <pre>f′(${dcT.toFixed(2)}) from the legs:         (${fromLegs.x.toFixed(4)}, ${fromLegs.y.toFixed(4)})
f′(${dcT.toFixed(2)}) from de Casteljau 3(r₁ − r₀): (${fromLevels.x.toFixed(4)}, ${fromLevels.y.toFixed(4)})</pre>`;
})()
```

The arrows (at 0.15 × length) are the velocity at nine equal steps of
${tex`u`}. At the ends they point along the first and last legs:
${tex`\mathbf f'(0) = 3(\mathbf p_1 - \mathbf p_0)`} and
${tex`\mathbf f'(1) = 3(\mathbf p_3 - \mathbf p_2)`}. The speed plot is
not flat, which is why equal steps of ${tex`u`} are not equal distances.
Drag ${tex`P_1`} onto ${tex`P_0`} and the speed at ${tex`u = 0`} drops to 0.

### Bézier properties

```js echo
const affineForm = view(Inputs.form({
  angle: Inputs.range([-180, 180], {value: 35, step: 1, label: "rotate"}),
  scale: Inputs.range([0.4, 1.8], {value: 1.2, step: 0.05, label: "scale"})
}));
```

```js echo
(() => {
  const T = mat2.multiply(mat2.rotation((affineForm.angle * Math.PI) / 180), mat2.scaling(affineForm.scale, affineForm.scale));
  const moved = dcControls.map((p) => mat2.apply(T, p));
  const evalThenMove = sampleCurve((u) => mat2.apply(T, bernsteinPoint(dcControls, u)), 64);
  const moveThenEval = sampleCurve((u) => bernsteinPoint(moved, u), 64);
  const gap = d3.max(evalThenMove, (p, i) => vec2.length(vec2.sub(p, moveThenEval[i])));
  const scene = plane({domain: 4.2});
  const hull = d3.polygonHull(moved.map((p) => [p.x, p.y]));
  scene.svg.append("polygon").attr("points", hull.map(([x, y]) => `${scene.x(x)},${scene.y(y)}`).join(" "))
    .attr("fill", "steelblue").attr("fill-opacity", 0.12).attr("stroke", "steelblue").attr("stroke-dasharray", "3,2");
  drawPath(scene, evalThenMove, {stroke: "gray", width: 6, opacity: 0.4});
  drawPath(scene, moveThenEval, {stroke: "crimson", width: 1.5});
  moved.forEach((p, i) => drawPoint(scene, p, {color: "gray", r: 3, label: `P${i}`}));
  return html`${scene.svg.node()}<p style="font: 12px var(--sans-serif)">largest gap between "transform, then evaluate" and "evaluate, then transform": ${gap.toExponential(1)}</p>`;
})()
```

- **Convex hull:** the curve stays inside the shaded hull of its control
  points, because the Bernstein weights are convex.
- **Affine invariance:** transforming the control points gives the same
  curve as transforming the curve (the thin red curve lies on the thick
  gray one), because the weights sum to 1.
- **Symmetric:** reversing the control points gives the same curve,
  traced backward.
- **Variation diminishing:** no line crosses the curve more often than it
  crosses the control polygon.

### Subdivision

The de Casteljau points **split** the curve at ${tex`u`}. The first point
of each level, from ${tex`\mathbf p_0`} down to ${tex`\mathbf f(u)`}, gives
the control points of the left half, and the last point of each level,
from ${tex`\mathbf f(u)`} to ${tex`\mathbf p_3`}, gives the right half
(using the points and ${tex`u`} from the de Casteljau figure):

```js echo
(() => {
  const levels = deCasteljauLevels(dcControls, dcT);
  const left = levels.map((l) => l[0]), right = levels.map((l) => l.at(-1)).reverse();
  const scene = plane({domain: 3.6});
  for (const [poly, stroke] of [[left, "steelblue"], [right, "orangered"]]) {
    drawPath(scene, poly, {stroke, width: 1, dash: "4,3"});
    drawPath(scene, sampleCurve((u) => bernsteinPoint(poly, u), 50), {stroke, width: 3});
    poly.forEach((p) => drawPoint(scene, p, {color: stroke, r: 3.5}));
  }
  return scene.svg.node();
})()
```

Splitting again and again gives control polygons that **converge** to the
curve. For a quadratic, each split at ${tex`u = \tfrac12`} is **corner
cutting**: split every leg at its midpoint and move the corner to the
midpoint of the new segment:

```js echo
const cutWidget = dragPoints({P0: {x: -3, y: -1.5}, P1: {x: 0, y: 2.8}, P2: {x: 3, y: -1.5}}, {domain: 3.6});
const cutPts = view(cutWidget);
const cutSteps = view(Inputs.range([0, 6], {value: 2, step: 1, label: "corner cuts"}));
```

```js echo
cutWidget.redecorate((scene) => {
  const P = Object.values(cutPts);
  let poly = P;
  for (let s = 0; s < cutSteps; s++) {
    const next = [poly[0]];
    const add = (p) => { const q = next.at(-1); if (Math.hypot(p.x - q.x, p.y - q.y) > 1e-12) next.push(p); };   // skip repeated points
    for (let i = 1; i < poly.length - 1; i++) {
      const a = lerp(poly[i - 1], poly[i], 0.5), b = lerp(poly[i], poly[i + 1], 0.5);
      add(a); add(lerp(a, b, 0.5)); add(b);
    }
    add(poly.at(-1));
    poly = next;
  }
  drawPath(scene, sampleCurve((u) => bernsteinPoint(P, u), 80), {stroke: "#ccc", width: 7});
  drawPath(scene, poly, {stroke: "steelblue", width: 2});
  poly.forEach((p) => drawPoint(scene, p, {color: "orangered", r: 2.5}));
})
```

After ${cutSteps} cuts the polygon has ${tex`2^{n+1}+1`} = ${2 ** (cutSteps + 1) + 1} points
and lies almost on the gray limit curve.

Subdivision also gives an **adaptive** way to draw a curve: split until
each piece's control points are nearly collinear. The convex hull
guarantees that a line segment is then close to the piece:

```js echo
function flattenBezier(P, tol, out = [P[0]]) {
  const dist = (p, a, b) => Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / (Math.hypot(b.x - a.x, b.y - a.y) || 1);
  if (Math.max(dist(P[1], P[0], P[3]), dist(P[2], P[0], P[3])) < tol) { out.push(P[3]); return out; }
  const L = deCasteljauLevels(P, 0.5);
  flattenBezier(L.map((l) => l[0]), tol, out);
  flattenBezier(L.map((l) => l.at(-1)).reverse(), tol, out);
  return out;
}
const flatTol = view(Inputs.range([0.002, 0.5], {value: 0.05, step: 0.002, label: "tolerance (plane units)"}));
```

```js echo
(() => {
  const pts = flattenBezier(dcControls, flatTol);
  const scene = plane({domain: 3.6});
  drawPath(scene, pts, {stroke: "steelblue", width: 2});
  pts.forEach((p) => drawPoint(scene, p, {color: "orangered", r: 3}));
  return html`${scene.svg.node()}<p style="font:12px var(--sans-serif)">${pts.length - 1} line segments</p>`;
})()
```

Segments concentrate where the curve bends sharply, and straight stretches
use few. Choosing the tolerance in **pixels** makes zooming in produce
more segments automatically. The same split-and-recurse idea tests two
curves for **intersection**: if their hulls do not overlap, they cannot
intersect.

## Polynomial Pieces and Continuity

### The constraint matrix and basis matrix

Expanding a Bézier curve gives an ordinary polynomial, so a curve has two
descriptions: **coefficients**
${tex`\mathbf f(u) = \mathbf u\cdot\mathbf a`} with
${tex`\mathbf u = [1\ u\ u^2\ \cdots]`}, and **control values**
${tex`\mathbf p`}. Each constraint (a position or a derivative at some
${tex`u`}) is a linear equation in ${tex`\mathbf a`}, so
${tex`\mathbf p = C\mathbf a`}. The **basis matrix** is
${tex`B = C^{-1}`}, and ${tex`\mathbf f(u) = \mathbf u B \mathbf p`}. The
code below builds ${tex`C`} from a list of constraints and inverts it:

```js echo
// Row of C for "the k-th derivative of f at u" for a polynomial of degree n.
function constraintRow(n, u, k = 0) {
  return d3.range(n + 1).map((i) => {
    if (i < k) return 0;
    let c = 1;
    for (let j = 0; j < k; j++) c *= i - j;       // i (i-1) ... (i-k+1)
    return c * u ** (i - k);
  });
}

function invert(M) {                              // Gauss-Jordan elimination with partial pivoting
  const n = M.length, A = M.map((row, i) => [...row, ...d3.range(n).map((j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    const p = d3.maxIndex(A.slice(c), (row) => Math.abs(row[c])) + c;
    [A[c], A[p]] = [A[p], A[c]];
    const pivot = A[c][c];
    A[c] = A[c].map((v) => v / pivot);
    for (let r = 0; r < n; r++) if (r !== c) { const f = A[r][c]; A[r] = A[r].map((v, j) => v - f * A[c][j]); }
  }
  return A.map((row) => row.slice(n).map((v) => (Math.abs(v) < 1e-12 ? 0 : v)));
}

function basisMatrix(degree, constraints) {        // constraints: [{u, k}] for "k-th derivative at u"
  return invert(constraints.map(({u, k = 0}) => constraintRow(degree, u, k)));
}
const showMatrix = (M) => tex`\begin{bmatrix}${M.map((r) => r.map((v) => +v.toFixed(3)).join(" & ")).join(String.raw`\\`)}\end{bmatrix}`;
```

The cubic Bézier conditions are linear too:
${tex`\mathbf p_1 = \mathbf f(0) + \tfrac13\mathbf f'(0)`} and
${tex`\mathbf p_2 = \mathbf f(1) - \tfrac13\mathbf f'(1)`}. Each is a sum
of constraint rows:

```js echo
const bezierRows = [
  constraintRow(3, 0),
  constraintRow(3, 0).map((v, i) => v + constraintRow(3, 0, 1)[i] / 3),
  constraintRow(3, 1).map((v, i) => v - constraintRow(3, 1, 1)[i] / 3),
  constraintRow(3, 1)
];
```

| Curve | Constraints | ${tex`B = C^{-1}`} |
|---|---|---|
| line | ${tex`f(0), f(1)`} | ${showMatrix(basisMatrix(1, [{u: 0}, {u: 1}]))} |
| quadratic through 3 points | ${tex`f(0), f(0.5), f(1)`} | ${showMatrix(basisMatrix(2, [{u: 0}, {u: 0.5}, {u: 1}]))} |
| cubic Bézier | ${tex`f(0),\ f(0) + \tfrac13 f'(0),\ f(1) - \tfrac13 f'(1),\ f(1)`} | ${showMatrix(invert(bezierRows))} |

The line's ${tex`B`} gives ${tex`\mathbf f(u) = (1-u)\,\mathbf p_0 + u\,\mathbf p_1`}:
the lerp. Column ${tex`k`} of the Bézier ${tex`B`} holds the coefficients
of ${tex`b_{k,3}`}: the first column is
${tex`1 - 3u + 3u^2 - u^3 = (1-u)^3`}. Only **linear** constraints work;
a segment's length or angle cannot be a row of ${tex`C`}.

### Blending functions

The **blending functions** are ${tex`\mathbf b(u) = \mathbf u B`}, and
the curve is ${tex`\mathbf f(u) = \sum_i b_i(u)\,\mathbf p_i`}. Pick a
basis to see its blending functions:

```js echo
const blendBases = {
  "lerp (line)": basisMatrix(1, [{u: 0}, {u: 1}]),
  "quadratic through 3 points": basisMatrix(2, [{u: 0}, {u: 0.5}, {u: 1}]),
  "cubic Bézier": invert(bezierRows),
  "cubic through 4 equally spaced points": basisMatrix(3, [{u: 0}, {u: 1 / 3}, {u: 2 / 3}, {u: 1}])
};
const blendChoice = view(Inputs.select(Object.keys(blendBases), {value: "cubic Bézier", label: "basis"}));
```

```js echo
(() => {
  const B = blendBases[blendChoice], n = B.length;
  const rows = d3.range(0, 1.0001, 0.01).flatMap((u) => {
    const uv = d3.range(n).map((r) => u ** r);
    return d3.range(n).map((i) => ({u, i: `b${i}`, b: d3.sum(uv, (x, r) => x * B[r][i])}));
  });
  return html`${Plot.plot({height: 220, x: {label: "u"}, y: {label: "bᵢ(u)"}, color: {legend: true},
    marks: [Plot.ruleY([0]), Plot.line(rows, {x: "u", y: "b", stroke: "i"})]})}
    <p>${showMatrix(B)}</p>`;
})()
```

All of them sum to 1. The lerp and Bézier weights also stay in
${tex`[0, 1]`}, so their curves stay in the convex hull. The
**interpolating** weights (through 3 or 4 points) go **negative**, so
those curves can leave the hull.

### Interpolating polynomials

A degree-${tex`n`} polynomial can pass through ${tex`n+1`} points, using
the **Lagrange** blending functions
${tex`b_i(t) = \prod_{j\ne i}(t - t_j)/(t_i - t_j)`}. Compare it with a
Catmull–Rom spline (built in the Splines section) through the same points:

```js echo
const lagrangeWidget = dragPoints({
  A: {x: -3.2, y: -0.4}, B: {x: -2.2, y: 1.2}, C: {x: -1.1, y: -0.8}, D: {x: 0, y: 0.6},
  E: {x: 1.1, y: 1.4}, F: {x: 2.2, y: -0.2}, G: {x: 3.2, y: 0.8}
}, {width: 420, height: 300, domain: 3.8});
const lagrangePts = view(lagrangeWidget);
```

```js echo
function lagrangeCurve(points) {
  const n = points.length, ts = d3.range(n).map((i) => i / (n - 1));
  return (t) => {
    let x = 0, y = 0;
    points.forEach((p, i) => {
      let b = 1;
      for (let j = 0; j < n; j++) if (j !== i) b *= (t - ts[j]) / (ts[i] - ts[j]);
      x += b * p.x; y += b * p.y;
    });
    return {x, y};
  };
}
```

```js echo
lagrangeWidget.redecorate((scene) => {
  const pts = Object.values(lagrangePts);
  drawPath(scene, sampleCurve(lagrangeCurve(pts), 300), {stroke: "orange", width: 2.5});
  // Catmull-Rom with the end points repeated so the curve reaches them
  const ext = [pts[0], ...pts, pts.at(-1)];
  drawPath(scene, d3.range(pts.length - 1).flatMap((i) => sampleCurve((u) => cardinalPoint(ext.slice(i, i + 4), u, 0), 30)), {stroke: "steelblue", width: 2.5});
})
```

The orange interpolating polynomial **overshoots** between the points,
and dragging any single point changes it **everywhere**. It is also
costly: every curve point needs all ${tex`n+1`} points. The blue spline
stays near the points, and dragging one point changes only the nearby
part. This is why graphics builds curves from low-degree pieces.

### Piecewise curves and local control

A **spline** is a **piecewise polynomial**. The pieces must meet, and
ideally moving one control point should change only a nearby part of the
curve (**local control**). That depends on how the pieces get their
values. Below, two chains of line segments represent the same shape. The
first uses **shared endpoints**. The second stores each segment as a
start point and a **midpoint**, and gets its end point by
**dependency**: ${tex`\text{end} = 2\,\text{mid} - \text{start}`},
where each segment starts where the last one ended:

```js echo
const localityWidget = dragPoints({"p₀": {x: -3.4, y: -1}}, {width: 420, height: 260, domain: 3.8, colors: ["orangered"]});
const localityP0 = view(localityWidget);
```

```js echo
localityWidget.redecorate((scene) => {
  const ends = [{x: -3.4, y: -1}, {x: -2, y: 0.4}, {x: -0.6, y: -0.8}, {x: 0.8, y: 0.5}, {x: 2.2, y: -0.6}, {x: 3.5, y: 0.6}];
  const mids = d3.range(5).map((i) => lerp(ends[i], ends[i + 1], 0.5));
  const p0 = localityP0["p₀"];
  // shared endpoints: only the first segment uses p0
  drawPath(scene, [p0, ...ends.slice(1)], {stroke: "steelblue", width: 3, opacity: 0.8});
  // dependency chain: each end is computed from its start and stored midpoint
  const chain = [p0];
  for (const m of mids) chain.push({x: 2 * m.x - chain.at(-1).x, y: 2 * m.y - chain.at(-1).y});
  drawPath(scene, chain, {stroke: "orangered", width: 2, dash: "6,3"});
  mids.forEach((m) => scene.svg.append("circle").attr("cx", scene.x(m.x)).attr("cy", scene.y(m.y)).attr("r", 3).attr("fill", "orange"));
})
```

Drag ${tex`p_0`}. The blue chain (shared endpoints) changes only its first
segment. The dashed red chain (dependency) changes **every** segment after
it. That is a lack of local control, and the natural cubic spline below
has the same problem.

### Continuity at a joint

Where piece ${tex`\mathbf f_1`} ends and piece ${tex`\mathbf f_2`} begins:

- ${tex`C^0`}: ${tex`\mathbf f_1(1) = \mathbf f_2(0)`}. The pieces meet,
  possibly at a **corner**.
- ${tex`C^1`}: the velocities also match,
  ${tex`\mathbf f_1'(1) = \mathbf f_2'(0)`}. ${tex`C^n`} matches all
  derivatives up to order ${tex`n`}; ${tex`C^2`} keeps the acceleration
  smooth, which matters for camera paths.
- ${tex`G^1`}: ${tex`\mathbf f_1'(1) = k\,\mathbf f_2'(0)`} with
  ${tex`k > 0`}. The **direction** matches, but the speed may not.
  ${tex`G^2`} adds the same **curvature**.

${tex`C^n`} (**parametric**) continuity depends on the parameterization;
${tex`G^n`} (**geometric**) continuity depends only on the shape.

### Joining Bézier segments

Two cubic segments share the point ${tex`P_3 = Q_0`}. For ${tex`G^1`},
${tex`P_2`}, ${tex`P_3`}, and ${tex`Q_1`} must be **collinear**. For
${tex`C^1`}, they must also be **equally spaced**. The dots mark equal
steps of ${tex`u`} on each segment:

```js echo
const joinWidget = dragPoints({"P3 = Q0": {x: 0, y: 0}, "Q1": {x: 1.6, y: 2.1}}, {colors: ["seagreen", "purple"], domain: 4.2});
const joinPts = view(joinWidget);
const joinMode = view(Inputs.radio(["C⁰ (free)", "G¹ (collinear)", "C¹ (collinear and equal)"], {value: "C¹ (collinear and equal)", label: "join"}));
```

```js echo
const joinGeometry = (() => {
  const P0 = {x: -3, y: -0.5}, P1 = {x: -2, y: 1.8}, P2 = {x: -1, y: 1.3}, Q2 = {x: 2.5, y: -1.2}, Q3 = {x: 3.5, y: 0.3};
  const P3 = joinPts["P3 = Q0"], tin = vec2.sub(P3, P2);
  let Q1 = joinPts.Q1;
  if (joinMode.startsWith("C¹")) Q1 = vec2.add(P3, tin);
  else if (joinMode.startsWith("G¹")) Q1 = vec2.add(P3, vec2.scale(vec2.normalize(tin), vec2.length(vec2.sub(joinPts.Q1, P3))));
  return {A: [P0, P1, P2, P3], B: [P3, Q1, Q2, Q3]};
})();
```

```js echo
joinWidget.redecorate((scene) => {
  for (const [poly, stroke] of [[joinGeometry.A, "steelblue"], [joinGeometry.B, "#e07b39"]]) {
    drawPath(scene, poly, {stroke: "gray", width: 1, dash: "3,2"});
    drawPath(scene, sampleCurve((u) => bernsteinPoint(poly, u), 48), {stroke, width: 2.5});
    d3.range(1, 8).forEach((i) => drawPoint(scene, bernsteinPoint(poly, i / 8), {color: stroke, r: 2.5}));
  }
})
```

```js echo
(() => {
  const [, , P2, P3] = joinGeometry.A, Q1 = joinGeometry.B[1];
  const d1 = vec2.scale(vec2.sub(P3, P2), 3), d2 = vec2.scale(vec2.sub(Q1, P3), 3);   // f₁'(1) and f₂'(0)
  const angle = (Math.acos(Math.max(-1, Math.min(1, vec2.dot(vec2.normalize(d1), vec2.normalize(d2))))) * 180) / Math.PI;
  return html`<pre>f₁'(1) = (${d1.x.toFixed(2)}, ${d1.y.toFixed(2)})    f₂'(0) = (${d2.x.toFixed(2)}, ${d2.y.toFixed(2)})
angle between them: ${angle.toFixed(1)}°    length ratio: ${(vec2.length(d2) / vec2.length(d1)).toFixed(2)}</pre>`;
})()
```

${tex`C^0`} leaves a corner. ${tex`G^1`} makes the angle 0°, but the
**speed** can still jump (ratio ≠ 1): drag ${tex`Q_1`} in ${tex`G^1`} mode
and watch the dot spacing change suddenly at the joint. ${tex`C^1`}
matches the whole derivative vector. The seam of a **closed** curve is
just another joint and needs the same condition.

## Splines

### Why cubic splines?

A **cubic** has four coefficients, the fewest that can match position
**and** velocity at both ends of a piece. Higher degrees cost more and
wiggle more. But no cubic spline can have all three of these at once:

| Cubic spline | Interpolating | Local | Continuity |
|---|---|---|---|
| natural | yes | **no** | ${tex`C^2`} |
| Hermite, cardinal, Catmull–Rom | yes | yes | **only** ${tex`C^1`} |
| uniform cubic B-spline | **no** | yes | ${tex`C^2`} |

### Evaluating a spline segment

Every spline below is evaluated the same way, one segment at a time, with
${tex`u \in [0, 1]`} restarting in each segment: gather the segment's four
**control values**, compute the blending functions
${tex`\mathbf b(u) = \mathbf u B`}, and blend. Only ${tex`B`} and the
gathering rule depend on the spline type:

```js echo
function evalSegment(B, p, u) {                  // p: the segment's four control values, each {x, y}
  const U = [1, u, u * u, u * u * u];
  const b = [0, 1, 2, 3].map((k) => d3.sum(U, (Ur, r) => Ur * B[r][k]));   // b = uB
  return {x: d3.sum(b, (bk, k) => bk * p[k].x), y: d3.sum(b, (bk, k) => bk * p[k].y)};
}
```

### Natural cubic splines

The control values are ${tex`\mathbf f(0), \mathbf f'(0), \mathbf f''(0), \mathbf f(1)`}:

```js echo
const naturalB = basisMatrix(3, [{u: 0}, {u: 0, k: 1}, {u: 0, k: 2}, {u: 1}]);
```

${tex`B =`} ${showMatrix(naturalB)}

Each segment passes its end slope and curvature to the next one, so the
spline is interpolating and ${tex`C^2`}. But every segment depends on all
the ones before it, and the chain is **ill-conditioned**. Nudge the
starting curvature slightly and watch the error grow down the chain:

```js echo
function naturalChain(points, d0, dd0) {
  const segments = [];
  let start = points[0], d = d0, dd = dd0;
  for (let i = 1; i < points.length; i++) {
    const p = [start, d, dd, points[i]];
    const a = naturalB.map((row) => ({x: d3.sum(row, (b, k) => b * p[k].x), y: d3.sum(row, (b, k) => b * p[k].y)}));   // a = Bp
    const f = (u) => ({x: a[0].x + a[1].x * u + a[2].x * u * u + a[3].x * u ** 3, y: a[0].y + a[1].y * u + a[2].y * u * u + a[3].y * u ** 3});
    segments.push(f);
    // values at u = 1 become the next segment's starting constraints
    d = {x: a[1].x + 2 * a[2].x + 3 * a[3].x, y: a[1].y + 2 * a[2].y + 3 * a[3].y};
    dd = {x: 2 * a[2].x + 6 * a[3].x, y: 2 * a[2].y + 6 * a[3].y};
    start = points[i];
  }
  return segments;
}
// The chain is affine in the starting slope. Pick the slope that makes the
// last curvature zero too: that is the true natural spline (f'' = 0 at both ends).
function naturalSpline(points, nudge = 0) {
  const endCurvature = (d0) => {
    const f = naturalChain(points, d0, {x: 0, y: 0}).at(-1), h = 1e-4;
    return {x: (f(1).x - 2 * f(1 - h).x + f(1 - 2 * h).x) / h ** 2, y: (f(1).y - 2 * f(1 - h).y + f(1 - 2 * h).y) / h ** 2};
  };
  const c0 = endCurvature({x: 0, y: 0}), c1 = endCurvature({x: 1, y: 1});
  const d0 = {x: -c0.x / (c1.x - c0.x), y: -c0.y / (c1.y - c0.y)};
  return naturalChain(points, d0, {x: 0, y: nudge});
}
const naturalNudge = view(Inputs.range([-0.1, 0.1], {value: 0.01, step: 0.002, label: "change in the starting curvature f''(0)"}));
```

```js echo
(() => {
  const pts = d3.range(7).map((i) => ({x: -3.3 + i * 1.1, y: [0, 0.8, -0.3, 0.6, -0.2, 0.7, 0][i]}));
  const scene = plane({width: 420, height: 300, domain: 3.8});
  for (const [nudge, stroke] of [[0, "steelblue"], [naturalNudge, "orangered"]]) {
    naturalSpline(pts, nudge).forEach((f) => drawPath(scene, sampleCurve(f, 40), {stroke, width: 2, clip: 3.7}));
  }
  pts.forEach((p) => drawPoint(scene, p, {r: 4}));
  return scene.svg.node();
})()
```

Both curves interpolate every point, but a tiny change at the start
(red vs. blue) grows into large wiggles at the far end.

### Hermite cubics

The control values are the end **positions and derivatives**
${tex`\mathbf f(0), \mathbf f'(0), \mathbf f(1), \mathbf f'(1)`}.
Neighboring segments share a position and a derivative, so a Hermite
spline is interpolating, local, and ${tex`C^1`}, but the user must supply
the derivatives:

```js echo
const hermiteB = basisMatrix(3, [{u: 0}, {u: 0, k: 1}, {u: 1}, {u: 1, k: 1}]);
const hermitePoint = (control, u) => evalSegment(hermiteB, control, u);   // control: [p0, d0, p1, d1]
```

${tex`B =`} ${showMatrix(hermiteB)}

### Cardinal and Catmull–Rom splines

A **cardinal** segment is a Hermite segment that computes its own
derivatives. It interpolates its middle two points and takes its end
slopes from the neighbors:
${tex`\mathbf f'(0) = s(\mathbf p_3 - \mathbf p_1)`},
${tex`\mathbf f'(1) = s(\mathbf p_4 - \mathbf p_2)`} with
${tex`s = (1-\tau)/2`}. Tension ${tex`\tau = 0`} gives the
**Catmull–Rom** spline:

```js echo
function cardinalPoint([p1, p2, p3, p4], u, tension) {
  const s = (1 - tension) / 2;
  return hermitePoint([p2, vec2.scale(vec2.sub(p3, p1), s), p3, vec2.scale(vec2.sub(p4, p2), s)], u);
}
```

```js echo
const cardinalWidget = dragPoints({
  "1": {x: -3.4, y: -1.2}, "2": {x: -2.3, y: 0.9}, "3": {x: -0.6, y: 1.5}, "4": {x: 0.1, y: -0.9},
  "5": {x: 1.5, y: -1.1}, "6": {x: 2.3, y: 1.2}, "7": {x: 3.4, y: 0.5}
}, {width: 420, height: 300, domain: 3.8});
const cardinalPts = view(cardinalWidget);
const cardinalTension = view(Inputs.range([-0.5, 0.95], {value: 0, step: 0.05, label: "tension τ (0 = Catmull–Rom)"}));
```

```js echo
cardinalWidget.redecorate((scene) => {
  const pts = Object.values(cardinalPts);
  drawPath(scene, pts, {stroke: "gray", width: 1, dash: "3,3"});
  d3.range(pts.length - 3).forEach((i) =>
    drawPath(scene, sampleCurve((u) => cardinalPoint(pts.slice(i, i + 4), u, cardinalTension), 40), {stroke: i % 2 ? "steelblue" : "seagreen", width: 2.5}));
})
```

Each colored segment is one cubic. Higher tension pulls the curve toward
straight lines, and negative tension makes it loopier. Points 1 and 7 are
not interpolated; they only set the end slopes. Repeat them if the curve
should reach them, or, on a **closed** curve, wrap the indices around.
Dragging a point changes at most four segments.

### From anchors to Bézier segments

A Catmull–Rom segment from ${tex`\mathbf p_i`} to ${tex`\mathbf p_{i+1}`}
can be rewritten as a cubic Bézier curve with control points
${tex`\mathbf c_0 \ldots \mathbf c_3`} that draws **exactly** the same
curve, so it can be evaluated with the Bernstein formula on the CPU or in
a shader. Two cubics with the same end points and the same end
derivatives are the same curve, so:

1. **Same ends:** ${tex`\mathbf c_0 = \mathbf p_i`} and ${tex`\mathbf c_3 = \mathbf p_{i+1}`}.
2. **Same end derivatives:** set the Bézier end derivatives
   ${tex`3(\mathbf c_1 - \mathbf c_0)`} and ${tex`3(\mathbf c_3 - \mathbf c_2)`}
   equal to the Catmull–Rom ones.
3. **Solve** for ${tex`\mathbf c_1`} and ${tex`\mathbf c_2`}.

Solving is left to you. To check an answer, draw your Bézier segments with
`bernsteinPoint` on top of `cardinalPoint(..., 0)`: they should match to
round-off, and every joint is then ${tex`C^1`}.

### Uniform cubic B-splines

A **B-spline** curve blends its control points with basis functions that
are each nonzero over only a few segments, so it is local like a cardinal
spline. In the uniform cubic case, every segment has the same basis
matrix, so a B-spline segment is evaluated like any other spline segment.
Segment ${tex`i`} uses the control values
${tex`\mathbf p_i \ldots \mathbf p_{i+3}`} and passes through none of them:

```js echo
const bsplineB = [[1, 4, 1, 0], [-3, 0, 3, 0], [3, -6, 3, 0], [-1, 3, -3, 1]].map((r) => r.map((v) => v / 6));
```

```js echo
const bsWidget = dragPoints({
  P0: {x: -3.2, y: -1}, P1: {x: -2.3, y: 1.6}, P2: {x: -1, y: -1.4}, P3: {x: 0, y: 1.8},
  P4: {x: 1, y: -1.2}, P5: {x: 2.3, y: 1.4}, P6: {x: 3.2, y: -0.6}
}, {domain: 3.8});
const bsPts = view(bsWidget);
```

```js echo
bsWidget.redecorate((scene) => {
  const pts = Object.values(bsPts);
  drawPath(scene, pts, {stroke: "gray", width: 1, dash: "3,2"});
  d3.range(pts.length - 3).forEach((i) =>
    drawPath(scene, sampleCurve((u) => evalSegment(bsplineB, pts.slice(i, i + 4), u), 40), {stroke: i % 2 ? "steelblue" : "seagreen", width: 3}));
})
```

${html`<p style="font:12px var(--sans-serif)">${showMatrix(bsplineB)}</p>`}

Each colored segment is one cubic. Dragging a point changes at most four
segments. The cubic B-spline is ${tex`C^2`} and local, and gives up
**interpolation**.

## Curves in WebGPU

### Two ways to draw a curve

The GPU rasterizes only points, lines, and triangles, so every curve is
**tessellated** into line segments. There are two places to do it:

- **On the CPU:** evaluate ${tex`N+1`} points and upload them as a vertex
  buffer. Simple, and fine for an editor, but every change re-uploads all
  the points.
- **On the GPU:** upload only the control points and evaluate the curve in
  the vertex shader. Only a few bytes change per frame.

Both canvases below draw the cubic Bézier from the de Casteljau figure:

```js echo
const {adapter, device} = await webgpu.requestDevice();
const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
const deviceErrorLog = document.createElement("pre");
deviceErrorLog.style.cssText = "display: none; color: #e5484d; background: #2a1214; border: 1px solid #e5484d; border-radius: 6px; padding: 8px 12px; font-size: 12px; white-space: pre-wrap;";
device.addEventListener("uncapturederror", (e) => { deviceErrorLog.textContent += `WebGPU error: ${e.error.message}\n`; deviceErrorLog.style.display = "block"; });
const makeCanvas = (width, height) => {
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  canvas.style.borderRadius = "8px";
  return {canvas, context: webgpu.configureCanvas(canvas, device).context};
};
```

```js echo
deviceErrorLog
```

```js echo
const gpuSegments = view(Inputs.range([2, 128], {value: 24, step: 1, label: "segments N"}));
```

```js echo
(() => {
  const row = document.createElement("div");
  row.style.cssText = "display:flex; gap:16px; flex-wrap:wrap";
  for (const [label, {canvas}] of [["CPU: vertex buffer, line-strip", cpuTarget], ["GPU: vertex shader, line-strip", gpuLineTarget]]) {
    const cell = document.createElement("div");
    cell.innerHTML = `<div style="font:12px var(--sans-serif); opacity:.65; margin-bottom:4px">${label}</div>`;
    cell.append(canvas);
    row.append(cell);
  }
  return row;
})()
```

They look the same. Lower ${tex`N`} to see the tessellation. Uniform
steps waste points on straight stretches; an adaptive tessellator would
subdivide instead (see **Subdivision**).

### Tessellating on the CPU

Evaluate ${tex`N + 1`} points with `bernsteinPoint`, convert them to clip
space, and upload them every time the curve changes:

```js echo
const MAX_SEGMENTS = 128;
const cpuCurveBuffer = device.createBuffer({size: 8 * (MAX_SEGMENTS + 1), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST});
const toNDC = (p) => [p.x / 3.6, p.y / 3.6];      // the drag widget spans [-3.6, 3.6]
function tessellateBezier(controls, N) {
  const pts = new Float32Array(2 * (N + 1));
  for (let i = 0; i <= N; i++) pts.set(toNDC(bernsteinPoint(controls, i / N)), 2 * i);
  return pts;
}
```

The pipeline uses `topology: "line-strip"` and a vertex buffer with one
`float32x2` attribute; `pass.draw(N + 1)` draws it.

### Evaluating in the vertex shader

Here the shader gets only the four control points in a uniform, and
`vertex_index` becomes the parameter: ${tex`u = i / N`}. There is no
vertex buffer at all. One module holds every entry point used in this
section:

```js echo
const curveModule = device.createShaderModule({code: `
struct Curve {
  p : array<vec4f, 4>,      // vec4f keeps the 16-byte array stride
  segments : u32,           // byte offset 64
  viewport : vec2f,         // canvas size in pixels, byte offset 72
  widthPx : f32,            // byte offset 80
  pixelNormal : u32,        // byte offset 84: 1 = normal in pixels, 0 = in clip space
};                          // 96 bytes in all
@group(0) @binding(0) var<uniform> curve : Curve;

fn bezier(u : f32) -> vec2f {
  let a = 1.0 - u;
  return (a * a * a * curve.p[0] + 3.0 * a * a * u * curve.p[1]
        + 3.0 * a * u * u * curve.p[2] + u * u * u * curve.p[3]).xy;      // Bernstein form
}
fn bezierTangent(u : f32) -> vec2f {
  let a = 1.0 - u;
  return (3.0 * (a * a * (curve.p[1] - curve.p[0]) + 2.0 * a * u * (curve.p[2] - curve.p[1])
        + u * u * (curve.p[3] - curve.p[2]))).xy;                         // f'(u)
}

@vertex
fn vs_cpu(@location(0) p : vec2f) -> @builtin(position) vec4f {          // CPU-tessellated points
  return vec4f(p, 0.0, 1.0);
}

@vertex
fn vs_line(@builtin(vertex_index) i : u32) -> @builtin(position) vec4f {
  return vec4f(bezier(f32(i) / f32(curve.segments)), 0.0, 1.0);
}

@vertex
fn vs_thick(@builtin(vertex_index) i : u32) -> @builtin(position) vec4f {
  let u = f32(i / 2u) / f32(curve.segments);                   // two vertices per sample
  let side = select(-1.0, 1.0, (i & 1u) == 1u);
  let toPixels = select(vec2f(1.0), curve.viewport, curve.pixelNormal == 1u);
  var dir = bezierTangent(u) * toPixels;                       // tangent on screen
  if (dot(dir, dir) < 1e-8) {                                  // collapsed handle: f' = 0
    dir = select(curve.p[3] - curve.p[1], curve.p[2] - curve.p[0], u < 0.5).xy * toPixels;
  }
  let n = normalize(vec2f(-dir.y, dir.x));                     // perpendicular to the tangent
  let offset = select(n * curve.widthPx / curve.viewport.y,    // wrong: same clip-space distance in x and y
                      n * curve.widthPx / curve.viewport,      // (w/2) px × 2/viewport
                      curve.pixelNormal == 1u);
  return vec4f(bezier(u) + side * offset, 0.0, 1.0);
}

@fragment
fn fs_main() -> @location(0) vec4f { return vec4f(0.95, 0.55, 0.2, 1.0); }`});

const makeCurvePipeline = (entryPoint, topology, buffers = []) => device.createRenderPipeline({
  layout: "auto",
  vertex: {module: curveModule, entryPoint, buffers},
  fragment: {module: curveModule, entryPoint: "fs_main", targets: [{format: canvasFormat}]},
  primitive: {topology}
});
const cpuLinePipeline = makeCurvePipeline("vs_cpu", "line-strip", [{arrayStride: 8, attributes: [{shaderLocation: 0, offset: 0, format: "float32x2"}]}]);
const linePipeline = makeCurvePipeline("vs_line", "line-strip");
const thickPipeline = makeCurvePipeline("vs_thick", "triangle-strip");
const curveUniforms = device.createBuffer({size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
const curveBindGroup = (pipeline) => device.createBindGroup({layout: pipeline.getBindGroupLayout(0), entries: [{binding: 0, resource: {buffer: curveUniforms}}]});
const cpuTarget = makeCanvas(300, 300);
const gpuLineTarget = {...makeCanvas(300, 300), bindGroup: curveBindGroup(linePipeline)};
const thickTarget = {...makeCanvas(420, 260), bindGroup: curveBindGroup(thickPipeline)};
```

The vertex shader uses the same Bernstein form as `bernsteinPoint`. Drag
the control points in the de Casteljau figure: the CPU canvas re-uploads
${tex`2(N+1)`} floats, while the GPU canvas re-uploads only the 96-byte
uniform.

### WGSL alignment rules

The `Curve` uniform above has gaps. In WGSL, every type has an
**alignment**, and each struct field starts at the next multiple of it:

| Type | Align | Size |
|---|---:|---:|
| `f32`, `u32`, `i32` | 4 | 4 |
| `vec2f` | 8 | 8 |
| `vec3f` | **16** | **12** |
| `vec4f` | 16 | 16 |
| `mat4x4f` | 16 | 64 |

The struct's size is rounded up to its largest alignment. In a
**uniform** buffer, array elements must also be a multiple of 16 bytes
apart, which is why `Curve` uses `array<vec4f, 4>` instead of
`array<vec2f, 4>`. The function below applies the rules, so you can check
a layout before writing the JavaScript that fills it:

```js echo
const wgslTypes = {f32: [4, 4], u32: [4, 4], i32: [4, 4], vec2f: [8, 8], vec3f: [16, 12], vec4f: [16, 16], mat4x4f: [16, 64], "array<vec4f, 4>": [16, 64]};
function wgslLayout(fields) {                     // fields: [[name, type], ...]
  let offset = 0, structAlign = 0;
  const rows = fields.map(([field, type]) => {
    const [align, size] = wgslTypes[type];
    const start = Math.ceil(offset / align) * align;
    const row = {field, type, align, size, "byte offset": start, "float index": start / 4, "padding before": start - offset};
    offset = start + size;
    structAlign = Math.max(structAlign, align);
    return row;
  });
  return {rows, size: Math.ceil(offset / structAlign) * structAlign};
}
const wgslStructs = {
  "Light": [["intensity", "f32"], ["direction", "vec3f"], ["color", "vec3f"], ["radius", "f32"]],
  "Light, reordered": [["direction", "vec3f"], ["intensity", "f32"], ["color", "vec3f"], ["radius", "f32"]],
  "Curve (this page)": [["p", "array<vec4f, 4>"], ["segments", "u32"], ["viewport", "vec2f"], ["widthPx", "f32"], ["pixelNormal", "u32"]]
};
const structChoice = view(Inputs.select(Object.keys(wgslStructs), {label: "struct"}));
```

```js echo
(() => {
  const {rows, size} = wgslLayout(wgslStructs[structChoice]);
  return html`${Inputs.table(rows)}<p style="font:12px var(--sans-serif)">size: ${size} bytes = ${size / 4} floats</p>`;
})()
```

`Light` wastes 16 bytes: `direction` cannot start at 4, so it jumps to
16. Reordering so that each `vec3f` is followed by an `f32` fills the
gaps, and the struct shrinks from 48 to 32 bytes. In `Curve`, `viewport`
aligns to 8 and lands at 72, and the 88 bytes of fields round up to 96.

To fill the buffer, use one `ArrayBuffer` with two views and write each
field at its **float index**. A `u32` must go through the `Uint32Array`
view: through the `Float32Array` it would store float bits, which the
shader reads as a huge integer. A wrong offset raises no error; the shader
silently reads the wrong numbers.

```js echo
const curveData = new ArrayBuffer(96);
const curveF32 = new Float32Array(curveData), curveU32 = new Uint32Array(curveData);
function writeCurveUniform({controls, segments, viewport, widthPx, pixelNormal}) {
  curveF32.set(controls.flatMap((p) => [...toNDC(p), 0, 1]), 0);   // p: floats 0-15
  curveU32[16] = segments;                                         // byte 64, a u32
  curveF32.set(viewport, 18);                                      // byte 72 (68-71 are padding)
  curveF32[20] = widthPx;                                          // byte 80
  curveU32[21] = pixelNormal ? 1 : 0;                              // byte 84, a u32
  device.queue.writeBuffer(curveUniforms, 0, curveData);
}
```

### Thick curves

WebGPU lines are always **one pixel wide**. For a thick curve, the
`vs_thick` entry point above draws a **triangle strip** with two vertices
per sample, pushed apart along the normal ${tex`(-f'_y, f'_x)`}, with
`pass.draw(2 * (N + 1))`. Two details matter:

- The normal must be computed in **pixels**. Clip-space ${tex`x`} and
  ${tex`y`} have different scales on a non-square canvas, so a normal
  computed in clip space is not perpendicular on screen. This canvas is
  420 × 260; switch to clip space to see the stroke thin out and thicken.
- Where ${tex`\mathbf f' = \mathbf 0`} (drag ${tex`P_1`} onto
  ${tex`P_0`}), the normal is undefined, so the shader falls back to
  another direction.

```js echo
const thickForm = view(Inputs.form({
  width: Inputs.range([1, 40], {value: 14, step: 1, label: "width (pixels)"}),
  normal: Inputs.radio(["pixels", "clip space"], {value: "pixels", label: "compute the normal in"})
}));
```

```js echo
html`<div style="font:12px var(--sans-serif); opacity:.65; margin-bottom:4px">GPU: vertex shader, triangle-strip</div>${thickTarget.canvas}`
```

```js echo
{
  writeCurveUniform({controls: dcControls, segments: gpuSegments, viewport: [420, 260], widthPx: thickForm.width, pixelNormal: thickForm.normal === "pixels"});
  device.queue.writeBuffer(cpuCurveBuffer, 0, tessellateBezier(dcControls, gpuSegments));
  const encoder = device.createCommandEncoder();
  const beginPass = ({context}) => encoder.beginRenderPass({colorAttachments: [{view: context.getCurrentTexture().createView(), clearValue: {r: 0.05, g: 0.05, b: 0.08, a: 1}, loadOp: "clear", storeOp: "store"}]});
  let pass = beginPass(cpuTarget);
  pass.setPipeline(cpuLinePipeline);
  pass.setVertexBuffer(0, cpuCurveBuffer);
  pass.draw(gpuSegments + 1);
  pass.end();
  pass = beginPass(gpuLineTarget);
  pass.setPipeline(linePipeline);
  pass.setBindGroup(0, gpuLineTarget.bindGroup);
  pass.draw(gpuSegments + 1);                       // no vertex buffer: vertex_index is the sample number
  pass.end();
  pass = beginPass(thickTarget);
  pass.setPipeline(thickPipeline);
  pass.setBindGroup(0, thickTarget.bindGroup);
  pass.draw(2 * (gpuSegments + 1));
  pass.end();
  device.queue.submit([encoder.finish()]);
}
```

### Many curves in one draw call

Many curves can be drawn with **one** call and no vertex buffer. Put the
control points in a **storage buffer**, 4 per curve, and draw one
**instance** per curve: `@builtin(instance_index)` picks the curve, and
`vertex_index` picks the sample. Each instance starts a new strip, so the
end of one curve is never joined to the start of the next. A storage
buffer's `array<vec2f>` is packed tightly, 8 bytes apart, and its length
is not fixed in the shader (Module 07). Here each curve is a blade of
grass, and a time uniform sways the upper control points:

```js echo
const grassModule = device.createShaderModule({code: `
struct Field { samples : u32, time : f32 };
@group(0) @binding(0) var<storage, read> pts : array<vec2f>;   // 4 control points per curve
@group(0) @binding(1) var<uniform> field : Field;

struct VSOut { @builtin(position) pos : vec4f, @location(0) color : vec3f };

@vertex
fn vs_blade(@builtin(vertex_index) i : u32, @builtin(instance_index) blade : u32) -> VSOut {
  let p0 = pts[4u * blade];      let p1 = pts[4u * blade + 1u];
  var p2 = pts[4u * blade + 2u]; var p3 = pts[4u * blade + 3u];
  let sway = 0.04 * sin(2.0 * field.time + 0.9 * f32(blade));  // wind moves only the upper points
  p2.x += 0.5 * sway;
  p3.x += sway;
  let u = f32(i) / f32(field.samples);
  let a = 1.0 - u;
  var out : VSOut;
  out.pos = vec4f(a * a * a * p0 + 3.0 * a * a * u * p1 + 3.0 * a * u * u * p2 + u * u * u * p3, 0.0, 1.0);
  out.color = mix(vec3f(0.1, 0.35, 0.1), vec3f(0.55, 0.85, 0.3), u);   // darker at the root
  return out;
}

@fragment
fn fs_blade(@location(0) color : vec3f) -> @location(0) vec4f { return vec4f(color, 1.0); }`});

const grassPipeline = device.createRenderPipeline({
  layout: "auto",
  vertex: {module: grassModule, entryPoint: "vs_blade"},
  fragment: {module: grassModule, entryPoint: "fs_blade", targets: [{format: canvasFormat}]},
  primitive: {topology: "line-strip"}
});
const MAX_BLADES = 4000;
const bladeBuffer = device.createBuffer({size: MAX_BLADES * 4 * 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST});
{
  const rand = d3.randomLcg(7), data = new Float32Array(MAX_BLADES * 8);
  for (let k = 0; k < MAX_BLADES; k++) {
    const x = -0.98 + 1.96 * rand(), h = 0.4 + 1.1 * rand(), lean = (rand() - 0.5) * 0.5;
    data.set([x, -1, x + 0.02 * lean, -1 + h / 3, x + 0.5 * lean, -1 + (2 * h) / 3, x + lean, -1 + h], 8 * k);
  }
  device.queue.writeBuffer(bladeBuffer, 0, data);     // uploaded once
}
const fieldData = new ArrayBuffer(8), fieldU32 = new Uint32Array(fieldData), fieldF32 = new Float32Array(fieldData);
const fieldUniform = device.createBuffer({size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
const grassBindGroup = device.createBindGroup({layout: grassPipeline.getBindGroupLayout(0), entries: [
  {binding: 0, resource: {buffer: bladeBuffer}}, {binding: 1, resource: {buffer: fieldUniform}}]});
const grassTarget = makeCanvas(420, 260);
```

```js echo
const grassForm = view(Inputs.form({
  count: Inputs.range([1, MAX_BLADES], {value: 600, step: 1, label: "curves (instances)"}),
  samples: Inputs.range([1, 32], {value: 12, step: 1, label: "segments per curve"})
}));
```

```js echo
grassTarget.canvas
```

```js echo
{
  fieldU32[0] = grassForm.samples;
  fieldF32[1] = now / 1000;                          // `now` is Observable's clock, in milliseconds
  device.queue.writeBuffer(fieldUniform, 0, fieldData);
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({colorAttachments: [{view: grassTarget.context.getCurrentTexture().createView(), clearValue: {r: 0.55, g: 0.75, b: 0.95, a: 1}, loadOp: "clear", storeOp: "store"}]});
  pass.setPipeline(grassPipeline);
  pass.setBindGroup(0, grassBindGroup);
  pass.draw(grassForm.samples + 1, grassForm.count);   // one instance per curve
  pass.end();
  device.queue.submit([encoder.finish()]);
}
```

One draw call draws ${grassForm.count} curves of
${grassForm.samples + 1} vertices each. Every frame, only the 8-byte
`Field` uniform changes.

### Animating along a path at constant speed

To move an object along a curve, place it at ${tex`\mathbf f(u)`} and turn
it to face along ${tex`\mathbf f'(u)`}. For a path of ${tex`n`} segments,
a **path parameter** ${tex`u \in [0, n]`} picks segment
${tex`\lfloor u \rfloor`} at local parameter ${tex`u - \lfloor u \rfloor`}.
If ${tex`u`} changes with time ${tex`t`}, the chain rule gives the speed:

${tex.block`\left\lVert \frac{d\mathbf f}{dt} \right\rVert = \lVert \mathbf f'(u) \rVert\,\left|\frac{du}{dt}\right|`}

With a constant ${tex`du/dt`}, the speed follows ${tex`\lVert\mathbf f'(u)\rVert`},
which is not constant (see the speed plot in **The Bézier derivative**).
For constant speed, step the **arc length**
${tex`s(u) = \int_0^u \lVert\mathbf f'(v)\rVert\,dv`} instead and find the
${tex`u`} with that ${tex`s`}. For cubics there is no closed form, so build
a table from many short chords and invert it by binary search:

```js echo
function arcLengthTable(f, samples = 400) {
  const table = [{u: 0, s: 0}];
  let prev = f(0);
  for (let i = 1; i <= samples; i++) {
    const p = f(i / samples);
    table.push({u: i / samples, s: table.at(-1).s + Math.hypot(p.x - prev.x, p.y - prev.y)});
    prev = p;
  }
  return table;
}
function uAtDistance(table, s) {
  let lo = 0, hi = table.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (table[mid].s < s) lo = mid; else hi = mid; }
  const a = table[lo], b = table[hi];
  return a.u + (b.s > a.s ? (s - a.s) / (b.s - a.s) : 0) * (b.u - a.u);
}
const travelTable = arcLengthTable((u) => bernsteinPoint(dcControls, u));
```

```js echo
const travelFraction = (now / 4000) % 1;   // one loop every 4 seconds
```

```js echo
(() => {
  const scene = plane({domain: 3.6});
  const f = (u) => bernsteinPoint(dcControls, u);
  drawPath(scene, sampleCurve(f, 100), {stroke: "#bbb", width: 3});
  const total = travelTable.at(-1).s;
  for (let i = 0; i <= 16; i++) {
    drawPoint(scene, f(i / 16), {color: "orangered", r: 2.5});
    drawPoint(scene, f(uAtDistance(travelTable, total * i / 16)), {color: "steelblue", r: 2.5});
  }
  const u = uAtDistance(travelTable, total * travelFraction), heading = bezierDerivative(dcControls, u);
  if (vec2.length(heading) > 1e-9) drawArrow(scene, f(u), vec2.add(f(u), vec2.scale(vec2.normalize(heading), 0.7)), {color: "steelblue"});
  drawPoint(scene, f(travelFraction), {color: "orangered", r: 7, label: "equal u"});
  drawPoint(scene, f(u), {color: "steelblue", r: 7, label: "equal s"});
  return scene.svg.node();
})()
```

Orange markers are equal steps of ${tex`u`}; blue markers are equal steps
of distance. The two moving dots start and finish together, but only the
blue one moves at **constant speed**, and its arrow is the heading
${tex`\mathbf f'(u)`}. Make the control polygon uneven in the de
Casteljau figure to exaggerate the difference. More samples make the
table more accurate; rebuild it whenever the curve changes.

## Loading OBJ Models

### OBJ, MTL, and material groups

To move something along a path, we need a model. Module 08 covered the
OBJ and MTL formats and `components/obj.js`: `v`, `vt`, `vn`, and `f`
records with **1-based** indices, fan-triangulated polygons, and
materials whose `Kd`, `Ks`, and `Ns` map onto Blinn–Phong. Here is a
small signpost, written in centimeters and far from the origin. Its
`usemtl Wood` appears **twice**, because the file switches materials
partway through the post:

```js echo
const signOBJText = `mtllib sign.mtl
# post: x 240-250, y -20-180, z 90-100
v 240 -20 90
v 250 -20 90
v 250 180 90
v 240 180 90
v 240 -20 100
v 250 -20 100
v 250 180 100
v 240 180 100
# board: x 200-300, y 120-170, z 100-104
v 200 120 100
v 300 120 100
v 300 170 100
v 200 170 100
v 200 120 104
v 300 120 104
v 300 170 104
v 200 170 104
usemtl Wood
f 1 2 6 5
f 4 8 7 3
f 1 4 3 2
usemtl Paint
f 9 10 14 13
f 12 16 15 11
f 9 12 11 10
f 13 14 15 16
f 9 13 16 12
f 10 11 15 14
usemtl Wood
f 5 6 7 8
f 1 5 8 4
f 2 3 7 6
`;
const signMTLText = `newmtl Wood
Kd 0.55 0.35 0.18
Ks 0.05 0.05 0.05
Ns 8

newmtl Paint
Kd 0.1 0.45 0.8
Ks 0.6 0.6 0.6
Ns 120
`;
const signParsed = obj.parseOBJ(signOBJText);
const signMTL = obj.parseMTL(signMTLText);
```

In file order the triangles come in three **runs** of one material each.
Sorting them by material gives one group per material, each a
`{material, first, count}` range of the index buffer, drawn with
`drawIndexed(count, 1, first)` after binding that material:

```js echo
const signRuns = signParsed.faceMaterials.reduce((runs, material, i) => {
  if (runs.length && runs.at(-1).material === material) runs.at(-1).triangles++;
  else runs.push({material, "first triangle": i, triangles: 1});
  return runs;
}, []);
const signGroups = (() => {
  let first = 0;
  return [...obj.groupFacesByMaterial(signParsed)].map(([material, faces]) => {
    const group = {material, first, count: 3 * faces.length, Kd: signMTL[material].Kd.join(" ")};
    first += group.count;
    return group;
  });
})();
```

```js echo
html`<div style="display:flex; gap:24px; flex-wrap:wrap">
  <div><b>In file order</b>${Inputs.table(signRuns)}</div>
  <div><b>Grouped for drawing</b>${Inputs.table(signGroups)}</div>
</div>`
```

Two draw calls instead of three, and each material's bind group is set
only once. With transparent materials (`d < 1`), draw the opaque groups
first.

### Fitting a model to its bounding box

OBJ files come in any size, position, and units. The **axis-aligned
bounding box** of the positions tells us how to bring a model to a known
size and place. Here we center it in all three axes and scale its largest
extent to 2, so it fits in ${tex`[-1, 1]^3`}:

```js echo
function boundingBox(positions) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of positions) [p.x, p.y, p.z].forEach((v, c) => { min[c] = Math.min(min[c], v); max[c] = Math.max(max[c], v); });
  return {min, max};
}
function fitToUnitBox(positions, {min, max}) {
  const center = min.map((v, c) => (v + max[c]) / 2);
  const scale = 2 / Math.max(...max.map((v, c) => v - min[c]));   // the largest extent becomes 2
  return positions.map((p) => ({x: (p.x - center[0]) * scale, y: (p.y - center[1]) * scale, z: (p.z - center[2]) * scale}));
}
const signBox = boundingBox(signParsed.positions);
const signFitted = fitToUnitBox(signParsed.positions, signBox);
```

```js echo
(() => {
  // a side view (x, y) of every triangle's outline, in its material's Kd
  const sideView = (positions, domain) => Plot.plot({
    width: 300, height: 300, x: {domain}, y: {domain}, grid: true, color: {type: "identity"},
    marks: [
      Plot.line(signParsed.faces.flatMap((tri, k) => [...tri, tri[0]].map((c) => ({k, ...positions[c.p],
        color: `rgb(${signMTL[signParsed.faceMaterials[k]].Kd.map((v) => Math.round(255 * v)).join(",")})`}))),
        {x: "x", y: "y", z: "k", stroke: "color"}),
      Plot.dot([{x: 0, y: 0}], {x: "x", y: "y", fill: "crimson", r: 4})
    ]
  });
  return html`<div style="display:flex; gap:24px; flex-wrap:wrap">
    <div><b>As loaded</b>${sideView(signParsed.positions, [-20, 320])}</div>
    <div><b>Fitted</b>${sideView(signFitted, [-1.2, 1.2])}</div></div>
    <pre>min = (${signBox.min.join(", ")})   max = (${signBox.max.join(", ")})</pre>`;
})()
```

The red dot is the origin. As loaded, a model can be far from where the
camera looks and hundreds of times too big; after fitting, it is at the
origin and its size is known, so a model matrix can place it. Other fits
are common, such as centering only ${tex`x`} and ${tex`z`} and moving the
lowest point to ${tex`y = 0`} so the model stands on the ground. Check
which axis the file uses as **up** and which as **forward**: files
disagree.

## Check Your Understanding

1. Why is a parametric curve easier to draw than an implicit one?
2. Are the weights ${tex`(0.5,\ 0.7,\ -0.2)`} an affine combination? A convex one?
3. A point has barycentric coordinates ${tex`(-0.1,\ 0.6,\ 0.5)`}. Is it inside the triangle? Which edge is it beyond?
4. What does de Casteljau's algorithm give you besides the point ${tex`\mathbf f(u)`}?
5. A cubic Bézier has ${tex`\mathbf p_0 = (0, 0)`} and ${tex`\mathbf p_1 = (1, 2)`}. What is ${tex`\mathbf f'(0)`}?
6. Write the constraint rows for ${tex`f(0.5)`} and ${tex`f'(0.5)`} of a cubic.
7. Two Bézier segments meet with ${tex`P_2 = (1, 1)`}, ${tex`P_3 = (2, 1)`}. Where must ${tex`Q_1`} be for ${tex`C^1`}? Give one ${tex`G^1`}-but-not-${tex`C^1`} position.
8. Which property in "two of three" does each of the natural cubic, Catmull–Rom, and cubic B-spline give up?
9. Why does a cardinal spline not interpolate its first and last points? How do you fix that?
10. How many control points affect a cubic B-spline segment?
11. Lay out `struct S { a : f32, b : vec3f, c : vec2f }`: give each field's byte offset and the struct's size.
12. Why does the grass draw one instance per blade instead of one long line strip through all the blades?

<details>
<summary>Answers</summary>

1. You step the parameter and get points directly. An implicit curve only tests points, so you must search for them.
2. Affine: yes, they sum to 1. Convex: no, one weight is negative.
3. No: ${tex`\alpha < 0`}, so it is beyond the edge ${tex`\mathbf{bc}`}, opposite ${tex`\mathbf a`}.
4. The control points of the two halves of the curve, split at ${tex`u`}.
5. ${tex`3(\mathbf p_1 - \mathbf p_0) = (3, 6)`}.
6. ${tex`[1,\ 0.5,\ 0.25,\ 0.125]`} and ${tex`[0,\ 1,\ 1,\ 0.75]`} (from `constraintRow(3, 0.5)` and `constraintRow(3, 0.5, 1)`).
7. ${tex`Q_1 = (3, 1)`}. Any ${tex`(x, 1)`} with ${tex`x > 2`}, ${tex`x \ne 3`}, such as ${tex`(2.5, 1)`}, is ${tex`G^1`} only.
8. Natural: locality. Catmull–Rom: ${tex`C^2`} (it is ${tex`C^1`}). B-spline: interpolation.
9. Each segment runs between its middle two points, and the end points only set slopes. Repeat the first and last points (or wrap the indices on a closed curve).
10. Four: segment ${tex`i`} uses ${tex`\mathbf p_i \ldots \mathbf p_{i+3}`}.
11. `a` at 0, `b` at 16 (it aligns to 16), `c` at 32 (28 rounds up to a multiple of 8). The fields end at 40, which rounds up to 48. Check with `wgslLayout`.
12. A line strip connects consecutive vertices, so one long strip would draw a line from the tip of each blade to the root of the next. Each instance starts a new strip.

</details>

## Common Pitfalls

- **Treating ${tex`u`} as distance.** Equal steps in ${tex`u`} are not
  equal distances; use an arc-length table for constant speed.
- **Weights that do not sum to 1.** The result then depends on where the
  origin is.
- **Assuming control points lie on the curve.** Only the ends of a
  Bézier curve do, and B-spline points usually do not.
- **Confusing ${tex`G^1`} with ${tex`C^1`}.** Matching directions is not
  matching speeds.
- **Using one high-degree polynomial** instead of a spline: it overshoots
  and every point affects everything.
- **Misaligned uniforms.** A `vec3f` aligns to 16, uniform arrays need a
  16-byte stride, and a `u32` must be written through a `Uint32Array`.
  Mistakes raise no error.
- **Expecting thick WebGPU lines.** Line primitives are one pixel wide;
  build a triangle strip, with the normal computed in pixels and a
  fallback where ${tex`\mathbf f' = \mathbf 0`}.
- **Using an OBJ model as loaded.** Fit it to its bounding box, and check
  which axes are up and forward.

## Summary

- **Representations:** explicit (one ${tex`y`} per ${tex`x`}), implicit
  (a test), and parametric (a generator). The derivative of a parametric
  curve is its velocity and tangent.
- **Linear interpolation:** ${tex`(1-u)\,\mathbf p_0 + u\,\mathbf p_1`}.
  Weights that sum to 1 give affine combinations, and nonnegative ones
  give convex combinations, which stay in the convex hull. Barycentric
  coordinates do the same for a triangle.
- **Bézier curves:** repeated lerps (de Casteljau) expand to Bernstein
  polynomials. They interpolate their end points, have end derivatives
  along the first and last legs, stay in the convex hull, are affine
  invariant, and split by subdivision.
- **Polynomial pieces:** ${tex`\mathbf f(u) = \mathbf u B \mathbf p`}, with
  ${tex`B = C^{-1}`} from linear constraints. ${tex`C^n`} continuity
  matches derivatives, and ${tex`G^n`} matches direction and curvature.
- **Splines:** natural (${tex`C^2`}, not local, ill-conditioned), Hermite
  and cardinal/Catmull–Rom (local, ${tex`C^1`}, tension ${tex`\tau`}), and
  uniform cubic B-splines (local, ${tex`C^2`}, not interpolating).
- **Drawing in WebGPU:** tessellate on the CPU, or evaluate in the vertex
  shader from control points in a uniform or storage buffer, with one
  instance per curve. Lay out uniforms by WGSL's alignment rules, and
  draw thick curves as triangle strips with pixel-space normals.
- **Moving along a curve:** step the arc length with a table, not
  ${tex`u`}, and face along ${tex`\mathbf f'(u)`}.
- **OBJ and MTL:** group triangles by material for drawing, and fit the
  model to its bounding box.
