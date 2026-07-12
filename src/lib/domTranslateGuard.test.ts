import { describe, it, expect, beforeEach } from 'vitest';
import { installDomTranslateGuard } from './domTranslateGuard';

// A minimal fake DOM node whose removeChild/insertBefore THROW on a foreign parent, exactly like the real
// browser APIs (and like the crash in the admin's screenshot). We inject a fake `root.Node` so the guard
// patches this instead of the real global prototype.
interface FakeNode {
  parentNode: FakeNode | null;
  children: FakeNode[];
  removeChild(child: FakeNode): FakeNode;
  insertBefore(newNode: FakeNode, ref: FakeNode | null): FakeNode;
  appendChild(child: FakeNode): FakeNode;
}

// A FRESH Node class per test (its own prototype), so the guard's idempotency flag never leaks between tests.
// Its removeChild/insertBefore THROW on a foreign parent, exactly like the real browser APIs (and the crash).
function makeRoot() {
  class FakeNode {
    parentNode: FakeNode | null = null;
    children: FakeNode[] = [];
    removeChild(child: FakeNode): FakeNode {
      if (child.parentNode !== this) throw new Error("Failed to execute 'removeChild' on 'Node'");
      this.children = this.children.filter((c) => c !== child);
      child.parentNode = null;
      return child;
    }
    insertBefore(newNode: FakeNode, ref: FakeNode | null): FakeNode {
      if (ref && ref.parentNode !== this) throw new Error("Failed to execute 'insertBefore' on 'Node'");
      this.children.push(newNode);
      newNode.parentNode = this;
      return newNode;
    }
    appendChild(child: FakeNode): FakeNode {
      this.children.push(child);
      child.parentNode = this;
      return child;
    }
  }
  return { Node: FakeNode as unknown as { prototype?: any } & Function, FakeNode };
}

describe('installDomTranslateGuard — survive the Google-Translate DOM corruption', () => {
  let root: ReturnType<typeof makeRoot>;
  let Node: new () => FakeNode;
  beforeEach(() => {
    root = makeRoot();
    Node = root.FakeNode as unknown as new () => FakeNode;
    expect(installDomTranslateGuard(root)).toBe(true);
  });

  it('removeChild on a node whose parent changed no-ops instead of throwing (the crash)', () => {
    const realParent = new Node();
    const wrongParent = new Node();
    const child = new Node();
    realParent.appendChild(child); // child belongs to realParent
    // React (post-translation) tries to remove it from the WRONG parent — must NOT throw now.
    expect(() => wrongParent.removeChild(child)).not.toThrow();
    expect(wrongParent.removeChild(child)).toBe(child); // returns the node
    // a legitimate removal still works
    expect(() => realParent.removeChild(child)).not.toThrow();
  });

  it('insertBefore with a reference node from a different parent no-ops instead of throwing', () => {
    const parent = new Node();
    const foreign = new Node();
    const other = new Node();
    other.appendChild(foreign); // foreign belongs to `other`, not `parent`
    const newNode = new Node();
    expect(() => parent.insertBefore(newNode, foreign)).not.toThrow();
    expect(parent.insertBefore(newNode, foreign)).toBe(newNode);
  });

  it('legitimate insertBefore (reference IS a child) still inserts normally', () => {
    const parent = new Node();
    const ref = new Node();
    parent.appendChild(ref);
    const newNode = new Node();
    parent.insertBefore(newNode, ref);
    expect(newNode.parentNode).toBe(parent);
  });

  it('is idempotent — a second install on the SAME root returns false and does not double-wrap', () => {
    expect(installDomTranslateGuard(root)).toBe(false);
  });

  it('returns false when Node is unavailable (SSR / no DOM)', () => {
    expect(installDomTranslateGuard({})).toBe(false);
  });
});
