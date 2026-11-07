---
title: Module 01 — Math Foundations
toc: true
---

```js
import * as vec2 from "./components/vec2.js";
import * as vec3 from "./lib/math/vec3.js";
import * as mat2 from "./components/mat2.js";
import {plane, drawArrow, drawPolygon, drawEllipse, dragVectors, dragPoints} from "./components/vectorField.js";
import * as Inputs from "npm:@observablehq/inputs";
import {html} from "npm:htl";
```

# Module 01 · Math Foundations

Almost every computation in graphics is built from a small set of
mathematical objects. This module builds each one and makes it live:

| Object | What it represents |
|---|---|
| **Points and vectors** | Locations, and the displacements between them |
| **Dot and cross products** | Alignment, projection, signed area, and normals |
| **Matrices** | Linear transformations and their composition |
| **Linear transformations** | Scale, rotation, reflection, shear, and their decomposition by SVD |

Drag points and vector tips, or move sliders, to see the calculations and
pictures update. The code is part of the reading: every operation is written
out here as a short function and then tested. Matching versions, which later
modules build on, live in `components/vec2.js`, `lib/math/vec3.js`, and
`components/mat2.js`. Only the code that draws the pictures is left out of the
page. Everything here is plain JavaScript, so no GPU is needed. This handout
teaches the *techniques* behind the module; it is not a walkthrough of
any graded assignment.

## Points and Vectors

A **point** identifies a location: for example, a vertex, light position, or camera position. A **vector** identifies a displacement: a direction and magnitude with no fixed location. The distinction matters because their geometric arithmetic differs:

- **point − point = vector**: the displacement from one location to another
- **point + vector = point**: a translated location
- ~~**point + point**: no standard geometric interpretation~~

In code, we store both points and vectors as plain `{x, y}` objects, and it is up to us to use them correctly. Subtraction works one component at a time:

```js echo
function sub(p, q) {
  return {x: p.x - q.x, y: p.y - q.y};
}
```

For example, the displacement from (1, 1) to (4, 5) should be (3, 4):

```js echo
sub({x: 4, y: 5}, {x: 1, y: 1})
```

Drag the two points below. The arrow is the vector ${tex`\mathbf v = B - A`}, recomputed as the points move.

```js
const pointsABWidget = dragPoints(
  {A: {x: -2, y: -1}, B: {x: 2, y: 1.5}},
  {domain: 4}
);
const pointsAB = view(pointsABWidget);
```

```js echo
const {A, B} = pointsAB;
const AB = sub(B, A);
```

```js
{
pointsABWidget.redecorate((scene) => {
  drawArrow(scene, A, B, {color: "seagreen", label: "v = B − A"});
});
}
```

**v** = (${AB.x.toFixed(2)}, ${AB.y.toFixed(2)}), with magnitude ‖**v**‖ = ${magnitude(AB).toFixed(2)}. If both points move by the same displacement, **v** does not change: it depends only on the difference between the locations.

## Vector Arithmetic

The vectors **a** and **b** below are drawn from the origin. Drag their tips. Their values carry through the sections on addition, magnitude, dot products, and 2D cross products.

```js
const abVectorsWidget = dragVectors(
  {a: {x: 3, y: 1}, b: {x: 1, y: 2.2}},
  {colors: ["steelblue", "orangered"], domain: 6}
);
const abVectors = view(abVectorsWidget);
```

```js echo
const {a, b} = abVectors;
```

Addition is component-wise. Geometrically, ${tex`\mathbf a + \mathbf b`} means “follow **a**, then follow a relocated copy of **b**.” Subtraction ${tex`\mathbf a - \mathbf b`} is the displacement from **b**’s tip to **a**’s tip. Scalar multiplication stretches a vector; a negative scalar also reverses its direction. Addition and scaling work one component at a time, just like `sub`:

```js echo
function add(u, w) {
  return {x: u.x + w.x, y: u.y + w.y};
}
function scale(u, k) {
  return {x: u.x * k, y: u.y * k};
}
```

Now we can compute all three combinations from the current **a** and **b**. The slider sets the scalar ${tex`k`}:

```js
const scaleK = view(Inputs.range([-2, 2], {value: 1.5, step: 0.1, label: "k (scalar for k·a)"}));
```

```js echo
const vSum = add(a, b);
const vDiff = sub(a, b);
const vScaled = scale(a, scaleK);
```

```js
{
abVectorsWidget.redecorate((scene) => {
  drawArrow(scene, a, vSum, {color: "orangered", width: 1.5});
  drawArrow(scene, {x: 0, y: 0}, vSum, {color: "seagreen", label: "a + b"});
  drawArrow(scene, {x: 0, y: 0}, vDiff, {color: "purple", label: "a − b"});
  drawArrow(scene, {x: 0, y: 0}, vScaled, {color: "gray", label: "k·a"});
});
}
```

