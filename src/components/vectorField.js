// A small, shared SVG coordinate-plane toolkit for Week 1's diagrams:
// grid + axes, arrows, polygons, and (in dragVectors) draggable vector
// tips. Built on d3 for scales and drag behavior — everything else is
// plain SVG, so it's easy to read start to finish.

import * as d3 from "npm:d3";

// Builds a math-space <-> screen-space coordinate system inside an SVG of
// the given pixel size, with the origin centered and `domain` math units
// visible from the origin to each edge.
export function plane({width = 380, height = 380, domain = 5, grid = true} = {}) {
  const svg = d3.create("svg")
    .attr("viewBox", [0, 0, width, height])
    .attr("width", width)
    .attr("height", height)
    .style("max-width", "100%")
    .style("touch-action", "none")
    .style("background", "var(--theme-background-alt, #f5f5f5)")
    .style("border-radius", "8px");

  const x = d3.scaleLinear().domain([-domain, domain]).range([0, width]);
  const y = d3.scaleLinear().domain([-domain, domain]).range([height, 0]);

  if (grid) {
    const ticks = x.ticks(domain * 2);
    svg.append("g").attr("stroke", "currentColor").attr("stroke-opacity", 0.08)
      .selectAll("line.v").data(ticks).join("line")
      .attr("x1", (d) => x(d)).attr("x2", (d) => x(d)).attr("y1", 0).attr("y2", height);
    svg.append("g").attr("stroke", "currentColor").attr("stroke-opacity", 0.08)
      .selectAll("line.h").data(ticks).join("line")
      .attr("y1", (d) => y(d)).attr("y2", (d) => y(d)).attr("x1", 0).attr("x2", width);
  }

  // Axes through the origin.
  svg.append("line").attr("x1", 0).attr("x2", width).attr("y1", y(0)).attr("y2", y(0))
    .attr("stroke", "currentColor").attr("stroke-opacity", 0.35);
  svg.append("line").attr("x1", x(0)).attr("x2", x(0)).attr("y1", 0).attr("y2", height)
    .attr("stroke", "currentColor").attr("stroke-opacity", 0.35);

  // A reusable arrowhead marker, one per color, so multiple vectors can
  // each get an arrowhead in their own color without marker collisions.
  const defs = svg.append("defs");
  function arrowMarker(color) {
    const id = `arrow-${color.replace(/[^a-z0-9]/gi, "")}`;
    if (defs.select(`#${id}`).empty()) {
      defs.append("marker")
        .attr("id", id)
        .attr("viewBox", "0 0 10 10")
        .attr("refX", 8).attr("refY", 5)
        .attr("markerWidth", 6).attr("markerHeight", 6)
        .attr("orient", "auto-start-reverse")
        .append("path")
        .attr("d", "M 0 0 L 10 5 L 0 10 z")
        .attr("fill", color);
    }
    return `url(#${id})`;
  }

  return {svg, x, y, arrowMarker};
}

// Draws an arrow from `from` to `to` (both in math space) plus an optional
// text label near the tip.
export function drawArrow(scene, from, to, {color = "steelblue", label, width = 2.5} = {}) {
  const {svg, x, y, arrowMarker} = scene;
  svg.append("line")
    .attr("x1", x(from.x)).attr("y1", y(from.y))
    .attr("x2", x(to.x)).attr("y2", y(to.y))
    .attr("stroke", color).attr("stroke-width", width)
    .attr("marker-end", arrowMarker(color));
  if (label) {
    svg.append("text")
      .attr("x", x(to.x) + 8).attr("y", y(to.y) - 8)
      .attr("fill", color).attr("font-size", 13).attr("font-family", "var(--sans-serif)")
      .text(label);
  }
}

export function drawPoint(scene, p, {color = "currentColor", r = 4, label} = {}) {
  const {svg, x, y} = scene;
  svg.append("circle").attr("cx", x(p.x)).attr("cy", y(p.y)).attr("r", r).attr("fill", color);
  if (label) {
    svg.append("text")
      .attr("x", x(p.x) + 8).attr("y", y(p.y) - 8)
      .attr("fill", color).attr("font-size", 13).attr("font-family", "var(--sans-serif)")
      .text(label);
  }
}

