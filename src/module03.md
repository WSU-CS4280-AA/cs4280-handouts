---
title: Module 03 — Transformations and Viewing
toc: true
---

```js
import * as mat2 from "./components/mat2.js";
import * as mat3 from "./components/mat3.js";
import * as mat4 from "./lib/math/mat4.js";
import * as vec3 from "./lib/math/vec3.js";
import * as transforms from "./lib/math/transforms.js";
import * as wireframe from "./components/wireframe.js";
import {plane, drawArrow, drawPoint, drawPolygon, dragVectors, dragPoints} from "./components/vectorField.js";
import * as Inputs from "npm:@observablehq/inputs";
import {html} from "npm:htl";
```

# Module 03 · Transformations and Viewing

Module 01's linear transformations (scaling, rotation, reflection, and
shear) all fix the origin. This module removes that restriction:
**homogeneous coordinates** let translation use the same
matrix-multiplication framework as the other transformations. That one
extension supports the rest of the graphics pipeline:

| Topic | What it adds |
|---|---|
| **Homogeneous coordinates** | Translation as a matrix, and a clean split between points and vectors |
| **Composition** | Building one matrix from several transforms, in the right order |
| **3D transformations** | 4×4 matrices, Euler angles, and gimbal lock |
| **Viewing and projection** | The camera, perspective and orthographic projection, and the MVP pipeline |

The code is part of the reading: each matrix and transform is written out here
and checked, while the code that draws the pictures stays out of sight. Matching
versions live in `components/mat3.js` and `lib/math/transforms.js`.

Everything here is plain JavaScript, with cubes drawn as wireframes on a
2D canvas, so no GPU is needed; Module 04 runs the same matrices in a
WebGPU vertex shader. This handout teaches the *techniques* behind the
module; it is not a walkthrough of any graded assignment.

## Homogeneous Coordinates

### Why translation is different

An **affine transformation** has the form ${tex`\mathbf{p}' = A\mathbf{p} + \mathbf{t}`}, where ${tex`A`} is the linear part and ${tex`\mathbf{t}`} is a translation vector. Affine transformations preserve straight lines, parallelism, and ratios along a line.

The issue is that ${tex`\mathbf{t}`} is added rather than multiplied. A linear transformation must map the origin to itself, as this scaling from Module 01's toolkit shows:

```js echo
mat2.apply(mat2.scaling(3, 3), {x: 0, y: 0})
```

The result is still ${tex`(0,0)`}. No ordinary 2×2 matrix can map the origin to a nonzero location, so translation is not linear. Homogeneous coordinates incorporate that added offset into a larger matrix.

### Points, vectors, and w

Represent a 2D point as ${tex`(x,y,1)`} and a 2D displacement vector as ${tex`(x,y,0)`}. The final coordinate, ${tex`w`}, distinguishes the two cases.

For a translation,

${tex.block`T(t_x,t_y)=\begin{bmatrix}1&0&t_x\\0&1&t_y\\0&0&1\end{bmatrix}`}

multiplying a point produces ${tex`(x+t_x,y+t_y,1)`}, while multiplying a vector produces ${tex`(x,y,0)`}. In other words, translation changes locations but does not change displacements, directions, or velocities.

In code, a 3×3 matrix adds a third row and column to Module 01's fields:

```js echo
const translation = (tx, ty) => ({
  m00: 1, m01: 0, m02: tx,
  m10: 0, m11: 1, m12: ty,
  m20: 0, m21: 0, m22: 1
});
```

Applying it is the same row-times-vector rule as before, with one more term in each row:

```js echo
const applyHomogeneous = (M, p) => ({
  x: M.m00 * p.x + M.m01 * p.y + M.m02 * p.w,
  y: M.m10 * p.x + M.m11 * p.y + M.m12 * p.w,
  w: M.m20 * p.x + M.m21 * p.y + M.m22 * p.w
});
```

Look at the `x` line. The translation `m02` is multiplied by `w`. That single term is the whole difference between a point and a vector, and the two functions below differ only in the `w` they supply:

```js echo
function transformPoint(M, p) {
  const {x, y} = applyHomogeneous(M, {x: p.x, y: p.y, w: 1});
  return {x, y};
}
function transformVector(M, v) {
  const {x, y} = applyHomogeneous(M, {x: v.x, y: v.y, w: 0});
  return {x, y};
}
```

Test both with the same numbers. Translated by (10, 20), the point (1, 2) should become (11, 22):