`a + b` = (${vSum.x.toFixed(2)}, ${vSum.y.toFixed(2)}) · `a − b` = (${vDiff.x.toFixed(2)}, ${vDiff.y.toFixed(2)}) · ${html`<code>${scaleK.toFixed(1)}·a</code>`} = (${vScaled.x.toFixed(2)}, ${vScaled.y.toFixed(2)})

### Magnitude and normalization

A vector’s **magnitude** is its Euclidean length. **Normalization** divides a nonzero vector by its magnitude, producing a unit vector with the same direction. Surface normals, light directions, and camera basis vectors are commonly normalized before use in graphics calculations.

The dot product, covered next, gives a compact way to write length, because ${tex`\mathbf u \cdot \mathbf u = u_x^2 + u_y^2`}, the sum of squares under the Pythagorean square root. `normalize` then scales by one over the length, refusing to divide by a length of zero:

```js echo
function magnitude(u) {
  return Math.sqrt(dot(u, u));
}
function normalize(u) {
  const len = magnitude(u);
  if (len < 1e-10) throw new Error("cannot normalize the zero vector");
  return scale(u, 1 / len);
}
```

Test it on a vector whose length is easy to check. (6, 8) has length 10, so the result should be (0.6, 0.8), give or take a tiny rounding error:

```js echo
normalize({x: 6, y: 8})
```

Here it is applied to the current **a**:

```js echo
const aLength = magnitude(a);
const aHat = normalize(a);
```

```js
(() => {
  const scene = plane({domain: 5});
  drawArrow(scene, {x: 0, y: 0}, a, {color: "steelblue", label: "a"});
  drawArrow(scene, {x: 0, y: 0}, aHat, {color: "seagreen", label: "â (unit length)"});
  return scene.svg.node();
})()
```

‖**a**‖ = ${aLength.toFixed(3)}, and **â** = (${aHat.x.toFixed(3)}, ${aHat.y.toFixed(3)}), with ‖**â**‖ = ${magnitude(aHat).toFixed(6)}. A zero vector has no direction and therefore cannot be normalized; avoid normalizing it in production code unless your vector utility defines an explicit fallback.

### The dot product

${tex.block`\mathbf{a}\cdot\mathbf{b} = a_xb_x + a_yb_y = \|\mathbf{a}\|\,\|\mathbf{b}\|\cos\theta`}

The dot product maps two vectors to one scalar. Its sign identifies their relative direction: positive for broadly similar directions, negative for broadly opposite directions, and zero for perpendicular vectors. This is why ${tex`\mathbf N \cdot \mathbf L`} appears in diffuse lighting, and why orientation tests often reduce to sign checks.

The first form of the formula is the one we compute:

```js echo
function dot(u, w) {
  return u.x * w.x + u.y * w.y;
}
```

Solving the second form for ${tex`\cos\theta`} gives the angle between two vectors. Rounding can push the ratio slightly past ±1, where `Math.acos` would return `NaN`, so we clamp it first:

```js echo
function angleBetween(u, w) {
  const cosTheta = dot(u, w) / (magnitude(u) * magnitude(w));
  return Math.acos(Math.max(-1, Math.min(1, cosTheta)));
}
```

The dot product also gives a **projection**: the part of **a** that lies along **b**. Its direction is **b**, and the scale factor ${tex`(\mathbf a \cdot \mathbf b)/(\mathbf b \cdot \mathbf b)`} is exactly what makes the leftover part of **a** perpendicular to **b**:

```js echo
const projectOnto = (u, w) => scale(w, dot(u, w) / dot(w, w));
```

Here are all three for the current **a** and **b**:

```js echo
const dotAB = dot(a, b);
const angleABDeg = (angleBetween(a, b) * 180) / Math.PI;
const projAonB = projectOnto(a, b);
```

```js
(() => {
  const scene = plane({domain: 5});
  drawArrow(scene, {x: 0, y: 0}, a, {color: "steelblue", label: "a"});
  drawArrow(scene, {x: 0, y: 0}, b, {color: "orangered", label: "b"});
  drawArrow(scene, {x: 0, y: 0}, projAonB, {color: "seagreen", label: "proj of a onto b"});
  scene.svg.append("line")
    .attr("x1", scene.x(a.x)).attr("y1", scene.y(a.y))
    .attr("x2", scene.x(projAonB.x)).attr("y2", scene.y(projAonB.y))
    .attr("stroke", "gray").attr("stroke-dasharray", "4,3");
  return scene.svg.node();
})()
```

**a**·**b** = ${dotAB.toFixed(2)}, and the angle between them is ${angleABDeg.toFixed(1)}°. **${dotAB > 0 ? "The dot product is positive, so a and b point in broadly similar directions." : dotAB < 0 ? "The dot product is negative, so a and b point in broadly opposite directions." : "The dot product is zero, so a and b are perpendicular."}** The green arrow is the projection of **a** onto **b**: the component of **a** that lies along **b**’s direction.

