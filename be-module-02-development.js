/*
 * Border Epoch — Module 2: Exploration, Development & Infrastructure
 * Version 2.0 — discovery-before-mining contract
 *
 * HARD BOUNDARY
 * - Reads Module 1 resource ENDOWMENT / terrain / geology seed.
 * - Owns exploration projects, exploration results, discovered deposits,
 *   mine development, facilities, power infrastructure and connections.
 * - DOES NOT decide prices, profits, migration, diplomacy, AI policy or stories.
 *
 * Project-wide time contract: 1 turn = 1 year.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.Development = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = '2.1.0';
  let sequence = 1;
  let WorldRef = null;

  /* Exploration is method-based, not a mandatory three-button ladder.
     Legacy names remain as aliases so older UI/adapters do not break. */
  const EXPLORATION_METHODS = {
    surface_mapping: {
      id:'surface_mapping', label:'Surface Mapping', cost:2, years:1,
      informationGain:.18, reservePrecision:null, repeatable:false,
      description:'Cheap geological mapping and outcrop inspection.'
    },
    geophysics: {
      id:'geophysics', label:'Geophysical Survey', cost:4, years:1,
      informationGain:.28, reservePrecision:null, repeatable:false,
      description:'Magnetic, gravity or seismic-style regional targeting.'
    },
    wildcat_drilling: {
      id:'wildcat_drilling', label:'Exploratory Drilling', cost:7, years:1,
      informationGain:.55, reservePrecision:.42, repeatable:true,
      description:'Tests a specific parcel directly; may discover a deposit without prior surface work.'
    },
    delineation_drilling: {
      id:'delineation_drilling', label:'Delineation Drilling', cost:10, years:1,
      informationGain:.30, reservePrecision:.20, repeatable:true,
      minimumConfidence:.32,
      description:'Adds drill control and narrows reserve uncertainty around a target.'
    },
    engineering_assessment: {
      id:'engineering_assessment', label:'Engineering Assessment', cost:5, years:1,
      informationGain:.10, reservePrecision:.16, repeatable:true,
      requiresDeposit:true,
      description:'Assesses depth, ground conditions, water, access and mine engineering difficulty.'
    }
  };

  const EXPLORATION_ALIASES = {
    preliminary:'surface_mapping',
    detailed:'wildcat_drilling',
    assessment:'engineering_assessment'
  };

  const EXPLORATION_STAGES = {
    preliminary:Object.assign({order:1},EXPLORATION_METHODS.surface_mapping),
    detailed:Object.assign({order:2},EXPLORATION_METHODS.wildcat_drilling),
    assessment:Object.assign({order:3},EXPLORATION_METHODS.engineering_assessment)
  };

  const MINE_BASE = {
    coal: { baseCost: 20, baseYears: 2, baseCapacity: 10, type: 'coal_mine' },
    iron: { baseCost: 22, baseYears: 2, baseCapacity: 9, type: 'iron_mine' },
    copper: { baseCost: 26, baseYears: 3, baseCapacity: 8, type: 'copper_mine' },
    oil: { baseCost: 30, baseYears: 3, baseCapacity: 9, type: 'oil_field' }
  };

  const FACILITY_LEVELS = {
    coal_mine: {
      maxLevel: 5,
      levels: {
        1:{name:'Small Coal Mine',capacity:10,powerDemand:2,transportDemand:6,visualStage:'small_coal_mine',upgradeCost:0,upgradeTurns:0},
        2:{name:'Mechanized Coal Mine',capacity:22,powerDemand:4,transportDemand:14,visualStage:'mechanized_coal_mine',upgradeCost:14,upgradeTurns:2},
        3:{name:'Industrial Coal Mine',capacity:38,powerDemand:7,transportDemand:28,visualStage:'industrial_coal_mine',upgradeCost:23,upgradeTurns:2},
        4:{name:'Deep Mining Complex',capacity:55,powerDemand:11,transportDemand:45,visualStage:'deep_mining_complex',upgradeCost:34,upgradeTurns:3},
        5:{name:'Northwest Mining Complex',capacity:75,powerDemand:16,transportDemand:65,visualStage:'national_mining_complex',upgradeCost:48,upgradeTurns:4}
      }
    },
    iron_mine: {
      maxLevel: 5,
      levels: {
        1:{name:'Small Iron Mine',capacity:9,powerDemand:2,transportDemand:6,visualStage:'small_iron_mine',upgradeCost:0,upgradeTurns:0},
        2:{name:'Mechanized Iron Mine',capacity:19,powerDemand:4,transportDemand:13,visualStage:'mechanized_iron_mine',upgradeCost:16,upgradeTurns:2},
        3:{name:'Industrial Iron Mine',capacity:31,powerDemand:7,transportDemand:25,visualStage:'industrial_iron_mine',upgradeCost:26,upgradeTurns:2},
        4:{name:'Deep Iron Complex',capacity:46,powerDemand:11,transportDemand:40,visualStage:'deep_iron_complex',upgradeCost:38,upgradeTurns:3},
        5:{name:'National Iron Complex',capacity:64,powerDemand:16,transportDemand:58,visualStage:'national_iron_complex',upgradeCost:54,upgradeTurns:4}
      }
    },
    steelworks: {
      maxLevel: 5,
      levels: {
        1:{name:'Small Steelworks',capacity:8,powerDemand:6,transportDemand:12,coalInput:8,ironInput:8,visualStage:'small_steelworks',upgradeCost:0,upgradeTurns:0},
        2:{name:'Integrated Steelworks',capacity:18,powerDemand:10,transportDemand:22,coalInput:16,ironInput:16,visualStage:'integrated_steelworks',upgradeCost:28,upgradeTurns:2},
        3:{name:'Heavy Steel Complex',capacity:32,powerDemand:17,transportDemand:38,coalInput:27,ironInput:27,visualStage:'heavy_steel_complex',upgradeCost:42,upgradeTurns:3},
        4:{name:'Modern Steel Complex',capacity:50,powerDemand:25,transportDemand:58,coalInput:40,ironInput:40,visualStage:'modern_steel_complex',upgradeCost:60,upgradeTurns:3},
        5:{name:'National Steel Hub',capacity:75,powerDemand:36,transportDemand:82,coalInput:58,ironInput:58,visualStage:'national_steel_hub',upgradeCost:82,upgradeTurns:4}
      }
    },
    basic_factory: {
      maxLevel: 4,
      levels: {
        1:{name:'Workshop Factory',capacity:6,powerDemand:3,transportDemand:4,visualStage:'workshop_factory',upgradeCost:0,upgradeTurns:0},
        2:{name:'Manufacturing Plant',capacity:15,powerDemand:6,transportDemand:10,visualStage:'manufacturing_plant',upgradeCost:18,upgradeTurns:2},
        3:{name:'Industrial Complex',capacity:28,powerDemand:11,transportDemand:20,visualStage:'industrial_complex',upgradeCost:30,upgradeTurns:3},
        4:{name:'Advanced Manufacturing Zone',capacity:45,powerDemand:18,transportDemand:34,visualStage:'advanced_manufacturing_zone',upgradeCost:46,upgradeTurns:3}
      }
    },
    power_plant: {
      maxLevel: 4,
      levels: {
        1:{name:'Local Power Plant',capacity:12,powerSupply:12,powerDemand:0,transportDemand:4,visualStage:'local_power_plant',upgradeCost:0,upgradeTurns:0},
        2:{name:'Regional Power Station',capacity:28,powerSupply:28,powerDemand:0,transportDemand:9,visualStage:'regional_power_station',upgradeCost:24,upgradeTurns:2},
        3:{name:'Major Power Station',capacity:50,powerSupply:50,powerDemand:0,transportDemand:16,visualStage:'major_power_station',upgradeCost:39,upgradeTurns:3},
        4:{name:'National Power Complex',capacity:80,powerSupply:80,powerDemand:0,transportDemand:26,visualStage:'national_power_complex',upgradeCost:58,upgradeTurns:4}
      }
    },
    port: {
      maxLevel: 5,
      levels: {
        1:{name:'Local Port',capacity:10,tradeCapacity:10,powerDemand:1,transportDemand:4,visualStage:'local_port',upgradeCost:0,upgradeTurns:0},
        2:{name:'Regional Port',capacity:25,tradeCapacity:25,powerDemand:2,transportDemand:9,visualStage:'regional_port',upgradeCost:20,upgradeTurns:2},
        3:{name:'Major Trade Port',capacity:50,tradeCapacity:50,powerDemand:3,transportDemand:18,visualStage:'major_trade_port',upgradeCost:34,upgradeTurns:3},
        4:{name:'Industrial Harbor',capacity:90,tradeCapacity:90,powerDemand:4,transportDemand:32,visualStage:'industrial_harbor',upgradeCost:52,upgradeTurns:3},
        5:{name:'Global Shipping Hub',capacity:150,tradeCapacity:150,powerDemand:6,transportDemand:52,visualStage:'global_shipping_hub',upgradeCost:78,upgradeTurns:4}
      }
    }
  };

  const CONNECTION_LEVELS = {
    railway: {
      maxLevel: 5,
      levels: {
        1:{name:'Light Railway',capacity:15,visualStage:'light_railway',upgradeCost:0,upgradeTurns:0},
        2:{name:'Mainline Railway',capacity:30,visualStage:'mainline_railway',upgradeCost:16,upgradeTurns:2},
        3:{name:'Double-Track Railway',capacity:55,visualStage:'double_track_railway',upgradeCost:28,upgradeTurns:2},
        4:{name:'Electrified Mainline',capacity:90,visualStage:'electrified_mainline',upgradeCost:44,upgradeTurns:3},
        5:{name:'Heavy Freight Corridor',capacity:140,visualStage:'heavy_freight_corridor',upgradeCost:68,upgradeTurns:4}
      }
    }
  };

  function clamp(v, a = 0, b = 1) { return Math.max(a, Math.min(b, Number(v) || 0)); }
  function deepClone(v) { return JSON.parse(JSON.stringify(v)); }
  function values(x) { return Object.values(x || {}); }
  function nowYear(state) { return Number(state?.time?.year ?? state?.turn ?? 0); }

  function hashString(input) {
    let h = 2166136261 >>> 0;
    const s = String(input);
    for (let i=0;i<s.length;i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function unitNoise(...parts) { return (hashString(parts.join('|')) % 1000003) / 1000003; }

  function setWorld(worldApi) {
    WorldRef = worldApi;
    return api;
  }
  function world() {
    if (WorldRef) return WorldRef;
    if (typeof globalThis !== 'undefined' && globalThis.World) return globalThis.World;
    throw new Error('Module 2 requires Module 1 World. Call Development.setWorld(World) first.');
  }

  function ensureState(state) {
    if (!state || typeof state !== 'object') throw new Error('Development requires gameState');
    state.projects = state.projects || {};
    state.facilities = state.facilities || {};
    state.connections = state.connections || {};
    state.explorationResults = state.explorationResults || {};
    state.discoveredDeposits = state.discoveredDeposits || {};
    state.events = state.events || [];
    state.history = state.history || [];
    state.modules = state.modules || {};
    state.modules.module2 = state.modules.module2 || { version: VERSION, initialized: false };
    state.time = state.time || { year: 0 };
    return state;
  }

  function initializeState(state) {
    ensureState(state);
    world().initialize(state);
    values(state.facilities).forEach(f => {
      if (FACILITY_LEVELS[f.type]) applyFacilityLevel(f, f.level || 1, state, false);
    });
    values(state.connections).forEach(c => {
      if (CONNECTION_LEVELS[c.type]) applyConnectionLevel(c, c.level || 1, state, false);
    });
    recalculatePower(state);
    state.modules.module2.initialized = true;
    return state;
  }

  function nextId(prefix) { return `${prefix}_${sequence++}`; }

  function emit(state, type, payload = {}) {
    const e = Object.assign({ id: nextId('evt'), type, sourceModule:'development', year: nowYear(state) }, deepClone(payload));
    state.events.push(e);
    state.history.push(e);
    return e;
  }

  function activeProjectConflict(state, pred) {
    return values(state.projects).find(p => p.status === 'under_construction' && pred(p));
  }

  function resolveMethod(methodOrAlias){
    const id=EXPLORATION_ALIASES[methodOrAlias]||methodOrAlias;
    return EXPLORATION_METHODS[id]||null;
  }

  function parcelList(regionId,state){ return world().getGeologicalParcels(regionId,state); }
  function resolveParcelId(regionId,state,parcelId=null){
    const parcels=parcelList(regionId,state);
    const p=parcelId?parcels.find(x=>x.id===parcelId):parcels[0];
    if(!p)throw new Error(`Unknown geological parcel ${parcelId} in ${regionId}`);
    return p.id;
  }

  function explorationKey(regionId, resourceType, parcelId) { return `${regionId}::${resourceType}::${parcelId}`; }
  function explorationResultsFor(regionId, resourceType, state, parcelId=null) {
    return values(state.explorationResults)
      .filter(r => r.regionId===regionId && r.resourceType===resourceType && (!parcelId || r.parcelId===parcelId))
      .sort((a,b) => (a.completedYear||0)-(b.completedYear||0) || String(a.id).localeCompare(String(b.id)));
  }
  function usableExplorationResultsFor(regionId,resourceType,parcelId,state){
    const basis=world().getExplorationBasis(regionId,resourceType,state,parcelId);
    return explorationResultsFor(regionId,resourceType,state,parcelId).filter(r=>Number(r.geologyRevision??r.basisRevision??0)===Number(basis.geologyRevision||0));
  }
  function latestExplorationResult(regionId,resourceType,state,parcelId=null){
    const list=parcelId?usableExplorationResultsFor(regionId,resourceType,parcelId,state):explorationResultsFor(regionId,resourceType,state);
    return list[list.length-1]||null;
  }

  function knowledgeFor(regionId,resourceType,parcelId,state){
    const results=usableExplorationResultsFor(regionId,resourceType,parcelId,state);
    let confidence=0, bestPrecision=null, signal=0;
    const methodsUsed=[];
    results.forEach(r=>{
      confidence=Math.max(confidence,Number(r.confidence||0));
      signal=Math.max(signal,Number(r.signalEvidence||0));
      if(r.reservePrecision!=null) bestPrecision=bestPrecision==null?Number(r.reservePrecision):Math.min(bestPrecision,Number(r.reservePrecision));
      if(r.explorationMethod)methodsUsed.push(r.explorationMethod);
    });
    return {confidence,bestPrecision,signal,methodsUsed,results};
  }

  function deriveSubsurface(regionId, resourceType, state, parcelId=null) {
    parcelId=resolveParcelId(regionId,state,parcelId);
    const basis=world().getExplorationBasis(regionId,resourceType,state,parcelId);
    const seed=`${basis.worldSeed}|${basis.geologySeed}|${regionId}|${parcelId}|${resourceType}|subsurface`;
    const u1=unitNoise(seed,'mineralization'),u2=unitNoise(seed,'reserve'),u3=unitNoise(seed,'quality'),u4=unitNoise(seed,'depth');
    const u5=unitNoise(seed,'stability'),u6=unitNoise(seed,'water'),u7=unitNoise(seed,'continuity');
    const mineralization=clamp(basis.potential*.86+(u1-.5)*.23);
    const rawReserve=Math.max(0,(mineralization-.20)*125*(.68+u2*.72));
    const trueReserve=Number(rawReserve.toFixed(1));
    const quality=clamp(.22+basis.potential*.48+(u3-.5)*.30);
    const t=basis.terrain||{},g=basis.geology||{};
    const rugged=clamp(t.ruggedness||0),complexity=clamp(g.complexity??.35);
    const depth=clamp(.24+complexity*.18+(u4-.5)*.44);
    const stability=clamp(.72-complexity*.32-rugged*.08+(u5-.5)*.32);
    const waterRisk=clamp((t.waterAccess||.5)*.30+complexity*.12+(u6-.5)*.38);
    const continuity=clamp(.30+basis.potential*.44-complexity*.10+(u7-.5)*.30);
    const accessibility=clamp((t.buildability??.6)*.56+(1-rugged)*.34+.10);
    const nearby=basis.nearbyEndowment||{};
    const secondaryIndications=Object.entries(nearby)
      .filter(([r,p])=>r!==resourceType&&p>=.55)
      .sort((a,b)=>b[1]-a[1])
      .filter(([r,p])=>p>=.70||unitNoise(seed,'secondary',r)>.28)
      .slice(0,2).map(([r,p])=>({resourceType:r,indicationBand:p>=.74?'promising':'possible'}));
    const techRequired=depth>=.88?3:depth>=.74?2:1;
    return {regionId,parcelId,resourceType,geologyRevision:basis.geologyRevision,surfaceRevision:basis.surfaceRevision,mineralization,trueReserve,quality,depth,stability,waterRisk,continuity,accessibility,techRequired,secondaryIndications};
  }

  function band(v, thresholds, labels) { for(let i=0;i<thresholds.length;i++)if(v<thresholds[i])return labels[i]; return labels[labels.length-1]; }
  function qualityClass(v){return band(v,[.30,.48,.68,.84],['very_low','low','medium','high','very_high']);}
  function depthClass(v){return band(v,[.30,.52,.72,.88],['shallow','moderate','deep','very_deep','extreme']);}
  function stabilityClass(v){return band(v,[.32,.50,.70,.84],['unstable','fractured','mixed','stable','very_stable']);}
  function riskClass(v){return band(v,[.25,.48,.70,.86],['low','moderate','high','very_high','extreme']);}
  function accessClass(v){return band(v,[.28,.48,.68,.84],['very_poor','poor','moderate','good','excellent']);}

  function reserveEstimate(truth,precision){
    const p=Math.max(.10,Number(precision??.42));
    const width=Math.max(2.5,truth.trueReserve*p);
    const min=Math.max(0,Math.round((truth.trueReserve-width)*10)/10);
    const max=Math.max(min,Math.round((truth.trueReserve+width)*10)/10);
    return {min,max};
  }

  function engineeringAssessment(truth,state){
    const terrain=world().getRegionTerrain(truth.regionId,state);
    const terrainPenalty=clamp((terrain.ruggedness||0)*.56+(1-(terrain.buildability??.6))*.44);
    const score=clamp(truth.depth*.28+terrainPenalty*.22+(1-truth.stability)*.20+truth.waterRisk*.16+(1-truth.accessibility)*.14);
    const difficulty=score<.25?'very_low':score<.42?'low':score<.60?'moderate':score<.78?'high':'very_high';
    return {score:Number(score.toFixed(4)),difficulty,factors:{depth:depthClass(truth.depth),terrain:terrainPenalty<.25?'easy':terrainPenalty<.48?'moderate':terrainPenalty<.70?'difficult':'very_difficult',geology:stabilityClass(truth.stability),waterRisk:riskClass(truth.waterRisk),access:accessClass(truth.accessibility)},technologyRequired:truth.techRequired};
  }

  function methodInformationGain(method,truth,basis,attemptIndex){
    const complexity=clamp(basis.geology?.complexity??.35);
    const repeatPenalty=Math.max(.55,1-attemptIndex*.12);
    const geologyPenalty=1-complexity*.28;
    return clamp(method.informationGain*repeatPenalty*geologyPenalty,.04,.72);
  }

  function visibleMethodResult(methodId,truth,knowledge,precision,state){
    if(methodId==='surface_mapping'){
      const signal=clamp(truth.mineralization*.72+truth.continuity*.18+truth.accessibility*.10);
      return {signalStrength:signal>=.68?'strong':signal>=.48?'promising':signal>=.28?'weak':'minimal',surfaceEvidence:qualityClass(signal),secondaryIndications:deepClone(truth.secondaryIndications)};
    }
    if(methodId==='geophysics'){
      const anomaly=clamp(truth.mineralization*.62+truth.continuity*.25+(1-truth.depth)*.13);
      return {anomalyStrength:qualityClass(anomaly),targetQuality:anomaly>=.62?'high_priority':anomaly>=.40?'follow_up':'weak',secondaryIndications:deepClone(truth.secondaryIndications)};
    }
    if(methodId==='wildcat_drilling'||methodId==='delineation_drilling'){
      return {reserveEstimate:reserveEstimate(truth,precision),qualityEstimate:qualityClass(truth.quality),depthEstimate:depthClass(truth.depth),continuityEstimate:qualityClass(truth.continuity),secondaryIndications:deepClone(truth.secondaryIndications)};
    }
    if(methodId==='engineering_assessment'){
      return {reserveEstimate:reserveEstimate(truth,precision),qualityEstimate:qualityClass(truth.quality),depthEstimate:depthClass(truth.depth),engineering:engineeringAssessment(truth,state),secondaryIndications:deepClone(truth.secondaryIndications)};
    }
    return {};
  }

  function depositIsGeologicallyCurrent(d,state){
    if(!d||!d.regionId||!d.resourceType||!d.parcelId)return true; // compatibility for manually seeded test deposits
    try{
      const basis=world().getExplorationBasis(d.regionId,d.resourceType,state,d.parcelId);
      return Number(d.geologyRevision??basis.geologyRevision)===Number(basis.geologyRevision);
    }catch(_){return false;}
  }
  function existingDeposit(regionId,resourceType,state,parcelId=null){
    return values(state.discoveredDeposits).find(d=>d.regionId===regionId&&d.resourceType===resourceType&&(!parcelId||d.parcelId===parcelId)&&d.status!=='invalidated'&&depositIsGeologicallyCurrent(d,state))||null;
  }

  function createOrUpdateDeposit(truth,visible,confidence,state,methodId){
    if(!['wildcat_drilling','delineation_drilling','engineering_assessment'].includes(methodId))return null;
    if(truth.trueReserve<6||truth.mineralization<.28||confidence<.42)return null;
    let d=existingDeposit(truth.regionId,truth.resourceType,state,truth.parcelId);
    if(!d){
      d={id:nextId(`deposit_${truth.resourceType}`),resourceType:truth.resourceType,regionId:truth.regionId,parcelId:truth.parcelId,countryId:state.regions?.[truth.regionId]?.countryId||null,status:'delineated',reserveEstimate:deepClone(visible.reserveEstimate||reserveEstimate(truth,.50)),qualityEstimate:visible.qualityEstimate||qualityClass(truth.quality),depthEstimate:visible.depthEstimate||depthClass(truth.depth),confidence,assessment:null,developed:false,mineFacilityId:null,discoveryYear:nowYear(state),geologyRevision:truth.geologyRevision};
      state.discoveredDeposits[d.id]=d;
      emit(state,'DEPOSIT_DISCOVERED',{depositId:d.id,regionId:d.regionId,parcelId:d.parcelId,resourceType:d.resourceType});
    }else{
      if(visible.reserveEstimate)d.reserveEstimate=deepClone(visible.reserveEstimate);
      if(visible.qualityEstimate)d.qualityEstimate=visible.qualityEstimate;
      if(visible.depthEstimate)d.depthEstimate=visible.depthEstimate;
      d.confidence=Math.max(d.confidence||0,confidence);d.geologyRevision=truth.geologyRevision;
    }
    return d;
  }

  function getExplorationMethods(regionId,resourceType,state,options={}){
    ensureState(state);const parcelId=resolveParcelId(regionId,state,options.parcelId||null);const k=knowledgeFor(regionId,resourceType,parcelId,state);const dep=existingDeposit(regionId,resourceType,state,parcelId);
    return Object.values(EXPLORATION_METHODS).map(m=>{
      let available=true,reason=null;
      if(!m.repeatable&&k.methodsUsed.includes(m.id)){available=false;reason='method already completed for this parcel';}
      if(m.minimumConfidence!=null&&k.confidence<m.minimumConfidence&&!dep){available=false;reason=`needs confidence >= ${m.minimumConfidence}`;}
      if(m.requiresDeposit&&!dep){available=false;reason='requires a discovered deposit';}
      return {id:m.id,label:m.label,available,reason,cost:m.cost,years:m.years,description:m.description};
    });
  }

  function canStartExploration(regionId,resourceType,methodOrAlias,state,options={}){
    ensureState(state);const method=resolveMethod(methodOrAlias);if(!method)return{ok:false,error:`Unknown exploration method: ${methodOrAlias}`,missing:['valid exploration method']};
    const parcelId=resolveParcelId(regionId,state,options.parcelId||null);const basis=world().getExplorationBasis(regionId,resourceType,state,parcelId);const k=knowledgeFor(regionId,resourceType,parcelId,state);const dep=existingDeposit(regionId,resourceType,state,parcelId);
    if(activeProjectConflict(state,p=>p.type==='resource_exploration'&&p.regionId===regionId&&p.resourceType===resourceType&&p.parcelId===parcelId))return{ok:false,error:'An exploration project for this parcel/resource is already active.',missing:['finish current exploration']};
    if(!method.repeatable&&k.methodsUsed.includes(method.id))return{ok:false,error:`${method.label} is already complete for this parcel.`,missing:['different method or parcel']};
    if(method.minimumConfidence!=null&&k.confidence<method.minimumConfidence&&!dep)return{ok:false,error:`${method.label} requires more evidence first.`,missing:['more geological evidence']};
    if(method.requiresDeposit&&!dep)return{ok:false,error:'Engineering assessment requires a discovered geological deposit.',missing:['discovered deposit']};
    const terrain=world().getRegionTerrain(regionId,state);const terrainCostFactor=1+(terrain.ruggedness||0)*.35+(1-(terrain.buildability??.6))*.20;
    const adjustedCost=Math.max(1,Math.round(method.cost*terrainCostFactor));
    return{ok:true,method:method.id,legacyStage:methodOrAlias,parcelId,cost:adjustedCost,years:method.years,knowledge:deepClone(k),geologyRevision:basis.geologyRevision,requirements:[]};
  }

  function startExploration(regionId,resourceType,methodOrAlias,state,options={}){
    const check=canStartExploration(regionId,resourceType,methodOrAlias,state,options);if(!check.ok)return check;
    const p={id:nextId('project_exploration'),type:'resource_exploration',explorationMethod:check.method,explorationStage:methodOrAlias,resourceType,regionId,parcelId:check.parcelId,countryId:state.regions?.[regionId]?.countryId||null,name:`${resolveMethod(methodOrAlias).label} — ${resourceType}`,cost:check.cost,governmentCost:check.cost,totalTurns:check.years,turnsRemaining:check.years,status:'under_construction',startedYear:nowYear(state),basisGeologyRevision:check.geologyRevision,causalActionRef:options.causalActionRef||null};
    state.projects[p.id]=p;emit(state,'PROJECT_STARTED',{projectId:p.id,projectType:p.type,regionId,parcelId:p.parcelId,resourceType,explorationMethod:p.explorationMethod,causalActionRef:p.causalActionRef});return{ok:true,project:p};
  }

  function completeExplorationProject(p,state){
    const method=resolveMethod(p.explorationMethod||p.explorationStage);const parcelId=resolveParcelId(p.regionId,state,p.parcelId);const basis=world().getExplorationBasis(p.regionId,p.resourceType,state,parcelId);
    if(Number(p.basisGeologyRevision??basis.geologyRevision)!==Number(basis.geologyRevision)){
      const stale={id:nextId('exploration_result'),projectId:p.id,regionId:p.regionId,parcelId,resourceType:p.resourceType,explorationMethod:method.id,confidence:0,result:{},outcome:'geology_changed_during_project',stale:true,completedYear:nowYear(state),geologyRevision:basis.geologyRevision};
      state.explorationResults[stale.id]=stale;emit(state,'EXPLORATION_COMPLETED',{resultId:stale.id,projectId:p.id,regionId:p.regionId,parcelId,resourceType:p.resourceType,outcome:stale.outcome,causalActionRef:p.causalActionRef||null});return stale;
    }
    const truth=deriveSubsurface(p.regionId,p.resourceType,state,parcelId);const before=knowledgeFor(p.regionId,p.resourceType,parcelId,state);const attemptIndex=before.methodsUsed.filter(x=>x===method.id).length;
    const gain=methodInformationGain(method,truth,basis,attemptIndex);const confidence=clamp(1-(1-before.confidence)*(1-gain),.05,.97);
    const reservePrecision=method.reservePrecision==null?before.bestPrecision:before.bestPrecision==null?method.reservePrecision:Math.min(before.bestPrecision,method.reservePrecision*Math.max(.65,1-attemptIndex*.12));
    const visible=visibleMethodResult(method.id,truth,before,reservePrecision,state);let deposit=createOrUpdateDeposit(truth,visible,confidence,state,method.id);
    if(method.id==='engineering_assessment'){
      deposit=deposit||existingDeposit(p.regionId,p.resourceType,state,parcelId);
      if(deposit){deposit.assessment=deepClone(visible.engineering);deposit.status='assessed';deposit.confidence=Math.max(deposit.confidence||0,confidence);}
    }
    const signalEvidence=clamp(truth.mineralization*.72+truth.continuity*.18+truth.accessibility*.10);
    const result={id:nextId('exploration_result'),projectId:p.id,regionId:p.regionId,parcelId,resourceType:p.resourceType,explorationMethod:method.id,explorationStage:p.explorationStage||method.id,confidence:Number(confidence.toFixed(3)),informationGain:Number(gain.toFixed(3)),signalEvidence:Number(signalEvidence.toFixed(3)),reservePrecision:reservePrecision==null?null:Number(reservePrecision.toFixed(3)),result:visible,depositId:deposit?.id||null,commercialDepositId:deposit?.id||null,outcome:deposit?(method.id==='engineering_assessment'?'assessed_deposit':'geological_deposit_delineated'):(truth.trueReserve>=2?'noncommercial_or_uncertain_occurrence':'no_significant_occurrence'),completedYear:nowYear(state),geologyRevision:truth.geologyRevision,surfaceRevision:truth.surfaceRevision,stale:false};
    state.explorationResults[result.id]=result;emit(state,'EXPLORATION_COMPLETED',{resultId:result.id,projectId:p.id,regionId:p.regionId,parcelId,resourceType:p.resourceType,explorationMethod:method.id,outcome:result.outcome,causalActionRef:p.causalActionRef||null});
    if(visible.secondaryIndications?.length)visible.secondaryIndications.forEach(ind=>emit(state,'RESOURCE_INDICATION_FOUND',{regionId:p.regionId,parcelId,primaryResource:p.resourceType,resourceType:ind.resourceType,indicationBand:ind.indicationBand}));
    return result;
  }

  function terrainMultiplier(regionId,state){
    const t=world().getRegionTerrain(regionId,state);
    const rugged=t.ruggedness||0, build=t.buildability??.6;
    return 1 + rugged*.30 + (1-build)*.20;
  }
  function depthMultiplier(cls){return ({shallow:.90,moderate:1.00,deep:1.35,very_deep:1.70,extreme:2.10})[cls]||1.0;}
  function geologyMultiplier(cls){return ({very_stable:.90,stable:.95,mixed:1.08,fractured:1.22,unstable:1.50})[cls]||1.10;}
  function waterMultiplier(cls){return ({low:.95,moderate:1.06,high:1.18,very_high:1.32,extreme:1.48})[cls]||1.10;}
  function accessMultiplier(cls){return ({excellent:.88,good:.94,moderate:1.05,poor:1.22,very_poor:1.42})[cls]||1.08;}

  function estimateMineDevelopment(depositId,state,options={}){
    ensureState(state);
    const d=state.discoveredDeposits[depositId];
    if(!d)return{ok:false,error:'Unknown discovered deposit.'};
    if(!depositIsGeologicallyCurrent(d,state))return{ok:false,error:'Deposit evidence is stale after a geological revision; re-exploration is required.'};
    if(!d.assessment)return{ok:false,error:'Deposit requires development assessment before mine construction.'};
    const base=MINE_BASE[d.resourceType];
    if(!base)return{ok:false,error:`No mine development template for ${d.resourceType}.`};
    const f=d.assessment.factors;
    const costMultiplier=terrainMultiplier(d.regionId,state)*depthMultiplier(f.depth)*geologyMultiplier(f.geology)*waterMultiplier(f.waterRisk)*accessMultiplier(f.access);
    const totalCost=Math.max(1,Math.round(base.baseCost*costMultiplier));
    const durationMultiplier=.75+d.assessment.score*1.05;
    const totalTurns=Math.max(1,Math.ceil(base.baseYears*durationMultiplier));
    const miningTech=Number(state.technology?.mining ?? 1);
    const techBlocked=miningTech < Number(d.assessment.technologyRequired||1);
    const method=options.method||'state';
    const governmentCost=method==='foreign_funded'?Math.max(1,Math.round(totalCost*.35)):totalCost;
    const duration=method==='foreign_funded'?Math.max(1,totalTurns-1):totalTurns;
    return {
      ok:!techBlocked,
      depositId,
      resourceType:d.resourceType,
      difficulty:d.assessment.difficulty,
      engineeringScore:d.assessment.score,
      totalCost,
      governmentCost,
      totalTurns:duration,
      unmodifiedTurns:totalTurns,
      method,
      technologyRequired:d.assessment.technologyRequired,
      miningTechnology:miningTech,
      blockedReason:techBlocked?`Mining technology ${miningTech} is below required level ${d.assessment.technologyRequired}.`:null,
      costFactors:{terrain:terrainMultiplier(d.regionId,state),depth:depthMultiplier(f.depth),geology:geologyMultiplier(f.geology),water:waterMultiplier(f.waterRisk),access:accessMultiplier(f.access)}
    };
  }

  function canDevelopDeposit(depositId,state,options={}){
    ensureState(state);
    const d=state.discoveredDeposits[depositId];
    if(!d)return{ok:false,error:'Unknown discovered deposit.',missing:['discovered deposit']};
    if(!depositIsGeologicallyCurrent(d,state))return{ok:false,error:'Deposit evidence is stale after geological change.',missing:['re-exploration']};
    if(!d.assessment)return{ok:false,error:'Development assessment is required.',missing:['development assessment']};
    if(d.developed||d.mineFacilityId)return{ok:false,error:'Deposit is already developed.',missing:['undeveloped deposit']};
    if(activeProjectConflict(state,p=>p.depositId===depositId&&p.type==='mine_development'))return{ok:false,error:'Mine development already under construction.',missing:['finish current project']};
    const estimate=estimateMineDevelopment(depositId,state,options);
    if(!estimate.ok)return{ok:false,error:estimate.blockedReason,missing:['required mining technology'],estimate};
    return{ok:true,estimate,missing:[]};
  }

  function getMineDevelopmentOptions(depositId,state){
    const stateCheck=canDevelopDeposit(depositId,state,{method:'state'});
    const foreignCheck=canDevelopDeposit(depositId,state,{method:'foreign_funded'});
    return [
      {id:'state',label:'State Mine',available:stateCheck.ok,estimate:stateCheck.estimate||null},
      {id:'foreign_funded',label:'Foreign-funded Mine',available:foreignCheck.ok,estimate:foreignCheck.estimate||null},
      {id:'delay',label:'Leave Undeveloped',available:true,estimate:null}
    ];
  }
  function chooseMineDevelopmentOption(depositId,optionId,state,options={}){
    if(optionId==='delay'){
      emit(state,'MINE_DEVELOPMENT_DEFERRED',{depositId,causalActionRef:options.causalActionRef||null});
      return{ok:true,deferred:true,depositId};
    }
    return startMineDevelopment(depositId,Object.assign({},options,{method:optionId}),state);
  }

  function startMineDevelopment(depositId,options={},state){
    const method=options.method||'state';
    if(!['state','foreign_funded'].includes(method))return{ok:false,error:'method must be state or foreign_funded'};
    const check=canDevelopDeposit(depositId,state,{method});
    if(!check.ok)return check;
    const d=state.discoveredDeposits[depositId];
    const e=check.estimate;
    const p={
      id:nextId('project_mine'),
      type:'mine_development',
      depositId,
      resourceType:d.resourceType,
      regionId:d.regionId,
      countryId:d.countryId,
      name:`${method==='foreign_funded'?'Foreign-funded':'State'} ${d.resourceType} mine development`,
      developmentMethod:method,
      cost:e.totalCost,
      governmentCost:e.governmentCost,
      totalTurns:e.totalTurns,
      turnsRemaining:e.totalTurns,
      status:'under_construction',
      startedYear:nowYear(state),
      ownership:method==='foreign_funded'?{type:'foreign',foreignCountryId:options.foreignCountryId||'foreign_partner',foreignShare:.65,domesticShare:.35}:{type:'domestic',domesticShare:1},
      causalActionRef:options.causalActionRef||null
    };
    state.projects[p.id]=p;
    emit(state,'PROJECT_STARTED',{projectId:p.id,projectType:p.type,depositId,regionId:p.regionId,resourceType:p.resourceType,developmentMethod:method,causalActionRef:p.causalActionRef});
    return{ok:true,project:p,estimate:e};
  }

  function completeMineDevelopment(p,state){
    const d=state.discoveredDeposits[p.depositId];
    if(!d)throw new Error(`Mine project ${p.id} references missing deposit ${p.depositId}`);
    const base=MINE_BASE[d.resourceType];
    const facilityType=base.type;
    const f={
      id:nextId(facilityType),
      type:facilityType,
      name:`${d.resourceType[0].toUpperCase()+d.resourceType.slice(1)} Mine`,
      countryId:d.countryId,
      regionId:d.regionId,
      cityId:null,
      depositId:d.id,
      resourceType:d.resourceType,
      level:1,
      maxLevel:FACILITY_LEVELS[facilityType]?.maxLevel||1,
      active:true,
      completed:true,
      ownership:deepClone(p.ownership),
      capacity:base.baseCapacity,
      engineeringDifficulty:d.assessment?.difficulty||'unknown'
    };
    if(FACILITY_LEVELS[facilityType])applyFacilityLevel(f,1,state,false);
    state.facilities[f.id]=f;
    d.developed=true;
    d.mineFacilityId=f.id;
    d.status='developed';
    recalculatePower(state);
    emit(state,'FACILITY_CREATED',{facilityId:f.id,facilityType:f.type,depositId:d.id,regionId:f.regionId,causalActionRef:p.causalActionRef||null});
    return f;
  }

  function createFacility(def,state){
    ensureState(state);
    if(!def||!def.type)throw new Error('createFacility requires type');
    if(['coal_mine','iron_mine','copper_mine','oil_field'].includes(def.type)){
      throw new Error('Resource extraction facilities must be created through an assessed discovered deposit and mine development project.');
    }
    const f={
      id:def.id||nextId(def.type),
      type:def.type,
      name:def.name||def.type,
      countryId:def.countryId||state.playerCountryId||null,
      regionId:def.regionId,
      cityId:def.cityId||null,
      level:def.level||1,
      active:def.active!==false,
      completed:true,
      ownership:deepClone(def.ownership||{type:'domestic',domesticShare:1}),
      capacity:Number(def.capacity||0)
    };
    if(FACILITY_LEVELS[f.type])applyFacilityLevel(f,f.level,state,false);
    state.facilities[f.id]=f;
    recalculatePower(state);
    emit(state,'FACILITY_CREATED',{facilityId:f.id,facilityType:f.type,regionId:f.regionId});
    return f;
  }

  function getFacilitySpec(type,level){return FACILITY_LEVELS[type]?.levels?.[level]||null;}
  function getConnectionSpec(type,level){return CONNECTION_LEVELS[type]?.levels?.[level]||null;}

  function applyFacilityLevel(facility,level,state,emitEvent=true){
    const spec=getFacilitySpec(facility.type,level);
    if(!spec)return{ok:false,error:`No level ${level} for ${facility.type}`};
    facility.level=level;
    facility.maxLevel=FACILITY_LEVELS[facility.type].maxLevel;
    facility.capacity=Number(spec.capacity??facility.capacity??0);
    facility.powerDemand=Number(spec.powerDemand??0);
    facility.powerSupply=Number(spec.powerSupply??0);
    facility.transportDemand=Number(spec.transportDemand??0);
    facility.visualStage=spec.visualStage;
    if(spec.tradeCapacity!=null)facility.tradeCapacity=Number(spec.tradeCapacity);
    if(emitEvent)emit(state,'FACILITY_LEVEL_CHANGED',{facilityId:facility.id,level,visualStage:facility.visualStage});
    return{ok:true,facility,spec};
  }

  function canUpgradeFacility(facilityId,state){
    ensureState(state);
    const f=state.facilities[facilityId];
    if(!f)return{ok:false,error:'Unknown facility.',missing:['facility']};
    const max=FACILITY_LEVELS[f.type]?.maxLevel||1;
    if((f.level||1)>=max)return{ok:false,error:'Maximum level reached.',missing:['higher level']};
    if(activeProjectConflict(state,p=>p.type==='facility_upgrade'&&p.targetFacilityId===facilityId))return{ok:false,error:'Upgrade already active.',missing:['finish upgrade']};
    const nextLevel=(f.level||1)+1,spec=getFacilitySpec(f.type,nextLevel);
    return{ok:true,nextLevel,nextSpec:spec,requirements:[],missing:[]};
  }

  function startFacilityUpgrade(facilityId,state,options={}){
    const c=canUpgradeFacility(facilityId,state);if(!c.ok)return c;
    const f=state.facilities[facilityId],s=c.nextSpec;
    const p={id:nextId('project_upgrade'),type:'facility_upgrade',targetFacilityId:facilityId,regionId:f.regionId,countryId:f.countryId||state.regions?.[f.regionId]?.countryId||state.playerCountryId||null,name:`Upgrade ${f.name}`,fromLevel:f.level,toLevel:c.nextLevel,cost:s.upgradeCost,governmentCost:s.upgradeCost,totalTurns:s.upgradeTurns,turnsRemaining:s.upgradeTurns,status:'under_construction',startedYear:nowYear(state),causalActionRef:options.causalActionRef||null};
    state.projects[p.id]=p;emit(state,'PROJECT_STARTED',{projectId:p.id,projectType:p.type,targetFacilityId:facilityId,causalActionRef:p.causalActionRef});return{ok:true,project:p};
  }

  function createRailConnection(fromId,toId,options={},state){
    ensureState(state);
    const existing=values(state.connections).find(c=>c.type==='railway'&&((c.fromId===fromId&&c.toId===toId)||(c.fromId===toId&&c.toId===fromId))&&c.active!==false);
    if(existing)return existing;
    const c={id:options.id||nextId('railway'),type:'railway',fromId,toId,ownerCountryId:options.ownerCountryId||state.playerCountryId||null,level:1,maxLevel:5,capacity:15,active:true};
    applyConnectionLevel(c,1,state,false);state.connections[c.id]=c;emit(state,'CONNECTION_COMPLETED',{connectionId:c.id,connectionType:'railway',fromId,toId});return c;
  }

  function applyConnectionLevel(connection,level,state,emitEvent=true){
    const spec=getConnectionSpec(connection.type,level);if(!spec)return{ok:false,error:'Unknown connection level'};
    connection.level=level;connection.maxLevel=CONNECTION_LEVELS[connection.type].maxLevel;connection.capacity=spec.capacity;connection.visualStage=spec.visualStage;
    if(emitEvent)emit(state,'CONNECTION_LEVEL_CHANGED',{connectionId:connection.id,level,visualStage:connection.visualStage});
    return{ok:true,connection,spec};
  }
  function hasRailConnection(a,b,state){return values(state.connections).some(c=>c.type==='railway'&&c.active!==false&&((c.fromId===a&&c.toId===b)||(c.fromId===b&&c.toId===a)));}
  function getTransportCapacity(a,b,state){const c=values(state.connections).find(c=>c.type==='railway'&&c.active!==false&&((c.fromId===a&&c.toId===b)||(c.fromId===b&&c.toId===a)));return Number(c?.capacity||0);}
  function canUpgradeConnection(connectionId,state){
    const c=state.connections?.[connectionId];if(!c)return{ok:false,error:'Unknown connection.'};const max=CONNECTION_LEVELS[c.type]?.maxLevel||1;if((c.level||1)>=max)return{ok:false,error:'Maximum level reached.'};const nextLevel=(c.level||1)+1;return{ok:true,nextLevel,nextSpec:getConnectionSpec(c.type,nextLevel)};
  }
  function startConnectionUpgrade(connectionId,state,options={}){
    const c=canUpgradeConnection(connectionId,state);if(!c.ok)return c;const conn=state.connections[connectionId],s=c.nextSpec;const p={id:nextId('project_connection_upgrade'),type:'connection_upgrade',targetConnectionId:connectionId,regionId:null,countryId:conn.ownerCountryId||state.playerCountryId||null,name:`Upgrade ${conn.type}`,fromLevel:conn.level,toLevel:c.nextLevel,cost:s.upgradeCost,governmentCost:s.upgradeCost,totalTurns:s.upgradeTurns,turnsRemaining:s.upgradeTurns,status:'under_construction',startedYear:nowYear(state),causalActionRef:options.causalActionRef||null};state.projects[p.id]=p;emit(state,'PROJECT_STARTED',{projectId:p.id,projectType:p.type,targetConnectionId:connectionId,causalActionRef:p.causalActionRef});return{ok:true,project:p};
  }

  function startProject(def,state){
    ensureState(state);
    if(def.type==='resource_exploration')return startExploration(def.regionId,def.resourceType,def.explorationMethod||def.explorationStage||'surface_mapping',state,def);
    if(def.type==='mine_development')return startMineDevelopment(def.depositId,def,state);
    if(def.type==='railway'){
      if(hasRailConnection(def.fromId,def.toId,state))return{ok:false,error:'Railway already exists.'};
      const p={id:nextId('project_railway'),type:'railway',name:def.name||'Railway',fromId:def.fromId,toId:def.toId,ownerCountryId:def.ownerCountryId||state.playerCountryId||null,countryId:def.countryId||def.ownerCountryId||state.playerCountryId||null,regionId:def.regionId||null,cost:Number(def.cost||18),governmentCost:Number(def.governmentCost!=null?def.governmentCost:(def.cost||18)),totalTurns:Number(def.totalTurns||2),turnsRemaining:Number(def.totalTurns||2),status:'under_construction',startedYear:nowYear(state),causalActionRef:def.causalActionRef||null};state.projects[p.id]=p;emit(state,'PROJECT_STARTED',{projectId:p.id,projectType:'railway',fromId:p.fromId,toId:p.toId,causalActionRef:p.causalActionRef});return{ok:true,project:p};
    }
    if(FACILITY_LEVELS[def.type] && !['coal_mine','iron_mine'].includes(def.type)){
      const p={id:nextId('project_facility'),type:def.type,name:def.name||def.type,regionId:def.regionId,cityId:def.cityId||null,countryId:def.countryId||state.playerCountryId||null,cost:Number(def.cost||10),governmentCost:Number(def.governmentCost!=null?def.governmentCost:(def.cost||10)),totalTurns:Number(def.totalTurns||2),turnsRemaining:Number(def.totalTurns||2),status:'under_construction',startedYear:nowYear(state),ownership:deepClone(def.ownership||{type:'domestic',domesticShare:1}),causalActionRef:def.causalActionRef||null};state.projects[p.id]=p;emit(state,'PROJECT_STARTED',{projectId:p.id,projectType:p.type,regionId:p.regionId,causalActionRef:p.causalActionRef});return{ok:true,project:p};
    }
    return{ok:false,error:`Unsupported project type: ${def.type}`};
  }

  function completeProject(projectId,state){
    ensureState(state);
    const p=state.projects[projectId];if(!p)return{ok:false,error:'Unknown project.'};if(p.status==='completed')return{ok:true,project:p};if(p.status!=='under_construction')return{ok:false,error:`Project status is ${p.status}.`};
    let created=null,result=null;
    if(p.type==='resource_exploration')result=completeExplorationProject(p,state);
    else if(p.type==='mine_development')created=completeMineDevelopment(p,state);
    else if(p.type==='facility_upgrade'){const f=state.facilities[p.targetFacilityId];if(!f)return{ok:false,error:'Upgrade target missing.'};applyFacilityLevel(f,p.toLevel,state,true);created=f;}
    else if(p.type==='connection_upgrade'){const c=state.connections[p.targetConnectionId];if(!c)return{ok:false,error:'Connection target missing.'};applyConnectionLevel(c,p.toLevel,state,true);created=c;}
    else if(p.type==='railway'){created=createRailConnection(p.fromId,p.toId,{ownerCountryId:p.ownerCountryId},state);}
    else if(FACILITY_LEVELS[p.type]){created=createFacility({type:p.type,name:p.name,regionId:p.regionId,cityId:p.cityId,countryId:p.countryId,ownership:p.ownership},state);}
    p.status='completed';p.turnsRemaining=0;p.completedYear=nowYear(state);emit(state,'PROJECT_COMPLETED',{projectId:p.id,projectType:p.type,regionId:p.regionId||null,causalActionRef:p.causalActionRef||null});recalculatePower(state);return{ok:true,project:p,created,result};
  }

  function cancelProject(projectId,state){const p=state.projects?.[projectId];if(!p)return{ok:false,error:'Unknown project.'};if(p.status!=='under_construction')return{ok:false,error:'Only active projects can be cancelled.'};p.status='cancelled';emit(state,'PROJECT_CANCELLED',{projectId:p.id,projectType:p.type});return{ok:true,project:p};}

  function updateProjects(state,years=1){
    ensureState(state);const completed=[];
    // Module 8 integration: Module 3 owns material/finance feasibility and emits
    // recommendedProgressFactor. Module 2 remains the only owner of physical
    // project progress/completion, but consumes that signal on the following year.
    const progressSignals=state.modules?.economy?.module2Signals?.projectProgress||state.economy?.module2Signals?.projectProgress||{};
    for(let y=0;y<years;y++){
      values(state.projects).filter(p=>p.status==='under_construction').forEach(p=>{
        const sig=progressSignals[p.id];
        const factor=Math.max(0,Math.min(1,Number(sig?.recommendedProgressFactor??1)));
        p.progressCredit=Number(p.progressCredit||0)+factor;
        const whole=Math.min(Number(p.turnsRemaining||0),Math.floor(p.progressCredit+1e-9));
        if(whole>0){p.turnsRemaining=Math.max(0,Number(p.turnsRemaining||0)-whole);p.progressCredit-=whole;}
        p.integrationProgressFactor=factor;
        if(p.turnsRemaining===0){const r=completeProject(p.id,state);if(r.ok)completed.push(r);}
      });
    }return completed;
  }
  function advanceYear(state){ensureState(state);state.time.year=nowYear(state)+1;const completed=updateProjects(state,1);return{year:state.time.year,completed};}

  function recalculatePower(state){
    Object.values(state.regions||{}).forEach(r=>{r.powerSupply=Number(r.basePowerSupply||0);r.powerDemand=Number(r.basePowerDemand||0);});
    values(state.facilities).filter(f=>f.active!==false).forEach(f=>{const r=state.regions?.[f.regionId];if(!r)return;r.powerSupply+=Number(f.powerSupply||0);r.powerDemand+=Number(f.powerDemand||0);});
    return Object.fromEntries(Object.entries(state.regions||{}).map(([id,r])=>[id,{supply:r.powerSupply||0,demand:r.powerDemand||0}]));
  }

  function getExplorationStatus(regionId,resourceType,state,options={}){
    const parcelId=resolveParcelId(regionId,state,options.parcelId||null);const all=explorationResultsFor(regionId,resourceType,state,parcelId);const usable=usableExplorationResultsFor(regionId,resourceType,parcelId,state);const k=knowledgeFor(regionId,resourceType,parcelId,state);const deposit=existingDeposit(regionId,resourceType,state,parcelId);
    return{regionId,resourceType,parcelId,methodsUsed:deepClone(k.methodsUsed),confidence:k.confidence,reservePrecision:k.bestPrecision,results:deepClone(all),usableResults:deepClone(usable),staleResults:deepClone(all.filter(r=>!usable.includes(r))),deposit:deposit?deepClone(deposit):null,availableMethods:getExplorationMethods(regionId,resourceType,state,{parcelId})};
  }
  function getExplorationResults(regionId,resourceType,state,options={}){return deepClone(explorationResultsFor(regionId,resourceType,state,options.parcelId||null));}
  function getDiscoveredDeposits(state){return deepClone(values(state.discoveredDeposits).map(d=>Object.assign({},d,{stale:!depositIsGeologicallyCurrent(d,state)})));}
  function getDeposit(depositId,state){const d=state.discoveredDeposits?.[depositId];return d?deepClone(Object.assign({},d,{stale:!depositIsGeologicallyCurrent(d,state)})):null;}
  function getDevelopmentAssessment(depositId,state){const d=state.discoveredDeposits?.[depositId];return d?.assessment?deepClone(d.assessment):null;}
  function getProjectInspection(projectId,state){const p=state.projects?.[projectId];return p?deepClone(p):null;}
  function getFacilityLevelInfo(type,level){return deepClone(getFacilitySpec(type,level));}
  function getConnectionLevelInfo(type,level){return deepClone(getConnectionSpec(type,level));}

  function getDebugSnapshot(state){
    return{
      version:VERSION,
      year:nowYear(state),
      projects:deepClone(state.projects||{}),
      explorationResults:deepClone(state.explorationResults||{}),
      discoveredDeposits:deepClone(state.discoveredDeposits||{}),
      facilities:deepClone(state.facilities||{}),
      connections:deepClone(state.connections||{}),
      power:recalculatePower(state)
    };
  }

  const api={
    VERSION,
    EXPLORATION_STAGES,
    EXPLORATION_METHODS,
    EXPLORATION_ALIASES,
    MINE_BASE,
    definitions:{FACILITY_LEVELS,CONNECTION_LEVELS},
    setWorld,
    initializeState,
    getExplorationMethods,
    canStartExploration,
    startExploration,
    getExplorationStatus,
    getExplorationResults,
    getDiscoveredDeposits,
    getDeposit,
    getDevelopmentAssessment,
    estimateMineDevelopment,
    canDevelopDeposit,
    getMineDevelopmentOptions,
    chooseMineDevelopmentOption,
    startMineDevelopment,
    startProject,
    updateProjects,
    advanceYear,
    completeProject,
    cancelProject,
    createFacility,
    canUpgradeFacility,
    startFacilityUpgrade,
    applyFacilityLevel,
    createRailConnection,
    hasRailConnection,
    getTransportCapacity,
    canUpgradeConnection,
    startConnectionUpgrade,
    applyConnectionLevel,
    recalculatePower,
    getProjectInspection,
    getFacilityLevelInfo,
    getConnectionLevelInfo,
    getDebugSnapshot,
    _internals:{deriveSubsurface,engineeringAssessment,knowledgeFor,reserveEstimate,methodInformationGain,qualityClass,depthClass,stabilityClass,riskClass,accessClass,resolveParcelId}
  };
  return api;
});