```js echo
transformPoint(translation(10, 20), {x: 1, y: 2})
```

The vector (1, 2) should not change at all:

```js echo
transformVector(translation(10, 20), {x: 1, y: 2})
```

Drag point **P** and vector **V**, then adjust the translation. The point moves; the vector does not.

```js
const translateForm = view(Inputs.form({
  tx: Inputs.range([-3, 3], {value: 2, step: 0.1, label: "tx"}),
  ty: Inputs.range([-3, 3], {value: 1, step: 0.1, label: "ty"})
}));
```

```js echo
const T = translation(translateForm.tx, translateForm.ty);
```

The same function calls now run on the draggable **P** and **V**:

```js
const pointInput = view(dragPoints(
  {P: {x: -2, y: -1.5}},
  {colors: ["steelblue"], domain: 4}
));
```

```js
const vectorInput = view(dragVectors(
  {V: {x: -2, y: -1.5}},
  {colors: ["seagreen"], domain: 4}
));
```

```js echo
const P = pointInput.P;
const Pprime = transformPoint(T, P);
const V = vectorInput.V;
const Vprime = transformVector(T, V);
```

```js
(() => {
  const scene = plane({domain: 4});
  drawPoint(scene, P, {color: "steelblue", label: "P"});
  drawPoint(scene, Pprime, {color: "orangered", label: "P′ = T·P"});
  drawArrow(scene, {x: 0, y: 0}, V, {color: "seagreen", label: "V"});
  drawArrow(scene, {x: 0, y: 0}, Vprime, {
    color: "purple",
    width: 1,
    label: "V′ = T·V"
  });
  return scene.svg.node();
})()
```

**P′** = (${Pprime.x.toFixed(2)}, ${Pprime.y.toFixed(2)}). It differs from **P** by exactly (${translateForm.tx.toFixed(2)}, ${translateForm.ty.toFixed(2)}).

**V′** = (${Vprime.x.toFixed(2)}, ${Vprime.y.toFixed(2)}). It is identical to **V**, so the purple arrow lies directly on top of the green arrow.

## Composing Transformations

With homogeneous coordinates, every 2D affine transformation is a 3×3 matrix:

${tex.block`T(t_x,t_y)=\begin{bmatrix}1&0&t_x\\0&1&t_y\\0&0&1\end{bmatrix}\qquad S(s_x,s_y)=\begin{bmatrix}s_x&0&0\\0&s_y&0\\0&0&1\end{bmatrix}\qquad R(\theta)=\begin{bmatrix}\cos\theta&-\sin\theta&0\\\sin\theta&\cos\theta&0\\0&0&1\end{bmatrix}`}

Assume column vectors, as in this module. In a product ${tex`M_3M_2M_1\mathbf{p}`}, the rightmost transformation acts first. This convention is essential for reading composed transforms correctly.

The new rotation has the same upper-left block as Module 01's, with the third row and column left as in the identity. `mat3.multiply` is the same row-dot-column product as before, extended to three rows and columns:

```js echo
function rotation(theta) {
  const c = Math.cos(theta), s = Math.sin(theta);
  return {
    m00: c, m01: -s, m02: 0,
    m10: s, m11: c, m12: 0,
    m20: 0, m21: 0, m22: 1
  };
}
```

### Rotate about a pivot

To rotate an object about a pivot ${tex`\mathbf{p}`} that is not the origin:

1. Translate the pivot to the origin.
2. Rotate about the origin.
3. Translate back.

Thus,

${tex.block`M = T(\mathbf{p})\,R(\theta)\,T(-\mathbf{p})`}

The order shown is the matrix-product order; when applied to a column vector, ${tex`T(-\mathbf{p})`} acts first. The code keeps the same left-to-right order:

```js echo
const rotateAbout = (pivot, theta) => [
  translation(pivot.x, pivot.y),
  rotation(theta),
  translation(-pivot.x, -pivot.y)
].reduce(mat3.multiply);
```

A pivot should stay where it is, because it goes to the origin, rotates in place, and comes back. So a pivot at (2, 3) should map to (2, 3), within rounding:

```js echo
transformPoint(rotateAbout({x: 2, y: 3}, 1.0), {x: 2, y: 3})
```

Below, the same matrix transforms every corner of a shape:

```js
const pivotInputWidget = dragPoints(
  {pivot: {x: 1.5, y: 0.5}},
  {colors: ["purple"], domain: 4}
);
const pivotInput = view(pivotInputWidget);
```

