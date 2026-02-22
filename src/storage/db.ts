import Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import { MIGRATIONS } from './migrations.js';
import type { RawEvent } from '../collectors/types.js';
import type { ClassifiedEvent, RiskAssessment } from '../classifiers/types.js';

export class SightglassDB {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  /** Run all pending migrations */
  init(): void {
    const currentVersion = this.getSchemaVersion();
    for (const migration of MIGRATIONS) {
      if (migration.version > currentVersion) {
        this.db.exec(migration.sql);
      }
    }
  }

  private getSchemaVersion(): number {
    try {
      const row = this.db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'"
      ).get() as { name: string } | undefined;
      if (!row) return 0;
      const version = this.db.prepare(
        'SELECT MAX(version) as version FROM schema_version'
      ).get() as { version: number } | undefined;
      return version?.version ?? 0;
    } catch {
      return 0;
    }
  }

  // ── Sessions ──

  insertSession(session: {
    id: string;
    agent: string;
    startedAt: string;
    projectPath?: string;
  }): void {
    this.db.prepare(`
      INSERT INTO sessions (id, agent, started_at, project_path)
      VALUES (?, ?, ?, ?)
    `).run(session.id, session.agent, session.startedAt, session.projectPath ?? null);
  }

  updateSessionEnd(sessionId: string, endedAt: string, eventCount: number): void {
    this.db.prepare(`
      UPDATE sessions SET ended_at = ?, event_count = ? WHERE id = ?
    `).run(endedAt, eventCount, sessionId);
  }

  getSession(id: string): SessionRow | undefined {
    return this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
  }

  getRecentSessions(limit = 10): SessionRow[] {
    return this.db.prepare(
      'SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?'
    ).all(limit) as SessionRow[];
  }

  // ── Events ──

  insertEvent(event: RawEvent): void {
    this.db.prepare(`
      INSERT INTO events (id, session_id, timestamp, agent, action, raw, result, exit_code, cwd)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id, event.sessionId, event.timestamp, event.agent,
      event.action, event.raw, event.result ?? null,
      event.exitCode ?? null, event.cwd ?? null,
    );
  }

  updateEventClassification(event: ClassifiedEvent): void {
    this.db.prepare(`
      UPDATE events SET
        classification = ?,
        classification_confidence = ?,
        package_name = ?,
        package_version = ?,
        package_manager = ?,
        is_install = ?,
        is_search = ?,
        abandoned = ?,
        alternatives = ?,
        chain_id = ?,
        chain_order = ?
      WHERE id = ?
    `).run(
      event.classification,
      event.confidence,
      event.packageName ?? null,
      event.packageVersion ?? null,
      event.packageManager ?? null,
      event.isInstall ? 1 : 0,
      event.isSearch ? 1 : 0,
      event.abandoned ? 1 : 0,
      event.alternatives.length > 0 ? JSON.stringify(event.alternatives) : null,
      null, null,
      event.id,
    );
  }

  getEventsBySession(sessionId: string): EventRow[] {
    return this.db.prepare(
      'SELECT * FROM events WHERE session_id = ? ORDER BY timestamp ASC'
    ).all(sessionId) as EventRow[];
  }

  getInstallEvents(since?: string): EventRow[] {
    if (since) {
      return this.db.prepare(
        'SELECT * FROM events WHERE is_install = 1 AND timestamp >= ? ORDER BY timestamp ASC'
      ).all(since) as EventRow[];
    }
    return this.db.prepare(
      'SELECT * FROM events WHERE is_install = 1 ORDER BY timestamp ASC'
    ).all() as EventRow[];
  }

  getAllEvents(since?: string): EventRow[] {
    if (since) {
      return this.db.prepare(
        'SELECT * FROM events WHERE timestamp >= ? ORDER BY timestamp ASC'
      ).all(since) as EventRow[];
    }
    return this.db.prepare(
      'SELECT * FROM events ORDER BY timestamp ASC'
    ).all() as EventRow[];
  }

  // ── Risk Assessments ──

  insertRiskAssessment(assessment: RiskAssessment & { eventId?: string }): void {
    this.db.prepare(`
      INSERT INTO risk_assessments (id, event_id, package_name, package_version, risk_level, factors)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      uuid(),
      assessment.eventId ?? null,
      assessment.packageName,
      assessment.packageVersion,
      assessment.riskLevel,
      JSON.stringify(assessment.factors),
    );
  }

  getRiskAssessments(): RiskAssessmentRow[] {
    return this.db.prepare(
      'SELECT * FROM risk_assessments ORDER BY risk_level DESC'
    ).all() as RiskAssessmentRow[];
  }

  // ── Bulk operations ──

  insertEventsBatch(events: RawEvent[]): void {
    const insert = this.db.prepare(`
      INSERT INTO events (id, session_id, timestamp, agent, action, raw, result, exit_code, cwd)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const tx = this.db.transaction((evts: RawEvent[]) => {
      for (const e of evts) {
        insert.run(e.id, e.sessionId, e.timestamp, e.agent, e.action, e.raw,
          e.result ?? null, e.exitCode ?? null, e.cwd ?? null);
      }
    });
    tx(events);
  }

  close(): void {
    this.db.close();
  }
}

// ── Row types (SQLite returns) ──

export interface SessionRow {
  id: string;
  agent: string;
  started_at: string;
  ended_at: string | null;
  project_path: string | null;
  event_count: number;
}

export interface EventRow {
  id: string;
  session_id: string;
  timestamp: string;
  agent: string;
  action: string;
  raw: string;
  result: string | null;
  exit_code: number | null;
  cwd: string | null;
  classification: string | null;
  classification_confidence: number | null;
  package_name: string | null;
  package_version: string | null;
  package_manager: string | null;
  is_install: number;
  is_search: number;
  abandoned: number;
  alternatives: string | null;
  chain_id: string | null;
  chain_order: number | null;
}

export interface RiskAssessmentRow {
  id: string;
  event_id: string | null;
  package_name: string;
  package_version: string | null;
  risk_level: string;
  factors: string;
}
