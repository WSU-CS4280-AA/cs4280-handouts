---
title: Module 13 — Computer Animation
toc: true
---

```js
import * as d3 from "npm:d3";
import * as mat4 from "./lib/math/mat4.js";
import * as transforms from "./lib/math/transforms.js";
import {initializeWebGPU} from "./lib/webgpu.js";
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

More control means more work for the animator. More automation means less
control over the result.

This handout follows the reading: the principles of animation,
keyframing and motion control, rotations, deformation and characters,
and physics, procedures, and groups. Many figures **play continuously**.
Each technique is built here as code you can read and test, while the
code that only draws the figures stays out of the way. The last section
runs animation on the GPU and needs **Chrome or Edge 113+**. This handout
teaches the *techniques*; it is not a walkthrough of any graded assignment.

Two small helpers convert between degrees and radians throughout. A third prints
a result on one line, rounded to four decimals, so that we can read the checks below:

```js echo
const rad = (d) => (d * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI;
const show = (value) => JSON.stringify(value, (key, x) =>
  (typeof x === "number" ? +x.toFixed(4) : x));
```

```js
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

These principles come from Disney animators in the 1930s. John Lasseter
brought them to computer animation at SIGGRAPH 1987.

### Timing and staging

The **speed** of an action carries meaning. The same head turn can read as
reacting to a hit, scanning a bookshelf, or stretching a neck. Only the
timing differs. Timing also shows **weight**: heavy objects accelerate
slowly, and light ones move quickly. Recorded **sound**, usually the voice
track, sets the timing, and the animation is synchronized to it.

**Staging** makes the important action obvious. The eye is drawn to relative
change, such as sudden motion in a still scene, and a changing **silhouette**
reads better than motion facing the camera.

Every action has three parts: **anticipation**, then the **action**, then
**follow-through**. The action itself is often the shortest and least
interesting part. In **overlapping action**, loose parts such as hair and
clothing lag behind and keep moving, and the next action starts before the
last one ends. **Secondary action** adds richness, but it must not upstage
the main action.

### Slow in and out, arcs, and squash and stretch

Natural motion follows **arcs**, not straight lines, and no real object
changes speed **instantly**, since that would take infinite force. The
**spacing** of frames shows the speed: frames are close together near a stop
and spread apart at full speed.

Take a ball's height during one bounce, with ${tex`\tau`} running from 0 to 1.
At constant speed, the height is a tent. Under gravity, it is a parabola:

```js echo
const bounceHeight = (tau, H, gravity) =>
  gravity ? 4 * H * tau * (1 - tau) : H * (1 - Math.abs(2 * tau - 1));
```

Both versions reach ${tex`H`} at the middle of the bounce. They differ on the
way up. A quarter of the way through, the gravity ball should already be at
0.75 of the height, because it is still moving fast and slows as it rises. The
constant-speed ball should be at 0.5:

```js echo
[true, false].map((gravity) => bounceHeight(0.25, 1, gravity))
```

**Squash and stretch** deforms a moving object: it stretches along its
motion and squashes under force, more for faster or softer objects. The
**volume must be preserved**, or the object will seem to grow or shrink. A ball
of radius ${tex`R`} deformed into an ellipse with semi-axes ${tex`a, b`} keeps its
area with ${tex`ab = R^2`} (in 3D, ${tex`abc = R^3`}). So stretching one axis
by ${tex`s`} means dividing the other by ${tex`s`}:

```js echo
const stretched = (R, s) => ({a: R * s, b: R / s});
```

The stretch should not change the product of the axes. With ${tex`R = 0.5`}, it
should stay 0.25:

```js echo
stretched(0.5, 1.8).a * stretched(0.5, 1.8).b
```

To animate the ball, we need its height and its shape at any moment. The stretch
grows with the vertical speed, and for a moment around impact the ball squashes
instead. Here `a` is the semi-axis along the motion and `b` is the one across it:

```js echo
function ballState(tau, {timing, squash}) {
  const R = 0.35, H = 2.4;
  const gravity = timing.startsWith("gravity");
  const y = R + bounceHeight(tau, H, gravity);
  const vy = gravity
    ? 4 * H * (1 - 2 * tau)
    : 2 * H * Math.sign(0.5 - tau);
  if (!squash) return {y, a: R, b: R};
  let {a, b} = stretched(R, 1 + 0.06 * Math.abs(vy));
  const contact = Math.min(tau, 1 - tau) / 0.06;
  if (contact < 1) {
    a = R * (0.6 + 0.4 * contact);
    b = (R * R) / a;
  }
  return {y: Math.max(a, y), a, b};
}
```

```js
const ballForm = view(Inputs.form({
  timing: Inputs.radio(["constant speed", "gravity (slow in and out)"], {value: "gravity (slow in and out)", label: "timing"}),
  squash: Inputs.toggle({value: true, label: "squash and stretch"})
}));
```

```js
(() => {
  const scene = plane({width: 420, height: 380, domain: 3.2});
  const tau = (now / 1200) % 1;
  for (let k = 0; k < 16; k++) {
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
overlaps its previous position. Rigid objects are deliberately left undeformed.

### Pose-to-pose and the rest

**Straight-ahead** animation draws frame after frame in order. The result
is spontaneous but hard to control. **Pose-to-pose** animation plans the
**key poses** first and fills in the in-betweens later, and this is the
approach computers use. Three more principles are about design rather than
computation: **exaggeration** emphasizes an action, **appeal** is something
the audience wants to watch, and **solid drawing** for a computer animator
means knowing graphics and the tools well.

## Keyframing

### Keys and the animation curve

A 3D scene is a long list of numbers: positions, colors, scales, joint
transforms, the camera, and lights. A **key** ${tex`(t_k, f_k)`} fixes the value
of one parameter at one time. Different parameters can have **different key
times**, dense where the action is complex and sparse elsewhere. The system fits
a continuous **animation curve** ${tex`f(t)`} through the keys and samples it at
each frame.

The derivative ${tex`df/dt`} is the **velocity** of the parameter, so the
curve needs to be ${tex`C^1`} to avoid sudden jumps in speed. Higher continuity
is usually unnecessary, since accelerations can change abruptly in reality, as
when a ball hits a wall. The animator gives **keys only, not tangents**, so the
tangents must come from the keys. **Catmull–Rom** splines (Module 09) interpolate
the keys, are ${tex`C^1`}, and compute their own tangents, which makes them a
natural first choice.

### TCB controls

Three controls adjust the tangents: **tension** ${tex`\tau`}, **continuity**
${tex`c`}, and **bias** ${tex`b`}. For keys spaced ${tex`\Delta t`} apart, they
set the tangent **arriving** at key ${tex`k`} and the tangent **leaving** it:

${tex.block`T_k^{\text{in}} = \frac{(1-\tau)(1-c)(1+b)}{2\Delta t}(f_k - f_{k-1}) + \frac{(1-\tau)(1+c)(1-b)}{2\Delta t}(f_{k+1} - f_k)`}

${tex.block`T_k^{\text{out}} = \frac{(1-\tau)(1+c)(1+b)}{2\Delta t}(f_k - f_{k-1}) + \frac{(1-\tau)(1-c)(1-b)}{2\Delta t}(f_{k+1} - f_k)`}

This is the **Kochanek–Bartels** form. **Book erratum:** the book swaps
${tex`(f_{k+1} - f_k)`} and ${tex`(f_k - f_{k-1})`}, which reverses the signs of
${tex`c`} and ${tex`b`} and contradicts its own description. The book also calls
tension ${tex`t`}; we write ${tex`\tau`} to keep ${tex`t`} for time.

The formulas combine the slope before the key and the slope after it, so the
code computes those two slopes first. Dividing by each segment's own length also
handles keys that are not evenly spaced. A key at the end of the track has no
neighbor on one side, so that slope is 0:

```js echo
function neighborSlopes(keys, k) {
  const prev = keys[Math.max(k - 1, 0)], cur = keys[k];
  const next = keys[Math.min(k + 1, keys.length - 1)];
  const before = cur.t > prev.t ? (cur.v - prev.v) / (cur.t - prev.t) : 0;
  const after = next.t > cur.t ? (next.v - cur.v) / (next.t - cur.t) : 0;
  return {before, after};
}
```

Then each tangent follows its formula:

```js echo
function tcbTangents(keys, k, {tau = 0, c = 0, b = 0} = {}) {
  const {before, after} = neighborSlopes(keys, k);
  const s = (1 - tau) / 2;
  return {
    in: s * (1 - c) * (1 + b) * before + s * (1 + c) * (1 - b) * after,
    out: s * (1 + c) * (1 + b) * before + s * (1 - c) * (1 - b) * after
  };
}
```

Three keys with values 0, 1, and 4 make a good test, because the slope before
the middle key is 1 and the slope after it is 3:

```js echo
const testKeys = [0, 1, 4].map((v, t) => ({t, v}));
```

With ${tex`\tau = c = b = 0`}, this is Catmull–Rom, and both tangents should be
the average slope, 2:

```js echo
tcbTangents(testKeys, 1)
```

Bias ${tex`b = 1`} leans fully toward the previous key, so both tangents should
be the slope before the key, 1:

```js echo
tcbTangents(testKeys, 1, {b: 1})
```

Continuity makes the two tangents differ. With ${tex`c = -1`}, the curve should
arrive with the slope before the key, 1, and leave with the slope after it, 3:

```js echo
tcbTangents(testKeys, 1, {c: -1})
```

Between two keys, the curve is the Hermite form from Module 09:

```js echo
function hermite(p0, m0, p1, m1, u) {
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * m0
    + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * m1;
}
```

To sample a track, clamp the time, find the segment that holds it, and scale the
tangents by the segment's length ${tex`h`}, because ${tex`u`} runs from 0 to 1
across the segment. The argument `params` gives the controls for each key:

```js echo
function sampleTCB(keys, time, params = () => ({})) {
  const n = keys.length;
  time = Math.min(Math.max(time, keys[0].t), keys[n - 1].t);
  let i = 0;
  while (i < n - 2 && time > keys[i + 1].t) i++;
  const h = keys[i + 1].t - keys[i].t, u = (time - keys[i].t) / h;
  const m0 = tcbTangents(keys, i, params(i)).out * h;
  const m1 = tcbTangents(keys, i + 1, params(i + 1)).in * h;
  return hermite(keys[i].v, m0, keys[i + 1].v, m1, u);
}
```

The curve must pass through every key. At ${tex`t = 1`} it should return 1:

```js echo
sampleTCB(testKeys, 1)
```

```js
const keyWidget = dragPoints({
  k0: {x: -3, y: -1}, k1: {x: -1.8, y: 1.2}, k2: {x: -0.5, y: -0.4}, k3: {x: 0.8, y: 1.6}, k4: {x: 2, y: 0.2}, k5: {x: 3, y: 0.8}
}, {width: 440, height: 300, domain: 3.4, colors: ["#555"]});
const keyPts = view(keyWidget);
const tcbForm = view(Inputs.form({
  key: Inputs.select(["k1", "k2", "k3", "k4"], {value: "k3", label: "edit key"}),
  tau: Inputs.range([-1, 1], {value: 0, step: 0.05, label: "tension τ"}),
  c: Inputs.range([-1, 1], {value: 0, step: 0.05, label: "continuity c"}),
  b: Inputs.range([-1, 1], {value: 0, step: 0.05, label: "bias b"})
}));
```

```js
{
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
});
}
```

The orange and green segments are the tangents arriving at and leaving the edited
key. **Tension** ${tex`\tau > 0`} shortens both, so the curve turns more sharply at
the key. **Continuity** ${tex`c \ne 0`} makes them differ, so the curve has a kink
and is no longer ${tex`C^1`}: ${tex`c < 0`} bends toward a **corner**, and
${tex`c > 0`} makes the curve **overshoot**. **Bias** ${tex`b > 0`} leans toward
the previous key, carrying its motion through, and ${tex`b < 0`} leans toward the
next. Useful values lie in ${tex`[-1, 1]`}. Drag the keys to change their times and
values.

### Controlling speed along a path

Keys fix *where* an object is at key times, but not *how fast* it moves in between.
Consider a trip with the keys ${tex`(0, 0)`} and ${tex`(10, 20)`}. Moving at 11 m/s
for 1 s and then 1 m/s for 9 s meets both keys, though the animator probably meant a
steady 2 m/s:

```js echo
const unevenTrip = (t) => (t <= 1 ? 11 * t : 11 + (t - 1));
const steadyTrip = (t) => 2 * t;
```

Both should reach 20 m at ${tex`t = 10`}, but after one second they should be at
11 m and 2 m:

```js echo
show([[unevenTrip(10), steadyTrip(10)], [unevenTrip(1), steadyTrip(1)]])
```

So we separate the **path** from the **timing**. The fitted curve
${tex`\mathbf p(u)`} gives the path in terms of its parameter ${tex`u`}, and its
**arc length** ${tex`s`} is the distance measured along it. Then

${tex.block`\mathbf p(t) = \mathbf p\big(u(s(t))\big)`}

The animator edits the distance–time curve ${tex`s(t)`}, for example
${tex`s = vt`} (constant speed ${tex`v`}) or
${tex`s = v_0 t + \tfrac12 a t^2`} (starting speed ${tex`v_0`}, constant
acceleration ${tex`a`}: an ease in).

The step ${tex`u(s)`} needs the arc-length table from Module 09. Walk along
the curve and add up the lengths of the small steps,
${tex`s(u_i) \approx s(u_{i-1}) + \lVert\mathbf p_i - \mathbf p_{i-1}\rVert`}:

```js echo
function arcLengthTable(f, n = 400) {
  const table = [{u: 0, s: 0}];
  let prev = f(0);
  for (let i = 1; i <= n; i++) {
    const p = f(i / n);
    const step = Math.hypot(p.x - prev.x, p.y - prev.y);
    table.push({u: i / n, s: table.at(-1).s + step});
    prev = p;
  }
  return table;
}
```

To invert the table, search for the two entries around the target distance and
interpolate between them:

```js echo
function uAtDistance(table, S) {
  const found = d3.bisector((d) => d.s).left(table, S);
  const i = Math.max(1, Math.min(table.length - 1, found));
  const a = table[i - 1], b = table[i];
  return a.u + ((S - a.s) / (b.s - a.s || 1)) * (b.u - a.u);
}
```

The reading's table has ${tex`s = 0, 2.5, 4, 5, 7, 8.5`} at
${tex`u = 0, 0.2, \dots, 1`}:

```js echo
const readingTable = [0, 2.5, 4, 5, 7, 8.5].map((s, i) => ({u: i / 5, s}));
```

The distance 6.5 lies between ${tex`u = 0.6`} (5) and ${tex`u = 0.8`} (7), three
quarters of the way, so the answer should be 0.75:

```js echo
uAtDistance(readingTable, 6.5)
```

For more accuracy, refine with **Newton–Raphson** on ${tex`s(u) - s^* = 0`}, using
${tex`s'(u) = \lVert\mathbf p'(u)\rVert`}. Speed matters most for **position**; our
eyes are less sensitive to uneven rates of change in color or rotation.

```js
const pathPts = [{x: -3, y: -1.5}, {x: -2.6, y: 1.8}, {x: -1.8, y: 2}, {x: -1.2, y: -1}, {x: 1.5, y: -1.6}, {x: 2.7, y: 0.2}, {x: 1.6, y: 2.3}, {x: 3, y: 2.5}];
const pathCurve = (u) => {
  const n = pathPts.length - 1, x = Math.min(u * n, n - 1e-9), i = Math.floor(x), w = x - i;
  const P = [pathPts[Math.max(i - 1, 0)], pathPts[i], pathPts[i + 1], pathPts[Math.min(i + 2, n)]];
  const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * w + (2 * a - 5 * b + 4 * c - d) * w * w + (-a + 3 * b - 3 * c + d) * w ** 3);
  return {x: cr(...P.map((p) => p.x)), y: cr(...P.map((p) => p.y))};
};
```

The figure uses a Catmull–Rom path through eight points, `pathCurve(u)`. Here are
three ways of moving along it, each taking a `phase` from 0 to 1 over the trip:

```js echo
const pathTable = arcLengthTable(pathCurve);
const pathLength = pathTable.at(-1).s;
const atDistance = (s) => pathCurve(uAtDistance(pathTable, s));
const easeInOut = (x) => (1 - Math.cos(Math.PI * x)) / 2;
const pathTimings = {
  "equal steps in u": (phase) => pathCurve(phase),
  "constant speed: s = vt": (phase) => atDistance(pathLength * phase),
  "ease in and out": (phase) => atDistance(pathLength * easeInOut(phase))
};
```

```js
(() => {
  const scene = plane({width: 400, height: 400, domain: 3.4});
  drawPath(scene, d3.range(0, 201).map((i) => pathCurve(i / 200)), {stroke: "#bbb", width: 4});
  const phase = (now / 5000) % 1;
  const colors = ["orangered", "steelblue", "seagreen"];
  Object.entries(pathTimings).forEach(([label, timing], k) => {
    drawPoint(scene, timing(phase), {color: colors[k], r: 8});
    scene.svg.append("text").attr("x", 10).attr("y", 20 + 16 * k).attr("fill", colors[k]).attr("font-size", 12).attr("font-family", "var(--sans-serif)").text(label);
  });
  return scene.svg.node();
})()
```

All three dots trace the same path in five seconds. The red one moves
slowly where the control points are close together and races across long
segments. The blue one has constant speed, and the green one starts and
stops gently.

## Interpolating Rotations

### Rotation is special

Element-wise interpolation of rotation **matrices** is wrong. Here is that
interpolation for ${tex`2\times2`} matrices, along with the determinant, which is
1 for every rotation:

```js echo
const lerpMatrix = (A, B, u) =>
  A.map((r, i) => r.map((v, j) => (1 - u) * v + u * B[i][j]));
