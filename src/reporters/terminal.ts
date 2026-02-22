import chalk from 'chalk';
import { table } from 'table';
import type { ClassifiedEvent, DiscoveryType, RiskAssessment } from '../classifiers/types.js';
import type { DecisionChain } from '../classifiers/types.js';
import type { ChainStats } from '../analyzers/chain-builder.js';
import type { RiskStats } from '../analyzers/risk-scorer.js';

export interface AnalysisReport {
  sessionId?: string;
  agent?: string;
  duration?: string;
  totalEvents: number;
  installEvents: ClassifiedEvent[];
  classificationDistribution: Record<DiscoveryType, number>;
  riskAssessments: RiskAssessment[];
  riskStats: RiskStats;
  chains?: DecisionChain[];
  chainStats?: ChainStats;
  alternativesNeverConsidered: number;
}

/** Format a full analysis report for terminal output */
export function formatTerminalReport(report: AnalysisReport): string {
  const lines: string[] = [];

  // Header
  lines.push('');
  lines.push(chalk.bold.white('  Sightglass Analysis'));
  if (report.sessionId) {
    lines.push(chalk.dim(`  Session: ${report.sessionId}`));
  }
  if (report.agent) {
    lines.push(chalk.dim(`  Agent: ${report.agent} | Events: ${report.totalEvents}`));
  }
  lines.push('');
  lines.push(chalk.dim('  ' + '\u2500'.repeat(50)));
  lines.push('');

  // Discovery distribution
  lines.push(chalk.bold.white('  Discovery Distribution'));
  lines.push('');

  const total = Object.values(report.classificationDistribution).reduce((a, b) => a + b, 0);
  const typeColors: Record<string, typeof chalk> = {
    TRAINING_RECALL: chalk.hex('#7c7cf0'),
    CONTEXT_INHERITANCE: chalk.hex('#c9893a'),
    REACTIVE_SEARCH: chalk.hex('#c94a4a'),
    PROACTIVE_SEARCH: chalk.hex('#3b8a6e'),
    USER_DIRECTED: chalk.hex('#3b8a6e'),
    UNKNOWN: chalk.dim,
  };

  const typeLabels: Record<string, string> = {
    TRAINING_RECALL: 'Training Recall',
    CONTEXT_INHERITANCE: 'Context Inherit',
    REACTIVE_SEARCH: 'Reactive Search',
    PROACTIVE_SEARCH: 'Proactive Search',
    USER_DIRECTED: 'User Directed',
    UNKNOWN: 'Unknown',
  };

  for (const [type, count] of Object.entries(report.classificationDistribution)) {
    if (count === 0) continue;
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    const barLen = Math.round(pct / 4);
    const bar = '\u2588'.repeat(barLen) + '\u2591'.repeat(25 - barLen);
    const colorFn = typeColors[type] ?? chalk.dim;
    lines.push(`  ${colorFn(bar)} ${typeLabels[type] ?? type}  ${pct}% (${count})`);
  }
  lines.push('');

  // Install summary
  const installCount = report.installEvents.filter(e => !e.abandoned).length;
  lines.push(chalk.bold.white(`  Packages Installed: ${installCount}`));
  lines.push('');

  // Risk flags
  if (report.riskAssessments.length > 0) {
    for (const assessment of report.riskAssessments) {
      for (const factor of assessment.factors) {
        const icon = riskIcon(factor.severity);
        const colorFn = riskColor(factor.severity);
        lines.push(`  ${icon} ${chalk.bold(assessment.packageName)}${assessment.packageVersion !== 'unknown' ? `@${assessment.packageVersion}` : ''} ${chalk.dim('\u2014')} ${colorFn(factor.detail)}`);
        if (factor.suggestedAlternative) {
          lines.push(chalk.hex('#3b8a6e')(`    \u2192 Consider: ${factor.suggestedAlternative}`));
        }
      }
    }
    lines.push('');
  }

  // No-deliberation stat
  if (report.alternativesNeverConsidered > 0) {
    lines.push(chalk.dim(`  Alternatives Never Considered: ${report.alternativesNeverConsidered}/${installCount} packages`));
    lines.push(chalk.dim('  installed with zero deliberation'));
    lines.push('');
  }

  // Chain stats
  if (report.chainStats) {
    lines.push(chalk.bold.white('  Decision Chains'));
    lines.push(chalk.dim(`  Total chains: ${report.chainStats.totalChains}`));
    lines.push(chalk.dim(`  With search: ${report.chainStats.chainsWithSearch}`));
    lines.push(chalk.dim(`  With abandoned attempts: ${report.chainStats.chainsWithAbandoned}`));
    lines.push(chalk.dim(`  No-deliberation rate: ${report.chainStats.noDeliberationRate}%`));
    lines.push('');
  }

  // Risk summary
  if (report.riskStats.total > 0) {
    lines.push(chalk.bold.white('  Risk Summary'));
    if (report.riskStats.critical > 0) lines.push(chalk.red(`  \u2b24 Critical: ${report.riskStats.critical}`));
    if (report.riskStats.high > 0) lines.push(chalk.red(`  \u2b24 High: ${report.riskStats.high}`));
    if (report.riskStats.medium > 0) lines.push(chalk.yellow(`  \u2b24 Medium: ${report.riskStats.medium}`));
    if (report.riskStats.low > 0) lines.push(chalk.green(`  \u2b24 Low: ${report.riskStats.low}`));
    lines.push('');
  }

  lines.push(chalk.dim('  ' + '\u2500'.repeat(50)));
  lines.push('');

  return lines.join('\n');
}

/** Format decision chains for terminal output */
export function formatChains(chains: DecisionChain[]): string {
  const lines: string[] = [];

  for (const chain of chains) {
    lines.push('');
    lines.push(chalk.bold(`  Chain #${chain.chainOrder}`));

    if (chain.abandonedChoices.length > 0) {
      for (const abandoned of chain.abandonedChoices) {
        lines.push(chalk.red(`    \u2717 ${abandoned.raw} (abandoned)`));
      }
    }

    if (chain.searchEvents.length > 0) {
      for (const search of chain.searchEvents) {
        lines.push(chalk.hex('#c9893a')(`    \u2315 ${search.raw}`));
      }
    }

    const pkgName = chain.finalSelection.packageName ?? 'unknown';
    const classification = chain.finalSelection.classification;
    lines.push(chalk.green(`    \u2713 ${pkgName} [${classification}]`));

    for (const sub of chain.subDecisions) {
      lines.push(chalk.dim(`      \u2514 ${sub.packageName ?? sub.raw}`));
    }
  }

  return lines.join('\n');
}

function riskIcon(severity: string): string {
  switch (severity) {
    case 'critical': return chalk.red('\u2b24');
    case 'error': return chalk.red('\u26a0');
    case 'warning': return chalk.yellow('\u26a0');
    default: return chalk.blue('\u2139');
  }
}

function riskColor(severity: string): typeof chalk {
  switch (severity) {
    case 'critical': return chalk.red;
    case 'error': return chalk.red;
    case 'warning': return chalk.yellow;
    default: return chalk.dim;
  }
}
