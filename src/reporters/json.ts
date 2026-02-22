import type { AnalysisReport } from './terminal.js';

/** Format analysis report as JSON */
export function formatJsonReport(report: AnalysisReport): string {
  return JSON.stringify({
    meta: {
      sessionId: report.sessionId,
      agent: report.agent,
      totalEvents: report.totalEvents,
      generatedAt: new Date().toISOString(),
    },
    distribution: report.classificationDistribution,
    installs: report.installEvents
      .filter(e => !e.abandoned)
      .map(e => ({
        package: e.packageName,
        version: e.packageVersion,
        manager: e.packageManager,
        classification: e.classification,
        confidence: e.confidence,
      })),
    risks: report.riskAssessments.map(a => ({
      package: a.packageName,
      version: a.packageVersion,
      level: a.riskLevel,
      factors: a.factors.map(f => ({
        type: f.type,
        severity: f.severity,
        detail: f.detail,
        alternative: f.suggestedAlternative,
      })),
    })),
    chains: report.chains?.map(c => ({
      id: c.id,
      order: c.chainOrder,
      root: c.rootEvent.packageName,
      final: c.finalSelection.packageName,
      subDecisions: c.subDecisions.map(s => s.packageName),
      searches: c.searchEvents.length,
      abandoned: c.abandonedChoices.map(a => a.packageName),
    })),
    summary: {
      alternativesNeverConsidered: report.alternativesNeverConsidered,
      riskStats: report.riskStats,
      chainStats: report.chainStats,
    },
  }, null, 2);
}
