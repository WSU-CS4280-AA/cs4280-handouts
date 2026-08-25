---
title: Module 01 · Math Foundations
toc: false
---

```js echo
import * as vec2 from "./components/vec2.js";
import * as vec3 from "./components/vec3.js";
import * as mat2 from "./components/mat2.js";
import {plane, drawArrow, drawPolygon, drawEllipse, 
  dragVectors, dragPoints} from "./components/vectorField.js";
import * as Inputs from "npm:@observablehq/inputs";
import {html} from "npm:htl";
```

# Module 01 · Math Foundations

This page runs in the browser, and its diagrams are live. Drag points and vector tips, or move sliders, to see the calculations and pictures update. As you read, change the inputs until each idea feels predictable rather than memorized. The helper functions used here are defined in [`components/vec2.js`](./components/vec2.js), [`vec3.js`](./components/vec3.js), and [`mat2.js`](./components/mat2.js).

## Points and vectors

A **point** identifies a location: for example, a vertex, light position, or camera position. A **vector** identifies a displacement: a direction and magnitude with no fixed location. The distinction matters because their geometric arithmetic differs:

- **point − point = vector**: the displacement from one location to another
- **point + vector = point**: a translated location
- ~~**point + point**: no standard geometric interpretation~~

Drag the two points below. The arrow is the vector ${tex`\mathbf v = B - A`}, recomputed as the points move.

```js echo
// TODO
```

```js echo
// TODO
```

```js echo
// TODO
```

**v** = (${AB.x.toFixed(2)}, ${AB.y.toFixed(2)}), with magnitude ‖**v**‖ = ${vec2.length(AB).toFixed(2)}. If both points move by the same displacement, **v** does not change: it depends only on the difference between the locations.

## Vector arithmetic

The vectors **a** and **b** below are drawn from the origin. Drag their tips. Their values carry through the sections on addition, magnitude, dot products, and 2D cross products.

```js echo
// TODO
```

```js echo
// TODO
```

Addition is component-wise. Geometrically, ${tex`\mathbf a + \mathbf b`} means “follow **a**, then follow a relocated copy of **b**.” Subtraction ${tex`\mathbf a - \mathbf b`} is the displacement from **b**’s tip to **a**’s tip. Scalar multiplication stretches a vector; a negative scalar also reverses its direction.

```js echo
const scaleK = view(Inputs.range([-2, 2], {value: 1.5, step: 0.1, label: "k (scalar for k·a)"}));
```

```js echo
// TODO
```

```js echo
// TODO
```

`a + b` = (${vSum.x.toFixed(2)}, ${vSum.y.toFixed(2)}) · `a − b` = (${vDiff.x.toFixed(2)}, ${vDiff.y.toFixed(2)}) · ${html`<code>${scaleK.toFixed(1)}·a</code>`} = (${vScaled.x.toFixed(2)}, ${vScaled.y.toFixed(2)})

### Magnitude and normalization

A vector’s **magnitude** is its Euclidean length. **Normalization** divides a nonzero vector by its magnitude, producing a unit vector with the same direction. Surface normals, light directions, and camera basis vectors are commonly normalized before use in graphics calculations.

```js echo
// TODO
```

```js echo
// TODO
```

‖**a**‖ = ${aLength.toFixed(3)}, and **â** = (${aHat.x.toFixed(3)}, ${aHat.y.toFixed(3)}), with ‖**â**‖ = ${vec2.length(aHat).toFixed(6)}. A zero vector has no direction and therefore cannot be normalized; avoid normalizing it in production code unless your vector utility defines an explicit fallback.

### The dot product

${tex.block`\mathbf{a}\cdot\mathbf{b} = a_xb_x + a_yb_y = \|\mathbf{a}\|\,\|\mathbf{b}\|\cos\theta`}

The dot product maps two vectors to one scalar. Its sign identifies their relative direction: positive for broadly similar directions, negative for broadly opposite directions, and zero for perpendicular vectors. This is why ${tex`\mathbf N \cdot \mathbf L`} appears in diffuse lighting, and why orientation tests often reduce to sign checks.

```js echo
// TODO
```

```js echo
// TODO
```

**a**·**b** = ${dotAB.toFixed(2)}, and the angle between them is ${angleABDeg.toFixed(1)}°. **${dotAB > 0 ? "The dot product is positive, so a and b point in broadly similar directions." : dotAB < 0 ? "The dot product is negative, so a and b point in broadly opposite directions." : "The dot product is zero, so a and b are perpendicular."}** The green arrow is the projection of **a** onto **b**: the component of **a** that lies along **b**’s direction.

### The cross product

In 2D, ${tex`\mathbf{a}\times\mathbf{b} = a_xb_y - a_yb_x`} is a scalar, not a vector. Its magnitude is the area of the parallelogram spanned by **a** and **b**. Its sign indicates whether rotating from **a** to **b** is counterclockwise (+) or clockwise (−), which supports winding-order and front-face tests in rasterization.

