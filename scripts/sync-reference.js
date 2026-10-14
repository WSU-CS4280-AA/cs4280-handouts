// Copies shared library code from ../reference/src/lib into src/components so
// the handouts teach with the same helpers the assignments use. Runs before
// dev/build/deploy (see the "pre*" scripts in package.json), or by hand with
// `npm run sync-reference`.
//
// If ../reference is not present (e.g. deploying from a checkout of this
// folder alone), the committed copies are left as they are.

import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {dirname, join, relative} from "node:path";
import {fileURLToPath} from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const lib = join(root, "..", "reference", "src", "lib");
const components = join(root, "src", "components");

// Each output file is built from one or more reference sources, in order.
const targets = [
  {out: "vec3.js", sources: ["math/vec3.js"]},
  // transforms.js is merged into mat4.js, so handouts get translate/scale/
  // lookAt/... from the same `mat4` import as multiply/invert.
  {out: "mat4.js", sources: ["math/mat4.js", "math/transforms.js"]},
  {out: "lib/webgpu.js", sources: ["webgpu.js"]}
];

function header(sources) {
  const list = sources.map((s) => `reference/src/lib/${s}`).join(", ");
  return [
    "// GENERATED FILE — do not edit directly.",
    `// Synced from ${list} by scripts/sync-reference.js`,
    "// (runs automatically before dev/build/deploy). Edit the source files in",
    "// reference/src/lib/ and re-run `npm run sync-reference` instead.",
    ""
  ].join("\n");
}

// Splits a module into its import lines and the rest.
function splitImports(text) {
  const lines = text.split("\n");
  const imports = lines.filter((l) => l.startsWith("import "));
  const body = lines.filter((l) => !l.startsWith("import ")).join("\n").replace(/^\n+/, "");
  return {imports, body};
}

function build({out, sources}) {
  const outName = out.split("/").pop();
  const imports = new Set();
  const bodies = sources.map((source, k) => {
    const parsed = splitImports(readFileSync(join(lib, source), "utf8"));
    for (const line of parsed.imports) {
      if (line.includes(`"./${outName}"`)) continue;              // the merged file itself
      imports.add(line);
    }
    let body = parsed.body;
    if (k > 0) {
      // Calls like `mat4.identity()` now refer to functions in this same file.
      const self = outName.replace(/\.js$/, "");
      body = body.replaceAll(`${self}.`, "");
      const name = source.split("/").pop();
      body = `// --- Transform-matrix construction (from ${name}) ---\n\n` + body.replace(/^\/\*\*[\s\S]*?\*\/\n+/, "");
    }
    return body.trimEnd();
  });
  const importBlock = imports.size ? [...imports].join("\n") + "\n\n" : "";
  return header(sources) + "\n" + importBlock + bodies.join("\n\n") + "\n";
}

if (!existsSync(lib)) {
  console.warn(`sync-reference: ${relative(root, lib)} not found; keeping the committed copies.`);
} else {
  for (const target of targets) {
    const path = join(components, target.out);
    mkdirSync(dirname(path), {recursive: true});
    const text = build(target);
    const old = existsSync(path) ? readFileSync(path, "utf8") : null;
    if (old !== text) {
      writeFileSync(path, text);
      console.log(`sync-reference: updated src/components/${target.out}`);
    }
  }
}
