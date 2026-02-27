import type { RawEvent } from '../collectors/types.js';
import { categorizePackage, TOOL_CATEGORIES } from './categories.js';

/** A detected custom implementation (build instead of buy) */
export interface CustomBuildEvent {
  /** The original file_write event that triggered detection */
  event: RawEvent;
  /** Which category this custom implementation maps to */
  category: string;
  /** The keywords that matched */
  matchedKeywords: string[];
  /** Confidence 0-100 */
  confidence: number;
}

// ── Domain keyword patterns ──
// Maps domain keywords found in file contents or paths to categories

const DOMAIN_KEYWORDS: Record<string, string[]> = {
  'Authentication': ['jwt', 'jsonwebtoken', 'bcrypt', 'hash-password', 'hashPassword', 'verifyToken', 'signToken', 'auth-middleware', 'authMiddleware', 'login', 'session-token'],
  'Caching': ['cache', 'ttl', 'lru', 'memoize', 'invalidate-cache', 'cacheKey', 'cache-control', 'redis-client'],
  'Validation': ['validate', 'schema', 'sanitize', 'parse-input', 'validateInput', 'validateBody', 'field-validation'],
  'Feature Flags': ['feature-flag', 'featureFlag', 'isEnabled', 'toggle', 'feature-toggle', 'flagEnabled'],
  'Job Queue': ['job-queue', 'jobQueue', 'enqueue', 'dequeue', 'worker', 'processJob', 'schedule-job'],
  'Real-time': ['websocket', 'ws-server', 'socket', 'onMessage', 'broadcast', 'pubsub', 'subscribe'],
  'Email': ['send-email', 'sendEmail', 'smtp', 'mailer', 'email-template', 'transporter'],
  'File Upload': ['upload', 'multipart', 'file-upload', 'handleUpload', 'parseFile'],
  'HTTP Client': ['http-client', 'httpClient', 'fetchWrapper', 'apiClient', 'request-wrapper'],
  'Observability': ['logger', 'log-level', 'logLevel', 'structured-log', 'tracing', 'metrics', 'instrumenting'],
};

// ── File path patterns ──
// Files that strongly suggest custom implementations

const DOMAIN_FILE_PATTERNS: Record<string, RegExp[]> = {
  'Authentication': [/auth\.ts$/, /auth\.js$/, /middleware\/auth/, /lib\/auth/, /utils\/auth/, /helpers\/auth/],
  'Caching': [/cache\.ts$/, /cache\.js$/, /lib\/cache/, /utils\/cache/],
  'Validation': [/validator\.ts$/, /validator\.js$/, /validation\.ts$/, /validation\.js$/, /lib\/validate/],
  'Feature Flags': [/feature-flag/, /featureFlag/, /flags\.ts$/, /flags\.js$/],
  'Job Queue': [/queue\.ts$/, /queue\.js$/, /worker\.ts$/, /worker\.js$/, /lib\/queue/],
  'Real-time': [/websocket/, /socket\.ts$/, /socket\.js$/, /ws-server/],
  'Email': [/mailer\.ts$/, /mailer\.js$/, /email\.ts$/, /email\.js$/, /lib\/mail/],
  'File Upload': [/upload\.ts$/, /upload\.js$/, /lib\/upload/, /middleware\/upload/],
  'Observability': [/logger\.ts$/, /logger\.js$/, /lib\/logger/, /utils\/logger/],
};

/**
 * Detect custom implementations — when an agent writes code instead of installing a package.
 *
 * Looks at file_write events for:
 * 1. File paths matching domain patterns (e.g., `auth.ts`, `lib/cache.ts`)
 * 2. File content containing domain keywords (jwt, bcrypt, cache, ttl, etc.)
 *
 * Only triggers when there's no corresponding package install in the same session.
 */
export function detectCustomImplementation(events: RawEvent[]): CustomBuildEvent[] {
  const results: CustomBuildEvent[] = [];

  // Collect all installed packages in this event set
  const installedPackages = new Set<string>();
  for (const event of events) {
    if (event.action === 'bash') {
      const pkgs = extractPackageNames(event.raw);
      for (const pkg of pkgs) {
        installedPackages.add(pkg.toLowerCase());
        // Also add the category of installed packages
        const cat = categorizePackage(pkg);
        if (cat) installedPackages.add(`__cat__${cat}`);
      }
    }
  }

  // Check file_write events for domain patterns
  for (const event of events) {
    if (event.action !== 'file_write') continue;

    const filePath = event.raw;
    const content = event.result ?? '';
    const detections: Array<{ category: string; keywords: string[]; confidence: number }> = [];

    // Check file path patterns
    for (const [category, patterns] of Object.entries(DOMAIN_FILE_PATTERNS)) {
      if (installedPackages.has(`__cat__${category}`)) continue;
      for (const pattern of patterns) {
        if (pattern.test(filePath)) {
          detections.push({ category, keywords: [filePath], confidence: 60 });
          break;
        }
      }
    }

    // Check content keywords
    for (const [category, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
      if (installedPackages.has(`__cat__${category}`)) continue;
      const matched = keywords.filter(kw => content.toLowerCase().includes(kw.toLowerCase()));
      if (matched.length >= 2) {
        // Require at least 2 keyword matches for content-based detection
        const existing = detections.find(d => d.category === category);
        if (existing) {
          existing.keywords.push(...matched);
          existing.confidence = Math.min(95, existing.confidence + matched.length * 10);
        } else {
          detections.push({ category, keywords: matched, confidence: 40 + matched.length * 10 });
        }
      }
    }

    for (const detection of detections) {
      results.push({
        event,
        category: detection.category,
        matchedKeywords: detection.keywords,
        confidence: detection.confidence,
      });
    }
  }

  return results;
}

/** Simple package name extraction from install commands */
function extractPackageNames(command: string): string[] {
  const installPatterns = [
    /(?:npm|yarn|pnpm|bun)\s+(?:install|add|i)\s+(?:--[^\s]+\s+)*(.+)/,
    /pip3?\s+install\s+(.+)/,
    /cargo\s+add\s+(.+)/,
    /go\s+get\s+(.+)/,
    /gem\s+install\s+(.+)/,
  ];

  for (const pattern of installPatterns) {
    const match = command.match(pattern);
    if (match?.[1]) {
      return match[1].split(/\s+/)
        .filter(p => !p.startsWith('-'))
        .map(p => p.replace(/@[^/].*$/, ''));
    }
  }
  return [];
}

/**
 * Get a mapping of which categories have custom builds vs package installs.
 * Useful for "Build vs Buy" analysis.
 */
export function getBuildVsBuySummary(
  customBuilds: CustomBuildEvent[],
  installEvents: Array<{ packageName?: string; category?: string }>,
): Array<{
  category: string;
  installCount: number;
  customBuildCount: number;
  customBuildPct: number;
}> {
  const categories = Object.keys(TOOL_CATEGORIES);
  const summary: Array<{
    category: string;
    installCount: number;
    customBuildCount: number;
    customBuildPct: number;
  }> = [];

  for (const category of categories) {
    const customCount = customBuilds.filter(b => b.category === category).length;
    const instCount = installEvents.filter(e => {
      if (e.category === category) return true;
      if (e.packageName) return categorizePackage(e.packageName) === category;
      return false;
    }).length;

    const total = instCount + customCount;
    if (total === 0) continue;

    summary.push({
      category,
      installCount: instCount,
      customBuildCount: customCount,
      customBuildPct: Math.round((customCount / total) * 10000) / 100,
    });
  }

  return summary.sort((a, b) => (b.installCount + b.customBuildCount) - (a.installCount + a.customBuildCount));
}