```js echo
// TODO
```

```js echo
// TODO
```

`a × b` = ${crossAB.toFixed(2)}. **b** is ${crossAB > 0 ? "counterclockwise" : crossAB < 0 ? "clockwise" : "collinear"} relative to **a**. The shaded parallelogram has area ${parallelogramArea.toFixed(2)}, and triangle ${tex`(0, \mathbf a, \mathbf b)`} has area ${(parallelogramArea / 2).toFixed(2)}.

### A 3D example: a tilted roof normal

In 3D, the cross product returns a vector perpendicular to both inputs. A triangle normal can be computed as ${tex`\mathbf N = (P_1-P_0)\times(P_2-P_0)`} and then normalized. The three roof corners below have fixed ${tex`(x,y)`} positions and adjustable heights.

```js echo
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
const roofNormal = vec3.triangleNormal(p0, p1, p2);
```

Normal = (${roofNormal[0].toFixed(2)}, ${roofNormal[1].toFixed(2)}, ${roofNormal[2].toFixed(2)}). When all three heights are 0, the normal is (0, 0, 1). Raising or lowering a corner tilts the normal, just as it would for a sloped surface.

### Checking vector identities

A small computational check can validate that the implementation preserves familiar algebraic identities.

```js echo
(() => {
  const va = {x: 2, y: -1};
  const vb = {x: -3, y: 4};
  const vc = {x: 1, y: 5};
  const checks = {
    "a·b === b·a (dot is commutative)": vec2.dot(va, vb) === vec2.dot(vb, va),
    "a×b === -(b×a) (cross is anticommutative)": Math.abs(vec2.cross(va, vb) + vec2.cross(vb, va)) < 1e-10,
    "a·(b+c) === a·b + a·c (dot distributes)":
      Math.abs(vec2.dot(va, vec2.add(vb, vc)) - (vec2.dot(va, vb) + vec2.dot(va, vc))) < 1e-10
  };
  return html`<pre>${Object.entries(checks).map(([k, v]) => `${v ? "✓" : "✗"}  ${k}`).join("\n")}</pre>`;
})()
```

## Matrices

Scaling, rotation, reflection, and shear are **linear transformations**. In 2D, each can be expressed as ${tex`\mathbf p' = M\mathbf p`} for a 2×2 matrix ${tex`M`}. Every linear transformation fixes the origin: ${tex`M\mathbf 0 = \mathbf 0`}.

```js echo
vec2.length(mat2.apply(mat2.scaling(5, -3), {x: 0, y: 0}))
```

Translation cannot be represented by a 2×2 linear transformation because translation moves the origin. Homogeneous coordinates, introduced in Week 3, extend the representation so translations can participate in the same matrix-composition framework.

The main payoff is composition: a sequence such as “scale, then rotate, then shear” can be represented by one matrix and applied efficiently to many vertices.

### Matrix–vector multiplication

${tex.block`M\mathbf v = \begin{bmatrix}m_{00}&m_{01}\\m_{10}&m_{11}\end{bmatrix}\begin{bmatrix}v_x\\v_y\end{bmatrix} = \begin{bmatrix}m_{00}v_x+m_{01}v_y\\m_{10}v_x+m_{11}v_y\end{bmatrix}`}

Each output component is the dot product of one matrix row with **v**. Set the entries of ${tex`M`}, then drag **v**. The same matrix is reused in the inverse example in the next section.

```js echo
const M = view(Inputs.form({
  m00: Inputs.range([-2, 2], {value: 1.4, step: 0.1, label: "m00"}),
  m01: Inputs.range([-2, 2], {value: -0.6, step: 0.1, label: "m01"}),
  m10: Inputs.range([-2, 2], {value: 0.5, step: 0.1, label: "m10"}),
  m11: Inputs.range([-2, 2], {value: 1.1, step: 0.1, label: "m11"})
}));
```

${tex.block`M = \begin{bmatrix}${M.m00.toFixed(2)} & ${M.m01.toFixed(2)}\\${M.m10.toFixed(2)} & ${M.m11.toFixed(2)}\end{bmatrix}`}

```js echo
// TODO
```

```js echo
// TODO
```

```js echo
// TODO
```

`Mv` = (${Mv.x.toFixed(2)}, ${Mv.y.toFixed(2)}). Try `m00 = m11 = 2, m01 = m10 = 0` for a uniform scale. Then try `m00 = m11 = 0, m01 = -1, m10 = 1` for a 90° counterclockwise rotation.

## Matrix–matrix multiplication and order

${tex.block`(AB)_{ij} = \sum_k A_{ik}B_{kj}`}

