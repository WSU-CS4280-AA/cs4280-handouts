---
title: Module 09 — Curves
toc: true
---

```js echo
import * as d3 from "npm:d3";
import * as vec2 from "./components/vec2.js";
import * as mat2 from "./components/mat2.js";
import * as webgpu from "./components/webgpu.js";
import {plane, drawPoint, dragPoints} from "./components/vectorField.js";
import * as Inputs from "npm:@observablehq/inputs";
import {html} from "npm:htl";
```

# Module 09 · Curves

A **free-form curve** can take almost any shape, so we need a compact way
to specify it. This module builds curves from **polynomial pieces**:
first the general machinery (constraint and basis matrices), then
interpolating splines (natural, Hermite, cardinal), and finally
approximating curves (Bézier, B-splines, NURBS). Every formula becomes a
function you can call, and most figures have control points you can
drag. The last section evaluates and draws curves on the GPU and needs
**Chrome or Edge 113+**. This handout teaches the *techniques*; it is not
a walkthrough of any graded assignment.

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

### Implicit, parametric, and reparameterized

The unit circle is ${tex`f(x,y) = x^2 + y^2 - 1 = 0`} (implicit: a
**test**) or ${tex`(\cos t, \sin t)`} (parametric: a **generator**).
Drawing a parametric curve just means stepping the parameter. A curve
has infinitely many parameterizations, and they put the pen at different
places at the same parameter value. Below, the same segment is traced by
${tex`(u,u)`}, ${tex`(u^2,u^2)`}, and ${tex`(u^5,u^5)`} at 11 equal steps
of ${tex`u`}:

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
Parameter space is not distance along the curve. An **arc-length
parameterization** fixes that; we build one at the end of the module.

## Polynomial Pieces

### Constraint and basis matrices

A cubic piece is ${tex`\mathbf f(u) = \mathbf u\cdot\mathbf a`} with
${tex`\mathbf u = [1\ u\ u^2\ u^3]`}. Each **constraint** (a position or a
derivative at some ${tex`u`}) is a linear equation in the coefficients
${tex`\mathbf a`}, so the control values satisfy ${tex`\mathbf p = C\mathbf a`}.
The **basis matrix** is ${tex`B = C^{-1}`}, and ${tex`\mathbf f(u) = \mathbf u B \mathbf p`}.
The code below builds ${tex`C`} from a list of constraints and inverts it:

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

The reading's examples come straight out of it:

| Curve | Constraints | ${tex`B = C^{-1}`} |
|---|---|---|
| line | ${tex`f(0), f(1)`} | ${showMatrix(basisMatrix(1, [{u: 0}, {u: 1}]))} |
| quadratic | ${tex`f(0), f(0.5), f(1)`} | ${showMatrix(basisMatrix(2, [{u: 0}, {u: 0.5}, {u: 1}]))} |
| quadratic | ${tex`f(0.5), f'(0.5), f''(0.5)`} | ${showMatrix(basisMatrix(2, [{u: 0.5}, {u: 0.5, k: 1}, {u: 0.5, k: 2}]))} |
| Hermite cubic | ${tex`f(0), f'(0), f(1), f'(1)`} | ${showMatrix(basisMatrix(3, [{u: 0}, {u: 0, k: 1}, {u: 1}, {u: 1, k: 1}]))} |
| natural cubic | ${tex`f(0), f'(0), f''(0), f(1)`} | ${showMatrix(basisMatrix(3, [{u: 0}, {u: 0, k: 1}, {u: 0, k: 2}, {u: 1}]))} |

### Blending functions

The **blending functions** are ${tex`\mathbf b(u) = \mathbf u B`}, and
the curve is ${tex`\mathbf f(u) = \sum_i b_i(u)\,\mathbf p_i`}: at any
${tex`u`}, a weighted average of the control values. Pick a basis to see
its blending functions:

```js echo
// Bézier: p0 = f(0), p1 = f(0) + f'(0)/3, p2 = f(1) - f'(1)/3, p3 = f(1). Each is a row of C acting on a.
const bezierRows = [
  constraintRow(3, 0),
  constraintRow(3, 0).map((v, i) => v + constraintRow(3, 0, 1)[i] / 3),
  constraintRow(3, 1).map((v, i) => v - constraintRow(3, 1, 1)[i] / 3),
  constraintRow(3, 1)
];
const blendBases = {
  "Hermite": basisMatrix(3, [{u: 0}, {u: 0, k: 1}, {u: 1}, {u: 1, k: 1}]),
  "Bézier": invert(bezierRows),
  "uniform cubic B-spline": [[1, 4, 1, 0], [-3, 0, 3, 0], [3, -6, 3, 0], [-1, 3, -3, 1]].map((r) => r.map((v) => v / 6)),
  "cubic through 4 equally spaced points": basisMatrix(3, [{u: 0}, {u: 1 / 3}, {u: 2 / 3}, {u: 1}])
};
const blendChoice = view(Inputs.select(Object.keys(blendBases), {value: "Bézier", label: "basis"}));
```

```js echo
(() => {
  const B = blendBases[blendChoice];
  const rows = d3.range(0, 1.0001, 0.01).flatMap((u) => {
    const uv = [1, u, u * u, u * u * u];
    return d3.range(4).map((i) => ({u, i: `b${i}`, b: d3.sum(uv, (x, r) => x * B[r][i])}));
  });
  return html`${Plot.plot({height: 220, x: {label: "u"}, y: {label: "bᵢ(u)"}, color: {legend: true},
    marks: [Plot.ruleY([0]), Plot.line(rows, {x: "u", y: "b", stroke: "i"})]})}
    <p>${showMatrix(B)}</p>`;
})()
```

The Bézier and B-spline blending functions are nonnegative and sum to 1,
so their curves are true weighted averages that stay inside the convex
hull. The Hermite functions do not sum to 1, because two of its control
values are derivatives, not points.

### Interpolating polynomials

A degree-${tex`n`} polynomial can pass through ${tex`n+1`} points, using
the **Lagrange** blending functions
${tex`b_i(t) = \prod_{j\ne i}(t - t_j)/(t_i - t_j)`}. Compare it with a
Catmull–Rom spline (built later in this module) through the same points:

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
and dragging any single point changes it **everywhere**. The blue
Catmull–Rom spline stays near the points, and dragging one point changes
only the nearby part. This is why graphics uses low-degree splines.

## Splines from Cubic Pieces

### Knots and locality

Two chains of line segments can represent the same shapes but behave
differently when edited. The first uses **shared endpoints**. The second
stores each segment as a start point and a **midpoint**, and gets its end
point by **dependency**: ${tex`\text{end} = 2\,\text{mid} - \text{start}`},
where each segment starts where the last one ended:

```js echo
const localityWidget = dragPoints({"p₀": {x: -3.4, y: -1}}, {width: 420, height: 260, domain: 3.8, colors: ["orangered"]});
const localityP0 = view(localityWidget);
```

