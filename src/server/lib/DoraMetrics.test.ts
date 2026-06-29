import { describe, it, expect, beforeEach } from 'vitest';
import {
  deploymentFrequencyPerDay, changeFailureRatePct, medianLeadTimeMs, mttrMs,
  classifyTier, computeDora, doraMetrics,
  type DeployRecord, type IncidentRecord,
} from './DoraMetrics';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const dep = (timestamp: number, success = true, leadTimeMs?: number): DeployRecord =>
  ({ id: `d${timestamp}`, timestamp, success, ...(leadTimeMs != null ? { leadTimeMs } : {}) });

describe('DoraMetrics (P-DEPLOY.1)', () => {
  describe('deploymentFrequencyPerDay', () => {
    it('computes deploys per day over the window', () => {
      expect(deploymentFrequencyPerDay([dep(1), dep(2), dep(3), dep(4)], 2 * DAY)).toBe(2);
    });
    it('is 0 for no deploys', () => {
      expect(deploymentFrequencyPerDay([], 30 * DAY)).toBe(0);
    });
  });

  describe('changeFailureRatePct', () => {
    it('is the % of failed deploys', () => {
      expect(changeFailureRatePct([dep(1, true), dep(2, false), dep(3, true), dep(4, false)])).toBe(50);
    });
    it('is 0 with no deploys', () => {
      expect(changeFailureRatePct([])).toBe(0);
    });
  });

  describe('medianLeadTimeMs', () => {
    it('medians the known lead times (ignores unknown)', () => {
      expect(medianLeadTimeMs([dep(1, true, 100), dep(2, true, 300), dep(3, true)])).toBe(200);
    });
    it('averages the two middle values for an even count', () => {
      expect(medianLeadTimeMs([dep(1, true, 100), dep(2, true, 200), dep(3, true, 300), dep(4, true, 500)])).toBe(250);
    });
    it('is null when no lead times are known', () => {
      expect(medianLeadTimeMs([dep(1), dep(2)])).toBeNull();
    });
  });

  describe('mttrMs', () => {
    it('means the durations of RESOLVED incidents', () => {
      const incidents: IncidentRecord[] = [
        { id: 'a', failedAt: 0, resolvedAt: 2 * HOUR },
        { id: 'b', failedAt: 0, resolvedAt: 4 * HOUR },
        { id: 'c', failedAt: 0 }, // unresolved → ignored
      ];
      expect(mttrMs(incidents)).toBe(3 * HOUR);
    });
    it('is null with no resolved incidents', () => {
      expect(mttrMs([{ id: 'a', failedAt: 0 }])).toBeNull();
    });
  });

  describe('classifyTier', () => {
    it('rates frequent deploys + fast recovery + low failure as elite', () => {
      expect(classifyTier({ deploymentFrequencyPerDay: 3, medianLeadTimeMs: HOUR, mttrMs: 30 * 60_000, changeFailureRatePct: 5 })).toBe('elite');
    });
    it('rates rare deploys + slow recovery + high failure as low', () => {
      expect(classifyTier({ deploymentFrequencyPerDay: 0.01, medianLeadTimeMs: 40 * DAY, mttrMs: 10 * DAY, changeFailureRatePct: 50 })).toBe('low');
    });
    it('does not penalise unknown lead time / mttr (null neutral)', () => {
      const t = classifyTier({ deploymentFrequencyPerDay: 3, medianLeadTimeMs: null, mttrMs: null, changeFailureRatePct: 5 });
      expect(t).toBe('elite');
    });
  });

  describe('computeDora — windowing + integration', () => {
    it('only counts events within the window', () => {
      const now = 100 * DAY;
      const deploys = [dep(now - 1 * DAY), dep(now - 5 * DAY), dep(now - 40 * DAY) /* outside 30d */];
      const s = computeDora(deploys, [], now, 30 * DAY);
      expect(s.deploymentCount).toBe(2);
    });
    it('produces an honest summary with nulls when lead/mttr unknown', () => {
      const now = 10 * DAY;
      const s = computeDora([dep(now - DAY, true), dep(now - 2 * DAY, false)], [], now, 30 * DAY);
      expect(s.deploymentCount).toBe(2);
      expect(s.changeFailureRatePct).toBe(50);
      expect(s.medianLeadTimeMs).toBeNull();
      expect(s.mttrMs).toBeNull();
      expect(['elite', 'high', 'medium', 'low']).toContain(s.tier);
    });
  });

  describe('doraMetrics collector', () => {
    beforeEach(() => doraMetrics.reset());

    it('records deploys and computes a summary', () => {
      doraMetrics.recordDeploy({ success: true });
      doraMetrics.recordDeploy({ success: false });
      const s = doraMetrics.summary();
      expect(s.deploymentCount).toBe(2);
      expect(s.changeFailureRatePct).toBe(50);
    });

    it('records + resolves incidents → MTTR is computed', () => {
      const t0 = Date.now();
      const id = doraMetrics.recordIncident(t0);
      doraMetrics.resolveIncident(id, t0 + 2 * HOUR);
      expect(doraMetrics.summary().mttrMs).toBe(2 * HOUR);
    });

    it('resolveIncident is idempotent (keeps the first resolution)', () => {
      const t0 = Date.now();
      const id = doraMetrics.recordIncident(t0);
      doraMetrics.resolveIncident(id, t0 + HOUR);
      doraMetrics.resolveIncident(id, t0 + 5 * HOUR);
      expect(doraMetrics.summary().mttrMs).toBe(HOUR);
    });
  });
});
