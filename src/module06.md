---
title: Module 06 — Signal Processing
toc: true
---

```js echo
import * as raster from "./components/raster.js";
import * as d3 from "npm:d3";
import * as Inputs from "npm:@observablehq/inputs";
import {html} from "npm:htl";
```

# Module 06 · Signal Processing

Decimate a fine checkerboard and false patterns appear that were never
in the original. This module explains why that happens and how to
prevent it. We sample continuous functions,
reconstruct them, filter them with **convolution**, and use the
**Fourier transform** to explain why some filters work better than
others.

Every example is plain JavaScript on arrays, so no GPU is needed. Each
formula becomes a function you can call, and each
figure becomes a plot you can change with a slider. This handout teaches
the *techniques* behind signal processing; it is not a walkthrough of any
graded assignment.

## Sampled Representations

A computer cannot store a continuous function directly. It **stores
samples** and **reconstructs** the values in between when they are
needed:

| Device | Continuous original | Sampled version |
|---|---|---|
| Digital camera | image, ${tex`\mathbb{R}^2 \to C`} | pixel grid, ${tex`\mathbb{Z}^2 \to C`} |
| Pen tablet | stylus motion, ${tex`\mathbb{R} \to \mathbb{R}^2`} | positions, ${tex`\mathbb{Z} \to \mathbb{R}^2`} |
| Motion capture | marker path, ${tex`\mathbb{R} \to \mathbb{R}^3`} | positions, ${tex`\mathbb{Z} \to \mathbb{R}^3`} |
| CT scanner | body density, ${tex`\mathbb{R}^3 \to \mathbb{R}`} | voxel grid, ${tex`\mathbb{Z}^3 \to \mathbb{R}`} |

### Aliasing

When a sinusoid of frequency ${tex`f`} is sampled at rate ${tex`f_s`},
its samples are identical to those of a sinusoid whose frequency differs
from ${tex`f`} by a whole multiple of ${tex`f_s`}. The one we hear or see
is the lowest such frequency:

```js echo
// The frequency that sampling at rate fs turns f into: shift f by the
// nearest whole multiple of fs. The sign records a phase flip; the
// frequency you perceive is its absolute value.
function aliasOf(f, fs) {
  return f - Math.round(f / fs) * fs;
}
```

```js echo
const sineForm = view(Inputs.form({
  f: Inputs.range([0.2, 10], {value: 4.5, step: 0.1, label: "signal frequency (Hz)"}),
  fs: Inputs.range([1, 12], {value: 5, step: 0.25, label: "sample rate (Hz)"})
}));
```

```js echo
const sineAlias = aliasOf(sineForm.f, sineForm.fs);
const sineTimes = d3.range(0, 2.0001, 0.002);
const sineTrue = sineTimes.map((t) => ({t, y: Math.sin(2 * Math.PI * sineForm.f * t)}));
const sineAliasCurve = sineTimes.map((t) => ({t, y: Math.sin(2 * Math.PI * sineAlias * t)}));
const sineSamples = d3.range(0, 2.0001, 1 / sineForm.fs).map((t) => ({t, y: Math.sin(2 * Math.PI * sineForm.f * t)}));
```

```js echo
Plot.plot({
  height: 240,
  x: {label: "time t (s)"},
  y: {domain: [-1.15, 1.15], label: null},
  marks: [
    Plot.ruleY([0], {strokeOpacity: 0.2}),
    Plot.line(sineTrue, {x: "t", y: "y", stroke: "gray", strokeWidth: 1.5}),
    Plot.line(sineAliasCurve, {x: "t", y: "y", stroke: "orangered", strokeWidth: 2, strokeDasharray: "6,4"}),
    Plot.dot(sineSamples, {x: "t", y: "y", fill: "orangered", r: 4})
  ]
})
```

The gray curve is the original signal and the dots are its samples. The
dashed curve is the **lowest-frequency sinusoid that passes through the
same samples**, at ${Math.abs(sineAlias).toFixed(2)} Hz. The Nyquist
frequency is ${tex`f_s/2`} = ${(sineForm.fs / 2).toFixed(2)} Hz, so this
signal is **${sineForm.f < sineForm.fs / 2 ? "safely sampled: the dashed curve lies on top of the original" : "undersampled: the samples also fit a slower wave, and nothing can tell the two apart"}**.

### Hearing an alias

The classic audio example is a 10 kHz bell sampled at 8 kHz. The code
below builds exactly those samples and plays them. Your browser then
resamples the buffer to your speaker's rate using a good reconstruction
filter, so you hear only the frequency that the samples actually
contain. **Turn your volume down first.**

```js echo
function playSampledTone(freq, sampleRate, seconds = 1) {
  const ctx = new AudioContext();
  const n = Math.round(sampleRate * seconds);
  const buffer = ctx.createBuffer(1, n, sampleRate);
  const samples = buffer.getChannelData(0);
  const fadeLength = sampleRate * 0.05; // 50 ms fade in and out avoids clicks
  for (let i = 0; i < n; i++) {
    const fade = Math.min(1, i / fadeLength, (n - i) / fadeLength);
    samples[i] = 0.15 * fade * Math.sin(2 * Math.PI * freq * i / sampleRate);
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.onended = () => ctx.close();
  source.start();
}
```

```js echo
const toneForm = view(Inputs.form({
  freq: Inputs.range([200, 12000], {value: 10000, step: 100, label: "tone (Hz)"}),
  rate: Inputs.select([8000, 16000, 22050, 48000], {value: 8000, label: "sample rate (Hz)"})
}));
```

```js echo
html`<button onclick=${() => playSampledTone(toneForm.freq, toneForm.rate)}>▶ Play ${toneForm.freq} Hz sampled at ${toneForm.rate} Hz</button>`
```

A ${toneForm.freq} Hz tone sampled at ${toneForm.rate} Hz sounds like
**${Math.abs(aliasOf(toneForm.freq, toneForm.rate))} Hz**. Try 10 000 Hz
at 8000 Hz, then at 48 000 Hz. Sweep the tone upward at 8000 Hz as well:
above 4000 Hz, the pitch you hear goes *down*.

<div class="note">

The same rule holds for audio, images, and every other sampled signal in
graphics: **filter before sampling, and filter again during
reconstruction.** Everything in the rest of this module is a way to do
those two jobs well.

</div>

## Convolution

### Discrete convolution

A moving average replaces each sample with the average of its
neighbors. **Convolution** generalizes this to a *weighted* average,
using a second sequence ${tex`b`}, the **filter**:

${tex.block`(a \star b)[i] = \sum_j a[j]\, b[i-j]`}

Below, a sequence is any JavaScript function of an integer index, so it
can be infinitely long. A filter with finite support stores its
${tex`2r+1`} weights ${tex`b[-r..r]`}. `convolveAt` implements the
standard `convolve(a, b, i)` pseudocode:

```js echo
function discreteFilter(weights) {
  const r = (weights.length - 1) / 2;
  const w = Float64Array.from(weights);
  return {r, w, at: (k) => (Math.abs(k) <= r ? w[k + r] : 0)};
}

function convolveAt(a, b, i) {
  let s = 0;
  for (let j = i - b.r; j <= i + b.r; j++) s += a(j) * b.at(i - j);
  return s;
}

const boxDiscrete = (r) => discreteFilter(Array(2 * r + 1).fill(1 / (2 * r + 1)));
const binomial5 = discreteFilter([1, 4, 6, 4, 1].map((v) => v / 16));
const step = (i) => (i >= 0 ? 1 : 0);
```

**Box ⋆ step.** Convolving the unit step with the 5-point box
(${tex`r=2`}) gives the ramp
${tex`\tfrac15[\dots,0,0,1,2,3,4,5,5,\dots]`}:

```js echo
Inputs.table(d3.range(-4, 5).map((i) => {
  const value = convolveAt(step, boxDiscrete(2), i);
  return {i, "a[i]": step(i), "(a ⋆ b)[i]": value, "5 · (a ⋆ b)[i]": Math.round(5 * value)};
}), {format: {"(a ⋆ b)[i]": (v) => v.toFixed(2)}})
```

Now try other filters on a step. You can add noise to see how filtering
removes it:

```js echo
const smoothFilters = {
  "3-point box (r = 1)": boxDiscrete(1),
  "5-point box (r = 2)": boxDiscrete(2),
  "9-point box (r = 4)": boxDiscrete(4),
  "binomial [1 4 6 4 1] / 16": binomial5
};
// Fixed pseudo-random values, so the noise does not change on every redraw.
const noiseValues = (() => {
  const rand = d3.randomLcg(42);
  return d3.range(41).map(() => rand() * 2 - 1);
})();
```

```js echo
const smoothForm = view(Inputs.form({
  filter: Inputs.select(Object.keys(smoothFilters), {value: "5-point box (r = 2)", label: "filter b"}),
  noise: Inputs.range([0, 0.4], {value: 0, step: 0.01, label: "noise on the step"})
}));
```

```js echo
const noisyStep = (i) => step(i) + (Math.abs(i) <= 20 ? smoothForm.noise * noiseValues[i + 20] : 0);
const smoothRows = d3.range(-15, 16).map((i) => ({
  i,
  input: noisyStep(i),
  output: convolveAt(noisyStep, smoothFilters[smoothForm.filter], i)
}));
```

