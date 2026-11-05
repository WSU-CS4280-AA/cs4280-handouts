# CS 4280 Hands-On Handouts

An [Observable Framework](https://observablehq.com/framework/) site of
weekly, self-study handouts for CS 4280 (Computer Graphics). Each page
teaches that week's topic from the [course schedule](../CS4280-syllabus.html)
from first principles, with fresh runnable JavaScript/WebGPU code — not a
copy of the graded assignments in `../reference/`.

To install the required dependencies, run:

```
npm install
```

Then, to start the local preview server, run:

```
npm run dev
```

Then visit <http://localhost:3000> to preview the site.

## Project structure

```ini
.
├─ src
│  ├─ components/          # shared JS modules (math, WebGPU helpers, widgets)
│  ├─ week01.md … week14.md  # one handout per non-exam week
│  └─ index.md              # home page / table of contents
├─ observablehq.config.js   # sidebar nav + app config
└─ package.json
```

Week 7 (Midterm Review & Midterm) and Week 15 (Final Exam Review) have no
handout, matching the syllabus.

Set `standaloneWeeks` to `true` at the top of `observablehq.config.js` to
hide the sidebar and prev/next links on every weekly handout (useful for
printing or sharing a single week standalone). The home page keeps its
sidebar regardless.

## Shared code from `starter/`

`scripts/sync-starter.js` copies the course library from `../starter/src/lib`
into `src/lib`, so the handouts use the same helpers, at the same paths, as the
activities and assignments:

| Generated file | Source |
| --- | --- |
| `src/lib/webgpu.js` | `starter/src/lib/webgpu.js` |
| `src/lib/obj-mtl.js` | `starter/src/lib/obj-mtl.js` |
| `src/lib/math/mat4.js` | `starter/src/lib/math/mat4.js` |
| `src/lib/math/vec3.js` | `starter/src/lib/math/vec3.js` |

It runs automatically before `npm run dev`, `build`, and `deploy`, or by hand
with `npm run sync-starter`. Don't edit the generated files; edit the sources
in `starter/src/lib` instead. If `../starter` is missing, the committed copies
are kept.

`src/lib/math/transforms.js` is written for the handouts rather than synced,
because the starter's copy is an unimplemented assignment deliverable. Its
function names and signatures match the starter's.

Helpers used only by the handouts live in `src/components`.

## Command reference

| Command | Description |
| --- | --- |
| `npm install` | Install or reinstall dependencies |
| `npm run dev` | Start local preview server |
| `npm run build` | Build the static site to `./dist` |
| `npm run clean` | Clear the local data loader cache |
| `npm run sync-starter` | Re-copy the shared library code from `../starter/src/lib` |
