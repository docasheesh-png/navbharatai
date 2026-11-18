/**
 * THE ENGINES IN FRONT OF THE WEAK LADDER, as the admin AI Engines page shows them (owner 2026-11-17).
 *
 * The build chain (`buildTurnRunner` in routes/agentv3.ts) puts Router One, BluesMinds and Moyi in front of the Weak
 * tier ladder, and a Weak build opens a Surplus session before all of them. The admin route may not import the build
 * route (tests/aRouteDoesNotLoadTheBuildEngine.test.ts: it is ~1.9 MB and took 22 s to load), so this small module
 * answers "which leads would run now" from the SAME predicates the chain uses. `tests/weakLeadEnginesMatchTheChain.test.ts`
 * builds the real chain and fails if this list and the chain ever disagree, so the two cannot drift. PURE: reads env.
 */
import { ROUTER_ONE_LABEL, routerOneApiKey, routerOneModels, routerOneWeakFallbackEnabled } from '../AI/RouterOne/routerOne';
import { BLUESMINDS_BUILDER_LABEL, bluesmindsBuilderEnabled, bluesmindsBuilderModels } from './bluesmindsBuilder';
import { MOYI_BUILDER_LABEL, moyiBuilderEnabled, moyiBuilderModels } from './moyiBuilder';
import { surplusBuilderEnabled } from '../AI/SurplusRegistry/buildSession';

export interface LeadEngine { name: string; models: string[] }

/** Surplus first (when a Weak build would open its session), then the rungs the chain puts before the Weak ladder. */
export function weakLeadEngines(env: NodeJS.ProcessEnv = process.env): LeadEngine[] {
  const out: LeadEngine[] = [];
  if (surplusBuilderEnabled(env)) out.push({ name: 'SURPLUS', models: [] });
  if (routerOneWeakFallbackEnabled(env) && routerOneApiKey(env)) out.push({ name: ROUTER_ONE_LABEL, models: routerOneModels(env) });
  if (bluesmindsBuilderEnabled(env)) out.push({ name: BLUESMINDS_BUILDER_LABEL, models: bluesmindsBuilderModels(env) });
  if (moyiBuilderEnabled(env)) out.push({ name: MOYI_BUILDER_LABEL, models: moyiBuilderModels(env) });
  return out;
}