```js echo
Plot.plot({
  height: 240,
  x: {label: "i"},
  y: {label: null, domain: [-0.5, 1.5]},
  marks: [
    Plot.ruleY([0], {strokeOpacity: 0.2}),
    Plot.dot(smoothRows, {x: "i", y: "input", stroke: "gray", r: 3.5}),
    Plot.ruleX(smoothRows, {x: "i", y: "output", stroke: "steelblue", strokeWidth: 2}),
    Plot.dot(smoothRows, {x: "i", y: "output", fill: "steelblue", r: 3})
  ]
})
```

Gray circles show the input, and blue stems show ${tex`a \star b`}. A
wider filter produces a longer ramp and removes more noise, because
**blurring turns a sharp edge into a gradual one**. Every filter here
sums to 1, so the flat regions keep their level.

### Convolution behaves like multiplication

Convolution is **commutative**, **associative**, and **distributive**.
Because of associativity, three short filters can be combined into one
filter *before* they touch the signal. Combining two finite filters
produces a filter whose radius is the sum of their radii:

```js echo
function convolveFilters(b1, b2) {
  const r = b1.r + b2.r;
  return discreteFilter(d3.range(-r, r + 1).map((i) => convolveAt(b1.at, b2, i)));
}

const box3 = boxDiscrete(1);
const box3x2 = convolveFilters(box3, box3);
const box3x3 = convolveFilters(box3x2, box3);
```

- box₃ ⋆ box₃ = ${tex`\tfrac19`}[${Array.from(box3x2.w, (v) => Math.round(v * 9)).join(", ")}], which is a discrete tent.
- box₃ ⋆ box₃ ⋆ box₃ = ${tex`\tfrac1{27}`}[${Array.from(box3x3.w, (v) => Math.round(v * 27)).join(", ")}], which already looks like a Gaussian.

The following check filters a random signal three times and compares the
result with a single pass of the combined filter:

```js echo
const assocCheck = (() => {
  const rand = d3.randomLcg(7);
  const values = d3.range(200).map(() => rand());
  const a = (i) => (i >= 0 && i < 200 ? values[i] : 0);
  const pass1 = (i) => convolveAt(a, box3, i);
  const pass2 = (i) => convolveAt(pass1, box3, i);
  const threePasses = (i) => convolveAt(pass2, box3, i);
  const onePass = (i) => convolveAt(a, box3x3, i);
  const commuted = convolveFilters(binomial5, box3);
  const commutedBack = convolveFilters(box3, binomial5);
  return {
    maxDifference: d3.max(d3.range(-5, 205), (i) => Math.abs(threePasses(i) - onePass(i))),
    commuteDifference: d3.max(d3.range(commuted.w.length), (k) => Math.abs(commuted.w[k] - commutedBack.w[k]))
  };
})();
```

The largest difference between the two results is
${assocCheck.maxDifference.toExponential(1)}, which is floating-point
round-off. Filtering with `binomial5 ⋆ box3` and with `box3 ⋆ binomial5`
differs by at most ${assocCheck.commuteDifference.toExponential(1)}.

**The impulse is the identity.** The radius-0 filter
${tex`d = [\dots,0,1,0,\dots]`} leaves every sequence unchanged. That
lets us write "smooth, then subtract the result from the original" as a
single filter, ${tex`a - a \star b = a \star (d - b)`}:

```js echo
const impulse = discreteFilter([1]);
const highPass = discreteFilter([0, 0, 1, 0, 0].map((v, k) => v - binomial5.w[k]));
```

${tex`d - b`} = ${tex`\tfrac1{16}`}[${Array.from(highPass.w, (v) => Math.round(v * 16)).join(", ")}]. Its weights sum to
${d3.sum(highPass.w).toFixed(2)}, so it removes the smooth part of a
signal and keeps only the change. On the step, it gives
[${d3.range(-3, 4).map((i) => convolveAt(step, highPass, i).toFixed(3)).join(", ")}]
for ${tex`i = -3..3`}. This is an edge detector. Convolving the step with
${tex`d`} returns the step unchanged:
[${d3.range(-3, 4).map((i) => convolveAt(step, impulse, i)).join(", ")}].

### Continuous convolution

For continuous functions, the sum becomes an integral:

${tex.block`(f \star g)(x) = \int_{-\infty}^{+\infty} f(t)\, g(x-t)\, dt`}

The value at ${tex`x`} is the **area under the product** after flipping
${tex`g`} and sliding it so that its center lines up with ${tex`x`}. We compute the
integral numerically with the midpoint rule:

```js echo
function integrate(f, lo, hi, n = 4000) {
  const h = (hi - lo) / n;
  let s = 0;
  for (let k = 0; k < n; k++) s += f(lo + (k + 0.5) * h);
  return s * h;
}

// (f ⋆ g)(x), with f known to be zero outside [lo, hi].
function convolveContinuous(f, g, x, lo, hi, n = 2000) {
  return integrate((t) => f(t) * g(x - t), lo, hi, n);
}

const unitBox = (x) => (x >= -0.5 && x < 0.5 ? 1 : 0);
```

Slide ${tex`x`} to see why **box ⋆ box = tent**:

```js echo
const slideX = view(Inputs.range([-1.5, 1.5], {value: 0.4, step: 0.01, label: "x"}));
```

```js echo
const slideRows = d3.range(-2, 2.0001, 0.005).map((t) => ({
  t,
  f: unitBox(t),
  g: unitBox(slideX - t),
  product: unitBox(t) * unitBox(slideX - t)
}));
const slideValue = convolveContinuous(unitBox, unitBox, slideX, -0.5, 0.5);
const tentRows = d3.range(-1.5, 1.5001, 0.02).map((x) => ({
  x,
  numeric: convolveContinuous(unitBox, unitBox, x, -0.5, 0.5, 400),
  formula: Math.max(0, 1 - Math.abs(x))
}));
```

```js echo
raster.sideBySide([
  ["f(t), g(x − t), and the shaded product", Plot.plot({
    width: 320, height: 200, x: {label: "t"}, y: {domain: [0, 1.2], label: null},
    marks: [
      Plot.areaY(slideRows, {x: "t", y: "product", fill: "orange", fillOpacity: 0.5}),
      Plot.line(slideRows, {x: "t", y: "f", stroke: "gray", strokeWidth: 2}),
      Plot.line(slideRows, {x: "t", y: "g", stroke: "steelblue", strokeWidth: 2, strokeDasharray: "5,3"})
    ]
  })],
  ["(f ⋆ f)(x): numeric dots vs. 1 − |x|", Plot.plot({
    width: 320, height: 200, x: {label: "x"}, y: {domain: [0, 1.2], label: null},
    marks: [
      Plot.line(tentRows, {x: "x", y: "formula", stroke: "gray"}),
      Plot.dot(tentRows, {x: "x", y: "numeric", fill: "steelblue", r: 2}),
      Plot.ruleX([slideX], {stroke: "orange"})
    ]
  })]
])
```

At ${tex`x`} = ${slideX.toFixed(2)}, the shaded area is
${slideValue.toFixed(4)}, and ${tex`1-|x|`} =
${Math.max(0, 1 - Math.abs(slideX)).toFixed(4)}.

**The Dirac delta** ${tex`\delta`} is the continuous identity: an
infinitely narrow spike with area 1. We can approximate it with a box of
width ${tex`\varepsilon`} and height ${tex`1/\varepsilon`}, then watch
${tex`\delta_\varepsilon \star f`} approach ${tex`f`} as
${tex`\varepsilon`} shrinks:

```js echo
const epsilon = view(Inputs.range([0.02, 2], {value: 1, step: 0.01, label: "ε (spike width)"}));
```

```js echo
(() => {
  const f = (x) => Math.sin(3 * x) + 0.4 * Math.sin(9 * x);
  const deltaEps = (x) => (Math.abs(x) < epsilon / 2 ? 1 / epsilon : 0);
  const rows = d3.range(-3, 3.0001, 0.01).map((x) => ({
    x, f: f(x), smoothed: convolveContinuous(deltaEps, f, x, -epsilon / 2, epsilon / 2, 200)
  }));
  return Plot.plot({
    height: 200, x: {label: "x"}, y: {label: null},
    marks: [
      Plot.line(rows, {x: "x", y: "f", stroke: "gray"}),
      Plot.line(rows, {x: "x", y: "smoothed", stroke: "steelblue", strokeWidth: 2})
    ]
  });
})()
```

A wide spike is simply a box blur, which smears out the fast wiggle. As
${tex`\varepsilon \to 0`}, the blue curve converges to the gray one,
because ${tex`\delta \star f = f`}.

### Discrete–continuous convolution: reconstruction

**Reconstruction** turns samples back into a continuous function. It
convolves the samples with a *continuous* filter ${tex`f`}:

${tex.block`(a \star f)(x) = \sum_i a[i]\, f(x - i)`}

This implements `reconstruct(a, f, x)`. The loop bounds include
samples at a distance of exactly ${tex`r`}. Every continuous filter gives
those samples a weight of 0, but including them lets the half-open box
work too. (The filter library `filters` is defined in the next section.)

