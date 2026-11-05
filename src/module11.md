---
title: Module 11 — Sampling
toc: true
---

```js echo
import * as d3 from "npm:d3";
import {initializeWebGPU} from "./lib/webgpu.js";
import * as Inputs from "npm:@observablehq/inputs";
import {html} from "npm:htl";
```

# Module 11 · Sampling

This module builds the tools for making **fair** random choices, in
order: measures, probability, Monte Carlo estimators, and ways to generate
points with a chosen density. It then applies them to a worked example,
fair random lines, and runs them in WebGPU shaders. The WebGPU section
needs **Chrome or Edge 113+**. This handout teaches the *techniques*; it
is not a walkthrough of any graded assignment.

## Why Sampling?

Graphics keeps needing fair random choices in unusual spaces: points in a
pixel, possibly weighted by a filter; points on a lens or an area light;
directions on a hemisphere around a surface normal; and lines through a
region. The same machinery **estimates integrals** that have no closed
form, which is **Monte Carlo integration**, the basis of realistic
rendering.

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

### Measures

A **measure** assigns a size to sets, matching our sense of length, area,
or volume. For area in the plane, the measure ${tex`A`} sends a subset of
the plane to a size in ${tex`[0, \infty]`}, with unit squares having
size 1. To be a measure, a function ${tex`\mu`} must satisfy

${tex.block`\mu(\varnothing) = 0, \qquad \mu(S \cup T) = \mu(S) + \mu(T) - \mu(S \cap T)`}

A single point, or a line in the plane, has zero area. Such sets are
**zero-measure** sets.

### Integrals are notation for measures

${tex.block`A(S) \equiv \int_{\mathbf x \in S} dA(\mathbf x)`}

Read it as "take every point in ${tex`S`} and add up its little piece of
area." To evaluate an integral, choose coordinates and expand ${tex`dA`},
for example ${tex`dA = dx\,dy`} or ${tex`dA = r\,dr\,d\phi`}. **Weighting**
by a nonnegative function creates a new measure:

${tex.block`\nu(S) = \int_{\mathbf x \in S} \lVert\mathbf x\rVert^2\, dA(\mathbf x)`}

### Averages depend on the measure

The **average** of ${tex`f`} over ${tex`S`} with respect to ${tex`\mu`} is

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

