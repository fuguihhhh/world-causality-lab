/* ===== MODULE 9 — AGRICULTURE & FOOD — INLINE INTEGRATED ===== */
(function (global) {
  'use strict';

  const BorderEpoch = global.BorderEpoch = global.BorderEpoch || {};
  const Agriculture = BorderEpoch.Agriculture = BorderEpoch.Agriculture || {};

  const VERSION = 2;
  const EPS = 1e-9;

  const AgricultureConfig = Object.freeze({
    minimumResourceShare: 0.15,
    cropHistoryYears: 5,
    continuousCroppingWindow: 3,
    minimumRotationFactor: 0.75
  });

  const DEFAULT_AGRICULTURE_POLICIES = Object.freeze({
    agriculturalTaxRate: 0.10,
    inputSubsidyRate: 0.00,
    creditSupportRate: 0.00,
    minimumPurchasePrice: 0.00,
    governmentProcurementShare: 0.00
  });

  const STATE_AGRICULTURE_PROJECT_TYPES = Object.freeze({
    land_development: Object.freeze({ labelZh:'国家耕地开发', labelEn:'State Land Development', baseCost:8, totalTurns:2 }),
    irrigation_expansion: Object.freeze({ labelZh:'国家灌溉扩建', labelEn:'State Irrigation Expansion', baseCost:12, totalTurns:2 }),
    storage_expansion: Object.freeze({ labelZh:'国家农业仓储扩建', labelEn:'State Agricultural Storage Expansion', baseCost:10, totalTurns:2 })
  });

  const CropDefinitions = Object.freeze({
    wheat: Object.freeze({
      id: 'wheat', baseYield: 1.00,
      climate: { temperatureIdeal: [0.35, 0.70], rainfallIdeal: [0.30, 0.65], growingSeasonMin: 0.40 },
      soilNeed: 0.50, waterNeed: 0.45, laborNeed: 0.35, machineryNeed: 0.45, inputNeed: 0.40,
      storability: 0.90, storageLossRate: 0.03, costPerArea: 1.00,
      operatingCost: { labor: 0.20, machinery: 0.30, farmInputs: 0.40, irrigation: 0.10 },
      rotation: { continuousCroppingSensitivity: 0.18, soilRecoveryEffect: 0.00, nitrogenFixing: false }
    }),
    rice: Object.freeze({
      id: 'rice', baseYield: 1.15,
      climate: { temperatureIdeal: [0.55, 0.90], rainfallIdeal: [0.55, 0.95], growingSeasonMin: 0.55 },
      soilNeed: 0.55, waterNeed: 0.90, laborNeed: 0.60, machineryNeed: 0.35, inputNeed: 0.55,
      storability: 0.88, storageLossRate: 0.035, costPerArea: 1.25,
      operatingCost: { labor: 0.24, machinery: 0.20, farmInputs: 0.33, irrigation: 0.23 },
      rotation: { continuousCroppingSensitivity: 0.20, soilRecoveryEffect: 0.00, nitrogenFixing: false }
    }),
    corn: Object.freeze({
      id: 'corn', baseYield: 1.10,
      climate: { temperatureIdeal: [0.45, 0.82], rainfallIdeal: [0.40, 0.78], growingSeasonMin: 0.48 },
      soilNeed: 0.55, waterNeed: 0.60, laborNeed: 0.40, machineryNeed: 0.50, inputNeed: 0.50,
      storability: 0.90, storageLossRate: 0.03, costPerArea: 1.08,
      operatingCost: { labor: 0.18, machinery: 0.31, farmInputs: 0.40, irrigation: 0.11 },
      rotation: { continuousCroppingSensitivity: 0.22, soilRecoveryEffect: 0.00, nitrogenFixing: false }
    }),
    soybean: Object.freeze({
      id: 'soybean', baseYield: 0.82,
      climate: { temperatureIdeal: [0.45, 0.80], rainfallIdeal: [0.40, 0.75], growingSeasonMin: 0.45 },
      soilNeed: 0.48, waterNeed: 0.52, laborNeed: 0.34, machineryNeed: 0.46, inputNeed: 0.36,
      storability: 0.90, storageLossRate: 0.028, costPerArea: 0.92,
      operatingCost: { labor: 0.20, machinery: 0.31, farmInputs: 0.39, irrigation: 0.10 },
      rotation: { continuousCroppingSensitivity: 0.12, soilRecoveryEffect: 0.08, nitrogenFixing: true }
    }),
    potato: Object.freeze({
      id: 'potato', baseYield: 1.35,
      climate: { temperatureIdeal: [0.25, 0.65], rainfallIdeal: [0.35, 0.72], growingSeasonMin: 0.36 },
      soilNeed: 0.42, waterNeed: 0.50, laborNeed: 0.55, machineryNeed: 0.38, inputNeed: 0.45,
      storability: 0.56, storageLossRate: 0.08, costPerArea: 1.12,
      operatingCost: { labor: 0.28, machinery: 0.24, farmInputs: 0.38, irrigation: 0.10 },
      rotation: { continuousCroppingSensitivity: 0.24, soilRecoveryEffect: 0.00, nitrogenFixing: false }
    }),
    cotton: Object.freeze({
      id: 'cotton', baseYield: 0.70,
      climate: { temperatureIdeal: [0.58, 0.95], rainfallIdeal: [0.28, 0.62], growingSeasonMin: 0.62 },
      soilNeed: 0.50, waterNeed: 0.58, laborNeed: 0.52, machineryNeed: 0.50, inputNeed: 0.58,
      storability: 0.94, storageLossRate: 0.02, costPerArea: 1.18,
      operatingCost: { labor: 0.24, machinery: 0.27, farmInputs: 0.39, irrigation: 0.10 },
      rotation: { continuousCroppingSensitivity: 0.20, soilRecoveryEffect: 0.00, nitrogenFixing: false }
    })
  });

  const LivestockDefinitions = Object.freeze({
    cattle: Object.freeze({ id: 'cattle', feedNeed: 1.00, waterNeed: 0.80, laborNeed: 0.50, outputs: { meat: 0.40, milk: 0.30 } }),
    pig: Object.freeze({ id: 'pig', feedNeed: 0.78, waterNeed: 0.55, laborNeed: 0.35, outputs: { meat: 0.58 } }),
    sheep: Object.freeze({ id: 'sheep', feedNeed: 0.62, waterNeed: 0.42, laborNeed: 0.32, outputs: { meat: 0.30, wool: 0.18 } }),
    poultry: Object.freeze({ id: 'poultry', feedNeed: 0.34, waterNeed: 0.22, laborNeed: 0.28, outputs: { meat: 0.42, eggs: 0.36 } })
  });

  const AgricultureIntensity = Object.freeze({
    extensive: Object.freeze({ inputMultiplier: 0.60, machineryMultiplier: 0.70, potentialYieldMultiplier: 0.86, degradationPressure: 0.003, capitalMultiplier: 0.65 }),
    normal: Object.freeze({ inputMultiplier: 1.00, machineryMultiplier: 1.00, potentialYieldMultiplier: 1.00, degradationPressure: 0.008, capitalMultiplier: 1.00 }),
    intensive: Object.freeze({ inputMultiplier: 1.50, machineryMultiplier: 1.30, potentialYieldMultiplier: 1.13, degradationPressure: 0.020, capitalMultiplier: 1.60 })
  });

  function finite(n, fallback) { n = Number(n); return Number.isFinite(n) ? n : (fallback == null ? 0 : fallback); }
  function nonNegative(n) { return Math.max(0, finite(n, 0)); }
  function clamp01(n) { return Math.max(0, Math.min(1, finite(n, 0))); }
  function clamp(n, min, max) { return Math.max(min, Math.min(max, finite(n, min))); }
  function sumObject(o) { return Object.keys(o || {}).reduce((s, k) => s + nonNegative(o[k]), 0); }

  function deepClone(value) {
    if (value == null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(deepClone);
    const out = {};
    for (const k of Object.keys(value)) out[k] = deepClone(value[k]);
    return out;
  }

  function stableStringify(value) {
    if (value == null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
  }

  function hashString(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }

  function seededUnit(seed, year, regionId, salt) {
    let x = hashString(String(seed) + '|' + String(year) + '|' + String(regionId) + '|' + String(salt || '')) || 1;
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x >>>= 0; x ^= x << 5; x >>>= 0;
    return (x >>> 0) / 4294967295;
  }

  function getAnnualClimateVariation(seed, year, regionId) {
    return {
      rainfallDelta: (seededUnit(seed, year, regionId, 'rain') - 0.5) * 0.24,
      temperatureDelta: (seededUnit(seed, year, regionId, 'temp') - 0.5) * 0.14,
      growingSeasonDelta: (seededUnit(seed, year, regionId, 'season') - 0.5) * 0.10
    };
  }

  function geometricMean(values) {
    const clean = values.map(v => clamp(finite(v, 0), 0, 1));
    if (!clean.length || clean.some(v => v <= 0)) return 0;
    return Math.exp(clean.reduce((s, v) => s + Math.log(v), 0) / clean.length);
  }
  function bottleneckPenalty(values) { const b = Math.min.apply(null, values.map(clamp01)); return 0.35 + 0.65 * b; }
  function safeFactor(available, required) { required = nonNegative(required); return required <= EPS ? 1 : clamp01(nonNegative(available) / required); }
  function rangeFitness(value, idealRange, softMargin) {
    value = clamp01(value); const lo = clamp01(idealRange && idealRange[0]); const hi = clamp01(idealRange && idealRange[1]);
    const margin = Math.max(0.01, finite(softMargin, 0.25));
    if (value >= lo && value <= hi) return 1;
    if (value < lo) return clamp01(1 - (lo - value) / margin);
    return clamp01(1 - (value - hi) / margin);
  }

  function getByRegion(container, regionId) {
    if (!container) return null;
    if (container.regions && container.regions[regionId]) return container.regions[regionId];
    if (Array.isArray(container.regions)) return container.regions.find(r => r && r.regionId === regionId) || null;
    return container[regionId] || null;
  }

  function normalizeWorldRegion(input, regionId) {
    const src = input || {}, w = src.water || {};
    return {
      regionId: src.regionId || regionId, area: nonNegative(src.area),
      terrain: { slope: clamp01(src.terrain && src.terrain.slope), elevation: clamp01(src.terrain && src.terrain.elevation), drainage: clamp01(src.terrain && src.terrain.drainage) },
      climate: { temperature: clamp01(src.climate && src.climate.temperature), rainfall: clamp01(src.climate && src.climate.rainfall), growingSeason: clamp01(src.climate && src.climate.growingSeason) },
      soil: { fertility: clamp01(src.soil && src.soil.fertility) },
      water: { naturalAvailability: clamp01(w.naturalAvailability), irrigationSourceCapacity: w.irrigationSourceCapacity == null ? null : nonNegative(w.irrigationSourceCapacity) },
      floodRisk: clamp01(src.floodRisk)
    };
  }

  function blankAnnualFlow() {
    return { openingStock: {}, harvestInflow: {}, withdrawalOutflow: {}, storageLoss: {}, overflowLoss: {}, fieldLoss: {}, closingStock: {} };
  }

  function createRegionState(src) {
    src = src || {}; const land = src.land || {};
    const developed = nonNegative(land.developedArable), potential = Math.max(developed, nonNegative(land.potentialArable));
    const cultivated = Math.min(developed, nonNegative(land.cultivated));
    const degraded = Math.min(developed, nonNegative(land.degraded));
    const fallow = Math.max(0, Math.min(developed, finite(land.fallow, Math.max(0, developed - cultivated))));
    const crops = {};
    for (const id of Object.keys(CropDefinitions)) {
      const c = src.crops && src.crops[id] ? src.crops[id] : {};
      crops[id] = { allocation: clamp01(c.allocation), area: nonNegative(c.area), plantedArea: nonNegative(c.plantedArea), yield: nonNegative(c.yield), harvest: nonNegative(c.harvest), factors: deepClone(c.factors || {}) };
    }
    const storage = src.storage || {}, resources = src.resources || {};
    const cropManagement = deepClone(src.cropManagement || {});
    for (const id of Object.keys(CropDefinitions)) if (!cropManagement[id]) cropManagement[id] = { priority: 50 };
    return {
      land: { potentialArable: potential, developedArable: developed, cultivated, fallow, degraded, irrigated: Math.min(developed, nonNegative(land.irrigated)) },
      crops, cropHistory: Array.isArray(src.cropHistory) ? deepClone(src.cropHistory).slice(-AgricultureConfig.cropHistoryYears) : [],
      livestock: deepClone(src.livestock || {}), livestockAllocation: deepClone(src.livestockAllocation || {}),
      cropManagement,
      resources: {
        laborAllocated: nonNegative(resources.laborAllocated), machineryAllocated: nonNegative(resources.machineryAllocated), farmInputsAllocated: nonNegative(resources.farmInputsAllocated),
        irrigationRequested: nonNegative(resources.irrigationRequested), irrigationAllocated: nonNegative(resources.irrigationAllocated), irrigationByCrop: deepClone(resources.irrigationByCrop || {}), capitalAllocated: nonNegative(resources.capitalAllocated)
      },
      infrastructureBonus: Object.assign({ irrigationCapacity:0, storageCapacity:0 }, deepClone(src.infrastructureBonus || {})),
      logistics: Object.assign({ collectionCapacity: 0, inputDeliveryCapacity: 0, marketAccess: 0, storageAccess: 0 }, deepClone(src.logistics || {})),
      storage: {
        capacity: nonNegative(storage.capacity), coldStorageCapacity: nonNegative(storage.coldStorageCapacity), stocks: deepClone(storage.stocks || {}), reserved: deepClone(storage.reserved || {}),
        pendingWithdrawals: Array.isArray(storage.pendingWithdrawals) ? deepClone(storage.pendingWithdrawals) : [], annualFlow: Object.assign(blankAnnualFlow(), deepClone(storage.annualFlow || {}))
      },
      soilState: { fertilityModifier: clamp(finite(src.soilState && src.soilState.fertilityModifier, 1), 0.15, 1.25), degradation: clamp01(src.soilState && src.soilState.degradation) },
      intensity: AgricultureIntensity[src.intensity] ? src.intensity : 'normal', cropAllocation: deepClone(src.cropAllocation || {}),
      productionHistory: Array.isArray(src.productionHistory) ? deepClone(src.productionHistory) : [], lastOutput: src.lastOutput ? deepClone(src.lastOutput) : null,
      pendingDevelopmentCost: nonNegative(src.pendingDevelopmentCost)
    };
  }

  function create(initialData) {
    initialData = initialData || {};
    const state = {
      version: VERSION,
      regions: {},
      policies: Object.assign({}, DEFAULT_AGRICULTURE_POLICIES, deepClone(initialData.policies || {})),
      stateProjects: deepClone(initialData.stateProjects || {}),
      year: nonNegative(initialData.year)
    };
    const regions = initialData.regions || {};
    if (Array.isArray(regions)) {
      for (const r of regions) {
        if (r && r.regionId) state.regions[r.regionId] = createRegionState(r);
      }
    } else {
      for (const id of Object.keys(regions)) state.regions[id] = createRegionState(regions[id]);
    }
    validateState(state, true); return state;
  }
  function clone(state) { return create(deepClone(state)); }
  function getRegion(state, regionId) { return state && state.regions ? state.regions[regionId] || null : null; }
  function requireRegion(state, regionId) { const r = getRegion(state, regionId); if (!r) throw new Error('Agriculture region not found: ' + regionId); return r; }
  function ensureRegion(state, regionId, context) {
    if (!state.regions[regionId]) {
      const w = normalizeWorldRegion(getByRegion(context && context.world, regionId), regionId);
      const potential = Math.max(0, w.area * Math.max(0, 1 - w.terrain.slope) * (0.35 + 0.65 * w.soil.fertility));
      state.regions[regionId] = createRegionState({ land: { potentialArable: potential } });
    }
    return state.regions[regionId];
  }

  function evaluateCropSuitability(worldRegionOrContext, cropOrRegionId, maybeCropId) {
    let worldRegion, crop;
    if (typeof cropOrRegionId === 'object' && cropOrRegionId && cropOrRegionId.id) { worldRegion = normalizeWorldRegion(worldRegionOrContext, worldRegionOrContext && worldRegionOrContext.regionId); crop = cropOrRegionId; }
    else { const context = worldRegionOrContext || {}; worldRegion = normalizeWorldRegion(getByRegion(context.world, cropOrRegionId), cropOrRegionId); crop = CropDefinitions[maybeCropId]; }
    if (!crop) throw new Error('Unknown crop definition');
    const temp = rangeFitness(worldRegion.climate.temperature, crop.climate.temperatureIdeal, 0.28);
    const rain = rangeFitness(worldRegion.climate.rainfall, crop.climate.rainfallIdeal, 0.32);
    const season = worldRegion.climate.growingSeason >= crop.climate.growingSeasonMin ? 1 : clamp01(worldRegion.climate.growingSeason / Math.max(EPS, crop.climate.growingSeasonMin));
    const soil = clamp01(worldRegion.soil.fertility / Math.max(0.15, crop.soilNeed));
    const slope = clamp01(1 - worldRegion.terrain.slope * 0.85);
    const drainage = crop.id === 'rice' ? clamp01(0.65 + 0.35 * (1 - worldRegion.terrain.drainage)) : clamp01(0.45 + 0.55 * worldRegion.terrain.drainage);
    const flood = clamp01(1 - worldRegion.floodRisk * (crop.id === 'rice' ? 0.25 : 0.70));
    const factors = [temp, rain, season, soil, slope, drainage, flood];
    const score = clamp01(geometricMean(factors) * bottleneckPenalty([temp, rain, season, soil]));
    const limitingFactors = [];
    if (temp < 0.65) limitingFactors.push('temperature_mismatch');
    if (rain < 0.65) limitingFactors.push(worldRegion.climate.rainfall < crop.climate.rainfallIdeal[0] ? 'low_rainfall' : 'excess_rainfall');
    if (season < 0.70) limitingFactors.push('short_growing_season'); if (soil < 0.70) limitingFactors.push('low_soil_fertility'); if (slope < 0.70) limitingFactors.push('steep_slope'); if (flood < 0.70) limitingFactors.push('flood_risk');
    if (worldRegion.water.naturalAvailability < crop.waterNeed * 0.65) limitingFactors.push('low_water');
    return { score, limitingFactors, factors: { temperature: temp, rainfall: rain, growingSeason: season, soil, slope, drainage, flood } };
  }

  function regionExternal(context, regionId) {
    const world = normalizeWorldRegion(getByRegion(context && context.world, regionId), regionId);
    const d = getByRegion(context && context.development, regionId) || {}, e = getByRegion(context && context.economy, regionId) || {}, p = getByRegion(context && context.population, regionId) || {};
    return {
      world,
      development: { irrigationCapacity: nonNegative(d.irrigationCapacity), ruralRoadCapacity: nonNegative(d.ruralRoadCapacity), railAccess: clamp01(d.railAccess), storageCapacity: nonNegative(d.storageCapacity), coldStorageCapacity: nonNegative(d.coldStorageCapacity), machinerySupportCapacity: nonNegative(d.machinerySupportCapacity), distanceToMarket: clamp01(d.distanceToMarket) },
      economy: { availableFarmInputs: nonNegative(e.availableFarmInputs), availableMachinery: nonNegative(e.availableMachinery), agriculturalCapital: nonNegative(e.agriculturalCapital), agriculturalLandDevelopmentCost: nonNegative(e.agriculturalLandDevelopmentCost) },
      population: { ruralLaborAvailable: nonNegative(p.ruralLaborAvailable), foodDemand: deepClone(p.foodDemand || {}), population: nonNegative(p.population) }
    };
  }

  function developmentCostFor(region, requestedArea, context, regionId) {
    const ext = regionExternal(context || {}, regionId), potential = Math.max(EPS, region.land.potentialArable);
    const avg = (clamp01(region.land.developedArable / potential) + clamp01((region.land.developedArable + requestedArea) / potential)) / 2;
    const baseCost = Math.max(EPS, ext.economy.agriculturalLandDevelopmentCost || finite(context && context.baseAgriculturalLandDevelopmentCost, 1));
    const terrainCostFactor = 1 + ext.world.terrain.slope * 1.4 + Math.max(0, 0.45 - ext.world.terrain.drainage) * 0.8;
    const marginalLandFactor = 1 + 2.75 * avg * avg;
    return { total: requestedArea * baseCost * marginalLandFactor * terrainCostFactor, baseCost, marginalLandFactor, terrainCostFactor };
  }

  function developLand(state, regionId, requestedArea, context) {
    const next = clone(state), region = ensureRegion(next, regionId, context || {}); requestedArea = nonNegative(requestedArea);
    const remaining = Math.max(0, region.land.potentialArable - region.land.developedArable), developed = Math.min(requestedArea, remaining), cost = developmentCostFor(region, developed, context || {}, regionId);
    region.land.developedArable += developed; region.land.fallow += developed; region.pendingDevelopmentCost += cost.total; validateRegion(region, regionId, true);
    return { nextState: next, regionId, requestedArea, developedArea: developed, unfulfilledArea: requestedArea - developed, developmentCost: cost };
  }

  function reduceCultivation(state, regionId, area) {
    const next = clone(state), region = requireRegion(next, regionId); area = Math.min(nonNegative(area), region.land.cultivated); if (area <= 0) return { nextState: next, reducedArea: 0 };
    region.land.cultivated -= area; region.land.fallow = Math.min(region.land.developedArable, region.land.fallow + area);
    for (const id of Object.keys(CropDefinitions)) region.crops[id].area = region.land.cultivated * clamp01(region.cropAllocation[id] || 0);
    validateRegion(region, regionId, true); return { nextState: next, reducedArea: area };
  }

  function setCultivatedArea(state, regionId, area) {
    const next = clone(state), region = requireRegion(next, regionId), target = Math.min(region.land.developedArable, nonNegative(area)); region.land.cultivated = target;
    let sum = 0; for (const id of Object.keys(CropDefinitions)) { const share = clamp01(region.cropAllocation[id] || 0); sum += share; region.crops[id].allocation = share; region.crops[id].area = target * share; }
    region.land.fallow = Math.max(0, region.land.developedArable - target + target * Math.max(0, 1 - sum)); validateRegion(region, regionId, true); return next;
  }

  function setCropAllocation(state, regionId, allocation) {
    const next = clone(state), region = requireRegion(next, regionId), clean = {}; let sum = 0;
    for (const id of Object.keys(allocation || {})) { if (!CropDefinitions[id]) throw new Error('Unknown crop: ' + id); const s = clamp01(allocation[id]); clean[id] = s; sum += s; }
    if (sum > 1 + 1e-8) throw new Error('Crop allocation sum must be <= 1'); region.cropAllocation = clean;
    for (const id of Object.keys(CropDefinitions)) { const share = clean[id] || 0; region.crops[id].allocation = share; region.crops[id].area = region.land.cultivated * share; }
    region.land.fallow = Math.max(0, region.land.developedArable - region.land.cultivated + region.land.cultivated * (1 - sum)); validateRegion(region, regionId, true); return next;
  }

  function setAgriculturalIntensity(state, regionId, intensity) { if (!AgricultureIntensity[intensity]) throw new Error('Unknown agricultural intensity: ' + intensity); const n = clone(state); requireRegion(n, regionId).intensity = intensity; return n; }
  function setCropPriority(state, regionId, cropId, priority) { if (!CropDefinitions[cropId]) throw new Error('Unknown crop: ' + cropId); const n = clone(state), r = requireRegion(n, regionId); r.cropManagement[cropId] = r.cropManagement[cropId] || {}; r.cropManagement[cropId].priority = finite(priority, 50); return n; }

  function setAgriculturePolicy(state, key, value) {
    if (!state) throw new Error('Missing agriculture state');
    const allowed = new Set(['agriculturalTaxRate','inputSubsidyRate','creditSupportRate','minimumPurchasePrice','governmentProcurementShare']);
    if (!allowed.has(key)) throw new Error('Unknown agriculture policy: ' + key);
    const next = clone(state);
    next.policies = Object.assign({}, DEFAULT_AGRICULTURE_POLICIES, next.policies || {});
    if (key === 'agriculturalTaxRate' || key === 'inputSubsidyRate' || key === 'creditSupportRate' || key === 'governmentProcurementShare') next.policies[key] = clamp01(value);
    else next.policies[key] = nonNegative(value);
    return next;
  }

  function startStateAgricultureProject(state, type, regionId, parameters, currentYear) {
    if (!STATE_AGRICULTURE_PROJECT_TYPES[type]) throw new Error('Unknown state agriculture project: ' + type);
    const next = clone(state), region = requireRegion(next, regionId), spec = STATE_AGRICULTURE_PROJECT_TYPES[type];
    parameters = deepClone(parameters || {});
    let amount = nonNegative(parameters.area != null ? parameters.area : parameters.capacity);
    if (amount <= EPS) amount = 10;
    if (type === 'land_development') {
      const remaining = Math.max(0, region.land.potentialArable - region.land.developedArable);
      amount = Math.min(amount, remaining);
      parameters.area = amount;
      if (amount <= EPS) throw new Error('No undeveloped arable land remains in this region');
    } else {
      parameters.capacity = amount;
    }
    next.stateProjects = next.stateProjects || {};
    const serial = Object.keys(next.stateProjects).length + 1;
    const y = nonNegative(currentYear || next.year);
    const id = `agri_state_${type}_${Math.round(y)}_${String(serial).padStart(3,'0')}`;
    const cost = nonNegative(parameters.cost != null ? parameters.cost : spec.baseCost * Math.max(1, amount / 10));
    const totalTurns = Math.max(1, Math.round(nonNegative(parameters.totalTurns || spec.totalTurns)));
    const project = {
      id, type, regionId, status:'under_construction', cost, totalTurns,
      turnsRemaining:totalTurns, parameters, startedYear:y, completedYear:null
    };
    next.stateProjects[id] = project;
    return { nextState:next, project:deepClone(project) };
  }

  function advanceStateAgricultureProjects(state, context) {
    state.stateProjects = state.stateProjects || {};
    for (const project of Object.values(state.stateProjects)) {
      if (!project || project.status !== 'under_construction') continue;
      project.turnsRemaining = Math.max(0, nonNegative(project.turnsRemaining) - 1);
      if (project.turnsRemaining > 0) continue;
      const region = requireRegion(state, project.regionId);
      const amount = nonNegative(project.parameters && (project.parameters.area != null ? project.parameters.area : project.parameters.capacity));
      if (project.type === 'land_development') {
        const remaining = Math.max(0, region.land.potentialArable - region.land.developedArable);
        const added = Math.min(amount, remaining);
        region.land.developedArable += added;
        region.land.fallow += added;
        project.parameters.completedArea = added;
      } else if (project.type === 'irrigation_expansion') {
        region.infrastructureBonus = Object.assign({irrigationCapacity:0,storageCapacity:0}, region.infrastructureBonus || {});
        region.infrastructureBonus.irrigationCapacity = nonNegative(region.infrastructureBonus.irrigationCapacity) + amount;
      } else if (project.type === 'storage_expansion') {
        region.infrastructureBonus = Object.assign({irrigationCapacity:0,storageCapacity:0}, region.infrastructureBonus || {});
        region.infrastructureBonus.storageCapacity = nonNegative(region.infrastructureBonus.storageCapacity) + amount;
        region.storage.capacity = nonNegative(region.storage.capacity) + amount;
      }
      project.status = 'completed';
      project.completedYear = nonNegative(context && context.year);
    }
    return state;
  }

  function allocateIrrigation(state, regionId, allocation) {
    const next = clone(state), region = requireRegion(next, regionId); region.resources.irrigationByCrop = {};
    if (typeof allocation === 'number') { region.resources.irrigationRequested = nonNegative(allocation); region.resources.irrigationAllocated = 0; }
    else {
      allocation = allocation || {}; const byCrop = allocation.byCrop || (allocation.totalRequested == null && allocation.cropPriority == null ? allocation : {});
      for (const id of Object.keys(byCrop)) { if (!CropDefinitions[id]) throw new Error('Unknown crop: ' + id); region.resources.irrigationByCrop[id] = nonNegative(byCrop[id]); }
      region.resources.irrigationRequested = allocation.totalRequested == null ? sumObject(region.resources.irrigationByCrop) : nonNegative(allocation.totalRequested);
      if (allocation.cropPriority) for (const id of Object.keys(allocation.cropPriority)) { if (!CropDefinitions[id]) throw new Error('Unknown crop: ' + id); region.cropManagement[id] = region.cropManagement[id] || {}; region.cropManagement[id].priority = finite(allocation.cropPriority[id], 50); }
    }
    return next;
  }

  function setLivestockAllocation(state, regionId, allocation) { const n = clone(state), r = requireRegion(n, regionId); r.livestockAllocation = {}; for (const id of Object.keys(allocation || {})) { if (!LivestockDefinitions[id]) throw new Error('Unknown livestock: ' + id); r.livestockAllocation[id] = nonNegative(allocation[id]); } return n; }

  function calculateResourceDemand(state, context, regionId) {
    const region = requireRegion(state, regionId), intensity = AgricultureIntensity[region.intensity] || AgricultureIntensity.normal;
    const perCrop = {}, total = { labor: 0, machinery: 0, farmInputs: 0, water: 0, capital: 0 };
    for (const id of Object.keys(CropDefinitions)) {
      const crop = CropDefinitions[id], area = nonNegative(region.crops[id].area);
      const d = { labor: area * crop.laborNeed, machinery: area * crop.machineryNeed * intensity.machineryMultiplier, farmInputs: area * crop.inputNeed * intensity.inputMultiplier, water: area * crop.waterNeed, capital: area * crop.costPerArea * intensity.capitalMultiplier };
      perCrop[id] = d; for (const k of Object.keys(total)) total[k] += d[k];
    }
    return { regionId, perCrop, total };
  }

  function calculateAgriculturalLogistics(worldRegionOrContext, developmentOrRegionId) {
    let w, d;
    if (typeof developmentOrRegionId === 'string') { const ext = regionExternal(worldRegionOrContext || {}, developmentOrRegionId); w = ext.world; d = ext.development; }
    else { w = normalizeWorldRegion(worldRegionOrContext || {}, worldRegionOrContext && worldRegionOrContext.regionId); d = developmentOrRegionId || {}; }
    const roadNorm = clamp01(nonNegative(d.ruralRoadCapacity) / Math.max(100, nonNegative(w.area) * 0.6));
    const rail = clamp01(d.railAccess), slopePenalty = 1 - 0.45 * w.terrain.slope, distancePenalty = 1 - 0.35 * clamp01(d.distanceToMarket);
    const collectionFactor = clamp01((0.35 + 0.50 * roadNorm + 0.15 * rail) * slopePenalty);
    const inputDeliveryFactor = clamp01((0.30 + 0.55 * roadNorm + 0.15 * rail) * slopePenalty);
    const machineryAccessFactor = clamp01((0.25 + 0.65 * roadNorm + 0.10 * rail) * slopePenalty);
    const marketAccessFactor = clamp01((0.25 + 0.35 * roadNorm + 0.40 * rail) * distancePenalty);
    const bulkTransportCapacity = clamp01(0.20 + 0.30 * roadNorm + 0.50 * rail);
    return { collectionFactor, inputDeliveryFactor, machineryAccessFactor, marketAccessFactor, bulkTransportCapacity, roadNormalized: roadNorm };
  }

  function calculateCapitalDemand(state, context, regionId) {
    const d = calculateResourceDemand(state, context, regionId), perCrop = {}, totalByCategory = { labor: 0, machinery: 0, farmInputs: 0, irrigation: 0 }, total = d.total.capital;
    for (const id of Object.keys(CropDefinitions)) {
      const crop = CropDefinitions[id], amount = d.perCrop[id].capital, c = crop.operatingCost;
      perCrop[id] = { total: amount, labor: amount * c.labor, machinery: amount * c.machinery, farmInputs: amount * c.farmInputs, irrigation: amount * c.irrigation };
      for (const k of Object.keys(totalByCategory)) totalByCategory[k] += perCrop[id][k];
    }
    return { total, perCrop, totalByCategory };
  }

  function applyCapitalConstraint(physical, capitalDemand, capitalAvailable) {
    const out = { effective: {}, payment: {}, requiredCapital: capitalDemand.total, availableCapital: nonNegative(capitalAvailable), capitalUsed: 0 };
    const cats = ['labor', 'machinery', 'farmInputs', 'irrigation'];
    const totalReq = cats.reduce((s, k) => s + nonNegative(capitalDemand.totalByCategory[k]), 0);
    const globalPayFactor = totalReq <= EPS ? 1 : clamp01(out.availableCapital / totalReq);
    for (const k of cats) {
      const req = nonNegative(capitalDemand.totalByCategory[k]), paid = req * globalPayFactor, factor = req <= EPS ? 1 : clamp01(paid / req);
      out.payment[k] = { requiredCost: req, actualPaid: paid, paymentFactor: factor };
      out.effective[k] = nonNegative(physical[k]) * factor; out.capitalUsed += paid;
    }
    return out;
  }

  function allocateScarceResource(available, cropDemands, cropPriorities, minimumShare) {
    available = nonNegative(available); minimumShare = clamp01(minimumShare == null ? AgricultureConfig.minimumResourceShare : minimumShare);
    const ids = Object.keys(cropDemands || {}).sort(), result = {}, active = ids.filter(id => nonNegative(cropDemands[id]) > EPS);
    for (const id of ids) result[id] = { demand: nonNegative(cropDemands[id]), allocated: 0, factor: nonNegative(cropDemands[id]) <= EPS ? 1 : 0 };
    let remaining = available;
    // minimum guarantee is proportional to demand and capped by available pool
    const guaranteeNeed = active.reduce((s, id) => s + result[id].demand * minimumShare, 0);
    const guaranteeScale = guaranteeNeed <= EPS ? 1 : Math.min(1, remaining / guaranteeNeed);
    for (const id of active) { const a = result[id].demand * minimumShare * guaranteeScale; result[id].allocated += a; remaining -= a; }
    const order = active.slice().sort((a, b) => {
      const pa = finite(cropPriorities && cropPriorities[a], 50), pb = finite(cropPriorities && cropPriorities[b], 50);
      return pb !== pa ? pb - pa : a.localeCompare(b);
    });
    for (const id of order) { if (remaining <= EPS) break; const unmet = Math.max(0, result[id].demand - result[id].allocated), a = Math.min(unmet, remaining); result[id].allocated += a; remaining -= a; }
    for (const id of ids) result[id].factor = result[id].demand <= EPS ? 1 : clamp01(result[id].allocated / result[id].demand);
    return { byCrop: result, used: Math.max(0, available - remaining), unused: Math.max(0, remaining) };
  }

  function prioritiesFor(region) { const p = {}; for (const id of Object.keys(CropDefinitions)) p[id] = finite(region.cropManagement[id] && region.cropManagement[id].priority, 50); return p; }

  function resolveIrrigation(region, ext, demand, capitalEffectiveIrrigation, annualClimate) {
    const requestedByCrop = region.resources.irrigationByCrop || {}, priorities = prioritiesFor(region), infrastructureCapacity = ext.development.irrigationCapacity;
    const sourceCapacity = ext.world.water.irrigationSourceCapacity == null ? region.land.cultivated * ext.world.water.naturalAvailability * 0.75 : ext.world.water.irrigationSourceCapacity;
    const maxIrrigation = Math.min(infrastructureCapacity, sourceCapacity, nonNegative(capitalEffectiveIrrigation));
    const explicitTotal = sumObject(requestedByCrop), requestedTotal = region.resources.irrigationRequested > EPS ? region.resources.irrigationRequested : (explicitTotal > EPS ? explicitTotal : demand.total.water);
    const actualPool = Math.min(requestedTotal, maxIrrigation);
    const delivered = {}; let used = 0;
    if (explicitTotal > EPS) {
      const scale = explicitTotal <= actualPool + EPS ? 1 : actualPool / explicitTotal;
      for (const id of Object.keys(CropDefinitions)) { delivered[id] = nonNegative(requestedByCrop[id]) * scale; used += delivered[id]; }
    } else {
      const irrigationDemands = {}; for (const id of Object.keys(CropDefinitions)) irrigationDemands[id] = demand.perCrop[id].water;
      const alloc = allocateScarceResource(actualPool, irrigationDemands, priorities, 0);
      for (const id of Object.keys(CropDefinitions)) delivered[id] = alloc.byCrop[id].allocated;
      used = alloc.used;
    }
    const naturalWaterByCrop = {}, waterFactorByCrop = {};
    const rainfall = clamp01(ext.world.climate.rainfall + annualClimate.rainfallDelta);
    for (const id of Object.keys(CropDefinitions)) {
      const crop = CropDefinitions[id], area = nonNegative(region.crops[id].area), demandWater = demand.perCrop[id].water;
      const rainfallEfficiency = clamp01(0.55 + 0.35 * ext.world.terrain.drainage);
      const natural = area * rainfall * crop.waterNeed * rainfallEfficiency + area * ext.world.water.naturalAvailability * crop.waterNeed * 0.30;
      naturalWaterByCrop[id] = natural;
      waterFactorByCrop[id] = demandWater <= EPS ? 1 : clamp01((natural + nonNegative(delivered[id])) / demandWater);
    }
    return { infrastructureCapacity, sourceCapacity, requestedTotal, actualAllocated: used, maxIrrigation, byCrop: delivered, naturalWaterByCrop, waterFactorByCrop };
  }

  function calculateGrowingConditions(ext, crop, annualClimate) {
    const adjusted = deepClone(ext.world);
    adjusted.climate.temperature = clamp01(ext.world.climate.temperature + annualClimate.temperatureDelta); adjusted.climate.rainfall = clamp01(ext.world.climate.rainfall + annualClimate.rainfallDelta); adjusted.climate.growingSeason = clamp01(ext.world.climate.growingSeason + annualClimate.growingSeasonDelta);
    const suitability = evaluateCropSuitability(adjusted, crop);
    return { adjustedWorld: adjusted, suitability, climateFactor: geometricMean([suitability.factors.temperature, suitability.factors.rainfall, suitability.factors.growingSeason]) };
  }

  function calculateContinuousCroppingPressure(region, cropId) {
    const hist = (region.cropHistory || []).slice(-AgricultureConfig.continuousCroppingWindow); if (!hist.length) return 0;
    let weighted = 0, weights = 0;
    hist.forEach((h, i) => { const w = i + 1; weighted += clamp01(h.shares && h.shares[cropId]) * w; weights += w; });
    return weights <= EPS ? 0 : clamp01(weighted / weights);
  }
  function calculateRotationFactor(region, cropId) { const p = calculateContinuousCroppingPressure(region, cropId), c = CropDefinitions[cropId]; return clamp(1 - p * c.rotation.continuousCroppingSensitivity, AgricultureConfig.minimumRotationFactor, 1); }

  function calculateYieldFactor(crop, region, resources, annualClimateOrGrowing, ext, rotationFactor) {
    const intensity = AgricultureIntensity[region.intensity] || AgricultureIntensity.normal;
    const growing = annualClimateOrGrowing && annualClimateOrGrowing.suitability ? annualClimateOrGrowing : calculateGrowingConditions(ext, crop, annualClimateOrGrowing || { rainfallDelta: 0, temperatureDelta: 0, growingSeasonDelta: 0 });
    const suitabilityFactor = growing.suitability.score, climateFactor = growing.climateFactor;
    const soilFactor = clamp01(growing.adjustedWorld.soil.fertility * region.soilState.fertilityModifier * (1 - 0.72 * region.soilState.degradation));
    const waterFactor = clamp01(resources.water), laborFactor = clamp01(resources.labor), machineryFactor = clamp01(resources.machinery), inputFactor = clamp01(resources.farmInputs), rot = clamp(rotationFactor == null ? 1 : rotationFactor, AgricultureConfig.minimumRotationFactor, 1);
    const factors = [suitabilityFactor, climateFactor, waterFactor, laborFactor, machineryFactor, inputFactor, soilFactor, rot];
    const critical = [waterFactor, laborFactor, machineryFactor, inputFactor, climateFactor];
    const factor = clamp(geometricMean(factors) * bottleneckPenalty(critical) * intensity.potentialYieldMultiplier, 0, 1.35);
    return { factor, factors: { suitabilityFactor, climateFactor, waterFactor, laborFactor, machineryFactor, inputFactor, soilFactor, rotationFactor: rot }, limitingFactors: growing.suitability.limitingFactors.slice() };
  }

  function calculateStorageLoss(product, quantity, storageContext) {
    quantity = nonNegative(quantity); const crop = CropDefinitions[product]; if (!crop || quantity <= 0) return 0; storageContext = storageContext || {};
    const tech = clamp01(finite(storageContext.storageTechnology, 0.5)), coldShare = product === 'potato' ? clamp01(nonNegative(storageContext.coldCapacityAvailable) / Math.max(EPS, quantity)) : 0;
    let rate = crop.storageLossRate * (1 - 0.45 * tech); if (product === 'potato') rate *= 1 - 0.55 * coldShare; return Math.min(quantity, quantity * Math.max(0, rate));
  }
  function totalStocks(stocks) { return sumObject(stocks); }

  function beginAnnualStorageFlow(region) { region.storage.annualFlow = blankAnnualFlow(); region.storage.annualFlow.openingStock = deepClone(region.storage.stocks); }

  function addHarvestToStorage(region, harvestByCrop, storageContext) {
    const stocks = region.storage.stocks, capacity = nonNegative(region.storage.capacity), result = { added: {}, overflow: {}, preLoss: {}, storageLoss: {} }; let used = totalStocks(stocks);
    for (const id of Object.keys(harvestByCrop || {}).sort()) {
      const q = nonNegative(harvestByCrop[id]), room = Math.max(0, capacity - used), accepted = Math.min(q, room), overflow = q - accepted;
      stocks[id] = nonNegative(stocks[id]) + accepted; used += accepted; result.added[id] = accepted; result.overflow[id] = overflow; result.preLoss[id] = stocks[id];
      region.storage.annualFlow.harvestInflow[id] = nonNegative(region.storage.annualFlow.harvestInflow[id]) + accepted; region.storage.annualFlow.overflowLoss[id] = nonNegative(region.storage.annualFlow.overflowLoss[id]) + overflow;
    }
    for (const id of Object.keys(stocks).sort()) {
      const loss = calculateStorageLoss(id, stocks[id], { storageTechnology: storageContext && storageContext.storageTechnology, coldCapacityAvailable: region.storage.coldStorageCapacity });
      stocks[id] = Math.max(0, stocks[id] - loss);
      if (region.storage.reserved[id] != null) region.storage.reserved[id] = Math.min(nonNegative(region.storage.reserved[id]), stocks[id]);
      result.storageLoss[id] = loss; region.storage.annualFlow.storageLoss[id] = nonNegative(region.storage.annualFlow.storageLoss[id]) + loss;
    }
    return result;
  }

  function reserveStock(state, regionId, goodId, quantity, reason) {
    const n = clone(state), r = requireRegion(n, regionId), physical = nonNegative(r.storage.stocks[goodId]), current = nonNegative(r.storage.reserved[goodId]), add = Math.min(nonNegative(quantity), Math.max(0, physical - current));
    r.storage.reserved[goodId] = current + add; return { nextState: n, reserved: add, totalReserved: r.storage.reserved[goodId], reason: reason || null };
  }
  function releaseReservedStock(state, regionId, goodId, quantity) { const n = clone(state), r = requireRegion(n, regionId), current = nonNegative(r.storage.reserved[goodId]), release = Math.min(current, nonNegative(quantity)); r.storage.reserved[goodId] = current - release; return { nextState: n, released: release }; }
  function requestWithdrawal(state, regionId, request) {
    const n = clone(state), r = requireRegion(n, regionId), q = nonNegative(request && request.quantity); if (!request || !request.goodId || q <= 0) return n;
    r.storage.pendingWithdrawals.push({ requester: String(request.requester || 'unknown'), goodId: String(request.goodId), quantity: q, purpose: String(request.purpose || 'unspecified'), priority: finite(request.priority, 50), sequence: r.storage.pendingWithdrawals.length }); return n;
  }
  function getAvailableSupply(stateOrRegion, regionId, goodId) {
    const r = regionId == null && stateOrRegion && stateOrRegion.storage ? stateOrRegion : requireRegion(stateOrRegion, regionId);
    const one = id => { const physicalStock = nonNegative(r.storage.stocks[id]), reservedStock = Math.min(physicalStock, nonNegative(r.storage.reserved[id])); return { regionId: regionId == null ? null : regionId, goodId: id, physicalStock, reservedStock, withdrawableStock: Math.max(0, physicalStock - reservedStock) }; };
    if (goodId) return one(goodId); const out = {}; for (const id of Object.keys(r.storage.stocks || {}).sort()) out[id] = one(id); return out;
  }
  function commitWithdrawals(state, regionId) {
    const n = clone(state), r = requireRegion(n, regionId), reqs = (r.storage.pendingWithdrawals || []).slice().sort((a, b) => b.priority !== a.priority ? b.priority - a.priority : (a.sequence || 0) - (b.sequence || 0));
    const fulfilled = [], unmet = [];
    for (const req of reqs) {
      const avail = getAvailableSupply(r, null, req.goodId).withdrawableStock, delivered = Math.min(req.quantity, avail), shortage = Math.max(0, req.quantity - delivered);
      r.storage.stocks[req.goodId] = Math.max(0, nonNegative(r.storage.stocks[req.goodId]) - delivered); r.storage.annualFlow.withdrawalOutflow[req.goodId] = nonNegative(r.storage.annualFlow.withdrawalOutflow[req.goodId]) + delivered;
      const rec = { requester: req.requester, goodId: req.goodId, requested: req.quantity, delivered, shortage, purpose: req.purpose, priority: req.priority };
      if (delivered > 0) fulfilled.push(rec); if (shortage > EPS) unmet.push(rec);
    }
    r.storage.pendingWithdrawals = []; return { nextState: n, fulfilled, unmet };
  }

  function evaluateRegionDevelopment(state, context, regionId, cropId) {
    const r = requireRegion(state, regionId), ext = regionExternal(context || {}, regionId), crop = CropDefinitions[cropId]; if (!crop) throw new Error('Unknown crop: ' + cropId);
    const agronomicSuitability = evaluateCropSuitability(ext.world, crop).score, logistics = calculateAgriculturalLogistics(ext.world, ext.development);
    const remaining = Math.max(0, r.land.potentialArable - r.land.developedArable), expansionPotential = r.land.potentialArable <= EPS ? 0 : clamp01(remaining / r.land.potentialArable);
    const expectedLabor = Math.max(EPS, Math.max(1, remaining * 0.25) * crop.laborNeed), laborAvailability = clamp01(ext.population.ruralLaborAvailable / expectedLabor);
    const sourceNorm = ext.world.water.irrigationSourceCapacity == null ? ext.world.water.naturalAvailability : clamp01(ext.world.water.irrigationSourceCapacity / Math.max(1, r.land.potentialArable * crop.waterNeed));
    const irrigationNorm = clamp01(ext.development.irrigationCapacity / Math.max(1, r.land.potentialArable * crop.waterNeed));
    const waterSecurity = clamp01(0.55 * ext.world.water.naturalAvailability + 0.25 * sourceNorm + 0.20 * irrigationNorm);
    const devCost = developmentCostFor(r, Math.min(Math.max(1, r.land.potentialArable * 0.05), remaining), context || {}, regionId);
    const developmentCostIndex = clamp01((devCost.marginalLandFactor * devCost.terrainCostFactor - 1) / 5);
    const storageReadiness = clamp01(ext.development.storageCapacity / Math.max(1, r.land.cultivated || r.land.developedArable || 1));
    const machineryReadiness = clamp01(ext.development.machinerySupportCapacity / Math.max(1, r.land.cultivated || 1));
    return {
      agronomicSuitability, developmentCostIndex, laborAvailability, waterSecurity,
      logisticsAccess: { collection: logistics.collectionFactor, inputs: logistics.inputDeliveryFactor, machinery: logistics.machineryAccessFactor, market: logistics.marketAccessFactor },
      expansionPotential,
      infrastructureReadiness: { irrigationReadiness: irrigationNorm, storageReadiness, transportReadiness: logistics.marketAccessFactor, machineryReadiness },
      riskProfile: { droughtRisk: clamp01(1 - waterSecurity), floodRisk: ext.world.floodRisk, soilDegradationRisk: r.soilState.degradation, logisticsRisk: clamp01(1 - logistics.collectionFactor) }
    };
  }

  function updateCropHistory(region, year) {
    const shares = {}; for (const id of Object.keys(CropDefinitions)) shares[id] = region.land.cultivated <= EPS ? 0 : clamp01(region.crops[id].area / region.land.cultivated);
    region.cropHistory.push({ year: nonNegative(year), shares }); while (region.cropHistory.length > AgricultureConfig.cropHistoryYears) region.cropHistory.shift();
  }

  function updateLandCondition(region, cropResourceFactors) {
    const intensity = AgricultureIntensity[region.intensity] || AgricultureIntensity.normal, cultivatedShare = region.land.developedArable > EPS ? clamp01(region.land.cultivated / region.land.developedArable) : 0, fallowShare = region.land.developedArable > EPS ? clamp01(region.land.fallow / region.land.developedArable) : 0;
    let weightedWater = 0, areaSum = 0, continuous = 0, rotationRecovery = 0;
    for (const id of Object.keys(CropDefinitions)) { const area = nonNegative(region.crops[id].area); if (area <= EPS) continue; const rf = cropResourceFactors[id] || {}; weightedWater += area * clamp01(rf.water); areaSum += area; const p = calculateContinuousCroppingPressure(region, id); continuous += area * p * CropDefinitions[id].rotation.continuousCroppingSensitivity * 0.012; if (CropDefinitions[id].rotation.nitrogenFixing) rotationRecovery += area * CropDefinitions[id].rotation.soilRecoveryEffect * 0.015; }
    const waterFactor = areaSum <= EPS ? 1 : weightedWater / areaSum, irrigationStress = Math.max(0, 0.55 - waterFactor) * 0.015;
    const continuousPressure = areaSum <= EPS ? 0 : continuous / areaSum, rotationRecoveryNorm = areaSum <= EPS ? 0 : rotationRecovery / areaSum;
    const pressure = intensity.degradationPressure * cultivatedShare + irrigationStress + continuousPressure, recovery = 0.014 * fallowShare + rotationRecoveryNorm + (region.intensity === 'extensive' ? 0.002 * cultivatedShare : 0);
    const delta = pressure - recovery; region.soilState.degradation = clamp01(region.soilState.degradation + delta); region.soilState.fertilityModifier = clamp(1 - 0.52 * region.soilState.degradation, 0.45, 1.05); region.land.degraded = Math.min(region.land.developedArable, region.land.developedArable * region.soilState.degradation);
    return { degradationDelta: delta, degradation: region.soilState.degradation, fertilityModifier: region.soilState.fertilityModifier, continuousPressure, rotationRecovery: rotationRecoveryNorm };
  }

  function maybeAbandonCultivation(region, cropResourceFactors) {
    let minFactor = 1; for (const id of Object.keys(CropDefinitions)) { if (region.crops[id].area <= EPS) continue; const f = cropResourceFactors[id] || {}; minFactor = Math.min(minFactor, clamp01(f.labor), clamp01(f.water), clamp01(f.machinery), clamp01(f.farmInputs)); }
    const stress = Math.max(0, (1 - minFactor) - 0.55) + Math.max(0, region.soilState.degradation - 0.72); if (stress <= 0) return 0;
    const abandoned = Math.min(region.land.cultivated, region.land.cultivated * Math.min(0.12, stress * 0.06)); region.land.cultivated -= abandoned;
    for (const id of Object.keys(CropDefinitions)) region.crops[id].area = region.land.cultivated * clamp01(region.cropAllocation[id] || 0);
    region.land.fallow = Math.max(region.land.fallow, region.land.developedArable - region.land.cultivated); return abandoned;
  }

  function buildInfrastructureNeed(regionId, region, ext, demand, irrigation, logistics, overflowTotal) {
    const irrigationGap = demand.total.water <= EPS ? 0 : clamp01(1 - (irrigation.actualAllocated + sumObject(irrigation.naturalWaterByCrop)) / demand.total.water);
    const roadAccessGap = clamp01(1 - logistics.collectionFactor), storageGap = nonNegative(overflowTotal), railLogisticsGap = demand.total.farmInputs > 0 ? clamp01(1 - logistics.bulkTransportCapacity) : 0;
    if (irrigationGap <= 0.01 && storageGap <= 0.01 && roadAccessGap <= 0.01 && railLogisticsGap <= 0.01) return null;
    return { type: 'agricultureInfrastructureNeed', regionId, irrigationGap, storageGap, roadAccessGap, railLogisticsGap };
  }

  function simulateRegionYear(state, context, regionId) {
    context = context || {}; const next = clone(state), region = ensureRegion(next, regionId, context), ext = regionExternal(context, regionId), annualClimate = getAnnualClimateVariation(context.seed, context.year, regionId);
    const policy = Object.assign({}, DEFAULT_AGRICULTURE_POLICIES, next.policies || {});
    const bonus = Object.assign({irrigationCapacity:0,storageCapacity:0}, region.infrastructureBonus || {});
    ext.development.irrigationCapacity = nonNegative(ext.development.irrigationCapacity) + nonNegative(bonus.irrigationCapacity);
    ext.development.storageCapacity = nonNegative(ext.development.storageCapacity) + nonNegative(bonus.storageCapacity);
    region.storage.capacity = Math.max(region.storage.capacity, ext.development.storageCapacity); region.storage.coldStorageCapacity = Math.max(region.storage.coldStorageCapacity, ext.development.coldStorageCapacity); beginAnnualStorageFlow(region);

    // 2 logistics
    const logistics = calculateAgriculturalLogistics(ext.world, ext.development); region.logistics = { collectionCapacity: logistics.collectionFactor, inputDeliveryCapacity: logistics.inputDeliveryFactor, marketAccess: logistics.marketAccessFactor, storageAccess: logistics.collectionFactor };
    // 3 demand
    const demand = calculateResourceDemand(next, context, regionId), capitalDemand = calculateCapitalDemand(next, context, regionId);
    const inputSubsidy = clamp01(policy.inputSubsidyRate);
    capitalDemand.totalByCategory.farmInputs *= (1 - 0.65 * inputSubsidy);
    capitalDemand.total = Object.values(capitalDemand.totalByCategory).reduce((a,v)=>a+nonNegative(v),0);
    // 4-5 capital and physical availability. Policy changes financing, never physical input stock.
    const physical = { labor: ext.population.ruralLaborAvailable, machinery: Math.min(ext.economy.availableMachinery, ext.development.machinerySupportCapacity > 0 ? ext.development.machinerySupportCapacity : Infinity) * logistics.machineryAccessFactor, farmInputs: ext.economy.availableFarmInputs * logistics.inputDeliveryFactor, irrigation: ext.development.irrigationCapacity };
    const priceSupportSignal = clamp01(nonNegative(policy.minimumPurchasePrice) / (1 + nonNegative(policy.minimumPurchasePrice)));
    const policyCapitalFactor = Math.max(0.25, 1 - 0.25 * clamp01(policy.agriculturalTaxRate) + 0.50 * clamp01(policy.creditSupportRate) + 0.15 * clamp01(policy.governmentProcurementShare) + 0.10 * priceSupportSignal);
    const capital = applyCapitalConstraint(physical, capitalDemand, ext.economy.agriculturalCapital * policyCapitalFactor); region.resources.capitalAllocated = capital.capitalUsed;
    // 6-8 resource allocation
    const priorities = prioritiesFor(region), laborDemands = {}, machineDemands = {}, inputDemands = {};
    for (const id of Object.keys(CropDefinitions)) { laborDemands[id] = demand.perCrop[id].labor; machineDemands[id] = demand.perCrop[id].machinery; inputDemands[id] = demand.perCrop[id].farmInputs; }
    const laborAlloc = allocateScarceResource(capital.effective.labor, laborDemands, priorities), machineAlloc = allocateScarceResource(capital.effective.machinery, machineDemands, priorities), inputAlloc = allocateScarceResource(capital.effective.farmInputs, inputDemands, priorities);
    // mechanization can partially substitute labor if a crop receives surplus-equivalent machinery access; cap modestly
    for (const id of Object.keys(CropDefinitions)) {
      const labor = laborAlloc.byCrop[id], machine = machineAlloc.byCrop[id];
      if (labor.demand > EPS && labor.factor < 1 && machine.factor >= 0.95) labor.factor = clamp01(labor.factor + 0.20 * (1 - labor.factor) * logistics.machineryAccessFactor);
    }
    // 9 irrigation
    const irrigation = resolveIrrigation(region, ext, demand, capital.effective.irrigation, annualClimate); region.resources.irrigationAllocated = irrigation.actualAllocated;
    // 10 planting
    for (const id of Object.keys(CropDefinitions)) region.crops[id].plantedArea = nonNegative(region.crops[id].area);
    // 11-13 growing, rotation, harvest
    const cropProduction = {}, cropDetails = {}, cropResourceFactors = {}, shortageSet = new Set();
    for (const id of Object.keys(CropDefinitions)) {
      const crop = CropDefinitions[id], cs = region.crops[id], plantedArea = nonNegative(cs.plantedArea); if (plantedArea <= EPS) { cs.yield = 0; cs.harvest = 0; cs.factors = {}; continue; }
      const growing = calculateGrowingConditions(ext, crop, annualClimate), rot = calculateRotationFactor(region, id);
      const rf = cropResourceFactors[id] = { labor: laborAlloc.byCrop[id].factor, machinery: machineAlloc.byCrop[id].factor, farmInputs: inputAlloc.byCrop[id].factor, water: irrigation.waterFactorByCrop[id] };
      const yf = calculateYieldFactor(crop, region, rf, growing, ext, rot), yieldPerArea = crop.baseYield * yf.factor, harvest = plantedArea * yieldPerArea;
      cs.yield = yieldPerArea; cs.harvest = harvest; cs.factors = yf.factors; cropProduction[id] = harvest; cropDetails[id] = { plantedArea, yieldPerArea, harvest, factors: yf.factors, limitingFactors: yf.limitingFactors, resourceAllocation: { labor: laborAlloc.byCrop[id], machinery: machineAlloc.byCrop[id], farmInputs: inputAlloc.byCrop[id], irrigation: { allocated: irrigation.byCrop[id] || 0, factor: irrigation.waterFactorByCrop[id] } } };
      if (rf.water < 0.65) shortageSet.add('water'); if (rf.labor < 0.65) shortageSet.add('labor'); if (rf.machinery < 0.65) shortageSet.add('machinery'); if (rf.farmInputs < 0.65) shortageSet.add('farm_inputs');
    }
    if (capital.availableCapital + EPS < capital.requiredCapital) shortageSet.add('capital');
    // 14 collection
    const collected = {}, fieldLoss = {}; for (const id of Object.keys(cropProduction)) { collected[id] = cropProduction[id] * logistics.collectionFactor; fieldLoss[id] = cropProduction[id] - collected[id]; region.storage.annualFlow.fieldLoss[id] = fieldLoss[id]; }
    // 15-17 storage, overflow, losses
    const storage = addHarvestToStorage(region, collected, { storageTechnology: clamp01(0.35 + 0.45 * logistics.collectionFactor + 0.20 * logistics.marketAccessFactor) });
    const overflowTotal = sumObject(storage.overflow);
    // 18 withdrawals already queued before simulateYear are committed now, after harvest/losses
    const pending = region.storage.pendingWithdrawals.length;
    const withdrawalResult = commitWithdrawals(next, regionId); const afterWithdrawalState = withdrawalResult.nextState; const wr = requireRegion(afterWithdrawalState, regionId);
    // continue on committed clone
    const finalRegion = wr;
    // 19 outputs / conditions
    const availableSupply = {}; for (const id of Object.keys(finalRegion.storage.stocks).sort()) availableSupply[id] = getAvailableSupply(finalRegion, null, id);
    const infraNeed = buildInfrastructureNeed(regionId, finalRegion, ext, demand, irrigation, logistics, overflowTotal), capitalNeed = capital.availableCapital + EPS < capital.requiredCapital ? { type: 'agricultureCapitalShortage', regionId, requiredCapital: capital.requiredCapital, availableCapital: capital.availableCapital, fundingGap: capital.requiredCapital - capital.availableCapital } : null;
    const conditions = [];
    for (const id of Object.keys(cropDetails)) { const f = cropDetails[id].factors; if (Math.min(f.waterFactor, f.climateFactor) < 0.45) conditions.push({ type: 'agricultureCondition', regionId, condition: 'crop_failure', cropId: id, causes: { rainfallFactor: f.climateFactor, irrigationFactor: f.waterFactor, cropWaterNeed: CropDefinitions[id].waterNeed }, severity: clamp01(1 - Math.min(f.waterFactor, f.climateFactor)) }); }
    // 20 land condition, 21 history
    const landCondition = updateLandCondition(finalRegion, cropResourceFactors), abandonedArea = maybeAbandonCultivation(finalRegion, cropResourceFactors); updateCropHistory(finalRegion, context.year);
    finalRegion.resources.laborAllocated = laborAlloc.used; finalRegion.resources.machineryAllocated = machineAlloc.used; finalRegion.resources.farmInputsAllocated = inputAlloc.used;
    finalRegion.storage.annualFlow.closingStock = deepClone(finalRegion.storage.stocks);
    const output = {
      regionId, cropProduction, cropHarvestCollected: collected, fieldLoss,
      resourceUse: { labor: Object.fromEntries(Object.keys(CropDefinitions).map(id => [id, laborAlloc.byCrop[id].allocated])), machinery: Object.fromEntries(Object.keys(CropDefinitions).map(id => [id, machineAlloc.byCrop[id].allocated])), farmInputs: Object.fromEntries(Object.keys(CropDefinitions).map(id => [id, inputAlloc.byCrop[id].allocated])), irrigation: deepClone(irrigation.byCrop), capital: { required: capital.requiredCapital, used: capital.capitalUsed, byCategory: deepClone(capital.payment) } },
      resourceDemand: deepClone(demand.total), shortages: Array.from(shortageSet), landChanges: { degradationDelta: landCondition.degradationDelta, abandonedArea },
      storageFlow: deepClone(finalRegion.storage.annualFlow), storage: storage, withdrawals: { pendingBeforeSettlement: pending, fulfilled: withdrawalResult.fulfilled, unmet: withdrawalResult.unmet },
      availableSupply, cropDetails, infrastructureNeeds: infraNeed ? [infraNeed] : [], capitalNeeds: capitalNeed ? [capitalNeed] : [], conditions,
      policyEffects: { policies:deepClone(policy), policyCapitalFactor, inputSubsidyApplied:inputSubsidy, procurementTarget:sumObject(cropProduction)*clamp01(policy.governmentProcurementShare) },
      logistics: deepClone(logistics)
    };
    finalRegion.lastOutput = deepClone(output); finalRegion.productionHistory.push({ year: nonNegative(context.year), output: deepClone(output) }); if (finalRegion.productionHistory.length > 100) finalRegion.productionHistory.splice(0, finalRegion.productionHistory.length - 100);
    afterWithdrawalState.year = nonNegative(context.year); validateRegion(finalRegion, regionId, true);
    return { nextState: afterWithdrawalState, output, debug: { annualClimate, external: ext, demand, capitalDemand, capital, logistics, laborAlloc, machineAlloc, inputAlloc, irrigation } };
  }

  function simulateYear(state, context) {
    context = context || {}; let working = clone(state);
    working.policies = Object.assign({}, DEFAULT_AGRICULTURE_POLICIES, working.policies || {});
    advanceStateAgricultureProjects(working, context);
    const ids = new Set(Object.keys(working.regions)), wrs = context.world && context.world.regions;
    if (Array.isArray(wrs)) wrs.forEach(r => { if (r && r.regionId) ids.add(r.regionId); }); else if (wrs && typeof wrs === 'object') Object.keys(wrs).forEach(id => ids.add(id));
    const outputs = { production: [], agriculturalEmployment: [], shortages: [], importNeeds: [], infrastructureNeeds: [], capitalNeeds: [], conditions: [], availableSupply: [] }, debug = { regions: {} };
    for (const regionId of Array.from(ids).sort()) {
      const sim = simulateRegionYear(working, context, regionId); working = sim.nextState; debug.regions[regionId] = sim.debug; const out = sim.output;
      for (const id of Object.keys(out.cropProduction)) outputs.production.push({ regionId, goodId: id, quantity: out.cropProduction[id], collectedQuantity: out.cropHarvestCollected[id] });
      outputs.agriculturalEmployment.push({ regionId, agriculturalEmployment: sumObject(out.resourceUse.labor), ruralLaborDemand: out.resourceDemand.labor });
      outputs.shortages.push({ regionId, shortages: deepClone(out.shortages) }); outputs.infrastructureNeeds.push.apply(outputs.infrastructureNeeds, out.infrastructureNeeds); outputs.capitalNeeds.push.apply(outputs.capitalNeeds, out.capitalNeeds); outputs.conditions.push.apply(outputs.conditions, out.conditions);
      const goods = {}; for (const id of Object.keys(out.availableSupply)) goods[id] = out.availableSupply[id].withdrawableStock; outputs.availableSupply.push({ regionId, goods, detail: deepClone(out.availableSupply) });
      const ext = regionExternal(context, regionId), demand = ext.population.foodDemand || {};
      for (const id of Object.keys(demand)) { const supply = goods[id] || 0, need = nonNegative(demand[id]); if (need > supply) outputs.importNeeds.push({ regionId, goodId: id, shortage: need - supply }); }
    }
    validateState(working, true); return { nextState: working, outputs, debug };
  }

  function getOutputs(state) {
    const out = { production: [], agriculturalEmployment: [], shortages: [], infrastructureNeeds: [], capitalNeeds: [], conditions: [], availableSupply: [] }; if (!state || !state.regions) return out;
    for (const regionId of Object.keys(state.regions).sort()) { const r = state.regions[regionId], last = r.lastOutput; if (!last) continue; for (const id of Object.keys(last.cropProduction || {})) out.production.push({ regionId, goodId: id, quantity: last.cropProduction[id], collectedQuantity: last.cropHarvestCollected && last.cropHarvestCollected[id] }); out.agriculturalEmployment.push({ regionId, agriculturalEmployment: sumObject(last.resourceUse && last.resourceUse.labor), ruralLaborDemand: last.resourceDemand && last.resourceDemand.labor }); out.shortages.push({ regionId, shortages: deepClone(last.shortages || []) }); out.infrastructureNeeds.push.apply(out.infrastructureNeeds, deepClone(last.infrastructureNeeds || [])); out.capitalNeeds.push.apply(out.capitalNeeds, deepClone(last.capitalNeeds || [])); out.conditions.push.apply(out.conditions, deepClone(last.conditions || [])); const goods = {}; for (const id of Object.keys(last.availableSupply || {})) goods[id] = last.availableSupply[id].withdrawableStock; out.availableSupply.push({ regionId, goods, detail: deepClone(last.availableSupply || {}) }); }
    return out;
  }

  function validateRegion(region, regionId, throwOnError) {
    const errors = [], L = region.land; if (L.potentialArable + EPS < L.developedArable) errors.push('potentialArable < developedArable'); if (L.developedArable + EPS < L.cultivated) errors.push('developedArable < cultivated'); if (L.cultivated < -EPS) errors.push('cultivated < 0'); if (L.fallow < -EPS) errors.push('fallow < 0');
    if (totalStocks(region.storage.stocks) > region.storage.capacity + EPS) errors.push('stocks exceed storage capacity');
    for (const id of Object.keys(region.storage.reserved || {})) { const p = nonNegative(region.storage.stocks[id]), res = nonNegative(region.storage.reserved[id]); if (res > p + EPS) errors.push('reservedStock > physicalStock: ' + id); if (p - res < -EPS) errors.push('withdrawableStock < 0: ' + id); }
    let cropArea = 0; for (const id of Object.keys(region.crops || {})) { if (region.crops[id].area < -EPS) errors.push('negative crop area: ' + id); cropArea += nonNegative(region.crops[id].area); } if (cropArea > L.cultivated + EPS) errors.push('sumCropArea > cultivatedLand');
    const scan = stableStringify(region); if (scan.indexOf('NaN') >= 0 || scan.indexOf('Infinity') >= 0) errors.push('non-finite numeric state'); if (errors.length && throwOnError) throw new Error('Agriculture invariant failure [' + regionId + ']: ' + errors.join('; ')); return errors;
  }
  function validateState(state, throwOnError) { const e = []; if (!state || !state.regions) e.push('missing regions'); else for (const id of Object.keys(state.regions)) validateRegion(state.regions[id], id, false).forEach(x => e.push(id + ': ' + x)); if (e.length && throwOnError) throw new Error('Agriculture state invalid: ' + e.join(' | ')); return e; }
  function serialize(state) { validateState(state, true); return stableStringify(state); }
  function deserialize(json) { return create(typeof json === 'string' ? JSON.parse(json) : deepClone(json)); }

  Agriculture.VERSION = VERSION; Agriculture.AgricultureConfig = AgricultureConfig; Agriculture.CropDefinitions = CropDefinitions; Agriculture.LivestockDefinitions = LivestockDefinitions; Agriculture.AgricultureIntensity = AgricultureIntensity;
  Agriculture.DEFAULT_AGRICULTURE_POLICIES = DEFAULT_AGRICULTURE_POLICIES; Agriculture.STATE_AGRICULTURE_PROJECT_TYPES = STATE_AGRICULTURE_PROJECT_TYPES;
  Agriculture.clamp01 = clamp01; Agriculture.getAnnualClimateVariation = getAnnualClimateVariation; Agriculture.create = create; Agriculture.clone = clone; Agriculture.getRegion = getRegion; Agriculture.evaluateCropSuitability = evaluateCropSuitability; Agriculture.evaluateRegionDevelopment = evaluateRegionDevelopment;
  Agriculture.developLand = developLand; Agriculture.reduceCultivation = reduceCultivation; Agriculture.setCultivatedArea = setCultivatedArea; Agriculture.setCropAllocation = setCropAllocation; Agriculture.setAgriculturalIntensity = setAgriculturalIntensity; Agriculture.setCropPriority = setCropPriority; Agriculture.allocateIrrigation = allocateIrrigation; Agriculture.setLivestockAllocation = setLivestockAllocation;
  Agriculture.setAgriculturePolicy = setAgriculturePolicy; Agriculture.startStateAgricultureProject = startStateAgricultureProject; Agriculture.advanceStateAgricultureProjects = function(state,context){const n=clone(state);advanceStateAgricultureProjects(n,context||{});return n;};
  Agriculture.calculateResourceDemand = calculateResourceDemand; Agriculture.calculateCapitalDemand = calculateCapitalDemand; Agriculture.applyCapitalConstraint = applyCapitalConstraint; Agriculture.allocateScarceResource = allocateScarceResource; Agriculture.calculateAgriculturalLogistics = calculateAgriculturalLogistics; Agriculture.calculateContinuousCroppingPressure = calculateContinuousCroppingPressure; Agriculture.calculateRotationFactor = calculateRotationFactor; Agriculture.calculateYieldFactor = calculateYieldFactor;
  Agriculture.calculateStorageLoss = calculateStorageLoss; Agriculture.addHarvestToStorage = addHarvestToStorage; Agriculture.requestWithdrawal = requestWithdrawal; Agriculture.commitWithdrawals = commitWithdrawals; Agriculture.reserveStock = reserveStock; Agriculture.releaseReservedStock = releaseReservedStock; Agriculture.getAvailableSupply = getAvailableSupply;
  Agriculture.simulateRegionYear = simulateRegionYear; Agriculture.simulateYear = simulateYear; Agriculture.getOutputs = getOutputs; Agriculture.validateState = validateState; Agriculture.serialize = serialize; Agriculture.deserialize = deserialize;

})(typeof window !== 'undefined' ? window : globalThis);
/* ===== END MODULE 9 — AGRICULTURE & FOOD ===== */
