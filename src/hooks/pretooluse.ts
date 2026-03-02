/**
 * Sightglass PreToolUse hook for Claude Code.
 *
 * Reads hook input from stdin, checks if the command is a package install,
 * calls the Sightglass API for evaluation, and returns a block decision
 * if the package has issues.
 *
 * The API does all the heavy lifting (grounded LLM eval with web search).
 * This hook is just a thin client: detect install → call API → relay verdict.
 *
 * Exit codes:
 *   0 = allow (pass through)
 *   2 = block (inject evaluation into agent context)
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { INSTALL_PATTERNS } from '../classifiers/types.js';
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

// ── Session-scoped bypass (second attempt = allow) ──

function getSessionId(hookData: Record<string, unknown>): string {
  const raw = (hookData.session_id as string) || 'unknown';
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 12);
}

function getAllowedPath(sessionId: string): string {
  return path.join(os.tmpdir(), `sightglass-allowed-${sessionId}.json`);
}

function isAlreadyAllowed(sessionId: string, packageName: string): boolean {
  try {
    const data = JSON.parse(fs.readFileSync(getAllowedPath(sessionId), 'utf-8'));
    return Array.isArray(data) && data.includes(packageName.toLowerCase());
  } catch {
    return false;
  }
}

function markAllowed(sessionId: string, packageName: string): void {
  const filePath = getAllowedPath(sessionId);
  let existing: string[] = [];
  try {
    existing = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (!Array.isArray(existing)) existing = [];
  } catch { /* */ }
  existing.push(packageName.toLowerCase());
  fs.writeFileSync(filePath, JSON.stringify(existing));
}

// ── Decision logging ──

function logDecision(entry: Record<string, unknown>): void {
  try {
    const logPath = path.join(os.homedir(), '.sightglass', 'decisions.jsonl');
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + '\n');
  } catch { /* non-fatal */ }
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
        const raw = match[1].trim();
        const parts = raw.split(/\s+/).filter(p => !p.startsWith('-'));
        const packageName = parts[0];
        if (packageName) {
          const cleanName = packageName.replace(/@[\^~]?[\d].*$/, '');
          return { packageName: cleanName, packageManager: manager as PackageManager };
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
  source?: string;
}

function formatEvaluationCard(evaluation: EvaluationResponse): string {
  const lines: string[] = [];

  const verdictIcon = evaluation.verdict === 'PROCEED' ? '[OK]'
    : evaluation.verdict === 'CAUTION' ? '[CAUTION]'
    : '[SWITCH]';

  lines.push('--- Sightglass Package Evaluation ---');
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
  lines.push('');
  lines.push('If you still want this package, re-run the install and Sightglass will allow it.');
  lines.push('---');

  return lines.join('\n');
}

// ── Main ──

async function main(): Promise<void> {
  let input: string;
  try {
    input = fs.readFileSync(0, 'utf-8');
  } catch {
    process.exit(0);
  }

  let hookData: Record<string, unknown>;
  try {
    hookData = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  // Only intercept Bash tool calls
  if (hookData.tool_name !== 'Bash') {
    process.exit(0);
  }

  const toolInput = hookData.tool_input as { command?: string } | undefined;
  const command = toolInput?.command;
  if (!command) {
    process.exit(0);
  }

  const installMatch = matchInstallCommand(command);
  if (!installMatch) {
    process.exit(0);
  }

  const { packageName, packageManager } = installMatch;
  const sessionId = getSessionId(hookData);

  // Second attempt bypass — if we already flagged this package, let it through
  if (isAlreadyAllowed(sessionId, packageName)) {
    logDecision({ session_id: sessionId, package: packageName, action: 'allowed_retry', package_manager: packageManager });
    process.exit(0);
  }

  // Call the Sightglass API (server does the LLM evaluation)
  const config = loadConfig();
  if (config) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);

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

        if (evaluation.verdict === 'PROCEED') {
          logDecision({ session_id: sessionId, package: packageName, action: 'allowed', verdict: 'PROCEED', source: evaluation.source, package_manager: packageManager });
          process.exit(0);
        }

        // Block — mark as allowed for next attempt
        markAllowed(sessionId, packageName);

        logDecision({
          session_id: sessionId,
          package: packageName,
          action: 'blocked',
          verdict: evaluation.verdict,
          status: evaluation.status,
          alternative: evaluation.alternative?.name || null,
          source: evaluation.source,
          package_manager: packageManager,
        });

        const card = formatEvaluationCard(evaluation);
        process.stdout.write(JSON.stringify({ decision: 'block', reason: card }));
        process.exit(2);
      }
    } catch {
      // API unreachable — fail open
    }
  }

  // No API config or API unreachable — fail open, allow the install
  logDecision({ session_id: sessionId, package: packageName, action: 'allowed_no_api', package_manager: packageManager });
  process.exit(0);
}

main().catch(() => {
  process.exit(0);
});
