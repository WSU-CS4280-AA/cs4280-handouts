---
title: Module 07 — Meshes and Scene Graphs
toc: true
---

```js
import * as d3 from "npm:d3";
import * as mat4 from "./lib/math/mat4.js";
import * as transforms from "./lib/math/transforms.js";
import * as mat3 from "./components/mat3.js";
import * as geometry from "./components/geometry.js";
import * as mesh from "./components/mesh.js";
import * as subdivision from "./components/subdivision.js";
import {SceneNode, traverse} from "./components/scenegraph.js";
import {initializeWebGPU, createBuffer, Mesh} from "./lib/webgpu.js";
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
113+**. The code is part of the reading: each structure is built in small, tested
steps, while the code that only draws the demos stays out of sight. This handout teaches the
*techniques* behind the module; it is not a walkthrough of any graded
assignment.

## Triangle Meshes

A **triangle mesh** is a network of triangles connected through shared
vertices and edges. We need a test mesh with predictable connectivity.
An **icosahedron** has 12 vertices and 20 triangles. Splitting every
triangle into four and pushing the new vertices onto the unit sphere
gives an **icosphere**: a closed, manifold mesh at any resolution.

```js
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
```

`icosahedron()` returns its 12 unit-length corners and 20 faces, as `{x, y, z}`
positions and triples of indices. To refine it, we need points on the sphere
halfway along each edge. A plain midpoint falls inside the sphere, so we push it
back out by normalizing it:

```js echo
function sphereMidpoint(a, b) {
  const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2, z = (a.z + b.z) / 2;
  const l = Math.hypot(x, y, z);
  return {x: x / l, y: y / l, z: z / l};
}
```

Two triangles share every edge, and both will ask for that edge's midpoint. If
each got its own copy, the triangles would no longer be connected. So
`midpointFinder` remembers the midpoints in a `Map`, with a key that lists the
smaller index first, and only creates a vertex the first time. It returns the
vertex's index:

```js echo
function midpointFinder(P) {
  const found = new Map();
  return (a, b) => {
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    if (!found.has(key)) {
      found.set(key, P.push(sphereMidpoint(P[a], P[b])) - 1);
    }
    return found.get(key);
  };
}
```

One refinement step then replaces each triangle with four: one at each corner,
and one in the middle made from the three midpoints. Each keeps the corner order
of the original, so the orientation is preserved:

```js echo
function refineIcosphere({positions, faces}) {
  const P = positions.slice(), mid = midpointFinder(P);
  const F = faces.flatMap(([a, b, c]) => {
    const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
    return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]];
  });
  return {positions: P, faces: F};
}
```

An icosphere is that step, repeated:

```js echo
function icosphere(levels) {
  let m = icosahedron();
  for (let k = 0; k < levels; k++) m = refineIcosphere(m);
  return m;
}
```

Each level multiplies the triangle count by 4, so two levels should give
${tex`20 \times 4^2 = 320`} triangles. Euler's formula for a closed sphere then
gives ${tex`V = F/2 + 2 = 162`} vertices. Without the `Map`, there would be 960:

```js echo
[icosphere(2).faces.length, icosphere(2).positions.length]
```

### Topology: manifolds

**Topology** is how the triangles connect, ignoring where the vertices
are. A mesh is a **manifold** if

1. every edge is shared by **exactly two** triangles, and
2. every vertex has **a single, complete loop** of triangles around it.

`mesh.checkManifold` (in `components/mesh.js`) tests condition 1 by
counting the faces on each edge. Condition 2 needs a different test: a
"bowtie" vertex can pass the edge test and still have **two separate
fans**. We count the edge-connected fans at each vertex in four steps.

**Step 1: list the faces around every vertex.** One pass over the faces
appends each face's index to the list of each of its corners:

```js echo
function facesAroundVertices(faces, vertexCount) {
  const around = Array.from({length: vertexCount}, () => []);
  faces.forEach((face, i) => face.forEach((v) => around[v].push(i)));
  return around;
}
```

**Step 2: a union–find structure.** We need to merge faces into groups. Every
face starts as its own group. `find` follows `parent` links up to the face that
is its own parent, which names the group. `merge` points one group's name at the
other's:

```js echo
function makeUnionFind(items) {
  const parent = new Map(items.map((f) => [f, f]));
  const find = (f) => (parent.get(f) === f ? f : find(parent.get(f)));
  const merge = (f, g) => parent.set(find(f), find(g));
  return {find, merge};
}
```

**Step 3: group one vertex's faces into fans.** A face around ${tex`v`} has two
edges that touch ${tex`v`}, leading to the corners on either side of it:

```js echo
function cornersBeside(face, v) {
  const k = face.indexOf(v), n = face.length;
  return [face[(k + 1) % n], face[(k - 1 + n) % n]];
}
```

Two faces belong to the same fan when they share one of those edges. The map
`first` remembers the first face seen on each edge ${tex`(v, w)`}. When a second
face uses the same edge, the two groups merge. At the end, the number of distinct
group names is the number of fans:

```js echo
function countFans(faces, v, facesOfV) {
  const {find, merge} = makeUnionFind(facesOfV), first = new Map();
  for (const f of facesOfV) for (const w of cornersBeside(faces[f], v)) {
    if (first.has(w)) merge(f, first.get(w));
    else first.set(w, f);
  }
  return new Set(facesOfV.map(find)).size;
}
```

**Step 4: do this for every vertex.** A manifold vertex, or a manifold
vertex on a boundary, has exactly one fan:

```js echo
function vertexFanCounts(faces, vertexCount) {
  return facesAroundVertices(faces, vertexCount).map(
    (facesOfV, v) => countFans(faces, v, facesOfV)
  );
}
```

Try it on the bowtie, two triangles that touch only at vertex 0. Vertex 0 should
report 2 fans and the other four should report 1:

```js echo
vertexFanCounts([[0, 1, 2], [0, 3, 4]], 5)
```

Three small meshes test both conditions. The tetrahedron is closed and
manifold. The second copy has one face **duplicated**, a common
export glitch that puts three faces on several edges. The third is the bowtie:

```js
const tetraPositions = [{x: 0, y: 1.2, z: 0}, {x: -1, y: -0.6, z: 1}, {x: 1, y: -0.6, z: 1}, {x: 0, y: -0.6, z: -1.2}];
const tetraFaces = [[0, 1, 2], [0, 2, 3], [0, 3, 1], [1, 3, 2]];
const testMeshes = {
  "tetrahedron": {faces: tetraFaces, nv: 4},
  "tetrahedron + duplicated face": {faces: [...tetraFaces, [0, 1, 2]], nv: 4},
  "bowtie (two triangles meeting at vertex 0)": {faces: [[0, 1, 2], [0, 3, 4]], nv: 5}
};
```

```js
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
twice. First, list a face's directed edges:

```js echo
const directedEdges = (f) =>
  f.map((a, k) => `${a}→${f[(k + 1) % f.length]}`);
```

The check records which face first used each directed edge and reports any repeat:

```js echo
function orientationConflicts(faces) {
  const seen = new Map(), conflicts = [];
  faces.forEach((f, i) => directedEdges(f).forEach((key) => {
    if (seen.has(key)) conflicts.push(`${seen.get(key)} & ${i}: ${key}`);
    else seen.set(key, i);
  }));
  return conflicts;
}
```