```js echo
function reconstruct(a, filter, x) {
  const r = filter.radius;
  let s = 0;
  for (let i = Math.ceil(x - r); i <= Math.floor(x + r); i++) s += a(i) * filter.f(x - i);
  return s;
}
```

A typical example is ${tex`x = 5.3`} with a radius-2 filter.
Catmull–Rom weights show which samples contribute (${tex`a[i] = 1`}
here, so the weights are also the terms):

```js echo
Inputs.table(d3.range(Math.ceil(5.3 - 2), Math.floor(5.3 + 2) + 1).map((i) => ({
  i, "x − i": 5.3 - i, "f(x − i)": filters.catmullRom.f(5.3 - i)
})), {format: {"x − i": (v) => v.toFixed(1), "f(x − i)": (v) => v.toFixed(4)}})
```

The four weights sum to
${d3.sum([4, 5, 6, 7], (i) => filters.catmullRom.f(5.3 - i)).toFixed(4)}.

**Reconstruction as a sum of shifted filters.** Each sample scatters one
copy of the filter, scaled by its value, and the reconstruction is the
sum of all the copies:

```js echo
const reconSamples = [1, 3, 2, 4, 3.5, 1.5, 2, 2.8, 1, 1.5];
const reconA = (i) => (i >= 0 && i < reconSamples.length ? reconSamples[i] : 0);
const reconFilterKey = view(Inputs.select(Object.keys(filters), {value: "tent", label: "filter f", format: (k) => filters[k].name}));
```

```js echo
(() => {
  const flt = filters[reconFilterKey];
  const xs = d3.range(-2.5, 11.5001, 0.01);
  const copies = reconSamples.flatMap((v, i) => xs.map((x) => ({x, y: v * flt.f(x - i), i})))
    .filter((d) => d.y !== 0);
  const sum = xs.map((x) => ({x, y: reconstruct(reconA, flt, x)}));
  return Plot.plot({
    height: 260, x: {label: "x"}, y: {label: null},
    color: {scheme: "tableau10"},
    marks: [
      Plot.ruleY([0], {strokeOpacity: 0.2}),
      Plot.line(copies, {x: "x", y: "y", z: "i", stroke: "i", strokeOpacity: 0.6}),
      Plot.line(sum, {x: "x", y: "y", stroke: "currentColor", strokeWidth: 2.5}),
      Plot.dot(reconSamples.map((v, i) => ({i, v})), {x: "i", y: "v", fill: "currentColor", r: 4})
    ]
  });
})()
```

With the **tent**, the sum of copies connects the dots: this is
**linear interpolation**. With the **box**, the result is a staircase
(nearest neighbor). The **B-spline** gives a smooth curve that does not
pass through the dots. Outside ${tex`0..9`}, the sequence is zero, so
every filter pulls the ends toward zero. We return to that edge problem
in the section on resampling.

**In 2D**, the sums become double sums. A radius-2 filter reconstructing
at ${tex`(5.3, 2.7)`} reads a ${tex`4 \times 4`} block of samples:
${d3.range(4, 8).flatMap((i) => d3.range(1, 5).map((j) => `(${i},${j})`)).join(" ")}.
This is the 16-sample neighborhood that bicubic image interpolation uses.

## Convolution Filters

Each filter is defined at its **natural radius** (the size for unit
sample spacing) and has area 1. Scaling a filter by ${tex`s`} uses
${tex`f_s(x) = f(x/s)/s`}. It stretches the filter by ${tex`s`} and
divides by ${tex`s`}, so the area stays at 1.

```js echo
// Piecewise cubics with natural radius 2, written piece by piece.
function fB(x) {
  const t = Math.abs(x);
  if (t <= 1) { const u = 1 - t; return (-3 * u ** 3 + 3 * u ** 2 + 3 * u + 1) / 6; }
  if (t <= 2) return (2 - t) ** 3 / 6;
  return 0;
}
function fC(x) {
  const t = Math.abs(x);
  if (t <= 1) { const u = 1 - t; return (-3 * u ** 3 + 4 * u ** 2 + u) / 2; }
  if (t <= 2) { const v = 2 - t; return (v ** 3 - v ** 2) / 2; }
  return 0;
}
function fM(x) {
  const t = Math.abs(x);
  if (t <= 1) { const u = 1 - t; return (-21 * u ** 3 + 27 * u ** 2 + 9 * u + 1) / 18; }
  if (t <= 2) { const v = 2 - t; return (7 * v ** 3 - 6 * v ** 2) / 18; }
  return 0;
}

// The Gaussian has infinite support; we trim it at radius trim·σ.
function gaussianFilter(sigma = 1, trim = 3) {
  const r = trim * sigma;
  return {
    name: `Gaussian (σ = ${sigma})`,
    radius: r,
    f: (x) => (Math.abs(x) <= r ? Math.exp(-(x * x) / (2 * sigma * sigma)) / (sigma * Math.sqrt(2 * Math.PI)) : 0)
  };
}

const filters = {
  box: {name: "Box", radius: 0.5, f: (x) => (x >= -0.5 && x < 0.5 ? 1 : 0)},
  tent: {name: "Tent", radius: 1, f: (x) => Math.max(0, 1 - Math.abs(x))},
  gaussian: gaussianFilter(1),
  bspline: {name: "B-spline", radius: 2, f: fB},
  catmullRom: {name: "Catmull–Rom", radius: 2, f: fC},
  mitchell: {name: "Mitchell–Netravali", radius: 2, f: fM}
};

function scaleFilter(filter, s) {
  return {name: filter.name, radius: filter.radius * s, f: (x) => filter.f(x / s) / s};
}
```

Two claims about these filters can be checked numerically:

```js echo
const filterChecks = {
  // f_M = f_B / 3 + 2 f_C / 3
  mitchellBlend: d3.max(d3.range(-2.5, 2.5, 0.001), (x) => Math.abs(fM(x) - (fB(x) / 3 + 2 * fC(x) / 3))),
  // f_B = box ⋆ box ⋆ box ⋆ box = tent ⋆ tent (a single integral)
  bsplineFromBoxes: d3.max([0, 0.3, 0.5, 1, 1.5, 1.9], (x) => Math.abs(
    convolveContinuous(filters.tent.f, filters.tent.f, x, -1, 1) - fB(x)))
};
```

- ${tex`\left|f_M - (\tfrac13 f_B + \tfrac23 f_C)\right|`} ≤ ${filterChecks.mitchellBlend.toExponential(1)}.
- ${tex`\left|\text{tent} \star \text{tent} - f_B\right|`} ≤ ${filterChecks.bsplineFromBoxes.toExponential(1)}, so the B-spline really is four boxes convolved together.

### A gallery of filters

```js echo
const galleryForm = view(Inputs.form({
  shown: Inputs.checkbox(Object.keys(filters), {value: ["box", "tent", "bspline", "catmullRom"], label: "filters", format: (k) => filters[k].name}),
  s: Inputs.range([0.5, 3], {value: 1, step: 0.05, label: "scale s"})
}));
```

```js echo
const galleryRows = galleryForm.shown.flatMap((key) => {
  const scaled = scaleFilter(filters[key], galleryForm.s);
  return d3.range(-6, 6.0001, 0.01).map((x) => ({x, y: scaled.f(x), name: scaled.name}));
});
```

```js echo
Plot.plot({
  height: 260,
  x: {label: "x", domain: [-6, 6]},
  y: {label: null},
  color: {legend: true},
  marks: [
    Plot.ruleY([0], {strokeOpacity: 0.3}),
    Plot.line(galleryRows, {x: "x", y: "y", stroke: "name", z: "name", strokeWidth: 2})
  ]
})
```

```js echo
Inputs.table(galleryForm.shown.map((key) => {
  const scaled = scaleFilter(filters[key], galleryForm.s);
  return {filter: scaled.name, radius: scaled.radius, area: integrate(scaled.f, -scaled.radius, scaled.radius)};
}), {format: {radius: (v) => v.toFixed(2), area: (v) => v.toFixed(4)}})
```

As ${tex`s`} grows, each filter gets wider and shorter, and its area
stays 1. The trimmed Gaussian's area is 0.9973, which is the fraction of
a normal distribution that lies within ±3σ.

### Filter properties, measured

A table of filter properties can be computed rather than memorized. A
filter is **interpolating** when ${tex`f(0)=1`} and ${tex`f(i)=0`} for
nonzero integers. It **rings** when it has negative values. It is
**ripple-free** when ${tex`\sum_i f(x+i) = 1`} for every ${tex`x`}:

```js echo
// Worst deviation from 1 when reconstructing the constant sequence 1 with
// filter f scaled by s: max over x of |Σ f_s(x − i) − 1|.
function rippleOf(filter, s = 1, samples = 400) {
  const scaled = scaleFilter(filter, s);
  let worst = 0;
  for (let k = 0; k < samples; k++) {
    worst = Math.max(worst, Math.abs(reconstruct(() => 1, scaled, k / samples) - 1));
  }
  return worst;
}
```