### The cross product

In 2D, ${tex`\mathbf{a}\times\mathbf{b} = a_xb_y - a_yb_x`} is a scalar, not a vector. Its magnitude is the area of the parallelogram spanned by **a** and **b**. Its sign indicates whether rotating from **a** to **b** is counterclockwise (+) or clockwise (−), which supports winding-order and front-face tests in rasterization.

```js echo
function cross(u, w) {
  return u.x * w.y - u.y * w.x;
}
```

The sign gives the orientation, and the absolute value gives the area:

```js echo
const crossAB = cross(a, b);
const parallelogramArea = Math.abs(crossAB);
```

```js
(() => {
  const scene = plane({domain: 6});
  drawPolygon(scene, [{x: 0, y: 0}, a, vec2.add(a, b), b], {stroke: "seagreen", fill: "seagreen", opacity: 0.15});
  drawArrow(scene, {x: 0, y: 0}, a, {color: "steelblue", label: "a"});
  drawArrow(scene, {x: 0, y: 0}, b, {color: "orangered", label: "b"});
  return scene.svg.node();
})()
```

`a × b` = ${crossAB.toFixed(2)}. **b** is ${crossAB > 0 ? "counterclockwise" : crossAB < 0 ? "clockwise" : "collinear"} relative to **a**. The shaded parallelogram has area ${parallelogramArea.toFixed(2)}, and triangle ${tex`(0, \mathbf a, \mathbf b)`} has area ${(parallelogramArea / 2).toFixed(2)}.

### A 3D example: a tilted roof normal

In 3D, the cross product returns a vector perpendicular to both inputs. A triangle normal can be computed as ${tex`\mathbf N = (P_1-P_0)\times(P_2-P_0)`} and then normalized. Module-wide, 3D vectors are stored as arrays `[x, y, z]`, the form WebGPU will need later. Each component of the 3D cross product leaves out one axis:

```js echo
const cross3 = (u, w) => [
  u[1] * w[2] - u[2] * w[1],
  u[2] * w[0] - u[0] * w[2],
  u[0] * w[1] - u[1] * w[0]
];
```

Two edges of the triangle go in, and the result is normalized. `vec3.sub` and `vec3.normalize` work like their 2D versions:

```js echo
const triangleNormal = (p0, p1, p2) =>
  vec3.normalize(cross3(vec3.sub(p1, p0), vec3.sub(p2, p0)));
```

The three roof corners below have fixed ${tex`(x,y)`} positions and adjustable heights.

```js
const roofHeights = view(Inputs.form({
  z0: Inputs.range([-1, 1], {value: 0, step: 0.05, label: "height at (0, 0)"}),
  z1: Inputs.range([-1, 1], {value: 0, step: 0.05, label: "height at (2, 0)"}),
  z2: Inputs.range([-1, 1], {value: 0, step: 0.05, label: "height at (0, 2)"})
}));
```

```js echo
const p0 = [0, 0, roofHeights.z0];
const p1 = [2, 0, roofHeights.z1];
const p2 = [0, 2, roofHeights.z2];
const roofNormal = triangleNormal(p0, p1, p2);
```

Normal = (${roofNormal[0].toFixed(2)}, ${roofNormal[1].toFixed(2)}, ${roofNormal[2].toFixed(2)}). When all three heights are 0, the normal is (0, 0, 1). Raising or lowering a corner tilts the normal, just as it would for a sloped surface.

### Checking vector identities

A small computational check can validate that the implementation preserves familiar algebraic identities. We will use three fixed vectors:

```js echo
const va = {x: 2, y: -1}, vb = {x: -3, y: 4}, vc = {x: 1, y: 5};
```

The dot product is commutative, so this should be `true`:

```js echo
dot(va, vb) === dot(vb, va)
```

The cross product is anticommutative: swapping its inputs flips the sign. Adding the two results should therefore give 0:

```js echo
cross(va, vb) + cross(vb, va)
```

The dot product distributes over addition, so this difference should also be 0:

```js echo
dot(va, add(vb, vc)) - (dot(va, vb) + dot(va, vc))
```

These inputs happen to give exact results. In general, floating-point rounding can leave a tiny nonzero value, so robust code compares against a small tolerance rather than using `===`.

## Matrices

Scaling, rotation, reflection, and shear are **linear transformations**. In 2D, each can be expressed as ${tex`\mathbf p' = M\mathbf p`} for a 2×2 matrix ${tex`M`}. Every linear transformation fixes the origin: ${tex`M\mathbf 0 = \mathbf 0`}.

We store a 2×2 matrix as a plain object whose fields are named by row and column, so `m01` is row 0, column 1. For example, a scaling matrix has its factors on the diagonal:

```js echo
const scaling = (sx, sy) => ({m00: sx, m01: 0, m10: 0, m11: sy});
```

