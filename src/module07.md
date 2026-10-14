---
title: Module 07 — Meshes and Scene Graphs
toc: true
---

```js echo
import * as d3 from "npm:d3";
import * as mat4 from "./components/mat4.js";
import * as mat3 from "./components/mat3.js";
import * as geometry from "./components/geometry.js";
import * as mesh from "./components/mesh.js";
import * as subdivision from "./components/subdivision.js";
import {SceneNode, traverse} from "./components/scenegraph.js";
import * as webgpu from "./components/webgpu.js";
import {createBuffer, Mesh} from "./components/lib/webgpu.js";
import * as wireframe from "./components/wireframe.js";
import {plane} from "./components/vectorField.js";
import * as Inputs from "npm:@observablehq/inputs";
import {html} from "npm:htl";
```

# Module 07 · Meshes and Scene Graphs

Some data structures appear again and again in graphics, because they
capture basic ideas: **surfaces**, **scene structure**, and
**repetition**. This module builds each one and measures what it buys:

| Structure | Problem it solves |
|---|---|
| **Triangle meshes** | Store surfaces compactly and answer "who is next to whom?" |
| **Scene graphs** | Organize objects and the transformations that place them |
| **Instances** | Draw many copies of one mesh, each with its own transform, in one draw call |

Sections 1 to 3 are plain JavaScript. Sections 4 and 5 put meshes,
scene graphs, and instances on the GPU and need **Chrome or Edge
113+**. Longer pieces of code are split into small cells, each followed
by an explanation of what it does and why. This handout teaches the
*techniques* behind the module; it is not a walkthrough of any graded
assignment.

## Triangle Meshes

A **triangle mesh** is a network of triangles connected through shared
vertices and edges. We need a test mesh with predictable connectivity.
An **icosahedron** has 12 vertices and 20 triangles. Splitting every
triangle into four and pushing the new vertices onto the unit sphere
gives an **icosphere**: a closed, manifold mesh at any resolution.

```js echo
function icosahedron() {
  const t = (1 + Math.sqrt(5)) / 2;
  const raw = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t],
               [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
  const positions = raw.map(([x, y, z]) => {
    const l = Math.hypot(x, y, z);
    return {x: x / l, y: y / l, z: z / l};
  });
  const faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4],
    [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  return {positions, faces};
}

// One refinement step: split each triangle into 4, sharing each new
// midpoint between the two triangles on either side of its edge.
function refineIcosphere({positions, faces}) {
  const P = positions.slice();
  const midpoint = new Map();
  const mid = (a, b) => {
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    if (!midpoint.has(key)) {
      const x = (P[a].x + P[b].x) / 2, y = (P[a].y + P[b].y) / 2, z = (P[a].z + P[b].z) / 2;
      const l = Math.hypot(x, y, z);
      midpoint.set(key, P.push({x: x / l, y: y / l, z: z / l}) - 1);
    }
    return midpoint.get(key);
  };
  const F = [];
  for (const [a, b, c] of faces) {
    const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
    F.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
  }
  return {positions: P, faces: F};
}

function icosphere(levels) {
  let m = icosahedron();
  for (let k = 0; k < levels; k++) m = refineIcosphere(m);
  return m;
}
```

### Topology: manifolds

**Topology** is how the triangles connect, ignoring where the vertices
are. A mesh is a **manifold** if

1. every edge is shared by **exactly two** triangles, and
2. every vertex has **a single, complete loop** of triangles around it.

`mesh.checkManifold` (in `components/mesh.js`) tests condition 1 by
counting the faces on each edge. Condition 2 needs a different test: a
"bowtie" vertex can pass the edge test and still have **two separate
fans**. We count the edge-connected fans at each vertex in three steps.

**Step 1: list the faces around every vertex.** One pass over the faces
appends each face's index to the list of each of its corners:

```js echo
function facesAroundVertices(faces, vertexCount) {
  const around = Array.from({length: vertexCount}, () => []);
  faces.forEach((face, i) => face.forEach((v) => around[v].push(i)));
  return around;
}
```

**Step 2: group one vertex's faces into fans.** Two faces around vertex
${tex`v`} belong to the same fan when they share an edge
${tex`(v, w)`}. We use a small **union–find** structure:

- `parent` starts with every face as its own group (`parent[f] = f`).
- `find(f)` follows `parent` links until it reaches a face that is its
  own parent. That face names the group.
- Each face around ${tex`v`} has two edges that touch ${tex`v`}: to the
  corner after ${tex`v`} and to the corner before it. The map
  `firstFaceOnEdge` remembers the first face seen on each edge
  ${tex`(v, w)`}. When a second face uses the same edge, the two faces'
  groups are **merged** by pointing one group's name at the other.
- When every face has been processed, the number of distinct group names
  is the number of fans.

```js echo
function countFans(faces, v, facesOfV) {
  const parent = new Map(facesOfV.map((f) => [f, f]));
  const find = (f) => (parent.get(f) === f ? f : find(parent.get(f)));
  const firstFaceOnEdge = new Map(); // other endpoint w -> first face using edge (v, w)
  for (const f of facesOfV) {
    const face = faces[f], k = face.indexOf(v), n = face.length;
    const after = face[(k + 1) % n], before = face[(k - 1 + n) % n];
    for (const w of [after, before]) {
      if (firstFaceOnEdge.has(w)) parent.set(find(f), find(firstFaceOnEdge.get(w))); // merge
      else firstFaceOnEdge.set(w, f);
    }
  }
  return new Set(facesOfV.map(find)).size;
}
```

**Step 3: do this for every vertex.** A manifold vertex, or a manifold
vertex on a boundary, has exactly one fan:

```js echo
function vertexFanCounts(faces, vertexCount) {
  return facesAroundVertices(faces, vertexCount).map((facesOfV, v) => countFans(faces, v, facesOfV));
}
```

Three small meshes test both conditions. The tetrahedron is closed and
manifold. The second copy has one face **duplicated**, a common
export glitch that puts three faces on several edges. The bowtie is two
triangles that touch only at vertex 0:

```js echo
const tetraPositions = [{x: 0, y: 1.2, z: 0}, {x: -1, y: -0.6, z: 1}, {x: 1, y: -0.6, z: 1}, {x: 0, y: -0.6, z: -1.2}];
const tetraFaces = [[0, 1, 2], [0, 2, 3], [0, 3, 1], [1, 3, 2]];
const testMeshes = {
  "tetrahedron": {faces: tetraFaces, nv: 4},
  "tetrahedron + duplicated face": {faces: [...tetraFaces, [0, 1, 2]], nv: 4},
  "bowtie (two triangles meeting at vertex 0)": {faces: [[0, 1, 2], [0, 3, 4]], nv: 5}
};
```

```js echo
Inputs.table(Object.entries(testMeshes).map(([name, {faces, nv}]) => {
  const edges = mesh.checkManifold(faces);
  const fans = vertexFanCounts(faces, nv);
  return {
    mesh: name,
    "edges with 3+ faces": edges.nonManifoldEdges.length,
    "boundary edges": edges.boundaryEdges.length,
    "vertices with 2+ fans": fans.filter((c) => c > 1).length,
    verdict: edges.nonManifoldEdges.length === 0 && fans.every((c) => c <= 1)
      ? (edges.boundaryEdges.length ? "manifold with boundary" : "manifold")
      : "non-manifold"
  };
}))
```

The bowtie passes the edge test, since every edge is used by only one
triangle, so it looks like a manifold *with boundary*. Only the fan
count catches it. The relaxed conditions for a **manifold with
boundary** are: every edge is used by **one or two** triangles, and every
vertex connects to **one** edge-connected set of triangles.

### Orientation

The **front** of a triangle is the side from which its vertices appear
in counterclockwise order. Two neighbors are **consistently oriented**
when their shared vertices appear in **opposite orders**. So a mesh is
consistent exactly when no **directed** edge ${tex`a \to b`} is used
twice:

```js echo
function orientationConflicts(faces) {
  const seen = new Map(), conflicts = [];
  faces.forEach((f, i) => f.forEach((a, k) => {
    const b = f[(k + 1) % f.length], key = `${a}→${b}`;
    if (seen.has(key)) conflicts.push(`faces ${seen.get(key)} and ${i} both use ${key}`);
    else seen.set(key, i);
  }));
  return conflicts;
}
```

```js echo
const flipFace = view(Inputs.range([-1, 19], {value: -1, step: 1, label: "flip icosahedron face (−1 = none)"}));
```

```js echo
const flippedIco = icosahedron().faces.map((f, i) => (i === flipFace ? [f[0], f[2], f[1]] : f));
const conflicts = orientationConflicts(flippedIco);
```

${conflicts.length === 0 ? html`<b>Consistently oriented:</b> every directed edge is used once.` : html`<b>${conflicts.length} conflicts</b>, one for each edge of the flipped face:<pre>${conflicts.join("\n")}</pre>`}

Flipping one face reverses all three of its edges, so all three of its
neighbors now disagree with it. A mesh with non-manifold edges cannot be
oriented consistently at all.

### Separate triangles vs. an indexed mesh

Storing each triangle's three positions separately costs ${tex`9n_t`}
floats. An **indexed mesh** stores each vertex once plus three integer
indices per triangle, ${tex`3n_v + 3n_t`} units. The saving depends on
${tex`n_t/n_v`}, which approaches **2** in large meshes because each
vertex touches about six triangles:

```js echo
Inputs.table(d3.range(0, 6).map((level) => {
  const m = icosphere(level);
  const nv = m.positions.length, nt = m.faces.length;
  return {
    level, "vertices nᵥ": nv, "triangles nₜ": nt, "nₜ / nᵥ": nt / nv,
    "separate 9nₜ": 9 * nt, "indexed 3nᵥ + 3nₜ": 3 * nv + 3 * nt,
    "indexed / separate": (3 * nv + 3 * nt) / (9 * nt)
  };
}), {format: {"nₜ / nᵥ": (v) => v.toFixed(3), "indexed / separate": (v) => v.toFixed(3)}})
```

For a closed triangle mesh of genus 0, Euler's formula gives exactly
${tex`n_t = 2n_v - 4`}, so the ratio tends to 2 and the indexed mesh tends
to **half** the storage. With more attributes per vertex (normals, UVs),
the saving grows.

### Triangle strips and fans

A **strip** describes ${tex`n`} triangles with ${tex`n+2`} indices.
Every three consecutive indices form a triangle, and every other triangle
is reversed so that the orientation stays consistent. A **fan** shares
its first vertex:

```js echo
function stripToTriangles(s) {
  const tris = [];
  for (let i = 0; i + 2 < s.length; i++) {
    tris.push(i % 2 === 0 ? [s[i], s[i + 1], s[i + 2]] : [s[i + 1], s[i], s[i + 2]]);
  }
  return tris;
}
function fanToTriangles(s) {
  const tris = [];
  for (let i = 1; i + 1 < s.length; i++) tris.push([s[0], s[i], s[i + 1]]);
  return tris;
}
const stripTris = stripToTriangles([0, 1, 2, 3, 4, 5, 6, 7]);
```

- Strip `[0 1 2 3 4 5 6 7]` → ${stripTris.map((t) => `(${t.join(",")})`).join(" ")}, with ${orientationConflicts(stripTris).length} orientation conflicts.
- Fan `[0 1 2 3 4 5]` → ${fanToTriangles([0, 1, 2, 3, 4, 5]).map((t) => `(${t.join(",")})`).join(" ")}.

Relative to an indexed mesh, a strip of length ${tex`n`} stores
${tex`(n+2)/(3n)`} as many indices. Most of the saving comes from short
strips:

```js echo
Inputs.table([1, 2, 3, 4, 5, 6, 7, 8, 16, 100, 1e9].map((n) => ({
  "strip length n": n === 1e9 ? "∞" : n,
  "relative size": n === 1e9 ? 1 / 3 : (n + 2) / (3 * n)
})), {format: {"relative size": (v) => v.toFixed(2)}})
```

### Connectivity: the triangle-neighbor structure

To **edit** a mesh we need fast answers to adjacency queries. The
**triangle-neighbor** structure adds two arrays to the indexed mesh:
`tNbr[t][k]` is the neighbor across edge ${tex`(v_k, v_{k+1})`}, stored
together with **which of its edges** it shares, and `vEdge[v]` is any one
edge leaving ${tex`v`}:

An edge is named by a pair `{t, i}`: **edge ${tex`i`} of triangle
${tex`t`}** runs from corner ${tex`i`} to corner ${tex`i+1`}. The builder
makes three passes over the faces:

1. Record every **directed** edge `"a,b"` and the `{t, i}` that owns it.
2. In a consistently oriented mesh, the neighbor across ${tex`a \to b`}
   is the triangle that runs the same edge the other way,
   ${tex`b \to a`}. Looking up the reversed key gives the neighbor **and**
   which of its edges is shared. A boundary edge has no reverse and gets
   `null`.
3. For each vertex, keep the first edge found that **leaves** it.

```js echo
function buildTriangleNeighbors(faces, vertexCount) {
  // Pass 1: "a,b" -> {t, i}, meaning edge i of triangle t runs a -> b.
  const directed = new Map();
  faces.forEach((f, t) => f.forEach((a, i) => directed.set(`${a},${f[(i + 1) % 3]}`, {t, i})));
  // Pass 2: the neighbor across a -> b is whoever uses b -> a.
  const tNbr = faces.map((f) => f.map((a, i) => directed.get(`${f[(i + 1) % 3]},${a}`) ?? null));
  // Pass 3: one outgoing edge per vertex.
  const vEdge = new Array(vertexCount).fill(null);
  faces.forEach((f, t) => f.forEach((a, i) => { vEdge[a] ??= {t, i}; }));
  return {tNbr, vEdge};
}
```

To walk around vertex ${tex`v`}, start on an edge `{t, i}` that leaves
${tex`v`}. Crossing it with `tNbr[t][i]` lands on edge `{t', i'}` of the
neighbor, which runs **into** ${tex`v`}. In that triangle, the next edge,
${tex`i'+1`}, leaves ${tex`v`} again, so we are ready for the next step
with **no search**:

```js echo
function trianglesOfVertex({tNbr, vEdge}, v) {
  const visited = [];
  let {t, i} = vEdge[v];
  const start = t;
  do {
    visited.push(t);
    ({t, i} = tNbr[t][i]);
    i = (i + 1) % 3;
  } while (t !== start);
  return visited;
}
```

```js echo
const icoLevel = view(Inputs.range([0, 3], {value: 1, step: 1, label: "icosphere level"}));
```

```js echo
const icoMesh = icosphere(icoLevel);
const icoNeighbors = buildTriangleNeighbors(icoMesh.faces, icoMesh.positions.length);
const invariantHolds = icoNeighbors.tNbr.every((row, t) => row.every((r) => icoNeighbors.tNbr[r.t][r.i].t === t));
```

```js echo
// Default to the vertex that faces the camera most directly.
const facingVertex = d3.maxIndex(icoMesh.positions, (p) => p.x * 2.2 + p.y * 1.6 + p.z * 2.6);
const queryVertex = view(Inputs.range([0, icoMesh.positions.length - 1], {value: facingVertex, step: 1, label: "query vertex v"}));
```

```js echo
const fanOfQuery = trianglesOfVertex(icoNeighbors, queryVertex);
```

```js echo
(() => {
  const size = 320;
  const eye = [2.2, 1.6, 2.6];
  const mvp = mat4.multiply(mat4.perspective(0.75, 1, 0.1, 10), mat4.lookAt(eye, [0, 0, 0], [0, 1, 0]));
  const proj = icoMesh.positions.map((p) => wireframe.project(mvp, p, size, size));
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  canvas.style.borderRadius = "8px";
  canvas.style.background = "var(--theme-background-alt, #f5f5f5)";
  const ctx = canvas.getContext("2d");
  const eyeDir = eye.map((c) => c / Math.hypot(...eye));
  icoMesh.faces.forEach((f, t) => {
    const c = f.map((i) => icoMesh.positions[i]);
    const center = [(c[0].x + c[1].x + c[2].x) / 3, (c[0].y + c[1].y + c[2].y) / 3, (c[0].z + c[1].z + c[2].z) / 3];
    if (center[0] * eyeDir[0] + center[1] * eyeDir[1] + center[2] * eyeDir[2] < 0) return; // back side
    const order = fanOfQuery.indexOf(t);
    ctx.beginPath();
    f.forEach((i, k) => (k ? ctx.lineTo(proj[i].x, proj[i].y) : ctx.moveTo(proj[i].x, proj[i].y)));
    ctx.closePath();
    ctx.fillStyle = order >= 0 ? d3.interpolateOranges(0.3 + 0.6 * order / fanOfQuery.length) : "rgba(70,130,180,0.12)";
    ctx.fill();
    ctx.strokeStyle = "rgba(70,130,180,0.7)";
    ctx.stroke();
  });
  return canvas;
})()
```

Vertex ${queryVertex} has **${fanOfQuery.length}** triangles around it,
visited in the order [${fanOfQuery.join(", ")}] (light to dark orange).
Each step takes constant time. The structure's invariant,
`t.nbr[j].t.nbr[t.nbr[j].i].t == t`, **${invariantHolds ? "holds" : "fails"}**
for every edge of this mesh. (Vertices on the far side of the sphere are
hidden; their fans are still traversed.)

### Winged-edge and half-edge structures

Edge-based structures work for **any polygon mesh**. A **winged-edge**
record stores its head and tail, its left and right faces, and the
previous and next edges around each face (traversing each face
counterclockwise):

We build it in three passes. Each undirected edge is looked up by a
key that lists its endpoints smallest first, so ${tex`a \to b`} and
${tex`b \to a`} find the same record:

```js echo
const edgeKey = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`);
```

**Pass 1: create one record per edge.** The first face that uses an edge
becomes its **left** face, and the edge's direction (tail → head) is taken
from that face. When the second face arrives, it becomes the **right**
face. A boundary edge keeps `right = -1`:

```js echo
function createEdges(faces) {
  const edges = [], index = new Map();     // index: edgeKey -> position in edges
  faces.forEach((f, fi) => f.forEach((a, k) => {
    const b = f[(k + 1) % f.length];
    if (!index.has(edgeKey(a, b))) {
      index.set(edgeKey(a, b), edges.length);
      edges.push({tail: a, head: b, left: fi, right: -1});
    } else {
      edges[index.get(edgeKey(a, b))].right = fi;
    }
  }));
  return {edges, index};
}
```

**Pass 2: link the wings.** Walk each face's corners in order. At corner
${tex`a`}, the face's edge is ${tex`a \to b`}. The edge **after** it in
this face is ${tex`b \to c`}, and the edge **before** it is
${tex`z \to a`}. Whether these are stored as `lnext`/`lprev` or
`rnext`/`rprev` depends on whether this face is the edge's left or
right face:

```js echo
function linkWings(faces, edges, index) {
  faces.forEach((f, fi) => f.forEach((a, k) => {
    const n = f.length;
    const b = f[(k + 1) % n], c = f[(k + 2) % n], z = f[(k - 1 + n) % n];
    const e = edges[index.get(edgeKey(a, b))];
    const next = index.get(edgeKey(b, c)), prev = index.get(edgeKey(z, a));
    if (e.left === fi) { e.lnext = next; e.lprev = prev; }
    else               { e.rnext = next; e.rprev = prev; }
  }));
}
```

**Pass 3: give every vertex and face one edge** to start traversals
from, and put the pieces together:

```js echo
function buildWingedEdge(faces) {
  const {edges, index} = createEdges(faces);
  linkWings(faces, edges, index);
  const vertexEdge = [], faceEdge = [];
  edges.forEach((e, i) => {
    vertexEdge[e.tail] ??= i; vertexEdge[e.head] ??= i;
    faceEdge[e.left] ??= i; if (e.right >= 0) faceEdge[e.right] ??= i;
  });
  return {edges, vertexEdge, faceEdge};
}
```

The two traversals from the reading follow. Each step must first check
**which way the current edge points** relative to the vertex or face,
and that test decides between the left and right wing. The half-edge
structure removes exactly this check:

```js echo
function edgesOfVertex({edges, vertexEdge}, v) {
  const out = [];
  let e = vertexEdge[v];
  do {
    out.push(e);
    e = edges[e].tail === v ? edges[e].lprev : edges[e].rprev;   // direction check
  } while (e !== vertexEdge[v]);
  return out;
}
function edgesOfFace({edges, faceEdge}, f) {
  const out = [];
  let e = faceEdge[f];
  do {
    out.push(e);
    e = edges[e].left === f ? edges[e].lnext : edges[e].rnext;   // direction check
  } while (e !== faceEdge[f]);
  return out;
}
```

```js echo
const icoWinged = buildWingedEdge(icoMesh.faces);
const icoHalf = mesh.buildHalfEdges(icoMesh.faces);
const fmtEdge = (e) => `${icoWinged.edges[e].tail}–${icoWinged.edges[e].head}`;
```

On the level-${icoLevel} icosphere (${icoWinged.edges.length} edges):

- `EdgesOfVertex(${queryVertex})` → ${edgesOfVertex(icoWinged, queryVertex).map(fmtEdge).join(", ")}
- `EdgesOfFace(0)` → ${edgesOfFace(icoWinged, 0).map(fmtEdge).join(", ")}, which matches face 0 = (${icoMesh.faces[0].join(", ")})
- The half-edge structure (`mesh.facesAroundVertex`) finds the faces around vertex ${queryVertex}: [${mesh.facesAroundVertex(icoHalf, queryVertex).join(", ")}]. That is the same set as the triangle-neighbor walk, reached with one `pair`/`prev` hop per step and no direction check.

**Storage, in units per vertex** (floats, ints, and pointers count as 1):

```js echo
(() => {
  const nv = icoMesh.positions.length, nt = icoMesh.faces.length, ne = icoWinged.edges.length;
  return Inputs.table([
    {structure: "separate triangles", units: 9 * nt},
    {structure: "indexed mesh", units: 3 * nv + 3 * nt},
    {structure: "triangle-neighbor (positions + 1 edge per vertex, 3 + 3 per triangle)", units: 4 * nv + 6 * nt},
    {structure: "winged-edge (8 refs per edge + 1 per vertex and face)", units: 3 * nv + 8 * ne + nv + nt},
    {structure: "half-edge (4 refs per half-edge + 1 per vertex and face)", units: 3 * nv + 4 * 2 * ne + nv + nt}
  ].map((r) => ({...r, "per vertex": r.units / nv})), {format: {"per vertex": (v) => v.toFixed(1)}});
})()
```

The table reproduces the reading's estimates: about ${tex`18n_v`} for
separate triangles, ${tex`9n_v`} for an indexed mesh, and
${tex`16n_v`} for the triangle-neighbor structure.

## Catmull–Clark Subdivision

Subdivision is a key application of adjacency: every rule needs the faces
around a vertex or on both sides of an edge. Each **Catmull–Clark** step
computes

${tex.block`F = \frac1m\sum_{i=1}^m P_i, \qquad E = \frac{P_1 + P_2 + F_1 + F_2}{4}, \qquad P' = \frac{\bar F + 2\bar R + (n-3)P}{n}`}