const det2 = (M) => M[0][0] * M[1][1] - M[0][1] * M[1][0];
```

These are the rotations by ${tex`+90°`} and ${tex`-90°`}:

```js echo
const plus90 = [[0, -1], [1, 0]], minus90 = [[0, 1], [-1, 0]];
```

Their average should be the zero matrix, not the identity, and its determinant
should be 0:

```js echo
const halfway = lerpMatrix(plus90, minus90, 0.5);
```

```js echo
show([halfway, det2(halfway)])
```

```js
const matLerpT = view(Inputs.range([0, 1], {value: 0.25, step: 0.01, label: "u"}));
```

```js
(() => {
  const M = lerpMatrix(plus90, minus90, matLerpT);
  const q = (1 - matLerpT) * rad(90) + matLerpT * rad(-90);
  const R = [[Math.cos(q), -Math.sin(q)], [Math.sin(q), Math.cos(q)]];
  const shape = [{x: 0, y: 0}, {x: 2, y: 0}, {x: 2, y: 0.6}, {x: 0.6, y: 0.6}, {x: 0.6, y: 1.4}, {x: 0, y: 1.4}, {x: 0, y: 0}];
  const apply = (m, p) => ({x: m[0][0] * p.x + m[0][1] * p.y, y: m[1][0] * p.x + m[1][1] * p.y});
  const scene = plane({width: 340, height: 340, domain: 2.6});
  drawPath(scene, shape.map((p) => apply(M, p)), {stroke: "crimson", width: 2.5, fill: "crimson", opacity: 0.6});
  drawPath(scene, shape.map((p) => apply(R, p)), {stroke: "steelblue", width: 2.5, dash: "5,3"});
  return row(scene.svg.node(), html`<pre style="align-self:center">lerped matrix (red):
[${M[0].map((v) => v.toFixed(2)).join("  ")}]
[${M[1].map((v) => v.toFixed(2)).join("  ")}]
determinant ${det2(M).toFixed(3)}  (a rotation has 1)

angle interpolation (blue, dashed): ${deg(q).toFixed(0)}°</pre>`);
})()
```

The red shape is the matrix interpolation. It shrinks to a point at
${tex`u = 0.5`}. The dashed blue shape interpolates the **angle** instead and
stays rigid.

### Euler angles and gimbal lock

Interpolating an angle works in 2D. In 3D, **Euler angles** seem natural: they
describe an orientation as three rotations about the object's own axes. (Fixed
angles use world axes instead.) Each angle can be keyframed like any other
parameter, but **gimbal lock** can occur: when two rotation axes **line up**, one
degree of freedom is lost. A single 90° turn of the middle gimbal can cause it, so
it is common in practice.

To measure this, we need the three basic rotations and a matrix product:

```js echo
const rot = {
  x: (a) => [[1, 0, 0],
    [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]],
  y: (a) => [[Math.cos(a), 0, Math.sin(a)],
    [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]],
  z: (a) => [[Math.cos(a), -Math.sin(a), 0],
    [Math.sin(a), Math.cos(a), 0], [0, 0, 1]]
};
const mul3 = (A, B) => A.map((r) =>
  B[0].map((_, j) => r.reduce((s, v, k) => s + v * B[k][j], 0)));
```

The orientation is the product of the three rotations:

```js echo
const euler = (yaw, pitch, roll) =>
  mul3(rot.z(yaw), mul3(rot.y(pitch), rot.x(roll)));
```

Now nudge an angle by 1°. The nudge is itself a small rotation, equal to the new
orientation times the inverse of the old one, which for a rotation is its
transpose. A small rotation's axis can be read from its skew-symmetric part:

```js echo
const transpose3 = (A) => A[0].map((_, j) => A.map((r) => r[j]));
function rotationAxis(R) {
  const v = [R[2][1] - R[1][2], R[0][2] - R[2][0], R[1][0] - R[0][1]];
  const len = Math.hypot(...v);
  return v.map((c) => c / len);
}
```

Gimbal lock shows up as the yaw nudge and the roll nudge having the same axis.
This function returns the two axes and the angle between them, for a given pitch:

```js echo
function nudgeAxes(pitch) {
  const yaw = rad(30), roll = rad(20), d = rad(1);
  const inverse = transpose3(euler(yaw, pitch, roll));
  const yawAxis = rotationAxis(mul3(euler(yaw + d, pitch, roll), inverse));
  const rollAxis = rotationAxis(mul3(euler(yaw, pitch, roll + d), inverse));
  const cos = Math.abs(yawAxis.reduce((s, v, i) => s + v * rollAxis[i], 0));
  return {yawAxis, rollAxis, between: deg(Math.acos(Math.min(1, cos)))};
}
```

At zero pitch the axes are the world's ${tex`z`} and ${tex`x`} axes, so they should
be 90° apart. At a pitch of 90° they should coincide, and the angle should be 0:

```js echo
[nudgeAxes(0).between, nudgeAxes(rad(90)).between]
```

```js
const gimbalPitch = view(Inputs.range([0, 90], {value: 60, step: 1, label: "pitch (degrees)"}));
```

```js
(() => {
  const {yawAxis, rollAxis, between} = nudgeAxes(rad(gimbalPitch));
  const f = (v) => `(${v.map((c) => c.toFixed(3)).join(", ")})`;
  return html`<pre>a yaw nudge rotates about  ${f(yawAxis)}
a roll nudge rotates about ${f(rollAxis)}
angle between the two axes: ${between.toFixed(1)}°${between < 0.5 ? "   ← gimbal lock: yaw and roll do the same thing" : ""}</pre>`;
})()
```

Slide the pitch toward 90° and watch the axes approach each other. At 90°, no
combination of small angle changes can turn the object about the missing axis.

### Quaternions

A **quaternion** ${tex`q = [s;\, \mathbf v]`} has a scalar part ${tex`s`} (not an
arc length) and a 3D vector part ${tex`\mathbf v`}. We store it as the array
`[s, x, y, z]`. Addition and scaling work component by component, and the product
is:

${tex.block`q_1 q_2 = [s_1 s_2 - \mathbf v_1\cdot\mathbf v_2;\ \ s_1\mathbf v_2 + s_2\mathbf v_1 + \mathbf v_1 \times \mathbf v_2]`}

In code, the dot and cross products are written out for each component:

```js echo
function qMul([s1, x1, y1, z1], [s2, x2, y2, z2]) {
  return [
    s1 * s2 - x1 * x2 - y1 * y2 - z1 * z2,
    s1 * x2 + s2 * x1 + y1 * z2 - z1 * y2,
    s1 * y2 + s2 * y1 + z1 * x2 - x1 * z2,
    s1 * z2 + s2 * z1 + x1 * y2 - y1 * x2
  ];
}
```

Multiplication is **associative** but **not commutative**, like matrix
multiplication. The units ${tex`i = [0; 1, 0, 0]`} and ${tex`j = [0; 0, 1, 0]`} show
it: ${tex`ij = k`} but ${tex`ji = -k`}, so these two products should differ in the
sign of the last component:

```js echo
show([qMul([0, 1, 0, 0], [0, 0, 1, 0]), qMul([0, 0, 1, 0], [0, 1, 0, 0])])
```

The dot product treats quaternions as 4D vectors,
${tex`q_1\cdot q_2 = s_1 s_2 + \mathbf v_1\cdot\mathbf v_2`}, and the norm is
${tex`|q| = \sqrt{q\cdot q}`}. The inverse is
${tex`q^{-1} = [s;\, -\mathbf v]/|q|^2`}. (The book divides by ${tex`|q|`}; it must be
${tex`|q|^2`}.)

```js echo
const qDot = (a, b) => a.reduce((sum, c, i) => sum + c * b[i], 0);
const qConj = ([s, x, y, z]) => [s, -x, -y, -z];
const qInverse = (q) => qConj(q).map((c) => c / qDot(q, q));
```

A quaternion times its inverse should be the identity quaternion,
${tex`[1; 0, 0, 0]`}, even when it is not a unit quaternion:

```js echo
show(qMul([2, 0, 0, 1], qInverse([2, 0, 0, 1])))
```

Rotations use **unit** quaternions, for which ${tex`q^{-1} = [s;\, -\mathbf v]`} is
just `qConj`. A rotation by angle ${tex`\phi`} about the unit axis ${tex`\mathbf n`}
is

${tex.block`q = \big[\cos(\phi/2);\ \sin(\phi/2)\,\mathbf n\big]`}

To rotate a point ${tex`\mathbf p`}, write it as ${tex`q_p = [0;\, \mathbf p]`} and
compute ${tex`q\, q_p\, q^{-1}`}. The result has a zero scalar part, and its vector
part is the rotated point:

```js echo
const qAxisAngle = (n, phi) =>
  [Math.cos(phi / 2), ...n.map((c) => Math.sin(phi / 2) * c)];
