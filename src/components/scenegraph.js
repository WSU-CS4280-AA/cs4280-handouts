// Week 8: a minimal hierarchical scene graph. Each node holds a local
// transform, optional drawable payload, and children; rendering is a
// depth-first traversal composing world = parentWorld * local down the
// tree — the matrix-stack pattern from lecture, expressed as recursion
// (the JS call stack *is* the matrix stack: parentWorld is exactly
// "top of stack", and it's naturally discarded — popped — when a call
// returns to its caller).

import * as mat4 from "./mat4.js";

export class SceneNode {
  constructor(name, localMatrix = mat4.identity(), {mesh = null, children = []} = {}) {
    this.name = name;
    this.localMatrix = localMatrix;
    this.mesh = mesh;
    this.children = children;
  }
}

// Visits every node with its accumulated world matrix: visit(node, worldMatrix).
export function traverse(node, visit, parentWorld = mat4.identity()) {
  const worldMatrix = mat4.multiply(parentWorld, node.localMatrix);
  visit(node, worldMatrix);
  for (const child of node.children) traverse(child, visit, worldMatrix);
}
