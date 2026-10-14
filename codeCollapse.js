// Collapsible code blocks: long code blocks (e.g. from ```js echo) are capped
// to a few lines with a fade and a "Show all N lines" toggle, so the demo that
// follows stays close to the prose. Injected into every page via the `head`
// option in observablehq.config.js.
//
// Opt out for a block that should always be fully visible by wrapping it:
//
//   <div class="code-expanded">
//
//   ```js echo
//   ...
//   ```
//
//   </div>

// Blocks with more than MIN_LINES lines collapse to PREVIEW_LINES lines.
const MIN_LINES = 8;
const PREVIEW_LINES = 5;

const css = `
pre.code-collapsed {
  max-height: calc(${PREVIEW_LINES} * 1.5em + 0.5rem);
  overflow-y: hidden;
  -webkit-mask-image: linear-gradient(to bottom, black 55%, transparent);
  mask-image: linear-gradient(to bottom, black 55%, transparent);
}
.code-toggle {
  display: block;
  margin: 0.25rem 0 1rem;
  padding: 2px 10px;
  font: 12px var(--sans-serif);
  color: var(--theme-foreground-muted);
  background: var(--theme-background-alt);
  border: 1px solid var(--theme-foreground-faintest);
  border-radius: 4px;
  cursor: pointer;
}
.code-toggle:hover {
  color: var(--theme-foreground);
}
.observablehq-pre-container:has(+ .code-toggle),
pre:has(+ .code-toggle) {
  margin-bottom: 0;
}
@media print {
  pre.code-collapsed {
    max-height: none;
    -webkit-mask-image: none;
    mask-image: none;
  }
  .code-toggle {
    display: none;
  }
}
`;

// Runs in the browser; serialized into an inline script below.
function setup(MIN_LINES) {
  function collapse(pre) {
    if (pre.dataset.collapse) return;
    pre.dataset.collapse = "done";
    if (pre.closest(".code-expanded")) return;
    const lines = pre.textContent.replace(/\n$/, "").split("\n").length;
    if (lines <= MIN_LINES) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "code-toggle";
    const update = () => {
      const collapsed = pre.classList.contains("code-collapsed");
      button.textContent = collapsed ? `▸ Show all ${lines} lines` : "▴ Collapse";
      button.setAttribute("aria-expanded", String(!collapsed));
    };
    button.addEventListener("click", () => {
      pre.classList.toggle("code-collapsed");
      update();
      // When collapsing, keep the code block in view rather than the page jumping.
      if (pre.classList.contains("code-collapsed") && pre.getBoundingClientRect().top < 0) {
        pre.scrollIntoView({block: "start"});
      }
    });
    pre.classList.add("code-collapsed");
    update();
    // Framework's copy button wraps the <pre> in a container; put the toggle
    // after that container if it exists, otherwise directly after the <pre>.
    const anchor = pre.parentNode.classList.contains("observablehq-pre-container") ? pre.parentNode : pre;
    anchor.after(button);
  }
  const run = () => document.querySelectorAll("pre:has(> code)").forEach(collapse);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
  // Re-run when the preview server hot-swaps page content.
  let pending = false;
  new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => ((pending = false), run()));
  }).observe(document.documentElement, {childList: true, subtree: true});
}

export const codeCollapseHead = `<style>${css}</style>
<script type="module">(${setup})(${MIN_LINES});</script>`;