const qRotate = (q, p) => qMul(qMul(q, [0, ...p]), qConj(q)).slice(1);
```

A rotation by 90° about ${tex`z`} should turn ${tex`(1, 0, 0)`} into
${tex`(0, 1, 0)`}:

```js echo
show(qRotate(qAxisAngle([0, 0, 1], rad(90)), [1, 0, 0]))
```

For a harder test, we can compare with **Rodrigues' formula**, an independent way
of rotating a point about an axis:

```js echo
function rodrigues(n, phi, p) {
  const dot = n.reduce((s, c, i) => s + c * p[i], 0);
  const cross = [n[1] * p[2] - n[2] * p[1],
    n[2] * p[0] - n[0] * p[2], n[0] * p[1] - n[1] * p[0]];
  const cos = Math.cos(phi), sin = Math.sin(phi);
  return p.map((c, i) =>
    c * cos + cross[i] * sin + n[i] * dot * (1 - cos));
}
```

```js echo
const testAxis = [1, 1, 0].map((c) => c / Math.SQRT2);
const testQ = qAxisAngle(testAxis, rad(70));
const testPoint = [0.3, -1.2, 2];
```

The two rows should match:

```js echo
show([qRotate(testQ, testPoint), rodrigues(testAxis, rad(70), testPoint)])
```

**Composition** is just multiplication: rotate by ${tex`q_1`} and then by
${tex`q_2`} with ${tex`q_2 q_1`}. Rotating with the product should give the same
point as rotating twice:

```js echo
const quarterZ = qAxisAngle([0, 0, 1], rad(90));
```

```js echo
show([
  qRotate(qMul(quarterZ, testQ), testPoint),
  qRotate(quarterZ, qRotate(testQ, testPoint))
])
```

To send a rotation to the GPU, convert it to a matrix. This gives the same rotation
as ${tex`q\,q_p\,q^{-1}`}, in the column-major layout of `lib/math/mat4.js`:

```js echo
function qToMat4([s, x, y, z]) {
  return new Float32Array([
    1 - 2 * (y * y + z * z), 2 * (x * y + s * z), 2 * (x * z - s * y), 0,
    2 * (x * y - s * z), 1 - 2 * (x * x + z * z), 2 * (y * z + s * x), 0,
    2 * (x * z + s * y), 2 * (y * z - s * x), 1 - 2 * (x * x + y * y), 0,
    0, 0, 0, 1
  ]);
}
```

A matrix's first column is where it sends the ${tex`x`}-axis. For the 90° rotation
about ${tex`z`}, it should be ${tex`(0, 1, 0)`}:

```js echo
show([...qToMat4(quarterZ).slice(0, 3)])
```

### Interpolating quaternions

Unit quaternions are points on a **sphere in 4D**, so we interpolate **on the
sphere**:

${tex.block`\operatorname{slerp}(q_1, q_2; u) = \frac{\sin\big((1-u)\theta\big)}{\sin\theta}\, q_1 + \frac{\sin(u\theta)}{\sin\theta}\, q_2, \qquad \cos\theta = q_1\cdot q_2`}

Here ${tex`\theta`} is the angle between ${tex`q_1`} and ${tex`q_2`} on the 4D sphere.
**nlerp** (lerp, then normalize) is simpler and often good enough, though it does not
have constant speed. The two functions below share one detail: ${tex`q`} and
${tex`-q`} are the **same rotation**, because the two minus signs in
${tex`q\,q_p\,q^{-1}`} cancel. If ${tex`q_1\cdot q_2 < 0`}, we negate one of them to
take the short way around.

```js echo
const shortWay = (a, b) => (qDot(a, b) < 0 ? b.map((c) => -c) : b);
function qNlerp(a, b, u) {
  b = shortWay(a, b);
  const q = a.map((c, i) => c + u * (b[i] - c));
  const len = Math.hypot(...q);
  return q.map((c) => c / len);
}
```

slerp falls back on nlerp when ${tex`\theta \approx 0`}, where it would otherwise
divide by ${tex`\sin\theta \approx 0`}:

```js echo
function qSlerp(a, b, u) {
  b = shortWay(a, b);
  const d = qDot(a, b);
  if (d > 0.9995) return qNlerp(a, b, u);
  const th = Math.acos(d), sinTh = Math.sin(th);
  return a.map((c, i) =>
    (Math.sin((1 - u) * th) * c + Math.sin(u * th) * b[i]) / sinTh);
}
```

Halfway from no rotation to a 90° rotation about ${tex`z`} should be the 45°
rotation, ${tex`[\cos 22.5°; 0, 0, \sin 22.5°] \approx [0.924; 0, 0, 0.383]`}. Both
methods are correct at the midpoint:

```js echo
const noRotation = qAxisAngle([0, 0, 1], 0);
```

```js echo
show([qSlerp(noRotation, quarterZ, 0.5), qNlerp(noRotation, quarterZ, 0.5)])
```

They differ elsewhere, and the plot measures how. It compares the **angular speed**
of the two methods at each ${tex`u`}:

```js
const slerpAngle = view(Inputs.range([10, 179], {value: 150, step: 1, label: "angle between the two keys (degrees)"}));
```

```js
(() => {
  const qa = qAxisAngle([0, 1, 0], 0), qb = qAxisAngle([0, 1, 0], rad(slerpAngle)), du = 0.005;
  const angleBetween = (p, q) => 2 * Math.acos(Math.min(1, Math.abs(qDot(p, q))));
  const data = ["slerp", "nlerp"].flatMap((name) => d3.range(0, 1 - du, du).map((u) => {
    const f = name === "slerp" ? qSlerp : qNlerp;
    return {u, name, speed: deg(angleBetween(f(qa, qb, u), f(qa, qb, u + du))) / du};
  }));
  return Plot.plot({height: 220, width: 520, x: {label: "u"}, y: {label: "angular speed (degrees per unit u)", zero: true}, color: {legend: true},
    marks: [Plot.line(data, {x: "u", y: "speed", stroke: "name", strokeWidth: 2})]});
})()
```

The slerp line is flat at the key angle. The nlerp speed bulges in the
middle, and the bulge grows with the angle. For keys a few degrees apart,
nlerp is fine.

For smoother curves through many keys, apply the **de Casteljau** construction from
Module 09, with slerp in place of lerp. Each pass blends neighboring quaternions
until one is left:

```js echo
function qDeCasteljau(keys, u) {
  let level = keys;
  while (level.length > 1) {
    const prev = level;
    level = prev.slice(1).map((q, i) => qSlerp(prev[i], q, u));
  }
  return level[0];
}
```

Since it only ever blends with slerp, the result should stay a unit quaternion, so
this norm should be 1:

```js echo
show(Math.hypot(...qDeCasteljau([noRotation, testQ, quarterZ], 0.3)))
```

## Deformation and Characters

### Global deformations

A **global deformation** applies one function to every vertex or control point:
${tex`\mathbf p' = f(\mathbf p, \boldsymbol\gamma)`}. To animate the shape, keyframe
the parameters ${tex`\boldsymbol\gamma`}. Three classic choices follow, for a bar that
runs along ${tex`x`} from ${tex`-2`} to ${tex`2`}.

**Taper** scales the cross-section by an amount that changes along the axis:

```js echo
const taper = (p, amount) =>
  ({...p, y: p.y * (1 - (amount * (p.x + 2)) / 4)});
```

**Bend** wraps the axis around a circle. A total bend ${tex`\alpha`} over a bar of
length 4 means a circle of radius ${tex`r = 4/\alpha`}, and a point's distance along
the bar becomes its angle on that circle:

```js echo
function bend(p, total) {
  if (Math.abs(total) < 1e-6) return p;
  const r = 4 / total, a = ((p.x + 2) / 4) * total;
  return {
    ...p,
    x: -2 + (r - p.y) * Math.sin(a),
    y: r - (r - p.y) * Math.cos(a)
  };
}
```

Bending by 90° should send the end of the bar's center line, ${tex`(2, 0)`}, to the
end of a quarter circle of radius ${tex`4/(\pi/2) \approx 2.546`}. That is
${tex`(0.546, 2.546)`}:

```js echo
show(bend({x: 2, y: 0}, rad(90)))
```

**Twist** needs 3D. It rotates the cross-section by an angle that grows along the axis:

```js echo
function twist({x, y, z}, ratePerUnit) {
  const a = ratePerUnit * x, c = Math.cos(a), s = Math.sin(a);
  return {x, y: c * y - s * z, z: s * y + c * z};
}
```

A point at ${tex`x = 0`} should not move, and a point at ${tex`x = 1`} with a rate of
90° per unit should go from ${tex`(1, 1, 0)`} to ${tex`(1, 0, 1)`}:

```js echo
show([
  twist({x: 0, y: 1, z: 0}, rad(90)),
  twist({x: 1, y: 1, z: 0}, rad(90))
])
```

The figure applies taper and then bend to a grid of points on the bar:

```js
const deformForm = view(Inputs.form({
  taper: Inputs.range([-0.8, 0.8], {value: 0.4, step: 0.05, label: "taper"}),
  bend: Inputs.range([-90, 90], {value: 40, step: 1, label: "bend (degrees over the bar)"})
}));
```

```js
(() => {
  const bar = [];
  for (let i = 0; i <= 20; i++) for (let j = 0; j <= 4; j++) bar.push({x: -2 + (4 * i) / 20, y: -0.5 + j / 4, i, j});
  const scene = plane({width: 420, height: 420, domain: 3});
  const pts = bar.map((p) => bend(taper(p, deformForm.taper), rad(deformForm.bend)));
  for (let j = 0; j <= 4; j++) drawPath(scene, pts.filter((p) => p.j === j), {stroke: "steelblue", width: j % 4 ? 1 : 2.5});
  for (let i = 0; i <= 20; i += 2) drawPath(scene, pts.filter((p) => p.i === i), {stroke: "steelblue", width: 1});
  return scene.svg.node();
})()
```

