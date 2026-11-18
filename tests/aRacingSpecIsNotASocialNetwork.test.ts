// Autopsy 05eb30ba (2026-11-18): the user's real racing spec was classified domain=social (from "Low-profile drag
// tires") and its "Fully Adjustable AWD" was reported as an unknown service. The real prompt is the fixture.
import { describe, expect, it } from 'vitest';
import { analyzeRequirementGaps, missingDomainFeatures } from '../src/server/lib/RequirementGapAnalyzer';
import { unknownNamesInRequest } from '../src/server/AgentV3/unknownName';

const SPEC = `To accommodate speeds over 400 km/h with high-RPM mechanics, design your systems around these specifications.

System Category

Component Details

Powertrain

Multi-Stage Engine Swaps

Induction

Advanced Twin-Turbochargers

Power Adders

Nitrous Oxide Injection

Drivetrain

Fully Adjustable AWD

Aerodynamics

Active Downforce Wings

Gearbox

Multi-Speed Sequential

Tires & Chassis

Compound & Camber Tuning

High-displacement V8 or quad-turbo V12s providing massive low-end torque.

Power distribution bias to prevent wheelspin during launch and maintain high-speed stability.

Low-profile drag tires; negative camber settings for high-speed lateral grip.

Set your target peak RPM between 8,000 and 10,000 to realistically support these velocity

goals.`;

describe('a racing spec is not a social network', () => {
  it('the real prompt is not social', () => {
    expect(analyzeRequirementGaps(SPEC).domain).not.toBe('social');
    expect(missingDomainFeatures(SPEC, 'prompt').domain).not.toBe('social');
  });
  it('with "And create two game" it is a game', () => {
    expect(analyzeRequirementGaps(`${SPEC}   And create two game`).domain).toBe('game');
  });
  it('"displacement" is not a job placement (the second false domain in the same spec)', () => {
    expect(analyzeRequirementGaps('a car tuner app: engine displacement, boost and camber').domain).not.toBe('jobs');
    expect(analyzeRequirementGaps('a campus placement portal for students and recruiters').domain).toBe('jobs');
  });
  it('a real profile keeps its meaning', () => {
    expect(analyzeRequirementGaps('a social app where people follow friends, post photos and edit their profile').domain).toBe('social');
  });
  it('AWD and the other drivetrain words are not unknown services', () => {
    expect(unknownNamesInRequest(SPEC)).toEqual([]);
    expect(unknownNamesInRequest('car with FWD, ABS, ECU tuning and 500 BHP at 9000 RPM')).toEqual([]);
  });
  it('a real unknown all-caps name is still reported', () => {
    expect(unknownNamesInRequest('Ye yese app banao jo data COACT oar sake')).toContain('COACT');
  });
});