```js echo
localityWidget.redecorate((scene) => {
  const ends = [{x: -3.4, y: -1}, {x: -2, y: 0.4}, {x: -0.6, y: -0.8}, {x: 0.8, y: 0.5}, {x: 2.2, y: -0.6}, {x: 3.5, y: 0.6}];
  const mids = d3.range(5).map((i) => ({x: (ends[i].x + ends[i + 1].x) / 2, y: (ends[i].y + ends[i + 1].y) / 2}));
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
it. That is a lack of **local control**.

### Cubics: pick three of four

No piecewise representation is (1) cubic, (2) interpolating, (3) local,
and (4) ${tex`C^2`} at once:

| Spline | Interpolating | Local | ${tex`C^2`} |
|---|---|---|---|
| natural cubic | yes | **no** | yes |
| Hermite, cardinal / Catmull–Rom | yes | yes | **no** (${tex`C^1`}) |
| cubic B-spline | **no** | yes | yes |

**Natural cubics** pass each segment's end position, slope, and
curvature to the next segment. They are interpolating and ${tex`C^2`},
but every segment depends on all the ones before it, and they are
**ill-conditioned**. Nudge the starting curvature slightly and watch the
error grow down the chain:

```js echo
const naturalB = basisMatrix(3, [{u: 0}, {u: 0, k: 1}, {u: 0, k: 2}, {u: 1}]);
function naturalChain(points, d0, dd0) {
  const segments = [];
  let start = points[0], d = d0, dd = dd0;
  for (let i = 1; i < points.length; i++) {
    const p = [start, d, dd, points[i]];
    const a = naturalB.map((row) => ({x: d3.sum(row, (b, k) => b * p[k].x), y: d3.sum(row, (b, k) => b * p[k].y)}));
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

### Hermite and cardinal splines

A **cardinal** segment interpolates its middle two points and takes its
end slopes from the neighbors: ${tex`\mathbf f'(0) = s(\mathbf p_3 - \mathbf p_1)`},
${tex`\mathbf f'(1) = s(\mathbf p_4 - \mathbf p_2)`} with
${tex`s = (1-t)/2`}. That is a Hermite segment with computed slopes.
Tension ${tex`t = 0`} gives the **Catmull–Rom** spline:

```js echo
const hermiteB = basisMatrix(3, [{u: 0}, {u: 0, k: 1}, {u: 1}, {u: 1, k: 1}]);
function hermitePoint([p0, d0, p1, d1], u) {
  const uv = [1, u, u * u, u * u * u];
  const w = [0, 1, 2, 3].map((i) => d3.sum(uv, (x, r) => x * hermiteB[r][i]));   // blending functions u B
  return {x: w[0] * p0.x + w[1] * d0.x + w[2] * p1.x + w[3] * d1.x, y: w[0] * p0.y + w[1] * d0.y + w[2] * p1.y + w[3] * d1.y};
}
function cardinalPoint([p1, p2, p3, p4], u, tension) {
  const s = (1 - tension) / 2;
  return hermitePoint([p2, {x: s * (p3.x - p1.x), y: s * (p3.y - p1.y)}, p3, {x: s * (p4.x - p2.x), y: s * (p4.y - p2.y)}], u);
}
```

```js echo
const cardinalWidget = dragPoints({
  "1": {x: -3.4, y: -1.2}, "2": {x: -2.3, y: 0.9}, "3": {x: -0.6, y: 1.5}, "4": {x: 0.1, y: -0.9},
  "5": {x: 1.5, y: -1.1}, "6": {x: 2.3, y: 1.2}, "7": {x: 3.4, y: 0.5}
}, {width: 420, height: 300, domain: 3.8});
const cardinalPts = view(cardinalWidget);
const cardinalTension = view(Inputs.range([-0.5, 0.95], {value: 0, step: 0.05, label: "tension t (0 = Catmull–Rom)"}));
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
not interpolated; they only set the end slopes. Dragging a point changes
at most four segments.

## Approximating Curves

### Bézier curves and de Casteljau's algorithm

A Bézier curve interpolates its first and last control points, with end
derivatives ${tex`3(\mathbf p_1 - \mathbf p_0)`} and
${tex`3(\mathbf p_3 - \mathbf p_2)`}. Its blending functions are the
**Bernstein polynomials**
${tex`b_{k,n}(u) = \binom{n}{k}u^k(1-u)^{n-k}`}. **De Casteljau's
algorithm** computes the same point by repeated linear interpolation:

```js echo
function bernsteinPoint(points, t) {
  const n = points.length - 1;
  let x = 0, y = 0, binom = 1;
  points.forEach((p, k) => {
    const b = binom * t ** k * (1 - t) ** (n - k);
    x += b * p.x; y += b * p.y;
    binom = (binom * (n - k)) / (k + 1);
  });
  return {x, y};
}
function deCasteljauLevels(points, t) {
  const levels = [points];
  while (levels.at(-1).length > 1) {
    const prev = levels.at(-1);
    levels.push(prev.slice(1).map((q, i) => ({x: (1 - t) * prev[i].x + t * q.x, y: (1 - t) * prev[i].y + t * q.y})));
  }
  return levels;
}
```

```js echo
const dcWidget = dragPoints({P0: {x: -2.8, y: -1}, P1: {x: -1.2, y: 2.2}, P2: {x: 1.2, y: 2.2}, P3: {x: 2.8, y: -1}}, {domain: 3.6});
const dcByLabel = view(dcWidget);
const dcT = view(Inputs.range([0, 1], {value: 0.5, step: 0.01, label: "t"}));
```

```js echo
const dcControls = Object.values(dcByLabel);   // read in its own cell so it updates while dragging
```

```js echo
dcWidget.redecorate((scene) => {
  drawPath(scene, dcControls, {stroke: "gray", width: 1, dash: "4,3"});
  const levels = deCasteljauLevels(dcControls, dcT);
  // The intermediate points split the curve into two Bézier halves:
  const left = levels.map((l) => l[0]), right = levels.map((l) => l.at(-1)).reverse();
  drawPath(scene, sampleCurve((u) => bernsteinPoint(left, u), 50), {stroke: "steelblue", width: 3});
  drawPath(scene, sampleCurve((u) => bernsteinPoint(right, u), 50), {stroke: "orangered", width: 3});
  const palette = ["#e07b39", "seagreen", "purple"];
  levels.slice(1, -1).forEach((level, k) => {
    drawPath(scene, level, {stroke: palette[k], width: 1.5});
    level.forEach((p) => drawPoint(scene, p, {color: palette[k], r: 3}));
  });
  drawPoint(scene, levels.at(-1)[0], {color: "crimson", r: 6, label: "B(t)"});
})
```

```js echo
html`<pre>de Casteljau  B(${dcT.toFixed(2)}) = (${deCasteljauLevels(dcControls, dcT).at(-1)[0].x.toFixed(6)}, ${deCasteljauLevels(dcControls, dcT).at(-1)[0].y.toFixed(6)})
Bernstein     B(${dcT.toFixed(2)}) = (${bernsteinPoint(dcControls, dcT).x.toFixed(6)}, ${bernsteinPoint(dcControls, dcT).y.toFixed(6)})</pre>`
```

The construction also **subdivides** the curve. The first point of each
level, from ${tex`P_0`} down to ${tex`B(t)`}, gives the control points of
the blue half, and the last point of each level, from ${tex`B(t)`} to
${tex`P_3`}, gives the control points of the red half.
Every step is a convex combination, so the algorithm is numerically
stable.

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

- **Convex hull:** the curve stays inside the shaded hull of its control points.
- **Affine invariance:** transforming the control points gives the same curve as transforming the curve (the thin red curve lies on the thick gray one).
- **Variation diminishing:** no line crosses the curve more often than it crosses the control polygon.

### Joining Bézier segments

Two cubic segments share the point ${tex`P_3 = Q_0`}. For ${tex`G^1`},
${tex`P_2`}, ${tex`P_3`}, and ${tex`Q_1`} must be **collinear**. For
${tex`C^1`}, they must also be **equally spaced**:

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

${tex`C^0`} leaves a corner. ${tex`G^1`} makes the angle 0° but the
**speed** can still jump (ratio ≠ 1). ${tex`C^1`} matches the whole
derivative vector.

### Corner cutting

Cutting the corners of a control polygon over and over approaches a
smooth curve. Each cut splits every leg at its midpoint and moves the
corner to the midpoint of the new segment. For three points, the limit is
the **quadratic Bézier curve**:

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
      const a = vec2.lerp(poly[i - 1], poly[i], 0.5), b = vec2.lerp(poly[i], poly[i + 1], 0.5);
      add(a); add(vec2.lerp(a, b, 0.5)); add(b);
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

### Adaptive flattening

To draw a Bézier curve, split it with de Casteljau until each piece's
control points are nearly collinear. The convex hull guarantees that a
line segment is then close to the piece:

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
  return html`${scene.svg.node()}<p style="font:12px var(--sans-serif)">${pts.length - 1} line segments (uses the control points dragged in the de Casteljau figure)</p>`;
})()
```

Segments concentrate where the curve bends sharply, and straight stretches
use few. Choosing the tolerance in **pixels** makes zooming in produce
more segments automatically.

### B-splines and the Cox–de Boor recurrence

A B-spline curve is ${tex`\mathbf f(t) = \sum_i \mathbf p_i\, b_{i,k}(t)`}
with order ${tex`k`} (degree ${tex`k-1`}). The basis functions come from a
**knot vector** through the **Cox–de Boor recurrence**:

${tex.block`b_{i,1}(t) = \begin{cases}1 & t_i \le t < t_{i+1}\\ 0 & \text{otherwise}\end{cases},\qquad b_{i,k}(t) = \frac{t - t_i}{t_{i+k-1} - t_i}\,b_{i,k-1}(t) + \frac{t_{i+k} - t}{t_{i+k} - t_{i+1}}\,b_{i+1,k-1}(t)`}

```js echo
function coxDeBoor(i, k, knots, t) {
  if (k === 1) {
    const last = t === knots.at(-1) && knots[i] < knots[i + 1] && knots[i + 1] === knots.at(-1);
    return (knots[i] <= t && t < knots[i + 1]) || last ? 1 : 0;
  }
  const d1 = knots[i + k - 1] - knots[i], d2 = knots[i + k] - knots[i + 1];
  return (d1 > 0 ? ((t - knots[i]) / d1) * coxDeBoor(i, k - 1, knots, t) : 0)
       + (d2 > 0 ? ((knots[i + k] - t) / d2) * coxDeBoor(i + 1, k - 1, knots, t) : 0);
}
const makeKnots = (n, k, kind) => kind === "uniform"
  ? d3.range(n + k)
  : [...Array(k).fill(0), ...d3.range(1, n - k + 1), ...Array(k).fill(n - k + 1)];   // repeat the end knots k times
```

```js echo
const bsForm = view(Inputs.form({
  k: Inputs.range([2, 6], {value: 4, step: 1, label: "order k (degree k − 1)"}),
  knots: Inputs.radio(["uniform", "end knots repeated"], {value: "uniform", label: "knot vector"})
}));
```

```js echo
const bsWidget = dragPoints({
  P0: {x: -3.2, y: -1}, P1: {x: -2.2, y: 1.6}, P2: {x: -0.6, y: -1.4}, P3: {x: 0.6, y: 1.8}, P4: {x: 2.2, y: -1}, P5: {x: 3.2, y: 1.2}
}, {domain: 3.8});
const bsPts = view(bsWidget);
```

```js echo
const bsKnots = makeKnots(6, bsForm.k, bsForm.knots === "uniform" ? "uniform" : "clamped");
const bsRange = [bsKnots[bsForm.k - 1], bsKnots[6]];        // where k basis functions overlap and sum to 1
function bsplinePoint(points, k, knots, t) {
  let x = 0, y = 0;
  points.forEach((p, i) => { const b = coxDeBoor(i, k, knots, t); x += b * p.x; y += b * p.y; });
  return {x, y};
}
```

```js echo
bsWidget.redecorate((scene) => {
  const pts = Object.values(bsPts);
  drawPath(scene, pts, {stroke: "gray", width: 1, dash: "3,2"});
  drawPath(scene, sampleCurve((t) => bsplinePoint(pts, bsForm.k, bsKnots, Math.min(t, bsRange[1] - 1e-9)), 200, ...bsRange), {stroke: "seagreen", width: 2.5});
})
```

```js echo
(() => {
  const rows = d3.range(6).flatMap((i) => d3.range(bsKnots[0], bsKnots.at(-1) + 1e-9, (bsKnots.at(-1) - bsKnots[0]) / 300)
    .map((t) => ({t, b: coxDeBoor(i, bsForm.k, bsKnots, t), i: `b${i}`})));
  return Plot.plot({height: 200, x: {label: "t"}, y: {label: "b_{i,k}(t)"}, color: {legend: true},
    marks: [Plot.rectX([bsRange], {x1: (d) => d[0], x2: (d) => d[1], y1: 0, y2: 1.05, fill: "orange", fillOpacity: 0.12}),
      Plot.ruleX(bsKnots, {strokeOpacity: 0.3}), Plot.line(rows, {x: "t", y: "b", stroke: "i"})]});
})()
```

Knots: [${bsKnots.join(", ")}]. The shaded band is where ${tex`k`}
basis functions overlap and **sum to 1**; the curve is drawn only there.
Things to see:

- **Local control:** dragging one point moves only the part of the curve
  where its basis function is nonzero, which spans ${tex`k`} knot intervals.
- **Order:** raising ${tex`k`} makes the curve smoother (${tex`C^{k-2}`})
  but pulls it further from the points. ${tex`k = 2`} is the control
  polygon itself.
- **Repeated end knots** make the curve **interpolate** its first and last
  points, like a Bézier curve, while staying smooth inside. With
  ${tex`k = 4`} and 4 points, it would be exactly a cubic Bézier.

### NURBS: exact conics

**NURBS** give each control point a weight ${tex`h_i`}:
${tex`\mathbf f = \sum h_i\mathbf p_i b_i / \sum h_i b_i`}. With 3 control
points, end knots repeated, and the middle weight
${tex`1/\sqrt2`}, the curve is an **exact** quarter circle:

```js echo
const nurbsWeight = view(Inputs.range([0.2, 2], {value: 1 / Math.sqrt(2), step: 0.001, label: "middle weight h₁"}));
```

```js echo
(() => {
  const P = [{x: 1, y: 0}, {x: 1, y: 1}, {x: 0, y: 1}], h = [1, nurbsWeight, 1], knots = [0, 0, 0, 1, 1, 1];
  const f = (t) => {
    let x = 0, y = 0, w = 0;
    P.forEach((p, i) => { const b = coxDeBoor(i, 3, knots, t) * h[i]; x += b * p.x; y += b * p.y; w += b; });
    return {x: x / w, y: y / w};
  };
  const pts = sampleCurve(f, 200);
  const deviation = d3.max(pts, (p) => Math.abs(Math.hypot(p.x, p.y) - 1));
  const scene = plane({domain: 1.6, width: 320, height: 320});
  drawPath(scene, sampleCurve((a) => ({x: Math.cos(a), y: Math.sin(a)}), 64, 0, Math.PI / 2), {stroke: "gray", dash: "3,2"});
  drawPath(scene, pts, {stroke: "crimson", width: 2.5});
  P.forEach((p, i) => drawPoint(scene, p, {color: "gray", r: 3, label: `h${i}`}));
  return html`${scene.svg.node()}<p style="font:12px var(--sans-serif)">weights h = [${h.map((w) => w.toFixed(3)).join(", ")}]; largest distance from the unit circle: ${deviation.toExponential(2)}</p>`;
})()
```

At ${tex`h_1 = 1/\sqrt2 \approx 0.707`} the error is round-off: the
curve **is** a circle. No polynomial curve can do that.

## Curves in WebGPU

The GPU draws only points, lines, and triangles, so every curve is
**tessellated**. Here the vertex shader evaluates the cubic Bézier
itself: we upload only the four control points (from the de Casteljau
figure above), and `vertex_index` becomes the parameter ${tex`u`}.

```js echo
const {adapter, device} = await webgpu.requestDevice();
const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
const deviceErrorLog = document.createElement("pre");
deviceErrorLog.style.cssText = "display: none; color: #e5484d; background: #2a1214; border: 1px solid #e5484d; border-radius: 6px; padding: 8px 12px; font-size: 12px; white-space: pre-wrap;";
device.addEventListener("uncapturederror", (e) => { deviceErrorLog.textContent += `WebGPU error: ${e.error.message}\n`; deviceErrorLog.style.display = "block"; });
```

```js echo
deviceErrorLog
```

```js echo
const curveModule = device.createShaderModule({code: `
struct Curve { p: array<vec4<f32>, 4>, params: vec4<f32> };   // params: segments, half width (NDC)
@group(0) @binding(0) var<uniform> curve: Curve;

fn bezier(u: f32) -> vec2<f32> {
  let a = 1.0 - u;
  return (a * a * a * curve.p[0] + 3.0 * a * a * u * curve.p[1]
        + 3.0 * a * u * u * curve.p[2] + u * u * u * curve.p[3]).xy;      // Bernstein form
}
fn bezierTangent(u: f32) -> vec2<f32> {
  let a = 1.0 - u;
  return (3.0 * (a * a * (curve.p[1] - curve.p[0]) + 2.0 * a * u * (curve.p[2] - curve.p[1])
        + u * u * (curve.p[3] - curve.p[2]))).xy;                         // f'(u)
}

@vertex
fn vs_line(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  return vec4<f32>(bezier(f32(i) / curve.params.x), 0.0, 1.0);
}

@vertex
fn vs_thick(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  let u = f32(i / 2u) / curve.params.x;                    // two vertices per sample
  let side = select(-1.0, 1.0, (i & 1u) == 1u);
  let d = bezierTangent(u);
  let n = normalize(vec2<f32>(-d.y, d.x));                 // perpendicular to the tangent
  return vec4<f32>(bezier(u) + side * curve.params.y * n, 0.0, 1.0);
}

@fragment
fn fs_main() -> @location(0) vec4<f32> { return vec4<f32>(0.95, 0.55, 0.2, 1.0); }`});
const makeCurvePipeline = (entryPoint, topology) => device.createRenderPipeline({
  layout: "auto",
  vertex: {module: curveModule, entryPoint},
  fragment: {module: curveModule, entryPoint: "fs_main", targets: [{format: canvasFormat}]},
  primitive: {topology}
});
const linePipeline = makeCurvePipeline("vs_line", "line-strip");
const thickPipeline = makeCurvePipeline("vs_thick", "triangle-strip");
const curveUniforms = device.createBuffer({size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
const curveTargets = [linePipeline, thickPipeline].map((pipeline) => {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 300;
  canvas.style.borderRadius = "8px";
  const {context} = webgpu.configureCanvas(canvas, device);
  return {canvas, context, pipeline, bindGroup: device.createBindGroup({layout: pipeline.getBindGroupLayout(0), entries: [{binding: 0, resource: {buffer: curveUniforms}}]})};
});
```

```js echo
const gpuCurveForm = view(Inputs.form({
  segments: Inputs.range([2, 128], {value: 24, step: 1, label: "segments N"}),
  width: Inputs.range([1, 30], {value: 10, step: 1, label: "thickness (pixels)"})
}));
```

```js echo
{
  const toNDC = (p) => [p.x / 3.6, p.y / 3.6, 0, 1];          // the drag widget spans [-3.6, 3.6]
  device.queue.writeBuffer(curveUniforms, 0, new Float32Array([...dcControls.flatMap(toNDC), gpuCurveForm.segments, gpuCurveForm.width / 300, 0, 0]));
  const encoder = device.createCommandEncoder();
  curveTargets.forEach(({context, pipeline, bindGroup}, k) => {
    const pass = encoder.beginRenderPass({colorAttachments: [{view: context.getCurrentTexture().createView(), clearValue: {r: 0.05, g: 0.05, b: 0.08, a: 1}, loadOp: "clear", storeOp: "store"}]});
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(k === 0 ? gpuCurveForm.segments + 1 : 2 * (gpuCurveForm.segments + 1));   // no vertex buffer at all
    pass.end();
  });
  device.queue.submit([encoder.finish()]);
}
```

```js echo
(() => {
  const row = document.createElement("div");
  row.style.cssText = "display:flex; gap:16px; flex-wrap:wrap";
  for (const [label, {canvas}] of [["line-strip (always 1 pixel wide)", curveTargets[0]], ["triangle-strip, offset along the normal", curveTargets[1]]]) {
    const cell = document.createElement("div");
    cell.innerHTML = `<div style="font:12px var(--sans-serif); opacity:.65; margin-bottom:4px">${label}</div>`;
    cell.append(canvas);
    row.append(cell);
  }
  return row;
})()
```

Drag the control points in the de Casteljau figure and both canvases
follow: only 80 bytes of uniforms change. WebGPU lines are always one
pixel wide, so a thick curve is a **triangle strip** with two vertices
per sample, pushed apart along the normal ${tex`(-f'_y, f'_x)`}. Lower
${tex`N`} to see the tessellation.

### Animating along a path at constant speed

Equal steps in ${tex`u`} are not equal distances. Build an **arc-length
table** from many samples, then invert it by binary search to find the
${tex`u`} for a desired distance ${tex`s`}:

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
const travelFraction = (now / 4000) % 1;   // `now` is Observable's clock: one loop every 4 seconds
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
  drawPoint(scene, f(travelFraction), {color: "orangered", r: 7, label: "equal u"});
  drawPoint(scene, f(uAtDistance(travelTable, total * travelFraction)), {color: "steelblue", r: 7, label: "equal s"});
  return scene.svg.node();
})()
```

Orange markers are equal steps of ${tex`u`}; blue markers are equal steps
of distance. The two moving dots start and finish together, but only the
blue one moves at **constant speed**. Make the control polygon uneven in
the de Casteljau figure to exaggerate the difference.

## Check Your Understanding

1. Why is a parametric curve easier to draw than an implicit one?
2. Write the constraint rows for ${tex`f(0.5)`} and ${tex`f'(0.5)`} of a cubic.
3. Which property in "pick three of four" does each of the natural cubic, Catmull–Rom, and cubic B-spline give up?
4. Why does a cardinal spline not interpolate its first and last points? How do you fix that?
5. Two Bézier segments meet with ${tex`P_2 = (1, 1)`}, ${tex`P_3 = (2, 1)`}. Where must ${tex`Q_1`} be for ${tex`C^1`}? Give one ${tex`G^1`}-but-not-${tex`C^1`} position.
6. What does de Casteljau's algorithm give you besides the point ${tex`B(t)`}?
7. How many control points affect a cubic B-spline at a given ${tex`t`}?
8. What do repeated end knots do to a B-spline curve?
9. Why can no polynomial curve be an exact circle, while a NURBS curve can?

