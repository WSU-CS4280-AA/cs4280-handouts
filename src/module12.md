---
title: Module 12 — Physics-Based Rendering
toc: true
---

```js echo
import * as d3 from "npm:d3";
import * as mat4 from "./components/mat4.js";
import * as geometry from "./components/geometry.js";
import * as webgpu from "./components/webgpu.js";
import {plane, drawPoint} from "./components/vectorField.js";
import * as Inputs from "npm:@observablehq/inputs";
import {html} from "npm:htl";
```

# Module 12 · Physics-Based Rendering

**Phenomenological** models such as Blinn–Phong put a highlight in the
"right" place by rule of thumb. **Physics-based** models follow the
physics of light. This module builds the pieces in the order of the
reading: how light meets smooth metals and dielectrics, a brute-force
photon tracer, the radiometry that describes light in bulk, the BRDF and
the transport equation, and Monte Carlo path tracing. The last section
puts it all in WebGPU and needs **Chrome or Edge 113+**. This handout
teaches the *techniques*; it is not a walkthrough of any graded
assignment.

```js echo
const xi = Math.random;
const row = (...nodes) => html`<div style="display:flex; gap:16px; flex-wrap:wrap; align-items:flex-start">${nodes}</div>`;
const deg = (r) => (r * 180) / Math.PI, rad = (d) => (d * Math.PI) / 180;
```

## Light and Materials

### Fresnel reflectance and Schlick's approximation

At a smooth surface, light either reflects or enters the material. The
**Fresnel equations** give the reflected fraction, and **Schlick's
approximation** is used almost everywhere:

${tex.block`R(\theta) = R_0 + (1 - R_0)(1 - \cos\theta)^5, \qquad R_0 = \left(\frac{n_t - n_i}{n_t + n_i}\right)^2`}

```js echo
const schlick = (cosTheta, R0) => R0 + (1 - R0) * (1 - cosTheta) ** 5;
const r0FromIndex = (ni, nt) => ((nt - ni) / (nt + ni)) ** 2;
function fresnelExact(cosI, ni, nt) {                   // unpolarized dielectric Fresnel
  const sinT2 = (ni / nt) ** 2 * (1 - cosI * cosI);
  if (sinT2 >= 1) return 1;                               // total internal reflection
  const cosT = Math.sqrt(1 - sinT2);
  const rs = (ni * cosI - nt * cosT) / (ni * cosI + nt * cosT), rp = (nt * cosI - ni * cosT) / (nt * cosI + ni * cosT);
  return (rs * rs + rp * rp) / 2;
}
const fresnelIndex = view(Inputs.range([1, 2.5], {value: 1.5, step: 0.01, label: "refractive index n (from air)"}));
```

```js echo
(() => {
  const R0 = r0FromIndex(1, fresnelIndex);
  const data = d3.range(0, 90.01, 0.5).flatMap((a) => {
    const c = Math.cos(rad(a));
    return [{a, R: fresnelExact(c, 1, fresnelIndex), curve: "exact Fresnel"}, {a, R: schlick(c, R0), curve: "Schlick"},
      ...[["gold, red", 0.95], ["gold, green", 0.75], ["gold, blue", 0.35]].map(([curve, r0]) => ({a, R: schlick(c, r0), curve}))];
  });
  return Plot.plot({height: 260, width: 560, x: {label: "angle of incidence θ (degrees)"}, y: {label: "reflectance R", domain: [0, 1]},
    color: {legend: true, domain: ["exact Fresnel", "Schlick", "gold, red", "gold, green", "gold, blue"], range: ["black", "orange", "#d33", "#3a3", "#36c"]},
    marks: [Plot.line(data, {x: "a", y: "R", stroke: "curve", strokeDasharray: (d) => (d.curve === "Schlick" ? "5,3" : null), strokeWidth: 2})]});
})()
```

${tex`R_0`} = ${r0FromIndex(1, fresnelIndex).toFixed(4)} for n = ${fresnelIndex}
(window glass: 1.51, about 4%). Schlick (dashed) tracks the exact curve
closely, and every material reflects nearly 100% at grazing angles. A
**metal** has a large, colored ${tex`R_0`} per channel, measured or set
by eye (gold above); whatever it does not reflect is absorbed.

### Snell's law and the refraction vector

${tex`n_i\sin\theta = n_t\sin\phi`}. Written with dot products, the
transmitted direction is

${tex.block`\mathbf t = \frac{n_i\big(\mathbf d - \mathbf n(\mathbf d\cdot\mathbf n)\big)}{n_t} - \mathbf n\sqrt{1 - \frac{n_i^2\big(1 - (\mathbf d\cdot\mathbf n)^2\big)}{n_t^2}}`}

and a negative value under the root means **total internal reflection**:

```js echo
function refractVector(d, n, ni, nt) {                  // d: unit incoming, n: unit normal facing d's origin side
  const dn = d.x * n.x + d.y * n.y, k = 1 - (ni * ni * (1 - dn * dn)) / (nt * nt);
  if (k < 0) return null;                                 // total internal reflection
  const s = Math.sqrt(k);
  return {x: (ni * (d.x - n.x * dn)) / nt - n.x * s, y: (ni * (d.y - n.y * dn)) / nt - n.y * s};
}
const reflectVector = (d, n) => { const dn = d.x * n.x + d.y * n.y; return {x: d.x - 2 * dn * n.x, y: d.y - 2 * dn * n.y}; };
const snellForm = view(Inputs.form({
  pair: Inputs.select(new Map([["air → glass", [1, 1.5]], ["glass → air", [1.5, 1]], ["air → water", [1, 1.33]], ["water → air", [1.33, 1]], ["air → diamond", [1, 2.42]], ["diamond → air", [2.42, 1]]]), {label: "media"}),
  theta: Inputs.range([0, 89], {value: 35, step: 1, label: "incidence angle θ (degrees)"})
}));
```

```js echo
(() => {
  const [ni, nt] = snellForm.pair, th = rad(snellForm.theta);
  const n = {x: 0, y: 1}, d = {x: Math.sin(th), y: -Math.cos(th)};
  const t = refractVector(d, n, ni, nt), r = reflectVector(d, n);
  const R = t ? fresnelExact(Math.cos(th), ni, nt) : 1;
  const scene = plane({width: 360, height: 360, domain: 2});
  scene.svg.insert("rect", ":first-child").attr("x", 0).attr("y", scene.y(0)).attr("width", 360).attr("height", 180).attr("fill", "steelblue").attr("fill-opacity", 0.12 * nt);
  scene.svg.insert("rect", ":first-child").attr("x", 0).attr("y", 0).attr("width", 360).attr("height", 180).attr("fill", "steelblue").attr("fill-opacity", 0.12 * ni);
  const seg = (a, b, color, width, label) => {
    scene.svg.append("line").attr("x1", scene.x(a.x)).attr("y1", scene.y(a.y)).attr("x2", scene.x(b.x)).attr("y2", scene.y(b.y)).attr("stroke", color).attr("stroke-width", width);
    if (label) scene.svg.append("text").attr("x", scene.x(b.x) + 6).attr("y", scene.y(b.y)).attr("font-size", 12).attr("font-family", "var(--sans-serif)").attr("fill", color).text(label);
  };
  seg({x: -1.8 * d.x, y: -1.8 * d.y}, {x: 0, y: 0}, "black", 3, "");
  seg({x: 0, y: 0}, {x: 1.6 * r.x, y: 1.6 * r.y}, "orange", 1 + 5 * R, `reflected ${(100 * R).toFixed(1)}%`);
  if (t) seg({x: 0, y: 0}, {x: 1.6 * t.x, y: 1.6 * t.y}, "seagreen", 1 + 5 * (1 - R), `refracted ${(100 * (1 - R)).toFixed(1)}%`);
  const phi = t ? deg(Math.asin(Math.abs(t.x))) : null;
  return row(scene.svg.node(), html`<pre style="align-self:center">nᵢ = ${ni}, nₜ = ${nt}
