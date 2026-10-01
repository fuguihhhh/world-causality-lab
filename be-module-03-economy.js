/* ===== MODULE 3 — ECONOMY & GOVERNMENT FINANCE — INLINE INTEGRATED ===== */
/*
 * BorderEpoch — Module 3: Economy & Government Finance
 * Standalone ES5-compatible-ish JavaScript module, no dependencies.
 *
 * Core rule:
 * physical world -> production/jobs -> income -> taxes/finance
 * Population reactions are NOT handled here; Module 4 consumes this output.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.Economy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var GOODS = ['food', 'coal', 'iron', 'steel', 'manufactured_goods'];

  var GOOD_CONFIG = {
    food:               { basePrice: 1.00, minPrice: 0.65, maxPrice: 1.75 },
    coal:               { basePrice: 1.00, minPrice: 0.60, maxPrice: 1.80 },
    iron:               { basePrice: 1.00, minPrice: 0.60, maxPrice: 1.80 },
    steel:              { basePrice: 1.00, minPrice: 0.65, maxPrice: 1.90 },
    manufactured_goods: { basePrice: 1.00, minPrice: 0.70, maxPrice: 2.00 }
  };

  /* Capacity is an abstract amount produced per turn at 100% operation.
     Facility.capacity scales these defaults. A facility with capacity=100 uses exactly these values. */
  var FACILITY_TYPES = {
    farm: {
      sector: 'agriculture', workersRequired: 4000, wage: 35,
      inputs: {}, output: { food: 80 }, powerDemand: 4, transportNeed: 0.35,
      operatingCost: 5, resource: 'fertile_farmland'
    },
    coal_mine: {
      sector: 'coal_mining', workersRequired: 8000, wage: 48,
      inputs: {}, output: { coal: 70 }, powerDemand: 7, transportNeed: 0.60,
      operatingCost: 8, resource: 'coal'
    },
    iron_mine: {
      sector: 'iron_mining', workersRequired: 7500, wage: 48,
      inputs: {}, output: { iron: 65 }, powerDemand: 7, transportNeed: 0.60,
      operatingCost: 8, resource: 'iron'
    },
    steelworks: {
      sector: 'steel', workersRequired: 12000, wage: 62,
      inputs: { coal: 50, iron: 40 }, output: { steel: 65 }, powerDemand: 18,
      transportNeed: 0.85, operatingCost: 18
    },
    basic_factory: {
      sector: 'basic_manufacturing', workersRequired: 7000, wage: 55,
      inputs: { steel: 38 }, output: { manufactured_goods: 60 }, powerDemand: 14,
      transportNeed: 0.75, operatingCost: 13
    }
  };

  var TAX_PRESETS = {
    low:    { household: 0.08, business: 0.12, disposableIncomeFactor: 1.05 },
    normal: { household: 0.14, business: 0.20, disposableIncomeFactor: 1.00 },
    high:   { household: 0.22, business: 0.28, disposableIncomeFactor: 0.92 }
  };

  var state = freshState();

  function freshState() {
    return {
      turn: 0,
      facilities: {}, cities: {}, regions: {}, countries: {}, goods: {}, projects: {},
      bottlenecks: [], debug: { facility: {}, city: {}, government: {}, goods: {} },
      module2Signals: { projectProgress: {}, maintenance: {} },
      module4Signals: { countries: {} },
      module5Signals: { tariffAssessments: [], tradeValues: {} },
      fiscalInputs: { facilitySubsidies: {} },
      fiscalAudit: {},
      previous: null
    };
  }

  function num(v, fallback) {
    v = Number(v);
    return Number.isFinite(v) ? v : (fallback == null ? 0 : fallback);
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function safeDiv(a, b, fallback) { return b > 0 ? a / b : (fallback == null ? 0 : fallback); }
  function sumValues(obj) { var s = 0; Object.keys(obj || {}).forEach(function(k){ s += num(obj[k]); }); return s; }
  function copy(obj) { return JSON.parse(JSON.stringify(obj)); }
  function idOf(x, prefix, i) { return String(x && (x.id || x.key) || (prefix + '_' + i)); }
  function list(x) { return Array.isArray(x) ? x : []; }
  function normalizeOwner(o) {
    o = o || {};
    var foreign = clamp(num(o.foreignShare != null ? o.foreignShare : o.foreign, 0), 0, 1);
    var stateShare = clamp(num(o.stateShare != null ? o.stateShare : o.state, 0), 0, 1);
    var domestic = o.domesticPrivateShare != null ? num(o.domesticPrivateShare) : Math.max(0, 1 - foreign - stateShare);
    var total = foreign + stateShare + domestic;
    if (total <= 0) return { stateShare: 0, domesticPrivateShare: 1, foreignShare: 0 };
    return { stateShare: stateShare / total, domesticPrivateShare: domestic / total, foreignShare: foreign / total };
  }

  function indexGame(gs) {
    // Shared gameState uses keyed objects in Modules 1/2/4/5/8, while older
    // Module 3 prototypes also accepted arrays. Accept both without copying away
    // object identity, so every module reads the same canonical entities.
    function mapCollection(value, prefix) {
      var out = {};
      if (Array.isArray(value)) value.forEach(function(x,i){ if(x) out[idOf(x,prefix,i)] = x; });
      else if (value && typeof value === 'object') Object.keys(value).forEach(function(k,i){ var x=value[k]; if(x) out[String(x.id || k || (prefix+'_'+i))] = x; });
      return out;
    }
    function arrayCollection(value) {
      if (Array.isArray(value)) return value.filter(Boolean);
      if (value && typeof value === 'object') return Object.values(value).filter(Boolean);
      return [];
    }
    var connectionSource = gs.infrastructureConnections || gs.connections || (gs.infrastructure && gs.infrastructure.connections);
    var projectSource = gs.completedProjects || gs.projects;
    var idx = {
      regions: mapCollection(gs.regions, 'region'),
      cities: mapCollection(gs.cities, 'city'),
      facilities: mapCollection(gs.facilities, 'facility'),
      countries: mapCollection(gs.countries, 'country'),
      connections: arrayCollection(connectionSource),
      projects: arrayCollection(projectSource)
    };
    if (!Object.keys(idx.countries).length) idx.countries.default = { id: 'default', name: 'Country' };
    return idx;
  }

  function facilitySpec(f) {
    var base = FACILITY_TYPES[f.type] || {};
    var override = f.economy || f.economic || {};
    return {
      sector: override.sector || base.sector || f.type || 'other',
      workersRequired: num(override.workersRequired != null ? override.workersRequired : base.workersRequired, 0),
      wage: num(override.wage != null ? override.wage : base.wage, 45),
      inputs: Object.assign({}, base.inputs || {}, override.inputs || f.inputs || {}),
      output: Object.assign({}, base.output || {}, override.output || f.output || {}),
      powerDemand: num(override.powerDemand != null ? override.powerDemand : (f.powerDemand != null ? f.powerDemand : base.powerDemand), 0),
      transportNeed: clamp(num(override.transportNeed != null ? override.transportNeed : base.transportNeed, 0.5), 0, 1),
      operatingCost: num(override.operatingCost != null ? override.operatingCost : base.operatingCost, 0),
      resource: override.resource || base.resource || f.resourceRequired || null
    };
  }

  function capacityScale(f) { return clamp(num(f.capacity, 100) / 100, 0, 10); }

  function findRegionResource(region, resource) {
    if (!resource) return 1;
    var resources = region && (region.resources || region.resourceDeposits || region.deposits);
    if (!resources) return 0;
    if (Array.isArray(resources)) {
      var found = resources.find(function(x){ return x === resource || (x && (x.type === resource || x.id === resource)); });
      if (!found) return 0;
      if (typeof found === 'string') return 1;
      if (found.accessible === false || found.depleted === true) return 0;
      return clamp(num(found.quality != null ? found.quality : found.availability, 1), 0, 1);
    }
    var v = resources[resource];
    if (v == null) return 0;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'number') return clamp(v, 0, 1);
    if (v && (v.accessible === false || v.depleted === true)) return 0;
    return clamp(num(v.quality != null ? v.quality : v.availability, 1), 0, 1);
  }

  /* Local logistics is deliberately separate from inter-regional freight.
     Module 2 region-to-region connections are consumed by buildFreightNetwork();
     they must NOT reduce facility production a second time here. */
  function localLogisticsFactorFor(f, idx) {
    if (f.localLogisticsFactor != null) return clamp(num(f.localLogisticsFactor), 0, 1);
    var city = idx.cities[f.cityId] || {};
    var region = idx.regions[f.regionId || city.regionId] || {};
    if (city.localLogisticsFactor != null) return clamp(num(city.localLogisticsFactor), 0, 1);
    if (region.localLogisticsFactor != null) return clamp(num(region.localLogisticsFactor), 0, 1);

    // Backward compatibility: explicit facility/city transportFactor means LOCAL logistics only.
    if (city.transportFactor != null) return clamp(num(city.transportFactor), 0, 1);
    if (f.transportFactor != null) return clamp(num(f.transportFactor), 0, 1);

    // No implicit penalty. Inter-regional rail/road/port capacity is already handled
    // by buildFreightNetwork(), so ordinary facilities default to full local access.
    return 1;
  }

  function regionPowerFactors(idx) {
    var out = {};
    Object.keys(idx.regions).forEach(function(rid){
      var r = idx.regions[rid];
      var supply = num(r.powerSupply, num(r.power && r.power.supply, 100));
      var explicitDemand = r.powerDemand != null ? num(r.powerDemand) : num(r.power && r.power.demand, NaN);
      var facilityDemand = 0;
      Object.keys(idx.facilities).forEach(function(fid){
        var f = idx.facilities[fid];
        var city = idx.cities[f.cityId] || {};
        if (String(f.regionId || city.regionId) === String(rid) && f.active !== false && f.completed !== false) facilityDemand += facilitySpec(f).powerDemand * capacityScale(f);
      });
      var demand = Number.isFinite(explicitDemand) ? Math.max(explicitDemand, facilityDemand) : facilityDemand;
      out[rid] = { supply: supply, demand: demand, factor: demand > 0 ? clamp(supply / demand, 0, 1) : 1 };
    });
    return out;
  }

  function cityWorkers(idx) {
    var out = {};
    Object.keys(idx.cities).forEach(function(cid){
      var c = idx.cities[cid];
      var population = num(c.population, 0);
      var workers = num(c.availableWorkers != null ? c.availableWorkers : c.workingAgePopulation, population * 0.55);
      out[cid] = {
        total: Math.max(0, workers),
        remaining: Math.max(0, workers),
        requested: 0,
        filled: 0,
        allocations: {},
        offeredWages: {}
      };
    });
    return out;
  }

  function dynamicOfferedWage(fid, f) {
    var spec = facilitySpec(f);
    var base = Math.max(1, spec.wage);
    var prev = state.previous && state.previous.facilities && state.previous.facilities[fid];
    if (!prev) return base;

    var prevWage = Math.max(1, num(prev.wage, base));
    var prevRequired = Math.max(0, num(prev.workersRequired, 0));
    var prevAllocated = Math.max(0, num(prev.workersAllocated != null ? prev.workersAllocated : prev.workersEmployed, 0));
    var staffing = prevRequired > 0 ? clamp(prevAllocated / prevRequired, 0, 1) : 1;

    // Short-staffed firms bid wages upward; fully staffed firms gently drift toward base wage.
    var target = base * (1 + Math.max(0, 0.95 - staffing) * 0.22);
    if (staffing >= 0.995) target = base;

    var lo = prevWage * (1 - MAX_WAGE_FALL_PER_TURN);
    var hi = prevWage * (1 + MAX_WAGE_RISE_PER_TURN);
    return clamp(target, lo, hi);
  }

  function calcLaborAllocation(idx, workers) {
    var byCity = {};

    Object.keys(idx.facilities).forEach(function(fid){
      var f = idx.facilities[fid];
      if (f.active === false || f.completed === false) return;
      var spec = facilitySpec(f), scale = capacityScale(f), cid = String(f.cityId || '');
      if (!workers[cid]) {
        workers[cid] = { total:0, remaining:0, requested:0, filled:0, allocations:{}, offeredWages:{} };
      }
      var demand = Math.max(0, spec.workersRequired * scale);
      var wage = dynamicOfferedWage(fid, f);
      workers[cid].requested += demand;
      workers[cid].offeredWages[fid] = wage;
      if (!byCity[cid]) byCity[cid] = [];
      byCity[cid].push({ facilityId:fid, demand:demand, wage:wage });
    });

    Object.keys(workers).forEach(function(cid){
      var pool = workers[cid];
      var entries = byCity[cid] || [];
      var totalDemand = entries.reduce(function(a,e){ return a + e.demand; }, 0);
      var available = Math.max(0, pool.total);
      pool.requested = totalDemand;
      pool.allocations = pool.allocations || {};

      if (totalDemand <= 0) {
        pool.allocationFactor = 1;
        return;
      }
      if (available >= totalDemand) {
        entries.forEach(function(e){ pool.allocations[e.facilityId] = 1; });
        pool.allocationFactor = 1;
        return;
      }

      var guaranteeNeed = totalDemand * LABOR_MINIMUM_STAFFING_GUARANTEE;
      var allocated = {};

      if (available <= guaranteeNeed + 1e-9) {
        var common = clamp(available / totalDemand, 0, LABOR_MINIMUM_STAFFING_GUARANTEE);
        entries.forEach(function(e){
          allocated[e.facilityId] = e.demand * common;
          pool.allocations[e.facilityId] = common;
        });
        pool.allocationFactor = common;
        return;
      }

      entries.forEach(function(e){ allocated[e.facilityId] = e.demand * LABOR_MINIMUM_STAFFING_GUARANTEE; });
      var remaining = available - guaranteeNeed;
      var active = entries.slice(), guard = 0;

      while (remaining > 1e-9 && active.length && guard++ < 30) {
        var avgWage = active.reduce(function(a,e){ return a + e.wage; }, 0) / Math.max(1, active.length);
        var weightSum = 0;
        active.forEach(function(e){
          var need = Math.max(0, e.demand - allocated[e.facilityId]);
          var wageWeight = Math.pow(Math.max(0.25, e.wage / Math.max(1, avgWage)), 1.5);
          weightSum += need * wageWeight;
        });
        if (weightSum <= 1e-12) break;

        var spent = 0;
        active.forEach(function(e){
          var need = Math.max(0, e.demand - allocated[e.facilityId]);
          if (need <= 0) return;
          var wageWeight = Math.pow(Math.max(0.25, e.wage / Math.max(1, avgWage)), 1.5);
          var share = remaining * (need * wageWeight / weightSum);
          var grant = Math.min(need, share);
          allocated[e.facilityId] += grant;
          spent += grant;
        });
        if (spent <= 1e-12) break;
        remaining -= spent;
        active = active.filter(function(e){ return e.demand - allocated[e.facilityId] > 1e-9; });
      }

      entries.forEach(function(e){
        pool.allocations[e.facilityId] = e.demand > 0 ? clamp(allocated[e.facilityId] / e.demand, 0, 1) : 1;
      });
      pool.allocationFactor = clamp(available / totalDemand, 0, 1); // summary only
    });
    return workers;
  }

  function facilityLaborFactor(workers, f, fid) {
    var pool = workers[String(f.cityId)] || {};
    if (pool.allocations && pool.allocations[fid] != null) return clamp(num(pool.allocations[fid]), 0, 1);
    return pool.allocationFactor != null ? clamp(num(pool.allocationFactor), 0, 1) : 0;
  }

  function facilityOfferedWage(workers, f, fid) {
    var pool = workers[String(f.cityId)] || {};
    return pool.offeredWages && pool.offeredWages[fid] != null ? num(pool.offeredWages[fid]) : facilitySpec(f).wage;
  }

  function initialGoods(previous) {
    var g = {};
    GOODS.forEach(function(k){
      g[k] = { id: k, supply: 0, demand: 0, available: 0, usedByIndustry: 0, unmetDemand: 0,
        price: previous && previous.goods && previous.goods[k] ? previous.goods[k].price : GOOD_CONFIG[k].basePrice,
        basePrice: GOOD_CONFIG[k].basePrice };
    });
    return g;
  }

  function domesticFinalDemand(idx) {
    var pop = 0;
    Object.keys(idx.cities).forEach(function(cid){ pop += num(idx.cities[cid].population, 0); });
    // Abstract per-turn demand units. Population scaling deliberately gentle for prototype stability.
    var p = pop / 100000;
    return {
      food: Math.max(8, p * 8),
      coal: 0,
      iron: 0,
      steel: Math.max(4, p * 1.2),
      manufactured_goods: Math.max(5, p * 4.5)
    };
  }

  function productionPass(idx, goods, power, workers, stage) {
    Object.keys(idx.facilities).forEach(function(fid){
      var f = idx.facilities[fid];
      if (f.active === false || f.completed === false) return;
      var spec = facilitySpec(f);
      var hasInputs = Object.keys(spec.inputs).length > 0;
      if ((stage === 0 && hasInputs) || (stage === 1 && !hasInputs)) return;

      var city = idx.cities[f.cityId] || {};
      var regionId = String(f.regionId || city.regionId || '');
      var region = idx.regions[regionId] || {};
      var scale = capacityScale(f);
      var laborFactor = facilityLaborFactor(workers, f, String(fid != null ? fid : (f.id || f.key || '')));
      var powerFactor = power[regionId] ? power[regionId].factor : 1;
      var rawTransport = localLogisticsFactorFor(f, idx);
      var transportFactor = clamp(1 - spec.transportNeed * (1 - rawTransport), 0, 1);
      var resourceFactor = findRegionResource(region, spec.resource);
      var inputFactors = {};

      Object.keys(spec.inputs).forEach(function(gid){
        var need = num(spec.inputs[gid]) * scale;
        var have = goods[gid] ? goods[gid].available : 0;
        inputFactors[gid] = need > 0 ? clamp(have / need, 0, 1) : 1;
      });
      var allFactors = { labor: laborFactor, power: powerFactor, transport: transportFactor };
      if (spec.resource) allFactors.resource = resourceFactor;
      Object.keys(inputFactors).forEach(function(k){ allFactors['input:' + k] = inputFactors[k]; });
      var productionLevel = 1;
      Object.keys(allFactors).forEach(function(k){ productionLevel = Math.min(productionLevel, allFactors[k]); });
      productionLevel = clamp(productionLevel, 0, 1);

      var employed = spec.workersRequired * scale * productionLevel;
      if (workers[String(f.cityId)]) workers[String(f.cityId)].filled += employed;

      var consumed = {};
      Object.keys(spec.inputs).forEach(function(gid){
        var amount = num(spec.inputs[gid]) * scale * productionLevel;
        consumed[gid] = amount;
        goods[gid].available = Math.max(0, goods[gid].available - amount);
        goods[gid].usedByIndustry += amount;
        goods[gid].demand += amount;
      });
      var produced = {};
      Object.keys(spec.output).forEach(function(gid){
        if (!goods[gid]) return;
        var amount = num(spec.output[gid]) * scale * productionLevel;
        produced[gid] = amount;
        goods[gid].supply += amount;
        goods[gid].available += amount;
      });

      var limiting = Object.keys(allFactors).sort(function(a,b){ return allFactors[a] - allFactors[b]; })[0] || 'none';
      state.facilities[fid] = {
        facilityId: fid, type: f.type, cityId: f.cityId, regionId: regionId,
        productionLevel: productionLevel,
        workersRequired: spec.workersRequired * scale, workersEmployed: employed,
        inputDemand: copy(spec.inputs), inputsConsumed: consumed, output: produced,
        powerDemand: spec.powerDemand * scale, powerFactor: powerFactor,
        transportFactor: localLogisticsFactor, localLogisticsFactor: localLogisticsFactor, resourceFactor: resourceFactor,
        factors: allFactors, mainBottleneck: productionLevel < 0.995 ? limiting : null,
        wage: spec.wage, ownership: normalizeOwner(f.ownership),
        operatingCostBase: spec.operatingCost * scale
      };
    });
  }


  /* ------------------------------------------------------------------
     REGIONAL GOODS LAYER
     ------------------------------------------------------------------
     Module 1 supplies regions/resources.
     Module 2 supplies facilities, power and infrastructure connections.
     Module 3 owns the accounting below.
     Module 4 consumes the resulting city/region economic outputs.
     Module 5 may inject foreign trade through externalEconomy hooks.
  */

  var GOODS_PRIORITY = {
    food: 1.20,
    steel: 1.10,
    coal: 1.00,
    iron: 1.00,
    manufactured_goods: 0.80
  };

  var STORAGE_RETENTION = {
    food: 0.85,
    coal: 0.99,
    iron: 0.99,
    steel: 0.99,
    manufactured_goods: 0.96
  };

  var PRODUCTION_PRIORITY_WEIGHTS = {
    low: 0.50,
    normal: 1.00,
    high: 1.50,
    critical: 2.00
  };

  // If regional supply can cover this share of every facility's demand,
  // reserve it first before priority-weighted competition for the remainder.
  var MINIMUM_INPUT_GUARANTEE = 0.20;

  // Labor market: wages react gradually to the previous year's staffing pressure.
  // One turn = one year, so annual wage movement is deliberately bounded.
  var LABOR_MINIMUM_STAFFING_GUARANTEE = 0.20;
  var MAX_WAGE_RISE_PER_TURN = 0.05;
  var MAX_WAGE_FALL_PER_TURN = 0.02;

  // One turn = one year. Regional prices are smoothed and additionally capped so
  // temporary shortages do not create unstable annual price explosions.
  var MAX_PRICE_RISE_PER_TURN = 0.25;
  var MAX_PRICE_FALL_PER_TURN = 0.20;

  // Firms need working capital to pre-finance inputs and operating costs. New firms
  // without an explicit capital value start with a modest one-turn buffer; thereafter
  // their retained earnings/losses determine available capital.
  var DEFAULT_WORKING_CAPITAL_BUFFER = 1.15;
  var INVENTORY_SOFT_LIMIT = 0.75;

  // Prototype storage capacities by region. Module 2 can override/expand these via
  // region.storageCapacity or facility.storageCapacity.
  var DEFAULT_STORAGE_CAPACITY = {
    food: 250,
    coal: 300,
    iron: 250,
    steel: 220,
    manufactured_goods: 220
  };

  // Abstract freight cost per 100 km (or per segment when no distance is supplied).
  var FREIGHT_COST_PER_100KM = {
    rail: 0.015,
    port: 0.010,
    shipping: 0.010,
    highway: 0.025,
    road: 0.040,
    other: 0.050
  };

  var PROJECT_MATERIAL_DEFAULTS = {
    railway: { steel: 30, manufactured_goods: 12 },
    rail: { steel: 30, manufactured_goods: 12 },
    highway: { steel: 18, manufactured_goods: 10 },
    road: { steel: 10, manufactured_goods: 8 },
    port: { steel: 40, manufactured_goods: 22 },
    power_plant: { steel: 35, manufactured_goods: 20 },
    powerplant: { steel: 35, manufactured_goods: 20 },
    factory: { steel: 20, manufactured_goods: 14 },
    steelworks: { steel: 24, manufactured_goods: 16 },
    default: { steel: 10, manufactured_goods: 8 }
  };

  function productionPriorityOf(f) {
    var p = String((f && (f.productionPriority || f.industryPriority)) || 'normal').toLowerCase();
    return PRODUCTION_PRIORITY_WEIGHTS[p] != null ? p : 'normal';
  }

  function productionPriorityWeight(f) {
    return PRODUCTION_PRIORITY_WEIGHTS[productionPriorityOf(f)];
  }

  function createRegionGoodState(gid, previousGood) {
    var cfg = GOOD_CONFIG[gid];
    previousGood = previousGood || {};
    var carry = Math.max(0, num(previousGood.stockpile, 0));
    return {
      id: gid,
      production: 0,
      industrialDemand: 0,
      industrialUse: 0,
      finalDemand: 0,
      finalUse: 0,
      projectDemand: 0,
      projectUse: 0,
      localDemand: 0,
      domesticImports: 0,
      domesticExports: 0,
      foreignImports: 0,
      foreignExports: 0,
      transportCostIn: 0,
      transportCostOut: 0,
      importCommodityCost: 0,
      foreignImportValue: 0,
      foreignExportValue: 0,
      tariffPaid: 0,
      averageImportTransportCost: 0,
      averageImportLandedCost: 0,
      imports: 0,
      exports: 0,
      startStockpile: carry,
      stockpile: carry,
      available: carry,
      endingInventory: carry,
      storageCapacity: Infinity,
      storageOverflow: 0,
      shortage: 0,
      surplus: 0,
      marketSupply: 0,
      marketUse: 0,
      sellThroughRate: 1,
      productionSold: 0,
      unsoldProduction: 0,
      price: previousGood.price != null ? num(previousGood.price, cfg.basePrice) : cfg.basePrice,
      basePrice: cfg.basePrice
    };
  }

  function initialRegionalGoods(idx, previous) {
    var out = {};
    Object.keys(idx.regions).forEach(function(rid){
      out[rid] = {};
      GOODS.forEach(function(gid){
        var pg = previous && previous.regions && previous.regions[rid] && previous.regions[rid].goods && previous.regions[rid].goods[gid];
        out[rid][gid] = createRegionGoodState(gid, pg);
      });
    });
    return out;
  }

  function regionPopulation(idx, rid) {
    var total = 0;
    Object.keys(idx.cities).forEach(function(cid){
      var c = idx.cities[cid];
      if (String(c.regionId) === String(rid)) total += num(c.population, 0);
    });
    return total;
  }

  function setRegionalFinalDemand(idx, regionalGoods) {
    Object.keys(idx.regions).forEach(function(rid){
      var p = regionPopulation(idx, rid) / 100000;
      var demand = {
        food: Math.max(0, p * 8),
        coal: 0,
        iron: 0,
        steel: Math.max(0, p * 1.2),
        manufactured_goods: Math.max(0, p * 4.5)
      };
      // Preserve the prototype's minimum national demand without forcing every tiny region to consume a minimum.
      GOODS.forEach(function(gid){
        regionalGoods[rid][gid].finalDemand = demand[gid] || 0;
      });
    });
  }

  function facilityDemandFactor(f, idx) {
    if (!state.previous || !state.previous.regions) return 1;
    var spec = facilitySpec(f);
    var city = idx.cities[f.cityId] || {};
    var regionId = String(f.regionId || city.regionId || '');
    var previousRegion = state.previous.regions[regionId];
    if (!previousRegion || !previousRegion.goods) return 1;

    // Demand is a lagged market signal: if last year's output sold poorly, the firm
    // reduces this year's production target. Inventory is handled separately below.
    var factors = [];
    Object.keys(spec.output || {}).forEach(function(gid){
      var pg = previousRegion.goods[gid];
      if (!pg) return;
      var sell = pg.sellThroughRate != null ? clamp(num(pg.sellThroughRate), 0, 1) : 1;
      factors.push(clamp(0.15 + 0.85 * sell, 0.10, 1));
    });
    if (!factors.length) return 1;
    return factors.reduce(function(a,b){ return Math.min(a,b); }, 1);
  }

  function facilityInventoryFactor(f, idx) {
    if (!state.previous || !state.previous.regions) return 1;
    var spec = facilitySpec(f);
    var city = idx.cities[f.cityId] || {};
    var regionId = String(f.regionId || city.regionId || '');
    var previousRegion = state.previous.regions[regionId];
    if (!previousRegion || !previousRegion.goods) return 1;
    var factors = [];
    Object.keys(spec.output || {}).forEach(function(gid){
      var pg = previousRegion.goods[gid];
      if (!pg) return;
      var cap = num(pg.storageCapacity, 0);
      if (!(cap > 0) || !Number.isFinite(cap)) { factors.push(1); return; }
      var inventory = Math.max(0, num(pg.endingInventory != null ? pg.endingInventory : pg.stockpile, 0));
      var occupancy = inventory / cap;
      var factor = 1;
      if (occupancy > INVENTORY_SOFT_LIMIT) {
        factor = clamp(1 - (occupancy - INVENTORY_SOFT_LIMIT) / (1 - INVENTORY_SOFT_LIMIT) * 0.75, 0.25, 1);
      }
      if (num(pg.storageOverflow, 0) > 0) factor = Math.min(factor, 0.20);
      factors.push(factor);
    });
    return factors.length ? factors.reduce(function(a,b){ return Math.min(a,b); }, 1) : 1;
  }

  function explicitFacilitySubsidy(fiscalInputs, fid) {
    return Math.max(0, num(fiscalInputs && fiscalInputs.facilitySubsidies && fiscalInputs.facilitySubsidies[fid], 0));
  }

  function estimateWorkingCapitalNeed(f, fid, base, regionalGoods, workers, level) {
    level = clamp(num(level, 1), 0, 1);
    var inputCost = 0;
    Object.keys(base.spec.inputs || {}).forEach(function(gid){
      var g = regionalGoods[base.regionId] && regionalGoods[base.regionId][gid];
      var price = g ? num(g.price, GOOD_CONFIG[gid] ? GOOD_CONFIG[gid].basePrice : 1) : (GOOD_CONFIG[gid] ? GOOD_CONFIG[gid].basePrice : 1);
      inputCost += num(base.spec.inputs[gid]) * base.scale * level * price;
    });
    var operating = base.spec.operatingCost * base.scale * level;
    // Working capital is a pre-production liquidity constraint. Payroll remains a
    // current-period cost in the final business account, not double-counted here.
    return Math.max(0, inputCost + operating);
  }

  function facilityWorkingCapital(fid, f, estimatedNeed, fiscalInputs) {
    var prev = state.previous && state.previous.facilities && state.previous.facilities[fid];
    var override = f.workingCapitalOverride != null ? f.workingCapitalOverride : ((f.economy || {}).workingCapitalOverride);
    var opening;
    if (override != null) opening = Math.max(0, num(override));
    else if (prev && prev.endingWorkingCapital != null) opening = Math.max(0, num(prev.endingWorkingCapital));
    else if (f.workingCapital != null) opening = Math.max(0, num(f.workingCapital));
    else if ((f.economy || {}).workingCapital != null) opening = Math.max(0, num((f.economy || {}).workingCapital));
    else opening = Math.max(0, estimatedNeed * DEFAULT_WORKING_CAPITAL_BUFFER);
    var subsidy = explicitFacilitySubsidy(fiscalInputs, fid);
    return { opening: opening, subsidy: subsidy, available: opening + subsidy };
  }

  function baseFacilityFactors(f, idx, power, workers, fid, regionalGoods, fiscalInputs) {
    var spec = facilitySpec(f);
    var city = idx.cities[f.cityId] || {};
    var regionId = String(f.regionId || city.regionId || '');
    var region = idx.regions[regionId] || {};
    var scale = capacityScale(f);
    var laborFactor = facilityLaborFactor(workers, f, String(fid != null ? fid : (f.id || f.key || '')));
    var powerFactor = power[regionId] ? power[regionId].factor : 1;
    var rawLocalLogistics = localLogisticsFactorFor(f, idx);
    var localLogisticsFactor = clamp(1 - spec.transportNeed * (1 - rawLocalLogistics), 0, 1);
    var resourceFactor = findRegionResource(region, spec.resource);
    var demandFactor = facilityDemandFactor(f, idx);
    var inventoryFactor = facilityInventoryFactor(f, idx);
    var preFinanceLimit = Math.min(laborFactor, powerFactor, localLogisticsFactor, demandFactor, inventoryFactor);
    if (spec.resource) preFinanceLimit = Math.min(preFinanceLimit, resourceFactor);
    preFinanceLimit = clamp(preFinanceLimit, 0, 1);
    var shell = { spec:spec, regionId:regionId, scale:scale };
    var workingCapitalRequired = estimateWorkingCapitalNeed(f, fid, shell, regionalGoods, workers, preFinanceLimit);
    var capital = facilityWorkingCapital(String(fid), f, workingCapitalRequired, fiscalInputs);
    var financeFactor = workingCapitalRequired > 0 ? clamp(capital.available / workingCapitalRequired, 0, 1) : 1;
    return {
      spec: spec, city: city, regionId: regionId, region: region, scale: scale,
      laborFactor: laborFactor, powerFactor: powerFactor, demandFactor: demandFactor, inventoryFactor: inventoryFactor,
      financeFactor: financeFactor, workingCapitalRequired: workingCapitalRequired, openingWorkingCapital:capital.opening,
      subsidyReceived:capital.subsidy, workingCapitalAvailable:capital.available,
      transportFactor: localLogisticsFactor, localLogisticsFactor: localLogisticsFactor, resourceFactor: resourceFactor
    };
  }

  function nonInputProductionLimit(base) {
    var limit = Math.min(base.laborFactor, base.powerFactor, base.localLogisticsFactor, base.demandFactor, base.inventoryFactor, base.financeFactor);
    if (base.spec.resource) limit = Math.min(limit, base.resourceFactor);
    return clamp(limit, 0, 1);
  }

  function facilityStage(f) {
    var spec = facilitySpec(f);
    var inputs = Object.keys(spec.inputs);
    if (!inputs.length) return 0;
    if (f.type === 'steelworks') return 1;
    if (f.type === 'basic_factory') return 2;
    return 2;
  }

  function addStageIndustrialDemand(idx, regionalGoods, power, workers, stage, fiscalInputs) {
    Object.keys(idx.facilities).forEach(function(fid){
      var f = idx.facilities[fid];
      if (f.active === false || f.completed === false || facilityStage(f) !== stage) return;
      var b = baseFacilityFactors(f, idx, power, workers, fid, regionalGoods, fiscalInputs);
      if (!regionalGoods[b.regionId]) return;
      var potentialLevel = nonInputProductionLimit(b);
      Object.keys(b.spec.inputs).forEach(function(gid){
        if (!regionalGoods[b.regionId][gid]) return;
        regionalGoods[b.regionId][gid].industrialDemand += num(b.spec.inputs[gid]) * b.scale * potentialLevel;
      });
    });
  }

  function calculateStageInputAllocation(idx, regionalGoods, power, workers, stage, fiscalInputs) {
    // Returns facility-specific allocation ratios: allocation[facilityId][goodId] = 0..1.
    // Rule:
    // 1) if supply is abundant, everyone gets 100%;
    // 2) if supply is so scarce that even the minimum guarantee cannot be covered,
    //    everyone receives the same proportional fraction;
    // 3) otherwise reserve the minimum guarantee for all facilities, then distribute
    //    the remainder by remaining demand × player-selected production priority.
    var groups = {};
    var allocation = {};

    Object.keys(idx.facilities).forEach(function(fid){
      var f = idx.facilities[fid];
      if (f.active === false || f.completed === false || facilityStage(f) !== stage) return;
      var b = baseFacilityFactors(f, idx, power, workers, fid, regionalGoods, fiscalInputs);
      if (!regionalGoods[b.regionId]) return;
      var potentialLevel = nonInputProductionLimit(b);
      allocation[fid] = allocation[fid] || {};
      Object.keys(b.spec.inputs).forEach(function(gid){
        var demand = num(b.spec.inputs[gid]) * b.scale * potentialLevel;
        var key = b.regionId + '::' + gid;
        if (!groups[key]) groups[key] = { regionId:b.regionId, goodId:gid, entries:[], totalDemand:0 };
        groups[key].entries.push({
          facilityId: fid,
          demand: demand,
          priority: productionPriorityOf(f),
          weight: productionPriorityWeight(f)
        });
        groups[key].totalDemand += demand;
      });
    });

    Object.keys(groups).forEach(function(key){
      var group = groups[key];
      var rg = regionalGoods[group.regionId] && regionalGoods[group.regionId][group.goodId];
      var available = rg ? Math.max(0, num(rg.available)) : 0;
      var totalDemand = Math.max(0, group.totalDemand);
      if (totalDemand <= 0) return;

      if (available >= totalDemand) {
        group.entries.forEach(function(e){ allocation[e.facilityId][group.goodId] = 1; });
        return;
      }

      var guaranteedTotal = totalDemand * MINIMUM_INPUT_GUARANTEE;

      // Not enough even for the guarantee: equal proportional shortage for everybody.
      if (available <= guaranteedTotal + 1e-9) {
        var commonRatio = clamp(available / totalDemand, 0, MINIMUM_INPUT_GUARANTEE);
        group.entries.forEach(function(e){ allocation[e.facilityId][group.goodId] = commonRatio; });
        return;
      }

      // First reserve the same minimum fraction of each facility's own demand.
      var allocatedAmount = {};
      group.entries.forEach(function(e){
        allocatedAmount[e.facilityId] = e.demand * MINIMUM_INPUT_GUARANTEE;
      });
      var remainingSupply = available - guaranteedTotal;

      // Weighted water-filling. Recompute weights whenever a facility reaches 100% so
      // leftover material is redistributed instead of being stranded.
      var active = group.entries.slice();
      var guard = 0;
      while (remainingSupply > 1e-9 && active.length && guard++ < 20) {
        var weightSum = 0;
        active.forEach(function(e){
          var remainingNeed = Math.max(0, e.demand - allocatedAmount[e.facilityId]);
          weightSum += remainingNeed * e.weight;
        });
        if (weightSum <= 1e-12) break;

        var spent = 0;
        active.forEach(function(e){
          var remainingNeed = Math.max(0, e.demand - allocatedAmount[e.facilityId]);
          if (remainingNeed <= 0) return;
          var share = remainingSupply * (remainingNeed * e.weight / weightSum);
          var grant = Math.min(remainingNeed, share);
          allocatedAmount[e.facilityId] += grant;
          spent += grant;
        });
        if (spent <= 1e-12) break;
        remainingSupply -= spent;
        active = active.filter(function(e){
          return e.demand - allocatedAmount[e.facilityId] > 1e-9;
        });
      }

      group.entries.forEach(function(e){
        allocation[e.facilityId][group.goodId] = e.demand > 0
          ? clamp(allocatedAmount[e.facilityId] / e.demand, 0, 1)
          : 1;
      });
    });

    return allocation;
  }

  function produceRegionalStage(idx, regionalGoods, power, workers, stage, fiscalInputs) {
    // Calculate one region-wide proportional allocation BEFORE any facility consumes inputs.
    // This prevents array order from deciding which factory gets scarce material first.
    var stageAllocation = calculateStageInputAllocation(idx, regionalGoods, power, workers, stage, fiscalInputs);

    Object.keys(idx.facilities).forEach(function(fid){
      var f = idx.facilities[fid];
      if (f.active === false || f.completed === false || facilityStage(f) !== stage) return;
      var b = baseFacilityFactors(f, idx, power, workers, fid, regionalGoods, fiscalInputs);
      var rg = regionalGoods[b.regionId];
      if (!rg) return;

      var potentialLevel = nonInputProductionLimit(b);
      var inputFactors = {};
      var inputAllocationFactors = {};
      Object.keys(b.spec.inputs).forEach(function(gid){
        var regionalAllocation = stageAllocation[fid] && stageAllocation[fid][gid] != null
          ? stageAllocation[fid][gid]
          : 1;
        inputAllocationFactors[gid] = regionalAllocation;
        // Effective input limit = this facility's non-input potential × its proportional share
        // of the scarce regional input.
        inputFactors[gid] = clamp(potentialLevel * regionalAllocation, 0, 1);
      });
      var allFactors = {
        labor: b.laborFactor, power: b.powerFactor, demand: b.demandFactor, inventory: b.inventoryFactor,
        finance: b.financeFactor, localLogistics: b.localLogisticsFactor
      };
      if (b.spec.resource) allFactors.resource = b.resourceFactor;
      Object.keys(inputFactors).forEach(function(k){ allFactors['input:' + k] = inputFactors[k]; });
      var productionLevel = 1;
      Object.keys(allFactors).forEach(function(k){ productionLevel = Math.min(productionLevel, allFactors[k]); });
      productionLevel = clamp(productionLevel, 0, 1);

      var workersRequired = b.spec.workersRequired * b.scale;
      var workersAllocated = workersRequired * b.laborFactor;
      var workersUsed = workersRequired * productionLevel;
      if (workers[String(f.cityId)]) workers[String(f.cityId)].filled += workersAllocated;

      var consumed = {};
      Object.keys(b.spec.inputs).forEach(function(gid){
        var amount = num(b.spec.inputs[gid]) * b.scale * productionLevel;
        consumed[gid] = amount;
        if (rg[gid]) {
          rg[gid].available = Math.max(0, rg[gid].available - amount);
          rg[gid].industrialUse += amount;
        }
      });

      var produced = {};
      Object.keys(b.spec.output).forEach(function(gid){
        if (!rg[gid]) return;
        var amount = num(b.spec.output[gid]) * b.scale * productionLevel;
        produced[gid] = amount;
        rg[gid].production += amount;
        rg[gid].available += amount;
      });

      var limiting = Object.keys(allFactors).sort(function(a,b2){ return allFactors[a] - allFactors[b2]; })[0] || 'none';
      state.facilities[fid] = {
        facilityId: fid, type: f.type, cityId: f.cityId, regionId: b.regionId,
        productionLevel: productionLevel,
        workersRequired: workersRequired, workersAllocated: workersAllocated, workersEmployed: workersAllocated, workersUsed: workersUsed,
        inputDemand: copy(b.spec.inputs), inputsConsumed: consumed, inputAllocationFactors: inputAllocationFactors, output: produced,
        powerDemand: b.spec.powerDemand * b.scale, powerFactor: b.powerFactor,
        transportFactor: b.localLogisticsFactor, localLogisticsFactor: b.localLogisticsFactor, resourceFactor: b.resourceFactor,
        factors: allFactors, mainBottleneck: productionLevel < 0.995 ? limiting : null,
        wage: facilityOfferedWage(workers, f, fid), baseWage: b.spec.wage, ownership: normalizeOwner(f.ownership),
        openingWorkingCapital: b.openingWorkingCapital, subsidyReceived: b.subsidyReceived,
        workingCapitalAvailable: b.workingCapitalAvailable, workingCapitalRequired: b.workingCapitalRequired,
        financeFactor: b.financeFactor, inventoryFactor: b.inventoryFactor, demandFactor: b.demandFactor,
        productionPriority: productionPriorityOf(f),
        productionPriorityWeight: productionPriorityWeight(f),
        minimumInputGuarantee: MINIMUM_INPUT_GUARANTEE,
        operatingCostBase: b.spec.operatingCost * b.scale
      };
    });
  }

  function connectionEndpoints(c) {
    var a = c.from != null ? c.from : (c.fromId != null ? c.fromId : (c.a != null ? c.a : c.regionA));
    var b = c.to != null ? c.to : (c.toId != null ? c.toId : (c.b != null ? c.b : c.regionB));
    return [a != null ? String(a) : null, b != null ? String(b) : null];
  }

  function connectionFreightCapacity(c) {
    if (c.freightCapacity != null) return Math.max(0, num(c.freightCapacity));
    var raw = num(c.capacity, 100);
    var t = String(c.type || c.kind || '').toLowerCase();
    if (t.indexOf('rail') >= 0) return raw * 0.60;
    if (t.indexOf('port') >= 0 || t.indexOf('shipping') >= 0) return raw * 0.80;
    if (t.indexOf('highway') >= 0) return raw * 0.35;
    if (t.indexOf('road') >= 0) return raw * 0.20;
    return raw * 0.15;
  }

  function connectionDistance100km(c) {
    if (c.distanceKm != null) return Math.max(0.1, num(c.distanceKm) / 100);
    if (c.lengthKm != null) return Math.max(0.1, num(c.lengthKm) / 100);
    if (c.distance != null) return Math.max(0.1, num(c.distance) / 100);
    return 1;
  }

  function connectionFreightUnitCost(c) {
    if (c.freightUnitCost != null) return Math.max(0, num(c.freightUnitCost));
    var t = String(c.type || c.kind || '').toLowerCase();
    var key = 'other';
    if (t.indexOf('rail') >= 0) key = 'rail';
    else if (t.indexOf('shipping') >= 0) key = 'shipping';
    else if (t.indexOf('port') >= 0) key = 'port';
    else if (t.indexOf('highway') >= 0) key = 'highway';
    else if (t.indexOf('road') >= 0) key = 'road';
    return FREIGHT_COST_PER_100KM[key] * connectionDistance100km(c);
  }

  function buildFreightNetwork(idx) {
    var graph = {};
    var remaining = {};
    var edges = {};
    var blockedCrossBorderEdges = [];
    Object.keys(idx.regions).forEach(function(rid){ graph[rid] = []; });
    idx.connections.forEach(function(c, i){
      if (c.active === false || c.completed === false) return;
      var ep = connectionEndpoints(c), a = ep[0], b = ep[1];
      if (!a || !b || !graph[a] || !graph[b]) return; // region-to-region only in this layer
      var countryA = countryIdForRegion(idx, a);
      var countryB = countryIdForRegion(idx, b);
      // Module 3 domestic freight may only connect regions proven to be in the same country.
      // Cross-border physical links are intentionally left for Module 5 to authorize as trade.
      if (!countryA || !countryB || countryA !== countryB) {
        blockedCrossBorderEdges.push({ id:String(c.id || ('connection_' + i)), from:a, to:b, countryA:countryA, countryB:countryB });
        return;
      }
      var id = String(c.id || ('connection_' + i));
      var cap = connectionFreightCapacity(c);
      if (cap <= 0) return;
      var unitCost = connectionFreightUnitCost(c);
      remaining[id] = cap;
      edges[id] = { id:id, from:a, to:b, capacity:cap, unitCost:unitCost };
      graph[a].push({ to:b, id:id, capacity:cap, unitCost:unitCost });
      graph[b].push({ to:a, id:id, capacity:cap, unitCost:unitCost });
    });
    return { graph:graph, remaining:remaining, edges:edges, blockedCrossBorderEdges:blockedCrossBorderEdges };
  }

  function bestFreightRoute(network, from, to) {
    if (from === to) return { path:[], capacity:Infinity, unitCost:0 };
    var graph = network.graph;
    if (!graph[from] || !graph[to]) return null;
    var best = {}, prev = {}, open = [from];
    best[from] = Infinity;
    while (open.length) {
      open.sort(function(a,b){ return (best[b]||0) - (best[a]||0); });
      var cur = open.shift();
      if (cur === to) break;
      (graph[cur] || []).forEach(function(edge){
        var edgeRemain = num(network.remaining[edge.id], 0);
        if (edgeRemain <= 0) return;
        var candidate = Math.min(best[cur], edgeRemain);
        if (candidate > (best[edge.to] || 0)) {
          best[edge.to] = candidate;
          prev[edge.to] = { node:cur, edgeId:edge.id };
          if (open.indexOf(edge.to) < 0) open.push(edge.to);
        }
      });
    }
    if (!best[to]) return null;
    var path = [], cursor = to;
    while (cursor !== from) {
      var step = prev[cursor];
      if (!step) return null;
      path.unshift(step.edgeId);
      cursor = step.node;
    }
    var unitCost = path.reduce(function(total, edgeId){ return total + num(network.edges && network.edges[edgeId] && network.edges[edgeId].unitCost, 0); }, 0);
    return { path:path, capacity:best[to], unitCost:unitCost };
  }

  function pendingDemandForGood(g) {
    var unfilledIndustry = Math.max(0, g.industrialDemand - g.industrialUse);var unfilledIndustry = Math.max(0, g.industrialDemand - g.industrialUse);
    var unfilledProject = Math.max(0, g.projectDemand - g.projectUse);
    var unfilledFinal = Math.max(0, g.finalDemand - g.finalUse);
    return unfilledIndustry + unfilledProject + unfilledFinal;
  }

  function refreshRegionalBalance(regionalGoods, gids) {
    gids = gids || GOODS;
    Object.keys(regionalGoods).forEach(function(rid){
      gids.forEach(function(gid){
        var g = regionalGoods[rid][gid];
        var pending = pendingDemandForGood(g);
        var net = g.available - pending;
        g.surplus = Math.max(0, net);
        g.shortage = Math.max(0, -net);
        g.localDemand = g.industrialDemand + g.projectDemand + g.finalDemand;
        g.imports = g.domesticImports + g.foreignImports;
        g.exports = g.domesticExports + g.foreignExports;
      });
    });
  }

  function transferRegionalGood(regionalGoods, network, from, to, gid, requested) {
    var source = regionalGoods[from] && regionalGoods[from][gid];
    var dest = regionalGoods[to] && regionalGoods[to][gid];
    if (!source || !dest) return 0;
    var route = bestFreightRoute(network, from, to);
    if (!route) return 0;
    var amount = Math.min(requested, source.surplus, dest.shortage, route.capacity);
    if (amount <= 0) return 0;
    source.available -= amount;
    dest.available += amount;
    source.domesticExports += amount;
    dest.domesticImports += amount;
    var freightCost = amount * num(route.unitCost, 0);
    var commodityCost = amount * num(source.price, source.basePrice || 1);
    source.transportCostOut += freightCost;
    dest.transportCostIn += freightCost;
    dest.importCommodityCost += commodityCost;
    dest.averageImportTransportCost = dest.domesticImports > 0 ? dest.transportCostIn / dest.domesticImports : 0;
    dest.averageImportLandedCost = dest.domesticImports > 0 ? (dest.importCommodityCost + dest.transportCostIn) / dest.domesticImports : 0;
    route.path.forEach(function(edgeId){ network.remaining[edgeId] = Math.max(0, network.remaining[edgeId] - amount); });
    refreshRegionalBalance(regionalGoods, [gid]);
    return amount;
  }

  function distributeRegionalGoods(regionalGoods, network, gids) {
    gids.slice().sort(function(a,b){ return (GOODS_PRIORITY[b]||1) - (GOODS_PRIORITY[a]||1); }).forEach(function(gid){
      refreshRegionalBalance(regionalGoods, [gid]);
      var safety = 0;
      while (safety++ < 500) {
        var importers = Object.keys(regionalGoods).filter(function(rid){ return regionalGoods[rid][gid].shortage > 0.0001; })
          .sort(function(a,b){ return regionalGoods[b][gid].shortage - regionalGoods[a][gid].shortage; });
        if (!importers.length) break;
        var movedAny = false;
        for (var ii=0; ii<importers.length; ii++) {
          var to = importers[ii];
          var exporters = Object.keys(regionalGoods).filter(function(rid){ return rid !== to && regionalGoods[rid][gid].surplus > 0.0001; })
            .sort(function(a,b){ return regionalGoods[b][gid].surplus - regionalGoods[a][gid].surplus; });
          for (var ei=0; ei<exporters.length; ei++) {
            var from = exporters[ei];
            var moved = transferRegionalGood(regionalGoods, network, from, to, gid, regionalGoods[to][gid].shortage);
            if (moved > 0) { movedAny = true; break; }
          }
        }
        if (!movedAny) break;
      }
    });
  }

  function externalTariffRate(ext, countryId, gid, flow) {
    if (flow.tariffRate != null) return Math.max(0, num(flow.tariffRate));
    var table = ext.tariffRates || {};
    var byCountry = table[countryId];
    if (byCountry && typeof byCountry === 'object' && byCountry[gid] != null) return Math.max(0, num(byCountry[gid]));
    if (byCountry != null && typeof byCountry !== 'object') return Math.max(0, num(byCountry));
    if (table[gid] != null) return Math.max(0, num(table[gid]));
    return Math.max(0, num(ext.defaultTariffRate, 0));
  }

  // Module 8 integration hook: domestic production from another simulation module
  // (currently Module 9 Agriculture) enters the local regional market as domestic
  // production. It must never be routed through externalEconomy, because that would
  // incorrectly classify home-grown food as a foreign import and could assess tariffs.
  function applyExternalProductionHooks(gameState, regionalGoods) {
    var ext = gameState.externalProduction || {};
    var flows = list(ext.regionalFlows || ext.flows);
    flows.forEach(function(flow){
      var rid = String(flow.regionId || flow.region || '');
      var gid = String(flow.goodId || flow.good || '');
      var g = regionalGoods[rid] && regionalGoods[rid][gid];
      if (!g) return;
      var amount = Math.max(0, num(flow.amount != null ? flow.amount : flow.quantity));
      if (amount <= 0) return;
      g.production += amount;
      g.available += amount;
      g.externalDomesticProduction = (g.externalDomesticProduction || 0) + amount;
    });
  }

  function applyExternalTradeHooks(gameState, regionalGoods, idx) {
    var ext = gameState.externalEconomy || {};
    var flows = list(ext.regionalFlows || ext.flows);
    state.module5Signals.tariffAssessments = [];
    state.module5Signals.tradeValues = {};
    flows.forEach(function(flow){
      var rid = String(flow.regionId || flow.region || '');
      var gid = String(flow.goodId || flow.good || '');
      var g = regionalGoods[rid] && regionalGoods[rid][gid];
      if (!g) return;
      var amount = Math.max(0, num(flow.amount));
      var dir = String(flow.direction || flow.type || '').toLowerCase();
      var countryId = String(flow.countryId || flow.toCountryId || countryIdForRegion(idx, rid) || '');
      var unitPrice = Math.max(0, num(flow.unitPrice != null ? flow.unitPrice : flow.price, g.price));
      var declaredValue = flow.value != null ? Math.max(0, num(flow.value)) : amount * unitPrice;
      var freight = Math.max(0, num(flow.transportCost, amount * num(flow.freightUnitCost, 0)));
      if (dir === 'import' || dir === 'in') {
        g.foreignImports += amount;
        g.available += amount;
        g.foreignImportValue += declaredValue;
        g.transportCostIn += freight;
        g.importCommodityCost += declaredValue;
        var tariffRate = externalTariffRate(ext, countryId, gid, flow);
        var tariff = declaredValue * tariffRate;
        g.tariffPaid += tariff;
        var totalImports = g.domesticImports + g.foreignImports;
        g.averageImportTransportCost = totalImports > 0 ? g.transportCostIn / totalImports : 0;
        g.averageImportLandedCost = totalImports > 0 ? (g.importCommodityCost + g.transportCostIn + g.tariffPaid) / totalImports : 0;
        state.module5Signals.tariffAssessments.push({ regionId:rid, countryId:countryId, goodId:gid, importValue:declaredValue, tariffRate:tariffRate, tariff:tariff });
        state.module5Signals.tradeValues[countryId] = state.module5Signals.tradeValues[countryId] || { imports:0, exports:0, tariffs:0 };
        state.module5Signals.tradeValues[countryId].imports += declaredValue;
        state.module5Signals.tradeValues[countryId].tariffs += tariff;
      } else if (dir === 'export' || dir === 'out') {
        var sent = Math.min(amount, g.available);
        var value = amount > 0 ? declaredValue * (sent / amount) : 0;
        g.foreignExports += sent;
        g.foreignExportValue += value;
        g.available -= sent;
        state.module5Signals.tradeValues[countryId] = state.module5Signals.tradeValues[countryId] || { imports:0, exports:0, tariffs:0 };
        state.module5Signals.tradeValues[countryId].exports += value;
      }
    });
  }

  function consumeRegionalFinalDemand(regionalGoods) {
    Object.keys(regionalGoods).forEach(function(rid){
      GOODS.forEach(function(gid){
        var g = regionalGoods[rid][gid];
        var used = Math.min(g.available, g.finalDemand);
        g.finalUse = used;
        g.available -= used;
      });
    });
    refreshRegionalBalance(regionalGoods);
  }

  function computeRegionalSalesMetrics(regionalGoods) {
    Object.keys(regionalGoods).forEach(function(rid){
      GOODS.forEach(function(gid){
        var g = regionalGoods[rid][gid];
        g.marketSupply = Math.max(0, g.production + g.startStockpile + g.domesticImports + g.foreignImports);
        g.marketUse = Math.max(0, g.industrialUse + g.projectUse + g.finalUse + g.domesticExports + g.foreignExports);
        g.sellThroughRate = g.marketSupply > 0 ? clamp(g.marketUse / g.marketSupply, 0, 1) : (g.localDemand > 0 ? 0 : 1);
        g.productionSold = g.production * g.sellThroughRate;
        g.unsoldProduction = Math.max(0, g.production - g.productionSold);
      });
    });
  }

  function updateRegionalPrices(regionalGoods) {
    Object.keys(regionalGoods).forEach(function(rid){
      GOODS.forEach(function(gid){
        var g = regionalGoods[rid][gid], cfg = GOOD_CONFIG[gid];
        var supply = g.production + g.startStockpile + g.domesticImports + g.foreignImports;
        var demand = g.localDemand + g.domesticExports + g.foreignExports;
        var ratio = demand > 0 ? supply / demand : (supply > 0 ? 1.4 : 1);
        var scarcityTarget = cfg.basePrice * clamp(1 + 0.45 * (1 - ratio), 0.65, 1.65);
        var imported = g.domesticImports + g.foreignImports;
        var importShare = supply > 0 ? clamp(imported / supply, 0, 1) : 0;
        var landed = num(g.averageImportLandedCost, 0);
        if (!(landed > 0) && imported > 0) landed = cfg.basePrice + num(g.averageImportTransportCost, 0);
        var target = importShare > 0 ? scarcityTarget * (1 - importShare) + Math.max(scarcityTarget, landed) * importShare : scarcityTarget;
        var oldPrice = clamp(num(g.price, cfg.basePrice), cfg.minPrice, cfg.maxPrice);
        var smoothed = oldPrice * 0.70 + target * 0.30;
        var annualLow = oldPrice * (1 - MAX_PRICE_FALL_PER_TURN);
        var annualHigh = oldPrice * (1 + MAX_PRICE_RISE_PER_TURN);
        g.price = clamp(smoothed, Math.max(cfg.minPrice, annualLow), Math.min(cfg.maxPrice, annualHigh));
      });
    });
  }

  function storageCapacityForRegion(idx, rid, gid) {
    var region = idx.regions[rid] || {};
    var explicit = region.storageCapacity || region.storageCapacities || (region.storage && region.storage.capacity);
    var base = explicit && explicit[gid] != null ? Math.max(0, num(explicit[gid])) : num(DEFAULT_STORAGE_CAPACITY[gid], Infinity);

    Object.keys(idx.facilities).forEach(function(fid){
      var f = idx.facilities[fid];
      if (f.active === false || f.completed === false) return;
      var city = idx.cities[f.cityId] || {};
      if (String(f.regionId || city.regionId || '') !== String(rid)) return;
      var cap = f.storageCapacity || (f.economy && f.economy.storageCapacity);
      if (cap && cap[gid] != null) base += Math.max(0, num(cap[gid]));
      else if (String(f.type || '').toLowerCase() === 'warehouse') base += 100;
      else if (String(f.type || '').toLowerCase() === 'grain_silo' && gid === 'food') base += 150;
    });
    return base;
  }

  function finalizeRegionalStorage(idx, regionalGoods) {
    Object.keys(regionalGoods).forEach(function(rid){
      GOODS.forEach(function(gid){
        var g = regionalGoods[rid][gid];
        var afterRetention = Math.max(0, g.available * (STORAGE_RETENTION[gid] || 1));
        var capacity = storageCapacityForRegion(idx, rid, gid);
        g.storageCapacity = capacity;
        g.storageOverflow = Math.max(0, afterRetention - capacity);
        g.endingInventory = Math.min(afterRetention, capacity);
        g.stockpile = g.endingInventory;
        g.available = g.endingInventory;
      });
    });
  }

  function aggregateGoodsForRegions(regionalGoods, regionIds, previousGoods) {
    var previousWrapper = previousGoods ? { goods: previousGoods } : null;
    var out = initialGoods(previousWrapper);
    GOODS.forEach(function(gid){
      var weightedPrice = 0, priceWeight = 0;
      regionIds.forEach(function(rid){
        var g = regionalGoods[rid] && regionalGoods[rid][gid];
        if (!g) return;
        out[gid].supply += g.production + g.foreignImports;
        out[gid].demand += g.localDemand + g.foreignExports;
        out[gid].available += g.stockpile;
        out[gid].usedByIndustry += g.industrialUse;
        out[gid].unmetDemand += g.shortage;
        var w = Math.max(1, g.industrialUse + g.projectUse + g.finalUse);
        weightedPrice += g.price * w;
        priceWeight += w;
      });
      out[gid].price = priceWeight > 0 ? weightedPrice / priceWeight : GOOD_CONFIG[gid].basePrice;
      out[gid].surplus = Math.max(0, out[gid].supply - out[gid].demand);
    });
    return out;
  }

  function aggregateNationalGoods(regionalGoods, previous) {
    return aggregateGoodsForRegions(regionalGoods, Object.keys(regionalGoods), previous && previous.goods);
  }

  function attachCountryGoods(idx, regionalGoods) {
    Object.keys(idx.countries).forEach(function(cid){
      var regionIds = Object.keys(idx.regions).filter(function(rid){ return countryIdForRegion(idx, rid) === String(cid); });
      var prevGoods = state.previous && state.previous.countries && state.previous.countries[cid] && state.previous.countries[cid].goods;
      if (!state.countries[cid]) state.countries[cid] = { countryId:cid };
      state.countries[cid].goods = aggregateGoodsForRegions(regionalGoods, regionIds, prevGoods || null);
    });
  }

  function attachRegionGoods(idx, regionalGoods) {
    Object.keys(idx.regions).forEach(function(rid){
      if (!state.regions[rid]) state.regions[rid] = { regionId:rid };
      state.regions[rid].goods = copy(regionalGoods[rid]);
    });
  }

  function updatePrices(goods, finalDemand) {
    GOODS.forEach(function(gid){
      var g = goods[gid];
      g.demand += num(finalDemand[gid]);
      var ratio = g.demand > 0 ? g.supply / g.demand : (g.supply > 0 ? 1.4 : 1);
      // Smooth bounded response. Ratio 1 => base; shortage => up; surplus => down.
      var cfg = GOOD_CONFIG[gid];
      var target = cfg.basePrice * clamp(1 + 0.45 * (1 - ratio), 0.65, 1.65);
      g.price = clamp(g.price * 0.60 + target * 0.40, cfg.minPrice, cfg.maxPrice);
      g.unmetDemand = Math.max(0, g.demand - g.supply);
      g.surplus = Math.max(0, g.supply - g.demand);
    });
  }

  function regionIdForCity(idx, cityId) {
    var c = idx.cities[cityId] || {};
    return c.regionId != null ? String(c.regionId) : '';
  }

  function countryIdForRegion(idx, regionId) {
    var r = idx.regions[regionId] || {};
    if (r.countryId != null) return String(r.countryId);
    if (r.ownerCountryId != null) return String(r.ownerCountryId);
    var inferred = {};
    Object.keys(idx.cities).forEach(function(cid){
      var c = idx.cities[cid] || {};
      if (String(c.regionId || '') !== String(regionId)) return;
      if (c.countryId != null) inferred[String(c.countryId)] = true;
    });
    var inferredIds = Object.keys(inferred);
    if (inferredIds.length === 1) return inferredIds[0];
    var ids = Object.keys(idx.countries);
    return ids.length === 1 ? ids[0] : '';
  }

  function countryIdForCity(idx, cityId) {
    var c = idx.cities[cityId] || {};
    if (c.countryId != null) return String(c.countryId);
    return countryIdForRegion(idx, regionIdForCity(idx, cityId));
  }

  function countryIdForFacility(idx, facilityId) {
    var f = idx.facilities[facilityId] || {};
    if (f.countryId != null) return String(f.countryId);
    if (f.ownerCountryId != null) return String(f.ownerCountryId);
    if (f.cityId != null) {
      var fromCity = countryIdForCity(idx, String(f.cityId));
      if (fromCity) return fromCity;
    }
    var rid = f.regionId != null ? String(f.regionId) : '';
    return countryIdForRegion(idx, rid);
  }

  function regionalPrice(regionId, goodId) {
    var r = state.regions[regionId];
    if (r && r.goods && r.goods[goodId]) return num(r.goods[goodId].price, GOOD_CONFIG[goodId].basePrice);
    return state.goods[goodId] ? num(state.goods[goodId].price, GOOD_CONFIG[goodId].basePrice) : GOOD_CONFIG[goodId].basePrice;
  }

  function calcFacilityMoney(idx, taxPolicy) {
    Object.keys(state.facilities).forEach(function(fid){
      var e = state.facilities[fid];
      var f = idx.facilities[fid] || {};
      var revenue = 0;
      e.outputSold = {};
      e.unsoldOutput = {};
      Object.keys(e.output).forEach(function(gid){
        var rg = state.regions[e.regionId] && state.regions[e.regionId].goods && state.regions[e.regionId].goods[gid];
        var sellThrough = rg && rg.sellThroughRate != null ? clamp(num(rg.sellThroughRate), 0, 1) : 1;
        var sold = num(e.output[gid]) * sellThrough;
        e.outputSold[gid] = sold;
        e.unsoldOutput[gid] = Math.max(0, num(e.output[gid]) - sold);
        revenue += sold * regionalPrice(e.regionId, gid);
      });
      var inputCost = 0;
      Object.keys(e.inputsConsumed).forEach(function(gid){ inputCost += e.inputsConsumed[gid] * regionalPrice(e.regionId, gid); });
      var wageBill = e.workersEmployed * e.wage / 10000; // normalized monetary scale
      var productionOperatingCost = e.operatingCostBase * e.productionLevel;
      var operatingCost = productionOperatingCost + inputCost + wageBill;
      var profitBeforeTax = revenue - operatingCost;
      var owner = e.ownership;
      var taxableProfit = Math.max(0, profitBeforeTax);
      e.countryId = countryIdForFacility(idx, fid);
      e.revenue = revenue; e.inputCost = inputCost; e.wageBill = wageBill;
      e.productionOperatingCost = productionOperatingCost;
      e.operatingCost = operatingCost; e.profit = profitBeforeTax; e.taxableProfit = taxableProfit;
      e.businessTax = taxableProfit * taxPolicy.business;
      e.resourceRoyaltyBase = (f.type === 'coal_mine' || f.type === 'iron_mine') ? revenue : 0;
      e.resourceRoyalty = e.resourceRoyaltyBase * num((f.economy || {}).royaltyRate, 0.06);
      var afterTaxAndRoyaltyProfit = Math.max(0, profitBeforeTax - e.businessTax - e.resourceRoyalty);
      e.stateEnterpriseProfit = afterTaxAndRoyaltyProfit * owner.stateShare;
      e.foreignProfitOutflow = afterTaxAndRoyaltyProfit * owner.foreignShare;
      e.domesticRetainedProfit = afterTaxAndRoyaltyProfit * owner.domesticPrivateShare;

      // Working capital carries across annual turns. Positive domestic retained profit
      // stays available to the firm; losses erode the capital base. State/foreign
      // distributions leave the firm and are accounted for elsewhere.
      var opening = Math.max(0, num(e.openingWorkingCapital, 0));
      var subsidy = Math.max(0, num(e.subsidyReceived, 0));
      var loss = Math.min(0, profitBeforeTax);
      e.endingWorkingCapital = Math.max(0, opening + subsidy + loss + e.domesticRetainedProfit);
      e.workingCapitalChange = e.endingWorkingCapital - opening;
      e.cashShortfall = Math.max(0, num(e.workingCapitalRequired, 0) - num(e.workingCapitalAvailable, 0));
    });
  }

  function aggregateCities(idx, workers, taxPolicy) {
    Object.keys(idx.cities).forEach(function(cid){
      var c = idx.cities[cid], pool = workers[cid] || { total:0, requested:0, filled:0 };
      var jobs = 0, filled = 0, wages = 0, industrialOutput = 0;
      Object.keys(state.facilities).forEach(function(fid){
        var f = state.facilities[fid]; if (String(f.cityId) !== String(cid)) return;
        jobs += f.workersRequired; filled += f.workersEmployed; wages += f.wageBill;
        industrialOutput += sumValues(f.output);
      });
      var avgIncomeGross = filled > 0 ? wages * 10000 / filled : num(c.baseIncome, 28);
      var population = Math.max(0, num(c.population, 0));
      var baselineIncomePerCapita = Math.max(0, num(c.baseIncome, 28));
      var baselineHouseholdIncome = population > 0 ? baselineIncomePerCapita * population / 10000 : 0;
      var grossHouseholdIncome = Math.max(wages, baselineHouseholdIncome);
      var avgIncome = avgIncomeGross * (1 - taxPolicy.household) * taxPolicy.disposableIncomeFactor;
      var regionId = regionIdForCity(idx, cid);
      var regionFood = state.regions[regionId] && state.regions[regionId].goods ? state.regions[regionId].goods.food : null;
      var foodPrice = regionFood ? regionFood.price : state.goods.food.price;
      var prev = state.previous && state.previous.cities && state.previous.cities[cid];
      var prevOut = prev ? prev.industrialOutput : industrialOutput;
      var growth = prevOut > 0 ? clamp((industrialOutput - prevOut) / prevOut, -0.5, 0.5) : 0;
      var localFacilities = Object.keys(state.facilities).map(function(k){return state.facilities[k];}).filter(function(x){return String(x.cityId)===String(cid);});
      var bottleneck = localFacilities.filter(function(x){return x.mainBottleneck;}).sort(function(a,b){return a.productionLevel-b.productionLevel;})[0];
      state.cities[cid] = {
        cityId: cid, regionId: regionId, countryId: countryIdForCity(idx, cid), jobsAvailable: jobs, jobsFilled: filled,
        availableWorkers: pool.total, unemployedWorkers: Math.max(0, pool.total - filled),
        employmentRate: pool.total > 0 ? clamp(filled / pool.total, 0, 1) : 0,
        averageIncome: avgIncome, averageGrossIncome: avgIncomeGross,
        totalHouseholdIncome: grossHouseholdIncome, grossHouseholdIncome: grossHouseholdIncome, industrialOutput: industrialOutput,
        foodAvailability: regionFood && regionFood.finalDemand > 0 ? clamp(regionFood.finalUse / regionFood.finalDemand, 0, 1.5) : 1,
        foodPrice: foodPrice, economicGrowth: growth, growthRate: growth,
        taxBurden: taxPolicy.household,
        majorBottleneck: bottleneck ? bottleneck.mainBottleneck.replace('input:','') : null
      };
    });
  }

  function aggregateRegions(idx) {
    Object.keys(idx.regions).forEach(function(rid){
      var cities = Object.keys(state.cities).map(function(k){return state.cities[k];}).filter(function(c){ return String((idx.cities[c.cityId]||{}).regionId) === String(rid); });
      var existingGoods = state.regions[rid] && state.regions[rid].goods ? state.regions[rid].goods : null;
      state.regions[rid] = {
        regionId: rid,
        jobsAvailable: cities.reduce(function(s,c){return s+c.jobsAvailable;},0),
        jobsFilled: cities.reduce(function(s,c){return s+c.jobsFilled;},0),
        householdIncome: cities.reduce(function(s,c){return s+c.totalHouseholdIncome;},0),
        industrialOutput: cities.reduce(function(s,c){return s+c.industrialOutput;},0),
        averageIncome: cities.reduce(function(s,c){ return s + c.averageIncome * Math.max(0, num((idx.cities[c.cityId] || {}).population, 0)); },0) /
          Math.max(1, cities.reduce(function(s,c){ return s + Math.max(0, num((idx.cities[c.cityId] || {}).population, 0)); },0)),
        foodPrice: existingGoods && existingGoods.food ? existingGoods.food.price : state.goods.food.price,
        goods: existingGoods
      };
    });
  }

  function projectRegionId(idx, p) {
    if (p.regionId != null) return String(p.regionId);
    if (p.cityId != null) return regionIdForCity(idx, String(p.cityId));
    return '';
  }

  function projectMaterialRequirementsPerTurn(p) {
    var explicit = p.materialRequirements || p.materialDemand || p.resourceRequirements || {};
    var type = String(p.type || p.projectType || 'default').toLowerCase();
    var defaults = PROJECT_MATERIAL_DEFAULTS[type] || PROJECT_MATERIAL_DEFAULTS.default;
    var total = {
      steel: explicit.steel != null ? Math.max(0, num(explicit.steel)) : num(defaults.steel, 0),
      manufactured_goods: explicit.manufactured_goods != null ? Math.max(0, num(explicit.manufactured_goods)) :
        (explicit.manufacturedGoods != null ? Math.max(0, num(explicit.manufacturedGoods)) : num(defaults.manufactured_goods, 0))
    };
    var duration = Math.max(1, num(p.totalTurns != null ? p.totalTurns : (p.durationTurns != null ? p.durationTurns : p.duration), 1));
    return {
      steel: total.steel / duration,
      manufactured_goods: total.manufactured_goods / duration
    };
  }

  function addProjectMaterialDemand(idx, regionalGoods, gids) {
    var set = {};
    (gids || ['steel','manufactured_goods']).forEach(function(g){ set[g] = true; });
    idx.projects.forEach(function(p, i){
      if (p.status === 'cancelled' || p.completed === true || p.status === 'completed') return;
      var rid = projectRegionId(idx, p);
      if (!rid || !regionalGoods[rid]) return;
      var req = projectMaterialRequirementsPerTurn(p);
      var pid = idOf(p, 'project', i);
      if (!state.projects[pid]) {
        state.projects[pid] = {
          projectId: pid, regionId: rid,
          countryId: p.countryId != null ? String(p.countryId) : countryIdForRegion(idx, rid),
          materialDemandPerTurn: copy(req), materialUse: {}, materialFulfillmentByGood: {},
          materialFulfillment: 1, recommendedProgressFactor: 1, delayedByMaterials: false
        };
      }
      Object.keys(req).forEach(function(gid){
        if (set[gid] && regionalGoods[rid][gid]) regionalGoods[rid][gid].projectDemand += req[gid];
      });
    });
  }

  function consumeRegionalProjectDemand(idx, regionalGoods, gids) {
    var set = {};
    (gids || GOODS).forEach(function(g){ set[g] = true; });
    var groups = {};
    idx.projects.forEach(function(p, i){
      if (p.status === 'cancelled' || p.completed === true || p.status === 'completed') return;
      var pid = idOf(p, 'project', i);
      var pe = state.projects[pid];
      if (!pe) return;
      Object.keys(pe.materialDemandPerTurn || {}).forEach(function(gid){
        if (!set[gid]) return;
        var demand = Math.max(0, num(pe.materialDemandPerTurn[gid]));
        if (demand <= 0) return;
        var key = pe.regionId + '::' + gid;
        if (!groups[key]) groups[key] = { regionId:pe.regionId, goodId:gid, entries:[], totalDemand:0 };
        groups[key].entries.push({ projectId:pid, demand:demand });
        groups[key].totalDemand += demand;
      });
    });

    Object.keys(groups).forEach(function(key){
      var group = groups[key];
      var g = regionalGoods[group.regionId] && regionalGoods[group.regionId][group.goodId];
      if (!g || group.totalDemand <= 0) return;
      var totalUsed = Math.min(Math.max(0, g.available), group.totalDemand);
      var ratio = clamp(totalUsed / group.totalDemand, 0, 1);
      group.entries.forEach(function(e){
        var used = e.demand * ratio;
        var pe = state.projects[e.projectId];
        pe.materialUse[group.goodId] = num(pe.materialUse[group.goodId], 0) + used;
      });
      g.projectUse += totalUsed;
      g.available -= totalUsed;
    });
    refreshRegionalBalance(regionalGoods, gids);
  }

  function finalizeProjectMaterialSignals(idx) {
    state.module2Signals.projectProgress = {};
    Object.keys(state.projects).forEach(function(pid){
      var pe = state.projects[pid];
      var requirements = pe.materialDemandPerTurn || {};
      var fulfillment = 1;
      var hasRequirement = false;
      var missing = {};
      Object.keys(requirements).forEach(function(gid){
        var req = Math.max(0, num(requirements[gid]));
        if (req <= 0) return;
        hasRequirement = true;
        var used = Math.max(0, num(pe.materialUse[gid], 0));
        var rate = clamp(used / req, 0, 1);
        pe.materialFulfillmentByGood[gid] = rate;
        missing[gid] = Math.max(0, req - used);
        fulfillment = Math.min(fulfillment, rate);
      });
      if (!hasRequirement) fulfillment = 1;
      pe.materialFulfillment = fulfillment;
      pe.recommendedProgressFactor = fulfillment;
      pe.delayedByMaterials = fulfillment < 0.999;
      pe.missingMaterials = missing;
      state.module2Signals.projectProgress[pid] = {
        projectId: pid, regionId: pe.regionId, countryId: pe.countryId,
        materialFulfillment: fulfillment, recommendedProgressFactor: fulfillment,
        delayedByMaterials: pe.delayedByMaterials, missingMaterials: copy(missing)
      };
    });
  }

  function projectPlannedSpendPerTurn(p) {
    var cost = p.governmentCost != null ? num(p.governmentCost, 0) : num(p.totalCost != null ? p.totalCost : p.cost, 0);
    var duration = Math.max(1, num(p.totalTurns != null ? p.totalTurns : (p.durationTurns != null ? p.durationTurns : p.duration), 1));
    return Math.max(0, cost / duration);
  }

  function projectSpend(idx, countryId) {
    var total = 0;
    idx.projects.forEach(function(p){
      var projectCountry = p.countryId != null ? String(p.countryId) : '';
      if (!projectCountry && p.cityId != null) projectCountry = countryIdForCity(idx, String(p.cityId));
      if (!projectCountry && p.regionId != null) projectCountry = countryIdForRegion(idx, String(p.regionId));
      if (!projectCountry && Object.keys(idx.countries).length === 1) projectCountry = Object.keys(idx.countries)[0];
      if (projectCountry !== String(countryId)) return;
      if (p.status === 'cancelled' || p.completed === true || p.status === 'completed') return;
      total += projectPlannedSpendPerTurn(p);
    });
    return total;
  }

  function buildFiscalInputs(idx, gs) {
    var result = { facilitySubsidies:{} };
    Object.keys(idx.facilities).forEach(function(fid){
      var f = idx.facilities[fid] || {};
      var countryId = countryIdForFacility(idx, fid);
      var spendingCfg = (gs.governmentSpending && (gs.governmentSpending[countryId] || gs.governmentSpending)) || {};
      var byFacility = spendingCfg.subsidiesByFacility || (typeof spendingCfg.subsidies === 'object' ? spendingCfg.subsidies : null) || {};
      var subsidy = byFacility[fid] != null ? Math.max(0, num(byFacility[fid])) :
        Math.max(0, num(f.operatingSubsidy != null ? f.operatingSubsidy : ((f.economy || {}).subsidy), 0));
      if (subsidy > 0) result.facilitySubsidies[fid] = subsidy;
    });
    return result;
  }

  function countryPopulation(idx, countryId) {
    var total = 0;
    Object.keys(idx.cities).forEach(function(cid){
      if (countryIdForCity(idx, cid) === String(countryId)) total += Math.max(0, num(idx.cities[cid].population, 0));
    });
    return total;
  }

  function countryConsumptionTaxBase(idx, countryId) {
    var total = 0;
    Object.keys(state.regions).forEach(function(rid){
      if (countryIdForRegion(idx, rid) !== String(countryId)) return;
      var goods = state.regions[rid].goods || {};
      GOODS.forEach(function(gid){
        var g = goods[gid];
        if (!g) return;
        total += Math.max(0, num(g.finalUse)) * Math.max(0, num(g.price, GOOD_CONFIG[gid].basePrice));
      });
    });
    return total;
  }

  function countryTariffRevenue(idx, countryId) {
    var total = 0, importValue = 0;
    Object.keys(state.regions).forEach(function(rid){
      if (countryIdForRegion(idx, rid) !== String(countryId)) return;
      var goods = state.regions[rid].goods || {};
      GOODS.forEach(function(gid){
        var g = goods[gid];
        if (!g) return;
        total += Math.max(0, num(g.tariffPaid));
        importValue += Math.max(0, num(g.foreignImportValue));
      });
    });
    return { tariff:total, importValue:importValue };
  }

  function applyProjectFinanceSignals(idx, countryId, fundingRatio) {
    idx.projects.forEach(function(p, i){
      if (p.status === 'cancelled' || p.completed === true || p.status === 'completed') return;
      var pid = idOf(p, 'project', i);
      var pe = state.projects[pid];
      if (!pe || String(pe.countryId || '') !== String(countryId)) return;
      var material = clamp(num(pe.materialFulfillment, 1), 0, 1);
      pe.financialFulfillment = fundingRatio;
      pe.recommendedProgressFactor = Math.min(material, fundingRatio);
      pe.delayedByFinance = fundingRatio < 0.999;
      pe.delayedByMaterials = material < 0.999;
      state.module2Signals.projectProgress[pid] = Object.assign({}, state.module2Signals.projectProgress[pid] || {}, {
        projectId:pid, regionId:pe.regionId, countryId:pe.countryId, materialFulfillment:material,
        financialFulfillment:fundingRatio, recommendedProgressFactor:pe.recommendedProgressFactor,
        delayedByFinance:pe.delayedByFinance, delayedByMaterials:pe.delayedByMaterials, missingMaterials:copy(pe.missingMaterials || {})
      });
    });
  }

  function calcGovernment(idx, gs, taxPolicy) {
    state.fiscalAudit = {};
    Object.keys(idx.countries).forEach(function(countryId){
      var prev = state.previous && state.previous.countries && state.previous.countries[countryId] && state.previous.countries[countryId].governmentFinance;
      var cfg = (gs.governmentFinance && (gs.governmentFinance[countryId] || gs.governmentFinance)) || {};
      var treasury = prev ? num(prev.treasury) : num(cfg.treasury, 30);
      var debt = prev ? num(prev.debt) : num(cfg.debt, 0);
      var householdIncome = 0, businessTax = 0, businessProfitTaxBase = 0, resourceRevenue = 0, resourceRoyaltyBase = 0, stateProfit = 0;
      Object.keys(state.cities).forEach(function(cid){
        var c = state.cities[cid];
        if (String(c.countryId || '') !== String(countryId)) return;
        householdIncome += Math.max(0, num(c.grossHouseholdIncome != null ? c.grossHouseholdIncome : c.totalHouseholdIncome));
      });
      Object.keys(state.facilities).forEach(function(fid){
        var fe = state.facilities[fid];
        if (String(fe.countryId || '') !== String(countryId)) return;
        businessTax += Math.max(0, num(fe.businessTax));
        businessProfitTaxBase += Math.max(0, num(fe.taxableProfit));
        resourceRevenue += Math.max(0, num(fe.resourceRoyalty));
        resourceRoyaltyBase += Math.max(0, num(fe.resourceRoyaltyBase));
        stateProfit += Math.max(0, num(fe.stateEnterpriseProfit));
      });
      var tariffInfo = countryTariffRevenue(idx, countryId);
      var spendingCfg = (gs.governmentSpending && (gs.governmentSpending[countryId] || gs.governmentSpending)) || {};
      var taxCfg = (gs.taxRates && (gs.taxRates[countryId] || gs.taxRates)) || {};
      var consumptionTaxRate = Math.max(0, num(taxCfg.consumption != null ? taxCfg.consumption : gs.consumptionTaxRate, 0));
      var consumptionTaxBase = countryConsumptionTaxBase(idx, countryId);
      var revenue = {
        householdTax: householdIncome * taxPolicy.household,
        businessTax: businessTax,
        resourceRevenue: resourceRevenue,
        tariffs: tariffInfo.tariff,
        consumptionTax: consumptionTaxBase * consumptionTaxRate,
        stateEnterpriseProfit: stateProfit
      };
      revenue.total = sumValues(revenue);

      var interestRate = clamp(0.025 + (debt > 50 ? (debt - 50) * 0.0007 : 0), 0.025, 0.14);
      var debtInterest = debt * interestRate;
      var plannedProjectSpending = projectSpend(idx, countryId);
      var projectBudget = spendingCfg.projectSpendingBudget != null ? Math.max(0, num(spendingCfg.projectSpendingBudget)) :
        (spendingCfg.projectsBudget != null ? Math.max(0, num(spendingCfg.projectsBudget)) : plannedProjectSpending);
      var actualProjectSpending = Math.min(plannedProjectSpending, projectBudget);
      var projectFundingRatio = plannedProjectSpending > 0 ? clamp(actualProjectSpending / plannedProjectSpending, 0, 1) : 1;

      var subsidyExpenditure = 0;
      Object.keys(state.fiscalInputs.facilitySubsidies || {}).forEach(function(fid){
        if (countryIdForFacility(idx, fid) === String(countryId)) subsidyExpenditure += Math.max(0, num(state.fiscalInputs.facilitySubsidies[fid]));
      });

      var maintenanceSpending = Math.max(0, num(spendingCfg.infrastructureMaintenance != null ? spendingCfg.infrastructureMaintenance : spendingCfg.maintenance, 4));
      var maintenanceRequired = Math.max(0, num(spendingCfg.requiredInfrastructureMaintenance != null ? spendingCfg.requiredInfrastructureMaintenance :
        (spendingCfg.maintenanceRequired != null ? spendingCfg.maintenanceRequired : maintenanceSpending), maintenanceSpending));
      var maintenanceFundingRatio = maintenanceRequired > 0 ? clamp(maintenanceSpending / maintenanceRequired, 0, 1) : 1;

      var spending = {
        projectSpending: actualProjectSpending,
        education: Math.max(0, num(spendingCfg.education, 6)),
        socialSpending: Math.max(0, num(spendingCfg.socialSpending != null ? spendingCfg.socialSpending : spendingCfg.social, 7)),
        administration: Math.max(0, num(spendingCfg.administration, 4)),
        infrastructureMaintenance: maintenanceSpending,
        subsidies: subsidyExpenditure,
        debtInterest: debtInterest
      };
      spending.total = sumValues(spending);
      var balance = revenue.total - spending.total;
      treasury += balance;
      var borrowed = 0;
      if (treasury < 0) { borrowed = -treasury; debt += borrowed; treasury = 0; }
      var maxAutoRepay = Math.min(debt, Math.max(0, treasury - 20) * 0.35);
      if (maxAutoRepay > 0) { debt -= maxAutoRepay; treasury -= maxAutoRepay; }

      var taxBases = {
        householdIncome:householdIncome, businessProfit:businessProfitTaxBase, resourceSales:resourceRoyaltyBase,
        importValue:tariffInfo.importValue, householdConsumption:consumptionTaxBase
      };
      var finance = { treasury: treasury, debt: debt, interestRate: interestRate, debtInterest: debtInterest,
        revenue: revenue, taxBases:taxBases, taxRates:{ household:taxPolicy.household, business:taxPolicy.business, consumption:consumptionTaxRate },
        expenditure: spending, plannedProjectSpending:plannedProjectSpending, projectFundingRatio:projectFundingRatio,
        maintenanceRequired:maintenanceRequired, maintenanceFundingRatio:maintenanceFundingRatio,
        budgetBalance: balance, borrowedThisTurn: borrowed, repaidThisTurn: maxAutoRepay };
      state.countries[countryId] = Object.assign({}, state.countries[countryId] || {}, { countryId: countryId, governmentFinance: finance });

      applyProjectFinanceSignals(idx, countryId, projectFundingRatio);
      state.module2Signals.maintenance[countryId] = { countryId:countryId, spending:maintenanceSpending, required:maintenanceRequired, fundingRatio:maintenanceFundingRatio };
      var population = countryPopulation(idx, countryId);
      state.module4Signals.countries[countryId] = {
        countryId:countryId, population:population, socialSpending:spending.socialSpending, educationSpending:spending.education,
        socialSpendingPer100k: population > 0 ? spending.socialSpending / (population / 100000) : 0,
        educationSpendingPer100k: population > 0 ? spending.education / (population / 100000) : 0,
        householdTaxRate:taxPolicy.household
      };
      state.fiscalAudit[countryId] = { taxBases:copy(taxBases), revenue:copy(revenue), expenditure:copy(spending),
        projectFundingRatio:projectFundingRatio, maintenanceFundingRatio:maintenanceFundingRatio };
    });
  }

  function bottlenecks() {
    var arr = [];
    Object.keys(state.facilities).forEach(function(fid){
      var f = state.facilities[fid];
      if (f.productionLevel >= 0.995 || !f.mainBottleneck) return;
      var label = f.mainBottleneck.replace('input:','');
      arr.push({ facilityId: fid, cityId: f.cityId, type: label, severity: 1-f.productionLevel,
        productionLevel: f.productionLevel, explanation: 'Production limited by ' + label + ' (' + Math.round((f.factors[f.mainBottleneck] || 0)*100) + '% factor).' });
    });
    return arr.sort(function(a,b){return b.severity-a.severity;});
  }

  function buildDebug() {
    state.debug.facility = copy(state.facilities);
    state.debug.city = copy(state.cities);
    state.debug.government = {};
    Object.keys(state.countries).forEach(function(cid){ state.debug.government[cid] = copy(state.countries[cid].governmentFinance); });
    state.debug.goods = copy(state.goods);
    state.debug.fiscalAudit = copy(state.fiscalAudit);
    state.debug.module2Signals = copy(state.module2Signals);
    state.debug.module4Signals = copy(state.module4Signals);
    state.debug.module5Signals = copy(state.module5Signals);
  }

  function update(gameState) {
    gameState = gameState || {};
    var previous = copy(state);
    state = freshState();
    state.turn = num(gameState.turn, previous.turn + 1);
    state.previous = previous.turn ? previous : null;
    var idx = indexGame(gameState);
    var taxSetting = String(gameState.taxPolicy || 'normal').toLowerCase();
    var taxPolicy = TAX_PRESETS[taxSetting] || TAX_PRESETS.normal;
    state.fiscalInputs = buildFiscalInputs(idx, gameState);

    // Modules 1-2 -> Module 3 physical inputs.
    var power = regionPowerFactors(idx);
    var workers = calcLaborAllocation(idx, cityWorkers(idx));
    var regionalGoods = initialRegionalGoods(idx, previous.turn ? previous : null);
    setRegionalFinalDemand(idx, regionalGoods);

    // Primary facilities create goods only in their own region.
    produceRegionalStage(idx, regionalGoods, power, workers, 0, state.fiscalInputs);

    // Module 9 Agriculture enters here as real domestic regional production.
    applyExternalProductionHooks(gameState, regionalGoods);

    // Stage 1 demand: steelworks need local coal/iron. Food final demand also competes for freight.
    addStageIndustrialDemand(idx, regionalGoods, power, workers, 1, state.fiscalInputs);
    refreshRegionalBalance(regionalGoods);

    // Module 5 compatibility hook: foreign imports/exports can enter/leave named regions.
    applyExternalTradeHooks(gameState, regionalGoods, idx);
    refreshRegionalBalance(regionalGoods);

    // Module 2 connections become a shared domestic freight network.
    var freightNetwork = buildFreightNetwork(idx);
    distributeRegionalGoods(regionalGoods, freightNetwork, ['food', 'coal', 'iron']);

    // Steel is produced from the coal/iron actually present in the steelworks' region.
    produceRegionalStage(idx, regionalGoods, power, workers, 1, state.fiscalInputs);

    // Stage 2 demand: factories and active Module 2 projects need steel.
    addStageIndustrialDemand(idx, regionalGoods, power, workers, 2, state.fiscalInputs);
    addProjectMaterialDemand(idx, regionalGoods, ['steel']);
    refreshRegionalBalance(regionalGoods, ['steel']);
    distributeRegionalGoods(regionalGoods, freightNetwork, ['steel']);

    // Factories consume the steel physically available in their region.
    produceRegionalStage(idx, regionalGoods, power, workers, 2, state.fiscalInputs);
    // Construction projects consume real steel after industrial input allocation.
    consumeRegionalProjectDemand(idx, regionalGoods, ['steel']);

    // Active projects also demand manufactured goods; finished manufactures can move to them or households.
    addProjectMaterialDemand(idx, regionalGoods, ['manufactured_goods']);
    refreshRegionalBalance(regionalGoods, ['manufactured_goods']);
    distributeRegionalGoods(regionalGoods, freightNetwork, ['manufactured_goods']);
    consumeRegionalProjectDemand(idx, regionalGoods, ['manufactured_goods']);
    finalizeProjectMaterialSignals(idx);

    // Households consume final goods; only goods actually used/sold become current producer revenue.
    consumeRegionalFinalDemand(regionalGoods);
    computeRegionalSalesMetrics(regionalGoods);
    updateRegionalPrices(regionalGoods);
    finalizeRegionalStorage(idx, regionalGoods);
    refreshRegionalBalance(regionalGoods);

    // Keep a national aggregate for existing UI / Module 4 compatibility; it is summary only.
    state.goods = aggregateNationalGoods(regionalGoods, previous.turn ? previous : null);
    attachRegionGoods(idx, regionalGoods);
    attachCountryGoods(idx, regionalGoods);

    // Income, profit and fiscal calculations remain Module 3 responsibilities.
    calcFacilityMoney(idx, taxPolicy);
    aggregateCities(idx, workers, taxPolicy); // city food price/availability now come from its own region.
    aggregateRegions(idx);
    calcGovernment(idx, gameState, taxPolicy);

    state.bottlenecks = bottlenecks();
    buildDebug();
    state.debug.regionGoods = copy(regionalGoods);
    state.debug.freightCapacityRemaining = copy(freightNetwork.remaining);
    state.debug.freightEdges = copy(freightNetwork.edges);
    state.debug.blockedCrossBorderFreightEdges = copy(freightNetwork.blockedCrossBorderEdges || []);
    state.debug.projects = copy(state.projects);
    state.debug.module2Signals = copy(state.module2Signals);
    return publicState();
  }

  function publicState() {
    var s = copy(state); delete s.previous; return s;
  }

  function getCityEconomy(id) { return copy(state.cities[id] || null); }
  function getRegionEconomy(id) { return copy(state.regions[id] || null); }
  function getCountryEconomy(id) {
    id = id || Object.keys(state.countries)[0];
    var gov = state.countries[id] || null;
    if (!gov) return null;
    var jobs=0, income=0, output=0;
    Object.keys(state.cities).forEach(function(cid){
      var c = state.cities[cid];
      if (String(c.countryId || '') !== String(id)) return;
      jobs += c.jobsFilled; income += c.totalHouseholdIncome; output += c.industrialOutput;
    });
    return { countryId:id, jobsFilled:jobs, totalHouseholdIncome:income, industrialOutput:output, goods:copy(gov.goods || {}), governmentFinance:copy(gov.governmentFinance) };
  }
  function getRegionGoodBalance(regionId, goodId) {
    var region = state.regions[regionId];
    if (!region || !region.goods) return null;
    return copy(region.goods[goodId] || null);
  }
  function getRegionGoods(regionId) {
    var region = state.regions[regionId];
    return copy(region && region.goods ? region.goods : null);
  }
  function getGoodBalance(id) { return copy(state.goods[id] || null); }
  function getProjectEconomy(id) { return copy(state.projects[id] || null); }
  function getProjectProgressSignals() { return copy(state.module2Signals.projectProgress || {}); }
  function getModule2Signals() { return copy(state.module2Signals || {}); }
  function getModule4Signals() { return copy(state.module4Signals || {}); }
  function getModule5Signals() { return copy(state.module5Signals || {}); }
  function getFiscalAudit(id) { return id != null ? copy(state.fiscalAudit[String(id)] || null) : copy(state.fiscalAudit); }
  function getFacilityEconomy(id) { return copy(state.facilities[id] || null); }
  function getGovernmentFinance(id) { id=id||Object.keys(state.countries)[0]; return copy(state.countries[id] ? state.countries[id].governmentFinance : null); }
  function getBottlenecks() { return copy(state.bottlenecks); }
  function getDebug() { return copy(state.debug); }
  function reset() { state = freshState(); }

  return {
    GOODS: GOODS.slice(), GOOD_CONFIG: copy(GOOD_CONFIG), FACILITY_TYPES: copy(FACILITY_TYPES), TAX_PRESETS: copy(TAX_PRESETS),
    GOODS_PRIORITY: copy(GOODS_PRIORITY), STORAGE_RETENTION: copy(STORAGE_RETENTION),
    PRODUCTION_PRIORITY_WEIGHTS: copy(PRODUCTION_PRIORITY_WEIGHTS), MINIMUM_INPUT_GUARANTEE: MINIMUM_INPUT_GUARANTEE,
    LABOR_MINIMUM_STAFFING_GUARANTEE: LABOR_MINIMUM_STAFFING_GUARANTEE,
    MAX_PRICE_RISE_PER_TURN: MAX_PRICE_RISE_PER_TURN, MAX_PRICE_FALL_PER_TURN: MAX_PRICE_FALL_PER_TURN,
    DEFAULT_WORKING_CAPITAL_BUFFER: DEFAULT_WORKING_CAPITAL_BUFFER, INVENTORY_SOFT_LIMIT: INVENTORY_SOFT_LIMIT,
    DEFAULT_STORAGE_CAPACITY: copy(DEFAULT_STORAGE_CAPACITY), FREIGHT_COST_PER_100KM: copy(FREIGHT_COST_PER_100KM),
    PROJECT_MATERIAL_DEFAULTS: copy(PROJECT_MATERIAL_DEFAULTS),
    update: update, reset: reset,
    getCityEconomy: getCityEconomy, getRegionEconomy: getRegionEconomy,
    getCountryEconomy: getCountryEconomy, getGoodBalance: getGoodBalance,
    getRegionGoodBalance: getRegionGoodBalance, getRegionGoods: getRegionGoods,
    getFacilityEconomy: getFacilityEconomy, getGovernmentFinance: getGovernmentFinance,
    getProjectEconomy: getProjectEconomy, getProjectProgressSignals: getProjectProgressSignals,
    getModule2Signals: getModule2Signals, getModule4Signals: getModule4Signals, getModule5Signals: getModule5Signals, getFiscalAudit:getFiscalAudit,
    getBottlenecks: getBottlenecks, getDebug: getDebug,
    getState: publicState
  };
});
/* ===== END MODULE 3 — ECONOMY & GOVERNMENT FINANCE ===== */
