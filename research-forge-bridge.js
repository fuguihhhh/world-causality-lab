(function(global){
'use strict';
const FALLBACK=()=>global.BorderEpochResearchForgeCore;
function pickHostApi(explicit){return explicit||global.BorderEpoch?.Research||global.BorderEpochResearch||null;}
function has(api,name){return api&&typeof api[name]==='function';}
function Bridge(options={}){
 this.getGameState=options.getGameState||(()=>global.gameState||this._demoState);
 this.languageProvider=options.languageProvider||(()=>options.language||'zh');
 this.onClose=options.onClose||(()=>{}); this.onNavigate=options.onNavigate||(()=>{});
 this.hostApi=pickHostApi(options.researchAPI); this.fallback=FALLBACK();
 this._demoState=options.demoState||{turn:2030,worldSeed:'research-forge-demo',research:{}};
 this.api=this.hostApi||this.fallback;
 this.api?.initializeState?.(this.state());
}
Bridge.prototype.state=function(){return this.getGameState?.()||this._demoState};
Bridge.prototype.call=function(name,...args){const gs=this.state();if(has(this.api,name))return this.api[name](...args,gs);if(has(this.fallback,name))return this.fallback[name](...args,gs);return null;};
Bridge.prototype.dashboard=function(){const gs=this.state();if(has(this.api,'getDashboard'))return this.api.getDashboard(gs);const base=this.fallback.getDashboard(gs),hostStatus=has(this.api,'getResearchStatus')?this.api.getResearchStatus(gs):{};base.status={...base.status,...hostStatus,capabilityCount:base.status.capabilityCount,problemCount:base.sections.technicalProblems.length,projectCount:base.sections.researchProjects.filter(x=>x.status==='active').length,institutionCount:base.sections.institutions.length,discoveryCount:base.sections.discoveries.length,possibilityCount:base.sections.engineeringPossibilities.length};return base;};
Bridge.prototype.capCatalog=function(){return has(this.api,'getCapabilityCatalog')?this.api.getCapabilityCatalog(null,this.state()):this.fallback.getCapabilityCatalog(null,this.state())};
Bridge.prototype.domains=function(){return has(this.api,'getDomains')?this.api.getDomains(this.state()):this.fallback.getDomains(this.state())};
Bridge.prototype.clusters=function(domain){return has(this.api,'getClusters')?this.api.getClusters(domain,this.state()):this.fallback.getClusters(domain,this.state())};
Bridge.prototype.capability=function(id){const gs=this.state(),rich=this.fallback.getCapability(id,gs),host=has(this.hostApi,'getCapability')?this.hostApi.getCapability(id,gs):null;if(!host)return rich;if(Number.isFinite(+host.theory))return host;const level=Number.isFinite(+host.level)?+host.level:rich.level;return{...rich,...host,level,theory:level,experiment:level,engineering:level,industrial:level};};
Bridge.prototype.problems=function(){return this.call('getProblems')||[]};
Bridge.prototype.directions=function(pid){return this.call('getDirections',pid)||[]};
Bridge.prototype.projects=function(){return this.call('getProjects')||[]};
Bridge.prototype.institutions=function(){return this.call('getInstitutions')||[]};
Bridge.prototype.discoveries=function(){return this.call('getDiscoveries')||[]};
Bridge.prototype.possibilities=function(){return this.call('getEngineeringPossibilities')||[]};
Bridge.prototype.startProject=function(problemId,directionId){return this.call('startProject',{problemId,directionId,annualBudget:2.5})};
Bridge.prototype.reportObservation=function(o){return this.call('reportObservation',o)};
Bridge.prototype.advanceResearchYear=function(){const gs=this.state();this.call('prepareYear');const s=this.call('simulateYear');const f=this.call('finalizeYear');return{s,f,year:gs.time?.year??gs.turn};};
Bridge.prototype.isHostConnected=function(){return !!this.hostApi};
global.BorderEpochResearchForgeBridge=Bridge;
})(window);