<details>
<summary>Answers</summary>

1. You step the parameter and get points directly. An implicit curve only tests points, so you must search for them.
2. ${tex`[1,\ 0.5,\ 0.25,\ 0.125]`} and ${tex`[0,\ 1,\ 1,\ 0.75]`} (from `constraintRow(3, 0.5)` and `constraintRow(3, 0.5, 1)`).
3. Natural: locality. Catmull–Rom: ${tex`C^2`} (it is ${tex`C^1`}). B-spline: interpolation.
4. Each segment runs between its middle two points, and the end points only set slopes. Repeat the first and last points.
5. ${tex`Q_1 = (3, 1)`}. Any ${tex`(x, 1)`} with ${tex`x > 2`}, ${tex`x \ne 3`}, such as ${tex`(2.5, 1)`}, is ${tex`G^1`} only.
6. The control points of the two halves of the curve, split at ${tex`t`}.
7. Four (${tex`k = 4`}).
8. They make the curve interpolate its end points, and reduce continuity only at the ends.
9. A circle's ${tex`x^2 + y^2 = 1`} needs a ratio of polynomials (for example, ${tex`\big(\frac{1-t^2}{1+t^2}, \frac{2t}{1+t^2}\big)`}), which the weights provide.

</details>

## Common Pitfalls

