import type { RawEvent } from '../collectors/types.js';
import type { ClassifiedEvent, DiscoveryType, PackageManager } from './types.js';
import {
  INSTALL_PATTERNS,
  SEARCH_PATTERNS,
  HIGH_TRAINING_WEIGHT_PACKAGES,
  AGENT_CONFIG_FILES,
} from './types.js';

// ── Package parsing ──

interface ParsedPackage {
  name: string;
  version?: string;
  manager: PackageManager;
}

/** Extract package info from an install command */
export function parseInstallCommand(command: string): ParsedPackage[] {
  const results: ParsedPackage[] = [];

  for (const [manager, patterns] of Object.entries(INSTALL_PATTERNS) as [PackageManager, RegExp[]][]) {
    for (const pattern of patterns) {
      const match = command.match(pattern);
      if (match?.[1]) {
        const pkgStr = match[1].trim();
        const packages = splitPackageArgs(pkgStr, manager);
        results.push(...packages);
      }
    }
  }

  return results;
}

/** Split a package argument string into individual packages, filtering flags */
function splitPackageArgs(args: string, manager: PackageManager): ParsedPackage[] {
  const parts = args.split(/\s+/).filter(p => !p.startsWith('-'));
  return parts.map(part => {
    const { name, version } = parsePackageSpec(part, manager);
    return { name, version, manager };
  }).filter(p => p.name.length > 0);
}

/** Parse a package specifier like "express@4.21.0" */
function parsePackageSpec(spec: string, manager: PackageManager): { name: string; version?: string } {
  if (manager === 'npm') {
    // Handle scoped packages: @scope/pkg@version
    const scopedMatch = spec.match(/^(@[^@]+)@(.+)$/);
    if (scopedMatch) return { name: scopedMatch[1], version: scopedMatch[2] };

    // Handle regular: pkg@version
    const match = spec.match(/^([^@]+)@(.+)$/);
    if (match) return { name: match[1], version: match[2] };

    return { name: spec };
  }

  if (manager === 'pip') {
    const match = spec.match(/^([^=<>!]+)(?:[=<>!]+(.+))?$/);
    if (match) return { name: match[1], version: match[2] };
  }

  return { name: spec };
}

// ── Event classification helpers ──

function isInstallEvent(event: RawEvent): boolean {
  if (event.action !== 'bash') return false;
  return parseInstallCommand(event.raw).length > 0;
}

function isSearchEvent(event: RawEvent): boolean {
  return event.action === 'web_search' || event.action === 'web_fetch';
}

function isFileReadEvent(event: RawEvent): boolean {
  return event.action === 'file_read';
}

function isConfigFileRead(event: RawEvent): boolean {
  if (!isFileReadEvent(event)) return false;
  return AGENT_CONFIG_FILES.some(f => event.raw.endsWith(f));
}

function isPackageFileRead(event: RawEvent): boolean {
  if (!isFileReadEvent(event)) return false;
  const packageFiles = [
    'package.json', 'requirements.txt', 'Pipfile', 'pyproject.toml',
    'Cargo.toml', 'go.mod', 'Gemfile',
  ];
  return packageFiles.some(f => event.raw.endsWith(f));
}

function isFailedBash(event: RawEvent): boolean {
  return event.action === 'bash' && event.exitCode !== undefined && event.exitCode !== 0;
}

function isHighTrainingWeight(packageName: string, manager: PackageManager): boolean {
  const list = HIGH_TRAINING_WEIGHT_PACKAGES[manager] ?? [];
  return list.includes(packageName);
}

function isProactiveSearchQuery(query: string): boolean {
  return SEARCH_PATTERNS.some(p => p.test(query));
}

/** Check if a package name appears in content (e.g., config file content) */
function packageMentionedIn(packageName: string, content: string): boolean {
  return content.toLowerCase().includes(packageName.toLowerCase());
}

// ── Main classifier ──

