import { z } from 'zod';
import type { RawEvent } from '../collectors/types.js';

// ── Classification taxonomy ──

export const DiscoveryType = z.enum([
  'TRAINING_RECALL',
  'CONTEXT_INHERITANCE',
  'REACTIVE_SEARCH',
  'PROACTIVE_SEARCH',
  'USER_DIRECTED',
  'UNKNOWN',
]);
export type DiscoveryType = z.infer<typeof DiscoveryType>;

export const PackageManager = z.enum(['npm', 'pip', 'cargo', 'go', 'gem']);
export type PackageManager = z.infer<typeof PackageManager>;

export const RiskLevel = z.enum(['low', 'medium', 'high', 'critical']);
export type RiskLevel = z.infer<typeof RiskLevel>;

export const RiskSeverity = z.enum(['info', 'warning', 'error', 'critical']);
export type RiskSeverity = z.infer<typeof RiskSeverity>;

// ── Classified event ──

export interface ClassifiedEvent extends RawEvent {
  classification: DiscoveryType;
  confidence: number;
  packageName?: string;
  packageVersion?: string;
  packageManager?: PackageManager;
  isInstall: boolean;
  isSearch: boolean;
  abandoned: boolean;
  alternatives: string[];
}

// ── Decision chain ──

export interface DecisionChain {
  id: string;
  sessionId: string;
  rootEvent: ClassifiedEvent;
  subDecisions: ClassifiedEvent[];
  searchEvents: ClassifiedEvent[];
  abandonedChoices: ClassifiedEvent[];
  finalSelection: ClassifiedEvent;
  chainOrder: number;
}

// ── Risk assessment ──

export const RiskFactorType = z.enum([
  'vulnerability',
  'deprecated',
  'unmaintained',
  'bloat',
  'license',
  'training_bias',
]);
export type RiskFactorType = z.infer<typeof RiskFactorType>;

export interface RiskFactor {
  type: RiskFactorType;
  severity: RiskSeverity;
  detail: string;
  source?: string;
  suggestedAlternative?: string;
}

export interface RiskAssessment {
  packageName: string;
  packageVersion: string;
  riskLevel: RiskLevel;
  factors: RiskFactor[];
}

// ── Package install detection patterns ──

export const INSTALL_PATTERNS: Record<PackageManager, RegExp[]> = {
  npm: [
    /npm\s+install\s+(?:--save(?:-dev)?\s+)?(.+)/,
    /npm\s+i\s+(?:--save(?:-dev)?\s+)?(.+)/,
    /yarn\s+add\s+(.+)/,
    /pnpm\s+add\s+(.+)/,
    /bun\s+add\s+(.+)/,
  ],
  pip: [
    /pip3?\s+install\s+(?:--break-system-packages\s+)?(.+)/,
    /uv\s+pip\s+install\s+(.+)/,
    /poetry\s+add\s+(.+)/,
    /pipx\s+install\s+(.+)/,
  ],
  cargo: [
    /cargo\s+add\s+(.+)/,
    /cargo\s+install\s+(.+)/,
  ],
  go: [
    /go\s+get\s+(.+)/,
    /go\s+install\s+(.+)/,
  ],
  gem: [
    /gem\s+install\s+(.+)/,
    /bundle\s+add\s+(.+)/,
  ],
};

// ── Search detection patterns ──

export const SEARCH_PATTERNS: RegExp[] = [
  /best\s+.+\s+(?:library|package|module|tool)/i,
  /(?:alternative|replacement)\s+(?:to|for)\s+/i,
  /\bvs\b/i,
  /compare\s+/i,
  /lightweight\s+/i,
];

// ── High training weight packages (agents default to these) ──

export const HIGH_TRAINING_WEIGHT_PACKAGES: Record<PackageManager, string[]> = {
  npm: [
    'express', 'react', 'next', 'axios', 'lodash', 'moment',
    'jsonwebtoken', 'bcrypt', 'mongoose', 'cors', 'dotenv',
    'body-parser', 'nodemon', 'jest', 'typescript', 'webpack',
    'puppeteer', 'cheerio', 'socket.io', 'multer', 'passport',
    'sequelize', 'pg', 'redis', 'uuid', 'chalk',
    'helmet', 'morgan', 'express-rate-limit', 'express-validator',
  ],
  pip: [
    'flask', 'django', 'requests', 'pandas', 'numpy',
    'beautifulsoup4', 'sqlalchemy', 'click', 'pytest',
    'fastapi', 'celery', 'redis', 'pillow', 'scipy',
    'matplotlib', 'scikit-learn', 'boto3', 'pydantic',
  ],
  cargo: [
    'serde', 'tokio', 'clap', 'reqwest', 'anyhow',
    'thiserror', 'tracing', 'axum', 'sqlx',
  ],
  go: [
    'gin-gonic/gin', 'gorilla/mux', 'gorm.io/gorm',
    'go-chi/chi', 'cobra', 'viper',
  ],
  gem: [
    'rails', 'sinatra', 'puma', 'sidekiq', 'rspec',
    'devise', 'pg', 'redis',
  ],
};

// ── Known problematic packages ──

export const KNOWN_ISSUES: Record<string, RiskFactor> = {
  'moment': {
    type: 'deprecated',
    severity: 'warning',
    detail: 'Moment.js is in maintenance mode. Agents still recommend it due to high training weight.',
    suggestedAlternative: 'date-fns or dayjs',
  },
  'request': {
    type: 'deprecated',
    severity: 'warning',
    detail: 'Request is fully deprecated since Feb 2020.',
    suggestedAlternative: 'node-fetch or undici',
  },
  'lodash': {
    type: 'bloat',
    severity: 'info',
    detail: 'Full lodash is 72KB min+gzip. Most projects use <5 functions.',
    suggestedAlternative: 'lodash-es (tree-shakeable) or individual lodash packages',
  },
  'axios': {
    type: 'bloat',
    severity: 'info',
    detail: 'Native fetch is available in Node 18+. Axios adds unnecessary dependency for simple HTTP calls.',
    suggestedAlternative: 'Native fetch API',
  },
  'jsonwebtoken': {
    type: 'vulnerability',
    severity: 'error',
    detail: 'CVE-2024-33663 — algorithm confusion vulnerability.',
    source: 'https://nvd.nist.gov/vuln/detail/CVE-2024-33663',
    suggestedAlternative: 'jose',
  },
  'puppeteer': {
    type: 'bloat',
    severity: 'warning',
    detail: 'Downloads Chromium binary (~280MB). Often unnecessary for PDF/scraping tasks.',
    suggestedAlternative: 'playwright (smaller) or pdfkit (for PDF generation)',
  },
  'body-parser': {
    type: 'deprecated',
    severity: 'info',
    detail: 'body-parser is built into Express 4.16+. Separate install is unnecessary.',
    suggestedAlternative: 'express.json() and express.urlencoded()',
  },
};

// ── Agent config file patterns (for USER_DIRECTED detection) ──

export const AGENT_CONFIG_FILES: string[] = [
  'CLAUDE.md',
  '.cursorrules',
  '.cursorignore',
  '.windsurfrules',
  '.github/copilot-instructions.md',
];