θ = ${snellForm.theta}°
${t ? `φ = ${phi.toFixed(2)}°
nᵢ sin θ = ${(ni * Math.sin(th)).toFixed(4)}
nₜ sin φ = ${(nt * Math.sin(rad(phi))).toFixed(4)}
|t| = ${Math.hypot(t.x, t.y).toFixed(6)}` : `total internal reflection
(critical angle ${deg(Math.asin(nt / ni)).toFixed(1)}°)`}</pre>`);
})()
```

Going into a denser medium bends the ray **toward** the normal. Choose
"glass → air" and raise ${tex`\theta`} past about 41.8°: the refracted
ray disappears and everything reflects. That is part of what makes glass
and diamonds sparkle. Line thickness shows the Fresnel split.

### Beer's law

Inside a medium, light loses intensity in proportion to itself, so
${tex`I(s) = I(0)\,a^s`} with an attenuation ${tex`a`} per unit
distance, chosen per RGB channel:

```js echo
const beerA = view(Inputs.form({
  r: Inputs.range([0.05, 1], {value: 0.55, step: 0.01, label: "a (red)"}),
  g: Inputs.range([0.05, 1], {value: 0.9, step: 0.01, label: "a (green)"}),
  b: Inputs.range([0.05, 1], {value: 0.65, step: 0.01, label: "a (blue)"})
}));
```

```js echo
(() => {
  const a = [beerA.r, beerA.g, beerA.b], names = ["red", "green", "blue"];
  const data = d3.range(0, 6.01, 0.1).flatMap((s) => a.map((ac, k) => ({s, I: ac ** s, channel: names[k]})));
  const swatch = (s) => {
    const c = a.map((ac) => Math.round(255 * (ac ** s) ** (1 / 2.2)));
    return html`<div style="text-align:center; font:12px var(--sans-serif)"><div style="width:56px; height:56px; border-radius:6px; background:rgb(${c.join(",")})"></div>s = ${s}</div>`;
  };
  return row(Plot.plot({width: 360, height: 200, x: {label: "distance s"}, y: {label: "I(s) / I(0)", domain: [0, 1]},
    color: {domain: names, range: ["#d33", "#3a3", "#36c"]}, marks: [Plot.line(data, {x: "s", y: "I", stroke: "channel", strokeWidth: 2})]}),
    html`<div style="display:flex; gap:10px; align-self:center">${[0.5, 1, 2, 4, 8].map(swatch)}</div>`);
})()
```

The swatches show white light after traveling distance ${tex`s`}: thin
glass looks nearly clear, and thick glass shows the tint. Many materials
that look opaque, such as snow and frosted glass, are clear dielectrics
whose microstructure scatters light many times; paint and skin add
pigments that absorb some wavelengths.

## A Brute-Force Photon Tracer

### Tracing photons through a glass slab

A photon tracer follows individual photons and makes **random**
decisions: at a surface, reflect with probability ${tex`R`}, otherwise
refract; inside a medium, get absorbed with the Beer's-law probability.
Here photons hit a glass slab of thickness ${tex`s`} and bounce around
inside it until they leave or are absorbed:

```js echo
const slabForm = view(Inputs.form({
  n: Inputs.range([1.1, 2.5], {value: 1.5, step: 0.01, label: "index n"}),
  theta: Inputs.range([0, 89], {value: 45, step: 1, label: "incidence θ (degrees)"}),
  s: Inputs.range([0, 4], {value: 1, step: 0.1, label: "thickness"}),
  a: Inputs.range([0.1, 1], {value: 0.7, step: 0.01, label: "attenuation a per unit"})
}));
```

```js echo
(() => {
  const N = 50000, cosT = Math.cos(rad(slabForm.theta));
  const cosP = Math.sqrt(1 - (Math.sin(rad(slabForm.theta)) / slabForm.n) ** 2);   // inside angle φ
  const R = schlick(cosT, r0FromIndex(1, slabForm.n));                               // same at both faces (by symmetry)
  const survive = slabForm.a ** (slabForm.s / cosP);                                  // one crossing: a^(path length)
  const count = {reflected: 0, transmitted: 0, absorbed: 0};
  for (let i = 0; i < N; i++) {
    if (xi() < R) { count.reflected++; continue; }                 // reflect at the top
    let goingDown = true;
    for (;;) {
      if (xi() > survive) { count.absorbed++; break; }             // absorbed while crossing
      if (xi() < R) { goingDown = !goingDown; continue; }          // reflect back inside
      count[goingDown ? "transmitted" : "reflected"]++;            // leave through the far or near face
      break;
    }
  }
  // Summing the geometric series of internal bounces gives the exact answer:
  const T = survive, denom = 1 - R * R * T * T;
  const exact = {reflected: R + ((1 - R) ** 2 * R * T * T) / denom, transmitted: ((1 - R) ** 2 * T) / denom};
  exact.absorbed = 1 - exact.reflected - exact.transmitted;
  return Inputs.table(["reflected", "transmitted", "absorbed"].map((k) => ({fate: k, "photons": count[k], "photon tracer": +(count[k] / N).toFixed(4), "geometric series": +exact[k].toFixed(4)})), {sort: null});
})()
```

${(50000).toLocaleString()} random photons agree with the analytic sum of
the internal bounces. A full photon tracer does exactly this in a whole
scene, with photons leaving a light at random positions, directions, and
wavelengths. It is accurate, and it is **very slow**: almost none reach a
small camera aperture.

### Lenses and defocus blur

A pinhole lets few photons through, so cameras use a **lens**. In the
**thin lens** model, all rays from a point ${tex`\mathbf p`} that pass
through the lens meet at a point ${tex`\mathbf q`} with
${tex`1/a + 1/b = 1/f`}. A point at another depth focuses in front of or
behind the sensor and spreads into a **circle of confusion**:

