import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { watch } from 'chokidar';
import readline from 'node:readline';
import {
  loadConfigWithFallback,
  loadGlobalConfig,
  saveGlobalConfig,
  getGlobalDbPath,
  getGlobalSightglassDir,
  detectAgents,
  createDefaultConfig,
} from './utils/config.js';
import { SightglassDB } from './storage/db.js';
import {
  collectAllEvents,
  parseJsonlContent,
  findLogDirectories,
} from './collectors/claude-code.js';
import {
  collectCodexEvents,
  parseCodexJsonlContent,
  findCodexLogDirectories,
} from './collectors/codex.js';
import { classifyEvents } from './classifiers/pattern-classifier.js';
import { buildChains, getChainStats } from './analyzers/chain-builder.js';
import { scoreRisks, getRiskStats } from './analyzers/risk-scorer.js';
import { formatTerminalReport, formatChains } from './reporters/terminal.js';
import type { AnalysisReport } from './reporters/terminal.js';
import { formatJsonReport } from './reporters/json.js';
import { pushEvents } from './sync/push.js';
import type { DiscoveryType } from './classifiers/types.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// execSync removed — no longer needed

const program = new Command();

program
  .name('sightglass')
  .description('Agent supply chain intelligence — see what your AI coding agents actually decide')
  .version('0.1.0');

// ── Helper: readline prompt ──

