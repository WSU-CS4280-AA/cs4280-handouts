---
title: Module 10 — Sampling
toc: true
---

```js echo
import * as d3 from "npm:d3";
import * as webgpu from "./components/webgpu.js";
import * as Inputs from "npm:@observablehq/inputs";
import {html} from "npm:htl";
```

# Module 10 · Sampling

Graphics keeps needing **fair** random choices in unusual spaces: points
in a pixel, points on a lens or an area light, directions on a
hemisphere, lines through a region. The same machinery **estimates
integrals** that have no closed form, which is **Monte Carlo
integration**, the basis of realistic rendering. This module builds the
tools in order: measures, probability, Monte Carlo estimators, and ways
to generate points with a chosen density. The last section runs them in
WebGPU shaders and needs **Chrome or Edge 113+**. This handout teaches the
*techniques*; it is not a walkthrough of any graded assignment.

Small helpers used throughout:

```js echo
const xi = Math.random;                                  // canonical random number ξ in [0, 1)
const mean = (a) => d3.mean(a), variance = (a) => d3.variance(a);
function caption(label, node) {
  const wrap = document.createElement("div");
  wrap.innerHTML = `<div style="font:12px var(--sans-serif); opacity:.65; margin-bottom:4px">${label}</div>`;
  wrap.append(node);
  return wrap;
}
const row = (...nodes) => html`<div style="display:flex; gap:16px; flex-wrap:wrap; align-items:flex-start">${nodes}</div>`;
function squarePlot(points, {size = 220, domain = [-1, 1], r = 1.8, fill = "steelblue", extra = () => {}} = {}) {
  const x = d3.scaleLinear().domain(domain).range([6, size - 6]), y = d3.scaleLinear().domain(domain).range([size - 6, 6]);
  const svg = d3.create("svg").attr("viewBox", [0, 0, size, size]).attr("width", size).attr("height", size)
    .style("background", "var(--theme-background-alt, #f5f5f5)").style("border-radius", "8px");
  extra(svg, x, y);
  svg.append("g").selectAll("circle").data(points).join("circle")
    .attr("cx", (d) => x(d.x)).attr("cy", (d) => y(d.y)).attr("r", r).attr("fill", (d) => d.fill ?? fill);
  return svg.node();
}
```

## Integration and Measures

### Integrals as measures, and averages

A **measure** ${tex`\mu`} assigns a size (length, area, volume) to sets.
An integral ${tex`\int_S d\mu`} is notation for "add up the little pieces
of ${tex`S`}". The **average** of ${tex`f`} depends on the measure:

${tex.block`\text{average}(f) = \frac{\int_S f\, d\mu}{\int_S d\mu}`}

The reading's example: ${tex`f(x,y) = x^2`} over ${tex`[0,2]^2`} with the
area measure has average ${tex`4/3`}. Choosing points **uniformly by
area** estimates it. Choosing them uniformly in some other coordinates
quietly changes the measure. Here the same square is also covered by
picking a random radius and angle from its center, which crowds points
toward the center:

```js echo
const avgN = view(Inputs.range([100, 20000], {value: 2000, step: 100, label: "points"}));
```

```js echo
(() => {
  const byArea = d3.range(avgN).map(() => ({x: 2 * xi(), y: 2 * xi()}));
  const byPolar = [];
  while (byPolar.length < avgN) {                      // uniform (r, φ) about (1, 1), kept if inside the square
    const r = Math.SQRT2 * xi(), phi = 2 * Math.PI * xi();
    const p = {x: 1 + r * Math.cos(phi), y: 1 + r * Math.sin(phi)};
    if (p.x >= 0 && p.x <= 2 && p.y >= 0 && p.y <= 2) byPolar.push(p);
  }
  const avg = (pts) => mean(pts.map((p) => p.x * p.x)).toFixed(4);
  return row(
    caption(`uniform in area: average x² ≈ ${avg(byArea)}`, squarePlot(byArea.slice(0, 1500), {domain: [0, 2], r: 1.3})),
    caption(`uniform in (r, φ): average x² ≈ ${avg(byPolar)}`, squarePlot(byPolar.slice(0, 1500), {domain: [0, 2], r: 1.3, fill: "orangered"})),
    html`<pre style="align-self:center">exact (area measure): ${(4 / 3).toFixed(4)}</pre>`
  );
})()
```

The second average is an honest average, but with respect to a
different measure (one that weights the center more). Most sampling
bugs are an unintended change of measure.

### A fair measure for lines

What does "a random line through a square" mean? A **fair** measure gives
equally wide bundles of lines the same weight, whatever their position or
angle. In **normal coordinates**
${tex`x\cos\theta + y\sin\theta = p`}, the fair measure is simply
${tex`dp\,d\theta`}: area in the ${tex`(p,\theta)`} plane. A test: under
a fair measure, the chance that a line hits a small disk depends only on
the disk's size, **not on where the disk is**.

```js echo
// Lines through the square [-1, 1]²: for each θ, p ranges over |p| ≤ r_max(θ) = |cos θ| + |sin θ|.
const rMax = (theta) => Math.abs(Math.cos(theta)) + Math.abs(Math.sin(theta));

// Fair: θ from p(θ) ∝ r_max(θ) by inverting a tabulated CDF, then p uniform in [-r_max, r_max].
const thetaTable = (() => {
  const n = 2048, cdf = [0];
  for (let i = 1; i <= n; i++) cdf.push(cdf[i - 1] + rMax(((i - 0.5) / n) * Math.PI));
  return cdf.map((c) => c / cdf[n]);
})();
function invertTable(cdf, u) {                          // returns a value in [0, 1]
  const i = Math.max(1, d3.bisectLeft(cdf, u)), a = cdf[i - 1], b = cdf[i];
  return (i - 1 + (u - a) / (b - a || 1)) / (cdf.length - 1);
}
function fairLine() {
  const theta = Math.PI * invertTable(thetaTable, xi());
  return {theta, p: (2 * xi() - 1) * rMax(theta)};
}
// Naive: the line through two uniform random points of the square.
function naiveLine() {
  const a = {x: 2 * xi() - 1, y: 2 * xi() - 1}, b = {x: 2 * xi() - 1, y: 2 * xi() - 1};
  const theta = Math.atan2(b.x - a.x, -(b.y - a.y));   // normal direction (perpendicular to b - a)
  return {theta, p: a.x * Math.cos(theta) + a.y * Math.sin(theta)};
}
const hits = (line, c, radius) => Math.abs(c.x * Math.cos(line.theta) + c.y * Math.sin(line.theta) - line.p) < radius;
```

