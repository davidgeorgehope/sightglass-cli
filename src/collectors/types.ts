import { z } from 'zod';

export const AgentType = z.enum([
  'claude-code',
  'cursor',
  'windsurf',
  'copilot',
  'unknown',
]);
export type AgentType = z.infer<typeof AgentType>;

export const ActionType = z.enum([
  'bash',
  'web_search',
  'web_fetch',
  'file_read',
  'file_write',
]);
export type ActionType = z.infer<typeof ActionType>;

export const RawEventSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string(),
  timestamp: z.string().datetime(),
  agent: AgentType,
  action: ActionType,
  raw: z.string(),
  result: z.string().optional(),
  exitCode: z.number().int().optional(),
  cwd: z.string().optional(),
  model: z.string().optional(),
  modelVersion: z.string().optional(),
});
export type RawEvent = z.infer<typeof RawEventSchema>;

/** Tool call extracted from Claude Code logs (normalized from any format) */
export interface ClaudeCodeToolCall {
  name: string;
  input?: {
    command?: string;
    description?: string;
    path?: string;
    query?: string;
    url?: string;
    file_path?: string;
    content?: string;
    old_string?: string;
    new_string?: string;
    pattern?: string;
    [key: string]: unknown;
  };
}

/** Minimal representation of a Claude Code JSONL log entry (v1 flat format) */
export interface ClaudeCodeLogEntry {
  type: string;
  tool?: string;
  name?: string;
  input?: ClaudeCodeToolCall['input'];
  output?: string;
  timestamp?: string;
  exitCode?: number;
  exit_code?: number;
  // Model info (extracted from session metadata)
  model?: string;
  model_version?: string;
  // v2 nested format
  message?: {
    content?: Array<{
      type: string;
      name?: string;
      input?: ClaudeCodeToolCall['input'];
      id?: string;
    }>;
    model?: string;
  };
  // tool_result format
  content?: Array<{
    type: string;
    text?: string;
  }>;
  duration_ms?: number;
}
