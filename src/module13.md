---
title: Module 13 — Computer Animation
toc: true
---

```js echo
import * as d3 from "npm:d3";
import * as mat4 from "./components/mat4.js";
import * as webgpu from "./components/webgpu.js";
import {plane, drawPoint, dragPoints} from "./components/vectorField.js";
import * as Inputs from "npm:@observablehq/inputs";
import {html} from "npm:htl";
```

# Module 13 · Computer Animation

Animation makes the numbers that describe a scene change over time.
There are four ways to produce that change, and each trades **control**
against **automation**:

| Approach | The animator provides | The computer provides |
|---|---|---|
| **Keyframing** | values at chosen moments | everything in between |
| **Procedural** | a function and its parameters | motion from that function |
| **Physics-based** | initial conditions and forces | a solution of the equations of motion |
| **Motion capture** | a real performance | its transfer to a model |

This handout follows the reading: the principles of animation,
keyframing and motion control, rotations, deformation and characters,
and physics, procedures, and groups. Many figures **play continuously**.
The last section runs animation on the GPU and needs **Chrome or Edge
113+**. This handout teaches the *techniques*; it is not a walkthrough of
any graded assignment.

```js echo
const rad = (d) => (d * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI;
const row = (...nodes) => html`<div style="display:flex; gap:16px; flex-wrap:wrap; align-items:flex-start">${nodes}</div>`;
function drawPath(scene, points, {stroke = "steelblue", width = 2, dash = null, opacity = 1, fill = "none"} = {}) {
  const line = d3.line().x((p) => scene.x(p.x)).y((p) => scene.y(p.y));
  const path = scene.svg.append("path").attr("d", line(points)).attr("fill", fill).attr("stroke", stroke)
    .attr("stroke-width", width).attr("opacity", opacity).attr("stroke-linejoin", "round");
  if (dash) path.attr("stroke-dasharray", dash);
  return path;
}
```

## Principles of Animation

### Timing, slow in and out, and squash and stretch

Speed carries meaning: heavy things accelerate slowly, and nothing
changes speed instantly. The **spacing** of frames shows speed: close
together near a stop, spread apart at full speed. **Squash and stretch**
deforms a moving object along its motion while **preserving volume**
(in 2D, area: the ellipse keeps ${tex`ab = R^2`}). Compare a ball whose height
changes at constant speed with one that follows gravity:

```js echo
const ballForm = view(Inputs.form({
  timing: Inputs.radio(["constant speed", "gravity (slow in and out)"], {value: "gravity (slow in and out)", label: "timing"}),
  squash: Inputs.toggle({value: true, label: "squash and stretch"})
}));
```

```js echo
function ballState(tau, {timing, squash}) {          // tau ∈ [0, 1): one bounce
  const R = 0.35, H = 2.4;
  const physics = timing.startsWith("gravity");
  const y = R + (physics ? 4 * H * tau * (1 - tau) : H * (1 - Math.abs(2 * tau - 1)));
  const vy = physics ? 4 * H * (1 - 2 * tau) : 2 * H * Math.sign(0.5 - tau);
  let a = R, b = R;                                    // a: along the motion (vertical), b: across
  if (squash) {
    const s = 1 + 0.06 * Math.abs(vy);                 // stretch with speed ...
    a = R * s; b = R / s;                              // ... keeping a·b = R²
    const contact = Math.min(1, Math.min(tau, 1 - tau) / 0.06);   // squash for a moment at impact
    if (contact < 1) { a = R * (0.6 + 0.4 * contact); b = (R * R) / a; }
  }
  return {y: Math.max(a, y), a, b};
}
```

```js echo
(() => {
  const scene = plane({width: 420, height: 380, domain: 3.2});
  const tau = (now / 1200) % 1;
  for (let k = 0; k < 16; k++) {                        // ghosts: 16 equally spaced frames of one bounce
    const g = ballState(k / 16, ballForm);
    scene.svg.append("ellipse").attr("cx", scene.x(-2.2 + k * 0.29)).attr("cy", scene.y(g.y - 3)).attr("rx", scene.x(g.b) - scene.x(0)).attr("ry", scene.x(g.a) - scene.x(0))
      .attr("fill", "none").attr("stroke", "steelblue").attr("stroke-opacity", 0.5);
  }
  const b = ballState(tau, ballForm);
  scene.svg.append("line").attr("x1", 0).attr("x2", 420).attr("y1", scene.y(-3)).attr("y2", scene.y(-3)).attr("stroke", "gray");
  scene.svg.append("ellipse").attr("cx", scene.x(1.2)).attr("cy", scene.y(b.y - 3)).attr("rx", scene.x(b.b) - scene.x(0)).attr("ry", scene.x(b.a) - scene.x(0)).attr("fill", "orangered");
  return scene.svg.node();
})()
```

The outlines are 16 equally spaced frames of one bounce. With gravity,
they bunch up near the top (slow out and slow in) and spread apart near
the floor. At constant speed, the spacing is even and the ball looks
weightless. Stretching also reduces **strobing**, since a fast ball
overlaps its previous position.

The other principles are about design rather than computation:
**staging** (make the important action obvious), **anticipation, action,
and follow-through**, **overlapping and secondary action**, **arcs**, and
**pose-to-pose** planning, which is what keyframing automates.

## Keyframing

### Keys, Catmull–Rom, and TCB controls

A **key** ${tex`(t_k, f_k)`} fixes one parameter at one time, and the
system fits a ${tex`C^1`} curve through the keys. The tangents come from
the keys: Catmull–Rom by default, adjusted by **tension** ${tex`t`},
**continuity** ${tex`c`}, and **bias** ${tex`b`}:

${tex.block`T_k^{\text{in}} = \tfrac{(1-t)(1-c)(1+b)}{2}\,\frac{f_{k+1} - f_k}{\Delta t} + \tfrac{(1-t)(1+c)(1-b)}{2}\,\frac{f_k - f_{k-1}}{\Delta t},\quad T_k^{\text{out}} = \tfrac{(1-t)(1+c)(1+b)}{2}\,\frac{f_{k+1} - f_k}{\Delta t} + \tfrac{(1-t)(1-c)(1-b)}{2}\,\frac{f_k - f_{k-1}}{\Delta t}`}

```js echo
function tcbTangents(keys, k, {t = 0, c = 0, b = 0} = {}) {      // keys: [{t, v}] sorted by time
  const prev = keys[Math.max(k - 1, 0)], cur = keys[k], next = keys[Math.min(k + 1, keys.length - 1)];
  const dOut = next.t > cur.t ? (next.v - cur.v) / (next.t - cur.t) : 0;    // slope toward the next key
  const dIn = cur.t > prev.t ? (cur.v - prev.v) / (cur.t - prev.t) : 0;     // slope from the previous key
  return {
    in: ((1 - t) * (1 - c) * (1 + b)) / 2 * dOut + ((1 - t) * (1 + c) * (1 - b)) / 2 * dIn,
    out: ((1 - t) * (1 + c) * (1 + b)) / 2 * dOut + ((1 - t) * (1 - c) * (1 - b)) / 2 * dIn
  };
}
function sampleTCB(keys, time, params = () => ({})) {
  const n = keys.length;
  time = Math.min(Math.max(time, keys[0].t), keys[n - 1].t);
  let i = 0;
  while (i < n - 2 && time > keys[i + 1].t) i++;
  const h = keys[i + 1].t - keys[i].t, u = (time - keys[i].t) / h;
  const m0 = tcbTangents(keys, i, params(i)).out * h, m1 = tcbTangents(keys, i + 1, params(i + 1)).in * h;
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * keys[i].v + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * keys[i + 1].v + (u3 - u2) * m1;   // Hermite
}
```

```js echo
const keyWidget = dragPoints({
  k0: {x: -3, y: -1}, k1: {x: -1.8, y: 1.2}, k2: {x: -0.5, y: -0.4}, k3: {x: 0.8, y: 1.6}, k4: {x: 2, y: 0.2}, k5: {x: 3, y: 0.8}
}, {width: 440, height: 300, domain: 3.4, colors: ["#555"]});
const keyPts = view(keyWidget);
const tcbForm = view(Inputs.form({
  key: Inputs.select(["k1", "k2", "k3", "k4"], {value: "k3", label: "edit key"}),
  t: Inputs.range([-1, 1], {value: 0, step: 0.05, label: "tension t"}),
  c: Inputs.range([-1, 1], {value: 0, step: 0.05, label: "continuity c"}),
  b: Inputs.range([-1, 1], {value: 0, step: 0.05, label: "bias b"})
}));
```