```js
const pivotTheta = view(Inputs.range([0, 360], {
  value: 40,
  step: 1,
  label: "rotate θ about pivot (degrees)"
}));
```

```js echo
const pivot = pivotInput.pivot;
const Mpivot = rotateAbout(pivot, (pivotTheta * Math.PI) / 180);
```

```js
const arrowShape = [
  {x: -2, y: -2.6},
  {x: -0.5, y: -2.6},
  {x: -0.5, y: -3.2},
  {x: 1, y: -2},
  {x: -0.5, y: -0.8},
  {x: -0.5, y: -1.4},
  {x: -2, y: -1.4}
];
```

```js
{
pivotInputWidget.redecorate((scene) => {
  drawPolygon(scene, arrowShape, {stroke: "gray"});
  drawPolygon(
    scene,
    arrowShape.map((p) => transformPoint(Mpivot, p)),
    {stroke: "seagreen", fill: "seagreen", opacity: 0.15}
  );
});
}
```

The gray arrow is the original object. The green arrow rotates around the draggable pivot, not around the plane origin. The same pattern appears when rotating a wheel about its axle or orbiting a camera around a target.

### Why order matters

Consider point ${tex`(1,0)`} and a 90° counterclockwise rotation.

- Rotate first, then translate by ${tex`(3,0)`}: ${tex`T(3,0)R(90^\circ)(1,0)=(3,1)`}.
- Translate first, then rotate: ${tex`R(90^\circ)T(3,0)(1,0)=(0,4)`}.

The transforms contain the same ingredients but describe different motions.

```js echo
const orderPoint = {x: 1, y: 0};
const quarterTurn = rotation(Math.PI / 2), shift = translation(3, 0);
const rotateThenTranslate =
  transformPoint(mat3.multiply(shift, quarterTurn), orderPoint);
const translateThenRotate =
  transformPoint(mat3.multiply(quarterTurn, shift), orderPoint);
```

```js
(() => {
  const scene = plane({domain: 5});
  drawPoint(scene, orderPoint, {color: "gray", label: "(1, 0)"});
  drawPoint(scene, rotateThenTranslate, {
    color: "steelblue",
    label: "rotate, then translate"
  });
  drawPoint(scene, translateThenRotate, {
    color: "orangered",
    label: "translate, then rotate"
  });
  return scene.svg.node();
})()
```

Rotate-then-translate ends at (${rotateThenTranslate.x.toFixed(0)}, ${rotateThenTranslate.y.toFixed(0)}). Translate-then-rotate ends at (${translateThenRotate.x.toFixed(0)}, ${translateThenRotate.y.toFixed(0)}).

Whenever translation and rotation are combined, ask: **which point is the rotation about?** The answer follows from the order of multiplication.

## Transformations in 3D

The same construction extends to 3D. A point becomes ${tex`(x,y,z,1)`}; a vector becomes ${tex`(x,y,z,0)`}; and affine transformations use 4×4 matrices. The module’s `lib/math/mat4.js` represents matrices as flat, column-major arrays, matching the convention typically used by graphics APIs.

Column-major means the 16 numbers are stored one **column** after another, so the translation, which is the last column of the matrix, occupies the last row of the array as written here:

```js echo
const translate3D = (tx, ty, tz) => new Float32Array([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  tx, ty, tz, 1
]);
```

`mat4.transformPoint(m, [x, y, z])` supplies ${tex`w = 1`} and returns all four components. Moving (1, 2, 3) by (10, 20, 30) should give `[11, 22, 33, 1]`:

```js echo
mat4.transformPoint(translate3D(10, 20, 30), [1, 2, 3])
```

The three principal-axis rotation matrices are

${tex.block`R_x(\theta)=\begin{bmatrix}1&0&0\\0&\cos\theta&-\sin\theta\\0&\sin\theta&\cos\theta\end{bmatrix}\qquad R_y(\theta)=\begin{bmatrix}\cos\theta&0&\sin\theta\\0&1&0\\-\sin\theta&0&\cos\theta\end{bmatrix}\qquad R_z(\theta)=\begin{bmatrix}\cos\theta&-\sin\theta&0\\\sin\theta&\cos\theta&0\\0&0&1\end{bmatrix}`}

A common Euler-angle convention composes rotations as

${tex.block`R = R_z(\mathrm{yaw})\,R_y(\mathrm{pitch})\,R_x(\mathrm{roll})`}