Each entry of ${tex`AB`} is the dot product of a row of ${tex`A`} with a column of ${tex`B`}. Applying ${tex`AB`} to a vector applies ${tex`B`} first and ${tex`A`} second: ${tex`AB\mathbf v = A(B\mathbf v)`}. Matrix multiplication is generally not commutative, so transformation order changes the result.

```js echo
const srForm = view(Inputs.form({
  sx: Inputs.range([0.3, 2.5], {value: 2, step: 0.1, label: "scale sx"}),
  sy: Inputs.range([0.3, 2.5], {value: 1, step: 0.1, label: "scale sy"}),
  thetaDeg: Inputs.range([0, 180], {value: 45, step: 1, label: "rotate θ (degrees)"})
}));
```

```js echo
// TODO
```

The unit square is transformed by **RS** (blue: scale, then rotate) and **SR** (orange: rotate, then scale). The gray outline is the original square.

```js echo
// TODO
```

`‖RS − SR‖` = ${orderDistance.toFixed(3)}. This Frobenius-distance value is zero precisely when the two matrices agree. Set `thetaDeg` to 0, or make the scale uniform by setting `sx = sy`, to see cases in which these particular transformations commute.

### Identity and inverse

The identity matrix **I** leaves vectors unchanged: ${tex`I\mathbf v = \mathbf v`}. An inverse matrix ${tex`M^{-1}`} undoes ${tex`M`}: ${tex`MM^{-1}=I`}. A 2×2 inverse exists exactly when `det(M) ≠ 0`.

${tex.block`M = \begin{bmatrix}${M.m00.toFixed(2)} & ${M.m01.toFixed(2)}\\${M.m10.toFixed(2)} & ${M.m11.toFixed(2)}\end{bmatrix}`}

```js echo
const det = mat2.determinant(M);
const isSingular = Math.abs(det) < 1e-6;
const Minv = isSingular ? null : mat2.invert(M);
const identityResidual = isSingular ? null : mat2.frobeniusDistance(mat2.multiply(M, Minv), mat2.identity());
```

`det(M)` = ${det.toFixed(3)} — ${isSingular ? "M is singular at the displayed precision. It collapses the plane into a lower-dimensional set, so no matrix can recover the lost information." : `M is invertible. ‖M·M⁻¹ − I‖ = ${identityResidual.toFixed(6)}, showing agreement with the identity up to floating-point error.`}

Experiment with matrices whose rows or columns are proportional, such as `m00 = 1, m01 = 2, m10 = 0.5, m11 = 1`. Their determinant is zero, so they collapse one direction and cannot be inverted.

### Orthonormal matrices

A matrix **Q** is **orthonormal** when its columns are unit vectors and are mutually perpendicular. Equivalently, ${tex`Q^TQ = I`}. Rotation matrices are orthonormal, which implies ${tex`R^{-1} = R^T`}.

```js echo
const orthoTheta = view(Inputs.range([0, 360], 
  {value: 40, step: 1, label: "rotation θ (degrees)"}));
```

```js echo
// TODO
```
${tex.block`Q = \begin{bmatrix}${R2.m00.toFixed(4)} & ${R.m01.toFixed(4)}\\${R2.m10.toFixed(4)} & ${R2.m11.toFixed(4)}\end{bmatrix}`}

${tex.block`Q^TQ = \begin{bmatrix}${QtQ.m00.toFixed(4)} & ${QtQ.m01.toFixed(4)}\\${QtQ.m10.toFixed(4)} & ${QtQ.m11.toFixed(4)}\end{bmatrix}`}

The result is the identity, up to floating-point rounding, for every rotation angle. Likewise, `‖R⁻¹ − Rᵀ‖` = ${inverseEqualsTranspose.toFixed(6)}. This transpose shortcut depends on orthonormality; it does not generally work for an arbitrary matrix such as **M** from §6.

### Linear transformations

Scale, rotation, reflection, and shear are common families of 2D linear maps. Scale stretches along coordinate axes; rotation turns vectors; reflection reverses orientation; and shear moves points parallel to one axis by an amount proportional to their coordinate on the other axis.

```js echo
const galleryForm = view(Inputs.form({
  sx: Inputs.range([0.2, 2.5], {value: 1.6, step: 0.1, label: "scale sx"}),
  sy: Inputs.range([0.2, 2.5], {value: 1, step: 0.1, label: "scale sy"}),
  thetaDeg: Inputs.range([0, 360], {value: 20, step: 1, label: "rotate θ (degrees)"}),
  hx: Inputs.range([-1.5, 1.5], {value: 0.4, step: 0.1, label: "shear hx"}),
  reflect: Inputs.toggle({label: "reflect across the y-axis first"})
}));
```