```js echo
const lensForm = view(Inputs.form({
  f: Inputs.range([0.8, 1.6], {value: 1.2, step: 0.01, label: "focal length f"}),
  aperture: Inputs.range([0.05, 0.9], {value: 0.5, step: 0.01, label: "lens radius"}),
  sensor: Inputs.range([1.2, 3.2], {value: 1.6, step: 0.01, label: "sensor distance"})
}));
```

```js echo
(() => {
  const W = 640, H = 300, x = d3.scaleLinear([-6.5, 3.5], [0, W]), y = d3.scaleLinear([-1.6, 1.6], [H, 0]);
  const svg = d3.create("svg").attr("viewBox", [0, 0, W, H]).attr("width", W).style("max-width", "100%").style("background", "var(--theme-background-alt, #f5f5f5)").style("border-radius", "8px");
  svg.append("line").attr("x1", 0).attr("x2", W).attr("y1", y(0)).attr("y2", y(0)).attr("stroke", "#bbb");
  svg.append("ellipse").attr("cx", x(0)).attr("cy", y(0)).attr("rx", 6).attr("ry", y(0) - y(lensForm.aperture)).attr("fill", "steelblue").attr("fill-opacity", 0.3);
  svg.append("line").attr("x1", x(lensForm.sensor)).attr("x2", x(lensForm.sensor)).attr("y1", y(1.5)).attr("y2", y(-1.5)).attr("stroke", "black").attr("stroke-width", 3);
  const lines = [];
  for (const [a, h, color] of [[5.5, 0.6, "crimson"], [2.6, -0.5, "seagreen"]]) {
    const b = 1 / (1 / lensForm.f - 1 / a), q = {x: b, y: (-h * b) / a};                // thin lens equation
    const ys = d3.range(-1, 1.001, 0.25).map((k) => k * lensForm.aperture);
    let lo = Infinity, hi = -Infinity;
    for (const ly of ys) {
      const sy = ly + ((q.y - ly) / q.x) * lensForm.sensor;                              // continue the ray from the lens to the sensor
      lo = Math.min(lo, sy); hi = Math.max(hi, sy);
      svg.append("polyline").attr("points", [[x(-a), y(h)], [x(0), y(ly)], [x(lensForm.sensor), y(sy)]].map((p) => p.join(",")).join(" ")).attr("fill", "none").attr("stroke", color).attr("stroke-opacity", 0.55);
    }
    svg.append("circle").attr("cx", x(-a)).attr("cy", y(h)).attr("r", 5).attr("fill", color);
    svg.append("circle").attr("cx", x(q.x)).attr("cy", y(q.y)).attr("r", 4).attr("fill", "none").attr("stroke", color).attr("stroke-width", 2);
    svg.append("line").attr("x1", x(lensForm.sensor) + 4).attr("x2", x(lensForm.sensor) + 4).attr("y1", y(lo)).attr("y2", y(hi)).attr("stroke", color).attr("stroke-width", 5);
    lines.push(`${color === "crimson" ? "far" : "near"} point: a = ${a}, focuses at b = ${b.toFixed(2)}, blur on the sensor = ${(hi - lo).toFixed(3)}`);
  }
  return html`<div>${svg.node()}<pre>${lines.join("\n")}</pre></div>`;
})()
```

Hollow circles mark where each point focuses (${tex`\mathbf q`}). Move the
sensor onto one of them and that point's blur bar shrinks to zero while
the other's grows. A smaller lens radius shrinks both: a larger **depth
of field**. Motion blur works the same way: give each photon a random
**time** in the shutter interval and let objects move with time.

### Reversing time

Almost no photons from a light reach the camera. Reversing the process,
and sending **adjoint photons** from each pixel until they reach a light,
is exactly what a ray tracer does. It is the basis of the path tracer
below.

## Radiometry

### Radiance and irradiance

**Radiance** ${tex`L`} is power per unit **projected** area per unit
solid angle (per wavelength). It matches our sense of brightness and **stays constant along
a ray** in empty space. **Irradiance** ${tex`H`} is the power arriving
per unit area, and it follows from radiance:

${tex.block`H = \int_{\text{hemisphere}} L_f(\mathbf k)\cos\theta\, d\sigma = \pi L_f \quad\text{for constant } L_f`}

A Monte Carlo check with uniform directions (${tex`p = 1/2\pi`},
Module 10):

```js echo
const radianceN = view(Inputs.radio([10, 100, 1000, 10000, 100000], {value: 1000, label: "random directions"}));
```

```js echo
(() => {
  const L = 1;
  let sum = 0;
  for (let i = 0; i < radianceN; i++) { const cosTheta = xi(); sum += (L * cosTheta) / (1 / (2 * Math.PI)); }   // uniform hemisphere: cos θ = ξ
  return html`<pre>estimate of H = ${(sum / radianceN).toFixed(4)}   (π L = ${Math.PI.toFixed(4)})</pre>`;
})()
```

The factor ${tex`\pi`}, not ${tex`2\pi`}, comes from the cosine: light
arriving at a grazing angle spreads over more area.

## Scattering and Light Transport

### The BRDF and energy conservation

The **BRDF** ${tex`\rho(\mathbf k_i, \mathbf k_o) = L_s(\mathbf k_o)/H(\mathbf k_i)`}
describes how a surface scatters light. Its **directional hemispherical
reflectance**
${tex`R(\mathbf k_i) = \int \rho\cos\theta_o\, d\sigma_o`} is the
fraction of light from ${tex`\mathbf k_i`} that is reflected, and energy
conservation requires ${tex`R \le 1`}. For a constant (Lambertian)
BRDF, ${tex`R = \pi\rho`}, so ${tex`\rho = R/\pi`}.

The estimator below computes ${tex`R(\theta_i)`} for three BRDFs: a
Lambertian one with ${tex`\rho = 1/\pi`}, an **unnormalized** Phong lobe
${tex`\cos^p\alpha`} (as in Module 05), and the same lobe **normalized**
by ${tex`(p+2)/2\pi`}. Here ${tex`\alpha`} is the angle between
${tex`\mathbf k_o`} and the mirror direction.

```js echo
const lobeP = view(Inputs.range([1, 200], {value: 20, step: 1, label: "Phong exponent p"}));
```

```js echo
function hemisphericalReflectance(brdf, thetaI, N = 20000) {
  const ki = [Math.sin(thetaI), 0, Math.cos(thetaI)], mirror = [-ki[0], 0, ki[2]];
  let sum = 0;
  for (let i = 0; i < N; i++) {
    const z = xi(), s = Math.sqrt(1 - z * z), phi = 2 * Math.PI * xi();      // uniform hemisphere, p = 1/2π
    const ko = [s * Math.cos(phi), s * Math.sin(phi), z];
    const cosAlpha = Math.max(0, ko[0] * mirror[0] + ko[1] * mirror[1] + ko[2] * mirror[2]);
    sum += brdf(cosAlpha) * z * 2 * Math.PI;                                   // ρ cos θ_o / p
  }
  return sum / N;
}
```