With column vectors, roll acts first, then pitch, then yaw. `transforms.rotateX`, `rotateY`, and `rotateZ` build those three matrices, and `mat4.multiplyAll` multiplies a list from left to right, so the code reads just like the formula:

```js echo
const fromEulerZYX = (yaw, pitch, roll) => mat4.multiplyAll([
  transforms.rotateZ(yaw),
  transforms.rotateY(pitch),
  transforms.rotateX(roll)
]);
```

The cube below uses that ZYX product. Its view and projection matrices are built by `lookAt` and `perspective`, which we write later in this module. The red, green, and blue lines show the cube’s local x-, y-, and z-axes after the rotation.

```js
const eulerForm = view(Inputs.form({
  yaw: Inputs.range([-180, 180], {value: 20, step: 1, label: "yaw (Z)"}),
  pitch: Inputs.range([-90, 90], {value: 30, step: 1, label: "pitch (Y)"}),
  roll: Inputs.range([-180, 180], {value: 15, step: 1, label: "roll (X)"})
}));
```

```js echo
const eulerModel = fromEulerZYX(
  (eulerForm.yaw * Math.PI) / 180,
  (eulerForm.pitch * Math.PI) / 180,
  (eulerForm.roll * Math.PI) / 180
);
const fixedView = lookAt([0, 0, 5], [0, 0, 0], [0, 1, 0]);
const fixedProjection = perspective((45 * Math.PI) / 180, 1, 0.1, 20);
const eulerMVP = mat4.multiplyAll([fixedProjection, fixedView, eulerModel]);
```

```js
wireframe.renderWireframe(eulerMVP, {width: 320, height: 320})
```

### Gimbal lock

At a pitch of 90°, the yaw and roll axes align in this ZYX convention. The orientation still exists, but yaw and roll no longer provide two independent controls: one rotational degree of freedom is lost. This is **gimbal lock**, a limitation of Euler-angle parameterizations rather than a numerical error.

Quaternions avoid this coordinate singularity and are therefore commonly used for animation and orientation interpolation. The following view fixes pitch at 90° so the dependency between yaw and roll is visible.

We can check the claim numerically before looking. Two different angle pairs with the same difference, yaw − roll = 40°, should give the same matrix, so the distance between them should be about 0:

```js echo
{
  const deg = Math.PI / 180;
  const m1 = fromEulerZYX(40 * deg, 90 * deg, 0);
  const m2 = fromEulerZYX(0, 90 * deg, -40 * deg);
  display(d3.max(m1, (value, i) => Math.abs(value - m2[i])));
}
```

```js
const gimbalForm = view(Inputs.form({
  yaw: Inputs.range([-180, 180], {value: 0, step: 1, label: "yaw (Z)"}),
  roll: Inputs.range([-180, 180], {value: 0, step: 1, label: "roll (X)"})
}));
```

```js echo
const gimbalModel = fromEulerZYX(
  (gimbalForm.yaw * Math.PI) / 180,
  Math.PI / 2,
  (gimbalForm.roll * Math.PI) / 180
);
const gimbalMVP =
  mat4.multiplyAll([fixedProjection, fixedView, gimbalModel]);
```

```js
wireframe.renderWireframe(gimbalMVP, {width: 320, height: 320})
```

At this fixed pitch, the visible orientation depends on the difference ${tex`\mathrm{yaw}-\mathrm{roll}`}. The current effective rotation is ${((gimbalForm.yaw - gimbalForm.roll)).toFixed(0)}°. For example, yaw = 40° and roll = 0° produces the same orientation as yaw = 0° and roll = −40°.

## Viewing and Projection

### From object space to screen space

A mesh vertex passes through several coordinate spaces:

```js
(() => {
  const items = ["Object (local)", "World", "View (camera)", "Clip", "NDC", "Screen"];
  const div = document.createElement("div");
  div.style.display = "flex";
  div.style.flexWrap = "wrap";
  div.style.gap = "6px";
  div.style.alignItems = "center";

  items.forEach((label, i) => {
    const chip = document.createElement("span");
    chip.textContent = label;
    chip.style.padding = "4px 10px";
    chip.style.borderRadius = "999px";
    chip.style.background = "var(--theme-background-alt, #f5f5f5)";
    chip.style.fontSize = "13px";
    div.appendChild(chip);

    if (i < items.length - 1) {
      const arrow = document.createElement("span");
      arrow.textContent = "→";
      arrow.style.opacity = "0.5";
      div.appendChild(arrow);
    }
  });

  return div;
})()
```