The next section derives matrix–vector multiplication, written here as `applyMatrix`. Whatever the matrix, the origin should stay put, so this length should be 0:

```js echo
magnitude(applyMatrix(scaling(5, -3), {x: 0, y: 0}))
```

Translation cannot be represented by a 2×2 linear transformation because translation moves the origin. Homogeneous coordinates, introduced in Module 03, extend the representation so translations can participate in the same matrix-composition framework.

The main payoff is composition: a sequence such as “scale, then rotate, then shear” can be represented by one matrix and applied efficiently to many vertices.

### Matrix–vector multiplication

${tex.block`M\mathbf v = \begin{bmatrix}m_{00}&m_{01}\\m_{10}&m_{11}\end{bmatrix}\begin{bmatrix}v_x\\v_y\end{bmatrix} = \begin{bmatrix}m_{00}v_x+m_{01}v_y\\m_{10}v_x+m_{11}v_y\end{bmatrix}`}

Each output component is the dot product of one matrix row with **v**, and the code follows the formula directly:

```js echo
function applyMatrix(m, u) {
  return {
    x: m.m00 * u.x + m.m01 * u.y,
    y: m.m10 * u.x + m.m11 * u.y
  };
}
```

Set the entries of ${tex`M`}, then drag **v**. The same matrix is reused in the inverse example in the next section.

```js
const M = view(Inputs.form({
  m00: Inputs.range([-2, 2], {value: 1.4, step: 0.1, label: "m00"}),
  m01: Inputs.range([-2, 2], {value: -0.6, step: 0.1, label: "m01"}),
  m10: Inputs.range([-2, 2], {value: 0.5, step: 0.1, label: "m10"}),
  m11: Inputs.range([-2, 2], {value: 1.1, step: 0.1, label: "m11"})
}));
```

${tex.block`M = \begin{bmatrix}${M.m00.toFixed(2)} & ${M.m01.toFixed(2)}\\${M.m10.toFixed(2)} & ${M.m11.toFixed(2)}\end{bmatrix}`}

```js
const vInputWidget = dragVectors({v: {x: 1.5, y: 1}}, {colors: ["seagreen"], domain: 4});
const vInput = view(vInputWidget);
```

```js echo
const {v} = vInput;
const Mv = applyMatrix(M, v);
```

```js
{
vInputWidget.redecorate((scene) => {
  drawArrow(scene, {x: 0, y: 0}, Mv, {color: "purple", label: "Mv"});
});
}
```

`Mv` = (${Mv.x.toFixed(2)}, ${Mv.y.toFixed(2)}). Try `m00 = m11 = 2, m01 = m10 = 0` for a uniform scale. Then try `m00 = m11 = 0, m01 = -1, m10 = 1` for a 90° counterclockwise rotation.

### Matrix–matrix multiplication and order

${tex.block`(AB)_{ij} = \sum_k A_{ik}B_{kj}`}

Each entry of ${tex`AB`} is the dot product of a row of ${tex`A`} with a column of ${tex`B`}. Applying ${tex`AB`} to a vector applies ${tex`B`} first and ${tex`A`} second: ${tex`AB\mathbf v = A(B\mathbf v)`}. Matrix multiplication is generally not commutative, so transformation order changes the result.

Each of the four results below is one row of the left matrix dotted with one column of the right matrix:

```js echo
function multiplyMatrices(p, q) {
  return {
    m00: p.m00 * q.m00 + p.m01 * q.m10,
    m01: p.m00 * q.m01 + p.m01 * q.m11,
    m10: p.m10 * q.m00 + p.m11 * q.m10,
    m11: p.m10 * q.m01 + p.m11 * q.m11
  };
}
```

To test order, we also need a rotation. The columns of a rotation matrix are where the two axes land:

```js echo
function rotation(theta) {
  const c = Math.cos(theta), s = Math.sin(theta);
  return {m00: c, m01: -s, m10: s, m11: c};
}
```

Now build both orders from the sliders. `mat2.frobeniusDistance` measures how far apart two matrices are, as the square root of the summed squared differences of their entries:

```js
const srForm = view(Inputs.form({
  sx: Inputs.range([0.3, 2.5], {value: 2, step: 0.1, label: "scale sx"}),
  sy: Inputs.range([0.3, 2.5], {value: 1, step: 0.1, label: "scale sy"}),
  thetaDeg: Inputs.range([0, 180], {value: 45, step: 1, label: "rotate θ (degrees)"})
}));
```

```js echo
const S = scaling(srForm.sx, srForm.sy);
const R = rotation((srForm.thetaDeg * Math.PI) / 180);
const RS = multiplyMatrices(R, S); // scale first, then rotate
const SR = multiplyMatrices(S, R); // rotate first, then scale
const orderDistance = mat2.frobeniusDistance(RS, SR);
```