```js echo
(() => {
  const brdfs = {
    "Lambert ρ = 1/π": () => 1 / Math.PI,
    "Phong cosᵖα (unnormalized)": (c) => c ** lobeP,
    "Phong (p+2)/2π cosᵖα": (c) => ((lobeP + 2) / (2 * Math.PI)) * c ** lobeP
  };
  const data = d3.range(0, 86, 5).flatMap((a) => Object.entries(brdfs).map(([name, f]) => ({a, R: hemisphericalReflectance(f, rad(a), 20000), name})));
  return Plot.plot({height: 240, width: 560, x: {label: "incidence θᵢ (degrees)"}, y: {label: "R(θᵢ)", domain: [0, 1.2]}, color: {legend: true},
    marks: [Plot.ruleY([1], {strokeDasharray: "4,3"}), Plot.line(data, {x: "a", y: "R", stroke: "name", strokeWidth: 2})]});
})()
```

The Lambertian surface reflects exactly 1 at every angle. The
unnormalized lobe reflects less and less as ${tex`p`} grows: a sharper
highlight would also be darker. The normalized lobe reflects nearly 1
near normal incidence, for every ${tex`p`}. It falls at grazing angles,
where more and more of the lobe dips below the surface. Normalization is why physically based materials keep their
brightness when their roughness changes.

### The transport equation, recursion, and termination

Summing the light arriving from every direction gives the **transport
(rendering) equation**:

${tex.block`L_s(\mathbf k_o) = L_e(\mathbf k_o) + \int \rho(\mathbf k_i, \mathbf k_o)\, L_f(\mathbf k_i)\cos\theta_i\, d\sigma_i`}

It is **recursive**, since each ${tex`L_f`} is another surface's
${tex`L_s`}. The **furnace test** makes this concrete: inside a closed
sphere that emits ${tex`E`} everywhere and has albedo ${tex`R`}, every
bounce sees the same thing, so
${tex`L = E + RE + R^2E + \dots = E/(1-R)`}. A path tracer must stop
somewhere. Compare a fixed **depth cap** with **Russian roulette**
(continue with probability ${tex`q`}, and divide by ${tex`q`}):

```js echo
const furnaceForm = view(Inputs.form({
  R: Inputs.range([0, 0.95], {value: 0.8, step: 0.01, label: "albedo R"}),
  depth: Inputs.range([1, 30], {value: 4, step: 1, label: "depth cap"}),
  q: Inputs.range([0.1, 0.99], {value: 0.8, step: 0.01, label: "roulette continue probability q"})
}));
```

```js echo
(() => {
  const E = 1, exact = E / (1 - furnaceForm.R), paths = 20000;
  let capped = 0, roulette = 0, rouletteSq = 0, bounces = 0;
  for (let i = 0; i < paths; i++) {
    let L = 0, beta = 1;
    for (let k = 0; k < furnaceForm.depth; k++) { L += beta * E; beta *= furnaceForm.R; }   // cosine sampling: ρ cos θ / p = R
    capped += L;
    L = 0; beta = 1;
    for (;;) {
      L += beta * E; beta *= furnaceForm.R; bounces++;
      if (xi() > furnaceForm.q) break;                                                    // stop with probability 1 − q
      beta /= furnaceForm.q;                                                               // ... and reweight survivors
    }
    roulette += L; rouletteSq += L * L;
  }
  const mean = roulette / paths, sd = Math.sqrt(rouletteSq / paths - mean * mean);
  return html`<pre>exact            L = E / (1 − R) = ${exact.toFixed(4)}
depth cap ${String(furnaceForm.depth).padStart(2)}     L ≈ ${(capped / paths).toFixed(4)}   (always too dark: biased)
Russian roulette L ≈ ${mean.toFixed(4)} ± ${(sd / Math.sqrt(paths)).toFixed(4)}   (unbiased; ${(bounces / paths).toFixed(1)} bounces per path on average)</pre>`;
})()
```

## Physics-Based Rendering in WebGPU

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

### A path tracer with an area light, glass, and a thin lens

A compute shader traces one path per pixel per frame through a box with
a rectangular **area light**, a mirror ball, a tinted glass ball, and a
matte ball. Its pieces come from the reading and from Modules 10 and
11:

- **Throughput** `beta` is the running product of ${tex`\rho\cos\theta/p`}.
  Cosine-weighted sampling makes it simply the albedo for a Lambertian
  surface.
- **Direct lighting** samples a point on the light (area form,
  ${tex`p = 1/\text{area}`}) and casts a shadow ray. Light reached by a
  bounce is then not counted again, except after mirrors and glass.
- **Glass** chooses reflect or refract with Schlick's ${tex`R`} and
  applies Beer's law inside.
- The **thin lens** starts each camera ray at a random point on the lens
  and aims it at the plane of focus.
- Radiance is accumulated in **floating point (HDR)** and **tone mapped**
  only for display.

