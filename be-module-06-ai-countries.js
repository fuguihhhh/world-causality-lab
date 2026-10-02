/* ===== MODULE 6 — AI COUNTRIES — INLINE INTEGRATED ===== */
/*
============================================================
BORDER EPOCH — MODULE 6
AI COUNTRIES AND STRATEGIC DECISION-MAKING
Version: prototype 1.1 — strategic realism pass

Core rule:
AI countries NEVER receive direct stat bonuses.
They may only change the world by calling Modules 2–5.

Designed for the shared Border Epoch gameState architecture.
============================================================
*/

const CountryAI = (() => {
  "use strict";

  /* ---------------------------------------------------------
     CONFIGURATION
     --------------------------------------------------------- */

  const AI_COUNTRY_IDS = ["meridian", "norvia"];

  const PROFILES = {
    meridian: {
      id: "meridian",
      identity: "Commercial Power",
      personality: {
        tradePreference: 1.30,
        foreignInvestmentPreference: 1.40,
        protectionismPreference: 0.50,
        dependencyAversion: 1.20,
        technologyPreference: 1.00,
        industrialPreference: 0.85,
        infrastructurePreference: 1.10,
        riskTolerance: 0.95
      },
      strategicGoals: [
        { type: "SECURE_RESOURCE_IMPORTS", priority: 1.00 },
        { type: "DIVERSIFY_SUPPLIERS", priority: 0.95 },
        { type: "EXPAND_TRADE_VOLUME", priority: 0.90 },
        { type: "ACQUIRE_FOREIGN_ASSETS", priority: 0.85 }
      ]
    },

    norvia: {
      id: "norvia",
      identity: "Industrial Competitor",
      personality: {
        tradePreference: 0.80,
        foreignInvestmentPreference: 0.70,
        protectionismPreference: 1.30,
        dependencyAversion: 1.10,
        technologyPreference: 0.95,
        industrialPreference: 1.40,
        infrastructurePreference: 1.10,
        riskTolerance: 0.90
      },
      strategicGoals: [
        { type: "INDUSTRIAL_SELF_SUFFICIENCY", priority: 1.00 },
        { type: "EXPAND_STEEL_PRODUCTION", priority: 0.95 },
        { type: "PROTECT_DOMESTIC_MANUFACTURING", priority: 0.85 },
        { type: "LIMIT_RIVAL_MARKET_DOMINANCE", priority: 0.80 }
      ]
    }
  };

  // Compact macro-industry baselines for AI countries that do not yet have
  // a full Module 3 regional economy. These records are explicit foreign
  // economy facts for Module 5, not bonuses to the player country.
  const FOREIGN_INDUSTRY_BASELINES = {
    meridian: {
      tradeCapacity: 90,
      goods: {
        food:               { production: 96, demand: 78, reserve: 4, price: 1.00 },
        coal:               { production: 98, demand: 68, reserve: 5, price: 0.95 },
        iron:               { production: 104, demand: 62, reserve: 5, price: 1.00 },
        steel:              { production: 125, demand: 42, reserve: 8, price: 1.10 },
        manufactured_goods: { production: 95, demand: 42, reserve: 5, price: 1.10 }
      }
    },
    norvia: {
      tradeCapacity: 80,
      goods: {
        food:               { production: 88, demand: 80, reserve: 4, price: 1.02 },
        coal:               { production: 128, demand: 84, reserve: 6, price: 0.92 },
        iron:               { production: 122, demand: 76, reserve: 6, price: 0.98 },
        steel:              { production: 145, demand: 70, reserve: 10, price: 1.05 },
        manufactured_goods: { production: 108, demand: 66, reserve: 6, price: 1.08 }
      }
    }
  };

  const DEFAULTS = {
    maxMajorActionsPerTurn: 1,
    maxMinorActionsPerTurn: 1,
    minimumUtilityToAct: 8,
    nearTieWindow: 6,
    memoryLimit: 60,
    debugCandidateLimit: 18,

    // Dependency concern thresholds.
    dependencyConcern: 0.50,
    dependencySevere: 0.80,

    // Treasury discipline.
    lowTreasuryRatio: 0.12,
    highDebtRatio: 0.70,

    // Need detection thresholds.
    shortageMinor: 0.10,
    shortageMajor: 0.30,
    surplusThreshold: 0.20,
    unemploymentConcern: 0.08,
    unemploymentSevere: 0.16,
    housingConcern: 0.12,
    lowSupport: 0.42,

    // Randomness is deliberately limited.
    tieChoiceRandomness: 0.22,

    // Strategic realism pass.
    planningHorizonTurns: 3,
    fiscalReserveShare: 0.20,
    maxAnnualDevelopmentShare: 0.45,
    maxAnnualForeignCommitmentShare: 0.30,
    severeMarketDominance: 0.60,
    moderateMarketDominance: 0.40
  };

  /* ---------------------------------------------------------
     INTERNAL RUNTIME
     --------------------------------------------------------- */

  const runtime = {
    config: { ...DEFAULTS },
    states: {},
    lastGameState: null,
    adapters: null
  };

  /* ---------------------------------------------------------
     BASIC HELPERS
     --------------------------------------------------------- */

  const clamp = (n, min = 0, max = 1) =>
    Math.max(min, Math.min(max, Number.isFinite(Number(n)) ? Number(n) : 0));

  const num = (v, fallback = 0) =>
    Number.isFinite(Number(v)) ? Number(v) : fallback;

  const arr = value => Array.isArray(value) ? value : [];
  const values = obj => obj ? Object.values(obj) : [];

  function turnNumber(state) {
    // Global Border Epoch contract: one turn is one calendar year.
    return num(state?.turn, num(state?.time?.year, 0));
  }

  function currentTurnLabel(state) {
    if (!state?.time) return "unknown";
    return String(state.time.year ?? state.turn ?? "?");
  }

  function hash32(input) {
    let h = 2166136261 >>> 0;
    const str = String(input);
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }

  function deterministicUnit(state, ...parts) {
    const seed = state?.worldSeed ?? state?.world?.seed ?? "border-epoch";
    return hash32([seed, turnNumber(state), ...parts].join("|")) / 4294967296;
  }

  function makeId(prefix = "ai") {
    makeId.seq = (makeId.seq || 0) + 1;
    const state = runtime.lastGameState;
    return `${prefix}_${turnNumber(state)}_${hash32([state?.worldSeed ?? state?.world?.seed ?? "be", prefix, makeId.seq].join("|" )).toString(36)}`;
  }

  function safeClone(value) {
    try {
      return structuredClone(value);
    } catch {
      return JSON.parse(JSON.stringify(value));
    }
  }

  function hasMeaningfulForeignIndustry(economy) {
    return Object.values(economy?.goods || {}).some(g => {
      if (typeof g === "number") return Number(g) > 0;
      return ["production","output","supply","domesticDemand","demand","consumption"]
        .some(k => Number.isFinite(Number(g?.[k])) && Number(g[k]) > 0);
    });
  }

  function ensureForeignIndustryEconomy(countryId, state = runtime.lastGameState) {
    if (!state || countryId === state.playerCountryId) return null;
    const baseline = FOREIGN_INDUSTRY_BASELINES[countryId];
    if (!baseline) return null;

    state.countries = state.countries || {};
    const country = state.countries[countryId] = state.countries[countryId] || { id: countryId };
    const existing = country.economy || {};

    // Respect any later real foreign economy implementation. This fallback owns
    // the record only while no other module has published meaningful goods.
    if (
      existing.sourceModule !== "module6_foreign_industry" &&
      hasMeaningfulForeignIndustry(existing)
    ) return existing;

    const goods = {};
    for (const [goodId, cfg] of Object.entries(baseline.goods || {})) {
      const production = Math.max(0, num(cfg.production));
      const demand = Math.max(0, num(cfg.demand));
      const consumption = Math.min(production, demand);
      const reserve = Math.max(0, num(cfg.reserve));
      const price = Math.max(0.01, num(cfg.price, 1));
      goods[goodId] = {
        production,
        output: production,
        supply: production,
        domesticDemand: demand,
        demand,
        consumption,
        domesticConsumption: consumption,
        strategicReserveTarget: reserve,
        reserveTarget: reserve,
        price,
        basePrice: price,
        sourceModule: "module6_foreign_industry"
      };
    }

    country.economy = {
      ...existing,
      sourceModule: "module6_foreign_industry",
      macroBaseline: true,
      updatedYear: turnNumber(state),
      goods
    };

    // Foreign states need a declared external gateway until/if a future world
    // model gives them physical ports. Module 5 still applies route capacity.
    if (!(Number(country.tradeCapacity) > 0)) country.tradeCapacity = baseline.tradeCapacity;

    return country.economy;
  }

  function getForeignIndustryMonitor(countryId, state = runtime.lastGameState) {
    if (!state) return null;
    const economy = ensureForeignIndustryEconomy(countryId, state);
    if (!economy) return null;

    const now = turnNumber(state);
    const goods = {};
    for (const [goodId, g] of Object.entries(economy.goods || {})) {
      const production = Math.max(0, num(g.production));
      const demand = Math.max(0, num(g.domesticDemand, num(g.demand)));
      const consumption = Math.max(0, num(g.consumption, Math.min(production, demand)));
      const reserve = Math.max(0, num(g.strategicReserveTarget, num(g.reserveTarget)));
      const grossSurplus = Math.max(0, production - consumption - reserve);
      const committedExports = values(state.tradeContracts).filter(c =>
        c && c.status === "active" &&
        c.exporterCountryId === countryId &&
        c.goodId === goodId &&
        now >= num(c.startYear) &&
        now <= num(c.endYear)
      ).reduce((sum, c) => sum + Math.max(0, num(c.contractedVolume)), 0);
      goods[goodId] = {
        production,
        demand,
        consumption,
        reserve,
        grossSurplus,
        committedExports,
        exportableSupply: Math.max(0, grossSurplus - committedExports),
        price: Math.max(0.01, num(g.price, 1))
      };
    }

    return {
      countryId,
      identity: PROFILES[countryId]?.identity || countryId,
      year: now,
      sourceModule: economy.sourceModule,
      tradeCapacity: Math.max(0, num(state.countries?.[countryId]?.tradeCapacity)),
      goods
    };
  }

  function refreshForeignIndustryMonitor(state = runtime.lastGameState) {
    if (!state) return {};
    state.ai = state.ai || {};
    state.ai.foreignIndustryMonitor = state.ai.foreignIndustryMonitor || {};
    for (const id of AI_COUNTRY_IDS) {
      if (!state.countries?.[id]) continue;
      ensureForeignIndustryEconomy(id, state);
      state.ai.foreignIndustryMonitor[id] = getForeignIndustryMonitor(id, state);
    }
    return state.ai.foreignIndustryMonitor;
  }

  function ownerOfFacility(f) {
    return f?.countryId ?? f?.ownerCountryId ?? null;
  }

  function ownerOfProject(p) {
    return p?.ownerCountryId ?? p?.countryId ?? null;
  }

  function ownerOfRegion(r) {
    return r?.countryId ?? r?.ownerCountryId ?? null;
  }

  function ownerOfCity(c) {
    return c?.countryId ?? c?.ownerCountryId ?? null;
  }

  function goodFromResourceSite(site) {
    const t = String(site?.goodId ?? site?.resourceId ?? site?.type ?? "").toLowerCase();
    if (t.includes("coal")) return "coal";
    if (t.includes("iron")) return "iron";
    if (t.includes("oil")) return "oil";
    if (t.includes("gas")) return "gas";
    if (t.includes("food") || t.includes("farm")) return "food";
    return site?.goodId ?? site?.resourceId ?? null;
  }

  function facilityProducesGood(f) {
    const t = String(f?.type ?? "").toLowerCase();
    if (f?.outputGoodId) return f.outputGoodId;
    if (t.includes("coal_mine")) return "coal";
    if (t.includes("iron_mine")) return "iron";
    if (t.includes("steel")) return "steel";
    if (t.includes("factory")) return "manufactured_goods";
    if (t.includes("power")) return "power";
    return null;
  }

  function isMajorAction(action) {
    return [
      "START_PROJECT",
      "UPGRADE_FACILITY",
      "UPGRADE_CONNECTION",
      "PROPOSE_TRADE",
      "PROPOSE_INVESTMENT",
      "END_TRADE"
    ].includes(action?.type);
  }

  function normalizeScore(v) {
    // Maps arbitrary positive magnitudes into 0..1 without exploding.
    const x = Math.max(0, num(v));
    return x / (x + 25);
  }

  function relationNormalized(raw) {
    const x = num(raw, 0);
    if (x >= -1 && x <= 1) return clamp((x + 1) / 2);
    if (x >= 0 && x <= 100) return clamp(x / 100);
    if (x >= -100 && x <= 100) return clamp((x + 100) / 200);
    return 0.5;
  }

  function treasuryNormalized(finance) {
    const treasury = Math.max(0, num(finance?.treasury));
    const revenue = Math.max(1, num(finance?.revenue, 100));
    return clamp(treasury / (revenue * 4));
  }

  function costPressure(cost, finance) {
    const treasury = Math.max(1, num(finance?.treasury, 1));
    return clamp(num(cost) / treasury);
  }

  function emitAIEvent(state, event) {
    if (!state) return;
    state.events = Array.isArray(state.events) ? state.events : [];
    const full = {
      id: event.id || makeId("ai_event"),
      turn: currentTurnLabel(state),
      source: "CountryAI",
      ...event
    };
    state.events.push(full);
    return full;
  }

  /* ---------------------------------------------------------
     STATE INITIALIZATION
     --------------------------------------------------------- */

  function createDecisionState(countryId) {
    const profile = PROFILES[countryId] || {
      id: countryId,
      identity: "Adaptive State",
      personality: {
        tradePreference: 1,
        foreignInvestmentPreference: 1,
        protectionismPreference: 1,
        dependencyAversion: 1,
        technologyPreference: 1,
        industrialPreference: 1,
        infrastructurePreference: 1,
        riskTolerance: 1
      },
      strategicGoals: []
    };

    return {
      countryId,
      identity: profile.identity,
      personality: safeClone(profile.personality),
      currentNeeds: [],
      strategicGoals: safeClone(profile.strategicGoals),
      perceivedOpportunities: [],
      perceivedThreats: [],
      activePlans: [],
      decisionMemory: [],
      lastObservation: null,
      candidateActions: [],
      lastDecision: null,
      lastProposalEvaluation: null,
      diagnostics: {
        skippedReasons: [],
        adapterWarnings: []
      }
    };
  }

  function ensureState(countryId) {
    if (!runtime.states[countryId]) {
      runtime.states[countryId] = createDecisionState(countryId);
    }
    return runtime.states[countryId];
  }

  function initialize(gameState = window.gameState) {
    runtime.lastGameState = gameState;
    runtime.adapters = makeAdapters();

    for (const id of AI_COUNTRY_IDS) {
      ensureState(id);
      if (gameState?.countries?.[id]) ensureForeignIndustryEconomy(id, gameState);
    }

    if (gameState) {
      gameState.ai = gameState.ai || {};
      gameState.ai.countries = gameState.ai.countries || {};
      for (const id of AI_COUNTRY_IDS) {
        gameState.ai.countries[id] = runtime.states[id];
      }
      refreshForeignIndustryMonitor(gameState);
    }

    return runtime.states;
  }

  /* ---------------------------------------------------------
     MODULE ADAPTERS
     Keeps the AI core independent from exact implementation names.
     --------------------------------------------------------- */

  function makeAdapters() {
    const W = typeof window !== "undefined" ? window : globalThis;

    const get = name => W?.[name];

    return {
      development: {
        available() {
          return !!get("Development");
        },

        canStartProject(def, state) {
          const D = get("Development");
          if (!D?.startProject) return { ok: false, missing: ["Development.startProject unavailable"] };
          if (D.canStartProject) return D.canStartProject(def, state);
          const type = String(def?.type || "");
          const facility = D.definitions?.FACILITY_LEVELS?.[type];
          const defaults = { basic_factory:[14,2], steelworks:[28,3], power_plant:[18,2], port:[24,3] };
          if (defaults[type]) {
            const [cost,totalTurns] = defaults[type];
            return { ok:true, definition:{ ...def, countryId:def.countryId ?? def.ownerCountryId, cost:num(def.cost,cost), totalTurns:num(def.totalTurns,totalTurns) } };
          }
          if (type === "railway" && def?.fromId && def?.toId) return { ok:true, definition:{...def,cost:num(def.cost,18),totalTurns:num(def.totalTurns,2)} };
          if ((type === "coal_mine" || type === "iron_mine") && def?.depositId && D.canDevelopDeposit) return D.canDevelopDeposit(def.depositId, state);
          if (facility && type !== "coal_mine" && type !== "iron_mine") return { ok:true, definition:{...def,cost:num(def.cost,10),totalTurns:num(def.totalTurns,2)} };
          return { ok:false, error:`Module 2 cannot start project type '${type}' with the supplied physical prerequisites.` };
        },

        startProject(def, state) {
          const D = get("Development");
          if (!D?.startProject) return { ok: false, error: "Development.startProject unavailable" };
          return D.startProject(def, state);
        },

        startFacilityUpgrade(id, state) {
          const D = get("Development");
          if (!D?.startFacilityUpgrade) return { ok: false, error: "Development.startFacilityUpgrade unavailable" };
          return D.startFacilityUpgrade(id, state);
        },

        startConnectionUpgrade(id, state) {
          const D = get("Development");
          if (!D?.startConnectionUpgrade) return { ok: false, error: "Development.startConnectionUpgrade unavailable" };
          return D.startConnectionUpgrade(id, state);
        }
      },

      economy: {
        available() {
          return !!get("Economy");
        },

        update(state) {
          return get("Economy")?.update?.(state);
        },

        country(countryId, state) {
          const E = get("Economy");
          // Prefer the explicit shared-state snapshot when present. This keeps
          // savegames/tests deterministic and avoids reading a stale singleton
          // from Module 3 when evaluating an alternate snapshot.
          return (
            state?.economy?.countries?.[countryId] ??
            state?.economy?.[countryId] ??
            E?.getCountryEconomy?.(countryId, state) ??
            {}
          );
        },

        goodBalance(countryId, goodId, state) {
          const E = get("Economy");
          // Shared-state snapshots are authoritative when they contain the
          // requested country/good. Only fall back to Module 3's singleton API
          // when the snapshot omits it.
          const explicit =
            state?.economy?.countries?.[countryId]?.goods?.[goodId] ??
            state?.economy?.countries?.[countryId]?.goodBalances?.[goodId] ??
            state?.economy?.goods?.[countryId]?.[goodId];
          if (explicit != null) return normalizeGoodBalance(explicit, goodId);

          const countryEcon = E?.getCountryEconomy?.(countryId, state);
          const countryGood = countryEcon?.goods?.[goodId];
          if (countryGood != null) return normalizeGoodBalance(countryGood, goodId);
          const direct = E?.getGoodBalance?.(goodId);
          if (direct != null && countryId === state?.playerCountryId) return normalizeGoodBalance(direct, goodId);

          const econ = this.country(countryId, state);
          return normalizeGoodBalance(econ?.goods?.[goodId] ?? econ?.goodBalances?.[goodId] ?? {}, goodId);
        },

        finance(countryId, state) {
          const E = get("Economy");
          return (
            state?.economy?.finance?.[countryId] ??
            state?.economy?.countries?.[countryId]?.finance ??
            E?.getGovernmentFinance?.(countryId, state) ??
            this.country(countryId, state)?.finance ??
            {}
          );
        },

        bottlenecks(countryId, state) {
          const E = get("Economy");
          const raw = arr(E?.getBottlenecks?.() ?? this.country(countryId, state)?.bottlenecks ?? []);
          return raw.filter(b => {
            const f = state?.facilities?.[b.facilityId];
            const owner = f?.countryId ?? f?.ownerCountryId ?? state?.regions?.[f?.regionId]?.countryId;
            return !owner || owner === countryId;
          });
        },

        canAfford(countryId, amount, state) {
          const E = get("Economy");
          if (E?.canGovernmentAfford) return E.canGovernmentAfford(countryId, amount, state);
          const f = this.finance(countryId, state);
          return { ok: num(f.treasury) >= num(amount), available: num(f.treasury) };
        },

        reserveFunds(countryId, amount, purpose, state) {
          const E = get("Economy");
          if (E?.reserveGovernmentFunds) {
            return E.reserveGovernmentFunds(countryId, amount, purpose, state);
          }
          // AI never mutates treasury directly. Missing payment authority is reported.
          return { ok: true, deferredToExecutingModule: true, amount, purpose };
        }
      },

      population: {
        available() {
          return !!get("Population");
        },

        country(countryId, state) {
          const P = get("Population");
          return (
            state?.population?.countries?.[countryId] ??
            state?.society?.countries?.[countryId] ??
            P?.getCountrySociety?.(countryId, state) ??
            {}
          );
        },

        publicSupport(countryId, state) {
          const P = get("Population");
          const raw =
            P?.getPublicSupport?.(countryId, state) ??
            this.country(countryId, state)?.publicSupport ??
            0.55;
          if (raw && typeof raw === "object") {
            const value = raw.publicSupport ?? raw.support ?? raw.value ?? 50;
            return clamp(num(value,50) > 1 ? num(value,50) / 100 : num(value,.5));
          }
          return clamp(num(raw,.55) > 1 ? num(raw,.55) / 100 : num(raw,.55));
        },

        socialIssues(countryId, state) {
          const P = get("Population");
          return arr(
            P?.getSocialIssues?.(countryId, state) ??
            this.country(countryId, state)?.issues ??
            []
          );
        }
      },

      trade: {
        available() {
          return !!get("TradeDiplomacy");
        },

        update(state) {
          return get("TradeDiplomacy")?.update?.(state);
        },

        imports(countryId, state) {
          const T = get("TradeDiplomacy");
          const explicit = state?.trade?.imports?.[countryId];
          if (Array.isArray(explicit) && explicit.length) return arr(explicit);
          const goods = Array.isArray(T?.GOODS) ? T.GOODS : ["food","coal","iron","steel","manufactured_goods"];
          if (T?.getImports) {
            return goods.map(goodId => ({ goodId, quantity:num(T.getImports(countryId, goodId, state)) })).filter(x => x.quantity > 0);
          }
          return arr(explicit ?? []);
        },

        exports(countryId, state) {
          const T = get("TradeDiplomacy");
          const explicit = state?.trade?.exports?.[countryId];
          if (Array.isArray(explicit) && explicit.length) return arr(explicit);
          const goods = Array.isArray(T?.GOODS) ? T.GOODS : ["food","coal","iron","steel","manufactured_goods"];
          if (T?.getExports) {
            return goods.map(goodId => ({ goodId, quantity:num(T.getExports(countryId, goodId, state)) })).filter(x => x.quantity > 0);
          }
          return arr(explicit ?? []);
        },

        dependency(countryId, partnerId, goodId, state) {
          const T = get("TradeDiplomacy");
          // Backward-compatible snapshots may carry explicit bilateral flows.
          // Compute from those first; otherwise use Module 5's current API.
          const explicitImports = state?.trade?.imports?.[countryId];
          if (Array.isArray(explicitImports) && explicitImports.length) {
            const imports = explicitImports.filter(x => !goodId || (x.goodId ?? x.good) === goodId);
            const total = imports.reduce((s, x) => s + num(x.quantity ?? x.volume ?? x.value), 0);
            const fromPartner = imports
              .filter(x => (x.partnerId ?? x.fromCountryId ?? x.exporterId) === partnerId)
              .reduce((s, x) => s + num(x.quantity ?? x.volume ?? x.value), 0);
            return total > 0 ? clamp(fromPartner / total) : 0;
          }

          // Module 5 current signature: getDependency(countryA, countryB, state).
          const raw = T?.getDependency?.(countryId, partnerId, state);
          if (raw != null) {
            if (typeof raw === "number") return clamp(raw);
            if (goodId) return clamp(raw.importDependency?.[goodId] ?? raw.demandDependency?.[goodId] ?? raw.total ?? 0);
            return clamp(raw.total ?? raw.share ?? raw.ratio ?? raw.dependency ?? 0);
          }
          return 0;
        },

        relationship(a, b, state) {
          const T = get("TradeDiplomacy");
          const rel =
            state?.diplomaticRelations?.[a]?.[b] ??
            state?.diplomaticRelations?.[`${a}:${b}`] ??
            state?.diplomaticRelations?.[`${b}:${a}`] ??
            T?.getRelationship?.(a, b, state) ??
            0;
          return relationNormalized(
            typeof rel === "object" ? rel.score ?? rel.value ?? rel.relation : rel
          );
        },

        createProposal(proposal, state) {
          const T = get("TradeDiplomacy");
          if (!T?.createProposal) return { ok: false, error: "TradeDiplomacy.createProposal unavailable" };
          return T.createProposal(proposal, state);
        },

        counterProposal(proposalId, terms, state) {
          const T = get("TradeDiplomacy");
          if (!T?.counterProposal) return { ok: false, error: "TradeDiplomacy.counterProposal unavailable" };
          return T.counterProposal(proposalId, terms, state);
        },

        endTradeRelation(relationId, state) {
          const T = get("TradeDiplomacy");
          if (!T?.endTradeRelation) return { ok: false, error: "TradeDiplomacy.endTradeRelation unavailable" };
          return T.endTradeRelation(relationId, "ai_action", state);
        },

        setTariff(countryId, targetCountryId, goodId, rate, state) {
          const T = get("TradeDiplomacy");
          if (!T?.setTariff) return { ok: false, error: "TradeDiplomacy.setTariff unavailable" };
          return T.setTariff(countryId, targetCountryId, goodId, rate, state);
        },

        quoteImport(importerId, exporterId, goodId, volume, state) {
          const T = get("TradeDiplomacy");
          const direct =
            T?.quoteTrade?.({
              importerCountryId: importerId,
              exporterCountryId: exporterId,
              goodId,
              volume
            }, state) ??
            T?.getImportQuote?.(importerId, exporterId, goodId, volume, state);

          if (direct) return normalizeTradeQuote(direct, volume);

          const seller = runtime.adapters.economy.goodBalance(exporterId, goodId, state);
          const unitPrice = Math.max(0.01, num(seller.price, 1));
          const route =
            state?.trade?.routes?.find?.(r =>
              (r.fromCountryId === exporterId || r.exporterId === exporterId) &&
              (r.toCountryId === importerId || r.importerId === importerId) &&
              (!r.goodId || r.goodId === goodId)
            ) || {};

          const transportPerUnit = Math.max(0, num(
            route.transportCostPerUnit ?? route.shippingCostPerUnit ?? route.unitTransportCost,
            num(route.distance, 0) * 0.002
          ));
          const tariffRate = clamp(
            route.tariffRate ??
            state?.trade?.tariffs?.[importerId]?.[exporterId]?.[goodId] ??
            state?.trade?.tariffs?.[importerId]?.[exporterId] ??
            0,
            0, 2
          );
          const capacity = Math.max(0, num(route.availableCapacity ?? route.capacity, volume || 999999));
          const actualVolume = Math.min(Math.max(0, num(volume, 1)), capacity);
          const tariffPerUnit = unitPrice * tariffRate;
          const landedUnitCost = unitPrice + transportPerUnit + tariffPerUnit;

          return {
            ok: capacity > 0,
            unitPrice,
            transportPerUnit,
            tariffRate,
            tariffPerUnit,
            landedUnitCost,
            capacity,
            requestedVolume: num(volume),
            feasibleVolume: actualVolume,
            totalCost: landedUnitCost * actualVolume,
            source: "fallback"
          };
        },

        marketShare(countryId, goodId, direction, state) {
          const T = get("TradeDiplomacy");
          const direct = T?.getMarketShare?.(countryId, goodId, direction, state);
          if (direct != null) return clamp(typeof direct === "number" ? direct : direct.share ?? direct.ratio);

          const allIds = Object.keys(state?.countries || {});
          if (direction === "export") {
            const totals = allIds.map(id => ({
              id,
              v: this.exports(id, state)
                .filter(x => (x.goodId ?? x.good) === goodId)
                .reduce((a, x) => a + num(x.quantity ?? x.volume ?? x.value), 0)
            }));
            const total = totals.reduce((a, x) => a + x.v, 0);
            const mine = totals.find(x => x.id === countryId)?.v ?? 0;
            return total > 0 ? clamp(mine / total) : 0;
          }

          const flows = this.imports(countryId, state).filter(x => (x.goodId ?? x.good) === goodId);
          const total = flows.reduce((a, x) => a + num(x.quantity ?? x.volume ?? x.value), 0);
          return total > 0 ? 1 : 0;
        }
      }
    };
  }

  function normalizeTradeQuote(raw, requestedVolume = 1) {
    const unitPrice = Math.max(0.01, num(raw.unitPrice ?? raw.price ?? raw.commodityPrice, 1));
    const transportPerUnit = Math.max(0, num(raw.transportPerUnit ?? raw.transportCostPerUnit ?? raw.shippingCostPerUnit));
    const tariffRate = clamp(raw.tariffRate ?? raw.tariff ?? 0, 0, 2);
    const tariffPerUnit = Math.max(0, num(raw.tariffPerUnit, unitPrice * tariffRate));
    const landedUnitCost = Math.max(0.01, num(raw.landedUnitCost, unitPrice + transportPerUnit + tariffPerUnit));
    const capacity = Math.max(0, num(raw.availableCapacity ?? raw.capacity, requestedVolume || 999999));
    const feasibleVolume = Math.min(Math.max(0, num(requestedVolume, 1)), capacity);
    return {
      ok: raw.ok !== false && capacity > 0,
      unitPrice,
      transportPerUnit,
      tariffRate,
      tariffPerUnit,
      landedUnitCost,
      capacity,
      requestedVolume: num(requestedVolume),
      feasibleVolume,
      totalCost: Math.max(0, num(raw.totalCost, landedUnitCost * feasibleVolume)),
      source: raw.source || "module5"
    };
  }

  function normalizeGoodBalance(raw, goodId) {
    if (typeof raw === "number") {
      return {
        goodId,
        production: Math.max(0, raw),
        demand: 0,
        available: Math.max(0, raw),
        shortage: 0,
        surplus: Math.max(0, raw),
        price: 1
      };
    }

    const production = num(raw?.production ?? raw?.supply);
    const demand = num(raw?.demand ?? raw?.consumption);
    const available = num(raw?.available ?? raw?.supplyAvailable ?? production);
    const balance = num(raw?.balance, production - demand);
    const shortage = Math.max(0, num(raw?.shortage, -Math.min(0, balance)));
    const surplus = Math.max(0, num(raw?.surplus, Math.max(0, balance)));

    return {
      goodId,
      production,
      demand,
      available,
      balance,
      shortage,
      surplus,
      price: Math.max(0.01, num(raw?.price, 1))
    };
  }


  /* ---------------------------------------------------------
     STRATEGIC REALISM HELPERS
     --------------------------------------------------------- */

  function inferProjectGood(project) {
    const t = String(project?.type || "").toLowerCase();
    if (t.includes("coal")) return "coal";
    if (t.includes("iron")) return "iron";
    if (t.includes("steel")) return "steel";
    if (t.includes("factory")) return "manufactured_goods";
    if (t.includes("power")) return "power";
    return project?.outputGoodId ?? null;
  }

  function inferProjectAnnualCapacity(project, state) {
    if (project?.expectedAnnualOutput != null) return Math.max(0, num(project.expectedAnnualOutput));
    if (project?.capacity != null) return Math.max(0, num(project.capacity));
    const target = project?.targetFacilityId && state?.facilities?.[project.targetFacilityId];
    if (target) {
      const current = num(target.capacity);
      const next = num(project.nextCapacity ?? project.toCapacity, current * 1.35);
      return Math.max(0, next - current);
    }
    const defaults = {
      coal_mine: 18, iron_mine: 16, steelworks: 14,
      basic_factory: 12, power_plant: 16
    };
    return defaults[project?.type] ?? 0;
  }

  function getProjectedGoodBalance(countryId, goodId, state, horizonTurns = runtime.config.planningHorizonTurns) {
    const base = runtime.adapters.economy.goodBalance(countryId, goodId, state);
    let incomingCapacity = 0;
    const projects = values(state?.projects).filter(
      p => ownerOfProject(p) === countryId &&
           p.status === "under_construction" &&
           num(p.turnsRemaining, 999) <= horizonTurns &&
           inferProjectGood(p) === goodId
    );

    for (const p of projects) incomingCapacity += inferProjectAnnualCapacity(p, state);

    const projectedProduction = num(base.production) + incomingCapacity;
    const projectedBalance = projectedProduction - num(base.demand);
    return {
      ...base,
      horizonTurns,
      incomingCapacity,
      projects: projects.map(p => p.id),
      projectedProduction,
      projectedBalance,
      projectedShortage: Math.max(0, -projectedBalance),
      projectedSurplus: Math.max(0, projectedBalance)
    };
  }

  function getStrategicBudget(countryId, state) {
    const f = runtime.adapters.economy.finance(countryId, state);
    const treasury = Math.max(0, num(f.treasury));
    const revenue = Math.max(0, num(f.revenue));
    const debt = Math.max(0, num(f.debt));
    const debtService = Math.max(0, num(f.debtService ?? f.interest));
    const mandatory = Math.max(0, num(f.mandatorySpending ?? f.essentialSpending));
    const reserveFloor = Math.max(
      revenue * runtime.config.fiscalReserveShare,
      debtService + mandatory * 0.10
    );
    const liquidAfterReserve = Math.max(0, treasury - reserveFloor);
    const debtStress = clamp(debt / Math.max(1, revenue * 4));
    const annualCap = Math.max(
      0,
      revenue * runtime.config.maxAnnualDevelopmentShare * (1 - debtStress * 0.55)
    );
    const developmentBudget = Math.min(liquidAfterReserve, annualCap || liquidAfterReserve);
    const foreignCommitmentBudget = Math.min(
      liquidAfterReserve,
      Math.max(0, revenue * runtime.config.maxAnnualForeignCommitmentShare)
    );
    return {
      treasury, revenue, debt, debtStress, reserveFloor,
      liquidAfterReserve, developmentBudget, foreignCommitmentBudget
    };
  }

  function getTradeLandedCost(importerId, exporterId, goodId, volume, state) {
    return runtime.adapters.trade.quoteImport(importerId, exporterId, goodId, volume, state);
  }

  function getMarketPosition(countryId, goodId, state) {
    const ownExportShare = runtime.adapters.trade.marketShare(countryId, goodId, "export", state);
    const rivals = Object.keys(state?.countries || {})
      .filter(id => id !== countryId)
      .map(id => ({
        countryId: id,
        exportShare: runtime.adapters.trade.marketShare(id, goodId, "export", state)
      }))
      .sort((a, b) => b.exportShare - a.exportShare);

    return {
      countryId,
      goodId,
      ownExportShare,
      leadingRival: rivals[0] || null,
      rivalDominance: rivals[0]?.exportShare ?? 0
    };
  }

  function composePlans(countryId, state) {
    const ai = ensureState(countryId);
    const candidates = [];

    for (const need of ai.currentNeeds) {
      if (need.type === "RESOURCE_SHORTAGE") {
        const projected = getProjectedGoodBalance(countryId, need.goodId, state);
        if (projected.projectedShortage <= 0) continue;

        candidates.push({
          type: "SECURE_RESOURCE_CHAIN",
          targetGoodId: need.goodId,
          triggerKey: `RESOURCE_SHORTAGE:${need.goodId}`,
          priority: need.severity,
          stages: [
            { id: "bridge_supply", label: `Secure short-term ${need.goodId} supply`, capability: "trade_or_stock" },
            { id: "expand_supply", label: `Expand reliable ${need.goodId} supply`, capability: "domestic_or_investment" },
            { id: "improve_logistics", label: "Remove transport bottlenecks", capability: "transport" },
            { id: "diversify", label: "Keep supplier dependence within tolerance", capability: "diversification" }
          ]
        });
      }

      if (need.type === "EXPORT_MARKET_NEEDED") {
        candidates.push({
          type: "BUILD_EXPORT_MARKET",
          targetGoodId: need.goodId,
          triggerKey: `EXPORT:${need.goodId}`,
          priority: need.severity,
          stages: [
            { id: "find_market", label: `Find demand for ${need.goodId}`, capability: "market" },
            { id: "secure_route", label: "Secure cost-effective route capacity", capability: "transport" },
            { id: "sign_contract", label: "Establish durable export agreement", capability: "trade" },
            { id: "protect_share", label: "Monitor rival market share", capability: "competition" }
          ]
        });
      }

      if (need.type === "INDUSTRIAL_EXPANSION_OPPORTUNITY" || need.type === "UNEMPLOYMENT") {
        candidates.push({
          type: "EXPAND_INDUSTRIAL_BASE",
          targetGoodId: need.goodId || "manufactured_goods",
          triggerKey: `INDUSTRY:${need.goodId || "general"}`,
          priority: need.severity,
          stages: [
            { id: "inputs", label: "Secure industrial inputs", capability: "resources" },
            { id: "power", label: "Ensure power capacity", capability: "power" },
            { id: "transport", label: "Ensure transport capacity", capability: "transport" },
            { id: "plant", label: "Build or upgrade production", capability: "development" },
            { id: "market", label: "Secure domestic or export demand", capability: "market" }
          ]
        });
      }
    }

    for (const cand of candidates) {
      let existing = ai.activePlans.find(p => p.status === "active" && p.triggerKey === cand.triggerKey);
      if (!existing) {
        existing = {
          id: makeId("plan"),
          status: "active",
          createdTurn: turnNumber(state),
          currentStage: 0,
          ...safeClone(cand)
        };
        ai.activePlans.push(existing);
      } else {
        existing.priority = cand.priority;
      }
    }

    return ai.activePlans;
  }

  /* ---------------------------------------------------------
     OBSERVATION
     --------------------------------------------------------- */

  function collectKnownGoods(countryId, state) {
    const set = new Set(["coal", "iron", "steel", "manufactured_goods"]);

    for (const site of values(state?.resourceSites)) {
      const g = goodFromResourceSite(site);
      if (g) set.add(g);
    }
    for (const f of values(state?.facilities)) {
      const g = facilityProducesGood(f);
      if (g && g !== "power") set.add(g);
    }

    const econ = runtime.adapters.economy.country(countryId, state);
    for (const g of Object.keys(econ?.goods || {})) set.add(g);
    for (const g of Object.keys(econ?.goodBalances || {})) set.add(g);

    return [...set];
  }

  function observeCountry(countryId, gameState = runtime.lastGameState || window.gameState) {
    const state = gameState;
    runtime.lastGameState = state;
    if (!runtime.adapters) runtime.adapters = makeAdapters();

    const ai = ensureState(countryId);
    ai.diagnostics.skippedReasons = [];
    ai.diagnostics.adapterWarnings = [];

    const countryExists = !!state?.countries?.[countryId];
    if (!countryExists) {
      ai.diagnostics.adapterWarnings.push(`Country "${countryId}" does not exist in Module 1 state.`);
    }

    const goods = {};
    for (const goodId of collectKnownGoods(countryId, state)) {
      goods[goodId] = runtime.adapters.economy.goodBalance(countryId, goodId, state);
      goods[goodId].projection = getProjectedGoodBalance(countryId, goodId, state);
    }

    const finance = runtime.adapters.economy.finance(countryId, state);
    const economy = runtime.adapters.economy.country(countryId, state);
    const society = runtime.adapters.population.country(countryId, state);

    const ownedRegions = values(state?.regions).filter(r => ownerOfRegion(r) === countryId);
    const ownedCities = values(state?.cities).filter(c => ownerOfCity(c) === countryId);
    const ownedFacilities = values(state?.facilities).filter(f => ownerOfFacility(f) === countryId);
    const ownedProjects = values(state?.projects).filter(p => ownerOfProject(p) === countryId);
    const resourceSites = values(state?.resourceSites).filter(s => s?.countryId === countryId);

    const foreignCountries = values(state?.countries).filter(c => c.id !== countryId);
    const imports = runtime.adapters.trade.imports(countryId, state);
    const exports = runtime.adapters.trade.exports(countryId, state);

    const relationships = {};
    const dependency = {};

    for (const c of foreignCountries) {
      relationships[c.id] = runtime.adapters.trade.relationship(countryId, c.id, state);
      dependency[c.id] = {};
      for (const goodId of Object.keys(goods)) {
        dependency[c.id][goodId] = runtime.adapters.trade.dependency(countryId, c.id, goodId, state);
      }
    }

    const obs = {
      turn: turnNumber(state),
      countryId,
      countryExists,
      goods,
      finance,
      economy,
      society: {
        ...society,
        publicSupport: runtime.adapters.population.publicSupport(countryId, state),
        issues: runtime.adapters.population.socialIssues(countryId, state)
      },
      development: {
        regions: ownedRegions,
        cities: ownedCities,
        facilities: ownedFacilities,
        projects: ownedProjects,
        resourceSites
      },
      international: {
        countries: foreignCountries,
        imports,
        exports,
        relationships,
        dependency
      },
      bottlenecks: runtime.adapters.economy.bottlenecks(countryId, state)
    };

    ai.lastObservation = obs;
    return obs;
  }

  /* ---------------------------------------------------------
     NEED DETECTION
     --------------------------------------------------------- */

  function pushNeed(needs, need) {
    const severity = clamp(need.severity);
    if (severity <= 0.01) return;
    needs.push({ ...need, severity });
  }

  function detectNeeds(countryId, gameState = runtime.lastGameState || window.gameState) {
    const ai = ensureState(countryId);
    const obs = ai.lastObservation?.turn === turnNumber(gameState)
      ? ai.lastObservation
      : observeCountry(countryId, gameState);

    const needs = [];

    for (const [goodId, g] of Object.entries(obs.goods)) {
      const demand = Math.max(1, num(g.demand, g.production + g.shortage));
      const projectedShortage = num(g.projection?.projectedShortage, g.shortage);
      const immediateRatio = clamp(num(g.shortage) / demand);
      const futureRatio = clamp(projectedShortage / demand);
      // Current shortages still matter, but near-term capacity prevents duplicate overbuilding.
      const shortageRatio = clamp(immediateRatio * 0.55 + futureRatio * 0.45);

      if (shortageRatio >= runtime.config.shortageMinor) {
        pushNeed(needs, {
          type: "RESOURCE_SHORTAGE",
          goodId,
          severity: clamp(shortageRatio / 0.60),
          evidence: { shortage: g.shortage, demand: g.demand, price: g.price }
        });
      }

      const surplusRatio = g.production > 0 ? clamp(num(g.surplus) / Math.max(1, g.production)) : 0;
      if (surplusRatio >= runtime.config.surplusThreshold) {
        pushNeed(needs, {
          type: "EXCESS_PRODUCTION",
          goodId,
          severity: clamp(surplusRatio),
          evidence: { surplus: g.surplus, production: g.production }
        });
        pushNeed(needs, {
          type: "EXPORT_MARKET_NEEDED",
          goodId,
          severity: clamp(surplusRatio * 0.9),
          evidence: { surplus: g.surplus }});
      }
    }

    const unemployment =
      num(obs.society?.unemploymentRate,
        num(obs.economy?.unemploymentRate,
          num(obs.economy?.unemployment, 0)));

    if (unemployment >= runtime.config.unemploymentConcern) {
      pushNeed(needs, {
        type: "UNEMPLOYMENT",
        severity: clamp(unemployment / runtime.config.unemploymentSevere),
        evidence: { unemploymentRate: unemployment }
      });
    }

    const laborShortage =
      num(obs.society?.laborShortageRate,
        num(obs.economy?.laborShortageRate, 0));

    if (laborShortage > 0.05) {
      pushNeed(needs, {
        type: "LABOR_SHORTAGE",
        severity: clamp(laborShortage / 0.20),
        evidence: { laborShortageRate: laborShortage }
      });
    }

    const powerShortfall =
      Math.max(0,
        num(obs.economy?.powerDemand) -
        num(obs.economy?.powerSupply));

    if (powerShortfall > 0) {
      pushNeed(needs, {
        type: "LOW_POWER_CAPACITY",
        severity: clamp(powerShortfall / Math.max(1, num(obs.economy?.powerDemand))),
        evidence: { powerShortfall }
      });
    }

    for (const b of arr(obs.bottlenecks)) {
      const type = String(b.type ?? b.id ?? "").toLowerCase();
      if (type.includes("transport") || type.includes("rail") || type.includes("port")) {
        pushNeed(needs, {
          type: "TRANSPORT_BOTTLENECK",
          severity: clamp(b.severity ?? b.value ?? 0.5),
          targetId: b.connectionId ?? b.regionId ?? b.cityId ?? null,
          evidence: safeClone(b)
        });
      }
    }

    const treasury = num(obs.finance?.treasury);
    const revenue = Math.max(1, num(obs.finance?.revenue, 100));
    const debt = Math.max(0, num(obs.finance?.debt));
    const debtRatio = debt / Math.max(1, revenue * 4);

    if (treasury / revenue < runtime.config.lowTreasuryRatio) {
      pushNeed(needs, {
        type: "LOW_TREASURY",
        severity: clamp(1 - treasury / Math.max(1, revenue)),
        evidence: { treasury, revenue }
      });
    }

    if (debtRatio >= runtime.config.highDebtRatio) {
      pushNeed(needs, {
        type: "HIGH_DEBT",
        severity: clamp(debtRatio / 1.5),
        evidence: { debt, revenue, debtRatio }
      });
    }

    for (const [partnerId, byGood] of Object.entries(obs.international.dependency)) {
      for (const [goodId, share] of Object.entries(byGood)) {
        if (share >= runtime.config.dependencyConcern) {
          pushNeed(needs, {
            type: "IMPORT_DEPENDENCE_TOO_HIGH",
            partnerId,
            goodId,
            severity: clamp(
              (share - runtime.config.dependencyConcern) /
              (1 - runtime.config.dependencyConcern)
            ),
            evidence: { dependency: share }
          });
        }
      }
    }

    // Industrial expansion opportunity is also a "need" when idle capacity,
    // resources, or country personality makes expansion strategically relevant.
    const profile = PROFILES[countryId];
    if (profile?.personality?.industrialPreference > 1.1) {
      const iron = obs.goods.iron;
      const steel = obs.goods.steel;
      if ((iron?.surplus ?? 0) > 0 || (steel?.demand ?? 0) > (steel?.production ?? 0)) {
        pushNeed(needs, {
          type: "INDUSTRIAL_EXPANSION_OPPORTUNITY",
          goodId: "steel",
          severity: 0.55,
          evidence: { iron: safeClone(iron), steel: safeClone(steel) }
        });
      }
    }

    ai.currentNeeds = needs.sort((a, b) => b.severity - a.severity);
    return ai.currentNeeds;
  }

  /* ---------------------------------------------------------
     OPPORTUNITY DETECTION
     --------------------------------------------------------- */

  function detectOpportunities(countryId, gameState = runtime.lastGameState || window.gameState) {
    const ai = ensureState(countryId);
    const obs = ai.lastObservation?.turn === turnNumber(gameState)
      ? ai.lastObservation
      : observeCountry(countryId, gameState);

    const needs = ai.currentNeeds?.length ? ai.currentNeeds : detectNeeds(countryId, gameState);
    const opportunities = [];
    const shortages = needs.filter(n => n.type === "RESOURCE_SHORTAGE");
    const exporterNeeds = needs.filter(n => n.type === "EXPORT_MARKET_NEEDED");

    for (const foreign of obs.international.countries) {
      const relation = obs.international.relationships[foreign.id] ?? 0.5;

      for (const need of shortages) {
        const foreignBalance = runtime.adapters.economy.goodBalance(foreign.id, need.goodId, gameState);
        if (foreignBalance.surplus > 0 || foreignBalance.production > foreignBalance.demand) {
          const projected = getProjectedGoodBalance(countryId, need.goodId, gameState);
          const neededVolume = Math.max(1, projected.projectedShortage || need.evidence?.shortage || 1);
          const quote = getTradeLandedCost(countryId, foreign.id, need.goodId, neededVolume, gameState);
          const costAttractiveness = clamp(1 / Math.max(1, quote.landedUnitCost));
          opportunities.push({
            type: "IMPORT_OPPORTUNITY",
            partnerId: foreign.id,
            goodId: need.goodId,
            value: clamp(
              0.25 +
              need.severity * 0.30 +
              relation * 0.15 +
              normalizeScore(foreignBalance.surplus) * 0.10 +
              costAttractiveness * 0.20
            ),
            tradeQuote: quote,
            evidence: {
              needSeverity: need.severity,
              relation,
              foreignSurplus: foreignBalance.surplus,
              foreignPrice: foreignBalance.price,
              landedUnitCost: quote.landedUnitCost,
              transportPerUnit: quote.transportPerUnit,
              tariffRate: quote.tariffRate,
              routeCapacity: quote.capacity
            }
          });
        }

        // Foreign investment opportunity: resource site exists in foreign country,
        // useful good, enough relations, AI has capital.
        const sites = values(gameState?.resourceSites).filter(
          s => s.countryId === foreign.id && goodFromResourceSite(s) === need.goodId
        );

        for (const site of sites) {
          opportunities.push({
            type: "FOREIGN_INVESTMENT_OPPORTUNITY",
            partnerId: foreign.id,
            goodId: need.goodId,
            resourceSiteId: site.id,
            value: clamp(
              0.20 + need.severity * 0.35 + relation * 0.25 +
              (site.developed ? 0.05 : 0.15)
            ),
            evidence: { relation, siteDeveloped: !!site.developed }
          });
        }
      }

      for (const need of exporterNeeds) {
        const foreignBalance = runtime.adapters.economy.goodBalance(foreign.id, need.goodId, gameState);
        const foreignDemandGap = Math.max(0, foreignBalance.demand - foreignBalance.production);
        if (foreignDemandGap > 0 || foreignBalance.shortage > 0) {
          opportunities.push({
            type: "EXPORT_OPPORTUNITY",
            partnerId: foreign.id,
            goodId: need.goodId,
            value: clamp(
              0.30 + need.severity * 0.25 + relation * 0.20 +
              normalizeScore(foreignDemandGap + foreignBalance.shortage) * 0.25
            ),
            evidence: { relation, foreignDemandGap, shortage: foreignBalance.shortage }
          });
        }
      }
    }

    // Domestic undeveloped resources.
    for (const site of obs.development.resourceSites) {
      const goodId = goodFromResourceSite(site);
      if (!goodId) continue;
      const matchingShortage = shortages.find(n => n.goodId === goodId);
      if (!site.developed && matchingShortage) {
        opportunities.push({
          type: "DOMESTIC_RESOURCE_DEVELOPMENT",
          resourceSiteId: site.id,
          goodId,
          value: clamp(0.35 + matchingShortage.severity * 0.45),
          evidence: { needSeverity: matchingShortage.severity }
        });
      }
    }

    // Upgrade opportunities for owned facilities/connections.
    for (const f of obs.development.facilities) {
      if (f.active === false) continue;
      if (num(f.level, 1) < num(f.maxLevel, f.level ?? 1)) {
        opportunities.push({
          type: "FACILITY_UPGRADE",
          facilityId: f.id,
          facilityType: f.type,
          value: 0.42,
          evidence: { level: f.level, maxLevel: f.maxLevel }
        });
      }
    }

    const threats = [];
    for (const goodId of Object.keys(obs.goods)) {
      const pos = getMarketPosition(countryId, goodId, gameState);
      if (pos.leadingRival && pos.rivalDominance >= runtime.config.moderateMarketDominance) {
        threats.push({
          type: "RIVAL_MARKET_DOMINANCE",
          goodId,
          rivalCountryId: pos.leadingRival.countryId,
          severity: clamp(
            (pos.rivalDominance - runtime.config.moderateMarketDominance) /
            (1 - runtime.config.moderateMarketDominance)
          ),
          marketShare: pos.rivalDominance
        });
      }
    }

    ai.perceivedThreats = threats.sort((a, b) => b.severity - a.severity);
    ai.perceivedOpportunities = opportunities.sort((a, b) => b.value - a.value);
    return ai.perceivedOpportunities;
  }

  /* ---------------------------------------------------------
     LONG-TERM GOALS
     --------------------------------------------------------- */

  function updateStrategicGoals(countryId, gameState = runtime.lastGameState || window.gameState) {
    const ai = ensureState(countryId);
    const baseGoals = safeClone(PROFILES[countryId]?.strategicGoals || []);

    for (const goal of baseGoals) {
      if (goal.type === "DIVERSIFY_SUPPLIERS") {
        const maxDep = highestDependency(ai.lastObservation);
        goal.priority = clamp(goal.priority + Math.max(0, maxDep - 0.4) * 0.35);
      }

      if (goal.type === "EXPAND_STEEL_PRODUCTION") {
        const need = ai.currentNeeds.find(n => n.type === "INDUSTRIAL_EXPANSION_OPPORTUNITY");
        if (need) goal.priority = clamp(goal.priority + need.severity * 0.15);
      }

      if (goal.type === "INDUSTRIAL_SELF_SUFFICIENCY") {
        const imports = ai.currentNeeds.filter(n => n.type === "RESOURCE_SHORTAGE").length;
        goal.priority = clamp(goal.priority + Math.min(0.15, imports * 0.04));
      }

      if (goal.type === "EXPAND_TRADE_VOLUME") {
        const surplus = ai.currentNeeds.filter(n => n.type === "EXPORT_MARKET_NEEDED").length;
        goal.priority = clamp(goal.priority + Math.min(0.12, surplus * 0.04));
      }
    }

    ai.strategicGoals = baseGoals.sort((a, b) => b.priority - a.priority);
    return ai.strategicGoals;
  }

  function highestDependency(obs) {
    let max = 0;
    for (const byGood of Object.values(obs?.international?.dependency || {})) {
      for (const share of Object.values(byGood || {})) {
        max = Math.max(max, num(share));
      }
    }
    return max;
  }

  /* ---------------------------------------------------------
     PLANS
     --------------------------------------------------------- */

  function ensurePlanForNeed(countryId, need, gameState) {
    const ai = ensureState(countryId);

    if (need.type === "INDUSTRIAL_EXPANSION_OPPORTUNITY" && countryId === "norvia") {
      let plan = ai.activePlans.find(p => p.type === "EXPAND_STEEL_INDUSTRY" && p.status === "active");
      if (!plan) {
        plan = {
          id: makeId("plan"),
          type: "EXPAND_STEEL_INDUSTRY",
          status: "active",
          createdTurn: turnNumber(gameState),
          currentStage: 0,
          stages: [
            { id: "secure_iron", label: "Secure iron supply", complete: false },
            { id: "secure_coal", label: "Secure coal supply", complete: false },
            { id: "improve_transport", label: "Improve industrial transport", complete: false },
            { id: "build_steelworks", label: "Construct steelworks", complete: false },
            { id: "seek_export_market", label: "Seek export market", complete: false }
          ],
          trigger: safeClone(need),
          lastReviewTurn: turnNumber(gameState)
        };
        ai.activePlans.push(plan);
      }
      return plan;
    }

    return null;
  }

  function reviewActivePlans(countryId, gameState = runtime.lastGameState || window.gameState) {
    const ai = ensureState(countryId);
    const obs = ai.lastObservation || observeCountry(countryId, gameState);

    const hasTradeOrOpportunity = goodId =>
      ai.perceivedOpportunities.some(o =>
        o.goodId === goodId &&
        ["IMPORT_OPPORTUNITY", "EXPORT_OPPORTUNITY", "FOREIGN_INVESTMENT_OPPORTUNITY"].includes(o.type)
      );

    const transportOkay = () =>
      !ai.currentNeeds.some(n => n.type === "TRANSPORT_BOTTLENECK" && n.severity > 0.45);

    for (const p of ai.activePlans) {
      if (p.status !== "active") continue;
      p.lastReviewTurn = turnNumber(gameState);

      if (p.type === "EXPAND_STEEL_INDUSTRY") {
        const iron = obs.goods.iron || {};
        const coal = obs.goods.coal || {};
        const steelworks = obs.development.facilities.some(f => String(f.type).includes("steel"));
        const activeSteelProject = obs.development.projects.some(
          x => x.status === "under_construction" && String(x.type).includes("steel")
        );

        const stageMap = {
          secure_iron: num(iron.projection?.projectedShortage, iron.shortage) <= 0,
          secure_coal: num(coal.projection?.projectedShortage, coal.shortage) <= 0,
          improve_transport: transportOkay(),
          build_steelworks: steelworks || activeSteelProject,
          seek_export_market: !!ai.perceivedOpportunities.find(o => o.type === "EXPORT_OPPORTUNITY" && o.goodId === "steel")
        };

        for (const stage of p.stages) stage.complete = !!stageMap[stage.id];
      }

      if (p.type === "SECURE_RESOURCE_CHAIN") {
        const g = obs.goods[p.targetGoodId] || {};
        const projected = g.projection || getProjectedGoodBalance(countryId, p.targetGoodId, gameState);
        const depTooHigh = ai.currentNeeds.some(
          n => n.type === "IMPORT_DEPENDENCE_TOO_HIGH" && n.goodId === p.targetGoodId
        );
        const stageMap = {
          bridge_supply: num(g.shortage) <= 0 || hasTradeOrOpportunity(p.targetGoodId),
          expand_supply: projected.projectedShortage <= 0 ||
            ai.perceivedOpportunities.some(o =>
              o.goodId === p.targetGoodId &&
              ["DOMESTIC_RESOURCE_DEVELOPMENT", "FOREIGN_INVESTMENT_OPPORTUNITY"].includes(o.type)
            ),
          improve_logistics: transportOkay(),
          diversify: !depTooHigh
        };
        for (const stage of p.stages) stage.complete = !!stageMap[stage.id];
      }

      if (p.type === "BUILD_EXPORT_MARKET") {
        const market = ai.perceivedOpportunities.some(
          o => o.type === "EXPORT_OPPORTUNITY" && o.goodId === p.targetGoodId
        );
        const currentExports = obs.international.exports.filter(
          x => (x.goodId ?? x.good) === p.targetGoodId
        );
        const threat = ai.perceivedThreats.find(
          t => t.type === "RIVAL_MARKET_DOMINANCE" && t.goodId === p.targetGoodId
        );
        const stageMap = {
          find_market: market || currentExports.length > 0,
          secure_route: transportOkay(),
          sign_contract: currentExports.length > 0,
          protect_share: !threat || threat.severity < 0.45
        };
        for (const stage of p.stages) stage.complete = !!stageMap[stage.id];
      }

      if (p.type === "EXPAND_INDUSTRIAL_BASE") {
        const target = p.targetGoodId || "manufactured_goods";
        const projected = getProjectedGoodBalance(countryId, target, gameState);
        const hasPlant = obs.development.facilities.some(f => facilityProducesGood(f) === target);
        const activePlant = obs.development.projects.some(
          x => x.status === "under_construction" && inferProjectGood(x) === target
        );
        const powerOkay = !ai.currentNeeds.some(n => n.type === "LOW_POWER_CAPACITY" && n.severity > 0.4);
        const stageMap = {
          inputs: !ai.currentNeeds.some(n => n.type === "RESOURCE_SHORTAGE" && ["coal", "iron"].includes(n.goodId) && n.severity > 0.5),
          power: powerOkay,
          transport: transportOkay(),
          plant: hasPlant || activePlant,
          market: projected.projectedSurplus <= 0 || hasTradeOrOpportunity(target)
        };
        for (const stage of p.stages) stage.complete = !!stageMap[stage.id];
      }

      const firstIncomplete = p.stages.findIndex(s => !s.complete);
      p.currentStage = firstIncomplete === -1 ? p.stages.length : firstIncomplete;

      if (firstIncomplete === -1) {
        p.status = "completed";
        p.completedTurn = turnNumber(gameState);
        continue;
      }

      const severeFinancialStress =
        ai.currentNeeds.some(n => n.type === "HIGH_DEBT" && n.severity > 0.85) &&
        ai.currentNeeds.some(n => n.type === "LOW_TREASURY" && n.severity > 0.75);

      const premiseGone =
        p.type === "SECURE_RESOURCE_CHAIN" &&
        !ai.currentNeeds.some(n => n.type === "RESOURCE_SHORTAGE" && n.goodId === p.targetGoodId) &&
        getProjectedGoodBalance(countryId, p.targetGoodId, gameState).projectedShortage <= 0;

      if (severeFinancialStress || premiseGone) {
        p.status = severeFinancialStress ? "paused" : "completed";
        p.pauseReason = severeFinancialStress
          ? "Fiscal stress exceeded the plan's safe execution threshold."
          : null;
        if (premiseGone) p.completedTurn = turnNumber(gameState);
      }
    }

    return ai.activePlans;
  }

  /* ---------------------------------------------------------
     ACTION GENERATION
     --------------------------------------------------------- */

  function generateActions(countryId, gameState = runtime.lastGameState || window.gameState) {
    const ai = ensureState(countryId);
    const obs = ai.lastObservation || observeCountry(countryId, gameState);
    const needs = ai.currentNeeds?.length ? ai.currentNeeds : detectNeeds(countryId, gameState);
    const opps = ai.perceivedOpportunities?.length
      ? ai.perceivedOpportunities
      : detectOpportunities(countryId, gameState);

    const actions = [];

    // No actions if country does not exist in Module 1.
    if (!obs.countryExists) {
      ai.candidateActions = [];
      ai.diagnostics.skippedReasons.push(`No actions: ${countryId} missing from gameState.countries.`);
      return [];
    }

    for (const need of needs) {
      if (need.type === "RESOURCE_SHORTAGE") {
        // Domestic development.
        for (const op of opps.filter(
          o => o.type === "DOMESTIC_RESOURCE_DEVELOPMENT" && o.goodId === need.goodId
        )) {
          const site = gameState.resourceSites?.[op.resourceSiteId];
          if (!site) continue;

          const type = need.goodId === "coal" ? "coal_mine" : `${need.goodId}_mine`;

          actions.push({
            id: makeId("action"),
            type: "START_PROJECT",
            category: "development",
            need,
            opportunity: op,
            project: {
              type,
              resourceSiteId: site.id,
              regionId: site.regionId,
              cityId: site.cityId ?? null,
              ownerCountryId: countryId,
              ownership: { type: "domestic", domesticShare: 1 }
            },
            label: `Develop domestic ${need.goodId} at ${site.name || site.id}`
          });
        }

        // Trade.
        for (const op of opps.filter(
          o => o.type === "IMPORT_OPPORTUNITY" && o.goodId === need.goodId
        )) {
          actions.push({
            id: makeId("action"),
            type: "PROPOSE_TRADE",
            category: "trade",
            need,
            opportunity: op,
            direction: "import",
            partnerId: op.partnerId,
            goodId: need.goodId,
            desiredVolume: estimateTradeVolume(need, op, obs),
            label: `Import ${need.goodId} from ${op.partnerId}`
          });
        }

        // Foreign investment.
        for (const op of opps.filter(
          o => o.type === "FOREIGN_INVESTMENT_OPPORTUNITY" && o.goodId === need.goodId
        )) {
          actions.push({
            id: makeId("action"),
            type: "PROPOSE_INVESTMENT",
            category: "investment",
            need,
            opportunity: op,
            partnerId: op.partnerId,
            goodId: need.goodId,
            resourceSiteId: op.resourceSiteId,
            label: `Invest in ${op.partnerId} ${need.goodId} production`
          });
        }

        // Diversification when dependency is already high.
        const highDeps = needs.filter(
          n => n.type === "IMPORT_DEPENDENCE_TOO_HIGH" && n.goodId === need.goodId
        );

        for (const depNeed of highDeps) {
          const alternatives = opps.filter(
            o => o.type === "IMPORT_OPPORTUNITY" &&
                 o.goodId === need.goodId &&
                 o.partnerId !== depNeed.partnerId
          );

          for (const op of alternatives) {
            actions.push({
              id: makeId("action"),
              type: "PROPOSE_TRADE",
              category: "trade",
              need: depNeed,
              opportunity: op,
              direction: "import",
              partnerId: op.partnerId,
              goodId: need.goodId,
              desiredVolume: estimateTradeVolume(depNeed, op, obs),
              diversification: true,
              label: `Diversify ${need.goodId} imports toward ${op.partnerId}`
            });
          }
        }
      }

      if (need.type === "EXPORT_MARKET_NEEDED") {
        for (const op of opps.filter(
          o => o.type === "EXPORT_OPPORTUNITY" && o.goodId === need.goodId
        )) {
          actions.push({
            id: makeId("action"),
            type: "PROPOSE_TRADE",
            category: "trade",
            need,
            opportunity: op,
            direction: "export",
            partnerId: op.partnerId,
            goodId: need.goodId,
            desiredVolume: estimateTradeVolume(need, op, obs),
            label: `Export ${need.goodId} to ${op.partnerId}`
          });
        }
      }

      if (need.type === "LOW_POWER_CAPACITY") {
        for (const region of obs.development.regions) {
          actions.push({
            id: makeId("action"),
            type: "START_PROJECT",
            category: "development",
            need,
            project: {
              type: "power_plant",
              regionId: region.id,
              ownerCountryId: countryId
            },
            label: `Build power plant in ${region.name || region.id}`
          });
        }
      }

      if (need.type === "TRANSPORT_BOTTLENECK") {
        const ownedConnections = values(gameState.connections).filter(
          c => (c.ownerCountryId ?? c.countryId) === countryId && c.active !== false
        );

        for (const c of ownedConnections) {
          if (num(c.level, 1) < num(c.maxLevel, c.level ?? 1)) {
            actions.push({
              id: makeId("action"),
              type: "UPGRADE_CONNECTION",
              category: "development",
              need,
              connectionId: c.id,
              label: `Upgrade ${c.type} ${c.id}`
            });
          }
        }
      }

      if (need.type === "UNEMPLOYMENT" || need.type === "INDUSTRIAL_EXPANSION_OPPORTUNITY") {
        for (const city of obs.development.cities) {
          actions.push({
            id: makeId("action"),
            type: "START_PROJECT",
            category: "development",
            need,
            project: {
              type: need.type === "INDUSTRIAL_EXPANSION_OPPORTUNITY" ? "steelworks" : "basic_factory",
              cityId: city.id,
              regionId: city.regionId,
              ownerCountryId: countryId
            },
            label: need.type === "INDUSTRIAL_EXPANSION_OPPORTUNITY"
              ? `Build steelworks in ${city.name || city.id}`
              : `Build factory in ${city.name || city.id}`
          });
        }

        ensurePlanForNeed(countryId, need, gameState);
      }

      if (need.type === "IMPORT_DEPENDENCE_TOO_HIGH") {
        // Preference for supplier diversification.
        for (const op of opps.filter(
          o => o.type === "IMPORT_OPPORTUNITY" &&
               o.goodId === need.goodId &&
               o.partnerId !== need.partnerId
        )) {
          actions.push({
            id: makeId("action"),
            type: "PROPOSE_TRADE",
            category: "trade",
            need,
            opportunity: op,
            direction: "import",
            partnerId: op.partnerId,
            goodId: need.goodId,
            desiredVolume: estimateTradeVolume(need, op, obs),
            diversification: true,
            label: `Reduce dependence on ${need.partnerId} via ${op.partnerId}`
          });
        }
      }
    }

    // Facility upgrades are opportunities, not only emergency responses.
    for (const op of opps.filter(o => o.type === "FACILITY_UPGRADE")) {
      actions.push({
        id: makeId("action"),
        type: "UPGRADE_FACILITY",
        category: "development",
        opportunity: op,
        facilityId: op.facilityId,
        label: `Upgrade ${op.facilityType} ${op.facilityId}`
      });
    }

    // Protective policy for Norvia when domestic manufactured goods face strong imports.
    if (countryId === "norvia") {
      const imports = obs.international.imports;
      const manufacturedImports = imports.filter(
        x => (x.goodId ?? x.good) === "manufactured_goods"
      );
      if (manufacturedImports.length) {
        const largest = [...manufacturedImports].sort(
          (a, b) => num(b.quantity ?? b.value) - num(a.quantity ?? a.value)
        )[0];
        const partnerId = largest.partnerId ?? largest.fromCountryId ?? largest.exporterId;
        if (partnerId) {
          actions.push({
            id: makeId("action"),
            type: "SET_TARIFF",
            category: "diplomatic",
            partnerId,
            goodId: "manufactured_goods",
            rate: 0.10,
            label: `Raise tariff on manufactured goods from ${partnerId}`
          });
        }
      }
    }

    // Remove duplicate actions.
    const deduped = [];
    const seen = new Set();
    for (const a of actions) {
      const key = JSON.stringify([
        a.type, a.partnerId, a.goodId, a.facilityId, a.connectionId,
        a.project?.type, a.project?.regionId, a.project?.cityId, a.project?.resourceSiteId
      ]);
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(a);
      }
    }

    ai.candidateActions = deduped;
    return deduped;
  }

  function estimateTradeVolume(need, opportunity, obs) {
    const evidence = need?.evidence || {};
    const projected = need?.goodId ? obs.goods?.[need.goodId]?.projection : null;
    const projectedShortage = Math.max(0, num(projected?.projectedShortage));
    if (projectedShortage > 0) return Math.max(1, Math.round(projectedShortage));

    const shortage = Math.max(0, num(evidence.shortage));
    if (shortage > 0) return Math.max(1, Math.round(shortage));

    const good = obs.goods?.[need?.goodId] || {};
    if ((good.surplus ?? 0) > 0) return Math.max(1, Math.round(good.surplus * 0.6));

    return Math.max(1, Math.round(5 + clamp(need?.severity) * 10));
  }

  /* ---------------------------------------------------------
     ACTION SCORING
     --------------------------------------------------------- */

  function scoreAction(countryId, action, gameState = runtime.lastGameState || window.gameState) {
    const ai = ensureState(countryId);
    const obs = ai.lastObservation || observeCountry(countryId, gameState);
    const profile = PROFILES[countryId] || { personality: ai.personality };

    const c = {
      economicBenefit: 0,
      strategicBenefit: 0,
      needResolution: 0,
      personalityFit: 0,
      diplomaticBenefit: 0,
      financialCost: 0,
      dependencyRisk: 0,
      politicalCost: 0,
      opportunityCost: 0,
      memoryEffect: 0,
      tradeCost: 0,
      futureCapacityEffect: 0,
      fiscalDiscipline: 0,
      competitionEffect: 0,
      feasibility: 0
    };

    const needSeverity = clamp(action.need?.severity ?? 0.25);
    c.needResolution = 34 * needSeverity;

    // Opportunity value.
    c.economicBenefit += 24 * clamp(action.opportunity?.value ?? 0.25);

    // Strategic-goal alignment.
    c.strategicBenefit += strategicGoalBonus(countryId, action, ai);

    // Diplomacy.
    if (action.partnerId) {
      const rel = obs.international.relationships?.[action.partnerId] ?? 0.5;
      c.diplomaticBenefit += (rel - 0.5) * 18;
    }

    // Memory.
    c.memoryEffect += memoryModifier(countryId, action.partnerId, gameState);

    // Dependency.
    if (action.type === "PROPOSE_TRADE" && action.direction === "import" && action.partnerId) {
      const dep = runtime.adapters.trade.dependency(
        countryId, action.partnerId, action.goodId, gameState
      );
      c.dependencyRisk -= dependencyPenalty(dep, ai.personality.dependencyAversion);

      if (action.diversification) {
        c.strategicBenefit += 18 * ai.personality.dependencyAversion;
      }
    }

    // Real import economics: commodity price + transport + tariff + capacity.
    if (action.type === "PROPOSE_TRADE" && action.direction === "import" && action.partnerId) {
      const quote = action.opportunity?.tradeQuote ||
        getTradeLandedCost(countryId, action.partnerId, action.goodId, action.desiredVolume, gameState);
      action.tradeQuote = quote;
      const domesticPrice = Math.max(0.01, num(obs.goods?.[action.goodId]?.price, quote.unitPrice));
      const relativeCost = quote.landedUnitCost / domesticPrice;
      c.tradeCost += clamp(1.25 - relativeCost, -1, 1) * 18;
      if (!quote.ok || quote.feasibleVolume < Math.max(1, num(action.desiredVolume)) * 0.5) {
        c.feasibility -= 28;
      }
    }

    // Future capacity: avoid solving a shortage twice when a project will soon solve it.
    if (action.need?.type === "RESOURCE_SHORTAGE" && action.need.goodId) {
      const projected = getProjectedGoodBalance(countryId, action.need.goodId, gameState);
      if (projected.incomingCapacity > 0) {
        const currentShortage = Math.max(1, num(obs.goods?.[action.need.goodId]?.shortage));
        const resolvedSoon = clamp((currentShortage - projected.projectedShortage) / currentShortage);
        c.futureCapacityEffect -= 24 * resolvedSoon;
      }
    }

    // Financial cost & feasibility.
    const finance = obs.finance || {};
    const strategicBudget = getStrategicBudget(countryId, gameState);
    if (action.type === "START_PROJECT") {
      const validation = runtime.adapters.development.canStartProject(action.project, gameState);
      action.validation = validation;

      if (!validation.ok) {
        c.feasibility -= 80;
      } else {
        c.feasibility += 8;
      }

      const def = validation.definition || action.project;
      const cost = num(def.cost ?? action.project.cost);
      action.estimatedCost = cost;
      c.financialCost -= 28 * costPressure(cost, finance);
      if (cost > strategicBudget.developmentBudget) {
        c.fiscalDiscipline -= 55 * clamp(cost / Math.max(1, strategicBudget.developmentBudget) - 1, 0, 1);
        c.feasibility -= 18;
      } else if (cost > 0) {
        c.fiscalDiscipline += 5 * clamp(1 - cost / Math.max(1, strategicBudget.developmentBudget));
      }

      if (action.project.type === "steelworks" || action.project.type === "basic_factory") {
        c.economicBenefit += 8;
      }
      if (action.project.type === "power_plant") {
        c.strategicBenefit += 8;
      }
    }

    if (action.type === "UPGRADE_FACILITY") {
      const f = gameState.facilities?.[action.facilityId];
      if (!f) c.feasibility -= 80;
      else {
        c.feasibility += 5;
        if (String(f.type).includes("port")) c.strategicBenefit += 9;
        if (String(f.type).includes("steel") || String(f.type).includes("mine")) c.economicBenefit += 8;
      }
    }

    if (action.type === "UPGRADE_CONNECTION") {
      const conn = gameState.connections?.[action.connectionId];
      if (!conn) c.feasibility -= 80;
      else {
        c.feasibility += 5;
        c.strategicBenefit += 8;
      }
    }

    if (action.type === "PROPOSE_INVESTMENT") {
      c.economicBenefit += 10;
      c.strategicBenefit += 8;
      const financeStrength = treasuryNormalized(finance);
      if (financeStrength < 0.2) c.financialCost -= 24;
      const commitment = num(action.estimatedCost ?? action.opportunity?.requiredCapital);
      if (commitment > strategicBudget.foreignCommitmentBudget && commitment > 0) {
        c.fiscalDiscipline -= 35;
      }
    }

    if (action.type === "PROPOSE_TRADE") {
      c.economicBenefit += action.direction === "import" ? 7 : 8;
    }

    if (action.type === "SET_TARIFF") {
      c.politicalCost -= 4;
      if (countryId === "norvia") c.strategicBenefit += 7;
    }

    // Market competition is based on actual trade share rather than a fixed rivalry tag.
    if (action.goodId) {
      const pos = getMarketPosition(countryId, action.goodId, gameState);
      const rival = pos.leadingRival;
      if (rival && rival.countryId !== countryId) {
        if (rival.exportShare >= runtime.config.severeMarketDominance) {
          if (action.diversification || action.type === "PROPOSE_TRADE" || action.type === "PROPOSE_INVESTMENT") {
            c.competitionEffect += 10;
          }
          if (countryId === "norvia" && rival.countryId === "meridian") c.competitionEffect += 7;
          if (countryId === "meridian" && rival.countryId === "norvia") c.competitionEffect += 5;
        }
      }
    }

    // Society.
    const unemploymentNeed = ai.currentNeeds.find(n => n.type === "UNEMPLOYMENT");
    if (
      unemploymentNeed &&
      action.type === "START_PROJECT" &&
      ["steelworks", "basic_factory", "coal_mine"].includes(action.project?.type)
    ) {
      c.needResolution += 10 * unemploymentNeed.severity;
    }

    const housingPressure = num(obs.society?.housingShortageRate ?? obs.society?.housingPressure);
    if (
      housingPressure >= runtime.config.housingConcern &&
      action.type === "START_PROJECT" &&
      ["steelworks", "basic_factory"].includes(action.project?.type)
    ) {
      c.politicalCost -= 7 * clamp(housingPressure / 0.30);
    }

    // Treasury stress discourages large new commitments.
    const lowTreasury = ai.currentNeeds.find(n => n.type === "LOW_TREASURY");
    const highDebt = ai.currentNeeds.find(n => n.type === "HIGH_DEBT");
    if (isMajorAction(action)) {
      if (lowTreasury) c.financialCost -= 13 * lowTreasury.severity;
      if (highDebt) c.financialCost -= 10 * highDebt.severity;
    }

    // Opportunity cost: do not start too many parallel major projects.
    const activeProjects = obs.development.projects.filter(p => p.status === "under_construction");
    if (isMajorAction(action)) {
      c.opportunityCost -= Math.min(14, activeProjects.length * 3);
    }

    // Personality modification is applied to relevant positive value,
    // not to reality/feasibility penalties.
    const personalityFactor = personalityMultiplier(profile.personality, action);
    const positiveBeforePersonality =
      Math.max(0, c.economicBenefit) +
      Math.max(0, c.strategicBenefit) +
      Math.max(0, c.needResolution) +
      Math.max(0, c.diplomaticBenefit);

    c.personalityFit = positiveBeforePersonality * (personalityFactor - 1);

    const total = Object.values(c).reduce((s, v) => s + num(v), 0);

    const scored = {
      ...action,
      utility: Math.round(total * 10) / 10,
      utilityComponents: c,
      personalityMultiplier: personalityFactor,
      reasons: buildReasons(c, action)
    };

    return scored;
  }

  function strategicGoalBonus(countryId, action, ai) {
    let bonus = 0;
    const goals = ai.strategicGoals || [];

    for (const g of goals) {
      const p = clamp(g.priority);

      if (
        g.type === "SECURE_RESOURCE_IMPORTS" &&
        action.type === "PROPOSE_TRADE" &&
        action.direction === "import"
      ) bonus += 9 * p;

      if (
        g.type === "DIVERSIFY_SUPPLIERS" &&
        action.diversification
      ) bonus += 12 * p;

      if (
        g.type === "EXPAND_TRADE_VOLUME" &&
        action.type === "PROPOSE_TRADE"
      ) bonus += 8 * p;

      if (
        g.type === "ACQUIRE_FOREIGN_ASSETS" &&
        action.type === "PROPOSE_INVESTMENT"
      ) bonus += 11 * p;

      if (
        g.type === "INDUSTRIAL_SELF_SUFFICIENCY" &&
        action.type === "START_PROJECT" &&
        ["coal_mine", "iron_mine", "steelworks", "basic_factory"].includes(action.project?.type)
      ) bonus += 10 * p;

      if (
        g.type === "EXPAND_STEEL_PRODUCTION" &&
        action.type === "START_PROJECT" &&action.project?.type === "steelworks"
      ) bonus += 12 * p;

      if (
        g.type === "PROTECT_DOMESTIC_MANUFACTURING" &&
        action.type === "SET_TARIFF"
      ) bonus += 9 * p;

      if (
        g.type === "LIMIT_RIVAL_MARKET_DOMINANCE" &&
        action.partnerId === "meridian" &&
        action.direction === "import"
      ) bonus -= 5 * p;
    }

    return bonus;
  }

  function dependencyPenalty(dep, aversion = 1) {
    dep = clamp(dep);
    if (dep < 0.20) return 0;
    if (dep < 0.50) return 5 * dep * aversion;
    if (dep < 0.80) return (7 + 18 * (dep - 0.5) / 0.3) * aversion;
    return (25 + 25 * (dep - 0.8) / 0.2) * aversion;
  }

  function personalityMultiplier(p, action) {
    if (!p) return 1;
    switch (action.category) {
      case "trade": return clamp(p.tradePreference, 0.35, 1.65);
      case "investment": return clamp(p.foreignInvestmentPreference, 0.35, 1.65);
      case "development": {
        if (action.project?.type === "steelworks" || action.project?.type === "basic_factory") {
          return clamp(p.industrialPreference, 0.35, 1.65);
        }
        return clamp(p.infrastructurePreference ?? 1, 0.35, 1.65);
      }
      case "diplomatic": {
        if (action.type === "SET_TARIFF") {
          return clamp(p.protectionismPreference, 0.35, 1.65);
        }
        return 1;
      }
      default: return 1;
    }
  }

  function memoryModifier(countryId, partnerId, gameState) {
    if (!partnerId) return 0;
    const ai = ensureState(countryId);
    const now = turnNumber(gameState);
    let total = 0;

    for (const m of ai.decisionMemory) {
      if (m.countryId !== partnerId) continue;
      const age = Math.max(0, now - num(m.turn, now));
      const decay = Math.pow(0.94, age);
      total += num(m.weight) * decay;
    }

    return Math.max(-28, Math.min(18, total));
  }

  function buildReasons(c, action) {
    const labels = {
      economicBenefit: "Economic benefit",
      strategicBenefit: "Strategic alignment",
      needResolution: "Resolves an identified need",
      personalityFit: "Fits national strategic personality",
      diplomaticBenefit: "Diplomatic relationship effect",
      financialCost: "Financial cost",
      dependencyRisk: "Dependency risk",
      politicalCost: "Domestic political/social cost",
      opportunityCost: "Opportunity cost",
      memoryEffect: "Past interaction memory",
      tradeCost: "Landed trade cost and route capacity",
      futureCapacityEffect: "Near-term capacity already under construction",
      fiscalDiscipline: "Strategic budget and fiscal reserve",
      competitionEffect: "Regional market competition",
      feasibility: "Practical feasibility"
    };

    return Object.entries(c)
      .filter(([, value]) => Math.abs(value) >= 1)
      .map(([key, value]) => ({
        reason: labels[key] || key,
        value: Math.round(value * 10) / 10
      }))
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  }

  /* ---------------------------------------------------------
     CHOICE
     --------------------------------------------------------- */

  function chooseAction(countryId, actions, gameState = runtime.lastGameState || window.gameState) {
    const ai = ensureState(countryId);
    const scored = arr(actions)
      .map(a => a.utility != null ? a : scoreAction(countryId, a, gameState))
      .sort((a, b) => b.utility - a.utility);

    ai.candidateActions = scored.slice(0, runtime.config.debugCandidateLimit);

    if (!scored.length || scored[0].utility < runtime.config.minimumUtilityToAct) {
      return null;
    }

    const best = scored[0];
    const near = scored.filter(
      a => a.utility >= best.utility - runtime.config.nearTieWindow &&
           a.utility >= runtime.config.minimumUtilityToAct
    );

    if (near.length === 1) return best;

    // Seed-driven deterministic variation among plausible near-ties only.
    // Same seed + same snapshot + same candidate set => same choice.
    const tieKey = near.map(a => `${a.id}:${round1(a.utility)}`).join("|");
    if (deterministicUnit(gameState, countryId, "tie-gate", tieKey) < runtime.config.tieChoiceRandomness) {
      const weights = near.map(a => Math.max(1, a.utility - (best.utility - runtime.config.nearTieWindow)));
      const total = weights.reduce((s, x) => s + x, 0);
      let roll = deterministicUnit(gameState, countryId, "tie-roll", tieKey) * total;

      for (let i = 0; i < near.length; i++) {
        roll -= weights[i];
        if (roll <= 0) return near[i];
      }
    }

    return best;
  }

  /* ---------------------------------------------------------
     EXECUTION
     --------------------------------------------------------- */

  function executeAction(countryId, action, gameState = runtime.lastGameState || window.gameState) {
    if (!action) return { ok: false, error: "No action selected." };

    const ai = ensureState(countryId);
    let result;

    switch (action.type) {
      case "START_PROJECT": {
        const validation = runtime.adapters.development.canStartProject(action.project, gameState);
        const cost = num(validation?.definition?.cost ?? action.estimatedCost ?? action.project?.cost);
        const budget = getStrategicBudget(countryId, gameState);
        const affordability = runtime.adapters.economy.canAfford(countryId, cost, gameState);
        if (cost > budget.developmentBudget || affordability?.ok === false) {
          result = {
            ok: false,
            error: "AI fiscal guard blocked project: cost exceeds strategic development budget or available treasury.",
            cost,
            developmentBudget: budget.developmentBudget
          };
          break;
        }
        const reservation = runtime.adapters.economy.reserveFunds(countryId, cost, action.label, gameState);
        if (reservation?.ok === false) {
          result = { ok: false, error: "AI could not reserve project funds.", reservation };
          break;
        }
        result = runtime.adapters.development.startProject(action.project, gameState);
        if (result?.ok && reservation?.deferredToExecutingModule) {
          ai.diagnostics.adapterWarnings.push(
            "Economy.reserveGovernmentFunds is unavailable; Module 2/3 must remain authoritative for actual project payment."
          );
        }
        break;
      }

      case "UPGRADE_FACILITY":
        result = runtime.adapters.development.startFacilityUpgrade(action.facilityId, gameState);
        break;

      case "UPGRADE_CONNECTION":
        result = runtime.adapters.development.startConnectionUpgrade(action.connectionId, gameState);
        break;

      case "PROPOSE_TRADE":
        result = runtime.adapters.trade.createProposal({
          type: "trade",
          proposerCountryId: countryId,
          targetCountryId: action.partnerId,
          direction: action.direction,
          goodId: action.goodId,
          volume: action.desiredVolume,
          terms: {
            longTerm: true,
            purpose: action.diversification ? "diversification" : "commercial"
          }
        }, gameState);
        break;

      case "PROPOSE_INVESTMENT":
        result = runtime.adapters.trade.createProposal({
          type: "foreign_investment",
          proposerCountryId: countryId,
          targetCountryId: action.partnerId,
          resourceSiteId: action.resourceSiteId,
          goodId: action.goodId,
          terms: {
            ownershipShare: countryId === "meridian" ? 0.45 : 0.30,
            duration: 6
          }
        }, gameState);
        break;

      case "SET_TARIFF":
        result = runtime.adapters.trade.setTariff(
          countryId,
          action.partnerId,
          action.goodId,
          action.rate,
          gameState
        );
        break;

      case "END_TRADE":
        result = runtime.adapters.trade.endTradeRelation(action.relationId, gameState);
        break;

      default:
        result = { ok: false, error: `Unsupported AI action type: ${action.type}` };
    }

    const succeeded = !!result?.ok;

    ai.lastDecision = {
      turn: turnNumber(gameState),
      turnLabel: currentTurnLabel(gameState),
      action: safeClone(action),
      result: safeClone(result)
    };

    emitAIEvent(gameState, {
      type: succeeded ? "AI_ACTION_EXECUTED" : "AI_ACTION_FAILED",
      countryId,
      actionType: action.type,
      actionLabel: action.label,
      utility: action.utility,
      result: safeClone(result)
    });

    return result;
  }

  /* ---------------------------------------------------------
     DIPLOMATIC PROPOSAL EVALUATION
     --------------------------------------------------------- */

  function evaluateProposal(countryId, proposal, gameState = runtime.lastGameState || window.gameState) {
    const ai = ensureState(countryId);
    const obs = ai.lastObservation || observeCountry(countryId, gameState);

    const proposerId =
      proposal.proposerCountryId ??
      proposal.fromCountryId ??
      proposal.countryId ??
      gameState.playerCountryId;

    const reasons = [];
    let score = 0;

    const relation = runtime.adapters.trade.relationship(countryId, proposerId, gameState);
    const trustMemory = memoryModifier(countryId, proposerId, gameState);

    const relationValue = (relation - 0.5) * 24;
    score += relationValue;
    reasons.push({ reason: "Bilateral relations", value: round1(relationValue) });

    score += trustMemory;
    if (Math.abs(trustMemory) >= 1) {
      reasons.push({ reason: "Past reliability and trust", value: round1(trustMemory) });
    }

    if (proposal.type === "trade" || proposal.goodId) {
      const goodId = proposal.goodId;
      const balance = runtime.adapters.economy.goodBalance(countryId, goodId, gameState);
      const directionFromAI =
        proposal.targetCountryId === countryId
          ? proposal.direction === "export" ? "import" : proposal.direction === "import" ? "export" : proposal.direction
          : proposal.direction;

      if (directionFromAI === "import") {
        const shortageNeed = ai.currentNeeds.find(
          n => n.type === "RESOURCE_SHORTAGE" && n.goodId === goodId
        );
        if (shortageNeed) {
          const v = 30 * shortageNeed.severity;
          score += v;
          reasons.push({ reason: `Need for ${goodId}`, value: round1(v) });
        }

        const currentDep = runtime.adapters.trade.dependency(
          countryId, proposerId, goodId, gameState
        );
        const volume = Math.max(1, num(proposal.volume ?? proposal.quantity, 1));
        const projectedPressure = clamp(currentDep + normalizeScore(volume) * 0.15);
        const depPenalty = dependencyPenalty(
          projectedPressure,
          ai.personality.dependencyAversion
        );
        score -= depPenalty;
        reasons.push({ reason: "Dependency risk", value: round1(-depPenalty) });
      }

      if (directionFromAI === "export") {
        const surplus = Math.max(0, num(balance.surplus));
        const v = 24 * normalizeScore(surplus);
        score += v;
        reasons.push({ reason: "Export market value", value: round1(v) });
      }
    }

    if (proposal.type === "foreign_investment") {
      const hostIsAI = proposal.targetCountryId === countryId;
      const ownershipShare = clamp(proposal.terms?.ownershipShare ?? 0.4);
      const v = hostIsAI
        ? 14 * (1 - ownershipShare)
        : 16 * ai.personality.foreignInvestmentPreference;

      score += v;
      reasons.push({
        reason: hostIsAI ? "Domestic control retained" : "Foreign investment opportunity",
        value: round1(v)
      });
    }

    // Competition: Norvia is cautious of deals that strengthen Meridian's
    // market control, but still accepts deals that are economically strong.
    if (
      countryId === "norvia" &&
      proposerId === "meridian" &&
      proposal.type === "trade"
    ) {
      score -= 5;
      reasons.push({ reason: "Commercial competition with Meridian", value: -5 });
    }

    // Duration can be good for security but bad when trust is low.
    const duration = num(proposal.duration ?? proposal.terms?.duration);
    if (duration >= 6) {
      const v = relation >= 0.55 ? 4 : -5;
      score += v;
      reasons.push({ reason: "Long-term commitment", value: v });
    }

    let decision = "reject";
    let counteroffer = null;

    if (score >= 12) {
      decision = "accept";
    } else if (score >= -8) {
      decision = "counter";
      counteroffer = buildCounteroffer(countryId, proposal, score, gameState);
    }

    const evaluation = {
      decision,
      score: round1(score),
      reasons: reasons.sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
      counteroffer
    };

    ai.lastProposalEvaluation = evaluation;
    return evaluation;
  }

  function buildCounteroffer(countryId, proposal, score, gameState) {
    const terms = safeClone(proposal.terms || {});

    if (proposal.type === "trade" || proposal.goodId) {
      if (proposal.tariffRate === 0 || terms.tariffRate === 0) {
        terms.tariffRate = 0.10;
      }

      if (num(proposal.volume ?? proposal.quantity) > 0) {
        terms.guaranteedVolume = Math.max(
          1,
          Math.round(num(proposal.volume ?? proposal.quantity) * 0.85)
        );
      }

      terms.reviewAfterTurns = 4;
    }

    if (proposal.type === "foreign_investment") {
      const share = clamp(terms.ownershipShare ?? 0.4);
      terms.ownershipShare = Math.min(share, countryId === "norvia" ? 0.35 : 0.45);
      terms.localEmploymentRequirement = 0.55;
    }

    return {
      proposerCountryId: countryId,
      targetCountryId:
        proposal.proposerCountryId ??
        proposal.fromCountryId ??
        gameState.playerCountryId,
      originalProposalId: proposal.id ?? null,
      type: proposal.type,
      goodId: proposal.goodId ?? null,
      terms
    };
  }

  function respondToProposal(countryId, proposal, gameState = runtime.lastGameState || window.gameState) {
    const evaluation = evaluateProposal(countryId, proposal, gameState);

    if (evaluation.decision === "counter" && proposal.id && evaluation.counteroffer) {
      const result = runtime.adapters.trade.counterProposal(
        proposal.id,
        evaluation.counteroffer.terms,
        gameState
      );
      return { evaluation, result };
    }

    return { evaluation };
  }

  /* ---------------------------------------------------------
     MEMORY
     --------------------------------------------------------- */

  function remember(countryId, memory, gameState = runtime.lastGameState || window.gameState) {
    const ai = ensureState(countryId);
    ai.decisionMemory.push({
      id: memory.id || makeId("memory"),
      turn: memory.turn ?? turnNumber(gameState),
      type: memory.type,
      countryId: memory.countryId,
      weight: num(memory.weight),
      data: safeClone(memory.data || {})
    });

    if (ai.decisionMemory.length > runtime.config.memoryLimit) {
      ai.decisionMemory.splice(0, ai.decisionMemory.length - runtime.config.memoryLimit);
    }

    return ai.decisionMemory[ai.decisionMemory.length - 1];
  }

  function recordAgreementBroken(aiCountryId, breakerCountryId, agreement, gameState) {
    return remember(aiCountryId, {
      type: "AGREEMENT_BROKEN",
      countryId: breakerCountryId,
      weight: -18,
      data: { agreementId: agreement?.id ?? null, goodId: agreement?.goodId ?? null }
    }, gameState);
  }

  function recordAgreementHonored(aiCountryId, partnerCountryId, agreement, gameState) {
    return remember(aiCountryId, {
      type: "AGREEMENT_HONORED",
      countryId: partnerCountryId,
      weight: 5,
      data: { agreementId: agreement?.id ?? null }
    }, gameState);
  }

  function recordInvestmentCancelled(aiCountryId, hostCountryId, investment, gameState) {
    return remember(aiCountryId, {
      type: "INVESTMENT_CANCELLED",
      countryId: hostCountryId,
      weight: -14,
      data: { investmentId: investment?.id ?? null }
    }, gameState);
  }

  function recordTariffRaised(aiCountryId, sourceCountryId, goodId, gameState) {
    return remember(aiCountryId, {
      type: "TARIFF_RAISED",
      countryId: sourceCountryId,
      weight: -6,
      data: { goodId }
    }, gameState);
  }

  /* ---------------------------------------------------------
     FULL COUNTRY / FULL WORLD UPDATE
     --------------------------------------------------------- */

  function updateCountry(countryId, gameState = window.gameState) {
    runtime.lastGameState = gameState;
    if (!runtime.adapters) runtime.adapters = makeAdapters();

    const ai = ensureState(countryId);
    ensureForeignIndustryEconomy(countryId, gameState);

    observeCountry(countryId, gameState);
    detectNeeds(countryId, gameState);
    detectOpportunities(countryId, gameState);
    updateStrategicGoals(countryId, gameState);
    composePlans(countryId, gameState);
    reviewActivePlans(countryId, gameState);

    const generated = generateActions(countryId, gameState);
    const scored = generated
      .map(a => scoreAction(countryId, a, gameState))
      .sort((a, b) => b.utility - a.utility);

    ai.candidateActions = scored.slice(0, runtime.config.debugCandidateLimit);

    const major = scored.filter(isMajorAction);
    const minor = scored.filter(a => !isMajorAction(a));

    const chosenMajor = chooseAction(countryId, major, gameState);
    const results = [];

    if (chosenMajor) {
      results.push({
        action: chosenMajor,
        result: executeAction(countryId, chosenMajor, gameState)
      });
    }

    const chosenMinor = chooseAction(countryId, minor, gameState);
    if (chosenMinor) {
      results.push({
        action: chosenMinor,
        result: executeAction(countryId, chosenMinor, gameState)
      });
    }

    // If no action, still record that AI deliberately held.
    if (!results.length) {
      ai.lastDecision = {
        turn: turnNumber(gameState),
        turnLabel: currentTurnLabel(gameState),
        action: null,
        result: { ok: true, held: true, reason: "No candidate cleared the minimum utility threshold." }
      };
    }

    refreshForeignIndustryMonitor(gameState);

    return {
      countryId,
      observation: ai.lastObservation,
      needs: ai.currentNeeds,
      opportunities: ai.perceivedOpportunities,
      goals: ai.strategicGoals,
      activePlans: ai.activePlans,
      foreignIndustry: getForeignIndustryMonitor(countryId, gameState),
      candidates: ai.candidateActions,
      decisions: results,
      explanation: getDecisionExplanation(countryId)
    };
  }

  function updateAll(gameState = window.gameState) {
    initialize(gameState);

    // Modules 3 and 5 may update their own derived state before AI observes.
    runtime.adapters.economy.update(gameState);
    runtime.adapters.trade.update(gameState);

    const results = [];

    for (const countryId of AI_COUNTRY_IDS) {
      if (gameState?.countries?.[countryId]) {
        results.push(updateCountry(countryId, gameState));
      } else {
        const ai = ensureState(countryId);
        ai.diagnostics.adapterWarnings.push(
          `Skipped ${countryId}: Module 1 has not created this country yet.`
        );
      }
    }

    return results;
  }

  /* ---------------------------------------------------------
     EXPLANATIONS / DEBUGGER
     --------------------------------------------------------- */

  function getDecisionExplanation(countryId) {
    const ai = ensureState(countryId);
    const decision = ai.lastDecision;
    if (!decision?.action) {
      return {
        countryId,
        chosenAction: null,
        public: `${countryId} made no major strategic move this turn.`,
        reasons: []
      };
    }

    const a = decision.action;
    const reasons = arr(a.reasons).slice(0, 5);

    return {
      countryId,
      chosenAction: a.label ?? a.type,
      utility: a.utility,
      reasons,
      public: publicExplanation(countryId, a, ai)
    };
  }

  function publicExplanation(countryId, action, ai) {
    const countryName =
      runtime.lastGameState?.countries?.[countryId]?.name ??
      countryId;

    if (action.type === "PROPOSE_INVESTMENT") {
      return `${countryName} sees ${action.partnerId} as a useful source of ${action.goodId} and is seeking a longer-term economic position there.`;
    }

    if (action.type === "PROPOSE_TRADE") {
      if (action.diversification) {
        return `${countryName} is trying to diversify its ${action.goodId} supply and reduce reliance on a single partner.`;
      }
      if (action.direction === "import") {
        return `${countryName} is seeking additional ${action.goodId} supply because current domestic availability is insufficient.`;
      }
      return `${countryName} is seeking a foreign market for excess ${action.goodId} production.`;
    }

    if (action.type === "START_PROJECT") {
      return `${countryName} is starting ${action.label?.toLowerCase() || "a development project"} in response to current economic conditions.`;
    }

    if (action.type === "SET_TARIFF") {
      return `${countryName} is adjusting trade protection in response to competitive pressure on domestic industry.`;
    }

    return `${countryName} selected this action because it best matched its current needs and strategic goals.`;
  }

  function getActivePlans(countryId) {
    return safeClone(ensureState(countryId).activePlans);
  }

  function getDebugSnapshot(countryId) {
    const ai = ensureState(countryId);
    return safeClone({
      countryId,
      identity: ai.identity,
      needs: ai.currentNeeds.map(n => ({
        type: n.type,
        severity: round1(n.severity),
        goodId: n.goodId,
        partnerId: n.partnerId
      })),
      opportunities: ai.perceivedOpportunities.map(o => ({
        type: o.type,
        value: round1(o.value),
        goodId: o.goodId,
        partnerId: o.partnerId
      })),
      threats: ai.perceivedThreats.map(t => ({
        type: t.type,
        severity: round1(t.severity),
        goodId: t.goodId,
        rivalCountryId: t.rivalCountryId,
        marketShare: round1(t.marketShare)
      })),
      goals: ai.strategicGoals,
      activePlans: ai.activePlans,
      candidateActions: ai.candidateActions.map(a => ({
        action: a.label ?? a.type,
        type: a.type,
        utility: a.utility,
        reasons: a.reasons
      })),
      decision: ai.lastDecision,
      memory: ai.decisionMemory,
      diagnostics: ai.diagnostics,
      foreignIndustry: getForeignIndustryMonitor(countryId, runtime.lastGameState)
    });
  }

  function formatDebugText(countryId) {
    const d = getDebugSnapshot(countryId);
    const lines = [];

    lines.push(`${countryId.toUpperCase()} — AI DEBUG`);
    lines.push("");

    lines.push("NEEDS");
    if (!d.needs.length) lines.push("  none");
    for (const n of d.needs) {
      lines.push(`  ${n.type}${n.goodId ? ` (${n.goodId})` : ""} — severity ${n.severity}`);
    }

    lines.push("");
    lines.push("OPPORTUNITIES");
    if (!d.opportunities.length) lines.push("  none");
    for (const o of d.opportunities.slice(0, 10)) {
      lines.push(`  ${o.type}${o.goodId ? ` (${o.goodId})` : ""} — value ${o.value}`);
    }

    lines.push("");
    lines.push("THREATS");
    if (!d.threats?.length) lines.push("  none");
    for (const t of (d.threats || []).slice(0, 10)) {
      lines.push(`  ${t.type}${t.goodId ? ` (${t.goodId})` : ""} — severity ${t.severity}${t.rivalCountryId ? ` — rival ${t.rivalCountryId}` : ""}`);
    }

    lines.push("");
    lines.push("GOALS");
    for (const g of d.goals) {
      lines.push(`  ${g.type} — priority ${round1(g.priority)}`);
    }

    lines.push("");
    lines.push("ACTIVE PLANS");
    if (!d.activePlans.length) lines.push("  none");
    for (const p of d.activePlans) {
      lines.push(`  ${p.type} — ${p.status} — stage ${p.currentStage + 1}/${p.stages.length}`);
    }

    lines.push("");
    lines.push("CANDIDATE ACTIONS");
    if (!d.candidateActions.length) lines.push("  none");
    for (const a of d.candidateActions.slice(0, 10)) {
      lines.push(`  ${a.action} — utility ${a.utility}`);
    }

    lines.push("");
    lines.push("DECISION");
    lines.push(`  ${d.decision?.action?.label ?? "Hold / no action"}`);

    if (d.decision?.action?.reasons?.length) {
      lines.push("");
      lines.push("REASONS");
      for (const r of d.decision.action.reasons.slice(0, 8)) {
        lines.push(`  ${r.value >= 0 ? "+" : ""}${r.value} ${r.reason}`);
      }
    }

    lines.push("");
    lines.push("MEMORY");
    if (!d.memory.length) lines.push("  none");
    for (const m of d.memory.slice(-10)) {
      lines.push(`  ${m.type} with ${m.countryId} — weight ${m.weight}`);
    }

    if (d.diagnostics.adapterWarnings?.length) {
      lines.push("");
      lines.push("WARNINGS");
      for (const w of d.diagnostics.adapterWarnings) lines.push(`  ${w}`);
    }

    return lines.join("\n");
  }

  /* ---------------------------------------------------------
     TEST HELPERS
     These do not mutate the live gameState unless explicitly passed.
     --------------------------------------------------------- */

  function runRequiredTests() {
    const results = [];

    results.push(testMeridianCoalChoice());
    results.push(testNorviaCoalChoice());
    results.push(testBrokenAgreementMemory());
    results.push(testChangingWorldResponse());
    results.push(testLandedCostPreference());
    results.push(testFutureCapacityAvoidsOverreaction());
    results.push(testFiscalGuard());
    results.push(testMarketCompetition());
    results.push(testComposablePlans());

    return results;
  }

  function syntheticBase() {
    return {
      time: { year: 2030, half: 1 },
      playerCountryId: "asteria",
      countries: {
        asteria: { id: "asteria", name: "Republic of Asteria" },
        meridian: { id: "meridian", name: "Meridian Republic" },
        norvia: { id: "norvia", name: "Norvia" }
      },
      regions: {},
      cities: {},
      resourceSites: {},
      facilities: {},
      connections: {},
      projects: {},
      economy: {
        countries: {
          asteria: { goods: {} },
          meridian: { goods: {} },
          norvia: { goods: {} }
        },
        finance: {
          asteria: { treasury: 150, revenue: 60, debt: 20 },
          meridian: { treasury: 300, revenue: 100, debt: 30 },
          norvia: { treasury: 220, revenue: 90, debt: 40 }
        }
      },
      population: { countries: {} },
      trade: { imports: {}, exports: {} },
      tradeRelations: {},
      diplomaticRelations: {
        meridian: { asteria: 60, norvia: 48 },
        norvia: { asteria: 55, meridian: 45 }
      },
      issues: {},
      events: [],
      history: [],
      flags: {}
    };
  }

  function withTemporaryAdapters(testState, fn) {
    const oldState = runtime.lastGameState;
    const oldAdapters = runtime.adapters;

    runtime.lastGameState = testState;
    runtime.adapters = makeAdapters();

    try {
      return fn();
    } finally {
      runtime.lastGameState = oldState;
      runtime.adapters = oldAdapters;
    }
  }

  function testMeridianCoalChoice() {
    const s = syntheticBase();
    s.economy.countries.meridian.goods.coal = {
      production: 20, demand: 60, shortage: 40, surplus: 0, price: 2.0
    };
    s.economy.countries.asteria.goods.coal = {
      production: 90, demand: 30, shortage: 0, surplus: 60, price: 1.1
    };
    s.economy.countries.norvia.goods.coal = {
      production: 45, demand: 35, shortage: 0, surplus: 10, price: 1.5
    };
    s.resourceSites.asteria_coal = {
      id: "asteria_coal", type: "coal_deposit", countryId: "asteria",
      regionId: "a1", developed: true
    };

    return withTemporaryAdapters(s, () => {
      runtime.states.meridian = createDecisionState("meridian");
      observeCountry("meridian", s);
      detectNeeds("meridian", s);
      const opps = detectOpportunities("meridian", s);
      const considersAsteria = opps.some(
        o => o.partnerId === "asteria" &&
        ["IMPORT_OPPORTUNITY", "FOREIGN_INVESTMENT_OPPORTUNITY"].includes(o.type)
      );
      return {
        test: "MERIDIAN_COAL_SHORTAGE",
        pass: considersAsteria,
        detail: considersAsteria
          ? "Meridian considered trade/investment relationship with Asteria."
          : "Meridian failed to identify Asterian coal opportunity."
      };
    });
  }

  function testNorviaCoalChoice() {
    const s = syntheticBase();
    s.economy.countries.norvia.goods.iron = {
      production: 60, demand: 35, shortage: 0, surplus: 25
    };
    s.economy.countries.norvia.goods.coal = {
      production: 12, demand: 50, shortage: 38, surplus: 0
    };
    s.economy.countries.asteria.goods.coal = {
      production: 70, demand: 20, shortage: 0, surplus: 50
    };
    s.trade.imports.meridian = [
      { partnerId: "asteria", goodId: "coal", quantity: 60 }
    ];

    return withTemporaryAdapters(s, () => {
      runtime.states.norvia = createDecisionState("norvia");
      observeCountry("norvia", s);
      detectNeeds("norvia", s);
      const opps = detectOpportunities("norvia", s);
      const seesAsteria = opps.some(
        o => o.type === "IMPORT_OPPORTUNITY" &&
             o.goodId === "coal" &&
             o.partnerId === "asteria"
      );
      return {
        test: "NORVIA_COAL_SHORTAGE",
        pass: seesAsteria,
        detail: seesAsteria
          ? "Norvia identified Asteria as a coal supplier."
          : "Norvia did not identify a coal import opportunity."
      };
    });
  }

  function testBrokenAgreementMemory() {
    const s = syntheticBase();

    return withTemporaryAdapters(s, () => {
      runtime.states.meridian = createDecisionState("meridian");
      recordAgreementBroken(
        "meridian",
        "asteria",
        { id: "coal_contract_1", goodId: "coal" },
        s
      );
      const penalty = memoryModifier("meridian", "asteria", s);
      return {
        test: "PLAYER_BREAKS_AGREEMENT",
        pass: penalty < -10,
        detail: `Future Asteria utility memory modifier = ${round1(penalty)}.`
      };
    });
  }

  function testChangingWorldResponse() {
    const s = syntheticBase();
    s.economy.countries.asteria.goods.manufactured_goods = {
      production: 80, demand: 30, shortage: 0, surplus: 50
    };
    s.economy.countries.meridian.goods.manufactured_goods = {
      production: 20, demand: 55, shortage: 35, surplus: 0
    };

    return withTemporaryAdapters(s, () => {
      runtime.states.meridian = createDecisionState("meridian");
      observeCountry("meridian", s);
      detectNeeds("meridian", s);
      const opps = detectOpportunities("meridian", s);
      const seesManufactures = opps.some(
        o => o.type === "IMPORT_OPPORTUNITY" &&
             o.partnerId === "asteria" &&
             o.goodId === "manufactured_goods"
      );
      return {
        test: "CHANGING_WORLD",
        pass: seesManufactures,
        detail: seesManufactures
          ? "Meridian updated its view of Asteria and saw manufactured-goods supply."
          : "Meridian failed to respond to Asteria's new manufacturing surplus."
      };
    });
  }


  function testLandedCostPreference() {
    const s = syntheticBase();
    s.economy.countries.meridian.goods.coal = { production: 10, demand: 50, shortage: 40, price: 2 };
    s.economy.countries.asteria.goods.coal = { production: 80, demand: 20, surplus: 60, price: 1 };
    s.economy.countries.norvia.goods.coal = { production: 80, demand: 20, surplus: 60, price: 3 };
    s.trade.routes = [
      { exporterId: "asteria", importerId: "meridian", goodId: "coal", transportCostPerUnit: 0.2, tariffRate: 0.05, capacity: 100 },
      { exporterId: "norvia", importerId: "meridian", goodId: "coal", transportCostPerUnit: 1.0, tariffRate: 0.20, capacity: 100 }
    ];
    return withTemporaryAdapters(s, () => {
      runtime.states.meridian = createDecisionState("meridian");
      observeCountry("meridian", s); detectNeeds("meridian", s); detectOpportunities("meridian", s);
      const ops = runtime.states.meridian.perceivedOpportunities.filter(o => o.type === "IMPORT_OPPORTUNITY" && o.goodId === "coal");
      const a = ops.find(o => o.partnerId === "asteria")?.tradeQuote?.landedUnitCost;
      const n = ops.find(o => o.partnerId === "norvia")?.tradeQuote?.landedUnitCost;
      return { test: "LANDED_COST", pass: a < n, detail: `Asteria=${round1(a)}, Norvia=${round1(n)}` };
    });
  }

  function testFutureCapacityAvoidsOverreaction() {
    const s = syntheticBase();
    s.economy.countries.meridian.goods.coal = { production: 20, demand: 50, shortage: 30, price: 2 };
    s.projects.coal_future = {
      id: "coal_future", type: "coal_mine", ownerCountryId: "meridian",
      status: "under_construction", turnsRemaining: 1, expectedAnnualOutput: 35, cost: 20
    };
    return withTemporaryAdapters(s, () => {
      const p = getProjectedGoodBalance("meridian", "coal", s);
      return { test: "FUTURE_CAPACITY", pass: p.projectedShortage === 0, detail: `Projected shortage=${p.projectedShortage}, incoming=${p.incomingCapacity}` };
    });
  }

  function testFiscalGuard() {
    const s = syntheticBase();
    s.economy.finance.meridian = { treasury: 20, revenue: 20, debt: 120 };
    return withTemporaryAdapters(s, () => {
      const b = getStrategicBudget("meridian", s);
      return { test: "FISCAL_BUDGET", pass: b.developmentBudget < 20, detail: `Development budget=${round1(b.developmentBudget)}, reserve=${round1(b.reserveFloor)}` };
    });
  }

  function testMarketCompetition() {
    const s = syntheticBase();
    s.trade.exports = {
      meridian: [{ partnerId: "asteria", goodId: "steel", quantity: 70 }],
      norvia: [{ partnerId: "asteria", goodId: "steel", quantity: 20 }],
      asteria: [{ partnerId: "norvia", goodId: "steel", quantity: 10 }]
    };
    return withTemporaryAdapters(s, () => {
      const pos = getMarketPosition("norvia", "steel", s);
      return { test: "MARKET_COMPETITION", pass: pos.leadingRival?.countryId === "meridian" && pos.rivalDominance >= 0.6, detail: JSON.stringify(pos) };
    });
  }

  function testComposablePlans() {
    const s = syntheticBase();
    s.economy.countries.meridian.goods.coal = { production: 10, demand: 60, shortage: 50 };
    return withTemporaryAdapters(s, () => {
      runtime.states.meridian = createDecisionState("meridian");observeCountry("meridian", s); detectNeeds("meridian", s);
      const plans = composePlans("meridian", s);
      const p = plans.find(x => x.type === "SECURE_RESOURCE_CHAIN" && x.targetGoodId === "coal");
      return { test: "COMPOSABLE_PLANS", pass: !!p && p.stages.length >= 4, detail: p ? p.stages.map(x => x.id).join(",") : "missing" };
    });
  }

  function round1(v) {
    return Math.round(num(v) * 10) / 10;
  }

  /* ---------------------------------------------------------
     CONFIG / INTEGRATION
     --------------------------------------------------------- */

  function configure(options = {}) {
    runtime.config = { ...runtime.config, ...options };
    return safeClone(runtime.config);
  }

  function getState(countryId) {
    return safeClone(ensureState(countryId));
  }

  function reset(countryId = null) {
    if (!countryId) makeId.seq = 0;
    if (countryId) {
      runtime.states[countryId] = createDecisionState(countryId);
      return runtime.states[countryId];
    }

    runtime.states = {};
    for (const id of AI_COUNTRY_IDS) {
      runtime.states[id] = createDecisionState(id);
    }
    return runtime.states;
  }

  return {
    initialize,
    configure,
    reset,

    updateAll,
    updateCountry,
    observeCountry,
    detectNeeds,
    detectOpportunities,
    updateStrategicGoals,
    generateActions,
    scoreAction,
    chooseAction,
    executeAction,

    evaluateProposal,
    respondToProposal,

    remember,
    recordAgreementBroken,
    recordAgreementHonored,
    recordInvestmentCancelled,
    recordTariffRaised,

    reviewActivePlans,
    getActivePlans,
    getDecisionExplanation,
    getDebugSnapshot,
    formatDebugText,
    getState,
    getForeignIndustryMonitor,

    runRequiredTests,

    // Strategic realism/debug helpers.
    getTradeLandedCost,
    getProjectedGoodBalance,
    getStrategicBudget,
    getMarketPosition,
    composePlans,

    profiles: safeClone(PROFILES),
    foreignIndustryBaselines: safeClone(FOREIGN_INDUSTRY_BASELINES)
  };
})();

window.CountryAI = CountryAI;
/* ===== END MODULE 6 — AI COUNTRIES ===== */
