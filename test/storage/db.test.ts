import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SightglassDB } from '../../src/storage/db.js';
import { v4 as uuid } from 'uuid';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('SightglassDB', () => {
  let db: SightglassDB;
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `sightglass-test-${uuid()}.db`);
    db = new SightglassDB(dbPath);
    db.init();
  });

  afterEach(() => {
    db.close();
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
  });

  describe('sessions', () => {
    it('inserts and retrieves a session', () => {
      const id = uuid();
      db.insertSession({
        id,
        agent: 'claude-code',
        startedAt: '2026-02-20T14:30:00.000Z',
        projectPath: '/tmp/test-project',
      });

      const session = db.getSession(id);
      expect(session).toBeDefined();
      expect(session!.id).toBe(id);
      expect(session!.agent).toBe('claude-code');
      expect(session!.project_path).toBe('/tmp/test-project');
    });

    it('updates session end time', () => {
      const id = uuid();
      db.insertSession({
        id,
        agent: 'claude-code',
        startedAt: '2026-02-20T14:30:00.000Z',
      });

      db.updateSessionEnd(id, '2026-02-20T14:45:00.000Z', 23);

      const session = db.getSession(id);
      expect(session!.ended_at).toBe('2026-02-20T14:45:00.000Z');
      expect(session!.event_count).toBe(23);
    });

    it('lists recent sessions', () => {
      for (let i = 0; i < 5; i++) {
        db.insertSession({
          id: uuid(),
          agent: 'claude-code',
          startedAt: `2026-02-2${i}T14:30:00.000Z`,
        });
      }

      const sessions = db.getRecentSessions(3);
      expect(sessions).toHaveLength(3);
      // Most recent first
      expect(sessions[0].started_at > sessions[1].started_at).toBe(true);
    });
  });

  describe('events', () => {
    const sessionId = uuid();

    beforeEach(() => {
      db.insertSession({
        id: sessionId,
        agent: 'claude-code',
        startedAt: '2026-02-20T14:30:00.000Z',
      });
    });

    it('inserts and retrieves events', () => {
      const eventId = uuid();
      db.insertEvent({
        id: eventId,
        sessionId,
        timestamp: '2026-02-20T14:30:05.000Z',
        agent: 'claude-code',
        action: 'bash',
        raw: 'npm install express',
        result: 'added 64 packages',
        exitCode: 0,
      });

      const events = db.getEventsBySession(sessionId);
      expect(events).toHaveLength(1);
      expect(events[0].id).toBe(eventId);
      expect(events[0].raw).toBe('npm install express');
      expect(events[0].exit_code).toBe(0);
    });

    it('batch inserts events', () => {
      const events = Array.from({ length: 10 }, (_, i) => ({
        id: uuid(),
        sessionId,
        timestamp: `2026-02-20T14:30:${String(i).padStart(2, '0')}.000Z`,
        agent: 'claude-code' as const,
        action: 'bash' as const,
        raw: `npm install package-${i}`,
        exitCode: 0,
      }));

      db.insertEventsBatch(events);

      const retrieved = db.getEventsBySession(sessionId);
      expect(retrieved).toHaveLength(10);
    });

    it('retrieves events ordered by timestamp', () => {
      const events = [
        { id: uuid(), sessionId, timestamp: '2026-02-20T14:30:10.000Z', agent: 'claude-code' as const, action: 'bash' as const, raw: 'second' },
        { id: uuid(), sessionId, timestamp: '2026-02-20T14:30:05.000Z', agent: 'claude-code' as const, action: 'bash' as const, raw: 'first' },
      ];
      db.insertEventsBatch(events);

      const retrieved = db.getEventsBySession(sessionId);
      expect(retrieved[0].raw).toBe('first');
      expect(retrieved[1].raw).toBe('second');
    });

    it('filters install events', () => {
      const eventId = uuid();
      db.insertEvent({
        id: eventId,
        sessionId,
        timestamp: '2026-02-20T14:30:05.000Z',
        agent: 'claude-code',
        action: 'bash',
        raw: 'npm install express',
        exitCode: 0,
      });

      // Manually update classification to mark as install
      db.updateEventClassification({
        id: eventId,
        sessionId,
        timestamp: '2026-02-20T14:30:05.000Z',
        agent: 'claude-code',
        action: 'bash',
        raw: 'npm install express',
        exitCode: 0,
        classification: 'TRAINING_RECALL',
        confidence: 90,
        packageName: 'express',
        packageManager: 'npm',
        isInstall: true,
        isSearch: false,
        abandoned: false,
        alternatives: [],
      });

      const installs = db.getInstallEvents();
      expect(installs).toHaveLength(1);
      expect(installs[0].package_name).toBe('express');
    });
  });

  describe('risk assessments', () => {
    it('inserts and retrieves risk assessments', () => {
      db.insertRiskAssessment({
        packageName: 'jsonwebtoken',
        packageVersion: '9.0.0',
        riskLevel: 'high',
        factors: [{
          type: 'vulnerability',
          severity: 'error',
          detail: 'CVE-2024-33663',
        }],
      });

      const assessments = db.getRiskAssessments();
      expect(assessments).toHaveLength(1);
      expect(assessments[0].package_name).toBe('jsonwebtoken');
      expect(assessments[0].risk_level).toBe('high');

      const factors = JSON.parse(assessments[0].factors);
      expect(factors).toHaveLength(1);
      expect(factors[0].type).toBe('vulnerability');
    });
  });
});