where ${tex`\bar F`} averages the face points around ${tex`P`},
${tex`\bar R`} averages the **midpoints** of its ${tex`n`} edges, and
${tex`n`} is its valence. Each original corner then becomes one new quad
(${tex`P'`}, edge point, face point, edge point). `components/subdivision.js`
implements exactly these rules:

```js echo
const cubePositions = [
  {x: -1, y: -1, z: -1}, {x: 1, y: -1, z: -1}, {x: 1, y: 1, z: -1}, {x: -1, y: 1, z: -1},
  {x: -1, y: -1, z: 1}, {x: 1, y: -1, z: 1}, {x: 1, y: 1, z: 1}, {x: -1, y: 1, z: 1}
];
const cubeFaces = [[1, 2, 6, 5], [0, 4, 7, 3], [3, 7, 6, 2], [0, 1, 5, 4], [4, 5, 6, 7], [0, 3, 2, 1]];
```

```js echo
const ccForm = view(Inputs.form({
  iterations: Inputs.range([0, 3], {value: 1, step: 1, label: "subdivision steps"}),
  azimuth: Inputs.range([-180, 180], {value: 35, step: 1, label: "orbit azimuth"})
}));
```

```js echo
const ccMesh = (() => {
  let m = {positions: cubePositions, faces: cubeFaces};
  for (let i = 0; i < ccForm.iterations; i++) m = subdivision.catmullClark(m);
  return m;
})();
const ccValence = (() => {
  const count = new Array(ccMesh.positions.length).fill(0);
  for (const [a, b] of subdivision.facesToEdges(ccMesh.faces)) { count[a]++; count[b]++; }
  return count;
})();
```

```js echo
(() => {
  const az = (ccForm.azimuth * Math.PI) / 180;
  const mvp = mat4.multiply(mat4.perspective(Math.PI / 4, 1, 0.1, 20),
    mat4.lookAt([4.5 * Math.cos(0.45) * Math.sin(az), 4.5 * Math.sin(0.45), 4.5 * Math.cos(0.45) * Math.cos(az)], [0, 0, 0], [0, 1, 0]));
  return wireframe.renderWireframe(mvp, {width: 320, height: 320, vertices: ccMesh.positions,
    edges: subdivision.facesToEdges(ccMesh.faces), showAxes: false});
})()
```

After ${ccForm.iterations} step(s): **${ccMesh.positions.length} vertices** and
**${ccMesh.faces.length} quads** (the count multiplies by 4 each step:
6 → 24 → 96 → 384). Vertices with valence ${tex`n \ne 4`} are
**extraordinary**: here there are **${ccValence.filter((n) => n !== 4).length}**,
the cube's 8 corners, and subdivision never adds more. The limit surface
is ${tex`C^2`} everywhere except at those points, where it is ${tex`C^1`}.
The weights ${tex`\tfrac1n + \tfrac2n + \tfrac{n-3}n`} sum to 1, so a
vertex is moved to an **average** of its neighborhood. With ${tex`n-2`},
the weights would sum to ${tex`\tfrac{n+1}n`} and scale every vertex away
from the origin, inflating the mesh.

## Scene Graphs

### The hinged pendulum

Each piece of the pendulum is modeled in its **own** frame. The upper
piece rotates by ${tex`\theta`} about its hinge at ${tex`p`}. The lower
piece hangs from point ${tex`b`} of the upper piece and rotates by
${tex`\varphi`}:

${tex.block`M_3 = \text{translate}(p)\,\text{rotate}(\theta), \qquad M_c = \text{translate}(b)\,\text{rotate}(\varphi), \qquad M_d = M_3\,M_c`}

```js echo
const pendulumForm = view(Inputs.form({
  theta: Inputs.range([-90, 90], {value: 25, step: 1, label: "θ (upper joint)"}),
  phi: Inputs.range([-120, 120], {value: -55, step: 1, label: "φ (lower joint)"}),
  px: Inputs.range([-2, 2], {value: 0, step: 0.1, label: "hinge position p.x"})
}));
```

```js echo
(() => {
  const deg = Math.PI / 180;
  const M3 = mat3.multiply(mat3.translation(pendulumForm.px, 2.5), mat3.rotation(pendulumForm.theta * deg));
  const b = {x: 0, y: -2.2};                       // attachment point, in the upper piece's frame
  const Mc = mat3.multiply(mat3.translation(b.x, b.y), mat3.rotation(pendulumForm.phi * deg));
  const Md = mat3.multiply(M3, Mc);                // the lower piece rides along with M3
  const upper = [{x: -0.15, y: 0.15}, {x: 0.15, y: 0.15}, {x: 0.15, y: -2.4}, {x: -0.15, y: -2.4}];
  const lower = [{x: -0.12, y: 0.12}, {x: 0.12, y: 0.12}, {x: 0.12, y: -1.8}, {x: -0.12, y: -1.8}];
  const scene = plane({width: 340, height: 340, domain: 4.2});
  const draw = (pts, M, fill) => scene.svg.append("polygon")
    .attr("points", pts.map((p) => mat3.transformPoint(M, p)).map((p) => `${scene.x(p.x)},${scene.y(p.y)}`).join(" "))
    .attr("fill", fill).attr("fill-opacity", 0.55).attr("stroke", "currentColor");
  draw(upper, M3, "steelblue");
  draw(lower, Md, "orangered");
  for (const [p, color] of [[mat3.transformPoint(M3, {x: 0, y: 0}), "steelblue"], [mat3.transformPoint(M3, b), "seagreen"]]) {
    scene.svg.append("circle").attr("cx", scene.x(p.x)).attr("cy", scene.y(p.y)).attr("r", 5).attr("fill", color);
  }
  return scene.svg.node();
})()
```

Change ${tex`\theta`}, and the lower piece swings along with the upper
one, even though nothing in its own matrix ${tex`M_c`} changed. **Its
whole coordinate system moves with the upper piece.**

### The matrix stack

The matrix for any object is the **product of the matrices on the path
from the root** to it. A **matrix stack** keeps that product while a
recursive traversal walks the tree. The class below stores the **running
products**, not the individual matrices:

- `stack[0]` is the identity, and `top()` is the matrix for the node
  being visited now.
- `push(M)` computes `top() · M` and pushes the result, so the new top is
  the parent's product times this node's local matrix. Putting ${tex`M`}
  on the **right** means it is applied to a point before the parent's
  matrices.
- `pop()` discards the top, which restores the parent's product exactly.
  No inverse is needed.
- `labels` and `log` record names such as `M0 · M1`, only so that the
  steps can be printed below.

```js echo
class MatrixStack {
  stack = [mat4.identity()];   // running products; stack[0] is the identity
  labels = [];                 // names of the matrices in the current product
  log = [];                    // a printout of every push and pop

  top() { return this.stack[this.stack.length - 1]; }
  push(M, name) {
    this.stack.push(mat4.multiply(this.top(), M));
    this.labels.push(name);
    this.log.push(`push ${name.padEnd(4)}  stack = [${this.names()}]`);
  }
  pop() {
    this.stack.pop();
    this.labels.pop();
    this.log.push(`pop        stack = [${this.names()}]`);
  }
  names() { return this.labels.join(" · "); }
}
```

The traversal is the reading's `traverse(node)`. It pushes the node's
matrix, draws the node with whatever is on top, visits the children (who
push and pop their own matrices), and finally pops, so the next sibling
starts again from the parent's product:

```js echo
function traverseWithStack(node, stack, drawn) {
  stack.push(node.local, node.matrixName);
  if (node.draws) drawn.push(`${node.name.padEnd(12)} drawn with ${stack.names()}`);
  for (const child of node.children) traverseWithStack(child, stack, drawn);
  stack.pop();
}
```

The ferry from the reading carries a car whose wheels move relative to the
car:

