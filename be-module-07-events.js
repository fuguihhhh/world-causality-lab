/* ===== MODULE 7 — ISSUES, EVENTS & CONSEQUENCE CHAINS — INLINE INTEGRATED ===== */
/*
 * Border Epoch — Module 7
 * Issues, Events and Emergent Consequence Stories
 * Time scale: 1 turn = 1 year.
 *
 * Module 7 does NOT calculate production, migration, diplomacy,
 * construction, trade or AI strategy. It reads structured outputs from
 * Modules 2–6 and coordinates player-facing situations and decisions.
 */

const IssuesEvents = (() => {
  const VERSION = "1.2.0";

  const PRESENTATION = Object.freeze({
    FEED: 1,
    SITUATION: 2,
    DECISION: 3,
    MAJOR: 4,
  });

  const CAUSAL_EVIDENCE = Object.freeze({
    SOURCE_CONFIRMED: "SOURCE_CONFIRMED",
    MODEL_SUPPORTED: "MODEL_SUPPORTED",
    CANDIDATE: "CANDIDATE",
  });

  const SEVERITY_LABELS = Object.freeze([
    { max: 0.24, label: "minor" },
    { max: 0.49, label: "noticeable" },
    { max: 0.74, label: "serious" },
    { max: 1.00, label: "critical" },
  ]);

  const DEFAULTS = Object.freeze({
    maxSituationCards: 12,
    feedRetentionTurns: 8,
    historyLimit: 500,
    maxQueueSize: 30,
    issueResolveThreshold: 0.08,
    issueReturnThreshold: 0.12,
    eventRetriggerSeverityDelta: 0.15,
    storyRecentTurns: 12,
    storyMinimumNodes: 2,
    defaultMaxCausalLagTurns: 12,
    candidateRelationMaxTurns: 12,
  });

  const state = {
    initialized: false,
    config: { ...DEFAULTS },
    adapters: {},
    issueIndex: new Map(),
    eventQueue: [],
    activeEvent: null,
    consequences: [],
    cooldowns: new Map(),
    eventMemory: new Map(),
    feed: [],
    history: [],
    flags: {},
    causalGraph: { nodes: new Map(), edges: new Map() },
    provenanceLedger: {
      facts: new Map(),
      claims: new Map(),
      candidates: new Map(),
      rejectedClaims: [],
    },
    storyClusters: new Map(),
    debug: {
      triggerLog: [],
      consequenceLog: [],
      adapterWarnings: [],
      causalValidationLog: [],
    },
  };

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));
  const nowTurn = (gameState) => Number(gameState?.turn ?? 0);
  const safeArray = (v) => (Array.isArray(v) ? v : []);
  const round = (v, digits = 1) => {
    const p = 10 ** digits;
    return Math.round((Number(v) || 0) * p) / p;
  };
  const deepClone = (obj) => {
    if (typeof structuredClone === "function") return structuredClone(obj);
    return JSON.parse(JSON.stringify(obj));
  };
  const unique = (arr) => [...new Set(arr.filter(Boolean))];

  function getSeverityLabel(severity) {
    const s = clamp01(severity);
    return SEVERITY_LABELS.find((x) => s <= x.max)?.label ?? "critical";
  }

  function presentationFromSeverity(issue) {
    const s = clamp01(issue.severity);
    if (issue.forcePresentationLevel) return issue.forcePresentationLevel;
    if (s < 0.25) return PRESENTATION.FEED;
    if (s < 0.60) return PRESENTATION.SITUATION;
    if (s < 0.85) return PRESENTATION.DECISION;
    return PRESENTATION.MAJOR;
  }

  function issueKey(raw) {
    if (raw.id) return String(raw.id);
    return [raw.type, raw.locationId || raw.regionId || raw.countryId || "global", raw.counterpartyId || ""].join(":");
  }

  function eventKey(eventId, locationId = "global") {
    return `${eventId}:${locationId || "global"}`;
  }

  function recordHistory(gameState, entry) {
    const item = {
      turn: nowTurn(gameState),
      timestamp: nowTurn(gameState),
      ...deepClone(entry),
    };
    state.history.push(item);
    if (state.history.length > state.config.historyLimit) {
      state.history.splice(0, state.history.length - state.config.historyLimit);
    }
    return item;
  }

  function addFeed(gameState, item) {
    const feedItem = {
      id: item.id || `feed_${nowTurn(gameState)}_${hashString(JSON.stringify([item.type || "feed", item.issueId || "", item.title || "", state.feed.length]))}`,
      turn: nowTurn(gameState),
      level: PRESENTATION.FEED,
      ...deepClone(item),
    };
    state.feed.push(feedItem);
    const minTurn = nowTurn(gameState) - state.config.feedRetentionTurns;
    state.feed = state.feed.filter((x) => x.turn >= minTurn);
    return feedItem;
  }

  function getFlag(path, fallback = undefined) {
    const parts = String(path).split(".");
    let cursor = state.flags;
    for (const p of parts) {
      if (!cursor || typeof cursor !== "object" || !(p in cursor)) return fallback;
      cursor = cursor[p];
    }
    return cursor;
  }

  function setFlag(path, value) {
    const parts = String(path).split(".");
    let cursor = state.flags;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (!cursor[p] || typeof cursor[p] !== "object") cursor[p] = {};
      cursor = cursor[p];
    }
    cursor[parts.at(-1)] = value;
    return value;
  }

  function warnAdapter(message, data = null) {
    state.debug.adapterWarnings.push({ message, data, timestamp: state.debug.adapterWarnings.length });
    if (state.debug.adapterWarnings.length > 100) state.debug.adapterWarnings.shift();
  }

  // ---------------------------------------------------------------------------
  // Adapter layer
  // ---------------------------------------------------------------------------
  // Expected adapter signatures are documented at the bottom of this file.

  async function callAdapter(name, payload, gameState) {
    const fn = state.adapters?.[name];
    if (typeof fn !== "function") {
      warnAdapter(`Missing Module 7 adapter: ${name}`, payload);
      return { ok: false, reason: `Missing adapter: ${name}` };
    }
    const result = await fn(payload, gameState);
    return result ?? { ok: true };
  }

  // ---------------------------------------------------------------------------
  // Issue collection and normalization
  // ---------------------------------------------------------------------------

  const SUPPORTED_ISSUE_TYPES = new Set([
    // Module 3
    "TRANSPORT_BOTTLENECK",
    "POWER_SHORTAGE",
    "INPUT_SHORTAGE",
    "FISCAL_DEFICIT",
    "HIGH_DEBT",
    // Module 4
    "HOUSING_PRESSURE",
    "HIGH_UNEMPLOYMENT",
    "LABOR_SHORTAGE",
    "REGIONAL_DECLINE",
    "REGIONAL_INEQUALITY",
    "LOW_LIVING_STANDARD",
    // Module 5
    "TRADE_DEPENDENCE",
    "IMPORT_SHORTAGE",
    "EXPORT_CONCENTRATION",
    "DIPLOMATIC_TENSION",
    "INVESTMENT_DEPENDENCE",
    // Module 6
    "FOREIGN_COMPETITION",
    "AI_TRADE_OFFER",
    "AI_INVESTMENT_OFFER",
    "AI_COUNTEROFFER",
    "AI_ECONOMIC_PRESSURE",
    // Optional story signals / producers
    "COAL_DISCOVERY",
    "INDUSTRIAL_OPPORTUNITY",
    "MIGRATION_SURGE",
    "FACTORY_LAYOFFS",
    "SOUTHERN_DISSATISFACTION",
  ]);

  function normalizeIssue(raw, sourceModule, gameState) {
    if (!raw || !raw.type) return null;
    const key = issueKey(raw);
    const previous = state.issueIndex.get(key);
    const turn = nowTurn(gameState);
    const normalized = {
      id: key,
      type: raw.type,
      sourceModule: raw.sourceModule || sourceModule,
      locationId: raw.locationId || raw.regionId || null,
      regionId: raw.regionId || null,
      countryId: raw.countryId || null,
      counterpartyId: raw.counterpartyId || null,
      severity: clamp01(raw.severity),
      causes: unique(safeArray(raw.causes)),
      causedBy: deepClone(safeArray(raw.causedBy)),
      causalClaims: deepClone(safeArray(raw.causalClaims)),
      evidence: deepClone(raw.evidence || {}),
      affectedGroups: deepClone(safeArray(raw.affectedGroups)),
      metrics: deepClone(raw.metrics || {}),
      context: deepClone(raw.context || {}),
      createdTurn: previous?.createdTurn ?? raw.createdTurn ?? turn,
      lastUpdatedTurn: turn,
      active: raw.active !== false,
      acknowledged: previous?.acknowledged ?? !!raw.acknowledged,
      presentationLevel: raw.presentationLevel || null,
      tags: unique(safeArray(raw.tags)),
      sourceRef: raw.sourceRef || null,
      baseIssueId: key,
      episodeId: previous?.episodeId || raw.episodeId || null,
      episodeCounter: previous?.episodeCounter || 0,
      lastSeverity: previous?.severity ?? clamp01(raw.severity),
      resolvedTurn: null,
    };
    return normalized;
  }

  function ingestIssue(raw, sourceModule, gameState) {
    const issue = normalizeIssue(raw, sourceModule, gameState);
    if (!issue) return null;
    const previous = state.issueIndex.get(issue.id);

    if (!previous) {
      issue.episodeCounter = Number(issue.episodeCounter || 0) + 1;
      issue.episodeId = issue.episodeId || `${issue.id}::episode:${issue.episodeCounter}`;
    } else if (previous.active) {
      issue.createdTurn = previous.createdTurn;
      issue.lastSeverity = previous.severity;
      issue.acknowledged = previous.acknowledged;
      issue.episodeCounter = previous.episodeCounter || 1;
      issue.episodeId = previous.episodeId || `${issue.id}::episode:${issue.episodeCounter}`;
    } else {
      // A recurring issue becomes a new causal episode. This prevents a later
      // housing crisis, for example, from inheriting the causes of an old one.
      issue.createdTurn = nowTurn(gameState);
      issue.lastSeverity = 0;
      issue.acknowledged = false;
      issue.episodeCounter = Number(previous.episodeCounter || 1) + 1;
      issue.episodeId = `${issue.id}::episode:${issue.episodeCounter}`;
      for (const [key, memory] of state.eventMemory.entries()) {
        if (memory.issueId === issue.id) state.eventMemory.delete(key);
      }
    }

    state.issueIndex.set(issue.id, issue);
    return issue;
  }

  function collectIssues(gameState) {
    const turn = nowTurn(gameState);
    const seen = new Set();

    const sources = [
      ["economy", gameState?.modules?.economy?.issues || gameState?.economy?.issues || gameState?.module3?.issues],
      ["population", gameState?.modules?.population?.issues || gameState?.population?.issues || gameState?.module4?.issues],
      ["trade", gameState?.modules?.trade?.issues || gameState?.trade?.issues || gameState?.module5?.issues],
      ["ai", gameState?.modules?.ai?.issues || gameState?.ai?.issues || gameState?.module6?.issues],
      ["development", gameState?.modules?.development?.issues || gameState?.development?.issues || gameState?.module2?.issues],
      ["root", gameState?.issues],
    ];

    for (const [source, list] of sources) {
      for (const raw of safeArray(list)) {
        const issue = ingestIssue(raw, source, gameState);
        if (issue) seen.add(issue.id);
      }
    }

    // Optional adapter-based issue providers.
    if (typeof state.adapters.collectIssues === "function") {
      const extra = state.adapters.collectIssues(gameState) || [];
      for (const raw of safeArray(extra)) {
        const issue = ingestIssue(raw, raw.sourceModule || "adapter", gameState);
        if (issue) seen.add(issue.id);
      }
    }

    // Mark stale issues resolved if their producers stopped reporting them.
    for (const [id, issue] of state.issueIndex.entries()) {
      if (seen.has(id)) continue;
      if (!issue.active) continue;
      if (turn <= issue.lastUpdatedTurn) continue;
      issue.active = false;
      issue.resolvedTurn = turn;
      issue.severity = 0;
      issue.lastUpdatedTurn = turn;
      recordHistory(gameState, {
        type: "ISSUE_RESOLVED",
        issueId: id,
        issueType: issue.type,
        locationId: issue.locationId,
      });
    }

    return getActiveIssues();
  }

  function updateIssueSeverity(issueId, severity, patch = {}, gameState = null) {
    const issue = state.issueIndex.get(issueId);
    if (!issue) return null;
    issue.lastSeverity = issue.severity;
    issue.severity = clamp01(severity);
    Object.assign(issue, deepClone(patch));
    if (gameState) issue.lastUpdatedTurn = nowTurn(gameState);
    if (issue.severity <= state.config.issueResolveThreshold) {
      issue.active = false;
      if (gameState) issue.resolvedTurn = nowTurn(gameState);
    }
    return issue;
  }

  function getActiveIssues() {
    return [...state.issueIndex.values()].filter((x) => x.active);
  }

  // ---------------------------------------------------------------------------
  // World-data helpers for dynamic text
  // ---------------------------------------------------------------------------

  function cityName(gameState, id) {
    if (!id) return "the affected area";
    return (
      gameState?.cities?.[id]?.name ||
      gameState?.locations?.[id]?.name ||
      gameState?.regions?.[id]?.name ||
      id
    );
  }

  function countryName(gameState, id) {
    if (!id) return "the foreign country";
    return gameState?.countries?.[id]?.name || id;
  }

  function moneyLabel(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return `${round(n, 1)} Treasury`;
  }

  function pct(value, alreadyFraction = false) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const v = alreadyFraction ? n * 100 : n;
    return `${round(v, 1)}%`;
  }

  // ---------------------------------------------------------------------------
  // Event templates
  // ---------------------------------------------------------------------------

  const EVENT_DEFS = {
    coal_discovery: {
      id: "coal_discovery",
      title: "Coal Deposit Discovered",
      trigger: { issueType: "COAL_DISCOVERY", minimumSeverity: 0.25 },
      cooldownTurns: 99,
      basePriority: 70,
      presentationLevel: PRESENTATION.DECISION,
      descriptionBuilder(issue, gameState) {
        const place = cityName(gameState, issue.locationId);
        const reserve = issue.metrics?.estimatedReserve;
        return `${place} has confirmed a commercially significant coal deposit${reserve ? `, estimated at ${round(reserve, 0)} reserve units` : ""}. The deposit could support mining, industry and export growth, but development will require capital and infrastructure.`;
      },
      choices: [
        {
          id: "state_development",
          text: "Develop the mine with state funding",
          uncertainty: {
            certain: ["The government finances the mine."],
            expected: ["Asteria keeps greater control over coal output."],
            possible: ["Government debt may rise if returns are slow."],
          },
          effects: [
            { type: "adapter", adapter: "development.startProject", payload: { projectType: "COAL_MINE", funding: "state" } },
            { type: "flag", path: "coalDevelopmentMethod", value: "state" },
          ],
        },
        {
          id: "foreign_investment",
          text: "Accept foreign investment",
          uncertainty: {
            certain: ["The state carries less initial construction cost."],
            expected: ["The mine can open sooner if financing is approved."],
            possible: ["The investor may seek future access or control rights."],
          },
          effects: [
            { type: "adapter", adapter: "trade.acceptForeignInvestment", payload: { assetType: "COAL_MINE" } },
            { type: "flag", path: "coalDevelopmentMethod", value: "foreign" },
            { type: "flag", path: "meridianCoalInvestment", value: true, fromContext: "isMeridianInvestor" },
            {
              type: "consequence",
              consequence: {
                id: "foreign_mine_future_dispute",
                conditions: [
                  { type: "metric", path: "foreignOwnershipShare", op: ">", value: 0.5 },
                  { type: "relationship", countryId: "meridian", op: "<", value: 20 },
                ],
                resultEventId: "mine_control_dispute",
              },
            },
          ],
        },
        {
          id: "delay",
          text: "Delay development",
          uncertainty: {
            certain: ["No mine construction begins this year."],
            expected: ["Public finances remain less strained in the short term."],
            possible: ["Foreign buyers may look elsewhere for supply."],
          },
          effects: [{ type: "flag", path: "coalDevelopmentMethod", value: "delayed" }],
        },
      ],
    },

    transport_bottleneck: {
      id: "transport_bottleneck",
      title: "Coal Transport Bottleneck",
      trigger: { issueType: "TRANSPORT_BOTTLENECK", minimumSeverity: 0.55 },
      cooldownTurns: 4,
      basePriority: 62,
      presentationLevel: PRESENTATION.DECISION,
      descriptionBuilder(issue, gameState) {
        const place = cityName(gameState, issue.locationId);
        const output = issue.metrics?.freightDemand;
        const cap = issue.metrics?.transportCapacity;
        return `${place}'s freight network is no longer keeping pace with industrial output${output != null && cap != null ? `. Freight demand is ${round(output, 1)} while effective transport capacity is ${round(cap, 1)}` : ""}. Mines and factories are losing potential sales because goods cannot move fast enough.`;
      },
      choices: [
        {
          id: "build_railway",
          text: "Build or upgrade the railway",
          effects: [
            { type: "adapter", adapter: "development.startProject", payload: { projectType: "RAILWAY_UPGRADE" } },
            { type: "flag", path: "decisionMemory.coal.railResponse", value: "railway" },
          ],
        },
        {
          id: "temporary_freight_priority",
          text: "Prioritize industrial freight on existing lines",
          effects: [
            { type: "adapter", adapter: "economy.applyPolicy", payload: { policy: "INDUSTRIAL_FREIGHT_PRIORITY" } },
            { type: "flag", path: "decisionMemory.coal.railResponse", value: "freight_priority" },
          ],
        },
        {
          id: "accept_constraints",
          text: "Accept the bottleneck for now",
          effects: [{ type: "flag", path: "decisionMemory.coal.railResponse", value: "none" }],
        },
      ],
    },

    industrial_opportunity: {
      id: "industrial_opportunity",
      title: "Cheap Coal Creates an Industrial Opportunity",
      trigger: { issueType: "INDUSTRIAL_OPPORTUNITY", minimumSeverity: 0.45 },
      cooldownTurns: 5,
      basePriority: 58,
      presentationLevel: PRESENTATION.DECISION,
      descriptionBuilder(issue, gameState) {
        const place = cityName(gameState, issue.locationId);
        const coalCost = issue.metrics?.coalCostIndex;
        return `${place} now has access to abundant coal${coalCost != null ? ` at a cost index of ${round(coalCost, 1)}` : ""}. Steel production and other heavy industry could become profitable, but a new industrial district would increase power, freight and labor demand.`;
      },
      choices: [
        {
          id: "steelworks",
          text: "Support construction of a steelworks",
          effects: [
            { type: "adapter", adapter: "development.startProject", payload: { projectType: "STEELWORKS" } },
            { type: "flag", path: "decisionMemory.coal.steelworksSupported", value: true },
          ],
        },
        {
          id: "market_only",
          text: "Allow private investors to decide",
          effects: [{ type: "adapter", adapter: "economy.applyPolicy", payload: { policy: "NO_INDUSTRIAL_SUBSIDY" } }],
        },
        {
          id: "reserve_capacity",
          text: "Hold back until infrastructure improves",
          effects: [{ type: "flag", path: "decisionMemory.coal.industryDeferred", value: true }],
        },
      ],
    },

    housing_crisis: {
      id: "housing_crisis",
      title: "Housing Crisis",
      trigger: { issueType: "HOUSING_PRESSURE", minimumSeverity: 0.65 },
      cooldownTurns: 4,
      basePriority: 68,
      presentationLevel: PRESENTATION.DECISION,
      descriptionBuilder(issue, gameState) {
        const place = cityName(gameState, issue.locationId);
        const growth = issue.metrics?.populationGrowthSinceDriverPct ?? issue.metrics?.populationGrowthPct;
        const rent = issue.metrics?.rentVsNationalPct;
        const driver = issue.context?.driverName || "recent job growth";
        const growthText = growth != null ? ` Population has grown by ${pct(growth)} since ${driver}.` : "";
        const rentText = rent != null ? ` Rents are ${pct(rent)} above the national average.` : "";
        return `${place} is struggling to house new residents.${growthText}${rentText} Housing construction has not kept pace with migration, putting pressure on workers and local services.`;
      },
      choices: [
        {
          id: "public_housing",
          text: "Launch a public housing program",
          effects: [
            { type: "adapter", adapter: "development.startProject", payload: { projectType: "PUBLIC_HOUSING" } },
            { type: "flag", path: "housing.lastPolicy", value: "public_housing" },
          ],
        },
        {
          id: "private_construction",
          text: "Relax planning restrictions",
          effects: [
            { type: "adapter", adapter: "population.applyHousingPolicy", payload: { policy: "RELAX_PLANNING" } },
            { type: "flag", path: "housing.lastPolicy", value: "private_construction" },
          ],
        },
        {
          id: "do_nothing",
          text: "Allow the market to adjust",
          effects: [{ type: "flag", path: "housing.lastPolicy", value: "market_adjustment" }],
        },
      ],
    },

    meridian_coal_contract: {
      id: "meridian_coal_contract",
      title: "Meridian Seeks a Long-Term Coal Contract",
      trigger: {
        issueType: ["AI_TRADE_OFFER", "AI_COUNTEROFFER"],
        minimumSeverity: 0.35,
        predicate: (issue) => issue.context?.offerType === "LONG_TERM_COAL_CONTRACT",
      },
      cooldownTurns: 6,
      basePriority: 72,
      presentationLevel: PRESENTATION.DECISION,
      descriptionBuilder(issue, gameState) {
        const buyer = countryName(gameState, issue.counterpartyId || "meridian");
        const years = issue.context?.durationTurns;
        const share = issue.context?.exportShareRequested;
        return `${buyer} is proposing a long-term coal purchase agreement${years ? ` lasting ${years} years` : ""}${share != null ? ` and covering about ${pct(share, true)} of current coal exports` : ""}. The deal would stabilize demand and revenue, but could deepen dependence on a single foreign market.`;
      },
      choices: [
        { id: "accept", text: "Accept the long-term contract", effects: [{ type: "adapter", adapter: "trade.resolveOffer", payload: { response: "accept" } }] },
        { id: "counter", text: "Demand better terms", effects: [{ type: "adapter", adapter: "trade.resolveOffer", payload: { response: "counter" } }] },
        { id: "reject", text: "Reject and preserve flexibility", effects: [{ type: "adapter", adapter: "trade.resolveOffer", payload: { response: "reject" } }] },
      ],
    },

    industrial_decline: {
      id: "industrial_decline",
      title: "Domestic Industry Under Pressure",
      trigger: { issueType: "FOREIGN_COMPETITION", minimumSeverity: 0.55 },
      cooldownTurns: 4,
      basePriority: 66,
      presentationLevel: PRESENTATION.DECISION,
      descriptionBuilder(issue, gameState) {
        const place = cityName(gameState, issue.locationId);
        const importGap = issue.metrics?.importPriceAdvantagePct;
        return `Manufacturers in ${place} are losing market share to cheaper imports${importGap != null ? `, which are about ${pct(importGap)} cheaper than comparable domestic goods` : ""}. Factory profitability is falling, and layoffs may follow if the gap persists.`;
      },
      choices: [
        { id: "tariff", text: "Raise targeted tariffs", effects: [{ type: "adapter", adapter: "trade.changeTariff", payload: { mode: "targeted_protection" } }] },
        { id: "subsidy", text: "Subsidize affected manufacturers", effects: [{ type: "adapter", adapter: "economy.applyPolicy", payload: { policy: "INDUSTRIAL_SUBSIDY" } }] },
        { id: "retraining", text: "Fund worker retraining", effects: [{ type: "adapter", adapter: "population.applyLaborPolicy", payload: { policy: "WORKER_RETRAINING" } }] },
        { id: "restructure", text: "Accept industrial restructuring", effects: [{ type: "flag", path: "industry.declinePolicy", value: "restructure" }] },
      ],
    },

    unemployment_crisis: {
      id: "unemployment_crisis",
      title: "Industrial Layoffs Spread",
      trigger: { issueType: "HIGH_UNEMPLOYMENT", minimumSeverity: 0.62 },
      cooldownTurns: 4,
      basePriority: 64,
      presentationLevel: PRESENTATION.DECISION,
      descriptionBuilder(issue, gameState) {
        const place = cityName(gameState, issue.locationId);
        const rate = issue.metrics?.unemploymentRate;
        return `${place} is experiencing a sustained rise in unemployment${rate != null ? `, now at ${pct(rate, true)}` : ""}. The downturn is reducing household income and weakening local demand.`;
      },
      choices: [
        { id: "retraining", text: "Expand retraining and relocation support", effects: [{ type: "adapter", adapter: "population.applyLaborPolicy", payload: { policy: "RETRAIN_AND_RELOCATE" } }] },
        { id: "jobs_program", text: "Launch temporary public works", effects: [{ type: "adapter", adapter: "development.startProject", payload: { projectType: "PUBLIC_WORKS" } }] },
        { id: "wait", text: "Wait for firms and workers to adjust", effects: [{ type: "flag", path: "industry.unemploymentResponse", value: "wait" }] },
      ],
    },

    regional_inequality: {
      id: "regional_inequality",
      title: "Regional Growth Gap Widens",
      trigger: { issueType: "REGIONAL_INEQUALITY", minimumSeverity: 0.55 },
      cooldownTurns: 5,
      basePriority: 60,
      presentationLevel: PRESENTATION.DECISION,
      descriptionBuilder(issue, gameState) {
        const fast = issue.context?.fastRegions?.map((x) => cityName(gameState, x)).join(" and ") || "the fastest-growing regions";
        const slow = issue.context?.slowRegions?.map((x) => cityName(gameState, x)).join(" and ") || "the slower regions";
        const gap = issue.metrics?.growthGapPct;
        return `${fast} are pulling away from ${slow}${gap != null ? `, with a growth gap of roughly ${pct(gap)}` : ""}. Workers and capital are increasingly moving toward the stronger regions, which may weaken the lagging areas further.`;
      },
      choices: [
        { id: "infrastructure", text: "Invest in lagging-region infrastructure", effects: [{ type: "adapter", adapter: "development.startProject", payload: { projectType: "REGIONAL_INFRASTRUCTURE" } }] },
        { id: "ag_modernization", text: "Modernize agriculture in the Southern Plains", effects: [{ type: "adapter", adapter: "economy.applyPolicy", payload: { policy: "AGRICULTURAL_MODERNIZATION" } }] },
        { id: "tax_incentives", text: "Offer targeted investment tax incentives", effects: [{ type: "adapter", adapter: "economy.applyPolicy", payload: { policy: "REGIONAL_TAX_INCENTIVES" } }] },
        { id: "ignore", text: "Allow migration to rebalance the economy", effects: [{ type: "flag", path: "regionalInequality.response", value: "market_migration" }] },
      ],
    },

    trade_dependence: {
      id: "trade_dependence",
      title: "Export Dependence Deepens",
      trigger: { issueType: ["TRADE_DEPENDENCE", "EXPORT_CONCENTRATION"], minimumSeverity: 0.55 },
      cooldownTurns: 5,
      basePriority: 65,
      presentationLevel: PRESENTATION.DECISION,
      descriptionBuilder(issue, gameState) {
        const cp = countryName(gameState, issue.counterpartyId || issue.context?.topPartnerId || "meridian");
        const share = issue.metrics?.exportShare;
        return `${cp} has become increasingly important to Asteria's export economy${share != null ? `, now taking about ${pct(share, true)} of exports in the affected sector` : ""}. Trade has supported growth, but dependence gives the buyer more leverage in future negotiations.`;
      },
      choices: [
        { id: "maintain", text: "Keep the relationship and prioritize current growth", effects: [{ type: "flag", path: "tradeDependence.response", value: "maintain" }] },
        { id: "diversify", text: "Diversify export markets", effects: [{ type: "adapter", adapter: "trade.applyStrategy", payload: { strategy: "EXPORT_DIVERSIFICATION" } }] },
        { id: "concessions", text: "Accept concessions to secure market access", effects: [{ type: "adapter", adapter: "trade.applyStrategy", payload: { strategy: "ACCEPT_PARTNER_CONCESSIONS" } }] },
        { id: "domestic_demand", text: "Develop domestic demand instead", effects: [{ type: "adapter", adapter: "economy.applyPolicy", payload: { policy: "DOMESTIC_DEMAND_EXPANSION" } }] },
      ],
    },

    mine_control_dispute: {
      id: "mine_control_dispute",
      title: "Foreign Mine Control Dispute",
      trigger: { manualOnly: true },
      cooldownTurns: 99,
      basePriority: 82,
      presentationLevel: PRESENTATION.MAJOR,
      descriptionBuilder(issue, gameState) {
        const investor = countryName(gameState, issue?.counterpartyId || "meridian");
        return `${investor}'s investment in Asteria's coal sector has become a political and commercial dispute. High foreign ownership now collides with deteriorating relations, forcing the government to decide how strongly to defend domestic control.`;
      },
      choices: [
        { id: "renegotiate", text: "Renegotiate ownership and access terms", effects: [{ type: "adapter", adapter: "trade.renegotiateInvestment", payload: { assetType: "COAL_MINE" } }] },
        { id: "buyout", text: "Seek a negotiated state buyout", effects: [{ type: "adapter", adapter: "economy.applyPolicy", payload: { policy: "FOREIGN_ASSET_BUYOUT" } }] },
        { id: "honor_terms", text: "Honor the existing agreement", effects: [{ type: "flag", path: "decisionMemory.coal.mineControlDecision", value: "honor_terms" }] },
      ],
    },
  };

  // ---------------------------------------------------------------------------
  // Triggering, priority and queue
  // ---------------------------------------------------------------------------

  function triggerMatches(def, issue) {
    const t = def.trigger || {};
    if (t.manualOnly) return false;
    const types = Array.isArray(t.issueType) ? t.issueType : [t.issueType];
    if (t.issueType && !types.includes(issue.type)) return false;
    if (issue.severity < (t.minimumSeverity ?? 0)) return false;
    if (typeof t.predicate === "function" && !t.predicate(issue)) return false;
    return true;
  }

  function calculatePriority(def, issue) {
    const severityScore = clamp01(issue.severity) * 45;
    const relevanceScore = issue.locationId ? 10 : 5;
    const strategic = Number(issue.context?.strategicImportance ?? 0) * 15;
    const novelty = issue.acknowledged ? 0 : 10;
    return round((def.basePriority ?? 30) + severityScore + relevanceScore + strategic + novelty, 2);
  }

  function isOnCooldown(def, issue, gameState) {
    const key = eventKey(def.id, issue.locationId);
    const until = state.cooldowns.get(key) ?? -Infinity;
    if (nowTurn(gameState) < until) return true;

    const memory = state.eventMemory.get(key);
    if (!memory) return false;

    // A persistent issue should not reopen the same decision every few years.
    // After the cooldown expires, retrigger only if severity has worsened materially.
    // If the issue fully resolves and later returns, ingestIssue clears this memory.
    const worsened = issue.severity - (memory.lastTriggeredSeverity ?? 0) >= state.config.eventRetriggerSeverityDelta;
    return !worsened;
  }

  function buildEvent(def, issue, gameState, extraContext = {}) {
    const level = def.presentationLevel || presentationFromSeverity(issue);
    const dynamicTitle = def.dynamicTitleBuilder?.(issue, gameState) || def.title;
    const playerContext = playerContextForIssue(issue);
    const baseDescription = def.descriptionBuilder ? def.descriptionBuilder(issue, gameState, extraContext) : "";
    const linkedDecision = playerContext.decisions.at(-1);
    const playerConnectionText = linkedDecision
      ? ` This development is connected through confirmed simulation links to your Year ${linkedDecision.turn} decision: ${linkedDecision.text}.`
      : "";
    const event = {
      instanceId: `${def.id}_${issue?.locationId || "global"}_${nowTurn(gameState)}_${hashString(JSON.stringify([issue?.id || "", issue?.severity || 0, extraContext || {}, state.eventQueue.length]))}`,
      eventId: def.id,
      title: dynamicTitle,
      level,
      issueId: issue?.id || null,
      issueType: issue?.type || null,
      locationId: issue?.locationId || null,
      counterpartyId: issue?.counterpartyId || null,
      severity: issue?.severity ?? 0.5,
      severityLabel: getSeverityLabel(issue?.severity ?? 0.5),
      causes: deepClone(issue?.causes || []),
      causedBy: deepClone(issue?.causedBy || []),
      evidence: deepClone(issue?.evidence || {}),
      affectedGroups: deepClone(issue?.affectedGroups || []),
      issueEpisodeId: issue?.episodeId || null,
      storyIds: getStoryIdsForNode(issue?.episodeId || null),
      playerContext,
      metrics: deepClone(issue?.metrics || {}),
      context: { ...deepClone(issue?.context || {}), ...deepClone(extraContext) },
      titleText: dynamicTitle,
      description: `${baseDescription}${playerConnectionText}`,
      choices: deepClone(def.choices || []),
      priority: calculatePriority(def, issue || { severity: 0.5, context: {} }),
      createdTurn: nowTurn(gameState),
      status: "queued",
      source: "simulation",
    };
    return event;
  }

  function queueEvent(eventOrId, gameState = null, issue = null, extraContext = {}) {
    let event = eventOrId;
    if (typeof eventOrId === "string") {
      const def = EVENT_DEFS[eventOrId];
      if (!def) throw new Error(`Unknown event definition: ${eventOrId}`);
      event = buildEvent(def, issue || { severity: 0.5, causes: [], context: {}, metrics: {} }, gameState || { turn: 0 }, extraContext);
    }

    if (state.eventQueue.length >= state.config.maxQueueSize) {
      state.eventQueue.sort((a, b) => b.priority - a.priority);
      state.eventQueue = state.eventQueue.slice(0, state.config.maxQueueSize - 1);
    }

    const duplicate = state.eventQueue.some((e) => e.eventId === event.eventId && e.issueId === event.issueId && e.status === "queued");
    if (!duplicate) state.eventQueue.push(event);
    state.eventQueue.sort((a, b) => b.priority - a.priority || a.createdTurn - b.createdTurn);
    return event;
  }

  function checkEventTriggers(gameState) {
    const triggered = [];
    for (const issue of getActiveIssues()) {
      for (const def of Object.values(EVENT_DEFS)) {
        if (!triggerMatches(def, issue)) continue;
        if (isOnCooldown(def, issue, gameState)) continue;

        const key = eventKey(def.id, issue.locationId);
        if (state.activeEvent?.eventId === def.id && state.activeEvent?.issueId === issue.id) continue;
        if (state.eventQueue.some((e) => e.eventId === def.id && e.issueId === issue.id)) continue;

        const event = buildEvent(def, issue, gameState);
        queueEvent(event);
        triggered.push(event);

        state.eventMemory.set(key, {
          triggeredTurn: nowTurn(gameState),
          lastTriggeredSeverity: issue.severity,
          issueId: issue.id,
        });
        state.cooldowns.set(key, nowTurn(gameState) + (def.cooldownTurns ?? 0));
        state.debug.triggerLog.push({
          turn: nowTurn(gameState),
          eventId: def.id,
          issueId: issue.id,
          reason: `${issue.type} severity ${round(issue.severity, 2)}`,
        });
        if (state.debug.triggerLog.length > 100) state.debug.triggerLog.shift();
      }
    }
    return triggered;
  }

  function getNextEvent() {
    if (state.activeEvent) return state.activeEvent;
    const next = state.eventQueue.shift() || null;
    if (next) {
      next.status = "active";
      state.activeEvent = next;
    }
    return next;
  }

  // ---------------------------------------------------------------------------
  // Situation generation
  // ---------------------------------------------------------------------------

  const SITUATION_TITLES = {
    TRANSPORT_BOTTLENECK: "Transport Bottleneck",
    POWER_SHORTAGE: "Power Shortage",
    INPUT_SHORTAGE: "Industrial Input Shortage",
    FISCAL_DEFICIT: "Government Deficit",
    HIGH_DEBT: "High Government Debt",
    HOUSING_PRESSURE: "Housing Pressure",
    HIGH_UNEMPLOYMENT: "High Unemployment",
    LABOR_SHORTAGE: "Labor Shortage",
    REGIONAL_DECLINE: "Regional Decline",
    REGIONAL_INEQUALITY: "Regional Inequality",
    LOW_LIVING_STANDARD: "Low Living Standards",
    TRADE_DEPENDENCE: "Trade Dependence",
    IMPORT_SHORTAGE: "Import Shortage",
    EXPORT_CONCENTRATION: "Export Concentration",
    DIPLOMATIC_TENSION: "Diplomatic Tension",
    INVESTMENT_DEPENDENCE: "Investment Dependence",
    FOREIGN_COMPETITION: "Foreign Competition",
    AI_TRADE_OFFER: "Foreign Trade Proposal",
    AI_INVESTMENT_OFFER: "Foreign Investment Proposal",
    AI_COUNTEROFFER: "Foreign Counteroffer",
    AI_ECONOMIC_PRESSURE: "Foreign Economic Pressure",
  };

  function situationSummary(issue, gameState) {
    const place = issue.locationId ? cityName(gameState, issue.locationId) : null;
    const cp = issue.counterpartyId ? countryName(gameState, issue.counterpartyId) : null;
    const prefix = place ? `${place}: ` : cp ? `${cp}: ` : "";
    const causeText = issue.causes.length ? ` Main causes: ${issue.causes.slice(0, 2).join(", ")}.` : "";
    return `${prefix}${SITUATION_TITLES[issue.type] || issue.type.replaceAll("_", " ")} is ${getSeverityLabel(issue.severity)}.${causeText}`;
  }

  function generateSituations(gameState) {
    const situations = getActiveIssues().map((issue) => {
      const hasAction = Object.values(EVENT_DEFS).some((def) => triggerMatches(def, issue));
      const level = issue.presentationLevel || presentationFromSeverity(issue);
      const playerContext = playerContextForIssue(issue);
      const linkedDecision = playerContext.decisions.at(-1);
      return {
        id: `situation:${issue.id}`,
        issueId: issue.id,
        title: issue.context?.title || `${issue.locationId ? cityName(gameState, issue.locationId) + " " : ""}${SITUATION_TITLES[issue.type] || issue.type.replaceAll("_", " ")}`,
        severity: issue.severity,
        severityLabel: getSeverityLabel(issue.severity),
        level,
        locationId: issue.locationId,
        counterpartyId: issue.counterpartyId,
        shortExplanation: `${situationSummary(issue, gameState)}${linkedDecision ? ` Linked to your Year ${linkedDecision.turn} decision: ${linkedDecision.text}.` : ""}`,
        causes: deepClone(issue.causes),
        metrics: deepClone(issue.metrics),
        actionAvailable: hasAction,
        acknowledged: issue.acknowledged,
        createdTurn: issue.createdTurn,
        issueEpisodeId: issue.episodeId,
        storyIds: getStoryIdsForNode(issue.episodeId),
        playerContext,
        affectedGroups: deepClone(issue.affectedGroups || []),
        evidence: deepClone(issue.evidence || {}),
        lastUpdatedTurn: issue.lastUpdatedTurn,
      };
    });

    return situations
      .sort((a, b) => b.severity - a.severity || Number(b.actionAvailable) - Number(a.actionAvailable))
      .slice(0, state.config.maxSituationCards);
  }

  function emitMinorFeedUpdates(gameState) {
    for (const issue of getActiveIssues()) {
      const level = issue.presentationLevel || presentationFromSeverity(issue);
      if (level !== PRESENTATION.FEED) continue;
      const memoryKey = `feed:${issue.id}`;
      const lastTurn = getFlag(memoryKey, -999);
      if (nowTurn(gameState) - lastTurn < 2) continue;
      addFeed(gameState, {
        type: "ISSUE_UPDATE",
        issueId: issue.id,
        title: SITUATION_TITLES[issue.type] || issue.type,
        text: situationSummary(issue, gameState),
      });
      setFlag(memoryKey, nowTurn(gameState));
    }
  }

  // ---------------------------------------------------------------------------
  // Consequences
  // ---------------------------------------------------------------------------

  function scheduleConsequence(consequence, gameState, sourceEventId = null) {
    const item = {
      id: consequence.id || `consequence_${nowTurn(gameState)}_${hashString(JSON.stringify([sourceEventId || "", consequence.adapter || consequence.resultEventId || "", consequence.payload || {}, state.consequences.length]))}`,
      sourceEventId: consequence.sourceEventId || sourceEventId,
      triggerTurn: consequence.triggerTurn ?? null,
      delayTurns: consequence.delayTurns ?? null,
      conditions: deepClone(consequence.conditions || []),
      resultEventId: consequence.resultEventId || null,
      adapter: consequence.adapter || null,
      payload: deepClone(consequence.payload || {}),
      active: consequence.active !== false,
      createdTurn: nowTurn(gameState),
      earliestTurn:
        consequence.triggerTurn != null
          ? consequence.triggerTurn
          : consequence.delayTurns != null
            ? nowTurn(gameState) + consequence.delayTurns
            : nowTurn(gameState),
      once: consequence.once !== false,
      context: deepClone(consequence.context || {}),
    };
    state.consequences.push(item);
    return item;
  }

  function resolvePath(obj, path) {
    const parts = String(path).split(".");
    let cur = obj;
    for (const p of parts) {
      if (cur == null) return undefined;
      cur = cur[p];
    }
    return cur;
  }

  function compare(a, op, b) {
    switch (op) {
      case ">": return a > b;
      case ">=": return a >= b;
      case "<": return a < b;
      case "<=": return a <= b;
      case "==": return a == b; // intentional loose equality for data-driven inputs
      case "===": return a === b;
      case "!=": return a != b;
      case "!==": return a !== b;
      case "in": return Array.isArray(b) && b.includes(a);
      default: return false;
    }
  }

  function consequenceConditionMet(condition, gameState) {
    if (typeof condition === "function") return !!condition(gameState, state.flags);
    if (typeof condition === "string") {
      // String conditions are only supported through an adapter for safety.
      if (typeof state.adapters.evaluateCondition === "function") {
        return !!state.adapters.evaluateCondition(condition, gameState, state.flags);
      }
      return false;
    }

    const type = condition?.type || "metric";
    if (type === "flag") {
      return compare(getFlag(condition.path), condition.op || "===", condition.value);
    }
    if (type === "relationship") {
      const value =
        gameState?.diplomacy?.relations?.[condition.countryId]?.score ??
        gameState?.countries?.[condition.countryId]?.relationWithPlayer ??
        resolvePath(gameState, `relations.${condition.countryId}`);
      return compare(value, condition.op || ">=", condition.value);
    }
    if (type === "metric") {
      const fromState = resolvePath(gameState, condition.path);
      const fromMetrics = resolvePath(gameState?.metrics || {}, condition.path);const value = fromState ?? fromMetrics;
      return compare(value, condition.op || ">=", condition.value);
    }
    if (type === "issue") {
      const candidates = getActiveIssues().filter((x) => x.type === condition.issueType);
      return candidates.some((x) => compare(x.severity, condition.op || ">=", condition.value ?? condition.minimumSeverity ?? 0));
    }
    return false;
  }

  async function processConsequences(gameState) {
    const fired = [];
    for (const c of state.consequences) {
      if (!c.active) continue;
      if (nowTurn(gameState) < c.earliestTurn) continue;
      const conditionsMet = c.conditions.every((cond) => consequenceConditionMet(cond, gameState));
      if (!conditionsMet) continue;

      if (c.resultEventId) {
        const def = EVENT_DEFS[c.resultEventId];
        if (def) {
          const issue = {
            id: `consequence:${c.id}`,
            type: "CONSEQUENCE",
            sourceModule: "events",
            severity: 0.8,
            causes: [c.sourceEventId],
            context: deepClone(c.context),
            metrics: {},
            locationId: c.context?.locationId || null,
            counterpartyId: c.context?.counterpartyId || null,
          };
          queueEvent(buildEvent(def, issue, gameState, c.context));
        }
      }
      if (c.adapter) {
        await callAdapter(c.adapter, c.payload, gameState);
      }

      fired.push(c);
      state.debug.consequenceLog.push({ turn: nowTurn(gameState), id: c.id, sourceEventId: c.sourceEventId });
      if (c.once) c.active = false;
    }
    return fired;
  }

  // ---------------------------------------------------------------------------
  // Choice resolution
  // ---------------------------------------------------------------------------

  function validateChoice(choice, event, gameState) {
    const req = choice.requirements || {};
    if (req.minTreasury != null) {
      const treasury = gameState?.economy?.treasury ?? gameState?.treasury ?? 0;
      if (treasury < req.minTreasury) return { ok: false, reason: "Insufficient Treasury" };
    }
    if (req.flag) {
      const actual = getFlag(req.flag.path);
      if (!compare(actual, req.flag.op || "===", req.flag.value)) return { ok: false, reason: "Requirement not met" };
    }
    if (typeof choice.requirementCheck === "function") {
      const result = choice.requirementCheck(gameState, event, state.flags);
      if (result !== true) return { ok: false, reason: typeof result === "string" ? result : "Requirement not met" };
    }
    return { ok: true };
  }

  async function applyEffect(effect, event, choice, gameState, effectIndex = 0, decisionNodeId = null) {
    if (!effect) return { ok: true };

    if (effect.type === "flag") {
      let value = effect.value;
      if (effect.fromContext) value = event.context?.[effect.fromContext] ?? effect.value;
      setFlag(effect.path, value);
      return { ok: true, type: "flag", path: effect.path, value };
    }

    if (effect.type === "adapter") {
      const actionNode = createPlayerActionNode(event, choice, effect, effectIndex, gameState, decisionNodeId);
      const payload = {
        ...deepClone(effect.payload || {}),
        eventId: event.eventId,
        eventInstanceId: event.instanceId,
        choiceId: choice.id,
        issueId: event.issueId,
        issueEpisodeId: event.issueEpisodeId || null,
        locationId: event.locationId,
        counterpartyId: event.counterpartyId,
        context: deepClone(event.context),
        // Modules 2–6 should preserve these refs in any downstream causal claim.
        causalDecisionRef: decisionNodeId,
        causalActionRef: actionNode?.id || null,
      };
      const result = await callAdapter(effect.adapter, payload, gameState);
      if (actionNode) {
        const stored = state.causalGraph.nodes.get(actionNode.id);
        if (stored) {
          stored.status = result?.ok === false ? "failed" : "accepted";
          stored.turn = nowTurn(gameState);
          state.provenanceLedger.facts.set(stored.id, deepClone(stored));
        }
      }
      const sourceModule = normalizeModuleName(String(effect.adapter || "unknown").split(".")[0]);
      ingestAdapterCausalPayload(result, sourceModule, gameState);
      return { ...(result || { ok: true }), causalActionRef: actionNode?.id || null };
    }

    if (effect.type === "consequence") {
      return scheduleConsequence({
        ...deepClone(effect.consequence || {}),
        context: {
          ...deepClone(effect.consequence?.context || {}),
          causalDecisionRef: decisionNodeId,
        },
      }, gameState, event.eventId);
    }

    if (effect.type === "feed") {
      return addFeed(gameState, { ...effect.item, sourceEventId: event.eventId });
    }

    return { ok: false, reason: `Unknown effect type: ${effect.type}` };
  }

  function buildDecisionFeedback(event, choice, effectResults) {
    const certain = safeArray(choice.uncertainty?.certain);
    const expected = safeArray(choice.uncertainty?.expected);
    const possible = safeArray(choice.uncertainty?.possible);

    // Adapter results may provide player-facing effects.
    for (const r of effectResults) {
      if (!r || typeof r !== "object") continue;
      if (r.feedback?.certain) certain.push(...safeArray(r.feedback.certain));
      if (r.feedback?.expected) expected.push(...safeArray(r.feedback.expected));
      if (r.feedback?.possible) possible.push(...safeArray(r.feedback.possible));
    }

    return {
      title: `${event.title} — Decision Recorded`,
      certain: unique(certain),
      expected: unique(expected),
      possible: unique(possible),
    };
  }

  async function resolveChoice(eventIdOrInstanceId, choiceId, gameState) {
    const event =
      state.activeEvent &&
      (state.activeEvent.eventId === eventIdOrInstanceId || state.activeEvent.instanceId === eventIdOrInstanceId)
        ? state.activeEvent
        : state.eventQueue.find((e) => e.eventId === eventIdOrInstanceId || e.instanceId === eventIdOrInstanceId);

    if (!event) return { ok: false, reason: "Event not found" };
    const choice = safeArray(event.choices).find((c) => c.id === choiceId);
    if (!choice) return { ok: false, reason: "Choice not found" };

    const validation = validateChoice(choice, event, gameState);
    if (!validation.ok) return validation;

    // Record the player's choice before dispatching commands. This node is a
    // confirmed part of history, but it is NOT automatically linked to later
    // world outcomes. Downstream modules must explicitly cite the action ref.
    const decisionNode = createPlayerDecisionNode(event, choice, gameState);
    event.causalDecisionRef = decisionNode.id;

    const effectResults = [];
    const effects = safeArray(choice.effects);
    for (let effectIndex = 0; effectIndex < effects.length; effectIndex++) {
      const effect = effects[effectIndex];
      const result = await applyEffect(effect, event, choice, gameState, effectIndex, decisionNode.id);
      effectResults.push(result);
      if (result?.ok === false && result?.fatal) {
        const stored = state.causalGraph.nodes.get(decisionNode.id);
        if (stored) stored.status = "partial_failure";
        return {
          ok: false,
          reason: result.reason || "Effect failed",
          partialResults: effectResults,
          causalDecisionRef: decisionNode.id,
        };
      }
    }

    setFlag(`eventChoices.${event.eventId}`, choice.id);
    setFlag(`eventChoicesByInstance.${event.instanceId}`, choice.id);

    if (event.issueId) {
      const issue = state.issueIndex.get(event.issueId);
      if (issue) issue.acknowledged = true;
    }

    recordHistory(gameState, {
      type: "PLAYER_DECISION",
      eventId: event.eventId,
      eventInstanceId: event.instanceId,
      issueId: event.issueId,
      locationId: event.locationId,
      choiceId: choice.id,
      choiceText: choice.text,
      causalDecisionRef: decisionNode.id,
    });

    event.status = "resolved";
    event.resolvedTurn = nowTurn(gameState);
    event.choiceId = choice.id;
    if (state.activeEvent?.instanceId === event.instanceId) state.activeEvent = null;
    state.eventQueue = state.eventQueue.filter((e) => e.instanceId !== event.instanceId);

    const feedback = buildDecisionFeedback(event, choice, effectResults);
    addFeed(gameState, {
      type: "DECISION_RESULT",
      title: feedback.title,
      text: feedback.certain[0] || `Decision: ${choice.text}`,
      eventId: event.eventId,
    });

    return {
      ok: true,
      eventId: event.eventId,
      choiceId: choice.id,
      causalDecisionRef: decisionNode.id,
      effectResults,
      feedback,
      situations: generateSituations(gameState),
    };
  }

  // ---------------------------------------------------------------------------
  // Provenance ledger, validated causality, and emergent story discovery
  // ---------------------------------------------------------------------------
  // HARD RULE:
  // Module 7 may discover relationships, but it may not invent causality.
  // A player-facing causal statement requires a validated CausalClaim from the
  // module that calculated the effect (or from Module 7 for its own dispatches).

  const CAUSAL_MECHANISMS = Object.freeze({
    player_decision_dispatches_action: { ownerModule: "issues_events", maxLagTurns: 0 },
    transport_demand_exceeds_capacity: { ownerModule: "economy", maxLagTurns: 2 },
    industrial_jobs_attract_migration: { ownerModule: "population", maxLagTurns: 4 },
    housing_demand_exceeds_supply: { ownerModule: "population", maxLagTurns: 4 },
    foreign_competition_reduces_profitability: { ownerModule: "economy", maxLagTurns: 3 },
    layoffs_raise_unemployment: { ownerModule: "population", maxLagTurns: 2 },
    export_concentration_creates_dependence: { ownerModule: "trade", maxLagTurns: 5 },
    trade_dependence_enables_pressure: { ownerModule: "ai", maxLagTurns: 8 },
  });

  // These rules ONLY create candidate relations for debugging/discovery hints.
  // They never enter the formal causal graph and never merge stories.
  const STORY_RELATION_RULES = Object.freeze([
    { from: "COAL_DISCOVERY", to: "TRANSPORT_BOTTLENECK", score: 0.55, samePlacePreferred: true },
    { from: "COAL_DISCOVERY", to: "INDUSTRIAL_OPPORTUNITY", score: 0.45, samePlacePreferred: true },
    { from: "INDUSTRIAL_OPPORTUNITY", to: "MIGRATION_SURGE", score: 0.50, samePlacePreferred: true },
    { from: "MIGRATION_SURGE", to: "HOUSING_PRESSURE", score: 0.72, samePlacePreferred: true },
    { from: "FOREIGN_COMPETITION", to: "FACTORY_LAYOFFS", score: 0.65, samePlacePreferred: true },
    { from: "FACTORY_LAYOFFS", to: "HIGH_UNEMPLOYMENT", score: 0.78, samePlacePreferred: true },
    { from: "HIGH_UNEMPLOYMENT", to: "REGIONAL_DECLINE", score: 0.55, samePlacePreferred: true },
    { from: "REGIONAL_INEQUALITY", to: "REGIONAL_DECLINE", score: 0.62, samePlacePreferred: false },
    { from: "REGIONAL_DECLINE", to: "MIGRATION_SURGE", score: 0.45, samePlacePreferred: true },
    { from: "EXPORT_CONCENTRATION", to: "TRADE_DEPENDENCE", score: 0.82, samePlacePreferred: false },
    { from: "TRADE_DEPENDENCE", to: "AI_ECONOMIC_PRESSURE", score: 0.48, samePlacePreferred: false },
    { from: "INVESTMENT_DEPENDENCE", to: "DIPLOMATIC_TENSION", score: 0.42, samePlacePreferred: false },
  ]);

  function normalizeModuleName(name) {
    const n = String(name || "unknown").toLowerCase();
    const aliases = {
      module2: "development",
      module3: "economy",
      module4: "population",
      module5: "trade",
      module6: "ai",
      module7: "issues_events",
      events: "issues_events",
      issues: "issues_events",
    };
    return aliases[n] || n;
  }

  function causalNodeFromIssue(issue) {
    return {
      id: issue.episodeId || `${issue.id}::episode:1`,
      issueId: issue.id,
      episodeId: issue.episodeId || `${issue.id}::episode:1`,
      episodeCounter: issue.episodeCounter || 1,
      kind: "issue",
      type: issue.type,
      title: SITUATION_TITLES[issue.type] || issue.type.replaceAll("_", " "),
      locationId: issue.locationId || null,
      counterpartyId: issue.counterpartyId || null,
      turn: issue.lastUpdatedTurn ?? issue.createdTurn ?? 0,
      startTurn: issue.createdTurn ?? 0,
      effectiveFrom: issue.createdTurn ?? 0,
      effectiveTo: issue.active === false ? issue.resolvedTurn ?? issue.lastUpdatedTurn ?? null : null,
      active: issue.active !== false,
      severity: issue.severity,
      causes: deepClone(issue.causes || []),
      evidence: deepClone(issue.evidence || {}),
      sourceModule: normalizeModuleName(issue.sourceModule),
    };
  }

  function normalizeCausalFact(raw, sourceModule, gameState) {
    if (!raw || !raw.type) return null;
    const moduleName = normalizeModuleName(sourceModule || raw.sourceModule);
    const effectiveFrom = Number(raw.effectiveFrom ?? raw.turn ?? nowTurn(gameState));
    const baseId = raw.id || raw.factId || [
      moduleName,
      raw.type,
      raw.locationId || raw.regionId || raw.countryId || "global",
      raw.subjectId || raw.objectId || "",
      effectiveFrom,
    ].join(":");
    return {
      id: String(baseId),
      kind: raw.kind || "world_fact",
      type: raw.type,
      title: raw.title || raw.type.replaceAll("_", " "),
      sourceModule: moduleName,
      locationId: raw.locationId || raw.regionId || null,
      counterpartyId: raw.counterpartyId || null,
      subjectId: raw.subjectId || raw.objectId || null,
      turn: Number(raw.turn ?? effectiveFrom),
      startTurn: effectiveFrom,
      effectiveFrom,
      effectiveTo: raw.effectiveTo == null ? null : Number(raw.effectiveTo),
      active: raw.active !== false,
      metrics: deepClone(raw.metrics || {}),
      evidence: deepClone(raw.evidence || {}),
      context: deepClone(raw.context || {}),
      playerVisible: raw.playerVisible !== false,
    };
  }

  function addCausalNode(node, { recordFact = true } = {}) {
    if (!node?.id) return null;
    const old = state.causalGraph.nodes.get(node.id) || {};
    const merged = { ...old, ...deepClone(node) };
    state.causalGraph.nodes.set(node.id, merged);
    if (recordFact) state.provenanceLedger.facts.set(node.id, deepClone(merged));
    return merged;
  }

  function registerCausalFact(raw, sourceModule = "unknown", gameState = { turn: 0 }) {
    const fact = normalizeCausalFact(raw, sourceModule, gameState);
    if (!fact) return null;
    return addCausalNode(fact);
  }

  function resolveNodeReference(ref) {
    if (!ref) return null;
    const direct = typeof ref === "string"
      ? ref
      : ref.nodeId || ref.factId || ref.episodeId || ref.ref || ref.id || null;
    if (direct && state.causalGraph.nodes.has(direct)) return state.causalGraph.nodes.get(direct);
    if (direct && state.issueIndex.has(direct)) {
      const issue = state.issueIndex.get(direct);
      return state.causalGraph.nodes.get(issue.episodeId) || null;
    }

    const issueId = typeof ref === "object" ? ref.issueId : null;
    if (issueId && state.issueIndex.has(issueId)) {
      const issue = state.issueIndex.get(issueId);
      return state.causalGraph.nodes.get(issue.episodeId) || null;
    }

    const type = typeof ref === "object" ? ref.type || ref.issueType : null;
    if (!type) return null;
    const locationId = typeof ref === "object" ? ref.locationId : null;
    const sourceModule = typeof ref === "object" ? normalizeModuleName(ref.sourceModule) : null;
    const candidates = [...state.causalGraph.nodes.values()].filter((x) =>
      x.type === type &&
      (!locationId || x.locationId === locationId) &&
      (!sourceModule || x.sourceModule === sourceModule)
    );
    return candidates.sort((a, b) => (b.effectiveFrom ?? b.turn ?? 0) - (a.effectiveFrom ?? a.turn ?? 0))[0] || null;
  }

  function normalizeClaimInput(input) {
    if (typeof input === "string") return { ref: input, role: "contributor", contribution: null };
    return {
      ref: input?.ref || input?.nodeId || input?.factId || input?.episodeId || input?.issueId || input?.id || null,
      role: input?.role || "contributor",
      contribution: input?.contribution == null ? null : Number(input.contribution),
      evidence: deepClone(input?.evidence || {}),
    };
  }

  function normalizeCausalClaim(raw, sourceModule, gameState, defaultEffectRef = null) {
    if (!raw) return null;
    const inputs = safeArray(raw.inputs || raw.causes || raw.causedBy).map(normalizeClaimInput).filter((x) => x.ref);
    const effectRef = raw.effectRef || raw.effectId || raw.effect?.ref || raw.effect?.id || defaultEffectRef;
    if (!effectRef || !inputs.length) return null;
    const moduleName = normalizeModuleName(sourceModule || raw.sourceModule);
    const level = raw.evidenceLevel || raw.level || CAUSAL_EVIDENCE.SOURCE_CONFIRMED;
    const mechanism = raw.mechanism || "producer_declared_contribution";
    const stable = `${moduleName}|${mechanism}|${String(effectRef)}|${inputs.map((x) => x.ref).sort().join("|")}`;
    return {
      id: String(raw.id || raw.claimId || `claim:${hashString(stable)}`),
      effectRef,
      mechanism,
      inputs,
      evidenceLevel: level,
      sourceModule: moduleName,
      evidence: deepClone(raw.evidence || {}),
      provenance: deepClone(safeArray(raw.provenance || raw.references)),
      effectiveTurn: Number(raw.effectiveTurn ?? nowTurn(gameState)),
      maxLagTurns: raw.maxLagTurns == null ? null : Number(raw.maxLagTurns),
      playerFacing: raw.playerFacing !== false,
    };
  }

  function effectiveLagTurns(causeNode, effectNode) {
    const effectFrom = Number(effectNode.effectiveFrom ?? effectNode.startTurn ?? effectNode.turn ?? 0);
    const causeFrom = Number(causeNode.effectiveFrom ?? causeNode.startTurn ?? causeNode.turn ?? 0);
    if (causeFrom > effectFrom) return { validDirection: false, lag: causeFrom - effectFrom };
    const causeTo = causeNode.effectiveTo == null ? null : Number(causeNode.effectiveTo);
    if (causeTo == null || causeTo >= effectFrom) return { validDirection: true, lag: 0 };
    return { validDirection: true, lag: Math.max(0, effectFrom - causeTo) };
  }

  function validateCausalClaim(rawClaim, gameState = { turn: 0 }) {
    const claim = rawClaim?.effectRef ? rawClaim : normalizeCausalClaim(rawClaim, rawClaim?.sourceModule, gameState);
    if (!claim) return { ok: false, status: "REJECTED", reason: "invalid_claim_format", claim: rawClaim };

    const effectNode = resolveNodeReference(claim.effectRef);
    if (!effectNode) return { ok: false, status: "PENDING", reason: "effect_not_found", claim };

    const resolvedInputs = [];
    for (const input of claim.inputs) {
      const node = resolveNodeReference(input.ref);
      if (!node) return { ok: false, status: "PENDING", reason: `cause_not_found:${input.ref}`, claim };
      resolvedInputs.push({ ...input, node });
    }

    if (claim.evidenceLevel === CAUSAL_EVIDENCE.CANDIDATE) {
      return { ok: false, status: "CANDIDATE", reason: "candidate_never_enters_formal_graph", claim, effectNode, resolvedInputs };
    }
    if (![CAUSAL_EVIDENCE.SOURCE_CONFIRMED, CAUSAL_EVIDENCE.MODEL_SUPPORTED].includes(claim.evidenceLevel)) {
      return { ok: false, status: "REJECTED", reason: "unknown_evidence_level", claim };
    }

    // Authority rule: the module asserting a formal causal explanation must be
    // the module that calculated the effect. Module 7 can only author claims for
    // its own decision/action dispatch nodes.
    const effectOwner = normalizeModuleName(effectNode.sourceModule);
    if (claim.sourceModule !== effectOwner) {
      return { ok: false, status: "CANDIDATE", reason: `source_not_effect_owner:${claim.sourceModule}->${effectOwner}`, claim, effectNode, resolvedInputs };
    }

    const mechanismSpec = CAUSAL_MECHANISMS[claim.mechanism] || null;
    if (mechanismSpec?.ownerModule && normalizeModuleName(mechanismSpec.ownerModule) !== claim.sourceModule) {
      return { ok: false, status: "REJECTED", reason: "mechanism_owner_mismatch", claim, effectNode, resolvedInputs };
    }

    const maxLag = claim.maxLagTurns ?? mechanismSpec?.maxLagTurns ?? state.config.defaultMaxCausalLagTurns;
    for (const input of resolvedInputs) {
      const timing = effectiveLagTurns(input.node, effectNode);
      if (!timing.validDirection) {
        return { ok: false, status: "REJECTED", reason: `cause_occurs_after_effect:${input.ref}`, claim, effectNode, resolvedInputs };
      }
      if (Number.isFinite(maxLag) && timing.lag > maxLag) {
        return { ok: false, status: "REJECTED", reason: `causal_lag_exceeded:${timing.lag}>${maxLag}`, claim, effectNode, resolvedInputs };
      }
    }

    return { ok: true, status: "VALIDATED", claim, effectNode, resolvedInputs };
  }

  function causalEdgeId(claimId, from, to) {
    return `${claimId}:${from}=>${to}`;
  }

  function materializeValidatedClaim(validation) {
    const { claim, effectNode, resolvedInputs } = validation;
    state.provenanceLedger.claims.set(claim.id, deepClone(claim));
    // A once-pending claim may become valid after its facts arrive.
    state.provenanceLedger.candidates.delete(`candidate:${claim.id}`);
    const strength = claim.evidenceLevel === CAUSAL_EVIDENCE.SOURCE_CONFIRMED ? 1 : 0.8;
    for (const input of resolvedInputs) {
      // Remove heuristic candidates for a pair once a real producer-owned claim exists.
      for (const [candidateId, candidate] of state.provenanceLedger.candidates.entries()) {
        if (candidate.from === input.node.id && candidate.to === effectNode.id) {
          state.provenanceLedger.candidates.delete(candidateId);
        }
      }
      const id = causalEdgeId(claim.id, input.node.id, effectNode.id);
      state.causalGraph.edges.set(id, {
        id,
        claimId: claim.id,
        from: input.node.id,
        to: effectNode.id,
        relation: input.role || claim.mechanism,
        mechanism: claim.mechanism,
        evidenceLevel: claim.evidenceLevel,
        confidence: strength,
        explicit: true,
        contribution: input.contribution,
        evidence: deepClone({ ...claim.evidence, ...input.evidence }),
        sourceModule: claim.sourceModule,
        lastUpdatedTurn: claim.effectiveTurn,
      });
    }
    return claim;
  }

  function storeCausalCandidate(candidate) {
    if (!candidate?.id) return null;
    state.provenanceLedger.candidates.set(candidate.id, deepClone(candidate));
    return candidate;
  }

  function submitCausalClaim(rawClaim, sourceModule = null, gameState = { turn: 0 }, defaultEffectRef = null) {
    const claim = normalizeCausalClaim(rawClaim, sourceModule, gameState, defaultEffectRef);
    if (!claim) return { ok: false, status: "REJECTED", reason: "invalid_claim_format" };
    const validation = validateCausalClaim(claim, gameState);
    state.debug.causalValidationLog.push({
      turn: nowTurn(gameState), claimId: claim.id, status: validation.status, reason: validation.reason || null,
    });
    if (state.debug.causalValidationLog.length > 200) state.debug.causalValidationLog.shift();

    if (validation.ok) {
      materializeValidatedClaim(validation);
      return { ok: true, status: "VALIDATED", claimId: claim.id };
    }
    if (validation.status === "CANDIDATE" || validation.status === "PENDING") {
      storeCausalCandidate({
        id: `candidate:${claim.id}`,
        kind: "claim_candidate",
        claim: deepClone(claim),
        status: validation.status,
        reason: validation.reason,
        turn: nowTurn(gameState),
      });
    } else {
      state.provenanceLedger.rejectedClaims.push({ claim: deepClone(claim), reason: validation.reason, turn: nowTurn(gameState) });
      if (state.provenanceLedger.rejectedClaims.length > 200) state.provenanceLedger.rejectedClaims.shift();
    }
    return { ok: false, status: validation.status, reason: validation.reason, claimId: claim.id };
  }

  function collectModuleCausalPayloads(gameState) {
    const sources = [
      ["development", gameState?.modules?.development || gameState?.development || gameState?.module2],
      ["economy", gameState?.modules?.economy || gameState?.economy || gameState?.module3],
      ["population", gameState?.modules?.population || gameState?.population || gameState?.module4],
      ["trade", gameState?.modules?.trade || gameState?.trade || gameState?.module5],
      ["ai", gameState?.modules?.ai || gameState?.ai || gameState?.module6],
      ["root", gameState],
    ];
    for (const [sourceModule, container] of sources) {
      if (!container) continue;
      for (const fact of safeArray(container.causalFacts)) registerCausalFact(fact, sourceModule, gameState);
    }
    // Claims are submitted only after all facts have been registered.
    for (const [sourceModule, container] of sources) {
      if (!container) continue;
      for (const claim of safeArray(container.causalClaims)) submitCausalClaim(claim, sourceModule, gameState);
    }
  }

  function ingestAdapterCausalPayload(result, sourceModule, gameState) {
    if (!result || typeof result !== "object") return;
    for (const fact of safeArray(result.causalFacts)) registerCausalFact(fact, sourceModule, gameState);
    for (const claim of safeArray(result.causalClaims)) submitCausalClaim(claim, sourceModule, gameState);
  }

  function sameCandidateContext(a, b, rule) {
    if (!a || !b) return false;
    const fromTurn = Number(a.effectiveFrom ?? a.startTurn ?? a.turn ?? 0);
    const toTurn = Number(b.effectiveFrom ?? b.startTurn ?? b.turn ?? 0);
    if (fromTurn > toTurn) return false; // candidates cannot point backward in time
    if (toTurn - fromTurn > state.config.candidateRelationMaxTurns) return false;
    if (a.counterpartyId && b.counterpartyId && a.counterpartyId !== b.counterpartyId) return false;
    if (rule.samePlacePreferred && a.locationId && b.locationId && a.locationId !== b.locationId) return false;
    return true;
  }

  function buildCandidateRelations(gameState) {
    const nodes = [...state.causalGraph.nodes.values()].filter((n) => n.kind === "issue");
    for (const rule of STORY_RELATION_RULES) {
      const fromNodes = nodes.filter((n) => n.type === rule.from);
      const toNodes = nodes.filter((n) => n.type === rule.to);
      for (const a of fromNodes) {
        for (const b of toNodes) {
          if (!sameCandidateContext(a, b, rule)) continue;
          const alreadyFormal = [...state.causalGraph.edges.values()].some((e) => e.from === a.id && e.to === b.id);
          if (alreadyFormal) continue;
          const id = `candidate:pattern:${a.id}=>${b.id}:${rule.from}_${rule.to}`;
          storeCausalCandidate({
            id,
            kind: "pattern_relation",
            from: a.id,
            to: b.id,
            score: rule.score,
            evidenceLevel: CAUSAL_EVIDENCE.CANDIDATE,
            reason: "temporal_spatial_pattern_only_not_causality",
            turn: nowTurn(gameState),
          });
        }
      }
    }
  }

  function legacyClaimsFromIssues(gameState) {
    for (const issue of state.issueIndex.values()) {
      const effectRef = issue.episodeId;
      // Preferred producer contract: causalClaims.
      for (const rawClaim of safeArray(issue.causalClaims)) {
        submitCausalClaim(rawClaim, issue.sourceModule, gameState, effectRef);
      }
      // Backward-compatible causedBy is treated as producer-supplied provenance.
      // It is no longer given a free-form confidence score; authority and time are validated.
      for (const ref of safeArray(issue.causedBy)) {
        const refValue = typeof ref === "string"
          ? ref
          : ref.episodeId || ref.nodeId || ref.factId || ref.issueId || ref.id;
        if (!refValue) continue;
        submitCausalClaim({
          id: `legacy:${hashString(`${issue.episodeId}|${refValue}`)}`,
          effectRef,
          mechanism: typeof ref === "object" ? ref.mechanism || "producer_declared_contribution" : "producer_declared_contribution",
          inputs: [{
            ref: refValue,
            role: typeof ref === "object" ? ref.role || ref.relation || "contributor" : "contributor",
            contribution: typeof ref === "object" ? ref.contribution ?? null : null,
          }],
          evidenceLevel: typeof ref === "object" ? ref.evidenceLevel || CAUSAL_EVIDENCE.SOURCE_CONFIRMED : CAUSAL_EVIDENCE.SOURCE_CONFIRMED,
          evidence: typeof ref === "object" ? ref.evidence || {} : {},
          provenance: [{ type: "legacy_causedBy", issueId: issue.id, episodeId: issue.episodeId }],
          effectiveTurn: issue.createdTurn,
        }, issue.sourceModule, gameState, effectRef);
      }
    }
  }

  function buildCausalLinks(gameState) {
    // 1) Register each real issue episode as a causal node.
    for (const issue of state.issueIndex.values()) addCausalNode(causalNodeFromIssue(issue));

    // 2) Register facts/claims emitted by the modules that actually calculated them.
    collectModuleCausalPayloads(gameState);
    legacyClaimsFromIssues(gameState);

    // 3) Heuristics are stored only as candidates. They never become formal edges.
    buildCandidateRelations(gameState);
    return getCausalGraph();
  }

  function createPlayerDecisionNode(event, choice, gameState) {
    const turn = nowTurn(gameState);
    const id = `decision:${event.instanceId}:${choice.id}`;
    return addCausalNode({
      id,
      kind: "player_decision",
      type: "PLAYER_DECISION",
      title: choice.text,
      sourceModule: "issues_events",
      locationId: event.locationId || null,
      counterpartyId: event.counterpartyId || null,
      eventId: event.eventId,
      eventInstanceId: event.instanceId,
      choiceId: choice.id,
      turn,
      startTurn: turn,
      effectiveFrom: turn,
      effectiveTo: turn,
      active: true,
      playerVisible: true,
    });
  }

  function createPlayerActionNode(event, choice, effect, effectIndex, gameState, decisionNodeId) {
    if (effect?.type !== "adapter") return null;
    const turn = nowTurn(gameState);
    const id = `action:${event.instanceId}:${choice.id}:${effectIndex}`;
    const node = addCausalNode({
      id,
      kind: "player_action",
      type: "ACTION_COMMAND",
      title: effect.payload?.label || effect.adapter,
      adapter: effect.adapter,
      sourceModule: "issues_events",
      locationId: event.locationId || null,
      counterpartyId: event.counterpartyId || null,
      eventId: event.eventId,
      choiceId: choice.id,
      turn,
      startTurn: turn,
      effectiveFrom: turn,
      effectiveTo: turn,
      active: true,
      status: "dispatched",
      playerVisible: true,
    });
    submitCausalClaim({
      id: `claim:${decisionNodeId}->${id}`,
      effectRef: id,
      mechanism: "player_decision_dispatches_action",
      inputs: [{ ref: decisionNodeId, role: "authorizes" }],
      evidenceLevel: CAUSAL_EVIDENCE.SOURCE_CONFIRMED,
      evidence: { eventId: event.eventId, choiceId: choice.id, adapter: effect.adapter },
      provenance: [{ type: "module7_dispatch", eventInstanceId: event.instanceId }],
      effectiveTurn: turn,
      maxLagTurns: 0,
    }, "issues_events", gameState);
    return node;
  }

  function findUpstreamPlayerDecisions(nodeId, maxDepth = 12) {
    if (!nodeId || !state.causalGraph.nodes.has(nodeId)) return [];
    const incoming = new Map();
    for (const edge of state.causalGraph.edges.values()) {
      if (!incoming.has(edge.to)) incoming.set(edge.to, []);
      incoming.get(edge.to).push(edge.from);
    }
    const queue = [{ id: nodeId, depth: 0 }];
    const visited = new Set();
    const found = new Map();
    while (queue.length) {
      const { id, depth } = queue.shift();
      if (visited.has(id) || depth > maxDepth) continue;
      visited.add(id);
      for (const parent of incoming.get(id) || []) {
        const node = state.causalGraph.nodes.get(parent);
        if (!node) continue;
        if (node.kind === "player_decision") found.set(node.id, node);
        queue.push({ id: parent, depth: depth + 1 });
      }
    }
    return [...found.values()].sort((a, b) => (a.effectiveFrom || 0) - (b.effectiveFrom || 0)).map(deepClone);
  }

  function playerContextForIssue(issue) {
    const nodeId = issue?.episodeId;
    const decisions = findUpstreamPlayerDecisions(nodeId);
    return {
      linkedToPlayerChoices: decisions.length > 0,
      decisions: decisions.map((d) => ({
        nodeId: d.id,
        turn: d.effectiveFrom,
        eventId: d.eventId,
        choiceId: d.choiceId,
        text: d.title,
      })),
    };
  }

  function storyTheme(types) {
    const set = new Set(types);
    if (["COAL_DISCOVERY", "TRANSPORT_BOTTLENECK", "INDUSTRIAL_OPPORTUNITY"].some((x) => set.has(x))) return "industrial_development";
    if (["FOREIGN_COMPETITION", "FACTORY_LAYOFFS", "HIGH_UNEMPLOYMENT"].some((x) => set.has(x))) return "industrial_decline";
    if (["REGIONAL_INEQUALITY", "REGIONAL_DECLINE"].some((x) => set.has(x))) return "regional_divergence";
    if (["TRADE_DEPENDENCE", "EXPORT_CONCENTRATION", "AI_ECONOMIC_PRESSURE"].some((x) => set.has(x))) return "trade_dependence";
    if (["MIGRATION_SURGE", "HOUSING_PRESSURE"].some((x) => set.has(x))) return "urban_growth";
    return "emergent_situation";
  }

  function storyTitle(theme, nodes, gameState) {
    const locations = unique(nodes.filter((n) => n.kind === "issue" || n.kind === "world_fact").map((n) => n.locationId));
    const place = locations.length === 1 ? cityName(gameState, locations[0]) : null;
    const prefix = place ? `${place} ` : "";
    const titles = {
      industrial_development: `${prefix}Industrial Development`,
      industrial_decline: `${prefix}Industrial Decline`,
      regional_divergence: "Regional Divergence",
      trade_dependence: "Trade Dependence",
      urban_growth: `${prefix}Urban Growth`,
      emergent_situation: `${prefix}Developing Situation`,
    };
    return titles[theme];
  }

  function detectStoryClusters(gameState) {
    const graph = state.causalGraph;
    // Only validated claims materialize edges, so candidates can never glue stories together.
    const eligibleEdges = [...graph.edges.values()].filter((e) =>
      [CAUSAL_EVIDENCE.SOURCE_CONFIRMED, CAUSAL_EVIDENCE.MODEL_SUPPORTED].includes(e.evidenceLevel)
    );
    const adjacency = new Map();
    for (const edge of eligibleEdges) {
      if (!adjacency.has(edge.from)) adjacency.set(edge.from, new Set());
      if (!adjacency.has(edge.to)) adjacency.set(edge.to, new Set());
      adjacency.get(edge.from).add(edge.to);
      adjacency.get(edge.to).add(edge.from);
    }

    const visited = new Set();
    const clusters = new Map();
    for (const nodeId of adjacency.keys()) {
      if (visited.has(nodeId)) continue;
      const stack = [nodeId];
      const ids = [];
      while (stack.length) {
        const id = stack.pop();
        if (visited.has(id)) continue;
        visited.add(id);
        ids.push(id);
        for (const next of adjacency.get(id) || []) if (!visited.has(next)) stack.push(next);
      }
      if (ids.length < state.config.storyMinimumNodes) continue;
      const nodes = ids.map((id) => graph.nodes.get(id)).filter(Boolean);
      // A decision + dispatch alone is not yet a world story. Require at least one
      // simulation-produced fact/issue beyond Module 7's own action bookkeeping.
      if (!nodes.some((n) => n.sourceModule !== "issues_events" && ["issue", "world_fact", "project", "policy", "agreement", "economic_change"].includes(n.kind))) continue;

      const types = unique(nodes.map((n) => n.type));
      const theme = storyTheme(types);
      const ordered = [...nodes].sort((a, b) => (a.effectiveFrom ?? a.startTurn ?? a.turn ?? 0) - (b.effectiveFrom ?? b.startTurn ?? b.turn ?? 0));
      const stableKey = ordered.map((n) => n.id).sort().join("|");
      const previousCandidates = [...state.storyClusters.values()]
        .map((oldStory) => {
          const oldSet = new Set(oldStory.nodeIds || []);
          const overlap = ids.filter((id) => oldSet.has(id)).length;
          const union = new Set([...(oldStory.nodeIds || []), ...ids]).size;
          return { oldStory, overlap, jaccard: union ? overlap / union : 0 };
        })
        .filter((x) => x.overlap > 0)
        .sort((a, b) => b.jaccard - a.jaccard || b.overlap - a.overlap);
      const inherited = previousCandidates[0];
      const id = inherited && (inherited.jaccard >= 0.30 || inherited.overlap >= 2)
        ? inherited.oldStory.id
        : `story:${theme}:${hashString(stableKey)}`;
      const nodeSet = new Set(ids);
      const edges = eligibleEdges.filter((e) => nodeSet.has(e.from) && nodeSet.has(e.to));
      const decisions = nodes.filter((n) => n.kind === "player_decision");
      clusters.set(id, {
        id,
        theme,
        title: storyTitle(theme, nodes, gameState),
        nodeIds: ids,
        edgeIds: edges.map((e) => e.id),
        locations: unique(nodes.map((n) => n.locationId)),
        types,
        startTurn: Math.min(...nodes.map((n) => n.effectiveFrom ?? n.startTurn ?? n.turn ?? 0)),
        lastUpdatedTurn: Math.max(...nodes.map((n) => n.turn ?? n.effectiveFrom ?? 0)),
        active: nodes.some((n) => n.active),
        evidenceStrength: round(edges.reduce((a, e) => a + (e.evidenceLevel === CAUSAL_EVIDENCE.SOURCE_CONFIRMED ? 1 : 0.8), 0) / Math.max(1, edges.length), 2),
        playerInvolvement: decisions.length ? "DIRECT" : "NONE_CONFIRMED",
        playerDecisionIds: decisions.map((d) => d.id),
      });
    }
    state.storyClusters = clusters;
    return getStories();
  }

  function hashString(input) {
    let h = 2166136261;
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  function getStoryIdsForNode(nodeId) {
    if (!nodeId) return [];
    return [...state.storyClusters.values()].filter((s) => s.nodeIds.includes(nodeId)).map((s) => s.id);
  }

  function getCausalGraph() {
    return {
      nodes: [...state.causalGraph.nodes.values()].map(deepClone),
      edges: [...state.causalGraph.edges.values()].map(deepClone),
    };
  }

  function getCausalCandidates() {
    return [...state.provenanceLedger.candidates.values()].map(deepClone);
  }

  function getProvenanceLedger() {
    return {
      facts: [...state.provenanceLedger.facts.values()].map(deepClone),
      claims: [...state.provenanceLedger.claims.values()].map(deepClone),
      candidates: getCausalCandidates(),
      rejectedClaims: deepClone(state.provenanceLedger.rejectedClaims),
    };
  }

  function getStories() {
    return [...state.storyClusters.values()].map(deepClone).sort((a, b) => b.lastUpdatedTurn - a.lastUpdatedTurn);
  }

  function nodeTimelineTitle(node) {
    if (node.kind === "player_decision") return `Your decision: ${node.title}`;
    if (node.kind === "player_action") return `Action ordered: ${node.title}`;
    return node.title || SITUATION_TITLES[node.type] || String(node.type || "World change").replaceAll("_", " ");
  }

  function getStorySummary(storyId, gameState = null) {
    const story = state.storyClusters.get(storyId);
    if (!story) return null;
    const nodes = story.nodeIds.map((id) => state.causalGraph.nodes.get(id)).filter(Boolean)
      .sort((a, b) => (a.effectiveFrom ?? a.startTurn ?? a.turn ?? 0) - (b.effectiveFrom ?? b.startTurn ?? b.turn ?? 0));
    const edges = story.edgeIds.map((id) => state.causalGraph.edges.get(id)).filter(Boolean);
    const playerDecisions = nodes.filter((n) => n.kind === "player_decision").map((n) => ({
      nodeId: n.id,
      turn: n.effectiveFrom,
      eventId: n.eventId,
      choiceId: n.choiceId,
      text: n.title,
    }));
    return {
      ...deepClone(story),
      playerDecisions,
      playerInvolvement: playerDecisions.length ? "DIRECT" : "NONE_CONFIRMED",
      timeline: nodes.map((n) => ({
        turn: n.effectiveFrom ?? n.startTurn ?? n.turn,
        kind: n.kind,
        type: n.type,
        locationId: n.locationId,
        title: nodeTimelineTitle(n),
        severity: n.severity,
        active: n.active,
        sourceModule: n.sourceModule,
      })),
      causalLinks: edges.map((e) => ({
        from: e.from,
        to: e.to,
        relation: e.relation,
        mechanism: e.mechanism,
        evidenceLevel: e.evidenceLevel,
        contribution: e.contribution,
        claimId: e.claimId,
      })),
      latest: nodes.at(-1) || null,
      gameTurn: gameState ? nowTurn(gameState) : null,
    };
  }

  // Records observations only. It never advances a scripted chain.
  function recordWorldObservations(gameState) {
    const turn = nowTurn(gameState);
    const mineOpen =
      gameState?.development?.facilities?.some?.((f) => f.type === "COAL_MINE" && f.status === "operational") ||
      gameState?.facilities?.some?.((f) => f.type === "COAL_MINE" && f.status === "operational");
    if (mineOpen && !getFlag("observations.coalMineOpened")) {
      setFlag("observations.coalMineOpened", true);
      setFlag("observations.coalMineOpenedTurn", turn);
      addFeed(gameState, {
        type: "WORLD_OBSERVATION",
        title: "Coal Mine Opens",
        text: "Coal production has begun. Any later transport, industrial, migration or trade effects must come from the simulation itself.",
      });
      recordHistory(gameState, { type: "WORLD_FACT", factType: "COAL_MINE_OPENED", event: "mine_opened" });
    }

    for (const issue of getActiveIssues()) {
      const memoryKey = `observedIssue:${issue.id}`;
      if (getFlag(memoryKey)) continue;
      setFlag(memoryKey, true);
      recordHistory(gameState, {
        type: "WORLD_FACT",
        factType: issue.type,
        issueId: issue.id,
        locationId: issue.locationId,
        causes: deepClone(issue.causes),
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Public update loop
  // ---------------------------------------------------------------------------

  async function update(gameState) {
    if (!state.initialized) init();
    collectIssues(gameState);
    emitMinorFeedUpdates(gameState);
    recordWorldObservations(gameState);
    buildCausalLinks(gameState);
    const stories = detectStoryClusters(gameState);
    const firedConsequences = await processConsequences(gameState);
    const triggeredEvents = checkEventTriggers(gameState);

    // Decrement-like cleanup is represented by absolute turn cooldowns.
    for (const [key, until] of state.cooldowns.entries()) {
      if (until < nowTurn(gameState) - 20) state.cooldowns.delete(key);
    }

    return {
      turn: nowTurn(gameState),
      activeIssues: getActiveIssues(),
      situations: generateSituations(gameState),
      triggeredEvents,
      firedConsequences,
      stories,
      queueLength: state.eventQueue.length,
      nextEvent: state.activeEvent || state.eventQueue[0] || null,
      feed: getFeed(),
    };
  }

  // ---------------------------------------------------------------------------
  // Debugger
  // ---------------------------------------------------------------------------

  function getDebuggerSnapshot(gameState) {
    const turn = nowTurn(gameState);return {
      turn,
      activeIssues: getActiveIssues().map((i) => ({
        id: i.id,
        type: i.type,
        location: i.locationId,
        severity: i.severity,
        severityLabel: getSeverityLabel(i.severity),
        causes: i.causes,
        causedBy: i.causedBy,
        evidence: i.evidence,
        episodeId: i.episodeId,
        storyIds: getStoryIdsForNode(i.episodeId),
        playerContext: playerContextForIssue(i),
      })),
      causalGraph: getCausalGraph(),
      provenanceLedger: getProvenanceLedger(),
      causalCandidates: getCausalCandidates(),
      stories: getStories(),
      triggeredEvents: deepClone(state.debug.triggerLog),
      eventQueue: state.eventQueue.map((e) => ({
        event: e.eventId,
        title: e.title,
        priority: e.priority,
        status: e.status,
        issueId: e.issueId,
      })),
      activeEvent: state.activeEvent ? {
        event: state.activeEvent.eventId,
        title: state.activeEvent.title,
        priority: state.activeEvent.priority,
        status: state.activeEvent.status,
      } : null,
      consequences: state.consequences.map((c) => ({
        id: c.id,
        sourceEvent: c.sourceEventId,
        conditions: c.conditions,
        scheduledResult: c.resultEventId || c.adapter,
        earliestTurn: c.earliestTurn,
        active: c.active,
      })),
      flags: deepClone(state.flags),
      cooldowns: [...state.cooldowns.entries()].map(([event, until]) => ({
        event,
        remainingTurns: Math.max(0, until - turn),
      })),
      adapterWarnings: deepClone(state.debug.adapterWarnings),
    };
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  function serialize() {
    return {
      version: VERSION,
      issues: [...state.issueIndex.entries()],
      eventQueue: deepClone(state.eventQueue),
      activeEvent: deepClone(state.activeEvent),
      consequences: deepClone(state.consequences),
      cooldowns: [...state.cooldowns.entries()],
      eventMemory: [...state.eventMemory.entries()],
      feed: deepClone(state.feed),
      history: deepClone(state.history),
      flags: deepClone(state.flags),
      causalGraph: {
        nodes: [...state.causalGraph.nodes.entries()],
        edges: [...state.causalGraph.edges.entries()],
      },
      provenanceLedger: {
        facts: [...state.provenanceLedger.facts.entries()],
        claims: [...state.provenanceLedger.claims.entries()],
        candidates: [...state.provenanceLedger.candidates.entries()],
        rejectedClaims: deepClone(state.provenanceLedger.rejectedClaims),
      },
      storyClusters: [...state.storyClusters.entries()],
    };
  }

  function hydrate(saved) {
    if (!saved) return;
    state.issueIndex = new Map(saved.issues || []);
    state.eventQueue = safeArray(saved.eventQueue);
    state.activeEvent = saved.activeEvent || null;
    state.consequences = safeArray(saved.consequences);
    state.cooldowns = new Map(saved.cooldowns || []);
    state.eventMemory = new Map(saved.eventMemory || []);
    state.feed = safeArray(saved.feed);
    state.history = safeArray(saved.history);
    state.flags = saved.flags || {};
    state.causalGraph = {
      nodes: new Map(saved.causalGraph?.nodes || []),
      edges: new Map(saved.causalGraph?.edges || []),
    };
    state.provenanceLedger = {
      facts: new Map(saved.provenanceLedger?.facts || saved.causalGraph?.nodes || []),
      claims: new Map(saved.provenanceLedger?.claims || []),
      candidates: new Map(saved.provenanceLedger?.candidates || []),
      rejectedClaims: safeArray(saved.provenanceLedger?.rejectedClaims),
    };
    state.storyClusters = new Map(saved.storyClusters || []);
  }

  // ---------------------------------------------------------------------------
  // Init/config/public getters
  // ---------------------------------------------------------------------------

  function init(options = {}) {
    state.config = { ...DEFAULTS, ...(options.config || {}) };
    state.adapters = { ...(options.adapters || state.adapters || {}) };
    if (options.savedState) hydrate(options.savedState);
    state.initialized = true;
    return api;
  }

  function setAdapters(adapters = {}) {
    state.adapters = { ...state.adapters, ...adapters };
  }

  function acknowledgeIssue(issueId) {
    const issue = state.issueIndex.get(issueId);
    if (!issue) return false;
    issue.acknowledged = true;
    return true;
  }

  function getCurrentSituations(gameState) {
    return generateSituations(gameState);
  }

  function getHistoryEntries(filter = {}) {
    return state.history.filter((h) => {
      if (filter.type && h.type !== filter.type) return false;
      if (filter.eventId && h.eventId !== filter.eventId) return false;
      if (filter.sinceTurn != null && h.turn < filter.sinceTurn) return false;
      return true;
    });
  }

  function getFeed() {
    return deepClone(state.feed);
  }

  function getFlags() {
    return deepClone(state.flags);
  }

  function getCooldowns(gameState) {
    const turn = nowTurn(gameState);
    return [...state.cooldowns.entries()].map(([key, until]) => ({ key, until, remainingTurns: Math.max(0, until - turn) }));
  }

  function getEventDefinitions() {
    return EVENT_DEFS;
  }

  // Public API requested by specification.
  const api = {
    VERSION,
    PRESENTATION,
    CAUSAL_EVIDENCE,
    init,
    setAdapters,
    update,
    collectIssues,
    updateIssueSeverity,
    generateSituations,
    checkEventTriggers,
    queueEvent,
    getNextEvent,
    resolveChoice,
    scheduleConsequence,
    processConsequences,
    getCurrentSituations,
    getHistoryEntries,
    getDebuggerSnapshot,
    acknowledgeIssue,
    getFeed,
    getFlags,
    getCooldowns,
    getEventDefinitions,
    buildCausalLinks,
    registerCausalFact,
    submitCausalClaim,
    validateCausalClaim,
    detectStoryClusters,
    getCausalGraph,
    getCausalCandidates,
    getProvenanceLedger,
    getStories,
    getStorySummary,
    serialize,
    hydrate,
    getActiveIssues,
  };

  return api;
})();

/*
==============================================================================
EMERGENT STORY MODEL (v1.2) — PROVENANCE FIRST
==============================================================================

HARD RULE:
Module 7 may discover relationships, but it may not invent causality.
A player-facing causal statement must come from a validated CausalClaim issued
by the module that calculated the effect.

There are three evidence levels:

1. SOURCE_CONFIRMED
   The module that calculated the effect explicitly identifies its causal inputs.
   This may enter the formal causal graph and may be shown to the player.

2. MODEL_SUPPORTED
   The effect-producing module reports a supported model contribution rather
   than a fully deterministic cause. This may enter the formal graph, but UI
   wording should use language such as "was an important driver" rather than
   claiming sole causation.

3. CANDIDATE
   Module 7 notices a temporal/spatial/type pattern only. Candidate relations
   NEVER enter the formal causal graph, NEVER merge stories, and NEVER justify
   player-facing "because" language.

The formal flow is:

world facts / issue episodes
        ↓
producer CausalClaims
        ↓
validateCausalClaim()
        ↓
validated Provenance Ledger
        ↓
formal causal graph
        ↓
detectStoryClusters()
        ↓
player-facing emergent stories

PLAYER PARTICIPATION
--------------------
Every resolved player choice receives a stable causalDecisionRef.
Every adapter command receives a causalActionRef.

Module 7 confirms only:

PLAYER_DECISION -> ACTION_COMMAND

It does NOT automatically connect the action to later economic/social outcomes.
Modules 2–6 receive both refs in adapter payloads and should cite causalActionRef
(or a later fact derived from it) in their own CausalClaims when the action
actually changes the world.

This produces a trace such as:

PLAYER_DECISION
  -> ACTION_COMMAND
  -> PROJECT_STARTED          // confirmed by Module 2
  -> PROJECT_COMPLETED        // confirmed by Module 2
  -> INDUSTRIAL_JOBS_RISE     // confirmed by Module 3
  -> MIGRATION_SURGE          // confirmed by Module 4
  -> HOUSING_PRESSURE         // confirmed by Module 4

Only links actually reported and validated exist. If a railway is built but
never creates industrial growth, the story simply stops there.

ISSUE EPISODES
--------------
A stable issue ID identifies the underlying issue type/location, for example:

  HOUSING_PRESSURE:westhaven

Each separate recurrence receives a distinct episodeId:

  HOUSING_PRESSURE:westhaven::episode:1
  HOUSING_PRESSURE:westhaven::episode:2

Formal causality points to episodeId, not the permanent issue ID. Therefore a
housing problem in Year 6 cannot accidentally inherit the causes of a different
housing problem in Year 18.

CAUSAL CLAIM FORMAT
-------------------
Preferred claim:

{
  id: "claim_housing_westhaven_12",
  effectRef: "HOUSING_PRESSURE:westhaven::episode:3",
  mechanism: "housing_demand_exceeds_supply",
  inputs: [
    {
      ref: "migration_westhaven_t12",
      role: "demand_growth",
      contribution: 0.58
    },
    {
      ref: "housing_supply_shortfall_westhaven_t12",
      role: "supply_constraint",
      contribution: 0.42
    }
  ],
  evidenceLevel: "SOURCE_CONFIRMED",
  evidence: { populationGrowthPct: 14, housingGrowthPct: 5 },
  provenance: ["population-calculation-12"],
  effectiveTurn: 12
}

VALIDATION GATE
---------------
A formal CausalClaim must pass all of these:

- effect exists
- every input exists
- source module is the module that calculated the effect
- cause does not begin after the effect
- mechanism owner is valid when a mechanism owner is defined
- direct causal lag is within the mechanism/default limit
- evidence level is SOURCE_CONFIRMED or MODEL_SUPPORTED

Failure never silently becomes causality. A plausible but unverified relation is
stored in candidateRelations for debugging/discovery only.

Producer APIs / Module 7 APIs:
- registerCausalFact(fact, sourceModule, gameState)
- submitCausalClaim(claim, sourceModule, gameState, defaultEffectRef?)
- validateCausalClaim(claim, gameState)
- buildCausalLinks(gameState)
- detectStoryClusters(gameState)
- getCausalGraph()
- getCausalCandidates()
- getProvenanceLedger()
- getStories()
- getStorySummary(storyId, gameState?)

==============================================================================
EXPECTED ISSUE FORMATS FROM MODULES 3–6
==============================================================================

Common format (recommended for every producer):

{
  id: "housing_westhaven",               // strongly recommended stable ID
  type: "HOUSING_PRESSURE",              // required
  sourceModule: "population",            // economy | population | trade | ai
  locationId: "westhaven",               // city/region; optional for national
  countryId: "asteria",                  // optional
  counterpartyId: "meridian",            // optional for foreign issues
  severity: 0.72,                         // required: 0..1
  causes: ["rapid_migration", "insufficient_housing"],
  evidence: {                             // raw/model evidence for the issue
    populationGrowthPct: 18,
    housingGrowthPct: 7
  },
  affectedGroups: [
    { group: "industrial_workers", impact: -0.6 }
  ],
  causalClaims: [                         // preferred; effectRef may be omitted
    {
      mechanism: "housing_demand_exceeds_supply",
      inputs: [{ ref: "migration_westhaven_t12", role: "demand_growth" }],
      evidenceLevel: "SOURCE_CONFIRMED"
    }
  ],
  metrics: {                              // event text should use these values
    populationGrowthPct: 18,
    rentVsNationalPct: 27,
    housingCapacityRatio: 0.86
  },
  context: {                              // semantic, non-numeric metadata
    driverName: "the opening of the steelworks",
    strategicImportance: 0.7
  },
  createdTurn: 8,                         // optional; M7 can fill it
  active: true,
  tags: ["urban", "labor"]
}

Severity interpretation:
  0.00–0.24 minor
  0.25–0.49 noticeable
  0.50–0.74 serious
  0.75–1.00 critical

----------------------
MODULE 3 — ECONOMY
----------------------

TRANSPORT_BOTTLENECK
Recommended metrics:
{
  freightDemand: 140,
  transportCapacity: 95,
  blockedOutputShare: 0.18,
  affectedGoods: ["coal", "steel"]
}
Recommended causes:
["mine_output_growth", "insufficient_rail_capacity"]

POWER_SHORTAGE
metrics: {
  powerDemand: 120,
  powerSupply: 92,
  shortageShare: 0.233,
  affectedFacilities: ["steelworks_westhaven"]
}

INPUT_SHORTAGE
metrics: {
  goodId: "iron_ore",
  required: 80,
  available: 54,
  shortageShare: 0.325
}

FISCAL_DEFICIT
metrics: {
  revenue: 92,
  expenditure: 118,
  deficit: 26,
  deficitToRevenue: 0.283
}

HIGH_DEBT
metrics: {
  publicDebt: 220,
  debtToRevenue: 2.1,
  interestCost: 18
}

Optional story signals from Module 3:
COAL_DISCOVERY
INDUSTRIAL_OPPORTUNITY
FACTORY_LAYOFFS

----------------------
MODULE 4 — POPULATION
----------------------

HOUSING_PRESSURE
metrics: {
  population: 250000,
  housingCapacity: 220000,
  housingGap: 30000,
  populationGrowthPct: 18,
  rentVsNationalPct: 27
}
context: {
  driverName: "the opening of the steelworks"
}

HIGH_UNEMPLOYMENT
metrics: {
  unemploymentRate: 0.14,
  unemployedWorkers: 32000,
  nationalRate: 0.07
}

LABOR_SHORTAGE
metrics: {
  vacancies: 18000,
  availableWorkers: 9000,
  wagePressurePct: 12
}

REGIONAL_DECLINE
metrics: {
  outputChangePct: -8,
  populationChangePct: -5,
  employmentChangePct: -7
}

REGIONAL_INEQUALITY
metrics: {
  growthGapPct: 11,
  incomeGapPct: 22
}
context: {
  fastRegions: ["northwest", "eastern_coast"],
  slowRegions: ["southern_plains"]
}

LOW_LIVING_STANDARD
metrics: {
  realIncomeIndex: 78,
  housingCostBurden: 0.39,
  essentialGoodsAffordability: 0.71
}

Optional story signal:
MIGRATION_SURGE
metrics: {
  netMigration: 22000,
  migrationRate: 0.08
}

----------------------
MODULE 5 — TRADE / DIPLOMACY
----------------------

TRADE_DEPENDENCE
metrics: {
  exportShare: 0.58,
  importShare: 0.12,
  sector: "coal"
}
counterpartyId: "meridian"

IMPORT_SHORTAGE
metrics: {
  goodId: "machine_tools",
  normalImports: 70,
  currentImports: 35,
  shortageShare: 0.5
}

EXPORT_CONCENTRATION
metrics: {
  exportShare: 0.63,
  sector: "coal"
}
context: {
  topPartnerId: "meridian"
}

DIPLOMATIC_TENSION
metrics: {
  relationScore: 18,
  previousRelationScore: 34
}

INVESTMENT_DEPENDENCE
metrics: {
  foreignOwnershipShare: 0.56,
  strategicSectorShare: 0.61
}

----------------------
MODULE 6 — AI COUNTRIES
----------------------

FOREIGN_COMPETITION
metrics: {
  importPriceAdvantagePct: 16,
  domesticProfitabilityChangePct: -12,
  marketShareLostPct: 9
}

AI_TRADE_OFFER / AI_COUNTEROFFER
counterpartyId: "meridian"
context: {
  offerType: "LONG_TERM_COAL_CONTRACT",
  durationTurns: 10,
  exportShareRequested: 0.40,
  priceFormula: "market_minus_3pct",
  strategicImportance: 0.8
}

AI_INVESTMENT_OFFER
context: {
  assetType: "COAL_MINE",
  investmentAmount: 55,
  requestedOwnershipShare: 0.51,
  strategicImportance: 0.8
}

AI_ECONOMIC_PRESSURE
metrics: {
  tariffIncreasePct: 15,
  exposedExportsShare: 0.32
}
context: {
  pressureType: "tariff_threat",
  demand: "preferred_coal_access"
}

==============================================================================
REQUIRED ADAPTERS
==============================================================================

Module 7 should be initialized with adapters that call the real functions from
Modules 2–6. Example:

IssuesEvents.init({
  adapters: {
    "development.startProject": async (payload, gameState) => {
      return Development.startProject({
        type: payload.projectType,
        locationId: payload.locationId,
        funding: payload.funding
      });
    },

    "economy.applyPolicy": async (payload, gameState) => {
      return Economy.applyPolicy(payload.policy, payload);
    },

    "population.applyHousingPolicy": async (payload, gameState) => {
      return Population.applyHousingPolicy(payload.policy, payload.locationId);
    },

    "population.applyLaborPolicy": async (payload, gameState) => {
      return Population.applyLaborPolicy(payload.policy, payload.locationId);
    },

    "trade.changeTariff": async (payload, gameState) => {
      return TradeDiplomacy.changeTariff(payload);
    },

    "trade.resolveOffer": async (payload, gameState) => {
      return TradeDiplomacy.resolveOffer(payload.context?.offerId, payload.response);
    },

    "trade.acceptForeignInvestment": async (payload, gameState) => {
      return TradeDiplomacy.acceptInvestment(payload);
    },

    "trade.applyStrategy": async (payload, gameState) => {
      return TradeDiplomacy.applyStrategy(payload.strategy, payload);
    },

    "trade.renegotiateInvestment": async (payload, gameState) => {
      return TradeDiplomacy.renegotiateInvestment(payload);
    },

    // Optional: lets string-based delayed consequence conditions be resolved
    // without using eval inside Module 7.
    evaluateCondition: (conditionId, gameState, flags) => {
      return ConsequenceConditions.evaluate(conditionId, gameState, flags);
    },

    // Optional: if your modules do not expose issues directly on gameState.
    collectIssues: (gameState) => [
      ...Economy.getIssues(),
      ...Population.getIssues(),
      ...TradeDiplomacy.getIssues(),
      ...AICountries.getIssues()
    ]
  }
});

Adapter result format can optionally include player-facing feedback:
{
  ok: true,
  feedback: {
    certain: ["Government commits 18 Treasury."],
    expected: ["Housing capacity will rise when construction finishes."],
    possible: ["Borrowing costs may increase if the deficit remains high."]
  }
}

Adapter results should also return causal provenance when the command creates a
real world object/change:

{
  ok: true,
  causalFacts: [
    {
      id: "project:westhaven_housing_12",
      kind: "project",
      type: "PROJECT_STARTED",
      sourceModule: "development",
      locationId: "westhaven",
      effectiveFrom: 12
    }
  ],
  causalClaims: [
    {
      effectRef: "project:westhaven_housing_12",
      mechanism: "project_authorized",
      inputs: [{ ref: payload.causalActionRef, role: "authorized_by" }],
      evidenceLevel: "SOURCE_CONFIRMED"
    }
  ]
}

Module 7 supplies these refs in every adapter payload:
- payload.causalDecisionRef
- payload.causalActionRef

Modules must preserve/reference them when they are genuinely part of the causal
path. Do not cite them merely because the events happened near each other in time.

==============================================================================
MODULE 8 INTEGRATION
==============================================================================

Main turn/year loop:

await IssuesEvents.update(gameState);

Right-side current situations panel:

const cards = IssuesEvents.getCurrentSituations(gameState);

Decision modal:

const event = IssuesEvents.getNextEvent();
if (event && event.level >= IssuesEvents.PRESENTATION.DECISION) {
  UI.openDecisionEvent(event);
}

On player choice:

const result = await IssuesEvents.resolveChoice(event.instanceId, choiceId, gameState);
UI.showDecisionFeedback(result.feedback);

Feed:

UI.renderFeed(IssuesEvents.getFeed());

Debugger:

UI.renderModule7Debugger(IssuesEvents.getDebuggerSnapshot(gameState));

Save game:

gameState.modules.module7 = IssuesEvents.serialize();

Load game:

IssuesEvents.init({
  adapters,
  savedState: gameState.modules.module7
});

==============================================================================
TEST SCENARIO — EXPECTED DATA FLOW
==============================================================================

Year N:
1. Player develops coal mine through a Module 7 event.
2. Module 2 creates the project; later it becomes operational.
3. Module 3 increases coal production and jobs.
4. Module 3 detects freight demand > rail capacity and emits:
   TRANSPORT_BOTTLENECK severity >= 0.55.
5. Module 7 creates a situation card and decision event.
6. Player selects railway construction.
7. Module 7 calls Development.startProject through adapter.
8. Module 2 later completes the railway.
9. Module 3 recalculates freight balance; bottleneck severity falls and then
   stops reporting the issue.
10. Module 7 marks the issue resolved.
11. Steelworks creates jobs.
12. Module 4 produces MIGRATION_SURGE then HOUSING_PRESSURE.
13. At severity >= 0.65 Module 7 creates Housing Crisis.

No story step is created by Module 7; every node must already exist in outputs from the
simulation modules.
*/
if (typeof window!=="undefined") window.IssuesEvents=IssuesEvents; else globalThis.IssuesEvents=IssuesEvents;
/* ===== END MODULE 7 — ISSUES, EVENTS & CONSEQUENCE CHAINS ===== */