These are easy to keyframe, but they are **global**: the whole object changes, and
unusual shapes are hard to express as a formula. A **local** alternative moves one
**seed vertex** and lets nearby vertices follow, with a falloff that decreases with
distance:

```js echo
const falloff = (distance, radius) =>
  Math.max(0, 1 - (distance / radius) ** 2) ** 2;
```

A vertex at the seed should move fully (1), and one at the radius should not move (0):

```js echo
[falloff(0, 2), falloff(1, 2), falloff(2, 2)]
```

### Free-form deformation

**Free-form deformation (FFD)** is more flexible. Embed the object in a lattice of
${tex`(L+1)\times(M+1)\times(N+1)`} points ${tex`P_{ijk}`}, find each object point's
lattice coordinates ${tex`(s,t,u) \in [0,1]^3`} (local coordinates, not time or arc
length), move the lattice to ${tex`P'_{ijk}`}, and re-evaluate:

${tex.block`\mathbf P(s,t,u) = \sum_{i=0}^{L}\sum_{j=0}^{M}\sum_{k=0}^{N} \tbinom{L}{i}(1-s)^{L-i}s^i\ \tbinom{M}{j}(1-t)^{M-j}t^j\ \tbinom{N}{k}(1-u)^{N-k}u^k\ \mathbf P'_{ijk}`}

This is a trivariate Bézier volume (Module 09). The lattice is a low-resolution handle
that can itself be animated or moved across the object. We use the 2D version with a
${tex`3\times3`} lattice, so the weights are the quadratic Bernstein polynomials:

```js echo
const bern = (k, u) => [(1 - u) ** 2, 2 * u * (1 - u), u * u][k];
```

`P(i, j)` looks up a lattice point. Our undeformed lattice covers the box from
${tex`-2`} to ${tex`2`}, which gives the lattice coordinates directly:

```js echo
function ffd(p, P) {
  const s = (p.x + 2) / 4, t = (p.y + 2) / 4;
  let x = 0, y = 0;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const w = bern(i, s) * bern(j, t);
      x += w * P(i, j).x;
      y += w * P(i, j).y;
    }
  }
  return {x, y};
}
```

An undeformed lattice has control points evenly spaced, so FFD should leave every
point where it was. Here, ${tex`(0.5, -1)`} should come back unchanged:

```js echo
const restLattice = (i, j) => ({x: -2 + 2 * i, y: -2 + 2 * j});
```

```js echo
ffd({x: 0.5, y: -1}, restLattice)
```

```js
const ffdInitial = Object.fromEntries(d3.range(9).map((k) => [`P${Math.floor(k / 3)}${k % 3}`, {x: -2 + 2 * (k % 3), y: -2 + 2 * Math.floor(k / 3)}]));
const ffdWidget = dragPoints({...ffdInitial, P11: {x: 0.7, y: 0.9}, P22: {x: 2.6, y: 2.4}}, {width: 400, height: 400, domain: 3.2, colors: ["purple"]});
const ffdLattice = view(ffdWidget);
```

```js
{
ffdWidget.redecorate((scene) => {
  const P = (i, j) => ffdLattice[`P${j}${i}`];
  for (let j = 0; j < 3; j++) drawPath(scene, [0, 1, 2].map((i) => P(i, j)), {stroke: "purple", width: 1, dash: "3,3"});
  for (let i = 0; i < 3; i++) drawPath(scene, [0, 1, 2].map((j) => P(i, j)), {stroke: "purple", width: 1, dash: "3,3"});
  const star = d3.range(0, 11).map((k) => { const r = k % 2 ? 0.7 : 1.6, a = Math.PI / 2 + (k * Math.PI) / 5; return {x: r * Math.cos(a), y: r * Math.sin(a)}; });
  const dense = star.slice(1).flatMap((q, k) => d3.range(20).map((m) => ({x: star[k].x + (q.x - star[k].x) * m / 20, y: star[k].y + (q.y - star[k].y) * m / 20})));
  drawPath(scene, [...dense, dense[0]].map((p) => ffd(p, P)), {stroke: "orangered", width: 2.5, fill: "orangered", opacity: 0.8});
  for (const g of [-1, 0, 1]) {
    drawPath(scene, d3.range(0, 41).map((k) => ffd({x: -2 + k / 10, y: g}, P)), {stroke: "#999", width: 1});
    drawPath(scene, d3.range(0, 41).map((k) => ffd({x: g, y: -2 + k / 10}, P)), {stroke: "#999", width: 1});
  }
});
}
```

Drag the purple lattice points. The star and the gray grid follow
smoothly, because every point is a weighted average of the lattice with
the same Bernstein weights it had before. (Two points start displaced so
the effect is visible.)

### Skeletons and forward kinematics

A **skin**, the visible surface, sits over a **skeleton**, a tree of joints used only
for animation. A joint's world transform is the **product of local transforms from the
root**, computed by depth-first traversal with a matrix stack (Module 07). In **forward
kinematics (FK)**, the animator sets the **joint angles** directly. Changing link
lengths stretches the limb, which usually looks wrong.

For a planar chain, the product of transforms reduces to adding up the angles and
walking along each link:

```js echo
const ikLengths = [1.5, 1.2, 0.8], ikBase = {x: -1.6, y: -1.6};
function forwardKinematics(angles) {
  const joints = [ikBase];
  let a = 0;
  angles.forEach((da, i) => {
    a += da;
    const p = joints.at(-1);
    joints.push({
      x: p.x + ikLengths[i] * Math.cos(a),
      y: p.y + ikLengths[i] * Math.sin(a)
    });
  });
  return joints;
}
```

The last joint is the **end effector**. With all angles 0, the arm lies along
${tex`x`}, so the effector should be 3.5 from the base, at ${tex`(1.9, -1.6)`}:

```js echo
forwardKinematics([0, 0, 0]).at(-1)
```

### Inverse kinematics

With FK, the animator must pose **every** joint, but they usually care only about the
**end effector**: a foot or a fingertip. In **inverse kinematics (IK)**, the animator
moves the effector, and the system computes the joint parameters. The problem is usually
**underconstrained**: several poses, or a whole continuum of them, reach the same target.
So we add **constraints** such as joint limits (a knee bends only one way).

Let the effector position be ${tex`\mathbf x = \mathbf F(\boldsymbol\alpha)`}, a function
of the ${tex`n`} joint parameters. For a small change,

${tex.block`\delta\mathbf x = J\,\delta\boldsymbol\alpha, \qquad
J = \frac{\partial\mathbf F}{\partial\boldsymbol\alpha} = \begin{bmatrix}
\frac{\partial f_1}{\partial\alpha_1} & \cdots & \frac{\partial f_1}{\partial\alpha_n} \\
\vdots & & \vdots \\
\frac{\partial f_3}{\partial\alpha_1} & \cdots & \frac{\partial f_3}{\partial\alpha_n}
\end{bmatrix}`}

${tex`J`} is the **Jacobian**. Each column says how the effector moves when **one** joint
moves and the others stay fixed. For a planar chain, turning joint ${tex`i`} swings the
effector around that joint, so column ${tex`i`} is the effector's offset from the joint,
turned 90°:

```js echo
const jacobianColumns = (joints) => {
  const e = joints.at(-1);
  return joints.slice(0, -1).map((p) => [p.y - e.y, e.x - p.x]);
};
```

For the straight arm above, the last joint is 0.8 from the effector and the first is 3.5,
so these columns should all point straight up, with lengths 3.5, 2, and 0.8:

```js echo
show(jacobianColumns(forwardKinematics([0, 0, 0])))
```

Now aim at ${tex`\delta\mathbf x = \text{target} - \text{effector}`}, or a limited step
toward it, because ${tex`J`} is valid only **near the current pose**:

```js echo
function limitedStep(from, to, maxStep) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const scale = Math.min(1, maxStep / (Math.hypot(dx, dy) || 1));
  return [dx * scale, dy * scale];
}
```

With more joint parameters than effector coordinates, there are many solutions. We take the
**smallest**: ${tex`\delta\boldsymbol\alpha = J^T(JJ^T)^{-1}\delta\mathbf x`}, the
**pseudoinverse** solution. **Damped least squares**,
${tex`J^T(JJ^T + \lambda^2 I)^{-1}\delta\mathbf x`} with a small damping constant
${tex`\lambda > 0`}, stays stable when the limb is nearly straight. For a planar chain,
${tex`JJ^T + \lambda^2 I`} is a ${tex`2\times2`} matrix we can invert by hand:

```js echo
function dampedSolve(J, [dx, dy], lambda) {
  let a = lambda ** 2, b = 0, d = lambda ** 2;
  for (const [jx, jy] of J) {
    a += jx * jx;
    b += jx * jy;
    d += jy * jy;
  }
  const det = a * d - b * b;
  const wx = (d * dx - b * dy) / det, wy = (a * dy - b * dx) / det;
  return J.map(([jx, jy]) => jx * wx + jy * wy);
}
```

One IK step linearizes around the current pose and takes one damped step. A full solve
repeats this, running FK again each time. A few passes per frame usually suffice, and joint
limits would be applied here, as the step is taken:

```js echo
function ikStep(angles, target, lambda, maxStep = 0.5) {
  const joints = forwardKinematics(angles);
  const J = jacobianColumns(joints);
  const dx = limitedStep(joints.at(-1), target, maxStep);
  const change = dampedSolve(J, dx, lambda);
  return angles.map((a, i) => a + change[i]);
}
function solveIK(start, target, lambda, iterations) {
  const poses = [start];
  for (let k = 0; k < iterations; k++) {
    poses.push(ikStep(poses.at(-1), target, lambda));
  }
  return poses;
}
```

Starting from a bent pose, a target within reach should be hit almost exactly after 40
passes, so this distance should be close to 0:

```js echo
const ikStart = [rad(80), rad(-40), rad(-30)];
const ikCheck = solveIK(ikStart, {x: 1.2, y: -0.6}, 0.3, 40).at(-1);
```

```js echo
show(Math.hypot(
  forwardKinematics(ikCheck).at(-1).x - 1.2,
  forwardKinematics(ikCheck).at(-1).y + 0.6
))
```

```js
const ikWidget = dragPoints({target: {x: 1.2, y: -0.6}}, {width: 400, height: 400, domain: 3.4, colors: ["crimson"]});
const ikTarget = view(ikWidget);
const ikForm = view(Inputs.form({
  iterations: Inputs.range([0, 40], {value: 3, step: 1, label: "IK iterations"}),
  lambda: Inputs.range([0.01, 1.5], {value: 0.3, step: 0.01, label: "damping λ"})
}));
```

```js
{
ikWidget.redecorate((scene) => {
  const poses = solveIK(ikStart, ikTarget.target, ikForm.lambda, ikForm.iterations).map(forwardKinematics);
  poses.forEach((pose, k) => drawPath(scene, pose, {stroke: k === poses.length - 1 ? "steelblue" : "#999", width: k === poses.length - 1 ? 6 : 1.2, opacity: k === poses.length - 1 ? 1 : 0.6}));
  poses.at(-1).forEach((p, k) => drawPoint(scene, p, {color: k === 3 ? "seagreen" : "#333", r: 4}));
  const e = poses.at(-1)[3];
  scene.svg.append("text").attr("x", 10).attr("y", 20).attr("font-size", 12).attr("font-family", "var(--sans-serif)")
    .text(`distance to target: ${Math.hypot(e.x - ikTarget.target.x, e.y - ikTarget.target.y).toFixed(4)}`);
});
}
```

Gray poses are the iterations from the starting pose: a handful of
steps reaches the target. Raise the iterations, then drag the target
out of reach (the arm is 3.5 units long): the arm points at it and stops, the best
least-squares answer. Small ${tex`\lambda`} converges fast but jerks near singular
poses (a straight arm); large ${tex`\lambda`} is smooth but slow.

### Skinning

