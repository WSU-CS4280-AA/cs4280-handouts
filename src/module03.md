---
title: Module 03 — Transformations and Viewing
toc: true
---

```js echo
import * as vec2 from "./components/vec2.js";
import * as mat2 from "./components/mat2.js";
import * as mat3 from "./components/mat3.js";
import * as mat4 from "./components/mat4.js";
import * as wireframe from "./components/wireframe.js";
import {plane, drawArrow, drawPoint, drawPolygon, dragVectors, dragPoints} from "./components/vectorField.js";
import * as Inputs from "npm:@observablehq/inputs";
import {html} from "npm:htl";
```

# Module 03 · Transformations and Viewing

Week 1 introduced linear transformations—scaling, rotation, reflection, and shear. Each of those transformations fixes the origin. This module removes that restriction: **homogeneous coordinates** let translation use the same matrix-multiplication framework as the other transformations.

That one extension supports the rest of the graphics pipeline. We will compose object transforms, express the scene relative to a camera, and project 3D geometry onto a 2D screen. This module focuses on the mathematics and conventions behind those operations; Week 4 applies the same ideas in WebGPU.

## 1. Why Translation Is Different

An **affine transformation** has the form ${tex`\mathbf{p}' = A\mathbf{p} + \mathbf{t}`}, where ${tex`A`} is the linear part and ${tex`\mathbf{t}`} is a translation vector. Affine transformations preserve straight lines, parallelism, and ratios along a line.

The issue is that ${tex`\mathbf{t}`} is added rather than multiplied. A linear transformation must map the origin to itself:

```js echo
mat2.apply(mat2.scaling(3, 3), {x: 0, y: 0})
```

The result is still ${tex`(0,0)`}. No ordinary 2×2 matrix can map the origin to a nonzero location, so translation is not linear. Homogeneous coordinates incorporate that added offset into a larger matrix.

## 2. Homogeneous Coordinates

Represent a 2D point as ${tex`(x,y,1)`} and a 2D displacement vector as ${tex`(x,y,0)`}. The final coordinate, ${tex`w`}, distinguishes the two cases.

For a translation,

${tex.block`T(t_x,t_y)=\begin{bmatrix}1&0&t_x\\0&1&t_y\\0&0&1\end{bmatrix}`}

multiplying a point produces ${tex`(x+t_x,y+t_y,1)`}, while multiplying a vector produces ${tex`(x,y,0)`}. In other words, translation changes locations but does not change displacements, directions, or velocities.

Drag point **P** and vector **V**, then adjust the translation. The point moves; the vector does not.

```js echo
const translateForm = view(Inputs.form({
  tx: Inputs.range([-3, 3], {value: 2, step: 0.1, label: "tx"}),
  ty: Inputs.range([-3, 3], {value: 1, step: 0.1, label: "ty"})
}));
```

```js echo
const T = mat3.translation(translateForm.tx, translateForm.ty);
```

```js echo
const pointInput = view(dragPoints(
  {P: {x: -2, y: -1.5}},
  {colors: ["steelblue"], domain: 4}
));
```

```js echo
const vectorInput = view(dragVectors(
  {V: {x: -2, y: -1.5}},
  {colors: ["seagreen"], domain: 4}
));
```

```js echo
const P = pointInput.P;
const Pprime = mat3.transformPoint(T, P);
const V = vectorInput.V;
const Vprime = mat3.transformVector(T, V);
```