The unit square is transformed by **RS** (blue: scale, then rotate) and **SR** (orange: rotate, then scale). The gray outline is the original square.

```js
(() => {
  const square = [{x: 0, y: 0}, {x: 1, y: 0}, {x: 1, y: 1}, {x: 0, y: 1}];
  const scene = plane({domain: 3});
  drawPolygon(scene, square, {stroke: "gray"});
  drawPolygon(scene, square.map((p) => applyMatrix(RS, p)), {stroke: "steelblue"});
  drawPolygon(scene, square.map((p) => applyMatrix(SR, p)), {stroke: "orangered"});
  return scene.svg.node();
})()
```

`‖RS − SR‖` = ${orderDistance.toFixed(3)}. This Frobenius-distance value is zero precisely when the two matrices agree. Set `thetaDeg` to 0, or make the scale uniform by setting `sx = sy`, to see cases in which these particular transformations commute.

### Identity and inverse

The identity matrix **I** leaves vectors unchanged: ${tex`I\mathbf v = \mathbf v`}. An inverse matrix ${tex`M^{-1}`} undoes ${tex`M`}: ${tex`MM^{-1}=I`}. A 2×2 inverse exists exactly when `det(M) ≠ 0`, because the formula for the inverse divides by the determinant:

```js echo
const determinant = (m) => m.m00 * m.m11 - m.m01 * m.m10;
function invertMatrix(m) {
  const k = 1 / determinant(m);
  return {m00: m.m11 * k, m01: -m.m01 * k, m10: -m.m10 * k, m11: m.m00 * k};
}
```

Test it on a scaling by 2 and 4, whose inverse should scale by 0.5 and 0.25. JavaScript prints the negated zeros off the diagonal as `-0`, which equals 0:

```js echo
invertMatrix(scaling(2, 4))
```

Now apply it to the matrix **M** from the sliders in the previous section:

${tex.block`M = \begin{bmatrix}${M.m00.toFixed(2)} & ${M.m01.toFixed(2)}\\${M.m10.toFixed(2)} & ${M.m11.toFixed(2)}\end{bmatrix}`}

```js echo
const det = determinant(M);
const isSingular = Math.abs(det) < 1e-6;
const Minv = isSingular ? null : invertMatrix(M);
const identityResidual = isSingular ? null :
  mat2.frobeniusDistance(multiplyMatrices(M, Minv), mat2.identity());
```

`det(M)` = ${det.toFixed(3)}. ${isSingular ? "M is singular at the displayed precision. It collapses the plane into a lower-dimensional set, so no matrix can recover the lost information." : `M is invertible. ‖M·M⁻¹ − I‖ = ${identityResidual.toFixed(6)}, showing agreement with the identity up to floating-point error.`}

Experiment with matrices whose rows or columns are proportional, such as `m00 = 1, m01 = 2, m10 = 0.5, m11 = 1`. Their determinant is zero, so they collapse one direction and cannot be inverted.

### Orthonormal matrices

A matrix **Q** is **orthonormal** when its columns are unit vectors and are mutually perpendicular. Equivalently, ${tex`Q^TQ = I`}. Rotation matrices are orthonormal, which implies ${tex`R^{-1} = R^T`}. The transpose just swaps rows and columns:

```js echo
const transpose = (m) => ({m00: m.m00, m01: m.m10, m10: m.m01, m11: m.m11});
```

We compute ${tex`Q^TQ`} for a rotation chosen by the slider, along with the distance between its true inverse and its transpose:

```js
const orthoTheta = view(Inputs.range([0, 360], 
  {value: 40, step: 1, label: "rotation θ (degrees)"}));
```

```js echo
const R2 = rotation((orthoTheta * Math.PI) / 180);
const QtQ = multiplyMatrices(transpose(R2), R2);
const inverseEqualsTranspose =
  mat2.frobeniusDistance(invertMatrix(R2), transpose(R2));
```

${tex.block`Q = \begin{bmatrix}${R2.m00.toFixed(4)} & ${R2.m01.toFixed(4)}\\${R2.m10.toFixed(4)} & ${R2.m11.toFixed(4)}\end{bmatrix}`}

${tex.block`Q^TQ = \begin{bmatrix}${QtQ.m00.toFixed(4)} & ${QtQ.m01.toFixed(4)}\\${QtQ.m10.toFixed(4)} & ${QtQ.m11.toFixed(4)}\end{bmatrix}`}

The result is the identity, up to floating-point rounding, for every rotation angle. Likewise, `‖R⁻¹ − Rᵀ‖` = ${inverseEqualsTranspose.toFixed(6)}. This transpose shortcut depends on orthonormality; it does not generally work for an arbitrary matrix such as **M** from the matrix–vector section.

## Linear Transformations

### A gallery of linear maps

