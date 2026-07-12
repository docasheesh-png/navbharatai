// Guard against the well-known React ↔ browser-translation crash.
//
// THE BUG (admin screenshot 2026-07-12): "Failed to execute 'insertBefore' on 'Node': The node before which
// the new node is to be inserted is not a child of this node." Google Translate (and other DOM-mutating
// browser features/extensions) REPLACE text nodes with their own <font> wrappers and MOVE nodes around. React
// still holds references to the original nodes, so its next reconciliation calls removeChild / insertBefore on
// a node the browser already detached → the DOM API throws → the whole app ErrorBoundary-crashes ("कुछ गलत हो
// गया"). This is especially common on the India-facing app because users tap Chrome's "Translate to Hindi".
//
// THE FIX: make those two DOM ops RESILIENT — if the target isn't actually where React thinks it is, no-op
// gracefully instead of throwing. React survives and re-reconciles on the next render. This KEEPS translation
// working (users can still read the app in Hindi) instead of disabling it. It is the widely-used, safe
// mitigation for this exact class; the true root (the browser rewriting our DOM) is outside our code (rule 6),
// and this is the accepted resilience pattern, not a symptom silencer.
//
// Idempotent + dependency-injected (pass a fake root in tests) so it is unit-testable without patching the
// real global prototype.

interface GuardRoot {
  Node?: { prototype?: any } & Function;
}

const GUARD_FLAG = '__nbaiTranslateGuard';

/**
 * Patch `Node.prototype.removeChild` / `insertBefore` on the given root (defaults to `window`) so a DOM node
 * moved/removed by translation can't crash React. Returns true if it installed, false if unavailable or
 * already installed (idempotent). Never throws.
 */
export function installDomTranslateGuard(root?: GuardRoot): boolean {
  const r: GuardRoot = root ?? (typeof window !== 'undefined' ? (window as unknown as GuardRoot) : {});
  const N = r.Node as any;
  if (typeof N !== 'function' || !N.prototype) return false;
  if (N.prototype[GUARD_FLAG]) return false; // already guarded — idempotent

  const originalRemoveChild = N.prototype.removeChild;
  N.prototype.removeChild = function (child: any) {
    // The browser already detached/moved this node → React's removeChild would throw. No-op, return the node.
    if (child && child.parentNode !== this) return child;
    return originalRemoveChild.apply(this, arguments as any);
  };

  const originalInsertBefore = N.prototype.insertBefore;
  N.prototype.insertBefore = function (newNode: any, referenceNode: any) {
    // The reference node was moved out from under React → inserting before it would throw. No-op, return node.
    if (referenceNode && referenceNode.parentNode !== this) return newNode;
    return originalInsertBefore.apply(this, arguments as any);
  };

  Object.defineProperty(N.prototype, GUARD_FLAG, { value: true, enumerable: false, configurable: true });
  return true;
}
