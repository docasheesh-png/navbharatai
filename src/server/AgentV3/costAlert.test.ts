import { describe, it, expect } from 'vitest';
import { costAlertThresholdUsd, costAlertAdvisory } from './costAlert';

describe('costAlertThresholdUsd — env parsing, OFF by default', () => {
  it('is 0 (off) when unset, empty, non-positive, or unparseable', () => {
    expect(costAlertThresholdUsd({})).toBe(0);
    expect(costAlertThresholdUsd({ AGENTV3_COST_ALERT_USD: '' })).toBe(0);
    expect(costAlertThresholdUsd({ AGENTV3_COST_ALERT_USD: '0' })).toBe(0);
    expect(costAlertThresholdUsd({ AGENTV3_COST_ALERT_USD: '-5' })).toBe(0);
    expect(costAlertThresholdUsd({ AGENTV3_COST_ALERT_USD: 'abc' })).toBe(0);
  });

  it('reads a positive threshold', () => {
    expect(costAlertThresholdUsd({ AGENTV3_COST_ALERT_USD: '2.5' })).toBe(2.5);
  });
});

describe('costAlertAdvisory — fires only when enabled AND charge reaches the threshold', () => {
  it('returns null when the alert is disabled (threshold 0), regardless of charge', () => {
    expect(costAlertAdvisory(100, 0)).toBeNull();
  });

  it('returns null when the charge is under the threshold', () => {
    expect(costAlertAdvisory(1.99, 2)).toBeNull();
  });

  it('fires at or above the threshold, naming the amount + the env var', () => {
    const line = costAlertAdvisory(2.0, 2);
    expect(line).toContain('COST ALERT');
    expect(line).toContain('$2.0000');
    expect(line).toContain('$2.00');
    expect(line).toContain('AGENTV3_COST_ALERT_USD');
    expect(costAlertAdvisory(9.5, 2)).toContain('$9.5000');
  });

  it('returns null for a missing / non-finite charge (a build with no billedUsd)', () => {
    expect(costAlertAdvisory(undefined, 2)).toBeNull();
    expect(costAlertAdvisory(NaN, 2)).toBeNull();
  });

  it('does not fire for a FREE build (charge 0) even with a threshold set', () => {
    expect(costAlertAdvisory(0, 2)).toBeNull();
  });
});