export function drawPolygon(scene, points, {stroke = "currentColor", fill = "none", opacity = 1} = {}) {
  const {svg, x, y} = scene;
  const d = points.map((p) => [x(p.x), y(p.y)]);
  svg.append("polygon")
    .attr("points", d.map((p) => p.join(",")).join(" "))
    .attr("stroke", stroke).attr("fill", fill).attr("fill-opacity", fill === "none" ? 0 : opacity)
    .attr("stroke-width", 2);
}

export function drawEllipse(scene, {center = {x: 0, y: 0}, rx, ry, rotation = 0, stroke = "currentColor"} = {}) {
  const {svg, x, y} = scene;
  // SVG's own rotate is in screen degrees (clockwise), math rotation is
  // counter-clockwise radians in a y-up frame — flip the sign to match.
  const deg = (-rotation * 180) / Math.PI;
  svg.append("ellipse")
    .attr("cx", x(center.x)).attr("cy", y(center.y))
    .attr("rx", Math.abs(x(rx) - x(0))).attr("ry", Math.abs(y(ry) - y(0)))
    .attr("transform", `rotate(${deg} ${x(center.x)} ${y(center.y)})`)
    .attr("stroke", stroke).attr("fill", "none").attr("stroke-width", 2);
}

// An interactive, drag-to-edit set of vectors, each drawn as an arrow from
// the origin to a draggable tip. `vectors` is an object of labeled {x, y}
// tips, e.g. dragVectors({a: {x: 3, y: 1}, b: {x: 1, y: 2.2}}) — each key
// doubles as that vector's on-screen label. Returns a DOM node with a
// `.value` (the live object of tips, same shape as `vectors`) that
// dispatches "input" events on drag — the shape Observable's `viewof`
// expects.
export function dragVectors(vectors, {
  width = 380,
  height = 380,
  domain = 5,
  colors = ["steelblue", "orangered", "seagreen", "purple"]
} = {}) {
  const labels = Object.keys(vectors);
  const {svg, x, y, arrowMarker} = plane({width, height, domain});
  const root = document.createElement("div");
  root.appendChild(svg.node());
  root.value = Object.fromEntries(labels.map((label) => [label, {...vectors[label]}]));

  // A layer for caller-supplied derived vectors (sums, projections,
  // Mv, ...), kept underneath the drag handles so it never intercepts
  // drag gestures. See `root.redecorate` below.
  const derived = svg.append("g").attr("class", "derived");

  // Elements are created ONCE, then have their positions updated in place
  // on every drag tick — rebuilding (removing + re-appending) the very
  // circle currently under the pointer mid-gesture corrupts the drag (the
  // browser drops pointer capture on removed elements), which is what
  // caused points to fly off wildly on drag.
  const g = svg.append("g").attr("class", "dynamic");
  const items = labels.map((label, i) => {
    const color = colors[i % colors.length];
    const line = g.append("line")
      .attr("stroke", color).attr("stroke-width", 2.5)
      .attr("marker-end", arrowMarker(color));
    const text = g.append("text").attr("fill", color).attr("font-size", 13)
      .attr("font-family", "var(--sans-serif)").text(label);
    const handle = g.append("circle")
      .attr("r", 7).attr("fill", color).attr("stroke", "white").attr("stroke-width", 2)
      .style("cursor", "grab");
    return {line, text, handle};
  });

  function place(label) {
    const tip = root.value[label];
    const {line, text, handle} = items[labels.indexOf(label)];
    line.attr("x1", x(0)).attr("y1", y(0)).attr("x2", x(tip.x)).attr("y2", y(tip.y));
    handle.attr("cx", x(tip.x)).attr("cy", y(tip.y));
    text.attr("x", x(tip.x) + 8).attr("y", y(tip.y) - 8);
  }

  labels.forEach((label, i) => {
    place(label);
    items[i].handle.call(
      d3.drag()
        // Without an explicit subject, d3 anchors the drag to wherever the
        // pointer went down — even a few px off the handle's true center —
        // and the point snaps there on the first move. Anchoring to the
        // point's actual screen position instead means only the pointer's
        // *movement* (not its exact starting pixel) drives the drag.
        .subject(() => ({x: x(root.value[label].x), y: y(root.value[label].y)}))
        .on("start", function () { d3.select(this).style("cursor", "grabbing"); })
        .on("drag", (event) => {
          root.value[label] = {x: x.invert(event.x), y: y.invert(event.y)};
          place(label);
          root.dispatchEvent(new Event("input"));
        })
        .on("end", function () { d3.select(this).style("cursor", "grab"); })
    );
  });

  // Lets a downstream reactive cell draw derived vectors (a + b, Mv, a
  // projected onto b, ...) into this same SVG — one live diagram instead
  // of a draggable widget plus a separate static plane() redrawing it.
  // Clears and redraws on every call, so it's safe to call from a cell
  // that reruns on any dependency change, not just drag ticks.
  root.redecorate = (fn) => {
    derived.selectAll("*").remove();
    fn({svg: derived, x, y, arrowMarker});
  };

  return root;
}