- **Object (local) space:** coordinates defined relative to the model itself.
- **World space:** the model after its model matrix places it in the scene.
- **View space:** world coordinates expressed relative to the camera.
- **Clip space:** the result of applying the projection matrix, before division by ${tex`w`}.
- **Normalized device coordinates (NDC):** clip coordinates after dividing by ${tex`w`}.
- **Screen space:** NDC mapped to pixel coordinates in a viewport.

The example follows one cube corner, ${tex`(1,1,1)`}, through those stages. The camera is at the world origin and looks down the negative z-axis, so objects with negative world z are in front of the camera.

Each stage is one matrix or one small step. `lookAt` and `perspective`, which we examine in the next two sections, build the view and projection matrices. The steps are in the order of the list above:

```js
const modelForm = view(Inputs.form({
  wx: Inputs.range([-8, 8], {value: 5, step: 0.5, label: "world x"}),
  wy: Inputs.range([-8, 8], {value: 0, step: 0.5, label: "world y"}),
  wz: Inputs.range([-15, -3], {value: -10, step: 0.5, label: "world z"})
}));
```

```js echo
const objectVertex = [1, 1, 1];
const modelMatrix = translate3D(modelForm.wx, modelForm.wy, modelForm.wz);
const viewMatrix = lookAt([0, 0, 0], [0, 0, -1], [0, 1, 0]);
const projMatrix = perspective((60 * Math.PI) / 180, 1, 0.1, 50);
```

```js echo

const worldVertex = mat4.transformPoint(modelMatrix, objectVertex);
const viewVertex = mat4.transformPoint(viewMatrix, worldVertex);
const clipVertex = mat4.transformPoint(projMatrix, viewVertex);
const ndcVertex = clipVertex.slice(0, 3).map((v) => v / clipVertex[3]);
```

The last step is the viewport transform, here for a 1920×1080 window. NDC runs from −1 to 1, so `* 0.5 + 0.5` remaps it to 0 to 1. Screen y points down, hence the `1 -`:

```js echo
const screenVertex = [
  (ndcVertex[0] * 0.5 + 0.5) * 1920,
  (1 - (ndcVertex[1] * 0.5 + 0.5)) * 1080
];
```

```js
(() => {
  const fmt = (p) => `(${p.map((v) => v.toFixed(2)).join(", ")})`;
  return html`<pre>object  ${fmt(objectVertex)}
world   ${fmt(worldVertex.slice(0, 3))}   (model matrix places the cube in the scene)
view    ${fmt(viewVertex.slice(0, 3))}   (coordinates relative to the camera)
clip    ${fmt(clipVertex)}   (after projection, before division by w)
NDC     ${fmt(ndcVertex)}   (clip coordinates divided by w)
screen  (${screenVertex[0].toFixed(0)}, ${screenVertex[1].toFixed(0)}) px   (on a 1920×1080 viewport)</pre>`;
})()
```

Move `world z` closer to 0. As the vertex approaches the camera plane, clip-space ${tex`w`} approaches zero, making the perspective divide unstable or undefined. The graphics pipeline clips primitives in clip space before performing that divide.

### The virtual camera

A graphics camera is represented by an eye position, a target point, and an up-direction hint. From these values, `lookAt` constructs an orthonormal camera basis, in three steps. `forward` points from the eye to the target. Crossing it with the up hint gives `right`, which is perpendicular to both. Crossing those two gives the camera's true up:

```js echo
function cameraBasis(eye, target, up) {
  const forward = vec3.normalize(vec3.sub(target, eye));
  const right = vec3.normalize(vec3.cross(forward, up));
  return {forward, right, trueUp: vec3.cross(right, forward)};
}
```

 The **view matrix** does not physically move a camera object; instead, it transforms the whole world into coordinates relative to that camera:

${tex.block`M_{\mathrm{view}} = M_{\mathrm{camera}}^{-1}`}

The inverse needs no general inversion routine. The camera's rotation is orthonormal, so its inverse is its transpose, which puts the basis vectors in the matrix's **rows**. The last column moves the eye to the origin. Remember that each row written below is one column of the matrix, and that a camera looks down its own ${tex`-z`}, hence `-f`:

```js echo
function lookAt(eye, target, up) {
  const {forward: f, right: r, trueUp: u} = cameraBasis(eye, target, up);
  return new Float32Array([
    r[0], u[0], -f[0], 0,
    r[1], u[1], -f[1], 0,
    r[2], u[2], -f[2], 0,
    -vec3.dot(r, eye), -vec3.dot(u, eye), vec3.dot(f, eye), 1]);
}
```

Two checks follow from what a view matrix means. The eye should land on the origin, within rounding:

```js echo
mat4.transformPoint(lookAt([3, 4, 0], [0, 0, 0], [0, 1, 0]), [3, 4, 0])
```

The target is 5 units from that eye, straight ahead along the camera's ${tex`-z`}, so it should land at `[0, 0, -5, 1]`:

```js echo
mat4.transformPoint(lookAt([3, 4, 0], [0, 0, 0], [0, 1, 0]), [0, 0, 0])
```

Orbit the eye around the cube below. The eye position comes from spherical coordinates around the origin. The cube’s model matrix remains the identity; only the view matrix changes.

```js
const orbitForm = view(Inputs.form({
  azimuth: Inputs.range([-180, 180], {value: 35, step: 1, label: "azimuth (degrees)"}),
  elevation: Inputs.range([-80, 80], {value: 20, step: 1, label: "elevation (degrees)"}),
  distance: Inputs.range([3, 12], {value: 6, step: 0.1, label: "distance"})
}));
```

```js echo
const az = (orbitForm.azimuth * Math.PI) / 180;
const el = (orbitForm.elevation * Math.PI) / 180;
const eye = [
  orbitForm.distance * Math.cos(el) * Math.sin(az),
  orbitForm.distance * Math.sin(el),
  orbitForm.distance * Math.cos(el) * Math.cos(az)
];
```

```js echo
const orbitView = lookAt(eye, [0, 0, 0], [0, 1, 0]);
const orbitProjection = perspective((50 * Math.PI) / 180, 1, 0.1, 30);
const orbitMVP = mat4.multiply(orbitProjection, orbitView);
```

```js
wireframe.renderWireframe(orbitMVP, {width: 320, height: 320})
```

Eye position: (${eye[0].toFixed(2)}, ${eye[1].toFixed(2)}, ${eye[2].toFixed(2)}).

The rendered view changes even though the cube does not. The view matrix re-expresses every object relative to the current eye position and viewing direction.

### Projection

**Orthographic projection** uses parallel projection rays. It preserves apparent size with depth: a cube twice as far away appears the same size. In homogeneous form, ${tex`w`} remains 1, so there is no meaningful perspective divide. The matrix just scales and shifts a box of the given bounds into the NDC range, with depth mapped to WebGPU's ${tex`[0, 1]`}:

```js echo
function ortho(l, r, b, t, n, f) {
  const k = 1 / (n - f);
  return new Float32Array([
    2 / (r - l), 0, 0, 0,
    0, 2 / (t - b), 0, 0,
    0, 0, k, 0,
    -(r + l) / (r - l), -(t + b) / (t - b), n * k, 1]);
}
```

**Perspective projection** uses rays that converge at the eye. The projected homogeneous ${tex`w`} is proportional to view-space depth, so dividing by ${tex`w`} makes more distant geometry appear smaller. Look for that in the code. Written here as columns, the `-1` is in the third column's last entry, so it copies ${tex`-z`} into ${tex`w`}. `f` scales ${tex`x`} and ${tex`y`} according to the field of view, and `k` maps depth to ${tex`[0, 1]`}:

```js echo
function perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2), k = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, far * k, -1,
    0, 0, near * far * k, 0]);
}
```

A point 4 units in front of the camera has ${tex`z = -4`}, so its ${tex`w`} should be 4:

```js echo
mat4.transformPoint(perspective(Math.PI / 2, 1, 0.1, 50), [1, 1, -4])
```

Under orthographic projection, the same point keeps ${tex`w = 1`}:

```js echo
mat4.transformPoint(ortho(-2, 2, -2, 2, 0.1, 50), [1, 1, -4])
```

```js
const projForm = view(Inputs.form({
  fov: Inputs.range([20, 100], {value: 50, step: 1, label: "perspective FOV (degrees)"}),
  orthoExtent: Inputs.range([1, 5], {value: 2.5, step: 0.1, label: "orthographic half-extent"})
}));
```