```js echo
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

## 3. Composition in 2D

With homogeneous coordinates, every 2D affine transformation is a 3×3 matrix:

${tex.block`T(t_x,t_y)=\begin{bmatrix}1&0&t_x\\0&1&t_y\\0&0&1\end{bmatrix}\qquad S(s_x,s_y)=\begin{bmatrix}s_x&0&0\\0&s_y&0\\0&0&1\end{bmatrix}\qquad R(\theta)=\begin{bmatrix}\cos\theta&-\sin\theta&0\\\sin\theta&\cos\theta&0\\0&0&1\end{bmatrix}`}

Assume column vectors, as in this module. In a product ${tex`M_3M_2M_1\mathbf{p}`}, the rightmost transformation acts first. This convention is essential for reading composed transforms correctly.

### Rotate about a pivot

To rotate an object about a pivot ${tex`\mathbf{p}`} that is not the origin:

1. Translate the pivot to the origin.
2. Rotate about the origin.
3. Translate back.

Thus,

${tex.block`M = T(\mathbf{p})\,R(\theta)\,T(-\mathbf{p})`}

The order shown is the matrix-product order; when applied to a column vector, ${tex`T(-\mathbf{p})`} acts first.

```js echo
const pivotInputWidget = dragPoints(
  {pivot: {x: 1.5, y: 0.5}},
  {colors: ["purple"], domain: 4}
);
const pivotInput = view(pivotInputWidget);
```

```js echo
const pivotTheta = view(Inputs.range([0, 360], {
  value: 40,
  step: 1,
  label: "rotate θ about pivot (degrees)"
}));
```

```js echo
const pivot = pivotInput.pivot;
const Mpivot = mat3.rotateAbout(pivot, (pivotTheta * Math.PI) / 180);
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

```js echo
pivotInputWidget.redecorate((scene) => {
  drawPolygon(scene, arrowShape, {stroke: "gray"});
  drawPolygon(
    scene,
    arrowShape.map((p) => mat3.transformPoint(Mpivot, p)),
    {stroke: "seagreen", fill: "seagreen", opacity: 0.15}
  );
});
```

The gray arrow is the original object. The green arrow rotates around the draggable pivot, not around the plane origin. The same pattern appears when rotating a wheel about its axle or orbiting a camera around a target.

### Why order matters

Consider point ${tex`(1,0)`} and a 90° counterclockwise rotation.

- Rotate first, then translate by ${tex`(3,0)`}: ${tex`T(3,0)R(90^\circ)(1,0)=(3,1)`}.
- Translate first, then rotate: ${tex`R(90^\circ)T(3,0)(1,0)=(0,4)`}.

The transforms contain the same ingredients but describe different motions.

```js echo
const orderPoint = {x: 1, y: 0};
const rotateThenTranslate = mat3.transformPoint(
  mat3.multiply(mat3.translation(3, 0), mat3.rotation(Math.PI / 2)),
  orderPoint
);
const translateThenRotate = mat3.transformPoint(
  mat3.multiply(mat3.rotation(Math.PI / 2), mat3.translation(3, 0)),
  orderPoint
);
```