// Like dragVectors, but draws plain draggable points with no arrows from
// the origin — for diagrams about points as locations (Points vs. Vectors)
// rather than vectors as displacements. `points` is an object of labeled
// {x, y} points, e.g. dragPoints({A: {x: -2, y: -1}, B: {x: 2, y: 1.5}}) —
// each key doubles as that point's on-screen label. `.value` mirrors that
// same shape, live-updated as points are dragged.
export function dragPoints(points, {
  width = 380,
  height = 380,
  domain = 5,
  colors = ["steelblue", "orangered", "seagreen", "purple"]
} = {}) {
  const labels = Object.keys(points);
  const {svg, x, y, arrowMarker} = plane({width, height, domain});
  const root = document.createElement("div");
  root.appendChild(svg.node());
  root.value = Object.fromEntries(labels.map((label) => [label, {...points[label]}]));

  // See dragVectors above for both of these: a layer for caller-supplied
  // derived vectors, kept under the handles so it can't intercept drags,
  // and elements created once and updated in place on every drag tick,
  // never removed/re-appended mid-gesture.
  const derived = svg.append("g").attr("class", "derived");
  const g = svg.append("g").attr("class", "dynamic");
  const items = labels.map((label, i) => {
    const color = colors[i % colors.length];
    const dot = g.append("circle").attr("r", 7).attr("fill", color);
    const text = g.append("text").attr("fill", color).attr("font-size", 13)
      .attr("font-family", "var(--sans-serif)").text(label);
    // A larger transparent hit target on top, easier to grab than the 7px dot.
    const handle = g.append("circle")
      .attr("r", 11).attr("fill", "transparent")
      .style("cursor", "grab");
    return {dot, text, handle};
  });

  function place(label) {
    const p = root.value[label];
    const {dot, text, handle} = items[labels.indexOf(label)];
    dot.attr("cx", x(p.x)).attr("cy", y(p.y));
    handle.attr("cx", x(p.x)).attr("cy", y(p.y));
    text.attr("x", x(p.x) + 8).attr("y", y(p.y) - 8);
  }

  labels.forEach((label, i) => {
    place(label);
    items[i].handle.call(
      d3.drag()
        // See dragVectors above — anchor to the point's true position so
        // dragging tracks pointer movement, not the exact click pixel.
        .subject(() => ({x: x(root.value[label].x), y: y(root.value[label].y)}))
        .on("start", function () { d3.select(this).style("cursor", "grabbing"); })
        .on("drag", (event) => {
          root.value[label] = {x: x.invert(event.x), y: y.invert(event.y)};
          place(label);
          root.dispatchEvent(new Event("input"));
        })
        .on("end", function () { d3.select(this).style("cursor", "grab"); })
    );
  });

  // See dragVectors above.
  root.redecorate = (fn) => {
    derived.selectAll("*").remove();
    fn({svg: derived, x, y, arrowMarker});
  };

  return root;
}