The skeleton **deforms** the skin. The skin is modeled in a **bind pose**, and a joint's
**inverse bind matrix** takes a vertex from model space into that joint's space in the bind
pose. In **rigid skinning**, each vertex is frozen into **one** joint's space, which is
simple but creases and tears near joints. In **smooth (linear blend) skinning**, let
${tex`\mathbf d_i`} be where joint ${tex`i`} alone would carry the vertex: its current world
transform times its inverse bind matrix, applied to the vertex. Blend these with weights:

${tex.block`\mathbf d = \sum_i w_i\, \mathbf d_i, \qquad \sum_i w_i = 1`}

The sum must be 1, or even the bind pose moves.

Take a 2D limb from ${tex`x = 0`} to ${tex`x = 2`}, with an elbow at ${tex`x = 1`}. Bone 0
never moves, so its ${tex`\mathbf d_0`} is the vertex itself. Bone 1 rotates about the elbow:

```js echo
const bone1 = (p, a) => ({
  x: 1 + Math.cos(a) * (p.x - 1) - Math.sin(a) * p.y,
  y: Math.sin(a) * (p.x - 1) + Math.cos(a) * p.y
});
```

Here is the blend, using ${tex`w`} as the weight of bone 1 and ${tex`1 - w`} as the weight of
bone 0:

```js echo
const blendSkin = (p, w, a) => {
  const q = bone1(p, a);
  return {x: (1 - w) * p.x + w * q.x, y: (1 - w) * p.y + w * q.y};
};
```

The two kinds of skinning differ only in their weights. A rigid vertex belongs entirely to
one bone, while a smooth one changes gradually across the joint:

```js echo
const rigidWeight = (x) => (x > 1 ? 1 : 0);
const smoothWeight = (x) => Math.min(1, Math.max(0, (x - 0.7) / 0.6));
```

A vertex on the skin at the elbow sits 0.3 from the joint. Blending it half and half at a
90° bend should bring it in to about 0.212, closer to the joint than it started:

```js echo
show(Math.hypot(
  blendSkin({x: 1, y: 0.3}, 0.5, rad(90)).x - 1,
  blendSkin({x: 1, y: 0.3}, 0.5, rad(90)).y
))
```

That is the **collapse** of linear blending. The figure shows it at larger scale:

```js
const skinAngle = view(Inputs.range([0, 170], {value: 90, step: 1, label: "elbow angle (degrees)"}));
```

```js
(() => {
  const skin = [];
  for (let i = 0; i <= 40; i++) for (const y of [-0.3, 0.3]) skin.push({x: (2 * i) / 40, y});
  const a = rad(skinAngle);
  const draw = (weight, title) => {
    const scene = plane({width: 280, height: 280, domain: 2.3});
    const moved = skin.map((p) => { const q = blendSkin(p, weight(p.x), a); return {x: q.x - 0.6, y: q.y - 0.6, side: p.y}; });
    const top = moved.filter((p) => p.side > 0), bottom = moved.filter((p) => p.side < 0);
    drawPath(scene, [...top, ...bottom.reverse(), top[0]], {stroke: "steelblue", width: 2, fill: "steelblue", opacity: 0.35});
    drawPath(scene, [{x: -0.6, y: -0.6}, {x: 0.4, y: -0.6}, {x: 0.4 + Math.cos(a), y: -0.6 + Math.sin(a)}], {stroke: "black", width: 3});
    scene.svg.append("text").attr("x", 10).attr("y", 20).attr("font-size", 12).attr("font-family", "var(--sans-serif)").text(title);
    return scene.svg.node();
  };
  return row(draw(rigidWeight, "rigid: one joint per vertex"), draw(smoothWeight, "smooth: blended weights"));
})()
```

Rigid skinning tears and creases at the elbow. Smooth skinning closes
the gap, but at large angles the blended vertices **collapse** inward,
because linear blending averages positions, which loses volume. Setting good weights takes
skill, and **dual quaternion** skinning fixes the collapse at more cost. Extra deformers
called **flexors** can add muscle or breathing effects.

### Facial animation

The face is moved by muscles **attached to the skin**, and people are experts at reading
faces. **Conformational parameters** set the static shape of an individual face: scale, nose
length, jaw width. **Expressive parameters** animate it: eye opening, head rotation,
feature-point motion. Key expressions such as sad, happy, and surprised are **blended** with
the same weighted sum as skinning, to get "slightly sad." For lip sync, the key poses are
**phonemes**. **FACS** (the Facial Action Coding System) builds any expression from elementary
**action units**, such as raising the inner brow.

### Motion capture

**Motion capture** records a real performance and transfers it to a character.

| | Electromagnetic | Optical |
|---|---|---|
| Sensors | active 3D sensors | passive colored markers, several cameras |
| Results | real time | usually processed offline |
| Problems | cost, metal interference, bulky sensors | occlusion, mislabeled markers, noise |

Markers sit on the **skin**, not on the joints, so joint positions must be estimated, and two
markers on either side of a joint help. Errors cause **foot sliding** and missed contacts, which
are fixed with **IK** constraints. **Retargeting** to a character with different proportions is
hard, and the bigger the change, the worse the result.

## Physics, Procedures, and Groups

### Explicit vs. implicit integration

Use physics when other methods cannot give realistic results: **fluids** (including smoke and
fire), **cloth**, **rigid bodies**, and **elastic** objects. **Finite differences** replace
derivatives with differences on a grid:

${tex.block`\frac{df}{dt} \approx \frac{f(t + \Delta t) - f(t)}{\Delta t}, \qquad \frac{\partial f}{\partial x} \approx \frac{f(x + \Delta x, t) - f(x, t)}{\Delta x}`}

Starting from **initial conditions** (and boundary values), the solution steps forward in time.
For ${tex`y' = f(y)`} with step ${tex`\Delta t`}, there are two basic schemes:

- **Explicit (forward) Euler:** ${tex`y_{n+1} = y_n + \Delta t\, f(y_n)`}. Each unknown comes directly from known values. It is simple, but it can become **unstable** for large steps.
- **Implicit (backward) Euler:** ${tex`y_{n+1} = y_n + \Delta t\, f(y_{n+1})`}. Unknowns appear together, so each step solves a **system of equations**. It is typically stable even for large steps.

The simplest test is ${tex`y' = -y`}, with exact solution ${tex`e^{-t}`}. Each scheme just
multiplies ${tex`y`} by a constant at each step. Solving the implicit equation for
${tex`y_{n+1}`} gives its factor:

```js echo
const explicitFactor = (dt) => 1 - dt;
const implicitFactor = (dt) => 1 / (1 + dt);
```

If the factor's magnitude is above 1, the solution grows even though the exact solution
decays, so explicit Euler is stable only for ${tex`\Delta t \le 2`}. At
${tex`\Delta t = 2.5`}, its factor should be ${tex`-1.5`}, which flips the sign and grows.
The implicit factor should be about 0.286:

```js echo
show([explicitFactor(2.5), implicitFactor(2.5)])
```

### Stability on a spring

Now take a spring, ${tex`x'' = -x`}, whose exact motion neither grows nor decays. It has two
state variables, ${tex`x`} and ${tex`v`}, so one step of each method updates both. A third
method joins the first two. **Semi-implicit Euler** updates the velocity first, then moves with
the **new** velocity. It is explicit, but more stable. For implicit Euler, solving the two
equations together gives ${tex`x_{n+1}`} directly:

```js echo
const springSteps = {
  "explicit Euler": (x, v, dt) => [x + v * dt, v - x * dt],
  "semi-implicit Euler": (x, v, dt) => {
    const newV = v - x * dt;
    return [x + newV * dt, newV];
  },
  "implicit Euler": (x, v, dt) => {
    const newX = (x + dt * v) / (1 + dt * dt);
    return [newX, v - newX * dt];
  }
};
```

The simulation just repeats a step and records the state:

```js echo
function simulateSpring(method, dt, steps) {
  let x = 1, v = 0;
  const trace = [{t: 0, x, v, method}];
  for (let i = 0; i < steps; i++) {
    [x, v] = springSteps[method](x, v, dt);
    trace.push({t: (i + 1) * dt, x, v, method});
  }
  return trace;
}
```

The quantity ${tex`x^2 + v^2`} starts at 1 and stays 1 in the exact motion. After 100 steps of
size 0.1, explicit Euler should have gained energy, to about 2.70. Semi-implicit Euler should stay
near 1, and implicit Euler should have lost energy, to about 0.37:

```js echo
show(Object.keys(springSteps).map((method) => {
  const {x, v} = simulateSpring(method, 0.1, 100).at(-1);
  return x * x + v * v;
}))
```

```js
const springDt = view(Inputs.range([0.05, 0.8], {value: 0.3, step: 0.01, label: "time step Δt"}));
```

```js
(() => {
  const steps = Math.round(30 / springDt);
  const data = Object.keys(springSteps).flatMap((m) => simulateSpring(m, springDt, steps));
  return Plot.plot({height: 240, width: 560, x: {label: "time"}, y: {label: "x", domain: [-3, 3], clamp: true}, color: {legend: true},
    marks: [Plot.line(d3.range(0, 30, 0.05), {x: (t) => t, y: (t) => Math.cos(t), stroke: "#ccc", strokeWidth: 4}),
      Plot.line(data, {x: "t", y: (d) => Math.max(-3, Math.min(3, d.x)), stroke: "method", strokeWidth: 1.8})]});
})()
```

The thick gray line is the exact motion. **Explicit** Euler gains energy every step and eventually
blows up: its errors grow exponentially, and the result becomes **meaningless**. **Implicit** Euler
loses energy and settles, which is inaccurate but **stable** at any step. **Semi-implicit**
(symplectic) Euler, one reordered line, stays bounded and is the usual choice for games. Animation
tolerates **inaccuracy** much better than **instability**.

Computing the forces, especially **collision detection**, often costs more than the solver itself.
And physics is hard to **direct**: once the initial conditions are set, the result is fixed. The
animator can only adjust the initial values, the physical properties, or add artificial "driving"
forces.

### Procedural animation: waves

Instead of solving physics, we can write a function whose output **looks like** the motion we want:

${tex.block`f(\mathbf x, t) = A\cos(\omega t - \mathbf k\cdot\mathbf x + \phi)`}

This is the height at surface point ${tex`\mathbf x`}: amplitude ${tex`A`}, angular frequency
${tex`\omega`}, **wave vector** ${tex`\mathbf k`} (direction of travel, ${tex`2\pi`}/wavelength long;
not a key index), and phase ${tex`\phi`} (not the rotation angle ${tex`\phi`}). A **sum of such waves**
with random phases gives a convincing water surface. Here is a slice of it along one axis, where
${tex`\mathbf k`} is just a number:

```js echo
const waves = [
  {A: 0.5, k: 0.6, w: 1.1, phi: 0},
  {A: 0.25, k: 1.3, w: 1.7, phi: 1.3},
  {A: 0.12, k: 2.9, w: 2.6, phi: 4.1},
  {A: 0.06, k: 5.1, w: 3.4, phi: 2.2}
];
const waveHeight = (x, t) => d3.sum(waves, ({A, k, w, phi}) =>
  A * Math.cos(w * t - k * x + phi));
```

At ${tex`x = 0`} and ${tex`t = 0`}, only the phases matter. The height should be about 0.46:

```js echo
show(waveHeight(0, 0))
```

```js
Plot.plot({height: 160, width: 560, x: {label: "x"}, y: {domain: [-1.2, 1.2], label: "height"},
  marks: [Plot.areaY(d3.range(0, 20.01, 0.05), {x: (x) => x, y1: -1.2, y2: (x) => waveHeight(x, now / 1000), fill: "steelblue", fillOpacity: 0.5})]})
```

The long waves carry the overall shape, and the short ones add ripples. **Animated noise** works in
a similar way, using Module 08's solid noise: move the lookup point through the noise lattice over time,
${tex`\text{noise}(\mathbf x + \mathbf v t)`} with a drift velocity ${tex`\mathbf v`}, or animate the
noise parameters, for example to make a cloud grow more turbulent.

### Cellular automata

Conway's **Game of Life** (1970) applies simple rules to a grid, over and over. Each cell has 8
**neighbors** (including diagonals), and all cells update at once:

1. A dead cell with exactly **three** live neighbors becomes alive.
2. A live cell with **two or three** live neighbors stays alive.
3. Every other cell dies or stays dead.

Those three rules fit on one line. The first function counts the neighbors, wrapping around the edges:

```js echo
function liveNeighbors({W, H, cells}, x, y) {
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx || dy) n += cells[((y + dy + H) % H) * W + ((x + dx + W) % W)];
    }
  }
  return n;
}
const lifeRule = (alive, n) => (n === 3 || (alive && n === 2) ? 1 : 0);
```

One generation applies the rule to every cell. It writes to a new array, since all cells must update
from the same old state:

```js echo
function lifeStep(grid) {
  const {W, H, cells} = grid, next = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const n = liveNeighbors(grid, x, y);
      next[y * W + x] = lifeRule(cells[y * W + x], n);
    }
  }
  return next;
}
```

A **blinker** is three live cells in a row, which flips between vertical and horizontal. In a
${tex`5\times5`} grid, the vertical cells 7, 12, and 17 should become the horizontal cells 11, 12, and 13:

```js echo
const blinker = {W: 5, H: 5, cells: new Uint8Array(25)};
blinker.cells.set([1], 7);
blinker.cells.set([1], 12);
blinker.cells.set([1], 17);
```

```js echo
[...lifeStep(blinker)].flatMap((alive, i) => (alive ? [i] : []))
```

```js
const lifeReset = view(Inputs.button("random restart"));
const lifeControls = view(Inputs.form({
  run: Inputs.toggle({value: true, label: "run"}),
  speed: Inputs.range([1, 30], {value: 10, step: 1, label: "generations per second"})
}));
```

```js
const lifeState = (() => {
  lifeReset;
  const W = 96, H = 64;
  return {W, H, cells: Uint8Array.from({length: W * H}, () => (Math.random() < 0.3 ? 1 : 0)), generation: 0};
})();
const lifeCanvas = (() => { const c = document.createElement("canvas"); c.width = 96 * 5; c.height = 64 * 5; c.style.cssText = "border-radius: 8px; max-width: 100%"; return c; })();
```

```js
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

```js
lifeCanvas
```

Gliders, oscillators, and still lifes emerge from these local rules, but
designing rules that produce a *particular* behavior is hard.

### L-systems

An **L-system** is a grammar that rewrites every nonterminal at once until only drawing commands
(terminals) remain. A symbol with no rule is a terminal and stays as it is. A symbol can have several
rules with probabilities, which makes the grammar **stochastic**:

```js echo
function chooseRule(options) {
  let r = Math.random();
  for (const [out, p] of options) {
    if ((r -= p) <= 0) return out;
  }
  return options.at(-1)[0];
}
const rewrite = (s, rules) => [...s]
  .map((ch) => (rules[ch] ? chooseRule(rules[ch]) : ch))
  .join("");
