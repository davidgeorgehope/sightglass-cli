import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const AgentConfigSchema = z.object({
  enabled: z.boolean(),
  logPath: z.string().nullable(),
});

const ConfigSchema = z.object({
  version: z.number().int(),
  agents: z.record(z.string(), AgentConfigSchema),
  analysis: z.object({
    autoClassify: z.boolean(),
    checkVulnerabilities: z.boolean(),
    checkDeprecations: z.boolean(),
  }),
  privacy: z.object({
    shareAnonymousData: z.boolean(),
    redactPaths: z.boolean(),
    redactEnvVars: z.boolean(),
    apiUrl: z.string().optional(),
    apiKey: z.string().optional(),
  }),
});

export type SightglassConfig = z.infer<typeof ConfigSchema>;

const SIGHTGLASS_DIR = '.sightglass';
const CONFIG_FILE = 'config.json';
const DB_FILE = 'sightglass.db';

/** Get the .sightglass directory path for the current project */
export function getSightglassDir(projectPath?: string): string {
  return path.join(projectPath ?? process.cwd(), SIGHTGLASS_DIR);
}

/** Get the global ~/.sightglass directory path */
export function getGlobalSightglassDir(): string {
  return path.join(os.homedir(), SIGHTGLASS_DIR);
}

/** Get the database file path */
export function getDbPath(projectPath?: string): string {
  return path.join(getSightglassDir(projectPath), DB_FILE);
}

/** Get the global database file path */
export function getGlobalDbPath(): string {
  return path.join(getGlobalSightglassDir(), DB_FILE);
}

/** Get the config file path */
export function getConfigPath(projectPath?: string): string {
  return path.join(getSightglassDir(projectPath), CONFIG_FILE);
}

/** Get the global config file path */
export function getGlobalConfigPath(): string {
  return path.join(getGlobalSightglassDir(), CONFIG_FILE);
}

/** Detect which agents are installed on this system */
export function detectAgents(): Record<string, { enabled: boolean; logPath: string | null }> {
  const agents: Record<string, { enabled: boolean; logPath: string | null }> = {};
  const home = os.homedir();

  // Claude Code
  const claudeLogDir = path.join(home, '.claude', 'projects');
  const claudeExists = fs.existsSync(claudeLogDir) || fs.existsSync(path.join(home, '.claude'));
  agents['claude-code'] = {
    enabled: claudeExists,
    logPath: claudeExists ? claudeLogDir : null,
  };

  // Codex
  const codexDir = path.join(home, '.codex');
  const codexExists = fs.existsSync(codexDir);
  agents['codex'] = {
    enabled: codexExists,
    logPath: codexExists ? codexDir : null,
  };

  // Cursor
  const cursorPaths = [
    path.join(home, '.cursor'),
    path.join(home, 'Library', 'Application Support', 'Cursor'),
  ];
  const cursorExists = cursorPaths.some(p => fs.existsSync(p));
  agents['cursor'] = {
    enabled: false, // Not yet supported
    logPath: cursorExists ? cursorPaths.find(p => fs.existsSync(p)) ?? null : null,
  };

  // Windsurf
  agents['windsurf'] = { enabled: false, logPath: null };

  // Copilot
  agents['copilot'] = { enabled: false, logPath: null };

  return agents;
}

/** Create default configuration */
export function createDefaultConfig(): SightglassConfig {
  return {
    version: 1,
    agents: detectAgents(),
    analysis: {
      autoClassify: true,
      checkVulnerabilities: true,
      checkDeprecations: true,
    },
    privacy: {
      shareAnonymousData: false,
      redactPaths: true,
      redactEnvVars: true,
    },
  };
}

/** Load config from .sightglass/config.json */
export function loadConfig(projectPath?: string): SightglassConfig {
  const configPath = getConfigPath(projectPath);
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config not found at ${configPath}. Run 'sightglass init' first.`);
  }
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  return ConfigSchema.parse(raw);
}

/** Load global config from ~/.sightglass/config.json */
export function loadGlobalConfig(): SightglassConfig | null {
  const configPath = getGlobalConfigPath();
  if (!fs.existsSync(configPath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return ConfigSchema.parse(raw);
  } catch {
    return null;
  }
}

/** Load config: try project-level first, then global */
export function loadConfigWithFallback(): SightglassConfig {
  try {
    return loadConfig();
  } catch {
    const global = loadGlobalConfig();
    if (global) return global;
    throw new Error('No config found. Run: sightglass setup');
  }
}

/** Save config to .sightglass/config.json */
export function saveConfig(config: SightglassConfig, projectPath?: string): void {
  const configPath = getConfigPath(projectPath);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}

/** Save global config to ~/.sightglass/config.json */
export function saveGlobalConfig(config: SightglassConfig): void {
  const dir = getGlobalSightglassDir();
  fs.mkdirSync(dir, { recursive: true });
  const configPath = getGlobalConfigPath();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}

/** Initialize .sightglass directory with config */
export function initSightglass(projectPath?: string): { dir: string; config: SightglassConfig } {
  const dir = getSightglassDir(projectPath);
  fs.mkdirSync(dir, { recursive: true });
  const config = createDefaultConfig();
  saveConfig(config, projectPath);
  return { dir, config };
}