```js echo
const ptW = 400, ptH = 400;
const ptModule = device.createShaderModule({code: `
fn pcg(v: u32) -> u32 {
  let state = v * 747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
fn rand(seed: ptr<function, u32>) -> f32 { *seed = pcg(*seed); return f32(*seed >> 8u) / 16777216.0; }

struct Params {
  e: vec3<f32>, aperture: f32,
  u: vec3<f32>, focusDist: f32,
  v: vec3<f32>, tanHalf: f32,
  w: vec3<f32>, exposure: f32,
  frame: u32, seed: u32, flags: u32, maxDepth: u32,   // flags: 1 = direct lighting, 2 = tone mapping
};
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read_write> accum: array<vec4<f32>>;

const PI = 3.14159265;
const EPS = 1e-3;
const DIFFUSE = 0u;
const MIRROR = 1u;
const GLASS = 2u;
const ABSORB = vec3<f32>(0.45, 0.85, 0.6);          // Beer's law attenuation per unit distance

struct Material { albedo: vec3<f32>, kind: u32, emitted: vec3<f32> };
struct Quad { corner: vec3<f32>, e1: vec3<f32>, e2: vec3<f32>, mat: u32 };
struct Sphere { center: vec3<f32>, radius: f32, mat: u32 };
struct Ray { o: vec3<f32>, d: vec3<f32> };
struct Hit { t: f32, n: vec3<f32>, mat: i32 };

var<private> materials: array<Material, 7> = array<Material, 7>(
  Material(vec3<f32>(0.73), DIFFUSE, vec3<f32>(0.0)),               // 0 white
  Material(vec3<f32>(0.65, 0.06, 0.05), DIFFUSE, vec3<f32>(0.0)),   // 1 red
  Material(vec3<f32>(0.12, 0.45, 0.15), DIFFUSE, vec3<f32>(0.0)),   // 2 green
  Material(vec3<f32>(0.0), DIFFUSE, vec3<f32>(17.0, 15.0, 11.0)),   // 3 light
  Material(vec3<f32>(0.95), MIRROR, vec3<f32>(0.0)),                // 4 mirror
  Material(vec3<f32>(1.0), GLASS, vec3<f32>(0.0)),                  // 5 glass
  Material(vec3<f32>(0.8, 0.6, 0.2), DIFFUSE, vec3<f32>(0.0)));     // 6 yellow
var<private> quads: array<Quad, 6> = array<Quad, 6>(
  Quad(vec3<f32>(-1.0, 0.0, -1.0), vec3<f32>(2.0, 0.0, 0.0), vec3<f32>(0.0, 0.0, 2.0), 0u),   // floor
  Quad(vec3<f32>(-1.0, 2.0, -1.0), vec3<f32>(2.0, 0.0, 0.0), vec3<f32>(0.0, 0.0, 2.0), 0u),   // ceiling
  Quad(vec3<f32>(-1.0, 0.0, -1.0), vec3<f32>(2.0, 0.0, 0.0), vec3<f32>(0.0, 2.0, 0.0), 0u),   // back
  Quad(vec3<f32>(-1.0, 0.0, -1.0), vec3<f32>(0.0, 0.0, 2.0), vec3<f32>(0.0, 2.0, 0.0), 1u),   // left
  Quad(vec3<f32>(1.0, 0.0, -1.0), vec3<f32>(0.0, 0.0, 2.0), vec3<f32>(0.0, 2.0, 0.0), 2u),    // right
  Quad(vec3<f32>(-0.3, 1.99, -0.3), vec3<f32>(0.6, 0.0, 0.0), vec3<f32>(0.0, 0.0, 0.6), 3u)); // light (faces down)
var<private> spheres: array<Sphere, 3> = array<Sphere, 3>(
  Sphere(vec3<f32>(-0.45, 0.4, -0.35), 0.4, 4u),
  Sphere(vec3<f32>(0.45, 0.38, 0.25), 0.38, 5u),
  Sphere(vec3<f32>(0.05, 0.18, 0.75), 0.18, 6u));

fn hitQuad(q: Quad, r: Ray, tmax: f32) -> f32 {
  let n = cross(q.e1, q.e2);
  let denom = dot(n, r.d);
  if (abs(denom) < 1e-8) { return -1.0; }
  let t = dot(q.corner - r.o, n) / denom;
  if (t < EPS || t > tmax) { return -1.0; }
  let rel = r.o + t * r.d - q.corner;
  let a = dot(rel, q.e1) / dot(q.e1, q.e1);
  let b = dot(rel, q.e2) / dot(q.e2, q.e2);
  if (a < 0.0 || a > 1.0 || b < 0.0 || b > 1.0) { return -1.0; }
  return t;
}
fn hitSphere(s: Sphere, r: Ray, tmax: f32) -> f32 {
  let ec = r.o - s.center;
  let B = dot(r.d, ec);
  let disc = B * B - (dot(ec, ec) - s.radius * s.radius);       // |d| = 1
  if (disc < 0.0) { return -1.0; }
  var t = -B - sqrt(disc);
  if (t < EPS) { t = -B + sqrt(disc); }
  if (t < EPS || t > tmax) { return -1.0; }
  return t;
}
fn sceneHit(r: Ray, tmaxIn: f32) -> Hit {
  var h = Hit(-1.0, vec3<f32>(0.0), -1);
  var tmax = tmaxIn;
  for (var i = 0; i < 6; i++) {
    let t = hitQuad(quads[i], r, tmax);
    if (t > 0.0) { tmax = t; h = Hit(t, normalize(cross(quads[i].e1, quads[i].e2)), i32(quads[i].mat)); }
  }
  for (var i = 0; i < 3; i++) {
    let t = hitSphere(spheres[i], r, tmax);
    if (t > 0.0) { tmax = t; h = Hit(t, (r.o + t * r.d - spheres[i].center) / spheres[i].radius, i32(spheres[i].mat)); }
  }
  return h;
}

fn sampleDisk(xi: vec2<f32>, R: f32) -> vec2<f32> {
  let r = R * sqrt(xi.y);
  let phi = 2.0 * PI * xi.x;
  return vec2<f32>(r * cos(phi), r * sin(phi));
}
fn sampleCosineHemisphere(xi: vec2<f32>) -> vec3<f32> {
  let phi = 2.0 * PI * xi.x;
  let s = sqrt(xi.y);
  return vec3<f32>(cos(phi) * s, sin(phi) * s, sqrt(1.0 - xi.y));
}
fn toWorld(v: vec3<f32>, n: vec3<f32>) -> vec3<f32> {
  let a = select(vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(0.0, 1.0, 0.0), abs(n.x) > 0.9);
  let t = normalize(cross(a, n));
  return v.x * t + v.y * cross(n, t) + v.z * n;
}
fn schlick(cosTheta: f32, R0: f32) -> f32 { return R0 + (1.0 - R0) * pow(1.0 - cosTheta, 5.0); }

fn directLight(x: vec3<f32>, n: vec3<f32>, albedo: vec3<f32>, seed: ptr<function, u32>) -> vec3<f32> {
  let light = quads[5];
  let xl = light.corner + rand(seed) * light.e1 + rand(seed) * light.e2;    // uniform point, p = 1 / area
  let toL = xl - x;
  let d2 = dot(toL, toL);
  let l = toL * inverseSqrt(d2);
  let lightN = normalize(cross(light.e1, light.e2));
  let cosI = dot(n, l);
  let cosL = -dot(lightN, l);
  if (cosI <= 0.0 || cosL <= 0.0) { return vec3<f32>(0.0); }
  if (sceneHit(Ray(x, l), sqrt(d2) - EPS).mat >= 0) { return vec3<f32>(0.0); }     // visibility v(x, x')
  let area = length(cross(light.e1, light.e2));
  return (albedo / PI) * materials[3].emitted * cosI * cosL / d2 * area;
}

fn radiance(primary: Ray, seed: ptr<function, u32>) -> vec3<f32> {
  let nee = (P.flags & 1u) != 0u;
  var ray = primary;
  var L = vec3<f32>(0.0);
  var beta = vec3<f32>(1.0);
  var countEmission = true;                      // camera rays, and rays after mirrors or glass
  for (var depth = 0u; depth < P.maxDepth; depth++) {
    let h = sceneHit(ray, 1e30);
    if (h.mat < 0) { break; }                    // escaped through the open front: black
    let m = materials[h.mat];
    let x = ray.o + h.t * ray.d;
    if (any(m.emitted > vec3<f32>(0.0))) {
      if ((countEmission || !nee) && dot(ray.d, h.n) < 0.0) { L += beta * m.emitted; }   // one-sided light
      break;
    }
    if (m.kind == DIFFUSE) {
      let n = select(h.n, -h.n, dot(h.n, ray.d) > 0.0);          // face the incoming ray
      if (nee) { L += beta * directLight(x, n, m.albedo, seed); }
      beta *= m.albedo;                                          // (albedo/π) cos θ / (cos θ/π)
      ray = Ray(x, toWorld(sampleCosineHemisphere(vec2<f32>(rand(seed), rand(seed))), n));
      countEmission = false;
    } else if (m.kind == MIRROR) {
      beta *= m.albedo;
      ray = Ray(x, reflect(ray.d, h.n));
      countEmission = true;
    } else {                                                     // glass, n = 1.5
      let entering = dot(ray.d, h.n) < 0.0;
      if (!entering) { beta *= pow(ABSORB, vec3<f32>(h.t)); }    // Beer's law over the path inside
      let nn = select(-h.n, h.n, entering);
      let eta = select(1.5, 1.0 / 1.5, entering);                // n_i / n_t
      let t = refract(ray.d, nn, eta);                           // zero on total internal reflection
      let cosine = select(-dot(t, nn), -dot(ray.d, nn), entering);   // use the angle on the air side
      if (all(t == vec3<f32>(0.0)) || rand(seed) < schlick(cosine, 0.04)) {
        ray = Ray(x, reflect(ray.d, nn));
      } else {
        ray = Ray(x, t);
      }
      countEmission = true;
    }
    if (depth >= 3u) {                                           // Russian roulette
      let q = min(0.95, max(beta.x, max(beta.y, beta.z)));
      if (rand(seed) > q) { break; }
      beta /= q;
    }
  }
  return L;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= ${ptW}u || id.y >= ${ptH}u) { return; }
  var seed = pcg(id.x + pcg(id.y + pcg(P.seed)));
  let px = (f32(id.x) + rand(&seed)) / ${ptW}.0 * 2.0 - 1.0;
  let py = 1.0 - (f32(id.y) + rand(&seed)) / ${ptH}.0 * 2.0;
  let dir = normalize(-P.w + px * P.tanHalf * P.u + py * P.tanHalf * P.v);   // pinhole direction
  let focusPoint = P.e + dir * (P.focusDist / dot(dir, -P.w));                // on the plane of sharp focus
  let lens = sampleDisk(vec2<f32>(rand(&seed), rand(&seed)), P.aperture);
  let origin = P.e + lens.x * P.u + lens.y * P.v;
  let c = radiance(Ray(origin, normalize(focusPoint - origin)), &seed);
  let i = id.y * ${ptW}u + id.x;
  accum[i] += (vec4<f32>(c, 1.0) - accum[i]) / f32(P.frame + 1u);           // running mean of radiance (HDR)
}