```

With the rule ${tex`A \to fA`}, one pass over `"A+"` should give `"fA+"`, and the terminal `+` should
stay as it is:

```js echo
rewrite("A+", {A: [["fA", 1]]})
```

Drawing the string with a **turtle** gives a plant. `f` moves forward, `+` and `-` turn, `[` saves
(pushes) the current state, `]` restores (pops) it, and `@` draws a leaf. (The book swaps push and pop.)

```js echo
function turtle(s, angle) {
  let x = 0, y = 0, a = 90;
  const stack = [], segments = [], leaves = [];
  for (const ch of s) {
    if (ch === "f") {
      const nx = x + Math.cos(rad(a)), ny = y + Math.sin(rad(a));
      segments.push([x, y, nx, ny]);
      x = nx;
      y = ny;
    }
    else if (ch === "+") a += angle;
    else if (ch === "-") a -= angle;
    else if (ch === "[") stack.push([x, y, a]);
    else if (ch === "]") [x, y, a] = stack.pop();
    else if (ch === "@") leaves.push([x, y]);
  }
  return {segments, leaves};
}
```

The string `"f[+f]f"` should draw a trunk, a branch, and a second trunk segment. The turtle returns to
the branch point after `]`, so the last segment should start where the first ended, at ${tex`(0, 1)`},
and go up to ${tex`(0, 2)`}:

```js echo
show(turtle("f[+f]f", 90).segments.at(-1))
```

Each intermediate string is a **younger plant**, so growth comes for free. The first grammar below is
the reading's, with a random choice where a symbol has two rules. The second is a classic deterministic
one. Other variants use **context-sensitive** rules and parameters on symbols.

```js echo
const grammars = {
  "reading (stochastic, 60°)": {axiom: "S", angle: 60, rules: {
    S: [["A", 1]],
    A: [["[+B]fA", 0.5], ["[-B]fA", 0.45], ["B", 0.05]],
    B: [["fB", 0.7], ["f@", 0.3]]
  }},
  "fractal plant (25°)": {axiom: "X", angle: 25, rules: {
    X: [["f+[[X]-X]-f[-fX]+X", 1]],
    f: [["ff", 1]]
  }}
};
```

```js
const lsysForm = view(Inputs.form({
  grammar: Inputs.select(Object.keys(grammars), {label: "grammar"}),
  generations: Inputs.range([1, 9], {value: 5, step: 1, label: "generations"}),
  reseed: Inputs.button("new random choices")
}));
```

```js
(() => {
  lsysForm.reseed;
  const g = grammars[lsysForm.grammar];
  const gens = g.angle === 25 ? Math.min(lsysForm.generations, 6) : lsysForm.generations * 3;
  let s = g.axiom;
  for (let k = 0; k < gens; k++) s = rewrite(s, g.rules);
  const {segments, leaves} = turtle(s, g.angle);
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

Raise the generations to watch the plant grow. With the reading's grammar, each press of the button makes a
different plant from the same rules.

### Flocking

Coordinated group motion **emerges** from simple local rules (Reynolds, 1987). Each **boid** sees only nearby boids
and combines several desired velocities:

- **physics:** ${tex`\mathbf v_{\text{new}} = \mathbf v_{\text{old}} + \mathbf F\Delta t/m`} for a force ${tex`\mathbf F`} (gravity, wind) on a boid of mass ${tex`m`},
- **collision avoidance** with nearby objects,
- **steering:** separation, alignment (velocity matching), and cohesion (flock centering),
- **goals:** follow a path or a leader, or migrate.

Our boids use only the steering urges. Each boid scans the others within a radius and collects the three urges. The
world wraps around, so each offset takes the shorter way across the edges:

```js echo
const flockW = 520, flockH = 340;
function steeringUrges(b, boids, radius) {
  const sep = {x: 0, y: 0}, ali = {x: 0, y: 0}, coh = {x: 0, y: 0};
  let n = 0;
  for (const o of boids) {
    if (o === b) continue;
    let dx = o.x - b.x, dy = o.y - b.y;
    dx -= flockW * Math.round(dx / flockW);
    dy -= flockH * Math.round(dy / flockH);
    const d = Math.hypot(dx, dy);
    if (d > radius) continue;
    n++;
    ali.x += o.vx;
    ali.y += o.vy;
    coh.x += dx;
    coh.y += dy;
    if (d < radius / 2.5) {
      sep.x -= dx / (d * d + 1e-3);
      sep.y -= dy / (d * d + 1e-3);
    }
  }
  return {sep, ali, coh, n};
}
```

Plain averaging of the urges can cancel out and leave the boid going nowhere. **Acceleration allocation** is better:
each boid has a fixed acceleration budget, handed to the urges in priority order until it runs out:

```js echo
const maxAccel = 0.12;
function allocate(acc, want) {
  const room = Math.max(0, maxAccel - Math.hypot(acc.x, acc.y));
  const len = Math.hypot(want.x, want.y);
  const scale = len > room ? room / len : 1;
  acc.x += want.x * scale;
  acc.y += want.y * scale;
  return acc;
}
```

The first urge below is larger than the budget, so it should take all of it, giving ${tex`x = 0.12`}. The second urge
then gets nothing, so ${tex`y`} should stay 0:

```js echo
allocate(allocate({x: 0, y: 0}, {x: 1, y: 0}), {x: 0, y: 1})
```

Separation goes first, then alignment, then cohesion. Alignment steers toward the neighbors' average velocity, and
cohesion toward their center:

```js echo
function boidAccel(b, boids, form) {
  const {sep, ali, coh, n} = steeringUrges(b, boids, form.radius);
  const acc = {x: 0, y: 0};
  if (!n) return acc;
  const s = form.separation * 0.6;
  const a = form.alignment * 0.05, c = form.cohesion * 0.002;
  allocate(acc, {x: sep.x * s, y: sep.y * s});
  allocate(acc, {x: (ali.x / n - b.vx) * a, y: (ali.y / n - b.vy) * a});
  allocate(acc, {x: (coh.x / n) * c, y: (coh.y / n) * c});
  return acc;
}
```

```js
const flockForm = view(Inputs.form({
  separation: Inputs.range([0, 3], {value: 1.5, step: 0.1, label: "separation"}),
  alignment: Inputs.range([0, 3], {value: 1, step: 0.1, label: "alignment"}),
  cohesion: Inputs.range([0, 3], {value: 0.8, step: 0.1, label: "cohesion"}),
  radius: Inputs.range([10, 80], {value: 40, step: 1, label: "neighborhood radius (pixels)"})
}));
```

```js
const boids = d3.range(140).map(() => ({x: Math.random() * flockW, y: Math.random() * flockH, vx: Math.random() * 2 - 1, vy: Math.random() * 2 - 1}));
const flockCanvas = (() => { const c = document.createElement("canvas"); c.width = flockW; c.height = flockH; c.style.cssText = "border-radius: 8px; max-width: 100%"; return c; })();
```

```js
{
  const ctx = flockCanvas.getContext("2d"), maxSpeed = 2.4;
  let running = true;
  invalidation.then(() => (running = false));
  function step() {
    if (!running) return;
    for (const b of boids) {
      const acc = boidAccel(b, boids, flockForm);
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

```js
flockCanvas
```

Set alignment and cohesion to 0: the boids just avoid each other. Turn
alignment up: they stream in parallel. Cohesion pulls them into clumps,
and separation keeps the clumps from collapsing. Group behavior
**emerges** from purely local rules.

### Particle systems

Particle systems handle many more objects than flocks, possibly hundreds of thousands, but with **no interaction**
between particles (Reeves, 1983). Each step does three things:

1. **Create** new particles with randomized initial values.
2. **Remove** particles whose lifetime has run out.
3. **Integrate** forces and collisions with Newton's law.

They suit fireworks, explosions, spray, smoke, and fire. **Randomness** goes into every parameter, and force fields steer
the system. The last section below builds one on the GPU, where a dead particle is simply reused as a new one, so create and
remove become a single respawn step.

## Animation in WebGPU

### Time-based animation

Animate in **seconds**, not frames, so the motion is the same on 30 Hz and 144 Hz displays.
The course's `animate` helper already measures this:

```js run=false
let start = null;
animate({canvas, device, context, onFrame: ({renderPass, dt, time}) => {
  start ??= time;                   // time, dt: seconds, from animate
  const t = time - start;           // seconds since the animation began
  const step = Math.min(dt, 0.05);  // avoid a huge step after a pause
  update(t, step);                  // sample keys, solve IK, step physics
  draw(renderPass);                 // upload uniforms, record draws
}});
```

Keyframes use the **absolute** time `t`, while physics steps use the **elapsed** time `step`.
`animate` does not clamp `dt`, so we do. It also attaches a `depth24plus` depth buffer, so a
pipeline drawn with it declares `depthStencil` with that format. The two figures below share
one GPU `device` and run their own frame loops with the same two kinds of time. Their
setup code is hidden, and any error from the device appears here:

```js
const {device, format: canvasFormat} = await initializeWebGPU(document.createElement("canvas"));
const deviceErrorLog = document.createElement("pre");
deviceErrorLog.style.cssText = "display: none; color: #e5484d; background: #2a1214; border: 1px solid #e5484d; border-radius: 6px; padding: 8px 12px; font-size: 12px; white-space: pre-wrap;";
device.addEventListener("uncapturederror", (e) => { deviceErrorLog.textContent += `WebGPU error: ${e.error.message}\n`; deviceErrorLog.style.display = "block"; });
```

```js
deviceErrorLog
```

### Sampling a keyframe track

The first figure animates an arm's elbow with a track of keys, every 0.5 s, in degrees:

```js echo
const elbowTrack = [0, 35, 100, 125, 70, 20, -15, -5, 0]
  .map((v, i) => ({t: i * 0.5, v}));
```

When keys are uniformly spaced, sampling is simpler than `sampleTCB`: the segment comes from a
division, and the tangents are Catmull–Rom, ${tex`\tau = c = b = 0`}. Evaluate on the CPU each
frame, then write the results into a buffer:

```js echo
function sampleTrack(keys, t) {
  const step = keys[1].t - keys[0].t, n = keys.length;
  t = Math.min(Math.max(t, keys[0].t), keys[n - 1].t);
  const i = Math.min(Math.floor((t - keys[0].t) / step), n - 2);
  const u = (t - keys[i].t) / step;
  const p0 = keys[Math.max(i - 1, 0)].v, p1 = keys[i].v;
  const p2 = keys[i + 1].v, p3 = keys[Math.min(i + 2, n - 1)].v;
  return hermite(p1, (p2 - p0) / 2, p2, (p3 - p1) / 2, u);
}
```

It should agree with the general sampler, so these two values should be equal:

```js echo
show([sampleTrack(elbowTrack, 1.3), sampleTCB(elbowTrack, 1.3)])
```

### Skinning in the vertex shader

The arm combines the track with a quaternion and with skinning. Each vertex stores four joint
indices and four weights. The shader's inputs are the camera, an array of joint matrices (each
one joint world × inverse bind), and these vertex attributes:

```js echo
const wgslSkinInputs = `
struct Camera { viewProj: mat4x4<f32>, lightDir: vec4<f32> };
@group(0) @binding(0) var<uniform> cam: Camera;
@group(0) @binding(1) var<storage, read> joints: array<mat4x4<f32>>;

struct SkinIn {
  @location(0) pos: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) jointIdx: vec4<u32>,
  @location(3) weights: vec4<f32>,
};
struct VOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) normal: vec3<f32>,
  @location(1) weight: f32,
};
`;
```

The vertex shader blends the matrices. This gives the same point as blending the positions
${tex`\mathbf d_i`}, by linearity, and it can transform the normal with the same `M`:

```js echo
const wgslSkinVertex = `
@vertex
fn vs_skin(v: SkinIn) -> VOut {
  let M = v.weights.x * joints[v.jointIdx.x]
        + v.weights.y * joints[v.jointIdx.y]
        + v.weights.z * joints[v.jointIdx.z]
        + v.weights.w * joints[v.jointIdx.w];
  let n = (M * vec4<f32>(v.normal, 0.0)).xyz;
  return VOut(cam.viewProj * M * vec4<f32>(v.pos, 1.0), n, v.weights.y);
}
`;
```

The fragment shader lights the arm, and its base color shows the weight of bone 1:

```js echo
const wgslSkinFragment = `
@fragment
fn fs_skin(f: VOut) -> @location(0) vec4<f32> {
  let blue = vec3<f32>(0.25, 0.5, 0.9);
  let orange = vec3<f32>(0.95, 0.55, 0.2);
  let base = mix(blue, orange, f.weight);
  let l = normalize(cam.lightDir.xyz);
  let lit = 0.25 + 0.75 * max(dot(normalize(f.normal), l), 0.0);
  return vec4<f32>(pow(base * lit, vec3<f32>(1.0 / 2.2)), 1.0);
}
`;
```

The module is these three pieces joined together:

```js echo
const skinModule = device.createShaderModule({
  code: wgslSkinInputs + wgslSkinVertex + wgslSkinFragment
});
```

On the JavaScript side, the vertex layout packs each vertex into 32 bytes. The indices use
`uint8x4`, which allows up to 256 joints, and the weights use `unorm8x4`, which turns bytes into values
from 0 to 1:

```js echo
const skinVertexLayout = {arrayStride: 32, attributes: [
  {shaderLocation: 0, offset: 0, format: "float32x3"},
  {shaderLocation: 1, offset: 12, format: "float32x3"},
  {shaderLocation: 2, offset: 24, format: "uint8x4"},
  {shaderLocation: 3, offset: 28, format: "unorm8x4"}
]};
```

With `unorm8x4`, the weights sum to 1 only if the four bytes sum to 255, so rounding each byte on its own
can break the rule. Rounding one weight and giving the rest to the other avoids this:

```js echo
const weightBytes = (w1) => {
  const w0 = Math.round(255 * (1 - w1));
  return [w0, 255 - w0, 0, 0];
};
```

For a weight of 0.25, this should give 191 and 64, which sum to 255:

```js echo
weightBytes(0.25)
```

The arm is a tube along ${tex`x`} from 0 to 2, with bone 0 covering ${tex`[0, 1]`} and bone 1 covering
${tex`[1, 2]`}. This function fills the vertex data, ring by ring. Each vertex's weight depends only on its
${tex`x`}, and the band of mixed weights around the elbow is what makes the skinning smooth:

```js echo
const tubeRings = 48, tubeSides = 20;
const tubeWeight = (x, smooth) => smooth
  ? Math.min(1, Math.max(0, (x - 0.75) / 0.5))
  : (x > 1 ? 1 : 0);
function buildTube(smooth) {
  const count = (tubeRings + 1) * (tubeSides + 1);
  const data = new ArrayBuffer(count * 32);
  const floats = new Float32Array(data), bytes = new Uint8Array(data);
  for (let i = 0; i <= tubeRings; i++) {
    for (let j = 0; j <= tubeSides; j++) {
      const k = i * (tubeSides + 1) + j, x = (2 * i) / tubeRings;
      const a = (2 * Math.PI * j) / tubeSides;
      const c = Math.cos(a), s = Math.sin(a);
      floats.set([x, 0.22 * c, 0.22 * s, 0, c, s], k * 8);
      const weights = weightBytes(tubeWeight(x, smooth));
      bytes.set([0, 1, 0, 0, ...weights], k * 32 + 24);
    }
  }
  return data;
}
```

```js
const skinPipeline = device.createRenderPipeline({
  layout: "auto",
  vertex: {module: skinModule, entryPoint: "vs_skin", buffers: [skinVertexLayout]},
  fragment: {module: skinModule, entryPoint: "fs_skin", targets: [{format: canvasFormat}]},
  primitive: {topology: "triangle-list"},
  depthStencil: {format: "depth24plus", depthWriteEnabled: true, depthCompare: "less"}
});
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
const {context: skinContext} = await initializeWebGPU(skinCanvas, {device});
const skinDepth = device.createTexture({size: [380, 320], format: "depth24plus", usage: GPUTextureUsage.RENDER_ATTACHMENT});
const skinClock = {seconds: 0};
```

Each frame, the CPU runs **forward kinematics** with a matrix-stack traversal (Module 07),
multiplies by each joint's **inverse bind** matrix, and uploads the array. Our skeleton has two
joints. Bone 0 is the root, so its world matrix is just the arm's orientation, and its bind pose is the identity.
Bone 1's joint rests at ${tex`x = 1`}, so its inverse bind matrix moves that point to the origin:

```js echo
const inverseBind1 = transforms.translate(-1, 0, 0);
function jointMatrices(orientation, elbow) {
  const J0 = qToMat4(orientation);
  const J1 = mat4.multiplyAll([
    J0, transforms.translate(1, 0, 0), transforms.rotateZ(elbow)
  ]);
  return new Float32Array([...J0, ...mat4.multiply(J1, inverseBind1)]);
}
```

In the bind pose, the joint's world matrix and the inverse bind matrix must cancel, leaving the skin
where it was modeled. So with no rotation at all, both uploaded matrices should be the identity, and
this should be `true`:

```js echo
[...jointMatrices(noRotation, 0)].every(
  (c, i) => Math.abs(c - (i % 16 % 5 === 0 ? 1 : 0)) < 1e-6)
```

The pose at any moment comes from the track and from two orientation keys. The arm's orientation is
slerped between them, and a cosine moves the blend back and forth:

```js echo
const orientationKeys = [
  qAxisAngle([0, 1, 0], rad(-35)),
  qAxisAngle([0.6, 0.8, 0], rad(80))
];
function armPose(seconds) {
  const elbow = rad(sampleTrack(elbowTrack, seconds % 4));
  const swing = (1 - Math.cos((Math.PI * seconds) / 4)) / 2;
  const [a, b] = orientationKeys;
  return jointMatrices(qSlerp(a, b, swing), elbow);
}
```

```js
const skinForm = view(Inputs.form({
  smooth: Inputs.toggle({value: true, label: "smooth skinning (off = rigid)"}),
  speed: Inputs.range([0, 2], {value: 1, step: 0.05, label: "playback speed"})
}));
```

```js
device.queue.writeBuffer(tubeVB, 0, buildTube(skinForm.smooth));
```

```js
{
  const viewProj = mat4.multiply(transforms.perspective(rad(45), 380 / 320, 0.1, 20), transforms.lookAt([1, 1.6, 4.2], [0.8, 0.3, 0], [0, 1, 0]));
  device.queue.writeBuffer(skinCamera, 0, new Float32Array([...viewProj, 0.4, 0.8, 0.5, 0]));
  let running = true, last = performance.now();
  invalidation.then(() => (running = false));
  function frame(nowMs) {
    if (!running) return;
    const dt = Math.max(0, Math.min((nowMs - last) / 1000, 0.05));
    last = nowMs;
    skinClock.seconds += dt * skinForm.speed;
    device.queue.writeBuffer(jointBuffer, 0, armPose(skinClock.seconds));
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

```js
skinCanvas
```

Color shows each vertex's weight for bone 1 (blue = bone 0, orange =
bone 1). With rigid skinning the elbow creases sharply; with smooth
skinning the band of mixed weights bends, and thins at the largest
angles (the collapse seen in the 2D figure).

### Procedural water

The second figure draws water and a fountain with one shader module. Both share a camera, which also
holds the time and, for the fountain, the camera's axes:

```js echo
const wgslFxCamera = `
struct Camera {
  viewProj: mat4x4<f32>,
  right: vec4<f32>,
  up: vec4<f32>,
  time: f32,
};
@group(0) @binding(0) var<uniform> cam: Camera;
`;
```

The water's vertex shader evaluates a **sum of waves** from `time` alone, moving a flat grid. Each wave stores
${tex`(k_x, k_z, \omega, A)`}, and its phase is simply its index. Moving the vertices does not move the normals, so
the shader computes the normal from the derivatives of the sum:
${tex`\partial y/\partial x = \sum A\,k_x \sin(\omega t - \mathbf k\cdot\mathbf x + \phi)`}, likewise for
${tex`z`}, and ${tex`\mathbf n \propto (-\partial y/\partial x,\ 1,\ -\partial y/\partial z)`}:

```js echo
const wgslWaterVertex = `
const WAVES = array<vec4<f32>, 3>(
  vec4<f32>(0.8, 0.3, 1.7, 0.10),
  vec4<f32>(-0.4, 1.1, 2.3, 0.06),
  vec4<f32>(1.9, -0.7, 3.1, 0.03));
struct WOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) normal: vec3<f32>,
};
@vertex
fn vs_water(@location(0) p: vec3<f32>) -> WOut {
  var y = 0.0;
  var slope = vec2<f32>(0.0);
  for (var i = 0; i < 3; i++) {
    let w = WAVES[i];
    let phase = w.z * cam.time - dot(w.xy, p.xz) + f32(i);
    y += w.w * cos(phase);
    slope += w.w * sin(phase) * w.xy;
  }
  let n = normalize(vec3<f32>(-slope.x, 1.0, -slope.y));
  return WOut(cam.viewProj * vec4<f32>(p.x, y, p.z, 1.0), n);
}
`;
```

```js
const wgslWaterFragment = `
@fragment
fn fs_water(f: WOut) -> @location(0) vec4<f32> {
  let l = normalize(vec3<f32>(0.3, 1.0, 0.4));
  let c = vec3<f32>(0.05, 0.25, 0.45) * (0.35 + 0.65 * max(dot(f.normal, l), 0.0)) + vec3<f32>(0.3) * pow(max(f.normal.x * 0.3 + f.normal.z * 0.5, 0.0), 3.0);
  return vec4<f32>(pow(c, vec3<f32>(1.0 / 2.2)), 1.0);
}
`;
```

Only `time` changes each frame, and the GPU recomputes the surface for every vertex. (The fragment shader is ordinary
diffuse lighting, so it is not shown.)

### A GPU particle system

The fountain is a **particle system** in a storage buffer. Each particle takes 32 bytes, and the `Sim` uniform holds
what changes per frame:

```js echo
const wgslParticleData = `
struct Particle {
  pos: vec3<f32>,
  life: f32,
  vel: vec3<f32>,
  pad: f32,
};
struct Sim {
  gravity: vec3<f32>,
  dt: f32,
  emitter: vec3<f32>,
  frame: u32,
};
@group(0) @binding(1) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(2) var<uniform> sim: Sim;
`;
```

`Sim` mixes floats and a `u32`, so the host side writes it through one `ArrayBuffer` with two views:

```js echo
function simBytes(gravity, dt, frame) {
  const data = new ArrayBuffer(32);
  new Float32Array(data).set([0, -gravity, 0, dt, 0, 0.1, 0]);
  new Uint32Array(data)[7] = frame;
  return data;
}
```

The gravity should read back as ${tex`-5`} through the floats, and the frame as 3 through the integers:

```js echo
const testSim = simBytes(5, 0.02, 3);
```

```js echo
[new Float32Array(testSim)[1], new Uint32Array(testSim)[7]]
```

A **compute pass** updates every particle. A negative `life` is a **birth delay**, during which the particle just waits.
When a particle's life runs out, it respawns with random values, using the random numbers from Module 11. Then **semi-implicit
Euler** moves it: velocity first, then position with the new velocity.

```js echo
const wgslParticleUpdate = `
@compute @workgroup_size(64)
fn update(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= arrayLength(&particles)) { return; }
  var p = particles[i];
  if (p.life < 0.0) {
    p.life = min(p.life + sim.dt, 0.0);
    particles[i] = p;
    return;
  }
  p.life -= sim.dt;
  if (p.life <= 0.0) {
    var seed = pcg(i + pcg(sim.frame));
    p.pos = sim.emitter;
    p.vel = vec3<f32>(rand(&seed) - 0.5, 3.0 + rand(&seed),
                      rand(&seed) - 0.5);
    p.life = 2.0 + rand(&seed);
  }
  p.vel += sim.gravity * sim.dt;
  p.pos += p.vel * sim.dt;
  if (p.pos.y < 0.0 && p.vel.y < 0.0) {
    p.pos.y = 0.0;
    p.vel = p.vel * vec3<f32>(0.8, -0.4, 0.8);
  }
  particles[i] = p;
}
`;
```