```js echo
keyWidget.redecorate((scene) => {
  const entries = Object.entries(keyPts).sort((p, q) => p[1].x - q[1].x);
  const keys = entries.map(([, p]) => ({t: p.x, v: p.y}));
  const edited = entries.findIndex(([name]) => name === tcbForm.key);
  const params = (k) => (k === edited ? tcbForm : {});
  const t0 = keys[0].t, t1 = keys.at(-1).t;
  drawPath(scene, d3.range(0, 301).map((i) => { const tt = t0 + (t1 - t0) * i / 300; return {x: tt, y: sampleTCB(keys, tt, params)}; }), {stroke: "steelblue", width: 2.5});
  const T = tcbTangents(keys, edited, tcbForm), p = keys[edited];
  for (const [slope, sign, color] of [[T.in, -1, "orange"], [T.out, 1, "seagreen"]]) {
    const len = 0.6 / Math.hypot(1, slope);
    drawPath(scene, [{x: p.t, y: p.v}, {x: p.t + sign * len, y: p.v + sign * len * slope}], {stroke: color, width: 3});
  }
})
```

The orange and green segments are the incoming and outgoing tangents at
the edited key. **Tension** shortens both (1 makes the curve stop at the
key). **Continuity** ${tex`\ne 0`} makes them differ: a kink, for a
sudden change of direction such as a bounce. **Bias** tilts both
tangents toward the slope of the next segment (${tex`b > 0`}) or the
previous one (${tex`b < 0`}), so the curve overshoots on one side of the
key. Drag the keys to
change their times and values.

### Controlling speed along a path

Keys fix *where* an object is, not *how fast* it moves in between.
Separate the **path** from the **timing** with
${tex`\mathbf p(t) = \mathbf p\big(u(s(t))\big)`}: tabulate arc length
${tex`s(u)`}, invert it by search and interpolation, and let the animator
edit the distance–time curve ${tex`s(t)`}. The reading's table checks the
inversion step:

```js echo
function arcLengthTable(f, n = 400) {
  const table = [{u: 0, s: 0}];
  for (let i = 1, prev = f(0); i <= n; i++) {
    const p = f(i / n);
    table.push({u: i / n, s: table.at(-1).s + Math.hypot(p.x - prev.x, p.y - prev.y)});
    prev = p;
  }
  return table;
}
function uAtDistance(table, S) {
  const i = Math.max(1, Math.min(table.length - 1, d3.bisector((d) => d.s).left(table, S)));
  const a = table[i - 1], b = table[i];
  return a.u + ((S - a.s) / (b.s - a.s || 1)) * (b.u - a.u);
}
const readingTable = [0, 2.5, 4, 5, 7, 8.5].map((s, i) => ({u: i / 5, s}));
```