```js echo
Inputs.table(Object.values(filters).map((flt) => {
  const minValue = d3.min(d3.range(-flt.radius, flt.radius, 0.001), flt.f);
  const [f0, f1, f2] = [flt.f(0), flt.f(1), flt.f(2)];
  const ripple = rippleOf(flt);
  return {
    filter: flt.name,
    "natural radius": flt.radius,
    "f(0)": f0, "f(1)": f1, "f(2)": f2,
    interpolating: Math.abs(f0 - 1) < 1e-9 && Math.abs(f1) < 1e-9 && Math.abs(f2) < 1e-9 ? "yes" : "no",
    "min value": minValue,
    ringing: minValue < -1e-9 ? "yes" : "no",
    ripple,
    "ripple-free": ripple < 1e-6 ? "yes" : "no"
  };
}), {
  format: {
    "f(0)": (v) => v.toFixed(3), "f(1)": (v) => v.toFixed(3), "f(2)": (v) => v.toFixed(3),
    "min value": (v) => v.toFixed(4), ripple: (v) => v.toExponential(1)
  }
})
```

The table confirms the usual summary. **Box** and **tent** interpolate without
ringing. The **B-spline** does not ring, but it misses the samples,
because ${tex`f_B(0) = \tfrac23`}. **Catmull–Rom** interpolates, but it
rings. **Mitchell–Netravali** sits between the two, with slight ringing.
The trimmed **Gaussian** is the only filter here that is not ripple-free.
**Continuity** is easiest to see in the gallery: the box jumps, the tent
has corners (${tex`C^0`}), Catmull–Rom and Mitchell–Netravali are
${tex`C^1`}, and the B-spline is the smoothest (${tex`C^2`}).

### Interpolating vs. smooth

Reconstruct a step with each filter:

```js echo
const interpShown = view(Inputs.checkbox(["tent", "bspline", "catmullRom", "mitchell"], {
  value: ["bspline", "catmullRom"], label: "reconstruct with", format: (k) => filters[k].name
}));
```

```js echo
const interpRows = interpShown.flatMap((key) =>
  d3.range(-5, 5.0001, 0.01).map((x) => ({x, y: reconstruct(step, filters[key], x), name: filters[key].name})));
```

```js echo
Plot.plot({
  height: 240, x: {label: "x"}, y: {label: null}, color: {legend: true},
  marks: [
    Plot.ruleY([0, 1], {strokeOpacity: 0.2}),
    Plot.line(interpRows, {x: "x", y: "y", stroke: "name", z: "name", strokeWidth: 2}),
    Plot.dot(d3.range(-5, 6).map((i) => ({i, v: step(i)})), {x: "i", y: "v", fill: "currentColor", r: 3.5})
  ]
})
```

```js echo
Inputs.table(interpShown.map((key) => {
  const ys = d3.range(-5, 5.0001, 0.01).map((x) => reconstruct(step, filters[key], x));
  return {filter: filters[key].name, "max (overshoot above 1)": d3.max(ys), "min (undershoot below 0)": d3.min(ys), "value at x = 0": reconstruct(step, filters[key], 0)};
}), {format: {"max (overshoot above 1)": (v) => v.toFixed(4), "min (undershoot below 0)": (v) => v.toFixed(4), "value at x = 0": (v) => v.toFixed(4)}})
```

Catmull–Rom passes through every dot, but it overshoots and undershoots
near the step. The B-spline never leaves ${tex`[0,1]`}, but at
${tex`x=0`} it gives ${tex`\tfrac56`} instead of 1.

### Ripple

Every filter above except the Gaussian is ripple-free at its natural
radius. None of them is guaranteed to be ripple-free at a **non-integer
scale**. Reconstruct the constant sequence ${tex`a[i]=1`} and look for
wobble:

```js echo
const rippleChoices = {
  "Tent": filters.tent,
  "Box": filters.box,
  "B-spline": filters.bspline,
  "Catmull–Rom": filters.catmullRom,
  "Mitchell–Netravali": filters.mitchell,
  "Gaussian σ = ½": gaussianFilter(0.5),
  "Gaussian σ = 1": filters.gaussian
};
const rippleForm = view(Inputs.form({
  filter: Inputs.select(Object.keys(rippleChoices), {value: "Tent", label: "filter"}),
  s: Inputs.range([0.5, 2.5], {value: 1.25, step: 0.05, label: "scale s"}),
  renormalize: Inputs.toggle({label: "divide by the weight sum", value: false})
}));
```

```js echo
const rippleScaled = scaleFilter(rippleChoices[rippleForm.filter], rippleForm.s);
// For a ≡ 1, the weighted sum Σ a[i] f(x − i) and the weight sum Σ f(x − i)
// are the same number, so renormalizing makes the result exactly 1.
const rippleRows = d3.range(0, 6.0001, 0.005).map((x) => {
  const weighted = reconstruct(() => 1, rippleScaled, x);
  return {x, y: rippleForm.renormalize ? weighted / weighted : weighted};
});
```

```js echo
Plot.plot({
  height: 200, x: {label: "x"}, y: {label: "reconstruction of a ≡ 1", domain: [0.8, 1.2]},
  marks: [Plot.ruleY([1], {strokeOpacity: 0.3}), Plot.line(rippleRows, {x: "x", y: "y", stroke: "steelblue", strokeWidth: 2})]
})
```

Worst deviation from 1: **${(d3.max(rippleRows, (d) => Math.abs(d.y - 1)) * 100).toFixed(2)}%**.
Try the Gaussian with σ = ½ at ${tex`s = 1`}; it ripples by about ±1.4%.
Then try the tent at ${tex`s = 1.25`}. Turning on the division by the
weight sum removes the ripple:

${tex.block`(a \star f)(x) = \frac{\sum_i a[i]\, f(x-i)}{\sum_i f(x-i)}`}

For a constant sequence, the numerator and denominator are the same sum,
so the result is exactly 1. For any other sequence, the division still
cancels the filter's wobble.

### Separable filters

Most 2D filters are built from a 1D filter:
${tex`b_2[i,j] = b_1[i]\, b_1[j]`}. Filtering then splits into a vertical
pass and a horizontal pass, and the cost per pixel drops from
${tex`(2r+1)^2`} to ${tex`2(2r+1)`}. The helpers below work on floating
point RGB images and clamp coordinates at the borders. Clamping is one of
the edge strategies discussed later. A simpler `filterImage` would trim
the border instead.

```js echo
function toFloatImage(imageData) {
  const {width: W, height: H, data} = imageData;
  const out = new Float32Array(W * H * 3);
  for (let p = 0, q = 0; p < data.length; p += 4, q += 3) {
    out[q] = data[p]; out[q + 1] = data[p + 1]; out[q + 2] = data[p + 2];
  }
  return {width: W, height: H, data: out};
}

function fromFloatImage({width: W, height: H, data}) {
  const out = new ImageData(W, H);
  for (let p = 0, q = 0; q < data.length; p += 4, q += 3) {
    out.data[p] = data[q]; out.data[p + 1] = data[q + 1]; out.data[p + 2] = data[q + 2]; out.data[p + 3] = 255;
  }
  return out;
}

function showImage(img, scale = 1) {
  return raster.renderImageData(fromFloatImage(img), {scale});
}

// A discrete Gaussian: the continuous one sampled at integers k = −r..r and
// normalized so the weights sum to exactly 1.
function gaussianWeights(sigma, r = Math.ceil(3 * sigma - 1e-9)) {
  const w = Float64Array.from(d3.range(-r, r + 1), (k) => Math.exp(-(k * k) / (2 * sigma * sigma)));
  const total = d3.sum(w);
  return w.map((v) => v / total);
}

// One 1D pass along x (axis 0) or y (axis 1), with weights w[k + r] = b[k].
// edge: "clamp" repeats the border pixel, "zero" pads with black, and
// "renormalize" drops out-of-bounds taps and divides by the weights left.
function filterPass(img, w, axis, edge = "clamp") {
  const {width: W, height: H, data} = img;
  const r = (w.length - 1) / 2;
  const n = axis === 0 ? W : H;
  const out = new Float32Array(data.length);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const pos = axis === 0 ? x : y;
      let s0 = 0, s1 = 0, s2 = 0, wsum = 0;
      for (let k = -r; k <= r; k++) {
        let p = pos - k; // out[i] = Σ_k a[i − k] b[k]
        if (p < 0 || p >= n) {
          if (edge !== "clamp") continue;
          p = p < 0 ? 0 : n - 1;
        }
        const wk = w[k + r];
        const idx = 3 * (axis === 0 ? y * W + p : p * W + x);
        s0 += data[idx] * wk; s1 += data[idx + 1] * wk; s2 += data[idx + 2] * wk;
        wsum += wk;
      }
      const norm = edge === "renormalize" && wsum !== 0 ? wsum : 1;
      const o = 3 * (y * W + x);
      out[o] = s0 / norm; out[o + 1] = s1 / norm; out[o + 2] = s2 / norm;
    }
  }
  return {width: W, height: H, data: out};
}

// Vertical pass, then horizontal pass. wy defaults to wx (a symmetric 2D filter).
function filterSeparable(img, wx, edge = "clamp", wy = wx) {
  return filterPass(filterPass(img, wy, 1, edge), wx, 0, edge);
}

// The same filter applied directly as a (2r+1) × (2r+1) mask, for comparison.
function filterDirect(img, w) {
  const {width: W, height: H, data} = img;
  const r = (w.length - 1) / 2;
  const out = new Float32Array(data.length);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let s0 = 0, s1 = 0, s2 = 0;
      for (let j = -r; j <= r; j++) {
        const py = Math.min(H - 1, Math.max(0, y - j));
        for (let i = -r; i <= r; i++) {
          const px = Math.min(W - 1, Math.max(0, x - i));
          const wk = w[i + r] * w[j + r];
          const idx = 3 * (py * W + px);
          s0 += data[idx] * wk; s1 += data[idx + 1] * wk; s2 += data[idx + 2] * wk;
        }
      }
      const o = 3 * (y * W + x);
      out[o] = s0; out[o + 1] = s1; out[o + 2] = s2;
    }
  }
  return {width: W, height: H, data: out};
}

const testFloat = toFloatImage(raster.toImageData(raster.createTestImage(160, 120)));
```

