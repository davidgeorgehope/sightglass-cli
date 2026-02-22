import type { ClassifiedEvent, RiskAssessment, RiskFactor, RiskLevel } from '../classifiers/types.js';
import { KNOWN_ISSUES } from '../classifiers/types.js';

/**
 * Score risks for classified install events.
 * Uses the known issues map for immediate flags.
 * CVE/OSV lookups are Phase 2.
 */
export function scoreRisks(events: ClassifiedEvent[]): RiskAssessment[] {
  const assessments: RiskAssessment[] = [];
  const installEvents = events.filter(e => e.isInstall && !e.abandoned);

  for (const event of installEvents) {
    if (!event.packageName) continue;

    const factors: RiskFactor[] = [];

    // Check known issues
    const knownIssue = KNOWN_ISSUES[event.packageName];
    if (knownIssue) {
      factors.push(knownIssue);
    }

    // Flag training recall with no deliberation
    if (event.classification === 'TRAINING_RECALL' && event.confidence >= 80) {
      factors.push({
        type: 'training_bias',
        severity: 'info',
        detail: `Installed via training recall (${event.confidence}% confidence) with no alternatives considered.`,
      });
    }

    if (factors.length > 0) {
      assessments.push({
        packageName: event.packageName,
        packageVersion: event.packageVersion ?? 'unknown',
        riskLevel: calculateRiskLevel(factors),
        factors,
      });
    }
  }

  return assessments;
}

/** Calculate overall risk level from individual factors */
function calculateRiskLevel(factors: RiskFactor[]): RiskLevel {
  const severityOrder: Record<string, number> = {
    info: 0,
    warning: 1,
    error: 2,
    critical: 3,
  };

  const maxSeverity = Math.max(
    ...factors.map(f => severityOrder[f.severity] ?? 0),
  );

  if (maxSeverity >= 3) return 'critical';
  if (maxSeverity >= 2) return 'high';
  if (maxSeverity >= 1) return 'medium';
  return 'low';
}

/** Get aggregate risk stats */
export function getRiskStats(assessments: RiskAssessment[]): RiskStats {
  return {
    total: assessments.length,
    critical: assessments.filter(a => a.riskLevel === 'critical').length,
    high: assessments.filter(a => a.riskLevel === 'high').length,
    medium: assessments.filter(a => a.riskLevel === 'medium').length,
    low: assessments.filter(a => a.riskLevel === 'low').length,
    vulnerabilities: assessments.filter(a =>
      a.factors.some(f => f.type === 'vulnerability'),
    ).length,
    deprecated: assessments.filter(a =>
      a.factors.some(f => f.type === 'deprecated'),
    ).length,
    bloat: assessments.filter(a =>
      a.factors.some(f => f.type === 'bloat'),
    ).length,
  };
}

export interface RiskStats {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  vulnerabilities: number;
  deprecated: number;
  bloat: number;
}