```js echo
const galleryScale = mat2.scaling(galleryForm.sx, galleryForm.sy);
const galleryRotate = mat2.rotation((galleryForm.thetaDeg * Math.PI) / 180);
const galleryShear = mat2.shear(galleryForm.hx, 0);
const galleryReflect = galleryForm.reflect ? mat2.reflectionY() : mat2.identity();
const galleryComposite = mat2.multiply(galleryRotate, mat2.multiply(galleryScale, mat2.multiply(galleryShear, galleryReflect)));
```

```js echo
(() => {
  const square = [{x: 0, y: 0}, {x: 1, y: 0}, {x: 1, y: 1}, {x: 0, y: 1}];
  const scene = plane({domain: 3});
  drawPolygon(scene, square, {stroke: "gray"});
  drawPolygon(scene, square.map((p) => mat2.apply(galleryComposite, p)), {stroke: "seagreen", fill: "seagreen", opacity: 0.15});
  return scene.svg.node();
})()
```

The gray square is unchanged. The green square undergoes reflection, shear, scale, and rotation, in that order. Toggle reflection and observe that the composite determinant changes sign, indicating a reversal of orientation.

```js echo
mat2.determinant(galleryComposite).toFixed(3)
```
### Singular value decomposition (conceptual)

Every real matrix can be factored as ${tex`M = U\Sigma V^T`}, where **U** and **V** are orthonormal and **Σ** is diagonal with nonnegative entries. Geometrically, this is a rotation or reflection by ${tex`V^T`}, scaling along perpendicular axes by the singular values in ${tex`\Sigma`}, then a rotation or reflection by ${tex`U`}.

A useful consequence is that ${tex`M`} maps the unit circle to an ellipse. The ellipse’s semiaxis lengths are the singular values, and its principal directions are the columns of **U**.

`mat2.svd` in [`mat2.js`](./components/mat2.js) computes this numerically by diagonalizing ${tex`M^TM`} to obtain **V** and the squared singular values, then recovering **U** from the action of ${tex`M`} on the right singular vectors.

```js echo
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
// TODO
```

```js echo
(() => {
  // TODO
})()
```

Singular values: σ₀ = ${sigma0.toFixed(3)}, σ₁ = ${sigma1.toFixed(3)}. The reconstruction residual `‖M − UΣVᵀ‖` is ${reconResidual.toExponential(2)}. Values near zero indicate that the decomposition reconstructs the input matrix to floating-point precision. Make the rows or columns proportional to observe one singular value approach zero and the ellipse collapse toward a line segment.

## Final Example: Rosette

A rotation matrix can be applied repeatedly to create evenly spaced copies of a shape. For ${tex`k`} petals and phase ${tex`\varphi`}, the angle of copy ${tex`i`} is

${tex.block`\theta_i = \varphi + \frac{2\pi i}{k}, \qquad i = 0, \dots, k-1`}

The petal below is a simple parametric polygon. Its right edge follows

${tex.block`x(t) = 4w\,t(1-t), \qquad y(t) = \ell t, \qquad t \in [0, 1]`}

The factor ${tex`t(1-t)`} is zero at the base and tip and reaches ${tex`\tfrac14`} at the midpoint. Multiplying it by ${tex`4w`} makes the maximum half-width exactly ${tex`w`}. The left edge mirrors the right edge.

<div style="position: relative;">

<div style="position: sticky; top: 12px; z-index: 2; background: var(--theme-background, #0d0d0d); padding-block: 8px 4px;">

```js echo
const rosetteForm = view(Inputs.form({
  petals: Inputs.range([1, 24], {value: 8, step: 1, label: "petal count k"}),
  length: Inputs.range([0.8, 2.6], {value: 2, step: 0.1, label: "petal length"}),
  width: Inputs.range([0.2, 1.2], {value: 0.55, step: 0.05, label: "petal half-width"}),
  phase: Inputs.range([0, 360], {value: 0, step: 1, label: "phase offset (degrees)"})
}));
```

</div>

```js echo
function petalOutline(length, width, steps = 24) {
  // TODO
}
```

```js echo
// TODO
```

```js echo
(() => {
  // TODO
})()
```

</div>

Every petal is generated from the same local coordinates; only its rotation angle differs. Changing `phase` rotates the full rosette rigidly, while changing `petals` recomputes the spacing as ${tex`2\pi/k`}. This same local-transform reuse is a foundation of hierarchical scene graphs.



## Summary

- Points represent locations; vectors represent displacements. Their allowed operations are different.
- Vector arithmetic includes addition, subtraction, scalar multiplication, magnitude, and normalization. Dot products express alignment and projection; 2D cross products express signed area and orientation.
- Matrices represent linear transformations. Their multiplication order matters, and singular matrices have no inverse.
- Orthonormal matrices preserve lengths and angles, so their inverse equals their transpose.
- Scale, rotation, reflection, and shear are fundamental linear maps. SVD describes every matrix as orthonormal transforms around axis-aligned scaling.


Happy learning!