Time both versions on the same Gaussian:

```js echo
const sepRadius = view(Inputs.range([1, 12], {value: 4, step: 1, label: "Gaussian radius r (σ = r / 3)"}));
```

```js echo
const sepResult = (() => {
  const w = gaussianWeights(sepRadius / 3, sepRadius);
  let t = performance.now();
  const direct = filterDirect(testFloat, w);
  const directMs = performance.now() - t;
  t = performance.now();
  const separable = filterSeparable(testFloat, w);
  const separableMs = performance.now() - t;
  let maxDiff = 0;
  for (let k = 0; k < direct.data.length; k++) maxDiff = Math.max(maxDiff, Math.abs(direct.data[k] - separable.data[k]));
  return {direct, separable, directMs, separableMs, maxDiff};
})();
```

```js echo
raster.sideBySide([
  [`direct: ${(2 * sepRadius + 1) ** 2} products/pixel, ${sepResult.directMs.toFixed(1)} ms`, showImage(sepResult.direct, 2)],
  [`separable: ${2 * (2 * sepRadius + 1)} products/pixel, ${sepResult.separableMs.toFixed(1)} ms`, showImage(sepResult.separable, 2)]
])
```

The two images match to within ${sepResult.maxDiff.toExponential(1)}
(out of 255). The cost gap grows as ${tex`O(r^2)`} vs. ${tex`O(r)`}.
At ${tex`r = 12`}, the direct version does
${(625 / 50).toFixed(1)}× as many multiplications.

## Signal Processing for Images

### Blurring and sharpening

**Blurring** is convolution with a low-pass filter, usually a Gaussian.
**Unsharp masking** subtracts a fraction ${tex`\alpha`} of a blurred copy
and rescales. By the distributive law and the impulse ${tex`d`}, the
whole operation is a single filter:

${tex.block`I_{\text{sharp}} = (1+\alpha)\,I - \alpha\,(I \star f_{g,\sigma}) = I \star \big((1+\alpha)\,d - \alpha\, f_{g,\sigma}\big)`}

```js echo
const sharpForm = view(Inputs.form({
  sigma: Inputs.range([0.5, 4], {value: 1.5, step: 0.1, label: "Gaussian σ (pixels)"}),
  alpha: Inputs.range([0, 3], {value: 1.2, step: 0.05, label: "sharpening amount α"})
}));
```

```js echo
function combineImages(a, b, fn) {
  return {width: a.width, height: a.height, data: a.data.map((v, k) => fn(v, b.data[k]))};
}
const blurred = filterSeparable(testFloat, gaussianWeights(sharpForm.sigma));
const sharpened = combineImages(testFloat, blurred, (orig, blur) => (1 + sharpForm.alpha) * orig - sharpForm.alpha * blur);
```

```js echo
raster.sideBySide([
  ["original", showImage(testFloat, 2)],
  [`Gaussian blur, σ = ${sharpForm.sigma}`, showImage(blurred, 2)],
  [`unsharp mask, α = ${sharpForm.alpha}`, showImage(sharpened, 2)]
])
```

```js echo
(() => {
  const g = gaussianWeights(sharpForm.sigma);
  const r = (g.length - 1) / 2;
  const kernel = Array.from(g, (v, k) => ({k: k - r, w: (k === r ? 1 + sharpForm.alpha : 0) - sharpForm.alpha * v}));
  // The green channel down column 60, across the sky/grass edge near y = 73.
  const column = d3.range(55, 92).map((y) => ({
    y,
    original: testFloat.data[3 * (y * 160 + 60) + 1],
    sharpened: sharpened.data[3 * (y * 160 + 60) + 1]
  }));
  return raster.sideBySide([
    [`1D slice of f_sharp (weights sum to ${d3.sum(kernel, (d) => d.w).toFixed(3)})`, Plot.plot({
      width: 300, height: 200, x: {label: "k"}, y: {label: null},
      marks: [Plot.ruleY([0], {strokeOpacity: 0.3}), Plot.ruleX(kernel, {x: "k", y: "w", stroke: "steelblue", strokeWidth: 2}), Plot.dot(kernel, {x: "k", y: "w", fill: "steelblue"})]
    })],
    ["green channel across the horizon", Plot.plot({
      width: 340, height: 200, x: {label: "row y"}, y: {label: null},
      marks: [
        Plot.line(column, {x: "y", y: "original", stroke: "gray", strokeWidth: 2}),
        Plot.line(column, {x: "y", y: "sharpened", stroke: "orangered", strokeWidth: 2}),
        Plot.ruleY([0, 255], {strokeOpacity: 0.2})
      ]
    })]
  ]);
})()
```

The filter is a tall positive spike surrounded by a shallow negative
Gaussian, and it still sums to 1. Across an edge, the dark side gets
darker and the bright side gets brighter (orange vs. gray), which makes
the edge look crisper. Large values of ${tex`\alpha`} push pixels past
0 or 255, and they clip.

### Drop shadows

A **shift** is convolution with an off-center impulse ${tex`d_{m,n}`}.
A soft drop shadow is a shifted, blurred copy of the object's mask. By
associativity, the shift and the blur combine into **one** filter with
three parameters. That filter is still separable: a Gaussian whose
center has moved by ${tex`m`} along ${tex`x`} and by ${tex`n`} along
${tex`y`}.

```js echo
const shadowForm = view(Inputs.form({
  m: Inputs.range([-12, 12], {value: 5, step: 1, label: "shift m (x)"}),
  n: Inputs.range([-12, 12], {value: 5, step: 1, label: "shift n (y)"}),
  sigma: Inputs.range([0.5, 6], {value: 2.5, step: 0.1, label: "blur σ"})
}));
```

```js echo
// d_m ⋆ g: the weights of g moved m taps to the right.
function shiftWeights(w, m) {
  const r = (w.length - 1) / 2;
  const R = r + Math.abs(m);
  const out = new Float64Array(2 * R + 1);
  for (let k = -r; k <= r; k++) out[k + m + R] = w[k + r];
  return out;
}

const shadowMask = (() => {
  const canvas = document.createElement("canvas");
  canvas.width = 300;
  canvas.height = 110;
  const ctx = canvas.getContext("2d");
  ctx.font = "bold 64px sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText("CS 4280", 28, 55);
  const {data} = ctx.getImageData(0, 0, 300, 110);
  const mask = new Float32Array(300 * 110 * 3);
  for (let p = 0; p < 300 * 110; p++) mask[3 * p] = mask[3 * p + 1] = mask[3 * p + 2] = data[4 * p + 3] / 255;
  return {width: 300, height: 110, data: mask};
})();
```

```js echo
(() => {
  const g = gaussianWeights(shadowForm.sigma);
  const shadow = filterSeparable(shadowMask, shiftWeights(g, shadowForm.m), "zero", shiftWeights(g, shadowForm.n));
  const background = [238, 236, 230], ink = [61, 111, 196];
  const out = {width: 300, height: 110, data: new Float32Array(300 * 110 * 3)};
  for (let p = 0; p < 300 * 110; p++) {
    const coverage = shadowMask.data[3 * p], shade = 1 - 0.6 * shadow.data[3 * p];
    for (let c = 0; c < 3; c++) out.data[3 * p + c] = ink[c] * coverage + background[c] * shade * (1 - coverage);
  }
  return showImage(out);
})()
```

This uses one separable convolution per axis, whose filters are
${tex`d_m \star g`} and ${tex`d_n \star g`}. No separate shift step is
needed.

### Antialiasing in image synthesis

A renderer, such as a ray tracer, can evaluate the image at **any**
point. The **zone plate** below is a good test pattern. Its rings get
closer together as the radius grows. The local frequency reaches the
pixel grid's Nyquist limit (0.5 cycles per pixel) halfway to the edge,
and a full cycle per pixel at the edge.

