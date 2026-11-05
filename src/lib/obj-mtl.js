// GENERATED FILE: do not edit directly.
// Synced from starter/src/lib/obj-mtl.js by scripts/sync-starter.js
// (runs automatically before dev/build/deploy). Edit the source file in
// starter/src/lib/ and re-run `npm run sync-starter` instead.

// OBJ and MTL parsers: text in, plain arrays out. Building GPU buffers from
// the result is left to the caller.
//
// Supported: `v`, `vt`, `vn`, `f` (any polygon, fan-triangulated; corners
// `v`, `v/t`, `v//n`, or `v/t/n`; negative indices), `usemtl`, and
// `mtllib`. Every other record (`o`, `g`, `s`, `l`, `p`, comments) is
// skipped. Smoothing groups are ignored: missing normals become flat face
// normals.

/** The material used for faces with no `usemtl`, or a name the MTL file lacks. */
export const DEFAULT_MATERIAL = Object.freeze({
  Ka: Object.freeze([0, 0, 0]),
  Kd: Object.freeze([0.8, 0.8, 0.8]),
  Ks: Object.freeze([0, 0, 0]),
  Ns: 0,
  d: 1,
  map_Kd: null,
});

/**
 * Parses OBJ text.
 *
 * Returns `{ positions, texcoords, normals, triangles, materialLibraries }`:
 * - `positions`, `normals`: arrays of `[x, y, z]`; `texcoords`: arrays of `[u, v]`.
 * - `triangles`: `{ corners, material }`, where `corners` holds 3 corners
 *   `{ p, t, n }` of 0-based indices into the arrays above (`t` is `null`
 *   when the file has no texture coordinate) and `material` is the
 *   `usemtl` name in effect (`null` before the first `usemtl`).
 * - `materialLibraries`: the file names given by `mtllib`.
 *
 * With `computeNormals` (the default), a face with no normals gets its flat
 * face normal, appended to `normals`, so every corner's `n` is an index.
 */
export function parseOBJ(text, { computeNormals = true } = {}) {
  const positions = [];
  const texcoords = [];
  const normals = [];
  const triangles = [];
  const materialLibraries = [];
  let material = null;

  // 1-based, or negative to count back from the most recent record.
  const resolve = (index, count) => (index < 0 ? count + index : index - 1);

  for (const line of text.split(/\r?\n/)) {
    const [tag, ...values] = line.trim().split(/\s+/);
    // slice() drops extras: a `v` line's w or vertex color, a `vt` line's w.
    if (tag === "v") positions.push(values.slice(0, 3).map(Number));
    else if (tag === "vt") texcoords.push(values.slice(0, 2).map(Number));
    else if (tag === "vn") normals.push(values.slice(0, 3).map(Number));
    else if (tag === "usemtl") material = values.join(" ");
    else if (tag === "mtllib") materialLibraries.push(values.join(" "));
    else if (tag === "f") {
      if (values.length < 3) continue;
      const corners = values.map((corner) => {
        const [p, t, n] = corner.split("/");
        return {
          p: resolve(Number(p), positions.length),
          t: t ? resolve(Number(t), texcoords.length) : null,
          n: n ? resolve(Number(n), normals.length) : null,
        };
      });
      if (computeNormals && corners.some((corner) => corner.n === null)) {
        normals.push(faceNormal(corners.map((corner) => positions[corner.p])));
        for (const corner of corners) corner.n ??= normals.length - 1;
      }
      for (let i = 1; i + 1 < corners.length; i++) {
        triangles.push({ corners: [corners[0], corners[i], corners[i + 1]], material });
      }
    }
  }
  return { positions, texcoords, normals, triangles, materialLibraries };
}

/**
 * Parses MTL text into `{ name: { Ka, Kd, Ks, Ns, d, map_Kd } }`. Missing
 * keys take their values from DEFAULT_MATERIAL. `Tr` is read as `1 − d`, and
 * `map_Kd` keeps only its last word (the file name, after any options).
 */
export function parseMTL(text) {
  const materials = {};
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const [tag, ...values] = line.trim().split(/\s+/);
    if (tag === "newmtl") {
      const { Ka, Kd, Ks } = DEFAULT_MATERIAL;
      current = { ...DEFAULT_MATERIAL, Ka: [...Ka], Kd: [...Kd], Ks: [...Ks] };
      materials[values.join(" ")] = current;
    } else if (!current) {
      // a record before the first newmtl has no material to go to
    } else if (tag === "Ka" || tag === "Kd" || tag === "Ks") {
      current[tag] = values.slice(0, 3).map(Number);
    } else if (tag === "Ns" || tag === "d") {
      current[tag] = Number(values[0]);
    } else if (tag === "Tr") {
      current.d = 1 - Number(values[0]);
    } else if (tag === "map_Kd") {
      current.map_Kd = values.at(-1);
    }
  }
  return materials;
}

/** A polygon's unit normal by Newell's method, which also handles non-planar n-gons. */
function faceNormal(points) {
  const normal = [0, 0, 0];
  points.forEach((a, i) => {
    const b = points[(i + 1) % points.length];
    normal[0] += (a[1] - b[1]) * (a[2] + b[2]);
    normal[1] += (a[2] - b[2]) * (a[0] + b[0]);
    normal[2] += (a[0] - b[0]) * (a[1] + b[1]);
  });
  const length = Math.hypot(...normal);
  return length > 0 ? normal.map((value) => value / length) : [0, 1, 0]; // degenerate face
}
