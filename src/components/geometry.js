// Minimal 3D mesh generation for Week 5: a UV sphere with smooth
// per-vertex normals, plus a "flatten" transform that duplicates
// vertices per triangle with a recomputed per-face normal — the two
// normal sources Flat/Gouraud/Phong shading (this week) compare.

// Smooth, indexed UV sphere: one vertex per (lat, lon) grid point, its
// normal simply its own normalized position (a sphere centered at the
// origin), shared by every triangle that touches it.
export function createSphere(latBands = 20, lonBands = 28, radius = 1) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  for (let lat = 0; lat <= latBands; lat++) {
    const theta = (lat * Math.PI) / latBands; // 0 (north pole) to PI (south pole)
    const sinTheta = Math.sin(theta), cosTheta = Math.cos(theta);
    for (let lon = 0; lon <= lonBands; lon++) {
      const phi = (lon * 2 * Math.PI) / lonBands;
      const x = Math.cos(phi) * sinTheta;
      const y = cosTheta;
      const z = Math.sin(phi) * sinTheta;
      positions.push(radius * x, radius * y, radius * z);
      normals.push(x, y, z); // already unit length
      uvs.push(lon / lonBands, lat / latBands); // the sphere's natural lat/lon parameterization
    }
  }

  const stride = lonBands + 1;
  for (let lat = 0; lat < latBands; lat++) {
    for (let lon = 0; lon < lonBands; lon++) {
      const a = lat * stride + lon;
      const b = a + stride;
      // Counter-clockwise as seen from outside the sphere (WebGPU's
      // default front face), so back-face culling keeps the near side.
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint16Array(indices)
  };
}

// Un-indexes an indexed mesh, replacing every vertex's normal with its
// triangle's face normal — three duplicated vertices per triangle, no
// index buffer needed, matching lecture's n_face = normalize((v1-v0) x
// (v2-v0)). Interpolating three identical normals across a face is a
// no-op, which is exactly what flat shading is.
export function flatten({positions, indices}) {
  const flatPositions = [];
  const flatNormals = [];

  function at(i) {
    return [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
  }
  function sub(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  }
  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function normalize(a) {
    const len = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / len, a[1] / len, a[2] / len];
  }

  for (let t = 0; t < indices.length; t += 3) {
    const v0 = at(indices[t]), v1 = at(indices[t + 1]), v2 = at(indices[t + 2]);
    const n = normalize(cross(sub(v1, v0), sub(v2, v0)));
    for (const v of [v0, v1, v2]) {
      flatPositions.push(...v);
      flatNormals.push(...n);
    }
  }

  return {positions: new Float32Array(flatPositions), normals: new Float32Array(flatNormals)};
}

// Interleaves separate position/normal(/uv) arrays into one
// [x,y,z,nx,ny,nz,(u,v), ...] buffer — the layout every pipeline in this
// handout's vertex buffers expects. `uvs` is optional (omit for a plain
// 6-float pos+normal stride, exactly Week 5/8's layout).
export function interleave(positions, normals, uvs) {
  const count = positions.length / 3;
  const stride = uvs ? 8 : 6;
  const out = new Float32Array(count * stride);
  for (let i = 0; i < count; i++) {
    out[i * stride + 0] = positions[i * 3 + 0];
    out[i * stride + 1] = positions[i * 3 + 1];
    out[i * stride + 2] = positions[i * 3 + 2];
    out[i * stride + 3] = normals[i * 3 + 0];
    out[i * stride + 4] = normals[i * 3 + 1];
    out[i * stride + 5] = normals[i * 3 + 2];
    if (uvs) {
      out[i * stride + 6] = uvs[i * 2 + 0];
      out[i * stride + 7] = uvs[i * 2 + 1];
    }
  }
  return out;
}