```js echo
const compareEye = [3, 2, 5];
const compareView = lookAt(compareEye, [0, 0, 0], [0, 1, 0]);
const fovRadians = (projForm.fov * Math.PI) / 180;
const perspProjection = perspective(fovRadians, 1, 0.1, 30);
const e = projForm.orthoExtent;
const orthoProjection = ortho(-e, e, -e, e, 0.1, 30);
const perspMVP = mat4.multiply(perspProjection, compareView);
const orthoMVP = mat4.multiply(orthoProjection, compareView);
```

```js
(() => {
  const div = document.createElement("div");
  div.style.display = "flex";
  div.style.gap = "20px";
  div.style.flexWrap = "wrap";

  const cell = (label, canvas) => {
    const wrap = document.createElement("div");
    const caption = document.createElement("div");
    caption.textContent = label;
    caption.style.font = "12px var(--sans-serif)";
    caption.style.opacity = "0.65";
    caption.style.marginBottom = "4px";
    wrap.appendChild(caption);
    wrap.appendChild(canvas);
    return wrap;
  };

  div.appendChild(cell("Perspective", wireframe.renderWireframe(perspMVP, {width: 280, height: 280})));
  div.appendChild(cell("Orthographic", wireframe.renderWireframe(orthoMVP, {width: 280, height: 280})));
  return div;
})()
```

From the same eye position, perspective projection makes the near face look larger than the far face and can make parallel 3D edges converge on screen. Orthographic projection retains parallel edges and does not use depth to change apparent size, which is useful in CAD, technical drawing, and many interface views.

### The full pipeline

For a vertex represented by a column vector, the pipeline is

${tex.block`\mathbf{p}_{\mathrm{clip}}=M_{\mathrm{projection}}\,M_{\mathrm{view}}\,M_{\mathrm{model}}\,\mathbf{p}_{\mathrm{object}}`}

After clipping, divide by the clip-space ${tex`w`} to obtain NDC:

${tex.block`\mathbf{p}_{\mathrm{ndc}}=\left(\frac{x_{\mathrm{clip}}}{w_{\mathrm{clip}}},\frac{y_{\mathrm{clip}}}{w_{\mathrm{clip}}},\frac{z_{\mathrm{clip}}}{w_{\mathrm{clip}}}\right)`}

Finally, a viewport transform maps NDC to pixel coordinates. In compact form,

${tex.block`\mathbf{p}_{\mathrm{screen}}=M_{\mathrm{viewport}}\,\operatorname{divideByW}\!\left(M_{\mathrm{projection}}M_{\mathrm{view}}M_{\mathrm{model}}\mathbf{p}_{\mathrm{object}}\right)`}

The product ${tex`M_{\mathrm{projection}}M_{\mathrm{view}}M_{\mathrm{model}}`} is commonly called the **Model-View-Projection (MVP)** transform. The notation is useful, but remember that the perspective divide is a separate operation between projection and viewport mapping. Module 04 uses the same transformations in a vertex shader.

## Check Your Understanding

1. Write the point ${tex`(2, 5)`} and the vector ${tex`(2, 5)`} in homogeneous coordinates. What does ${tex`T(3, -1)`} do to each?
2. Where does the point ${tex`(2, 1)`} go under a 90° counterclockwise rotation about the pivot ${tex`(1, 1)`}?
3. Compute ${tex`T(3,0)R(90^\circ)`} and ${tex`R(90^\circ)T(3,0)`} applied to the point ${tex`(0, 1)`}.
4. What is the inverse of ${tex`M = T(\mathbf t)\,R(\theta)`}?
5. In ${tex`R = R_z(\mathrm{yaw})\,R_y(\mathrm{pitch})\,R_x(\mathrm{roll})`}, which rotation acts on a vertex first?
6. What is lost at gimbal lock, and is it a numerical error?
7. A vertex has view-space ${tex`z = -10`}. What is its clip-space ${tex`w`} after this module's perspective matrix?
8. Convert the clip-space point ${tex`(2, -1, 3, 4)`} to NDC.
9. Using this module's viewport mapping, where do NDC ${tex`x = 0.5`}, ${tex`y = -0.25`} land on a 1920×1080 screen?
10. Why does the pipeline clip before the perspective divide?
11. Moving the camera 2 units to the right looks the same as what change to the world? How does that relate to ${tex`M_{\mathrm{view}} = M_{\mathrm{camera}}^{-1}`}?
12. Under orthographic projection, does a cube twice as far away look smaller?

<details>
<summary>Answers</summary>

