import { v4 as uuid } from 'uuid';
import type { ClassifiedEvent, DecisionChain } from '../classifiers/types.js';

/**
 * Build decision chains from classified events.
 * Groups related events (search → install, failure → retry) into chains.
 */
export function buildChains(events: ClassifiedEvent[]): DecisionChain[] {
  const chains: DecisionChain[] = [];
  const installEvents = events.filter(e => e.isInstall);
  const used = new Set<string>();
  let chainOrder = 0;

  for (const installEvent of installEvents) {
    if (used.has(installEvent.id)) continue;

    const chain = buildChainForInstall(installEvent, events, used);
    chain.chainOrder = ++chainOrder;
    chains.push(chain);
  }

  return chains;
}

function buildChainForInstall(
  rootInstall: ClassifiedEvent,
  allEvents: ClassifiedEvent[],
  used: Set<string>,
): DecisionChain {
  used.add(rootInstall.id);

  const sessionEvents = allEvents.filter(e => e.sessionId === rootInstall.sessionId);
  const rootIndex = sessionEvents.findIndex(e => e.id === rootInstall.id);

  const searchEvents: ClassifiedEvent[] = [];
  const abandonedChoices: ClassifiedEvent[] = [];
  const subDecisions: ClassifiedEvent[] = [];

  // Scan backwards from root install for related events
  const lookbackSize = 10;
  for (let i = rootIndex - 1; i >= Math.max(0, rootIndex - lookbackSize); i--) {
    const event = sessionEvents[i];
    if (used.has(event.id)) continue;

    if (event.isSearch) {
      searchEvents.push(event);
      used.add(event.id);
    } else if (event.isInstall && event.abandoned) {
      abandonedChoices.push(event);
      used.add(event.id);
    }
  }

  // Scan forward for sub-decisions and (if root is abandoned) for searches + replacement
  const lookaheadSize = 10;
  const rootTime = new Date(rootInstall.timestamp).getTime();
  for (let i = rootIndex + 1; i < Math.min(sessionEvents.length, rootIndex + lookaheadSize); i++) {
    const event = sessionEvents[i];
    if (used.has(event.id)) continue;

    if (event.isSearch) {
      // Include forward searches in the chain (especially for abandoned → search → install flows)
      searchEvents.push(event);
      used.add(event.id);
    } else if (event.isInstall) {
      const timeDiff = new Date(event.timestamp).getTime() - rootTime;
      if (rootInstall.abandoned || timeDiff < 30_000) {
        subDecisions.push(event);
        used.add(event.id);
      }
    }
  }

  // Final selection: if root is abandoned, pick the first non-abandoned sub-decision
  const finalSelection = rootInstall.abandoned
    ? (subDecisions.find(e => !e.abandoned) ?? rootInstall)
    : rootInstall;

  return {
    id: uuid(),
    sessionId: rootInstall.sessionId,
    rootEvent: rootInstall,
    subDecisions,
    searchEvents,
    abandonedChoices,
    finalSelection,
    chainOrder: 0,
  };
}

/** Get aggregate stats from decision chains */
export function getChainStats(chains: DecisionChain[]): ChainStats {
  const totalChains = chains.length;
  const withSearch = chains.filter(c => c.searchEvents.length > 0).length;
  const withAbandoned = chains.filter(c => c.abandonedChoices.length > 0).length;
  const avgSubDecisions = totalChains > 0
    ? chains.reduce((sum, c) => sum + c.subDecisions.length, 0) / totalChains
    : 0;

  return {
    totalChains,
    chainsWithSearch: withSearch,
    chainsWithAbandoned: withAbandoned,
    averageSubDecisions: Math.round(avgSubDecisions * 10) / 10,
    noDeliberationRate: totalChains > 0
      ? Math.round(((totalChains - withSearch) / totalChains) * 100)
      : 0,
  };
}

export interface ChainStats {
  totalChains: number;
  chainsWithSearch: number;
  chainsWithAbandoned: number;
  averageSubDecisions: number;
  noDeliberationRate: number;
}
