import { describe, it, expect } from 'vitest';
import { buildChains, getChainStats } from '../../src/analyzers/chain-builder.js';
import { classifyEvents } from '../../src/classifiers/pattern-classifier.js';
import { FIXTURE_SESSION_REST_API, FIXTURE_SESSION_PDF } from '../fixtures/sessions.js';

describe('buildChains — REST API session', () => {
  const classified = classifyEvents(FIXTURE_SESSION_REST_API.events);
  const chains = buildChains(classified);

  it('builds multiple decision chains', () => {
    expect(chains.length).toBeGreaterThan(0);
  });

  it('assigns sequential chain order', () => {
    for (let i = 0; i < chains.length; i++) {
      expect(chains[i].chainOrder).toBe(i + 1);
    }
  });

  it('each chain has a final selection', () => {
    for (const chain of chains) {
      expect(chain.finalSelection).toBeDefined();
      expect(chain.finalSelection.isInstall).toBe(true);
    }
  });

  it('chains share the same session ID', () => {
    for (const chain of chains) {
      expect(chain.sessionId).toBe('test-session-001');
    }
  });
});

describe('buildChains — PDF session', () => {
  const classified = classifyEvents(FIXTURE_SESSION_PDF.events);
  const chains = buildChains(classified);

  it('builds chains with abandoned choices', () => {
    const chainsWithAbandoned = chains.filter(c => c.abandonedChoices.length > 0);
    // At least one chain should have the abandoned puppeteer install
    expect(chainsWithAbandoned.length + chains.filter(c => c.rootEvent.abandoned).length).toBeGreaterThan(0);
  });

  it('links searches to install chains', () => {
    const chainsWithSearch = chains.filter(c => c.searchEvents.length > 0);
    expect(chainsWithSearch.length).toBeGreaterThan(0);
  });
});

describe('getChainStats', () => {
  const classified = classifyEvents(FIXTURE_SESSION_REST_API.events);
  const chains = buildChains(classified);
  const stats = getChainStats(chains);

  it('calculates total chains', () => {
    expect(stats.totalChains).toBe(chains.length);
  });

  it('calculates no-deliberation rate', () => {
    expect(stats.noDeliberationRate).toBeGreaterThanOrEqual(0);
    expect(stats.noDeliberationRate).toBeLessThanOrEqual(100);
  });

  it('reports average sub-decisions', () => {
    expect(typeof stats.averageSubDecisions).toBe('number');
  });
});
