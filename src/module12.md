---
title: Module 12 — Physics-Based Rendering
toc: true
---

```js
import * as d3 from "npm:d3";
import * as mat4 from "./lib/math/mat4.js";
import * as transforms from "./lib/math/transforms.js";
import * as geometry from "./components/geometry.js";
import {initializeWebGPU, createBuffer} from "./lib/webgpu.js";
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
puts it all in WebGPU and needs **Chrome or Edge 113+**. The code is part of the
reading: each formula is written out and tested here, while the code that only draws the
demos stays out of sight. Almost every practical rendering algorithm is a faster version
of the brute-force one below. For the details, see *Physically Based Rendering* (PBRT,
Pharr et al.). This handout teaches the *techniques*; it is not a walkthrough of any graded
assignment.

We start with the canonical random number from Module 11, and with two conversions used
throughout:

```js echo
const xi = Math.random;
const deg = (r) => (r * 180) / Math.PI, rad = (d) => (d * Math.PI) / 180;
```

```js
const row = (...nodes) => html`<div style="display:flex; gap:16px; flex-wrap:wrap; align-items:flex-start">${nodes}</div>`;
```

## Light and Materials

### Photons

In graphics, a **photon** is a packet of light energy that follows **geometric optics**: it
travels in straight lines and has no wave behavior. It has a position, a direction, and a
**wavelength** ${tex`\lambda`}, measured in nm (${tex`10^{-9}`} m). Its speed is
${tex`c/n`}, where ${tex`n`} is the medium's **refractive index**. The frequency ${tex`f`} does
not change when the photon refracts, so ${tex`\lambda`} does; wavelengths are quoted in
vacuum. Its energy is

${tex.block`q = hf = \frac{hc}{\lambda}, \qquad h = 6.63 \times 10^{-34}\ \text{J s}`}

```js echo
const photonEnergy = (lambdaNm) => (6.63e-34 * 3e8) / (lambdaNm * 1e-9);
```

A 500 nm photon should carry about ${tex`4 \times 10^{-19}`} J:

```js echo
photonEnergy(500)
```

So if all 100 W of a bulb became light at that wavelength, it would emit a few times
${tex`10^{20}`} photons per second. Real bulbs emit somewhat fewer:

```js echo
100 / photonEnergy(500)
```

### Fresnel reflectance and Schlick's approximation

At a smooth metal, light **reflects** like a mirror, or it **refracts** into the metal and
is quickly **absorbed**. **Dielectrics** are everything that is not a metal: glass, water,
skin, cloth, and most everyday materials. A smooth dielectric needs only three properties: how
much light is reflected at each angle and wavelength, how much is absorbed per unit distance
inside, and the directions of the reflected and refracted rays.

For the first of these, the **Fresnel equations** give the reflected fraction, and **Schlick's
approximation** is used almost everywhere. Here ${tex`\theta`} is the angle between the light's
direction and the surface normal, and ${tex`R_0`} is the reflectance at normal incidence:

${tex.block`R(\theta) = R_0 + (1 - R_0)(1 - \cos\theta)^5, \qquad R_0 = \left(\frac{n_t - n_i}{n_t + n_i}\right)^2`}

For a dielectric, ${tex`R_0`} comes from the refractive indices of the incident and transmitted
sides:

| air | water | window glass | diamond |
|---|---|---|---|
| 1.00 | 1.33 | 1.51 | 2.42 |

The code is two lines:

```js echo
const schlick = (cosTheta, R0) => R0 + (1 - R0) * (1 - cosTheta) ** 5;
const r0FromIndex = (ni, nt) => ((nt - ni) / (nt + ni)) ** 2;
```

Glass with ${tex`n = 1.5`} from air should reflect 4% head-on. At a grazing angle, where
${tex`\cos\theta = 0`}, everything should reflect:

```js echo
[r0FromIndex(1, 1.5), schlick(0, r0FromIndex(1, 1.5))]
```

Below, we compare Schlick with the exact equations for an unpolarized dielectric. They average two
polarizations, and they use the same refraction angle we derive next:

```js echo
function fresnelExact(cosI, ni, nt) {
  const sinT2 = (ni / nt) ** 2 * (1 - cosI * cosI);
  if (sinT2 >= 1) return 1;   // total internal reflection
  const cosT = Math.sqrt(1 - sinT2);
  const rs = (ni * cosI - nt * cosT) / (ni * cosI + nt * cosT);
  const rp = (nt * cosI - ni * cosT) / (nt * cosI + ni * cosT);
  return (rs * rs + rp * rp) / 2;
}
```

```js
const fresnelIndex = view(Inputs.range([1, 2.5], {value: 1.5, step: 0.01, label: "refractive index n (from air)"}));
```

```js
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
by eye (gold above); whatever it does not reflect is absorbed. For a
dielectric, whatever is not reflected is **transmitted**. Use ${tex`\theta`} on
the **air side**: when light exits the glass, that is the refraction angle
${tex`\phi`} of the next section.

### Snell's law and the refraction vector

A ray crosses from index ${tex`n_i`} into index ${tex`n_t`}. With ${tex`\theta`} the angle of
incidence and ${tex`\phi`} the angle of refraction, both measured from the normal:

${tex.block`n_i\sin\theta = n_t\sin\phi \qquad\Longrightarrow\qquad \cos^2\phi = 1 - \frac{n_i^2(1 - \cos^2\theta)}{n_t^2}`}

Cosines are dot products, so we work with ${tex`\cos\phi`} rather than angles. Let
${tex`\mathbf d`} be the unit incoming direction and ${tex`\mathbf n`} the unit normal on the
**incident** side, so ${tex`\mathbf d\cdot\mathbf n = -\cos\theta`}. (Bold ${tex`\mathbf n`} is
the normal; plain ${tex`n`} is an index.) Writing both directions in a basis
${tex`(\mathbf n, \mathbf b)`} of the plane of refraction,

${tex.block`\mathbf d = \sin\theta\,\mathbf b - \cos\theta\,\mathbf n, \qquad \mathbf t = \sin\phi\,\mathbf b - \cos\phi\,\mathbf n`}

Solving the first for ${tex`\mathbf b`} and substituting gives the transmitted direction:

${tex.block`\mathbf t = \frac{n_i\big(\mathbf d - \mathbf n(\mathbf d\cdot\mathbf n)\big)}{n_t} - \mathbf n\sqrt{1 - \frac{n_i^2\big(1 - (\mathbf d\cdot\mathbf n)^2\big)}{n_t^2}}`}

A negative value under the root means **total internal reflection**, so the function returns
`null` for that case:

```js echo
function refractVector(d, n, ni, nt) {
  const dn = d.x * n.x + d.y * n.y;
  const k = 1 - (ni * ni * (1 - dn * dn)) / (nt * nt);
  if (k < 0) return null;
  const s = Math.sqrt(k), ratio = ni / nt;
  return {x: ratio * (d.x - n.x * dn) - n.x * s,
          y: ratio * (d.y - n.y * dn) - n.y * s};
}
```

A ray straight down should not bend at all:

```js echo
refractVector({x: 0, y: -1}, {x: 0, y: 1}, 1, 1.5)
```

Total internal reflection happens only going into a lower index, beyond the **critical angle**
${tex`\theta_c = \arcsin(n_t/n_i)`}. From glass to air, it should be about 41.8°:

```js echo
const criticalAngle = (ni, nt) => deg(Math.asin(nt / ni));
```

```js echo
criticalAngle(1.5, 1)
```

The demo below also needs the mirror direction from Module 10:

```js echo
const reflectVector = (d, n) => {
  const dn = d.x * n.x + d.y * n.y;
  return {x: d.x - 2 * dn * n.x, y: d.y - 2 * dn * n.y};
};
```

```js
const snellForm = view(Inputs.form({
  pair: Inputs.select(new Map([["air → glass", [1, 1.5]], ["glass → air", [1.5, 1]], ["air → water", [1, 1.33]], ["water → air", [1.33, 1]], ["air → diamond", [1, 2.42]], ["diamond → air", [2.42, 1]]]), {label: "media"}),
  theta: Inputs.range([0, 89], {value: 35, step: 1, label: "incidence angle θ (degrees)"})
}));
```

```js
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

Light inside a medium with impurities loses intensity in proportion to itself:
${tex`dI = -C\,I\,dx`}, so ${tex`I(x) = I(0)\,e^{-Cx}`}. Let ${tex`a = I(1)/I(0)`} be the fraction
**left** after one unit of distance. Then ${tex`e^{-C} = a`}, and

${tex.block`I(s) = I(0)\, e^{\ln(a)\, s} = I(0)\, a^s`}

The value ${tex`a`} is an RGB value, usually chosen by eye. Green glass absorbs more red and blue than
green.

```js echo
const beer = (a, s) => a ** s;
```

With ${tex`a = 0.5`}, two units of distance should leave a quarter of the light:

```js echo
beer(0.5, 2)
```

```js
const beerA = view(Inputs.form({
  r: Inputs.range([0.05, 1], {value: 0.55, step: 0.01, label: "a (red)"}),
  g: Inputs.range([0.05, 1], {value: 0.9, step: 0.01, label: "a (green)"}),
  b: Inputs.range([0.05, 1], {value: 0.65, step: 0.01, label: "a (blue)"})
}));
```

```js
(() => {
  const a = [beerA.r, beerA.g, beerA.b], names = ["red", "green", "blue"];
  const data = d3.range(0, 6.01, 0.1).flatMap((s) => a.map((ac, k) => ({s, I: beer(ac, s), channel: names[k]})));
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
glass looks nearly clear, and thick glass shows the tint.

Many matte, opaque materials are **mixtures of smooth dielectrics**. Air bubbles in ice make it
opaque, as in a snowball. A roughened surface gives frosted glass. Colored particles in a clear
binder, which follow Beer's law, give paint. Skin is a rough surface over layers with slightly
different indices, pigment, and blood. With enough microstructure, smooth dielectrics alone can
produce a huge range of materials.

## A Brute-Force Photon Tracer

### The sensor and tracing photons

To form an image, we need a **camera**: a box with a **pinhole**, and an array of **photon counters**
behind it, like a digital camera's sensor. **Color filters** in front of the sensors respond to blue
(400–500 nm), green (500–600 nm), and red (600–700 nm). Every counter starts at 0 and adds 1 for
each photon that hits it. Few photons give black, and many give white.

Pick a random point on the light, a random direction, and a random ${tex`\lambda`} in
${tex`[400, 700]`} nm. Trace the photon as in Module 10, and at each surface, with ${tex`\xi`} a
canonical random number:

```js run=false
R = schlickReflectance(lambda, angle);
if (xi() < R) traceReflectedPhoton();
else traceRefractedPhoton();     // at a metal: absorbed instead
// inside a medium, s is the path length (Beer's law):
if (xi() < 1 - a(lambda) ** s) startNewPhoton();
```

This is all you need for excellent images. It is just **very slow**.

### Tracing photons through a glass slab

Here is a small version of those decisions. Photons hit a glass slab of thickness ${tex`s`} and bounce
around inside it until they leave or are absorbed. `R` is the chance of reflecting at either face, and
`survive` is the chance of crossing the slab once:

```js echo
function photonFate(R, survive) {
  if (xi() < R) return "reflected";               // at the top face
  for (let goingDown = true; ; goingDown = !goingDown) {
    if (xi() > survive) return "absorbed";        // while crossing
    if (xi() >= R) return goingDown ? "transmitted" : "reflected";
    // otherwise it reflects back inside
  }
}
```

The crossing is longer than the thickness when the ray is slanted, by the factor
${tex`1/\cos\phi`}. A perfectly clear slab has `survive = 1`, so out of 1,000 photons, none should
be absorbed:

```js echo
d3.range(1000).filter(() => photonFate(0.04, 1) === "absorbed").length
```

The demo sets `R` and `survive` from the sliders. Summing the geometric series of internal bounces also
gives the exact answer, which we can compare:

```js
const slabForm = view(Inputs.form({
  n: Inputs.range([1.1, 2.5], {value: 1.5, step: 0.01, label: "index n"}),
  theta: Inputs.range([0, 89], {value: 45, step: 1, label: "incidence θ (degrees)"}),
  s: Inputs.range([0, 4], {value: 1, step: 0.1, label: "thickness"}),
  a: Inputs.range([0.1, 1], {value: 0.7, step: 0.01, label: "attenuation a per unit"})
}));
```

```js
(() => {
  const N = 50000, cosT = Math.cos(rad(slabForm.theta));
  const cosP = Math.sqrt(1 - (Math.sin(rad(slabForm.theta)) / slabForm.n) ** 2);
  const R = schlick(cosT, r0FromIndex(1, slabForm.n));
  const survive = beer(slabForm.a, slabForm.s / cosP);
  const count = {reflected: 0, transmitted: 0, absorbed: 0};
  for (let i = 0; i < N; i++) count[photonFate(R, survive)]++;
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

A pinhole lets few photons through, so cameras use a bigger hole with a **lens**. In the **thin lens**
model, with focal length ${tex`f`}:

1. A ray through the lens **center** does not bend.
2. All rays from a point ${tex`\mathbf p`} that pass through the lens **meet** at a point ${tex`\mathbf q`} on
   that center line.
3. ${tex`1/a + 1/b = 1/f`}, with ${tex`a`} and ${tex`b`} measured along the optical axis.

Solving the last rule for ${tex`b`} gives where a point at distance ${tex`a`} comes into focus:

```js echo
const focusDistance = (a, f) => 1 / (1 / f - 1 / a);
```

A point twice the focal length away should focus twice the focal length behind the lens:

```js echo
focusDistance(2, 1)
```

A point at another depth focuses in front of or behind the sensor and spreads into a **circle of
confusion**. That is **depth of field**:

```js
const lensForm = view(Inputs.form({
  f: Inputs.range([0.8, 1.6], {value: 1.2, step: 0.01, label: "focal length f"}),
  aperture: Inputs.range([0.05, 0.9], {value: 0.5, step: 0.01, label: "lens radius"}),
  sensor: Inputs.range([1.2, 3.2], {value: 1.6, step: 0.01, label: "sensor distance"})
}));
```

```js
(() => {
  const W = 640, H = 300, x = d3.scaleLinear([-6.5, 3.5], [0, W]), y = d3.scaleLinear([-1.6, 1.6], [H, 0]);
  const svg = d3.create("svg").attr("viewBox", [0, 0, W, H]).attr("width", W).style("max-width", "100%").style("background", "var(--theme-background-alt, #f5f5f5)").style("border-radius", "8px");
  svg.append("line").attr("x1", 0).attr("x2", W).attr("y1", y(0)).attr("y2", y(0)).attr("stroke", "#bbb");
  svg.append("ellipse").attr("cx", x(0)).attr("cy", y(0)).attr("rx", 6).attr("ry", y(0) - y(lensForm.aperture)).attr("fill", "steelblue").attr("fill-opacity", 0.3);
  svg.append("line").attr("x1", x(lensForm.sensor)).attr("x2", x(lensForm.sensor)).attr("y1", y(1.5)).attr("y2", y(-1.5)).attr("stroke", "black").attr("stroke-width", 3);
  const lines = [];
  for (const [a, h, color] of [[5.5, 0.6, "crimson"], [2.6, -0.5, "seagreen"]]) {
    const b = focusDistance(a, lensForm.f), q = {x: b, y: (-h * b) / a};                // thin lens equation
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
of field**.

### Motion blur

A real shutter stays open for a **time interval**. Simulate it with two features. Each photon gets a
**random time** within the shutter interval, and intersection takes **time** as an argument, so objects
can move. For example, a sphere whose center moves from ${tex`\mathbf g`} at time 0 to ${tex`\mathbf h`}
at time 1:

${tex.block`\mathbf c(\text{time}) = \mathbf g + \text{time}\,(\mathbf h - \mathbf g)`}

Blur from both moving objects and a moving camera then appears **automatically**.

### Reversing time

Even with a lens, almost no photons from a light reach the camera. So we **reverse** the process: send
**adjoint photons** from each **pixel**, and record them when they reach a **light**. The color filters
act as **emission curves** that choose the wavelength, and a photon that hits a light is recorded with a
weight equal to the light's emission. This is exactly what a ray tracer does, and it is the basis of the
path tracer below.

## Radiometry

Photon simulation is too slow, so we model the **bulk** behavior of light with **radiometry**, in SI units.

### Spectral energy

Sort photon energies by wavelength: for example, ${tex`q[500, 600] = 10.2`} J. That number depends on the bin
size, so we divide by the bin width instead. This gives ${tex`Q_\lambda = 10.2/100 = 0.102`} J/nm, the
**spectral energy**, which is a *density*, like people per square meter. (The book misprints 0.12.)
**Intensive** quantities are densities, and **extensive** ones are totals. The energy *at* exactly one
wavelength is 0, but its density is not. Graphics usually drops the ${tex`\lambda`} subscript: "energy"
usually means spectral energy.

### Power and irradiance

**Power** is energy per unit time, in watts. **Spectral power** ${tex`\Phi`} is in W/nm, so 100 W spread evenly
over 400–800 nm is 0.25 W/nm. Keep this in mind when setting light strengths by hand.

**Irradiance** answers "how much light hits this point?" as a density per unit area:

${tex.block`H = \frac{\Delta q}{\Delta A\, \Delta t\, \Delta\lambda} \qquad (\text{J m}^{-2}\,\text{s}^{-1}\,\text{nm}^{-1})`}

Light **leaving** a surface has the same units but is called **radiant exitance** ${tex`E`}. Be careful:
Modules 05 and 10 wrote irradiance as ${tex`E`}. From here on, following the book, ${tex`H`} is irradiance
and ${tex`E`} is exitance.

### Radiance

A **solid angle** is the area a set of directions covers on the unit sphere, in steradians (the whole
sphere is ${tex`4\pi`}). This chapter writes it ${tex`\sigma`}, where Module 11 wrote ${tex`\omega`}.
Adding a cone of solid angle ${tex`\Delta\sigma`} to an irradiance meter makes it a radiance meter:

${tex.block`L = \frac{\Delta H}{\Delta\sigma} = \frac{\Delta q}{\Delta A\, \Delta\sigma\, \Delta t\, \Delta\lambda}`}

Radiance is what graphics programs usually compute, and it matches our sense of brightness. **It is constant
along a ray**: the area seen grows as ${tex`r^2`}, while the light reaching the detector falls as
${tex`1/r^2`}, so the two cancel.

At a surface, the detector is not aligned with the cone, so we add a cosine of ${tex`\theta`}, the angle
between the cone's axis and the surface normal:

${tex.block`L_s = \frac{\Delta E}{\Delta\sigma\cos\theta}\ \ (\text{surface radiance, leaving}), \qquad L_f = \frac{\Delta H}{\Delta\sigma\cos\theta}\ \ (\text{field radiance, arriving})`}

### Everything from radiance

Radiance is the **fundamental** quantity; the others follow from it. With ${tex`\mathbf k`} an incident
direction above the surface, at angle ${tex`\theta`} from the normal and azimuth ${tex`\phi`}:

${tex.block`H = \int_{\text{all }\mathbf k} L_f(\mathbf k)\cos\theta\, d\sigma = \int_0^{2\pi}\!\!\int_0^{\pi/2} L_f\cos\theta\sin\theta\, d\theta\, d\phi = \pi L_f \quad\text{for constant } L_f`}

Power is ${tex`\Phi = \int H(\mathbf x)\, dA`}, integrating over the points of the surface. The integral for
${tex`H`} is a job for Module 11's estimator, with uniform directions
(${tex`p = 1/2\pi`}, and ${tex`\cos\theta = \xi`}):

```js echo
function estimateIrradiance(L, N) {
  let sum = 0;
  for (let i = 0; i < N; i++) sum += (L * xi()) / (1 / (2 * Math.PI));
  return sum / N;
}
```

With ${tex`L = 1`}, it should approach ${tex`\pi`} as the number of directions grows:

```js
const radianceN = view(Inputs.radio([10, 100, 1000, 10000, 100000], {value: 1000, label: "random directions"}));
```

```js
html`<pre>estimate of H = ${estimateIrradiance(1, radianceN).toFixed(4)}   (π L = ${Math.PI.toFixed(4)})</pre>`
```

The factor ${tex`\pi`}, not ${tex`2\pi`}, comes from the cosine: light
arriving at a grazing angle spreads over more area.

## Scattering and Light Transport

### The BRDF and energy conservation

Rather than modeling every scratch, we describe a rough surface **statistically**:

${tex.block`\rho(\mathbf k_i, \mathbf k_o) = \frac{L_s(\mathbf k_o)}{H(\mathbf k_i)}`}

This is the **bidirectional reflectance distribution function**, a 4D function of two directions, in units of
${tex`\text{sr}^{-1}`}, so ${tex`\rho = 1/\pi`} is not a fraction. **Both** ${tex`\mathbf k_i`} (toward the
light) and ${tex`\mathbf k_o`} (toward the viewer) point **away** from the surface. It uses irradiance, not
radiance, so it does not depend on the size or shape of the light. Volumes use the matching idea, a **phase
function**, which is a PDF over scattering directions.

What fraction of the light from ${tex`\mathbf k_i`} is reflected? This is the **directional hemispherical
reflectance**, and energy conservation requires ${tex`0 \le R \le 1`}:

${tex.block`R(\mathbf k_i) = \frac{E}{H} = \int_{\text{all }\mathbf k_o} \rho(\mathbf k_i, \mathbf k_o)\cos\theta_o\, d\sigma_o`}

An ideal diffuse surface has a **constant** BRDF, ${tex`\rho = C`}. It looks equally bright from every
direction. Then ${tex`R = \int_0^{2\pi}\!\int_0^{\pi/2} C\cos\theta_o\sin\theta_o\, d\theta_o\, d\phi_o = \pi C`},
so ${tex`\rho = R/\pi`}. A perfect white Lambertian surface has ${tex`\rho = 1/\pi`}, which is the ${tex`\pi`}
in the Lambert term from Module 05.

To estimate ${tex`R`} for any BRDF, we use uniform directions, ${tex`p = 1/2\pi`}. Each sample is
${tex`\rho\cos\theta_o/p`}. The argument to `brdf` is ${tex`\cos\alpha`}, where ${tex`\alpha`} is the angle
between ${tex`\mathbf k_o`} and the mirror direction:

```js echo
function hemisphericalReflectance(brdf, thetaI, N = 20000) {
  const mirror = [-Math.sin(thetaI), 0, Math.cos(thetaI)];
  let sum = 0;
  for (let i = 0; i < N; i++) {
    const z = xi(), s = Math.sqrt(1 - z * z), phi = 2 * Math.PI * xi();
    const ko = [s * Math.cos(phi), s * Math.sin(phi), z];
    const cosAlpha = Math.max(0, d3.sum(ko, (c, k) => c * mirror[k]));
    sum += brdf(cosAlpha) * z * 2 * Math.PI;
  }
  return sum / N;
}
```

A Lambertian surface with ${tex`\rho = 1/\pi`} should reflect everything:

```js echo
hemisphericalReflectance(() => 1 / Math.PI, 0)
```

The plot computes ${tex`R(\theta_i)`} for three BRDFs: that Lambertian one, an **unnormalized** Phong lobe
${tex`\cos^p\alpha`} (as in Module 05), and the same lobe **normalized** by ${tex`(p+2)/2\pi`}:

```js
const lobeP = view(Inputs.range([1, 200], {value: 20, step: 1, label: "Phong exponent p"}));
```

```js
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

### The transport equation

Light arriving with field radiance ${tex`L_f(\mathbf k_i)`} through a small solid angle gives irradiance
${tex`L_f\cos\theta_i\,\Delta\sigma_i`}, so it adds ${tex`\rho\, L_f\cos\theta_i\,\Delta\sigma_i`} to the
outgoing radiance. Summing over all directions, and adding the radiance ${tex`L_e`} the surface **emits**
itself, gives the **transport (rendering) equation** (Kajiya, 1986; Immel, Cohen, and Greenberg, 1986):

${tex.block`L_s(\mathbf k_o) = L_e(\mathbf k_o) + \int \rho(\mathbf k_i, \mathbf k_o)\, L_f(\mathbf k_i)\cos\theta_i\, d\sigma_i`}

${tex`L_e`} is zero except on lights, and the book's version omits it. The equation is **recursive**, since each
${tex`L_f`} is another surface's ${tex`L_s`}.

### Area form and visibility

Each incoming direction comes from a surface point ${tex`\mathbf x'`}, whose normal makes angle ${tex`\theta'`}
with the direction to ${tex`\mathbf x`}. A patch ${tex`dA'`} there covers solid angle
${tex`d\sigma_i = \cos\theta'\,dA'/\lVert\mathbf x - \mathbf x'\rVert^2`}, so, leaving out ${tex`L_e`},

${tex.block`L_s(\mathbf x, \mathbf k_o) = \int_{\text{all }\mathbf x'} \frac{\rho(\mathbf k_i, \mathbf k_o)\, L_s(\mathbf x', \mathbf x - \mathbf x')\, v(\mathbf x, \mathbf x')\cos\theta_i\cos\theta'}{\lVert\mathbf x - \mathbf x'\rVert^2}\, dA'`}

The **visibility function** ${tex`v(\mathbf x, \mathbf x')`} is 1 when the two points see each other and 0 otherwise. It
moves the complexity from the domain into the integrand. The geometry term translates directly to code, and the
direct lighting shader below uses exactly this:

```js echo
const areaTerm = (cosI, cosLight, dist2) => (cosI * cosLight) / dist2;
```

Doubling the distance to a light patch should quarter its contribution:

```js echo
areaTerm(1, 1, 2 ** 2) / areaTerm(1, 1, 1)
```

### Materials in practice

Visible structure, like carpet pile, belongs in the **geometry**. Invisible microstructure, like paper fibers,
belongs in the **BRDF**. Industry practice combines **lobes**, weighted by constants or by Fresnel. The
**Burley/Disney** model, with diffuse, glossy, sheen, and more, is widely used in film, games, and product
design. Its dominant glossy lobe is the **GGX** microfacet model, a statistical distribution of microfacet
normals, which we build at the end of this module.

### Monte Carlo ray tracing

Apply Module 11's estimator to the transport equation. With **one** random direction ${tex`\mathbf q \sim p`}:

${tex.block`L_s(\mathbf k_o) \approx \frac{\rho(\mathbf q, \mathbf k_o)\, L_f(\mathbf q)\cos\theta_i}{p(\mathbf q)}, \qquad p = \frac{1}{2\pi}\ \text{(uniform hemisphere)}`}

${tex`L_f(\mathbf q)`} is itself an integral: the radiance from whatever surface ${tex`\mathbf q`} points to. So
we estimate it the same way at the next hit, and recurse. This is **path tracing**:

```js run=false
function radiance(o, d) {
  const hit = scene.intersect(o, d);
  if (!hit) return background(o, d);
  const q = randomDirection();   // q ~ p; θi: angle between q and the normal
  const weight = brdf(q, -d) * cosThetaI / p(q);
  return emitted(hit) + weight * radiance(hit.x, q);
}
```

Here ${tex`\mathbf q`} plays ${tex`\mathbf k_i`} and ${tex`-\mathbf d`} plays ${tex`\mathbf k_o`}: both point away
from the surface. This works because expected values add, even for dependent terms. Each pixel averages many
random paths, and the noise falls as ${tex`1/\sqrt N`}.

### Termination

In a closed scene, the recursion must stop somewhere. The **furnace test** makes this concrete: inside a closed sphere
that emits ${tex`E`} everywhere and has albedo ${tex`R`}, every bounce sees the same thing, so
${tex`L = E + RE + R^2E + \dots = E/(1-R)`}. A fixed **maximum depth** simply stops adding terms:

```js echo
function furnaceCapped(E, R, depth) {
  let L = 0, beta = 1;
  for (let k = 0; k < depth; k++) { L += beta * E; beta *= R; }
  return L;
}
```

With ${tex`E = 1`} and ${tex`R = 0.5`}, the exact answer is 2. Three bounces reach only 1.75, so the image is always too
dark:

```js echo
furnaceCapped(1, 0.5, 3)
```

**Russian roulette** stops at random instead. It continues with probability ${tex`q`} and divides the survivors by
${tex`q`}, which keeps the estimate **unbiased**. It only adds noise:

```js echo
function furnaceRoulette(E, R, q) {
  let L = 0, beta = 1, bounces = 0;
  for (;;) {
    L += beta * E; beta *= R; bounces++;
    if (xi() > q) return {L, bounces};
    beta /= q;
  }
}
```

Averaged over 20,000 paths, with those same values, it should be very close to 2:

```js echo
d3.mean(d3.range(20000), () => furnaceRoulette(1, 0.5, 0.8).L)
```

```js
const furnaceForm = view(Inputs.form({
  R: Inputs.range([0, 0.95], {value: 0.8, step: 0.01, label: "albedo R"}),
  depth: Inputs.range([1, 30], {value: 4, step: 1, label: "depth cap"}),
  q: Inputs.range([0.1, 0.99], {value: 0.8, step: 0.01, label: "roulette continue probability q"})
}));
```

```js
(() => {
  const E = 1, exact = E / (1 - furnaceForm.R), paths = 20000;
  const runs = d3.range(paths).map(() => furnaceRoulette(E, furnaceForm.R, furnaceForm.q));
  const mean = d3.mean(runs, (r) => r.L), sd = d3.deviation(runs, (r) => r.L);
  return html`<pre>exact            L = E / (1 − R) = ${exact.toFixed(4)}
depth cap ${String(furnaceForm.depth).padStart(2)}     L ≈ ${furnaceCapped(E, furnaceForm.R, furnaceForm.depth).toFixed(4)}   (always too dark: biased)
Russian roulette L ≈ ${mean.toFixed(4)} ± ${(sd / Math.sqrt(paths)).toFixed(4)}   (unbiased; ${d3.mean(runs, (r) => r.bounces).toFixed(1)} bounces per path on average)</pre>`;
})()
```

### Direct lighting

Small, bright lights are rarely hit by chance, so the image is **very noisy**. We compute their contribution
**separately**: `directLightAt` samples **points on the lights**, using the area form, and casts **shadow rays**.

```js run=false
return directLightAt(x) + (brdf(q, -d) * cosThetaI / p(q)) * radiance(x, q);
```

A light hit by the camera ray, or seen in a mirror, gets no `directLightAt` term, so its emission must be added there,
or it renders black. When a later random bounce hits a light, do **not** add its emission again:
`directLightAt` already counted that light at the previous hit. **Impulse** materials (mirrors, glass) have
delta-function BRDFs and need an explicit branch, as in Module 10.

## Physics-Based Rendering in WebGPU

```js
const {device, format: canvasFormat} = await initializeWebGPU(document.createElement("canvas"));
const deviceErrorLog = document.createElement("pre");
deviceErrorLog.style.cssText = "display: none; color: #e5484d; background: #2a1214; border: 1px solid #e5484d; border-radius: 6px; padding: 8px 12px; font-size: 12px; white-space: pre-wrap;";
device.addEventListener("uncapturederror", (e) => { deviceErrorLog.textContent += `WebGPU error: ${e.error.message}\n`; deviceErrorLog.style.display = "block"; });
const showShader = (code) => html`<pre><code>${code.trim()}</code></pre>`;
```

```js
deviceErrorLog
```

### A path tracer with an area light, glass, and a thin lens

A compute shader traces one path per pixel per frame through a box with
a rectangular **area light**, a mirror ball, a tinted glass ball, and a
matte ball. The compute and display structure follows Module 11's progressive accumulation, so we focus on what
is new.

The image size goes into the shaders as text, as in Module 11:

```js echo
const ptW = 400, ptH = 400;
```

The uniforms hold the camera, lens, exposure, and path settings. `flags` has one bit for direct lighting and one
for tone mapping:

```js echo
const wgslPtParams = `
struct Params {
  e: vec3<f32>, aperture: f32,
  u: vec3<f32>, focusDist: f32,
  v: vec3<f32>, tanHalf: f32,
  w: vec3<f32>, exposure: f32,
  frame: u32, seed: u32, flags: u32, maxDepth: u32,
};
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read_write> accum: array<vec4<f32>>;`;
```

Every surface has a material. A material's `kind` says how it scatters, and only the light has a nonzero `emitted`.
The scene's walls are quads, with the light as a small one just under the ceiling, and the balls are spheres. Their
data and the intersection tests, which follow Module 10, stay out of sight, except for this much:

```js echo
const wgslMaterial = `
const DIFFUSE = 0u;
const MIRROR = 1u;
const GLASS = 2u;
struct Material { albedo: vec3<f32>, kind: u32, emitted: vec3<f32> };`;
```

```js
const wgslPtScene = `
fn pcg(v: u32) -> u32 {
  let state = v * 747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
fn rand(seed: ptr<function, u32>) -> f32 { *seed = pcg(*seed); return f32(*seed >> 8u) / 16777216.0; }
const PI = 3.14159265;
const EPS = 1e-3;
const ABSORB = vec3<f32>(0.45, 0.85, 0.6);
struct Quad { corner: vec3<f32>, e1: vec3<f32>, e2: vec3<f32>, mat: u32 };
struct Sphere { center: vec3<f32>, radius: f32, mat: u32 };
struct Ray { o: vec3<f32>, d: vec3<f32> };
struct Hit { t: f32, n: vec3<f32>, mat: i32 };
var<private> materials: array<Material, 7> = array<Material, 7>(
  Material(vec3<f32>(0.73), DIFFUSE, vec3<f32>(0.0)),
  Material(vec3<f32>(0.65, 0.06, 0.05), DIFFUSE, vec3<f32>(0.0)),
  Material(vec3<f32>(0.12, 0.45, 0.15), DIFFUSE, vec3<f32>(0.0)),
  Material(vec3<f32>(0.0), DIFFUSE, vec3<f32>(17.0, 15.0, 11.0)),
  Material(vec3<f32>(0.95), MIRROR, vec3<f32>(0.0)),
  Material(vec3<f32>(1.0), GLASS, vec3<f32>(0.0)),
  Material(vec3<f32>(0.8, 0.6, 0.2), DIFFUSE, vec3<f32>(0.0)));
var<private> quads: array<Quad, 6> = array<Quad, 6>(
  Quad(vec3<f32>(-1.0, 0.0, -1.0), vec3<f32>(2.0, 0.0, 0.0), vec3<f32>(0.0, 0.0, 2.0), 0u),
  Quad(vec3<f32>(-1.0, 2.0, -1.0), vec3<f32>(2.0, 0.0, 0.0), vec3<f32>(0.0, 0.0, 2.0), 0u),
  Quad(vec3<f32>(-1.0, 0.0, -1.0), vec3<f32>(2.0, 0.0, 0.0), vec3<f32>(0.0, 2.0, 0.0), 0u),
  Quad(vec3<f32>(-1.0, 0.0, -1.0), vec3<f32>(0.0, 0.0, 2.0), vec3<f32>(0.0, 2.0, 0.0), 1u),
  Quad(vec3<f32>(1.0, 0.0, -1.0), vec3<f32>(0.0, 0.0, 2.0), vec3<f32>(0.0, 2.0, 0.0), 2u),
  Quad(vec3<f32>(-0.3, 1.99, -0.3), vec3<f32>(0.6, 0.0, 0.0), vec3<f32>(0.0, 0.0, 0.6), 3u));
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
  let disc = B * B - (dot(ec, ec) - s.radius * s.radius);
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
}`;
```

**Direct lighting** samples a uniform point on the light, with ${tex`p = 1/\text{area}`}, and applies the area form. Dividing by
${tex`p`} is multiplying by the area. Quad 5 is the light, and `cosL` is the angle at the light's own surface:

```js echo
const wgslDirectLight = `
fn directLight(
  x: vec3<f32>, n: vec3<f32>, albedo: vec3<f32>, seed: ptr<function, u32>
) -> vec3<f32> {
  let light = quads[5];
  let xl = light.corner + rand(seed) * light.e1 + rand(seed) * light.e2;
  let toL = xl - x;
  let d2 = dot(toL, toL);
  let l = toL * inverseSqrt(d2);
  let lightN = normalize(cross(light.e1, light.e2));
  let cosI = dot(n, l);
  let cosL = -dot(lightN, l);
  if (cosI <= 0.0 || cosL <= 0.0) { return vec3<f32>(0.0); }
  let blocker = sceneHit(Ray(x, l), sqrt(d2) - EPS);
  if (blocker.mat >= 0) { return vec3<f32>(0.0); }
  let area = length(cross(light.e1, light.e2));
  return (albedo / PI) * materials[3].emitted * cosI * cosL / d2 * area;
}`;
```

A **glass** hit picks reflect with probability ${tex`R`} or refract with probability ${tex`1 - R`}, as the photon tracer did. Each
choice's weight ${tex`R/R`} or ${tex`(1-R)/(1-R)`} is 1, so `beta` changes only by Beer's law, for the distance the ray just
traveled inside. Schlick uses the angle on the air side. WGSL's `refract` returns zero on total internal reflection:

```js echo
const wgslGlass = `
fn schlick(c: f32, R0: f32) -> f32 {
  return R0 + (1.0 - R0) * pow(1.0 - c, 5.0);
}
fn glassBounce(
  ray: Ray, h: Hit, x: vec3<f32>,
  seed: ptr<function, u32>, beta: ptr<function, vec3<f32>>
) -> Ray {
  let entering = dot(ray.d, h.n) < 0.0;
  if (!entering) { *beta *= pow(ABSORB, vec3<f32>(h.t)); }
  let nn = select(-h.n, h.n, entering);
  let t = refract(ray.d, nn, select(1.5, 1.0 / 1.5, entering));
  let cosAir = select(-dot(t, nn), -dot(ray.d, nn), entering);
  let tir = all(t == vec3<f32>(0.0));
  let reflects = tir || rand(seed) < schlick(cosAir, 0.04);
  return Ray(x, select(t, reflect(ray.d, nn), reflects));
}`;
```

A **diffuse** bounce adds the direct light, then continues in a random cosine-weighted direction. Cosine-weighted sampling cancels both
the ${tex`\pi`} and the cosine: ${tex`(R/\pi)\cos\theta / (\cos\theta/\pi) = R`}, so the **throughput** `beta` simply multiplies by the
albedo:

```js echo
const wgslDiffuse = `
fn diffuseBounce(
  ray: Ray, h: Hit, x: vec3<f32>, albedo: vec3<f32>,
  seed: ptr<function, u32>, beta: ptr<function, vec3<f32>>
) -> Ray {
  let n = select(h.n, -h.n, dot(h.n, ray.d) > 0.0);
  *beta *= albedo;
  let xi = vec2<f32>(rand(seed), rand(seed));
  return Ray(x, toWorld(sampleCosineHemisphere(xi), n));
}`;
```

The rules for counting a light's emission come next. A camera ray, or a ray after a mirror or glass, must count it, since no
direct-lighting step ran. Otherwise, the shadow ray has already counted it, so counting it again would double it. The light is
one-sided, so only its front counts:

```js echo
const wgslEmission = `
fn emissionSeen(
  ray: Ray, h: Hit, m: Material, specular: bool, nee: bool
) -> vec3<f32> {
  let front = dot(ray.d, h.n) < 0.0;
  return select(vec3<f32>(0.0), m.emitted, (specular || !nee) && front);
}`;
```

**Russian roulette** in the shader is the same idea as `furnaceRoulette`. The brighter the throughput, the more likely the path
continues:

```js echo
const wgslRoulette = `
fn surviveRoulette(
  seed: ptr<function, u32>, beta: ptr<function, vec3<f32>>
) -> bool {
  let q = min(0.95, max((*beta).x, max((*beta).y, (*beta).z)));
  if (rand(seed) > q) { return false; }
  *beta /= q;
  return true;
}`;
```

Now the loop that replaces recursion. It carries `L`, the radiance so far, and `beta`, the product of
${tex`\rho\cos\theta/p`}:

```js echo
const wgslRadiance = `
fn radiance(primary: Ray, seed: ptr<function, u32>) -> vec3<f32> {
  let nee = (P.flags & 1u) != 0u;
  var ray = primary;
  var L = vec3<f32>(0.0);
  var beta = vec3<f32>(1.0);
  var specular = true;
  for (var depth = 0u; depth < P.maxDepth; depth++) {
    let h = sceneHit(ray, 1e30);
    if (h.mat < 0) { break; }
    let m = materials[h.mat];
    let x = ray.o + h.t * ray.d;
    if (any(m.emitted > vec3<f32>(0.0))) {
      L += beta * emissionSeen(ray, h, m, specular, nee);
      break;
    }
    if (m.kind == DIFFUSE) {
      let n = select(h.n, -h.n, dot(h.n, ray.d) > 0.0);
      if (nee) { L += beta * directLight(x, n, m.albedo, seed); }
      ray = diffuseBounce(ray, h, x, m.albedo, seed, &beta);
    } else if (m.kind == MIRROR) {
      beta *= m.albedo;
      ray = Ray(x, reflect(ray.d, h.n));
    } else {
      ray = glassBounce(ray, h, x, seed, &beta);
    }
    specular = m.kind != DIFFUSE;
    if (depth >= 3u && !surviveRoulette(seed, &beta)) { break; }
  }
  return L;
}`;
```

The **thin lens** starts each camera ray at a random point on the lens, using Module 11's disk warp, and aims it at the point this pixel
would see on the plane of focus. All rays through the lens for this pixel meet at that point, matching the thin-lens rule. With a radius
of zero, it is a pinhole. Since we choose the focus distance directly, the focal length never appears:

```js echo
const wgslCameraRay = `
fn cameraRay(px: f32, py: f32, seed: ptr<function, u32>) -> Ray {
  let dir = normalize(-P.w + px * P.tanHalf * P.u + py * P.tanHalf * P.v);
  let focusPoint = P.e + dir * (P.focusDist / dot(dir, -P.w));
  let xi = vec2<f32>(rand(seed), rand(seed));
  let lens = sampleDisk(xi, P.aperture);
  let origin = P.e + lens.x * P.u + lens.y * P.v;
  return Ray(origin, normalize(focusPoint - origin));
}`;
```

The compute entry point jitters within the pixel and folds the result into Module 11's running mean. Radiance goes in **as it is**, in
floating point:

```js echo
const wgslPtMain = `
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= ${ptW}u || id.y >= ${ptH}u) { return; }
  var seed = pcg(id.x + pcg(id.y + pcg(P.seed)));
  let px = (f32(id.x) + rand(&seed)) / ${ptW}.0 * 2.0 - 1.0;
  let py = 1.0 - (f32(id.y) + rand(&seed)) / ${ptH}.0 * 2.0;
  let c = radiance(cameraRay(px, py, &seed), &seed);
  let i = id.y * ${ptW}u + id.x;
  accum[i] += (vec4<f32>(c, 1.0) - accum[i]) / f32(P.frame + 1u);
}`;
```

Radiance easily exceeds 1, so it is **compressed** only for display. **Reinhard tone mapping** is ${tex`c/(1+c)`}. A value of 1 should map to
0.5, and a very bright one should approach, but never reach, 1:

```js echo
const reinhard = (c) => c / (1 + c);
```

```js echo
[1, 10, 1000].map(reinhard)
```

The display pass applies it, then gamma, for a non-sRGB canvas format:

```js echo
const wgslToneMap = `
@group(0) @binding(1) var<storage, read> image: array<vec4<f32>>;
@fragment
fn fs_tonemap(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
  let c = P.exposure * image[u32(pos.y) * ${ptW}u + u32(pos.x)].rgb;
  let clamped = clamp(c, vec3<f32>(0.0), vec3<f32>(1.0));
  let mapped = select(clamped, c / (1.0 + c), (P.flags & 2u) != 0u);
  return vec4<f32>(pow(mapped, vec3<f32>(1.0 / 2.2)), 1.0);
}`;
```

Joining all of the pieces gives the complete shader:

```js echo
const ptShader = [wgslPtParams, wgslMaterial, wgslPtScene, wgslDirectLight,
  wgslGlass, wgslDiffuse, wgslEmission, wgslRoulette, wgslRadiance,
  wgslCameraRay, wgslPtMain, wgslToneMap
].join("\n");
```

```js
showShader(ptShader)
```

```js
const ptModule = device.createShaderModule({code: `${ptShader}
@vertex
fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  var pos = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  return vec4<f32>(pos[i], 0.0, 1.0);
}`});
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
const {context: ptContext} = await initializeWebGPU(ptCanvas, {device});
const ptStatus = html`<pre style="margin: 4px 0"></pre>`;
function encodePtFrame() {
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
}
```

The host fills the uniforms through two views of one `ArrayBuffer`, since they mix floats and integers. The camera sits at
${tex`z = 3.8`}, looking down the box:

```js echo
function ptParamData(form) {
  const data = new ArrayBuffer(80);
  new Float32Array(data).set([
    0, 1, 3.8, form.aperture,  1, 0, 0, form.focusDist,
    0, 1, 0, 0.34,             0, 0, 1, form.exposure
  ]);
  const u = new Uint32Array(data);
  u[18] = (form.direct ? 1 : 0) | (form.toneMap ? 2 : 0);
  u[19] = form.maxDepth;
  return {data, u};
}
```

Each frame sets the frame number and a new seed, uploads the uniforms, and runs one compute and one display pass, as in Module 11.
Changing any control re-runs this cell, which restarts the running mean:

```js echo
{
  const {data, u} = ptParamData(ptForm);
  let frame = 0, running = true;
  invalidation.then(() => (running = false));
  const start = performance.now();
  function step() {
    if (!running || frame >= ptForm.maxFrames) return;
    u[16] = frame; u[17] = frame + 1;
    device.queue.writeBuffer(ptParams, 0, data);
    encodePtFrame();
    frame++;
    const seconds = ((performance.now() - start) / 1000).toFixed(1);
    ptStatus.textContent = `${frame} samples per pixel, ${seconds} s`;
    requestAnimationFrame(step);
  }
  step();
}
```

```js
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

```js
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

Real-time renderers use the same physics without paths: a Lambertian diffuse lobe ${tex`\rho = R/\pi`} plus a **glossy**
lobe, weighted by Fresnel.

A rough surface is modeled as tiny mirrors, called **microfacets**. With unit ${tex`\mathbf l = \mathbf k_i`} and
${tex`\mathbf v = \mathbf k_o`}, only facets whose normal is the half vector ${tex`\mathbf h`} reflect ${tex`\mathbf l`} into
${tex`\mathbf v`}:

${tex.block`\rho_{\text{glossy}} = \frac{D(\mathbf h)\, G(\mathbf l, \mathbf v)\, F(\mathbf v\cdot\mathbf h)}{4\,(\mathbf n\cdot\mathbf l)(\mathbf n\cdot\mathbf v)}`}

- ${tex`D`} is the **distribution** of facet normals, the density of facets facing ${tex`\mathbf h`}.
- ${tex`G`} is **masking–shadowing**, the fraction of those facets that both ${tex`\mathbf l`} and ${tex`\mathbf v`} can see.
- ${tex`F`} is the Fresnel reflectance of a facet, by Schlick with ${tex`\cos\theta = \mathbf v\cdot\mathbf h`}.
- The denominator converts from the facets' area and angles to the surface's.

The **GGX** distribution, with ${tex`\alpha`} larger for rougher surfaces, controls the highlight's shape:

${tex.block`D(\mathbf h) = \frac{\alpha^2}{\pi\big((\mathbf n\cdot\mathbf h)^2(\alpha^2 - 1) + 1\big)^2}, \qquad \alpha = \text{roughness}^2`}

```js echo
function ggxD(cosH, roughness) {
  const a2 = roughness ** 4;
  return a2 / (Math.PI * (cosH * cosH * (a2 - 1) + 1) ** 2);
}
```

At the peak, where ${tex`\mathbf h = \mathbf n`}, this equals ${tex`1/(\pi\alpha^2)`}. So going from roughness 0.5 to 0.25 quarters
${tex`\alpha`} and should make the peak 16 times taller:

```js echo
ggxD(1, 0.25) / ggxD(1, 0.5)
```

```js
Plot.plot({height: 200, width: 560, x: {label: "angle between n and h (degrees)"}, y: {label: "D (log scale)", type: "log", domain: [1e-3, 1e3]}, color: {legend: true, type: "ordinal"},
  marks: [Plot.line([0.1, 0.3, 0.5, 0.8].flatMap((rough) => d3.range(0, 89.5, 0.5).map((a) => {
    return {a, D: ggxD(Math.cos(rad(a)), rough), roughness: rough};
  })), {x: "a", y: "D", stroke: "roughness", strokeWidth: 2})]})
```

Low roughness gives a tall, narrow lobe: a sharp, bright highlight.
High roughness spreads it out.

In the shader, each of those factors takes a line or two. ${tex`G`} is the Schlick–GGX approximation for a direct light:

```js echo
const wgslGlossyTerms = `
fn distributionGGX(nh: f32, rough: f32) -> f32 {
  let a2 = pow(rough, 4.0);
  return a2 / (PI * pow(nh * nh * (a2 - 1.0) + 1.0, 2.0));
}
fn visibilityG(nv: f32, nl: f32, rough: f32) -> f32 {
  let k = pow(rough + 1.0, 2.0) / 8.0;
  return (nv / (nv * (1.0 - k) + k)) * (nl / (nl * (1.0 - k) + k));
}`;
```

The material mixes the two lobes. A **dielectric** has ${tex`F_0 = 0.04`}, and a **metal** has ${tex`F_0`} equal to its base color and no diffuse
term. Tiny lower limits on the cosines avoid dividing by zero:

```js echo
const wgslBrdf = `
fn brdf(n: vec3<f32>, v: vec3<f32>, l: vec3<f32>,
        base: vec3<f32>, metallic: f32, rough: f32) -> vec3<f32> {
  let h = normalize(v + l);
  let nv = max(dot(n, v), 1e-4);
  let nl = max(dot(n, l), 1e-4);
  let D = distributionGGX(max(dot(n, h), 0.0), rough);
  let F0 = mix(vec3<f32>(0.04), base, metallic);
  let F = F0 + (1.0 - F0) * pow(1.0 - max(dot(v, h), 0.0), 5.0);
  let diffuse = (1.0 - F) * (1.0 - metallic) * base / PI;
  return diffuse + D * visibilityG(nv, nl, rough) * F / (4.0 * nv * nl);
}`;
```

The fragment shader multiplies that by the light and the cosine, as the transport equation says, and then tone maps. For a point light in a real
scene, the light's term would be ${tex`I/r^2`} from Module 05; here it is a constant strength. The grid below uses one shader for ten spheres:
dielectric on the top row, metal on the bottom, with roughness rising from left to right.

```js echo
const wgslGgxFragment = `
@fragment
fn fs_main(frag: VOut) -> @location(0) vec4<f32> {
  let n = normalize(frag.normal);
  let v = normalize(U.camPos.xyz - frag.world);
  let l = normalize(U.lightPos.xyz - frag.world);
  let f = brdf(n, v, l, U.base.rgb, U.base.a, U.params.x);
  var c = f * U.params.z * max(dot(n, l), 0.0) + 0.02 * U.base.rgb;
  if (U.params.y > 0.5) { c = c / (1.0 + c); }
  let shown = clamp(c, vec3<f32>(0.0), vec3<f32>(1.0));
  return vec4<f32>(pow(shown, vec3<f32>(1.0 / 2.2)), 1.0);
}`;
```

```js
const ggxModule = device.createShaderModule({code: `
const PI = 3.14159265;
struct Uniforms { mvp: mat4x4<f32>, model: mat4x4<f32>, lightPos: vec4<f32>, camPos: vec4<f32>, base: vec4<f32>, params: vec4<f32> };
@group(0) @binding(0) var<uniform> U: Uniforms;
${wgslGlossyTerms}${wgslBrdf}
struct VOut { @builtin(position) pos: vec4<f32>, @location(0) world: vec3<f32>, @location(1) normal: vec3<f32> };
@vertex
fn vs_main(@location(0) p: vec3<f32>, @location(1) n: vec3<f32>) -> VOut {
  return VOut(U.mvp * vec4<f32>(p, 1.0), (U.model * vec4<f32>(p, 1.0)).xyz, (U.model * vec4<f32>(n, 0.0)).xyz);
}
${wgslGgxFragment}`});
const ggxPipeline = device.createRenderPipeline({
  layout: "auto",
  vertex: {module: ggxModule, entryPoint: "vs_main", buffers: [{arrayStride: 24, attributes: [
    {shaderLocation: 0, offset: 0, format: "float32x3"}, {shaderLocation: 1, offset: 12, format: "float32x3"}]}]},
  fragment: {module: ggxModule, entryPoint: "fs_main", targets: [{format: canvasFormat}]},
  primitive: {topology: "triangle-list"},
  depthStencil: {format: "depth24plus", depthWriteEnabled: true, depthCompare: "less"}
});
const ggxSphere = geometry.createSphere(24, 32);
const ggxVB = createBuffer(device, geometry.interleave(ggxSphere.positions, ggxSphere.normals), GPUBufferUsage.VERTEX);
const ggxIndexCount = ggxSphere.indices.length;
const ggxIB = createBuffer(device, ggxSphere.indices, GPUBufferUsage.INDEX);
const ggxRoughness = [0.1, 0.3, 0.5, 0.7, 0.9];
const ggxDrawables = [0, 1].flatMap((metallic) => ggxRoughness.map((roughness, col) => {
  const buffer = device.createBuffer({size: 192, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
  return {metallic, roughness, buffer, model: mat4.multiply(transforms.translate((col - 2) * 1.05, metallic ? -0.55 : 0.55, 0), transforms.scale(0.46, 0.46, 0.46)),
    bindGroup: device.createBindGroup({layout: ggxPipeline.getBindGroupLayout(0), entries: [{binding: 0, resource: {buffer}}]})};
}));
const ggxCanvas = document.createElement("canvas");
ggxCanvas.width = 560; ggxCanvas.height = 330;
ggxCanvas.style.cssText = "border-radius: 8px; max-width: 100%";
const {context: ggxContext} = await initializeWebGPU(ggxCanvas, {device});
const ggxDepth = device.createTexture({size: [560, 330], format: "depth24plus", usage: GPUTextureUsage.RENDER_ATTACHMENT});
```

```js
const ggxForm = view(Inputs.form({
  azimuth: Inputs.range([-90, 90], {value: 30, step: 1, label: "light azimuth"}),
  elevation: Inputs.range([0, 80], {value: 35, step: 1, label: "light elevation"}),
  strength: Inputs.range([1, 40], {value: 6, step: 0.5, label: "light strength"}),
  toneMap: Inputs.toggle({value: true, label: "Reinhard tone mapping"})
}));
```

```js
{
  const VP = mat4.multiply(transforms.perspective(rad(40), 560 / 330, 0.1, 20), transforms.lookAt([0, 0, 6.5], [0, 0, 0], [0, 1, 0]));
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

```js
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
