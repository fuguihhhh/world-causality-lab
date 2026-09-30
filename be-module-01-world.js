/*
 * Border Epoch — Module 1: World, Surface Terrain, Geology & Resource Endowment
 * Version 2.1 — geology-first resource model
 *
 * HARD BOUNDARY
 * - Owns countries, regions, cities, surface terrain, geology, geological parcels,
 *   spatial facts and hidden resource endowment.
 * - DOES NOT create discovered mineral deposits, mines, projects, production,
 *   prices, migration, diplomacy, AI decisions or stories.
 * - Surface terrain and underground geology are deliberately separate systems.
 * - Surface changes may alter access/exposure, but DO NOT reroll underground resources.
 * - Geological changes may alter endowment and the deterministic subsurface seed.
 *
 * Project-wide time contract: 1 turn = 1 year.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.World = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = '2.1.0';
  const RESOURCE_TYPES = ['coal', 'iron', 'copper', 'oil'];

  /* Underground geology is now the primary resource driver. */
  const LITHOLOGY_RESOURCE_AFFINITY = {
    coal_bearing_sediments: { coal:0.88, oil:0.34, iron:0.10, copper:0.08 },
    organic_sediments:      { coal:0.58, oil:0.82, iron:0.08, copper:0.06 },
    mixed_sedimentary:      { coal:0.38, oil:0.34, iron:0.14, copper:0.10 },
    banded_iron_formation:  { coal:0.04, oil:0.02, iron:0.94, copper:0.16 },
    crystalline_basement:   { coal:0.04, oil:0.02, iron:0.54, copper:0.40 },
    mafic_volcanic:         { coal:0.03, oil:0.01, iron:0.52, copper:0.58 },
    felsic_intrusive:       { coal:0.02, oil:0.01, iron:0.28, copper:0.62 },
    carbonate_sequence:     { coal:0.16, oil:0.34, iron:0.12, copper:0.22 }
  };

  const GEOLOGY_TAG_MODIFIERS = {
    coal_measures:       { coal: 0.24 },
    organic_rich:        { coal: 0.08, oil: 0.20 },
    ancient_craton:      { iron: 0.16, copper: 0.06 },
    banded_iron:         { iron: 0.26 },
    volcanic_arc:        { copper: 0.22, iron: 0.06 },
    hydrothermal_belt:   { copper: 0.24 },
    petroleum_system:    { oil: 0.28 },
    faulted_basin:       { oil: 0.08, coal:-0.03 },
    metamorphic_overprint:{ coal:-0.10, oil:-0.08, iron:0.05 },
    deeply_weathered:    { iron: 0.05, copper:-0.03 }
  };

  const TECTONIC_RESOURCE_MODIFIERS = {
    stable_platform:  { coal:0.04, oil:0.05, iron:0.00, copper:-0.02 },
    foreland_basin:   { coal:0.10, oil:0.08, iron:-0.04, copper:-0.04 },
    rift_basin:       { coal:0.04, oil:0.12, iron:0.00, copper:0.02 },
    volcanic_arc:     { coal:-0.08, oil:-0.08, iron:0.08, copper:0.18 },
    cratonic_shield:  { coal:-0.08, oil:-0.10, iron:0.14, copper:0.08 },
    passive_margin:   { coal:0.03, oil:0.12, iron:-0.03, copper:-0.02 }
  };

  /* Surface terrain affects what can be observed/accessed, not how much ore exists underground. */
  const TERRAIN_EXPOSURE = {
    sedimentary_basin: 0.32,
    mountain: 0.78,
    upland: 0.68,
    hills: 0.60,
    plain: 0.36,
    river_valley: 0.45,
    coast: 0.42,
    delta: 0.22,
    plateau: 0.64
  };

  const DEFAULT_TERRAIN = {
    composition: { plain: 1 },
    elevation: 0.25,
    ruggedness: 0.15,
    waterAccess: 0.5,
    coastAccess: false,
    buildability: 0.8
  };

  const DEFAULT_GEOLOGY = {
    lithology: { mixed_sedimentary: 1 },
    tags: [],
    tectonicSetting: 'stable_platform',
    complexity: 0.35,
    parcelCount: 4
  };

  function clamp(v, a=0, b=1){ return Math.max(a, Math.min(b, Number(v)||0)); }
  function deepClone(v){ return JSON.parse(JSON.stringify(v)); }

  function hashString(input){
    let h=2166136261>>>0; const s=String(input);
    for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); }
    return h>>>0;
  }
  function unitNoise(...parts){ return (hashString(parts.join('|'))%1000003)/1000003; }

  function normalizeComposition(comp, fallbackKey='plain'){
    const clean={}; let total=0;
    Object.entries(comp||{}).forEach(([k,v])=>{ const n=Math.max(0,Number(v)||0); if(n>0){clean[k]=n;total+=n;} });
    if(!total) return {[fallbackKey]:1};
    Object.keys(clean).forEach(k=>clean[k]/=total);
    return clean;
  }

  function qualitativeBand(v){
    if(v>=0.80)return'very_high'; if(v>=0.62)return'high'; if(v>=0.42)return'medium'; if(v>=0.24)return'low'; return'very_low';
  }

  function ensureModuleState(state){
    state.modules=state.modules||{};
    const existing=state.modules.module1||{};
    state.modules.module1=Object.assign({
      version:VERSION,
      worldSeed:String(state.worldSeed||'border-epoch-default'),
      surfaceRevision:0,
      geologyRevision:0,
      regionSurface:{},
      regionGeology:{},
      initialized:false
    },existing);
    state.modules.module1.version=VERSION;
    if(state.modules.module1.surfaceRevision==null) state.modules.module1.surfaceRevision=Number(existing.terrainRevision||0);
    if(state.modules.module1.geologyRevision==null) state.modules.module1.geologyRevision=0;
    state.modules.module1.regionSurface=state.modules.module1.regionSurface||{};
    state.modules.module1.regionGeology=state.modules.module1.regionGeology||{};
    return state.modules.module1;
  }

  function ensureRegion(state,regionId){
    const r=state.regions&&state.regions[regionId]; if(!r)throw new Error(`Unknown region: ${regionId}`); return r;
  }

  function terrainFor(region){
    const source=region.surfaceTerrain||region.terrain||{};
    const t=Object.assign({},DEFAULT_TERRAIN,source);
    t.composition=normalizeComposition(source.composition||t.composition,'plain');
    t.elevation=clamp(t.elevation); t.ruggedness=clamp(t.ruggedness); t.waterAccess=clamp(t.waterAccess);
    t.coastAccess=!!t.coastAccess; t.buildability=clamp(t.buildability);
    delete t.geologyTags;
    return t;
  }

  function inferLegacyGeology(region){
    const legacyTags=Array.from(new Set([...(region.geologyTags||[]),...((region.terrain&&region.terrain.geologyTags)||[])]));
    let lithology={mixed_sedimentary:1};
    if(legacyTags.includes('coal_measures')) lithology={coal_bearing_sediments:.78,organic_sediments:.22};
    else if(legacyTags.includes('banded_iron')) lithology={banded_iron_formation:.68,crystalline_basement:.32};
    else if(legacyTags.includes('volcanic_arc')) lithology={mafic_volcanic:.45,felsic_intrusive:.35,crystalline_basement:.20};
    else if(legacyTags.includes('ancient_craton')) lithology={crystalline_basement:.75,banded_iron_formation:.25};
    else if(legacyTags.includes('organic_sediments')) lithology={organic_sediments:.62,mixed_sedimentary:.38};
    const tags=legacyTags.map(t=>({organic_sediments:'organic_rich',tectonically_broken:'faulted_basin'}[t]||t));
    let tectonicSetting='stable_platform';
    if(tags.includes('volcanic_arc'))tectonicSetting='volcanic_arc';
    else if(tags.includes('ancient_craton')||tags.includes('banded_iron'))tectonicSetting='cratonic_shield';
    else if(tags.includes('coal_measures'))tectonicSetting='foreland_basin';
    return {lithology,tags,tectonicSetting,complexity:.35,parcelCount:4};
  }

  function geologyFor(region){
    const source=region.geology||inferLegacyGeology(region);
    const g=Object.assign({},DEFAULT_GEOLOGY,source);
    g.lithology=normalizeComposition(source.lithology||g.lithology,'mixed_sedimentary');
    g.tags=Array.from(new Set(source.tags||[]));
    g.tectonicSetting=source.tectonicSetting||'stable_platform';
    g.complexity=clamp(source.complexity??.35);
    g.parcelCount=Math.max(1,Math.min(9,Math.round(Number(source.parcelCount)||4)));
    return g;
  }

  function surfaceExposure(terrain){
    let exposure=0;
    Object.entries(terrain.composition||{}).forEach(([k,share])=>{ exposure+=share*Number(TERRAIN_EXPOSURE[k]??.45); });
    exposure=exposure*.72+(1-terrain.waterAccess)*.08+terrain.ruggedness*.20;
    return clamp(exposure);
  }

  function computeGeologyPotential(regionId,resourceType,state,parcelModifier=0){
    const region=ensureRegion(state,regionId); const geology=geologyFor(region); const mod=ensureModuleState(state);
    const regionGeo=mod.regionGeology[regionId];
    let score=0;
    Object.entries(geology.lithology).forEach(([lith,share])=>{ score+=share*Number((LITHOLOGY_RESOURCE_AFFINITY[lith]||{})[resourceType]??.10); });
    geology.tags.forEach(tag=>{ score+=Number((GEOLOGY_TAG_MODIFIERS[tag]||{})[resourceType]||0); });
    score+=Number((TECTONIC_RESOURCE_MODIFIERS[geology.tectonicSetting]||{})[resourceType]||0);
    const geoSeed=regionGeo?.geologySeed||hashString(`${mod.worldSeed}|${regionId}|geology`).toString(16);
    score+=(unitNoise(geoSeed,resourceType,'endowment')-.5)*.09;
    score+=parcelModifier;
    // Smooth saturation keeps very favorable geology high without flattening every parcel to 1.0.
    // This preserves meaningful within-region geological variation.
    return clamp(1-Math.exp(-Math.max(0,score)*1.25));
  }

  function publicIndicationText(resourceType,potential,terrain){
    const exposure=surfaceExposure(terrain);
    const visibleSignal=clamp(potential*.72+exposure*.18+(terrain.buildability*.10));
    const band=qualitativeBand(visibleSignal);
    const lead={very_high:'Strong surface/geological indications',high:'Promising indications',medium:'Mixed but plausible indications',low:'Weak indications',very_low:'Little surface evidence'}[band];
    return {band,visibleSignal,exposure,text:`${lead} for ${resourceType}.`};
  }

  function computeEndowment(regionId,resourceType,state){
    const region=ensureRegion(state,regionId); const terrain=terrainFor(region); const mod=ensureModuleState(state);
    const rg=mod.regionGeology[regionId]; const potential=computeGeologyPotential(regionId,resourceType,state,0);
    const indication=publicIndicationText(resourceType,potential,terrain);
    return {
      resourceType,
      potential:Number(potential.toFixed(4)),
      band:qualitativeBand(potential),
      indication:indication.text,
      surfaceIndicationBand:indication.band,
      surfaceExposure:Number(indication.exposure.toFixed(3)),
      geologyRevision:rg?.revision||0,
      surfaceRevision:mod.regionSurface[regionId]?.revision||0,
      regionId
    };
  }

  function recalculateRegionEndowment(regionId,state){
    const region=ensureRegion(state,regionId); region.resourceEndowment=region.resourceEndowment||{};
    RESOURCE_TYPES.forEach(r=>{region.resourceEndowment[r]=computeEndowment(regionId,r,state);});
    return deepClone(region.resourceEndowment);
  }

  function initialize(state,options={}){
    if(!state||typeof state!=='object')throw new Error('World.initialize requires gameState');
    state.regions=state.regions||{};state.countries=state.countries||{};state.cities=state.cities||{};
    const mod=ensureModuleState(state); if(options.worldSeed!=null)mod.worldSeed=String(options.worldSeed);
    Object.keys(state.regions).forEach(regionId=>{
      const region=state.regions[regionId];
      // Capture/migrate legacy geology BEFORE surface normalization removes old geologyTags.
      const initialGeology=geologyFor(region);
      region.surfaceTerrain=terrainFor(region); region.terrain=deepClone(region.surfaceTerrain); // legacy alias
      region.geology=initialGeology;
      mod.regionSurface[regionId]=mod.regionSurface[regionId]||{revision:0};
      mod.regionGeology[regionId]=mod.regionGeology[regionId]||{
        geologySeed:hashString(`${mod.worldSeed}|${regionId}|geology|0`).toString(16),revision:0
      };
      recalculateRegionEndowment(regionId,state);
    });
    mod.initialized=true;return state;
  }

  /* Surface evolution: construction, erosion, urbanization, land reclamation, etc.
     This deliberately does NOT change geologySeed or resource potential. */
  function setRegionTerrain(regionId,terrainPatch,state){
    const region=ensureRegion(state,regionId);const mod=ensureModuleState(state);
    const beforeEndowment=deepClone(region.resourceEndowment||recalculateRegionEndowment(regionId,state));
    const next=Object.assign({},region.surfaceTerrain||region.terrain||{},terrainPatch||{});
    if(terrainPatch&&terrainPatch.composition)next.composition=normalizeComposition(terrainPatch.composition,'plain');
    delete next.geologyTags;
    region.surfaceTerrain=terrainFor({surfaceTerrain:next});region.terrain=deepClone(region.surfaceTerrain);
    mod.surfaceRevision+=1;mod.regionSurface[regionId]={revision:(mod.regionSurface[regionId]?.revision||0)+1};
    // Rebuild player-facing exposure fields while preserving underground potential exactly.
    RESOURCE_TYPES.forEach(r=>{
      const old=beforeEndowment[r]||computeEndowment(regionId,r,state);const ind=publicIndicationText(r,old.potential,region.surfaceTerrain);
      region.resourceEndowment[r]=Object.assign({},old,{indication:ind.text,surfaceIndicationBand:ind.band,surfaceExposure:Number(ind.exposure.toFixed(3)),surfaceRevision:mod.regionSurface[regionId].revision});
    });
    return {ok:true,regionId,terrain:deepClone(region.surfaceTerrain),surfaceRevision:mod.regionSurface[regionId].revision,endowmentUnchanged:true,endowment:deepClone(region.resourceEndowment)};
  }

  function applyTerrainOverlay(regionId,overlay,state){
    const region=ensureRegion(state,regionId);region.surfaceOverlays=region.surfaceOverlays||[];region.surfaceOverlays.push(deepClone(overlay||{}));
    const patch={};
    if(overlay?.ruggednessDelta!=null)patch.ruggedness=clamp((region.surfaceTerrain?.ruggedness||0)+Number(overlay.ruggednessDelta));
    if(overlay?.buildabilityDelta!=null)patch.buildability=clamp((region.surfaceTerrain?.buildability||0)+Number(overlay.buildabilityDelta));
    if(overlay?.waterAccessDelta!=null)patch.waterAccess=clamp((region.surfaceTerrain?.waterAccess||0)+Number(overlay.waterAccessDelta));
    const out=setRegionTerrain(regionId,patch,state);out.overlay=deepClone(overlay);return out;
  }

  /* Geological evolution / scenario editing: only this path may change hidden endowment. */
  function setRegionGeology(regionId,geologyPatch,state){
    const region=ensureRegion(state,regionId);const mod=ensureModuleState(state);
    const next=Object.assign({},region.geology||geologyFor(region),geologyPatch||{});
    if(geologyPatch?.lithology)next.lithology=normalizeComposition(geologyPatch.lithology,'mixed_sedimentary');
    if(geologyPatch?.tags)next.tags=Array.from(new Set(geologyPatch.tags));
    region.geology=geologyFor({geology:next});
    mod.geologyRevision+=1;
    const localRevision=(mod.regionGeology[regionId]?.revision||0)+1;
    mod.regionGeology[regionId]={geologySeed:hashString(`${mod.worldSeed}|${regionId}|geology|${localRevision}`).toString(16),revision:localRevision};
    const endowment=recalculateRegionEndowment(regionId,state);
    return {ok:true,regionId,geology:deepClone(region.geology),geologyRevision:localRevision,endowment,priorExplorationMayBeStale:true};
  }

  function applyGeologyEvent(regionId,event,state){
    const region=ensureRegion(state,regionId);const patch=deepClone(event?.geologyPatch||{});
    const result=setRegionGeology(regionId,patch,state);result.event=deepClone(event||{});return result;
  }

  function getRegionTerrain(regionId,state){return deepClone(terrainFor(ensureRegion(state,regionId)));}
  function getRegionGeology(regionId,state){return deepClone(geologyFor(ensureRegion(state,regionId)));}

  function getResourceEndowment(regionId,resourceType,state){
    const region=ensureRegion(state,regionId);if(!region.resourceEndowment?.[resourceType])recalculateRegionEndowment(regionId,state);return deepClone(region.resourceEndowment[resourceType]);
  }
  function getAllResourceEndowment(regionId,state){const region=ensureRegion(state,regionId);if(!region.resourceEndowment)recalculateRegionEndowment(regionId,state);return deepClone(region.resourceEndowment);}
  function getResourceIndications(regionId,state){return Object.values(getAllResourceEndowment(regionId,state)).map(x=>({resourceType:x.resourceType,band:x.surfaceIndicationBand,indication:x.indication}));}

  function getGeologicalParcels(regionId,state){
    const region=ensureRegion(state,regionId);const geology=geologyFor(region);const mod=ensureModuleState(state);const rg=mod.regionGeology[regionId];
    if(Array.isArray(geology.parcels)&&geology.parcels.length)return deepClone(geology.parcels);
    const count=geology.parcelCount||4;const parcels=[];
    for(let i=0;i<count;i++){
      const id=`${regionId}_parcel_${i+1}`;
      const x=.12+unitNoise(rg.geologySeed,id,'x')*.76;const y=.12+unitNoise(rg.geologySeed,id,'y')*.76;
      parcels.push({id,regionId,index:i+1,label:`Geological Parcel ${i+1}`,centroid:{x:Number(x.toFixed(3)),y:Number(y.toFixed(3))},geologyRevision:rg.revision});
    }
    return parcels;
  }

  function getExplorationBasis(regionId,resourceType,state,parcelId=null){
    const mod=ensureModuleState(state);const region=ensureRegion(state,regionId);const rg=mod.regionGeology[regionId]||{geologySeed:hashString(`${mod.worldSeed}|${regionId}|geology|0`).toString(16),revision:0};
    const parcels=getGeologicalParcels(regionId,state);const parcel=parcelId?parcels.find(p=>p.id===parcelId):parcels[0];
    if(!parcel)throw new Error(`Unknown geological parcel ${parcelId} in ${regionId}`);
    const geology=getRegionGeology(regionId,state);const localNoise=(unitNoise(rg.geologySeed,parcel.id,resourceType,'parcel-potential')-.5)*(.18+.18*geology.complexity);
    const potential=computeGeologyPotential(regionId,resourceType,state,localNoise);
    return {
      regionId,resourceType,parcelId:parcel.id,parcel:deepClone(parcel),potential:Number(potential.toFixed(4)),band:qualitativeBand(potential),
      geologySeed:rg.geologySeed,geologyRevision:rg.revision,surfaceRevision:mod.regionSurface[regionId]?.revision||0,worldSeed:mod.worldSeed,
      terrain:getRegionTerrain(regionId,state),geology,
      nearbyEndowment:Object.fromEntries(RESOURCE_TYPES.map(r=>[r,computeGeologyPotential(regionId,r,state,(unitNoise(rg.geologySeed,parcel.id,r,'parcel-potential')-.5)*(.18+.18*geology.complexity))]))
    };
  }

  function getSpatialContext(locationId,state){
    if(state.regions?.[locationId]){const r=state.regions[locationId];return{kind:'region',id:locationId,countryId:r.countryId||null,terrain:getRegionTerrain(locationId,state),geology:getRegionGeology(locationId,state)};}
    if(state.cities?.[locationId]){const c=state.cities[locationId];return{kind:'city',id:locationId,countryId:c.countryId||null,regionId:c.regionId||null};}
    return null;
  }

  function getDebugSnapshot(state){
    const mod=ensureModuleState(state);return{version:VERSION,worldSeed:mod.worldSeed,surfaceRevision:mod.surfaceRevision,geologyRevision:mod.geologyRevision,regions:Object.fromEntries(Object.keys(state.regions||{}).map(rid=>[rid,{terrain:getRegionTerrain(rid,state),geology:getRegionGeology(rid,state),parcels:getGeologicalParcels(rid,state),endowment:getAllResourceEndowment(rid,state),surfaceRevision:mod.regionSurface[rid]?.revision||0,geologyRevision:mod.regionGeology[rid]?.revision||0}]))};
  }

  return {
    VERSION,RESOURCE_TYPES,LITHOLOGY_RESOURCE_AFFINITY,GEOLOGY_TAG_MODIFIERS,TECTONIC_RESOURCE_MODIFIERS,TERRAIN_EXPOSURE,
    initialize,setRegionTerrain,applyTerrainOverlay,setRegionGeology,applyGeologyEvent,recalculateRegionEndowment,
    getRegionTerrain,getRegionGeology,getGeologicalParcels,getResourceEndowment,getAllResourceEndowment,getResourceIndications,getExplorationBasis,getSpatialContext,getDebugSnapshot,
    _internals:{hashString,unitNoise,normalizeComposition,qualitativeBand,surfaceExposure,computeGeologyPotential}
  };
});
