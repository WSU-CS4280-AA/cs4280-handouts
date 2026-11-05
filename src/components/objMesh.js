// Module 08's mesh-building steps, which lib/obj-mtl.js leaves to the caller:
// turning its parsed triangles into indexed meshes ready for GPU buffers.
// Positions and normals are [x, y, z] and UVs are [u, v], as in obj-mtl.js.

// Groups triangles by their usemtl name, in first-seen order.
export function groupTrianglesByMaterial(triangles) {
  const groups = new Map();
  for (const triangle of triangles) {
    if (!groups.has(triangle.material)) groups.set(triangle.material, []);
    groups.get(triangle.material).push(triangle);
  }
  return groups;
}

// Deduplicates position/normal/texcoord triples into one vertex record each,
// producing a flat indexed mesh ready for a vertex and an index buffer.
export function buildIndexedMesh({positions, normals, texcoords}, triangles) {
  const vertexMap = new Map(); // "p,n,t" -> new vertex index
  const outPositions = [];
  const outNormals = [];
  const outUVs = [];
  const indices = [];

  for (const {corners} of triangles) {
    for (const corner of corners) {
      const key = `${corner.p},${corner.n},${corner.t}`;
      let index = vertexMap.get(key);
      if (index === undefined) {
        index = outPositions.length;
        vertexMap.set(key, index);
        outPositions.push(positions[corner.p]);
        outNormals.push(normals[corner.n]);
        outUVs.push(corner.t !== null ? texcoords[corner.t] : [0, 0]);
      }
      indices.push(index);
    }
  }

  return {
    positions: outPositions,
    normals: outNormals,
    uvs: outUVs,
    indices: new Uint16Array(indices),
    uniqueVertexCount: outPositions.length,
    rawVertexCount: triangles.length * 3
  };
}

// Per-vertex tangents from UV gradients: for each triangle, solves for the
// direction that maps to increasing U given its edges and UV deltas, then
// averages contributions at shared vertices. `indices` is the triangle list
// from buildIndexedMesh.
export function computeTangents(positions, uvs, indices) {
  const tangents = positions.map(() => [0, 0, 0]);

  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i], i1 = indices[i + 1], i2 = indices[i + 2];
    const p0 = positions[i0], p1 = positions[i1], p2 = positions[i2];
    const uv0 = uvs[i0], uv1 = uvs[i1], uv2 = uvs[i2];

    const edge1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const edge2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    const duv1 = [uv1[0] - uv0[0], uv1[1] - uv0[1]];
    const duv2 = [uv2[0] - uv0[0], uv2[1] - uv0[1]];

    const denom = duv1[0] * duv2[1] - duv2[0] * duv1[1];
    if (Math.abs(denom) < 1e-10) continue; // degenerate UVs: skip this triangle
    const f = 1 / denom;
    const T = [0, 1, 2].map((c) => f * (duv2[1] * edge1[c] - duv1[1] * edge2[c]));
    for (const idx of [i0, i1, i2]) tangents[idx] = tangents[idx].map((v, c) => v + T[c]);
  }

  return tangents.map((t) => {
    const len = Math.hypot(...t) || 1;
    return t.map((v) => v / len);
  });
}