function prompt(question: string, isPassword = false): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    if (isPassword) {
      // For passwords, disable echo
      process.stdout.write(question);
      const stdin = process.stdin;
      const wasRaw = stdin.isRaw;
      if (stdin.isTTY) stdin.setRawMode(true);
      let password = '';
      const onData = (ch: Buffer) => {
        const c = ch.toString('utf8');
        if (c === '\n' || c === '\r' || c === '\u0004') {
          if (stdin.isTTY) stdin.setRawMode(wasRaw ?? false);
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          rl.close();
          resolve(password);
        } else if (c === '\u0003') {
          process.exit(0);
        } else if (c === '\u007F' || c === '\b') {
          if (password.length > 0) {
            password = password.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else {
          password += c;
          process.stdout.write('*');
        }
      };
      stdin.on('data', onData);
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

function promptYN(question: string, defaultYes = true): Promise<boolean> {
  const suffix = defaultYes ? '[Y/n]' : '[y/N]';
  return prompt(`${question} ${suffix} `).then(ans => {
    if (!ans) return defaultYes;
    return ans.toLowerCase().startsWith('y');
  });
}

// ── sightglass login ──

program
  .command('login')
  .description('Authenticate with sightglass.dev')
  .option('--api-url <url>', 'API URL', 'https://sightglass.dev')
  .action(async (opts) => {
    console.log('');
    console.log(chalk.hex('#c9893a').bold('  sightglass') + chalk.dim(' login'));
    console.log('');

    const email = await prompt('  Email: ');
    const password = await prompt('  Password: ', true);

    if (!email || !password) {
      console.log(chalk.red('  Email and password are required.'));
      process.exit(1);
    }

    const apiUrl = opts.apiUrl;

    // Try login first
    const spinner = ora('  Signing in...').start();
    try {
      const loginRes = await fetch(`${apiUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (loginRes.ok) {
        const data = await loginRes.json() as { apiKey: string; token: string };
        spinner.succeed('  Signed in!');
        saveApiConfig(apiUrl, data.apiKey);
        console.log(chalk.dim(`  API key saved to ~/.sightglass/config.json`));
        console.log('');
        return;
      }

      if (loginRes.status === 401) {
        spinner.stop();
        // Ask to register
        console.log(chalk.yellow('  Account not found or wrong password.'));
        const wantRegister = await promptYN('  Create a new account?');
        if (!wantRegister) {
          process.exit(1);
        }

        const regSpinner = ora('  Creating account...').start();
        const regRes = await fetch(`${apiUrl}/api/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });

        if (regRes.ok) {
          const data = await regRes.json() as { apiKey: string; token: string };
          regSpinner.succeed('  Account created!');
          saveApiConfig(apiUrl, data.apiKey);
          console.log(chalk.dim(`  API key saved to ~/.sightglass/config.json`));
          console.log('');
          return;
        }

        const regErr = await regRes.json() as { error?: string };
        regSpinner.fail(`  Registration failed: ${regErr.error ?? 'unknown error'}`);
        process.exit(1);
      }

      const errBody = await loginRes.json() as { error?: string };
      spinner.fail(`  Login failed: ${errBody.error ?? loginRes.statusText}`);
      process.exit(1);
    } catch (err) {
      spinner.fail(`  Could not reach ${apiUrl}`);
      console.log(chalk.dim(`  ${err instanceof Error ? err.message : String(err)}`));
      process.exit(1);
    }
  });

function saveApiConfig(apiUrl: string, apiKey: string): void {
  let config = loadGlobalConfig();
  if (!config) {
    config = createDefaultConfig();
  }
  config.privacy.shareAnonymousData = true;
  config.privacy.apiUrl = apiUrl;
  config.privacy.apiKey = apiKey;
  saveGlobalConfig(config);
}

// ── sightglass setup ──

program
  .command('setup')
  .alias('init')
  .description('Interactive first-time setup — detect agents, login, install hook')
  .action(async () => {
    console.log('');
    console.log(chalk.hex('#c9893a').bold('  sightglass') + ' setup');
    console.log(chalk.dim('  One command to rule them all'));
    console.log('');

    // 1. Detect agents
    const agents = detectAgents();
    const enabled = Object.entries(agents).filter(([_, v]) => v.enabled);
    console.log(chalk.bold('  Detected agents:'));
    for (const [name, info] of Object.entries(agents)) {
      const icon = info.enabled ? chalk.green('✓') : chalk.dim('✗');
      console.log(`    ${icon} ${name}${info.logPath ? chalk.dim(` (${info.logPath})`) : ''}`);
    }
    console.log('');

    if (enabled.length === 0) {
      console.log(chalk.yellow('  No supported agents found.'));
      console.log(chalk.dim('  Install Claude Code, Codex, or Cursor first.'));
      process.exit(1);
    }

    // 2. Global config
    let config = loadGlobalConfig();
    if (!config) {
      config = createDefaultConfig();
      saveGlobalConfig(config);
      console.log(chalk.green('  ✓') + ' Created global config at ~/.sightglass/config.json');
    } else {
      // Update agents in existing config
      config.agents = agents;
      saveGlobalConfig(config);
      console.log(chalk.green('  ✓') + ' Updated global config');
    }

    // 3. Init database
    const dbPath = getGlobalDbPath();
    const db = new SightglassDB(dbPath);
    db.init();
    db.close();
    console.log(chalk.green('  ✓') + ' Database initialized at ~/.sightglass/sightglass.db');

    // 4. Login if no API key
    if (!config.privacy.apiKey) {
      console.log('');
      const wantLogin = await promptYN('  Connect to sightglass.dev for cloud analytics?');
      if (wantLogin) {
        const email = await prompt('  Email: ');
        const password = await prompt('  Password: ', true);
        const apiUrl = 'https://sightglass.dev';

        // Try login, then register
        try {
          let res = await fetch(`${apiUrl}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
          });

          if (res.status === 401) {
            console.log(chalk.dim('  Creating new account...'));
            res = await fetch(`${apiUrl}/api/auth/register`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email, password }),
            });
          }

          if (res.ok) {
            const data = await res.json() as { apiKey: string };
            config.privacy.shareAnonymousData = true;
            config.privacy.apiUrl = apiUrl;
            config.privacy.apiKey = data.apiKey;
            saveGlobalConfig(config);
            console.log(chalk.green('  ✓') + ' Connected to sightglass.dev');
          } else {
            console.log(chalk.yellow('  ⚠ Could not authenticate. You can run `sightglass login` later.'));
          }
        } catch {
          console.log(chalk.yellow('  ⚠ Could not reach sightglass.dev. You can run `sightglass login` later.'));
        }
      }
    } else {
      console.log(chalk.green('  ✓') + ' Already connected to sightglass.dev');
    }

    // 5. Install PreToolUse hook
    const packageHookSrc = path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      'hooks',
      'pretooluse.js',
    );
    const hookDestDir = path.join(os.homedir(), '.sightglass', 'hooks');
    const hookDestPath = path.join(hookDestDir, 'pretooluse.js');
    fs.mkdirSync(hookDestDir, { recursive: true });

    if (fs.existsSync(packageHookSrc)) {
      fs.copyFileSync(packageHookSrc, hookDestPath);

      // Register in Claude Code settings
      const settingsDir = path.join(os.homedir(), '.claude');
      const settingsPath = path.join(settingsDir, 'settings.json');
      let settings: Record<string, unknown> = {};
      if (fs.existsSync(settingsPath)) {
        try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')); } catch { /* */ }
      }
      if (!settings.hooks) settings.hooks = {};
      const hooks = settings.hooks as Record<string, unknown>;
      if (!hooks.PreToolUse) hooks.PreToolUse = [];
      const preToolUse = hooks.PreToolUse as Array<Record<string, string>>;
      const alreadyInstalled = preToolUse.some(
        (h) => h.type === 'command' && h.command?.includes('sightglass'),
      );
      if (!alreadyInstalled) {
        preToolUse.push({ type: 'command', command: `node ${hookDestPath}` });
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      }
      console.log(chalk.green('  ✓') + ' PreToolUse hook installed in Claude Code');
    } else {
      console.log(chalk.yellow('  ⚠ Hook script not found — run: sightglass hook install'));
    }

    // 6. Summary
    console.log('');
    console.log(chalk.hex('#c9893a').bold('  Setup complete! 🎉'));
    console.log('');
    console.log(chalk.dim('  What happens now:'));
    console.log(chalk.dim('    • When your agent installs a package, Sightglass evaluates it'));
    console.log(chalk.dim('    • Deprecated/vulnerable packages get flagged with alternatives'));
    console.log(chalk.dim('    • All decisions are logged locally'));
    console.log(chalk.dim('    • View your dashboard at https://sightglass.dev'));
    console.log('');
  });

// (init is now an alias of setup)

// ── sightglass watch ──

program
  .command('watch')
  .description('Watch agent sessions in real-time')
  .option('--agent <agent>', 'Watch specific agent (default: all)')
  .option('--live', 'Show live terminal output')
  .action(async (opts) => {
    let config;
    try {
      config = loadConfigWithFallback();
    } catch {
      console.error(chalk.red('Not initialized. Run: sightglass setup'));
      process.exit(1);
    }

    const dbPath = getGlobalDbPath();
    const dir = getGlobalSightglassDir();
    fs.mkdirSync(dir, { recursive: true });
    const db = new SightglassDB(dbPath);
    db.init();

    // Gather all log directories from all agents
    const logDirs: string[] = [];

    // Claude Code
    const ccDirs = findLogDirectories();
    logDirs.push(...ccDirs);

    // Codex
    const codexDirs = findCodexLogDirectories();
    logDirs.push(...codexDirs);

    if (logDirs.length === 0) {
      console.log(chalk.yellow('No agent log directories found.'));
      console.log(chalk.dim('Run some agent sessions first, then try again.'));
      db.close();
      return;
    }

    console.log(chalk.hex('#c9893a')('  sightglass') + chalk.dim(' watching...'));
    console.log(chalk.dim(`  Monitoring ${logDirs.length} director${logDirs.length === 1 ? 'y' : 'ies'} (Claude Code: ${ccDirs.length}, Codex: ${codexDirs.length})`));
    console.log('');

    // Watch for new JSONL files and changes
    const watcher = watch(logDirs.map(d => `${d}/**/*.jsonl`), {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
    });

    const processedLines = new Map<string, number>();

    watcher.on('change', (filePath) => {
      try {
        const content = require('node:fs').readFileSync(filePath, 'utf-8') as string;
        const lines = content.split('\n');
        const prevCount = processedLines.get(filePath) ?? 0;
        const newLines = lines.slice(prevCount).filter((l: string) => l.trim());
        processedLines.set(filePath, lines.length);

        if (newLines.length === 0) return;

        const sessionId = require('node:path').basename(filePath, '.jsonl');
        const newContent = newLines.join('\n');

        // Detect agent type from path
        const isCodex = filePath.includes('.codex');
        const events = isCodex
          ? parseCodexJsonlContent(newContent, sessionId)
          : parseJsonlContent(newContent, sessionId);

        if (events.length > 0) {
          const classified = classifyEvents(events);

          // Store events
          for (const event of events) {
            try { db.insertEvent(event); } catch { /* duplicate */ }
          }

          // Update classifications
          for (const event of classified) {
            try { db.updateEventClassification(event); } catch { /* */ }
          }

          // Live output
          if (opts.live) {
            for (const event of classified) {
              if (event.isInstall) {
                const riskColor = event.abandoned ? chalk.red : chalk.green;
                const classColor = classificationColor(event.classification);
                console.log(
                  chalk.dim(`  ${new Date(event.timestamp).toLocaleTimeString()}`) +
                  ` ${riskColor(event.abandoned ? '\u2717' : '\u2713')}` +
                  ` ${chalk.white(event.packageName ?? event.raw)}` +
                  ` ${classColor(`[${event.classification}]`)}` +
                  ` ${chalk.dim(`${event.confidence}%`)}`,
                );
              }
            }
          }

          // Push to API if enabled
          if (config.privacy.shareAnonymousData) {
            pushEvents(classified, config).catch(() => {});
          }
        }
      } catch {
        // Skip errors in file processing
      }
    });

    watcher.on('add', (filePath) => {
      if (opts.live) {
        const name = require('node:path').basename(filePath);
        console.log(chalk.dim(`  New session: ${name}`));
      }
    });

    // Keep running
    process.on('SIGINT', () => {
      console.log('');
      console.log(chalk.dim('  Stopped watching.'));
      watcher.close();
      db.close();
      process.exit(0);
    });
  });

// ── sightglass analyze ──

program
  .command('analyze')
  .description('Analyze collected sessions')
  .option('--since <date>', 'Analyze events since date (e.g. "today", "2024-01-01")')
  .option('--format <format>', 'Output format: terminal, json', 'terminal')
  .option('--chains', 'Show full decision chains')
  .option('--session <id>', 'Analyze specific session')
  .action(async (opts) => {
    let config;
    try {
      config = loadConfigWithFallback();
    } catch {
      // No config — try to work without it
    }

    // Try to load from DB first
    const dbPath = getGlobalDbPath();
    let allEvents;

    try {
      const db = new SightglassDB(dbPath);
      db.init();

      const since = parseSinceDate(opts.since);
      const rows = opts.session
        ? db.getEventsBySession(opts.session)
        : db.getAllEvents(since?.toISOString());

      if (rows.length > 0) {
        allEvents = rows.map(row => ({
          id: row.id,
          sessionId: row.session_id,
          timestamp: row.timestamp,
          agent: row.agent as 'claude-code',
          action: row.action as 'bash',
          raw: row.raw,
          result: row.result ?? undefined,
          exitCode: row.exit_code ?? undefined,
          cwd: row.cwd ?? undefined,
        }));
      }
      db.close();
    } catch {
      // DB not available
    }

    // If no DB data, try collecting from logs directly
    if (!allEvents) {
      const spinner = ora('Collecting events from agent logs...').start();
      const since = parseSinceDate(opts.since);

      // Collect from all agents
      const ccSessions = collectAllEvents(since ?? undefined);
      const codexSessions = collectCodexEvents(since ?? undefined);
      const allSessions = [...ccSessions, ...codexSessions];

      allEvents = allSessions.flatMap(s => s.events);
      spinner.stop();
    }

    if (allEvents.length === 0) {
      console.log(chalk.yellow('\n  No events found.'));
      console.log(chalk.dim('  Run some AI agent sessions, then try again.\n'));
      return;
    }

    // Classify
    const classified = classifyEvents(allEvents);
    const installEvents = classified.filter(e => e.isInstall);

    // Build chains
    const chains = buildChains(classified);
    const chainStats = getChainStats(chains);

    // Score risks
    const riskAssessments = scoreRisks(classified);
    const riskStats = getRiskStats(riskAssessments);

    // Classification distribution
    const distribution: Record<DiscoveryType, number> = {
      TRAINING_RECALL: 0,
      CONTEXT_INHERITANCE: 0,
      REACTIVE_SEARCH: 0,
      PROACTIVE_SEARCH: 0,
      USER_DIRECTED: 0,
      UNKNOWN: 0,
    };
    for (const event of installEvents) {
      distribution[event.classification]++;
    }

    const alternativesNeverConsidered = installEvents.filter(
      e => !e.abandoned && e.alternatives.length === 0 && e.classification === 'TRAINING_RECALL',
    ).length;

    const report: AnalysisReport = {
      totalEvents: allEvents.length,
      installEvents,
      classificationDistribution: distribution,
      riskAssessments,
      riskStats,
      chains: opts.chains ? chains : undefined,
      chainStats,
      alternativesNeverConsidered,
    };

    // Output
    if (opts.format === 'json') {
      console.log(formatJsonReport(report));
    } else {
      console.log(formatTerminalReport(report));
      if (opts.chains) {
        console.log(formatChains(chains));
      }
    }

    // Push if enabled
    if (config?.privacy?.shareAnonymousData) {
      const result = await pushEvents(classified, config);
      if (result.success) {
        console.log(chalk.dim(`  Pushed ${result.count} anonymized events to sightglass.dev`));
      }
    }
  });

// ── Helpers ──

function parseSinceDate(since?: string): Date | null {
  if (!since) return null;

  if (since === 'today') {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  if (since === 'yesterday') {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  const parsed = new Date(since);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function classificationColor(type: string): typeof chalk {
  const colors: Record<string, typeof chalk> = {
    TRAINING_RECALL: chalk.hex('#7c7cf0'),
    CONTEXT_INHERITANCE: chalk.hex('#c9893a'),
    REACTIVE_SEARCH: chalk.hex('#c94a4a'),
    PROACTIVE_SEARCH: chalk.hex('#3b8a6e'),
    USER_DIRECTED: chalk.hex('#3b8a6e'),
  };
  return colors[type] ?? chalk.dim;
}


// ── sightglass hook ──

const hookCmd = program
  .command("hook")
  .description("Manage Claude Code hooks for real-time interception");

hookCmd
  .command("install")
  .description("Install the Sightglass PreToolUse hook into Claude Code")
  .action(async () => {
    // Copy hook from package dist to canonical location
    const packageHookPath = path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      "hooks",
      "pretooluse.js",
    );
    const canonicalHookDir = path.join(os.homedir(), ".sightglass", "hooks");
    const canonicalHookPath = path.join(canonicalHookDir, "pretooluse.js");
    
    fs.mkdirSync(canonicalHookDir, { recursive: true });
    
    if (fs.existsSync(packageHookPath)) {
      fs.copyFileSync(packageHookPath, canonicalHookPath);
    } else {
      // Maybe already installed at canonical path
      if (!fs.existsSync(canonicalHookPath)) {
        console.log(chalk.red("  Hook script not found. Run: sightglass setup"));
        process.exit(1);
      }
    }
    
    const hookScriptPath = canonicalHookPath;

    // Find or create .claude/settings.json
    const settingsDir = path.join(os.homedir(), ".claude");
    const settingsPath = path.join(settingsDir, "settings.json");
    fs.mkdirSync(settingsDir, { recursive: true });

    let settings: Record<string, unknown> = {};
    if (fs.existsSync(settingsPath)) {
      try {
        settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      } catch {
        // corrupted — start fresh
      }
    }

    // Add PreToolUse hook
    if (!settings.hooks) {
      settings.hooks = {};
    }
    const hooks = settings.hooks as Record<string, unknown>;
    if (!hooks.PreToolUse) {
      hooks.PreToolUse = [];
    }
    const preToolUse = hooks.PreToolUse as Array<Record<string, string>>;

    // Check if already installed
    const alreadyInstalled = preToolUse.some(
      (h) => h.type === "command" && h.command?.includes("sightglass"),
    );

    if (alreadyInstalled) {
      console.log(chalk.yellow("  Sightglass hook already installed."));
      return;
    }

    preToolUse.push({
      type: "command",
      command: `node ${hookScriptPath}`,
    });

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    console.log(chalk.green("  ✓") + " Installed PreToolUse hook in Claude Code");
    console.log(chalk.dim("  Settings: " + settingsPath));
    console.log("");
    console.log(chalk.dim("  The hook will evaluate package installs in real-time."));
    console.log(
      chalk.dim("  It checks against the Sightglass API + local known issues DB."),
    );
    console.log("");
  });

hookCmd
  .command("uninstall")
  .description("Remove the Sightglass PreToolUse hook from Claude Code")
  .action(async () => {
    const settingsPath = path.join(os.homedir(), ".claude", "settings.json");
    if (!fs.existsSync(settingsPath)) {
      console.log(chalk.yellow("  No Claude Code settings found."));
      return;
    }

    let settings: Record<string, unknown>;
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    } catch {
      console.log(chalk.red("  Could not parse settings.json"));
      process.exit(1);
    }

    const hooks = settings.hooks as Record<string, unknown> | undefined;
    if (!hooks?.PreToolUse) {
      console.log(chalk.yellow("  No PreToolUse hooks found."));
      return;
    }

    const preToolUse = hooks.PreToolUse as Array<Record<string, string>>;
    const filtered = preToolUse.filter(
      (h) => !(h.type === "command" && h.command?.includes("sightglass")),
    );

    if (filtered.length === preToolUse.length) {
      console.log(chalk.yellow("  Sightglass hook not found in settings."));
      return;
    }

    hooks.PreToolUse = filtered;
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    console.log(chalk.green("  ✓") + " Removed Sightglass PreToolUse hook");
  });

hookCmd
  .command("status")
  .description("Check if the Sightglass hook is installed")
  .action(async () => {
    const settingsPath = path.join(os.homedir(), ".claude", "settings.json");
    if (!fs.existsSync(settingsPath)) {
      console.log(chalk.dim("  Not installed — no Claude Code settings found."));
      return;
    }

    let settings: Record<string, unknown>;
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    } catch {
      console.log(chalk.red("  Could not parse settings.json"));
      return;
    }

    const hooks = settings.hooks as Record<string, unknown> | undefined;
    const preToolUse = (hooks?.PreToolUse ?? []) as Array<Record<string, string>>;
    const installed = preToolUse.some(
      (h) => h.type === "command" && h.command?.includes("sightglass"),
    );

    if (installed) {
      console.log(chalk.green("  ✓") + " Sightglass PreToolUse hook is installed");
    } else {
      console.log(chalk.dim("  ✗ Sightglass PreToolUse hook is not installed"));
      console.log(chalk.dim("    Run: sightglass hook install"));
    }
  });


program.parse();