Scale, rotation, reflection, and shear are common families of 2D linear maps. Scale stretches along coordinate axes; rotation turns vectors; reflection reverses orientation; and shear moves points parallel to one axis by an amount proportional to their coordinate on the other axis. We already have `scaling` and `rotation`. Here are the other two:

```js echo
const reflectionY = () => ({m00: -1, m01: 0, m10: 0, m11: 1});   // flips x
const shear = (hx, hy) => ({m00: 1, m01: hx, m10: hy, m11: 1});
```

The composite below multiplies four matrices from left to right. The rightmost one, the reflection, acts on the shape first:

```js
const galleryForm = view(Inputs.form({
  sx: Inputs.range([0.2, 2.5], {value: 1.6, step: 0.1, label: "scale sx"}),
  sy: Inputs.range([0.2, 2.5], {value: 1, step: 0.1, label: "scale sy"}),
  thetaDeg: Inputs.range([0, 360], {value: 20, step: 1, label: "rotate θ (degrees)"}),
  hx: Inputs.range([-1.5, 1.5], {value: 0.4, step: 0.1, label: "shear hx"}),
  reflect: Inputs.toggle({label: "reflect across the y-axis first"})
}));
```

```js echo
const galleryScale = scaling(galleryForm.sx, galleryForm.sy);
const galleryRotate = rotation((galleryForm.thetaDeg * Math.PI) / 180);
const galleryShear = shear(galleryForm.hx, 0);
const galleryReflect = galleryForm.reflect ? reflectionY() : mat2.identity();
const galleryComposite = [galleryRotate, galleryScale, galleryShear,
  galleryReflect].reduce(multiplyMatrices);
```

```js
(() => {
  const square = [{x: 0, y: 0}, {x: 1, y: 0}, {x: 1, y: 1}, {x: 0, y: 1}];
  const scene = plane({domain: 3});
  drawPolygon(scene, square, {stroke: "gray"});
  drawPolygon(scene, square.map((p) => applyMatrix(galleryComposite, p)), {stroke: "seagreen", fill: "seagreen", opacity: 0.15});
  return scene.svg.node();
})()
```

The gray square is unchanged. The green square undergoes reflection, shear, scale, and rotation, in that order. Toggle reflection and observe that the composite determinant changes sign, indicating a reversal of orientation.

```js echo
determinant(galleryComposite).toFixed(3)
```

### Singular value decomposition (conceptual)

Every real matrix can be factored as ${tex`M = U\Sigma V^T`}, where **U** and **V** are orthonormal and **Σ** is diagonal with nonnegative entries. Geometrically, this is a rotation or reflection by ${tex`V^T`}, scaling along perpendicular axes by the singular values in ${tex`\Sigma`}, then a rotation or reflection by ${tex`U`}.

A useful consequence is that ${tex`M`} maps the unit circle to an ellipse. The ellipse’s semiaxis lengths are the singular values, and its principal directions are the columns of **U**.

`mat2.svd` in `mat2.js` computes this numerically by diagonalizing ${tex`M^TM`} to obtain **V** and the squared singular values, then recovering **U** from the action of ${tex`M`} on the right singular vectors. We call it as a library function, since the numerical steps are not the point here.

After setting a matrix with the sliders, we factor it and multiply the factors back together. If the decomposition is right, `reconstructed` should match the original:

```js
const svdForm = view(Inputs.form({
  a: Inputs.range([-2, 2], {value: 2, step: 0.1, label: "m00"}),
  b: Inputs.range([-2, 2], {value: 1, step: 0.1, label: "m01"}),
  c: Inputs.range([-2, 2], {value: 0.5, step: 0.1, label: "m10"}),
  d: Inputs.range([-2, 2], {value: 1.2, step: 0.1, label: "m11"})
}));
```

```js echo
const M2 = {m00: svdForm.a, m01: svdForm.b, m10: svdForm.c, m11: svdForm.d};
```

${tex.block`M = \begin{bmatrix}${M2.m00.toFixed(2)} & ${M2.m01.toFixed(2)}\\${M2.m10.toFixed(2)} & ${M2.m11.toFixed(2)}\end{bmatrix}`}

```js echo
const {U, singularValues, V} = mat2.svd(M2);
const [sigma0, sigma1] = singularValues;
const Sigma = {m00: sigma0, m01: 0, m10: 0, m11: sigma1};
const reconstructed =
  multiplyMatrices(multiplyMatrices(U, Sigma), transpose(V));
const reconResidual = mat2.frobeniusDistance(M2, reconstructed);
```

```js
(() => {
  const [u0, u1] = mat2.columns(U);
  const axisAngle = Math.atan2(u0.y, u0.x);
  const scene = plane({domain: 3});
  drawEllipse(scene, {rx: 1, ry: 1, stroke: "gray"});
  drawEllipse(scene, {rx: sigma0, ry: sigma1, rotation: axisAngle, stroke: "seagreen"});
  drawArrow(scene, {x: 0, y: 0}, vec2.scale(u0, sigma0), {color: "steelblue", label: "σ₀·u₀"});
  drawArrow(scene, {x: 0, y: 0}, vec2.scale(u1, sigma1), {color: "orangered", label: "σ₁·u₁"});
  return scene.svg.node();
})()
```

