import type { ClassifiedEvent } from '../classifiers/types.js';
import type { SightglassConfig } from '../utils/config.js';

/** Anonymize an event before sending to the hosted API */
function anonymizeEvent(event: ClassifiedEvent, config: SightglassConfig): Record<string, unknown> {
  const anonymized: Record<string, unknown> = {
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
  // Never include session IDs (could be used for tracking)

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

  const anonymized = events.map(e => anonymizeEvent(e, config));

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