@group(0) @binding(1) var<storage, read> image: array<vec4<f32>>;
@vertex
fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  var pos = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  return vec4<f32>(pos[i], 0.0, 1.0);
}
@fragment
fn fs_tonemap(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
  let c = P.exposure * image[u32(pos.y) * ${ptW}u + u32(pos.x)].rgb;
  let mapped = select(clamp(c, vec3<f32>(0.0), vec3<f32>(1.0)), c / (1.0 + c), (P.flags & 2u) != 0u);   // Reinhard
  return vec4<f32>(pow(mapped, vec3<f32>(1.0 / 2.2)), 1.0);   // gamma, for a non-sRGB canvas format
}`});
```

```js echo
const ptComputeLayout = device.createBindGroupLayout({entries: [
  {binding: 0, visibility: GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT, buffer: {type: "uniform"}},
  {binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: {type: "storage"}}]});
const ptDisplayLayout = device.createBindGroupLayout({entries: [
  {binding: 0, visibility: GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT, buffer: {type: "uniform"}},
  {binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: {type: "read-only-storage"}}]});
const ptComputePipeline = device.createComputePipeline({
  layout: device.createPipelineLayout({bindGroupLayouts: [ptComputeLayout]}), compute: {module: ptModule, entryPoint: "main"}});
const ptDisplayPipeline = device.createRenderPipeline({
  layout: device.createPipelineLayout({bindGroupLayouts: [ptDisplayLayout]}),
  vertex: {module: ptModule, entryPoint: "vs_main"},
  fragment: {module: ptModule, entryPoint: "fs_tonemap", targets: [{format: canvasFormat}]}});
const ptParams = device.createBuffer({size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
const ptAccum = device.createBuffer({size: ptW * ptH * 16, usage: GPUBufferUsage.STORAGE});
const ptComputeBG = device.createBindGroup({layout: ptComputeLayout, entries: [{binding: 0, resource: {buffer: ptParams}}, {binding: 1, resource: {buffer: ptAccum}}]});
const ptDisplayBG = device.createBindGroup({layout: ptDisplayLayout, entries: [{binding: 0, resource: {buffer: ptParams}}, {binding: 1, resource: {buffer: ptAccum}}]});
const ptCanvas = document.createElement("canvas");
ptCanvas.width = ptW; ptCanvas.height = ptH;
ptCanvas.style.cssText = "border-radius: 8px; max-width: 100%";
const {context: ptContext} = webgpu.configureCanvas(ptCanvas, device);
const ptStatus = html`<pre style="margin: 4px 0"></pre>`;
```

```js echo
const ptForm = view(Inputs.form({
  direct: Inputs.toggle({value: true, label: "direct lighting (shadow rays to the light)"}),
  toneMap: Inputs.toggle({value: true, label: "Reinhard tone mapping (off = clamp)"}),
  exposure: Inputs.range([0.25, 4], {value: 1, step: 0.05, label: "exposure"}),
  maxDepth: Inputs.range([1, 12], {value: 8, step: 1, label: "max path length"}),
  aperture: Inputs.range([0, 0.15], {value: 0, step: 0.005, label: "lens radius (0 = pinhole)"}),
  focusDist: Inputs.range([2.5, 5], {value: 3.55, step: 0.05, label: "focus distance"}),
  maxFrames: Inputs.range([1, 2048], {value: 512, step: 1, label: "stop after (frames)"})
}));
```

```js echo
{
  // Changing any control re-runs this cell, which restarts the running mean.
  const data = new ArrayBuffer(80), f = new Float32Array(data), u = new Uint32Array(data);
  f.set([0, 1, 3.8, ptForm.aperture, 1, 0, 0, ptForm.focusDist, 0, 1, 0, 0.34, 0, 0, 1, ptForm.exposure]);   // e, u, v, w (camera at z = 3.8)
  u[18] = (ptForm.direct ? 1 : 0) | (ptForm.toneMap ? 2 : 0);
  u[19] = ptForm.maxDepth;
  let frame = 0, running = true;
  invalidation.then(() => (running = false));
  const start = performance.now();
  function step() {
    if (!running || frame >= ptForm.maxFrames) return;
    u[16] = frame; u[17] = frame + 1;
    device.queue.writeBuffer(ptParams, 0, data);
    const encoder = device.createCommandEncoder();
    const compute = encoder.beginComputePass();
    compute.setPipeline(ptComputePipeline);
    compute.setBindGroup(0, ptComputeBG);
    compute.dispatchWorkgroups(Math.ceil(ptW / 8), Math.ceil(ptH / 8));
    compute.end();
    const pass = encoder.beginRenderPass({colorAttachments: [{view: ptContext.getCurrentTexture().createView(), clearValue: {r: 0, g: 0, b: 0, a: 1}, loadOp: "clear", storeOp: "store"}]});
    pass.setPipeline(ptDisplayPipeline);
    pass.setBindGroup(0, ptDisplayBG);
    pass.draw(3);
    pass.end();
    device.queue.submit([encoder.finish()]);
    frame++;
    ptStatus.textContent = `${frame} samples per pixel, ${((performance.now() - start) / 1000).toFixed(1)} s`;
    requestAnimationFrame(step);
  }
  step();
}
```