```js echo
const zoneSize = 200;
// Frequency grows linearly with radius: `peak` cycles/pixel at radius size / 2.
function zonePlate(x, y, size = zoneSize, peak = 1) {
  const dx = x - size / 2, dy = y - size / 2;
  return 0.5 + 0.5 * Math.cos((Math.PI * peak * (dx * dx + dy * dy)) / (size / 2));
}

// Render the zone plate, averaging n × n sub-samples per pixel.
// "point": one sample at each pixel center.
// "box": equal weights over the pixel's own 1 × 1 square.
// "gaussian": Gaussian weights (σ = 0.5 px) over a 3 × 3 pixel area.
function renderZonePlate(method, n) {
  const img = {width: zoneSize, height: zoneSize, data: new Float32Array(zoneSize * zoneSize * 3)};
  const span = method === "gaussian" ? 3 : 1;
  const count = method === "point" ? 1 : n * span;
  for (let py = 0; py < zoneSize; py++) {
    for (let px = 0; px < zoneSize; px++) {
      let sum = 0, wsum = 0;
      for (let b = 0; b < count; b++) {
        for (let a = 0; a < count; a++) {
          const ox = method === "point" ? 0.5 : ((a + 0.5) / count) * span - (span - 1) / 2;
          const oy = method === "point" ? 0.5 : ((b + 0.5) / count) * span - (span - 1) / 2;
          const d2 = (ox - 0.5) ** 2 + (oy - 0.5) ** 2;
          const w = method === "gaussian" ? Math.exp(-d2 / (2 * 0.25)) : 1;
          sum += w * zonePlate(px + ox, py + oy);
          wsum += w;
        }
      }
      const v = (255 * sum) / wsum, o = 3 * (py * zoneSize + px);
      img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
    }
  }
  return img;
}
```

```js echo
const zoneSamples = view(Inputs.range([1, 6], {value: 4, step: 1, label: "sub-samples per pixel side"}));
```

```js echo
raster.sideBySide([
  ["point sampling", showImage(renderZonePlate("point", 1))],
  [`box filter (${zoneSamples}×${zoneSamples} per pixel)`, showImage(renderZonePlate("box", zoneSamples))],
  ["Gaussian filter (σ = 0.5 px)", showImage(renderZonePlate("gaussian", zoneSamples))]
])
```

Point sampling produces strong **moiré**. The false rings near the edges
are aliases, because the pattern there is finer than the grid can
represent. The box filter improves things but leaves visible moiré. The
Gaussian removes most of it, and the fine rings fade to gray instead of
aliasing, at the cost of a softer image near the center. **Choosing an
antialiasing filter always trades sharpness against aliasing.**

### Resampling: reconstruct, then sample

Resampling means **sampling a continuous function reconstructed from the
input**. The same filter does both jobs. By associativity, the
reconstruction filter ${tex`f`} and the sampling filter ${tex`g`}
combine into ${tex`g \star f`}. The rule is to let the **lower**
resolution set the filter size. When downsampling, scale the filter to
the output spacing ${tex`\Delta x`}. When upsampling, use it at the input
spacing.

```js echo
// reconstruct() on a finite array, with the filter scaled by s and a choice
// of what to do with taps that fall outside the array.
function reconstructArray(a, filter, x, {s = 1, edge = "clamp"} = {}) {
  const r = filter.radius * s;
  let sum = 0, wsum = 0;
  for (let j = Math.ceil(x - r); j <= Math.floor(x + r); j++) {
    if ((j < 0 || j >= a.length) && edge !== "clamp") continue; // "zero" and "renormalize" drop it
    const w = filter.f((x - j) / s) / s;
    sum += a[Math.max(0, Math.min(a.length - 1, j))] * w;
    wsum += w;
  }
  return edge === "renormalize" ? (wsum === 0 ? 0 : sum / wsum) : sum;
}

// resample(a, xl, xh, n, f) over the source interval (xl, xh).
// prefilter: false skips the filter scaling, which reduces the box filter
// to pixel dropping.
function resample1D(a, xl, xh, n, filter, {prefilter = true, edge = "clamp"} = {}) {
  const dx = (xh - xl) / n;
  const x0 = xl + dx / 2;
  const s = prefilter ? Math.max(1, dx) : 1;
  return Float64Array.from({length: n}, (_, i) => reconstructArray(a, filter, x0 + i * dx, {s, edge}));
}
```

In 1D, 16 input samples are resampled to ${tex`n`} output samples over
the whole sequence, with ${tex`x_l = -0.5`} and ${tex`x_h = 15.5`}:

```js echo
const resampleInput = [0.2, 0.2, 0.8, 0.9, 0.3, 0.1, 0.1, 0.6, 0.6, 0.6, 0.2, 0.9, 0.1, 0.8, 0.2, 0.5];
const resample1Form = view(Inputs.form({
  n: Inputs.range([3, 40], {value: 6, step: 1, label: "output samples n"}),
  filter: Inputs.select(Object.keys(filters), {value: "tent", label: "filter", format: (k) => filters[k].name})
}));
```

```js echo
(() => {
  const flt = filters[resample1Form.filter];
  const N = resampleInput.length, n = resample1Form.n;
  const dx = N / n, x0 = -0.5 + dx / 2, s = Math.max(1, dx);
  const out = resample1D(resampleInput, -0.5, N - 0.5, n, flt);
  const curve = d3.range(-0.5, N - 0.5, 0.01).map((x) => ({x, y: reconstructArray(resampleInput, flt, x, {s})}));
  return Plot.plot({
    height: 240, x: {label: "position in input samples"}, y: {label: null, domain: [-0.1, 1.1]},
    marks: [
      Plot.ruleX(resampleInput.map((v, i) => ({i, v})), {x: "i", y: "v", stroke: "gray", strokeOpacity: 0.6}),
      Plot.dot(resampleInput.map((v, i) => ({i, v})), {x: "i", y: "v", fill: "gray", r: 3}),
      Plot.line(curve, {x: "x", y: "y", stroke: "steelblue", strokeWidth: 1.5}),
      Plot.dot(Array.from(out, (v, i) => ({x: x0 + i * dx, v})), {x: "x", y: "v", fill: "orangered", r: 5}),
      Plot.text([`Δx = ${dx.toFixed(2)}, filter scaled by s = ${s.toFixed(2)} → radius ${(flt.radius * s).toFixed(2)}`], {frameAnchor: "top-left", dx: 4, dy: 4})
    ]
  });
})()
```

The gray samples are the input. The blue curve is the continuous
function that the filter reconstructs *at the scale used*, and the
orange dots are the output samples. With ${tex`n < 16`}, the filter
widens and the curve smooths out detail that the coarser grid could not
represent anyway. With ${tex`n > 16`}, the filter stays at its natural
size and the curve interpolates the input.

For images, we resample **separably**, rows first and then columns:

```js echo
function resampleAxis({width: W, height: H, data}, newN, axis, filter, opts) {
  const n = axis === 0 ? W : H, lines = axis === 0 ? H : W;
  const outW = axis === 0 ? newN : W, outH = axis === 0 ? H : newN;
  const out = new Float32Array(outW * outH * 3);
  const line = new Float64Array(n);
  for (let k = 0; k < lines; k++) {
    for (let c = 0; c < 3; c++) {
      for (let j = 0; j < n; j++) line[j] = data[3 * (axis === 0 ? k * W + j : j * W + k) + c];
      const res = resample1D(line, -0.5, n - 0.5, newN, filter, opts);
      for (let i = 0; i < newN; i++) out[3 * (axis === 0 ? k * outW + i : i * outW + k) + c] = res[i];
    }
  }
  return {width: outW, height: outH, data: out};
}

function resampleImage(img, newW, newH, filter, opts = {}) {
  return resampleAxis(resampleAxis(img, newW, 0, filter, opts), newH, 1, filter, opts);
}

// Nearest-neighbor enlargement with CSS, so small results stay easy to compare.
function showEnlarged(img, displayWidth) {
  const canvas = showImage(img);
  canvas.style.width = `${displayWidth}px`;
  canvas.style.imageRendering = "pixelated";
  return canvas;
}
```

**Downsampling.** A 256 × 256 zone plate is shrunk to ${tex`N \times N`}.
Pixel dropping is box reconstruction at the *input* spacing followed by
point sampling. The other methods scale the filter to the output
spacing:

```js echo
const downSize = view(Inputs.range([32, 200], {value: 90, step: 1, label: "output size N"}));
```

```js echo
const zoneInput = (() => {
  const img = {width: 256, height: 256, data: new Float32Array(256 * 256 * 3)};
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const v = 255 * zonePlate(x + 0.5, y + 0.5, 256, 0.5), o = 3 * (y * 256 + x);
    img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
  }
  return img;
})();
```

```js echo
raster.sideBySide([
  ["input, 256 × 256", showEnlarged(zoneInput, 200)],
  ["pixel dropping", showEnlarged(resampleImage(zoneInput, downSize, downSize, filters.box, {prefilter: false}), 200)],
  ["box, scaled", showEnlarged(resampleImage(zoneInput, downSize, downSize, filters.box), 200)],
  ["tent, scaled", showEnlarged(resampleImage(zoneInput, downSize, downSize, filters.tent), 200)],
  ["Mitchell–Netravali, scaled", showEnlarged(resampleImage(zoneInput, downSize, downSize, filters.mitchell), 200)]
])
```

Pixel dropping produces bold false rings as soon as ${tex`N < 256`}. The
box reduces them, the tent does better, and Mitchell–Netravali gives the
cleanest result of these.

**Upsampling.** A 32 × 24 crop around the sun is enlarged 8×. For
upsampling, reconstruction dominates, so every filter is used at its
natural size:

```js echo
const sunCrop = (() => {
  const W = 32, H = 24, x0 = 108, y0 = 10;
  const data = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) {
    data[3 * (y * W + x) + c] = testFloat.data[3 * ((y + y0) * 160 + x + x0) + c];
  }
  return {width: W, height: H, data};
})();
```

```js echo
raster.sideBySide(["box", "tent", "bspline", "catmullRom", "mitchell"].map((key) =>
  [`${filters[key].name}`, showImage(resampleImage(sunCrop, 256, 192, filters[key]))]))
```

The box gives nearest-neighbor blocks. The tent looks smooth, but its
corners are visible. The B-spline is the softest. Catmull–Rom is the
sharpest, with slight halos from its negative lobes at the sun's edge.
Mitchell–Netravali is a good all-around default.

### Handling image edges

Near the border, some filter taps fall outside the image. A large blur
makes the difference between the three strategies easy to see:

```js echo
const edgeSigma = view(Inputs.range([1, 10], {value: 6, step: 0.5, label: "Gaussian σ"}));
```

```js echo
raster.sideBySide(["zero", "clamp", "renormalize"].map((edge) =>
  [`${edge}`, showImage(filterSeparable(testFloat, gaussianWeights(edgeSigma), edge), 2)]))
```

**Zero padding** darkens the border, because missing taps count as
black. **Clamping** extends the edge row or column outward. It is easy to
implement, but the edge pixels get extra weight. **Renormalizing**
divides by the weights of the taps that actually fall inside the image.
It preserves intensity and is probably the best choice. A production
implementation renormalizes only in the band of pixels within one filter
radius of the edge, because the interior never needs it.

## Sampling Theory

This section is optional. The sections above are enough to build
excellent resamplers. Sampling
theory explains *why* they work, using one more tool: the Fourier
transform.

### Building functions from sinusoids

A square wave with period 1 is a sum of odd harmonics:

${tex.block`\text{square}(x) = \frac{4}{\pi} \sum_{n = 1, 3, 5, \dots} \frac{\sin 2\pi n x}{n}`}

```js echo
const squareTerms = view(Inputs.range([1, 60], {value: 3, step: 1, label: "odd harmonics included"}));
```

```js echo
const squareRows = d3.range(-1, 1.0001, 0.001).map((x) => {
  let s = 0;
  for (let k = 0; k < squareTerms; k++) s += Math.sin(2 * Math.PI * (2 * k + 1) * x) / (2 * k + 1);
  return {x, partial: (4 / Math.PI) * s, square: Math.sin(2 * Math.PI * x) >= 0 ? 1 : -1};
});
```

```js echo
Plot.plot({
  height: 220, x: {label: "x"}, y: {label: null, domain: [-1.4, 1.4]},
  marks: [
    Plot.line(squareRows, {x: "x", y: "square", stroke: "gray", curve: "step"}),
    Plot.line(squareRows, {x: "x", y: "partial", stroke: "steelblue", strokeWidth: 2})
  ]
})
```

With ${squareTerms} harmonics, the peak is
${d3.max(squareRows, (d) => d.partial).toFixed(3)}. The partial sums
approach the square wave everywhere except near the jumps, where the
overshoot settles at about 1.18 however many terms you add. This
**Gibbs ringing** is the same effect that the sinc filter causes below.

### The Fourier transform of a filter

${tex.block`\hat f(u) = \int_{-\infty}^{\infty} f(x)\, e^{-2\pi i u x}\, dx`}

All of our filters are even, so the sine part cancels and
${tex`\hat f`} is the real integral of ${tex`f(x)\cos 2\pi u x`}:

```js echo
function fourierEven(filter, u, n = 1200) {
  return integrate((x) => filter.f(x) * Math.cos(2 * Math.PI * u * x), -filter.radius, filter.radius, n);
}
const sinc = (x) => (x === 0 ? 1 : Math.sin(x) / x);
```

```js echo
const ftForm = view(Inputs.form({
  filter: Inputs.select(Object.keys(filters), {value: "box", label: "filter", format: (k) => filters[k].name}),
  s: Inputs.range([0.5, 3], {value: 1, step: 0.05, label: "scale s"})
}));
```

```js echo
const ftAnalytic = {
  box: (u, s) => sinc(Math.PI * s * u),
  tent: (u, s) => sinc(Math.PI * s * u) ** 2,
  bspline: (u, s) => sinc(Math.PI * s * u) ** 4,
  gaussian: (u, s) => Math.exp(-((2 * Math.PI * s * u) ** 2) / 2)
}[ftForm.filter];
const ftScaled = scaleFilter(filters[ftForm.filter], ftForm.s);
const ftNumeric = d3.range(0, 3.0001, 0.04).map((u) => ({u, F: fourierEven(ftScaled, u)}));
const ftCurve = ftAnalytic ? d3.range(0, 3.0001, 0.005).map((u) => ({u, F: ftAnalytic(u, ftForm.s)})) : [];
```

```js echo
Plot.plot({
  height: 240, x: {label: "frequency u"}, y: {label: "f̂(u)", domain: [-0.3, 1.05]},
  marks: [
    Plot.ruleY([0], {strokeOpacity: 0.3}),
    Plot.line(ftCurve, {x: "u", y: "F", stroke: "gray", strokeWidth: 2}),
    Plot.dot(ftNumeric, {x: "u", y: "F", fill: "steelblue", r: 3})
  ]
})
```

The dots are the numeric transform, and the gray line is the closed form
from the standard transform pairs: box ↔ ${tex`\operatorname{sinc}\pi u`}, tent ↔
${tex`\operatorname{sinc}^2\pi u`}, B-spline ↔ ${tex`\operatorname{sinc}^4\pi u`},
and Gaussian ↔ a Gaussian. Catmull–Rom and Mitchell–Netravali have only
the numeric dots. Three properties are visible here:

- **Stretch ↔ squash:** increasing ${tex`s`} narrows the transform by the same factor.
- **Zero frequency:** ${tex`\hat f(0)`} = ${ftNumeric[0].F.toFixed(4)}, which is the filter's area.
- **The convolution theorem:** the tent is box ⋆ box, so its transform is ${tex`\operatorname{sinc}\cdot\operatorname{sinc}`}. The B-spline is four boxes, so its transform is ${tex`\operatorname{sinc}^4`}. Convolution in space becomes multiplication in frequency.

The box and tent transforms are exactly zero at
${tex`u = 1, 2, 3, \dots`}. That property matters in the next section.

### Sampling copies the spectrum

Sampling at spacing ${tex`T`} multiplies the signal by an impulse train.
By the convolution theorem, that **convolves the spectrum** with an
impulse train in frequency, which places copies of ${tex`\hat f`} every
${tex`f_s = 1/T`}:

${tex.block`\mathcal{F}\{f\, s_T\} = \frac1T \sum_{i} \hat f\!\left(u - \frac{i}{T}\right)`}

The signal below has a spectrum confined to ${tex`|u| < 1`}. Change the
sample rate, add a pre-filter, and pick a reconstruction filter. The
reconstruction filter's transform is scaled to the sample spacing,
${tex`\hat f(Tu)`}.

```js echo
const specForm = view(Inputs.form({
  fs: Inputs.range([0.8, 4], {value: 1.6, step: 0.05, label: "sample rate fₛ"}),
  prefilter: Inputs.toggle({label: "low-pass (Gaussian) before sampling", value: false}),
  recon: Inputs.select(["box (nearest neighbor)", "tent (linear)", "B-spline", "ideal (sinc)"], {value: "tent (linear)", label: "reconstruction filter"})
}));
```

```js echo
const specBase = (u) => (Math.abs(u) < 1 ? 0.5 + 0.5 * Math.cos(Math.PI * u) : 0);
const specT = 1 / specForm.fs;
// A spatial Gaussian with σ = 0.6 T, whose transform is a Gaussian in u.
const specF = (u) => specBase(u) * (specForm.prefilter ? Math.exp(-((2 * Math.PI * 0.6 * specT * u) ** 2) / 2) : 1);
const specR = {
  "box (nearest neighbor)": (u) => sinc(Math.PI * specT * u),
  "tent (linear)": (u) => sinc(Math.PI * specT * u) ** 2,
  "B-spline": (u) => sinc(Math.PI * specT * u) ** 4,
  "ideal (sinc)": (u) => (Math.abs(u) < specForm.fs / 2 ? 1 : 0)
}[specForm.recon];
const specU = d3.range(-4, 4.0001, 0.005);
const specKs = d3.range(-8, 9);
const specRows = specU.map((u) => {
  const base = specF(u);
  const aliases = d3.sum(specKs, (k) => (k === 0 ? 0 : specF(u - k * specForm.fs)));
  const R = specR(u);
  return {u, base, aliases, R, out: (base + aliases) * R, leak: aliases * R, loss: specBase(u) - base * R};
});
const specCopies = d3.range(-4, 5).flatMap((k) => specU.map((u) => ({u, v: specF(u - k * specForm.fs), k})));
const specEnergy = d3.sum(specU, (u) => specBase(u) ** 2);
const specLeak = d3.sum(specRows, (d) => d.leak ** 2) / specEnergy;
const specLoss = d3.sum(specRows, (d) => d.loss ** 2) / specEnergy;
const specOverlap = d3.sum(specRows, (d) => Math.min(d.base, d.aliases)) * 0.005;
```