/**
 * Classify a list of raw events into classified events.
 * Uses a sliding window approach: for each install event, looks at
 * preceding events to determine the discovery type.
 */
export function classifyEvents(events: RawEvent[]): ClassifiedEvent[] {
  const classified: ClassifiedEvent[] = [];
  const configFileContents: string[] = [];
  const packageFileContents: string[] = [];
  const recentFailures: RawEvent[] = [];
  const recentSearches: RawEvent[] = [];
  let lastFailure: RawEvent | null = null;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];

    // Track config file reads
    if (isConfigFileRead(event) && event.result) {
      configFileContents.push(event.result);
    }

    // Track package file reads
    if (isPackageFileRead(event) && event.result) {
      packageFileContents.push(event.result);
    }

    // Track failures
    if (isFailedBash(event)) {
      lastFailure = event;
      recentFailures.push(event);
    }

    // Track searches
    if (isSearchEvent(event)) {
      recentSearches.push(event);
    }

    // Classify install events
    if (isInstallEvent(event)) {
      const packages = parseInstallCommand(event.raw);
      const primaryPkg = packages[0];

      if (!primaryPkg) {
        classified.push(createClassifiedEvent(event, 'UNKNOWN', 30, packages));
        continue;
      }

      const classification = classifySingleInstall(
        event, primaryPkg, i, events,
        configFileContents, packageFileContents,
        lastFailure, recentSearches,
      );

      classified.push(createClassifiedEvent(
        event, classification.type, classification.confidence, packages,
        classification.abandoned, classification.alternatives,
      ));

      // Reset failure tracking after an install
      if (classification.type !== 'REACTIVE_SEARCH') {
        // Don't reset if this install was reactive — the failure context may still matter
      }
      continue;
    }

    // Classify search events
    if (isSearchEvent(event)) {
      const searchClassification = classifySearchEvent(event, lastFailure);
      classified.push({
        ...event,
        classification: searchClassification.type,
        confidence: searchClassification.confidence,
        isInstall: false,
        isSearch: true,
        abandoned: false,
        alternatives: extractAlternativesFromSearch(event),
      });
      continue;
    }

    // Classify file reads
    if (isFileReadEvent(event)) {
      classified.push({
        ...event,
        classification: isConfigFileRead(event) ? 'USER_DIRECTED' : 'UNKNOWN',
        confidence: isConfigFileRead(event) ? 60 : 20,
        isInstall: false,
        isSearch: false,
        abandoned: false,
        alternatives: [],
      });
      continue;
    }

    // Non-install bash commands (including failures)
    classified.push({
      ...event,
      classification: 'UNKNOWN',
      confidence: 10,
      isInstall: false,
      isSearch: false,
      abandoned: isFailedBash(event),
      alternatives: [],
    });
  }

  // Mark abandoned installs (install that failed followed by a different install)
  markAbandonedInstalls(classified);

  return classified;
}

