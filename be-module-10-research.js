/* ===== BORDER EPOCH — MODULE 10: RESEARCH & TECHNOLOGY ADAPTER ===== */
(function(global){
'use strict';
const BE=global.BorderEpoch=global.BorderEpoch||{};
const initialPublic=BE.Research||global.BorderEpochResearch||null;
const initialCore=global.BorderEpochResearchForgeCore||null;
const Research=(initialPublic&&initialPublic!==initialCore)?initialPublic:{};
const captured={};

const PROXY_METHODS=[
  'getDashboard','getDomains','getClusters','getCapabilityCatalog','getCapability','getCapabilities','getKnowledge',
  'getProblems','getDirections','startProject','getProjects','getInstitutions','getDiscoveries',
  'getEngineeringPossibilities','scanEngineeringPossibilities','detectTechnicalProblems','runSelfCheck'
];
const REQUIRED=['initializeState','getDashboard','reportObservation','getProblems','getDirections','startProject','getProjects','prepareYear','simulateYear','finalizeYear'];

if(initialPublic&&initialPublic!==initialCore){
  for(const name of [...PROXY_METHODS,...REQUIRED]){
    if(typeof initialPublic[name]==='function')captured[name]=initialPublic[name].bind(initialPublic);
  }
}

function getCore(){return global.BorderEpochResearchForgeCore||null;}
function backend(name){
  if(captured[name])return captured[name];
  const core=getCore();
  return core&&typeof core[name]==='function'?core[name].bind(core):null;
}
function call(name,args){const fn=backend(name);return fn?fn(...(args||[])):null;}
function year(gs){return Number(gs?.time?.year??gs?.turn??0)||0;}
function finite(v){return Number.isFinite(Number(v));}
function values(v){return Array.isArray(v)?v.filter(Boolean):Object.values(v||{}).filter(Boolean);}
function object(v){return v&&typeof v==='object'&&!Array.isArray(v)?v:{};}

function metricCategory(metrics){
  const m=metrics||{};
  if(finite(m.designOutput)&&finite(m.actualOutput))return'output';
  if(finite(m.failureRate))return'reliability';
  if(finite(m.fuelConsumptionRatio))return'efficiency';
  if(finite(m.yieldRate))return'yield';
  if(finite(m.scaleUpRatio))return'scaling';
  if(m.cannotManufacture)return'manufacturing';
  if(finite(m.environmentPerformanceRatio))return'environment';
  if(m.causeUnknown||m.measurementGap||m.theoryGap)return'knowledge';
  return'other';
}
function wouldSignal(metrics){
  const m=metrics||{};
  if(finite(m.designOutput)&&Number(m.designOutput)>0&&finite(m.actualOutput)&&Number(m.actualOutput)/Number(m.designOutput)<.82)return true;
  if(finite(m.failureRate)&&Number(m.failureRate)>.08)return true;
  if(finite(m.fuelConsumptionRatio)&&Number(m.fuelConsumptionRatio)>1.15)return true;
  if(finite(m.yieldRate)&&Number(m.yieldRate)>0&&Number(m.yieldRate)<.82)return true;
  if(finite(m.scaleUpRatio)&&Number(m.scaleUpRatio)>0&&Number(m.scaleUpRatio)<.72)return true;
  if(m.cannotManufacture||m.causeUnknown||m.measurementGap||m.theoryGap)return true;
  if(finite(m.environmentPerformanceRatio)&&Number(m.environmentPerformanceRatio)>0&&Number(m.environmentPerformanceRatio)<.75)return true;
  return false;
}
function directTechnicalMetrics(source){
  const src=object(source?.metrics&&typeof source.metrics==='object'?source.metrics:source);
  const m={};
  if(finite(src.designOutput)&&finite(src.actualOutput)){m.designOutput=Number(src.designOutput);m.actualOutput=Number(src.actualOutput);}
  for(const k of ['failureRate','fuelConsumptionRatio','yieldRate','scaleUpRatio','environmentPerformanceRatio'])if(finite(src[k]))m[k]=Number(src[k]);
  for(const k of ['cannotManufacture','causeUnknown','measurementGap','theoryGap'])if(src[k]===true)m[k]=true;
  return m;
}
function sameObservation(o,input,y,category){
  return o&&Number(o.year)===y&&String(o.sourceModule||'')===String(input.sourceModule||'')&&
    String(o.sourceType||o.objectType||'')===String(input.sourceType||input.objectType||'')&&
    String(o.sourceId||o.objectId||'')===String(input.sourceId||input.objectId||'')&&metricCategory(o.metrics)===category;
}
function reportCandidate(gs,input,summary){
  const r=Research.initializeState(gs);
  if(!r||!Array.isArray(r.observations))return false;
  const y=year(gs),category=metricCategory(input.metrics);
  if(!wouldSignal(input.metrics)||r.observations.some(o=>sameObservation(o,input,y,category)))return false;
  const fn=backend('reportObservation');
  if(!fn)return false;
  const result=fn({...input,year:y},gs);
  if(!result||result.ok===false)return false;
  summary.count++;
  summary.sources[input.sourceModule]=(summary.sources[input.sourceModule]||0)+1;
  summary.keys.push(`${y}|${input.sourceModule}|${input.sourceType||input.objectType||'object'}|${input.sourceId||input.objectId||''}|${category}`);
  return true;
}

function collectM2(gs,summary){
  // Only explicit technical state is translated. Financial/material/project delays are intentionally ignored.
  for(const [id,f] of Object.entries(gs.facilities||{})){
    const metrics=directTechnicalMetrics(f);
    if(wouldSignal(metrics))reportCandidate(gs,{sourceModule:'M2',sourceType:'facility',sourceId:f.id||id,objectName:f.name||f.type||id,metrics},summary);
  }
  const miningTech=Number(gs.technology?.mining??1);
  for(const [id,d] of Object.entries(gs.discoveredDeposits||{})){
    const required=Number(d?.assessment?.technologyRequired);
    if(d?.developed||d?.mineFacilityId||!finite(required)||!finite(miningTech)||miningTech>=required)continue;
    reportCandidate(gs,{
      sourceModule:'M2',sourceType:'resource_development',sourceId:d.id||id,
      objectName:d.name||`${d.resourceType||'resource'} deposit ${d.id||id}`,
      operatingCondition:`miningTechnology=${miningTech}; required=${required}`,
      metrics:{cannotManufacture:true},
      capabilityHints:['machine_tools','construction_engineering','surveying']
    },summary);
  }
}

function collectM3(gs,summary){
  const econ=gs.economy||gs.modules?.economy?.state||{};
  for(const [id,f] of Object.entries(econ.facilities||{})){
    let metrics=directTechnicalMetrics(f);
    // Current Module 3 bottlenecks are normally labor/power/input/finance/logistics/demand and are not research problems.
    // A normalized output gap is only translated if Module 3 explicitly labels a technical/engineering bottleneck.
    const bottleneck=String(f.mainBottleneck||'');
    if(!wouldSignal(metrics)&&finite(f.productionLevel)&&Number(f.productionLevel)<.82&&/quality|precision|reliab|process|technolog|technical|engineering|manufactur/i.test(bottleneck)){
      metrics={designOutput:1,actualOutput:Number(f.productionLevel)};
    }
    if(!wouldSignal(metrics))continue;
    reportCandidate(gs,{sourceModule:'M3',sourceType:'facility_economy',sourceId:f.facilityId||id,objectName:f.name||f.type||f.facilityId||id,operatingCondition:bottleneck?`bottleneck=${bottleneck}`:'',metrics},summary);
  }
}

function collectM9(gs,summary){
  const cropDefs=BE.Agriculture?.CropDefinitions||{};
  for(const [regionId,region] of Object.entries(gs.agriculture?.regions||{})){
    const last=region?.lastOutput||{},details=last.cropDetails||{};
    for(const [cropId,d] of Object.entries(details)){
      const def=cropDefs[cropId],f=d?.factors||{};
      if(!def||!finite(def.baseYield)||Number(def.baseYield)<=0||!finite(d?.yieldPerArea)||Number(d?.plantedArea||0)<=0)continue;
      const healthy=[f.waterFactor,f.laborFactor,f.machineryFactor,f.inputFactor,f.climateFactor,f.suitabilityFactor,f.soilFactor]
        .every(v=>finite(v)&&Number(v)>=.85);
      const rotationHealthy=finite(f.rotationFactor)&&Number(f.rotationFactor)>=.90;
      if(!healthy||!rotationHealthy||String(region.intensity||'normal')==='extensive')continue;
      const yieldRate=Number(d.yieldPerArea)/Number(def.baseYield);
      if(!(yieldRate>0&&yieldRate<.82))continue;
      reportCandidate(gs,{
        sourceModule:'M9',sourceType:'crop_performance',sourceId:`${regionId}:${cropId}`,
        objectName:`${cropId} @ ${regionId}`,
        operatingCondition:'resource, climate, soil and rotation factors are all healthy',
        metrics:{yieldRate},
        capabilityHints:['breeding','variety_selection','experimental_design']
      },summary);
    }
    // Module 9 explicitly emits crop_failure only under severe climate/water stress.
    // Translate that formal condition into Forge's existing extreme-environment performance signal;
    // ordinary food shortage, capital shortage and logistics shortage are intentionally ignored.
    for(const c of Array.isArray(last.conditions)?last.conditions:[]){
      if(c?.condition!=='crop_failure'||!c.cropId)continue;
      const rain=Number(c.causes?.rainfallFactor),irrigation=Number(c.causes?.irrigationFactor);
      const ratio=Math.min(finite(rain)?rain:1,finite(irrigation)?irrigation:1);
      if(!(ratio>0&&ratio<.75))continue;
      reportCandidate(gs,{
        sourceModule:'M9',sourceType:'crop_environment_performance',sourceId:`${regionId}:${c.cropId}`,
        objectName:`${c.cropId} @ ${regionId}`,
        operatingCondition:`crop_failure; rainfallFactor=${finite(rain)?rain:'n/a'}; irrigationFactor=${finite(irrigation)?irrigation:'n/a'}`,
        metrics:{environmentPerformanceRatio:ratio},
        capabilityHints:['breeding','irrigation_engineering','soil_science']
      },summary);
    }
  }
}

function collectObservations(gs){
  const r=Research.initializeState(gs);
  if(!r)return{ok:false,reason:'research_core_unavailable',year:year(gs),count:0,sources:{M2:0,M3:0,M9:0},keys:[]};
  r.runtime=r.runtime||{};
  const y=year(gs);
  if(r.runtime.adapterObservationYear===y&&r.runtime.adapterObservationComplete){
    return{ok:true,skipped:true,year:y,count:Number(r.runtime.adapterObservationCount||0),sources:{M2:0,M3:0,M9:0,...object(r.runtime.adapterObservationSources)},keys:Array.isArray(r.runtime.adapterObservationKeys)?r.runtime.adapterObservationKeys.slice():[]};
  }
  const summary={ok:true,skipped:false,year:y,count:0,sources:{M2:0,M3:0,M9:0},keys:[]};
  collectM2(gs,summary);collectM3(gs,summary);collectM9(gs,summary);
  r.runtime.adapterObservationYear=y;
  r.runtime.adapterObservationCount=summary.count;
  r.runtime.adapterObservationSources={...summary.sources};
  r.runtime.adapterObservationKeys=summary.keys.slice();
  r.runtime.adapterObservationComplete=true;
  return summary;
}

Research.initializeState=function(gs){
  if(!gs||typeof gs!=='object')return null;
  const fn=backend('initializeState');
  return fn?fn(gs):null;
};
Research.reportObservation=function(input,gs){
  const state=gs||global.gameState;
  if(!state)return{ok:false,reason:'game_state_unavailable'};
  Research.initializeState(state);
  const fn=backend('reportObservation');
  return fn?fn(input,state):{ok:false,reason:'research_core_unavailable'};
};
Research.prepareYear=function(gs){
  Research.initializeState(gs);
  const fn=backend('prepareYear');
  return fn?fn(gs):{year:year(gs),skipped:true,reason:'research_core_unavailable'};
};
Research.simulateYear=function(gs){
  Research.initializeState(gs);
  collectObservations(gs);
  const fn=backend('simulateYear');
  return fn?fn(gs):{year:year(gs),skipped:true,reason:'research_core_unavailable'};
};
Research.finalizeYear=function(gs){
  Research.initializeState(gs);
  const fn=backend('finalizeYear');
  return fn?fn(gs):{year:year(gs),skipped:true,reason:'research_core_unavailable'};
};

for(const name of PROXY_METHODS){
  if(typeof Research[name]==='function')continue;
  Research[name]=function(...args){const fn=backend(name);return fn?fn(...args):null;};
}

Research.getIntegrationStatus=function(gs){
  const state=gs||global.gameState||null;
  const core=getCore(),r=state?.research||{},rt=r.runtime||{},y=state?year(state):null;
  const current=state&&Array.isArray(r.observations)?r.observations.filter(o=>Number(o.year)===y):[];
  const sources={M2:0,M3:0,M9:0};
  for(const o of current)if(Object.prototype.hasOwnProperty.call(sources,o.sourceModule))sources[o.sourceModule]++;
  return{
    apiConnected:true,coreConnected:!!core,year:y,
    observationYear:rt.adapterObservationYear??null,observationCount:current.length,sources,
    simulatedYear:rt.simulatedYear??null,finalizedYear:rt.finalizedYear??null,
    adapterCollected:rt.adapterObservationYear===y&&rt.adapterObservationComplete===true,
    message:current.length?'Research observations connected.':'No reportable technical observation found this year.'
  };
};

const core=getCore();
const missing=REQUIRED.filter(name=>name==='initializeState'||name==='reportObservation'||name==='prepareYear'||name==='simulateYear'||name==='finalizeYear'?typeof Research[name]!=='function':typeof backend(name)!=='function');
Research.VERSION=(initialPublic&&initialPublic.VERSION)||(core&&core.VERSION)||'1.0.0-module10-adapter';
Research.available=!!core||Object.keys(captured).length>0;
Research.integrationVersion='1.1.0-module10-observation-adapter';
Research.missingRequiredMethods=missing.slice();

BE.Research=Research;
BE.Module10=Research;
global.BorderEpochResearch=Research;
global.BorderEpochModule10=Research;
if(BE.API&&typeof BE.API==='object')BE.API.research=Research;

if(missing.length&&typeof console!=='undefined'&&console.error)console.error('[Border Epoch] Module 10 research API missing methods:',missing.join(', '));
})(typeof window!=='undefined'?window:globalThis);
/* ===== END MODULE 10 ===== */