```js echo
html`<pre>u(6.5) from the reading's table = ${uAtDistance(readingTable, 6.5).toFixed(3)}   (expected 0.75)</pre>`
```

```js echo
const pathPts = [{x: -3, y: -1.5}, {x: -2.6, y: 1.8}, {x: -1.8, y: 2}, {x: -1.2, y: -1}, {x: 1.5, y: -1.6}, {x: 2.7, y: 0.2}, {x: 1.6, y: 2.3}, {x: 3, y: 2.5}];
const pathCurve = (u) => {                               // Catmull–Rom through pathPts, u ∈ [0, 1]
  const n = pathPts.length - 1, x = Math.min(u * n, n - 1e-9), i = Math.floor(x), w = x - i;
  const P = [pathPts[Math.max(i - 1, 0)], pathPts[i], pathPts[i + 1], pathPts[Math.min(i + 2, n)]];
  const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * w + (2 * a - 5 * b + 4 * c - d) * w * w + (-a + 3 * b - 3 * c + d) * w ** 3);
  return {x: cr(...P.map((p) => p.x)), y: cr(...P.map((p) => p.y))};
};
const pathTable = arcLengthTable(pathCurve);
```

```js echo
(() => {
  const scene = plane({width: 400, height: 400, domain: 3.4});
  drawPath(scene, d3.range(0, 201).map((i) => pathCurve(i / 200)), {stroke: "#bbb", width: 4});
  const total = pathTable.at(-1).s, phase = (now / 5000) % 1;
  const ease = (x) => (1 - Math.cos(Math.PI * x)) / 2;    // s(t): slow in and slow out
  const movers = [
    ["equal steps in u", "orangered", pathCurve(phase)],
    ["constant speed: s = vt", "steelblue", pathCurve(uAtDistance(pathTable, total * phase))],
    ["ease in and out", "seagreen", pathCurve(uAtDistance(pathTable, total * ease(phase)))]
  ];
  movers.forEach(([label, color, p], k) => {
    drawPoint(scene, p, {color, r: 8});
    scene.svg.append("text").attr("x", 10).attr("y", 20 + 16 * k).attr("fill", color).attr("font-size", 12).attr("font-family", "var(--sans-serif)").text(label);
  });
  return scene.svg.node();
})()
```

All three dots trace the same path in five seconds. The red one moves
slowly where the control points are close together and races across long
segments. The blue one has constant speed, and the green one starts and
stops gently.

### Rotation is special

Element-wise interpolation of rotation **matrices** fails: halfway
between ${tex`+90°`} and ${tex`-90°`} rotations is the zero matrix.

```js echo
const matLerpT = view(Inputs.range([0, 1], {value: 0.25, step: 0.01, label: "t"}));
```

```js echo
(() => {
  const A = [[0, -1], [1, 0]], B = [[0, 1], [-1, 0]];                     // rotations by +90° and −90°
  const M = A.map((r, i) => r.map((v, j) => (1 - matLerpT) * v + matLerpT * B[i][j]));
  const q = (1 - matLerpT) * rad(90) + matLerpT * rad(-90);              // interpolate the angle instead
  const R = [[Math.cos(q), -Math.sin(q)], [Math.sin(q), Math.cos(q)]];
  const shape = [{x: 0, y: 0}, {x: 2, y: 0}, {x: 2, y: 0.6}, {x: 0.6, y: 0.6}, {x: 0.6, y: 1.4}, {x: 0, y: 1.4}, {x: 0, y: 0}];
  const apply = (m, p) => ({x: m[0][0] * p.x + m[0][1] * p.y, y: m[1][0] * p.x + m[1][1] * p.y});
  const scene = plane({width: 340, height: 340, domain: 2.6});
  drawPath(scene, shape.map((p) => apply(M, p)), {stroke: "crimson", width: 2.5, fill: "crimson", opacity: 0.6});
  drawPath(scene, shape.map((p) => apply(R, p)), {stroke: "steelblue", width: 2.5, dash: "5,3"});
  const det = M[0][0] * M[1][1] - M[0][1] * M[1][0];
  return row(scene.svg.node(), html`<pre style="align-self:center">lerped matrix (red):
[${M[0].map((v) => v.toFixed(2)).join("  ")}]
[${M[1].map((v) => v.toFixed(2)).join("  ")}]
determinant ${det.toFixed(3)}  (a rotation has 1)

angle interpolation (blue, dashed): ${deg(q).toFixed(0)}°</pre>`);
})()
```

The red shape shrinks to a point at ${tex`t = 0.5`}. Interpolating an
**angle** works in 2D. In 3D, three **Euler angles** seem natural, but
they suffer **gimbal lock**: when two rotation axes line up, one degree of
freedom disappears. The check below nudges yaw and roll by 1° at a given
pitch and measures the axes of the two small rotations:

```js echo
const rot = {
  x: (a) => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]],
  y: (a) => [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]],
  z: (a) => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]]
};
const mul3 = (A, B) => A.map((r, i) => B[0].map((_, j) => r.reduce((s, v, k) => s + v * B[k][j], 0)));
const T3 = (A) => A[0].map((_, j) => A.map((r) => r[j]));
const euler = (yaw, pitch, roll) => mul3(rot.z(yaw), mul3(rot.y(pitch), rot.x(roll)));   // R = Rz Ry Rx
function rotationAxis(R) {                                      // axis of a small rotation, from its skew part
  const v = [R[2][1] - R[1][2], R[0][2] - R[2][0], R[1][0] - R[0][1]], len = Math.hypot(...v);
  return v.map((c) => c / len);
}
const gimbalPitch = view(Inputs.range([0, 90], {value: 60, step: 1, label: "pitch (degrees)"}));
```

```js echo
(() => {
  const [y0, p0, r0, d] = [rad(30), rad(gimbalPitch), rad(20), rad(1)];
  const R = euler(y0, p0, r0);
  const yawAxis = rotationAxis(mul3(euler(y0 + d, p0, r0), T3(R)));    // what a yaw nudge does
  const rollAxis = rotationAxis(mul3(euler(y0, p0, r0 + d), T3(R)));   // what a roll nudge does
  const between = deg(Math.acos(Math.min(1, Math.abs(yawAxis.reduce((s, v, i) => s + v * rollAxis[i], 0)))));
  const f = (v) => `(${v.map((c) => c.toFixed(3)).join(", ")})`;
  return html`<pre>a yaw nudge rotates about  ${f(yawAxis)}
a roll nudge rotates about ${f(rollAxis)}
angle between the two axes: ${between.toFixed(1)}°${between < 0.5 ? "   ← gimbal lock: yaw and roll do the same thing" : ""}</pre>`;
})()
```

At a pitch of 90° the axes coincide, and no combination of small angle
changes can turn the object about the missing axis.

### Quaternions and slerp

A unit **quaternion** ${tex`q = [\cos(\phi/2);\ \sin(\phi/2)\,\mathbf n]`}
rotates a point by ${tex`q\,[0;\mathbf p]\,q^{-1}`}, composes by
multiplication, and has no gimbal lock:

```js echo
// q = [s, x, y, z]
const qAxisAngle = (n, phi) => [Math.cos(phi / 2), ...n.map((c) => Math.sin(phi / 2) * c)];
function qMul([s1, x1, y1, z1], [s2, x2, y2, z2]) {    // [s1s2 − v1·v2 ; s1v2 + s2v1 + v1×v2]
  return [s1 * s2 - x1 * x2 - y1 * y2 - z1 * z2,
          s1 * x2 + s2 * x1 + y1 * z2 - z1 * y2,
          s1 * y2 + s2 * y1 + z1 * x2 - x1 * z2,
          s1 * z2 + s2 * z1 + x1 * y2 - y1 * x2];
}
const qConj = ([s, x, y, z]) => [s, -x, -y, -z];       // the inverse of a unit quaternion
const qRotate = (q, p) => qMul(qMul(q, [0, ...p]), qConj(q)).slice(1);
function qSlerp(a, b, t) {
  let d = a.reduce((sum, ai, i) => sum + ai * b[i], 0);
  if (d < 0) { b = b.map((c) => -c); d = -d; }          // q and −q: take the short way
  if (d > 0.9995) return qNlerp(a, b, t);               // nearly equal: nlerp
  const th = Math.acos(d), s = Math.sin(th);
  return a.map((ai, i) => (Math.sin((1 - t) * th) * ai + Math.sin(t * th) * b[i]) / s);
}
function qNlerp(a, b, t) {
  if (a.reduce((sum, ai, i) => sum + ai * b[i], 0) < 0) b = b.map((c) => -c);
  const q = a.map((ai, i) => ai + t * (b[i] - ai)), len = Math.hypot(...q);
  return q.map((c) => c / len);
}
function qToMat4([s, x, y, z]) {                        // column-major, for the GPU
  return new Float32Array([
    1 - 2 * (y * y + z * z), 2 * (x * y + s * z), 2 * (x * z - s * y), 0,
    2 * (x * y - s * z), 1 - 2 * (x * x + z * z), 2 * (y * z + s * x), 0,
    2 * (x * z + s * y), 2 * (y * z - s * x), 1 - 2 * (x * x + y * y), 0,
    0, 0, 0, 1]);
}
```

```js echo
(() => {
  const n = [1, 1, 0].map((c) => c / Math.SQRT2), phi = rad(70), p = [0.3, -1.2, 2];
  const q = qAxisAngle(n, phi);
  // Rodrigues' formula as an independent check
  const dot = n.reduce((s, c, i) => s + c * p[i], 0), cross = [n[1] * p[2] - n[2] * p[1], n[2] * p[0] - n[0] * p[2], n[0] * p[1] - n[1] * p[0]];
  const rod = p.map((c, i) => c * Math.cos(phi) + cross[i] * Math.sin(phi) + n[i] * dot * (1 - Math.cos(phi)));
  const q2 = qAxisAngle([0, 0, 1], rad(90));
  const f = (v) => `(${v.map((c) => c.toFixed(4)).join(", ")})`;
  return html`<pre>rotate p = (0.3, −1.2, 2) by 70° about (1, 1, 0)/√2
  q p q⁻¹          = ${f(qRotate(q, p))}
  Rodrigues        = ${f(rod)}
compose: rotate by q, then by q₂ (90° about z)
  (q₂ q) p (q₂ q)⁻¹ = ${f(qRotate(qMul(q2, q), p))}
  q₂ (q p q⁻¹) q₂⁻¹ = ${f(qRotate(q2, qRotate(q, p)))}</pre>`;
})()
```

Unit quaternions are points on a 4D sphere. **slerp** moves along the
sphere at constant angular speed. **nlerp** (lerp, then normalize) is
cheaper but speeds up in the middle:

```js echo
const slerpAngle = view(Inputs.range([10, 179], {value: 150, step: 1, label: "angle between the two keys (degrees)"}));
```

```js echo
(() => {
  const qa = qAxisAngle([0, 1, 0], 0), qb = qAxisAngle([0, 1, 0], rad(slerpAngle)), dt = 0.005;
  const angleBetween = (p, q) => 2 * Math.acos(Math.min(1, Math.abs(p.reduce((s, v, i) => s + v * q[i], 0))));
  const data = ["slerp", "nlerp"].flatMap((name) => d3.range(0, 1 - dt, dt).map((t) => {
    const f = name === "slerp" ? qSlerp : qNlerp;
    return {t, name, speed: deg(angleBetween(f(qa, qb, t), f(qa, qb, t + dt))) / dt};
  }));
  return Plot.plot({height: 220, width: 520, x: {label: "t"}, y: {label: "angular speed (degrees per unit t)", zero: true}, color: {legend: true},
    marks: [Plot.line(data, {x: "t", y: "speed", stroke: "name", strokeWidth: 2})]});
})()
```

The slerp line is flat at the key angle. The nlerp speed bulges in the
middle, and the bulge grows with the angle. For keys a few degrees apart,
nlerp is fine.

## Deformation and Characters

### Global deformations and free-form deformation

A **global deformation** applies one function to every point. **Taper**
scales the cross-section along an axis, **twist** rotates it by an
amount that grows along the axis, and **bend** wraps the axis around a
circle:

```js echo
const deformForm = view(Inputs.form({
  taper: Inputs.range([-0.8, 0.8], {value: 0.4, step: 0.05, label: "taper"}),
  bend: Inputs.range([-90, 90], {value: 40, step: 1, label: "bend (degrees over the bar)"})
}));
```

```js echo
(() => {
  const bar = [];
  for (let i = 0; i <= 20; i++) for (let j = 0; j <= 4; j++) bar.push({x: -2 + (4 * i) / 20, y: -0.5 + j / 4, i, j});
  const taper = (p) => ({x: p.x, y: p.y * (1 - deformForm.taper * (p.x + 2) / 4)});      // scale y by a function of x
  const bend = (p) => {                                                                       // map x onto an arc
    const total = rad(deformForm.bend);
    if (Math.abs(total) < 1e-6) return p;
    const r = 4 / total, a = ((p.x + 2) / 4) * total;
    return {x: -2 + (r - p.y) * Math.sin(a), y: r - (r - p.y) * Math.cos(a)};
  };
  const scene = plane({width: 420, height: 420, domain: 3});
  const pts = bar.map((p) => ({...bend(taper(p)), i: p.i, j: p.j}));
  for (let j = 0; j <= 4; j++) drawPath(scene, pts.filter((p) => p.j === j), {stroke: "steelblue", width: j % 4 ? 1 : 2.5});
  for (let i = 0; i <= 20; i += 2) drawPath(scene, pts.filter((p) => p.i === i), {stroke: "steelblue", width: 1});
  return scene.svg.node();
})()
```

Global deformations are easy to keyframe (animate the parameters), but
they change the whole object. **Free-form deformation (FFD)** is more
flexible: embed the object in a lattice, find each point's lattice
coordinates ${tex`(s, t)`}, move the lattice, and re-evaluate the Bézier
**volume** (here a 2D Bézier patch with a ${tex`3\times3`} lattice):

```js echo
const ffdInitial = Object.fromEntries(d3.range(9).map((k) => [`P${Math.floor(k / 3)}${k % 3}`, {x: -2 + 2 * (k % 3), y: -2 + 2 * Math.floor(k / 3)}]));
const ffdWidget = dragPoints({...ffdInitial, P11: {x: 0.7, y: 0.9}, P22: {x: 2.6, y: 2.4}}, {width: 400, height: 400, domain: 3.2, colors: ["purple"]});
const ffdLattice = view(ffdWidget);
```

```js echo
ffdWidget.redecorate((scene) => {
  const P = (i, j) => ffdLattice[`P${j}${i}`];                       // i along x, j along y
  const bern = (k, u) => [(1 - u) ** 2, 2 * u * (1 - u), u * u][k];
  const ffd = (p) => {
    const s = (p.x + 2) / 4, t = (p.y + 2) / 4;                       // lattice coordinates in the undeformed box
    let x = 0, y = 0;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { const w = bern(i, s) * bern(j, t); x += w * P(i, j).x; y += w * P(i, j).y; }
    return {x, y};
  };
  for (let j = 0; j < 3; j++) drawPath(scene, [0, 1, 2].map((i) => P(i, j)), {stroke: "purple", width: 1, dash: "3,3"});
  for (let i = 0; i < 3; i++) drawPath(scene, [0, 1, 2].map((j) => P(i, j)), {stroke: "purple", width: 1, dash: "3,3"});
  const star = d3.range(0, 11).map((k) => { const r = k % 2 ? 0.7 : 1.6, a = Math.PI / 2 + (k * Math.PI) / 5; return {x: r * Math.cos(a), y: r * Math.sin(a)}; });
  const dense = star.slice(1).flatMap((q, k) => d3.range(20).map((m) => ({x: star[k].x + (q.x - star[k].x) * m / 20, y: star[k].y + (q.y - star[k].y) * m / 20})));
  drawPath(scene, [...dense, dense[0]].map(ffd), {stroke: "orangered", width: 2.5, fill: "orangered", opacity: 0.8});
  for (const g of [-1, 0, 1]) {
    drawPath(scene, d3.range(0, 41).map((k) => ffd({x: -2 + k / 10, y: g})), {stroke: "#999", width: 1});
    drawPath(scene, d3.range(0, 41).map((k) => ffd({x: g, y: -2 + k / 10})), {stroke: "#999", width: 1});
  }
})
```

Drag the purple lattice points. The star and the gray grid follow
smoothly, because every point is a weighted average of the lattice with
the same Bernstein weights it had before. (Two points start displaced so
the effect is visible.)

### Forward and inverse kinematics

A skeleton is a tree of joints. **Forward kinematics** computes each
joint's position from the angles, as a product of transforms from the
root. **Inverse kinematics** goes the other way: given a target for the
end effector, find the angles. Linearize with the **Jacobian**
${tex`\delta\mathbf x = J\,\delta\boldsymbol\alpha`}, solve by damped least
squares, and **iterate**, because ${tex`J`} is valid only near the current
pose. For a planar chain, column ${tex`i`} of ${tex`J`} is the effector's
offset from joint ${tex`i`}, turned 90°:

```js echo
const ikLengths = [1.5, 1.2, 0.8], ikBase = {x: -1.6, y: -1.6};
function forwardKinematics(angles) {
  const joints = [ikBase];
  let a = 0;
  angles.forEach((da, i) => { a += da; const p = joints.at(-1); joints.push({x: p.x + ikLengths[i] * Math.cos(a), y: p.y + ikLengths[i] * Math.sin(a)}); });
  return joints;                                         // joints[3] is the end effector
}
function ikStep(angles, target, lambda, maxStep = 0.5) {
  const joints = forwardKinematics(angles), e = joints.at(-1);
  let dx = target.x - e.x, dy = target.y - e.y;
  const dist = Math.hypot(dx, dy);
  if (dist > maxStep) { dx *= maxStep / dist; dy *= maxStep / dist; }       // stay where the linearization holds
  const J = angles.map((_, i) => [-(e.y - joints[i].y), e.x - joints[i].x]); // columns of J
  // Damped least squares: δα = Jᵀ (J Jᵀ + λ² I)⁻¹ δx
  let a = lambda ** 2, b = 0, d = lambda ** 2;
  for (const [jx, jy] of J) { a += jx * jx; b += jx * jy; d += jy * jy; }
  const det = a * d - b * b, wx = (d * dx - b * dy) / det, wy = (a * dy - b * dx) / det;
  return angles.map((ang, i) => ang + J[i][0] * wx + J[i][1] * wy);
}
const ikWidget = dragPoints({target: {x: 1.2, y: -0.6}}, {width: 400, height: 400, domain: 3.4, colors: ["crimson"]});
const ikTarget = view(ikWidget);
const ikForm = view(Inputs.form({
  iterations: Inputs.range([0, 40], {value: 3, step: 1, label: "IK iterations"}),
  lambda: Inputs.range([0.01, 1.5], {value: 0.3, step: 0.01, label: "damping λ"})
}));
```

```js echo
ikWidget.redecorate((scene) => {
  let angles = [rad(80), rad(-40), rad(-30)];
  const poses = [forwardKinematics(angles)];
  for (let k = 0; k < ikForm.iterations; k++) { angles = ikStep(angles, ikTarget.target, ikForm.lambda); poses.push(forwardKinematics(angles)); }
  poses.forEach((pose, k) => drawPath(scene, pose, {stroke: k === poses.length - 1 ? "steelblue" : "#999", width: k === poses.length - 1 ? 6 : 1.2, opacity: k === poses.length - 1 ? 1 : 0.6}));
  poses.at(-1).forEach((p, k) => drawPoint(scene, p, {color: k === 3 ? "seagreen" : "#333", r: 4}));
  const e = poses.at(-1)[3];
  scene.svg.append("text").attr("x", 10).attr("y", 20).attr("font-size", 12).attr("font-family", "var(--sans-serif)")
    .text(`distance to target: ${Math.hypot(e.x - ikTarget.target.x, e.y - ikTarget.target.y).toFixed(4)}`);
})
```

Gray poses are the iterations from the starting pose: a handful of
steps reaches the target. Raise the iterations, then drag the target
out of reach (the arm is 3.5 units long): the arm points at it and stops, the best least-squares
answer. Small ${tex`\lambda`} converges fast but jerks near singular
poses (a straight arm); large ${tex`\lambda`} is smooth but slow.

### Skinning

The skeleton deforms the **skin**. In **rigid skinning** each vertex
follows one joint; in **smooth (linear blend) skinning** it blends joints:
${tex`\mathbf p' = \sum_i w_i\, M_i M_{i,\text{bind}}^{-1}\,\mathbf p`},
with weights that sum to 1:

```js echo
const skinAngle = view(Inputs.range([0, 170], {value: 90, step: 1, label: "elbow angle (degrees)"}));
```

```js echo
(() => {
  const skin = [];                                           // a limb from x = 0 to 2, elbow at x = 1
  for (let i = 0; i <= 40; i++) for (const y of [-0.3, 0.3]) skin.push({x: (2 * i) / 40, y});
  const a = rad(skinAngle);
  const bone1 = (p) => ({x: 1 + Math.cos(a) * (p.x - 1) - Math.sin(a) * p.y, y: Math.sin(a) * (p.x - 1) + Math.cos(a) * p.y});   // M₁ M₁,bind⁻¹
  const smooth = (x) => Math.min(1, Math.max(0, (x - 0.7) / 0.6));     // weight of bone 1, 0 → 1 across the joint
  const draw = (weight, title) => {
    const scene = plane({width: 280, height: 280, domain: 2.3});
    const moved = skin.map((p) => { const w = weight(p.x), q = bone1(p); return {x: (1 - w) * p.x + w * q.x - 0.6, y: (1 - w) * p.y + w * q.y - 0.6, side: p.y}; });
    const top = moved.filter((p) => p.side > 0), bottom = moved.filter((p) => p.side < 0);
    drawPath(scene, [...top, ...bottom.reverse(), top[0]], {stroke: "steelblue", width: 2, fill: "steelblue", opacity: 0.35});
    drawPath(scene, [{x: -0.6, y: -0.6}, {x: 0.4, y: -0.6}, {x: 0.4 + Math.cos(a), y: -0.6 + Math.sin(a)}], {stroke: "black", width: 3});
    scene.svg.append("text").attr("x", 10).attr("y", 20).attr("font-size", 12).attr("font-family", "var(--sans-serif)").text(title);
    return scene.svg.node();
  };
  return row(draw((x) => (x > 1 ? 1 : 0), "rigid: one joint per vertex"), draw(smooth, "smooth: blended weights"));
})()
```

Rigid skinning tears and creases at the elbow. Smooth skinning closes
the gap, but at large angles the blended vertices **collapse** inward
(linear blending averages positions, which loses volume). Good weights
take skill, and **dual quaternion** skinning fixes the collapse at more
cost. **Facial animation** blends key expressions and phonemes the same
way, and **motion capture** records joint motion from a performer,
cleaned up with IK.

## Physics, Procedures, and Groups

### Explicit vs. implicit integration and stability

Physics-based animation steps a differential equation forward in time.
Apply three schemes to a spring ${tex`x'' = -x`}, whose exact motion
neither grows nor decays:

```js echo
function simulateSpring(method, dt, steps) {
  let x = 1, v = 0;
  const trace = [{t: 0, x, method}];
  for (let i = 0; i < steps; i++) {
    if (method === "explicit Euler") { [x, v] = [x + v * dt, v - x * dt]; }            // both from old values
    else if (method === "semi-implicit Euler") { v = v - x * dt; x = x + v * dt; }       // new velocity moves x
    else { x = (x + dt * v) / (1 + dt * dt); v = v - x * dt; }                          // implicit: solve for the new state
    trace.push({t: (i + 1) * dt, x, method});
  }
  return trace;
}
const springDt = view(Inputs.range([0.05, 0.8], {value: 0.3, step: 0.01, label: "time step Δt"}));
```

```js echo
(() => {
  const steps = Math.round(30 / springDt);
  const data = ["explicit Euler", "semi-implicit Euler", "implicit Euler"].flatMap((m) => simulateSpring(m, springDt, steps));
  return Plot.plot({height: 240, width: 560, x: {label: "time"}, y: {label: "x", domain: [-3, 3], clamp: true}, color: {legend: true},
    marks: [Plot.line(d3.range(0, 30, 0.05), {x: (t) => t, y: (t) => Math.cos(t), stroke: "#ccc", strokeWidth: 4}),
      Plot.line(data, {x: "t", y: (d) => Math.max(-3, Math.min(3, d.x)), stroke: "method", strokeWidth: 1.8})]});
})()
```

