// Week 8: a small, from-scratch OBJ + MTL parser — enough to load a
// hand-authored teaching model. Not a full-spec implementation: no
// smoothing groups, no `l`/`p` lines, no negative (relative) indices.

// Parses OBJ text into raw position/texcoord/normal arrays plus a
// triangulated face list (every face already fan-triangulated, so a
// quad or n-gon in the file becomes 2+ triangles here).
export function parseOBJ(text) {
  const positions = [];
  const texcoords = [];
  const normals = [];
  const faces = []; // each: [{p,t,n}, {p,t,n}, {p,t,n}]
  const faceMaterials = [];
  let material = null;

  function parseRef(token) {
    const parts = token.split("/");
    // OBJ indices are 1-based; convert to 0-based, missing parts stay null.
    return {
      p: parts[0] ? parseInt(parts[0], 10) - 1 : null,
      t: parts[1] ? parseInt(parts[1], 10) - 1 : null,
      n: parts[2] ? parseInt(parts[2], 10) - 1 : null
    };
  }

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const [tag, ...rest] = line.split(/\s+/);
    if (tag === "v") {
      const [x, y, z] = rest.map(Number);
      positions.push({x, y, z});
    } else if (tag === "vt") {
      const [u, v] = rest.map(Number);
      texcoords.push({u, v});
    } else if (tag === "vn") {
      const [x, y, z] = rest.map(Number);
      normals.push({x, y, z});
    } else if (tag === "usemtl") {
      material = rest[0];
    } else if (tag === "f") {
      const refs = rest.map(parseRef);
      for (let i = 1; i < refs.length - 1; i++) {
        faces.push([refs[0], refs[i], refs[i + 1]]);
        faceMaterials.push(material);
      }
    }
  }

  return {positions, texcoords, normals, faces, faceMaterials};
}

// Parses MTL text into { materialName: {Kd:[r,g,b], Ks:[r,g,b], Ns} }.
export function parseMTL(text) {
  const materials = {};
  let current = null;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const [tag, ...rest] = line.split(/\s+/);
    if (tag === "newmtl") {
      current = rest[0];
      materials[current] = {Kd: [0.8, 0.8, 0.8], Ks: [0, 0, 0], Ns: 10};
    } else if (tag === "Kd" && current) {
      materials[current].Kd = rest.map(Number);
    } else if (tag === "Ks" && current) {
      materials[current].Ks = rest.map(Number);
    } else if (tag === "Ns" && current) {
      materials[current].Ns = Number(rest[0]);
    }
  }
  return materials;
}

// Groups a parsed OBJ's (already-triangulated) faces by their usemtl
// name, in first-seen order.
export function groupFacesByMaterial({faces, faceMaterials}) {
  const groups = new Map();
  faces.forEach((face, i) => {
    const name = faceMaterials[i] ?? "__default__";
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(face);
  });
  return groups;
}

// The import pipeline's "build buffers" step: deduplicates unique
// position/normal/texcoord triples into one vertex record each,
// producing a flat indexed mesh ready for a GPU vertex + index buffer.
export function buildIndexedMesh({positions, normals, texcoords}, faces) {
  const vertexMap = new Map(); // "p,n,t" -> new vertex index
  const outPositions = [];
  const outNormals = [];
  const outUVs = [];
  const indices = [];

  for (const tri of faces) {
    for (const ref of tri) {
      const key = `${ref.p},${ref.n},${ref.t}`;
      let index = vertexMap.get(key);
      if (index === undefined) {
        index = outPositions.length;
        vertexMap.set(key, index);
        outPositions.push(positions[ref.p]);
        outNormals.push(ref.n !== null ? normals[ref.n] : {x: 0, y: 1, z: 0});
        outUVs.push(ref.t !== null && texcoords ? texcoords[ref.t] : {u: 0, v: 0});
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
    rawVertexCount: faces.length * 3
  };
}

// Per-vertex tangents from UV gradients (the standard technique): for
// each triangle, solves for the tangent direction that maps to
// increasing U given the triangle's edge vectors and UV deltas, then
// averages contributions at shared vertices — the same accumulate-then-
// normalize pattern as mesh.js's averageVertexNormals. `indices` is the
// already-indexed triangle list from buildIndexedMesh.
export function computeTangents(positions, uvs, indices) {
  const tangents = positions.map(() => ({x: 0, y: 0, z: 0}));

  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i], i1 = indices[i + 1], i2 = indices[i + 2];
    const p0 = positions[i0], p1 = positions[i1], p2 = positions[i2];
    const uv0 = uvs[i0], uv1 = uvs[i1], uv2 = uvs[i2];

    const edge1 = {x: p1.x - p0.x, y: p1.y - p0.y, z: p1.z - p0.z};
    const edge2 = {x: p2.x - p0.x, y: p2.y - p0.y, z: p2.z - p0.z};
    const duv1 = {u: uv1.u - uv0.u, v: uv1.v - uv0.v};
    const duv2 = {u: uv2.u - uv0.u, v: uv2.v - uv0.v};

    const denom = duv1.u * duv2.v - duv2.u * duv1.v;
    if (Math.abs(denom) < 1e-10) continue; // degenerate UVs — skip this triangle's contribution
    const f = 1 / denom;
    const T = {
      x: f * (duv2.v * edge1.x - duv1.v * edge2.x),
      y: f * (duv2.v * edge1.y - duv1.v * edge2.y),
      z: f * (duv2.v * edge1.z - duv1.v * edge2.z)
    };
    for (const idx of [i0, i1, i2]) {
      tangents[idx] = {x: tangents[idx].x + T.x, y: tangents[idx].y + T.y, z: tangents[idx].z + T.z};
    }
  }

  return tangents.map((t) => {
    const len = Math.hypot(t.x, t.y, t.z) || 1;
    return {x: t.x / len, y: t.y / len, z: t.z / len};
  });
}