```js echo
const lineMethod = view(Inputs.radio(["fair: uniform in (p, θ)", "naive: through two random points"], {value: "fair: uniform in (p, θ)", label: "lines"}));
```

```js echo
(() => {
  const make = lineMethod.startsWith("fair") ? fairLine : naiveLine;
  const disks = [{x: 0, y: 0, label: "center"}, {x: 0.75, y: 0.75, label: "corner"}], radius = 0.12, trials = 40000;
  const counts = disks.map(() => 0);
  for (let t = 0; t < trials; t++) { const L = make(); disks.forEach((c, k) => { if (hits(L, c, radius)) counts[k]++; }); }
  const lines = d3.range(40).map(make);
  const size = 260, x = d3.scaleLinear([-1, 1], [10, size - 10]), y = d3.scaleLinear([-1, 1], [size - 10, 10]);
  const svg = d3.create("svg").attr("viewBox", [0, 0, size, size]).attr("width", size).attr("height", size)
    .style("background", "var(--theme-background-alt, #f5f5f5)").style("border-radius", "8px");
  const clipId = `clip-${Math.random().toString(36).slice(2)}`;
  svg.append("clipPath").attr("id", clipId).append("rect").attr("x", x(-1)).attr("y", y(1)).attr("width", x(1) - x(-1)).attr("height", y(-1) - y(1));
  const g = svg.append("g").attr("clip-path", `url(#${clipId})`);
  for (const L of lines) {
    const c = {x: L.p * Math.cos(L.theta), y: L.p * Math.sin(L.theta)}, d = {x: -Math.sin(L.theta), y: Math.cos(L.theta)};
    g.append("line").attr("x1", x(c.x - 3 * d.x)).attr("y1", y(c.y - 3 * d.y)).attr("x2", x(c.x + 3 * d.x)).attr("y2", y(c.y + 3 * d.y))
      .attr("stroke", "steelblue").attr("stroke-opacity", 0.6);
  }
  svg.append("rect").attr("x", x(-1)).attr("y", y(1)).attr("width", x(1) - x(-1)).attr("height", y(-1) - y(1)).attr("fill", "none").attr("stroke", "gray");
  disks.forEach((c) => svg.append("circle").attr("cx", x(c.x)).attr("cy", y(c.y)).attr("r", x(radius) - x(0)).attr("fill", "orangered").attr("fill-opacity", 0.5));
  return row(svg.node(), html`<pre style="align-self:center">${disks.map((c, k) => `lines hitting the ${c.label} disk: ${(100 * counts[k] / trials).toFixed(2)}%`).join("\n")}
(${trials} lines)</pre>`);
})()
```

Fair lines hit both disks equally often. Lines through two random points
favor the center: they are uniform in a different measure. Sampling
${tex`\theta`} with density ${tex`\propto r_{\max}(\theta)`} uses
**function inversion** with a table, a technique developed below.

## Continuous Probability

### Expected value and variance

For ${tex`x \sim p`}, ${tex`E(f(x)) = \int f(x)p(x)\,dx`} and
${tex`V(x) = E(x^2) - E(x)^2`}. Expectation is **linear even for
correlated variables**, while variances add only for **uncorrelated**
ones (independent variables, for example). Check both with ${tex`x = \xi`} and a second variable that is
either independent or ${tex`y = \xi^2`} of the same ${tex`\xi`}:

```js echo
const corrMode = view(Inputs.radio(["independent: y = ξ′²", "correlated: y = ξ²"], {value: "correlated: y = ξ²", label: "y"}));
```

```js echo
(() => {
  const N = 200000, xs = [], ys = [];
  for (let i = 0; i < N; i++) { const a = xi(); xs.push(a); ys.push(corrMode.startsWith("ind") ? xi() ** 2 : a * a); }
  const sum = xs.map((v, i) => v + ys[i]);
  const f = (v) => v.toFixed(4);
  return html`<pre>E(x) = ${f(mean(xs))}   E(y) = ${f(mean(ys))}   E(x) + E(y) = ${f(mean(xs) + mean(ys))}   E(x + y) = ${f(mean(sum))}   (exact 1/2 + 1/3 = 0.8333)
V(x) = ${f(variance(xs))}   V(y) = ${f(variance(ys))}   V(x) + V(y) = ${f(variance(xs) + variance(ys))}   V(x + y) = ${f(variance(sum))}</pre>`;
})()
```

The expectations always add. With the correlated ${tex`y`}, the variance
of the sum is much **larger** than the sum of variances.

### Estimated means and the law of large numbers

For iid samples, ${tex`\frac1N\sum x_i \to E(x)`}, and the variance of the
average is ${tex`V(x)/N`}. Below, 40 independent averages of
${tex`\xi^2`} (exact mean ${tex`1/3`}) at the chosen ${tex`N`}, with the
band ${tex`\pm 2\sigma/\sqrt N`}:

```js echo
const meanN = view(Inputs.range([2, 2000], {value: 20, step: 1, label: "N (samples per average)"}));
```

```js echo
(() => {
  const sigma = Math.sqrt(1 / 5 - 1 / 9);                  // V(ξ²) = E(ξ⁴) − E(ξ²)² = 1/5 − 1/9
  const trials = d3.range(40).map((k) => ({k, est: d3.mean(d3.range(meanN), () => xi() ** 2)}));
  const band = 2 * sigma / Math.sqrt(meanN);
  return Plot.plot({height: 120, x: {domain: [0, 1], label: "estimate of E(ξ²)"}, y: {axis: null, domain: [-1, 1]},
    marks: [
      Plot.rectX([0], {x1: 1 / 3 - band, x2: 1 / 3 + band, y1: -1, y2: 1, fill: "orange", fillOpacity: 0.15}),
      Plot.ruleX([1 / 3], {stroke: "crimson", strokeDasharray: "4,3"}),
      Plot.dot(trials, {x: "est", y: (d) => Math.sin(d.k * 7.3) * 0.7, fill: "steelblue", r: 3.5})
    ]});
})()
```

About 95% of the dots land in the band, and the band narrows only as
${tex`1/\sqrt N`}. Monte Carlo gives **statistical confidence**, not
certainty.

## Monte Carlo Integration

### The estimator and its error

Since ${tex`E(g(x)/p(x)) = \int g\,d\mu`}, a sample average estimates the
integral:

${tex.block`\int_S g\, d\mu \approx \frac1N\sum_{i=1}^N \frac{g(\mathbf x_i)}{p(\mathbf x_i)}, \qquad \mathbf x_i \sim p`}

It works in any dimension, which is why it beats grid quadrature for
rendering. A grid with 10 points per axis needs ${tex`10^d`} samples in
${tex`d`} dimensions, while Monte Carlo's error ${tex`\sigma/\sqrt N`} has
no ${tex`d`} in it.

The reading's running example is ${tex`\int_0^4 x\,dx = 8`}. Each
density below is sampled by inverting its CDF:

```js echo
const mcMethods = [
  {name: "uniform  p = 1/4", sample: () => 4 * xi(), pdf: () => 1 / 4},
  {name: "importance  p = (6 − x)/16", sample: () => 6 - Math.sqrt(36 - 32 * xi()), pdf: (x) => (6 - x) / 16},
  {name: "importance  p = (x + 2)/16", sample: () => -2 + Math.sqrt(4 + 32 * xi()), pdf: (x) => (x + 2) / 16},
  {name: "importance  p = x/8", sample: () => 4 * Math.sqrt(xi()), pdf: (x) => x / 8}
];
function mcEstimate(method, N) {
  let s = 0;
  for (let i = 0; i < N; i++) { const x = method.sample(); s += x / method.pdf(x); }
  return s / N;
}
function stratifiedEstimate(N) {                        // one uniform sample in each of N equal strata
  let s = 0;
  for (let i = 0; i < N; i++) s += 4 * (i + xi()) / N;
  return (4 / N) * s;
}
```

```js echo
(() => {
  const Ns = [4, 8, 16, 32, 64, 128, 256, 512, 1024];
  const methods = [...mcMethods.slice(0, 3), {name: "stratified  p = 1/4", estimate: stratifiedEstimate}];
  const rows = methods.flatMap((m) => Ns.map((N) => {
    const est = d3.range(300).map(() => (m.estimate ? m.estimate(N) : mcEstimate(m, N)));
    return {method: m.name, N, rms: Math.sqrt(d3.mean(est, (e) => (e - 8) ** 2))};
  }));
  return Plot.plot({height: 280, width: 560, x: {type: "log", label: "N"}, y: {type: "log", label: "RMS error"}, color: {legend: true},
    marks: [Plot.line(rows, {x: "N", y: "rms", stroke: "method", marker: "dot"}), Plot.gridY({strokeOpacity: 0.1})]});
})()
```

The three plain Monte Carlo lines have slope ${tex`-\tfrac12`}: halving
the error costs four times the samples. Their **heights** differ with the
variance of ${tex`g/p`}. Stratification changes the **slope** to
${tex`-\tfrac32`} for this smooth integrand. The ${tex`p = x/8`} line is
missing because its error is exactly zero: ${tex`g/p = 8`} for every
sample. The measured variances match the reading's table:

```js echo
(() => {
  const N = 1000, rows = [...mcMethods.map((m) => ({m, est: () => mcEstimate(m, N)})), {m: {name: "stratified  p = 1/4"}, est: () => stratifiedEstimate(N)}];
  const theory = {"uniform  p = 1/4": "21.3/N", "importance  p = (6 − x)/16": "56.8/N", "importance  p = (x + 2)/16": "6.3/N", "importance  p = x/8": "0", "stratified  p = 1/4": "21.3/N³"};
  return Inputs.table(rows.map(({m, est}) => {
    const v = variance(d3.range(400).map(est));
    return {method: m.name, "theory": theory[m.name], "measured variance × N": +(v * N).toFixed(2), "measured × N³": +(v * N ** 3).toFixed(1)};
  }), {sort: null});
})()
```

### Importance sampling

Importance sampling picks ${tex`p`} **shaped like** ${tex`g`} so that
${tex`g/p`} is nearly constant. A bad match is worse than uniform: the
${tex`(6-x)/16`} density above puts most samples where ${tex`g`} is
small. The effect is dramatic for a peaked integrand such as a bright
light or a glossy lobe. Here ${tex`g(x) = e^{-50(x - 0.5)^2}`} is sampled
uniformly and with a tent density centered on the peak:

```js echo
const peaked = (x) => Math.exp(-50 * (x - 0.5) ** 2);
const tentPdf = (x) => (x < 0.5 ? 4 * x : 4 * (1 - x));
const sampleTent = () => { const u = xi(); return u < 0.5 ? Math.sqrt(u / 2) : 1 - Math.sqrt((1 - u) / 2); };
const peakedExact = Math.sqrt(Math.PI / 50) * 0.9999994267;   // erf(√50 / 2) ≈ 0.9999994
const isN = view(Inputs.range([2, 200], {value: 16, step: 1, label: "N per estimate"}));
```

```js echo
(() => {
  const est = (draw, pdf) => d3.mean(d3.range(isN), () => { const x = draw(); return peaked(x) / pdf(x); });
  const data = [
    ...d3.range(60).map((k) => ({k, method: "uniform", value: est(xi, () => 1)})),
    ...d3.range(60).map((k) => ({k, method: "tent (importance)", value: est(sampleTent, tentPdf)}))
  ];
  const rowOf = {"uniform": 1, "tent (importance)": 0};
  return Plot.plot({height: 170, marginLeft: 110, x: {label: "estimate", domain: [0, 2 * peakedExact]},
    y: {domain: [-0.5, 1.5], ticks: [0, 1], tickFormat: (v) => (v ? "uniform" : "tent (importance)"), label: null},
    marks: [Plot.ruleX([peakedExact], {stroke: "crimson", strokeDasharray: "4,3"}),
      Plot.dot(data, {x: "value", y: (d) => rowOf[d.method] + 0.3 * Math.sin(d.k * 7.3), fill: "seagreen", r: 3, fillOpacity: 0.6})]});
})()
```

At the same ${tex`N`}, the tent estimates cluster more tightly around the
true value (red line). The tent is only a rough match to the bump, yet it
cuts the variance of ${tex`g/p`} by about a factor of 3, worth three
times as many uniform samples.

### Stratified and quasi-random points

Monte Carlo says how to *combine* samples. Where you *place* them also
matters. **Jittering** is stratified sampling (one random point per grid
cell), and **quasi-random** sequences such as Halton and Hammersley are
deterministic but evenly spread. Both are built on the **radical
inverse**, which writes ${tex`i`} in a given base and mirrors its digits
about the radix point:

```js echo
function radicalInverse(i, base) {
  let result = 0, f = 1 / base;
  for (let n = i; n > 0; n = Math.floor(n / base), f /= base) result += f * (n % base);
  return result;
}
const halton = (i) => ({x: radicalInverse(i, 2), y: radicalInverse(i, 3)});
const hammersley = (i, N) => ({x: i / N, y: radicalInverse(i, 2)});
const patternN = view(Inputs.range([16, 256], {value: 64, step: 1, label: "N (rounded to a square for grids)"}));
```

```js echo
(() => {
  const side = Math.max(2, Math.round(Math.sqrt(patternN))), n = side * side;
  const grid = (f) => d3.range(side * side).map((k) => ({x: (k % side + f()) / side, y: (Math.floor(k / side) + f()) / side}));
  const sets = [
    ["random", d3.range(n).map(() => ({x: xi(), y: xi()}))],
    ["jittered", grid(xi)],
    ["regular", grid(() => 0.5)],
    ["Halton (2, 3)", d3.range(1, n + 1).map(halton)],
    ["Hammersley", d3.range(n).map((i) => hammersley(i, n))]
  ];
  // Discrepancy check: the worst error of "points in a box ≈ area × N" over many random boxes
  const discrepancy = (pts) => d3.max(d3.range(400), (k) => {
    const a = (k * 0.6180339887) % 1, b = (k * 0.7548776662) % 1;
    return Math.abs(pts.filter((p) => p.x < a && p.y < b).length / pts.length - a * b);
  });
  return row(...sets.map(([label, pts]) => caption(`${label}: worst box error ${discrepancy(pts).toFixed(3)}`, squarePlot(pts, {size: 160, domain: [0, 1], r: 2}))));
})()
```

"Worst box error" measures how far the count in an axis-aligned box
strays from (area × N). Random points do worst. The others spread evenly,
but the regular grid's structure can **alias**. Quasi-random points can
replace random ones **anywhere** a random point in ${tex`[0,1]^d`} is used.

## Choosing Random Points

### Function inversion in 1D

To sample a density ${tex`p`}, invert its CDF ${tex`P`}:
${tex`x = P^{-1}(\xi)`}. For ${tex`p(x) = \tfrac32x^2`} on ${tex`[-1,1]`},
${tex`P(x) = (x^3 + 1)/2`}, so ${tex`x = \sqrt[3]{2\xi - 1}`}:

```js echo
const invN = view(Inputs.range([10, 40], {value: 16, step: 1, label: "jittered ξ values"}));
```

```js echo
(() => {
  const warp = (u) => Math.cbrt(2 * u - 1);
  const xis = d3.range(invN).map((i) => (i + xi()) / invN);       // stratified ξ
  const links = xis.map((u) => ({x1: 2 * u - 1, x2: warp(u)}));
  const many = d3.range(40000).map(() => warp(xi()));
  return row(
    Plot.plot({width: 320, height: 200, x: {domain: [-1, 1], label: "top: 2ξ − 1   bottom: x = P⁻¹(ξ)"}, y: {axis: null, domain: [-0.1, 1.1]},
      marks: [Plot.ruleY([0, 1], {stroke: "#ccc"}), Plot.link(links, {x1: "x1", y1: 1, x2: "x2", y2: 0, stroke: "steelblue", strokeOpacity: 0.6}),
        Plot.dot(links, {x: "x1", y: 1, fill: "orange", r: 3}), Plot.dot(links, {x: "x2", y: 0, fill: "steelblue", r: 3})]}),
    Plot.plot({width: 320, height: 200, x: {label: "x"}, y: {label: "density"},
      marks: [Plot.rectY(many, Plot.binX({y: (bin) => bin.length / many.length / 0.05}, {x: (d) => d, interval: 0.05, fill: "steelblue", fillOpacity: 0.5})),
        Plot.line(d3.range(-1, 1.001, 0.02), {x: (d) => d, y: (d) => 1.5 * d * d, stroke: "crimson", strokeWidth: 2})]})
  );
})()
```

The warp pulls the samples toward the ends, where ${tex`p`} is large, and
the histogram matches ${tex`p`} (red). Because ${tex`P^{-1}`} is
monotonic, each stratum of ${tex`\xi`} maps to one stratum of ${tex`x`}:
**stratification survives the warp**.

### Inversion in 2D: the disk

A uniform point on a disk of radius ${tex`R`} has
${tex`p = 1/(\pi R^2)`} with ${tex`dA = r\,dr\,d\phi`}. Inverting gives
${tex`\phi = 2\pi\xi_1`}, ${tex`r = R\sqrt{\xi_2}`}. The naive
${tex`r = R\xi_2`} crowds the center. Check with the reading's
probability: a uniform point lies in the inner half radius with
probability ${tex`0.25`}.

```js echo
const diskJitter = view(Inputs.toggle({label: "jitter (ξ₁, ξ₂) on a 24 × 24 grid", value: true}));
```

```js echo
(() => {
  const n = 24, uv = d3.range(n * n).map((k) => diskJitter ? {u: (k % n + xi()) / n, v: (Math.floor(k / n) + xi()) / n} : {u: xi(), v: xi()});
  const toDisk = (rFn) => uv.map(({u, v}) => { const r = rFn(v), phi = 2 * Math.PI * u; return {x: r * Math.cos(phi), y: r * Math.sin(phi)}; });
  const naive = toDisk((v) => v), area = toDisk(Math.sqrt);
  const inner = (pts) => (pts.filter((p) => Math.hypot(p.x, p.y) < 0.5).length / pts.length).toFixed(3);
  const ring = (svg, x, y) => svg.append("circle").attr("cx", x(0)).attr("cy", y(0)).attr("r", x(0.5) - x(0)).attr("fill", "none").attr("stroke", "orange").attr("stroke-dasharray", "3,2");
  return row(
    caption(`naive r = ξ₂: inner fraction ${inner(naive)}`, squarePlot(naive, {extra: ring})),
    caption(`r = √ξ₂: inner fraction ${inner(area)}`, squarePlot(area, {extra: ring}))
  );
})()
```

### Sampling the hemisphere

For diffuse and glossy reflection, sample directions with density
${tex`p(\theta,\phi) = \frac{n+1}{2\pi}\cos^n\theta`}:
${tex`\theta = \arccos\big((1-\xi_1)^{1/(n+1)}\big)`},
${tex`\phi = 2\pi\xi_2`}. The left plot looks down on the hemisphere
(each direction's ${tex`x, y`}); the right compares the histogram of
${tex`\theta`} with its exact density
${tex`(n+1)\cos^n\theta\sin\theta`}:

```js echo
const cosN = view(Inputs.range([0, 64], {value: 1, step: 1, label: "exponent n (0 = uniform, 1 = cosine)"}));
```

```js echo
function sampleCosPowerHemisphere(n, u1 = xi(), u2 = xi()) {
  const cosTheta = (1 - u1) ** (1 / (n + 1)), sinTheta = Math.sqrt(1 - cosTheta * cosTheta), phi = 2 * Math.PI * u2;
  return {x: Math.cos(phi) * sinTheta, y: Math.sin(phi) * sinTheta, z: cosTheta};
}
```

```js echo
(() => {
  const dirs = d3.range(30000).map(() => sampleCosPowerHemisphere(cosN));
  const thetas = dirs.map((d) => Math.acos(d.z)), bw = Math.PI / 2 / 40;
  const ring = (svg, x, y) => svg.append("circle").attr("cx", x(0)).attr("cy", y(0)).attr("r", x(1) - x(0)).attr("fill", "none").attr("stroke", "#bbb");
  return row(
    caption("top view of 1500 directions", squarePlot(dirs.slice(0, 1500), {r: 1.4, extra: ring})),
    Plot.plot({width: 340, height: 220, x: {label: "θ (radians)", domain: [0, Math.PI / 2]}, y: {label: "density"},
      marks: [Plot.rectY(thetas, Plot.binX({y: (b) => b.length / thetas.length / bw}, {x: (d) => d, interval: bw, fill: "steelblue", fillOpacity: 0.5})),
        Plot.line(d3.range(0, Math.PI / 2, 0.01), {x: (t) => t, y: (t) => (cosN + 1) * Math.cos(t) ** cosN * Math.sin(t), stroke: "crimson", strokeWidth: 2})]})
  );
})()
```

At ${tex`n = 0`} directions are uniform over the hemisphere, so the top
view crowds near the rim. At ${tex`n = 1`} the top view is a uniform disk:
cosine-weighted sampling is just disk sampling lifted to the hemisphere,
${tex`\mathbf a = (\cos 2\pi\xi_2\sqrt{\xi_1},\ \sin 2\pi\xi_2\sqrt{\xi_1},\ \sqrt{1 - \xi_1})`}.
Large ${tex`n`} concentrates samples in a narrow glossy lobe.

### Rejection sampling

Pick points in an easy region and **keep** those that land in the target.
For a disk, keep ${tex`(x,y)`} in ${tex`[-1,1]^2`} with
${tex`x^2 + y^2 < 1`}. Normalizing points kept in the unit **ball** gives
uniform **directions**.

```js echo
const rejectN = view(Inputs.range([100, 3000], {value: 800, step: 100, label: "candidates"}));
```

```js echo
(() => {
  const cands = d3.range(rejectN).map(() => ({x: 2 * xi() - 1, y: 2 * xi() - 1}));
  cands.forEach((p) => (p.fill = p.x * p.x + p.y * p.y < 1 ? "steelblue" : "#d55"));
  const kept = cands.filter((p) => p.fill === "steelblue").length;
  // In d dimensions the acceptance rate is the ball's volume / the cube's volume.
  const ballVolume = (d) => (d === 0 ? 1 : d === 1 ? 2 : (2 * Math.PI / d) * ballVolume(d - 2));   // V_d = (2π/d) V_{d−2}
  const ballFraction = (d) => ballVolume(d) / 2 ** d;
  return row(squarePlot(cands, {r: 2}), html`<pre style="align-self:center">kept ${kept} of ${rejectN} = ${(kept / rejectN).toFixed(3)}   (π/4 = ${(Math.PI / 4).toFixed(3)})

acceptance rate for a ball in d dimensions:
${[2, 3, 6, 10].map((d) => `  d = ${String(d).padStart(2)}: ${ballFraction(d).toFixed(4)}`).join("\n")}</pre>`);
})()
```

Rejection is simple and works for any shape, but it wastes samples,
collapses in high dimensions, and is **hard to stratify**: a jittered
grid of candidates leaves an irregular set after rejection.

### Metropolis sampling

When you can only **evaluate** ${tex`f`}, a Metropolis chain samples it
anyway. From ${tex`x`}, propose ${tex`y = x + \text{small random step}`}
and accept with probability ${tex`\min(1, f(y)/f(x))`}; otherwise stay.
(The general rule also includes the probability of proposing each move;
for a symmetric proposal like this one, those terms cancel.)

```js echo
const metroF = (x) => (x < 0 || x > 1 ? 0 : 0.6 * Math.exp(-(((x - 0.25) / 0.06) ** 2)) + Math.exp(-(((x - 0.7) / 0.1) ** 2)));
const metroArea = d3.sum(d3.range(0, 1, 1e-4), (x) => metroF(x + 5e-5) * 1e-4);
function gaussian() { return Math.sqrt(-2 * Math.log(1 - xi())) * Math.cos(2 * Math.PI * xi()); }
function metropolis(f, steps, stepSize, x = 0.5) {
  const chain = [];
  let accepted = 0;
  for (let i = 0; i < steps; i++) {
    const y = x + stepSize * gaussian();
    if (xi() < Math.min(1, f(y) / f(x))) { x = y; accepted++; }
    chain.push(x);                                       // a rejected move repeats x
  }
  return {chain, rate: accepted / steps};
}
const metroForm = view(Inputs.form({
  steps: Inputs.range([1000, 100000], {value: 20000, step: 1000, label: "steps"}),
  step: Inputs.range([0.005, 1], {value: 0.1, step: 0.005, label: "proposal step size"})
}));
```

```js echo
(() => {
  const {chain, rate} = metropolis(metroF, metroForm.steps, metroForm.step);
  const kept = chain.slice(500), bw = 0.02;                // discard the start-up samples
  return html`<div>${row(
    Plot.plot({width: 340, height: 200, x: {label: "x", domain: [0, 1]}, y: {label: "density"},
      marks: [Plot.rectY(kept, Plot.binX({y: (b) => b.length / kept.length / bw}, {x: (d) => d, interval: bw, fill: "steelblue", fillOpacity: 0.5})),
        Plot.line(d3.range(0, 1, 0.005), {x: (d) => d, y: (d) => metroF(d) / metroArea, stroke: "crimson", strokeWidth: 2})]}),
    Plot.plot({width: 340, height: 200, x: {label: "step"}, y: {label: "x", domain: [0, 1]},
      marks: [Plot.line(chain.slice(0, 600).map((x, i) => ({i, x})), {x: "i", y: "x", stroke: "seagreen"})]})
  )}<pre>acceptance rate ${(rate * 100).toFixed(1)}%</pre></div>`;
})()
```

The histogram matches ${tex`f/\int f`} (red). The trace (first 600 steps)
shows that samples are **correlated**. With tiny steps the chain rarely
jumps between the two bumps. With huge steps most proposals are rejected.
Metropolis Light Transport uses the same idea on light paths.

## Sampling in WebGPU

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

### Random numbers and pixel sample patterns

WGSL has no `Math.random()`. Instead, **hash** the pixel position (and
frame number) into a seed with the PCG hash, then draw ${tex`\xi`} values
from it. The shader below estimates the coverage of each pixel of a
**Siemens star**, whose thin spokes alias badly, with ${tex`n\times n`}
samples per pixel and a choice of pattern:

```js echo
const wgslRandom = `
fn pcg(v: u32) -> u32 {                          // PCG hash
  let state = v * 747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
fn rand(seed: ptr<function, u32>) -> f32 {      // canonical ξ in [0, 1)
  *seed = pcg(*seed);
  return f32(*seed >> 8u) / 16777216.0;
}
fn hammersley(k: u32, N: u32) -> vec2<f32> {
  return vec2<f32>(f32(k) / f32(N), f32(reverseBits(k)) / 4294967296.0);
}`;

