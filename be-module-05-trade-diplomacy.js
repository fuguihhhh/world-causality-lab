/* ===== MODULE 5 — TRADE & DIPLOMACY — INLINE INTEGRATED ===== */
/* Border Epoch — Module 5: Trade & Diplomacy
   Rules layer only. This module never chooses actions for AI countries.
   It reads Modules 1–4 through shared gameState and exposes structured
   information for Module 6 to evaluate.
*/
"use strict";

const TradeDiplomacy = (() => {
  const GOODS = ["food", "coal", "iron", "steel", "manufactured_goods"];
  const TARIFF_LEVELS = [0, 0.10, 0.25];
  const AGREEMENT_TYPES = {
    TRADE_AGREEMENT: "trade_agreement",
    LONG_TERM_SUPPLY_CONTRACT: "long_term_supply_contract",
    FOREIGN_INVESTMENT_AGREEMENT: "foreign_investment_agreement",
    TECHNOLOGY_COOPERATION_AGREEMENT: "technology_cooperation_agreement"
  };

  const ACTION_MEMORY = {
    SIGNED_AGREEMENT: { relation: 6, trust: 3, decay: 0.88 },
    HONORED_CONTRACT: { relation: 1, trust: 2, decay: 0.92 },
    BROKE_TRADE_AGREEMENT: { relation: -16, trust: -28, decay: 0.97 },
    RAISED_TARIFF: { relation: -5, trust: -2, decay: 0.85 },
    LOWERED_TARIFF: { relation: 3, trust: 1, decay: 0.82 },
    RESTRICTED_INVESTMENT: { relation: -8, trust: -10, decay: 0.90 },
    REDUCED_IMPORTS: { relation: -5, trust: -4, decay: 0.86 },
    PREFERENTIAL_ACCESS: { relation: 5, trust: 2, decay: 0.86 }
  };

  let sequence = 1;
  let _lastState = null;

  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(+n) ? +n : 0));
  const round = (n, d = 2) => {
    const p = 10 ** d;
    return Math.round((Number(n) || 0) * p) / p;
  };
  const clone = v => v == null ? v : JSON.parse(JSON.stringify(v));
  const id = prefix => `${prefix}_${String(sequence++).padStart(4, "0")}`;
  const pairKey = (a, b) => [a, b].sort().join("__");
  const flowKey = (exporter, importer, good) => `${exporter}__${importer}__${good}`;
  const tariffKey = (importer, exporter, good) => `${importer}__${exporter}__${good || "*"}`;

  function getState(state) {
    const s = state || _lastState || (typeof window !== "undefined" ? window.gameState : null);
    if (!s) throw new Error("TradeDiplomacy requires shared gameState.");
    _lastState = s;
    return s;
  }

  function emit(state, event) {
    state.events ||= [];
    state.history ||= [];
    const stamp = {
      ...event,
      year: state.time?.year ?? null,
      half: state.time?.half ?? null,
      turn: getTurn(state)
    };
    state.events.push(stamp);
    state.history.push(stamp);
    return stamp;
  }

  function getTurn(state) {
    // Global game rule: 1 turn = 1 year.
    // If the shared state has an explicit turn counter, use it.
    // Otherwise the calendar year itself is the turn marker.
    // Legacy `half` fields are intentionally ignored by Module 5.
    if (Number.isFinite(state.turn)) return state.turn;
    if (Number.isFinite(state.time?.year)) return Number(state.time.year);
    return 0;
  }

  function countryExists(state, countryId) {
    return !!state.countries?.[countryId];
  }

  function initializeState(state = getState()) {
    _lastState = state;
    state.tradeRelations ||= {};
    state.tradeRoutes ||= {};
    state.diplomaticRelations ||= {};
    state.agreements ||= {};
    state.diplomaticProposals ||= {};
    state.foreignInvestments ||= {};
    state.tariffs ||= {};
    state.exportTaxes ||= {};
    state.exportRestrictions ||= {};
    state.marketAccess ||= {};
    state.marketAccessRules ||= {};
    state.tradeRestrictions ||= {};
    state.tradeLedger ||= {};
    state.tradeDiagnostics ||= { lastUpdateTurn: null, goods: {}, routes: {}, warnings: [] };

    for (const cid of Object.keys(state.countries || {})) {
      state.marketAccess[cid] ||= {};
      state.tradeLedger[cid] ||= {};
      for (const good of GOODS) {
        state.tradeLedger[cid][good] ||= {
          imports: 0, exports: 0, importValue: 0, exportValue: 0,
          averageImportPrice: 0, exportDemand: 0
        };
      }
    }

    const ids = Object.keys(state.countries || {});
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) ensureRelationship(ids[i], ids[j], state);
    }

    discoverForeignInvestments(state);
    return state;
  }

  function ensureRelationship(a, b, state = getState()) {
    if (a === b) throw new Error("Diplomatic relationship requires two different countries.");
    const key = pairKey(a, b);
    state.diplomaticRelations ||= {};
    if (!state.diplomaticRelations[key]) {
      state.diplomaticRelations[key] = {
        id: `relationship_${key}`,
        countryAId: [a, b].sort()[0],
        countryBId: [a, b].sort()[1],
        relation: 0,
        trust: 0,
        strategicCompetition: 0,
        activeAgreements: [],
        recentActions: [],
        dependence: {}
      };
    }
    const rel = state.diplomaticRelations[key];
    rel.activeAgreements ||= [];
    rel.recentActions ||= [];
    rel.dependence ||= {};
    rel.dependence[a] ||= { on: b, importDependency: {}, exportDependency: {}, investmentDependency: 0, total: 0 };
    rel.dependence[b] ||= { on: a, importDependency: {}, exportDependency: {}, investmentDependency: 0, total: 0 };
    return rel;
  }

  function getRelationship(a, b, state = getState()) {
    initializeState(state);
    return clone(ensureRelationship(a, b, state));
  }

  function rawRelationship(a, b, state) {
    return ensureRelationship(a, b, state);
  }

  function addRecentAction(a, b, type, details = {}, state = getState()) {
    const rel = rawRelationship(a, b, state);
    const spec = ACTION_MEMORY[type] || { relation: 0, trust: 0, decay: 0.90 };
    const action = {
      id: id("diplomatic_action"),
      type,
      turn: getTurn(state),
      relationImpact: Number(details.relationImpact ?? spec.relation ?? 0),
      trustImpact: Number(details.trustImpact ?? spec.trust ?? 0),
      competitionImpact: Number(details.competitionImpact ?? 0),
      decay: Number(details.decay ?? spec.decay ?? 0.90),
      details: clone(details)
    };
    rel.recentActions.push(action);
    if (rel.recentActions.length > 30) rel.recentActions.splice(0, rel.recentActions.length - 30);
    rel.relation = clamp(rel.relation + action.relationImpact, -100, 100);
    rel.trust = clamp(rel.trust + action.trustImpact, -100, 100);
    rel.strategicCompetition = clamp(rel.strategicCompetition + action.competitionImpact, 0, 100);
    return action;
  }

  function decayDiplomaticMemory(state) {
    for (const rel of Object.values(state.diplomaticRelations || {})) {
      const now = getTurn(state);
      for (const action of rel.recentActions || []) {
        const age = Math.max(0, now - (action.turn || now));
        action.currentWeight = round(Math.pow(action.decay ?? 0.9, age), 3);
      }
      rel.recentActions = (rel.recentActions || []).filter(a =>
        (a.currentWeight ?? 1) > 0.08 || a.type === "BROKE_TRADE_AGREEMENT"
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Module 3 adapters
  // Supports several likely economy shapes so Module 5 does not own production.
  // ---------------------------------------------------------------------------
  function hasMeaningfulEconomyGoods(economy) {
    return Object.values(economy?.goods || {}).some(g => {
      if (typeof g === "number") return Number(g) > 0;
      return ["production","output","supply","availableDomestic","domesticDemand","demand","consumption"]
        .some(k => Number.isFinite(Number(g?.[k])) && Number(g[k]) > 0);
    });
  }

  function economyCountry(state, countryId) {
    const shared = state.economy?.countries?.[countryId] || state.economy?.[countryId] || null;
    const declared = state.countries?.[countryId]?.economy || null;

    // Foreign AI countries are currently represented by Module 6 macro-industry
    // snapshots. Module 3 may still publish an empty placeholder for them. Use
    // the Module 6 snapshot only when the shared Module 3 record has no real
    // goods activity, so a future authoritative foreign economy automatically wins.
    if (
      countryId !== state.playerCountryId &&
      declared?.sourceModule === "module6_foreign_industry" &&
      !hasMeaningfulEconomyGoods(shared)
    ) return declared;

    if (shared) return shared;
    if (countryId === state.playerCountryId && state.economy && !state.economy.countries) return state.economy;
    return declared || {};
  }

  function goodRecord(state, countryId, goodId) {
    const e = economyCountry(state, countryId);
    return e.goods?.[goodId]
      || e.resources?.[goodId]
      || e.production?.[goodId]
      || state.countries?.[countryId]?.goods?.[goodId]
      || {};
  }

  function numberFrom(obj, names, fallback = 0) {
    for (const n of names) {
      const v = obj?.[n];
      if (Number.isFinite(+v)) return +v;
    }
    return fallback;
  }

  function getDomesticProduction(countryId, goodId, state = getState()) {
    const r = goodRecord(state, countryId, goodId);
    if (typeof r === "number") return Math.max(0, r);
    return Math.max(0, numberFrom(r, ["production", "output", "supply", "availableDomestic"], 0));
  }

  function getDomesticDemand(countryId, goodId, state = getState()) {
    const r = goodRecord(state, countryId, goodId);
    if (typeof r === "number") return 0;
    return Math.max(0, numberFrom(r, ["domesticDemand", "demand", "consumptionNeed", "required"], 0));
  }

  function getDomesticConsumption(countryId, goodId, state = getState()) {
    const r = goodRecord(state, countryId, goodId);
    return Math.max(0, numberFrom(r, ["consumption", "domesticConsumption", "consumed"],
      Math.min(getDomesticProduction(countryId, goodId, state), getDomesticDemand(countryId, goodId, state))));
  }

  function getBasePrice(countryId, goodId, state = getState()) {
    const r = goodRecord(state, countryId, goodId);
    return Math.max(0.01, numberFrom(r, ["price", "basePrice", "marketPrice"], 1));
  }

  function getSpotBid(exporterId, importerId, goodId, tariffRate, exportTaxRate, state = getState()) {
    const importerLocalPrice = getBasePrice(importerId, goodId, state);
    const exporterAsk = getBasePrice(exporterId, goodId, state);

    // Convert the importing market's local willingness-to-pay into the maximum
    // pre-tax price the exporter can receive after border taxes.
    const taxFactor = Math.max(0.0001, (1 + Math.max(0, exportTaxRate)) * (1 + Math.max(0, tariffRate)));
    const maxSellerPrice = importerLocalPrice / taxFactor;

    return {
      importerLocalPrice: round(importerLocalPrice, 4),
      exporterAsk: round(exporterAsk, 4),
      maxSellerPrice: round(Math.max(0, maxSellerPrice), 4),
      economicallyViable: maxSellerPrice + 1e-9 >= exporterAsk
    };
  }

  function getStrategicReserve(countryId, goodId, state = getState()) {
    const r = goodRecord(state, countryId, goodId);
    return Math.max(0, numberFrom(r, ["strategicReserveTarget", "reserveTarget", "reserve"], 0));
  }

  function getPotentialSurplus(countryId, goodId, state = getState()) {
    const production = getDomesticProduction(countryId, goodId, state);
    const consumption = getDomesticConsumption(countryId, goodId, state);
    const reserve = getStrategicReserve(countryId, goodId, state);
    return Math.max(0, production - consumption - reserve);
  }

  function getImportNeed(countryId, goodId, state = getState()) {
    const demand = getDomesticDemand(countryId, goodId, state);
    const production = getDomesticProduction(countryId, goodId, state);
    return Math.max(0, demand - production);
  }

  // ---------------------------------------------------------------------------
  // Infrastructure / route adapters
  // ---------------------------------------------------------------------------
  function getCountryTradeInfrastructure(countryId, state = getState()) {
    const ports = Object.values(state.facilities || {}).filter(f =>
      f.active !== false && f.countryId === countryId && f.type === "port"
    );
    if (ports.length) {
      return {
        countryId,
        capacity: ports.reduce((sum, p) => sum + Math.max(0, Number(p.tradeCapacity ?? p.capacity ?? 0)), 0),
        source: "physical_ports",
        physical: true,
        ports: ports.map(p => p.id)
      };
    }

    // Bootstrap only: an existing active port city can handle limited coastal
    // commerce before the player constructs a formal Module 2 port facility.
    // A physical port, once built, always takes precedence above this fallback.
    const portCities = Object.values(state.cities || {}).filter(c =>
      c?.active !== false &&
      c?.status !== "abandoned" &&
      c?.countryId === countryId &&
      String(c?.role || "").toLowerCase() === "port_city"
    );
    if (portCities.length) {
      const capacity = Math.min(90, portCities.reduce((sum, c) =>
        sum + Math.max(0, Number(c.tradeCapacity ?? c.portCapacity ?? 70)), 0));
      return {
        countryId,
        capacity,
        source: "initial_port_city_capacity",
        physical: false,
        ports: [],
        cities: portCities.map(c => c.id)
      };
    }

    const declared = Number(
      state.tradeInfrastructure?.[countryId]?.capacity
      ?? state.countries?.[countryId]?.tradeCapacity
      ?? state.countries?.[countryId]?.externalTradeCapacity
    );

    const allowFallback = state.flags?.allowLegacyTradeCapacityFallback !== false;
    if (allowFallback && Number.isFinite(declared) && declared > 0) {
      state.tradeDiagnostics ||= { warnings: [] };
      state.tradeDiagnostics.warnings ||= [];
      const msg = `LEGACY_TRADE_CAPACITY_FALLBACK:${countryId}`;
      if (!state.tradeDiagnostics.warnings.includes(msg)) state.tradeDiagnostics.warnings.push(msg);
      return {
        countryId,
        capacity: Math.max(0, declared),
        source: "legacy_country_capacity",
        physical: false,
        ports: []
      };
    }

    return { countryId, capacity: 0, source: "none", physical: false, ports: [] };
  }

  function fallbackEndpointKey(countryId, infra) {
    if (!infra || !(infra.capacity > 0)) return null;
    if (infra.source === "legacy_country_capacity") return `legacy:${countryId}`;
    if (infra.source === "initial_port_city_capacity") return `port_city:${countryId}`;
    return null;
  }

  function getCountryPortCapacity(countryId, state = getState()) {
    return getCountryTradeInfrastructure(countryId, state).capacity;
  }

  function getRailAccessCapacity(countryId, exportLocationId, state = getState()) {
    if (!exportLocationId) return Infinity;
    const regionId = state.cities?.[exportLocationId]?.regionId
      || state.facilities?.[exportLocationId]?.regionId
      || state.resourceSites?.[exportLocationId]?.regionId
      || (state.regions?.[exportLocationId] ? exportLocationId : null);
    if (!regionId) return Infinity;

    const connections = Object.values(state.connections || {}).filter(c => c.active !== false && c.type === "railway");
    if (!connections.length) return Infinity;

    const touching = connections.filter(c => c.fromId === regionId || c.toId === regionId);
    if (!touching.length) return Infinity;
    return touching.reduce((sum, c) => sum + Math.max(0, Number(c.capacity || 0)), 0);
  }

  function findDefaultPort(countryId, state = getState()) {
    const ports = Object.values(state.facilities || {}).filter(f =>
      f.active !== false && f.countryId === countryId && f.type === "port"
    );
    return ports.sort((a, b) => Number(b.tradeCapacity ?? b.capacity ?? 0) - Number(a.tradeCapacity ?? a.capacity ?? 0))[0] || null;
  }

  function createTradeRoute(def, state = getState()) {
    initializeState(state);
    if (!countryExists(state, def.exporterCountryId) || !countryExists(state, def.importerCountryId))
      return { ok: false, error: "Unknown exporter or importer." };

    const exporterPort = def.exportLocationId
      ? state.facilities?.[def.exportLocationId] || null
      : findDefaultPort(def.exporterCountryId, state);
    const importerPort = def.importLocationId
      ? state.facilities?.[def.importLocationId] || null
      : findDefaultPort(def.importerCountryId, state);

    const exportCap = exporterPort
      ? Number(exporterPort.tradeCapacity ?? exporterPort.capacity ?? 0)
      : getCountryPortCapacity(def.exporterCountryId, state);
    const importCap = importerPort
      ? Number(importerPort.tradeCapacity ?? importerPort.capacity ?? 0)
      : getCountryPortCapacity(def.importerCountryId, state);

    const explicit = Number(def.capacity);
    const capacity = Number.isFinite(explicit)
      ? Math.max(0, explicit)
      : Math.max(0, Math.min(exportCap || 0, importCap || 0));

    const route = {
      id: def.id || id("trade_route"),
      exporterCountryId: def.exporterCountryId,
      importerCountryId: def.importerCountryId,
      exportLocationId: def.exportLocationId || exporterPort?.id || null,
      importLocationId: def.importLocationId || importerPort?.id || null,
      capacity,
      active: def.active !== false,
      usedCapacity: 0,
      estimatedInfrastructure: !exporterPort || !importerPort,
      infrastructureSource: {
        exporter: exporterPort ? "physical_port" : getCountryTradeInfrastructure(def.exporterCountryId, state).source,
        importer: importerPort ? "physical_port" : getCountryTradeInfrastructure(def.importerCountryId, state).source
      }
    };
    state.tradeRoutes[route.id] = route;
    return { ok: true, route };
  }

  function getRouteEndpointDescriptor(route, side, state = getState()) {
    if (!route) return { key: null, capacity: 0, source: "none", facilityId: null };

    const isExport = side === "export";
    const countryId = isExport ? route.exporterCountryId : route.importerCountryId;
    const locationId = isExport ? route.exportLocationId : route.importLocationId;

    const ports = Object.values(state.facilities || {}).filter(f =>
      f.active !== false && f.countryId === countryId && f.type === "port"
    );

    let port = null;
    if (locationId) {
      const direct = state.facilities?.[locationId];
      if (direct?.type === "port" && direct.active !== false && direct.countryId === countryId) {
        port = direct;
      } else {
        const byCity = ports.filter(p => p.cityId && p.cityId === locationId);
        const byRegion = ports.filter(p => p.regionId && p.regionId === locationId);
        const candidates = byCity.length ? byCity : byRegion;
        if (candidates.length) {
          port = candidates.sort((a, b) =>
            Number(b.tradeCapacity ?? b.capacity ?? 0) - Number(a.tradeCapacity ?? a.capacity ?? 0)
          )[0];
        }
      }
    }

    if (!port && ports.length === 1) port = ports[0];
    if (!port && !locationId && ports.length) port = findDefaultPort(countryId, state);

    if (port) {
      return {
        key: `port:${port.id}`,
        capacity: Math.max(0, Number(port.tradeCapacity ?? port.capacity ?? 0)),
        source: "physical_port",
        facilityId: port.id,
        countryId
      };
    }

    const infra = getCountryTradeInfrastructure(countryId, state);
    const fallbackKey = fallbackEndpointKey(countryId, infra);
    if (fallbackKey) {
      return {
        key: fallbackKey,
        capacity: infra.capacity,
        source: infra.source,
        facilityId: null,
        countryId
      };
    }

    return { key: null, capacity: 0, source: "none", facilityId: null, countryId };
  }

  function makeEndpointCapacityPool(state = getState()) {
    const pool = {};
    for (const port of Object.values(state.facilities || {})) {
      if (port.active === false || port.type !== "port") continue;
      pool[`port:${port.id}`] = Math.max(0, Number(port.tradeCapacity ?? port.capacity ?? 0));
    }

    for (const cid of Object.keys(state.countries || {})) {
      const physicalPorts = Object.values(state.facilities || {}).some(f =>
        f.active !== false && f.type === "port" && f.countryId === cid
      );
      if (physicalPorts) continue;
      const infra = getCountryTradeInfrastructure(cid, state);
      const key = fallbackEndpointKey(cid, infra);
      if (key) pool[key] = infra.capacity;
    }
    return pool;
  }

  function getRouteCapacity(route, state) {
    if (!route || route.active === false) return 0;
    const declared = Math.max(0, Number(route.capacity || 0));
    const exportEndpoint = getRouteEndpointDescriptor(route, "export", state);
    const importEndpoint = getRouteEndpointDescriptor(route, "import", state);
    const railCap = getRailAccessCapacity(route.exporterCountryId, route.exportLocationId, state);
    return Math.max(0, Math.min(
      declared,
      exportEndpoint.capacity,
      importEndpoint.capacity,
      Number.isFinite(railCap) ? railCap : Infinity
    ));
  }

  function showRoute(route) {
    if (typeof window === "undefined") return;
    const fn = window.MapUI?.showTradeRoute;
    if (typeof fn === "function") fn(route);
  }

  function hideRoute(routeId) {
    if (typeof window === "undefined") return;
    const fn = window.MapUI?.hideTradeRoute;
    if (typeof fn === "function") fn(routeId);
  }

  // ---------------------------------------------------------------------------
  // Tariffs and market access
  // ---------------------------------------------------------------------------
  function normalizeTariff(rate) {
    const n = Number(rate);
    if (!TARIFF_LEVELS.some(x => Math.abs(x - n) < 1e-9)) {
      throw new Error("Prototype tariff must be 0, 0.10, or 0.25.");
    }
    return n;
  }

  function getTariff(importerId, exporterId, goodId, state = getState()) {
    initializeState(state);
    return Number(
      state.tariffs[tariffKey(importerId, exporterId, goodId)]
      ?? state.tariffs[tariffKey(importerId, exporterId, "*")]
      ?? 0
    );
  }

  function setTariff(importerId, exporterId, goodId, rate, state = getState()) {
    initializeState(state);
    const value = normalizeTariff(rate);
    const key = tariffKey(importerId, exporterId, goodId || "*");
    const before = Number(state.tariffs[key] || 0);
    state.tariffs[key] = value;

    if (before !== value) {
      addRecentAction(importerId, exporterId, value > before ? "RAISED_TARIFF" : "LOWERED_TARIFF",
        { goodId: goodId || "*", before, after: value }, state);
      emit(state, { type: "TARIFF_CHANGED", importerId, exporterId, goodId: goodId || "*", before, after: value });
    }
    return { ok: true, tariffRate: value };
  }

  function agreementTariffReduction(a, b, goodId, state) {
    let reduction = 0;
    for (const ag of Object.values(state.agreements || {})) {
      if (!ag.active) continue;
      const pairMatches = (ag.countryAId === a && ag.countryBId === b) || (ag.countryAId === b && ag.countryBId === a);
      if (!pairMatches) continue;
      if (ag.type !== AGREEMENT_TYPES.TRADE_AGREEMENT) continue;
      if (ag.terms?.goodId && ag.terms.goodId !== goodId) continue;
      reduction = Math.max(reduction, Number(ag.terms?.tariffReduction || 0));
    }
    return reduction;
  }

  function getEffectiveTariff(importerId, exporterId, goodId, state = getState()) {
    const base = getTariff(importerId, exporterId, goodId, state);
    const reduction = agreementTariffReduction(importerId, exporterId, goodId, state);
    return clamp(base - reduction, 0, 1);
  }

  function exportPolicyKey(exporterId, importerId, goodId) {
    return `${exporterId}__${importerId || "*"}__${goodId || "*"}`;
  }

  function getExportTax(exporterId, importerId, goodId, state = getState()) {
    initializeState(state);
    return Number(
      state.exportTaxes[exportPolicyKey(exporterId, importerId, goodId)]
      ?? state.exportTaxes[exportPolicyKey(exporterId, "*", goodId)]
      ?? state.exportTaxes[exportPolicyKey(exporterId, importerId, "*")]
      ?? state.exportTaxes[exportPolicyKey(exporterId, "*", "*")]
      ?? 0
    );
  }

  function setExportTax(exporterId, importerId, goodId, rate, state = getState()) {
    initializeState(state);
    const value = clamp(Number(rate), 0, 1);
    const key = exportPolicyKey(exporterId, importerId || "*", goodId || "*");
    const before = Number(state.exportTaxes[key] || 0);
    state.exportTaxes[key] = value;

    if (before !== value && importerId && importerId !== "*") {
      addRecentAction(exporterId, importerId, value > before ? "RAISED_EXPORT_TAX" : "LOWERED_EXPORT_TAX", {
        goodId: goodId || "*", before, after: value,
        relationImpact: value > before ? -4 : 2,
        trustImpact: value > before ? -1 : 0
      }, state);
    }

    emit(state, {
      type: "EXPORT_TAX_CHANGED",
      exporterId, importerId: importerId || "*", goodId: goodId || "*",
      before, after: value
    });
    return { ok: true, exportTaxRate: value };
  }

  function setExportRestriction(exporterId, importerId, goodId, rule = {}, state = getState()) {
    initializeState(state);
    const key = exportPolicyKey(exporterId, importerId || "*", goodId || "*");
    state.exportRestrictions[key] = {
      suspended: !!rule.suspended,
      maxVolume: Number.isFinite(+rule.maxVolume) ? Math.max(0, +rule.maxVolume) : null,
      maxShareOfSurplus: Number.isFinite(+rule.maxShareOfSurplus) ? clamp(+rule.maxShareOfSurplus, 0, 1) : null,
      setTurn: getTurn(state)
    };
    if (importerId && importerId !== "*") {
      addRecentAction(exporterId, importerId, "EXPORT_RESTRICTED", {
        goodId: goodId || "*",
        relationImpact: -6,
        trustImpact: -3,
        ...clone(state.exportRestrictions[key])
      }, state);
    }
    emit(state, {
      type: "EXPORT_RESTRICTION_CHANGED",
      exporterId, importerId: importerId || "*", goodId: goodId || "*",
      rule: clone(state.exportRestrictions[key])
    });
    return { ok: true, restriction: clone(state.exportRestrictions[key]) };
  }

  function getExportRestriction(exporterId, importerId, goodId, state = getState()) {
    initializeState(state);
    return clone(
      state.exportRestrictions[exportPolicyKey(exporterId, importerId, goodId)]
      ?? state.exportRestrictions[exportPolicyKey(exporterId, "*", goodId)]
      ?? state.exportRestrictions[exportPolicyKey(exporterId, importerId, "*")]
      ?? state.exportRestrictions[exportPolicyKey(exporterId, "*", "*")]
      ?? { suspended: false, maxVolume: null, maxShareOfSurplus: null }
    );
  }

  function getMarketAccessBreakdown(exporterId, importerId, goodId, state = getState()) {
    initializeState(state);

    const explicit = state.marketAccess?.[exporterId]?.[importerId]?.[goodId]
      ?? state.marketAccess?.[exporterId]?.[importerId]?.default;
    if (Number.isFinite(+explicit)) {
      return {
        access: clamp(+explicit, 0, 1),
        explicitOverride: true,
        legalAccess: 1,
        administrativeAccess: 1,
        tariffFactor: 1,
        agreementFactor: 1,
        trustReliability: 1,
        restrictionCap: clamp(+explicit, 0, 1)
      };
    }

    const rules = state.marketAccessRules?.[exporterId]?.[importerId]?.[goodId]
      ?? state.marketAccessRules?.[exporterId]?.[importerId]?.default
      ?? {};

    const rel = rawRelationship(exporterId, importerId, state);
    const tariff = getEffectiveTariff(importerId, exporterId, goodId, state);

    // Concrete institutional factors dominate access.
    const legalAccess = clamp(Number(rules.legalAccess ?? 1), 0, 1);
    const administrativeAccess = clamp(Number(rules.administrativeAccess ?? 1), 0, 1);
    const licensingAccess = clamp(Number(rules.licensingAccess ?? 1), 0, 1);
    const standardsAccess = clamp(Number(rules.standardsAccess ?? 1), 0, 1);
    const tariffFactor = clamp(1 - tariff, 0, 1);

    const hasTradeAgreement = Object.values(state.agreements || {}).some(ag =>
      ag.active &&
      ag.type === AGREEMENT_TYPES.TRADE_AGREEMENT &&
      ((ag.countryAId === exporterId && ag.countryBId === importerId) ||
       (ag.countryAId === importerId && ag.countryBId === exporterId)) &&
      (!ag.terms?.goodId || ag.terms.goodId === goodId)
    );
    const agreementFactor = hasTradeAgreement ? 1 : clamp(Number(rules.noAgreementFactor ?? 0.88), 0, 1);

    // Relation no longer directly opens markets. Trust only has a small
    // enforcement/reliability effect because unreliable partners may face
    // paperwork, guarantees, or reduced commercial willingness.
    const trustReliability = clamp(0.9 + clamp(rel.trust, -100, 100) / 1000, 0.8, 1);

    const restriction = state.tradeRestrictions?.[flowKey(exporterId, importerId, goodId)];
    if (restriction?.suspended) {
      return {
        access: 0, legalAccess, administrativeAccess, licensingAccess,
        standardsAccess, tariffFactor, agreementFactor, trustReliability,
        restrictionCap: 0, explicitOverride: false
      };
    }
    const restrictionCap = Number.isFinite(+restriction?.maxAccess)
      ? clamp(+restriction.maxAccess, 0, 1)
      : 1;

    const access = clamp(
      legalAccess *
      administrativeAccess *
      licensingAccess *
      standardsAccess *
      tariffFactor *
      agreementFactor *
      trustReliability,
      0, restrictionCap
    );

    return {
      access: round(access, 4),
      legalAccess,
      administrativeAccess,
      licensingAccess,
      standardsAccess,
      tariffFactor: round(tariffFactor, 4),
      agreementFactor,
      trustReliability: round(trustReliability, 4),
      restrictionCap,
      explicitOverride: false
    };
  }

  function getMarketAccess(exporterId, importerId, goodId, state = getState()) {
    return getMarketAccessBreakdown(exporterId, importerId, goodId, state).access;
  }


  // ---------------------------------------------------------------------------
  // Trade relationships and flows
  // ---------------------------------------------------------------------------
  function createTradeRelation(def, state = getState()) {
    initializeState(state);
    if (!GOODS.includes(def.goodId)) return { ok: false, error: `Unknown good '${def.goodId}'.` };
    if (!countryExists(state, def.exporterCountryId) || !countryExists(state, def.importerCountryId))
      return { ok: false, error: "Unknown exporter or importer." };

    let routeId = def.routeId || null;
    if (!routeId) {
      const made = createTradeRoute({
        exporterCountryId: def.exporterCountryId,
        importerCountryId: def.importerCountryId,
        exportLocationId: def.exportLocationId,
        importLocationId: def.importLocationId,
        capacity: def.capacity
      }, state);
      if (made.ok) routeId = made.route.id;
    }

    const relation = {
      id: def.id || id(`trade_${def.exporterCountryId}_${def.importerCountryId}_${def.goodId}`),
      exporterCountryId: def.exporterCountryId,
      importerCountryId: def.importerCountryId,
      goodId: def.goodId,
      volume: 0,
      desiredVolume: Math.max(0, Number(def.desiredVolume ?? def.volume ?? 0)),
      priceMultiplier: Math.max(0.01, Number(def.priceMultiplier ?? 1)),
      routeId,
      tariffRate: getEffectiveTariff(def.importerCountryId, def.exporterCountryId, def.goodId, state),
      agreementId: def.agreementId || null,
      active: def.active !== false,
      createdTurn: getTurn(state),
      lastExplanation: []
    };
    state.tradeRelations[relation.id] = relation;
    emit(state, { type: "TRADE_RELATION_CREATED", tradeRelationId: relation.id });
    return { ok: true, tradeRelation: relation };
  }

  function endTradeRelation(tradeRelationId, reason = "ended", state = getState()) {
    const tr = state.tradeRelations?.[tradeRelationId];
    if (!tr) return { ok: false, error: "Trade relation not found." };
    tr.active = false;
    tr.volume = 0;
    tr.endedTurn = getTurn(state);
    tr.endReason = reason;
    if (tr.routeId) {
      const stillUsed = Object.values(state.tradeRelations).some(x => x.id !== tr.id && x.active && x.routeId === tr.routeId);
      if (!stillUsed) {
        if (state.tradeRoutes?.[tr.routeId]) state.tradeRoutes[tr.routeId].active = false;
        hideRoute(tr.routeId);
      }
    }
    emit(state, { type: "TRADE_RELATION_ENDED", tradeRelationId, reason });
    return { ok: true };
  }

  function getLongTermMinimum(tr, state) {
    if (!tr.agreementId) return 0;
    const ag = state.agreements?.[tr.agreementId];
    if (!ag?.active || ag.type !== AGREEMENT_TYPES.LONG_TERM_SUPPLY_CONTRACT) return 0;
    if (ag.terms?.goodId && ag.terms.goodId !== tr.goodId) return 0;
    return Math.max(0, Number(ag.terms?.minimumVolume || 0));
  }

  function clearLedger(state) {
    for (const cid of Object.keys(state.countries || {})) {
      state.tradeLedger[cid] ||= {};
      for (const good of GOODS) {
        state.tradeLedger[cid][good] = {
          imports: 0, exports: 0, importValue: 0, exportValue: 0,
          averageImportPrice: 0, exportDemand: 0
        };
      }
    }
  }

  function contractPerformance(tr, allocationMeta, state) {
    const minimum = getLongTermMinimum(tr, state);
    if (minimum <= 0 || !tr.agreementId) return null;
    const ag = state.agreements?.[tr.agreementId];
    if (!ag?.active) return null;

    const actual = Math.max(0, Number(tr.volume || 0));
    const shortfall = Math.max(0, minimum - actual);
    const ratio = minimum > 0 ? clamp(actual / minimum, 0, 1) : 1;

    let cause = "FULFILLED";
    let responsibility = "none";
    if (shortfall > 0.0001) {
      const initialSurplus = allocationMeta?.initialExporterSurplus ?? 0;
      const routeCap = allocationMeta?.routeCapacity ?? 0;
      const access = allocationMeta?.marketAccess ?? 0;
      const importerNeed = allocationMeta?.importerNeed ?? 0;
      const exportRestriction = allocationMeta?.exportRestriction || {};
      const exportControlExempt = !!allocationMeta?.exportControlExempt;
      const restrictionCap = allocationMeta?.initialExportRestrictionCap ?? Infinity;

      if (initialSurplus + 1e-9 < minimum) {
        cause = "EXPORTER_SUPPLY_SHORTFALL";
        responsibility = "exporter_capacity";
      } else if (!exportControlExempt &&
                 (exportRestriction.suspended || restrictionCap + 1e-9 < minimum)) {
        cause = "GOVERNMENT_EXPORT_RESTRICTION";
        responsibility = "exporter_policy";
      } else if (routeCap + 1e-9 < minimum) {
        cause = "LOGISTICS_CAPACITY_SHORTFALL";
        responsibility = "shared_logistics";
      } else if (access < 0.999 && minimum * access + 1e-9 < minimum) {
        cause = "MARKET_ACCESS_SHORTFALL";
        responsibility = "policy_or_access";
      } else if (importerNeed + 1e-9 < minimum) {
        cause = "IMPORTER_DEMAND_SHORTFALL";
        responsibility = "importer_demand";
      } else {
        cause = "COMPETING_ALLOCATION_SHORTFALL";
        responsibility = "exporter_allocation";
      }
    }

    const performance = {
      turn: getTurn(state),
      promisedVolume: round(minimum),
      deliveredVolume: round(actual),
      shortfall: round(shortfall),
      fulfillmentRatio: round(ratio, 3),
      cause,
      responsibility
    };

    ag.performance ||= {};
    ag.performance.current = performance;
    ag.performance.history ||= [];

    const prior = ag.performance.history.find(x => x.turn === performance.turn);
    if (prior) Object.assign(prior, performance);
    else ag.performance.history.push(clone(performance));

    // Apply diplomatic consequences only once per year, even if the economy is
    // recalculated multiple times during the same annual settlement.
    if (shortfall > 0.0001 && ag.performance.lastPenaltyTurn !== performance.turn) {
      const exporter = ag.terms?.exporterCountryId || tr.exporterCountryId;
      const importer = ag.terms?.importerCountryId || tr.importerCountryId;
      let trustImpact = 0;
      let relationImpact = 0;

      if (responsibility === "exporter_allocation") {
        trustImpact = -Math.max(3, Math.round(14 * (1 - ratio)));
        relationImpact = -Math.max(2, Math.round(8 * (1 - ratio)));
      } else if (responsibility === "exporter_policy") {
        trustImpact = -Math.max(5, Math.round(18 * (1 - ratio)));
        relationImpact = -Math.max(3, Math.round(10 * (1 - ratio)));
      } else if (responsibility === "exporter_capacity") {
        trustImpact = -Math.max(1, Math.round(6 * (1 - ratio)));
        relationImpact = -Math.max(1, Math.round(3 * (1 - ratio)));
      } else if (responsibility === "policy_or_access") {
        trustImpact = -Math.max(2, Math.round(10 * (1 - ratio)));
        relationImpact = -Math.max(2, Math.round(6 * (1 - ratio)));
      } else if (responsibility === "shared_logistics") {
        trustImpact = -Math.max(1, Math.round(4 * (1 - ratio)));
      }

      if (trustImpact || relationImpact) {
        addRecentAction(exporter, importer, "CONTRACT_SHORTFALL", {
          agreementId: ag.id,
          goodId: tr.goodId,
          promisedVolume: minimum,
          deliveredVolume: actual,
          cause,
          trustImpact,
          relationImpact,
          decay: 0.90
        }, state);
      }

      ag.performance.lastPenaltyTurn = performance.turn;
      emit(state, {
        type: "CONTRACT_SHORTFALL",
        agreementId: ag.id,
        exporterCountryId: exporter,
        importerCountryId: importer,
        goodId: tr.goodId,
        ...performance
      });
    }

    return performance;
  }

  function updateTradeFlows(state) {
    clearLedger(state);

    const exporterRemaining = {};
    const importerRemaining = {};
    const endpointRemaining = makeEndpointCapacityPool(state);

    for (const cid of Object.keys(state.countries || {})) {
      exporterRemaining[cid] = {};
      importerRemaining[cid] = {};
      for (const good of GOODS) {
        exporterRemaining[cid][good] = getPotentialSurplus(cid, good, state);
        importerRemaining[cid][good] = getImportNeed(cid, good, state);
      }
    }

    const initialExporterSurplus = clone(exporterRemaining);
    const initialImporterNeed = clone(importerRemaining);

    for (const route of Object.values(state.tradeRoutes || {})) route.usedCapacity = 0;

    const active = Object.values(state.tradeRelations || {}).filter(tr => tr.active);
    const groups = new Map();

    for (const tr of active) {
      const key = `${tr.exporterCountryId}__${tr.goodId}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(tr);
      tr.volume = 0;
      tr.contractVolume = 0;
      tr.spotVolume = 0;
      tr.spotUnitPrice = 0;
      tr.contractUnitPrice = 0;
      tr.marketClearingPrice = 0;
    }

    function remainingEndpoint(key) {
      if (!key) return 0;
      return Math.max(0, Number(endpointRemaining[key] || 0));
    }

    function consumeEndpoint(key, amount) {
      if (!key || amount <= 0) return;
      endpointRemaining[key] = Math.max(0, remainingEndpoint(key) - amount);
    }

    function sharedEndpointFactor(candidates, claimField, supplyAvailable) {
      const totalClaims = candidates.reduce((sum, c) => sum + Math.max(0, Number(c[claimField] || 0)), 0);
      if (totalClaims <= 0) return 0;

      let factor = Math.min(1, Math.max(0, supplyAvailable) / totalClaims);
      const claimsByEndpoint = {};

      for (const c of candidates) {
        const claim = Math.max(0, Number(c[claimField] || 0));
        if (claim <= 0) continue;
        const keys = new Set([
          c.m?.exportEndpoint?.key,
          c.m?.importEndpoint?.key
        ].filter(Boolean));

        for (const key of keys) {
          claimsByEndpoint[key] = (claimsByEndpoint[key] || 0) + claim;
        }
      }

      for (const [key, claims] of Object.entries(claimsByEndpoint)) {
        if (claims <= 0) continue;
        factor = Math.min(factor, remainingEndpoint(key) / claims);
      }

      return Math.max(0, factor);
    }

    for (const trs of groups.values()) {
      const exporterId = trs[0].exporterCountryId;
      const goodId = trs[0].goodId;
      const meta = new Map();

      for (const tr of trs) {
        const route = state.tradeRoutes?.[tr.routeId];
        const routeCap = getRouteCapacity(route, state);
        const access = getMarketAccess(tr.exporterCountryId, tr.importerCountryId, tr.goodId, state);
        const minimum = getLongTermMinimum(tr, state);
        const desired = Math.max(0, Number(tr.desiredVolume || 0), minimum);
        const importerNeed = initialImporterNeed[tr.importerCountryId]?.[goodId] || 0;
        const exportRestriction = getExportRestriction(tr.exporterCountryId, tr.importerCountryId, goodId, state);
        const exportTaxRate = getExportTax(tr.exporterCountryId, tr.importerCountryId, goodId, state);
        const startSurplus = initialExporterSurplus[exporterId]?.[goodId] || 0;

        const agreement = tr.agreementId ? state.agreements?.[tr.agreementId] : null;
        const exportControlExempt = !!(
          agreement?.active &&
          agreement.type === AGREEMENT_TYPES.LONG_TERM_SUPPLY_CONTRACT &&
          agreement.terms?.exportControlExempt === true
        );

        const restrictionCap = exportRestriction.suspended ? 0 : Math.min(
          exportRestriction.maxVolume == null ? Infinity : exportRestriction.maxVolume,
          exportRestriction.maxShareOfSurplus == null ? Infinity : startSurplus * exportRestriction.maxShareOfSurplus
        );

        const exportEndpoint = getRouteEndpointDescriptor(route, "export", state);
        const importEndpoint = getRouteEndpointDescriptor(route, "import", state);
        const tariffRate = getEffectiveTariff(tr.importerCountryId, tr.exporterCountryId, goodId, state);
        const bid = getSpotBid(exporterId, tr.importerCountryId, goodId, tariffRate, exportTaxRate, state);

        meta.set(tr.id, {
          route,
          routeCapacity: routeCap,
          routeRemaining: routeCap,
          exportEndpoint,exportEndpoint,
          importEndpoint,
          marketAccess: access,
          minimum,
          desired,
          importerNeed,
          tariffRate,
          exportTaxRate,
          exportRestriction,
          exportControlExempt,
          initialExportRestrictionCap: restrictionCap,
          exportRestrictionRemaining: restrictionCap,
          initialExporterSurplus: startSurplus,
          bid
        });
      }

      function feasibleClaim(tr, m, target, kind) {
        if (target <= 0) return 0;
        const importerId = tr.importerCountryId;
        const remainingNeed = importerRemaining[importerId]?.[goodId] || 0;

        const demandCeiling = kind === "contract"
          ? Math.max(remainingNeed, Math.max(0, m.minimum - Number(tr.contractVolume || 0)))
          : remainingNeed;

        const accessLimited = target * m.marketAccess;
        const restrictionRemaining = kind === "contract" && m.exportControlExempt
          ? Infinity
          : m.exportRestrictionRemaining;

        return Math.max(0, Math.min(
          demandCeiling,
          accessLimited,
          m.routeRemaining,
          restrictionRemaining,
          remainingEndpoint(m.exportEndpoint.key),
          remainingEndpoint(m.importEndpoint.key)
        ));
      }

      function applyAllocation(tr, m, amount, kind) {
        if (amount <= 0) return;
        const importerId = tr.importerCountryId;

        tr.volume = Number(tr.volume || 0) + amount;
        if (kind === "contract") tr.contractVolume = Number(tr.contractVolume || 0) + amount;
        else tr.spotVolume = Number(tr.spotVolume || 0) + amount;

        m.routeRemaining = Math.max(0, m.routeRemaining - amount);

        if (!(kind === "contract" && m.exportControlExempt)) {
          m.exportRestrictionRemaining = Math.max(0, m.exportRestrictionRemaining - amount);
        }

        exporterRemaining[exporterId][goodId] = Math.max(0, exporterRemaining[exporterId][goodId] - amount);
        importerRemaining[importerId][goodId] = Math.max(0, (importerRemaining[importerId][goodId] || 0) - amount);

        consumeEndpoint(m.exportEndpoint.key, amount);
        consumeEndpoint(m.importEndpoint.key, amount);

        if (m.route) m.route.usedCapacity = round((m.route.usedCapacity || 0) + amount);
      }

      // PASS 1 — long-term contracts.
      // Contract claims share insufficient supply proportionally. A contract can
      // bypass export controls only when its explicit terms say exportControlExempt.
      const contractCandidates = [];
      for (const tr of trs) {
        const m = meta.get(tr.id);
        if (m.minimum <= 0) continue;
        const claim = feasibleClaim(tr, m, m.minimum, "contract");
        if (claim > 0) contractCandidates.push({ tr, m, claim });
      }

      let availableSupply = exporterRemaining[exporterId]?.[goodId] || 0;
      const contractFactor = sharedEndpointFactor(contractCandidates, "claim", availableSupply);
      for (const c of contractCandidates) {
        applyAllocation(c.tr, c.m, c.claim * contractFactor, "contract");
      }

      // PASS 2 — spot/commercial market.
      // Buyers bid using their local market price net of border taxes.
      // Higher net bids receive scarce residual supply first; equal bids share
      // proportionally. The lowest accepted bid becomes the uniform clearing price.
      const spotCandidates = [];
      for (const tr of trs) {
        const m = meta.get(tr.id);
        const remainingTarget = Math.max(0, m.desired - Number(tr.volume || 0));
        if (remainingTarget <= 0 || !m.bid.economicallyViable) continue;

        const claim = feasibleClaim(tr, m, remainingTarget, "spot");
        if (claim > 0) {
          spotCandidates.push({
            tr, m, claim,
            bid: m.bid.maxSellerPrice,
            ask: getBasePrice(exporterId, goodId, state) * Math.max(0.01, Number(tr.priceMultiplier || 1))
          });
        }
      }

      spotCandidates.sort((a, b) => b.bid - a.bid);
      availableSupply = exporterRemaining[exporterId]?.[goodId] || 0;
      let clearingPrice = 0;
      let idx = 0;

      while (availableSupply > 1e-9 && idx < spotCandidates.length) {
        const bidLevel = spotCandidates[idx].bid;
        const sameBid = [];
        while (idx < spotCandidates.length && Math.abs(spotCandidates[idx].bid - bidLevel) < 1e-6) {
          sameBid.push(spotCandidates[idx]);
          idx++;
        }

        const eligible = sameBid.filter(c => c.bid + 1e-9 >= c.ask);
        if (!eligible.length) continue;

        // Recalculate claims because an earlier bid tier may have consumed shared
        // endpoint capacity.
        const live = eligible.map(c => {
          const remainingTarget = Math.max(0, c.m.desired - Number(c.tr.volume || 0));
          return { ...c, liveClaim: feasibleClaim(c.tr, c.m, remainingTarget, "spot") };
        }).filter(c => c.liveClaim > 1e-9);

        const total = live.reduce((sum, c) => sum + c.liveClaim, 0);
        if (total <= 0) continue;

        const tierFactor = sharedEndpointFactor(live, "liveClaim", availableSupply);
        for (const c of live) {
          const amount = c.liveClaim * tierFactor;
          applyAllocation(c.tr, c.m, amount, "spot");
          availableSupply = exporterRemaining[exporterId]?.[goodId] || 0;
          if (amount > 0) clearingPrice = Math.max(getBasePrice(exporterId, goodId, state), bidLevel);
        }
      }

      // Uniform price for all spot trades in this exporter-good market.
      if (clearingPrice > 0) {
        for (const tr of trs) {
          if ((tr.spotVolume || 0) > 0) {
            tr.spotUnitPrice = round(clearingPrice, 4);
            tr.marketClearingPrice = round(clearingPrice, 4);
          }
        }
      }

      // Final pricing, ledger and explanations.
      for (const tr of trs) {
        const m = meta.get(tr.id);
        const actual = Math.max(0, Number(tr.volume || 0));
        tr.volume = round(actual);
        tr.contractVolume = round(tr.contractVolume || 0);
        tr.spotVolume = round(tr.spotVolume || 0);
        tr.tariffRate = m.tariffRate;
        tr.marketAccess = round(m.marketAccess, 3);
        tr.routeCapacity = round(m.routeCapacity);
        tr.exportTaxRate = m.exportTaxRate;

        const exporterBase = getBasePrice(tr.exporterCountryId, tr.goodId, state);
        tr.contractUnitPrice = round(exporterBase * Math.max(0.01, Number(tr.priceMultiplier || 1)), 4);

        const contractPreTaxValue = tr.contractVolume * tr.contractUnitPrice;
        const spotPreTaxValue = tr.spotVolume * (tr.spotUnitPrice || tr.contractUnitPrice);
        const exportValue = contractPreTaxValue + spotPreTaxValue;
        tr.preTaxTradeValue = round(exportValue, 4);

        const borderFactor = (1 + m.exportTaxRate) * (1 + tr.tariffRate);
        const importValue = exportValue * borderFactor;
        const averageLandedPrice = actual > 0 ? importValue / actual : 0;

        tr.lastExplanation = [
          `Exporter starting surplus: ${round(m.initialExporterSurplus)}`,
          `Importer starting shortage: ${round(m.importerNeed)}`,
          `Desired volume: ${round(m.desired)}`,
          `Contract minimum: ${round(m.minimum)}`,
          `Contract volume: ${round(tr.contractVolume)}`,
          `Spot volume: ${round(tr.spotVolume)}`,
          `Spot buyer net bid: ${round(m.bid.maxSellerPrice, 4)}`,
          `Spot clearing price: ${round(tr.marketClearingPrice || 0, 4)}`,
          `Route capacity: ${round(m.routeCapacity)}`,
          `Export endpoint: ${m.exportEndpoint.key || "none"} (${m.exportEndpoint.source})`,
          `Import endpoint: ${m.importEndpoint.key || "none"} (${m.importEndpoint.source})`,
          `Market access: ${round(m.marketAccess * 100, 1)}%`,
          `Effective tariff: ${round(tr.tariffRate * 100, 1)}%`,
          `Export tax: ${round(m.exportTaxRate * 100, 1)}%`,
          `Export restriction: ${m.exportRestriction.suspended ? "suspended" : "active/none"}`,
          `Contract export-control exemption: ${m.exportControlExempt ? "yes" : "no"}`
        ];

        const ex = state.tradeLedger[tr.exporterCountryId][tr.goodId];
        const im = state.tradeLedger[tr.importerCountryId][tr.goodId];
        ex.exports += actual;
        ex.exportValue += exportValue;
        ex.exportDemand += m.desired;
        im.imports += actual;
        im.importValue += importValue;
        im._weightedImportPrice = (im._weightedImportPrice || 0) + actual * averageLandedPrice;

        if (actual > 0 && m.route) showRoute(m.route);
        contractPerformance(tr, m, state);
      }
    }

    for (const route of Object.values(state.tradeRoutes || {})) {
      if ((route.usedCapacity || 0) <= 0) hideRoute(route.id);
    }

    for (const cid of Object.keys(state.tradeLedger)) {
      for (const good of GOODS) {
        const g = state.tradeLedger[cid][good];
        g.imports = round(g.imports);
        g.exports = round(g.exports);
        g.importValue = round(g.importValue);
        g.exportValue = round(g.exportValue);
        g.exportDemand = round(g.exportDemand);
        g.averageImportPrice = g.imports > 0 ? round((g._weightedImportPrice || 0) / g.imports, 4) : 0;
        delete g._weightedImportPrice;
      }
    }

    state.tradeDiagnostics.endpointRemaining = clone(endpointRemaining);
    return { exporterRemaining, importerRemaining, endpointRemaining };
  }


  function getImports(countryId, goodId, state = getState()) {
    initializeState(state);
    return round(state.tradeLedger?.[countryId]?.[goodId]?.imports || 0);
  }

  function getExports(countryId, goodId, state = getState()) {
    initializeState(state);
    return round(state.tradeLedger?.[countryId]?.[goodId]?.exports || 0);
  }

  function getImportPrice(countryId, goodId, state = getState()) {
    initializeState(state);
    return round(state.tradeLedger?.[countryId]?.[goodId]?.averageImportPrice || 0, 4);
  }

  function getExportDemand(countryId, goodId, state = getState()) {
    initializeState(state);
    return round(state.tradeLedger?.[countryId]?.[goodId]?.exportDemand || 0);
  }

  function getRelationPreTaxTradeValue(tr, state = getState()) {
    if (!tr || tr.volume <= 0) return 0;
    if (Number.isFinite(+tr.preTaxTradeValue)) return Math.max(0, +tr.preTaxTradeValue);

    const contractPrice = Number(tr.contractUnitPrice || getBasePrice(tr.exporterCountryId, tr.goodId, state) * tr.priceMultiplier);
    const spotPrice = Number(tr.spotUnitPrice || contractPrice);
    return Math.max(0,
      Number(tr.contractVolume || 0) * contractPrice +
      Number(tr.spotVolume || 0) * spotPrice
    );
  }

  function getTariffRevenue(countryId, state = getState()) {
    let total = 0;
    for (const tr of Object.values(state.tradeRelations || {})) {
      if (!tr.active || tr.importerCountryId !== countryId || tr.volume <= 0) continue;
      const preTaxValue = getRelationPreTaxTradeValue(tr, state);
      const exportTax = getExportTax(tr.exporterCountryId, tr.importerCountryId, tr.goodId, state);
      total += preTaxValue * (1 + exportTax) * tr.tariffRate;
    }
    return round(total);
  }

  function getExportTaxRevenue(countryId, state = getState()) {
    let total = 0;
    for (const tr of Object.values(state.tradeRelations || {})) {
      if (!tr.active || tr.exporterCountryId !== countryId || tr.volume <= 0) continue;
      const preTaxValue = getRelationPreTaxTradeValue(tr, state);
      total += preTaxValue * getExportTax(tr.exporterCountryId, tr.importerCountryId, tr.goodId, state);
    }
    return round(total);
  }

  // ---------------------------------------------------------------------------
  // Dependence
  // ---------------------------------------------------------------------------
  function discoverForeignInvestments(state) {
    for (const facility of Object.values(state.facilities || {})) {
      const o = facility.ownership;
      if (!o || o.type !== "foreign" || !o.foreignCountryId || !Number(o.foreignShare)) continue;
      const existing = Object.values(state.foreignInvestments || {}).find(x => x.facilityId === facility.id && x.active !== false);
      if (existing) continue;
      const inv = {
        id: id("foreign_investment"),
        investorCountryId: o.foreignCountryId,
        hostCountryId: facility.countryId,
        facilityId: facility.id,
        ownershipShare: clamp(Number(o.foreignShare), 0, 1),
        investmentValue: Number(o.investmentValue ?? facility.investmentValue ?? 0),
        agreementId: o.agreementId || null,
        active: true,
        discoveredFromOwnership: true
      };
      state.foreignInvestments[inv.id] = inv;
    }
  }

  function registerForeignInvestment(def, state = getState()) {
    initializeState(state);
    const investment = {
      id: def.id || id("foreign_investment"),
      investorCountryId: def.investorCountryId,
      hostCountryId: def.hostCountryId,
      facilityId: def.facilityId || null,
      projectId: def.projectId || null,
      ownershipShare: clamp(Number(def.ownershipShare || 0), 0, 1),
      investmentValue: Math.max(0, Number(def.investmentValue || 0)),
      agreementId: def.agreementId || null,
      active: def.active !== false,
      createdTurn: getTurn(state)
    };
    state.foreignInvestments[investment.id] = investment;
    addRecentAction(investment.investorCountryId, investment.hostCountryId, "SIGNED_AGREEMENT",
      { relationImpact: 3, trustImpact: 2, investmentId: investment.id }, state);
    emit(state, { type: "FOREIGN_INVESTMENT_REGISTERED", investmentId: investment.id });
    return { ok: true, investment };
  }

  function updateDependencies(state) {
    discoverForeignInvestments(state);
    const countries = Object.keys(state.countries || {});

    for (let i = 0; i < countries.length; i++) {
      for (let j = i + 1; j < countries.length; j++) {
        const a = countries[i], b = countries[j];
        const rel = rawRelationship(a, b, state);
        for (const cid of [a, b]) {
          const other = cid === a ? b : a;
          const dep = rel.dependence[cid] ||= {};
          dep.on = other;

          // `importSourceConcentration`: among imports, how much comes from this partner?
          // `importDependency`: among TOTAL domestic demand, how much is supplied by this partner?
          // Keeping both prevents "100% of a tiny import" from being mistaken for
          // "100% national dependence".
          dep.importSourceConcentration = {};
          dep.importDependency = {};
          dep.demandDependency = dep.importDependency; // explicit semantic alias
          dep.exportDependency = {};
          dep.investmentDependency = 0;
          dep.total = 0;
        }
      }
    }

    for (const cid of countries) {
      for (const other of countries) {
        if (cid === other) continue;
        const rel = rawRelationship(cid, other, state);
        const dep = rel.dependence[cid];

        for (const good of GOODS) {
          const totalImports = getImports(cid, good, state);
          const fromOther = Object.values(state.tradeRelations || {}).reduce((sum, tr) =>
            sum + (tr.active && tr.importerCountryId === cid && tr.exporterCountryId === other && tr.goodId === good ? tr.volume : 0), 0);

          const totalDemand = getDomesticDemand(cid, good, state);
          dep.importSourceConcentration[good] = totalImports > 0
            ? round(clamp(fromOther / totalImports, 0, 1), 4)
            : 0;
          dep.importDependency[good] = totalDemand > 0
            ? round(clamp(fromOther / totalDemand, 0, 1), 4)
            : 0;

          const totalExports = getExports(cid, good, state);
          const toOther = Object.values(state.tradeRelations || {}).reduce((sum, tr) =>
            sum + (tr.active && tr.exporterCountryId === cid && tr.importerCountryId === other && tr.goodId === good ? tr.volume : 0), 0);
          dep.exportDependency[good] = totalExports > 0 ? round(clamp(toOther / totalExports, 0, 1), 4) : 0;
        }

        const activeInvestments = Object.values(state.foreignInvestments || {})
          .filter(x => x.active !== false && x.hostCountryId === cid);
        const foreignValueInCountry = activeInvestments
          .reduce((sum, x) => sum + Math.max(0, Number(x.investmentValue || 0)), 0);
        const otherValue = activeInvestments
          .filter(x => x.investorCountryId === other)
          .reduce((sum, x) => sum + Math.max(0, Number(x.investmentValue || 0)), 0);

        const econ = economyCountry(state, cid);
        const explicitCapital = Number(
          econ.totalProductiveCapital
          ?? econ.capitalStock
          ?? state.countries?.[cid]?.totalProductiveCapital
          ?? state.countries?.[cid]?.capitalStock
        );
        const facilityCapital = Object.values(state.facilities || {})
          .filter(f => f.active !== false && f.countryId === cid)
          .reduce((sum, f) => sum + Math.max(0, Number(
            f.capitalValue ?? f.assetValue ?? f.investmentValue ?? f.buildCost ?? f.cost ?? 0
          )), 0);
        const totalProductiveCapital = Number.isFinite(explicitCapital) && explicitCapital > 0
          ? explicitCapital
          : Math.max(facilityCapital, foreignValueInCountry, 0);

        const partnerShareOfForeign = foreignValueInCountry > 0
          ? clamp(otherValue / foreignValueInCountry, 0, 1)
          : 0;
        const foreignShareOfNationalCapital = totalProductiveCapital > 0
          ? clamp(foreignValueInCountry / totalProductiveCapital, 0, 1)
          : 0;

        dep.investmentSourceConcentration = round(partnerShareOfForeign, 4);
        dep.foreignCapitalShare = round(foreignShareOfNationalCapital, 4);
        dep.investmentDependency = totalProductiveCapital > 0
          ? round(clamp(otherValue / totalProductiveCapital, 0, 1), 4)
          : 0;

        const importNeedMax = Math.max(0, ...Object.values(dep.importDependency));
        const exportMax = Math.max(0, ...Object.values(dep.exportDependency));
        dep.total = round(clamp(importNeedMax * 0.45 + exportMax * 0.35 + dep.investmentDependency * 0.20, 0, 1), 3);
      }
    }
  }

  function getDependency(countryA, countryB, state = getState()) {
    initializeState(state);
    const rel = rawRelationship(countryA, countryB, state);
    return clone(rel.dependence[countryA] || {
      on: countryB, importDependency: {}, exportDependency: {}, investmentDependency: 0, total: 0
    });
  }

  // ---------------------------------------------------------------------------
  // Agreements
  // ---------------------------------------------------------------------------
  function createAgreement(def, state = getState()) {
    initializeState(state);
    const allowed = Object.values(AGREEMENT_TYPES);
    if (!allowed.includes(def.type)) return { ok: false, error: `Unsupported agreement type '${def.type}'.` };
    if (!countryExists(state, def.countryAId) || !countryExists(state, def.countryBId))
      return { ok: false, error: "Unknown agreement country." };

    const agreement = {
      id: def.id || id("agreement"),
      type: def.type,
      countryAId: def.countryAId,
      countryBId: def.countryBId,
      terms: clone(def.terms || {}),
      startTurn: Number.isFinite(def.startTurn) ? def.startTurn : getTurn(state),
      duration: def.duration == null ? null : Math.max(1, Number(def.duration)),
      active: def.active !== false,
      sourceProposalId: def.sourceProposalId || null
    };
    state.agreements[agreement.id] = agreement;

    const rel = rawRelationship(agreement.countryAId, agreement.countryBId, state);
    if (!rel.activeAgreements.includes(agreement.id)) rel.activeAgreements.push(agreement.id);
    addRecentAction(agreement.countryAId, agreement.countryBId, "SIGNED_AGREEMENT",
      { agreementId: agreement.id, agreementType: agreement.type }, state);

    if (agreement.type === AGREEMENT_TYPES.LONG_TERM_SUPPLY_CONTRACT) {
      const exporter = agreement.terms.exporterCountryId || agreement.countryAId;
      const importer = agreement.terms.importerCountryId || agreement.countryBId;
      const goodId = agreement.terms.goodId;
      if (GOODS.includes(goodId)) {
        const existing = Object.values(state.tradeRelations).find(tr =>
          tr.active && tr.exporterCountryId === exporter && tr.importerCountryId === importer && tr.goodId === goodId
        );
        if (existing) {
          existing.agreementId = agreement.id;
          existing.desiredVolume = Math.max(existing.desiredVolume, Number(agreement.terms.minimumVolume || 0));
        } else {
          createTradeRelation({
            exporterCountryId: exporter,
            importerCountryId: importer,
            goodId,
            desiredVolume: Number(agreement.terms.minimumVolume || 0),
            agreementId: agreement.id
          }, state);
        }
      }
    }

    emit(state, { type: "AGREEMENT_CREATED", agreementId: agreement.id, agreementType: agreement.type });
    return { ok: true, agreement };
  }

  function breakAgreement(agreementId, breakerCountryId, state = getState()) {
    const ag = state.agreements?.[agreementId];
    if (!ag) return { ok: false, error: "Agreement not found." };
    if (!ag.active) return { ok: false, error: "Agreement is already inactive." };
    if (![ag.countryAId, ag.countryBId].includes(breakerCountryId)) return { ok: false, error: "Breaker is not a party to agreement." };

    ag.active = false;
    ag.endedTurn = getTurn(state);
    ag.endedBy = breakerCountryId;
    ag.endReason = "broken";

    const other = breakerCountryId === ag.countryAId ? ag.countryBId : ag.countryAId;
    const rel = rawRelationship(ag.countryAId, ag.countryBId, state);
    rel.activeAgreements = rel.activeAgreements.filter(x => x !== ag.id);
    addRecentAction(breakerCountryId, other, "BROKE_TRADE_AGREEMENT",
      { agreementId: ag.id, agreementType: ag.type }, state);

    for (const tr of Object.values(state.tradeRelations || {})) {
      if (tr.agreementId === ag.id) {
        tr.agreementId = null;
        if (ag.type === AGREEMENT_TYPES.LONG_TERM_SUPPLY_CONTRACT) tr.desiredVolume = 0;
      }
    }
    emit(state, { type: "AGREEMENT_BROKEN", agreementId, breakerCountryId });
    return { ok: true };
  }

  function expireAgreements(state) {
    const turn = getTurn(state);
    for (const ag of Object.values(state.agreements || {})) {
      if (!ag.active || ag.duration == null) continue;
      if (turn >= ag.startTurn + ag.duration) {
        ag.active = false;
        ag.endedTurn = turn;
        ag.endReason = "expired";
        const rel = rawRelationship(ag.countryAId, ag.countryBId, state);
        rel.activeAgreements = rel.activeAgreements.filter(x => x !== ag.id);
        emit(state, { type: "AGREEMENT_EXPIRED", agreementId: ag.id });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Structured proposals / negotiation
  // ---------------------------------------------------------------------------
  function createProposal(def, state = getState()) {
    initializeState(state);
    if (!countryExists(state, def.proposerCountryId) || !countryExists(state, def.receiverCountryId))
      return { ok: false, error: "Unknown proposer or receiver." };

    const proposal = {
      id: def.id || id("proposal"),
      proposerCountryId: def.proposerCountryId,
      receiverCountryId: def.receiverCountryId,
      type: def.type,
      offeredTerms: clone(def.offeredTerms || {}),
      requestedTerms: clone(def.requestedTerms || {}),
      expirationTurn: Number.isFinite(def.expirationTurn) ? def.expirationTurn : getTurn(state) + 2,
      createdTurn: getTurn(state),
      status: "pending",
      parentProposalId: def.parentProposalId || null,
      explanation: clone(def.explanation || [])
    };
    state.diplomaticProposals[proposal.id] = proposal;
    emit(state, { type: "DIPLOMATIC_PROPOSAL_CREATED", proposalId: proposal.id });
    return { ok: true, proposal };
  }

  function proposalToAgreement(proposal) {
    const terms = { ...clone(proposal.offeredTerms || {}), ...clone(proposal.requestedTerms || {}) };
    const typeMap = {
      trade_agreement: AGREEMENT_TYPES.TRADE_AGREEMENT,
      long_term_supply_contract: AGREEMENT_TYPES.LONG_TERM_SUPPLY_CONTRACT,
      coal_supply_agreement: AGREEMENT_TYPES.LONG_TERM_SUPPLY_CONTRACT,
      foreign_investment_agreement: AGREEMENT_TYPES.FOREIGN_INVESTMENT_AGREEMENT,
      technology_cooperation_agreement: AGREEMENT_TYPES.TECHNOLOGY_COOPERATION_AGREEMENT
    };
    return {
      type: typeMap[proposal.type] || proposal.type,
      countryAId: proposal.proposerCountryId,
      countryBId: proposal.receiverCountryId,
      terms,
      duration: terms.duration ?? null,
      sourceProposalId: proposal.id
    };
  }

  function acceptProposal(proposalId, state = getState()) {
    const p = state.diplomaticProposals?.[proposalId];
    if (!p) return { ok: false, error: "Proposal not found." };
    if (p.status !== "pending") return { ok: false, error: `Proposal is ${p.status}.` };
    if (getTurn(state) > p.expirationTurn) {
      p.status = "expired";
      return { ok: false, error: "Proposal expired." };
    }
    const made = createAgreement(proposalToAgreement(p), state);
    if (!made.ok) return made;
    p.status = "accepted";
    p.resolvedTurn = getTurn(state);
    p.agreementId = made.agreement.id;
    emit(state, { type: "DIPLOMATIC_PROPOSAL_ACCEPTED", proposalId, agreementId: made.agreement.id });
    return { ok: true, proposal: p, agreement: made.agreement };
  }

  function rejectProposal(proposalId, reason = null, state = getState()) {
    const p = state.diplomaticProposals?.[proposalId];
    if (!p) return { ok: false, error: "Proposal not found." };
    if (p.status !== "pending") return { ok: false, error: `Proposal is ${p.status}.` };
    p.status = "rejected";
    p.rejectionReason = reason;
    p.resolvedTurn = getTurn(state);
    emit(state, { type: "DIPLOMATIC_PROPOSAL_REJECTED", proposalId, reason });
    return { ok: true, proposal: p };
  }

  function counterProposal(proposalId, counterTerms, state = getState()) {
    const original = state.diplomaticProposals?.[proposalId];
    if (!original) return { ok: false, error: "Original proposal not found." };
    if (original.status !== "pending") return { ok: false, error: `Original proposal is ${original.status}.` };
    original.status = "countered";
    original.resolvedTurn = getTurn(state);
    return createProposal({
      proposerCountryId: original.receiverCountryId,
      receiverCountryId: original.proposerCountryId,
      type: counterTerms.type || original.type,
      offeredTerms: counterTerms.offeredTerms || original.requestedTerms,
      requestedTerms: counterTerms.requestedTerms || original.offeredTerms,
      expirationTurn: counterTerms.expirationTurn ?? getTurn(state) + 2,
      parentProposalId: original.id
    }, state);
  }

  function expireProposals(state) {
    const turn = getTurn(state);
    for (const p of Object.values(state.diplomaticProposals || {})) {
      if (p.status === "pending" && turn > p.expirationTurn) p.status = "expired";
    }
  }

  // ---------------------------------------------------------------------------
  // Economic pressure
  // ---------------------------------------------------------------------------
  function restrictInvestment(countryId, targetCountryId, restricted = true, state = getState()) {
    initializeState(state);
    state.investmentRestrictions ||= {};
    state.investmentRestrictions[`${countryId}__${targetCountryId}`] = !!restricted;
    if (restricted) addRecentAction(countryId, targetCountryId, "RESTRICTED_INVESTMENT", {}, state);
    emit(state, { type: "INVESTMENT_RESTRICTION_CHANGED", countryId, targetCountryId, restricted: !!restricted });
    return { ok: true };
  }

  function reduceImports(importerId, exporterId, goodId, maxAccess = 0.25, state = getState()) {
    initializeState(state);
    state.tradeRestrictions[flowKey(exporterId, importerId, goodId)] = {
      maxAccess: clamp(maxAccess, 0, 1), suspended: false, setTurn: getTurn(state)
    };
    addRecentAction(importerId, exporterId, "REDUCED_IMPORTS", { goodId, maxAccess }, state);
    return { ok: true };
  }

  function suspendTrade(importerId, exporterId, goodId, state = getState()) {
    initializeState(state);
    state.tradeRestrictions[flowKey(exporterId, importerId, goodId)] = {
      maxAccess: 0, suspended: true, setTurn: getTurn(state)
    };
    addRecentAction(importerId, exporterId, "REDUCED_IMPORTS", { goodId, suspended: true, relationImpact: -8 }, state);
    return { ok: true };
  }

  function offerPreferentialAccess(grantorId, partnerId, goodId, access = 0.95, state = getState()) {
    initializeState(state);
    state.marketAccess[partnerId] ||= {};
    state.marketAccess[partnerId][grantorId] ||= {};
    state.marketAccess[partnerId][grantorId][goodId] = clamp(access, 0, 1);
    addRecentAction(grantorId, partnerId, "PREFERENTIAL_ACCESS", { goodId, access }, state);
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // Module 6 decision inputs (facts, not choices)
  // ---------------------------------------------------------------------------
  function getTradeOpportunities(countryId, state = getState()) {
    initializeState(state);
    const result = [];
    for (const good of GOODS) {
      const surplus = getPotentialSurplus(countryId, good, state);
      const need = getImportNeed(countryId, good, state);

      if (surplus > 0) {
        for (const other of Object.keys(state.countries || {})) {
          if (other === countryId) continue;
          const otherNeed = getImportNeed(other, good, state);
          if (otherNeed <= 0) continue;
          result.push({
            type: "export_opportunity", countryId, partnerCountryId: other, goodId: good,
            availableSupply: round(surplus), partnerNeed: round(otherNeed),
            marketAccess: round(getMarketAccess(countryId, other, good, state), 3),
            tariffRate: getEffectiveTariff(other, countryId, good, state),
            transportCapacity: Math.min(getCountryPortCapacity(countryId, state), getCountryPortCapacity(other, state))
          });
        }
      }

      if (need > 0) {
        for (const other of Object.keys(state.countries || {})) {
          if (other === countryId) continue;
          const otherSurplus = getPotentialSurplus(other, good, state);
          if (otherSurplus <= 0) continue;
          result.push({
            type: "import_opportunity", countryId, partnerCountryId: other, goodId: good,
            importNeed: round(need), partnerSurplus: round(otherSurplus),
            marketAccess: round(getMarketAccess(other, countryId, good, state), 3),
            tariffRate: getEffectiveTariff(countryId, other, good, state),
            transportCapacity: Math.min(getCountryPortCapacity(countryId, state), getCountryPortCapacity(other, state))
          });
        }
      }
    }
    return result;
  }

  function getCountryInterests(countryId, state = getState()) {
    initializeState(state);
    const shortages = [];
    const surpluses = [];
    for (const good of GOODS) {
      const need = getImportNeed(countryId, good, state);
      const surplus = getPotentialSurplus(countryId, good, state);
      if (need > 0) shortages.push({ goodId: good, amount: round(need), urgency: need >= 30 ? "high" : need >= 10 ? "medium" : "low" });
      if (surplus > 0) surpluses.push({ goodId: good, amount: round(surplus), opportunity: surplus >= 30 ? "high" : surplus >= 10 ? "medium" : "low" });
    }

    const dependencies = Object.keys(state.countries || {})
      .filter(x => x !== countryId)
      .map(other => ({ partnerCountryId: other, ...getDependency(countryId, other, state) }))
      .sort((a, b) => b.total - a.total);

    const investments = Object.values(state.foreignInvestments || {}).filter(x =>
      x.active !== false && (x.investorCountryId === countryId || x.hostCountryId === countryId)
    );

    return {
      countryId,
      shortages,
      surpluses,
      dependencies,
      investments: clone(investments),
      activeAgreements: Object.values(state.agreements || {}).filter(a =>
        a.active && (a.countryAId === countryId || a.countryBId === countryId)
      ).map(clone),
      tradeOpportunities: getTradeOpportunities(countryId, state)
    };
  }

  function getProposalDecisionContext(proposalId, evaluatorCountryId, state = getState()) {
    initializeState(state);
    const p = state.diplomaticProposals?.[proposalId];
    if (!p) return null;
    const other = evaluatorCountryId === p.proposerCountryId ? p.receiverCountryId : p.proposerCountryId;
    const rel = getRelationship(evaluatorCountryId, other, state);
    const dep = getDependency(evaluatorCountryId, other, state);
    const interests = getCountryInterests(evaluatorCountryId, state);

    const goodsMentioned = new Set([
      p.offeredTerms?.goodId, p.requestedTerms?.goodId
    ].filter(Boolean));
    const relevantGoods = [...goodsMentioned].map(goodId => ({
      goodId,
      production: getDomesticProduction(evaluatorCountryId, goodId, state),
      demand: getDomesticDemand(evaluatorCountryId, goodId, state),
      shortage: getImportNeed(evaluatorCountryId, goodId, state),
      surplus: getPotentialSurplus(evaluatorCountryId, goodId, state),
      imports: getImports(evaluatorCountryId, goodId, state),
      exports: getExports(evaluatorCountryId, goodId, state)
    }));

    return {
      proposal: clone(p),
      evaluatorCountryId,
      partnerCountryId: other,
      relationship: rel,
      dependency: dep,
      interests,
      relevantGoods,
      // Module 6 should attach its own score/reasons. Module 5 supplies facts only.
      scoringInputsOnly: true
    };
  }

  function explainTradeRelation(tradeRelationId, state = getState()) {
    const tr = state.tradeRelations?.[tradeRelationId];
    if (!tr) return null;
    return {
      tradeRelationId,
      actualVolume: tr.volume,
      desiredVolume: tr.desiredVolume,
      capacity: tr.routeCapacity || 0,
      tariffRate: tr.tariffRate || 0,
      marketAccess: tr.marketAccess || 0,
      reasons: clone(tr.lastExplanation || [])
    };
  }

  // ---------------------------------------------------------------------------
  // Diplomatic competition based on factual overlap
  // ---------------------------------------------------------------------------
  function updateStrategicCompetition(state) {
    const countries = Object.keys(state.countries || {});
    for (let i = 0; i < countries.length; i++) {
      for (let j = i + 1; j < countries.length; j++) {
        const a = countries[i], b = countries[j];
        let overlap = 0;

        for (const good of GOODS) {
          const aNeeds = getImportNeed(a, good, state) > 0;
          const bNeeds = getImportNeed(b, good, state) > 0;
          if (aNeeds && bNeeds) {
            const thirdPartySupply = countries.some(c => c !== a && c !== b && getPotentialSurplus(c, good, state) > 0);
            if (thirdPartySupply) overlap += 6;
          }

          const aExports = getPotentialSurplus(a, good, state) > 0;
          const bExports = getPotentialSurplus(b, good, state) > 0;
          if (aExports && bExports) {
            const thirdPartyDemand = countries.some(c => c !== a && c !== b && getImportNeed(c, good, state) > 0);
            if (thirdPartyDemand) overlap += 4;
          }
        }

        const rel = rawRelationship(a, b, state);
        rel.strategicCompetition = round(clamp(rel.strategicCompetition * 0.75 + Math.min(100, overlap) * 0.25, 0, 100), 2);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Main update
  // ---------------------------------------------------------------------------
  function update(state = getState()) {
    initializeState(state);
    expireProposals(state);
    expireAgreements(state);
    decayDiplomaticMemory(state);

    const flowResult = updateTradeFlows(state);
    updateDependencies(state);
    updateStrategicCompetition(state);

    state.tradeDiagnostics.lastUpdateTurn = getTurn(state);
    state.tradeDiagnostics.goods = {};
    for (const cid of Object.keys(state.countries || {})) {
      state.tradeDiagnostics.goods[cid] = {};
      for (const good of GOODS) {
        state.tradeDiagnostics.goods[cid][good] = {
          production: getDomesticProduction(cid, good, state),
          demand: getDomesticDemand(cid, good, state),
          surplusBeforeTrade: getPotentialSurplus(cid, good, state),
          importNeedBeforeTrade: getImportNeed(cid, good, state),
          imports: getImports(cid, good, state),
          exports: getExports(cid, good, state),
          importPrice: getImportPrice(cid, good, state)
        };
      }
    }

    state.tradeDiagnostics.routes = Object.fromEntries(
      Object.values(state.tradeRoutes || {}).map(r => [r.id, {
        exporter: r.exporterCountryId,
        importer: r.importerCountryId,
        capacity: getRouteCapacity(r, state),
        used: r.usedCapacity || 0,
        active: r.active,
        estimatedInfrastructure: !!r.estimatedInfrastructure,
        infrastructureSource: clone(r.infrastructureSource || {})
      }])
    );
    state.tradeDiagnostics.infrastructure = Object.fromEntries(
      Object.keys(state.countries || {}).map(cid => [cid, getCountryTradeInfrastructure(cid, state)])
    );

    emit(state, { type: "TRADE_DIPLOMACY_UPDATED" });
    return {
      ok: true,
      turn: getTurn(state),
      exporterRemaining: flowResult.exporterRemaining,
      importerRemaining: flowResult.importerRemaining
    };
  }

  // ---------------------------------------------------------------------------
  // Debug snapshot and self-check
  // ---------------------------------------------------------------------------
  function getDebugSnapshot(state = getState()) {
    initializeState(state);
    return {
      trade: Object.values(state.tradeRelations || {}).map(tr => ({
        id: tr.id, good: tr.goodId, exporter: tr.exporterCountryId, importer: tr.importerCountryId,
        volume: tr.volume, desiredVolume: tr.desiredVolume, capacity: tr.routeCapacity,
        price: getImportPrice(tr.importerCountryId, tr.goodId, state),
        tariff: tr.tariffRate, route: tr.routeId, active: tr.active
      })),
      dependence: Object.keys(state.diplomaticRelations || {}).map(key => ({
        pair: key,
        dependence: clone(state.diplomaticRelations[key].dependence)
      })),
      diplomacy: Object.values(state.diplomaticRelations || {}).map(rel => ({
        pair: pairKey(rel.countryAId, rel.countryBId),
        relation: rel.relation, trust: rel.trust, competition: rel.strategicCompetition
      })),
      agreements: Object.values(state.agreements || {}).map(a => ({
        id: a.id, type: a.type, terms: clone(a.terms), duration: a.duration, active: a.active
      })),
      proposals: Object.values(state.diplomaticProposals || {}).map(p => ({
        id: p.id, proposer: p.proposerCountryId, receiver: p.receiverCountryId,
        type: p.type, offer: clone(p.offeredTerms), request: clone(p.requestedTerms),
        status: p.status, expirationTurn: p.expirationTurn
      }))
    };
  }

  function runSelfCheck() {
    const s = {
      playerCountryId: "asteria",
      time: { year: 2030, half: 2 }, // half must NOT create a second turn
      countries: {
        asteria: { id: "asteria", name: "Asteria", tradeCapacity: 100 },
        meridian: { id: "meridian", name: "Meridian", tradeCapacity: 100 },
        norvia: { id: "norvia", name: "Norvia", tradeCapacity: 100 }
      },
      facilities: {},
      connections: {},
      economy: {
        countries: {
          asteria: { goods: {
            coal: { production: 120, domesticDemand: 70, consumption: 70, price: 1 },
            steel: { production: 20, domesticDemand: 20, consumption: 20, price: 2 }
          }},
          meridian: { goods: {
            coal: { production: 10, domesticDemand: 80, consumption: 10, price: 1.1 },
            steel: { production: 30, domesticDemand: 80, consumption: 30, price: 2.2 }
          }},
          norvia: { goods: {
            coal: { production: 20, domesticDemand: 80, consumption: 20, price: 1.05 }
          }}
        }
      },
      tradeRelations: {}, diplomaticRelations: {}, events: [], history: []
    };

    initializeState(s);
    const checks = [];
    const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });

    // 1) Annual turn rule.
    check("1 turn = 1 year; legacy half-year is ignored",
      getTurn(s) === 2030,
      `turn=${getTurn(s)} for year=${s.time.year}, half=${s.time.half}`);

    // 2) Competing buyers: same exporter/good, neither should win by ID order.
    const r1 = createTradeRelation({
      id: "aaa_first",
      exporterCountryId: "asteria", importerCountryId: "meridian",
      goodId: "coal", desiredVolume: 50, capacity: 100
    }, s);
    const r2 = createTradeRelation({
      id: "zzz_second",
      exporterCountryId: "asteria", importerCountryId: "norvia",
      goodId: "coal", desiredVolume: 50, capacity: 100
    }, s);
    update(s);
    const v1 = s.tradeRelations[r1.tradeRelation.id].volume;
    const v2 = s.tradeRelations[r2.tradeRelation.id].volume;
    check("Spot competition favors the higher net bid and still respects finite supply",
      v1 > v2 && Math.abs((v1 + v2) - 50) < 0.05,
      `Meridian=${v1}, Norvia=${v2}`);

    // 3) Dependency split: 100% source concentration can still mean tiny national dependence.
    const dstate = {
      time: { year: 2040 },
      countries: {
        home: { id: "home", tradeCapacity: 100 },
        supplier: { id: "supplier", tradeCapacity: 100 }
      },
      facilities: {}, connections: {},
      economy: { countries: {
        home: { goods: { coal: { production: 79, domesticDemand: 80, consumption: 79, price: 1 } } },
        supplier: { goods: { coal: { production: 100, domesticDemand: 20, consumption: 20, price: 1 } } }
      }},
      tradeRelations: {}, diplomaticRelations: {}, events: [], history: []
    };
    initializeState(dstate);
    dstate.marketAccess.supplier ||= {};
    dstate.marketAccess.supplier.home ||= {};
    dstate.marketAccess.supplier.home.coal = 1;
    createTradeRelation({
      exporterCountryId: "supplier", importerCountryId: "home",
      goodId: "coal", desiredVolume: 1, capacity: 100
    }, dstate);
    update(dstate);
    const dd = getDependency("home", "supplier", dstate);
    check("Dependency distinguishes import-source concentration from total-demand dependence",
      Math.abs(dd.importSourceConcentration.coal - 1) < 0.001 &&
      Math.abs(dd.importDependency.coal - 0.0125) < 0.001,
      `source=${dd.importSourceConcentration.coal}, demand=${dd.importDependency.coal}`);

    // 4) Contract shortfall detection and once-per-year diplomatic penalty.
    const cstate = {
      time: { year: 2050 },
      countries: {
        exporter: { id: "exporter", tradeCapacity: 100 },
        importer: { id: "importer", tradeCapacity: 100 }
      },
      facilities: {}, connections: {},
      economy: { countries: {
        exporter: { goods: { coal: { production: 25, domesticDemand: 10, consumption: 10, price: 1 } } },
        importer: { goods: { coal: { production: 0, domesticDemand: 50, consumption: 0, price: 1 } } }
      }},tradeRelations: {}, diplomaticRelations: {}, events: [], history: []
    };
    initializeState(cstate);
    const cag = createAgreement({
      type: AGREEMENT_TYPES.LONG_TERM_SUPPLY_CONTRACT,
      countryAId: "exporter", countryBId: "importer",
      terms: {
        exporterCountryId: "exporter", importerCountryId: "importer",
        goodId: "coal", minimumVolume: 30
      },
      duration: 6
    }, cstate);
    update(cstate);
    const perf = cstate.agreements[cag.agreement.id].performance?.current;
    const trustAfterFirst = getRelationship("exporter", "importer", cstate).trust;
    update(cstate); // same year: must not penalize twice
    const trustAfterSecond = getRelationship("exporter", "importer", cstate).trust;
    check("Contract shortfall is detected with an explicit cause",
      perf?.shortfall > 0 && perf?.cause === "EXPORTER_SUPPLY_SHORTFALL",
      JSON.stringify(perf));
    check("Contract shortfall diplomatic penalty is applied at most once per year",
      trustAfterSecond === trustAfterFirst,
      `trust first=${trustAfterFirst}, second=${trustAfterSecond}`);

    // 5) Foreign-investment dependence should reflect national capital weight,
    // not just concentration among foreign investors.
    const istate = {
      time: { year: 2060 },
      countries: {
        host: { id: "host" },
        foreign: { id: "foreign" }
      },
      facilities: {},
      connections: {},
      economy: {
        countries: {
          host: { totalProductiveCapital: 1000, goods: {} },
          foreign: { totalProductiveCapital: 900, goods: {} }
        }
      },
      foreignInvestments: {
        inv1: {
          id: "inv1", investorCountryId: "foreign", hostCountryId: "host",
          investmentValue: 20, ownershipShare: 1, active: true
        }
      },
      tradeRelations: {}, diplomaticRelations: {}, events: [], history: []
    };
    initializeState(istate);
    updateDependencies(istate);
    const idep = getDependency("host", "foreign", istate);
    check("Investment dependence uses national productive capital, not foreign-investor concentration alone",
      Math.abs(idep.investmentSourceConcentration - 1) < 0.001 &&
      Math.abs(idep.investmentDependency - 0.02) < 0.001,
      `foreign-source=${idep.investmentSourceConcentration}, national-capital=${idep.investmentDependency}`);

    // 6) Market access should be primarily institutional, not relation-score driven.
    const mstate = {
      time: { year: 2061 },
      countries: {
        ex: { id: "ex", tradeCapacity: 100 },
        im: { id: "im", tradeCapacity: 100 }
      },
      facilities: {}, connections: {},
      economy: { countries: { ex: { goods: {} }, im: { goods: {} } } },
      tradeRelations: {}, diplomaticRelations: {}, events: [], history: []
    };
    initializeState(mstate);
    const mrel = rawRelationship("ex", "im", mstate);
    mrel.relation = 100;
    mrel.trust = 0;
    mstate.marketAccessRules.ex ||= {};
    mstate.marketAccessRules.ex.im ||= {};
    mstate.marketAccessRules.ex.im.coal = {
      legalAccess: 0.5,
      administrativeAccess: 0.5,
      licensingAccess: 1,
      standardsAccess: 1,
      noAgreementFactor: 1
    };
    const mb = getMarketAccessBreakdown("ex", "im", "coal", mstate);
    check("Market access is driven by concrete institutional barriers rather than relation score",
      Math.abs(mb.access - 0.225) < 0.002,
      JSON.stringify(mb));

    // 7) Export tax and export restriction both affect real trade.
    const estate = {
      time: { year: 2062 },
      countries: {
        ex: { id: "ex", tradeCapacity: 100 },
        im: { id: "im", tradeCapacity: 100 }
      },
      facilities: {}, connections: {},
      economy: { countries: {
        ex: { goods: { coal: { production: 100, domesticDemand: 20, consumption: 20, price: 10 } } },
        im: { goods: { coal: { production: 0, domesticDemand: 100, consumption: 0, price: 20 } } }
      }},
      tradeRelations: {}, diplomaticRelations: {}, events: [], history: []
    };
    initializeState(estate);
    estate.marketAccess.ex ||= {};
    estate.marketAccess.ex.im ||= {};
    estate.marketAccess.ex.im.coal = 1;
    createTradeRelation({
      exporterCountryId: "ex", importerCountryId: "im",
      goodId: "coal", desiredVolume: 80, capacity: 100
    }, estate);
    setExportTax("ex", "im", "coal", 0.10, estate);
    setExportRestriction("ex", "im", "coal", { maxVolume: 30 }, estate);
    update(estate);
    check("Export restriction caps actual trade and export tax creates government revenue",
      Math.abs(getExports("ex", "coal", estate) - 30) < 0.01 &&
      getExportTaxRevenue("ex", estate) > 0,
      `exports=${getExports("ex","coal",estate)}, exportTaxRevenue=${getExportTaxRevenue("ex",estate)}`);

    // 8) Physical port infrastructure is preferred; legacy country capacity is explicit fallback.
    const pstate = {
      time: { year: 2063 },
      flags: { allowLegacyTradeCapacityFallback: true },
      countries: {
        physical: { id: "physical", tradeCapacity: 999 },
        legacy: { id: "legacy", tradeCapacity: 40 }
      },
      facilities: {
        real_port: {
          id: "real_port", type: "port", countryId: "physical",
          active: true, tradeCapacity: 25
        }
      },
      economy: { countries: { physical: { goods: {} }, legacy: { goods: {} } } },
      connections: {}, tradeRelations: {}, diplomaticRelations: {}, events: [], history: []
    };
    initializeState(pstate);
    const phys = getCountryTradeInfrastructure("physical", pstate);
    const leg = getCountryTradeInfrastructure("legacy", pstate);
    check("Physical ports override country-level capacity; legacy fallback is explicit and warned",
      phys.capacity === 25 && phys.source === "physical_ports" &&
      leg.capacity === 40 && leg.source === "legacy_country_capacity" &&
      pstate.tradeDiagnostics.warnings.includes("LEGACY_TRADE_CAPACITY_FALLBACK:legacy"),
      `physical=${JSON.stringify(phys)}, legacy=${JSON.stringify(leg)}`);

    // 9) Two routes using the same physical port must share that port's capacity.
    const portState = {
      time: { year: 2064 },
      countries: {
        ex: { id: "ex" },
        a: { id: "a", tradeCapacity: 100 },
        b: { id: "b", tradeCapacity: 100 }
      },
      facilities: {
        shared_port: {
          id: "shared_port", type: "port", countryId: "ex",
          active: true, tradeCapacity: 20
        }
      },
      connections: {},
      economy: { countries: {
        ex: { goods: { coal: { production: 100, domesticDemand: 0, consumption: 0, price: 1 } } },
        a: { goods: { coal: { production: 0, domesticDemand: 60, consumption: 0, price: 2 } } },
        b: { goods: { coal: { production: 0, domesticDemand: 60, consumption: 0, price: 2 } } }
      }},
      tradeRelations: {}, diplomaticRelations: {}, events: [], history: []
    };
    initializeState(portState);
    portState.marketAccess.ex ||= {};
    for (const cid of ["a", "b"]) {
      portState.marketAccess.ex[cid] ||= {};
      portState.marketAccess.ex[cid].coal = 1;
      createTradeRelation({
        exporterCountryId: "ex", importerCountryId: cid, goodId: "coal",
        desiredVolume: 30, exportLocationId: "shared_port", capacity: 100
      }, portState);
    }
    update(portState);
    const portExports = getExports("ex", "coal", portState);
    check("Routes sharing one physical port cannot borrow capacity from elsewhere",
      Math.abs(portExports - 20) < 0.01 &&
      Math.abs((portState.tradeDiagnostics.endpointRemaining["port:shared_port"] || 0)) < 0.01,
      `exports=${portExports}, remaining=${portState.tradeDiagnostics.endpointRemaining["port:shared_port"]}`);

    // 10) Export ban overrides ordinary contract flow and is recorded as policy breach;
    // an explicit contract exemption bypasses the ban.
    function makeContractBanState(exempt) {
      const st = {
        time: { year: exempt ? 2066 : 2065 },
        countries: {
          ex: { id: "ex", tradeCapacity: 100 },
          im: { id: "im", tradeCapacity: 100 }
        },
        facilities: {}, connections: {},
        economy: { countries: {
          ex: { goods: { coal: { production: 100, domesticDemand: 10, consumption: 10, price: 1 } } },
          im: { goods: { coal: { production: 0, domesticDemand: 80, consumption: 0, price: 2 } } }
        }},
        tradeRelations: {}, diplomaticRelations: {}, events: [], history: []
      };
      initializeState(st);
      st.marketAccess.ex ||= {};
      st.marketAccess.ex.im ||= {};
      st.marketAccess.ex.im.coal = 1;
      const ag = createAgreement({
        type: AGREEMENT_TYPES.LONG_TERM_SUPPLY_CONTRACT,
        countryAId: "ex", countryBId: "im",
        terms: {
          exporterCountryId: "ex", importerCountryId: "im",
          goodId: "coal", minimumVolume: 30,
          exportControlExempt: exempt
        },
        duration: 6
      }, st);
      setExportRestriction("ex", "im", "coal", { suspended: true }, st);
      update(st);
      return { st, ag: ag.agreement };
    }

    const banned = makeContractBanState(false);
    const exempted = makeContractBanState(true);
    check("Export ban creates policy-caused contract breach unless the contract is explicitly exempt",
      getExports("ex", "coal", banned.st) === 0 &&
      banned.ag.performance?.current?.cause === "GOVERNMENT_EXPORT_RESTRICTION" &&
      getExports("ex", "coal", exempted.st) >= 29.99 &&
      exempted.ag.performance?.current?.cause === "FULFILLED",
      `blocked=${getExports("ex","coal",banned.st)} cause=${banned.ag.performance?.current?.cause}; exempt=${getExports("ex","coal",exempted.st)} cause=${exempted.ag.performance?.current?.cause}`);

    // Existing core behavior.
    const proposal = createProposal({
      proposerCountryId: "meridian", receiverCountryId: "asteria",
      type: "foreign_investment_agreement",
      offeredTerms: { investmentValue: 20 },
      requestedTerms: { facilityType: "coal_mine", ownershipShare: 0.65 }
    }, s);
    check("Structured proposal created",
      proposal.ok && proposal.proposal.status === "pending",
      proposal.proposal?.id);

    const ctx = getProposalDecisionContext(proposal.proposal.id, "asteria", s);
    check("Module 6 decision context remains available",
      !!ctx?.relationship && !!ctx?.interests,
      "relationship + interests + dependency");

    return {
      passed: checks.filter(x => x.ok).length,
      total: checks.length,
      checks
    };
  }

  return {
    GOODS,
    TARIFF_LEVELS,
    AGREEMENT_TYPES,
    initializeState,
    update,

    createTradeRelation,
    endTradeRelation,
    createTradeRoute,

    createProposal,
    acceptProposal,
    rejectProposal,
    counterProposal,

    createAgreement,
    breakAgreement,

    setTariff,
    getTariff,
    getEffectiveTariff,
    setExportTax,
    getExportTax,
    setExportRestriction,
    getExportRestriction,
    getMarketAccess,
    getMarketAccessBreakdown,

    registerForeignInvestment,
    restrictInvestment,
    reduceImports,
    suspendTrade,
    offerPreferentialAccess,

    getRelationship,
    getDependency,
    getCountryInterests,
    getTradeOpportunities,
    getProposalDecisionContext,
    explainTradeRelation,

    getImports,
    getExports,
    getImportPrice,
    getExportDemand,
    getTariffRevenue,
    getExportTaxRevenue,
    getRelationPreTaxTradeValue,

    getPotentialSurplus,
    getImportNeed,
    getCountryPortCapacity,
    getCountryTradeInfrastructure,
    getRouteEndpointDescriptor,
    getSpotBid,

    getDebugSnapshot,
    runSelfCheck
  };
})();

if (typeof window !== "undefined") {
  window.TradeDiplomacy = TradeDiplomacy;
  if (window.gameState) TradeDiplomacy.initializeState(window.gameState);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = TradeDiplomacy;
}
/* ===== END MODULE 5 — TRADE & DIPLOMACY ===== */
