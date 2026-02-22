import { describe, it, expect } from 'vitest';
import { classifyEvents, parseInstallCommand } from '../../src/classifiers/pattern-classifier.js';
import { FIXTURE_SESSION_REST_API, FIXTURE_SESSION_PDF } from '../fixtures/sessions.js';

describe('parseInstallCommand', () => {
  it('parses npm install with single package', () => {
    const result = parseInstallCommand('npm install express');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('express');
    expect(result[0].manager).toBe('npm');
  });

  it('parses npm install with version', () => {
    const result = parseInstallCommand('npm install express@4.21.0');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('express');
    expect(result[0].version).toBe('4.21.0');
  });

  it('parses npm install with multiple packages', () => {
    const result = parseInstallCommand('npm install cors helmet dotenv');
    expect(result).toHaveLength(3);
    expect(result.map(r => r.name)).toEqual(['cors', 'helmet', 'dotenv']);
  });

  it('parses npm install with --save-dev flag', () => {
    const result = parseInstallCommand('npm install --save-dev typescript');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('typescript');
  });

  it('parses npm i shorthand', () => {
    const result = parseInstallCommand('npm i express');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('express');
  });

  it('parses scoped npm packages', () => {
    const result = parseInstallCommand('npm install @types/express');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('@types/express');
  });

  it('parses yarn add', () => {
    const result = parseInstallCommand('yarn add react');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('react');
    expect(result[0].manager).toBe('npm');
  });

  it('parses pip install', () => {
    const result = parseInstallCommand('pip install flask');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('flask');
    expect(result[0].manager).toBe('pip');
  });

  it('parses cargo add', () => {
    const result = parseInstallCommand('cargo add serde');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('serde');
    expect(result[0].manager).toBe('cargo');
  });

  it('parses install with -D flag', () => {
    const result = parseInstallCommand('npm install -D ts-node typescript');
    expect(result).toHaveLength(2);
    expect(result.map(r => r.name)).toEqual(['ts-node', 'typescript']);
  });

  it('returns empty for non-install commands', () => {
    const result = parseInstallCommand('git status');
    expect(result).toHaveLength(0);
  });
});

describe('classifyEvents — REST API session', () => {
  const classified = classifyEvents(FIXTURE_SESSION_REST_API.events);
  const installs = classified.filter(e => e.isInstall);

  it('identifies all install events', () => {
    expect(installs.length).toBe(7);
  });

  it('classifies express as TRAINING_RECALL', () => {
    const express = installs.find(e => e.packageName === 'express');
    expect(express).toBeDefined();
    expect(express!.classification).toBe('TRAINING_RECALL');
    expect(express!.confidence).toBeGreaterThanOrEqual(70);
  });

  it('classifies jsonwebtoken as TRAINING_RECALL', () => {
    const jwt = installs.find(e => e.packageName === 'jsonwebtoken');
    expect(jwt).toBeDefined();
    expect(jwt!.classification).toBe('TRAINING_RECALL');
  });

  it('classifies cors as TRAINING_RECALL', () => {
    const cors = installs.find(e => e.packageName === 'cors');
    expect(cors).toBeDefined();
    expect(cors!.classification).toBe('TRAINING_RECALL');
  });

  it('classifies zod as REACTIVE_SEARCH (search after failure)', () => {
    const zod = installs.find(e => e.packageName === 'zod');
    expect(zod).toBeDefined();
    expect(zod!.classification).toBe('REACTIVE_SEARCH');
  });

  it('assigns confidence scores to all installs', () => {
    for (const install of installs) {
      expect(install.confidence).toBeGreaterThan(0);
      expect(install.confidence).toBeLessThanOrEqual(100);
    }
  });

  it('extracts package names for all installs', () => {
    for (const install of installs) {
      expect(install.packageName).toBeDefined();
      expect(install.packageName!.length).toBeGreaterThan(0);
    }
  });

  it('sets packageManager to npm for all installs', () => {
    for (const install of installs) {
      expect(install.packageManager).toBe('npm');
    }
  });
});

describe('classifyEvents — PDF session', () => {
  const classified = classifyEvents(FIXTURE_SESSION_PDF.events);
  const installs = classified.filter(e => e.isInstall);

  it('identifies 2 install events', () => {
    expect(installs.length).toBe(2);
  });

  it('marks puppeteer install as abandoned (failed)', () => {
    const puppeteer = installs.find(e => e.packageName === 'puppeteer');
    expect(puppeteer).toBeDefined();
    expect(puppeteer!.abandoned).toBe(true);
  });

  it('classifies pdfkit as REACTIVE_SEARCH', () => {
    const pdfkit = installs.find(e => e.packageName === 'pdfkit');
    expect(pdfkit).toBeDefined();
    expect(pdfkit!.classification).toBe('REACTIVE_SEARCH');
  });

  it('identifies search events', () => {
    const searches = classified.filter(e => e.isSearch);
    expect(searches.length).toBeGreaterThanOrEqual(1);
  });
});