```js echo
html`<div>${ptCanvas}${ptStatus}</div>`
```

Things to try:

- Turn **direct lighting** off. The image still converges to the same
  answer (light is then found only when a random bounce hits the small
  light), but it is far noisier at the same sample count.
- Set the **max path length** to 1 (direct light only on the walls),
  then 2 and 3: **color bleeding** from the red and green walls and light
  under the spheres appear as indirect bounces are added.
- Look at the **glass** ball: it focuses a bright **caustic** on the
  floor, tinted by Beer's law. Caustics are found by bounce paths only,
  so they stay noisy longest.
- Turn **tone mapping** off and raise the exposure: the light and the
  caustic clip to flat white. With Reinhard they compress smoothly.
- Give the lens a radius and change the **focus distance**: the mirror
  ball (about 4.15 away), the glass ball (3.55), and the small ball (3.05)
  come into focus in turn.

### A physically based material for rasterization

Real-time renderers use the same physics without paths: a Lambertian
diffuse lobe ${tex`\rho = R/\pi`} plus a **GGX** microfacet glossy lobe,
weighted by Schlick's Fresnel term. Its normal distribution
${tex`D`} controls the highlight's shape:

${tex.block`D(\mathbf h) = \frac{\alpha^2}{\pi\big((\mathbf n\cdot\mathbf h)^2(\alpha^2 - 1) + 1\big)^2}, \qquad \alpha = \text{roughness}^2`}

```js echo
Plot.plot({height: 200, width: 560, x: {label: "angle between n and h (degrees)"}, y: {label: "D (log scale)", type: "log", domain: [1e-3, 1e3]}, color: {legend: true, type: "ordinal"},
  marks: [Plot.line([0.1, 0.3, 0.5, 0.8].flatMap((rough) => d3.range(0, 89.5, 0.5).map((a) => {
    const a2 = rough ** 4, c = Math.cos(rad(a));
    return {a, D: a2 / (Math.PI * (c * c * (a2 - 1) + 1) ** 2), roughness: rough};
  })), {x: "a", y: "D", stroke: "roughness", strokeWidth: 2})]})
```

Low roughness gives a tall, narrow lobe: a sharp, bright highlight.
High roughness spreads it out. The grid below uses one shader for ten
spheres: **dielectric** (top row, ${tex`F_0 = 0.04`}) and **metal**
(bottom row, ${tex`F_0`} = base color, no diffuse), with roughness rising
from left to right:

```js echo
const ggxModule = device.createShaderModule({code: `
const PI = 3.14159265;
struct Uniforms { mvp: mat4x4<f32>, model: mat4x4<f32>, lightPos: vec4<f32>, camPos: vec4<f32>, base: vec4<f32>, params: vec4<f32> };
// base.a = metallic; params: x = roughness, y = tone map on/off, z = light strength
@group(0) @binding(0) var<uniform> U: Uniforms;

fn brdf(n: vec3<f32>, v: vec3<f32>, l: vec3<f32>, base: vec3<f32>, metallic: f32, rough: f32) -> vec3<f32> {
  let h = normalize(v + l);
  let nh = max(dot(n, h), 0.0);
  let nv = max(dot(n, v), 1e-4);
  let nl = max(dot(n, l), 1e-4);
  let a2 = pow(rough, 4.0);                                          // α = roughness²
  let D = a2 / (PI * pow(nh * nh * (a2 - 1.0) + 1.0, 2.0));          // GGX glossy lobe
  let k = pow(rough + 1.0, 2.0) / 8.0;
  let G = (nv / (nv * (1.0 - k) + k)) * (nl / (nl * (1.0 - k) + k)); // masking-shadowing
  let F0 = mix(vec3<f32>(0.04), base, metallic);                     // dielectric R0 ≈ 0.04
  let F = F0 + (1.0 - F0) * pow(1.0 - max(dot(v, h), 0.0), 5.0);     // Schlick
  let diffuse = (1.0 - F) * (1.0 - metallic) * base / PI;            // Lambert: ρ = R/π
  return diffuse + D * G * F / (4.0 * nv * nl);
}

