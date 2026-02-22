import { describe, it, expect } from 'vitest';
import { parseLogEntry, parseJsonlContent } from '../../src/collectors/claude-code.js';
import { FIXTURE_JSONL_CONTENT } from '../fixtures/sessions.js';
import type { ClaudeCodeLogEntry } from '../../src/collectors/types.js';

describe('parseLogEntry', () => {
  it('parses a bash tool_use entry', () => {
    const entry: ClaudeCodeLogEntry = {
      type: 'tool_use',
      tool: 'bash',
      input: { command: 'npm install express' },
      output: 'added 64 packages',
      exitCode: 0,
      timestamp: '2026-02-20T14:30:05.000Z',
    };

    const result = parseLogEntry(entry, 'test-session');
    expect(result.length).toBe(1);
    expect(result[0].action).toBe('bash');
    expect(result[0].raw).toBe('npm install express');
    expect(result[0].exitCode).toBe(0);
    expect(result[0].agent).toBe('claude-code');
  });

  it('parses a read tool_use entry', () => {
    const entry: ClaudeCodeLogEntry = {
      type: 'tool_use',
      tool: 'read',
      input: { path: 'package.json' },
      output: '{"dependencies":{}}',
      timestamp: '2026-02-20T14:30:01.000Z',
    };

    const result = parseLogEntry(entry, 'test-session');
    expect(result.length).toBe(1);
    expect(result[0].action).toBe('file_read');
    expect(result[0].raw).toBe('package.json');
  });

  it('parses a search tool_use entry', () => {
    const entry: ClaudeCodeLogEntry = {
      type: 'tool_use',
      tool: 'search',
      input: { query: 'best node.js framework' },
      output: 'Results: express, fastify, koa...',
      timestamp: '2026-02-20T14:30:03.000Z',
    };

    const result = parseLogEntry(entry, 'test-session');
    expect(result.length).toBe(1);
    expect(result[0].action).toBe('web_search');
    expect(result[0].raw).toBe('best node.js framework');
  });

  it('returns empty array for non-tool_use entries', () => {
    const entry: ClaudeCodeLogEntry = {
      type: 'text',
      output: 'I will set up the project',
      timestamp: '2026-02-20T14:30:00.000Z',
    };

    const result = parseLogEntry(entry, 'test-session');
    expect(result).toHaveLength(0);
  });

  it('returns empty array for unknown tool types', () => {
    const entry: ClaudeCodeLogEntry = {
      type: 'tool_use',
      tool: 'unknown_tool',
      input: { command: 'something' },
      timestamp: '2026-02-20T14:30:00.000Z',
    };

    const result = parseLogEntry(entry, 'test-session');
    expect(result).toHaveLength(0);
  });

  it('returns empty array for entries without input', () => {
    const entry: ClaudeCodeLogEntry = {
      type: 'tool_use',
      tool: 'bash',
      timestamp: '2026-02-20T14:30:00.000Z',
    };

    const result = parseLogEntry(entry, 'test-session');
    expect(result).toHaveLength(0);
  });

  it('truncates long output to 2000 chars', () => {
    const entry: ClaudeCodeLogEntry = {
      type: 'tool_use',
      tool: 'bash',
      input: { command: 'npm install express' },
      output: 'x'.repeat(5000),
      exitCode: 0,
      timestamp: '2026-02-20T14:30:05.000Z',
    };

    const result = parseLogEntry(entry, 'test-session');
    expect(result.length).toBe(1);
    expect(result[0].result!.length).toBe(2000);
  });
});

describe('parseJsonlContent', () => {
  it('parses multi-line JSONL content', () => {
    const events = parseJsonlContent(FIXTURE_JSONL_CONTENT, 'test-session');

    // Should parse tool_use entries only (skipping 'text' type)
    expect(events.length).toBe(4); // bash, read, search, bash (text is skipped)
  });

  it('assigns correct session ID to all events', () => {
    const events = parseJsonlContent(FIXTURE_JSONL_CONTENT, 'my-session');
    for (const event of events) {
      expect(event.sessionId).toBe('my-session');
    }
  });

  it('generates unique IDs for each event', () => {
    const events = parseJsonlContent(FIXTURE_JSONL_CONTENT, 'test-session');
    const ids = new Set(events.map(e => e.id));
    expect(ids.size).toBe(events.length);
  });

  it('handles empty content', () => {
    const events = parseJsonlContent('', 'test-session');
    expect(events).toHaveLength(0);
  });

  it('handles malformed JSON lines gracefully', () => {
    const content = '{"type":"tool_use","tool":"bash","input":{"command":"ls"},"timestamp":"2026-01-01T00:00:00.000Z"}\n{invalid json}\n{"type":"tool_use","tool":"bash","input":{"command":"pwd"},"timestamp":"2026-01-01T00:00:01.000Z"}';
    const events = parseJsonlContent(content, 'test-session');
    expect(events.length).toBe(2); // Skips the invalid line
  });
});