const starSize = 300;
const starModule = device.createShaderModule({code: `${wgslRandom}
struct Params { n: u32, mode: u32, seed: u32, pad: u32 };
@group(0) @binding(0) var<uniform> params: Params;

@vertex
fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  var pos = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  return vec4<f32>(pos[i], 0.0, 1.0);                     // one triangle covers the screen
}

fn inside(p: vec2<f32>) -> f32 {                           // Siemens star with 36 spokes
  let d = p - vec2<f32>(${starSize / 2}.0);
  if (length(d) > ${starSize * 0.47}) { return 0.0; }
  return select(0.0, 1.0, fract(atan2(d.y, d.x) / 6.2831853 * 36.0) < 0.5);
}

@fragment
fn fs_main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  var seed = pcg(u32(frag.x) + pcg(u32(frag.y) + pcg(params.seed)));
  let n = params.n;
  let N = n * n;
  let shift = vec2<f32>(rand(&seed), rand(&seed));         // per-pixel random shift for Hammersley
  var covered = 0.0;
  for (var k = 0u; k < N; k++) {
    let cell = vec2<f32>(f32(k % n), f32(k / n));
    var offset: vec2<f32>;
    if (params.mode == 0u) { offset = (cell + 0.5) / f32(n); }                                   // regular
    else if (params.mode == 1u) { offset = (cell + vec2<f32>(rand(&seed), rand(&seed))) / f32(n); } // jittered
    else if (params.mode == 2u) { offset = vec2<f32>(rand(&seed), rand(&seed)); }                // random
    else { offset = fract(hammersley(k, N) + shift); }                                           // Hammersley
    covered += inside(floor(frag.xy) + offset);
  }
  let c = covered / f32(N);
  return vec4<f32>(vec3<f32>(pow(c, 1.0 / 2.2)), 1.0);    // coverage is linear; encode for display
}`});
const starPipeline = device.createRenderPipeline({
  layout: "auto",
  vertex: {module: starModule, entryPoint: "vs_main"},
  fragment: {module: starModule, entryPoint: "fs_main", targets: [{format: canvasFormat}]}
});
const starUniforms = device.createBuffer({size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
const starBindGroup = device.createBindGroup({layout: starPipeline.getBindGroupLayout(0), entries: [{binding: 0, resource: {buffer: starUniforms}}]});
const starCanvas = document.createElement("canvas");
starCanvas.width = starCanvas.height = starSize;
starCanvas.style.borderRadius = "8px";
const {context: starContext} = webgpu.configureCanvas(starCanvas, device);
const starZoom = document.createElement("canvas");
starZoom.width = starZoom.height = 240;
starZoom.style.cssText = "border-radius: 8px; image-rendering: pixelated";
```

```js echo
const starForm = view(Inputs.form({
  n: Inputs.range([1, 8], {value: 1, step: 1, label: "n (n² samples per pixel)"}),
  pattern: Inputs.radio(["regular", "jittered", "random", "Hammersley"], {value: "regular", label: "pattern"})
}));
```

```js echo
{
  device.queue.writeBuffer(starUniforms, 0, new Uint32Array([starForm.n, ["regular", "jittered", "random", "Hammersley"].indexOf(starForm.pattern), 1, 0]));
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({colorAttachments: [{view: starContext.getCurrentTexture().createView(), clearValue: {r: 0, g: 0, b: 0, a: 1}, loadOp: "clear", storeOp: "store"}]});
  pass.setPipeline(starPipeline);
  pass.setBindGroup(0, starBindGroup);
  pass.draw(3);
  pass.end();
  device.queue.submit([encoder.finish()]);
  // Zoom on the star's center, where the spokes are thinner than a pixel.
  const bitmap = await createImageBitmap(starCanvas, starSize / 2 - 24, starSize / 2 - 24, 48, 48);
  const ctx = starZoom.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bitmap, 0, 0, 240, 240);
}
```

```js echo
row(caption(`n = ${starForm.n}, ${starForm.pattern}`, starCanvas), caption("zoom near the center (×5)", starZoom))
```

With one regular sample, the center shows false **moiré** patterns: the
spokes alias into structures that are not there. More regular samples
push the aliasing inward but keep its structure. Jittered, random, and
Hammersley samples turn it into **noise**, and jittered and Hammersley
have less noise than random. Hardware MSAA (`multisample: {count: 4}`)
uses a fixed pattern of four positions (a rotated grid); shader sampling
lets you choose any pattern.

### Progressive accumulation: ambient occlusion

**Ambient occlusion** is the cosine-weighted visible fraction of the
hemisphere above a point:

${tex.block`AO = \frac1\pi\int_\Omega V(\omega)\cos\theta\,d\omega`}

With **cosine-weighted** directions (${tex`p = \cos\theta/\pi`}), each
sample's ${tex`g/p`} is just ${tex`V(\omega)`}, 0 or 1. With **uniform**
directions (${tex`p = 1/2\pi`}), it is ${tex`2V\cos\theta`}, which varies
more. A compute shader traces one AO ray per pixel per frame and keeps a
**running mean** in a storage buffer:

```js echo
const aoWidth = 400, aoHeight = 260;
const aoModule = device.createShaderModule({code: `${wgslRandom}
struct Params { frame: u32, mode: u32, width: u32, seed: u32 };   // height is fixed below
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> accum: array<vec4<f32>>;

const PI = 3.14159265;
const SPHERES = array<vec4<f32>, 4>(                      // center xyz, radius
  vec4<f32>(0.0, 1.0, 0.0, 1.0), vec4<f32>(-1.7, 0.5, 0.7, 0.5),
  vec4<f32>(1.6, 0.7, -0.5, 0.7), vec4<f32>(0.9, 0.25, 1.3, 0.25));

struct Hit { t: f32, n: vec3<f32> };

fn intersect(o: vec3<f32>, d: vec3<f32>) -> Hit {
  var best = Hit(1e30, vec3<f32>(0.0));
  if (d.y < 0.0) {                                          // ground plane y = 0
    let t = -o.y / d.y;
    if (t > 1e-4) { best = Hit(t, vec3<f32>(0.0, 1.0, 0.0)); }
  }
  for (var i = 0; i < 4; i++) {
    let s = SPHERES[i];
    let oc = o - s.xyz;
    let b = dot(oc, d);
    let disc = b * b - (dot(oc, oc) - s.w * s.w);
    if (disc > 0.0) {
      let t = -b - sqrt(disc);
      if (t > 1e-4 && t < best.t) { best = Hit(t, normalize(o + t * d - s.xyz)); }
    }
  }
  return best;
}

fn toWorld(v: vec3<f32>, n: vec3<f32>) -> vec3<f32> {      // uvw basis around n
  let a = select(vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(0.0, 1.0, 0.0), abs(n.x) > 0.9);
  let t = normalize(cross(a, n));
  let b = cross(n, t);
  return v.x * t + v.y * b + v.z * n;
}

fn sampleDirection(xi: vec2<f32>, mode: u32) -> vec4<f32> {  // xyz = local direction, w = g/p weight factor
  let phi = 2.0 * PI * xi.x;
  if (mode == 0u) {                                          // cosine-weighted: pdf = cos θ / π
    let s = sqrt(xi.y);
    return vec4<f32>(cos(phi) * s, sin(phi) * s, sqrt(1.0 - xi.y), 1.0);
  }
  let z = xi.y;                                              // uniform: pdf = 1 / 2π
  let s = sqrt(1.0 - z * z);
  return vec4<f32>(cos(phi) * s, sin(phi) * s, z, 2.0 * z);  // weight (cos θ / π) / (1 / 2π) = 2 cos θ
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.width || id.y >= ${aoHeight}u) { return; }
  var seed = pcg(id.x + pcg(id.y + pcg(params.seed)));

  // Camera ray through a jittered point in the pixel (antialiasing for free).
  let eye = vec3<f32>(0.0, 1.9, 4.2);
  let w = normalize(eye - vec3<f32>(0.0, 0.5, 0.0));
  let u = normalize(cross(vec3<f32>(0.0, 1.0, 0.0), w));
  let v = cross(w, u);
  let px = (f32(id.x) + rand(&seed)) / f32(params.width) * 2.0 - 1.0;
  let py = 1.0 - (f32(id.y) + rand(&seed)) / ${aoHeight}.0 * 2.0;
  let aspect = f32(params.width) / ${aoHeight}.0;
  let dir = normalize(px * aspect * 0.55 * u + py * 0.55 * v - w);

  var value = 0.75;                                          // background
  let hit = intersect(eye, dir);
  if (hit.t < 1e29) {
    let p = eye + hit.t * dir;
    let s = sampleDirection(vec2<f32>(rand(&seed), rand(&seed)), params.mode);
    let blocked = intersect(p + 1e-3 * hit.n, toWorld(s.xyz, hit.n)).t < 1e29;
    value = select(s.w, 0.0, blocked);                       // g/p = V(ω) × weight
  }
  let i = id.y * params.width + id.x;
  accum[i] += (vec4<f32>(value, value, value, 1.0) - accum[i]) / f32(params.frame + 1u);   // running mean
}

// Display pass: read the running mean.
@group(0) @binding(1) var<storage, read> image: array<vec4<f32>>;
@vertex
fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  var pos = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  return vec4<f32>(pos[i], 0.0, 1.0);
}
@fragment
fn fs_main(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let c = image[u32(frag.y) * ${aoWidth}u + u32(frag.x)];
  return vec4<f32>(pow(clamp(c.rgb, vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(1.0 / 2.2)), 1.0);
}`});
```

The compute entry point writes the buffer as `read_write`, and the display
entry point reads it as `read`. Each declares its own variable at binding 1,
which WGSL allows because no single entry point uses both. Two explicit
layouts describe the two views of the same buffer:

```js echo
const aoComputeLayout = device.createBindGroupLayout({entries: [
  {binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: {type: "uniform"}},
  {binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: {type: "storage"}}
]});
const aoDisplayLayout = device.createBindGroupLayout({entries: [
  {binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: {type: "read-only-storage"}}
]});
const aoComputePipeline = device.createComputePipeline({
  layout: device.createPipelineLayout({bindGroupLayouts: [aoComputeLayout]}),
  compute: {module: aoModule, entryPoint: "main"}
});
const aoDisplayPipeline = device.createRenderPipeline({
  layout: device.createPipelineLayout({bindGroupLayouts: [aoDisplayLayout]}),
  vertex: {module: aoModule, entryPoint: "vs_main"},
  fragment: {module: aoModule, entryPoint: "fs_main", targets: [{format: canvasFormat}]}
});
const aoParams = device.createBuffer({size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
const aoAccum = device.createBuffer({size: aoWidth * aoHeight * 16, usage: GPUBufferUsage.STORAGE});
const aoComputeBindGroup = device.createBindGroup({layout: aoComputeLayout, entries: [
  {binding: 0, resource: {buffer: aoParams}}, {binding: 1, resource: {buffer: aoAccum}}]});
const aoDisplayBindGroup = device.createBindGroup({layout: aoDisplayLayout, entries: [{binding: 1, resource: {buffer: aoAccum}}]});
const aoCanvas = document.createElement("canvas");
aoCanvas.width = aoWidth;
aoCanvas.height = aoHeight;
aoCanvas.style.borderRadius = "8px";
const {context: aoContext} = webgpu.configureCanvas(aoCanvas, device);
const aoStatus = html`<pre style="margin:4px 0"></pre>`;
```

```js echo
const aoForm = view(Inputs.form({
  mode: Inputs.radio(["cosine-weighted", "uniform hemisphere"], {value: "cosine-weighted", label: "AO directions"}),
  accumulate: Inputs.toggle({value: true, label: "accumulate frames"}),
  maxFrames: Inputs.range([1, 1024], {value: 256, step: 1, label: "stop after (frames)"})
}));
```

```js echo
{
  // Re-running this cell (any control change) restarts the running mean at frame 0.
  let frame = 0, total = 0, running = true;
  invalidation.then(() => (running = false));
  function step() {
    if (!running || total >= aoForm.maxFrames) return;
    // Without accumulation, frame stays 0, so each frame replaces the mean. The seed always changes.
    device.queue.writeBuffer(aoParams, 0, new Uint32Array([aoForm.accumulate ? frame : 0, aoForm.mode === "cosine-weighted" ? 0 : 1, aoWidth, total + 1]));
    const encoder = device.createCommandEncoder();
    const compute = encoder.beginComputePass();
    compute.setPipeline(aoComputePipeline);
    compute.setBindGroup(0, aoComputeBindGroup);
    compute.dispatchWorkgroups(Math.ceil(aoWidth / 8), Math.ceil(aoHeight / 8));
    compute.end();
    const pass = encoder.beginRenderPass({colorAttachments: [{view: aoContext.getCurrentTexture().createView(), clearValue: {r: 0, g: 0, b: 0, a: 1}, loadOp: "clear", storeOp: "store"}]});
    pass.setPipeline(aoDisplayPipeline);
    pass.setBindGroup(0, aoDisplayBindGroup);
    pass.draw(3);
    pass.end();
    device.queue.submit([encoder.finish()]);
    total++;
    if (aoForm.accumulate) frame++;
    aoStatus.textContent = aoForm.accumulate ? `${frame} samples per pixel (noise ∝ 1/√${frame})` : `1 sample per pixel, new seed each frame`;
    requestAnimationFrame(step);
  }
  step();
}
```

```js echo
html`<div>${aoCanvas}${aoStatus}</div>`
```

Things to try:

- Turn **accumulate** off: each frame is a fresh one-sample estimate, and
  the noise flickers. Turned back on, it shrinks as
  ${tex`1/\sqrt{\text{frame}}`}: each halving takes four times as many
  frames.
- Compare **uniform** with **cosine-weighted** directions at the same
  frame count (set "stop after" to 16). Both converge to the same image
  (unbiased), but uniform is noisier because its ${tex`g/p`} varies.
- The running mean ${tex`a \mathrel{+}= (x - a)/(k+1)`} never stores a
  large sum, so it avoids the precision loss of adding small values to a
  large total. Restart it (frame 0) whenever
  the camera or scene changes.

## Check Your Understanding

1. Why do "random points in a square" chosen by random radius and angle give a different average of ${tex`x^2`}?
2. What is a fair measure for lines in normal coordinates, and how can you test it?
3. If ${tex`x`} and ${tex`y`} are correlated, does ${tex`E(x + y) = E(x) + E(y)`}? Does ${tex`V(x + y) = V(x) + V(y)`}?
4. A Monte Carlo estimate has RMS error 0.04 with 100 samples. About how many samples give 0.01?
5. Why is ${tex`p = x/8`} perfect for ${tex`\int_0^4 x\,dx`}, and why can't you use that idea in general?
6. Derive the sampling formula for ${tex`p(x) = 2x`} on ${tex`[0,1]`}.
7. Why is ${tex`r = R\xi_2`} wrong for a uniform disk?
8. With cosine-weighted directions, why is each AO sample just 0 or 1?
9. Give one advantage of inversion over rejection, and one situation where Metropolis is the only option.

<details>
<summary>Answers</summary>

1. That method is uniform in ${tex`(r, \phi)`}, which is a different measure from area: it crowds points toward the center.
2. ${tex`dp\,d\theta`}. Count lines hitting small equal disks in different places: the rates should match.
3. Yes, expectation is always linear. Not in general: variances add only when the variables are uncorrelated, which independence guarantees.
4. ${tex`100 \times 4^2 = 1600`}.
5. ${tex`g/p = 8`} is constant, so the variance is zero. Building ${tex`p = g/I`} requires knowing ${tex`I`}, which is what you wanted to compute.
6. ${tex`P(x) = x^2`}, so ${tex`x = \sqrt\xi`}.
7. The area of a ring grows with ${tex`r`}, so equal steps in ${tex`r`} put too many points near the center. The area-preserving map is ${tex`r = R\sqrt{\xi_2}`}.
8. The ${tex`\cos\theta/\pi`} in the integrand cancels the pdf, leaving ${tex`V(\omega)`}.
9. Inversion keeps stratification and wastes no samples. Metropolis works when you can evaluate ${tex`f`} but cannot integrate or invert it, such as light-path space.

</details>

## Common Pitfalls

- **Changing the measure by accident**, for example uniform ${tex`r`}
  instead of uniform area.
- **Forgetting to divide by ${tex`p`}**, or using a ${tex`p`} that is zero
  where ${tex`g`} is not.
- **Confusing variance with bias.** More samples reduce variance, never
  bias.
- **Using a poorly matched importance density**, which is worse than
  uniform.
- **Breaking stratification** with rejection, or by using the same random
  stream for two dimensions.
- **Reusing one GPU seed for every pixel**, which gives structured
  patterns instead of noise.
- **Forgetting to reset progressive accumulation** when the view changes.

## Summary

- **Measures** turn length, area, and "how many lines" into integrals. A
  fair measure for lines is ${tex`dp\,d\theta`} in normal coordinates.
- **Probability:** pdfs, expected value (linear even for correlated
  variables), variance (additive only for uncorrelated ones), and the law
  of large numbers.
- **Monte Carlo:** ${tex`\int g \approx \frac1N\sum g(\mathbf x_i)/p(\mathbf x_i)`}
  with error ${tex`\propto 1/\sqrt N`}. Importance sampling,
  stratification, and quasi-random points reduce the variance.
- **Choosing points:** function inversion (disk: ${tex`r = R\sqrt\xi`};
  ${tex`\cos^n`} hemisphere), rejection, and Metropolis.
- **WebGPU:** hash-based random numbers, sample patterns in a fragment
  shader, warping in WGSL, and progressive accumulation in a compute
  shader.
