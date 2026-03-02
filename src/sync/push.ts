import { createHash } from "node:crypto";
import type { ClassifiedEvent } from '../classifiers/types.js';
import type { SightglassConfig } from '../utils/config.js';

/** Filter out noisy events that add no analytical value */
function isSignalEvent(event: ClassifiedEvent): boolean {
  // Always keep: installs, searches, web fetches
  if (event.isInstall) return true;
  if (event.isSearch) return true;
  if (event.action === 'web_search' || event.action === 'web_fetch') return true;

  // Keep: bash commands that failed (error signals)
  if (event.action === 'bash' && event.exitCode !== undefined && event.exitCode !== 0) return true;

  // Drop: pure file_read, file_write, and successful non-install bash
  // These are routine operations that create noise without insight
  return false;
}

/** Anonymize an event before sending to the hosted API */
function anonymizeEvent(event: ClassifiedEvent, config: SightglassConfig): Record<string, unknown> {
  const anonymized: Record<string, unknown> = {
    sessionId: event.sessionId
      ? createHash("sha256").update(event.sessionId).digest("hex").slice(0, 12)
      : undefined,
    agent: event.agent,
    action: event.action,
    classification: event.classification,
    confidence: event.confidence,
    packageName: event.packageName,
    packageVersion: event.packageVersion,
    packageManager: event.packageManager,
    isInstall: event.isInstall,
    isSearch: event.isSearch,
    abandoned: event.abandoned,
    timestamp: event.timestamp,
    model: event.model,
    modelVersion: event.modelVersion,
  };

  // Redact paths
  if (config.privacy.redactPaths) {
    // Don't include raw command (may contain file paths)
    // Don't include cwd
  } else {
    anonymized.raw = event.raw;
    anonymized.cwd = event.cwd;
  }

  // Never include results (may contain sensitive output)
  // Include a short hash of session ID for grouping (not the raw ID)

  return anonymized;
}

/** Push anonymized events to the hosted API */
export async function pushEvents(
  events: ClassifiedEvent[],
  config: SightglassConfig,
): Promise<{ success: boolean; count: number; error?: string }> {
  if (!config.privacy.shareAnonymousData) {
    return { success: false, count: 0, error: 'Anonymous data sharing is disabled' };
  }

  const apiUrl = config.privacy.apiUrl ?? 'https://api.sightglass.dev';
  const apiKey = config.privacy.apiKey;

  if (!apiKey) {
    return { success: false, count: 0, error: 'No API key configured. Run: sightglass login' };
  }

  // Filter to signal events only — drop file_read/file_write/routine bash noise
  const signalEvents = events.filter(isSignalEvent);
  if (signalEvents.length === 0) {
    return { success: true, count: 0 };
  }

  const anonymized = signalEvents.map(e => anonymizeEvent(e, config));

  try {
    const response = await fetch(`${apiUrl}/api/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ events: anonymized }),
    });

    if (!response.ok) {
      return {
        success: false,
        count: 0,
        error: `API returned ${response.status}: ${await response.text()}`,
      };
    }

    return { success: true, count: anonymized.length };
  } catch (err) {
    return {
      success: false,
      count: 0,
      error: `Failed to reach API: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