```js echo
Plot.plot({
  height: 280, x: {label: "frequency u", domain: [-4, 4]}, y: {label: null, domain: [-0.25, 1.3]},
  marks: [
    Plot.ruleY([0], {strokeOpacity: 0.3}),
    Plot.ruleX([-specForm.fs / 2, specForm.fs / 2], {stroke: "green", strokeDasharray: "3,3"}),
    Plot.areaY(specRows, {x: "u", y: "out", fill: "orange", fillOpacity: 0.45}),
    Plot.line(specCopies, {x: "u", y: "v", z: "k", stroke: (d) => (d.k === 0 ? "steelblue" : "gray"), strokeWidth: 1.5}),
    Plot.line(specRows, {x: "u", y: "R", stroke: "currentColor", strokeDasharray: "6,4"})
  ]
})
```

The blue curve is the base spectrum, and the gray curves are the alias
copies at multiples of ${tex`f_s`}. The dashed line is the
reconstruction filter's transform, and the orange area is what survives
reconstruction. The green lines mark the Nyquist frequency
${tex`\pm f_s/2`}.

| Measure | Value |
|---|---|
| Nyquist: ${tex`f_{\max} = 1`} vs. ${tex`f_s/2`} = ${(specForm.fs / 2).toFixed(2)} | **${specForm.fs > 2 ? "satisfied" : "violated"}** |
| Overlap between base and alias copies (undersampling) | ${specOverlap.toFixed(3)} |
| Alias energy that leaks through reconstruction | ${(specLeak * 100).toFixed(2)}% |
| Energy lost from the original base spectrum | ${(specLoss * 100).toFixed(2)}% |

Things to try:

- **Undersampling.** Set ${tex`f_s < 2`}. The copies overlap and add, and no reconstruction filter can separate them again. This is the first source of aliasing.
- **Prefiltering.** Turn on the low-pass filter. The copies shrink and stop overlapping, but some real detail is lost. It is still better to lose it than to have it scrambled into artifacts.
- **Reconstruction.** With ${tex`f_s = 3`}, compare the box with the B-spline. The box's sinc is broad, so pieces of every alias copy leak through. This is the second source of aliasing, and it appears as the blocky look of nearest-neighbor enlargement. The B-spline blocks the aliases but also attenuates the base spectrum: sharpness vs. aliasing again. Every ripple-free filter is zero at nonzero multiples of ${tex`f_s`}, which is where each copy's peak sits.
- **The ideal filter.** A box in frequency, cut off at the Nyquist frequency, keeps the base spectrum and removes every alias.

### Why not always use sinc?

The ideal box in frequency is ${tex`\operatorname{sinc}\pi x`} in space.
It has infinite extent and many ripples. Truncate it and reconstruct a
step:

```js echo
const sincRadius = view(Inputs.range([2, 24], {value: 6, step: 1, label: "sinc truncated at radius"}));
```

```js echo
(() => {
  const sincFilter = {name: "truncated sinc", radius: sincRadius, f: (x) => (Math.abs(x) < sincRadius ? sinc(Math.PI * x) : 0)};
  const rows = [sincFilter, filters.mitchell].flatMap((flt) =>
    d3.range(-10, 10.0001, 0.02).map((x) => ({x, y: reconstruct(step, flt, x), name: flt.name})));
  const peak = d3.max(rows.filter((d) => d.name === "truncated sinc"), (d) => d.y);
  return html`${Plot.plot({
    height: 220, x: {label: "x"}, y: {label: null}, color: {legend: true},
    marks: [Plot.ruleY([0, 1], {strokeOpacity: 0.2}), Plot.line(rows, {x: "x", y: "y", stroke: "name", z: "name", strokeWidth: 2})]
  })}<p>Sinc peak: <b>${peak.toFixed(3)}</b>. The overshoot does not shrink as the radius grows.</p>`;
})()
```

Even with a radius of 24 samples (48 taps per axis), the sinc still
**rings** at the step, and the ringing spreads far from the edge. A
compact cubic such as Mitchell–Netravali costs 4 taps per axis and
barely rings. As a sampling filter, the sinc's negative lobes cause
trouble too, while a Gaussian's transform falls off smoothly and leaves
no bumps for aliases to leak through. Useful filters balance
**sharpness, aliasing, ringing, and cost**.

## Check Your Understanding

1. Convolve the step ${tex`a[i] = [i \ge 0]`} with the 3-point box. Where does the ramp start and end?
2. Why does Catmull–Rom interpolate while the B-spline does not? Which of the two rings?
3. A tent scaled by 1.25 reconstructs a constant sequence. What goes wrong, and how do you fix it?
4. You shrink an image by a factor of 4 using a Mitchell–Netravali filter. What radius, in input pixels, should the filter have?
5. A 10 kHz tone is sampled at 8 kHz. What frequency do you hear, and why?
6. Use the convolution theorem to show that ${tex`\mathcal{F}\{f_{\text{tent}}\} = \operatorname{sinc}^2 \pi u`}.
7. Why does a B-spline reconstruction filter suppress alias spectra better than a box?
8. How many multiplications per pixel does an ${tex`r = 5`} filter need when applied directly vs. separably?

<details>
<summary>Answers</summary>

1. The values for ${tex`i = -2..2`} are [${d3.range(-2, 3).map((i) => convolveAt(step, boxDiscrete(1), i).toFixed(3)).join(", ")}], so the ramp starts after ${tex`i=-2`} and reaches 1 at ${tex`i=1`}.
2. Catmull–Rom has ${tex`f(0)=`}${fC(0)} and ${tex`f(\pm1)=f(\pm2)=0`}. The B-spline has ${tex`f(0)=`}${fB(0).toFixed(3)} and ${tex`f(\pm1)=`}${fB(1).toFixed(3)}, so its reconstruction does not pass through the samples. Catmull–Rom rings, because its minimum value is ${d3.min(d3.range(-2, 2, 0.001), fC).toFixed(3)}.
3. It ripples by ${(rippleOf(filters.tent, 1.25) * 100).toFixed(1)}%. Fix it by dividing by ${tex`\sum_i f(x-i)`}.
4. When downsampling, the filter is scaled to the output spacing, so ${tex`s = 4`} and the radius is ${tex`2 \times 4 = 8`} input pixels.
5. ${Math.abs(aliasOf(10000, 8000))} Hz. The 10 kHz tone produces the same samples as ${tex`10 - 8 = 2`} kHz, which is the alias inside the 0–4 kHz representable range.
6. The tent is box ⋆ box, so its transform is ${tex`\hat f_{\text{box}} \cdot \hat f_{\text{box}} = \operatorname{sinc}^2 \pi u`}. The transform plot confirms this numerically.
7. Its transform ${tex`\operatorname{sinc}^4`} falls off like ${tex`1/u^4`} instead of ${tex`1/u`}, and it has higher-order zeros at each copy's center. In the spectrum demo at ${tex`f_s = 3`}, compare the leakage for the two filters.
8. ${(2 * 5 + 1) ** 2} directly vs. ${2 * (2 * 5 + 1)} separably.

</details>

## Common Pitfalls

- **Point-sampling when downsampling.** Pixel dropping is fast, but it
  aliases. Scale the filter to the *output* spacing.
- **Using the filter at its natural radius for downsampling.** Scaling
  it by ${tex`\Delta x`} is what provides the smoothing that the sampling
  step needs.
- **Forgetting to normalize.** A filter that does not sum to 1 brightens
  or darkens the whole image. Edge detectors, which sum to 0, are the
  deliberate exception.
- **Zero-padding the edges.** It leaves a dark border. Clamp, or better,
  renormalize.
- **Assuming a filter is ripple-free at every scale.** At non-integer
  scales, and always for the Gaussian, divide by the weight sum.
- **Treating the sinc as the practical optimum.** It is ideal in the
  frequency domain but rings badly and costs too much in space.
- **Forgetting the flip for asymmetric filters.** Convolution uses
  ${tex`b[i-j]`}. Many image libraries use cross-correlation, which gives
  the same result only for symmetric filters.

## Summary

- **Sampling and reconstruction:** sampling turns continuous functions into arrays, and reconstruction
  turns them back. **Both need filtering.** A sinusoid above
  ${tex`f_s/2`} produces the same samples as a lower one, as the
  plotted and audible examples showed.
- **Convolution:** a weighted moving average, or equivalently a sum of
  shifted filters. It comes in discrete, continuous, and
  discrete–continuous (reconstruction) forms, and its algebra lets you
  combine several filters into one.
- **Filters:** they differ in whether they **interpolate**, **ring**, and
  **ripple**, and in how **continuous** they are. Each of these
  properties was measured directly above. **Separable** filters reduce
  the cost per pixel from ${tex`O(r^2)`} to ${tex`O(r)`}.
- **Images:** blurring, sharpening, and drop shadows are each a single
  convolution. **Antialias** by averaging before sampling. **Resample**
  with one filter whose size is set by the lower resolution, and handle
  edges by renormalizing.
- **Sampling theory:** in frequency, sampling **copies the spectrum**. Aliasing comes from
  copies that overlap (undersampling) and from copies that survive a
  poor reconstruction filter. **Nyquist:** ${tex`f_{\max} < f_s/2`}.
