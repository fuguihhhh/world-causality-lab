/* ===== BORDER EPOCH — MODULE 10: RESEARCH & TECHNOLOGY ADAPTER ===== */
(function(global){
'use strict';
const BE=global.BorderEpoch=global.BorderEpoch||{};
const existing=BE.Research||global.BorderEpochResearch||null;
const core=global.BorderEpochResearchForgeCore||null;
const impl=existing||core;

if(!impl){
  const unavailable={
    VERSION:'1.0.0-module10-adapter-unavailable',
    available:false,
    error:'Research Forge Core is not loaded before be-module-10-research.js'
  };
  BE.Module10=unavailable;
  console.error('[Border Epoch] Module 10 unavailable:',unavailable.error);
  return;
}

const required=['initializeState','getDashboard','reportObservation','getProblems','getDirections','startProject','getProjects','prepareYear','simulateYear','finalizeYear','runSelfCheck'];
const missing=required.filter(name=>typeof impl[name]!=='function');
if(missing.length){
  console.error('[Border Epoch] Module 10 research API missing methods:',missing.join(', '));
}

// One public Research API, one shared gameState. No second research state and no independent clock.
BE.Research=impl;
BE.Module10=impl;
global.BorderEpochResearch=impl;
global.BorderEpochModule10=impl;

// If the unified Kernel is already present, expose the same object instead of creating another API.
if(BE.API&&typeof BE.API==='object'&&!BE.API.research) BE.API.research=impl;

impl.available=true;
impl.integrationVersion='1.0.0-module10-adapter';
impl.missingRequiredMethods=missing.slice();
})(typeof window!=='undefined'?window:globalThis);
/* ===== END MODULE 10 ===== */
