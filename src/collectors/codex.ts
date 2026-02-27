/**
 * Codex CLI collector.
 * Codex stores logs at ~/.codex/history.jsonl and ~/.codex/sessions/session-*.jsonl
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { v4 as uuid } from 'uuid';
import type { RawEvent, ActionType } from './types.js';

/** A single Codex JSONL log entry */
interface CodexLogEntry {
  type?: string;
  tool?: string;
  name?: string;
  command?: string;
  input?: {
    command?: string;
    path?: string;
    file_path?: string;
    content?: string;
    query?: string;
    url?: string;
    [key: string]: unknown;
  };
  output?: string;
  result?: string;
  timestamp?: string;
  exit_code?: number;
  exitCode?: number;
  model?: string;
  model_version?: string;
  // Nested message format (similar to Claude Code v2)
  message?: {
    content?: Array<{
      type: string;
      name?: string;
      input?: Record<string, unknown>;
    }>;
    model?: string;
  };
}

/** Map Codex tool names to our action types */
function mapCodexToolToAction(tool: string): ActionType | null {
  const t = tool.toLowerCase();
  if (t === 'shell' || t === 'bash' || t === 'exec' || t === 'command' || t === 'terminal') return 'bash';
  if (t === 'read' || t === 'read_file' || t === 'file_read' || t === 'cat' || t === 'grep' || t === 'glob') return 'file_read';
  if (t === 'write' || t === 'write_file' || t === 'file_write' || t === 'edit' || t === 'patch' || t === 'apply_diff') return 'file_write';
  if (t === 'web_search' || t === 'search') return 'web_search';
  if (t === 'web_fetch' || t === 'fetch') return 'web_fetch';
  return null;
}

/** Extract the raw command/path from a Codex tool call */
function extractRaw(entry: CodexLogEntry): string | null {
  if (entry.command) return entry.command;
  if (entry.input?.command) return entry.input.command;
  if (entry.input?.path) return entry.input.path;
  if (entry.input?.file_path) return entry.input.file_path;
  if (entry.input?.query) return entry.input.query;
  if (entry.input?.url) return entry.input.url;
  return null;
}

/** Parse a single Codex log entry into RawEvents */
export function parseCodexEntry(entry: CodexLogEntry, sessionId: string): RawEvent[] {
  const results: RawEvent[] = [];
  const model = entry.model ?? entry.message?.model;
  const modelVersion = entry.model_version;

  // Direct tool call format
  const toolName = entry.tool ?? entry.name;
  if (toolName && (entry.type === 'tool_use' || entry.type === 'function_call' || entry.type === 'tool_call' || !entry.type)) {
    const action = mapCodexToolToAction(toolName);
    if (action) {
      const raw = extractRaw(entry);
      if (raw) {
        results.push({
          id: uuid(),
          sessionId,
          timestamp: entry.timestamp ?? new Date().toISOString(),
          agent: 'claude-code', // Map to compatible agent type
          action,
          raw,
          result: (entry.output ?? entry.result)?.slice(0, 2000),
          exitCode: entry.exitCode ?? entry.exit_code,
          cwd: undefined,
          model,
          modelVersion,
        });
      }
    }
  }

  // Nested message format
  if (entry.message?.content) {
    for (const block of entry.message.content) {
      if (block.type === 'tool_use' && block.name) {
        const action = mapCodexToolToAction(block.name);
        if (!action) continue;
        const input = block.input as CodexLogEntry['input'];
        const raw = input?.command ?? input?.path ?? input?.file_path ?? input?.query ?? input?.url;
        if (!raw) continue;
        results.push({
          id: uuid(),
          sessionId,
          timestamp: entry.timestamp ?? new Date().toISOString(),
          agent: 'claude-code',
          action,
          raw: raw as string,
          cwd: undefined,
          model,
          modelVersion,
        });
      }
    }
  }

  return results;
}

/** Parse Codex JSONL content into RawEvents */
export function parseCodexJsonlContent(content: string, sessionId: string): RawEvent[] {
  const events: RawEvent[] = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as CodexLogEntry;
      events.push(...parseCodexEntry(entry, sessionId));
    } catch {
      // Skip malformed lines
    }
  }
  return events;
}

/** Find Codex log directories */
export function findCodexLogDirectories(): string[] {
  const home = os.homedir();
  const dirs: string[] = [];

  const codexDir = path.join(home, '.codex');
  if (!fs.existsSync(codexDir)) return dirs;

  // Main history file directory
  if (fs.existsSync(path.join(codexDir, 'history.jsonl'))) {
    dirs.push(codexDir);
  }

  // Sessions directory
  const sessionsDir = path.join(codexDir, 'sessions');
  if (fs.existsSync(sessionsDir)) {
    dirs.push(sessionsDir);
  }

  return dirs;
}

/** Find Codex JSONL log files */
export function findCodexLogFiles(): string[] {
  const home = os.homedir();
  const codexDir = path.join(home, '.codex');
  if (!fs.existsSync(codexDir)) return [];

  const files: string[] = [];

  // Main history file
  const historyFile = path.join(codexDir, 'history.jsonl');
  if (fs.existsSync(historyFile)) {
    files.push(historyFile);
  }

  // Session files
  const sessionsDir = path.join(codexDir, 'sessions');
  if (fs.existsSync(sessionsDir)) {
    try {
      for (const entry of fs.readdirSync(sessionsDir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          files.push(path.join(sessionsDir, entry.name));
        }
      }
    } catch { /* */ }
  }

  return files;
}

/** Collect all events from Codex logs */
export function collectCodexEvents(since?: Date): { sessionId: string; events: RawEvent[] }[] {
  const results: { sessionId: string; events: RawEvent[] }[] = [];

  for (const file of findCodexLogFiles()) {
    const sessionId = path.basename(file, '.jsonl');
    const content = fs.readFileSync(file, 'utf-8');
    const events = parseCodexJsonlContent(content, sessionId);

    const filtered = since
      ? events.filter(e => new Date(e.timestamp) >= since)
      : events;

    if (filtered.length > 0) {
      results.push({ sessionId, events: filtered });
    }
  }

  return results;
}