**Explicit** Euler gains energy every step and eventually blows up:
**unstable**. **Implicit** Euler loses energy and settles, which is
inaccurate but **stable** at any step. **Semi-implicit** (symplectic)
Euler, one reordered line, stays bounded and is the usual choice for
games. Animation tolerates inaccuracy much better than instability.

### Procedural animation: waves

Instead of solving physics, write a function that *looks* right. A sum of
waves ${tex`A\cos(\omega t - kx + \phi)`} with assorted wavelengths makes
a convincing water surface:

```js echo
const waves = [{A: 0.5, k: 0.6, w: 1.1, phi: 0}, {A: 0.25, k: 1.3, w: 1.7, phi: 1.3}, {A: 0.12, k: 2.9, w: 2.6, phi: 4.1}, {A: 0.06, k: 5.1, w: 3.4, phi: 2.2}];
```

```js echo
Plot.plot({height: 160, width: 560, x: {label: "x"}, y: {domain: [-1.2, 1.2], label: "height"},
  marks: [Plot.areaY(d3.range(0, 20.01, 0.05), {x: (x) => x, y1: -1.2, y2: (x) => d3.sum(waves, ({A, k, w, phi}) => A * Math.cos(w * now / 1000 - k * x + phi)), fill: "steelblue", fillOpacity: 0.5})]})
```

### Cellular automata

Conway's **Game of Life** applies three rules to every cell at once: a
dead cell with exactly three live neighbors comes alive, a live cell with
two or three survives, and every other cell dies or stays dead.

```js echo
const lifeReset = view(Inputs.button("random restart"));
const lifeControls = view(Inputs.form({
  run: Inputs.toggle({value: true, label: "run"}),
  speed: Inputs.range([1, 30], {value: 10, step: 1, label: "generations per second"})
}));
```

```js echo
const lifeState = (() => {
  lifeReset;                                                  // depend on the button so it reseeds
  const W = 96, H = 64;
  return {W, H, cells: Uint8Array.from({length: W * H}, () => (Math.random() < 0.3 ? 1 : 0)), generation: 0};
})();
```

```js echo
function lifeStep({W, H, cells}) {
  const next = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
      if (dx || dy) n += cells[((y + dy + H) % H) * W + ((x + dx + W) % W)];   // wrap around the edges
    const alive = cells[y * W + x];
    next[y * W + x] = n === 3 || (alive && n === 2) ? 1 : 0;
  }
  return next;
}
const lifeCanvas = (() => { const c = document.createElement("canvas"); c.width = 96 * 5; c.height = 64 * 5; c.style.cssText = "border-radius: 8px; max-width: 100%"; return c; })();
```

```js echo
{
  const ctx = lifeCanvas.getContext("2d"), s = lifeState;
  let running = true, last = 0;
  invalidation.then(() => (running = false));
  function draw() {
    ctx.fillStyle = "#111"; ctx.fillRect(0, 0, lifeCanvas.width, lifeCanvas.height);
    ctx.fillStyle = "#7fd17f";
    for (let i = 0; i < s.W * s.H; i++) if (s.cells[i]) ctx.fillRect((i % s.W) * 5, Math.floor(i / s.W) * 5, 4, 4);
    ctx.fillStyle = "white"; ctx.font = "12px sans-serif"; ctx.fillText(`generation ${s.generation}`, 8, 16);
  }
  function tick(t) {
    if (!running) return;
    if (lifeControls.run && t - last > 1000 / lifeControls.speed) { s.cells = lifeStep(s); s.generation++; last = t; }
    draw();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
```

```js echo
lifeCanvas
```

Gliders, oscillators, and still lifes emerge from these local rules, but
designing rules for a *particular* behavior is hard.

### L-systems

An **L-system** rewrites every symbol at once. Drawing the string with a
turtle (`f` forward, `+`/`-` turn, `[`/`]` push/pop, `@` leaf) gives a
plant, and each intermediate string is a younger plant. The first grammar
is the reading's (with a random choice where a symbol has two rules); the
second is a classic deterministic one:

```js echo
const grammars = {
  "reading (stochastic, 60°)": {axiom: "S", angle: 60, rules: {S: [["A", 1]], A: [["[+B]fA", 0.5], ["[-B]fA", 0.45], ["B", 0.05]], B: [["fB", 0.7], ["f@", 0.3]]}},
  "fractal plant (25°)": {axiom: "X", angle: 25, rules: {X: [["f+[[X]-X]-f[-fX]+X", 1]], f: [["ff", 1]]}}
};
const lsysForm = view(Inputs.form({
  grammar: Inputs.select(Object.keys(grammars), {label: "grammar"}),
  generations: Inputs.range([1, 9], {value: 5, step: 1, label: "generations"}),
  reseed: Inputs.button("new random choices")
}));
```

```js echo
(() => {
  lsysForm.reseed;
  const g = grammars[lsysForm.grammar];
  const gens = g.angle === 25 ? Math.min(lsysForm.generations, 6) : lsysForm.generations * 3;
  let s = g.axiom;
  for (let k = 0; k < gens; k++) {
    s = [...s].map((ch) => {
      const options = g.rules[ch];
      if (!options) return ch;                              // terminals stay
      let r = Math.random();
      for (const [out, p] of options) { if ((r -= p) <= 0) return out; }
      return options.at(-1)[0];
    }).join("");
  }
  let x = 0, y = 0, a = 90;
  const stack = [], segments = [], leaves = [];
  for (const ch of s) {
    if (ch === "f") { const nx = x + Math.cos(rad(a)), ny = y + Math.sin(rad(a)); segments.push([x, y, nx, ny]); x = nx; y = ny; }
    else if (ch === "+") a += g.angle; else if (ch === "-") a -= g.angle;
    else if (ch === "[") stack.push([x, y, a]); else if (ch === "]") [x, y, a] = stack.pop();
    else if (ch === "@") leaves.push([x, y]);
  }
  const xs = segments.flatMap((sg) => [sg[0], sg[2]]), ys = segments.flatMap((sg) => [sg[1], sg[3]]);
  const W = 420, H = 380, pad = 10;
  const span = Math.max(d3.max(xs) - d3.min(xs), d3.max(ys) - d3.min(ys), 1);
  const sc = Math.min((W - 2 * pad) / span, (H - 2 * pad) / span);
  const X = (v) => pad + (v - d3.min(xs)) * sc + (W - 2 * pad - (d3.max(xs) - d3.min(xs)) * sc) / 2, Y = (v) => H - pad - (v - d3.min(ys)) * sc;
  const svg = d3.create("svg").attr("viewBox", [0, 0, W, H]).attr("width", W).style("max-width", "100%").style("background", "var(--theme-background-alt, #f5f5f5)").style("border-radius", "8px");
  svg.append("g").selectAll("line").data(segments).join("line").attr("x1", (d) => X(d[0])).attr("y1", (d) => Y(d[1])).attr("x2", (d) => X(d[2])).attr("y2", (d) => Y(d[3]))
    .attr("stroke", "#6b4f2a").attr("stroke-width", 1.2);
  svg.append("g").selectAll("circle").data(leaves).join("circle").attr("cx", (d) => X(d[0])).attr("cy", (d) => Y(d[1])).attr("r", 3).attr("fill", "seagreen");
  return html`<div>${svg.node()}<pre>${s.length.toLocaleString()} symbols, ${segments.length.toLocaleString()} segments</pre></div>`;
})()
```

### Flocking

Each **boid** sees only its neighbors and combines desired accelerations
for **separation**, **alignment**, and **cohesion** (Reynolds, 1987).
Instead of averaging them, which can cancel out, **acceleration
allocation** fills a fixed budget in priority order: separation first,
then alignment, then cohesion.

```js echo
const flockForm = view(Inputs.form({
  separation: Inputs.range([0, 3], {value: 1.5, step: 0.1, label: "separation"}),
  alignment: Inputs.range([0, 3], {value: 1, step: 0.1, label: "alignment"}),
  cohesion: Inputs.range([0, 3], {value: 0.8, step: 0.1, label: "cohesion"}),
  radius: Inputs.range([10, 80], {value: 40, step: 1, label: "neighborhood radius (pixels)"})
}));
```

```js echo
const flockW = 520, flockH = 340;
const boids = d3.range(140).map(() => ({x: Math.random() * flockW, y: Math.random() * flockH, vx: Math.random() * 2 - 1, vy: Math.random() * 2 - 1}));
const flockCanvas = (() => { const c = document.createElement("canvas"); c.width = flockW; c.height = flockH; c.style.cssText = "border-radius: 8px; max-width: 100%"; return c; })();
```

