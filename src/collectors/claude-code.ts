import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { v4 as uuid } from 'uuid';
import type { RawEvent, ClaudeCodeLogEntry, ClaudeCodeToolCall, ActionType } from './types.js';

/**
 * Parse a single Claude Code JSONL log entry into a RawEvent (if relevant).
 * Returns null for entries that aren't tool calls we care about.
 */
export function parseLogEntry(
  entry: ClaudeCodeLogEntry,
  sessionId: string,
): RawEvent[] {
  const results: RawEvent[] = [];

  // v1 flat format: {type: "tool_use", tool: "Bash", input: {...}}
  if (entry.type === 'tool_use' && (entry.tool || entry.name)) {
    const toolName = entry.tool ?? entry.name!;
    const action = mapToolToAction(toolName);
    if (action) {
      const raw = extractRawCommand({ name: toolName, input: entry.input });
      if (raw) {
        results.push({
          id: uuid(),
          sessionId,
          timestamp: entry.timestamp ?? new Date().toISOString(),
          agent: 'claude-code',
          action,
          raw,
          result: entry.output?.slice(0, 2000),
          exitCode: entry.exitCode ?? entry.exit_code,
          cwd: undefined,
        });
      }
    }
    return results;
  }

  // v2 nested format: {type: "assistant", message: {content: [{type: "tool_use", name: "Bash", input: {...}}]}}
  if (entry.type === 'assistant' && entry.message?.content) {
    for (const block of entry.message.content) {
      if (block.type === 'tool_use' && block.name) {
        const action = mapToolToAction(block.name);
        if (!action) continue;
        const raw = extractRawCommand({ name: block.name, input: block.input as ClaudeCodeToolCall['input'] });
        if (!raw) continue;
        results.push({
          id: uuid(),
          sessionId,
          timestamp: entry.timestamp ?? new Date().toISOString(),
          agent: 'claude-code',
          action,
          raw,
          result: undefined,
          exitCode: undefined,
          cwd: undefined,
        });
      }
    }
  }

  return results;
}

/** Map Claude Code tool names to our action types */
function mapToolToAction(tool: string): ActionType | null {
  const mapping: Record<string, ActionType> = {
    'bash': 'bash',
    'Bash': 'bash',
    'search': 'web_search',
    'Search': 'web_search',
    'web_search': 'web_search',
    'WebSearch': 'web_search',
    'fetch': 'web_fetch',
    'Fetch': 'web_fetch',
    'web_fetch': 'web_fetch',
    'WebFetch': 'web_fetch',
    'read': 'file_read',
    'Read': 'file_read',
    'file_read': 'file_read',
    'write': 'file_write',
    'Write': 'file_write',
    'file_write': 'file_write',
    'edit': 'file_write',
    'Edit': 'file_write',
    'Glob': 'file_read',
    'glob': 'file_read',
    'Grep': 'file_read',
    'grep': 'file_read',
  };
  return mapping[tool] ?? null;
}

/** Extract the raw command/query/path from a tool call */
function extractRawCommand(call: ClaudeCodeToolCall): string | null {
  const input = call.input;
  if (!input) return null;

  if (input.command) return input.command;
  if (input.query) return input.query;
  if (input.url) return input.url;
  if (input.path) return input.path;
  if (input.file_path) return input.file_path;

  return null;
}

/**
 * Parse a JSONL file into RawEvents.
 * Each line is expected to be a JSON object.
 */
export function parseJsonlFile(filePath: string, sessionId: string): RawEvent[] {
  if (!fs.existsSync(filePath)) return [];

  const content = fs.readFileSync(filePath, 'utf-8');
  return parseJsonlContent(content, sessionId);
}

/** Parse JSONL content string into RawEvents */
export function parseJsonlContent(content: string, sessionId: string): RawEvent[] {
  const events: RawEvent[] = [];
  const lines = content.split('\n').filter(line => line.trim());

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as ClaudeCodeLogEntry;
      const parsed = parseLogEntry(entry, sessionId);
      events.push(...parsed);
    } catch {
      // Skip malformed lines
    }
  }

  return events;
}

/**
 * Find Claude Code log directories.
 * Claude Code stores logs in ~/.claude/projects/ organized by project path.
 */
export function findLogDirectories(): string[] {
  const home = os.homedir();
  const projectsDir = path.join(home, '.claude', 'projects');

  if (!fs.existsSync(projectsDir)) return [];

  const dirs: string[] = [];
  try {
    const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        dirs.push(path.join(projectsDir, entry.name));
      }
    }
  } catch {
    // Permission errors, etc.
  }

  return dirs;
}

/**
 * Find JSONL log files in a Claude Code project directory.
 * Looks for files matching common log patterns.
 */
export function findLogFiles(projectDir: string): string[] {
  if (!fs.existsSync(projectDir)) return [];

  const files: string[] = [];
  try {
    const entries = fs.readdirSync(projectDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && (entry.name.endsWith('.jsonl') || entry.name.endsWith('.json'))) {
        files.push(path.join(projectDir, entry.name));
      }
    }
  } catch {
    // Permission errors, etc.
  }

  return files.sort((a, b) => {
    // Sort by modification time, newest first
    const aStat = fs.statSync(a);
    const bStat = fs.statSync(b);
    return bStat.mtimeMs - aStat.mtimeMs;
  });
}

/**
 * Collect all events from Claude Code logs.
 * Scans all project directories and parses their log files.
 */
export function collectAllEvents(since?: Date): { sessionId: string; events: RawEvent[] }[] {
  const results: { sessionId: string; events: RawEvent[] }[] = [];
  const dirs = findLogDirectories();

  for (const dir of dirs) {
    const logFiles = findLogFiles(dir);
    for (const file of logFiles) {
      // Use filename as session identifier
      const sessionId = path.basename(file, path.extname(file));
      const events = parseJsonlFile(file, sessionId);

      // Filter by date if specified
      const filtered = since
        ? events.filter(e => new Date(e.timestamp) >= since)
        : events;

      if (filtered.length > 0) {
        results.push({ sessionId, events: filtered });
      }
    }
  }

  return results;
}
