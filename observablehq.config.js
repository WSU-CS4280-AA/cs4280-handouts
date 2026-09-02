// See https://observablehq.com/framework/config for documentation.

// Set to true to hide the sidebar and prev/next links on every weekly
// handout page, so each week can be viewed/printed/shared standalone.
// The home page (src/index.md) keeps its sidebar regardless.
const standaloneWeeks = false;

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
  head: '<link rel="icon" href="observable.png" type="image/png" sizes="32x32">',

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