```js echo
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

## 4. Transformations in 3D

The same construction extends to 3D. A point becomes ${tex`(x,y,z,1)`}; a vector becomes ${tex`(x,y,z,0)`}; and affine transformations use 4×4 matrices. The module’s [`components/mat4.js`](./components/mat4.js) represents matrices as flat, column-major arrays, matching the convention typically used by graphics APIs.

The three principal-axis rotation matrices are

${tex.block`R_x(\theta)=\begin{bmatrix}1&0&0\\0&\cos\theta&-\sin\theta\\0&\sin\theta&\cos\theta\end{bmatrix}\qquad R_y(\theta)=\begin{bmatrix}\cos\theta&0&\sin\theta\\0&1&0\\-\sin\theta&0&\cos\theta\end{bmatrix}\qquad R_z(\theta)=\begin{bmatrix}\cos\theta&-\sin\theta&0\\\sin\theta&\cos\theta&0\\0&0&1\end{bmatrix}`}

A common Euler-angle convention composes rotations as

${tex.block`R = R_z(\mathrm{yaw})\,R_y(\mathrm{pitch})\,R_x(\mathrm{roll})`}

With column vectors, roll acts first, then pitch, then yaw. The cube below uses that ZYX product. The red, green, and blue lines show the cube’s local x-, y-, and z-axes after the rotation.

```js echo
const eulerForm = view(Inputs.form({
  yaw: Inputs.range([-180, 180], {value: 20, step: 1, label: "yaw (Z)"}),
  pitch: Inputs.range([-90, 90], {value: 30, step: 1, label: "pitch (Y)"}),
  roll: Inputs.range([-180, 180], {value: 15, step: 1, label: "roll (X)"})
}));
```

```js echo
const eulerModel = mat4.fromEulerZYX(
  (eulerForm.yaw * Math.PI) / 180,
  (eulerForm.pitch * Math.PI) / 180,
  (eulerForm.roll * Math.PI) / 180
);
const fixedView = mat4.lookAt([0, 0, 5], [0, 0, 0], [0, 1, 0]);
const fixedProjection = mat4.perspective((45 * Math.PI) / 180, 1, 0.1, 20);
const eulerMVP = mat4.multiplyAll([fixedProjection, fixedView, eulerModel]);
```

```js echo
wireframe.renderWireframe(eulerMVP, {width: 320, height: 320})
```

### Gimbal lock

At a pitch of 90°, the yaw and roll axes align in this ZYX convention. The orientation still exists, but yaw and roll no longer provide two independent controls: one rotational degree of freedom is lost. This is **gimbal lock**, a limitation of Euler-angle parameterizations rather than a numerical error.

Quaternions avoid this coordinate singularity and are therefore commonly used for animation and orientation interpolation. The following view fixes pitch at 90° so the dependency between yaw and roll is visible.

```js echo
const gimbalForm = view(Inputs.form({
  yaw: Inputs.range([-180, 180], {value: 0, step: 1, label: "yaw (Z)"}),
  roll: Inputs.range([-180, 180], {value: 0, step: 1, label: "roll (X)"})
}));
```

```js echo
const gimbalModel = mat4.fromEulerZYX(
  (gimbalForm.yaw * Math.PI) / 180,
  Math.PI / 2,
  (gimbalForm.roll * Math.PI) / 180
);
const gimbalMVP = mat4.multiplyAll([fixedProjection, fixedView, gimbalModel]);
```

```js echo
wireframe.renderWireframe(gimbalMVP, {width: 320, height: 320})
```

At this fixed pitch, the visible orientation depends on the difference ${tex`\mathrm{yaw}-\mathrm{roll}`}. The current effective rotation is ${((gimbalForm.yaw - gimbalForm.roll)).toFixed(0)}°. For example, yaw = 40° and roll = 0° produces the same orientation as yaw = 0° and roll = −40°.

## 5. From Object Space to Screen Space

A mesh vertex passes through several coordinate spaces:

```js echo
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

```js echo
const modelForm = view(Inputs.form({
  wx: Inputs.range([-8, 8], {value: 5, step: 0.5, label: "world x"}),
  wy: Inputs.range([-8, 8], {value: 0, step: 0.5, label: "world y"}),
  wz: Inputs.range([-15, -3], {value: -10, step: 0.5, label: "world z"})
}));
```

```js echo
const objectVertex = [1, 1, 1];
const modelMatrix = mat4.translate(modelForm.wx, modelForm.wy, modelForm.wz);
const viewMatrix = mat4.lookAt([0, 0, 0], [0, 0, -1], [0, 1, 0]);
const projMatrix = mat4.perspective((60 * Math.PI) / 180, 1, 0.1, 50);

const worldVertex = mat4.transformPoint(modelMatrix, objectVertex);
const viewVertex = mat4.transformPoint(viewMatrix, worldVertex);
const clipVertex = mat4.transformPoint(projMatrix, viewVertex);
const ndcVertex = mat4.perspectiveDivide(clipVertex);
const screenVertex = [
  (ndcVertex[0] * 0.5 + 0.5) * 1920,
  (1 - (ndcVertex[1] * 0.5 + 0.5)) * 1080
];
```