1. The point is ${tex`(2, 5, 1)`} and moves to ${tex`(5, 4, 1)`}. The vector is ${tex`(2, 5, 0)`} and does not change.
2. (${mat3.transformPoint(mat3.rotateAbout({x: 1, y: 1}, Math.PI / 2), {x: 2, y: 1}).x.toFixed(2)}, ${mat3.transformPoint(mat3.rotateAbout({x: 1, y: 1}, Math.PI / 2), {x: 2, y: 1}).y.toFixed(2)}). Relative to the pivot the point is ${tex`(1, 0)`}, which rotates to ${tex`(0, 1)`}; adding the pivot back gives ${tex`(1, 2)`}.
3. ${tex`T(3,0)R(90^\circ)`}: rotate to ${tex`(-1, 0)`}, then translate to ${tex`(2, 0)`}. ${tex`R(90^\circ)T(3,0)`}: translate to ${tex`(3, 1)`}, then rotate to ${tex`(-1, 3)`}.
4. ${tex`M^{-1} = R(-\theta)\,T(-\mathbf t)`}. The inverse of a product reverses the order and inverts each factor.
5. ${tex`R_x(\mathrm{roll})`}, the rightmost factor.
6. One rotational degree of freedom. At pitch 90° the yaw and roll axes line up, so the two angles control the same rotation. It is a property of the Euler-angle parameterization, not a rounding error.
7. ${mat4.transformPoint(transforms.perspective(Math.PI / 3, 1, 0.1, 50), [0, 0, -10])[3]}. The perspective matrix copies ${tex`-z_{\mathrm{view}}`} into ${tex`w`}.
8. ${tex`(2/4,\ -1/4,\ 3/4) = (0.5, -0.25, 0.75)`}.
9. ${tex`x = (0.5 \cdot 0.5 + 0.5)\cdot 1920 = 1440`} and ${tex`y = (1 - (-0.25 \cdot 0.5 + 0.5))\cdot 1080 = 675`}. Screen y points down, so NDC y is flipped.
10. Near the camera plane ${tex`w`} approaches 0, and behind the camera it is negative. Dividing first would blow up coordinates or flip geometry; clipping first removes those parts while the math is still linear.
11. Moving the whole world 2 units to the left. The view matrix applies the inverse of the camera's placement to everything in the scene.
12. No. Orthographic projection keeps ${tex`w = 1`}, so depth does not change apparent size.

</details>

## Common Pitfalls

- **Translating directions.** Normals, light directions, and velocities
  need ${tex`w = 0`}; with ${tex`w = 1`} a translation shifts them.
- **Reading a product left to right.** In ${tex`M_3M_2M_1\mathbf p`},
  ${tex`M_1`} acts first.
- **Rotating about the origin by accident.** To spin an object in place,
  use ${tex`T(\mathbf c)R(\theta)T(-\mathbf c)`} about its center
  ${tex`\mathbf c`}.
- **Mixing row-major and column-major layouts.** `mat4.js` stores
  matrices as flat column-major arrays. Typing a matrix out row by row
  transposes it, and the translation ends up in the bottom row.
- **Dividing by ${tex`w`} before clipping.** Geometry at or behind the
  camera produces infinite or mirrored coordinates.
- **Choosing an up vector parallel to the view direction.** `lookAt`
  takes a cross product of the two, which is zero, so the camera basis
  becomes `NaN`.
- **Interpolating Euler angles for smooth rotation.** Near gimbal lock,
  small orientation changes need large angle changes; use quaternions.

## Summary

- **Homogeneous coordinates:** add ${tex`w`}, with ${tex`w = 1`} for
  points and ${tex`w = 0`} for vectors. Translation becomes a matrix
  multiplication, and vectors are unaffected by it.
- **Composition:** with column vectors, the rightmost matrix acts first.
  Order changes the result and decides the center of rotation, as in
  ${tex`T(\mathbf p)R(\theta)T(-\mathbf p)`}.
- **3D transformations:** affine transformations use 4×4 matrices.
  Euler angles are convenient but lose a degree of freedom at gimbal
  lock.
- **Viewing:** the pipeline is object → world → view → clip → NDC →
  screen, and clipping happens before the perspective divide. The view
  matrix is the inverse of the camera's placement.
- **Projection:** perspective projection makes apparent size depend on
  depth through ${tex`w`}; orthographic projection does not. Together,
  ${tex`M_{\mathrm{projection}}M_{\mathrm{view}}M_{\mathrm{model}}`} is
  the MVP transform.