```js
const wgslRandom = `
fn pcg(v: u32) -> u32 {
  let state = v * 747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
fn rand(seed: ptr<function, u32>) -> f32 { *seed = pcg(*seed); return f32(*seed >> 8u) / 16777216.0; }
`;
```

The buffer starts with every particle off-screen and with a random delay of up to 3 seconds. So particles first appear spread
over time, instead of in one burst:

```js echo
const particleCount = 20000;
function initialParticles(n) {
  const f = new Float32Array(n * 8);
  for (let i = 0; i < n; i++) {
    f[i * 8 + 1] = -1e4;
    f[i * 8 + 3] = -3 * Math.random();
  }
  return f;
}
```

The **render pass** reads the same buffer as instance data and draws each particle as a quad of four corners. To face the
camera, a **billboard** builds the quad from the camera's own right and up vectors:

```js echo
const wgslParticleDraw = `
struct POut {
  @builtin(position) clip: vec4<f32>,
  @location(0) corner: vec2<f32>,
  @location(1) life: f32,
};
@vertex
fn vs_particle(@builtin(vertex_index) c: u32,
               @location(0) center: vec3<f32>,
               @location(1) life: f32) -> POut {
  let corner = vec2<f32>(f32(c & 1u), f32(c >> 1u)) * 2.0 - 1.0;
  let offset = corner.x * cam.right.xyz + corner.y * cam.up.xyz;
  let p = center + 0.03 * offset;
  return POut(cam.viewProj * vec4<f32>(p, 1.0), corner, life);
}
@fragment
fn fs_particle(f: POut) -> @location(0) vec4<f32> {
  let r = length(f.corner);
  if (r > 1.0) { discard; }
  let fade = 0.35 * (1.0 - r) * clamp(f.life, 0.0, 1.0);
  return vec4<f32>(vec3<f32>(0.75, 0.9, 1.0) * fade, fade);
}
`;
```

`right` and `up` are rows 0 and 1 of the view matrix, stored column-major:

```js echo
const billboardAxes = (V) => ({
  right: [V[0], V[4], V[8]],
  up: [V[1], V[5], V[9]]
});
```

For a camera on the ${tex`+z`} side looking at the origin, with no tilt, right should be ${tex`(1, 0, 0)`} and up should be
${tex`(0, 1, 0)`}:

```js echo
show(billboardAxes(transforms.lookAt([0, 0, 7], [0, 0, 0], [0, 1, 0])))
```

The pipeline's vertex buffer steps once per **instance**, and the topology is a triangle strip. Each particle is soft, so the pipeline blends
additively and leaves `depthWriteEnabled` off, so that the quads do not cut into each other. They still read the depth buffer, so the water can hide
them:

```js echo
const additive = {srcFactor: "one", dstFactor: "one", operation: "add"};
const particleLayout = {arrayStride: 32, stepMode: "instance", attributes: [
  {shaderLocation: 0, offset: 0, format: "float32x3"},
  {shaderLocation: 1, offset: 12, format: "float32"}
]};
const particleTarget = {
  blend: {color: additive, alpha: additive},
  format: canvasFormat
};
const particleDepth = {
  format: "depth24plus",
  depthWriteEnabled: false,
  depthCompare: "less"
};
```

The module joins the pieces. Here is everything in one list, in the order the shader compiler sees them:

```js echo
const fxModule = device.createShaderModule({code: [
  wgslRandom, wgslFxCamera, wgslWaterVertex, wgslWaterFragment,
  wgslParticleData, wgslParticleUpdate, wgslParticleDraw
].join("\n")});
```

```js
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
  depthStencil: {format: "depth24plus", depthWriteEnabled: true, depthCompare: "less"}});
const particlePipeline = device.createRenderPipeline({
  layout: fxPipelineLayout,
  vertex: {module: fxModule, entryPoint: "vs_particle", buffers: [particleLayout]},
  fragment: {module: fxModule, entryPoint: "fs_particle", targets: [particleTarget]},
  primitive: {topology: "triangle-strip"},
  depthStencil: particleDepth});
const updatePipeline = device.createComputePipeline({layout: device.createPipelineLayout({bindGroupLayouts: [fxComputeLayout]}), compute: {module: fxModule, entryPoint: "update"}});

const gridN = 80, gridVerts = new Float32Array((gridN + 1) * (gridN + 1) * 3), gridIdx = new Uint32Array(gridN * gridN * 6);
for (let i = 0; i <= gridN; i++) for (let j = 0; j <= gridN; j++) gridVerts.set([-4 + (8 * j) / gridN, 0, -4 + (8 * i) / gridN], (i * (gridN + 1) + j) * 3);
for (let i = 0, n = 0; i < gridN; i++) for (let j = 0; j < gridN; j++) { const a = i * (gridN + 1) + j, b = a + gridN + 1; gridIdx.set([a, b, a + 1, a + 1, b, b + 1], n); n += 6; }
const gridVB = device.createBuffer({size: gridVerts.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST});
device.queue.writeBuffer(gridVB, 0, gridVerts);
const gridIB = device.createBuffer({size: gridIdx.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST});
device.queue.writeBuffer(gridIB, 0, gridIdx);

const particleBuffer = device.createBuffer({size: particleCount * 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST});
device.queue.writeBuffer(particleBuffer, 0, initialParticles(particleCount));
const fxCamera = device.createBuffer({size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
const fxSim = device.createBuffer({size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
const fxRenderBG = device.createBindGroup({layout: fxRenderLayout, entries: [{binding: 0, resource: {buffer: fxCamera}}]});
const fxComputeBG = device.createBindGroup({layout: fxComputeLayout, entries: [
  {binding: 1, resource: {buffer: particleBuffer}}, {binding: 2, resource: {buffer: fxSim}}]});
const fxCanvas = document.createElement("canvas");
fxCanvas.width = 520; fxCanvas.height = 340;
fxCanvas.style.cssText = "border-radius: 8px; max-width: 100%";
const {context: fxContext} = await initializeWebGPU(fxCanvas, {device});
const fxDepth = device.createTexture({size: [520, 340], format: "depth24plus", usage: GPUTextureUsage.RENDER_ATTACHMENT});
const fxFrameCounter = {value: 0};
```

Here is what a frame records. The hidden setup above creates the pipelines and buffers that this function names. The compute pass comes first, and
WebGPU orders its writes before the later render reads, so no barrier is needed. The water draws next, since it writes depth. Then each
particle is drawn as 4 corners, with `particleCount` instances:

```js echo
function recordFxFrame(encoder, passDescriptor) {
  const compute = encoder.beginComputePass();
  compute.setPipeline(updatePipeline);
  compute.setBindGroup(0, fxComputeBG);
  compute.dispatchWorkgroups(Math.ceil(particleCount / 64));
  compute.end();

  const pass = encoder.beginRenderPass(passDescriptor);
  pass.setBindGroup(0, fxRenderBG);
  pass.setPipeline(waterPipeline);
  pass.setVertexBuffer(0, gridVB);
  pass.setIndexBuffer(gridIB, "uint32");
  pass.drawIndexed(gridIdx.length);
  pass.setPipeline(particlePipeline);
  pass.setVertexBuffer(0, particleBuffer);
  pass.draw(4, particleCount);
  pass.end();
}
```

```js
const fxForm = view(Inputs.form({
  gravity: Inputs.range([0, 15], {value: 5, step: 0.1, label: "gravity"}),
  orbit: Inputs.range([-180, 180], {value: 25, step: 1, label: "camera azimuth"})
}));
```

```js
{
  const az = rad(fxForm.orbit), eye = [7 * Math.sin(az), 3, 7 * Math.cos(az)];
  const V = transforms.lookAt(eye, [0, 1, 0], [0, 1, 0]);
  const viewProj = mat4.multiply(transforms.perspective(rad(45), 520 / 340, 0.1, 50), V);
  const {right, up} = billboardAxes(V);
  const camData = new Float32Array(28);
  camData.set([...viewProj, ...right, 0, ...up, 0]);
  let running = true, last = performance.now();
  invalidation.then(() => (running = false));
  function frame(nowMs) {
    if (!running) return;
    const dt = Math.max(0, Math.min((nowMs - last) / 1000, 0.05));
    last = nowMs;
    camData[24] = nowMs / 1000;
    device.queue.writeBuffer(fxCamera, 0, camData);
    device.queue.writeBuffer(fxSim, 0, simBytes(fxForm.gravity, dt, fxFrameCounter.value++));
    const encoder = device.createCommandEncoder();
    recordFxFrame(encoder, {
      colorAttachments: [{view: fxContext.getCurrentTexture().createView(), clearValue: {r: 0.03, g: 0.04, b: 0.07, a: 1}, loadOp: "clear", storeOp: "store"}],
      depthStencilAttachment: {view: fxDepth.createView(), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store"}});
    device.queue.submit([encoder.finish()]);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
```

```js
fxCanvas
```

Only a few bytes of uniforms change per frame: the time and the
simulation step. ${particleCount.toLocaleString()} particles are updated and
drawn without ever returning to the CPU. Raise gravity to shorten the
fountain. **Flocking** on the GPU has the same structure, except each boid
also reads its neighbors, ideally found with a uniform spatial grid (Module 07).

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
3. Tension scales both; continuity makes them unequal (a kink); bias tilts them toward one neighbor. ${tex`\tau = c = b = 0`}.
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
