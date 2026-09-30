/* ===== MODULE 4 — POPULATION & SOCIETY — INLINE INTEGRATED ===== */
/**
 * Border Epoch — Module 4
 * Population, Migration and Society
 *
 * Design contract:
 *   Module 2 asks: What physically exists?
 *   Module 3 asks: What does it economically produce?
 *   Module 4 asks: How do people respond?
 *
 * No industrial production, tax collection, trade, construction, diplomacy,
 * or event prose is calculated here.
 */
(function (global) {
  "use strict";

  const GROUPS = [
    "workers",
    "rural_population",
    "middle_class",
    "business_owners",
    "professionals"
  ];

  const DEFAULTS = {
    workingAgeShare: 0.63,
    laborParticipation: 0.76,
    personsPerHousehold: 2.65,
    naturalGrowthRate: 0.0012,
    birthRate: 0.0105,
    childAgingRate: 1 / 18,
    workingAgeAgingRate: 1 / 47,
    childMortalityRate: 0.0005,
    workingAgeMortalityRate: 0.0025,
    elderlyMortalityRate: 0.038,
    normalMigrationCap: 0.02,           // 2% of source population / turn
    crisisMigrationCap: 0.05,           // hard ceiling
    attractivenessScale: 30,
    migrationFriction: 0.45,
    housingComfortRatio: 0.96,
    automaticHousingGrowth: 0.0020,
    automaticHousingResponse: 0.0100,
    housingConstructionLagYears: 2,
    maxAnnualHousingExpansion: 0.025,
    serviceDemandPerCapita: 1,
    servicePressureElasticity: 0.72,
    migrationDistanceScale: 650,            // map-distance / km-like calibration
    directRailMigrationBonus: 0.28,
    directRoadMigrationBonus: 0.14,
    directPortMigrationBonus: 0.08,
    minCityPopulation: 500,
    inequalityThreshold: 0.22,
    issueThreshold: 0.35
  };

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));
  const safe = (v, fallback = 0) => Number.isFinite(+v) ? +v : fallback;
  const round = (v, d = 0) => {
    const p = Math.pow(10, d);
    return Math.round((safe(v) + Number.EPSILON) * p) / p;
  };
  const sum = arr => arr.reduce((a, b) => a + safe(b), 0);
  const mean = arr => arr.length ? sum(arr) / arr.length : 0;
  const asEntries = obj => Array.isArray(obj)
    ? obj.map((v, i) => [v.id ?? String(i), v])
    : Object.entries(obj || {});
  const values = obj => asEntries(obj).map(([, v]) => v);

  const state = {
    gameState: null,
    config: { ...DEFAULTS },
    city: {},
    region: {},
    groups: {},
    countries: {},
    national: {
      population: 0,
      publicSupport: 50,
      publicSupportDelta: 0,
      regionalInequality: 0,
      reasons: []
    },
    migrationFlows: [],
    socialIssues: [],
    lastUpdateTurn: null
  };

  function getEconomyAPI(gameState) {
    if (global.Economy && typeof global.Economy.getCityEconomy === "function") {
      return global.Economy;
    }
    if (gameState && gameState.Economy && typeof gameState.Economy.getCityEconomy === "function") {
      return gameState.Economy;
    }
    return null;
  }

  function getMapAPI(gameState) {
    if (global.MapUI && typeof global.MapUI.updateCity === "function") return global.MapUI;
    if (gameState && gameState.MapUI && typeof gameState.MapUI.updateCity === "function") return gameState.MapUI;
    return null;
  }

  function regionIdOf(city) {
    return city.regionId ?? city.region ?? city.region_id ?? "unassigned";
  }

  function countryIdOf(city, gameState) {
    if (city.countryId) return city.countryId;
    const region = getRegion(gameState, regionIdOf(city));
    return region?.countryId ?? gameState?.playerCountryId ?? "asteria";
  }

  function getCity(gameState, cityId) {
    if (!gameState?.cities) return null;
    if (Array.isArray(gameState.cities)) return gameState.cities.find(c => c.id === cityId) || null;
    return gameState.cities[cityId] || null;
  }

  function getRegion(gameState, regionId) {
    if (!gameState?.regions) return null;
    if (Array.isArray(gameState.regions)) return gameState.regions.find(r => r.id === regionId) || null;
    return gameState.regions[regionId] || null;
  }

  function cityEconomy(gameState, cityId) {
    const api = getEconomyAPI(gameState);
    let e = null;
    if (api) {
      try { e = api.getCityEconomy(cityId); } catch (_) {}
    }
    e = e || gameState?.economy?.cities?.[cityId] || getCity(gameState, cityId)?.economy || {};
    const jobsAvailable = Math.max(0, safe(e.jobsAvailable, e.jobs ?? 0));
    const activeLaborDemand = Math.max(
      0,
      safe(e.activeLaborDemand, safe(e.laborDemand, jobsAvailable))
    );
    const inactiveJobs = Math.max(
      0,
      safe(e.inactiveJobs, Math.max(0, jobsAvailable - activeLaborDemand))
    );
    const jobsFilledProvided =
      e.jobsFilled !== undefined &&
      e.jobsFilled !== null &&
      Number.isFinite(+e.jobsFilled);

    return {
      jobsAvailable,
      activeLaborDemand,
      jobsFilled: jobsFilledProvided ? Math.max(0, +e.jobsFilled) : null,
      jobsFilledProvided,
      inactiveJobs,
      skillMismatch: clamp(safe(e.skillMismatch, 0), 0, 1),
      averageIncome: Math.max(1, safe(e.averageIncome, e.averageWage ?? 50)),
      foodPrice: Math.max(0.2, safe(e.foodPrice, 1)),
      growthRate: safe(e.growthRate, 0),
      taxBurden: clamp(safe(e.taxBurden, e.effectiveTaxRate ?? 0.15), 0, 0.8),
      agriculturalIncome: Math.max(1, safe(e.agriculturalIncome, e.averageIncome ?? 45)),
      businessProfitIndex: Math.max(0, safe(e.businessProfitIndex, 1)),
      highSkillJobs: Math.max(0, safe(e.highSkillJobs, 0)),
      productionGrowth: safe(e.productionGrowth, e.growthRate ?? 0)
    };
  }

  function infrastructureContext(gameState, city) {
    // Module 4 reads physical/infrastructure outputs but never builds anything.
    const infra = city.infrastructure || city.access || {};
    const connections = values(gameState?.connections).filter(c =>
      c.fromCityId === city.id || c.toCityId === city.id ||
      c.from === city.id || c.to === city.id
    );
    const operational = connections.filter(c =>
      c.status === "operational" || c.completed === true || c.active === true
    );

    const rail = operational.some(c => /rail|railway/i.test(c.type || c.kind || c.name || ""));
    const road = operational.some(c => /road|highway/i.test(c.type || c.kind || c.name || ""));
    const port = operational.some(c => /port|shipping|sea/i.test(c.type || c.kind || c.name || ""));

    const accessibility = clamp(
      safe(city.accessibility, safe(infra.accessibility, 50)) +
      (rail ? 8 : 0) + (road ? 4 : 0) + (port ? 4 : 0),
      0, 100
    );

    const services = clamp(
      safe(city.services, safe(city.serviceLevel, safe(infra.services, 50))),
      0, 100
    );

    return { accessibility, services, rail, road, port };
  }

  function inferGroupShares(city, gameState) {
    const supplied = city.socialGroups || city.groupShares;
    if (supplied) {
      const raw = {};
      let total = 0;
      for (const g of GROUPS) {
        raw[g] = Math.max(0, safe(supplied[g], 0));
        total += raw[g];
      }
      if (total > 0) {
        for (const g of GROUPS) raw[g] /= total;
        return raw;
      }
    }

    const name = `${city.name || ""} ${regionIdOf(city)}`.toLowerCase();
    let shares;
    if (/southern|plain|rural|farm/.test(name)) {
      shares = { workers: .18, rural_population: .48, middle_class: .17, business_owners: .06, professionals: .11 };
    } else if (/capital/.test(name)) {
      shares = { workers: .21, rural_population: .04, middle_class: .35, business_owners: .10, professionals: .30 };
    } else if (/westhaven|industrial|basin|mining/.test(name)) {
      shares = { workers: .43, rural_population: .12, middle_class: .22, business_owners: .08, professionals: .15 };
    } else if (/port|coast/.test(name)) {
      shares = { workers: .31, rural_population: .07, middle_class: .30, business_owners: .14, professionals: .18 };
    } else {
      shares = { workers: .30, rural_population: .18, middle_class: .26, business_owners: .09, professionals: .17 };
    }
    return shares;
  }

  function ensureCityState(gameState, cityId, city) {
    if (state.city[cityId]) return state.city[cityId];

    const population = Math.max(
      state.config.minCityPopulation,
      safe(city.population, safe(city.demographics?.population, 50000))
    );
    const households = Math.max(1, safe(city.households, population / state.config.personsPerHousehold));
    const housingCapacity = Math.max(
      1,
      safe(city.housingCapacity, households * 1.04)
    );

    const cs = state.city[cityId] = {
      id: cityId,
      name: city.name || cityId,
      countryId: countryIdOf(city, gameState),
      regionId: regionIdOf(city),
      population,
      previousPopulation: population,
      childrenPopulation: Math.round(population * 0.22),
      workingAgePopulation: Math.round(population * state.config.workingAgeShare),
      elderlyPopulation: Math.round(population * 0.15),
      workforce: 0,
      households,
      housingCapacity,
      housingDemand: households,
      housingShortage: 0,
      housingPressure: 0,
      housingCost: safe(city.housingCost, 1),
      unemploymentRate: 0,
      unemployed: 0,
      jobsAvailable: 0,
      activeLaborDemand: 0,
      jobsFilled: 0,
      unfilledJobs: 0,
      inactiveJobs: 0,
      skillMismatch: 0,
      averageIncome: 50,
      foodPrice: 1,
      taxBurden: 0.15,
      livingStandard: 50,
      attractiveness: 0,
      attractivenessReasons: [],
      migrationIn: 0,
      migrationOut: 0,
      migrationBalance: 0,
      accessibility: 50,
      services: 50,
      serviceCapacity: 0,
      serviceDemand: 0,
      servicePressure: 0,
      effectiveServices: 50,
      groupShares: inferGroupShares(city, gameState),
      groupSatisfaction: {},
      recentChanges: []
    };

    const cohortTotal = cs.childrenPopulation + cs.workingAgePopulation + cs.elderlyPopulation;
    if (cohortTotal > 0) {
      const k = population / cohortTotal;
      cs.childrenPopulation = Math.round(cs.childrenPopulation * k);
      cs.workingAgePopulation = Math.round(cs.workingAgePopulation * k);
      cs.elderlyPopulation = Math.max(0, population - cs.childrenPopulation - cs.workingAgePopulation);
    }
    cs.housingPipeline ||= [];

    return cs;
  }

  function updateDemographics(cs) {
    const cfg = state.config;
    const children = Math.max(0, cs.childrenPopulation);
    const working = Math.max(0, cs.workingAgePopulation);
    const elderly = Math.max(0, cs.elderlyPopulation);

    const births = Math.round(cs.population * cfg.birthRate);
    const childDeaths = Math.round(children * cfg.childMortalityRate);
    const workingDeaths = Math.round(working * cfg.workingAgeMortalityRate);
    const elderlyDeaths = Math.round(elderly * cfg.elderlyMortalityRate);
    const childrenToWorking = Math.round(children * cfg.childAgingRate);
    const workingToElderly = Math.round(working * cfg.workingAgeAgingRate);

    cs.childrenPopulation = Math.max(0, children + births - childDeaths - childrenToWorking);
    cs.workingAgePopulation = Math.max(0, working + childrenToWorking - workingDeaths - workingToElderly);
    cs.elderlyPopulation = Math.max(0, elderly + workingToElderly - elderlyDeaths);

    cs.demographicChange = {
      births,
      deaths: childDeaths + workingDeaths + elderlyDeaths,
      childrenToWorking,
      workingToElderly
    };
  }

  function calculateLabor(cs, e) {
    cs.workforce = Math.round(cs.workingAgePopulation * state.config.laborParticipation);
    cs.jobsAvailable = Math.round(e.jobsAvailable);
    cs.activeLaborDemand = Math.round(e.activeLaborDemand);
    cs.inactiveJobs = Math.round(e.inactiveJobs);
    cs.skillMismatch = e.skillMismatch;

    // Module 3 is authoritative whenever jobsFilled is explicitly supplied.
    // An explicit 0 is a real economic result, not "missing data".
    const effectiveDemand = cs.activeLaborDemand;
    if (e.jobsFilledProvided) {
      const reportedFilled = Math.max(0, Math.round(e.jobsFilled));
      cs.jobsFilled = Math.min(reportedFilled, cs.workforce, effectiveDemand);
    } else {
      cs.jobsFilled = Math.min(
        cs.workforce,
        Math.round(effectiveDemand * (1 - clamp(cs.skillMismatch, 0, .95)))
      );
    }

    cs.unemployed = Math.max(0, cs.workforce - cs.jobsFilled);
    cs.unemploymentRate = cs.workforce > 0 ? cs.unemployed / cs.workforce : 0;
    cs.unfilledJobs = Math.max(0, effectiveDemand - cs.jobsFilled);
  }

  function advanceHousingYear(cs) {
    cs.housingPipeline ||= [];

    const startingCapacity = Math.max(1, cs.housingCapacity);
    const annualCompletionCap =
      startingCapacity * state.config.maxAnnualHousingExpansion;

    const matured = [];
    const stillBuilding = [];

    for (const project of cs.housingPipeline) {
      const nextYears = Math.max(0, safe(project.yearsRemaining, 0) - 1);
      const capacity = Math.max(0, safe(project.capacity, 0));
      if (nextYears <= 0) matured.push({ capacity });
      else stillBuilding.push({ ...project, capacity, yearsRemaining: nextYears });
    }

    let remainingAnnualCapacity = annualCompletionCap;
    let pipelineCompleted = 0;
    let deferredCapacity = 0;

    // Matured pressure-response projects have priority over baseline growth.
    for (const project of matured) {
      const deliver = Math.min(project.capacity, remainingAnnualCapacity);
      pipelineCompleted += deliver;
      remainingAnnualCapacity -= deliver;

      const deferred = project.capacity - deliver;
      if (deferred > 0) {
        deferredCapacity += deferred;
        stillBuilding.push({
          capacity: deferred,
          yearsRemaining: 1,
          deferredFromCapacityLimit: true
        });
      }
    }

    const baselineDesired =
      startingCapacity * state.config.automaticHousingGrowth;
    const baselineCompleted =
      Math.min(baselineDesired, Math.max(0, remainingAnnualCapacity));

    const completedThisYear = pipelineCompleted + baselineCompleted;
    cs.housingCapacity += completedThisYear;
    cs.housingPipeline = stillBuilding;

    cs.housingConstruction = {
      completedThisYear: round(completedThisYear, 1),
      pipelineCompletedThisYear: round(pipelineCompleted, 1),
      baselineCompletedThisYear: round(baselineCompleted, 1),
      deferredCapacity: round(deferredCapacity, 1),
      pipelineCapacity: round(sum(cs.housingPipeline.map(p => p.capacity)), 1),
      projectsInPipeline: cs.housingPipeline.length
    };
  }

  function calculateHousingState(cs, adjustPrice = false) {
    cs.households = Math.max(1, cs.population / state.config.personsPerHousehold);
    cs.housingDemand = cs.households;

    const demandRatio = cs.housingDemand / Math.max(1, cs.housingCapacity);
    cs.housingPressure = clamp(
      (demandRatio - state.config.housingComfortRatio) / 0.30,
      0, 1
    );
    cs.housingShortage = Math.max(
      0,
      Math.round(cs.housingDemand - cs.housingCapacity)
    );

    if (adjustPrice) {
      const targetHousingCost = clamp(
        0.78 + demandRatio * 0.30 + cs.housingPressure * 0.55,
        0.60, 2.50
      );
      cs.housingCost += (targetHousingCost - cs.housingCost) * 0.22;
      cs.housingCost = clamp(cs.housingCost, 0.60, 2.50);
    }
  }

  function planHousingConstruction(cs) {
    cs.housingPipeline ||= [];

    const desiredNewCapacity =
      cs.housingCapacity *
      state.config.automaticHousingResponse *
      cs.housingPressure;

    if (desiredNewCapacity >= 1) {
      cs.housingPipeline.push({
        capacity: desiredNewCapacity,
        yearsRemaining: Math.max(
          1,
          Math.round(state.config.housingConstructionLagYears)
        ),
        startedFromPressure: round(cs.housingPressure, 3)
      });
    }

    cs.housingConstruction ||= {
      completedThisYear: 0,
      pipelineCompletedThisYear: 0,
      baselineCompletedThisYear: 0,
      deferredCapacity: 0
    };
    cs.housingConstruction.pipelineCapacity = round(
      sum(cs.housingPipeline.map(p => p.capacity)), 1
    );
    cs.housingConstruction.projectsInPipeline = cs.housingPipeline.length;
    cs.housingConstruction.startedThisYear = round(desiredNewCapacity >= 1 ? desiredNewCapacity : 0, 1);
  }

  function updateServices(cs, city, infra) {
    // Physical service capacity should ideally be supplied by Module 2.
    // If absent, initialize it from the city's starting population and service level.
    if (!cs.serviceCapacity || cs.serviceCapacity <= 0) {
      cs.serviceCapacity = Math.max(
        1,
        safe(
          city.serviceCapacity,
          safe(city.infrastructure?.serviceCapacity,
            cs.population * (0.70 + infra.services / 100 * 0.60)
          )
        )
      );
    } else {
      const supplied = safe(city.serviceCapacity, safe(city.infrastructure?.serviceCapacity, NaN));
      if (Number.isFinite(supplied) && supplied > 0) cs.serviceCapacity = supplied;
    }

    cs.serviceDemand = Math.max(1, cs.population * state.config.serviceDemandPerCapita);
    const load = cs.serviceDemand / Math.max(1, cs.serviceCapacity);
    cs.servicePressure = clamp((load - 0.92) / 0.55, 0, 1);

    const capacityFactor = clamp(
      1 - cs.servicePressure * state.config.servicePressureElasticity,
      0.25, 1
    );
    cs.services = infra.services;
    cs.effectiveServices = clamp(infra.services * capacityFactor, 0, 100);
  }

  function calculateLivingStandard(cs, e, infra) {
    cs.averageIncome = e.averageIncome;
    cs.foodPrice = e.foodPrice;
    cs.taxBurden = e.taxBurden;
    cs.accessibility = infra.accessibility;

    // Normalize income around prototype baseline = 50.
    const incomePower = clamp((e.averageIncome - 25) / 50, 0, 1.5);
    const employmentScore = 1 - clamp(cs.unemploymentRate / 0.25, 0, 1);
    const housingBurden = clamp((cs.housingCost - 0.65) / 1.30, 0, 1);
    const foodBurden = clamp((e.foodPrice - 0.75) / 0.85, 0, 1);
    const serviceScore = cs.effectiveServices / 100;

    cs.disposableLivingPower =
      e.averageIncome -
      (16 * cs.housingCost) -
      (10 * e.foodPrice);

    cs.livingStandard = clamp(
      20 +
      incomePower * 32 +
      employmentScore * 20 +
      serviceScore * 18 -
      housingBurden * 17 -
      foodBurden * 13,
      0, 100
    );
  }

  function calculateAttractiveness(cs, e, infra) {
    const reasons = [];

    const vacancyRate = cs.workforce > 0 ? cs.unfilledJobs / cs.workforce : 0;
    const employmentOpportunity =
      clamp(vacancyRate * 80, 0, 18) -
      clamp(cs.unemploymentRate * 45, 0, 18);

    const incomeOpportunity = clamp((e.averageIncome - 50) * 0.35, -12, 18);
    const services = (cs.effectiveServices - 50) * 0.16;
    const accessibility = (infra.accessibility - 50) * 0.10;
    const housingPenalty = cs.housingPressure * 20 + Math.max(0, cs.housingCost - 1) * 8;
    const populationPressure = clamp((cs.population / Math.max(1, cs.housingCapacity * state.config.personsPerHousehold) - 0.95) * 25, 0, 10);
    const growthSignal = clamp(e.growthRate * 120, -6, 8);

    function add(label, val) {
      if (Math.abs(val) >= 0.5) reasons.push({ reason: label, value: round(val, 1) });
    }

    add("employment_opportunity", employmentOpportunity);
    add("income_opportunity", incomeOpportunity);
    add("services", services);
    add("accessibility", accessibility);
    add("economic_growth", growthSignal);
    add("housing_pressure", -housingPenalty);
    add("population_pressure", -populationPressure);

    cs.attractiveness = clamp(
      employmentOpportunity + incomeOpportunity + services + accessibility +
      growthSignal - housingPenalty - populationPressure,
      -50, 50
    );
    cs.attractivenessReasons = reasons.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  }


  function cityPoint(gameState, cityId) {
    const c = getCity(gameState, cityId);
    if (!c) return null;
    const x = safe(c.x, safe(c.mapX, safe(c.position?.x, NaN)));
    const y = safe(c.y, safe(c.mapY, safe(c.position?.y, NaN)));
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }

  function directConnection(gameState, a, b) {
    return values(gameState?.connections).find(c => {
      const from = c.fromCityId ?? c.from;
      const to = c.toCityId ?? c.to;
      const active = c.status === "operational" || c.completed === true || c.active === true;
      return active && ((from === a && to === b) || (from === b && to === a));
    }) || null;
  }

  function migrationAccessFactor(gameState, fromId, toId) {
    let factor = 1;
    const a = cityPoint(gameState, fromId);
    const b = cityPoint(gameState, toId);

    if (a && b) {
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      factor *= clamp(Math.exp(-d / state.config.migrationDistanceScale), 0.22, 1);
    } else if (regionIdOf(getCity(gameState, fromId) || {}) !== regionIdOf(getCity(gameState, toId) || {})) {
      factor *= 0.72;
    }

    const conn = directConnection(gameState, fromId, toId);
    if (conn) {
      const type = String(conn.type || conn.kind || conn.name || "").toLowerCase();
      if (/rail/.test(type)) factor *= 1 + state.config.directRailMigrationBonus;
      else if (/road|highway/.test(type)) factor *= 1 + state.config.directRoadMigrationBonus;
      else if (/port|shipping|sea/.test(type)) factor *= 1 + state.config.directPortMigrationBonus;
      else factor *= 1.06;
    }

    return clamp(factor, 0.18, 1.35);
  }

  function groupMigrationPropensity(group, origin, dest, economies) {
    const oe = economies[origin.id];
    const de = economies[dest.id];
    const incomeGain = de.averageIncome / Math.max(1, oe.averageIncome) - 1;
    const jobGain = (dest.unfilledJobs - origin.unfilledJobs) / Math.max(1, origin.workforce);

    if (group === "workers") {
      return clamp(1 + jobGain * 2.2 + incomeGain * 1.2, 0.35, 2.2);
    }
    if (group === "professionals") {
      const skillGain = (de.highSkillJobs - oe.highSkillJobs) / Math.max(1, origin.workforce);
      return clamp(.75 + skillGain * 5 + incomeGain * .9 + (dest.effectiveServices-origin.effectiveServices)/120, .25, 2.2);
    }
    if (group === "middle_class") {
      return clamp(.72 + incomeGain*.7 + (dest.effectiveServices-origin.effectiveServices)/150 - dest.housingPressure*.25, .25, 1.8);
    }
    if (group === "business_owners") {
      return clamp(.42 + Math.max(0, de.businessProfitIndex-oe.businessProfitIndex)*1.1 + Math.max(0, de.growthRate-oe.growthRate)*3, .15, 1.4);
    }
    if (group === "rural_population") {
      return clamp(.48 + Math.max(0, oe.unemploymentRate-dest.unemploymentRate)*1.4 + Math.max(0, oe.averageIncome-de.agriculturalIncome)/80, .15, 1.5);
    }
    return 1;
  }

  function migrationCapacity(cs) {
    const vacancyPull = cs.workforce > 0 ? cs.unfilledJobs / cs.workforce : 0;
    const housingRoom = Math.max(0, cs.housingCapacity * state.config.personsPerHousehold - cs.population);
    return {
      vacancyPull,
      housingRoom
    };
  }

  function calculateMigration(gameState, cityStates, economies) {
    const flows = [];
    const net = Object.fromEntries(cityStates.map(c => [c.id, 0]));
    const groupNet = Object.fromEntries(cityStates.map(c => [
      c.id, Object.fromEntries(GROUPS.map(g => [g, 0]))
    ]));

    for (const origin of cityStates) {
      const candidates = cityStates
        .filter(dest => dest.id !== origin.id && dest.countryId === origin.countryId)
        .map(dest => ({
          dest,
          gap: dest.attractiveness - origin.attractiveness,
          access: migrationAccessFactor(gameState, origin.id, dest.id)
        }))
        .filter(x => x.gap > 3)
        .sort((a, b) => (b.gap*b.access) - (a.gap*a.access))
        .slice(0, 4);

      if (!candidates.length) continue;

      const push =
        clamp(origin.unemploymentRate / 0.18, 0, 1) * 0.55 +
        clamp(origin.housingPressure, 0, 1) * 0.20 +
        clamp(origin.servicePressure, 0, 1) * 0.10 +
        clamp((-origin.attractiveness) / 30, 0, 1) * 0.15;

      const bestEffectiveGap = Math.max(...candidates.map(x => x.gap*x.access));
      const maxRate = bestEffectiveGap > 30 || push > .80
        ? state.config.crisisMigrationCap
        : state.config.normalMigrationCap;

      const baseRate = clamp(
        (bestEffectiveGap / 100) * 0.018 + push * 0.012,
        0, maxRate
      );

      let movable = origin.population * baseRate * (1 - state.config.migrationFriction);
      if (movable < 1) continue;

      const destWeights = candidates.map(x => {
        const cap = migrationCapacity(x.dest);
        const housingFactor = clamp(0.55 + cap.housingRoom / Math.max(1, x.dest.population) * 4, 0.35, 1.35);
        const jobFactor = clamp(0.65 + cap.vacancyPull * 2.5, 0.45, 1.50);
        return Math.pow(x.gap, 1.35) * housingFactor * jobFactor * x.access;
      });
      const weightTotal = sum(destWeights);
      if (weightTotal <= 0) continue;

      let sourceRemaining = origin.population * maxRate;

      candidates.forEach((x, i) => {
        let amount = movable * destWeights[i] / weightTotal;
        amount = Math.min(amount, sourceRemaining);

        const destSoftCap = Math.max(
          x.dest.population * state.config.crisisMigrationCap,
          migrationCapacity(x.dest).housingRoom * 0.65 + x.dest.unfilledJobs * 1.20
        );
        amount = Math.min(amount, Math.max(0, destSoftCap));
        amount = Math.floor(amount);
        if (amount <= 0) return;

        const groupWeights = GROUPS.map(g =>
          Math.max(.0001, origin.groupShares[g] * groupMigrationPropensity(g, origin, x.dest, economies))
        );
        const ageWeights = {
          children: Math.max(.01, origin.childrenPopulation / Math.max(1, origin.population) * 0.75),
          workingAge: Math.max(.01, origin.workingAgePopulation / Math.max(1, origin.population) * 1.22),
          elderly: Math.max(.005, origin.elderlyPopulation / Math.max(1, origin.population) * 0.45)
        };
        const ageWeightTotal = ageWeights.children + ageWeights.workingAge + ageWeights.elderly;
        const ageBreakdown = {
          children: Math.floor(amount * ageWeights.children / ageWeightTotal),
          workingAge: Math.floor(amount * ageWeights.workingAge / ageWeightTotal),
          elderly: 0
        };
        ageBreakdown.elderly = Math.max(
          0,
          amount - ageBreakdown.children - ageBreakdown.workingAge
        );
        const gwTotal = sum(groupWeights);
        const groupBreakdown = {};
        let assigned = 0;
        GROUPS.forEach((g, gi) => {
          const n = gi === GROUPS.length - 1
            ? amount - assigned
            : Math.max(0, Math.floor(amount * groupWeights[gi] / gwTotal));
          groupBreakdown[g] = n;
          assigned += n;
          groupNet[origin.id][g] -= n;
          groupNet[x.dest.id][g] += n;
        });

        sourceRemaining -= amount;
        net[origin.id] -= amount;
        net[x.dest.id] += amount;

        flows.push({
          fromCityId: origin.id,
          toCityId: x.dest.id,
          people: amount,
          groupBreakdown,
          ageBreakdown,
          attractivenessGap: round(x.gap, 1),
          accessFactor: round(x.access, 3),
          causes: migrationCauses(origin, x.dest)
        });
      });
    }

    return { flows, net, groupNet };
  }

  function migrationCauses(origin, dest) {
    const causes = [];
    if (dest.unfilledJobs > origin.unfilledJobs) causes.push("better_job_opportunity");
    if (dest.averageIncome > origin.averageIncome * 1.05) causes.push("higher_income");
    if (origin.unemploymentRate > dest.unemploymentRate + 0.03) causes.push("lower_unemployment");
    if (dest.livingStandard > origin.livingStandard + 4) causes.push("higher_living_standard");
    if (origin.housingPressure > dest.housingPressure + .15) causes.push("lower_housing_pressure");
    if (!causes.length) causes.push("higher_expected_life_quality");
    return causes;
  }

  function applyPopulationChanges(gameState, cityStates, migration) {
    const map = getMapAPI(gameState);

    const ageNet = Object.fromEntries(
      cityStates.map(c => [c.id, { children: 0, workingAge: 0, elderly: 0 }])
    );

    for (const f of migration.flows) {
      if (!f.ageBreakdown) continue;
      for (const key of ["children", "workingAge", "elderly"]) {
        const n = safe(f.ageBreakdown[key], 0);
        ageNet[f.fromCityId][key] -= n;
        ageNet[f.toCityId][key] += n;
      }
    }

    for (const cs of cityStates) {
      cs.previousPopulation = cs.population;

      updateDemographics(cs);

      cs.childrenPopulation = Math.max(0, cs.childrenPopulation + ageNet[cs.id].children);
      cs.workingAgePopulation = Math.max(0, cs.workingAgePopulation + ageNet[cs.id].workingAge);
      cs.elderlyPopulation = Math.max(0, cs.elderlyPopulation + ageNet[cs.id].elderly);

      cs.migrationIn = sum(migration.flows.filter(f => f.toCityId === cs.id).map(f => f.people));
      cs.migrationOut = sum(migration.flows.filter(f => f.fromCityId === cs.id).map(f => f.people));
      cs.migrationBalance = Math.round(migration.net[cs.id] || 0);

      cs.population = Math.max(
        state.config.minCityPopulation,
        Math.round(cs.childrenPopulation + cs.workingAgePopulation + cs.elderlyPopulation)
      );

      const sourceCity = getCity(gameState, cs.id);
      if (sourceCity) {
        sourceCity.population = cs.population;
        sourceCity.childrenPopulation = cs.childrenPopulation;
        sourceCity.workingAgePopulation = cs.workingAgePopulation;
        sourceCity.elderlyPopulation = cs.elderlyPopulation;
      }

      if (map) {
        try {
          map.updateCity(cs.id, {
            population: cs.population,
            populationDelta: cs.population - cs.previousPopulation,
            migrationBalance: cs.migrationBalance
          });
        } catch (_) {
          try { map.updateCity(cs.id); } catch (_) {}
        }
      }
    }
  }

  function applyGroupMigration(cityStates, migration) {
    for (const cs of cityStates) {
      const oldPopulation = Math.max(1, cs.previousPopulation);
      const oldCounts = Object.fromEntries(
        GROUPS.map(g => [g, oldPopulation * cs.groupShares[g]])
      );

      let total = 0;
      const newCounts = {};
      for (const g of GROUPS) {
        newCounts[g] = Math.max(0, oldCounts[g] + safe(migration.groupNet?.[cs.id]?.[g], 0));
        total += newCounts[g];
      }

      // Natural population change is distributed proportionally.
      const target = Math.max(1, cs.population);
      const scale = total > 0 ? target / total : 1;
      total = 0;
      for (const g of GROUPS) {
        newCounts[g] *= scale;
        total += newCounts[g];
      }
      if (total > 0) {
        for (const g of GROUPS) cs.groupShares[g] = newCounts[g] / total;
      }
    }
  }

  function evolveGroupShares(cs, e) {
    const s = { ...cs.groupShares };
    const total = cs.population;

    // Small structural evolution only; avoids micromanagement.
    const industrialPull = clamp((cs.activeLaborDemand / Math.max(1, cs.workforce) - 0.75) * 0.0015, -0.0008, 0.0015);
    const professionalPull = clamp((e.highSkillJobs / Math.max(1, cs.activeLaborDemand)) * 0.001, 0, 0.001);
    const ruralDrift = cs.migrationBalance > 0 ? -0.001 : 0.0003;

    s.workers = Math.max(.02, s.workers + industrialPull);
    s.professionals = Math.max(.02, s.professionals + professionalPull);
    s.rural_population = Math.max(.01, s.rural_population + ruralDrift);
    s.middle_class = Math.max(.03, s.middle_class + Math.max(0, cs.livingStandard - 55) * 0.000015);
    s.business_owners = Math.max(.02, s.business_owners + Math.max(0, e.businessProfitIndex - 1) * 0.0005);

    const t = sum(Object.values(s));
    for (const g of GROUPS) s[g] /= t;
    cs.groupShares = s;
  }

  function factor(label, value) {
    return { factor: label, value: round(value, 1) };
  }

  function groupSatisfactionFor(cs, e, group) {
    const positives = [], negatives = [];
    const add = (label, value) => {
      if (Math.abs(value) < .5) return;
      (value >= 0 ? positives : negatives).push(factor(label, value));
    };

    const employment = (0.08 - cs.unemploymentRate) * 90;
    const wage = (e.averageIncome - 50) * 0.18;
    const housing = -cs.housingPressure * 18 - Math.max(0, cs.housingCost - 1) * 7;
    const food = -(e.foodPrice - 1) * 14;
    const service = (cs.effectiveServices - 50) * .12;
    const tax = -(e.taxBurden - .15) * 30;
    const growth = e.growthRate * 70;
    const business = (e.businessProfitIndex - 1) * 12;
    const agriculture = (e.agriculturalIncome - 45) * .16;
    const highSkill = clamp(e.highSkillJobs / Math.max(1, cs.workforce) * 65, 0, 10);

    let score = 50;
    if (group === "workers") {
      for (const [l,v] of [["jobs",employment*1.00],["wages",wage*1.2],["housing",housing*1.00],["food_prices",food]]) add(l,v), score += v;
    } else if (group === "rural_population") {
      for (const [l,v] of [["agricultural_income",agriculture*1.4],["food_market",food*.55],["services",service*.7],["employment",employment*.35]]) add(l,v), score += v;
    } else if (group === "middle_class") {
      for (const [l,v] of [["income",wage],["services",service*1.25],["tax_burden",tax],["housing",housing*.85],["stability_from_employment",employment*.45]]) add(l,v), score += v;
    } else if (group === "business_owners") {
      for (const [l,v] of [["profits",business*1.35],["growth",growth],["tax_burden",tax*1.15],["infrastructure",(cs.accessibility-50)*.13]]) add(l,v), score += v;
    } else if (group === "professionals") {
      for (const [l,v] of [["high_skill_opportunities",highSkill*1.3],["income",wage],["services",service*1.3],["technology_growth",growth*.45],["housing",housing*.6]]) add(l,v), score += v;
    }

    // Avoid double-counting: jobs, wages, housing and food already enter directly.
    // Only residual service/access quality is added here.
    const residualQuality =
      (cs.effectiveServices - 50) * 0.045 +
      (cs.accessibility - 50) * 0.025;
    score += residualQuality;
    add("residual_quality_of_life", residualQuality);

    positives.sort((a,b) => b.value - a.value);
    negatives.sort((a,b) => a.value - b.value);

    return {
      satisfaction: clamp(score, 0, 100),
      positiveFactors: positives.slice(0, 4),
      negativeFactors: negatives.slice(0, 4)
    };
  }

  function calculateGroups(gameState, cityStates, economies) {
    // City-level group satisfaction is calculated once.
    for (const cs of cityStates) {
      const e = economies[cs.id];
      evolveGroupShares(cs, e);
      cs.groupSatisfaction = {};
      for (const g of GROUPS) {
        cs.groupSatisfaction[g] = groupSatisfactionFor(cs, e, g);
      }
    }

    const countryIds = [...new Set(cityStates.map(c => c.countryId))];
    for (const countryId of countryIds) {
      const countryCities = cityStates.filter(c => c.countryId === countryId);
      const nationalGroup = {};
      const nationalPopulation = sum(countryCities.map(c => c.population));

      for (const g of GROUPS) {
        let weighted = 0, nTotal = 0;
        const positives = {}, negatives = {};

        for (const cs of countryCities) {
          const n = cs.population * cs.groupShares[g];
          const r = cs.groupSatisfaction[g];
          weighted += r.satisfaction * n;
          nTotal += n;

          for (const x of r.positiveFactors) {
            positives[x.factor] = (positives[x.factor] || 0) + x.value * n;
          }
          for (const x of r.negativeFactors) {
            negatives[x.factor] = (negatives[x.factor] || 0) + x.value * n;
          }
        }

        nationalGroup[g] = {
          id: g,
          population: Math.round(nTotal),
          populationShare: nationalPopulation ? nTotal / nationalPopulation : 0,
          satisfaction: nTotal ? weighted / nTotal : 50,
          positiveFactors: Object.entries(positives)
            .map(([factorName,v]) => factor(factorName, v / Math.max(1,nTotal)))
            .sort((a,b)=>b.value-a.value).slice(0,4),
          negativeFactors: Object.entries(negatives)
            .map(([factorName,v]) => factor(factorName, v / Math.max(1,nTotal)))
            .sort((a,b)=>a.value-b.value).slice(0,4)
        };
      }

      state.countries[countryId] ||= {};
      state.countries[countryId].groups = nationalGroup;
    }

    // Backward-compatible alias: old callers get the player country's groups.
    const playerCountryId =
      gameState?.playerCountryId ??
      countryIds[0] ??
      "asteria";
    state.groups = state.countries[playerCountryId]?.groups || {};
  }

  function calculateRegions(gameState, cityStates) {
    const grouped = {};
    for (const cs of cityStates) {
      const key = `${cs.countryId}::${cs.regionId}`;
      (grouped[key] ||= []).push(cs);
    }

    const out = {};
    for (const [key, cities] of Object.entries(grouped)) {
      const first = cities[0];
      const countryId = first.countryId;
      const regionId = first.regionId;
      const pop = sum(cities.map(c => c.population));
      const wavg = k => pop ? sum(cities.map(c => c[k] * c.population)) / pop : 0;

      let satNumerator = 0;
      let groupPop = 0;
      for (const cs of cities) {
        for (const g of GROUPS) {
          const n = cs.population * cs.groupShares[g];
          satNumerator += cs.groupSatisfaction[g].satisfaction * n;
          groupPop += n;
        }
      }

      // Keep regionId as normal key when globally unique; otherwise use country-qualified key.
      const outputKey = out[regionId] ? key : regionId;
      out[outputKey] = {
        id: regionId,
        countryId,
        key: outputKey,key: outputKey,
        name: getRegion(gameState, regionId)?.name || regionId,
        population: Math.round(pop),
        averageIncome: round(wavg("averageIncome"), 2),
        livingStandard: round(wavg("livingStandard"), 2),
        satisfaction: round(groupPop ? satNumerator / groupPop : 50, 2),
        unemploymentRate: round(wavg("unemploymentRate"), 4),
        housingPressure: round(wavg("housingPressure"), 4),
        migrationBalance: Math.round(sum(cities.map(c => c.migrationBalance))),
        infrastructure: round(mean(cities.map(c => c.accessibility)), 2),
        cityIds: cities.map(c => c.id)
      };
    }
    state.region = out;

    for (const countryId of [...new Set(cityStates.map(c => c.countryId))]) {
      state.countries[countryId] ||= {};
      state.countries[countryId].regions = Object.fromEntries(
        Object.entries(out).filter(([,r]) => r.countryId === countryId)
      );
    }
  }

  function calculateRegionalInequality(countryId) {
    const rs = countryId
      ? Object.values(state.region).filter(r => r.countryId === countryId)
      : Object.values(state.region);

    if (rs.length < 2) return 0;

    const spread = (key, normalizeBy = 100) => {
      const vals = rs.map(r => safe(r[key]));
      return (Math.max(...vals) - Math.min(...vals)) / normalizeBy;
    };

    const avgIncome = Math.max(1, mean(rs.map(r => r.averageIncome)));
    const incomeSpread = spread("averageIncome", avgIncome);
    const livingSpread = spread("livingStandard", 100);
    const unemploymentSpread = spread("unemploymentRate", 1);
    const infrastructureSpread = spread("infrastructure", 100);

    return clamp(
      incomeSpread * .35 +
      livingSpread * .30 +
      unemploymentSpread * .20 +
      infrastructureSpread * .15,
      0, 1
    );
  }

  function buildEconomicFeedback(cityStates) {
    const out = {};
    for (const cs of cityStates) {
      out[cs.id] = {
        cityId: cs.id,
        population: cs.population,
        childrenPopulation: cs.childrenPopulation,
        workingAgePopulation: cs.workingAgePopulation,
        elderlyPopulation: cs.elderlyPopulation,
        workforce: cs.workforce,
        unemployed: cs.unemployed,
        laborSupply: cs.workforce,
        householdDemand: round(cs.households, 1),
        consumerDemandIndex: round(
          clamp((cs.population / Math.max(1, cs.previousPopulation)) *
            (0.75 + cs.livingStandard / 200), 0.55, 1.65), 3
        ),
        housingDemand: round(cs.housingDemand, 1),
        serviceDemand: round(cs.serviceDemand, 1),
        migrationBalance: cs.migrationBalance
      };
    }
    return out;
  }

  function calculatePublicSupport(gameState, cityStates) {
    const countryIds = [...new Set(cityStates.map(c => c.countryId))];

    for (const countryId of countryIds) {
      const cities = cityStates.filter(c => c.countryId === countryId);
      const previous = state.countries[countryId]?.national?.publicSupport ?? 50;

      let numerator = 0, denominator = 0;
      for (const cs of cities) {
        for (const g of GROUPS) {
          const n = cs.population * cs.groupShares[g];
          numerator += cs.groupSatisfaction[g].satisfaction * n;
          denominator += n;
        }
      }

      const raw = denominator ? numerator / denominator : 50;
      const support = clamp(previous * .35 + raw * .65, 0, 100);
      const nationalPop = sum(cities.map(c => c.population));

      state.countries[countryId] ||= {};
      state.countries[countryId].national = {
        countryId,
        population: Math.round(nationalPop),
        publicSupport: round(support, 1),
        publicSupportDelta: round(support - previous, 1),
        regionalInequality: round(calculateRegionalInequality(countryId), 3),
        reasons: aggregateSupportReasons(cities, nationalPop)
      };
    }

    const playerCountryId =
      gameState?.playerCountryId ??
      countryIds[0] ??
      "asteria";
    state.national = state.countries[playerCountryId]?.national || {
      countryId: playerCountryId,
      population: 0,
      publicSupport: 50,
      publicSupportDelta: 0,
      regionalInequality: 0,
      reasons: []
    };
  }

  function aggregateSupportReasons(cityStates, nationalPop) {
    const scores = {};
    for (const cs of cityStates) {
      const weight = cs.population / Math.max(1, nationalPop);

      if (cs.unemploymentRate < .05) scores.industrial_employment_growth = (scores.industrial_employment_growth || 0) + 5 * weight;
      if (cs.unemploymentRate > .10) scores.high_unemployment = (scores.high_unemployment || 0) - 11 * clamp(cs.unemploymentRate/.20,0,1) * weight;
      if (cs.housingPressure > .25) scores.housing_shortage = (scores.housing_shortage || 0) - 12 * cs.housingPressure * weight;
      if (cs.foodPrice < .95) scores.falling_food_prices = (scores.falling_food_prices || 0) + 4 * (.95-cs.foodPrice)/.25 * weight;
      if (cs.foodPrice > 1.08) scores.high_food_prices = (scores.high_food_prices || 0) - 7 * clamp((cs.foodPrice-1.08)/.5,0,1) * weight;
      if (cs.livingStandard > 62) scores.rising_living_standard = (scores.rising_living_standard || 0) + 5 * weight;
      if (cs.livingStandard < 42) scores.low_living_standard = (scores.low_living_standard || 0) - 7 * weight;
      if (cs.taxBurden > .19) scores.higher_taxes = (scores.higher_taxes || 0) - 7 * clamp((cs.taxBurden-.19)/.20,0,1) * weight;
      if (cs.taxBurden < .12) scores.lower_tax_burden = (scores.lower_tax_burden || 0) + 3 * clamp((.12-cs.taxBurden)/.08,0,1) * weight;
    }

    return Object.entries(scores)
      .map(([reason,value]) => ({ reason, value: round(value,1) }))
      .filter(x => Math.abs(x.value) >= .2)
      .sort((a,b) => Math.abs(b.value)-Math.abs(a.value))
      .slice(0, 6);
  }

  function issue(id, type, severity, extra = {}) {
    return {
      id,
      type,
      severity: round(clamp(severity, 0, 1), 3),
      ...extra
    };
  }

  function detectIssues(cityStates) {
    const issues = [];

    for (const cs of cityStates) {
      const migrationRate = Math.abs(cs.migrationBalance) / Math.max(1, cs.previousPopulation);

      if (cs.housingPressure >= state.config.issueThreshold) {
        issues.push(issue(
          `housing_${cs.id}`, "HOUSING_PRESSURE", cs.housingPressure,
          {
            cityId: cs.id,
            locationId: cs.id,
            causes: [
              ...(migrationRate > .01 ? ["rapid_population_growth"] : []),
              "insufficient_housing"
            ]
          }
        ));
      }

      if (cs.unemploymentRate >= .10) {
        issues.push(issue(
          `unemployment_${cs.id}`, "HIGH_UNEMPLOYMENT",
          clamp((cs.unemploymentRate - .07) / .18, 0, 1),
          {
            cityId: cs.id,
            locationId: cs.id,
            causes: ["insufficient_jobs"]
          }
        ));
      }

      if (cs.servicePressure >= .40) {
        issues.push(issue(
          `services_${cs.id}`, "SERVICE_OVERLOAD",
          cs.servicePressure,
          {
            cityId: cs.id,
            locationId: cs.id,
            causes: ["population_exceeds_service_capacity"]
          }
        ));
      }

      if (cs.livingStandard <= 42) {
        issues.push(issue(
          `living_${cs.id}`, "LOW_LIVING_STANDARD",
          clamp((48 - cs.livingStandard) / 28, 0, 1),
          {
            cityId: cs.id,
            locationId: cs.id,
            causes: livingStandardCauses(cs)
          }
        ));
      }

      if (migrationRate >= .015) {
        issues.push(issue(
          `migration_${cs.id}`, "RAPID_MIGRATION",
          clamp(migrationRate / state.config.crisisMigrationCap, 0, 1),
          {
            cityId: cs.id,
            locationId: cs.id,
            direction: cs.migrationBalance >= 0 ? "inflow" : "outflow",
            causes: cs.migrationBalance >= 0
              ? ["high_city_attractiveness"]
              : ["low_city_attractiveness"]
          }
        ));
      }

      // A true labor shortage means local labor supply is too small for the
      // available job stock. Unfilled jobs alone are not enough: they may
      // reflect skill mismatch or a Module-3 production constraint.
      const laborGap = Math.max(0, cs.activeLaborDemand - cs.workforce);
      const laborShortageSeverity = cs.activeLaborDemand > 0
        ? laborGap / cs.activeLaborDemand
        : 0;
      if (laborShortageSeverity >= .05) {
        issues.push(issue(
          `labor_${cs.id}`, "LABOR_SHORTAGE",
          clamp(laborShortageSeverity / .30, 0, 1),
          {
            cityId: cs.id,
            locationId: cs.id,
            causes: ["jobs_exceed_local_labor_supply"]
          }
        ));
      }
    }

    for (const r of Object.values(state.region)) {
      if (r.migrationBalance < -Math.max(500, r.population * .006) && r.satisfaction < 48) {
        issues.push(issue(
          `decline_${r.id}`, "REGIONAL_DECLINE",
          clamp((-r.migrationBalance / Math.max(1,r.population)) / .04 + (48-r.satisfaction)/40, 0, 1),
          {
            regionId: r.id,
            locationId: r.id,
            causes: ["population_outflow", "low_satisfaction"]
          }
        ));
      }
    }

    for (const countryId of [...new Set(cityStates.map(c => c.countryId))]) {
      const inequality = calculateRegionalInequality(countryId);
      if (inequality >= state.config.inequalityThreshold) {
        const sorted = Object.values(state.region)
          .filter(r => r.countryId === countryId)
          .sort((a,b)=>a.livingStandard-b.livingStandard);

        issues.push(issue(
          `regional_inequality_${countryId}`, "REGIONAL_INEQUALITY",
          clamp((inequality - state.config.inequalityThreshold) / .45, 0, 1),
          {
            countryId,
            affectedRegionIds: sorted
              .slice(0, Math.max(1, Math.ceil(sorted.length/2)))
              .map(r=>r.id),
            causes: ["income_gap", "employment_gap", "living_standard_gap", "infrastructure_gap"]
          }
        ));
      }
    }

    state.socialIssues = issues.sort((a,b)=>b.severity-a.severity);
  }

  function livingStandardCauses(cs) {
    const causes = [];
    if (cs.unemploymentRate > .08) causes.push("high_unemployment");
    if (cs.housingPressure > .25) causes.push("housing_pressure");
    if (cs.housingCost > 1.15) causes.push("high_housing_cost");
    if (cs.foodPrice > 1.08) causes.push("high_food_price");
    if (cs.effectiveServices < 45) causes.push("weak_services");
    return causes.length ? causes : ["weak_disposable_living_power"];
  }

  function syncIssueOutput(gameState) {
    // Non-destructive: Module 7 can read Population.getSocialIssues(),
    // while shared gameState also receives a module-owned snapshot.
    if (!gameState) return;
    gameState.issues ||= {};
    gameState.issues.population = state.socialIssues.map(x => ({ ...x }));
  }

  function update(gameState, options = {}) {
    if (!gameState || !gameState.cities) {
      throw new Error("Population.update(gameState): gameState.cities is required.");
    }
    state.gameState = gameState;
    state.config = { ...state.config, ...(options.config || {}) };

    const currentTurn = gameState.turn ?? gameState.time?.turn ?? gameState.year;
    if (!options.force && currentTurn != null && state.lastUpdateTurn === currentTurn) {
      return snapshot();
    }

    const cityEntries = asEntries(gameState.cities)
      .filter(([, city]) => city && city.disabled !== true && city.active !== false);

    const cityStates = [];
    const economies = {};

    // 1–7: read economy, workforce, unemployment, housing, living standard, attractiveness.
    for (const [cityId, city] of cityEntries) {
      city.id ||= cityId;
      const cs = ensureCityState(gameState, cityId, city);
      cs.countryId = countryIdOf(city, gameState);
      cs.regionId = regionIdOf(city);
      const e = economies[cityId] = cityEconomy(gameState, cityId);
      const infra = infrastructureContext(gameState, city);

      calculateLabor(cs, e);
      advanceHousingYear(cs);
      calculateHousingState(cs, false);
      updateServices(cs, city, infra);
      calculateLivingStandard(cs, e, infra);
      calculateAttractiveness(cs, e, infra);
      cityStates.push(cs);
    }

    // 8–9: migration and population update.
    const migration = calculateMigration(gameState, cityStates, economies);
    state.migrationFlows = migration.flows;
    applyPopulationChanges(gameState, cityStates, migration);
    applyGroupMigration(cityStates, migration);

    // Recompute housing/labor/living conditions after people actually move.
    for (const cs of cityStates) {
      const e = economies[cs.id];
      const city = getCity(gameState, cs.id);
      const infra = infrastructureContext(gameState, city);
      calculateLabor(cs, e);
      calculateHousingState(cs, true);
      planHousingConstruction(cs);
      updateServices(cs, city, infra);
      calculateLivingStandard(cs, e, infra);
      calculateAttractiveness(cs, e, infra);
    }

    // 10–15: groups, regions, country support, issues, map already notified above.
    calculateGroups(gameState, cityStates, economies);
    calculateRegions(gameState, cityStates);
    calculatePublicSupport(gameState, cityStates);
    detectIssues(cityStates);
    syncIssueOutput(gameState);

    state.lastUpdateTurn =
      gameState.turn ?? gameState.time?.turn ?? gameState.year ?? Date.now();

    const economicFeedback = buildEconomicFeedback(cityStates);

    gameState.population ||= {};
    gameState.population.cities = state.city;
    gameState.population.regions = state.region;
    gameState.population.groups = state.groups;
    gameState.population.countries = state.countries;
    gameState.population.national = state.national;
    gameState.population.migrationFlows = state.migrationFlows;
    gameState.population.socialIssues = state.socialIssues;
    gameState.population.economicFeedback = economicFeedback;

    return snapshot();
  }

  function snapshot() {
    return {
      cities: state.city,
      regions: state.region,
      groups: state.groups,
      countries: state.countries,
      national: state.national,
      migrationFlows: state.migrationFlows,
      socialIssues: state.socialIssues,
      lastUpdateTurn: state.lastUpdateTurn
    };
  }

  function getCityPopulation(cityId) {
    const c = state.city[cityId];
    if (!c) return null;
    return {
      cityId,
      population: c.population,
      childrenPopulation: c.childrenPopulation,
      workingAgePopulation: c.workingAgePopulation,
      elderlyPopulation: c.elderlyPopulation,
      workforce: c.workforce,
      households: round(c.households),
      housingCapacity: round(c.housingCapacity),
      housingDemand: round(c.housingDemand),
      housingShortage: c.housingShortage,
      housingCost: round(c.housingCost, 3),
      housingConstruction: c.housingConstruction ? { ...c.housingConstruction } : null,
      unemploymentRate: round(c.unemploymentRate, 4),
      averageIncome: round(c.averageIncome, 2),
      livingStandard: round(c.livingStandard, 2),
      migrationBalance: c.migrationBalance
    };
  }

  function getCityAttractiveness(cityId) {
    const c = state.city[cityId];
    if (!c) return null;
    return {
      cityId,
      attractiveness: round(c.attractiveness, 1),
      reasons: c.attractivenessReasons.map(x => ({ ...x }))
    };
  }

  function getRegionSociety(regionId, countryId) {
    if (countryId) {
      const match = Object.values(state.region).find(
        r => r.id === regionId && r.countryId === countryId
      );
      return match ? { ...match } : null;
    }
    return state.region[regionId] ? { ...state.region[regionId] } : null;
  }

  function getGroupSatisfaction(groupId, countryId) {
    const cid =
      countryId ??
      state.gameState?.playerCountryId ??
      Object.keys(state.countries)[0];
    const g = state.countries[cid]?.groups?.[groupId];
    return g ? { ...g } : null;
  }

  function getPublicSupport(countryId) {
    const cid =
      countryId ??
      state.gameState?.playerCountryId ??
      Object.keys(state.countries)[0];
    const n = state.countries[cid]?.national;
    return n ? { ...n } : null;
  }

  function getMigrationFlows() {
    return state.migrationFlows.map(f => ({ ...f, causes: [...f.causes] }));
  }

  function getSocialIssues() {
    return state.socialIssues.map(i => ({ ...i, causes: i.causes ? [...i.causes] : undefined }));
  }

  function getEconomicFeedback(cityId) {
    const feedback = state.gameState?.population?.economicFeedback || {};
    return cityId ? (feedback[cityId] ? { ...feedback[cityId] } : null)
                  : Object.fromEntries(Object.entries(feedback).map(([k,v]) => [k,{...v}]));
  }

  function getDebugSnapshot() {
    return {
      city: Object.values(state.city).map(c => ({
        city: c.name,
        cityId: c.id,
        population: c.population,
        children: c.childrenPopulation,
        workingAge: c.workingAgePopulation,
        elderly: c.elderlyPopulation,
        workforce: c.workforce,
        jobs: c.jobsAvailable,
        jobsFilled: c.jobsFilled,
        unemployment: round(c.unemploymentRate * 100, 1) + "%",
        averageIncome: round(c.averageIncome, 1),
        housingCapacity: round(c.housingCapacity),
        housingCost: round(c.housingCost, 2),
        housingPressure: round(c.housingPressure, 2),
        housingPipeline: round(c.housingConstruction?.pipelineCapacity || 0),
        serviceCapacity: round(c.serviceCapacity),
        servicePressure: round(c.servicePressure, 2),
        effectiveServices: round(c.effectiveServices, 1),
        livingStandard: round(c.livingStandard, 1),
        attractiveness: round(c.attractiveness, 1),
        migration: c.migrationBalance
      })),
      region: Object.values(state.region).map(r => ({
        region: r.name,
        regionId: r.id,
        population: r.population,
        averageIncome: r.averageIncome,
        livingStandard: r.livingStandard,
        satisfaction: r.satisfaction,
        migrationBalance: r.migrationBalance
      })),
      socialGroup: GROUPS.map(g => ({
        group: g,
        populationShare: round((state.groups[g]?.populationShare || 0) * 100, 1) + "%",
        satisfaction: round(state.groups[g]?.satisfaction || 50, 1),
        mainPositiveFactors: state.groups[g]?.positiveFactors || [],
        mainNegativeFactors: state.groups[g]?.negativeFactors || []
      })),
      national: { ...state.national },
      countries: Object.fromEntries(
        Object.entries(state.countries).map(([countryId, c]) => [
          countryId,
          {
            national: c.national ? { ...c.national } : null,
            regions: c.regions ? Object.values(c.regions).map(r => ({ ...r })) : [],
            groups: c.groups ? Object.fromEntries(
              Object.entries(c.groups).map(([g,v]) => [g,{...v}])
            ) : {}
          }
        ])
      )
    };
  }

  function reset() {
    state.city = {};
    state.region = {};
    state.groups = {};
    state.countries = {};
    state.migrationFlows = [];
    state.socialIssues = [];
    state.national = {
      population: 0,
      publicSupport: 50,
      publicSupportDelta: 0,
      regionalInequality: 0,
      reasons: []
    };
    state.lastUpdateTurn = null;
  }

  const Population = {
    GROUPS: [...GROUPS],
    update,
    reset,
    snapshot,
    getCityPopulation,
    getCityAttractiveness,
    getRegionSociety,
    getGroupSatisfaction,
    getPublicSupport,
    getMigrationFlows,
    getSocialIssues,
    getEconomicFeedback,
    getDebugSnapshot
  };

  global.Population = Population;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = Population;
  }
})(typeof window !== "undefined" ? window : globalThis);
/* ===== END MODULE 4 — POPULATION & SOCIETY ===== */
