/** SQL schema for local Sightglass SQLite database */

export const MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        agent TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        project_path TEXT,
        event_count INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        timestamp TEXT NOT NULL,
        agent TEXT NOT NULL,
        action TEXT NOT NULL,
        raw TEXT NOT NULL,
        result TEXT,
        exit_code INTEGER,
        cwd TEXT,
        classification TEXT,
        classification_confidence REAL,
        package_name TEXT,
        package_version TEXT,
        package_manager TEXT,
        is_install INTEGER DEFAULT 0,
        is_search INTEGER DEFAULT 0,
        abandoned INTEGER DEFAULT 0,
        alternatives TEXT,
        chain_id TEXT,
        chain_order INTEGER
      );

      CREATE TABLE IF NOT EXISTS risk_assessments (
        id TEXT PRIMARY KEY,
        event_id TEXT REFERENCES events(id),
        package_name TEXT NOT NULL,
        package_version TEXT,
        risk_level TEXT NOT NULL,
        factors TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY
      );

      CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
      CREATE INDEX IF NOT EXISTS idx_events_classification ON events(classification);
      CREATE INDEX IF NOT EXISTS idx_events_package ON events(package_name);
      CREATE INDEX IF NOT EXISTS idx_events_chain ON events(chain_id);
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);

      INSERT OR IGNORE INTO schema_version (version) VALUES (1);
    `,
  },
];
