// Week 8: one iteration of Catmull-Clark subdivision on a manifold
// polygon mesh (any face arity — a cube's quads work; so would a
// triangle mesh). Fresh implementation of the three-step lecture rule,
// not tied to any particular shape.

import * as vec3 from "./vec3.js";

function avg(points) {
  const sum = points.reduce((a, p) => vec3.add(a, p), {x: 0, y: 0, z: 0});
  return vec3.scale(sum, 1 / points.length);
}

function edgeKey(a, b) {
  return a < b ? `${a},${b}` : `${b},${a}`;
}

export function catmullClark({positions, faces}) {
  const V = positions.length;

  // Step 1: one face point per face, the average of its own vertices.
  const facePoints = faces.map((face) => avg(face.map((i) => positions[i])));

  // Every undirected edge, with its two endpoints and the (1 or 2)
  // face(s) that border it.
  const edges = new Map();
  faces.forEach((face, faceIndex) => {
    const n = face.length;
    for (let i = 0; i < n; i++) {
      const a = face[i], b = face[(i + 1) % n];
      const key = edgeKey(a, b);
      if (!edges.has(key)) edges.set(key, {a, b, faces: []});
      edges.get(key).faces.push(faceIndex);
    }
  });

  // Step 2: one edge point per edge, averaging its endpoints and its
  // bordering face point(s).
  const edgeKeys = [...edges.keys()];
  const edgeIndex = new Map(edgeKeys.map((key, i) => [key, V + faces.length + i]));
  const edgePoints = edgeKeys.map((key) => {
    const e = edges.get(key);
    return avg([positions[e.a], positions[e.b], ...e.faces.map((f) => facePoints[f])]);
  });

  // Per-vertex incidence, needed for the update rule below.
  const vertexEdges = Array.from({length: V}, () => []);
  const vertexFaces = Array.from({length: V}, () => []);
  for (const key of edgeKeys) {
    const e = edges.get(key);
    vertexEdges[e.a].push(key);
    vertexEdges[e.b].push(key);
  }
  faces.forEach((face, faceIndex) => {
    for (const v of face) vertexFaces[v].push(faceIndex);
  });

  // Step 3: P' = (F + 2R + (n-2)P) / n — F the average incident face
  // point, R the average incident edge midpoint, P the original vertex,
  // n its degree (edge count).
  const updatedVertices = positions.map((P, v) => {
    const n = vertexEdges[v].length;
    if (n === 0) return P;
    const F = avg(vertexFaces[v].map((f) => facePoints[f]));
    const R = avg(vertexEdges[v].map((key) => {
      const e = edges.get(key);
      return avg([positions[e.a], positions[e.b]]);
    }));
    const blended = vec3.add(vec3.add(F, vec3.scale(R, 2)), vec3.scale(P, n - 2));
    return vec3.scale(blended, 1 / n);
  });

  const newPositions = [...updatedVertices, ...facePoints, ...edgePoints];

  // Reconnect: every corner of every original face becomes one new quad
  // (that face's point, the edge point before the corner, the corner
  // itself, the edge point after it) — always a quad, whatever the
  // original face's arity.
  const newFaces = [];
  faces.forEach((face, faceIndex) => {
    const n = face.length;
    const fp = V + faceIndex;
    for (let i = 0; i < n; i++) {
      const prev = face[(i - 1 + n) % n], curr = face[i], next = face[(i + 1) % n];
      const ep0 = edgeIndex.get(edgeKey(prev, curr));
      const ep1 = edgeIndex.get(edgeKey(curr, next));
      newFaces.push([fp, ep0, curr, ep1]);
    }
  });

  return {positions: newPositions, faces: newFaces};
}

// Deduplicated undirected edge list [[i, j], ...] from a face list, for
// wireframe.js's renderWireframe (which just wants index pairs).
export function facesToEdges(faces) {
  const seen = new Set();
  const edges = [];
  for (const face of faces) {
    const n = face.length;
    for (let i = 0; i < n; i++) {
      const a = face[i], b = face[(i + 1) % n];
      const key = edgeKey(a, b);
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push(a < b ? [a, b] : [b, a]);
    }
  }
  return edges;
}