Singular values: σ₀ = ${sigma0.toFixed(3)}, σ₁ = ${sigma1.toFixed(3)}. The reconstruction residual `‖M − UΣVᵀ‖` is ${reconResidual.toExponential(2)}. Values near zero indicate that the decomposition reconstructs the input matrix to floating-point precision. Make the rows or columns proportional to observe one singular value approach zero and the ellipse collapse toward a line segment.

### Rosettes: repeated rotation

A rotation matrix can be applied repeatedly to create evenly spaced copies of a shape. For ${tex`k`} petals and phase ${tex`\varphi`}, the angle of copy ${tex`i`} is

${tex.block`\theta_i = \varphi + \frac{2\pi i}{k}, \qquad i = 0, \dots, k-1`}

The petal below is a simple parametric polygon. Its right edge follows

${tex.block`x(t) = 4w\,t(1-t), \qquad y(t) = \ell t, \qquad t \in [0, 1]`}

The factor ${tex`t(1-t)`} is zero at the base and tip and reaches ${tex`\tfrac14`} at the midpoint. Multiplying it by ${tex`4w`} makes the maximum half-width exactly ${tex`w`}. The left edge mirrors the right edge. In code, we compute the right edge from ${tex`t = 0`} to 1, then walk back down its mirror image to close the outline:

```js echo
function petalOutline(length, width, steps = 24) {
  const edge = d3.range(steps + 1).map((i) => {
    const t = i / steps;
    return {x: width * 4 * t * (1 - t), y: length * t};
  });
  const mirrored = edge.map((p) => ({x: -p.x, y: p.y})).reverse();
  return [...edge, ...mirrored];
}
```

Each petal is that one outline, rotated by its own ${tex`\theta_i`}:

```js echo
const basePetal = petalOutline(rosetteForm.length, rosetteForm.width);
const rosettePetals = d3.range(rosetteForm.petals).map((i) => {
  const phase = (rosetteForm.phase * Math.PI) / 180;
  const Rpetal = rotation(phase + (i * 2 * Math.PI) / rosetteForm.petals);
  return basePetal.map((p) => applyMatrix(Rpetal, p));
});
```

```js
const rosetteForm = view(Inputs.form({
  petals: Inputs.range([1, 24], {value: 8, step: 1, label: "petal count k"}),
  length: Inputs.range([0.8, 2.6], {value: 2, step: 0.1, label: "petal length"}),
  width: Inputs.range([0.2, 1.2], {value: 0.55, step: 0.05, label: "petal half-width"}),
  phase: Inputs.range([0, 360], {value: 0, step: 1, label: "phase offset (degrees)"})
}));
```

```js
(() => {
  const scene = plane({domain: 3});
  rosettePetals.forEach((petal, i) => {
    const hue = Math.round((360 * i) / rosetteForm.petals);
    drawPolygon(scene, petal, {stroke: `hsl(${hue}, 60%, 45%)`, fill: `hsl(${hue}, 70%, 60%)`, opacity: 0.55});
  });
  return scene.svg.node();
})()
```

Every petal is generated from the same local coordinates; only its rotation angle differs. Changing `phase` rotates the full rosette rigidly, while changing `petals` recomputes the spacing as ${tex`2\pi/k`}. This same local-transform reuse is a foundation of hierarchical scene graphs.

## Check Your Understanding

1. For points ${tex`P, Q`} and a vector ${tex`\mathbf v`}, which of ${tex`P - Q`}, ${tex`P + \mathbf v`}, and ${tex`P + Q`} have a geometric meaning, and what kind of object is each?
2. Normalize ${tex`(3, 4)`}.
3. Compute ${tex`\mathbf a \cdot \mathbf b`} for ${tex`\mathbf a = (2, -1)`} and ${tex`\mathbf b = (1, 2)`}. What does the result say about the two vectors?
4. Compute the 2D cross product ${tex`\mathbf a \times \mathbf b`} for ${tex`\mathbf a = (2, 0)`} and ${tex`\mathbf b = (1, 3)`}. Is **b** clockwise or counterclockwise from **a**, and what is the area of triangle ${tex`(0, \mathbf a, \mathbf b)`}?
5. A triangle has vertices ${tex`P_0 = (0,0,0)`}, ${tex`P_1 = (1,0,0)`}, ${tex`P_2 = (0,1,0)`}. What is ${tex`(P_1-P_0)\times(P_2-P_0)`}? What changes if the vertices are listed as ${tex`P_0, P_2, P_1`}?
6. Why can no 2×2 matrix translate the plane?
7. In ${tex`RS\mathbf v`}, which transformation acts on ${tex`\mathbf v`} first?
8. Is ${tex`\begin{bmatrix}1&2\\2&4\end{bmatrix}`} invertible? What does it do to the plane?
9. What is the inverse of a rotation by 30°, and how can you get it without inverting a matrix?
10. What is the determinant of a reflection across the y-axis? What does a negative determinant say about a composite transformation?
11. What are the singular values of ${tex`\begin{bmatrix}3&0\\0&-2\end{bmatrix}`}?
12. A rosette has ${tex`k = 8`} petals. What angle separates neighboring petals?

