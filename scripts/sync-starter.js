// Copies the shared course library from ../starter/src/lib into src/lib, so the
// handouts use the same helpers, at the same paths, as the activities and
// assignments. Runs before dev/build/deploy (see the "pre*" scripts in
// package.json), or by hand with `npm run sync-starter`.
//
// src/lib/math/transforms.js is not synced: the starter's copy is unimplemented
// because it is an assignment deliverable, so the handouts keep their own
// implementation with the same names and signatures.
//
// If ../starter is not present (e.g. deploying from a checkout of this folder
// alone), the committed copies are left as they are.

import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {dirname, join, relative} from "node:path";
import {fileURLToPath} from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "..", "starter", "src", "lib");
const target = join(root, "src", "lib");
const files = ["webgpu.js", "obj-mtl.js", "math/mat4.js", "math/vec3.js"];

function header(file) {
  return [
    "// GENERATED FILE: do not edit directly.",
    `// Synced from starter/src/lib/${file} by scripts/sync-starter.js`,
    "// (runs automatically before dev/build/deploy). Edit the source file in",
    "// starter/src/lib/ and re-run `npm run sync-starter` instead.",
    "",
    ""
  ].join("\n");
}

if (!existsSync(source)) {
  console.warn(`sync-starter: ${relative(root, source)} not found; keeping the committed copies.`);
} else {
  for (const file of files) {
    const path = join(target, file);
    mkdirSync(dirname(path), {recursive: true});
    const text = header(file) + readFileSync(join(source, file), "utf8");
    const old = existsSync(path) ? readFileSync(path, "utf8") : null;
    if (old !== text) {
      writeFileSync(path, text);
      console.log(`sync-starter: updated src/lib/${file}`);
    }
  }
}
