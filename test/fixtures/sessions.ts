import type { RawEvent } from '../../src/collectors/types.js';

/**
 * Sample Claude Code session: "Build REST API with auth"
 * Demonstrates training recall dominance.
 */
export const FIXTURE_SESSION_REST_API: { sessionId: string; events: RawEvent[] } = {
  sessionId: 'test-session-001',
  events: [
    // Step 1: Agent reads project context
    {
      id: 'evt-001',
      sessionId: 'test-session-001',
      timestamp: '2026-02-20T14:30:00.000Z',
      agent: 'claude-code',
      action: 'file_read',
      raw: 'package.json',
      result: '{"name": "my-api", "version": "1.0.0", "dependencies": {}}',
    },
    // Step 2: Agent reads CLAUDE.md
    {
      id: 'evt-002',
      sessionId: 'test-session-001',
      timestamp: '2026-02-20T14:30:01.000Z',
      agent: 'claude-code',
      action: 'file_read',
      raw: 'CLAUDE.md',
      result: '# Project Guidelines\n\nUse TypeScript for all code.\nUse PostgreSQL for the database.',
    },
    // Step 3: Training recall — Express (no search, high-weight)
    {
      id: 'evt-003',
      sessionId: 'test-session-001',
      timestamp: '2026-02-20T14:30:05.000Z',
      agent: 'claude-code',
      action: 'bash',
      raw: 'npm install express @types/express',
      result: 'added 64 packages in 3s',
      exitCode: 0,
    },
    // Step 4: Training recall — jsonwebtoken + bcrypt
    {
      id: 'evt-004',
      sessionId: 'test-session-001',
      timestamp: '2026-02-20T14:30:10.000Z',
      agent: 'claude-code',
      action: 'bash',
      raw: 'npm install jsonwebtoken @types/jsonwebtoken bcrypt @types/bcrypt',
      result: 'added 12 packages in 2s',
      exitCode: 0,
    },
    // Step 5: User directed — pg (from CLAUDE.md mentioning PostgreSQL)
    {
      id: 'evt-005',
      sessionId: 'test-session-001',
      timestamp: '2026-02-20T14:30:15.000Z',
      agent: 'claude-code',
      action: 'bash',
      raw: 'npm install pg @types/pg',
      result: 'added 8 packages in 1s',
      exitCode: 0,
    },
    // Step 6: Training recall — express-rate-limit
    {
      id: 'evt-006',
      sessionId: 'test-session-001',
      timestamp: '2026-02-20T14:30:18.000Z',
      agent: 'claude-code',
      action: 'bash',
      raw: 'npm install express-rate-limit',
      result: 'added 1 package in 0.5s',
      exitCode: 0,
    },
    // Step 7: Training recall — cors/helmet/dotenv trio
    {
      id: 'evt-007',
      sessionId: 'test-session-001',
      timestamp: '2026-02-20T14:30:22.000Z',
      agent: 'claude-code',
      action: 'bash',
      raw: 'npm install cors helmet dotenv',
      result: 'added 5 packages in 1s',
      exitCode: 0,
    },
    // Step 8: File write (not a dependency decision)
    {
      id: 'evt-008',
      sessionId: 'test-session-001',
      timestamp: '2026-02-20T14:30:30.000Z',
      agent: 'claude-code',
      action: 'file_write',
      raw: 'src/index.ts',
      result: 'File written successfully',
    },
    // Step 9: Failed run
    {
      id: 'evt-009',
      sessionId: 'test-session-001',
      timestamp: '2026-02-20T14:31:00.000Z',
      agent: 'claude-code',
      action: 'bash',
      raw: 'npx ts-node src/index.ts',
      result: "Error: Cannot find module 'ts-node'",
      exitCode: 1,
    },
    // Step 10: Reactive install after failure
    {
      id: 'evt-010',
      sessionId: 'test-session-001',
      timestamp: '2026-02-20T14:31:05.000Z',
      agent: 'claude-code',
      action: 'bash',
      raw: 'npm install -D ts-node typescript',
      result: 'added 2 packages in 1s',
      exitCode: 0,
    },
    // Step 11: Another failure
    {
      id: 'evt-011',
      sessionId: 'test-session-001',
      timestamp: '2026-02-20T14:31:15.000Z',
      agent: 'claude-code',
      action: 'bash',
      raw: 'npx ts-node src/index.ts',
      result: "Error: Cannot find module 'express-validator'",
      exitCode: 1,
    },
    // Step 12: Search for validation approach
    {
      id: 'evt-012',
      sessionId: 'test-session-001',
      timestamp: '2026-02-20T14:31:18.000Z',
      agent: 'claude-code',
      action: 'web_search',
      raw: 'express request validation middleware typescript',
      result: 'Results: express-validator, joi, zod, yup, class-validator...',
    },
    // Step 13: Install from search results
    {
      id: 'evt-013',
      sessionId: 'test-session-001',
      timestamp: '2026-02-20T14:31:25.000Z',
      agent: 'claude-code',
      action: 'bash',
      raw: 'npm install zod',
      result: 'added 1 package in 0.5s',
      exitCode: 0,
    },
  ],
};

