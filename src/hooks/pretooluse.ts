/**
 * Sightglass PreToolUse hook for Claude Code.
 *
 * Reads hook input from stdin, checks if the command is a package install,
 * calls the Sightglass API for evaluation, and returns a block decision
 * if the package has issues.
 *
 * Exit codes:
 *   0 = allow (pass through)
 *   2 = block (inject evaluation into agent context)
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { INSTALL_PATTERNS, KNOWN_ISSUES } from '../classifiers/types.js';
import type { PackageManager } from '../classifiers/types.js';

// ── Config loading ──

interface SightglassHookConfig {
  apiUrl: string;
  apiKey: string;
}

function loadConfig(): SightglassHookConfig | null {
  const configPath = path.join(os.homedir(), '.sightglass', 'config.json');
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const apiUrl = raw?.privacy?.apiUrl;
    const apiKey = raw?.privacy?.apiKey;
    if (apiUrl && apiKey) {
      return { apiUrl, apiKey };
    }
    return null;
  } catch {
    return null;
  }
}

// ── Install pattern matching ──

interface InstallMatch {
  packageName: string;
  packageManager: PackageManager;
}

function matchInstallCommand(command: string): InstallMatch | null {
  for (const [manager, patterns] of Object.entries(INSTALL_PATTERNS)) {
    for (const pattern of patterns) {
      const match = command.match(pattern);
      if (match?.[1]) {
        // Extract the first package name (before any flags or spaces)
        const raw = match[1].trim();
        // Filter out flags like --save-dev, -D, etc.
        const parts = raw.split(/\s+/).filter(p => !p.startsWith('-'));
        const packageName = parts[0];
        if (packageName) {
          // Strip version specifiers like @^1.0.0
          const cleanName = packageName.replace(/@[\^~]?[\d].*$/, '');
          return {
            packageName: cleanName,
            packageManager: manager as PackageManager,
          };
        }
      }
    }
  }
  return null;
}

// ── Evaluation card formatting ──

interface EvaluationResponse {
  packageName: string;
  verdict: string;
  status: string;
  cves: string[];
  size: string;
  alternative: { name: string; reason: string } | null;
  summary: string;
}

function formatEvaluationCard(evaluation: EvaluationResponse): string {
  const lines: string[] = [];

  const verdictIcon = evaluation.verdict === 'PROCEED' ? '[OK]'
    : evaluation.verdict === 'CAUTION' ? '[CAUTION]'
    : '[SWITCH]';

  lines.push(`--- Sightglass Package Evaluation ---`);
  lines.push(`Package: ${evaluation.packageName}`);
  lines.push(`Verdict: ${verdictIcon} ${evaluation.verdict}`);
  lines.push(`Status: ${evaluation.status}`);

  if (evaluation.cves.length > 0) {
    lines.push(`CVEs: ${evaluation.cves.join(', ')}`);
  }

  if (evaluation.size && evaluation.size !== 'unknown') {
    lines.push(`Size: ${evaluation.size}`);
  }

  if (evaluation.alternative) {
    lines.push(`Alternative: ${evaluation.alternative.name} — ${evaluation.alternative.reason}`);
  }

  lines.push(`Summary: ${evaluation.summary}`);
  lines.push(`---`);

  return lines.join('\n');
}

// ── Known issues fallback ──

function getKnownIssueEvaluation(packageName: string): EvaluationResponse | null {
  const issue = KNOWN_ISSUES[packageName.toLowerCase()];
  if (!issue) return null;

  const verdictMap: Record<string, string> = {
    vulnerability: 'SWITCH',
    deprecated: 'SWITCH',
    bloat: 'CAUTION',
    unmaintained: 'CAUTION',
  };

  return {
    packageName,
    verdict: verdictMap[issue.type] ?? 'CAUTION',
    status: issue.type.toUpperCase(),
    cves: issue.source?.includes('CVE') ? [issue.source.split('/').pop()!] : [],
    size: 'unknown',
    alternative: issue.suggestedAlternative
      ? { name: issue.suggestedAlternative, reason: issue.detail }
      : null,
    summary: issue.detail,
  };
}

// ── Main ──

async function main(): Promise<void> {
  // Read JSON from stdin
  let input: string;
  try {
    input = fs.readFileSync(0, 'utf-8');
  } catch {
    process.exit(0);
  }

  let hookData: { tool_name?: string; tool_input?: { command?: string } };
  try {
    hookData = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  // Only intercept Bash tool calls
  if (hookData.tool_name !== 'Bash') {
    process.exit(0);
  }

  const command = hookData.tool_input?.command;
  if (!command) {
    process.exit(0);
  }

  // Check if command matches an install pattern
  const installMatch = matchInstallCommand(command);
  if (!installMatch) {
    process.exit(0);
  }

  const { packageName, packageManager } = installMatch;

  // Try API evaluation
  const config = loadConfig();
  if (config) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12_000);

      const response = await fetch(`${config.apiUrl}/api/evaluate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({ packageName, packageManager, command }),
      });

      clearTimeout(timeout);

      if (response.ok) {
        const evaluation = await response.json() as EvaluationResponse;

        // PROCEED = allow through, only block on CAUTION/SWITCH
        if (evaluation.verdict === 'PROCEED') {
          process.exit(0);
        }

        const card = formatEvaluationCard(evaluation);

        // Output the hook response — block with evaluation context
        const hookResponse = JSON.stringify({
          decision: 'block',
          reason: card,
        });
        process.stdout.write(hookResponse);
        process.exit(2);
      }
    } catch {
      // API unreachable — fall through to local check
    }
  }

  // Fallback: check local known issues
  const knownEval = getKnownIssueEvaluation(packageName);
  if (knownEval) {
    const card = formatEvaluationCard(knownEval);
    const hookResponse = JSON.stringify({
      decision: 'block',
      reason: card,
    });
    process.stdout.write(hookResponse);
    process.exit(2);
  }

  // No issues found — allow
  process.exit(0);
}

main().catch(() => {
  // On any unhandled error, fail open
  process.exit(0);
});