```js echo
const ferryForm = view(Inputs.form({
  ferryX: Inputs.range([-2, 2], {value: 0, step: 0.1, label: "ferry position (M₀)"}),
  carX: Inputs.range([-1.5, 1.5], {value: 0.4, step: 0.1, label: "car on the deck (M₁)"}),
  wheelSpin: Inputs.range([0, 360], {value: 30, step: 5, label: "wheel spin (M₂, M₃)"})
}));
```

```js echo
const ferryTree = (() => {
  const spin = mat4.rotateZ((-ferryForm.wheelSpin * Math.PI) / 180);
  const node = (name, matrixName, local, children = [], draws = true) => ({name, matrixName, local, children, draws});
  return node("ferry", "M0", mat4.translate(ferryForm.ferryX, 0, 0), [
    node("car body", "M1", mat4.translate(ferryForm.carX, 0.55, 0), [
      node("left wheel", "M2", mat4.multiply(mat4.translate(-0.45, -0.25, 0), spin)),
      node("right wheel", "M3", mat4.multiply(mat4.translate(0.45, -0.25, 0), spin))
    ])
  ]);
})();
const ferryStack = new MatrixStack();
const ferryDrawn = [];
traverseWithStack(ferryTree, ferryStack, ferryDrawn);
```

```js echo
(() => {
  const scene = plane({width: 340, height: 340, domain: 2.6});
  const shapes = {
    "ferry": [{x: -2, y: -0.4}, {x: 2, y: -0.4}, {x: 1.6, y: 0.2}, {x: -1.6, y: 0.2}],
    "car body": [{x: -0.7, y: -0.2}, {x: 0.7, y: -0.2}, {x: 0.6, y: 0.3}, {x: -0.6, y: 0.3}],
    "left wheel": d3.range(8).map((k) => ({x: 0.18 * Math.cos(k * Math.PI / 4), y: 0.18 * Math.sin(k * Math.PI / 4)})),
    "right wheel": d3.range(8).map((k) => ({x: 0.18 * Math.cos(k * Math.PI / 4), y: 0.18 * Math.sin(k * Math.PI / 4)}))
  };
  const colors = {"ferry": "steelblue", "car body": "orangered", "left wheel": "#333", "right wheel": "#333"};
  (function walk(n, parent) {
    const world = mat4.multiply(parent, n.local);
    const pts = shapes[n.name].map((p) => mat4.transformPoint(world, [p.x, p.y, 0]));
    scene.svg.append("polygon").attr("points", pts.map((p) => `${scene.x(p[0])},${scene.y(p[1])}`).join(" "))
      .attr("fill", colors[n.name]).attr("fill-opacity", 0.6).attr("stroke", "currentColor");
    n.children.forEach((c) => walk(c, world));
  })(ferryTree, mat4.identity());
  return scene.svg.node();
})()
```

```js echo
html`<pre>${ferryStack.log.join("\n")}

${ferryDrawn.join("\n")}</pre>`
```

Each `pop()` restores the parent's matrix, so the right wheel gets
${tex`M_0M_1M_3`}, not ${tex`M_0M_1M_2M_3`}: **siblings never inherit
each other's transforms.** In `components/scenegraph.js`, the JavaScript
call stack plays the same role: `parentWorld` is the top of the stack,
and returning from a call pops it.

## Meshes and Scene Graphs in WebGPU

```js echo
const {adapter, device} = await webgpu.requestDevice();
```

Validation errors in WebGPU are reported asynchronously, so we display
them on the page:

```js echo
const deviceErrorLog = document.createElement("pre");
deviceErrorLog.style.cssText = "display: none; color: #e5484d; background: #2a1214; border: 1px solid #e5484d; border-radius: 6px; padding: 8px 12px; font-size: 12px; white-space: pre-wrap;";
device.addEventListener("uncapturederror", (event) => {
  deviceErrorLog.textContent += `WebGPU error: ${event.error.message}\n`;
  deviceErrorLog.style.display = "block";
});
```

```js echo
deviceErrorLog
```

The drawings in this section share a few helpers. They are the usual
WebGPU setup steps, split into small pieces so that each one can be
explained.

**1. The shader.** Every drawing below uses the same simple shader. The
uniform block holds one **MVP** matrix (model-view-projection) and one
color. The vertex shader transforms each position to clip space and
passes the normal along. The fragment shader applies a Lambert term with
a fixed light direction. The constant 0.35 is an ambient floor, so faces
that point away from the light are dim but not black:

```js echo
const litShaderSource = `
struct Uniforms { mvp: mat4x4<f32>, color: vec4<f32> };
@group(0) @binding(0) var<uniform> u: Uniforms;

struct VertexOut { @builtin(position) position: vec4<f32>, @location(0) normal: vec3<f32> };

@vertex
fn vs_main(@location(0) inPos: vec3<f32>, @location(1) inNormal: vec3<f32>) -> VertexOut {
  var out: VertexOut;
  out.position = u.mvp * vec4<f32>(inPos, 1.0);
  out.normal = inNormal;
  return out;
}

@fragment
fn fs_main(@location(0) normal: vec3<f32>) -> @location(0) vec4<f32> {
  let L = normalize(vec3<f32>(0.4, 0.8, 0.5));
  let ndotl = max(dot(normalize(normal), L), 0.0);
  return vec4<f32>(u.color.rgb * (0.35 + 0.65 * ndotl), 1.0);
}
`;
const litModule = device.createShaderModule({code: litShaderSource});
```

**2. The vertex layout and the pipeline.** Each vertex is 6 floats,
interleaved: a position at byte offset 0 and a normal at byte offset 12.
The `shaderLocation` numbers connect each attribute to the matching
`@location(n)` parameter of `vs_main`. Culling is off, so a face with
the wrong winding is still visible here:

```js echo
const canvasFormat = navigator.gpu.getPreferredCanvasFormat();

const vertexLayout = {
  arrayStride: 6 * 4,                                     // 6 floats = 24 bytes per vertex
  attributes: [
    {shaderLocation: 0, offset: 0, format: "float32x3"},     // position
    {shaderLocation: 1, offset: 3 * 4, format: "float32x3"}  // normal
  ]
};

function makeLitPipeline(topology = "triangle-list", extra = {}) {
  return device.createRenderPipeline({
    layout: "auto",
    vertex: {module: litModule, entryPoint: "vs_main", buffers: [vertexLayout]},
    fragment: {module: litModule, entryPoint: "fs_main", targets: [{format: canvasFormat}]},
    primitive: {topology, cullMode: "none", ...extra},
    depthStencil: {format: "depth24plus", depthWriteEnabled: true, depthCompare: "less"}
  });
}
const litPipeline = makeLitPipeline();
```

**3. Vertex and index buffers.** `mappedAtCreation: true` creates a
buffer whose memory the CPU can write right away. We copy the data into
`getMappedRange()` and then `unmap()` it, which hands the buffer to the
GPU. Buffer sizes must be multiples of 4 bytes. A `Uint16Array` with an
odd number of indices is 2 bytes short, so `makeIndexBuffer` pads it
with one extra index that is never drawn:

```js echo
function makeVertexBuffer(data) {
  const buffer = device.createBuffer({size: data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, mappedAtCreation: true});
  new Float32Array(buffer.getMappedRange()).set(data);
  buffer.unmap();
  return buffer;
}
function makeIndexBuffer(data) {
  const padded = new Uint16Array(Math.ceil(data.length / 2) * 2);   // round up to a multiple of 4 bytes
  padded.set(data);
  const buffer = device.createBuffer({size: padded.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST, mappedAtCreation: true});
  new Uint16Array(buffer.getMappedRange()).set(padded);
  buffer.unmap();
  return buffer;
}
```

**4. A canvas to draw into, and a drawable.** `makeCanvas` returns a
configured canvas plus a depth texture of the same size. A **drawable**
bundles what one draw call needs: its buffers, its index count, and a
bind group pointing at its own 80-byte uniform buffer (a 64-byte matrix
plus a 16-byte color):

```js echo
function makeCanvas(size) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  canvas.style.borderRadius = "8px";
  const {context} = webgpu.configureCanvas(canvas, device);
  const depthTexture = device.createTexture({size: [size, size], format: "depth24plus", usage: GPUTextureUsage.RENDER_ATTACHMENT});
  return {canvas, context, depthTexture};
}

function makeDrawable(vertexBuffer, indexBuffer, count, mvp, colorRGB, pipeline = litPipeline) {
  const uniformBuffer = device.createBuffer({size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
  device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([...mvp, ...colorRGB, 1]));
  const bindGroup = device.createBindGroup({layout: pipeline.getBindGroupLayout(0), entries: [{binding: 0, resource: {buffer: uniformBuffer}}]});
  return {vertexBuffer, indexBuffer, count, bindGroup, uniformBuffer, pipeline};
}
```

**5. Rendering a list of drawables.** `beginPass` clears the color and
depth attachments. `renderScenePass` records one draw per drawable and
submits the commands. A drawable with an index buffer uses
`drawIndexed`, and one without uses plain `draw`:

```js echo
function beginPass(encoder, target) {
  return encoder.beginRenderPass({
    colorAttachments: [{view: target.context.getCurrentTexture().createView(), clearValue: {r: 0.05, g: 0.05, b: 0.08, a: 1}, loadOp: "clear", storeOp: "store"}],
    depthStencilAttachment: {view: target.depthTexture.createView(), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store"}
  });
}

function renderScenePass(target, drawList) {
  const encoder = device.createCommandEncoder();
  const pass = beginPass(encoder, target);
  for (const {pipeline, bindGroup, vertexBuffer, indexBuffer, count} of drawList) {
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, vertexBuffer);
    if (indexBuffer) { pass.setIndexBuffer(indexBuffer, "uint16"); pass.drawIndexed(count); }
    else pass.draw(count);
  }
  pass.end();
  device.queue.submit([encoder.finish()]);
}
```

**6. Two small utilities.** `packInterleaved` turns arrays of
`{x, y, z}` positions and normals into the 6-floats-per-vertex layout
from step 2. `captioned` places canvases side by side with a label above
each:

```js echo
function packInterleaved(positions, normals) {
  const out = new Float32Array(positions.length * 6);
  positions.forEach((p, i) => {
    const n = normals[i];
    out.set([p.x, p.y, p.z, n.x, n.y, n.z], i * 6);
  });
  return out;
}

function captioned(entries) {
  const row = document.createElement("div");
  row.style.cssText = "display: flex; gap: 16px; flex-wrap: wrap;";
  for (const [label, canvas] of entries) {
    const cell = document.createElement("div");
    const caption = document.createElement("div");
    caption.textContent = label;
    caption.style.cssText = "font: 12px var(--sans-serif); opacity: 0.65; margin-bottom: 4px;";
    cell.append(caption, canvas);
    row.append(cell);
  }
  return row;
}
```