/**
 * Sample session: "Add PDF generation"
 * Demonstrates failure-driven search and alternative discovery.
 */
export const FIXTURE_SESSION_PDF: { sessionId: string; events: RawEvent[] } = {
  sessionId: 'test-session-002',
  events: [
    // Step 1: Training recall — puppeteer (fails)
    {
      id: 'evt-100',
      sessionId: 'test-session-002',
      timestamp: '2026-02-20T15:45:00.000Z',
      agent: 'claude-code',
      action: 'bash',
      raw: 'npm install puppeteer',
      result: 'Error: Failed to download Chromium. ENOSPC: no space on device',
      exitCode: 1,
    },
    // Step 2: Search after failure
    {
      id: 'evt-101',
      sessionId: 'test-session-002',
      timestamp: '2026-02-20T15:45:10.000Z',
      agent: 'claude-code',
      action: 'web_search',
      raw: 'lightweight PDF generation nodejs without puppeteer',
      result: 'Results: pdfkit, pdf-lib, jspdf, puppeteer-core...',
    },
    // Step 3: Evaluate option
    {
      id: 'evt-102',
      sessionId: 'test-session-002',
      timestamp: '2026-02-20T15:45:15.000Z',
      agent: 'claude-code',
      action: 'web_fetch',
      raw: 'https://github.com/foliojs/pdfkit',
      result: 'Stars: 9.8k, Last commit: 2 weeks ago...',
    },
    // Step 4: Install the alternative
    {
      id: 'evt-103',
      sessionId: 'test-session-002',
      timestamp: '2026-02-20T15:45:22.000Z',
      agent: 'claude-code',
      action: 'bash',
      raw: 'npm install pdfkit',
      result: 'added 4 packages in 1s',
      exitCode: 0,
    },
  ],
};

/**
 * Sample JSONL content (mimics Claude Code log format).
 */
export const FIXTURE_JSONL_CONTENT = [
  '{"type":"tool_use","tool":"bash","input":{"command":"npm install express"},"output":"added 64 packages","exitCode":0,"timestamp":"2026-02-20T14:30:05.000Z"}',
  '{"type":"tool_use","tool":"read","input":{"path":"package.json"},"output":"{\\"dependencies\\":{}}","timestamp":"2026-02-20T14:30:01.000Z"}',
  '{"type":"tool_use","tool":"search","input":{"query":"best node.js web framework"},"output":"Results: express, fastify, koa, hapi...","timestamp":"2026-02-20T14:30:03.000Z"}',
  '{"type":"text","output":"I will set up the project","timestamp":"2026-02-20T14:30:00.000Z"}',
  '{"type":"tool_use","tool":"bash","input":{"command":"npm install axios"},"output":"added 1 package","exitCode":0,"timestamp":"2026-02-20T14:30:06.000Z"}',
].join('\n');

/**
 * Expected analysis for REST API fixture.
 */
export const EXPECTED_REST_API_ANALYSIS = {
  totalInstallEvents: 7,
  classifications: {
    TRAINING_RECALL: 4,  // express, jwt+bcrypt, rate-limit, cors+helmet+dotenv
    USER_DIRECTED: 1,    // pg (from CLAUDE.md)
    REACTIVE_SEARCH: 2,  // ts-node (after failure), zod (after search)
  },
  riskFlags: ['jsonwebtoken'],
  alternativesNeverConsidered: 4,
};