Two triangles sharing the edge between vertices 1 and 2 are consistent when they
use it in opposite directions, so this should find no conflicts:

```js echo
orientationConflicts([[0, 1, 2], [2, 1, 3]])
```

If both run ${tex`1 \to 2`}, it should report that edge:

```js echo
orientationConflicts([[0, 1, 2], [1, 2, 3]])
```

Below, the slider flips one face of the icosahedron by swapping two of its corners:

```js
const flipFace = view(Inputs.range([-1, 19], {value: -1, step: 1, label: "flip icosahedron face (−1 = none)"}));
```

```js echo
const flippedIco = icosahedron().faces.map(
  (f, i) => (i === flipFace ? [f[0], f[2], f[1]] : f)
);
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
vertex touches about six triangles. In the units above, the two costs are:

```js echo
const separateUnits = (m) => 9 * m.faces.length;
const indexedUnits = (m) => 3 * m.positions.length + 3 * m.faces.length;
```

At level 4, the indexed form should already be very close to half the size:

```js echo
indexedUnits(icosphere(4)) / separateUnits(icosphere(4))
```

The table repeats this for each level:

```js
Inputs.table(d3.range(0, 6).map((level) => {
  const m = icosphere(level);
  const nv = m.positions.length, nt = m.faces.length;
  return {
    level, "vertices nᵥ": nv, "triangles nₜ": nt, "nₜ / nᵥ": nt / nv,
    "separate 9nₜ": separateUnits(m), "indexed 3nᵥ + 3nₜ": indexedUnits(m),
    "indexed / separate": indexedUnits(m) / separateUnits(m)
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
is reversed so that the orientation stays consistent. In code, an odd
triangle swaps its first two corners:

```js echo
function stripToTriangles(s) {
  const tris = [];
  for (let i = 0; i + 2 < s.length; i++) {
    const [a, b, c] = s.slice(i, i + 3);
    tris.push(i % 2 === 0 ? [a, b, c] : [b, a, c]);
  }
  return tris;
}
```

A **fan** shares its first vertex, so every triangle starts with `s[0]`:

```js echo
function fanToTriangles(s) {
  const tris = [];
  for (let i = 1; i + 1 < s.length; i++) tris.push([s[0], s[i], s[i + 1]]);
  return tris;
}
```

Here are both on short lists. The strip uses the orientation check from above,
which should find no conflicts:

```js
const stripTris = stripToTriangles([0, 1, 2, 3, 4, 5, 6, 7]);
```

- Strip `[0 1 2 3 4 5 6 7]` → ${stripTris.map((t) => `(${t.join(",")})`).join(" ")}, with ${orientationConflicts(stripTris).length} orientation conflicts.
- Fan `[0 1 2 3 4 5]` → ${fanToTriangles([0, 1, 2, 3, 4, 5]).map((t) => `(${t.join(",")})`).join(" ")}.

Relative to an indexed mesh, a strip of length ${tex`n`} stores
${tex`(n+2)/(3n)`} as many indices. Most of the saving comes from short
strips:

```js
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
${tex`t`}** runs from corner ${tex`i`} to corner ${tex`i+1`}. The first step
records every **directed** edge `"a,b"` and the `{t, i}` that owns it, along with
the vertex it leaves from:

```js echo
function directedEdgeOwners(faces) {
  const owner = new Map();
  faces.forEach((f, t) => f.forEach((a, i) => {
    owner.set(`${a},${f[(i + 1) % 3]}`, {t, i, from: a});
  }));
  return owner;
}
```

In a consistently oriented mesh, the neighbor across ${tex`a \to b`} is the
triangle that runs the same edge the other way, ${tex`b \to a`}. So looking up the
**reversed** key gives the neighbor and which of its edges is shared. A boundary
edge has no reverse and gets `null`. For `vEdge`, we keep the first edge found that
leaves each vertex:

```js echo
function buildTriangleNeighbors(faces, vertexCount) {
  const owner = directedEdgeOwners(faces);
  const tNbr = faces.map((f) => f.map((a, i) =>
    owner.get(`${f[(i + 1) % 3]},${a}`) ?? null));
  const vEdge = new Array(vertexCount).fill(null);
  for (const e of owner.values()) vEdge[e.from] ??= e;
  return {tNbr, vEdge};
}
```

To walk around vertex ${tex`v`}, start on an edge `{t, i}` that leaves
${tex`v`}. Crossing it with `tNbr[t][i]` lands on edge `{t', i'}` of the
neighbor, which runs **into** ${tex`v`}. In that triangle, the next edge,
${tex`i'+1`}, leaves ${tex`v`} again, so we are ready for the next step
with **no search**:

```js echo
function crossToNextEdge(tNbr, {t, i}) {
  const across = tNbr[t][i];
  return {t: across.t, i: (across.i + 1) % 3};
}
```

The walk repeats that step until it returns to the starting triangle:

```js echo
function trianglesOfVertex({tNbr, vEdge}, v) {
  const start = vEdge[v], visited = [start.t];
  let edge = crossToNextEdge(tNbr, start);
  for (; edge.t !== start.t; edge = crossToNextEdge(tNbr, edge)) {
    visited.push(edge.t);
  }
  return visited;
}
```

Every vertex of an icosahedron touches exactly 5 triangles, so a walk around
vertex 0 should visit 5:

```js echo
trianglesOfVertex(buildTriangleNeighbors(icosahedron().faces, 12), 0)
```

On a finer icosphere, the slider chooses which vertex to walk around:

```js
const icoLevel = view(Inputs.range([0, 3], {value: 1, step: 1, label: "icosphere level"}));
```

```js
const icoMesh = icosphere(icoLevel);
const icoNeighbors = buildTriangleNeighbors(icoMesh.faces, icoMesh.positions.length);
const invariantHolds = icoNeighbors.tNbr.every((row, t) => row.every((r) => icoNeighbors.tNbr[r.t][r.i].t === t));
```

```js
// Default to the vertex that faces the camera most directly.
const facingVertex = d3.maxIndex(icoMesh.positions, (p) => p.x * 2.2 + p.y * 1.6 + p.z * 2.6);
const queryVertex = view(Inputs.range([0, icoMesh.positions.length - 1], {value: facingVertex, step: 1, label: "query vertex v"}));
```

```js
const fanOfQuery = trianglesOfVertex(icoNeighbors, queryVertex);
```

```js
(() => {
  const size = 320;
  const eye = [2.2, 1.6, 2.6];
  const mvp = mat4.multiply(transforms.perspective(0.75, 1, 0.1, 10), transforms.lookAt(eye, [0, 0, 0], [0, 1, 0]));
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
  const edges = [], index = new Map();   // edgeKey -> position in edges
  faces.forEach((f, fi) => f.forEach((a, k) => {
    const b = f[(k + 1) % f.length], key = edgeKey(a, b);
    if (index.has(key)) {
      edges[index.get(key)].right = fi;
    } else {
      index.set(key, edges.length);
      edges.push({tail: a, head: b, left: fi, right: -1});
    }
  }));
  return {edges, index};
}
```

Euler's formula says a closed triangle mesh has ${tex`E = 3F/2`} edges, so the
icosahedron should produce 30 records:

```js echo
createEdges(icosahedron().faces).edges.length
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
    vertexEdge[e.tail] ??= i;
    vertexEdge[e.head] ??= i;
    faceEdge[e.left] ??= i;
    if (e.right >= 0) faceEdge[e.right] ??= i;
  });
  return {edges, vertexEdge, faceEdge};
}
```

Now the two traversals from the reading. Both follow links until they return to the
start, so they can share a small loop:

```js echo
function walkLoop(start, next) {
  const out = [start];
  for (let e = next(start); e !== start; e = next(e)) out.push(e);
  return out;
}
```

Each step must first check **which way the current edge points** relative to the vertex
or face, and that test decides between the left and right wing. Around a vertex, the
check is on the tail:

```js echo
const edgesOfVertex = ({edges, vertexEdge}, v) => walkLoop(vertexEdge[v],
  (e) => (edges[e].tail === v ? edges[e].lprev : edges[e].rprev));
```

Around a face, the check is on the left face:

```js echo
const edgesOfFace = ({edges, faceEdge}, f) => walkLoop(faceEdge[f],
  (e) => (edges[e].left === f ? edges[e].lnext : edges[e].rnext));
```

The half-edge structure removes exactly this check. `mesh.buildHalfEdges` in
`components/mesh.js` builds one, and here we run all of them on the current
icosphere:

```js echo
const icoWinged = buildWingedEdge(icoMesh.faces);
const icoHalf = mesh.buildHalfEdges(icoMesh.faces);
```

```js
const fmtEdge =
  (e) => `${icoWinged.edges[e].tail}–${icoWinged.edges[e].head}`;
```

On the level-${icoLevel} icosphere (${icoWinged.edges.length} edges):

- `EdgesOfVertex(${queryVertex})` → ${edgesOfVertex(icoWinged, queryVertex).map(fmtEdge).join(", ")}
- `EdgesOfFace(0)` → ${edgesOfFace(icoWinged, 0).map(fmtEdge).join(", ")}, which matches face 0 = (${icoMesh.faces[0].join(", ")})
- The half-edge structure (`mesh.facesAroundVertex`) finds the faces around vertex ${queryVertex}: [${mesh.facesAroundVertex(icoHalf, queryVertex).join(", ")}]. That is the same set as the triangle-neighbor walk, reached with one `pair`/`prev` hop per step and no direction check.

**Storage, in units per vertex** (floats, ints, and pointers count as 1):

```js
(() => {
  const nv = icoMesh.positions.length, nt = icoMesh.faces.length, ne = icoWinged.edges.length;
  return Inputs.table([
    {structure: "separate triangles", units: 9 * nt},
    {structure: "indexed mesh", units: 3 * nv + 3 * nt},
    {
      structure: "triangle-neighbor (positions + 1 edge per vertex, 3 + 3 per triangle)",
      units: 4 * nv + 6 * nt
    },
    {
      structure: "winged-edge (8 refs per edge + 1 per vertex and face)",
      units: 3 * nv + 8 * ne + nv + nt
    },
    {
      structure: "half-edge (4 refs per half-edge + 1 per vertex and face)",
      units: 3 * nv + 4 * 2 * ne + nv + nt
    }
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
(${tex`P'`}, edge point, face point, edge point).

All three rules are averages, so we start with an average of points, written for
`[x, y, z]` arrays:

```js echo
const averagePoints = (points) =>
  [0, 1, 2].map((k) => d3.mean(points, (p) => p[k]));
```

The **face point** is simply the average of the face's corners. The **edge point**
averages the edge's two endpoints with the face points on its two sides:

```js echo
const facePoint = (corners) => averagePoints(corners);
const edgePoint = (p1, p2, f1, f2) => averagePoints([p1, p2, f1, f2]);
```

The **vertex rule** weights three positions. For a cube corner, the valence is 3, so
the original position ${tex`P`} gets a weight of zero:

```js echo
function movedVertex(P, faceAverage, edgeMidpointAverage, n) {
  return [0, 1, 2].map((k) =>
    (faceAverage[k] + 2 * edgeMidpointAverage[k] + (n - 3) * P[k]) / n);
}
```

Let's check this by hand on the cube with corners at ±1. The three faces at corner
(1, 1, 1) have face points (1, 0, 0), (0, 1, 0), and (0, 0, 1), which average to ⅓ in
each coordinate. The three edge midpoints there average to ⅔. So the corner should
move to ${tex`(\tfrac13 + 2\cdot\tfrac23)/3 = \tfrac59 \approx 0.556`} in each
coordinate, pulled inward:

```js echo
movedVertex([1, 1, 1], [1 / 3, 1 / 3, 1 / 3], [2 / 3, 2 / 3, 2 / 3], 3)
```

The edge from (1, 1, 1) to (1, 1, −1) borders the faces with points (1, 0, 0) and
(0, 1, 0), so its edge point should be (0.75, 0.75, 0):

```js echo
edgePoint([1, 1, 1], [1, 1, -1], [1, 0, 0], [0, 1, 0])
```

Applying these rules to a whole mesh mostly takes bookkeeping: finding the faces around
each vertex and on each edge, exactly as in the previous section. `catmullClark` in
`components/subdivision.js` does that bookkeeping and applies the same three rules:

```js
const cubePositions = [
  {x: -1, y: -1, z: -1}, {x: 1, y: -1, z: -1}, {x: 1, y: 1, z: -1}, {x: -1, y: 1, z: -1},
  {x: -1, y: -1, z: 1}, {x: 1, y: -1, z: 1}, {x: 1, y: 1, z: 1}, {x: -1, y: 1, z: 1}
];
const cubeFaces = [[1, 2, 6, 5], [0, 4, 7, 3], [3, 7, 6, 2], [0, 1, 5, 4], [4, 5, 6, 7], [0, 3, 2, 1]];
```

```js
const ccForm = view(Inputs.form({
  iterations: Inputs.range([0, 3], {value: 1, step: 1, label: "subdivision steps"}),
  azimuth: Inputs.range([-180, 180], {value: 35, step: 1, label: "orbit azimuth"})
}));
```

```js
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

```js
(() => {
  const az = (ccForm.azimuth * Math.PI) / 180;
  const mvp = mat4.multiply(transforms.perspective(Math.PI / 4, 1, 0.1, 20),
    transforms.lookAt([4.5 * Math.cos(0.45) * Math.sin(az), 4.5 * Math.sin(0.45), 4.5 * Math.cos(0.45) * Math.cos(az)], [0, 0, 0], [0, 1, 0]));
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

```js
const pendulumForm = view(Inputs.form({
  theta: Inputs.range([-90, 90], {value: 25, step: 1, label: "θ (upper joint)"}),
  phi: Inputs.range([-120, 120], {value: -55, step: 1, label: "φ (lower joint)"}),
  px: Inputs.range([-2, 2], {value: 0, step: 0.1, label: "hinge position p.x"})
}));
```

The code follows those three equations. `mat3` is Module 03's 3×3 toolkit. The sliders
set the angles, and `b` is the attachment point in the upper piece's own frame:

```js echo
const deg = Math.PI / 180;
const b = {x: 0, y: -2.2};
const hinge = mat3.translation(pendulumForm.px, 2.5);
const M3 = mat3.multiply(hinge, mat3.rotation(pendulumForm.theta * deg));
const attach = mat3.translation(b.x, b.y);
const Mc = mat3.multiply(attach, mat3.rotation(pendulumForm.phi * deg));
const Md = mat3.multiply(M3, Mc);   // the lower piece rides along with M3
```

The lower piece's own origin, which is the joint, should land exactly where the upper
piece carries point `b`, whatever the angles. Both of these should match:

```js echo
[mat3.transformPoint(Md, {x: 0, y: 0}), mat3.transformPoint(M3, b)]
  .map((p) => `(${p.x.toFixed(3)}, ${p.y.toFixed(3)})`)
```

```js
(() => {
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

```js echo
class MatrixStack {
  stack = [mat4.identity()];
  top() { return this.stack.at(-1); }
  push(M) { this.stack.push(mat4.multiply(this.top(), M)); }
  pop() { this.stack.pop(); }
}
```

```js
// Adds a printout of each push and pop, labeling matrices by the names in `names`.
class TracedStack extends MatrixStack {
  labels = [];
  log = [];
  constructor(names) { super(); this.matrixNames = names; }
  push(M) {
    super.push(M);
    this.labels.push(this.matrixNames.get(M));
    this.log.push(`push ${this.matrixNames.get(M).padEnd(4)}  stack = [${this.names()}]`);
  }
  pop() {
    super.pop();
    this.labels.pop();
    this.log.push(`pop        stack = [${this.names()}]`);
  }
  names() { return this.labels.join(" · "); }
}
```

Try it with two translations. After both pushes, the top should move a point by the
sum, (1, 2, 0). After one pop, only the first translation should remain:

```js echo
{
  const s = new MatrixStack();
  s.push(transforms.translate(1, 0, 0));
  s.push(transforms.translate(0, 2, 0));
  const afterTwo = mat4.transformPoint(s.top(), [0, 0, 0]);
  s.pop();
  display([afterTwo, mat4.transformPoint(s.top(), [0, 0, 0])]
    .map((p) => `(${p[0]}, ${p[1]}, ${p[2]})`));
}
```

The traversal is the reading's `traverse(node)`. It pushes the node's matrix, visits
the node with whatever is on top, visits the children (who push and pop their own
matrices), and finally pops, so the next sibling starts again from the parent's
product:

```js echo
function traverseWithStack(node, stack, visit) {
  stack.push(node.local);
  visit(node, stack.top());
  for (const child of node.children) traverseWithStack(child, stack, visit);
  stack.pop();
}
```

The ferry from the reading carries a car whose wheels move relative to the
car:

```js
const ferryForm = view(Inputs.form({
  ferryX: Inputs.range([-2, 2], {value: 0, step: 0.1, label: "ferry position (M₀)"}),
  carX: Inputs.range([-1.5, 1.5], {value: 0.4, step: 0.1, label: "car on the deck (M₁)"}),
  wheelSpin: Inputs.range([0, 360], {value: 30, step: 5, label: "wheel spin (M₂, M₃)"})
}));
```

A node holds a name, its local matrix, and its children. Both wheels spin by the same
amount, at their own places on the car:

```js echo
const treeNode = (name, matrixName, local, children = []) =>
  ({name, matrixName, local, children});
const wheelSpin = transforms.rotateZ(-ferryForm.wheelSpin * deg);
const wheelAt = (x) =>
  mat4.multiply(transforms.translate(x, -0.25, 0), wheelSpin);
```

The tree reads like the sentence "the ferry carries a car, and the car has wheels":

```js echo
const ferryTree = treeNode("ferry", "M0",
  transforms.translate(ferryForm.ferryX, 0, 0), [
    treeNode("car body", "M1",
      transforms.translate(ferryForm.carX, 0.55, 0), [
        treeNode("left wheel", "M2", wheelAt(-0.45)),
        treeNode("right wheel", "M3", wheelAt(0.45))
      ])
  ]);
```

```js
const ferryNames = new Map();
(function collect(n) { ferryNames.set(n.local, n.matrixName); n.children.forEach(collect); })(ferryTree);
const ferryStack = new TracedStack(ferryNames);
const ferryDrawn = [];
traverseWithStack(ferryTree, ferryStack, (node) =>
  ferryDrawn.push(`${node.name.padEnd(12)} drawn with ${ferryStack.names()}`));
```

The picture and the printout below come from one traversal, with a version of the
stack that also logs each push and pop:

```js
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

```js
html`<pre>${ferryStack.log.join("\n")}

${ferryDrawn.join("\n")}</pre>`
```

Each `pop()` restores the parent's matrix, so the right wheel gets
${tex`M_0M_1M_3`}, not ${tex`M_0M_1M_2M_3`}: **siblings never inherit
each other's transforms.** In `components/scenegraph.js`, the JavaScript
call stack plays the same role: `parentWorld` is the top of the stack,
and returning from a call pops it.

## Meshes and Scene Graphs in WebGPU

```js
// a blank canvas: each demo adds its own below
const {device, format: canvasFormat} =
  await initializeWebGPU(document.createElement("canvas"));
const deviceErrorLog = document.createElement("pre");
deviceErrorLog.style.cssText = "display: none; color: #e5484d; background: #2a1214; border: 1px solid #e5484d; border-radius: 6px; padding: 8px 12px; font-size: 12px; white-space: pre-wrap;";
device.addEventListener("uncapturederror", (event) => {
  deviceErrorLog.textContent += `WebGPU error: ${event.error.message}\n`;
  deviceErrorLog.style.display = "block";
});
```

```js
deviceErrorLog
```

The device and canvas setup follows Modules 04 and 05 and stays out of sight. The
drawings in this section share a few helpers, each one a familiar WebGPU step.

**1. The shader.** Every drawing below uses the same simple shader. The
uniform block holds one **MVP** matrix (model-view-projection) and one
color:

```js echo
const wgslLitUniforms = `
struct Uniforms { mvp: mat4x4<f32>, color: vec4<f32> };
@group(0) @binding(0) var<uniform> u: Uniforms;`;
```

The vertex shader transforms each position to clip space and passes the normal along:

```js echo
const wgslLitVertex = `
struct VertexOut {
  @builtin(position) position: vec4<f32>, @location(0) normal: vec3<f32>
};
@vertex
fn vs_main(
  @location(0) inPos: vec3<f32>, @location(1) inNormal: vec3<f32>
) -> VertexOut {
  return VertexOut(u.mvp * vec4<f32>(inPos, 1.0), inNormal);
}`;
```

The fragment shader applies a Lambert term with a fixed light direction. The constant
0.35 is an ambient floor, so faces that point away from the light are dim but not black:

```js echo
const wgslLitFragment = `
@fragment
fn fs_main(@location(0) normal: vec3<f32>) -> @location(0) vec4<f32> {
  let L = normalize(vec3<f32>(0.4, 0.8, 0.5));
  let ndotl = max(dot(normalize(normal), L), 0.0);
  return vec4<f32>(u.color.rgb * (0.35 + 0.65 * ndotl), 1.0);
}`;
```

```js
const litModule = device.createShaderModule(
  {code: wgslLitUniforms + wgslLitVertex + wgslLitFragment}
);
```

**2. The vertex layout and the pipeline.** Each vertex is 6 floats,
interleaved: a position at byte offset 0 and a normal at byte offset 12.
The `shaderLocation` numbers connect each attribute to the matching
`@location(n)` parameter of `vs_main`:

```js echo
const vertexLayout = {
  arrayStride: 6 * 4,
  attributes: [
    {shaderLocation: 0, offset: 0, format: "float32x3"},     // position
    {shaderLocation: 1, offset: 3 * 4, format: "float32x3"}  // normal
  ]
};
```

We need the same pipeline twice below, with different bind group layouts, so a
function fills in the common parts. Depth testing is on, as in Module 05:

```js echo
const depthTest = {
  format: "depth24plus", depthWriteEnabled: true, depthCompare: "less"
};
const colorTargets = [{format: canvasFormat}];
```

```js echo
const litDescriptor = (layout, cullMode) => ({
  layout,
  vertex: {
    module: litModule, entryPoint: "vs_main", buffers: [vertexLayout]
  },
  fragment: {
    module: litModule, entryPoint: "fs_main", targets: colorTargets
  },
  primitive: {topology: "triangle-list", cullMode},
  depthStencil: depthTest
});
```

The first pipeline leaves culling off, so a face with the wrong winding is still visible:

```js echo
const litPipeline =
  device.createRenderPipeline(litDescriptor("auto", "none"));
```

**3. Vertex and index buffers.** `createBuffer` from Module 05 uploads the
data. Buffer sizes must be multiples of 4 bytes. A `Uint16Array` with an odd
number of indices is 2 bytes short, so `createBuffer` pads it with bytes that
are never drawn.

```js
async function makeCanvas(size) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  canvas.style.borderRadius = "8px";
  const {context} = await initializeWebGPU(canvas, {device});
  const depthTexture = device.createTexture({
    size: [size, size], format: "depth24plus",
    usage: GPUTextureUsage.RENDER_ATTACHMENT
  });
  return {canvas, context, depthTexture};
}
function beginPass(encoder, target) {
  return encoder.beginRenderPass({
    colorAttachments: [{
      view: target.context.getCurrentTexture().createView(),
      clearValue: {r: 0.05, g: 0.05, b: 0.08, a: 1}, loadOp: "clear", storeOp: "store"
    }],
    depthStencilAttachment: {
      view: target.depthTexture.createView(), depthClearValue: 1,
      depthLoadOp: "clear", depthStoreOp: "store"
    }
  });
}
```

**4. A drawable.** A **drawable** bundles what one draw call needs: its buffers, its
index count, and a bind group pointing at its own 80-byte uniform buffer (a 64-byte
matrix plus a 16-byte color):

```js echo
function makeDrawable(vertexBuffer, indexBuffer, count, mvp, colorRGB) {
  const uniformBuffer = device.createBuffer(
    {size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST}
  );
  const data = new Float32Array([...mvp, ...colorRGB, 1]);
  device.queue.writeBuffer(uniformBuffer, 0, data);
  const bindGroup = device.createBindGroup({
    layout: litPipeline.getBindGroupLayout(0),
    entries: [{binding: 0, resource: {buffer: uniformBuffer}}]
  });
  return {vertexBuffer, indexBuffer, count, bindGroup};
}
```

**5. Rendering a list of drawables.** `beginPass`, kept out of sight, clears the color
and depth attachments as in Module 05. `renderScenePass` records one draw per drawable
and submits the commands. A drawable with an index buffer uses `drawIndexed`, and one
without uses plain `draw`:

```js echo
function renderScenePass(target, drawList) {
  const encoder = device.createCommandEncoder();
  const pass = beginPass(encoder, target);
  pass.setPipeline(litPipeline);
  for (const {bindGroup, vertexBuffer, indexBuffer, count} of drawList) {
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, vertexBuffer);
    if (indexBuffer) {
      pass.setIndexBuffer(indexBuffer, "uint16");
      pass.drawIndexed(count);
    } else pass.draw(count);
  }
  pass.end();
  device.queue.submit([encoder.finish()]);
}
```

**6. One small utility.** `packInterleaved` turns arrays of
`{x, y, z}` positions and normals into the 6-floats-per-vertex layout
from step 2:

```js echo
function packInterleaved(positions, normals) {
  const out = new Float32Array(positions.length * 6);
  positions.forEach((p, i) => {
    const n = normals[i];
    out.set([p.x, p.y, p.z, n.x, n.y, n.z], i * 6);
  });
  return out;
}
```

```js
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

```js
const gpuIcoLevel = view(Inputs.range([0, 4], {value: 2, step: 1, label: "icosphere level"}));
```

The two forms come from the same mesh. On a unit sphere, a point's normal equals its
position, so we pass the positions twice. The indexed form has one vertex per position.
The separate form looks up the three corners of every triangle, repeating shared
vertices:

```js echo
const gpuIco = icosphere(gpuIcoLevel);
const icoIndexed = {
  vertices: packInterleaved(gpuIco.positions, gpuIco.positions),
  indices: new Uint16Array(gpuIco.faces.flat())
};
const icoCorners = gpuIco.faces.flat().map((i) => gpuIco.positions[i]);
const icoSeparate = packInterleaved(icoCorners, icoCorners);
```

Only the buffers and draw call differ between the two drawables:

```js echo
const {VERTEX: VB, INDEX: IB} = GPUBufferUsage;
const icoMVP = mat4.multiply(
  transforms.perspective(0.75, 1, 0.1, 10),
  transforms.lookAt([2.2, 1.6, 2.6], [0, 0, 0], [0, 1, 0])
);
const indexedDrawable = makeDrawable(
  createBuffer(device, icoIndexed.vertices, VB),
  createBuffer(device, icoIndexed.indices, IB),
  icoIndexed.indices.length, icoMVP, [0.3, 0.55, 0.85]
);
const separateDrawable = makeDrawable(
  createBuffer(device, icoSeparate, VB), null,
  icoSeparate.length / 6, icoMVP, [0.85, 0.45, 0.25]
);
```

```js
const icoTargets = [await makeCanvas(240), await makeCanvas(240)];
renderScenePass(icoTargets[0], [indexedDrawable]);
renderScenePass(icoTargets[1], [separateDrawable]);
```

```js
captioned([
  [
    `indexed: ${(icoIndexed.vertices.byteLength + icoIndexed.indices.byteLength).toLocaleString()} bytes`,
    icoTargets[0].canvas
  ],
  [
    `separate: ${icoSeparate.byteLength.toLocaleString()} bytes`,
    icoTargets[1].canvas
  ]
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
const dynamicPipeline = device.createRenderPipeline(litDescriptor(
  device.createPipelineLayout({bindGroupLayouts: [dynamicLayout]}), "back"
));
```

**3. One buffer, one bind group.** The buffer holds `MAX_NODES` slots.
The bind group's `size: 80` is the **window** the shader sees. The
dynamic offset slides that window to a different slot for each draw:

```js echo
const MAX_NODES = 8;
const slotBuffer = device.createBuffer({
  size: SLOT * MAX_NODES,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
});
const slotBindGroup = device.createBindGroup({
  layout: dynamicLayout,
  entries: [{binding: 0, resource: {buffer: slotBuffer, size: 80}}]
});
```

**4. The shared sphere.** Every body is the same sphere mesh, uploaded
once. Only the matrix in each slot differs:

```js echo
const sphereGeo = geometry.createSphere(16, 20);
const sphereMesh = new Mesh(device, {
  vertices: geometry.interleave(sphereGeo.positions, sphereGeo.normals),
  indices: sphereGeo.indices
});
```

```js
const solarTarget = await makeCanvas(340);
const solarVP = mat4.multiply(
  transforms.perspective(0.84, 1, 0.1, 30),
  transforms.lookAt([0, 4.5, 7.5], [0, 0, 0], [0, 1, 0])
);
```

**5. Build the scene graph.** `SceneNode` from `components/scenegraph.js` holds a name,
a local matrix, and children. Only nodes with a `color` are drawn. The pivot nodes only
rotate, and the offset nodes only translate, so rotating a pivot swings everything below
it around the parent's center. The Earth's part of the tree comes first:

```js echo
const body = (name, m, children = [], color = null) =>
  Object.assign(new SceneNode(name, m, {children}), {color});
const uniformScale = (s) => transforms.scale(s, s, s);
const earth = body("Earth", mat4.multiply(
  transforms.rotateY(solarForm.earthSpin * deg), uniformScale(0.32)
), [], [0.3, 0.5, 0.9]);
```

The Moon hangs from the Earth's offset, not from the Earth itself, so it follows the
orbit but not the spin:

```js echo
const moon = body("Moon", uniformScale(0.15), [], [0.65, 0.65, 0.65]);
const spinY = (angle) => transforms.rotateY(angle * deg);
const moonPivot = body("MoonPivot", spinY(solarForm.moonOrbit), [
  body("MoonOffset", transforms.translate(0.75, 0, 0), [moon])
]);
const earthPivot = body("EarthPivot", spinY(solarForm.earthOrbit), [
  body("EarthOffset", transforms.translate(2.6, 0, 0), [earth, moonPivot])
]);
```

`traverse` (from `components/scenegraph.js`) hands each node its world matrix, the
product along its path from the root. We collect the drawable ones:

```js echo
const solarRoot = body("System", mat4.identity(), [
  body("Sun", uniformScale(0.6), [], [1, 0.8, 0.2]), earthPivot
]);
const solarWorld = [];
traverse(solarRoot, (n, world) => {
  if (n.color) solarWorld.push({name: n.name, world, color: n.color});
});
```

```js
const solarForm = view(Inputs.form({
  earthOrbit: Inputs.range([0, 360], {value: 40, step: 1, label: "Earth orbit"}),
  earthSpin: Inputs.range([0, 360], {value: 0, step: 1, label: "Earth spin"}),
  moonOrbit: Inputs.range([0, 360], {value: 90, step: 1, label: "Moon orbit"})
}));
```

**6. Write all slots, then draw with a different offset each time.**
All writes land before the pass runs, so the data goes up in **one** `writeBuffer`. A
slot is `SLOT` bytes, which is `SLOT / 4` floats:

```js echo
function writeSlots() {
  const data = new Float32Array((SLOT / 4) * solarWorld.length);
  solarWorld.forEach((d, i) => data.set(
    [...mat4.multiply(solarVP, d.world), ...d.color, 1], (i * SLOT) / 4
  ));
  device.queue.writeBuffer(slotBuffer, 0, data);
}
```

There is one bind group. Each draw selects its node's slot by passing a different offset
to `setBindGroup`:

```js echo
writeSlots();
const solarEncoder = device.createCommandEncoder();
const solarPass = beginPass(solarEncoder, solarTarget);
solarPass.setPipeline(dynamicPipeline);
solarWorld.forEach((d, i) => {
  solarPass.setBindGroup(0, slotBindGroup, [i * SLOT]);
  sphereMesh.draw(solarPass);
});
solarPass.end();
device.queue.submit([solarEncoder.finish()]);
```

```js
captioned(
  [
    [solarWorld.map((d) => `${d.name} at (${d.world[12].toFixed(2)}, ${d.world[14].toFixed(2)})`).join(" · "), solarTarget.canvas]
  ]
)
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

```js
const vec3Cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]
];
```

```js echo
const CUBE_FACES = [
  {n: [ 1, 0, 0], u: [0, 0, -1], v: [0, 1, 0]},   // +x
  {n: [-1, 0, 0], u: [0, 0,  1], v: [0, 1, 0]},   // -x
  {n: [0,  1, 0], u: [1, 0,  0], v: [0, 0, -1]},  // +y (top)
  {n: [0, -1, 0], u: [1, 0,  0], v: [0, 0,  1]},  // -y (bottom)
  {n: [0, 0,  1], u: [ 1, 0, 0], v: [0, 1, 0]},   // +z
  {n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0]}    // -z
];
```

Check the claim on one face. For the +x face, ${tex`\mathbf u \times \mathbf v`}
should equal its normal (1, 0, 0):

```js echo
vec3Cross(CUBE_FACES[0].u, CUBE_FACES[0].v)
```

For one face, the four corners come from the four sign combinations, in
counterclockwise order. Each vertex is its position followed by its normal:

```js echo
function faceVertices({n, u, v}) {
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].flatMap(([su, sv]) => [
    ...[0, 1, 2].map((k) => 0.5 * (n[k] + su * u[k] + sv * v[k])),
    ...n
  ]);
}
```

Each face adds four vertices and two triangles, with indices measured from that face's
first corner, `base`:

```js echo
function unitCube() {
  const vertices = CUBE_FACES.flatMap(faceVertices);
  const indices = CUBE_FACES.flatMap((_, f) => {
    const base = 4 * f;
    return [base, base + 1, base + 2, base, base + 2, base + 3];
  });
  return {
    vertices: new Float32Array(vertices), indices: new Uint16Array(indices)
  };
}
const cube = unitCube();
```

The cube has ${cube.vertices.length / 6} vertices and
${cube.indices.length} indices. It is uploaded **once**, with the
two buffer helpers from the course library, `lib/webgpu.js`:

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
  return mat4.multiply(
    transforms.translate(...center), transforms.scale(...size)
  );
}
```

A chair is 6 boxes: a seat, 4 legs, and a backrest. All sizes are in
meters, in the chair's **own space**: the origin is on the floor under
the middle of the seat, ${tex`+y`} is up, and the backrest is on the
${tex`-z`} side:

```js echo
const CHAIR = {
  seat: 0.45, seatHeight: 0.45, seatThick: 0.04, leg: 0.04, backHeight: 0.4,
  backThick: 0.04
};
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
const {seat, seatHeight, seatThick, leg, backHeight, backThick} = CHAIR;
const LEG_HEIGHT = seatHeight - seatThick;
const LEG_OFFSET = seat / 2 - leg / 2;   // center to each leg's center
const BACK_Z = -(seat / 2 - backThick / 2);
```

The seat and backrest each come straight from those rules:

```js echo
const seatBox = boxTransform(
  [0, seatHeight - seatThick / 2, 0], [seat, seatThick, seat]
);
const backBox = boxTransform(
  [0, seatHeight + backHeight / 2, BACK_Z], [seat, backHeight, backThick]
);
```

The four legs differ only in the signs of their positions:

```js echo
const legBox = ([sx, sz]) => boxTransform(
  [sx * LEG_OFFSET, LEG_HEIGHT / 2, sz * LEG_OFFSET], [leg, LEG_HEIGHT, leg]
);
const legBoxes = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(legBox);
```

The chair is the list of all six, each tagged with its role:

```js echo
const CHAIR_PARTS = [
  {role: "seat", transform: seatBox},
  ...legBoxes.map((transform) => ({role: "leg", transform})),
  {role: "back", transform: backBox}
];
```

These 6 matrices are computed **once** and shared by every chair. We
can read each one back to check it. In a column-major matrix,
`m[12..14]` is the translation (the box's center), and for a
translate × scale matrix the diagonal `m[0], m[5], m[10]` is the size:

```js
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
// chair center to chair center, in meters
const SPACING = {x: 0.8, z: 0.9};

function chairPlacement(row, col, rows, cols) {
  const x = (col - (cols - 1) / 2) * SPACING.x;
  const z = (row - (rows - 1) / 2) * SPACING.z;
  return transforms.translate(x, 0, z);                              // P_ij
}
```

Each instance also carries a **color**. Seats and legs share fixed
colors, and each chair's backrest gets its own color from a rainbow, so
you can see that per-instance data really is per instance:

```js echo
const PART_COLORS = {
  seat: [0.62, 0.42, 0.25], leg: [0.55, 0.57, 0.6], floor: [0.32, 0.33, 0.36]
};

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
function chairInstances(row, col, rows, cols) {
  const placement = chairPlacement(row, col, rows, cols);
  const backColor = rainbow((row * cols + col) / (rows * cols));
  return CHAIR_PARTS.map((part) => ({
    model: mat4.multiply(placement, part.transform),   // P_ij · T_k
    color: part.role === "back" ? backColor : PART_COLORS[part.role]
  }));
}
```

The room visits every grid position, then adds the floor:

```js echo
function buildRoomInstances(rows, cols) {
  const instances = d3.cross(d3.range(rows), d3.range(cols))
    .flatMap(([row, col]) => chairInstances(row, col, rows, cols));
  const floorSize = [cols * SPACING.x + 0.6, 0.05, rows * SPACING.z + 0.6];
  const model = boxTransform([0, -0.025, 0], floorSize);
  return [...instances, {model, color: PART_COLORS.floor}];
}
```

A 3 × 4 room has 12 chairs of 6 boxes each, plus the floor, so it should have 73
instances:

```js echo
buildRoomInstances(3, 4).length
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
    data.set(model, i * INSTANCE_FLOATS);         // floats 0..15
    data.set(color, i * INSTANCE_FLOATS + 16);    // floats 16..18
  });
  return data;
}
```

Here is the record for instance 0, the seat of the first chair in a
3 × 4 room. The last column of the matrix (floats 12–14) is the seat's
center in the room:

```js
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

The shader's inputs show those two kinds side by side:

```js echo
const wgslInstanceInputs = `
struct InstanceIn {
  @location(0) position: vec3<f32>,   // slot 0: per vertex
  @location(1) normal: vec3<f32>,
  @location(2) m0: vec4<f32>,         // slot 1: per instance
  @location(3) m1: vec4<f32>,
  @location(4) m2: vec4<f32>,
  @location(5) m3: vec4<f32>,
  @location(6) color: vec4<f32>,
};`;
```

The camera uniform and the outputs are short:

```js echo
const wgslInstanceShared = `
struct Camera { viewProj: mat4x4<f32>, lightDir: vec4<f32> };
@group(0) @binding(0) var<uniform> camera: Camera;
struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) normal: vec3<f32>,
  @location(1) color: vec3<f32>,
};`;
```

The vertex shader rebuilds the matrix from its columns and applies the normal formula:

```js echo
const wgslInstanceVertex = `
@vertex
fn vs_main(in: InstanceIn) -> VertexOut {
  let model = mat4x4<f32>(in.m0, in.m1, in.m2, in.m3);
  let linear = mat3x3<f32>(in.m0.xyz, in.m1.xyz, in.m2.xyz);
  let s = vec3<f32>(length(in.m0.xyz), length(in.m1.xyz), length(in.m2.xyz));
  return VertexOut(camera.viewProj * model * vec4<f32>(in.position, 1.0),
    linear * (in.normal / (s * s)), in.color.rgb);
}`;
```

The fragment shader is a Lambert term once more:

```js echo
const wgslInstanceFragment = `
@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  let n = normalize(in.normal);
  let l = normalize(camera.lightDir.xyz);
  return vec4<f32>(in.color * (0.3 + 0.7 * max(dot(n, l), 0.0)), 1.0);
}`;
const instancingShader = device.createShaderModule({code: [
  wgslInstanceInputs, wgslInstanceShared,
  wgslInstanceVertex, wgslInstanceFragment
].join("\n")});
```

We can check the normal formula on the CPU with a matrix that also rotates and a slanted
normal. Below, the shader's shortcut and the full inverse transpose point the same way,
while using ${tex`M`} directly does not:

```js
{
  const M = mat4.multiplyAll([transforms.translate(1, 2, 3), transforms.rotateY(0.7), transforms.scale(1.6, 0.05, 0.8)]);
  const n = [0.6, 0.8, 0];
  const unit = (v) => v.map((x) => x / Math.hypot(...v));
  const col = (k) => [M[4 * k], M[4 * k + 1], M[4 * k + 2]];
  const s = [0, 1, 2].map((k) => Math.hypot(...col(k)));
  const shortcut = [0, 1, 2].map((r) => [0, 1, 2].reduce((sum, k) => sum + col(k)[r] * n[k] / s[k] ** 2, 0));
  const full = mat4.multiplyVec4(mat4.transpose(mat4.invert(M)), [...n, 0]).slice(0, 3);
  const naive = mat4.multiplyVec4(M, [...n, 0]).slice(0, 3);
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
const instanceSlot = {
  arrayStride: INSTANCE_FLOATS * 4,   // 80 bytes per record
  stepMode: "instance",
  attributes: [
    ...[0, 1, 2, 3].map((c) =>        // the four matrix columns
      ({shaderLocation: 2 + c, offset: c * 16, format: "float32x4"})),
    {shaderLocation: 6, offset: 16 * 4, format: "float32x4"}   // color
  ]
};
```

Slot 0 is the same per-vertex layout as before, so the pipeline just lists both:

```js echo
const instancingPipeline = device.createRenderPipeline({
  layout: "auto",
  vertex: {
    module: instancingShader, entryPoint: "vs_main",
    buffers: [vertexLayout, instanceSlot]
  },
  fragment: {
    module: instancingShader, entryPoint: "fs_main", targets: colorTargets
  },
  primitive: {topology: "triangle-list", cullMode: "back"},
  depthStencil: depthTest
});
```

The camera uniform (a view-projection matrix and a light direction) is
the same for every instance, so it stays a normal uniform buffer with
one bind group:

```js echo
const roomCamera = device.createBuffer(
  {size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST}
);
const roomBindGroup = device.createBindGroup({
  layout: instancingPipeline.getBindGroupLayout(0),
  entries: [{binding: 0, resource: {buffer: roomCamera}}]
});
```

```js
const roomTarget = await makeCanvas(420);
```

### Step 6: one draw call for the whole room

Choose the room size, then the draw mode and camera angle. They are
separate forms so that orbiting the camera does not rebuild the
instance buffer:

```js
const roomSize = view(Inputs.form({
  rows: Inputs.range([1, 60], {value: 8, step: 1, label: "rows of chairs"}),
  cols: Inputs.range([1, 60], {value: 10, step: 1, label: "chairs per row"})
}));
```

```js
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
const instanceBuffer =
  createBuffer(device, packInstances(roomInstances), GPUBufferUsage.VERTEX);
invalidation.then(() => instanceBuffer.destroy());
```

The camera orbits the room's center at a distance that grows with the
room, so the whole grid stays in view. That is ordinary Module 03 math and stays out of
sight.

```js
const roomViewProj = (() => {
  const extent = Math.max(roomSize.cols * SPACING.x, roomSize.rows * SPACING.z);
  const dist = 0.9 * extent + 2, az = (roomView.azimuth * Math.PI) / 180, el = 0.6;
  const eye = [dist * Math.cos(el) * Math.sin(az), dist * Math.sin(el), dist * Math.cos(el) * Math.cos(az)];
  return mat4.multiply(
    transforms.perspective(0.8, 1, 0.1, 4 * dist),
    transforms.lookAt(eye, [0, 0.3, 0], [0, 1, 0])
  );
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

The whole difference between the two modes fits in a small function. It returns the
number of draw calls it made:

```js echo
function encodeRoomDraws(pass, count, instanced) {
  if (instanced) {
    cubeMesh.draw(pass, 0, count);                 // every box, one call
    return 1;
  }
  for (let i = 0; i < count; i++) cubeMesh.draw(pass, 0, 1, i);
  return count;
}
```

The rest of the frame writes the camera, which is out of sight here, and sets up the pass. We time only the **encoding** on the CPU, which
is the part that grows with the number of draw calls:

```js echo
const roomStats = (() => {
  writeRoomCamera();
  const encoder = device.createCommandEncoder();
  const pass = beginPass(encoder, roomTarget);
  const t0 = performance.now();
  pass.setPipeline(instancingPipeline);
  pass.setBindGroup(0, roomBindGroup);
  pass.setVertexBuffer(1, instanceBuffer);         // per instance (slot 1)
  const count = roomInstances.length;
  const instanced = roomView.mode.startsWith("instanced");
  const drawCalls = encodeRoomDraws(pass, count, instanced);
  const encodeMs = performance.now() - t0;
  pass.end();
  device.queue.submit([encoder.finish()]);
  return {count, drawCalls, encodeMs};
})();
```

```js
function writeRoomCamera() {
  device.queue.writeBuffer(roomCamera, 0, new Float32Array([...roomViewProj, 0.4, 0.9, 0.5, 0]));
}
```

```js
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
const wgslStorageDecls = `
struct Instance { model: mat4x4<f32>, color: vec4<f32> };
@group(0) @binding(0) var<uniform> viewProj: mat4x4<f32>;
@group(0) @binding(1) var<storage, read> instances: array<Instance>;
struct VertexOut {
  @builtin(position) position: vec4<f32>, @location(0) normal: vec3<f32>,
  @location(1) color: vec3<f32>
};`;
```

The vertex shader reads its record by index. These spheres scale uniformly, so no
correction to the normal is needed:

```js echo
const wgslStorageVertex = `
@vertex
fn vs_main(@location(0) inPos: vec3<f32>, @location(1) inNormal: vec3<f32>,
           @builtin(instance_index) i: u32) -> VertexOut {
  let inst = instances[i];
  return VertexOut(viewProj * inst.model * vec4<f32>(inPos, 1.0),
    (inst.model * vec4<f32>(inNormal, 0.0)).xyz, inst.color.rgb);
}`;
```

```js
const storageInstancingShader = device.createShaderModule({code: `${wgslStorageDecls}${wgslStorageVertex}
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
  vertex: {
    module: storageInstancingShader, entryPoint: "vs_main",
    buffers: [vertexLayout]
  },
  fragment: {
    module: storageInstancingShader, entryPoint: "fs_main",
    targets: colorTargets
  },
  primitive: {topology: "triangle-list", cullMode: "back"},
  depthStencil: depthTest
});
```

```js
const storageVP = device.createBuffer(
  {size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST}
);
const storageTarget = await makeCanvas(340);
const instIco = icosphere(2);
const instIcoMesh = new Mesh(device, {
  vertices: packInterleaved(instIco.positions, instIco.positions),
  indices: new Uint16Array(instIco.faces.flat())
});
```

```js
const instanceCountForm = view(Inputs.range([2, 16], {value: 6, step: 1, label: "spheres per axis (n → n³ instances)"}));
```

**The records** are the same 20 floats as before: a matrix and a color.
The three nested loops place the spheres on an
${tex`n \times n \times n`} grid and color each one by its grid
position:

```js echo
function sphereRecord(ix, iy, iz, n) {
  const half = (n - 1) / 2;
  const model = mat4.multiply(
    transforms.translate(ix - half, iy - half, iz - half), uniformScale(0.35)
  );
  return [...model, ix / (n - 1), iy / (n - 1), iz / (n - 1), 1];
}
```

```js echo
const sphereGrid = (() => {
  const n = instanceCountForm, count = n ** 3, axis = d3.range(n);
  const records = d3.cross(axis, axis, axis)
    .flatMap(([ix, iy, iz]) => sphereRecord(ix, iy, iz, n));
  return {n, count, data: new Float32Array(records)};
})();
```

**The draw.** The records go into a buffer with `STORAGE` usage, bound
at `@binding(1)`. There is no second `setVertexBuffer`. The draw call is
the same `mesh.draw(pass, 0, instanceCount)`:

```js echo
const storage =
  createBuffer(device, sphereGrid.data, GPUBufferUsage.STORAGE);
invalidation.then(() => storage.destroy());
const storageBindGroup = device.createBindGroup({
  layout: storagePipeline.getBindGroupLayout(0),
  entries: [
    {binding: 0, resource: {buffer: storageVP}},
    {binding: 1, resource: {buffer: storage}}
  ]
});
```

```js echo
writeStorageCamera();
const storageEncoder = device.createCommandEncoder();
const storagePass = beginPass(storageEncoder, storageTarget);
storagePass.setPipeline(storagePipeline);
storagePass.setBindGroup(0, storageBindGroup);
instIcoMesh.draw(storagePass, 0, sphereGrid.count);
storagePass.end();
device.queue.submit([storageEncoder.finish()]);
```

```js
function writeStorageCamera() {
  const dist = sphereGrid.n * 1.9 + 2;
  device.queue.writeBuffer(storageVP, 0, mat4.multiply(
    transforms.perspective(0.73, 1, 0.1, 200),
    transforms.lookAt([dist * 0.6, dist * 0.5, dist * 0.7], [0, 0, 0], [0, 1, 0])
  ));
}
```

```js
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