### Indexed meshes and `drawIndexed`

An icosphere drawn two ways: as an **indexed** mesh (one vertex per
position, `drawIndexed`), and as **separate triangles** (three vertices per
triangle, `draw`). The pictures match; the buffer sizes do not:

```js echo
const gpuIcoLevel = view(Inputs.range([0, 4], {value: 2, step: 1, label: "icosphere level"}));
```

```js echo
const gpuIco = icosphere(gpuIcoLevel);
const icoIndexed = {
  vertices: packInterleaved(gpuIco.positions, gpuIco.positions),       // a unit sphere's normal is its position
  indices: new Uint16Array(gpuIco.faces.flat())
};
const icoSeparate = (() => {
  const corners = gpuIco.faces.flat().map((i) => gpuIco.positions[i]);
  return packInterleaved(corners, corners);
})();
const icoMVP = mat4.multiply(mat4.perspective(0.75, 1, 0.1, 10), mat4.lookAt([2.2, 1.6, 2.6], [0, 0, 0], [0, 1, 0]));
const icoTargets = [makeCanvas(240), makeCanvas(240)];
renderScenePass(icoTargets[0], [makeDrawable(makeVertexBuffer(icoIndexed.vertices), makeIndexBuffer(icoIndexed.indices), icoIndexed.indices.length, icoMVP, [0.3, 0.55, 0.85])]);
renderScenePass(icoTargets[1], [makeDrawable(makeVertexBuffer(icoSeparate), null, icoSeparate.length / 6, icoMVP, [0.85, 0.45, 0.25])]);
```

```js echo
captioned([
  [`indexed: ${(icoIndexed.vertices.byteLength + icoIndexed.indices.byteLength).toLocaleString()} bytes`, icoTargets[0].canvas],
  [`separate: ${icoSeparate.byteLength.toLocaleString()} bytes`, icoTargets[1].canvas]
])
```

With 24-byte vertices (position + normal) and 2-byte indices, the
indexed version uses **${((icoIndexed.vertices.byteLength + icoIndexed.indices.byteLength) / icoSeparate.byteLength * 100).toFixed(0)}%**
of the memory, even better than the ~50% from the unit-count analysis,
because an index is much smaller than a vertex.

Meshes loaded from files work the same way, with one complication: a
model file such as OBJ indexes positions, normals, and texture
coordinates **separately**, while the GPU has one index per vertex.
Loading OBJ and MTL files is covered in the Module 08 handout, where
texture coordinates come in.

### Scene graphs with dynamic offsets

The scene graph is traversed on the CPU, and every drawable node writes
its world matrix into **its own 256-byte slot** of one uniform buffer.
All `writeBuffer` calls happen before the GPU runs the pass, so reusing a
single slot would draw every node with the last matrix written. A bind
group layout with `hasDynamicOffset: true` selects each slot at draw
time:

**1. The slot size.** Dynamic offsets must be multiples of
`minUniformBufferOffsetAlignment`, which is 256 bytes on most devices.
Each node needs only 80 bytes (a matrix and a color), but each one gets
a full slot:

```js echo
const SLOT = Math.max(256, device.limits.minUniformBufferOffsetAlignment);
```

**2. A layout that allows a dynamic offset.** With `layout: "auto"`,
WebGPU cannot know that we want to change the offset at draw time, so
we write the bind group layout ourselves and set
`hasDynamicOffset: true`. The pipeline is the lit pipeline from before,
built with this layout:

```js echo
const dynamicLayout = device.createBindGroupLayout({entries: [{
  binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
  buffer: {type: "uniform", hasDynamicOffset: true}
}]});
const dynamicPipeline = device.createRenderPipeline({
  layout: device.createPipelineLayout({bindGroupLayouts: [dynamicLayout]}),
  vertex: {module: litModule, entryPoint: "vs_main", buffers: [vertexLayout]},
  fragment: {module: litModule, entryPoint: "fs_main", targets: [{format: canvasFormat}]},
  primitive: {topology: "triangle-list", cullMode: "back"},
  depthStencil: {format: "depth24plus", depthWriteEnabled: true, depthCompare: "less"}
});
```

**3. One buffer, one bind group.** The buffer holds `MAX_NODES` slots.
The bind group's `size: 80` is the **window** the shader sees. The
dynamic offset slides that window to a different slot for each draw:

```js echo
const MAX_NODES = 8;
const slotBuffer = device.createBuffer({size: SLOT * MAX_NODES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
const slotBindGroup = device.createBindGroup({layout: dynamicLayout, entries: [{binding: 0, resource: {buffer: slotBuffer, size: 80}}]});
```

**4. The shared sphere.** Every body is the same sphere mesh, uploaded
once. Only the matrix in each slot differs:

```js echo
const sphereGeo = geometry.createSphere(16, 20);
const sphereVB = makeVertexBuffer(geometry.interleave(sphereGeo.positions, sphereGeo.normals));
const sphereIB = makeIndexBuffer(sphereGeo.indices);
const solarTarget = makeCanvas(340);
const solarVP = mat4.multiply(mat4.perspective(0.84, 1, 0.1, 30), mat4.lookAt([0, 4.5, 7.5], [0, 0, 0], [0, 1, 0]));
```

```js echo
const solarForm = view(Inputs.form({
  earthOrbit: Inputs.range([0, 360], {value: 40, step: 1, label: "Earth orbit"}),
  earthSpin: Inputs.range([0, 360], {value: 0, step: 1, label: "Earth spin"}),
  moonOrbit: Inputs.range([0, 360], {value: 90, step: 1, label: "Moon orbit"})
}));
```

```js echo
const solarWorld = (() => {
  const r = (deg) => (deg * Math.PI) / 180;
  const node = (name, m, children = [], color = null) => Object.assign(new SceneNode(name, m, {children}), {color});
  const root = node("System", mat4.identity(), [
    node("Sun", mat4.scale(0.6, 0.6, 0.6), [], [1, 0.8, 0.2]),
    node("EarthPivot", mat4.rotateY(r(solarForm.earthOrbit)), [
      node("EarthOffset", mat4.translate(2.6, 0, 0), [
        node("Earth", mat4.multiply(mat4.rotateY(r(solarForm.earthSpin)), mat4.scale(0.32, 0.32, 0.32)), [], [0.3, 0.5, 0.9]),
        node("MoonPivot", mat4.rotateY(r(solarForm.moonOrbit)), [
          node("MoonOffset", mat4.translate(0.75, 0, 0), [node("Moon", mat4.scale(0.15, 0.15, 0.15), [], [0.65, 0.65, 0.65])])
        ])
      ])
    ])
  ]);
  const drawables = [];
  traverse(root, (n, world) => { if (n.color) drawables.push({name: n.name, world, color: n.color}); });
  return drawables;
})();
```

**5. Build the scene graph and collect the drawables.** In the cell
above, the pivot nodes (`EarthPivot`, `MoonPivot`) only rotate, and the
offset nodes only translate. Rotating a pivot therefore swings
everything below it around the parent's center. Only nodes with a
`color` are drawn. `traverse` (from `components/scenegraph.js`) hands
each one its world matrix, the product along its path from the root.

**6. Write all slots, then draw with a different offset each time.**
All the data goes up in **one** `writeBuffer` before the pass runs.
Each draw then selects its node's slot with `setBindGroup(0, group,
[offset])`:

```js echo
{
  // 1. Write every node's data into its own slot (all writes land before the pass runs).
  const staging = new Float32Array((SLOT / 4) * solarWorld.length);
  solarWorld.forEach((d, i) => staging.set([...mat4.multiply(solarVP, d.world), ...d.color, 1], (i * SLOT) / 4));
  device.queue.writeBuffer(slotBuffer, 0, staging);
  // 2. One bind group, a different dynamic offset per draw.
  const encoder = device.createCommandEncoder();
  const pass = beginPass(encoder, solarTarget);
  pass.setPipeline(dynamicPipeline);
  pass.setVertexBuffer(0, sphereVB);
  pass.setIndexBuffer(sphereIB, "uint16");
  solarWorld.forEach((d, i) => {
    pass.setBindGroup(0, slotBindGroup, [i * SLOT]);
    pass.drawIndexed(sphereGeo.indices.length);
  });
  pass.end();
  device.queue.submit([encoder.finish()]);
}
```

```js echo
captioned([[solarWorld.map((d) => `${d.name} at (${d.world[12].toFixed(2)}, ${d.world[14].toFixed(2)})`).join(" · "), solarTarget.canvas]])
```

Drag **Earth orbit**: the Moon follows, because `MoonPivot` hangs below
`EarthOffset`. Drag **Earth spin**: neither world position changes,
because the Moon is not a descendant of the spin transform.

## Object Instancing

The solar system above draws one sphere mesh several times, but it still
issues **one draw call per body** and needs one uniform slot per body.
That is fine for five objects. A room with a thousand chairs has
thousands of boxes, and they are all **the same box** in different
places and sizes.

An **instance** is a reference to a shared mesh plus **its own model
matrix** (and, optionally, a little more data, such as a color). The
mesh is uploaded **once**. All the per-instance records go in one
buffer, and a single **instanced draw call** renders every copy. This
section builds such a room step by step:

1. one unit cube, uploaded once;
2. one chair made of 6 transformed copies of that cube;
3. a grid of chairs, which gives one model matrix per box;
4. those matrices packed into an **instance buffer**;
5. a pipeline that reads the instance buffer once per instance;
6. one `drawIndexed` call that draws them all.

### Step 1: the unit cube

Every box in the room is this cube: side 1, centered at the origin, so
its corners are at ${tex`\pm\tfrac12`}. It has **24 vertices**, not 8,
because each face needs its own normal. A corner shared by three faces
appears three times, once with each face's normal. A vertex can be
shared only where **all** of its attributes agree, here both position
and normal.

For each face we know its normal ${tex`\mathbf n`} and two directions
${tex`\mathbf u`} and ${tex`\mathbf v`} that span it, chosen so that
${tex`\mathbf u \times \mathbf v = \mathbf n`}. The four corners
${tex`\tfrac12(\mathbf n \pm \mathbf u \pm \mathbf v)`}, listed in the
order below, are then **counterclockwise** when seen from outside, which
is the front face for back-face culling:

```js echo
const CUBE_FACES = [
  {n: [ 1, 0, 0], u: [0, 0, -1], v: [0, 1, 0]},   // +x
  {n: [-1, 0, 0], u: [0, 0,  1], v: [0, 1, 0]},   // -x
  {n: [0,  1, 0], u: [1, 0,  0], v: [0, 0, -1]},  // +y (top)
  {n: [0, -1, 0], u: [1, 0,  0], v: [0, 0,  1]},  // -y (bottom)
  {n: [0, 0,  1], u: [ 1, 0, 0], v: [0, 1, 0]},   // +z
  {n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0]}    // -z
];