function classifySingleInstall(
  event: RawEvent,
  pkg: ParsedPackage,
  eventIndex: number,
  allEvents: RawEvent[],
  configContents: string[],
  packageContents: string[],
  lastFailure: RawEvent | null,
  recentSearches: RawEvent[],
): { type: DiscoveryType; confidence: number; abandoned: boolean; alternatives: string[] } {
  // Look at the window of events before this install
  const windowSize = 10;
  const window = allEvents.slice(Math.max(0, eventIndex - windowSize), eventIndex);

  const hasRecentSearch = window.some(e => isSearchEvent(e));
  const hasRecentFailure = window.some(e => isFailedBash(e));
  const hasRecentPackageRead = window.some(e => isPackageFileRead(e));
  const hasRecentConfigRead = window.some(e => isConfigFileRead(e));
  const searchInWindow = window.filter(e => isSearchEvent(e));
  const alternatives = searchInWindow.flatMap(e => extractAlternativesFromSearch(e));

  // 1. USER_DIRECTED: package mentioned in config files
  if (configContents.some(c => packageMentionedIn(pkg.name, c))) {
    return { type: 'USER_DIRECTED', confidence: 90, abandoned: false, alternatives };
  }

  // 2. CONTEXT_INHERITANCE: package already in project files
  if (hasRecentPackageRead && packageContents.some(c => packageMentionedIn(pkg.name, c))) {
    return { type: 'CONTEXT_INHERITANCE', confidence: 85, abandoned: false, alternatives };
  }

  // 3. REACTIVE_SEARCH: failure followed by search followed by install
  if (hasRecentFailure && hasRecentSearch) {
    return { type: 'REACTIVE_SEARCH', confidence: 80, abandoned: false, alternatives };
  }

  // 4. PROACTIVE_SEARCH: deliberate search without preceding failure
  if (hasRecentSearch && !hasRecentFailure) {
    const proactive = searchInWindow.some(e => isProactiveSearchQuery(e.raw));
    if (proactive) {
      return { type: 'PROACTIVE_SEARCH', confidence: 75, abandoned: false, alternatives };
    }
    // Search happened but wasn't proactive — still better than pure recall
    return { type: 'REACTIVE_SEARCH', confidence: 65, abandoned: false, alternatives };
  }

  // 5. TRAINING_RECALL: high confidence if known high-weight package
  if (isHighTrainingWeight(pkg.name, pkg.manager)) {
    return { type: 'TRAINING_RECALL', confidence: 90, abandoned: false, alternatives: [] };
  }

  // 6. TRAINING_RECALL: default for no-search, no-context installs
  return { type: 'TRAINING_RECALL', confidence: 70, abandoned: false, alternatives: [] };
}

function classifySearchEvent(
  event: RawEvent,
  lastFailure: RawEvent | null,
): { type: DiscoveryType; confidence: number } {
  if (lastFailure) {
    // Search after a failure
    const timeDiff = new Date(event.timestamp).getTime() - new Date(lastFailure.timestamp).getTime();
    if (timeDiff < 60_000) { // Within 1 minute of failure
      return { type: 'REACTIVE_SEARCH', confidence: 80 };
    }
  }

  if (isProactiveSearchQuery(event.raw)) {
    return { type: 'PROACTIVE_SEARCH', confidence: 75 };
  }

  return { type: 'UNKNOWN', confidence: 40 };
}

function extractAlternativesFromSearch(event: RawEvent): string[] {
  if (!event.result) return [];

  // Try to extract package names from search results
  // Look for common package name patterns in the result text
  const npmPackagePattern = /\b([a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)?)\b/g;
  const matches = event.result.match(npmPackagePattern) ?? [];

  // Filter to plausible package names (3+ chars, not common words)
  const stopWords = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'from', 'results', 'stars', 'last', 'commit']);
  return [...new Set(matches.filter(m => m.length >= 3 && !stopWords.has(m)))].slice(0, 10);
}

/** Mark installs that failed and were replaced by a different install */
function markAbandonedInstalls(events: ClassifiedEvent[]): void {
  const installEvents = events.filter(e => e.isInstall);

  for (let i = 0; i < installEvents.length - 1; i++) {
    const current = installEvents[i];
    if (current.abandoned) continue; // Already marked

    // If this install failed (exitCode !== 0), mark as abandoned
    if (current.exitCode !== undefined && current.exitCode !== 0) {
      current.abandoned = true;
    }
  }
}

function createClassifiedEvent(
  event: RawEvent,
  classification: DiscoveryType,
  confidence: number,
  packages: ParsedPackage[],
  abandoned = false,
  alternatives: string[] = [],
): ClassifiedEvent {
  const primaryPkg = packages[0];
  return {
    ...event,
    classification,
    confidence,
    packageName: primaryPkg?.name,
    packageVersion: primaryPkg?.version,
    packageManager: primaryPkg?.manager,
    isInstall: true,
    isSearch: false,
    abandoned,
    alternatives,
  };
}
