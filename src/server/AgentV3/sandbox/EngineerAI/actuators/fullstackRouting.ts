// E2B fullstack routing (AB-1 / AB-2) — decide when a build's sandbox must be the polyglot/multi-service
// template (JDK 17 + Maven, Go, MongoDB, Redis) instead of the default builder image.
//
// A build whose framework is a JVM (Spring Boot) or Go backend cannot run on the default sandbox (no
// `java`/`go` runtime). When such a framework is selected AND the account has published + configured the
// fullstack template (FULLSTACK_E2B_TEMPLATE_ID), the sandbox must launch from that image. Pure + fully
// unit-testable — the actuator just consults these functions.

/** Frameworks that require the fullstack sandbox (a backend language runtime the default image lacks). */
const FULLSTACK_FRAMEWORKS = new Set(['spring-boot', 'go']);

/** True when this framework needs the fullstack (JDK/Go) sandbox rather than the default builder. Pure. */
export function needsFullstackTemplate(framework: unknown): boolean {
  return typeof framework === 'string' && FULLSTACK_FRAMEWORKS.has(framework.trim().toLowerCase());
}

/**
 * Resolve the E2B template id for a sandbox, given the (optional) framework and the environment. Pure.
 *
 * Priority:
 *   1. framework needs fullstack AND FULLSTACK_E2B_TEMPLATE_ID is set → the fullstack image.
 *   2. else E2B_TEMPLATE_ID when set → the default custom builder image.
 *   3. else undefined → E2B's default base image (unchanged current behaviour).
 *
 * So it is a SAFE, doubly-gated no-op: nothing changes unless the framework is a polyglot backend AND the
 * admin has published + configured the fullstack template. A non-fullstack build never sees it.
 */
export function resolveTemplateId(
  framework: unknown,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (needsFullstackTemplate(framework)) {
    const full = env.FULLSTACK_E2B_TEMPLATE_ID?.trim();
    if (full) return full;
    // Fullstack framework but no fullstack template configured → fall through to the default template.
    // (The build may fail for lack of a runtime, but that is an infra-config gap, not a routing bug.)
  }
  const t = env.E2B_TEMPLATE_ID?.trim();
  return t ? t : undefined;
}