```js echo
{
  const ctx = flockCanvas.getContext("2d"), maxAccel = 0.12, maxSpeed = 2.4;
  let running = true;
  invalidation.then(() => (running = false));
  function allocate(acc, want, weight) {                     // add as much of "want" as the budget allows
    const used = Math.hypot(acc.x, acc.y), room = Math.max(0, maxAccel - used);
    let wx = want.x * weight, wy = want.y * weight;
    const len = Math.hypot(wx, wy);
    if (len > room) { wx *= room / len; wy *= room / len; }
    acc.x += wx; acc.y += wy;
  }
  function step() {
    if (!running) return;
    for (const b of boids) {
      let sep = {x: 0, y: 0}, ali = {x: 0, y: 0}, coh = {x: 0, y: 0}, n = 0;
      for (const o of boids) {
        if (o === b) continue;
        let dx = o.x - b.x, dy = o.y - b.y;
        dx -= flockW * Math.round(dx / flockW); dy -= flockH * Math.round(dy / flockH);   // wrap around
        const d = Math.hypot(dx, dy);
        if (d > flockForm.radius) continue;
        n++;
        ali.x += o.vx; ali.y += o.vy; coh.x += dx; coh.y += dy;
        if (d < flockForm.radius / 2.5) { sep.x -= dx / (d * d + 1e-3); sep.y -= dy / (d * d + 1e-3); }
      }
      const acc = {x: 0, y: 0};
      if (n) {
        allocate(acc, {x: sep.x * 6, y: sep.y * 6}, flockForm.separation * 0.1);
        allocate(acc, {x: ali.x / n - b.vx, y: ali.y / n - b.vy}, flockForm.alignment * 0.05);
        allocate(acc, {x: coh.x / n, y: coh.y / n}, flockForm.cohesion * 0.002);
      }
      b.vx += acc.x; b.vy += acc.y;
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > maxSpeed) { b.vx *= maxSpeed / sp; b.vy *= maxSpeed / sp; }
      if (sp < 0.8) { b.vx *= 0.8 / (sp + 1e-6); b.vy *= 0.8 / (sp + 1e-6); }
    }
    ctx.fillStyle = "#0e1420"; ctx.fillRect(0, 0, flockW, flockH);
    ctx.fillStyle = "#ffd27a";
    for (const b of boids) {
      b.x = (b.x + b.vx + flockW) % flockW; b.y = (b.y + b.vy + flockH) % flockH;
      const a = Math.atan2(b.vy, b.vx);
      ctx.beginPath();
      ctx.moveTo(b.x + 7 * Math.cos(a), b.y + 7 * Math.sin(a));
      ctx.lineTo(b.x + 4 * Math.cos(a + 2.5), b.y + 4 * Math.sin(a + 2.5));
      ctx.lineTo(b.x + 4 * Math.cos(a - 2.5), b.y + 4 * Math.sin(a - 2.5));
      ctx.fill();
    }
    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
```

```js echo
flockCanvas
```

Set alignment and cohesion to 0: the boids just avoid each other. Turn
alignment up: they stream in parallel. Cohesion pulls them into clumps,
and separation keeps the clumps from collapsing. Group behavior
**emerges** from purely local rules. A **particle system** is the
non-interacting version of the same idea, and it scales to hundreds of
thousands of particles on the GPU.

## Animation in WebGPU

### Time-based animation, keyframe tracks, quaternions, and skinning

Animate in **seconds**, not frames. Keyframes use the absolute time, and
physics steps use the clamped elapsed time `dt`. The arm below combines
three ideas:

- a **keyframe track** for the elbow angle, sampled with Catmull–Rom tangents (TCB with ${tex`t = c = b = 0`}),
- the whole arm's orientation **slerped** between two quaternion keys,
- **skinning in the vertex shader**: each vertex stores four joint indices
  (`uint8x4`) and four weights (`unorm8x4`), of which this arm uses two,
  and the shader blends the joint matrices.

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
const skinModule = device.createShaderModule({code: `
struct Camera { viewProj: mat4x4<f32>, lightDir: vec4<f32> };
@group(0) @binding(0) var<uniform> cam: Camera;
@group(0) @binding(1) var<storage, read> joints: array<mat4x4<f32>>;   // jointWorld × inverseBind

struct SkinIn {
  @location(0) pos: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) jointIdx: vec4<u32>,      // vertex format uint8x4
  @location(3) weights: vec4<f32>,       // vertex format unorm8x4, sums to 1
};
struct VOut { @builtin(position) clip: vec4<f32>, @location(0) normal: vec3<f32>, @location(1) weight: f32 };

@vertex
fn vs_skin(v: SkinIn) -> VOut {
  let M = v.weights.x * joints[v.jointIdx.x] + v.weights.y * joints[v.jointIdx.y]
        + v.weights.z * joints[v.jointIdx.z] + v.weights.w * joints[v.jointIdx.w];   // d = Σ wᵢ dᵢ
  return VOut(cam.viewProj * M * vec4<f32>(v.pos, 1.0), (M * vec4<f32>(v.normal, 0.0)).xyz, v.weights.y);
}
@fragment
fn fs_skin(f: VOut) -> @location(0) vec4<f32> {
  let base = mix(vec3<f32>(0.25, 0.5, 0.9), vec3<f32>(0.95, 0.55, 0.2), f.weight);   // color shows the bone-1 weight
  let lit = 0.25 + 0.75 * max(dot(normalize(f.normal), normalize(cam.lightDir.xyz)), 0.0);
  return vec4<f32>(pow(base * lit, vec3<f32>(1.0 / 2.2)), 1.0);
}`});
const skinPipeline = device.createRenderPipeline({
  layout: "auto",
  vertex: {module: skinModule, entryPoint: "vs_skin", buffers: [{arrayStride: 32, attributes: [
    {shaderLocation: 0, offset: 0, format: "float32x3"}, {shaderLocation: 1, offset: 12, format: "float32x3"},
    {shaderLocation: 2, offset: 24, format: "uint8x4"}, {shaderLocation: 3, offset: 28, format: "unorm8x4"}]}]},
  fragment: {module: skinModule, entryPoint: "fs_skin", targets: [{format: canvasFormat}]},
  primitive: {topology: "triangle-list"},
  depthStencil: {format: "depth24plus", depthWriteEnabled: true, depthCompare: "less"}
});