- **Assuming control points lie on the curve.** Only the ends of a
  Bézier curve do, and B-spline points usually do not.
- **Confusing ${tex`G^1`} with ${tex`C^1`}.** Matching directions is not
  matching speeds.
- **Using one high-degree polynomial** instead of a spline: it overshoots
  and every point affects everything.
- **Forgetting that NURBS need weights and knots**, not only points.
- **Drawing the B-spline outside the valid knot range**, where fewer
  than ${tex`k`} basis functions overlap and they no longer sum to 1.
- **Treating ${tex`u`} as distance.** Use an arc-length table for
  constant speed.
- **Expecting thick WebGPU lines.** Line primitives are one pixel wide;
  build a triangle strip.

## Summary

- **Representations:** implicit curves test, parametric curves generate.
  Parameterizations are not unique, and ${tex`u`} is not distance.
- **Polynomial pieces:** constraints give ${tex`C`}, the basis matrix is
  ${tex`B = C^{-1}`}, and the blending functions ${tex`\mathbf u B`} weight
  the control values. Interpolating polynomials overshoot and are not
  local.
- **Cubic splines:** natural (${tex`C^2`}, not local, ill-conditioned),
  Hermite and cardinal/Catmull–Rom (local, ${tex`C^1`}, tension controls
  tightness).
- **Approximating curves:** Bézier curves (Bernstein polynomials, convex
  hull, affine invariance, de Casteljau evaluation and subdivision,
  ${tex`C^1`}/${tex`G^1`} joins), B-splines (Cox–de Boor, local control,
  ${tex`C^{k-2}`}, repeated knots), and NURBS (weights give exact conics).
- **Drawing and motion:** flatten adaptively with de Casteljau, evaluate
  the curve in a WebGPU vertex shader from `vertex_index`, draw thick
  curves as triangle strips, and use arc length for constant-speed motion.