struct VOut { @builtin(position) pos: vec4<f32>, @location(0) world: vec3<f32>, @location(1) normal: vec3<f32> };
@vertex
fn vs_main(@location(0) p: vec3<f32>, @location(1) n: vec3<f32>) -> VOut {
  return VOut(U.mvp * vec4<f32>(p, 1.0), (U.model * vec4<f32>(p, 1.0)).xyz, (U.model * vec4<f32>(n, 0.0)).xyz);
}
@fragment
fn fs_main(frag: VOut) -> @location(0) vec4<f32> {
  let n = normalize(frag.normal);
  let v = normalize(U.camPos.xyz - frag.world);
  let l = normalize(U.lightPos.xyz - frag.world);
  var c = brdf(n, v, l, U.base.rgb, U.base.a, U.params.x) * vec3<f32>(U.params.z) * max(dot(n, l), 0.0);
  c += 0.02 * U.base.rgb;                                             // a little ambient fill
  if (U.params.y > 0.5) { c = c / (1.0 + c); }                        // Reinhard
  return vec4<f32>(pow(clamp(c, vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(1.0 / 2.2)), 1.0);
}`});
const ggxPipeline = device.createRenderPipeline({
  layout: "auto",
  vertex: {module: ggxModule, entryPoint: "vs_main", buffers: [{arrayStride: 24, attributes: [
    {shaderLocation: 0, offset: 0, format: "float32x3"}, {shaderLocation: 1, offset: 12, format: "float32x3"}]}]},
  fragment: {module: ggxModule, entryPoint: "fs_main", targets: [{format: canvasFormat}]},
  primitive: {topology: "triangle-list"},
  depthStencil: {format: "depth24plus", depthWriteEnabled: true, depthCompare: "less"}
});
const ggxSphere = geometry.createSphere(24, 32);
const ggxVB = device.createBuffer({size: ggxSphere.positions.length * 8, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST});
device.queue.writeBuffer(ggxVB, 0, geometry.interleave(ggxSphere.positions, ggxSphere.normals));
const ggxIndexCount = ggxSphere.indices.length;
const ggxIndices = new Uint16Array(Math.ceil(ggxIndexCount / 2) * 2);   // pad: buffer writes must be multiples of 4 bytes
ggxIndices.set(ggxSphere.indices);
const ggxIB = device.createBuffer({size: ggxIndices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST});
device.queue.writeBuffer(ggxIB, 0, ggxIndices);
const ggxRoughness = [0.1, 0.3, 0.5, 0.7, 0.9];
const ggxDrawables = [0, 1].flatMap((metallic) => ggxRoughness.map((roughness, col) => {
  const buffer = device.createBuffer({size: 192, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
  return {metallic, roughness, buffer, model: mat4.multiply(mat4.translate((col - 2) * 1.05, metallic ? -0.55 : 0.55, 0), mat4.scale(0.46, 0.46, 0.46)),
    bindGroup: device.createBindGroup({layout: ggxPipeline.getBindGroupLayout(0), entries: [{binding: 0, resource: {buffer}}]})};
}));
const ggxCanvas = document.createElement("canvas");
ggxCanvas.width = 560; ggxCanvas.height = 330;
ggxCanvas.style.cssText = "border-radius: 8px; max-width: 100%";
const {context: ggxContext} = webgpu.configureCanvas(ggxCanvas, device);
const ggxDepth = device.createTexture({size: [560, 330], format: "depth24plus", usage: GPUTextureUsage.RENDER_ATTACHMENT});
```

```js echo
const ggxForm = view(Inputs.form({
  azimuth: Inputs.range([-90, 90], {value: 30, step: 1, label: "light azimuth"}),
  elevation: Inputs.range([0, 80], {value: 35, step: 1, label: "light elevation"}),
  strength: Inputs.range([1, 40], {value: 6, step: 0.5, label: "light strength"}),
  toneMap: Inputs.toggle({value: true, label: "Reinhard tone mapping"})
}));
```

```js echo
{
  const VP = mat4.multiply(mat4.perspective(rad(40), 560 / 330, 0.1, 20), mat4.lookAt([0, 0, 6.5], [0, 0, 0], [0, 1, 0]));
  const az = rad(ggxForm.azimuth), el = rad(ggxForm.elevation);
  const light = [6 * Math.cos(el) * Math.sin(az), 6 * Math.sin(el), 6 * Math.cos(el) * Math.cos(az)];
  for (const d of ggxDrawables) {
    device.queue.writeBuffer(d.buffer, 0, new Float32Array([...mat4.multiply(VP, d.model), ...d.model, ...light, 1, 0, 0, 6.5, 1,
      0.9, 0.45, 0.2, d.metallic, d.roughness, ggxForm.toneMap ? 1 : 0, ggxForm.strength, 0]));   // copper-colored base
  }
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [{view: ggxContext.getCurrentTexture().createView(), clearValue: {r: 0.05, g: 0.05, b: 0.07, a: 1}, loadOp: "clear", storeOp: "store"}],
    depthStencilAttachment: {view: ggxDepth.createView(), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store"}});
  pass.setPipeline(ggxPipeline);
  pass.setVertexBuffer(0, ggxVB);
  pass.setIndexBuffer(ggxIB, "uint16");
  for (const d of ggxDrawables) { pass.setBindGroup(0, d.bindGroup); pass.drawIndexed(ggxIndexCount); }
  pass.end();
  device.queue.submit([encoder.finish()]);
}
```

```js echo
ggxCanvas
```

The top row keeps its diffuse color with a small white highlight. The
bottom row has no diffuse term, so the metal is colored only through its
Fresnel-tinted reflection. Across each row the highlight spreads and
dims as the GGX lobe widens, and the normalized lobe keeps the total
reflected energy about the same. Move the light toward grazing angles to
see Fresnel brighten the dielectric rims.

## Check Your Understanding

1. What is ${tex`R_0`} for diamond (${tex`n = 2.42`}) seen from air? What is ${tex`R`} at 90°?
2. Light goes from water (1.33) into air. What is the critical angle?
3. Green glass has ${tex`a = (0.5, 0.9, 0.6)`} per cm. What fraction of red light passes through 3 cm?
4. Why does a photon tracer need so many photons, and what does reversing time fix?
5. Why is ${tex`H = \pi L`}, not ${tex`2\pi L`}, for uniform radiance?
6. Derive ${tex`\rho = R/\pi`} for a Lambertian surface.
7. In the furnace test, why is a fixed depth cap biased, and why is Russian roulette not?
8. With cosine-weighted sampling, why does the path throughput for a Lambertian bounce reduce to the albedo?
9. Why must a path tracer with direct lighting not also count emission when a diffuse bounce hits the light?

<details>
<summary>Answers</summary>

1. ${tex`R_0 = (1.42/3.42)^2 \approx 0.172`}. At 90°, ${tex`R = 1`}.
2. ${tex`\arcsin(1/1.33) \approx 48.8°`}.
3. ${tex`0.5^3 = 0.125`}.
4. Very few photons from a light happen to reach a small aperture. Tracing from the pixels toward the lights (ray tracing) only follows paths that matter to the image.
5. The ${tex`\cos\theta`} weighting: ${tex`\int\cos\theta\,d\sigma = \pi`} over the hemisphere.
6. ${tex`R = \int C\cos\theta_o\,d\sigma_o = \pi C`}, so ${tex`C = R/\pi`}.
7. The cap drops every term after a fixed depth, so the estimate is always too low. Roulette keeps every term with probability ${tex`q^k`} and divides by the same factor, so the expected value is unchanged.
8. ${tex`\rho\cos\theta/p = (R/\pi)\cos\theta/(\cos\theta/\pi) = R`}.
9. That light was already counted by the shadow ray at the previous hit. Counting it again would double it. After mirrors and glass, there was no direct-lighting step, so emission is counted.

</details>

## Common Pitfalls

- **Clamping radiance** before averaging or tone mapping. Accumulate in
  floating point (HDR), then tone map.
- **Forgetting gamma** on a non-sRGB canvas, or applying it twice.
- **Using the wrong angle in Schlick** when leaving a dense medium. Use
  the angle on the less dense side.
- **Ignoring total internal reflection** in the refraction formula.
- **Forgetting the ${tex`\pi`}** in ${tex`\rho = R/\pi`}, which makes
  diffuse surfaces reflect more light than they receive.
- **Unnormalized lobes**, which change brightness with shininess.
- **Double counting** light with direct lighting, or never counting
  lights seen directly.
- **Truncating paths at a fixed depth** without accounting for the bias.

## Summary

- **Materials:** metals reflect or absorb; dielectrics reflect or
  refract. Schlick's ${tex`R(\theta)`}, Snell's law and the refraction
  vector, total internal reflection, and Beer's law ${tex`I(s) = I(0)a^s`}.
- **Brute force:** random photons and reflect-or-refract decisions give
  accurate but slow images. Lenses, time, and reversing direction give
  depth of field, motion blur, and ray tracing.
- **Radiometry:** radiance is constant along rays, and ${tex`H = \pi L`}
  for uniform light.
- **Transport:** the BRDF, directional hemispherical reflectance and
  energy conservation, Lambertian ${tex`\rho = R/\pi`}, and the recursive
  rendering equation.
- **Monte Carlo:** path tracing with throughput, direct lighting with
  shadow rays, special handling for impulses, and Russian roulette.
- **WebGPU:** an HDR progressive path tracer with an area light, glass,
  and a thin lens, and a GGX metallic–roughness material for
  rasterization.