// A tube along x from 0 to 2, radius 0.22; bone 0 covers [0, 1], bone 1 covers [1, 2].
const tubeRings = 48, tubeSides = 20;
function buildTube(smooth) {
  const data = new ArrayBuffer((tubeRings + 1) * (tubeSides + 1) * 32), f = new Float32Array(data), b = new Uint8Array(data);
  for (let i = 0; i <= tubeRings; i++) for (let j = 0; j <= tubeSides; j++) {
    const k = i * (tubeSides + 1) + j, x = (2 * i) / tubeRings, a = (2 * Math.PI * j) / tubeSides;
    const w1 = smooth ? Math.min(1, Math.max(0, (x - 0.75) / 0.5)) : x > 1 ? 1 : 0;   // weight of bone 1
    f.set([x, 0.22 * Math.cos(a), 0.22 * Math.sin(a), 0, Math.cos(a), Math.sin(a)], k * 8);
    b.set([0, 1, 0, 0, Math.round(255 * (1 - w1)), 255 - Math.round(255 * (1 - w1)), 0, 0], k * 32 + 24);
  }
  return data;
}
const tubeIndices = new Uint16Array(tubeRings * tubeSides * 6);
for (let i = 0, n = 0; i < tubeRings; i++) for (let j = 0; j < tubeSides; j++) {
  const a = i * (tubeSides + 1) + j, b = a + tubeSides + 1;
  tubeIndices.set([a, b, a + 1, a + 1, b, b + 1], n); n += 6;
}
const tubeVB = device.createBuffer({size: (tubeRings + 1) * (tubeSides + 1) * 32, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST});
const tubeIB = device.createBuffer({size: tubeIndices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST});
device.queue.writeBuffer(tubeIB, 0, tubeIndices);
const skinCamera = device.createBuffer({size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
const jointBuffer = device.createBuffer({size: 2 * 64, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST});
const skinBindGroup = device.createBindGroup({layout: skinPipeline.getBindGroupLayout(0), entries: [
  {binding: 0, resource: {buffer: skinCamera}}, {binding: 1, resource: {buffer: jointBuffer}}]});
const skinCanvas = document.createElement("canvas");
skinCanvas.width = 380; skinCanvas.height = 320;
skinCanvas.style.cssText = "border-radius: 8px; max-width: 100%";
const {context: skinContext} = webgpu.configureCanvas(skinCanvas, device);
const skinDepth = device.createTexture({size: [380, 320], format: "depth24plus", usage: GPUTextureUsage.RENDER_ATTACHMENT});

// Elbow keys every 0.5 s (degrees), and two orientation keys for the whole arm.
const elbowTrack = [0, 35, 100, 125, 70, 20, -15, -5, 0].map((v, i) => ({t: i * 0.5, v}));
const orientationKeys = [qAxisAngle([0, 1, 0], rad(-35)), qAxisAngle([0.6, 0.8, 0], rad(80))];
```

```js echo
const skinForm = view(Inputs.form({
  smooth: Inputs.toggle({value: true, label: "smooth skinning (off = rigid)"}),
  speed: Inputs.range([0, 2], {value: 1, step: 0.05, label: "playback speed"})
}));
```

Every frame, the CPU samples the tracks, runs **forward kinematics**
(the joint matrices from the root), multiplies by the inverse bind
matrices, and uploads two matrices. The GPU does the rest:

```js echo
device.queue.writeBuffer(tubeVB, 0, buildTube(skinForm.smooth));
```

```js echo
{
  const viewProj = mat4.multiply(mat4.perspective(rad(45), 380 / 320, 0.1, 20), mat4.lookAt([1, 1.6, 4.2], [0.8, 0.3, 0], [0, 1, 0]));
  device.queue.writeBuffer(skinCamera, 0, new Float32Array([...viewProj, 0.4, 0.8, 0.5, 0]));
  const inverseBind1 = mat4.translate(-1, 0, 0);            // bone 1's rest joint is at x = 1
  let running = true, clock = 0, last = performance.now();
  invalidation.then(() => (running = false));
  function frame(nowMs) {
    if (!running) return;
    const dt = Math.min((nowMs - last) / 1000, 0.05);       // seconds; clamp after a pause
    last = nowMs;
    clock += dt * skinForm.speed;
    const loop = clock % 4;                                  // the track is 4 seconds long
    const elbow = rad(sampleTCB(elbowTrack, loop));
    const swing = (1 - Math.cos((Math.PI * clock) / 4)) / 2; // ping-pong between the two orientation keys
    const J0 = qToMat4(qSlerp(orientationKeys[0], orientationKeys[1], swing));
    const J1 = mat4.multiplyAll([J0, mat4.translate(1, 0, 0), mat4.rotateZ(elbow)]);   // FK: parent × local
    device.queue.writeBuffer(jointBuffer, 0, new Float32Array([...J0, ...mat4.multiply(J1, inverseBind1)]));
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{view: skinContext.getCurrentTexture().createView(), clearValue: {r: 0.06, g: 0.06, b: 0.09, a: 1}, loadOp: "clear", storeOp: "store"}],
      depthStencilAttachment: {view: skinDepth.createView(), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store"}});
    pass.setPipeline(skinPipeline);
    pass.setBindGroup(0, skinBindGroup);
    pass.setVertexBuffer(0, tubeVB);
    pass.setIndexBuffer(tubeIB, "uint16");
    pass.drawIndexed(tubeIndices.length);
    pass.end();
    device.queue.submit([encoder.finish()]);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
```

```js echo
skinCanvas
```

Color shows each vertex's weight for bone 1 (blue = bone 0, orange =
bone 1). With rigid skinning the elbow creases sharply; with smooth
skinning the band of mixed weights bends, and thins at the largest
angles (the collapse seen in the 2D figure).

### Procedural water and a GPU particle system

The water's vertex shader evaluates a **sum of waves** from `time` alone.
The fountain is a **particle system** in a storage buffer: a **compute
pass** ages, respawns, and integrates every particle (semi-implicit
Euler), and the **render pass** reads the same buffer as instance data,
drawing each particle as a camera-facing quad.

```js echo
const fxModule = device.createShaderModule({code: `
fn pcg(v: u32) -> u32 {
  let state = v * 747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
fn rand(seed: ptr<function, u32>) -> f32 { *seed = pcg(*seed); return f32(*seed >> 8u) / 16777216.0; }

struct Camera { viewProj: mat4x4<f32>, right: vec4<f32>, up: vec4<f32>, time: f32 };
@group(0) @binding(0) var<uniform> cam: Camera;

// ---- water: A cos(ωt − k·x + φ) summed over three waves
const WAVES = array<vec4<f32>, 3>(vec4<f32>(0.8, 0.3, 1.7, 0.10), vec4<f32>(-0.4, 1.1, 2.3, 0.06), vec4<f32>(1.9, -0.7, 3.1, 0.03));
struct WOut { @builtin(position) clip: vec4<f32>, @location(0) normal: vec3<f32> };
@vertex
fn vs_water(@location(0) p: vec3<f32>) -> WOut {
  var y = 0.0;
  var slope = vec2<f32>(0.0);
  for (var i = 0; i < 3; i++) {
    let w = WAVES[i];
    let phase = w.z * cam.time - dot(w.xy, p.xz) + f32(i);
    y += w.w * cos(phase);
    slope += w.w * sin(phase) * w.xy;                   // ∂y/∂x and ∂y/∂z
  }
  return WOut(cam.viewProj * vec4<f32>(p.x, y, p.z, 1.0), normalize(vec3<f32>(-slope.x, 1.0, -slope.y)));
}
@fragment
fn fs_water(f: WOut) -> @location(0) vec4<f32> {
  let l = normalize(vec3<f32>(0.3, 1.0, 0.4));
  let c = vec3<f32>(0.05, 0.25, 0.45) * (0.35 + 0.65 * max(dot(f.normal, l), 0.0)) + vec3<f32>(0.3) * pow(max(f.normal.x * 0.3 + f.normal.z * 0.5, 0.0), 3.0);
  return vec4<f32>(pow(c, vec3<f32>(1.0 / 2.2)), 1.0);
}

// ---- particles
struct Particle { pos: vec3<f32>, life: f32, vel: vec3<f32>, pad: f32 };   // 32 bytes
struct Sim { gravity: vec3<f32>, dt: f32, emitter: vec3<f32>, frame: u32 };
@group(0) @binding(1) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(2) var<uniform> sim: Sim;

@compute @workgroup_size(64)
fn update(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= arrayLength(&particles)) { return; }
  var p = particles[i];
  p.life -= sim.dt;
  if (p.life <= 0.0) {                                    // respawn with random values
    var seed = pcg(i + pcg(sim.frame));
    p.pos = sim.emitter;
    p.vel = vec3<f32>(rand(&seed) - 0.5, 3.0 + rand(&seed), rand(&seed) - 0.5);
    p.life = 2.0 + rand(&seed);
  }
  p.vel += sim.gravity * sim.dt;                          // semi-implicit Euler
  p.pos += p.vel * sim.dt;
  if (p.pos.y < 0.0) { p.pos.y = 0.0; p.vel.y *= -0.4; p.vel.x *= 0.8; p.vel.z *= 0.8; }   // bounce off the water
  particles[i] = p;
}

struct POut { @builtin(position) clip: vec4<f32>, @location(0) corner: vec2<f32>, @location(1) life: f32 };
@vertex
fn vs_particle(@builtin(vertex_index) c: u32, @location(0) center: vec3<f32>, @location(1) life: f32) -> POut {
  let corner = vec2<f32>(f32(c & 1u), f32(c >> 1u)) * 2.0 - 1.0;          // (−1,−1) (1,−1) (−1,1) (1,1)
  let p = center + 0.03 * (corner.x * cam.right.xyz + corner.y * cam.up.xyz);   // billboard faces the camera
  return POut(cam.viewProj * vec4<f32>(p, 1.0), corner, life);
}
@fragment
fn fs_particle(f: POut) -> @location(0) vec4<f32> {
  let r = length(f.corner);
  if (r > 1.0) { discard; }
  let fade = 0.35 * (1.0 - r) * clamp(f.life, 0.0, 1.0);          // additive, so keep each one faint
  return vec4<f32>(vec3<f32>(0.75, 0.9, 1.0) * fade, fade);
}`});

const fxDepthFormat = "depth24plus";
// Two layouts: the render passes see only the camera, so the particle buffer is never
// writable storage and a vertex buffer in the same pass.
const fxRenderLayout = device.createBindGroupLayout({entries: [{binding: 0, visibility: GPUShaderStage.VERTEX, buffer: {type: "uniform"}}]});
const fxComputeLayout = device.createBindGroupLayout({entries: [
  {binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: {type: "storage"}},
  {binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: {type: "uniform"}}]});
const fxPipelineLayout = device.createPipelineLayout({bindGroupLayouts: [fxRenderLayout]});
const waterPipeline = device.createRenderPipeline({
  layout: fxPipelineLayout,
  vertex: {module: fxModule, entryPoint: "vs_water", buffers: [{arrayStride: 12, attributes: [{shaderLocation: 0, offset: 0, format: "float32x3"}]}]},
  fragment: {module: fxModule, entryPoint: "fs_water", targets: [{format: canvasFormat}]},
  depthStencil: {format: fxDepthFormat, depthWriteEnabled: true, depthCompare: "less"}});
const particlePipeline = device.createRenderPipeline({
  layout: fxPipelineLayout,
  vertex: {module: fxModule, entryPoint: "vs_particle", buffers: [{arrayStride: 32, stepMode: "instance", attributes: [
    {shaderLocation: 0, offset: 0, format: "float32x3"}, {shaderLocation: 1, offset: 12, format: "float32"}]}]},
  fragment: {module: fxModule, entryPoint: "fs_particle", targets: [{format: canvasFormat,
    blend: {color: {srcFactor: "one", dstFactor: "one", operation: "add"}, alpha: {srcFactor: "one", dstFactor: "one", operation: "add"}}}]},   // additive
  primitive: {topology: "triangle-strip"},
  depthStencil: {format: fxDepthFormat, depthWriteEnabled: false, depthCompare: "less"}});
const updatePipeline = device.createComputePipeline({layout: device.createPipelineLayout({bindGroupLayouts: [fxComputeLayout]}), compute: {module: fxModule, entryPoint: "update"}});

// Water grid
const gridN = 80, gridVerts = new Float32Array((gridN + 1) * (gridN + 1) * 3), gridIdx = new Uint32Array(gridN * gridN * 6);
for (let i = 0; i <= gridN; i++) for (let j = 0; j <= gridN; j++) gridVerts.set([-4 + (8 * j) / gridN, 0, -4 + (8 * i) / gridN], (i * (gridN + 1) + j) * 3);
for (let i = 0, n = 0; i < gridN; i++) for (let j = 0; j < gridN; j++) { const a = i * (gridN + 1) + j, b = a + gridN + 1; gridIdx.set([a, b, a + 1, a + 1, b, b + 1], n); n += 6; }
const gridVB = device.createBuffer({size: gridVerts.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST});
device.queue.writeBuffer(gridVB, 0, gridVerts);
const gridIB = device.createBuffer({size: gridIdx.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST});
device.queue.writeBuffer(gridIB, 0, gridIdx);

// Particles: written by the compute pass, read as instance vertices
const particleCount = 20000;
const particleBuffer = device.createBuffer({size: particleCount * 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST});
device.queue.writeBuffer(particleBuffer, 0, new Float32Array(d3.range(particleCount).flatMap(() =>
  [0, 0.1, 0, Math.random() * 3, Math.random() - 0.5, 3 + Math.random(), Math.random() - 0.5, 0])));   // like a respawn, with staggered lifetimes
const fxCamera = device.createBuffer({size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
const fxSim = device.createBuffer({size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
const fxRenderBG = device.createBindGroup({layout: fxRenderLayout, entries: [{binding: 0, resource: {buffer: fxCamera}}]});
const fxComputeBG = device.createBindGroup({layout: fxComputeLayout, entries: [
  {binding: 1, resource: {buffer: particleBuffer}}, {binding: 2, resource: {buffer: fxSim}}]});
const fxCanvas = document.createElement("canvas");
fxCanvas.width = 520; fxCanvas.height = 340;
fxCanvas.style.cssText = "border-radius: 8px; max-width: 100%";
const {context: fxContext} = webgpu.configureCanvas(fxCanvas, device);
const fxDepth = device.createTexture({size: [520, 340], format: fxDepthFormat, usage: GPUTextureUsage.RENDER_ATTACHMENT});
```

```js echo
const fxForm = view(Inputs.form({
  gravity: Inputs.range([0, 15], {value: 5, step: 0.1, label: "gravity"}),
  orbit: Inputs.range([-180, 180], {value: 25, step: 1, label: "camera azimuth"})
}));
```

```js echo
{
  const az = rad(fxForm.orbit), eye = [7 * Math.sin(az), 3, 7 * Math.cos(az)];
  const viewProj = mat4.multiply(mat4.perspective(rad(45), 520 / 340, 0.1, 50), mat4.lookAt(eye, [0, 1, 0], [0, 1, 0]));
  const right = [Math.cos(az), 0, -Math.sin(az)];                                   // camera axes for billboards
  const fwd = [-eye[0], 1 - eye[1], -eye[2]].map((c, _, v) => c / Math.hypot(...v));
  const up = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
  const camData = new Float32Array(28);
  camData.set([...viewProj, ...right, 0, ...up, 0]);
  const simData = new ArrayBuffer(32), simF = new Float32Array(simData), simU = new Uint32Array(simData);
  let running = true, last = performance.now(), frameIndex = 0;
  invalidation.then(() => (running = false));
  function frame(nowMs) {
    if (!running) return;
    const dt = Math.min((nowMs - last) / 1000, 0.05);
    last = nowMs;
    camData[24] = nowMs / 1000;                                                  // time, for the water
    device.queue.writeBuffer(fxCamera, 0, camData);
    simF.set([0, -fxForm.gravity, 0, dt, 0, 0.1, 0]);
    simU[7] = frameIndex++;
    device.queue.writeBuffer(fxSim, 0, simData);
    const encoder = device.createCommandEncoder();
    const compute = encoder.beginComputePass();
    compute.setPipeline(updatePipeline);
    compute.setBindGroup(0, fxComputeBG);
    compute.dispatchWorkgroups(Math.ceil(particleCount / 64));
    compute.end();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{view: fxContext.getCurrentTexture().createView(), clearValue: {r: 0.03, g: 0.04, b: 0.07, a: 1}, loadOp: "clear", storeOp: "store"}],
      depthStencilAttachment: {view: fxDepth.createView(), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store"}});
    pass.setBindGroup(0, fxRenderBG);
    pass.setPipeline(waterPipeline);
    pass.setVertexBuffer(0, gridVB);
    pass.setIndexBuffer(gridIB, "uint32");
    pass.drawIndexed(gridIdx.length);
    pass.setPipeline(particlePipeline);
    pass.setVertexBuffer(0, particleBuffer);
    pass.draw(4, particleCount);                                                 // 4 corners, N instances
    pass.end();
    device.queue.submit([encoder.finish()]);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
```

```js echo
fxCanvas
```

Only a few bytes of uniforms change per frame: the time and the
simulation step. ${(20000).toLocaleString()} particles are updated and
drawn without ever returning to the CPU. Raise gravity to shorten the
fountain. **Flocking** on the GPU has the same structure, except each boid
also reads its neighbors, ideally found with a spatial grid (Module 07).

## Check Your Understanding

1. Why does a gravity-timed bounce look heavier than a constant-speed one?
2. How should an ellipse change shape so that squash and stretch preserves area?
3. What do tension, continuity, and bias do to the tangents at a key? Which values give Catmull–Rom?
4. Using the reading's table, find ${tex`u(3.0)`}.
5. Why does averaging two rotation matrices fail? What is gimbal lock?
6. Write the quaternion for a 90° rotation about the ${tex`z`}-axis, and explain why ${tex`q`} and ${tex`-q`} give the same rotation.
7. Why does IK need to iterate, and what does damping do?
8. Why does linear blend skinning lose volume at sharp bends?
9. Explicit Euler blows up on the spring but semi-implicit Euler does not. What changed?
10. Why should keyframe sampling use absolute time and physics use a clamped `dt`?

<details>
<summary>Answers</summary>

1. The frames bunch up near the top (slow out and slow in) and spread out near the floor, as real acceleration does.
2. Scale one axis by ${tex`s`} and the other by ${tex`1/s`}, so ${tex`ab = R^2`}.
3. Tension scales both; continuity makes them unequal (a kink); bias tilts them toward one neighbor. ${tex`t = c = b = 0`}.
4. ${tex`3.0`} lies between ${tex`s = 2.5`} (${tex`u = 0.2`}) and ${tex`4.0`} (${tex`u = 0.4`}), so ${tex`u = 0.2 + 0.2 \cdot 0.5/1.5 \approx 0.267`}.
5. The average of two rotation matrices is not a rotation (it can even be zero). Gimbal lock is the loss of a degree of freedom when two Euler rotation axes line up.
6. ${tex`[\cos 45°;\ 0, 0, \sin 45°]`}. In ${tex`q\,p\,q^{-1}`}, the two minus signs cancel.
7. The Jacobian is a linearization valid only near the current pose. Damping limits the step near singular poses at the cost of slower convergence.
8. It averages the vertex positions produced by the different joints. Positions on opposite sides of the bend average toward the joint.
9. Semi-implicit Euler updates the velocity first and moves the position with the new velocity, which makes the scheme symplectic.
10. Keys are defined at absolute times. Physics steps must be small and bounded, or a long pause produces one huge, unstable step.

</details>

## Common Pitfalls

- **Frame-based animation** that runs faster on faster displays. Use
  seconds.
- **Interpolating rotation matrices or Euler angles.** Use quaternions
  with slerp (or nlerp for small angles), and take the short way.
- **Treating ${tex`u`} as distance** along a path. Use an arc-length
  table.
- **Forgetting the inverse bind matrix** in skinning, which applies the
  rest pose twice.
- **Weights that do not sum to 1**, which scale or shift the skin.
- **Updating a child joint before its parent.**
- **Explicit integration with large steps**, which explodes.
- **Unclamped `dt`** after the tab was hidden.

## Summary

- **Principles:** timing, staging, anticipation and follow-through,
  squash and stretch (volume preserved), arcs, slow in and slow out,
  pose-to-pose.
- **Keyframing:** ${tex`C^1`} curves through keys (Catmull–Rom, tuned
  with TCB), and ${tex`\mathbf p(u(s(t)))`} to separate path from timing.
- **Rotation:** do not interpolate matrices; Euler angles risk gimbal
  lock; unit quaternions with slerp or nlerp avoid both problems.
- **Characters:** global deformations and FFD, skeletons with FK and
  Jacobian IK, smooth skinning, facial animation, motion capture.
- **Simulation and procedures:** explicit vs. implicit integration
  (stability first), procedural waves, cellular automata, L-systems,
  flocking, and particle systems.
- **WebGPU:** time-based updates, keyframe sampling, quaternions,
  skinning in the vertex shader, procedural vertex motion, and
  compute-shader particles drawn as instanced billboards.