The hard part of many problems is choosing the **natural** measure. For
points in the plane it is area. For a set of **lines**, it is not obvious;
we return to lines in [Example: Fair Random Lines](#example-fair-random-lines),
once we can sample.

## Continuous Probability

### Probability density functions

A continuous random variable ${tex`x`} is described by its **probability
density function** (pdf) ${tex`p`}, and we write ${tex`x \sim p`}:

${tex.block`\text{Probability}(x \in [a, b]) = \int_a^b p(x)\, dx, \qquad p(x) \ge 0, \qquad \int_{-\infty}^{\infty} p(x)\, dx = 1`}

The value ${tex`p(x)`} is a **relative** likelihood, not a probability: it
can exceed 1. If ${tex`p(x_1) = 6`} and ${tex`p(x_2) = 3`}, values near
${tex`x_1`} are twice as likely as values near ${tex`x_2`}. The **canonical
random number** ${tex`\xi`} is uniform on ${tex`[0, 1)`}, so
${tex`p(\xi) = 1`} there. It is what `Math.random()` returns.

### Expected value and variance

For ${tex`x \sim p`}, the **expected value** and **variance** are

${tex.block`E(f(x)) = \int f(x)\,p(x)\,dx, \qquad V(x) = E\big([x - E(x)]^2\big) = E(x^2) - [E(x)]^2`}

The first form of ${tex`V`} is easier to think about, and the second is
easier to compute. Scaling gives ${tex`V(cx) = c^2V(x)`}, and the
**standard deviation** ${tex`\sigma = \sqrt V`} is the typical size of the
deviation from the mean. Expectation is **linear even for correlated
variables**, a fact most of Monte Carlo rests on, while variances add only
for **uncorrelated** ones (independent variables, for example). Check both
with ${tex`x = \xi`} and a second variable that is either independent or
${tex`y = \xi^2`} of the same ${tex`\xi`}:

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

### Multidimensional random variables

On a space ${tex`S`} with measure ${tex`\mu`}, such as an area
(${tex`dA`}) or the directions on a unit sphere
(${tex`d\omega = \sin\theta\,d\theta\,d\phi`}, with ${tex`\theta`} the
polar angle from an axis and ${tex`\phi`} the azimuth around it):

${tex.block`\text{Probability}(\mathbf x \in S_i) = \int_{S_i} p(\mathbf x)\, d\mu, \qquad E\big(f(\mathbf x)\big) = \int_S f(\mathbf x)\, p(\mathbf x)\, d\mu`}

A point uniform on a disk of radius ${tex`R`} has
${tex`p = 1/(\pi R^2)`}. The chance that it lies in the inner half radius is

${tex.block`\int_0^{2\pi}\!\!\int_0^{R/2} \frac{1}{\pi R^2}\, r\, dr\, d\phi = 0.25`}

Here ${tex`\phi`} is uniform but ${tex`r`} is **not**. Uniform in area does
not mean uniform in each coordinate. The disk demo below measures this
0.25 directly.

### Estimated means and the law of large numbers

For independent, identically distributed (iid) samples,
${tex`\frac1N\sum x_i \to E(x)`}, and the variance of the
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
no ${tex`d`} in it. The density ${tex`p`} must be **positive wherever
${tex`g`} is nonzero**.

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
sample.

### Importance sampling

Importance sampling picks ${tex`p`} **shaped like** ${tex`g`} so that
${tex`g/p`} is nearly constant. If ${tex`p = g/I`} exactly (here
${tex`x/8`}; this needs ${tex`g \ge 0`}), the variance is **zero**, but
that requires knowing ${tex`I`}, the value being computed. A bad match is
worse than uniform: the
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

### Stratified sampling

Split the domain into ${tex`N`} strata ${tex`S_i`} of **equal probability**
and take **one sample in each**, drawn from ${tex`p_i`} (${tex`p`}
restricted to ${tex`S_i`} and renormalized). Each term estimates
${tex`\int_{S_i} g`}, so the estimate is a plain sum, and the variances of
the independent terms add:

${tex.block`I \approx \sum_{i=1}^N \frac{g(\mathbf x_i)}{p_i(\mathbf x_i)}, \qquad V = \sum_{i=1}^N V\left(\frac{g(\mathbf x_i)}{p_i(\mathbf x_i)}\right)`}

The variance is **never higher** than without stratification, and
**jittering** a pixel (one random point in each cell of a grid) is
stratified sampling. There is no general rate. The ${tex`21.3/N^3`} of the
running example comes from its smooth integrand; stratification helps most
when ${tex`g`} is smooth inside each stratum, and does not help at all for
white noise.

### Monte Carlo results for the running example

The measured variances match the reading's table. The last column is the
sample count needed for a standard error of 0.008 (0.1% of 8), computed
from the table's rounded variances:

```js echo
(() => {
  const N = 1000, m = (name) => mcMethods.find((d) => d.name.includes(name));
  const rows = [
    {method: m("(6 − x)").name, theory: "56.8/N", scale: N, est: () => mcEstimate(m("(6 − x)"), N), needed: "≈ 887,500"},
    {method: m("1/4").name, theory: "21.3/N", scale: N, est: () => mcEstimate(m("1/4"), N), needed: "≈ 332,800"},
    {method: m("(x + 2)").name, theory: "6.3/N", scale: N, est: () => mcEstimate(m("(x + 2)"), N), needed: "≈ 98,400"},
    {method: m("x/8").name, theory: "0", scale: N, est: () => mcEstimate(m("x/8"), N), needed: "1"},
    {method: "stratified  p = 1/4", theory: "21.3/N³", scale: N ** 3, est: () => stratifiedEstimate(N), needed: "70"}
  ];
  return Inputs.table(rows.map(({method, theory, scale, est, needed}) => ({
    method, theory, "measured (same units)": +(variance(d3.range(4000).map(est)) * scale).toFixed(1), "N for error 0.008": needed
  })), {sort: null});
})()
```

Stratified sampling is often far better than importance sampling, and the
two can be combined.

### Quasi–Monte Carlo

Replace random points with **quasi-random** points: deterministic, but
evenly spread, so that the number of points in any region ${tex`R`} of the
unit square is about ${tex`|R|\,N`}. The **radical inverse**
${tex`\Phi_b(k)`} mirrors the base-${tex`b`} digits of ${tex`k`} about the
radix point, for example ${tex`6 = 110_2 \mapsto 0.011_2 = 0.375`}. The
**Halton sequence** makes point ${tex`k`} equal to
${tex`(\Phi_2(k), \Phi_3(k), \dots)`}, with one prime base per dimension.
The **Hammersley set** is ${tex`(k/N, \Phi_2(k))`}, which needs ${tex`N`}
in advance.

```js echo
function radicalInverse(k, base) {
  let result = 0, f = 1 / base;
  for (let n = k; n > 0; n = Math.floor(n / base), f /= base) result += f * (n % base);
  return result;
}
const halton = (k) => ({x: radicalInverse(k, 2), y: radicalInverse(k, 3)});
const hammersley = (k, N) => ({x: k / N, y: radicalInverse(k, 2)});
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
    ["Hammersley", d3.range(n).map((k) => hammersley(k, n))]
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
but the regular grid's structure can **alias** (Module 06). Quasi-random points can
replace random ones **anywhere** a random point in ${tex`[0,1]^d`} is used.

## Choosing Random Points

### The problem: warping samples

The estimator needs samples ${tex`\mathbf x_i \sim p`} **and** the value
${tex`p(\mathbf x_i)`}. We can generate well-spread canonical pairs
${tex`(\xi_1, \xi_2)`} on the unit square, and we must **warp** them to
other domains and densities. For a disk, the naive mapping covers the disk
unevenly, as the demo below shows. We need a mapping that sends equal
areas to equal areas.

### Function inversion in 1D

To sample a density ${tex`p`}, compute its **cumulative distribution
function** ${tex`P`} and invert it, ${tex`x = P^{-1}(\xi)`}. This works
because

${tex.block`\text{Probability}\big(P^{-1}(\xi) < x\big) = \text{Probability}\big(\xi < P(x)\big) = P(x)`}

For ${tex`p(x) = \tfrac32x^2`} on ${tex`[-1,1]`},
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

For a 2D density with joint CDF ${tex`F(x, y)`}, pick ${tex`x`} from the
**marginal** CDF ${tex`F(x, y_{\max})`}, then pick ${tex`y`} from the
conditional CDF ${tex`F(x_i, y) / F(x_i, y_{\max})`}. If ${tex`p`} is
**separable**, ${tex`p(x, y) = g(x)\,h(y)`}, invert each dimension on its
own. A uniform disk is separable in ${tex`(r, \phi)`}, with
${tex`dA = r\,dr\,d\phi`}:

${tex.block`F(r_0, \phi_0) = \int_0^{\phi_0}\!\!\int_0^{r_0} \frac{r\, dr\, d\phi}{\pi R^2} = \frac{\phi_0}{2\pi}\cdot\frac{r_0^2}{R^2} \quad\Longrightarrow\quad \phi = 2\pi\xi_1, \quad r = R\sqrt{\xi_2}`}

The square root fixes the crowding of the naive ${tex`r = R\xi_2`}. Check
with the earlier probability: a uniform point lies in the inner half
radius with probability ${tex`0.25`}.

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

For diffuse and glossy reflection, sample a direction ${tex`\omega`} around
an axis ${tex`\mathbf w`} with density per solid angle
${tex`p(\omega) = \frac{n+1}{2\pi}\cos^n\theta`}, where ${tex`\theta`} is
the angle from ${tex`\mathbf w`}, ${tex`\phi`} the azimuth, and ${tex`n`} a
Phong-like exponent. Multiplying by ${tex`\sin\theta`} and integrating out
${tex`\phi`} gives the ${tex`\theta`}-CDF ${tex`1 - \cos^{n+1}\theta`}, so

${tex.block`\phi = 2\pi\xi_1, \qquad \theta = \arccos\left((1 - \xi_2)^{\frac{1}{n+1}}\right)`}

The direction is
${tex`\mathbf a = (\cos\phi\sin\theta,\ \sin\phi\sin\theta,\ \cos\theta)`} in
an orthonormal basis whose ${tex`\mathbf w`} is the lobe's axis, either the
normal or the mirror direction. For a lobe around the mirror direction,
discard directions below the surface. The left plot looks down on the
hemisphere (each direction's ${tex`x, y`}); the right compares the histogram
of ${tex`\theta`} with its exact density
${tex`(n+1)\cos^n\theta\sin\theta`}:

```js echo
const cosN = view(Inputs.range([0, 64], {value: 1, step: 1, label: "exponent n (0 = uniform, 1 = cosine)"}));
```

```js echo
function sampleCosPowerHemisphere(n, u1 = xi(), u2 = xi()) {
  const phi = 2 * Math.PI * u1, cosTheta = (1 - u2) ** (1 / (n + 1)), sinTheta = Math.sqrt(1 - cosTheta * cosTheta);
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
${tex`\mathbf a = (\cos 2\pi\xi_1\sqrt{\xi_2},\ \sin 2\pi\xi_1\sqrt{\xi_2},\ \sqrt{1 - \xi_2})`}.
Large ${tex`n`} concentrates samples in a narrow glossy lobe.

### Rejection sampling

Pick points in an easy region and **keep** those that land in the target.
For a disk, keep ${tex`(x,y)`} in ${tex`[-1,1]^2`} with
${tex`x^2 + y^2 < 1`}. The same idea samples any ${tex`p`} on
${tex`[a, b]`} with ${tex`p < M`}: pick points in
${tex`[a,b] \times [0,M]`} and keep those under the curve. Normalizing
points kept in the unit **ball** (52% accepted) gives uniform **directions**.

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
grid of candidates leaves an irregular set after rejection. Use it for
debugging or when nothing else works.

### Metropolis sampling

To sample in proportion to ${tex`f`} when you can only **evaluate** it (it
need not be normalized), start at any ${tex`\mathbf x`} with
${tex`f(\mathbf x) > 0`} and repeat:

1. Propose a move ${tex`\mathbf y \sim t(\mathbf x \to \mathbf y)`}.
2. Accept it with probability
   ${tex`a(\mathbf x \to \mathbf y) = \min\left(1,\ \frac{f(\mathbf y)\, t(\mathbf y \to \mathbf x)}{f(\mathbf x)\, t(\mathbf x \to \mathbf y)}\right)`}.
   Otherwise, keep ${tex`\mathbf x`}.

This balances the "flow" between every pair of points:
${tex`f(\mathbf x)\,t(\mathbf x \to \mathbf y)\,a(\mathbf x \to \mathbf y) = f(\mathbf y)\,t(\mathbf y \to \mathbf x)\,a(\mathbf y \to \mathbf x)`}.
For a **symmetric** proposal, such as the small Gaussian step below, the
${tex`t`} terms cancel and ${tex`a = \min(1, f(\mathbf y)/f(\mathbf x))`}.

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
Discard the early samples, as the code does. Metropolis Light Transport
uses the same idea on light paths.

## Example: Fair Random Lines

### A fair measure for lines

What does "a random line through the square" mean? A line is a **point in
a dual space**: slope and ${tex`y`}-intercept ${tex`(m, b)`}, or the angle
${tex`\phi \in (-\pi/2, \pi/2)`} it makes with the ${tex`x`}-axis and the
intercept, ${tex`(\phi, b)`}. But ${tex`dm\,db`} is unfair, and so is
${tex`d\phi\,db`}: a bundle of width ${tex`w`} at angle ${tex`\phi`} spans
${tex`w/\cos\phi`} of intercept, so steep bundles get too much weight. A
**fair** measure gives equal-width bundles of lines the same measure,
whatever their position or angle.

| Line parameters | Fair measure |
|---|---|
| angle–intercept ${tex`(\phi, b)`} | ${tex`\cos\phi\, d\phi\, db`} |
| slope–intercept ${tex`(m, b)`} | ${tex`dm\, db \,/\, (1 + m^2)^{3/2}`} (substitute ${tex`m = \tan\phi`}) |

### Normal coordinates for lines

In this section, ${tex`r`} and ${tex`\theta`} describe **lines**, not disks
or directions. Describe a line by its distance ${tex`r`} from the origin
and the angle ${tex`\theta`} of its normal:

${tex.block`x\cos\theta + y\sin\theta - r = 0, \qquad d\mu = dr\, d\theta`}

The measure of a set of lines is simply an **area** in ${tex`(r, \theta)`}
space, so fair lines are **uniform points** in that space.

### Lines in 3D

Lines in 3D are **4D** objects. A line crossing the ${tex`xy`} plane at
${tex`(x, y)`}, with direction at polar angle ${tex`\theta_d`} from the
${tex`z`}-axis and azimuth ${tex`\phi_d`}, has

${tex.block`d\mu = \lvert\cos\theta_d\rvert\; dx\,dy\; \sin\theta_d\,d\theta_d\,d\phi_d`}

The factor ${tex`\lvert\cos\theta_d\rvert\,dx\,dy`} is the bundle's
**cross-section**, the 3D version of the ${tex`\cos\phi`} in 2D. (The book
omits this factor.) Two uniform random points on a sphere give uniformly
distributed lines through it. Check: a fair line through a unit sphere
crosses a perpendicular disk uniformly by area, so it passes within half
the radius of the center with probability 0.25. The midpoint of the chord
is the line's closest point to the center:

```js echo
(() => {
  const onSphere = () => {
    const z = 2 * xi() - 1, s = Math.sqrt(1 - z * z), phi = 2 * Math.PI * xi();
    return [s * Math.cos(phi), s * Math.sin(phi), z];
  };
  const trials = 200000;
  let inner = 0;
  for (let t = 0; t < trials; t++) {
    const a = onSphere(), b = onSphere();
    if (Math.hypot(a[0] + b[0], a[1] + b[1], a[2] + b[2]) / 2 < 0.5) inner++;
  }
  return html`<pre>lines passing within half the radius: ${(inner / trials).toFixed(4)}   (exact 0.25)</pre>`;
})()
```

### Random lines through a square

For the unit square ${tex`[0,1]^2`} (origin at a corner,
${tex`r \ge 0`}, ${tex`\theta \in [-\pi, \pi)`}),
${tex`r_{\max}(\theta)`} is the distance of the farthest line at angle
${tex`\theta`} that still touches the square. Sample **uniformly under**
it: choose ${tex`\theta = P^{-1}(\xi_1)`} for
${tex`p(\theta) = r_{\max}(\theta)/4`}, then set
${tex`r = \xi_2\, r_{\max}(\theta)`}. The 4 is
${tex`\int r_{\max}\,d\theta`}, the square's **perimeter**. Inverting the
CDF piece by piece:

${tex.block`r_{\max}(\theta) = \begin{cases}
0 & \theta \in [-\pi, -\tfrac\pi2] \\
\cos\theta & \theta \in [-\tfrac\pi2, 0] \\
\sqrt2\cos(\theta - \tfrac\pi4) & \theta \in [0, \tfrac\pi2] \\
\sin\theta & \theta \in [\tfrac\pi2, \pi]
\end{cases}
\qquad
P(\theta) = \begin{cases}
0 \\
(1 + \sin\theta)/4 \\
\big(1 + \tfrac{\sqrt2}{2}\sin(\theta - \tfrac\pi4)\big)/2 \\
(3 - \cos\theta)/4
\end{cases}`}

${tex.block`\theta = \begin{cases}
\arcsin(4\xi_1 - 1) & \xi_1 < \tfrac14 \\
\arcsin\big(\sqrt2\,(2\xi_1 - 1)\big) + \tfrac\pi4 & \xi_1 \in [\tfrac14, \tfrac34] \\
\arccos(3 - 4\xi_1) & \xi_1 > \tfrac34
\end{cases}`}

**Book erratum:** the book prints ${tex`\tfrac{\sqrt2}{2}`} in the middle
branch; solving the middle ${tex`P`} gives ${tex`\sqrt2`}.

```js echo
function rMax(theta) {
  if (theta < -Math.PI / 2) return 0;
  if (theta < 0) return Math.cos(theta);
  if (theta < Math.PI / 2) return Math.SQRT2 * Math.cos(theta - Math.PI / 4);
  return Math.sin(theta);
}
function sampleTheta(u) {
  if (u < 1 / 4) return Math.asin(4 * u - 1);
  if (u <= 3 / 4) return Math.asin(Math.SQRT2 * (2 * u - 1)) + Math.PI / 4;
  return Math.acos(3 - 4 * u);
}
function fairLine() {
  const theta = sampleTheta(xi());
  return {theta, r: xi() * rMax(theta)};
}
// Naive: the line through two uniform random points of the square.
function naiveLine() {
  const a = {x: xi(), y: xi()}, b = {x: xi(), y: xi()};
  const theta = Math.atan2(b.x - a.x, -(b.y - a.y));   // the normal, perpendicular to b - a
  const r = a.x * Math.cos(theta) + a.y * Math.sin(theta);
  if (r >= 0) return {theta, r};
  return {theta: theta < 0 ? theta + Math.PI : theta - Math.PI, r: -r};   // the same line, with r ≥ 0
}
const hits = (line, c, radius) => Math.abs(c.x * Math.cos(line.theta) + c.y * Math.sin(line.theta) - line.r) < radius;
```

A test of fairness: the chance that a line hits a small disk should depend
only on the disk's size, **not on where the disk is**. In fact, the measure
of the lines hitting a convex shape is its perimeter, so a fair line hits a
disk of radius 0.06 with probability ${tex`2\pi(0.06)/4 \approx 9.42\%`}.

```js echo
const lineMethod = view(Inputs.radio(["fair: uniform in (r, θ)", "naive: through two random points"], {value: "fair: uniform in (r, θ)", label: "lines"}));
```

```js echo
(() => {
  const make = lineMethod.startsWith("fair") ? fairLine : naiveLine;
  const disks = [{x: 0.5, y: 0.5, label: "center"}, {x: 0.875, y: 0.875, label: "corner"}], radius = 0.06, trials = 40000;
  const counts = disks.map(() => 0);
  for (let t = 0; t < trials; t++) { const L = make(); disks.forEach((c, k) => { if (hits(L, c, radius)) counts[k]++; }); }
  const lines = d3.range(40).map(make);
  const dual = Plot.plot({width: 300, height: 260, x: {label: "θ", domain: [-Math.PI, Math.PI]}, y: {label: "r", domain: [0, 1.5]},
    marks: [Plot.dot(d3.range(1500).map(make), {x: "theta", y: "r", r: 1, fill: "steelblue"}),
      Plot.line(d3.range(-Math.PI, Math.PI, 0.01), {x: (t) => t, y: rMax, stroke: "crimson", strokeWidth: 2})]});
  const size = 260, x = d3.scaleLinear([0, 1], [10, size - 10]), y = d3.scaleLinear([0, 1], [size - 10, 10]);
  const svg = d3.create("svg").attr("viewBox", [0, 0, size, size]).attr("width", size).attr("height", size)
    .style("background", "var(--theme-background-alt, #f5f5f5)").style("border-radius", "8px");
  const clipId = `clip-${Math.random().toString(36).slice(2)}`;
  svg.append("clipPath").attr("id", clipId).append("rect").attr("x", x(0)).attr("y", y(1)).attr("width", x(1) - x(0)).attr("height", y(0) - y(1));
  const g = svg.append("g").attr("clip-path", `url(#${clipId})`);
  for (const L of lines) {
    const c = {x: L.r * Math.cos(L.theta), y: L.r * Math.sin(L.theta)}, d = {x: -Math.sin(L.theta), y: Math.cos(L.theta)};
    g.append("line").attr("x1", x(c.x - 3 * d.x)).attr("y1", y(c.y - 3 * d.y)).attr("x2", x(c.x + 3 * d.x)).attr("y2", y(c.y + 3 * d.y))
      .attr("stroke", "steelblue").attr("stroke-opacity", 0.6);
  }
  svg.append("rect").attr("x", x(0)).attr("y", y(1)).attr("width", x(1) - x(0)).attr("height", y(0) - y(1)).attr("fill", "none").attr("stroke", "gray");
  disks.forEach((c) => svg.append("circle").attr("cx", x(c.x)).attr("cy", y(c.y)).attr("r", x(radius) - x(0)).attr("fill", "orangered").attr("fill-opacity", 0.5));
  return row(dual, svg.node(), html`<pre style="align-self:center">${disks.map((c, k) => `lines hitting the ${c.label} disk: ${(100 * counts[k] / trials).toFixed(2)}%`).join("\n")}
(${trials} lines)</pre>`);
})()
```

Fair lines fill the region under ${tex`r_{\max}`} (red) evenly and hit both
disks equally often. Lines through two random points bunch up in
${tex`(r, \theta)`} space and favor the center: they are uniform in a
different measure. Inversion also keeps the samples **stratified**, so try
it before rejection or Metropolis.

## Sampling in WebGPU

```js echo
const {device, format: canvasFormat} = await initializeWebGPU(document.createElement("canvas"));   // a blank canvas: each demo adds its own below
const deviceErrorLog = document.createElement("pre");
deviceErrorLog.style.cssText = "display: none; color: #e5484d; background: #2a1214; border: 1px solid #e5484d; border-radius: 6px; padding: 8px 12px; font-size: 12px; white-space: pre-wrap;";
device.addEventListener("uncapturederror", (e) => { deviceErrorLog.textContent += `WebGPU error: ${e.error.message}\n`; deviceErrorLog.style.display = "block"; });
```

```js echo
deviceErrorLog
```

### Random numbers in a shader

WGSL has no `Math.random()`. Instead, **hash** the pixel position and the
frame number into a seed with the PCG hash, then draw ${tex`\xi`} values
from it. The seed is passed as a pointer, so each call advances the
caller's variable:

```js echo
const wgslRandom = `
fn pcg(v: u32) -> u32 {                          // PCG hash
  let state = v * 747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
fn rand(seed: ptr<function, u32>) -> f32 {      // canonical ξ in [0, 1)
  *seed = pcg(*seed);
  return f32(*seed >> 8u) / 16777216.0;         // 24 bits: never rounds up to 1.0
}`;
```

### Warping samples in WGSL

The warps from [Choosing Random Points](#choosing-random-points) port
directly to WGSL. `toWorld` builds a basis around a normal, which plays the
role of ${tex`\mathbf w`}:

```js echo
const wgslWarps = `
const PI = 3.14159265;

fn sampleCubic(xi: f32) -> f32 {                         // p(x) = 3x²/2
  let t = 2.0 * xi - 1.0;                                // pow needs a positive base
  return select(0.0, sign(t) * pow(abs(t), 1.0 / 3.0), t != 0.0);
}
fn sampleDisk(xi: vec2<f32>, R: f32) -> vec2<f32> {      // lens, area light
  let phi = 2.0 * PI * xi.x;
  let r = R * sqrt(xi.y);
  return vec2<f32>(r * cos(phi), r * sin(phi));
}
fn sampleCosineHemisphere(xi: vec2<f32>) -> vec3<f32> {  // pdf = cos θ / π
  let phi = 2.0 * PI * xi.x;
  let s = sqrt(xi.y);
  return vec3<f32>(cos(phi) * s, sin(phi) * s, sqrt(1.0 - xi.y));
}
fn toWorld(v: vec3<f32>, nrm: vec3<f32>) -> vec3<f32> {  // basis (t, b, nrm)
  // select(falseValue, trueValue, condition): pick a helper axis not parallel to nrm
  let a = select(vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(0.0, 1.0, 0.0), abs(nrm.x) > 0.9);
  let t = normalize(cross(a, nrm));
  let b = cross(nrm, t);
  return v.x * t + v.y * b + v.z * nrm;
}`;
```

The vertex shader below draws each point from its `vertex_index` alone: it
seeds `rand`, warps the pair, and outputs the position. All the sampling
runs on the GPU.

```js echo
const warpSize = 300;
const warpModule = device.createShaderModule({code: `${wgslRandom}${wgslWarps}
struct Params { mode: u32, seed: u32 };
@group(0) @binding(0) var<uniform> params: Params;

@vertex
fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  var seed = pcg(i + pcg(params.seed));
  let xi = vec2<f32>(rand(&seed), rand(&seed));
  var p: vec2<f32>;
  if (params.mode == 0u) { p = xi.y * vec2<f32>(cos(2.0 * PI * xi.x), sin(2.0 * PI * xi.x)); }  // naive disk
  else if (params.mode == 1u) { p = sampleDisk(xi, 1.0); }
  else if (params.mode == 2u) { p = sampleCosineHemisphere(xi).xy; }                            // top view
  else { p = vec2<f32>(sampleCubic(xi.x), 2.0 * xi.y - 1.0); }                                  // x warped, y uniform
  return vec4<f32>(0.95 * p, 0.0, 1.0);
}
@fragment
fn fs_main() -> @location(0) vec4<f32> { return vec4<f32>(0.4, 0.7, 1.0, 1.0); }`});
const warpPipeline = device.createRenderPipeline({
  layout: "auto",
  vertex: {module: warpModule, entryPoint: "vs_main"},
  fragment: {module: warpModule, entryPoint: "fs_main", targets: [{format: canvasFormat}]},
  primitive: {topology: "point-list"}
});
const warpUniforms = device.createBuffer({size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
const warpBindGroup = device.createBindGroup({layout: warpPipeline.getBindGroupLayout(0), entries: [{binding: 0, resource: {buffer: warpUniforms}}]});
const warpCanvas = document.createElement("canvas");
warpCanvas.width = warpCanvas.height = warpSize;
warpCanvas.style.borderRadius = "8px";
const {context: warpContext} = await initializeWebGPU(warpCanvas, {device});
const warpNames = ["naive disk: r = ξ₂", "sampleDisk", "sampleCosineHemisphere (top view)", "sampleCubic (x only)"];
```

```js echo
const warpForm = view(Inputs.form({
  warp: Inputs.select(warpNames, {value: "sampleDisk", label: "warp"}),
  points: Inputs.range([500, 50000], {value: 8000, step: 500, label: "points"})
}));
```

```js echo
{
  device.queue.writeBuffer(warpUniforms, 0, new Uint32Array([warpNames.indexOf(warpForm.warp), 1, 0, 0]));
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({colorAttachments: [{view: warpContext.getCurrentTexture().createView(), clearValue: {r: 0.08, g: 0.08, b: 0.1, a: 1}, loadOp: "clear", storeOp: "store"}]});
  pass.setPipeline(warpPipeline);
  pass.setBindGroup(0, warpBindGroup);
  pass.draw(warpForm.points);
  pass.end();
  device.queue.submit([encoder.finish()]);
}
```

```js echo
warpCanvas
```

### A jittered ray through a pixel

Module 10's `viewingRay(i, j, ...)` takes integer pixels, adds 0.5, and
counts ${tex`j`} up. Sampling needs a ray through **any** point `q` of the
image, given in pixel units with ${tex`y`} growing **down** like `id`. Here
`cam`, `Ray`, and `trace` follow Module 10, and `trace` is defined in the
ambient occlusion example below, where this function runs. The `seed` is
passed along for random bounce directions.

```js echo
const wgslRadiance = `
fn radiance(q: vec2<f32>, seed: ptr<function, u32>) -> vec3<f32> {
  let dims = vec2<f32>(${aoWidth}.0, ${aoHeight}.0);
  let us = cam.l + (cam.r - cam.l) * q.x / dims.x;             // no + 0.5: the jitter supplies it
  let vs = cam.b + (cam.t - cam.b) * (dims.y - q.y) / dims.y;  // continuous flip: ny − y
  return trace(Ray(cam.e, normalize(-cam.dist * cam.w + us * cam.u + vs * cam.v)), seed);
}`;
```

One sample is `radiance(vec2<f32>(id.xy) + vec2<f32>(rand(&seed), rand(&seed)), &seed)`.

### Stratified pixel samples

Jitter inside the pixel with `side` × `side` strata: each stratum is a
${tex`\tfrac{1}{\text{side}} \times \tfrac{1}{\text{side}}`} cell of the
pixel, with one random point inside. This is
[stratified sampling](#stratified-sampling) applied to a pixel. The shader
below estimates the coverage of each pixel of a **Siemens star**, whose thin
spokes alias badly. Its `inside(q)` plays the role of `radiance(q)`, with a
choice of pattern:

```js echo
const starSize = 300;
const starModule = device.createShaderModule({code: `${wgslRandom}${wgslHammersley}
struct Params { side: u32, mode: u32, seed: u32, pad: u32 };
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
  let side = params.side;
  let N = side * side;
  let shift = vec2<f32>(rand(&seed), rand(&seed));         // per-pixel random shift for Hammersley
  var covered = 0.0;
  for (var k = 0u; k < N; k++) {
    let cell = vec2<f32>(f32(k % side), f32(k / side));
    var offset: vec2<f32>;
    if (params.mode == 0u) { offset = (cell + 0.5) / f32(side); }                                   // regular
    else if (params.mode == 1u) { offset = (cell + vec2<f32>(rand(&seed), rand(&seed))) / f32(side); } // jittered
    else if (params.mode == 2u) { offset = vec2<f32>(rand(&seed), rand(&seed)); }                   // random
    else { offset = fract(hammersley(k, N) + shift); }                                              // Hammersley
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
const {context: starContext} = await initializeWebGPU(starCanvas, {device});
const starZoom = document.createElement("canvas");
starZoom.width = starZoom.height = 240;
starZoom.style.cssText = "border-radius: 8px; image-rendering: pixelated";
```

```js echo
const starForm = view(Inputs.form({
  side: Inputs.range([1, 8], {value: 1, step: 1, label: "side (side² samples per pixel)"}),
  pattern: Inputs.radio(["regular", "jittered", "random", "Hammersley"], {value: "regular", label: "pattern"})
}));
```

```js echo
{
  device.queue.writeBuffer(starUniforms, 0, new Uint32Array([starForm.side, ["regular", "jittered", "random", "Hammersley"].indexOf(starForm.pattern), 1, 0]));
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
row(caption(`side = ${starForm.side}, ${starForm.pattern}`, starCanvas), caption("zoom near the center (×5)", starZoom))
```

With one regular sample, the center shows false **moiré** patterns: the
spokes alias into structures that are not there. More regular samples
push the aliasing inward but keep its structure. Jittered, random, and
Hammersley samples turn it into **noise**, and jittered and Hammersley
have less noise than random.

### Quasi-random pixel samples

The **Hammersley** option above computes the base-2 radical inverse by bit
reversal, then shifts the shared pattern by a random offset per pixel, a
**Cranley–Patterson rotation**. Without the shift, every pixel uses the
same points, and the errors line up into visible patterns.

```js echo
const wgslHammersley = `
fn hammersley(k: u32, N: u32) -> vec2<f32> {
  return vec2<f32>(f32(k) / f32(N), f32(reverseBits(k) >> 8u) / 16777216.0);
}`;
```

Hardware **MSAA** (`multisample: {count: 4}`) is a render-pipeline feature: a
fixed rotated-grid pattern that antialiases triangle **edges**, shading once
per pixel by default. Shader sampling lets you choose the pattern and shade
every sample.

### Progressive accumulation

One sample per pixel per frame is cheap but noisy. Keeping a **running
mean** in a storage buffer turns successive frames into one estimate:
after ${tex`k + 1`} frames, it holds the mean of ${tex`k + 1`} samples, so
the noise falls as ${tex`1/\sqrt{k + 1}`}. The running mean
${tex`A_k = A_{k-1} + (c_k - A_{k-1})/(k+1)`} never stores a large sum, so
it avoids the precision loss of adding small values to a large total.

```js echo
const wgslAccumulate = `
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> accum: array<vec4<f32>>;   // A_k, one per pixel

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= ${aoWidth}u || id.y >= ${aoHeight}u) { return; }
  var seed = pcg(id.x + pcg(id.y + pcg(params.seed)));
  let c = vec4<f32>(radiance(vec2<f32>(id.xy) + vec2<f32>(rand(&seed), rand(&seed)), &seed), 1.0);   // c_k
  let i = id.y * ${aoWidth}u + id.x;
  if (params.frame == 0u) { accum[i] = c; }                                // start over: also clears old NaNs
  else { accum[i] += (c - accum[i]) / f32(params.frame + 1u); }            // running mean
}`;
```

On the host side, the buffer stays in floating point; only the displayed
copy is clamped to 8 bits. Set the frame back to 0 when the camera, scene,
or size changes, and recreate the buffer and bind groups when the size
changes. The compute entry point writes the buffer as `read_write`, and the
display entry point reads it as `read`. Each declares its own variable at
binding 1, which WGSL allows because no single entry point uses both. Two
explicit layouts describe the two views of the same buffer:

```js echo
const aoWidth = 400, aoHeight = 260;
const aoComputeLayout = device.createBindGroupLayout({entries: [
  {binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: {type: "uniform"}},
  {binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: {type: "storage"}}
]});
const aoDisplayLayout = device.createBindGroupLayout({entries: [
  {binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: {type: "read-only-storage"}}
]});
const aoParams = device.createBuffer({size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
const aoAccum = device.createBuffer({size: aoWidth * aoHeight * 16, usage: GPUBufferUsage.STORAGE});   // one vec4 per pixel
const aoComputeBindGroup = device.createBindGroup({layout: aoComputeLayout, entries: [
  {binding: 0, resource: {buffer: aoParams}}, {binding: 1, resource: {buffer: aoAccum}}]});
const aoDisplayBindGroup = device.createBindGroup({layout: aoDisplayLayout, entries: [{binding: 1, resource: {buffer: aoAccum}}]});
```

### Example: Ambient occlusion

**Ambient occlusion** is the visible fraction of the hemisphere
${tex`\Omega`} around the normal ${tex`\mathbf n`}, weighted by
${tex`\cos\theta`}. Here ${tex`\text{vis}(\omega) = 1`} if a ray in
direction ${tex`\omega`} escapes the scene and 0 if it hits something:

${tex.block`AO = \frac1\pi\int_\Omega \text{vis}(\omega)\cos\theta\,d\omega \qquad \Big(\textstyle\int_\Omega \cos\theta\, d\omega = \pi\Big)`}

With **cosine-weighted** directions (${tex`p = \cos\theta/\pi`}), the cosine
cancels in ${tex`g/p`}, so the estimator is just the fraction of rays that
escape. With **uniform** directions (${tex`p = 1/2\pi`}), each sample is
${tex`2\,\text{vis}(\omega)\cos\theta`}, which varies more. A compute shader
puts every piece together: `trace` finds the first hit, then shoots `rays`
AO rays from it.

```js echo
const aoModule = device.createShaderModule({code: `${wgslRandom}${wgslWarps}${wgslRadiance}
struct Params { frame: u32, mode: u32, rays: u32, seed: u32 };
struct Ray { o: vec3<f32>, d: vec3<f32> };
struct Camera { e: vec3<f32>, u: vec3<f32>, v: vec3<f32>, w: vec3<f32>, l: f32, r: f32, b: f32, t: f32, dist: f32 };

const camE = vec3<f32>(0.0, 1.9, 4.2);
const camW = normalize(camE - vec3<f32>(0.0, 0.5, 0.0));
const camU = normalize(cross(vec3<f32>(0.0, 1.0, 0.0), camW));
const cam = Camera(camE, camU, cross(camW, camU), camW, ${-0.55 * aoWidth / aoHeight}, ${0.55 * aoWidth / aoHeight}, -0.55, 0.55, 1.0);

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

fn occluded(o: vec3<f32>, d: vec3<f32>) -> bool {          // Module 10's shadow test, t1 = ∞
  return intersect(o, d).t < 1e29;
}

fn sampleDirection(xi: vec2<f32>, mode: u32) -> vec4<f32> {  // xyz = local direction, w = g/p when visible
  if (mode == 0u) { return vec4<f32>(sampleCosineHemisphere(xi), 1.0); }
  let phi = 2.0 * PI * xi.x;                                 // uniform: pdf = 1 / 2π
  let s = sqrt(1.0 - xi.y * xi.y);
  return vec4<f32>(cos(phi) * s, sin(phi) * s, xi.y, 2.0 * xi.y);  // (cos θ / π) / (1 / 2π) = 2 cos θ
}

fn trace(ray: Ray, seed: ptr<function, u32>) -> vec3<f32> {
  let hit = intersect(ray.o, ray.d);
  if (hit.t >= 1e29) { return vec3<f32>(0.75); }             // background
  let pos = ray.o + hit.t * ray.d;
  var open = 0.0;
  for (var k = 0u; k < params.rays; k++) {
    let s = sampleDirection(vec2<f32>(rand(seed), rand(seed)), params.mode);
    let d = toWorld(s.xyz, hit.n);
    open += select(s.w, 0.0, occluded(pos + 1e-3 * hit.n, d));  // vis(ω) × g/p factor
  }
  return vec3<f32>(open / f32(params.rays));
}
${wgslAccumulate}

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
const aoComputePipeline = device.createComputePipeline({
  layout: device.createPipelineLayout({bindGroupLayouts: [aoComputeLayout]}),
  compute: {module: aoModule, entryPoint: "main"}
});
const aoDisplayPipeline = device.createRenderPipeline({
  layout: device.createPipelineLayout({bindGroupLayouts: [aoDisplayLayout]}),
  vertex: {module: aoModule, entryPoint: "vs_main"},
  fragment: {module: aoModule, entryPoint: "fs_main", targets: [{format: canvasFormat}]}
});
const aoCanvas = document.createElement("canvas");
aoCanvas.width = aoWidth;
aoCanvas.height = aoHeight;
aoCanvas.style.borderRadius = "8px";
const {context: aoContext} = await initializeWebGPU(aoCanvas, {device});
const aoStatus = html`<pre style="margin:4px 0"></pre>`;
```

```js echo
const aoForm = view(Inputs.form({
  mode: Inputs.radio(["cosine-weighted", "uniform hemisphere"], {value: "cosine-weighted", label: "AO directions"}),
  rays: Inputs.range([1, 16], {value: 1, step: 1, label: "AO rays per sample (N)"}),
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
    device.queue.writeBuffer(aoParams, 0, new Uint32Array([aoForm.accumulate ? frame : 0, aoForm.mode === "cosine-weighted" ? 0 : 1, aoForm.rays, total + 1]));
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
- Raise **N**: 16 rays in one frame give about the same AO noise as one ray
  over 16 frames, at the cost of a slower frame.

## Check Your Understanding

1. Why do "random points in a square" chosen by random radius and angle give a different average of ${tex`x^2`}?
2. What is a fair measure for lines in normal coordinates, and how can you test it? (See *Example: Fair Random Lines*.)
3. If ${tex`x`} and ${tex`y`} are correlated, does ${tex`E(x + y) = E(x) + E(y)`}? Does ${tex`V(x + y) = V(x) + V(y)`}?
4. A Monte Carlo estimate has RMS error 0.04 with 100 samples. About how many samples give 0.01?
5. Why is ${tex`p = x/8`} perfect for ${tex`\int_0^4 x\,dx`}, and why can't you use that idea in general?
6. Derive the sampling formula for ${tex`p(x) = 2x`} on ${tex`[0,1]`}.
7. Why is ${tex`r = R\xi_2`} wrong for a uniform disk?
8. With cosine-weighted directions, why is each AO sample just 0 or 1?
9. Give one advantage of inversion over rejection, and one situation where Metropolis is the only option.
10. Why is the ${tex`(\phi, b)`} measure ${tex`d\phi\,db`} unfair for lines, and what fixes it?
11. Why shift the shared Hammersley points by a random offset in each pixel?

<details>
<summary>Answers</summary>

1. That method is uniform in ${tex`(r, \phi)`}, which is a different measure from area: it crowds points toward the center.
2. ${tex`dr\,d\theta`}. Count lines hitting small equal disks in different places: the rates should match.
3. Yes, expectation is always linear. Not in general: variances add only when the variables are uncorrelated, which independence guarantees.
4. ${tex`100 \times 4^2 = 1600`}.
5. ${tex`g/p = 8`} is constant, so the variance is zero. Building ${tex`p = g/I`} requires knowing ${tex`I`}, which is what you wanted to compute.
6. ${tex`P(x) = x^2`}, so ${tex`x = \sqrt\xi`}.
7. The area of a ring grows with ${tex`r`}, so equal steps in ${tex`r`} put too many points near the center. The area-preserving map is ${tex`r = R\sqrt{\xi_2}`}.
8. The ${tex`\cos\theta/\pi`} in the integrand cancels the pdf, leaving ${tex`\text{vis}(\omega)`}.
9. Inversion keeps stratification and wastes no samples. Metropolis works when you can evaluate ${tex`f`} but cannot integrate or invert it, such as light-path space.
10. A bundle of width ${tex`w`} at angle ${tex`\phi`} spans ${tex`w/\cos\phi`} of intercept, so steep bundles get too much weight. The factor ${tex`\cos\phi`} cancels this.
11. Without the shift, every pixel uses the same points, and the errors line up into visible patterns.

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

- **Measures** turn length and area into integrals, and averages depend on
  the measure chosen.
- **Probability:** pdfs, expected value (linear even for correlated
  variables), variance (additive only for uncorrelated ones), and the law
  of large numbers.
- **Monte Carlo:** ${tex`\int g \approx \frac1N\sum g(\mathbf x_i)/p(\mathbf x_i)`}
  with error ${tex`\propto 1/\sqrt N`}. Importance sampling,
  stratification, and quasi-random points reduce the variance.
- **Choosing points:** function inversion (disk: ${tex`r = R\sqrt\xi`};
  ${tex`\cos^n`} hemisphere), rejection, and Metropolis.
- **Fair random lines:** the fair measure is ${tex`dr\,d\theta`} in normal
  coordinates; sample uniformly under ${tex`r_{\max}(\theta)`} by inversion.
- **WebGPU:** hash-based random numbers, warping functions in WGSL, a ray
  through any point of a pixel, jittered or Hammersley pixel samples, and
  progressive accumulation in a compute shader, applied to ambient
  occlusion.