<details>
<summary>Answers</summary>

1. ${tex`P - Q`} is a vector, the displacement from ${tex`Q`} to ${tex`P`}. ${tex`P + \mathbf v`} is a point. ${tex`P + Q`} has no geometric meaning on its own.
2. (${vec2.normalize({x: 3, y: 4}).x.toFixed(1)}, ${vec2.normalize({x: 3, y: 4}).y.toFixed(1)}), since the length is 5.
3. ${vec2.dot({x: 2, y: -1}, {x: 1, y: 2})}, so the vectors are perpendicular.
4. ${vec2.cross({x: 2, y: 0}, {x: 1, y: 3})}. The value is positive, so **b** is counterclockwise from **a**. The triangle's area is half of that, ${vec2.cross({x: 2, y: 0}, {x: 1, y: 3}) / 2}.
5. (${vec3.triangleNormal([0, 0, 0], [1, 0, 0], [0, 1, 0]).join(", ")}) before normalizing. Swapping two vertices reverses the cross product, so the normal becomes (0, 0, −1). Vertex order decides which way a normal points.
6. Every linear map fixes the origin: ${tex`M\mathbf 0 = \mathbf 0`}. A translation moves the origin, so it is not linear.
7. ${tex`S`}. With column vectors, the matrix closest to the vector acts first.
8. No. Its determinant is ${mat2.determinant({m00: 1, m01: 2, m10: 2, m11: 4})}, because the second row is twice the first. It collapses the whole plane onto a line, so the lost information cannot be recovered.
9. A rotation by −30°. Rotation matrices are orthonormal, so the inverse is the transpose.
10. ${mat2.determinant(mat2.reflectionY())}. A composite with a negative determinant reverses orientation, so counterclockwise shapes come out clockwise.
11. ${mat2.svd({m00: 3, m01: 0, m10: 0, m11: -2}).singularValues.map((s) => +s.toFixed(6)).join(" and ")}. Singular values are never negative; the sign goes into ${tex`U`} or ${tex`V`}.
12. ${tex`2\pi/8`}, or 45°.

</details>

## Common Pitfalls

- **Treating points and vectors the same.** Adding two points has no
  meaning, and in Module 03 a direction must not be translated the way a
  position is.
- **Normalizing a zero vector.** Dividing by a zero length produces `NaN`
  values that spread through every later calculation.
- **Reading the dot product as a cosine without normalizing.**
  ${tex`\mathbf a \cdot \mathbf b = \cos\theta`} only when both vectors
  have unit length; otherwise only the sign is directly meaningful.
- **Swapping cross-product operands.** ${tex`\mathbf a \times \mathbf b = -(\mathbf b \times \mathbf a)`},
  so the wrong order flips a normal or a winding test.
- **Multiplying matrices in the wrong order.** With column vectors, the
  rightmost matrix acts first: ${tex`RS`} scales, then rotates.
- **Testing a determinant with `=== 0`.** Floating-point error rarely
  produces exactly zero. Compare ${tex`|\det M|`} against a small tolerance.
- **Using the transpose as the inverse of any matrix.** The shortcut
  ${tex`M^{-1} = M^T`} holds only for orthonormal matrices.
- **Mixing degrees and radians.** `Math.cos` and `Math.sin` take radians;
  convert slider angles with ${tex`\pi/180`}.

## Summary

- **Points and vectors:** points are locations and vectors are
  displacements. Point − point is a vector and point + vector is a point,
  but point + point has no meaning.
- **Vector arithmetic:** addition, subtraction, scaling, magnitude, and
  normalization. The dot product measures alignment and gives
  projections; the 2D cross product gives signed area and orientation,
  and the 3D cross product gives triangle normals.
- **Matrices:** a 2×2 matrix represents a linear transformation, which
  always fixes the origin. Matrix products compose transformations, the
  order matters, and a matrix with zero determinant has no inverse.
- **Orthonormal matrices:** they preserve lengths and angles, so their
  inverse is their transpose.
- **Linear transformations:** scale, rotation, reflection, and shear are
  the basic 2D maps. SVD writes every matrix as a rotation or reflection,
  an axis-aligned scale, and another rotation or reflection. Repeated
  rotation of one local shape builds a rosette.
