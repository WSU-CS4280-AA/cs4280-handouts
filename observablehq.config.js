import { codeCollapseHead } from "./codeCollapse.js";

// See https://observablehq.com/framework/config for documentation.

// Set to true to hide the sidebar and prev/next links on every weekly
// handout page, so each week can be viewed/printed/shared standalone.
// The home page (src/index.md) keeps its sidebar regardless.
const standaloneWeeks = false;

// Site-wide text styles. Framework caps prose at 600-640px but code blocks at
// 960px, offset 1rem to the left, so --prose-width extends text to the right
// edge of the code blocks: 960px - 1rem.
const textStylesCss = `<style>
:root {
  --prose-width: calc(960px - 1rem);
  --serif: "Inter", system-ui, sans-serif; /* Framework's body and heading font; math stays in KaTeX's serif */
}
body {
  font-size: 16px;
  line-height: 1.7;
}
p, table, h1, h2, h3, h4, h5, h6, .katex-display,
.note, .tip, .warning, .caution {
  max-width: var(--prose-width);
}
ol, ul {
  max-width: var(--prose-width);
  box-sizing: border-box;
}
blockquote {
  max-width: calc(var(--prose-width) - 3rem); /* it has 1.5rem side margins */
}
/* Inputs.table output is a form that otherwise fills the whole page column.
   The id outranks the max-width: 100% in the Inputs stylesheet's class rule. */
#observablehq-main form:has(> table) {
  max-width: var(--prose-width);
}
h2 {
  margin-top: 2.5rem;
  margin-bottom: 0.75rem;
}
h3 {
  margin-top: 1.75rem;
  margin-bottom: 0.5rem;
}
h2 + h3 {
  margin-top: 0.75rem;
}
</style>`;

export default {
  // The app's title; used in the sidebar and webpage titles.
  title: "CS 4280 Hands-On Handouts",

  // The pages and sections in the sidebar. If you don't specify this option,
  // all pages will be listed in alphabetical order. Listing pages explicitly
  // lets you organize them into sections and have unlisted pages.
  // pages: [
  //   {
  //     name: "Weekly Handouts",
  //   }
  // ],

  // Content to add to the head of the page, e.g. for a favicon:
  // codeCollapseHead collapses long code blocks (see codeCollapse.js).
  head: '<link rel="icon" href="observable.png" type="image/png" sizes="32x32">' + textStylesCss + codeCollapseHead,

  // Replaces Framework's default Source Serif 4.
  globalStylesheets: ["https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap"],

  // The path to the source root.
  root: "src",

  // Some additional configuration options and their defaults:
  theme: "dashboard",
  footer: "CS 4280 - Computer Graphics:  Weekly hands-on handouts.",
  sidebar: !standaloneWeeks,
  toc: true,
  pager: !standaloneWeeks,
  search: true,
  linkify: true,
};