function unitCube() {
  const vertices = [], indices = [];
  for (const {n, u, v} of CUBE_FACES) {
    const base = vertices.length / 6;                         // index of this face's first corner
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {   // counterclockwise
      const p = [0, 1, 2].map((k) => 0.5 * (n[k] + su * u[k] + sv * v[k]));
      vertices.push(...p, ...n);                              // position, then normal
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);  // two triangles
  }
  return {vertices: new Float32Array(vertices), indices: new Uint16Array(indices)};
}

const cube = unitCube();
```

The cube has ${cube.vertices.length / 6} vertices and
${cube.indices.length} indices. It is uploaded **once**. From here on we
use the two buffer helpers from the course library,
`reference/src/lib/webgpu.js`, the same ones the assignments use (they
are copied into `components/lib/webgpu.js`):

- `createBuffer(device, data, usage)` creates a buffer of the right size
  (rounded up to a multiple of 4 bytes), adds `COPY_DST`, and writes
  `data` into it.
- `new Mesh(device, {vertices, indices})` uploads a vertex buffer and an
  index buffer and remembers the index count and format (`uint16` or
  `uint32`, from the array type). `mesh.draw(pass, slot, instanceCount,
  firstInstance)` binds both buffers and calls
  `pass.drawIndexed(indexCount, instanceCount, 0, 0, firstInstance)`.
  The last two arguments default to 1 and 0, which draws one ordinary
  copy.

```js echo
const cubeMesh = new Mesh(device, cube);   // cube = {vertices, indices}
```

### Step 2: one chair from one cube

To turn the unit cube into a box of size ${tex`\mathbf s`} centered at
${tex`\mathbf c`}, **scale first, then translate**:

${tex.block`T = \text{translate}(\mathbf c)\;\text{scale}(\mathbf s)`}

Scaling first stretches the cube around its own center, which is the
origin. Translating second moves that center to ${tex`\mathbf c`}. In
the other order, the scale would also stretch the translation.
`mat4.multiply(A, B)` returns ${tex`AB`}, and ${tex`B`} is the one
applied to a point first:

```js echo
function boxTransform(center, size) {
  return mat4.multiply(mat4.translate(...center), mat4.scale(...size));
}
```

A chair is 6 boxes: a seat, 4 legs, and a backrest. All sizes are in
meters, in the chair's **own space**: the origin is on the floor under
the middle of the seat, ${tex`+y`} is up, and the backrest is on the
${tex`-z`} side:

```js echo
const CHAIR = {seat: 0.45, seatHeight: 0.45, seatThick: 0.04, leg: 0.04, backHeight: 0.4, backThick: 0.04};
```

Each part's center follows from those sizes:

- The **seat**'s top is at `seatHeight`, so its center is half a
  thickness lower.
- A **leg** runs from the floor to the bottom of the seat, so its height
  is `seatHeight − seatThick`, and its center is halfway up. The four
  legs sit at the seat's corners, pulled in by half a leg so they stay
  under it.
- The **backrest** stands on the back edge of the seat, so its center is
  half its height above the seat and half its thickness in from the
  edge.

```js echo
const LEG_HEIGHT = CHAIR.seatHeight - CHAIR.seatThick;
const LEG_OFFSET = CHAIR.seat / 2 - CHAIR.leg / 2;            // from the center to each leg's center
const BACK_Z = -(CHAIR.seat / 2 - CHAIR.backThick / 2);

const CHAIR_PARTS = [
  {role: "seat", transform: boxTransform([0, CHAIR.seatHeight - CHAIR.seatThick / 2, 0],
                                         [CHAIR.seat, CHAIR.seatThick, CHAIR.seat])},
  ...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => ({
    role: "leg", transform: boxTransform([sx * LEG_OFFSET, LEG_HEIGHT / 2, sz * LEG_OFFSET],
                                         [CHAIR.leg, LEG_HEIGHT, CHAIR.leg])})),
  {role: "back", transform: boxTransform([0, CHAIR.seatHeight + CHAIR.backHeight / 2, BACK_Z],
                                         [CHAIR.seat, CHAIR.backHeight, CHAIR.backThick])}
];
```

These 6 matrices are computed **once** and shared by every chair. We
can read each one back to check it. In a column-major matrix,
`m[12..14]` is the translation (the box's center), and for a
translate × scale matrix the diagonal `m[0], m[5], m[10]` is the size:

```js echo
Inputs.table(CHAIR_PARTS.map(({role, transform: m}, k) => ({
  part: `${k}: ${role}`,
  "center c": `(${m[12].toFixed(3)}, ${m[13].toFixed(3)}, ${m[14].toFixed(3)})`,
  "size s": `(${m[0].toFixed(3)}, ${m[5].toFixed(3)}, ${m[10].toFixed(3)})`
})))
```

### Step 3: many chairs, one list of instances

Chairs stand in a grid of `rows × cols`. The chair in row ${tex`i`},
column ${tex`j`} is moved into the room by a **placement** matrix
${tex`P_{ij}`}, a pure translation. Part ${tex`k`} of that chair then
has the model matrix

${tex.block`\text{model}_{ijk} = P_{ij}\,T_k`}

which is the scene-graph rule again: the product of the matrices on the
path room → chair → part → cube. The difference is that we **flatten**
the hierarchy into a plain list, because the GPU wants one matrix per
box.

First, the room's layout. Chairs are `SPACING` apart, and the grid is
centered on the origin. With ${tex`n`} chairs in a row, the first one
is ${tex`(n-1)/2`} spacings left of center:

```js echo
const SPACING = {x: 0.8, z: 0.9};   // chair center to chair center, in meters

function chairPlacement(row, col, rows, cols) {
  const x = (col - (cols - 1) / 2) * SPACING.x;
  const z = (row - (rows - 1) / 2) * SPACING.z;
  return mat4.translate(x, 0, z);                              // P_ij
}
```

Each instance also carries a **color**. Seats and legs share fixed
colors, and each chair's backrest gets its own color from a rainbow, so
you can see that per-instance data really is per instance:

```js echo
const PART_COLORS = {seat: [0.62, 0.42, 0.25], leg: [0.55, 0.57, 0.6], floor: [0.32, 0.33, 0.36]};

function rainbow(t) {
  const c = d3.rgb(d3.interpolateSinebow(t));
  return [c.r / 255, c.g / 255, c.b / 255];
}
```

Now the list itself. The two outer loops visit every chair. The inner
loop visits the chair's 6 parts and pushes one instance per part. So
chair ${tex`c`}'s parts are instances ${tex`6c`} through ${tex`6c+5`}.
The floor is one more instance at the end, a cube scaled into a thin
slab just under ${tex`y = 0`}:

```js echo
function buildRoomInstances(rows, cols) {
  const instances = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const placement = chairPlacement(row, col, rows, cols);
      const backColor = rainbow((row * cols + col) / (rows * cols));
      for (const part of CHAIR_PARTS) {
        instances.push({
          model: mat4.multiply(placement, part.transform),      // P_ij · T_k
          color: part.role === "back" ? backColor : PART_COLORS[part.role]
        });
      }
    }
  }
  const floorSize = [cols * SPACING.x + 0.6, 0.05, rows * SPACING.z + 0.6];
  instances.push({model: boxTransform([0, -0.025, 0], floorSize), color: PART_COLORS.floor});
  return instances;
}
```

### Step 4: packing the instance buffer

The GPU reads raw bytes, so the list becomes one `Float32Array` with a
fixed-size **record** per instance:

| floats | bytes | contents |
|---|---|---|
| 0–15 | 0–63 | the model matrix, column-major (column 0 first) |
| 16–18 | 64–75 | the color (r, g, b) |
| 19 | 76–79 | padding, so each record is a whole number of `vec4`s |

The record is 20 floats = 80 bytes. Instance ${tex`i`} starts at float
${tex`20i`}:

```js echo
const INSTANCE_FLOATS = 20;

