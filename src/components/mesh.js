// Week 8: mesh topology helpers on top of a face list (array of vertex
// index arrays, any arity — triangles or quads). Kept separate from
// geometry.js (which only ever produced a smooth, already-manifold UV
// sphere) since this file is specifically about *adjacency* and
// *validity*, not generation.

import * as vec3 from "./vec3.js";

function edgeKey(a, b) {
  return a < b ? `${a},${b}` : `${b},${a}`;
}

// A minimal half-edge structure: every face edge becomes one directed
// half-edge, paired with its opposite-direction twin (if the mesh is
// manifold there), and linked to the next/prev half-edge around its own
// face. Every local adjacency query below is then a single pointer hop.
export function buildHalfEdges(faces) {
  const halfEdges = [];
  const directed = new Map(); // "from,to" -> half-edge index
  const outgoing = new Map(); // vertex -> one half-edge index starting there

  faces.forEach((face, faceIndex) => {
    const n = face.length;
    const start = halfEdges.length;
    for (let i = 0; i < n; i++) {
      const from = face[i], to = face[(i + 1) % n];
      halfEdges.push({from, to, face: faceIndex, next: -1, prev: -1, twin: -1});
      directed.set(`${from},${to}`, start + i);
      if (!outgoing.has(from)) outgoing.set(from, start + i);
    }
    for (let i = 0; i < n; i++) {
      halfEdges[start + i].next = start + ((i + 1) % n);
      halfEdges[start + i].prev = start + ((i - 1 + n) % n);
    }
  });

  for (const he of halfEdges) {
    he.twin = directed.get(`${he.to},${he.from}`) ?? -1;
  }

  return {halfEdges, outgoing};
}

// Every face touching vertex v, found by rotating around v one pointer
// hop at a time: prev(he) ends at v, so prev(he).twin starts at v in the
// neighboring face — repeat until back at the start (closed fan) or a
// boundary is hit (twin === -1, open fan).
export function facesAroundVertex({halfEdges, outgoing}, v) {
  const start = outgoing.get(v);
  if (start === undefined) return [];
  const faces = [];
  let he = start;
  do {
    faces.push(halfEdges[he].face);
    const twin = halfEdges[halfEdges[he].prev].twin;
    if (twin === -1) break;
    he = twin;
  } while (he !== start);
  return faces;
}

// Counts how many faces border each undirected edge. A manifold mesh has
// every edge bordered by exactly 1 (boundary) or 2 (interior) faces —
// 3+ is a non-manifold edge (three sheets meeting at once).
export function checkManifold(faces) {
  const edgeCount = new Map();
  for (const face of faces) {
    const n = face.length;
    for (let i = 0; i < n; i++) {
      const key = edgeKey(face[i], face[(i + 1) % n]);
      edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
    }
  }
  const boundaryEdges = [], nonManifoldEdges = [];
  for (const [key, count] of edgeCount) {
    if (count === 1) boundaryEdges.push(key);
    else if (count > 2) nonManifoldEdges.push(key);
  }
  return {isManifold: nonManifoldEdges.length === 0, boundaryEdges, nonManifoldEdges};
}

// Flat normal of a face, from its first three vertices (a face is
// assumed planar, as required for the winding to define a normal at all).
export function faceNormal(positions, face) {
  return vec3.triangleNormal(positions[face[0]], positions[face[1]], positions[face[2]]);
}

// One normal per vertex, averaging the (unweighted) face normals of
// every face touching it — the vertex-normal rule from lecture.
export function averageVertexNormals(positions, faces) {
  const acc = positions.map(() => ({x: 0, y: 0, z: 0}));
  for (const face of faces) {
    const n = faceNormal(positions, face);
    for (const v of face) acc[v] = vec3.add(acc[v], n);
  }
  return acc.map((n) => (vec3.length(n) < 1e-10 ? n : vec3.normalize(n)));
}