```js echo
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

## 6. The Virtual Camera

A graphics camera is represented by an eye position, a target point, and an up-direction hint. From these values, `lookAt` constructs an orthonormal camera basis. The **view matrix** does not physically move a camera object; instead, it transforms the whole world into coordinates relative to that camera:

${tex.block`M_{\mathrm{view}} = M_{\mathrm{camera}}^{-1}`}

Orbit the eye around the cube below. The cube’s model matrix remains the identity; only the view matrix changes.

```js echo
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
const orbitView = mat4.lookAt(eye, [0, 0, 0], [0, 1, 0]);
const orbitProjection = mat4.perspective((50 * Math.PI) / 180, 1, 0.1, 30);
const orbitMVP = mat4.multiplyAll([orbitProjection, orbitView, mat4.identity()]);
```

```js echo
wireframe.renderWireframe(orbitMVP, {width: 320, height: 320})
```

Eye position: (${eye[0].toFixed(2)}, ${eye[1].toFixed(2)}, ${eye[2].toFixed(2)}).

The rendered view changes even though the cube does not. The view matrix re-expresses every object relative to the current eye position and viewing direction.

## 7. Projection

**Orthographic projection** uses parallel projection rays. It preserves apparent size with depth: a cube twice as far away appears the same size. In homogeneous form, ${tex`w`} remains 1, so there is no meaningful perspective divide.

**Perspective projection** uses rays that converge at the eye. The projected homogeneous ${tex`w`} is proportional to view-space depth, so dividing by ${tex`w`} makes more distant geometry appear smaller.

```js echo
const projForm = view(Inputs.form({
  fov: Inputs.range([20, 100], {value: 50, step: 1, label: "perspective FOV (degrees)"}),
  orthoExtent: Inputs.range([1, 5], {value: 2.5, step: 0.1, label: "orthographic half-extent"})
}));
```

```js echo
const compareEye = [3, 2, 5];
const compareView = mat4.lookAt(compareEye, [0, 0, 0], [0, 1, 0]);
const perspProjection = mat4.perspective((projForm.fov * Math.PI) / 180, 1, 0.1, 30);
const orthoProjection = mat4.ortho(
  -projForm.orthoExtent,
  projForm.orthoExtent,
  -projForm.orthoExtent,
  projForm.orthoExtent,
  0.1,
  30
);
const perspMVP = mat4.multiplyAll([perspProjection, compareView, mat4.identity()]);
const orthoMVP = mat4.multiplyAll([orthoProjection, compareView, mat4.identity()]);
```

```js echo
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

## 8. The Full Pipeline

For a vertex represented by a column vector, the pipeline is

${tex.block`\mathbf{p}_{\mathrm{clip}}=M_{\mathrm{projection}}\,M_{\mathrm{view}}\,M_{\mathrm{model}}\,\mathbf{p}_{\mathrm{object}}`}

After clipping, divide by the clip-space ${tex`w`} to obtain NDC:

${tex.block`\mathbf{p}_{\mathrm{ndc}}=\left(\frac{x_{\mathrm{clip}}}{w_{\mathrm{clip}}},\frac{y_{\mathrm{clip}}}{w_{\mathrm{clip}}},\frac{z_{\mathrm{clip}}}{w_{\mathrm{clip}}}\right)`}

Finally, a viewport transform maps NDC to pixel coordinates. In compact form,

${tex.block`\mathbf{p}_{\mathrm{screen}}=M_{\mathrm{viewport}}\,\operatorname{divideByW}\!\left(M_{\mathrm{projection}}M_{\mathrm{view}}M_{\mathrm{model}}\mathbf{p}_{\mathrm{object}}\right)`}

The product ${tex`M_{\mathrm{projection}}M_{\mathrm{view}}M_{\mathrm{model}}`} is commonly called the **Model-View-Projection (MVP)** transform. The notation is useful, but remember that the perspective divide is a separate operation between projection and viewport mapping. Week 4 will use the same transformations in a vertex shader.

## Summary

- Homogeneous coordinates add ${tex`w`}: use ${tex`w=1`} for points and ${tex`w=0`} for displacement vectors.
- Translation becomes matrix multiplication in homogeneous coordinates, while vectors remain unchanged by translation.
- With column vectors, the rightmost matrix acts first. Composition order changes the result and determines the center of rotation.
- 3D affine transformations use 4×4 matrices. Euler angles are convenient but can lose a degree of freedom at gimbal lock.
- The pipeline is object → world → view → clip → NDC → screen. Clipping occurs before the perspective divide.
- The view matrix expresses the world relative to the camera; the projection matrix maps view-space geometry into clip space.
- Perspective projection makes apparent size depend on depth, whereas orthographic projection does not.