function packInstances(instances) {
  const data = new Float32Array(instances.length * INSTANCE_FLOATS);
  instances.forEach(({model, color}, i) => {
    data.set(model, i * INSTANCE_FLOATS);          // floats 0..15
    data.set(color, i * INSTANCE_FLOATS + 16);     // floats 16..18; float 19 stays 0
  });
  return data;
}
```

Here is the record for instance 0, the seat of the first chair in a
3 × 4 room. The last column of the matrix (floats 12–14) is the seat's
center in the room:

```js echo
{
  const record = packInstances(buildRoomInstances(3, 4)).subarray(0, INSTANCE_FLOATS);
  const f = (a) => Array.from(a, (x) => x.toFixed(3).padStart(7)).join(" ");
  display(html`<pre>column 0  ${f(record.subarray(0, 4))}
column 1  ${f(record.subarray(4, 8))}
column 2  ${f(record.subarray(8, 12))}
column 3  ${f(record.subarray(12, 16))}   ← translation (x, y, z, 1)
color     ${f(record.subarray(16, 20))}   ← r, g, b, padding</pre>`);
}
```

### Step 5: a pipeline with two vertex buffers

The vertex shader receives **two kinds** of inputs:

- **Per-vertex** data from the cube (slot 0): position and normal. These
  change for every vertex.
- **Per-instance** data from the instance buffer (slot 1): the model
  matrix and the color. These stay the same for all 36 vertices of one
  box and change only when the next box starts.

A vertex attribute can hold at most 4 floats (`float32x4`), so a 4 × 4
matrix arrives as **4 separate attributes**, one per column, at
`@location(2)` through `@location(5)`. The shader puts them back
together with `mat4x4<f32>(m0, m1, m2, m3)`, which takes columns in
order, matching the column-major layout in the buffer.

Next, the **normal**. Normals transform by the inverse transpose
${tex`(M^{-1})^T`} of the upper 3 × 3 part, and WGSL has no `inverse()`.
Every model matrix here is translate × scale (a placement could also
rotate), so the upper 3 × 3 is ${tex`L = RS`}, and the length of its
column ${tex`k`} is the scale ${tex`s_k`}. Then

${tex.block`(M^{-1})^T\,\mathbf n = R\,S^{-1}\mathbf n = (RS)\,S^{-2}\mathbf n = L\,(\mathbf n / \mathbf s^2)`}

so we divide the normal by ${tex`\mathbf s^2`} and multiply by ${tex`L`}.
No inverse is needed. The fragment shader normalizes the result.

```js echo
const instancingShader = device.createShaderModule({code: `
struct Camera { viewProj: mat4x4<f32>, lightDir: vec4<f32> };
@group(0) @binding(0) var<uniform> camera: Camera;

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) normal: vec3<f32>,
  @location(1) color: vec3<f32>,
};

@vertex
fn vs_main(
  @location(0) position: vec3<f32>,   // slot 0: per vertex
  @location(1) normal: vec3<f32>,
  @location(2) m0: vec4<f32>,         // slot 1: per instance, the 4 columns of the model matrix
  @location(3) m1: vec4<f32>,
  @location(4) m2: vec4<f32>,
  @location(5) m3: vec4<f32>,
  @location(6) color: vec4<f32>,
) -> VertexOut {
  let model = mat4x4<f32>(m0, m1, m2, m3);
  let linear = mat3x3<f32>(m0.xyz, m1.xyz, m2.xyz);
  let s = vec3<f32>(length(m0.xyz), length(m1.xyz), length(m2.xyz));

  var out: VertexOut;
  out.position = camera.viewProj * model * vec4<f32>(position, 1.0);
  out.normal = linear * (normal / (s * s));   // = (M^-1)^T n for translate * rotate * scale
  out.color = color.rgb;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  let ndotl = max(dot(normalize(in.normal), normalize(camera.lightDir.xyz)), 0.0);
  return vec4<f32>(in.color * (0.3 + 0.7 * ndotl), 1.0);
}`});
```

We can check the normal formula on the CPU with a matrix that also
rotates. The shader's shortcut and the full inverse transpose point the
same way:

```js echo
{
  const M = mat4.multiplyAll([mat4.translate(1, 2, 3), mat4.rotateY(0.7), mat4.scale(1.6, 0.05, 0.8)]);
  const n = [0.6, 0.8, 0];                                        // a slanted object-space normal
  const unit = (v) => v.map((x) => x / Math.hypot(...v));
  const col = (k) => [M[4 * k], M[4 * k + 1], M[4 * k + 2]];
  const s = [0, 1, 2].map((k) => Math.hypot(...col(k)));
  const shortcut = [0, 1, 2].map((r) => [0, 1, 2].reduce((sum, k) => sum + col(k)[r] * n[k] / s[k] ** 2, 0));
  const full = mat4.multiplyVec4(mat4.transpose(mat4.invert(M)), [...n, 0]).slice(0, 3);
  const naive = mat4.multiplyVec4(M, [...n, 0]).slice(0, 3);       // wrong: M itself
  const f = (v) => unit(v).map((x) => x.toFixed(4).padStart(8)).join(" ");
  display(html`<pre>L (n / s²)      ${f(shortcut)}
(M⁻¹)ᵀ n        ${f(full)}
M n  (wrong)    ${f(naive)}</pre>`);
}
```

Now the pipeline. The `buffers` array describes the two slots. The only
new field is **`stepMode`**:

- `"vertex"` (the default) moves to the next record for **every
  vertex**.
- `"instance"` moves to the next record only when a **new instance**
  starts.

The `offset` of each attribute is its byte position inside one record,
and `arrayStride` is the size of the whole record. Both match the table
in step 4:

```js echo
const instancingPipeline = device.createRenderPipeline({
  layout: "auto",
  vertex: {
    module: instancingShader,
    entryPoint: "vs_main",
    buffers: [
      {                                                   // slot 0: the cube
        arrayStride: 6 * 4,
        attributes: [
          {shaderLocation: 0, offset: 0, format: "float32x3"},       // position
          {shaderLocation: 1, offset: 3 * 4, format: "float32x3"}    // normal
        ]
      },
      {                                                   // slot 1: the instances
        arrayStride: INSTANCE_FLOATS * 4,                 // 80 bytes per record
        stepMode: "instance",
        attributes: [
          {shaderLocation: 2, offset: 0, format: "float32x4"},       // model column 0
          {shaderLocation: 3, offset: 4 * 4, format: "float32x4"},   // model column 1
          {shaderLocation: 4, offset: 8 * 4, format: "float32x4"},   // model column 2
          {shaderLocation: 5, offset: 12 * 4, format: "float32x4"},  // model column 3
          {shaderLocation: 6, offset: 16 * 4, format: "float32x4"}   // color + padding
        ]
      }
    ]
  },
  fragment: {module: instancingShader, entryPoint: "fs_main", targets: [{format: canvasFormat}]},
  primitive: {topology: "triangle-list", cullMode: "back"},
  depthStencil: {format: "depth24plus", depthWriteEnabled: true, depthCompare: "less"}
});
```

The camera uniform (a view-projection matrix and a light direction) is
the same for every instance, so it stays a normal uniform buffer with
one bind group:

```js echo
const roomCamera = device.createBuffer({size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
const roomBindGroup = device.createBindGroup({
  layout: instancingPipeline.getBindGroupLayout(0),
  entries: [{binding: 0, resource: {buffer: roomCamera}}]
});
const roomTarget = makeCanvas(420);
```

### Step 6: one draw call for the whole room

Choose the room size, then the draw mode and camera angle. They are
separate forms so that orbiting the camera does not rebuild the
instance buffer:

```js echo
const roomSize = view(Inputs.form({
  rows: Inputs.range([1, 60], {value: 8, step: 1, label: "rows of chairs"}),
  cols: Inputs.range([1, 60], {value: 10, step: 1, label: "chairs per row"})
}));
```

```js echo
const roomView = view(Inputs.form({
  mode: Inputs.radio(["instanced (1 draw call)", "one draw call per box"], {value: "instanced (1 draw call)", label: "draw mode"}),
  azimuth: Inputs.range([-180, 180], {value: 30, step: 1, label: "orbit azimuth"})
}));
```

When the room size changes, we rebuild the instance list, pack it, and
upload it with `createBuffer`. Its usage is `VERTEX`, because it is
bound with `setVertexBuffer`, just like the cube's vertices. `invalidation`
is Observable's signal that this cell is about to run again, so the old
buffer is destroyed instead of leaking:

```js echo
const roomInstances = buildRoomInstances(roomSize.rows, roomSize.cols);
const instanceBuffer = createBuffer(device, packInstances(roomInstances), GPUBufferUsage.VERTEX);
invalidation.then(() => instanceBuffer.destroy());
```

The camera orbits the room's center at a distance that grows with the
room, so the whole grid stays in view:

```js echo
const roomViewProj = (() => {
  const extent = Math.max(roomSize.cols * SPACING.x, roomSize.rows * SPACING.z);
  const dist = 0.9 * extent + 2, az = (roomView.azimuth * Math.PI) / 180, el = 0.6;
  const eye = [dist * Math.cos(el) * Math.sin(az), dist * Math.sin(el), dist * Math.cos(el) * Math.cos(az)];
  return mat4.multiply(mat4.perspective(0.8, 1, 0.1, 4 * dist), mat4.lookAt(eye, [0, 0.3, 0], [0, 1, 0]));
})();
```

Finally, the draw. We bind the instance buffer to slot 1 ourselves.
`cubeMesh.draw` binds the cube to slot 0, binds its index buffer, and
issues the draw call:

- **Instanced:** `cubeMesh.draw(pass, 0, instanceCount)` becomes
  `drawIndexed(36, instanceCount)`: 36 indices, `instanceCount` times.
  The GPU runs the vertex shader ${tex`36 \times`} `instanceCount`
  times. Slot 0 restarts at the cube's first vertex for every instance,
  and slot 1 moves to the next record.
- **One call per box:** the loop calls `cubeMesh.draw(pass, 0, 1, i)`,
  which becomes `drawIndexed(36, 1, 0, 0, i)`. The last argument,
  `firstInstance`, tells slot 1 which record to start at, so draw
  ${tex`i`} reads record ${tex`i`}. It draws the same picture with the
  same buffers, one box per call.

We time only the **encoding** on the CPU, which is the part that grows
with the number of draw calls:

```js echo
const roomStats = (() => {
  device.queue.writeBuffer(roomCamera, 0, new Float32Array([...roomViewProj, 0.4, 0.9, 0.5, 0]));
  const encoder = device.createCommandEncoder();
  const pass = beginPass(encoder, roomTarget);
  const t0 = performance.now();
  pass.setPipeline(instancingPipeline);
  pass.setBindGroup(0, roomBindGroup);
  pass.setVertexBuffer(1, instanceBuffer);         // per instance (slot 1)
  const count = roomInstances.length;
  let drawCalls;
  if (roomView.mode.startsWith("instanced")) {
    cubeMesh.draw(pass, 0, count);                 // every box, one call
    drawCalls = 1;
  } else {
    for (let i = 0; i < count; i++) cubeMesh.draw(pass, 0, 1, i);   // firstInstance = i
    drawCalls = count;
  }
  const encodeMs = performance.now() - t0;
  pass.end();
  device.queue.submit([encoder.finish()]);
  return {count, drawCalls, encodeMs};
})();
```

```js echo
captioned([[`${roomSize.rows * roomSize.cols} chairs → ${roomStats.count.toLocaleString()} cube instances, ${roomStats.drawCalls.toLocaleString()} draw call(s), ${roomStats.encodeMs.toFixed(2)} ms to encode`, roomTarget.canvas]])
```

Set the room to 60 × 60 (21,601 boxes) and switch modes. The picture
does not change, but the encoding time does: thousands of draw calls
cost CPU time to record and validate, and one instanced call costs
almost nothing. **Instancing moves the per-object loop from the CPU,
as draw calls, to the GPU, as instances.**

### Alternative: a storage buffer and `instance_index`

The instance records can also live in a **storage buffer** that the
shader indexes itself. The vertex shader receives
`@builtin(instance_index)`, the number of the instance being drawn, and
reads `instances[i]`. Nothing is declared in the pipeline's `buffers`,
because the records are not vertex attributes.

Below, ${tex`n^3`} spheres of one icosphere mesh are drawn this way.
**The shader** declares the record as a WGSL `struct` and the buffer as
an `array` of them:

```js echo
const storageInstancingShader = device.createShaderModule({code: `
struct Instance { model: mat4x4<f32>, color: vec4<f32> };
@group(0) @binding(0) var<uniform> viewProj: mat4x4<f32>;
@group(0) @binding(1) var<storage, read> instances: array<Instance>;

struct VertexOut { @builtin(position) position: vec4<f32>, @location(0) normal: vec3<f32>, @location(1) color: vec3<f32> };

@vertex
fn vs_main(@location(0) inPos: vec3<f32>, @location(1) inNormal: vec3<f32>,
           @builtin(instance_index) i: u32) -> VertexOut {
  let inst = instances[i];
  var out: VertexOut;
  out.position = viewProj * inst.model * vec4<f32>(inPos, 1.0);
  out.normal = (inst.model * vec4<f32>(inNormal, 0.0)).xyz;   // uniform scale: no correction needed
  out.color = inst.color.rgb;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  let ndotl = max(dot(normalize(in.normal), normalize(vec3<f32>(0.4, 0.8, 0.5))), 0.0);
  return vec4<f32>(in.color * (0.35 + 0.65 * ndotl), 1.0);
}`});
```

**The pipeline** has only the per-vertex buffer (slot 0). The sphere is
uploaded once, as a `Mesh`:

```js echo
const storagePipeline = device.createRenderPipeline({
  layout: "auto",
  vertex: {module: storageInstancingShader, entryPoint: "vs_main", buffers: [vertexLayout]},
  fragment: {module: storageInstancingShader, entryPoint: "fs_main", targets: [{format: canvasFormat}]},
  primitive: {topology: "triangle-list", cullMode: "back"},
  depthStencil: {format: "depth24plus", depthWriteEnabled: true, depthCompare: "less"}
});
const storageVP = device.createBuffer({size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST});
const storageTarget = makeCanvas(340);
const instIco = icosphere(2);
const instIcoMesh = new Mesh(device, {
  vertices: packInterleaved(instIco.positions, instIco.positions),   // a unit sphere's normal is its position
  indices: new Uint16Array(instIco.faces.flat())
});
```

```js echo
const instanceCountForm = view(Inputs.range([2, 16], {value: 6, step: 1, label: "spheres per axis (n → n³ instances)"}));
```

**The records** are the same 20 floats as before: a matrix and a color.
The three nested loops place the spheres on an
${tex`n \times n \times n`} grid and color each one by its grid
position:

```js echo
const sphereGrid = (() => {
  const n = instanceCountForm, half = (n - 1) / 2, count = n ** 3;
  const data = new Float32Array(count * 20);
  let k = 0;
  for (let ix = 0; ix < n; ix++) for (let iy = 0; iy < n; iy++) for (let iz = 0; iz < n; iz++) {
    data.set(mat4.multiply(mat4.translate(ix - half, iy - half, iz - half), mat4.scale(0.35, 0.35, 0.35)), k * 20);
    data.set([ix / (n - 1), iy / (n - 1), iz / (n - 1), 1], k * 20 + 16);
    k++;
  }
  return {n, count, data};
})();
```

**The draw.** The records go into a buffer with `STORAGE` usage, bound
at `@binding(1)`. There is no second `setVertexBuffer`. The draw call is
the same `mesh.draw(pass, 0, instanceCount)`:

```js echo
{
  const {n, count, data} = sphereGrid;
  const storage = createBuffer(device, data, GPUBufferUsage.STORAGE);
  invalidation.then(() => storage.destroy());
  const dist = n * 1.9 + 2;
  device.queue.writeBuffer(storageVP, 0, mat4.multiply(mat4.perspective(0.73, 1, 0.1, 200), mat4.lookAt([dist * 0.6, dist * 0.5, dist * 0.7], [0, 0, 0], [0, 1, 0])));
  const bindGroup = device.createBindGroup({layout: storagePipeline.getBindGroupLayout(0), entries: [
    {binding: 0, resource: {buffer: storageVP}}, {binding: 1, resource: {buffer: storage}}]});
  const encoder = device.createCommandEncoder();
  const pass = beginPass(encoder, storageTarget);
  pass.setPipeline(storagePipeline);
  pass.setBindGroup(0, bindGroup);
  instIcoMesh.draw(pass, 0, count);
  pass.end();
  device.queue.submit([encoder.finish()]);
}
```

```js echo
captioned([[`${sphereGrid.count} instances, 1 draw call: drawIndexed(${instIcoMesh.indexCount}, ${sphereGrid.count})`, storageTarget.canvas]])
```

| | Instance vertex buffer | Storage buffer |
|---|---|---|
| Data arrives as | vertex attributes (`@location`) | array reads (`instances[i]`) |
| Record layout is set by | the pipeline's `buffers` | a WGSL `struct` |
| Good for | small, fixed records | large or variable records, or records written by a compute shader |

Scene graphs and instancing solve different problems. A scene graph
organizes **different** parts that move relative to each other.
Instancing draws **many identical** parts cheaply. The room above uses
both ideas: the chair's parts form a small hierarchy, and that hierarchy
is flattened into a list of instances.

## Check Your Understanding

1. A mesh has an edge used by three triangles. Is it manifold? Can it be consistently oriented?
2. Why does an indexed mesh need about half the storage of separate triangles in a large mesh?
3. How many indices does a strip of 10 triangles need? An indexed triangle list?
4. In the triangle-neighbor traversal, why can the next edge be found as `(i + 1) mod 3` without a search?
5. What check does the winged-edge structure need at every step that the half-edge structure avoids?
6. In the ferry scene graph, which matrix is on top of the stack while the right wheel is drawn?
7. A box has `scale(2, 0.1, 1)` and its center at ${tex`(0, 3, 0)`}. Write its model matrix as a product of two matrices. Why does the order matter?
8. A chair's leg has model matrix ${tex`P_{ij}T_k`}. Which factor is shared by all 6 parts of one chair, and which is shared by the same part of every chair?
9. An instance record is 20 floats. At what byte offset does the record for instance 37 start, and where is its color?
10. With `stepMode: "instance"`, how many times does the vertex shader run for `drawIndexed(36, 500)`, and how many different model matrices does it see?
11. Why does the model matrix arrive as four `float32x4` attributes instead of one?
12. Using `model * n` for normals looks correct for every face of a scaled cube. Why? When does it fail?

<details>
<summary>Answers</summary>

1. No. An edge shared by three triangles violates the first manifold condition, and such a mesh cannot be oriented consistently.
2. Each vertex touches about 6 triangles, so ${tex`n_t \approx 2n_v`}, which gives ${tex`18n_v`} vs. ${tex`9n_v`} units.
3. 12 indices for the strip vs. 30 for a triangle list.
4. Each neighbor reference also records which of the neighbor's edges was crossed, so we know which edge we entered through.
5. Whether we arrived at the edge from its head or its tail, which decides between `lprev` and `rprev`. Half-edges are already oriented, so `h.pair.next` needs no check.
6. ${tex`M_0M_1M_3`}. ${tex`M_2`} was popped after the left wheel was drawn.
7. ${tex`\text{translate}(0,3,0)\,\text{scale}(2,0.1,1)`}. The scale is applied first, around the cube's center at the origin. In the other order, the scale would also scale the translation and move the center to ${tex`(0, 0.3, 0)`}.
8. ${tex`P_{ij}`} is shared by all parts of chair ${tex`(i,j)`}. ${tex`T_k`} is shared by part ${tex`k`} of every chair.
9. Byte ${tex`37 \times 80 = 2960`}. Its color starts 64 bytes later, at byte 3024.
10. ${tex`36 \times 500 = 18{,}000`} times. It sees 500 matrices, one per instance: all 36 vertices of an instance read the same record.
11. A vertex attribute holds at most 4 components. The shader rebuilds the matrix from its 4 columns with `mat4x4<f32>(m0, m1, m2, m3)`.
12. A cube's normals point along the axes, and scaling an axis-aligned vector only changes its length, which normalizing undoes. A slanted normal (a sphere, a smooth OBJ) tilts the wrong way, so use ${tex`(M^{-1})^T`}, or ${tex`L\,(\mathbf n/\mathbf s^2)`} when there is no shear.

</details>

## Common Pitfalls

- **Testing only edges for manifoldness.** A bowtie vertex passes the
  edge test. Count the fans at each vertex too.
- **Mixing orientations.** One reversed face makes its normal point
  inward and makes back-face culling remove it.
- **Skipping the parent's matrix** in a scene-graph traversal, or failing
  to pop, so that a sibling inherits the previous sibling's transform.
- **Reusing one uniform slot** for every node. `writeBuffer` calls all
  land before the pass runs, so every node is drawn with the last matrix.
  Use one slot per node, aligned to 256 bytes.
- **Translating before scaling** a part. `scale · translate` scales the
  offset too, so the part ends up in the wrong place. Build each box as
  `translate(center) · scale(size)`.
- **Forgetting `stepMode: "instance"`.** The instance buffer then
  advances once per vertex, and each vertex of a box reads a different
  record.
- **Mismatched record layout.** `arrayStride` and every attribute
  `offset` must match how the `Float32Array` was packed (here 80 bytes
  per record, color at byte 64).
- **Transforming normals by `model`.** Use ${tex`(M^{-1})^T`}, or
  ${tex`L\,(\mathbf n/\mathbf s^2)`} for translate · rotate · scale.
- **Using the wrong Catmull–Clark weight.** The vertex rule is
  ${tex`(n-3)P`}; ${tex`(n-2)P`} does not sum to 1 and inflates the mesh.

## Summary

- **Meshes:** manifolds have two triangles per edge and one fan per vertex.
  Consistent orientation means no directed edge is used twice. An indexed
  mesh halves storage, strips and fans shrink the indices further, and the
  triangle-neighbor, winged-edge, and half-edge structures answer
  adjacency queries in constant time. Catmull–Clark subdivision depends
  on those queries.
- **Scene graphs:** an object's matrix is the product along its path from
  the root, kept by a matrix stack during a recursive traversal.
- **WebGPU:** indexed buffers with `drawIndexed` and per-node uniform
  slots with dynamic offsets.
- **Object instancing:** one mesh is uploaded once, and each copy is a
  record holding its model matrix ${tex`P_{ij}T_k`} and a color. The
  records go in a vertex buffer with `stepMode: "instance"` (or a storage
  buffer read with `instance_index`), and one
  `drawIndexed(indexCount, instanceCount)` draws them all.
