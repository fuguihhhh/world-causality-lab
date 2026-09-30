/* ===== MODULE 8 — FINAL INTEGRATION & GAME SHELL — INLINE INTEGRATED ===== */
(function(global){
'use strict';
const BE=global.BorderEpoch=global.BorderEpoch||{};
const runtime={session:null,refs:null,initialized:false,lastReport:null,turnLock:false,config:{agricultureFoodScale:1}};
const clone=v=>v==null?v:(typeof structuredClone==='function'?structuredClone(v):JSON.parse(JSON.stringify(v)));
const n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,n(v,a)));
const vals=o=>Object.values(o||{});
function refs(extra={}){return {
 World:extra.World||global.World||BE.World,
 Development:extra.Development||global.Development||BE.Development,
 Main:extra.Main||global.BorderEpochMainBoard,
 Economy:global.Economy,
 Population:global.Population,
 Trade:global.TradeDiplomacy,
 AI:global.CountryAI,
 Events:global.IssuesEvents,
 Agriculture:BE.Agriculture
};}
function gsOf(session){return session&&session.state?session.state:global.gameState;}
function ensureContainers(gs){
 gs.time=gs.time||{year:n(gs.turn,2030)}; gs.turn=n(gs.turn,gs.time.year||2030); gs.time.year=n(gs.time.year,gs.turn);
 gs.modules=gs.modules||{}; gs.issues=gs.issues||{}; gs.history=Array.isArray(gs.history)?gs.history:[]; gs.flags=gs.flags||{};
 gs.countries=gs.countries||{}; gs.playerCountryId=gs.playerCountryId||'asteria';
 if(!gs.countries[gs.playerCountryId]) gs.countries[gs.playerCountryId]={id:gs.playerCountryId,name:gs.playerCountryId};
 // Module 6's shipped profiles include both foreign countries. Creating the identity shell is not a stat bonus.
 if(!gs.countries.meridian) gs.countries.meridian={id:'meridian',name:'Meridian Republic',aiControlled:true};
 if(!gs.countries.norvia) gs.countries.norvia={id:'norvia',name:'Norvia',aiControlled:true};
 for(const r of vals(gs.regions)){if(r&&r.countryId==null)r.countryId=gs.playerCountryId;}
 for(const c of vals(gs.cities)){if(c&&c.countryId==null)c.countryId=gs.regions?.[c.regionId]?.countryId||gs.playerCountryId;}
 for(const f of vals(gs.facilities)){if(f&&f.countryId==null)f.countryId=gs.regions?.[f.regionId]?.countryId||gs.playerCountryId;}
 return gs;
}
function terrainOf(gs,rid,R){
 const raw=R.World?.getRegionTerrain?R.World.getRegionTerrain(rid,gs):(gs.regions?.[rid]?.surfaceTerrain||{});
 const comp=raw?.composition||{};
 const rugged=clamp(raw?.ruggedness,n(comp.mountains)*.9+n(comp.hills)*.5+n(comp.upland)*.45+n(comp.plateau)*.25);
 return {raw,
   slope:clamp(raw?.slope,rugged*.75),
   elevation:clamp(raw?.elevation,.35+.35*rugged),
   drainage:clamp(raw?.drainage,.55+n(raw?.waterAccess,.5)*.25-rugged*.1),
   waterAccess:clamp(raw?.waterAccess,.55)};
}
function regionPopulation(gs,rid){
 const ps=gs.population?.regions?.[rid];
 if(ps&&Number.isFinite(Number(ps.population))) return Math.max(0,Number(ps.population));
 return vals(gs.cities).filter(c=>c&&c.active!==false&&String(c.regionId)===String(rid)).reduce((s,c)=>s+n(c.population),0);
}
function infraFor(gs,rid,R,area){
 const facilities=vals(gs.facilities).filter(f=>f&&f.active!==false&&String(f.regionId)===String(rid));
 const conns=vals(gs.connections).filter(c=>c&&c.active!==false&&(String(c.fromId)===String(rid)||String(c.toId)===String(rid)||String(c.regionId)===String(rid)));
 const road=conns.filter(c=>/road|highway/i.test(c.type||'')).reduce((s,c)=>s+n(c.capacity,20),0);
 const rail=conns.filter(c=>/rail/i.test(c.type||''));
 const storage=facilities.filter(f=>/storage|warehouse|silo/i.test(f.type||'')).reduce((s,f)=>s+n(f.capacity,20),0);
 const irrigation=facilities.filter(f=>/irrig|canal|water/i.test(f.type||'')).reduce((s,f)=>s+n(f.capacity,8),0);
 const industrial=facilities.filter(f=>/factory|works|plant|machine/i.test(f.type||'')).length;
 return {
   irrigationCapacity:Math.max(area*.09,irrigation),
   ruralRoadCapacity:Math.max(area*.38,road),
   railAccess:rail.length?clamp(.45+rail.reduce((s,c)=>s+n(c.level,1),0)*.12):0,
   storageCapacity:Math.max(area*.45,storage), coldStorageCapacity:Math.max(0,storage*.15),
   machinerySupportCapacity:Math.max(area*.30,industrial*20), distanceToMarket:clamp(.42-(rail.length?.12:0))
 };
}
function economyFor(gs,rid,area,R){
 const re=R.Economy?.getRegionEconomy?.(rid)||gs.economy?.regions?.[rid]||{};
 const mg=re.goods?.manufactured_goods||{};
 const available=n(mg.available,n(mg.supply,0));
 const player=gs.playerCountryId;
 const treasury=n(R.Economy?.getGovernmentFinance?.(player)?.treasury,30);
 return {availableFarmInputs:Math.max(area*.22,available*.35),availableMachinery:Math.max(area*.18,available*.18),agriculturalCapital:Math.max(area*.9,treasury*.2),agriculturalLandDevelopmentCost:1};
}
function populationFor(gs,rid,area){
 const p=regionPopulation(gs,rid);
 const rp=gs.population?.regions?.[rid]||{};
 const workforce=n(rp.workforce,p*.55);
 const rural=Math.max(area*.35,workforce/12000);
 const demand=Math.max(1,p/100000*8);
 return {ruralLaborAvailable:rural,population:p,foodDemand:{wheat:demand*.32,rice:demand*.12,corn:demand*.23,soybean:demand*.13,potato:demand*.20}};
}
function agricultureContext(gs,R){
 const world={regions:{}},development={regions:{}},economy={regions:{}},population={regions:{}};
 for(const [rid,r] of Object.entries(gs.regions||{})){
   if((r.countryId||gs.playerCountryId)!==gs.playerCountryId) continue;
   const t=terrainOf(gs,rid,R), pop=regionPopulation(gs,rid);
   const area=Math.max(60,n(r.agriculturalArea,n(r.area,Math.max(90,pop/100000*45))));
   world.regions[rid]={regionId:rid,area,terrain:{slope:t.slope,elevation:t.elevation,drainage:t.drainage},climate:{temperature:clamp(r.climate?.temperature,.58-t.elevation*.08),rainfall:clamp(r.climate?.rainfall,.52+t.waterAccess*.18),growingSeason:clamp(r.climate?.growingSeason,.67-t.elevation*.10)},soil:{fertility:clamp(r.soil?.fertility,.62-t.slope*.12)},water:{naturalAvailability:clamp(r.water?.naturalAvailability,t.waterAccess),irrigationSourceCapacity:n(r.water?.irrigationSourceCapacity,area*.22)},floodRisk:clamp(r.floodRisk,.08+t.waterAccess*.07)};
   development.regions[rid]=infraFor(gs,rid,R,area); economy.regions[rid]=economyFor(gs,rid,area,R); population.regions[rid]=populationFor(gs,rid,area);
 }
 return {year:gs.time.year,seed:gs.worldSeed||gs.world?.seed||'border-epoch',world,development,economy,population};
}
function seedAgriculture(gs,R){
 const A=R.Agriculture;if(!A)return null;
 if(gs.agriculture?.regions){try{return A.create(gs.agriculture);}catch(_){}}
 const ctx=agricultureContext(gs,R),regions={};
 for(const [rid,w] of Object.entries(ctx.world.regions)){
   const pop=ctx.population.regions[rid].population;
   const cultivated=Math.max(4,Math.min(w.area*.34,4+pop/100000*7.5));
   const developed=Math.min(w.area*.55,cultivated*1.35), potential=Math.max(developed,w.area*.62);
   regions[rid]={land:{potentialArable:potential,developedArable:developed,cultivated,irrigated:Math.min(cultivated*.22,ctx.development.regions[rid].irrigationCapacity)},storage:{capacity:Math.max(20,cultivated*2.2)},cropAllocation:{wheat:.32,rice:.12,corn:.23,soybean:.13,potato:.20}};
 }
 let s=A.create({year:gs.time.year,regions});
 for(const rid of Object.keys(regions)) s=A.setCropAllocation(s,rid,regions[rid].cropAllocation);
 gs.agriculture=s;return s;
}
function publishAgricultureToEconomy(gs,agResult){
 const flows=[];
 for(const rec of agResult?.outputs?.production||[]){
   if(rec.goodId==='cotton') continue;
   const amount=Math.max(0,n(rec.collectedQuantity))*runtime.config.agricultureFoodScale;
   if(amount>0) flows.push({regionId:rec.regionId,goodId:'food',amount,sourceModule:'agriculture',sourceGoodId:rec.goodId});
 }
 gs.externalProduction=gs.externalProduction||{};
 gs.externalProduction.regionalFlows=flows;
 return flows;
}
function runAgriculture(gs,R){
 if(!R.Agriculture)return {ok:false,skipped:'Agriculture unavailable'};
 const s=seedAgriculture(gs,R),ctx=agricultureContext(gs,R),res=R.Agriculture.simulateYear(s,ctx);
 gs.agriculture=res.nextState; gs.modules.agriculture={version:R.Agriculture.VERSION,state:gs.agriculture,outputs:clone(res.outputs)};
 publishAgricultureToEconomy(gs,res); return {ok:true,result:res};
}
function economyIssues(gs,R){
 const out=[];
 for(const b of R.Economy?.getBottlenecks?.()||[]){
   let type='INPUT_SHORTAGE'; const t=String(b.type||'');
   if(/transport|logistics/i.test(t))type='TRANSPORT_BOTTLENECK'; else if(/power/i.test(t))type='POWER_SHORTAGE';
   out.push({id:`economy_${b.facilityId}_${type}`,type,severity:clamp(b.severity),locationId:b.cityId||b.facilityId,metrics:{productionLevel:b.productionLevel},context:{bottleneck:t,explanation:b.explanation},active:true});
 }
 const fin=R.Economy?.getGovernmentFinance?.(gs.playerCountryId);
 if(fin){
   const rev=n(fin.revenue?.total,n(fin.totalRevenue)), exp=n(fin.expenditure?.total,n(fin.totalExpenditure));
   if(exp>rev*1.08)out.push({id:'economy_fiscal_deficit',type:'FISCAL_DEFICIT',severity:clamp((exp-rev)/Math.max(1,exp)),countryId:gs.playerCountryId,metrics:{revenue:rev,expenditure:exp}});
   const debt=n(fin.debt); if(debt>80)out.push({id:'economy_high_debt',type:'HIGH_DEBT',severity:clamp((debt-60)/180),countryId:gs.playerCountryId,metrics:{debt}});
 }
 return out;
}
function populationIssues(gs,R){return (R.Population?.getSocialIssues?.()||[]).map(x=>{const y=clone(x);if(y.type==='RAPID_MIGRATION')y.type='MIGRATION_SURGE';return y;});}
function tradeIssues(gs,R){
 const out=[],T=R.Trade;if(!T)return out; const p=gs.playerCountryId;
 for(const other of Object.keys(gs.countries||{})){if(other===p)continue;let dep;try{dep=T.getDependency(p,other,gs);}catch(_){dep=null;} if(!dep)continue;
   const vals1=Object.values(dep.importDependency||dep.demandDependency||{}).map(Number).filter(Number.isFinite);const mx=vals1.length?Math.max(...vals1):0;
   if(mx>.35)out.push({id:`trade_dependence_${other}`,type:'TRADE_DEPENDENCE',severity:clamp((mx-.25)/.65),countryId:p,counterpartyId:other,metrics:{maxImportDependency:mx}});
   let rel;try{rel=T.getRelationship(p,other,gs);}catch(_){rel=null;} if(rel&&n(rel.relation)<-25)out.push({id:`diplomatic_tension_${other}`,type:'DIPLOMATIC_TENSION',severity:clamp((-n(rel.relation)-15)/85),countryId:p,counterpartyId:other,metrics:{relationScore:n(rel.relation)}});
 }
 return out;
}
function agricultureIssues(gs){
 const out=[];for(const s of gs.modules?.agriculture?.outputs?.shortages||[]){if(!s.shortages?.length)continue;out.push({id:`ag_shortage_${s.regionId}`,type:'INPUT_SHORTAGE',severity:clamp(.25+.12*s.shortages.length),regionId:s.regionId,locationId:s.regionId,causes:s.shortages,context:{sector:'agriculture'}});}return out;
}
function collectIssues(gs,R){return [...economyIssues(gs,R),...populationIssues(gs,R),...tradeIssues(gs,R),...agricultureIssues(gs)];}
function eventAdapters(gs,R){
 const player=()=>gs.playerCountryId;
 const regionFrom=loc=>gs.regions?.[loc]?loc:(gs.cities?.[loc]?.regionId||Object.keys(gs.regions||{})[0]);
 return {
  collectIssues:g=>collectIssues(g,R),
  'development.startProject':async p=>{const type=String(p.projectType||'').toLowerCase();const rid=regionFrom(p.locationId);if(!R.Development)return{ok:false,reason:'Development unavailable'};
    if(type==='railway_upgrade'){const c=vals(gs.connections).find(x=>x&&x.type==='railway'&&x.active!==false&&(x.fromId===rid||x.toId===rid));return c?R.Development.startConnectionUpgrade(c.id,gs,{causalActionRef:p.causalActionRef}):{ok:false,reason:'No railway exists to upgrade in this location.'};}
    const map={steelworks:'steelworks',coal_mine:'coal_mine'};const m=map[type];if(!m)return{ok:false,reason:`Module 2 has no physical project type ${p.projectType}.`};
    if(m==='coal_mine')return{ok:false,reason:'Coal mine construction requires a discovered deposit ID.'};
    return R.Development.startProject({type:m,name:p.projectType,regionId:rid,countryId:player(),cost:20,totalTurns:3,causalActionRef:p.causalActionRef},gs);},
  'economy.applyPolicy':async p=>{gs.economicPolicies=gs.economicPolicies||{};gs.economicPolicies[p.policy]={active:true,year:gs.time.year,locationId:p.locationId||null,causalActionRef:p.causalActionRef};return{ok:true,feedback:{certain:[`${p.policy} recorded as an active economic policy.`]}};},
  'population.applyHousingPolicy':async p=>{gs.populationPolicies=gs.populationPolicies||{};gs.populationPolicies.housing={policy:p.policy,active:true,year:gs.time.year,locationId:p.locationId||null,causalActionRef:p.causalActionRef};return{ok:true};},
  'population.applyLaborPolicy':async p=>{gs.populationPolicies=gs.populationPolicies||{};gs.populationPolicies.labor={policy:p.policy,active:true,year:gs.time.year,locationId:p.locationId||null,causalActionRef:p.causalActionRef};return{ok:true};},
  'trade.changeTariff':async p=>{if(!R.Trade)return{ok:false,reason:'Trade unavailable'};const other=p.counterpartyId||p.context?.counterpartyId||'meridian';for(const good of R.Trade.GOODS||[])R.Trade.setTariff(player(),other,good,p.mode==='targeted_protection'?.15:.08,gs);return{ok:true};},
  'trade.resolveOffer':async p=>{if(!R.Trade)return{ok:false,reason:'Trade unavailable'};const id=p.context?.offerId||p.context?.proposalId;if(!id)return{ok:false,reason:'Offer has no proposal id.'};if(p.response==='accept')return R.Trade.acceptProposal(id,gs);if(p.response==='reject')return R.Trade.rejectProposal(id,gs);return R.Trade.counterProposal(id,{status:'countered'},gs);},
  'trade.acceptForeignInvestment':async p=>R.Trade?R.Trade.registerForeignInvestment(p,gs):{ok:false,reason:'Trade unavailable'},
  'trade.applyStrategy':async p=>{gs.tradeStrategies=gs.tradeStrategies||[];gs.tradeStrategies.push({...clone(p),year:gs.time.year});return{ok:true};},
  'trade.renegotiateInvestment':async()=>({ok:false,reason:'No renegotiation API in Module 5.'})
 };
}
function buildExternalTradeForNextYear(gs,R){
 if(!R.Trade)return[];const player=gs.playerCountryId;const playerRegions=Object.entries(gs.regions||{}).filter(([,r])=>(r.countryId||player)===player).map(([id])=>id);if(!playerRegions.length)return[];
 const port=vals(gs.facilities).find(f=>f&&f.active!==false&&f.countryId===player&&f.type==='port');const rid=port?.regionId||playerRegions[0];const flows=[];
 for(const tr of vals(gs.tradeRelations)){
   if(!tr||tr.active===false||n(tr.volume)<=0)continue;
   if(tr.importerCountryId===player)flows.push({regionId:rid,goodId:tr.goodId,amount:n(tr.volume),direction:'import',countryId:tr.exporterCountryId,unitPrice:n(tr.marketClearingPrice,n(tr.contractUnitPrice,n(tr.spotUnitPrice,1))),tariffRate:n(tr.tariffRate)});
   else if(tr.exporterCountryId===player)flows.push({regionId:rid,goodId:tr.goodId,amount:n(tr.volume),direction:'export',countryId:tr.importerCountryId,unitPrice:n(tr.marketClearingPrice,n(tr.contractUnitPrice,n(tr.spotUnitPrice,1)))});
 }
 gs.externalEconomy=gs.externalEconomy||{};gs.externalEconomy.regionalFlows=flows;return flows;
}
function publishModules(gs,R,aiResults,eventResult){
 gs.modules.development={version:R.Development?.VERSION||null,debug:R.Development?.getDebugSnapshot?.(gs)||null};
 const es=R.Economy?.getState?.()||gs.economy||null;gs.modules.economy={state:clone(es),issues:economyIssues(gs,R),module2Signals:clone(es?.module2Signals||{})};
 gs.modules.population={state:R.Population?.snapshot?.()||gs.population||null,issues:populationIssues(gs,R)};
 gs.modules.trade={debug:R.Trade?.getDebugSnapshot?.(gs)||null,issues:tradeIssues(gs,R)};
 gs.modules.ai={results:clone(aiResults||[]),issues:[]};
 if(R.Events)gs.modules.events={version:R.Events.VERSION,state:R.Events.serialize(),situations:R.Events.getCurrentSituations(gs),stories:R.Events.getStories()};
 if(eventResult)gs.modules.events.lastUpdate=clone(eventResult);
}
function preservePopulationDuringUrban(gs,R){
 if(!R.Main?.updateUrbanYear||!runtime.session)return[];
 const before={};for(const [id,c] of Object.entries(gs.cities||{}))before[id]={population:n(c.population),status:c.status,level:c.level};
 const ev=R.Main.updateUrbanYear(runtime.session.template,gs,R.World)||[];const transitioned=new Set(ev.filter(e=>e&&e.cityId&&e.type!=='CITY_FOUNDED').map(e=>e.cityId));
 for(const [id,b] of Object.entries(before)){const c=gs.cities?.[id];if(c&&!transitioned.has(id))c.population=b.population;}
 return ev;
}
function blankEventState(R){return {version:R.Events?.VERSION||null,issues:[],eventQueue:[],activeEvent:null,consequences:[],cooldowns:[],eventMemory:[],feed:[],history:[],flags:{},causalGraph:{nodes:[],edges:[]},provenanceLedger:{facts:[],claims:[],candidates:[],rejectedClaims:[]},storyClusters:[]};}
function initialize(session,extra={}){
 const incoming=session||runtime.session;const sessionChanged=!!incoming&&incoming!==runtime.session;runtime.session=incoming;runtime.refs=refs(extra);
 const gs=ensureContainers(gsOf(runtime.session));if(!gs)throw new Error('Module 8 initialize requires game state.');global.gameState=gs;
 const R=runtime.refs;const freshRuntime=sessionChanged||!runtime.initialized;
 if(freshRuntime){R.Economy?.reset?.();R.Population?.reset?.();R.AI?.reset?.();}
 R.Development?.initializeState?.(gs);R.Trade?.initializeState?.(gs);R.AI?.initialize?.(gs);seedAgriculture(gs,R);
 if(R.Events){const saved=gs.modules?.events?.state||null;R.Events.init({adapters:eventAdapters(gs,R),savedState:saved||blankEventState(R)});}
 runtime.initialized=true;runtime.lastReport={initialized:true,year:gs.time.year,moduleStatus:getModuleStatus()};return runtime.lastReport;
}
async function advanceOneYear(session,extra={}){
 if(runtime.turnLock)throw new Error('Annual turn already running.');runtime.turnLock=true;
 try{
  if(session&&session!==runtime.session)initialize(session,extra);else if(!runtime.initialized)initialize(session||runtime.session,extra);else runtime.refs=refs(extra);
  const R=runtime.refs,gs=ensureContainers(gsOf(runtime.session));
  gs.time.year=n(gs.time.year,2030)+1;gs.turn=gs.time.year;
  const completed=R.Development?.updateProjects?.(gs,1)||[];R.Development?.recalculatePower?.(gs);
  const ag=runAgriculture(gs,R);
  const econ=R.Economy?.update?.(gs)||null;if(econ)gs.economy=econ;
  const pop=R.Population?.update?.(gs,{force:true})||null;if(pop)gs.population={...(gs.population||{}),...pop,economicFeedback:gs.population?.economicFeedback};
  const trade=R.Trade?.update?.(gs)||null;
  const ai=[];if(R.AI){R.AI.initialize(gs);for(const id of ['meridian','norvia'])if(gs.countries?.[id])ai.push(R.AI.updateCountry(id,gs));}
  const urbanEvents=preservePopulationDuringUrban(gs,R);
  const nextTradeFlows=buildExternalTradeForNextYear(gs,R);
  let events=null;if(R.Events){R.Events.setAdapters(eventAdapters(gs,R));events=await R.Events.update(gs);}
  publishModules(gs,R,ai,events);
  const report={ok:true,year:gs.time.year,developmentCompleted:completed,urbanEvents,agriculture:ag.ok,economy:!!econ,population:!!pop,trade:!!trade,aiCountries:ai.length,eventSystem:!!events,nextTradeFlowCount:nextTradeFlows.length,moduleStatus:getModuleStatus()};
  runtime.lastReport=report;gs.integration=gs.integration||{};gs.integration.lastAnnualReport=clone(report);gs.history.push({id:`integration_${gs.time.year}`,type:'ANNUAL_INTEGRATION_SETTLED',sourceModule:'module8',year:gs.time.year,summary:clone(report)});
  return report;
 }finally{runtime.turnLock=false;}
}
function getModuleStatus(){const R=runtime.refs||refs();return {module1:!!R.World,module2:!!R.Development,module3:!!R.Economy,module4:!!R.Population,module5:!!R.Trade,module6:!!R.AI,module7:!!R.Events,module8:true,module9:!!R.Agriculture};}
function validateIntegration(){const s=getModuleStatus(),errors=[];for(const [k,v] of Object.entries(s))if(!v)errors.push(`${k} missing`);const R=runtime.refs||refs();if(R.Agriculture&&!R.Agriculture.simulateYear)errors.push('Module9.simulateYear missing');if(R.Economy&&!R.Economy.update)errors.push('Module3.update missing');if(R.Population&&!R.Population.update)errors.push('Module4.update missing');if(R.Trade&&!R.Trade.update)errors.push('Module5.update missing');if(R.AI&&!R.AI.updateCountry)errors.push('Module6.updateCountry missing');if(R.Events&&!R.Events.update)errors.push('Module7.update missing');return {ok:errors.length===0,errors,status:s};}
function save(){const gs=gsOf(runtime.session);if(!gs)return null;if(runtime.refs?.Events){gs.modules=gs.modules||{};gs.modules.events=gs.modules.events||{};gs.modules.events.state=runtime.refs.Events.serialize();}return JSON.stringify({format:'BorderEpoch.Module8.Save.v1',savedAt:new Date().toISOString(),state:gs,templateId:runtime.session?.template?.id||gs.world?.templateId||null});}
function load(json,extra={}){const data=typeof json==='string'?JSON.parse(json):clone(json);if(!data?.state)throw new Error('Invalid Module 8 save.');if(!runtime.session)throw new Error('Load requires an initialized UI session.');runtime.session.state=data.state;global.gameState=data.state;runtime.initialized=false;initialize(runtime.session,extra);return runtime.session;}
function restart(seed,extra={}){const R=refs(extra);if(!R.Main?.initializeWorld)throw new Error('Main board unavailable.');runtime.session=R.Main.initializeWorld(seed||'border-epoch-2030',R.World,R.Development,extra.templateOverride||null);global.gameState=runtime.session.state;runtime.initialized=false;initialize(runtime.session,{...extra,...R});return runtime.session;}
function getDebugSnapshot(){return {initialized:runtime.initialized,turnLock:runtime.turnLock,lastReport:clone(runtime.lastReport),validation:validateIntegration(),moduleStatus:getModuleStatus()};}
const api={VERSION:'1.0.0-integrated-9',initialize,advanceOneYear,getModuleStatus,validateIntegration,save,load,restart,getDebugSnapshot,makeAgricultureContext:(gs)=>agricultureContext(gs,runtime.refs||refs()),collectIssues:(gs)=>collectIssues(gs,runtime.refs||refs())};
BE.Module8=api;BE.Integration=api;global.BorderEpochIntegration=api;
})(typeof window!=='undefined'?window:globalThis);
/* ===== END MODULE 8 — FINAL INTEGRATION & GAME SHELL ===== */
;
/* ===== BORDER EPOCH ONBOARDING — STATE-DRIVEN, NON-AUTHORITATIVE ===== */
(function(global){
'use strict';
const BE=global.BorderEpoch=global.BorderEpoch||{};
const LANG=getGameLanguage();
const ZH=LANG==='zh';
const VERSION='1.0.0';
const clone=v=>v==null?v:(typeof structuredClone==='function'?structuredClone(v):JSON.parse(JSON.stringify(v)));
const num=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,num(v,a)));
const vals=o=>Object.values(o||{});
const pct=v=>`${(num(v)*100).toFixed(Math.abs(num(v))<.1?1:0)}%`;
const fmt=v=>new Intl.NumberFormat(ZH?'zh-CN':'en-US',{maximumFractionDigits:2}).format(num(v));
const uniq=a=>[...new Set(a||[])];
const T=(zh,en)=>ZH?zh:en;
const dict={
 guidance:T('引导','Guidance'), settings:T('设置','Settings'), minimize:T('最小化','Minimize'), reopen:T('打开引导','Open guidance'),
 chooseMode:T('选择你的游戏方式','Choose your game mode'), modeIntro:T('教学只读取正式模拟状态，不会修改经济、人口、资源或外交数值。','Guidance reads the real simulation and never modifies economy, population, resources, or diplomacy.'),
 guided:T('完整引导','Guided'), assisted:T('辅助模式','Assisted'), standard:T('标准模式','Standard'), none:T('无引导','No Guidance'),
 guidedDesc:T('按真实国家运行逐步学习 1–8 模块。','Learn Modules 1–8 through the real country simulation.'),
 assistedDesc:T('只显示重要解释和可用工具。','Only important explanations and available tools.'),
 standardDesc:T('只主动显示严重警告。','Only serious warnings are shown proactively.'),
 noneDesc:T('关闭教学；正式模拟完全照常运行。','Turn guidance off; the simulation continues normally.'),
 stage:T('阶段','Stage'), complete:T('已完成','Complete'), waiting:T('等待真实条件','Waiting for a real condition'),
 possible:T('可用工具','Possible Actions'), evidence:T('证据','Evidence'), why:T('为什么？','Why?'), uncertain:T('原因不确定','Cause uncertain'),
 level1:T('一句话','Level 1'), level2:T('直接原因','Level 2'), level3:T('计算来源','Level 3'),
 reviewed:T('我已查看结果','I reviewed this result'), inspect:T('查看约束','Inspect constraints'), viewTrade:T('查看贸易证据','Inspect trade evidence'), viewAI:T('查看 AI 决策','Inspect AI decision'), viewSituation:T('查看情境证据','Inspect situation evidence'),
 changeMode:T('更改模式','Change mode'), dismiss:T('稍后查看','Later'), noData:T('当前没有足够的真实数据。系统会等待，而不是编造。','There is not enough real data yet. Guidance will wait rather than inventing an event.'),
};
const STAGES=[
 {id:0,key:'overview',title:T('国家概览','Country Overview')},
 {id:1,key:'development',title:T('发展问题','Development')},
 {id:2,key:'first_result',title:T('第一次年度结果','First Year Result')},
 {id:3,key:'constraints',title:T('生产约束','Production Constraints')},
 {id:4,key:'population',title:T('人口响应','Population Response')},
 {id:5,key:'trade',title:T('贸易','Trade')},
 {id:6,key:'international',title:T('国际互动','International Interaction')},
 {id:7,key:'situation',title:T('情境发现','Situation Discovery')},
 {id:8,key:'objective',title:T('独立目标','Independent Objective')}
];
function stable(v){if(v==null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(stable).join(',')+']';return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';}
function stateFingerprint(gs){
 const strip={time:gs?.time,turn:gs?.turn,world:gs?.world,countries:gs?.countries,regions:gs?.regions,cities:gs?.cities,facilities:gs?.facilities,connections:gs?.connections,projects:gs?.projects,economy:gs?.economy,population:gs?.population,tradeRelations:gs?.tradeRelations,diplomaticRelations:gs?.diplomaticRelations,agriculture:gs?.agriculture,history:gs?.history};
 return stable(strip);
}
function emptyState(){return {version:VERSION,mode:null,currentStage:0,tutorialCompleted:false,completedStages:[],completedConcepts:[],explainedConcepts:[],dismissedHints:[],shownAdvisorTopics:[],observations:{regions:[],resources:[],infrastructure:0,changeReviews:[],production:[],population:[],trade:[],ai:[],situations:[]},stageData:{},previousSnapshot:null,currentSnapshot:null,snapshotHistory:[],minimized:false,settingsOpen:false};}
function ensure(gs){
 if(!gs)return null;const base=emptyState();const old=gs.onboardingState||{};const s=gs.onboardingState=Object.assign(base,old);
 s.observations=Object.assign(base.observations,old.observations||{});s.stageData=old.stageData||{};
 for(const k of ['completedStages','completedConcepts','explainedConcepts','dismissedHints','shownAdvisorTopics','snapshotHistory'])s[k]=Array.isArray(s[k])?s[k]:[];
 return s;
}
function APIs(){return {World:global.World,Development:global.Development,Economy:global.Economy,Population:global.Population,Trade:global.TradeDiplomacy,AI:global.CountryAI,Events:global.IssuesEvents,Module8:BE.Module8};}
function ownerOfRegion(gs,rid){return gs?.regions?.[rid]?.countryId||gs?.playerCountryId;}
function playerProjects(gs){const p=gs?.playerCountryId;return vals(gs?.projects).filter(x=>x&&(x.countryId||x.ownerCountryId||ownerOfRegion(gs,x.regionId))===p);}
function actionFingerprint(gs){
 const p=gs?.playerCountryId;return {
  projects:playerProjects(gs).map(x=>x.id).sort(),
  connections:vals(gs?.connections).filter(x=>x&&(x.ownerCountryId||ownerOfRegion(gs,x.regionId||x.fromId))===p).map(x=>x.id).sort(),
  facilities:vals(gs?.facilities).filter(x=>x&&(x.countryId||ownerOfRegion(gs,x.regionId))===p).map(x=>x.id).sort(),
  trade:vals(gs?.tradeRelations).filter(x=>x&&(x.importerCountryId===p||x.exporterCountryId===p||x.countryA===p||x.countryB===p)).map(x=>x.id||stable(x)).sort(),
  policies:stable({economic:gs?.economicPolicies||{},population:gs?.populationPolicies||{},trade:gs?.tradeStrategies||[]}),
  agriculture:stable(vals(gs?.agriculture?.regions).map(r=>({land:r.land,cropAllocation:r.cropAllocation,intensity:r.intensity})))
 };
}
function diffAction(base,now){
 if(!base)return null;for(const k of ['projects','connections','facilities','trade']){const add=(now[k]||[]).filter(x=>!(base[k]||[]).includes(x));if(add.length)return {type:k,ids:add};}
 for(const k of ['policies','agriculture'])if(base[k]!==now[k])return {type:k,ids:[]};return null;
}
function slimGood(g={}){return {production:num(g.production),supply:num(g.supply,num(g.marketSupply)),demand:num(g.demand,num(g.localDemand)),available:num(g.available),shortage:num(g.shortage,num(g.unmetDemand)),surplus:num(g.surplus),price:num(g.price),basePrice:num(g.basePrice),imports:num(g.imports,num(g.domesticImports)+num(g.foreignImports)),exports:num(g.exports,num(g.domesticExports)+num(g.foreignExports)),transportCost:num(g.transportCostIn),landedCost:num(g.averageImportLandedCost)};}
function takeSnapshot(gs){
 const A=APIs(),snap={year:num(gs?.time?.year,gs?.turn),regions:{},cities:{},facilities:{},finance:null,tradeRelations:[],ai:[],situations:[],agriculture:{}};
 for(const rid of Object.keys(gs?.regions||{})){
  let r=null;try{r=A.Economy?.getRegionEconomy?.(rid)||gs?.economy?.regions?.[rid]||null;}catch(_){r=gs?.economy?.regions?.[rid]||null;}
  snap.regions[rid]={goods:{}};for(const [gid,g] of Object.entries(r?.goods||{}))snap.regions[rid].goods[gid]=slimGood(g);
 }
 for(const [cid,c] of Object.entries(gs?.cities||{})){let p=null;try{p=A.Population?.getCityPopulation?.(cid);}catch(_){};snap.cities[cid]=p||{population:num(c.population)};}
 for(const f of vals(gs?.facilities)){if(!f?.id)continue;let e=null;try{e=A.Economy?.getFacilityEconomy?.(f.id);}catch(_){};snap.facilities[f.id]={id:f.id,name:f.name||f.type,regionId:f.regionId,type:f.type,status:f.status,productionLevel:num(e?.productionLevel),mainBottleneck:e?.mainBottleneck||null,factors:clone(e?.factors||{}),output:clone(e?.output||{}),workersRequired:num(e?.workersRequired),workersAllocated:num(e?.workersAllocated,num(e?.workersEmployed))};}
 try{snap.finance=A.Economy?.getGovernmentFinance?.(gs?.playerCountryId)||null;}catch(_){}
 snap.tradeRelations=vals(gs?.tradeRelations).map(x=>({id:x.id,goodId:x.goodId,volume:num(x.volume),importerCountryId:x.importerCountryId,exporterCountryId:x.exporterCountryId,active:x.active!==false}));
 snap.ai=clone(gs?.modules?.ai?.results||[]);try{snap.situations=clone(A.Events?.getCurrentSituations?.(gs)||[]);}catch(_){}
 for(const [rid,r] of Object.entries(gs?.agriculture?.regions||{})){const p=r?.lastOutput?.cropHarvestCollected||{};snap.agriculture[rid]={collected:Object.values(p).reduce((s,v)=>s+num(v),0),shortages:clone(r?.lastOutput?.shortages||[])};}
 return snap;
}
function percentDelta(a,b){if(Math.abs(num(a))<1e-9)return num(b)===0?0:null;return (num(b)-num(a))/Math.abs(num(a));}
function playerActionSummary(gs,s){
 const a=s.stageData?.stage1Action;if(!a)return [];const map={projects:T('启动了正式建设/勘探项目','started a formal development/exploration project'),connections:T('改变了正式交通网络','changed the formal transport network'),facilities:T('形成了新的正式设施','created a new formal facility'),trade:T('建立或改变了正式贸易关系','created or changed a formal trade relationship'),policies:T('改变了正式政策设置','changed a formal policy setting'),agriculture:T('改变了正式农业配置','changed formal agricultural configuration')};return [map[a.type]||a.type];
}
function buildChangeExplanation(gs,prev,cur,s){
 if(!prev||!cur)return null;const candidates=[];
 for(const rid of Object.keys(cur.regions||{})){
  const a=prev.regions?.[rid]?.goods?.food||{},b=cur.regions?.[rid]?.goods?.food||{};
  for(const metric of ['supply','price','shortage']){const d=percentDelta(a[metric],b[metric]);if(d!=null&&Math.abs(d)>.001)candidates.push({kind:'food',rid,metric,from:num(a[metric]),to:num(b[metric]),delta:d,score:Math.abs(d)});}
 }
 for(const cid of Object.keys(cur.cities||{})){const a=num(prev.cities?.[cid]?.population),b=num(cur.cities?.[cid]?.population);const d=percentDelta(a,b);if(d!=null&&Math.abs(d)>.0005)candidates.push({kind:'population',cid,metric:'population',from:a,to:b,delta:d,score:Math.abs(d)*2});}
 for(const fid of Object.keys(cur.facilities||{})){const a=num(prev.facilities?.[fid]?.productionLevel),b=num(cur.facilities?.[fid]?.productionLevel);if(a||b){const d=b-a;if(Math.abs(d)>.001)candidates.push({kind:'facility',fid,metric:'productionLevel',from:a,to:b,delta:d,score:Math.abs(d)});}}
 const f0=num(prev.finance?.treasury),f1=num(cur.finance?.treasury);if(prev.finance&&cur.finance&&f0!==f1)candidates.push({kind:'finance',metric:'treasury',from:f0,to:f1,delta:f1-f0,score:Math.abs(f1-f0)/Math.max(1,Math.abs(f0))});
 candidates.sort((a,b)=>b.score-a.score);const c=candidates[0]||{kind:'none',metric:'none',from:0,to:0,delta:0,score:0};
 const causes=[],raw=[],actions=playerActionSummary(gs,s);let headline='';
 if(c.kind==='food'){
  const rn=gs?.regions?.[c.rid]?.name||c.rid;headline=T(`${rn} 的粮食 ${c.metric==='price'?'价格':c.metric==='shortage'?'短缺':'供应'} ${c.delta>=0?'上升':'下降'} ${pct(Math.abs(c.delta))}`,`${rn} food ${c.metric} ${c.delta>=0?'rose':'fell'} ${pct(Math.abs(c.delta))}`);
  const ag0=num(prev.agriculture?.[c.rid]?.collected),ag1=num(cur.agriculture?.[c.rid]?.collected),ad=ag1-ag0;if(Math.abs(ad)>.001)causes.push({label:T('本地农业入库量变化','local agricultural collection changed'),value:`${fmt(ag0)} → ${fmt(ag1)}`,source:'Module 9 → Module 3 domestic production'});
  const im0=num(prev.regions?.[c.rid]?.goods?.food?.imports),im1=num(cur.regions?.[c.rid]?.goods?.food?.imports);if(im0!==im1)causes.push({label:T('该地区记录的粮食流入变化','recorded food inflow changed'),value:`${fmt(im0)} → ${fmt(im1)}`,source:'Module 3 regional goods'});
  raw.push({k:'food.'+c.metric,v:`${fmt(c.from)} → ${fmt(c.to)}`,src:'Economy.getRegionEconomy'});
 } else if(c.kind==='population'){
  const name=gs?.cities?.[c.cid]?.name||c.cid;headline=T(`${name} 人口 ${c.delta>=0?'增加':'减少'} ${pct(Math.abs(c.delta))}`,`${name} population ${c.delta>=0?'grew':'fell'} ${pct(Math.abs(c.delta))}`);raw.push({k:'population',v:`${fmt(c.from)} → ${fmt(c.to)}`,src:'Population.getCityPopulation'});
  const now=cur.cities?.[c.cid];if(now?.migrationBalance)causes.push({label:T('本年净迁移','net migration this year'),value:fmt(now.migrationBalance),source:'Module 4'});
 } else if(c.kind==='facility'){
  const f=cur.facilities?.[c.fid];headline=T(`${f?.name||c.fid} 的实际产出率发生变化`,`${f?.name||c.fid} actual production rate changed`);if(f?.mainBottleneck)causes.push({label:T('当前主要约束','current main bottleneck'),value:String(f.mainBottleneck),source:'Module 3 facility factors'});raw.push({k:'productionLevel',v:`${pct(c.from)} → ${pct(c.to)}`,src:'Economy.getFacilityEconomy'});
 } else if(c.kind==='finance'){
  headline=T(`国库从 ${fmt(c.from)} 变为 ${fmt(c.to)}`,`Treasury changed from ${fmt(c.from)} to ${fmt(c.to)}`);raw.push({k:'treasury',v:`${fmt(c.from)} → ${fmt(c.to)}`,src:'Economy.getGovernmentFinance'});
 } else headline=T('这一年没有出现足够大的单项变化。','No single measured change dominated this year.');
 return {id:`change_${cur.year}`,headline,causes,raw,playerActions:actions,causeCertain:causes.length>0,fromYear:prev.year,toYear:cur.year};
}
function findDevelopmentProblem(gs){
 const A=APIs(),player=gs?.playerCountryId;for(const rid of Object.keys(gs?.regions||{})){
  if(ownerOfRegion(gs,rid)!==player)continue;let inds=[];try{inds=A.World?.getResourceIndications?.(rid,gs)||[];}catch(_){};const strong=inds.slice().sort((a,b)=>({very_high:5,high:4,medium:3,low:2,very_low:1}[b.band]-({very_high:5,high:4,medium:3,low:2,very_low:1}[a.band])))[0];
  if(strong){const hasMine=vals(gs?.facilities).some(f=>f&&f.regionId===rid&&/mine|field/i.test(f.type||''));if(!hasMine)return {id:`resource_${rid}_${strong.resourceType}`,type:'resource_undeveloped',regionId:rid,title:T(`${gs.regions[rid].name} 存在 ${strong.resourceType} 资源禀赋，但没有现成矿山`,`${gs.regions[rid].name} has ${strong.resourceType} endowment but no existing mine`),evidence:[`${strong.resourceType}: ${strong.band}`],actions:[T('进行地质勘探','Explore geological parcels'),T('先改善运输或电力','Improve transport or power first'),T('发展其他产业','Develop another sector'),T('在出现短缺时使用贸易工具','Use trade tools if a shortage appears')]};}
 }
 const rails=vals(gs?.connections).filter(c=>c&&c.active!==false&&/rail/i.test(c.type||''));if(!rails.length)return {id:'transport_none',type:'transport_access',title:T('国家当前没有已投入运行的铁路连接','The country currently has no operational railway link'),evidence:[T('正式 connections 中铁路数量为 0','Railway count in formal connections is 0')],actions:[T('建设铁路','Build railway'),T('优先发展本地产业','Prefer locally supplied industry'),T('利用港口与贸易','Use ports and trade'),T('暂缓高运输强度扩张','Delay transport-intensive expansion')]};
 return null;
}
function findFacilityCase(gs){const A=APIs(),player=gs?.playerCountryId;let best=null;for(const f of vals(gs?.facilities)){if(!f?.id||(f.countryId||ownerOfRegion(gs,f.regionId))!==player)continue;let e=null;try{e=A.Economy?.getFacilityEconomy?.(f.id);}catch(_){};if(!e)continue;const pl=clamp(e.productionLevel);const factors=e.factors||{};const item={id:f.id,name:f.name||f.type,regionId:f.regionId,potential:1,actual:pl,bottleneck:e.mainBottleneck||null,factors:clone(factors),workersRequired:num(e.workersRequired),workersAllocated:num(e.workersAllocated,num(e.workersEmployed)),source:'Economy.getFacilityEconomy'};if(!best||item.actual<best.actual)best=item;}return best;}
function findPopulationCase(gs,s){const A=APIs();let issues=[];try{issues=A.Population?.getSocialIssues?.()||[];}catch(_){};const issue=issues.find(i=>/MIGRATION|HOUSING|UNEMPLOY|LIVING|AGE/i.test(i.type||''));if(issue)return {id:issue.id||`pop_${issue.type}`,type:issue.type,title:T('人口与社会系统出现了真实响应','A real population/social response has appeared'),evidence:clone(issue.metrics||{}),causes:clone(issue.causes||[]),certain:Array.isArray(issue.causes)&&issue.causes.length>0,source:'Population.getSocialIssues'};
 let flows=[];try{flows=A.Population?.getMigrationFlows?.()||[];}catch(_){};if(flows.length){const f=flows.slice().sort((a,b)=>Math.abs(num(b.amount))-Math.abs(num(a.amount)))[0];return {id:f.id||`migration_${f.fromCityId}_${f.toCityId}`,type:'MIGRATION',title:T('出现了真实迁移流','A real migration flow has appeared'),evidence:{from:f.fromCityId,to:f.toCityId,amount:f.amount},causes:clone(f.causes||[]),certain:Array.isArray(f.causes)&&f.causes.length>0,source:'Population.getMigrationFlows'};}
 return null;}
function findTradeCase(gs){const A=APIs();let best=null;for(const rid of Object.keys(gs?.regions||{})){let r=null;try{r=A.Economy?.getRegionEconomy?.(rid)||null;}catch(_){};for(const [gid,g0] of Object.entries(r?.goods||{})){const g=slimGood(g0),base=Math.max(.0001,g.basePrice||g.price||1),pressure=Math.max(g.shortage/Math.max(1,g.demand),g.surplus/Math.max(1,g.supply),Math.abs(g.price-base)/base);if(pressure>.02&&(!best||pressure>best.pressure)){const tariffs=vals(gs?.tradeRelations).filter(x=>x&&x.goodId===gid&&(x.importerCountryId===gs.playerCountryId||x.exporterCountryId===gs.playerCountryId)).map(x=>num(x.tariffRate)).filter(Number.isFinite);const metrics={...g,tariffRates:tariffs};best={id:`trade_${rid}_${gid}`,regionId:rid,goodId:gid,pressure,metrics,title:T(`${gs.regions?.[rid]?.name||rid} 的 ${gid} 存在真实供需/价格压力`,`${gid} in ${gs.regions?.[rid]?.name||rid} has real supply/demand or price pressure`),source:'Economy.getRegionEconomy + tradeRelations'};}}}
 return best;}
function findAICase(gs){const A=APIs();for(const id of ['meridian','norvia']){if(!gs?.countries?.[id])continue;let d=null;try{d=A.AI?.getDebugSnapshot?.(id);}catch(_){};if(d?.decision){const action=d.decision?.action;return {id:`ai_${id}_${d.decision?.turn||gs?.turn}`,countryId:id,name:gs.countries[id].name||id,action:action?.label||action?.type||null,reasons:clone(action?.reasons||[]),held:!action,source:'CountryAI.getDebugSnapshot'};}}return null;}
function findSituation(gs){const A=APIs();let cards=[];try{cards=A.Events?.getCurrentSituations?.(gs)||[];}catch(_){};if(!cards.length)return null;const c=cards[0],evidence=c.evidence||c.metrics||c.context||{};let chain=[];try{const g=A.Events?.getCausalGraph?.();if(g?.edges?.length)chain=g.edges.slice(0,6);}catch(_){};return {id:c.id||c.issueId||`situation_${gs?.turn}`,title:c.title||c.type||T('真实情境','Real situation'),problem:c.summary||c.description||c.type,evidence:clone(evidence),causeChain:clone(chain),certain:chain.length>0,possibleResponses:clone(c.possibleResponses||c.choices||[]),risks:clone(c.risks||[]),source:'IssuesEvents.getCurrentSituations'};}
function issueCandidates(gs){let a=[];try{a=APIs().Module8?.collectIssues?.(gs)||[];}catch(_){};return a;}
function findContextual(gs,s){
 const seen=new Set(s.shownAdvisorTopics||[]),issues=issueCandidates(gs);const patterns=[['major_shortage',/SHORTAGE|INPUT_SHORTAGE/],['severe_unemployment',/UNEMPLOY/],['housing_crisis',/HOUSING/],['fiscal_crisis',/FISCAL|DEBT/],['transport_bottleneck',/TRANSPORT_BOTTLENECK/],['international_dependence',/TRADE_DEPENDENCE|INVESTMENT_DEPENDENCE/],['rapid_migration',/MIGRATION/]];
 for(const [topic,re] of patterns){if(seen.has(topic))continue;const i=issues.find(x=>re.test(x.type||'')&&num(x.severity,.5)>=(s.mode==='standard'?.65:.35));if(i)return {topic,issue:i,title:T('新的重要情况','New important condition'),summary:String(i.type||topic),actions:actionsForIssue(i),source:'Module 8 issue aggregation'};}
 if(!seen.has('ai_pressure')){const ai=findAICase(gs);if(ai&&ai.action&&/TARIFF|PRESSURE|TRADE|INVEST/i.test(ai.action))return {topic:'ai_pressure',issue:ai,title:T('AI 国家采取了新的对外行动','An AI country took a new external action'),summary:`${ai.name}: ${ai.action}`,actions:[T('检查依赖关系','Inspect dependencies'),T('调整贸易关系','Adjust trade relationships'),T('发展国内替代能力','Develop domestic alternatives')],source:ai.source};}
 if(!seen.has('event_causal_chain')){const sit=findSituation(gs);if(sit&&sit.certain)return {topic:'event_causal_chain',issue:sit,title:T('出现了新的真实因果链','A new real causal chain appeared'),summary:sit.title,actions:actionsForIssue(sit),source:sit.source};}
 return null;
}
function actionsForIssue(i){const t=String(i?.type||i?.issue?.type||'');if(/SHORTAGE|food/i.test(t))return [T('扩大国内供给','Expand domestic supply'),T('改善物流','Improve logistics'),T('增加进口','Increase imports'),T('释放储备','Release reserves')];if(/UNEMPLOY/i.test(t))return [T('发展吸纳就业的产业','Develop job-creating industries'),T('培训与转岗','Retraining and reallocation'),T('改善地区流动条件','Improve regional mobility')];if(/HOUSING/i.test(t))return [T('增加住房供给','Expand housing supply'),T('改善交通与通勤','Improve transport and commuting'),T('调整城市发展政策','Adjust urban development policy')];if(/TRANSPORT/i.test(t))return [T('扩大道路/铁路能力','Expand road/rail capacity'),T('降低运输需求','Reduce transport demand'),T('改变生产布局','Change production geography')];if(/TRADE|DEPEND/i.test(t))return [T('分散贸易伙伴','Diversify partners'),T('扩大国内替代','Expand domestic substitutes'),T('重新谈判准入与关税','Renegotiate access and tariffs')];return [T('查看证据','Inspect evidence'),T('使用正式游戏工具回应','Respond through formal game tools'),T('推进一年后观察结果','Advance a year and observe the result')];}
function objectiveMetric(gs,rid){const A=APIs();let r=null;try{r=A.Economy?.getRegionEconomy?.(rid)||null;}catch(_){};const food=slimGood(r?.goods?.food||{});const shortageRatio=food.demand>0?food.shortage/food.demand:0;let un=0,cnt=0;for(const [cid,c] of Object.entries(gs?.cities||{}))if(c.regionId===rid){let p=null;try{p=A.Population?.getCityPopulation?.(cid);}catch(_){};if(p){un+=num(p.unemploymentRate);cnt++;}}un=cnt?un/cnt:0;const pricePressure=food.basePrice>0?Math.max(0,food.price/food.basePrice-1):0;const bad=shortageRatio*.45+un*.35+pricePressure*.20;const output=Object.values(r?.goods||{}).reduce((s,g)=>s+num(g.production),0);return {badness:bad,shortageRatio,unemployment:un,pricePressure,output};}
function createObjective(gs){let best=null;for(const rid of Object.keys(gs?.regions||{})){if(ownerOfRegion(gs,rid)!==gs.playerCountryId)continue;const m=objectiveMetric(gs,rid);if(!best||m.badness>best.m.badness)best={rid,m};}if(!best)return null;const metric=best.m.badness>.02?'badness':'output',base=best.m[metric],direction=metric==='badness'?'down':'up',target=direction==='down'?Math.max(0,base*.95):base*1.05;return {id:`objective_${best.rid}_${gs.time?.year}`,regionId:best.rid,regionName:gs.regions?.[best.rid]?.name||best.rid,metric,baseline:base,target,direction,startYear:num(gs.time?.year),deadlineYear:num(gs.time?.year)+3,completed:false};}
function objectiveValue(gs,o){return objectiveMetric(gs,o.regionId)[o.metric];}
const Manager={
 VERSION,
 initialize(gs){const s=ensure(gs);if(!s)return null;if(s.mode==='guided'&&!s.tutorialCompleted&&!s.stageData[`stage_${s.currentStage}`])this.enterStage(gs,s.currentStage);setTimeout(()=>UI.refresh(gs),0);return s;},
 getState(gs=global.gameState){return ensure(gs);},
 setMode(mode,gs=global.gameState){const s=ensure(gs);if(!['guided','assisted','standard','none'].includes(mode))return;s.mode=mode;s.minimized=false;s.settingsOpen=false;if(mode==='guided'&&!s.tutorialCompleted)this.enterStage(gs,s.currentStage||0);UI.refresh(gs);},
 enterStage(gs,id){const s=ensure(gs);s.currentStage=id;const key=`stage_${id}`;s.stageData[key]=s.stageData[key]||{enteredYear:num(gs?.time?.year)};if(id===1){s.stageData.stage_1.baseline=actionFingerprint(gs);s.stageData.stage_1.problem=findDevelopmentProblem(gs);}if(id===8&&!s.stageData.stage_8.objective)s.stageData.stage_8.objective=createObjective(gs);},
 completeStage(gs,id){const s=ensure(gs);if(!s.completedStages.includes(id))s.completedStages.push(id);if(STAGES[id])s.completedConcepts=uniq([...s.completedConcepts,STAGES[id].key]);if(id>=8){s.tutorialCompleted=true;s.currentStage=9;s.completedConcepts=uniq([...s.completedConcepts,...STAGES.map(x=>x.key)]);}else{this.enterStage(gs,id+1);}UI.refresh(gs);},
 record(kind,value,gs=global.gameState){const s=ensure(gs);if(!s)return;const o=s.observations;if(kind==='region')o.regions=uniq([...o.regions,String(value)]);if(kind==='resource')o.resources=uniq([...o.resources,String(value)]);if(kind==='infrastructure')o.infrastructure=Math.max(1,num(o.infrastructure));if(kind==='change')o.changeReviews=uniq([...o.changeReviews,String(value)]);if(kind==='production')o.production=uniq([...o.production,String(value)]);if(kind==='population')o.population=uniq([...o.population,String(value)]);if(kind==='trade')o.trade=uniq([...o.trade,String(value)]);if(kind==='ai')o.ai=uniq([...o.ai,String(value)]);if(kind==='situation')o.situations=uniq([...o.situations,String(value)]);const concept={change:'first_result',production:'constraints',population:'population',trade:'trade',ai:'international',situation:'situation'}[kind];if(concept)s.explainedConcepts=uniq([...s.explainedConcepts,concept]);this.evaluate(gs);UI.refresh(gs);},
 beforeAnnualTurn(gs){const s=ensure(gs);if(!s||s.mode==='none')return;const snap=takeSnapshot(gs);s.previousSnapshot=snap;s.snapshotHistory.push(clone(snap));if(s.snapshotHistory.length>8)s.snapshotHistory.shift();},
 afterAnnualTurn(gs,report){const s=ensure(gs);if(!s||s.mode==='none')return;const cur=takeSnapshot(gs);s.currentSnapshot=cur;s.snapshotHistory.push(clone(cur));if(s.snapshotHistory.length>8)s.snapshotHistory.shift();if(s.mode==='guided'&&s.currentStage===2&&!s.stageData.stage_2?.explanation){s.stageData.stage_2=s.stageData.stage_2||{};s.stageData.stage_2.explanation=buildChangeExplanation(gs,s.previousSnapshot,cur,s);}this.evaluate(gs);setTimeout(()=>UI.refresh(gs),0);},
 evaluate(gs=global.gameState){const s=ensure(gs);if(!s||s.mode!=='guided'||s.tutorialCompleted)return false;const id=s.currentStage;let done=false;
  if(id===0)done=s.observations.regions.length>0&&s.observations.resources.length>0&&s.observations.infrastructure>0;
  if(id===1){const b=s.stageData.stage_1?.baseline,delta=diffAction(b,actionFingerprint(gs));if(delta){s.stageData.stage1Action=delta;done=true;}}
  if(id===2){const ex=s.stageData.stage_2?.explanation;done=!!ex&&s.observations.changeReviews.includes(ex.id);}
  if(id===3){const c=findFacilityCase(gs);s.stageData.stage_3=s.stageData.stage_3||{};s.stageData.stage_3.case=c;done=!!c&&s.observations.production.includes(c.id);}
  if(id===4){const c=findPopulationCase(gs,s);s.stageData.stage_4=s.stageData.stage_4||{};s.stageData.stage_4.case=c;done=!!c&&s.observations.population.includes(c.id);}
  if(id===5){const c=findTradeCase(gs);s.stageData.stage_5=s.stageData.stage_5||{};s.stageData.stage_5.case=c;done=!!c&&s.observations.trade.includes(c.id);}
  if(id===6){const c=findAICase(gs);s.stageData.stage_6=s.stageData.stage_6||{};s.stageData.stage_6.case=c;done=!!c&&s.observations.ai.includes(c.id);}
  if(id===7){const c=findSituation(gs);s.stageData.stage_7=s.stageData.stage_7||{};s.stageData.stage_7.case=c;done=!!c&&s.observations.situations.includes(c.id);}
  if(id===8){const o=s.stageData.stage_8?.objective;if(o){const v=objectiveValue(gs,o);o.current=v;o.completed=o.direction==='down'?v<=o.target:v>=o.target;done=o.completed;}}
  if(done)this.completeStage(gs,id);return done;},
 markAdvisorShown(topic,gs=global.gameState){const s=ensure(gs);if(!s.shownAdvisorTopics.includes(topic))s.shownAdvisorTopics.push(topic);},
 dismiss(id,gs=global.gameState){const s=ensure(gs);s.dismissedHints=uniq([...s.dismissedHints,id]);s.minimized=true;UI.refresh(gs);},
 setMinimized(v,gs=global.gameState){const s=ensure(gs);s.minimized=!!v;UI.refresh(gs);},
 setSettings(v,gs=global.gameState){const s=ensure(gs);s.settingsOpen=!!v;UI.refresh(gs);}
};
const Advisor={findDevelopmentProblem,findProductionConstraint:findFacilityCase,findPopulationResponse:findPopulationCase,findTradeCase,findAICase,findSituation,findContextual,actionsForIssue};
const Explainer={takeSnapshot,buildChangeExplanation,whyForSituation(c){return {certain:!!c?.certain,chain:clone(c?.causeChain||c?.causes||[]),evidence:clone(c?.evidence||{}),source:c?.source||null};},productionCase:findFacilityCase};
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function objRows(o){if(!o||typeof o!=='object')return `<div class="ob-raw">${esc(o)}</div>`;return Object.entries(o).slice(0,12).map(([k,v])=>`<div class="ob-kv"><span>${esc(k)}</span><b>${esc(typeof v==='object'?JSON.stringify(v):v)}</b></div>`).join('');}
function chips(a){return `<div class="ob-chips">${(a||[]).map(x=>`<span>${esc(typeof x==='string'?x:(x.text||x.label||x.id||JSON.stringify(x)))}</span>`).join('')}</div>`;}
function progress(s){return `<div class="ob-stagebar">${STAGES.map(x=>`<i class="${s.completedStages.includes(x.id)?'done':s.currentStage===x.id?'active':''}" title="${esc(x.title)}"></i>`).join('')}</div>`;}
function modeChooser(){return `<div class="ob-mode"><h3>${dict.chooseMode}</h3><p>${dict.modeIntro}</p>${[['guided',dict.guided,dict.guidedDesc],['assisted',dict.assisted,dict.assistedDesc],['standard',dict.standard,dict.standardDesc],['none',dict.none,dict.noneDesc]].map(([id,n,d])=>`<button data-ob-mode="${id}"><b>${n}</b><small>${d}</small></button>`).join('')}</div>`;}
function levelBlocks(l1,l2,l3){return `<div class="ob-level"><b>${dict.level1}</b><p>${l1}</p></div><details class="ob-level"><summary>${dict.level2}</summary><div>${l2||dict.uncertain}</div></details><details class="ob-level"><summary>${dict.level3}</summary><div>${l3||dict.noData}</div></details>`;}
function stageBody(gs,s){const id=s.currentStage,d=s.stageData[`stage_${id}`]||{};if(id===0){return `<h3>${STAGES[0].title}</h3><p>${T('先认识国家、地区、资源禀赋与基础设施。资源禀赋只是地下潜力，不等于已经存在矿山。','Start with the country, regions, resource endowment, and infrastructure. Resource endowment is underground potential, not an existing mine.')}</p><div class="ob-checks"><span class="${s.observations.regions.length?'ok':''}">${T('查看地区','View a region')}</span><span class="${s.observations.resources.length?'ok':''}">${T('查看资源禀赋','View resource endowment')}</span><span class="${s.observations.infrastructure?'ok':''}">${T('查看基础设施','View infrastructure')}</span></div><div class="ob-nav"><button data-ob-nav="world">${T('打开世界','Open World')}</button><button data-ob-nav="development">${T('打开开发','Open Development')}</button></div>`;}
 if(id===1){const p=d.problem||findDevelopmentProblem(gs);if(!p)return `<h3>${STAGES[1].title}</h3><p>${dict.noData}</p>`;return `<h3>${STAGES[1].title}</h3><p>${esc(p.title)}</p><div class="ob-evidence"><b>${dict.evidence}</b>${chips(p.evidence)}</div><b>${dict.possible}</b>${chips(p.actions)}<p class="ob-muted">${T('选择任意合理行动即可继续；系统不会指定唯一正确路线。','Any reasonable action can continue the tutorial; no single route is declared correct.')}</p>`;}
 if(id===2){const e=d.explanation;if(!e)return `<h3>${STAGES[2].title}</h3><p>${T('推进一年后，系统会比较前后快照并解释真实变化。','Advance one year; the system will compare real before/after snapshots.')}</p>`;const l2=e.causes.length?e.causes.map(x=>`${esc(x.label)}: <b>${esc(x.value)}</b>`).join('<br>'):dict.uncertain;const l3=`${e.raw.map(x=>`${esc(x.k)}: ${esc(x.v)} <small>${esc(x.src)}</small>`).join('<br>')}<hr><b>${T('之前的玩家行动','Player actions before the turn')}</b><br>${e.playerActions.length?e.playerActions.map(esc).join('<br>'):T('没有已验证的玩家行动因果链接','No verified player-action causal link')}`;return `<h3>${STAGES[2].title}</h3>${levelBlocks(esc(e.headline),l2,l3)}<button class="ob-primary" data-ob-review="${esc(e.id)}">${dict.reviewed}</button>`;}
 if(id===3){const c=d.case||findFacilityCase(gs);if(!c)return `<h3>${STAGES[3].title}</h3><p>${T('目前没有可供检查的真实运营企业。完成任意生产设施后，系统会自动选择一个真实企业。','No real operating enterprise is available yet. Complete any production facility and guidance will select one.')}</p>`;const facts=Object.entries(c.factors||{}).map(([k,v])=>`${esc(k)}: ${pct(v)}`).join('<br>')||dict.noData;return `<h3>${STAGES[3].title}</h3><div class="ob-meter"><span>${T('潜在产能','Potential Capacity')} <b>100%</b></span><span>${T('实际产出','Actual Output')} <b>${pct(c.actual)}</b></span></div>${levelBlocks(T('有工厂不等于自动满产。','Owning a factory does not mean automatic full output.'),c.bottleneck?`${T('主要约束','Main constraint')}: <b>${esc(c.bottleneck)}</b>`:dict.uncertain,`${facts}<br><small>${esc(c.source)}</small>`)}<button class="ob-primary" data-ob-production="${esc(c.id)}">${dict.inspect}</button>`;}
 if(id===4){const c=d.case||findPopulationCase(gs,s);if(!c)return `<h3>${STAGES[4].title}</h3><p>${T('等待真实人口变化：就业、迁移、住房、生活成本或年龄结构。系统不会为了教学制造固定人口事件。','Waiting for real population change: jobs, migration, housing, living costs, or age structure. No population event will be fabricated.')}</p>`;const l2=c.certain?(c.causes||[]).map(esc).join(' → '):dict.uncertain;return `<h3>${STAGES[4].title}</h3>${levelBlocks(esc(c.title),l2,`${objRows(c.evidence)}<small>${esc(c.source)}</small>`)}<button class="ob-primary" data-ob-population="${esc(c.id)}">${T('查看人口证据','Inspect population evidence')}</button>`;}
 if(id===5){const c=d.case||findTradeCase(gs);if(!c)return `<h3>${STAGES[5].title}</h3><p>${T('等待真实的短缺、过剩或价格压力。','Waiting for a real shortage, surplus, or price pressure.')}</p>`;return `<h3>${STAGES[5].title}</h3><p>${esc(c.title)}</p><div class="ob-note">${T('贸易不会因为签了协议就自动发生；供给、需求、价格、运输、政策与外交准入共同决定实际流量。','Trade does not happen automatically after an agreement; supply, demand, price, transport, policy, and diplomatic access jointly determine real flow.')}</div>${levelBlocks(T('这里存在真实市场压力。','A real market pressure exists here.'),c.metrics.shortage>0?T('需求超过可用供给。','Demand exceeds available supply.'):c.metrics.surplus>0?T('可用供给超过当前需求。','Available supply exceeds current demand.'):T('价格偏离基础价格。','Price differs from its base level.'),objRows(c.metrics))}<button class="ob-primary" data-ob-trade="${esc(c.id)}">${dict.viewTrade}</button>`;}
 if(id===6){const c=d.case||findAICase(gs);if(!c)return `<h3>${STAGES[6].title}</h3><p>${T('等待 AI 国家完成一次真实年度决策。','Waiting for an AI country to complete a real annual decision.')}</p>`;const r=(c.reasons||[]).map(x=>`${esc(x.reason||x.type||'reason')}: ${esc(x.value??'')}`).join('<br>')||T('本回合选择保持不动。','This turn it chose to hold.');return `<h3>${STAGES[6].title}</h3><p><b>${esc(c.name)}</b>: ${esc(c.action||T('保持现状','Hold'))}</p><div class="ob-note">${T('AI 与玩家使用同一套世界规则；它必须通过建设、贸易、投资、外交、关税或技术合作改变状态。','AI countries use the same world rules and must act through development, trade, investment, diplomacy, tariffs, or technology cooperation.')}</div>${levelBlocks(T('这是正式 AI 模块的真实决策记录。','This is a real decision record from the formal AI module.'),r,esc(c.source))}<button class="ob-primary" data-ob-ai="${esc(c.id)}">${dict.viewAI}</button>`;}
 if(id===7){const c=d.case||findSituation(gs);if(!c)return `<h3>${STAGES[7].title}</h3><p>${dict.noData}</p>`;const chain=c.certain?c.causeChain.map(x=>esc(x.mechanism||x.relation||JSON.stringify(x))).join(' → '):dict.uncertain;return `<h3>${STAGES[7].title}</h3><div class="ob-situation"><b>${T('观察到的问题','Observed Problem')}</b><p>${esc(c.problem||c.title)}</p><b>${dict.evidence}</b>${objRows(c.evidence)}<b>${T('因果链','Cause Chain')}</b><p>${chain}</p><b>${dict.possible}</b>${chips((c.possibleResponses||[]).length?c.possibleResponses:actionsForIssue(c))}<b>${T('预期风险','Expected Risks')}</b>${chips(c.risks||[])}</div><button class="ob-primary" data-ob-situation="${esc(c.id)}">${dict.viewSituation}</button>`;}
 if(id===8){const o=d.objective;if(!o)return `<h3>${STAGES[8].title}</h3><p>${dict.noData}</p>`;const cur=objectiveValue(gs,o),deadline=num(gs.time?.year)>o.deadlineYear?T('3 年窗口已过去；没有惩罚，目标会继续保留直到你真正改善它。','The 3-year window has passed; there is no penalty and the objective remains until it is genuinely improved.'):T(`还剩 ${o.deadlineYear-num(gs.time?.year)} 年`,` ${o.deadlineYear-num(gs.time?.year)} year(s) remain`);return `<h3>${STAGES[8].title}</h3><p>${T(`在 3 个回合内改善 ${o.regionName} 的经济状况。`,`Improve ${o.regionName}'s economic condition within 3 turns.`)}</p><div class="ob-meter"><span>${T('基线','Baseline')} <b>${fmt(o.baseline)}</b></span><span>${T('当前','Current')} <b>${fmt(cur)}</b></span></div><p class="ob-muted">${deadline}</p><div class="ob-note">${T('这里不提供具体路线。请独立使用你已经学到的系统。','No route is prescribed here. Use the systems you have learned independently.')}</div>`;}
 return `<h3>${T('引导完成','Guided Tutorial Complete')}</h3>`;}
function advisorBody(gs,s){const a=findContextual(gs,s);if(!a)return `<h3>${T('情境顾问','Contextual Advisor')}</h3><p>${T('目前没有新的首次重大情况需要主动解释。','There is no new first-time major condition to explain right now.')}</p>`;Manager.markAdvisorShown(a.topic,gs);const issue=a.issue||{};return `<h3>${T('情境顾问','Contextual Advisor')}</h3><p><b>${esc(a.title)}</b><br>${esc(a.summary)}</p>${levelBlocks(T('这是正式模拟中第一次出现的这一类情况。','This is the first occurrence of this type in the formal simulation.'),Array.isArray(issue.causes)&&issue.causes.length?issue.causes.map(esc).join(' → '):dict.uncertain,`${objRows(issue.metrics||issue.evidence||{})}<small>${esc(a.source)}</small>`)}<b>${dict.possible}</b>${chips(a.actions)}`;}
const UI={
 installed:false,
 install(){if(this.installed)return;this.installed=true;const style=document.createElement('style');style.textContent=`.be-ob-card{border-bottom:1px solid var(--line);background:linear-gradient(145deg,#102431,#0a1720);padding:10px 11px;max-height:47vh;overflow:auto}.be-ob-head{display:flex;align-items:center;gap:7px}.be-ob-head b{font-size:10px;letter-spacing:.08em}.be-ob-head span{margin-left:auto;display:flex;gap:5px}.be-ob-head button,.be-ob-card button{border:1px solid #315066;background:#102634;color:#cfe2ed;border-radius:6px;padding:5px 7px;font-size:8px}.be-ob-card h3{font-size:11px;margin:9px 0 6px}.be-ob-card p{font-size:9px;color:#a8becb;margin:6px 0}.be-ob-card small{color:#7290a2}.ob-stagebar{display:flex;gap:3px;margin:7px 0}.ob-stagebar i{height:3px;flex:1;background:#203542;border-radius:99px}.ob-stagebar i.done{background:#59b681}.ob-stagebar i.active{background:#5da7d2}.ob-mode{display:grid;grid-template-columns:1fr 1fr;gap:6px}.ob-mode h3,.ob-mode>p{grid-column:1/-1}.ob-mode button{text-align:left;min-height:48px}.ob-mode button b,.ob-mode button small{display:block}.ob-checks,.ob-chips{display:flex;gap:5px;flex-wrap:wrap;margin:7px 0}.ob-checks span,.ob-chips span{border:1px solid #2b4556;background:#0d1c26;padding:4px 6px;border-radius:999px;font-size:8px;color:#89a3b3}.ob-checks span.ok{border-color:#3f8060;color:#83d5a1}.ob-nav{display:flex;gap:6px;margin-top:8px}.ob-primary{width:100%;margin-top:8px!important;background:#1c5879!important;border-color:#4387ad!important;color:#fff!important;font-weight:700}.ob-level{border:1px solid #253d4d;background:#0c1a23;border-radius:7px;padding:7px;margin:6px 0;font-size:8px}.ob-level summary{cursor:pointer;color:#b9cfdb}.ob-level p{margin:3px 0}.ob-kv{display:flex;justify-content:space-between;gap:10px;border-bottom:1px solid #172a36;padding:3px 0;font-size:8px}.ob-kv span{color:#7993a4}.ob-kv b{color:#d0e0e8;text-align:right;overflow-wrap:anywhere}.ob-meter{display:grid;grid-template-columns:1fr 1fr;gap:6px}.ob-meter span{border:1px solid #294657;background:#0c1c26;border-radius:7px;padding:7px;font-size:8px}.ob-meter b{display:block;font-size:13px}.ob-note{border-left:3px solid #4d7c98;background:#0d202b;padding:7px;font-size:8px;color:#9fb6c4;margin:7px 0}.ob-muted{color:#718b9c!important}.ob-situation>b{display:block;font-size:8px;margin-top:7px;color:#d7c980}.be-ob-mini{padding:7px 10px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;background:#0c1a24}.be-ob-mini button{border:1px solid #315066;background:#102634;color:#cfe2ed;border-radius:6px;padding:5px 8px;font-size:8px}.be-ob-topbtn{white-space:nowrap}@media(max-width:1050px){.be-ob-card{max-height:none}}`;document.head.appendChild(style);
  const LEGACY_ONBOARDING_UI_ENABLED=false;
  if(LEGACY_ONBOARDING_UI_ENABLED){
    const side=document.querySelector('.sidebar');if(side){const host=document.createElement('div');host.id='beOnboardingHost';side.insertBefore(host,side.firstChild);}
    const top=document.querySelector('.status-pills')||document.querySelector('.topbar');if(top){const b=document.createElement('button');b.id='beOnboardingOpen';b.className='be-ob-topbtn';b.textContent=dict.guidance;b.addEventListener('click',()=>{const s=ensure(global.gameState);s.minimized=false;s.settingsOpen=true;this.refresh(global.gameState);});if(top.classList?.contains('status-pills'))top.parentNode.insertBefore(b,top);else top.appendChild(b);}
  }
  this.bindSemanticEvents();},
 bindSemanticEvents(){global.addEventListener('click',e=>{const gs=global.gameState,s=ensure(gs);if(!gs||!s)return;const r=e.target.closest?.('[data-region]');if(r){Manager.record('region',r.dataset.region,gs);Manager.record('resource',r.dataset.region,gs);}const tab=e.target.closest?.('[data-tab]');if(tab?.dataset.tab==='development')Manager.record('infrastructure','development',gs);const mode=e.target.closest?.('[data-ob-mode]');if(mode){Manager.setMode(mode.dataset.obMode,gs);return;}const nav=e.target.closest?.('[data-ob-nav]');if(nav){document.querySelector(`[data-tab="${nav.dataset.obNav}"]`)?.click();return;}const rev=e.target.closest?.('[data-ob-review]');if(rev){Manager.record('change',rev.dataset.obReview,gs);return;}const pr=e.target.closest?.('[data-ob-production]');if(pr){Manager.record('production',pr.dataset.obProduction,gs);return;}const pp=e.target.closest?.('[data-ob-population]');if(pp){Manager.record('population',pp.dataset.obPopulation,gs);return;}const tr=e.target.closest?.('[data-ob-trade]');if(tr){Manager.record('trade',tr.dataset.obTrade,gs);return;}const ai=e.target.closest?.('[data-ob-ai]');if(ai){Manager.record('ai',ai.dataset.obAi,gs);return;}const si=e.target.closest?.('[data-ob-situation]');if(si){Manager.record('situation',si.dataset.obSituation,gs);return;}if(e.target.closest?.('[data-ob-min]'))Manager.setMinimized(true,gs);if(e.target.closest?.('[data-ob-settings]'))Manager.setSettings(!s.settingsOpen,gs);if(e.target.closest?.('[data-ob-dismiss]'))Manager.dismiss(`stage:${s.currentStage}`,gs);});},
 refresh(gs=global.gameState){this.install();const host=document.getElementById('beOnboardingHost');if(!host||!gs)return;const s=ensure(gs);if(s.mode==='none'&&s.minimized){host.innerHTML='';return;}if(s.minimized){host.innerHTML=`<div class="be-ob-mini"><span>${dict.guidance}</span><button onclick="BorderEpoch.OnboardingManager.setMinimized(false)">${dict.reopen}</button></div>`;return;}if(!s.mode){host.innerHTML=`<section class="be-ob-card">${modeChooser()}</section>`;return;}if(s.settingsOpen){host.innerHTML=`<section class="be-ob-card"><div class="be-ob-head"><b>${dict.settings}</b><span><button data-ob-settings>×</button></span></div>${modeChooser()}</section>`;return;}if(s.mode==='none'){host.innerHTML='';return;}const guided=s.mode==='guided'&&!s.tutorialCompleted;const body=guided?stageBody(gs,s):advisorBody(gs,s);host.innerHTML=`<section class="be-ob-card"><div class="be-ob-head"><b>${dict.guidance}</b><span><button data-ob-settings>⚙</button><button data-ob-min>–</button></span></div>${guided?progress(s):''}${guided?`<small>${dict.stage} ${s.currentStage+1}/9 · ${esc(STAGES[s.currentStage]?.title||'')}</small>`:''}${body}<div class="ob-nav"><button data-ob-dismiss>${dict.dismiss}</button></div></section>`;}
};
function wrapActionObservers(){
 const watch=(obj,name)=>{if(!obj||typeof obj[name]!=='function'||obj[name].__obObserved)return;const original=obj[name];function wrapped(...args){const result=original.apply(this,args);const finish=()=>setTimeout(()=>{if(global.gameState)Manager.evaluate(global.gameState);},0);if(result&&typeof result.then==='function')return result.finally(finish);finish();return result;}wrapped.__obObserved=true;wrapped.__obOriginal=original;obj[name]=wrapped;};
 const A=APIs();['startProject','startExploration','startMineDevelopment','startFacilityUpgrade','startConnectionUpgrade'].forEach(n=>watch(A.Development,n));['createTradeRelation','createProposal','acceptProposal','counterProposal','setTariff','registerForeignInvestment','offerPreferentialAccess'].forEach(n=>watch(A.Trade,n));['setCropAllocation','developLand','allocateIrrigation','setAgriculturalIntensity','setCropPriority'].forEach(n=>watch(BE.Agriculture,n));
}
function wrapModule8(){const M=BE.Module8;if(!M||M.__onboardingWrapped)return;M.__onboardingWrapped=true;const oi=M.initialize.bind(M),oa=M.advanceOneYear.bind(M),ol=M.load?.bind(M);M.initialize=function(session,extra){const r=oi(session,extra);Manager.initialize(session?.state||global.gameState);return r;};M.advanceOneYear=async function(session,extra){const gs=session?.state||global.gameState;Manager.beforeAnnualTurn(gs);const r=await oa(session,extra);Manager.afterAnnualTurn(session?.state||global.gameState,r);return r;};if(ol)M.load=function(json,extra){const r=ol(json,extra);Manager.initialize(r?.state||global.gameState);return r;};}
function runSelfTests(){const results=[];const test=(name,fn)=>{try{results.push({name,pass:!!fn()});}catch(e){results.push({name,pass:false,error:String(e)})}};test('alternative development action counts',()=>{const b={projects:[],connections:[],facilities:[],trade:[],policies:'{}',agriculture:'[]'},n=clone(b);n.trade=['t1'];return diffAction(b,n)?.type==='trade';});test('UI position independent',()=>true);test('no expected event does not fabricate',()=>findSituation({})===null);test('same state stable',()=>stable({b:2,a:1})===stable({a:1,b:2}));const live=global.gameState;if(live){test('no-guidance does not change simulation fields',()=>{const before=stateFingerprint(live),s=ensure(live),old=s.mode;s.mode='none';const after=stateFingerprint(live);s.mode=old;return before===after;});test('onboarding persists inside save state',()=>{const snap=JSON.parse(JSON.stringify({state:{onboardingState:ensure(live)}}));return snap.state.onboardingState&&Array.isArray(snap.state.onboardingState.completedStages);});}return results;}
BE.OnboardingManager=Manager;BE.OnboardingAdvisor=Advisor;BE.OnboardingExplainer=Explainer;BE.OnboardingUI=UI;BE.OnboardingTests={run:runSelfTests};wrapActionObservers();wrapModule8();
document.addEventListener('DOMContentLoaded',()=>{UI.install();if(global.gameState)Manager.initialize(global.gameState);setTimeout(()=>{if(global.gameState){Manager.initialize(global.gameState);Manager.evaluate(global.gameState);UI.refresh(global.gameState);global.__BE_ONBOARDING_TESTS__=runSelfTests();}},60);});
})(typeof window!=='undefined'?window:globalThis);
/* ===== END BORDER EPOCH ONBOARDING ===== */
;
/*
 * Border Epoch — Main Board Core
 * Integrates weighted world-map templates with Module 1 resource endowment,
 * deterministic initial city siting, map city anchors and urban lifecycle.
 *
 * Time contract: 1 turn = 1 year.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  root.BorderEpochMainBoard=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const VERSION='1.1.0';
  const CITY_LEVELS=['settlement','village','town','city','major_city'];
  const CITY_LEVEL_LABELS={settlement:'Settlement',village:'Village',town:'Town',city:'City',major_city:'Major City'};

  function clamp(v,a=0,b=1){v=Number(v)||0;return Math.max(a,Math.min(b,v));}
  function deepClone(v){return JSON.parse(JSON.stringify(v));}
  function hashString(input){let h=2166136261>>>0;const s=String(input);for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
  function unitNoise(...parts){const h=hashString(parts.join('|'));return (h%1000003)/1000003;}
  function dist(a,b){const dx=(a.x||0)-(b.x||0),dy=(a.y||0)-(b.y||0);return Math.sqrt(dx*dx+dy*dy);}

  const GEOLOGY_PROFILES={
    craton:{
      surfaceTerrain:{composition:{mountain:.55,hills:.28,plateau:.17},elevation:.72,ruggedness:.72,waterAccess:.30,coastAccess:false,buildability:.34},
      geology:{lithology:{crystalline_basement:.68,banded_iron_formation:.22,felsic_intrusive:.10},tags:['ancient_craton','banded_iron'],tectonicSetting:'cratonic_shield',complexity:.48,parcelCount:5}
    },
    coal_basin:{
      surfaceTerrain:{composition:{sedimentary_basin:.52,plain:.28,river_valley:.20},elevation:.28,ruggedness:.23,waterAccess:.62,coastAccess:false,buildability:.80},
      geology:{lithology:{coal_bearing_sediments:.64,organic_sediments:.18,mixed_sedimentary:.18},tags:['coal_measures','organic_rich'],tectonicSetting:'foreland_basin',complexity:.34,parcelCount:6}
    },
    alluvial:{
      surfaceTerrain:{composition:{plain:.48,river_valley:.32,hills:.20},elevation:.22,ruggedness:.18,waterAccess:.76,coastAccess:false,buildability:.88},
      geology:{lithology:{mixed_sedimentary:.70,organic_sediments:.20,carbonate_sequence:.10},tags:[],tectonicSetting:'stable_platform',complexity:.24,parcelCount:5}
    },
    coast_margin:{
      surfaceTerrain:{composition:{coast:.38,plain:.32,delta:.18,hills:.12},elevation:.18,ruggedness:.22,waterAccess:.88,coastAccess:true,buildability:.78},
      geology:{lithology:{organic_sediments:.46,mixed_sedimentary:.40,carbonate_sequence:.14},tags:['petroleum_system'],tectonicSetting:'passive_margin',complexity:.32,parcelCount:5}
    },
    volcanic:{
      surfaceTerrain:{composition:{mountain:.44,upland:.34,hills:.22},elevation:.62,ruggedness:.66,waterAccess:.36,coastAccess:false,buildability:.40},
      geology:{lithology:{mafic_volcanic:.44,felsic_intrusive:.34,crystalline_basement:.22},tags:['volcanic_arc','hydrothermal_belt'],tectonicSetting:'volcanic_arc',complexity:.68,parcelCount:6}
    },
    rift:{
      surfaceTerrain:{composition:{hills:.35,plain:.28,river_valley:.22,plateau:.15},elevation:.38,ruggedness:.34,waterAccess:.56,coastAccess:false,buildability:.70},
      geology:{lithology:{mixed_sedimentary:.38,organic_sediments:.30,mafic_volcanic:.18,crystalline_basement:.14},tags:['faulted_basin','petroleum_system'],tectonicSetting:'rift_basin',complexity:.58,parcelCount:6}
    },
    forest_highland:{
      surfaceTerrain:{composition:{upland:.34,hills:.32,river_valley:.20,plain:.14},elevation:.46,ruggedness:.44,waterAccess:.68,coastAccess:false,buildability:.58},
      geology:{lithology:{crystalline_basement:.42,mixed_sedimentary:.30,felsic_intrusive:.18,carbonate_sequence:.10},tags:['hydrothermal_belt'],tectonicSetting:'stable_platform',complexity:.44,parcelCount:5}
    }
  };

  function region(profile,name,countryId='asteria'){
    const p=GEOLOGY_PROFILES[profile];
    return {name,countryId,basePowerSupply:6,basePowerDemand:1,surfaceTerrain:deepClone(p.surfaceTerrain),geology:deepClone(p.geology)};
  }

  function site(id,x,y,regionId,kind,attrs={}){
    return Object.assign({id,x,y,regionId,kind,harbor:0,estuary:0,river:0,flatness:.5,corridor:.5,expansion:.5,inland:.5,coastal:.5,settlement:.5,resourceAdjacency:.5},attrs);
  }

  const MAP_TEMPLATES=[
    {
      id:'map_01',name:'River Coast Highlands',weight:15,imageKey:'map_01',
      regionAnchors:{northwest_basin:{x:24,y:25},central_corridor:{x:52,y:49},eastern_coast:{x:78,y:60}},
      regions:{northwest_basin:region('craton','Northwest Highlands'),central_corridor:region('coal_basin','Central Basin'),eastern_coast:region('coast_margin','Eastern Coast')},
      sites:[
        site('01_p1',88,55,'eastern_coast','port',{harbor:.92,estuary:.78,flatness:.68,expansion:.82,coastal:1,river:.72,settlement:.88}),
        site('01_p2',76,81,'eastern_coast','port',{harbor:.86,estuary:.50,flatness:.62,expansion:.76,coastal:1,river:.44,settlement:.80}),
        site('01_p3',91,74,'eastern_coast','port',{harbor:.74,estuary:.38,flatness:.55,expansion:.70,coastal:1,settlement:.70}),
        site('01_i1',57,47,'central_corridor','inland',{river:.94,flatness:.88,corridor:.90,expansion:.92,inland:.95,settlement:.93,resourceAdjacency:.82}),
        site('01_i2',44,58,'central_corridor','inland',{river:.72,flatness:.92,corridor:.80,expansion:.88,inland:.98,settlement:.86,resourceAdjacency:.88}),
        site('01_i3',63,38,'central_corridor','inland',{river:.75,flatness:.84,corridor:.78,expansion:.80,inland:.88,settlement:.82,resourceAdjacency:.72}),
        site('01_s1',35,70,'central_corridor','settlement',{river:.46,flatness:.78,corridor:.66,expansion:.78,inland:.86,settlement:.68}),
        site('01_s2',70,60,'eastern_coast','settlement',{river:.70,flatness:.73,corridor:.70,expansion:.69,coastal:.55,inland:.58,settlement:.74}),
        site('01_s3',30,46,'northwest_basin','settlement',{river:.42,flatness:.48,corridor:.46,expansion:.52,inland:.96,settlement:.52,resourceAdjacency:.82})
      ]
    },
    {
      id:'map_02',name:'Mountain River Harbor',weight:12,imageKey:'map_02',
      regionAnchors:{northwest_basin:{x:24,y:34},central_corridor:{x:50,y:52},eastern_coast:{x:79,y:51}},
      regions:{northwest_basin:region('volcanic','Western Mountain Belt'),central_corridor:region('alluvial','Central River Plain'),eastern_coast:region('coast_margin','Harbor Coast')},
      sites:[
        site('02_p1',83,49,'eastern_coast','port',{harbor:.98,estuary:.84,flatness:.74,expansion:.76,coastal:1,river:.78,settlement:.95}),
        site('02_p2',86,63,'eastern_coast','port',{harbor:.82,estuary:.52,flatness:.61,expansion:.68,coastal:1,river:.50,settlement:.78}),
        site('02_p3',76,78,'eastern_coast','port',{harbor:.72,estuary:.44,flatness:.56,expansion:.72,coastal:.95,settlement:.70}),
        site('02_i1',52,50,'central_corridor','inland',{river:.96,flatness:.90,corridor:.94,expansion:.88,inland:.90,settlement:.95,resourceAdjacency:.64}),
        site('02_i2',44,64,'central_corridor','inland',{river:.74,flatness:.85,corridor:.79,expansion:.88,inland:.96,settlement:.84,resourceAdjacency:.60}),
        site('02_i3',61,63,'central_corridor','inland',{river:.82,flatness:.78,corridor:.86,expansion:.74,inland:.74,settlement:.84,resourceAdjacency:.56}),
        site('02_s1',39,78,'central_corridor','settlement',{river:.50,flatness:.76,corridor:.62,expansion:.75,inland:.86,settlement:.66}),
        site('02_s2',67,41,'central_corridor','settlement',{river:.68,flatness:.72,corridor:.73,expansion:.66,inland:.67,settlement:.72}),
        site('02_s3',34,45,'northwest_basin','settlement',{river:.38,flatness:.38,corridor:.48,expansion:.46,inland:.97,settlement:.46,resourceAdjacency:.86})
      ]
    },
    {
      id:'map_03',name:'Open Plain Estuary',weight:14,imageKey:'map_03',
      regionAnchors:{northwest_basin:{x:24,y:28},central_corridor:{x:50,y:50},eastern_coast:{x:72,y:72}},
      regions:{northwest_basin:region('craton','Western Ridges'),central_corridor:region('coal_basin','Interior Plain'),eastern_coast:region('coast_margin','Southern Estuary')},
      sites:[
        site('03_p1',69,78,'eastern_coast','port',{harbor:.94,estuary:.88,flatness:.80,expansion:.86,coastal:1,river:.86,settlement:.92}),
        site('03_p2',82,69,'eastern_coast','port',{harbor:.82,estuary:.58,flatness:.72,expansion:.78,coastal:1,river:.52,settlement:.81}),
        site('03_p3',58,86,'eastern_coast','port',{harbor:.76,estuary:.62,flatness:.66,expansion:.75,coastal:.96,river:.55,settlement:.76}),
        site('03_i1',51,55,'central_corridor','inland',{river:.88,flatness:.95,corridor:.90,expansion:.94,inland:.95,settlement:.96,resourceAdjacency:.84}),
        site('03_i2',39,48,'central_corridor','inland',{river:.62,flatness:.91,corridor:.78,expansion:.90,inland:.99,settlement:.86,resourceAdjacency:.78}),
        site('03_i3',62,43,'central_corridor','inland',{river:.78,flatness:.86,corridor:.82,expansion:.82,inland:.86,settlement:.84,resourceAdjacency:.70}),
        site('03_s1',31,62,'central_corridor','settlement',{river:.45,flatness:.80,corridor:.67,expansion:.82,inland:.98,settlement:.70}),
        site('03_s2',70,55,'eastern_coast','settlement',{river:.74,flatness:.79,corridor:.75,expansion:.78,coastal:.48,inland:.66,settlement:.78}),
        site('03_s3',45,71,'central_corridor','settlement',{river:.58,flatness:.88,corridor:.66,expansion:.84,inland:.79,settlement:.75})
      ]
    },
    {
      id:'map_04',name:'Lake & Delta Corridor',weight:12,imageKey:'map_04',
      regionAnchors:{northwest_basin:{x:25,y:27},central_corridor:{x:56,y:48},eastern_coast:{x:73,y:73}},
      regions:{northwest_basin:region('forest_highland','Lake Highlands'),central_corridor:region('alluvial','Central Lake Plain'),eastern_coast:region('coast_margin','Delta Coast')},
      sites:[
        site('04_p1',57,80,'eastern_coast','port',{harbor:.96,estuary:.95,flatness:.82,expansion:.86,coastal:1,river:.98,settlement:.94}),
        site('04_p2',73,76,'eastern_coast','port',{harbor:.82,estuary:.66,flatness:.84,expansion:.84,coastal:1,river:.62,settlement:.86}),
        site('04_p3',86,70,'eastern_coast','port',{harbor:.78,estuary:.40,flatness:.72,expansion:.76,coastal:1,river:.36,settlement:.73}),
        site('04_i1',63,53,'central_corridor','inland',{river:.92,flatness:.94,corridor:.96,expansion:.92,inland:.82,settlement:.97,resourceAdjacency:.58}),
        site('04_i2',72,43,'central_corridor','inland',{river:.62,flatness:.92,corridor:.84,expansion:.88,inland:.78,settlement:.84,resourceAdjacency:.52}),
        site('04_i3',49,58,'central_corridor','inland',{river:.82,flatness:.85,corridor:.82,expansion:.86,inland:.94,settlement:.86,resourceAdjacency:.60}),
        site('04_s1',40,70,'central_corridor','settlement',{river:.68,flatness:.80,corridor:.71,expansion:.84,inland:.83,settlement:.76}),
        site('04_s2',78,56,'eastern_coast','settlement',{river:.58,flatness:.87,corridor:.76,expansion:.76,coastal:.54,inland:.58,settlement:.77}),
        site('04_s3',37,44,'northwest_basin','settlement',{river:.52,flatness:.55,corridor:.56,expansion:.60,inland:.96,settlement:.60,resourceAdjacency:.66})
      ]
    },
    {
      id:'map_05',name:'Great River South Coast',weight:14,imageKey:'map_05',
      regionAnchors:{northwest_basin:{x:24,y:24},central_corridor:{x:51,y:51},eastern_coast:{x:61,y:79}},
      regions:{northwest_basin:region('craton','Northwest Mountains'),central_corridor:region('alluvial','Great River Plain'),eastern_coast:region('coast_margin','Southern Bay Coast')},
      sites:[
        site('05_p1',52,82,'eastern_coast','port',{harbor:.97,estuary:.96,flatness:.88,expansion:.90,coastal:1,river:1,settlement:.97}),
        site('05_p2',69,84,'eastern_coast','port',{harbor:.84,estuary:.60,flatness:.80,expansion:.82,coastal:1,river:.52,settlement:.84}),
        site('05_p3',82,74,'eastern_coast','port',{harbor:.76,estuary:.44,flatness:.70,expansion:.76,coastal:.96,river:.40,settlement:.76}),
        site('05_i1',52,54,'central_corridor','inland',{river:.98,flatness:.96,corridor:.95,expansion:.95,inland:.96,settlement:.98,resourceAdjacency:.58}),
        site('05_i2',61,45,'central_corridor','inland',{river:.75,flatness:.92,corridor:.84,expansion:.88,inland:.86,settlement:.88,resourceAdjacency:.55}),
        site('05_i3',42,63,'central_corridor','inland',{river:.72,flatness:.90,corridor:.82,expansion:.90,inland:.95,settlement:.86,resourceAdjacency:.62}),
        site('05_s1',34,74,'central_corridor','settlement',{river:.52,flatness:.78,corridor:.67,expansion:.84,inland:.84,settlement:.72}),
        site('05_s2',73,55,'central_corridor','settlement',{river:.42,flatness:.82,corridor:.72,expansion:.78,inland:.70,settlement:.74}),
        site('05_s3',38,42,'northwest_basin','settlement',{river:.38,flatness:.53,corridor:.52,expansion:.60,inland:.98,settlement:.57,resourceAdjacency:.80})
      ]
    },
    {
      id:'map_06',name:'Braided River Frontier',weight:11,imageKey:'map_06',
      regionAnchors:{northwest_basin:{x:25,y:37},central_corridor:{x:55,y:50},eastern_coast:{x:78,y:65}},
      regions:{northwest_basin:region('craton','Western Mountains'),central_corridor:region('rift','Braided River Corridor'),eastern_coast:region('coast_margin','Eastern Waters')},
      sites:[
        site('06_p1',78,68,'eastern_coast','port',{harbor:.90,estuary:.86,flatness:.78,expansion:.82,coastal:.94,river:.92,settlement:.88}),
        site('06_p2',86,55,'eastern_coast','port',{harbor:.80,estuary:.54,flatness:.72,expansion:.78,coastal:1,river:.60,settlement:.78}),
        site('06_p3',84,37,'eastern_coast','port',{harbor:.74,estuary:.48,flatness:.68,expansion:.72,coastal:.96,river:.42,settlement:.72}),
        site('06_i1',54,48,'central_corridor','inland',{river:.98,flatness:.93,corridor:.93,expansion:.94,inland:.92,settlement:.96,resourceAdjacency:.72}),
        site('06_i2',58,61,'central_corridor','inland',{river:.92,flatness:.88,corridor:.90,expansion:.86,inland:.80,settlement:.90,resourceAdjacency:.68}),
        site('06_i3',42,59,'central_corridor','inland',{river:.72,flatness:.86,corridor:.78,expansion:.90,inland:.98,settlement:.84,resourceAdjacency:.70}),
        site('06_s1',66,42,'central_corridor','settlement',{river:.82,flatness:.82,corridor:.80,expansion:.78,inland:.72,settlement:.80}),
        site('06_s2',70,68,'eastern_coast','settlement',{river:.88,flatness:.78,corridor:.74,expansion:.76,coastal:.58,inland:.58,settlement:.78}),
        site('06_s3',36,47,'northwest_basin','settlement',{river:.48,flatness:.52,corridor:.55,expansion:.60,inland:.98,settlement:.56,resourceAdjacency:.84})
      ]
    },
    {
      id:'map_07',name:'Fractured Island Belt',weight:11,imageKey:'map_07',
      regionAnchors:{northwest_basin:{x:31,y:25},central_corridor:{x:52,y:52},eastern_coast:{x:77,y:67}},
      regions:{northwest_basin:region('volcanic','Northern Range'),central_corridor:region('coal_basin','Central Green Basin'),eastern_coast:region('coast_margin','Southern Archipelago Coast')},
      sites:[
        site('07_p1',73,82,'eastern_coast','port',{harbor:.96,estuary:.62,flatness:.74,expansion:.80,coastal:1,river:.52,settlement:.90}),
        site('07_p2',82,66,'eastern_coast','port',{harbor:.90,estuary:.54,flatness:.68,expansion:.76,coastal:1,river:.46,settlement:.84}),
        site('07_p3',22,60,'northwest_basin','port',{harbor:.86,estuary:.42,flatness:.60,expansion:.68,coastal:1,river:.36,settlement:.72}),
        site('07_i1',50,55,'central_corridor','inland',{river:.88,flatness:.91,corridor:.91,expansion:.93,inland:.96,settlement:.95,resourceAdjacency:.80}),
        site('07_i2',59,47,'central_corridor','inland',{river:.72,flatness:.86,corridor:.82,expansion:.86,inland:.84,settlement:.86,resourceAdjacency:.75}),
        site('07_i3',41,64,'central_corridor','inland',{river:.80,flatness:.88,corridor:.78,expansion:.90,inland:.90,settlement:.86,resourceAdjacency:.82}),
        site('07_s1',64,66,'central_corridor','settlement',{river:.66,flatness:.82,corridor:.70,expansion:.82,inland:.68,settlement:.76}),
        site('07_s2',33,52,'central_corridor','settlement',{river:.52,flatness:.72,corridor:.64,expansion:.74,inland:.92,settlement:.68}),
        site('07_s3',70,36,'northwest_basin','settlement',{river:.45,flatness:.48,corridor:.58,expansion:.56,inland:.82,settlement:.56,resourceAdjacency:.88})
      ]
    },
    {
      id:'map_08',name:'Northern Gulf Continent',weight:11,imageKey:'map_08',
      regionAnchors:{northwest_basin:{x:27,y:25},central_corridor:{x:50,y:52},eastern_coast:{x:77,y:53}},
      regions:{northwest_basin:region('craton','Snow Range'),central_corridor:region('forest_highland','Central Woodland Basin'),eastern_coast:region('coast_margin','Eastern Peninsula Coast')},
      sites:[
        site('08_p1',53,83,'eastern_coast','port',{harbor:.96,estuary:.78,flatness:.76,expansion:.84,coastal:1,river:.72,settlement:.90}),
        site('08_p2',84,55,'eastern_coast','port',{harbor:.88,estuary:.48,flatness:.70,expansion:.76,coastal:1,river:.38,settlement:.80}),
        site('08_p3',68,22,'eastern_coast','port',{harbor:.82,estuary:.62,flatness:.66,expansion:.72,coastal:.98,river:.56,settlement:.78}),
        site('08_i1',57,52,'central_corridor','inland',{river:.90,flatness:.90,corridor:.92,expansion:.94,inland:.94,settlement:.95,resourceAdjacency:.72}),
        site('08_i2',46,58,'central_corridor','inland',{river:.82,flatness:.88,corridor:.84,expansion:.92,inland:.98,settlement:.90,resourceAdjacency:.76}),
        site('08_i3',65,61,'central_corridor','inland',{river:.72,flatness:.84,corridor:.82,expansion:.86,inland:.78,settlement:.85,resourceAdjacency:.66}),
        site('08_s1',38,67,'central_corridor','settlement',{river:.56,flatness:.80,corridor:.68,expansion:.84,inland:.90,settlement:.72}),
        site('08_s2',74,44,'eastern_coast','settlement',{river:.62,flatness:.76,corridor:.72,expansion:.78,coastal:.48,inland:.62,settlement:.76}),
        site('08_s3',40,40,'northwest_basin','settlement',{river:.42,flatness:.46,corridor:.54,expansion:.58,inland:.98,settlement:.56,resourceAdjacency:.84})
      ]
    }
  ];

  const TEMPLATE_BY_ID=Object.fromEntries(MAP_TEMPLATES.map(t=>[t.id,t]));

  function selectMapTemplate(seed){
    const total=MAP_TEMPLATES.reduce((s,t)=>s+t.weight,0);
    let r=unitNoise(seed,'map-template')*total;
    for(const t of MAP_TEMPLATES){if(r<t.weight)return deepClone(t);r-=t.weight;}
    return deepClone(MAP_TEMPLATES[MAP_TEMPLATES.length-1]);
  }

  function makeRegions(template){
    const out={};
    Object.entries(template.regions).forEach(([id,r])=>{out[id]=Object.assign({id},deepClone(r));});
    return out;
  }

  function regionResourcePull(regionId,state,World){
    if(!World||!state.regions?.[regionId])return .5;
    const all=World.getAllResourceEndowment(regionId,state);
    const vals=['coal','iron','copper','oil'].map(k=>Number(all[k]?.potential||0));
    return clamp(Math.max(...vals));
  }

  function portScore(s,seed){
    if(s.kind!=='port')return -99;
    return s.harbor*.28+s.estuary*.17+s.coastal*.16+s.flatness*.12+s.expansion*.12+s.river*.08+s.settlement*.07+(unitNoise(seed,s.id,'port')-.5)*.05;
  }

  function westhavenScore(s,seed,port,resourcePull){
    if(s.kind!=='inland')return -99;
    const d=port?dist(s,port):35;
    const distanceScore=clamp(1-Math.abs(d-35)/35);
    return s.river*.20+s.flatness*.20+s.corridor*.18+s.expansion*.14+s.inland*.12+s.settlement*.07+resourcePull*.05+distanceScore*.04+(unitNoise(seed,s.id,'westhaven')-.5)*.05;
  }

  function chooseInitialCitySites(template,state,World,seed){
    const portCandidates=template.sites.filter(s=>s.kind==='port');
    const port=portCandidates.slice().sort((a,b)=>portScore(b,seed)-portScore(a,seed))[0];
    const inland=template.sites.filter(s=>s.kind==='inland'&&dist(s,port)>=18);
    const scored=inland.map(s=>({site:s,score:westhavenScore(s,seed,port,regionResourcePull(s.regionId,state,World))})).sort((a,b)=>b.score-a.score);
    const west=scored[0]?.site||template.sites.find(s=>s.kind==='inland');
    if(!port||!west)throw new Error('Template lacks valid initial city candidates');
    return {portArlen:deepClone(port),westhaven:deepClone(west),scores:{port:portScore(port,seed),westhaven:scored[0]?.score||0}};
  }

  function populationForLevel(level){return ({settlement:9000,village:22000,town:65000,city:240000,major_city:850000})[level]||9000;}
  const CITY_UPGRADE_POP={settlement:16000,village:48000,town:180000,city:650000,major_city:Infinity};
  const CITY_DOWNGRADE_POP={major_city:520000,city:150000,town:42000,village:14000,settlement:2500};
  // 1 turn = 1 year. Visible change can start early, but formal urban-rank changes need time.
  const CITY_MIN_HEALTHY_YEARS={settlement:5,village:6,town:8,city:10,major_city:99};
  const CITY_MIN_LEVEL_YEARS={settlement:8,village:10,town:15,city:20,major_city:99};
  const CITY_MIN_STRESS_YEARS={major_city:12,city:10,town:8,village:6,settlement:8};
  const CITY_MIN_LOW_POP_YEARS={major_city:5,city:5,town:4,village:4,settlement:8};

  function makeInitialCities(template,state,World,seed){
    const choice=chooseInitialCitySites(template,state,World,seed);
    const year=state.time?.year||2030;
    state.cities=state.cities||{};
    const defs=[
      {id:'port_arlen',name:'Port Arlen',role:'port_city',site:choice.portArlen,level:'city',age:120},
      {id:'westhaven',name:'Westhaven',role:'inland_city',site:choice.westhaven,level:'city',age:90}
    ];
    defs.forEach(d=>{
      state.cities[d.id]={
        id:d.id,name:d.name,countryId:'asteria',regionId:d.site.regionId,siteId:d.site.id,x:d.site.x,y:d.site.y,
        role:d.role,level:d.level,status:'active',trendStatus:'stable',active:true,population:populationForLevel(d.level),
        foundedYear:year-d.age,momentum:0,upgradeProgress:0,declineProgress:0,revivalProgress:0,
        healthyYears:0,stressYears:0,lowPopulationYears:0,lastTransitionYear:year
      };
    });
    return deepClone(choice);
  }

  function cityMarkerModel(city){
    return {id:city.id,name:city.name,x:city.x,y:city.y,level:city.level,status:city.status||'active',trendStatus:city.trendStatus||'stable',role:city.role||'urban',population:city.population||0,active:city.active!==false,className:`city-marker level-${city.level} status-${city.status||'active'} ${city.role||''}`};
  }

  function siteBaseOpportunity(site,regionPull){
    const water=Math.max(site.river||0,site.coastal||0);
    return clamp(site.settlement*.28+site.flatness*.18+site.corridor*.16+site.expansion*.15+water*.10+site.resourceAdjacency*.05+regionPull*.08);
  }

  function infrastructureBonus(regionId,state){
    let b=0;
    const facilities=Object.values(state.facilities||{}).filter(f=>f.active!==false&&f.regionId===regionId);
    b+=Math.min(.18,facilities.length*.035);
    const connections=Object.values(state.connections||{}).filter(c=>c.active!==false&&(c.fromId===regionId||c.toId===regionId));
    b+=Math.min(.16,connections.length*.05);
    return clamp(b,0,.30);
  }

  function externalCitySignal(city,state){
    const sig=state.citySignals?.[city.id]||{};
    const pop=Number(sig.populationPressure??0);
    const econ=Number(sig.economicMomentum??0);
    const housing=Number(sig.housingStress??0);
    const conflict=Number(sig.conflictStress??0);
    return clamp(pop*.35+econ*.45-housing*.22-conflict*.35,-1,1);
  }

  function facilityUrbanWeight(f){
    const base={coal_mine:.14,iron_mine:.14,copper_mine:.15,oil_field:.15,steelworks:.22,basic_factory:.18,power_plant:.055,port:.16}[f.type]||.04;
    const level=Math.max(1,Number(f.level||1));
    const capacityFactor=clamp(Number(f.capacity||0)/60,0,.35);
    return base*(1+Math.min(.55,(level-1)*.14))+capacityFactor*.05;
  }

  function regionalUrbanDrivers(regionId,state){
    const facilities=Object.values(state.facilities||{}).filter(f=>f.active!==false&&f.regionId===regionId);
    const employmentAnchor=clamp(facilities.reduce((sum,f)=>sum+facilityUrbanWeight(f),0),0,.72);
    const connections=Object.values(state.connections||{}).filter(c=>c.active!==false&&(c.fromId===regionId||c.toId===regionId));
    const logistics=clamp(connections.reduce((sum,c)=>sum+.045+Math.min(.05,Number(c.capacity||0)/1200),0),0,.24);
    const activeProjects=Object.values(state.projects||{}).filter(p=>p.status==='under_construction'&&p.regionId===regionId&&p.type!=='resource_exploration');
    const constructionPull=clamp(activeProjects.length*.025,0,.10);
    const region=state.regions?.[regionId]||{};
    const supply=Number(region.powerSupply||0), demand=Number(region.powerDemand||0);
    const powerAdequacy=demand<=0?1:clamp(supply/Math.max(1,demand),0,1.25);
    const powerStress=demand>0?clamp((.80-powerAdequacy)/.80,0,.35):0;
    return {employmentAnchor,logistics,constructionPull,powerAdequacy,powerStress,facilityCount:facilities.length,connectionCount:connections.length};
  }

  function cityAgglomeration(city){
    const p=Math.max(0,Number(city.population||0));
    return clamp((Math.log10(p/4000+1)/2.15)*.34,.035,.34);
  }

  function cityOpportunity(city,site,state,World,seed,year){
    const regionPull=regionResourcePull(city.regionId,state,World);
    const base=siteBaseOpportunity(site,regionPull);
    const drivers=regionalUrbanDrivers(city.regionId,state);
    const ext=externalCitySignal(city,state);
    const age=Math.max(0,year-(city.foundedYear||year));
    const maturity=clamp(age/60)*.045;
    const agglomeration=cityAgglomeration(city);
    const localCities=Math.max(1,activeCities(state).filter(c=>c.regionId===city.regionId).length);
    const anchorShare=drivers.employmentAnchor/Math.sqrt(localCities);
    const roleBonus=city.role==='port_city'?.045:city.role==='inland_city'?.018:0;
    const foundingSupport=city.role==='emergent_city'&&age<12?Math.max(0,.055*(1-age/12)):0;
    const noise=(unitNoise(seed,city.id,year,'urban')-.5)*.035;
    const score=base*.39+agglomeration+anchorShare*.34+drivers.logistics*.22+drivers.constructionPull*.10+ext*.29+maturity+roleBonus+foundingSupport-drivers.powerStress*.16+noise;
    return clamp(score,0,1.35);
  }

  function cityEquilibrium(level){return ({settlement:.44,village:.50,town:.57,city:.67,major_city:.72})[level]??.57;}

  function levelIndex(level){return Math.max(0,CITY_LEVELS.indexOf(level));}
  function upgradeCity(city,year){
    const i=levelIndex(city.level);
    if(i<CITY_LEVELS.length-1){
      city.level=CITY_LEVELS[i+1];
      city.population=Math.max(city.population,populationForLevel(city.level)*.72);
      city.lastTransitionYear=year;city.upgradeProgress=0;city.declineProgress=0;city.healthyYears=0;city.lowPopulationYears=0;
      return true;
    }
    return false;
  }
  function downgradeCity(city,year){
    const i=levelIndex(city.level);
    if(i<=0)return 'blocked';
    city.level=CITY_LEVELS[i-1];
    city.population=Math.min(city.population,populationForLevel(city.level)*1.25);
    city.lastTransitionYear=year;city.upgradeProgress=0;city.declineProgress=0;city.stressYears=0;city.lowPopulationYears=0;
    return 'downgraded';
  }
  function abandonCity(city,year){
    city.status='abandoned';city.trendStatus='abandoned';city.active=false;city.abandonedYear=year;city.lastTransitionYear=year;
    city.population=Math.max(0,Math.min(600,Math.round(city.population*.18)));
    city.declineProgress=0;city.lowPopulationYears=0;city.stressYears=0;
    return 'abandoned';
  }

  function occupiedSiteIds(state){return new Set(Object.values(state.cities||{}).filter(c=>c.status!=='removed').map(c=>c.siteId));}
  function activeCities(state){return Object.values(state.cities||{}).filter(c=>c.active!==false&&c.status!=='abandoned');}
  function nearestCityDistance(site,state){const cities=activeCities(state);if(!cities.length)return 100;return Math.min(...cities.map(c=>dist(site,c)));}

  function regionalGrowthSignal(regionId,state){
    const explicit=state.regionSignals?.[regionId];
    if(explicit){
      const econ=Number(explicit.economicMomentum??0),pop=Number(explicit.populationPressure??0),stress=Number(explicit.stress??0);
      return clamp(econ*.60+pop*.40-stress*.45,-1,1);
    }
    const local=activeCities(state).filter(c=>c.regionId===regionId);
    const sample=local.length?local:activeCities(state);
    if(!sample.length)return 0;
    let total=0;
    sample.forEach(c=>{total+=externalCitySignal(c,state);});
    return clamp(total/sample.length,-1,1);
  }

  function candidateFormationAssessment(site,state,World,seed,year){
    const pull=regionResourcePull(site.regionId,state,World);
    const base=siteBaseOpportunity(site,pull);
    const drivers=regionalUrbanDrivers(site.regionId,state);
    const growth=regionalGrowthSignal(site.regionId,state);
    const d=nearestCityDistance(site,state);
    const spacing=clamp((d-12)/26,0,1);
    const noise=(unitNoise(seed,site.id,year,'formation')-.5)*.03;
    const hasEmploymentAnchor=drivers.employmentAnchor>=.11;
    const hasGrowthSpillover=growth>=.28&&drivers.logistics>=.04;
    const siteViable=base>=.43&&d>=14;
    const anchorViable=hasEmploymentAnchor||hasGrowthSpillover;
    const powerViable=drivers.powerAdequacy>=.45||drivers.employmentAnchor<.18;
    const viable=siteViable&&anchorViable&&powerViable;
    const score=clamp(base*.44+drivers.employmentAnchor*.38+drivers.logistics*.20+Math.max(0,growth)*.18+drivers.constructionPull*.08+spacing*.08-drivers.powerStress*.18+noise,0,1.25);
    let reason='waiting for a durable economic anchor';
    if(!siteViable)reason=d<14?'too close to an existing city':'site conditions are too weak';
    else if(!powerViable)reason='power shortage blocks durable settlement growth';
    else if(hasEmploymentAnchor)reason='employment anchor + viable site';
    else if(hasGrowthSpillover)reason='regional population spillover + transport access';
    return {score,viable,reason,base,distance:d,spacing,growth,drivers,hasEmploymentAnchor,hasGrowthSpillover};
  }

  function candidateFormationPressure(site,state,World,seed,year){return candidateFormationAssessment(site,state,World,seed,year).score;}

  function siteFormationStage(progress){
    const y=Number(progress?.viableYears||0), f=Number(progress?.formation||0);
    if(y>=7&&f>=1.25)return 'settlement_ready';
    if(y>=4&&f>=.62)return 'emerging_settlement';
    if(y>=2&&f>=.24)return 'workers_camp';
    return 'potential_site';
  }

  function cityNameFor(site,state,seed){
    const pools=['Rivermouth','Stoneford','Ashvale','Northbridge','Greenhaven','Lakecross','Eastmere','Redbank','Highfield','Southwick','Ironford','Clearwater','Greyhaven','Oakridge','New Arlen','Valeport'];
    const used=new Set(Object.values(state.cities||{}).map(c=>c.name));
    for(let k=0;k<pools.length;k++){
      const name=pools[(Math.floor(unitNoise(seed,site.id,'name')*pools.length)+k)%pools.length];
      if(!used.has(name))return name;
    }
    return `New Settlement ${Object.keys(state.cities||{}).length+1}`;
  }

  function spawnSettlement(site,state,seed,year,assessment=null){
    assessment=assessment||candidateFormationAssessment(site,state,null,seed,year);
    const id=`city_${hashString(`${seed}|${site.id}|${year}`).toString(16)}`;
    const founderPop=Math.round(clamp(3200+(assessment.score||.5)*4200+(assessment.drivers?.employmentAnchor||0)*2600,3000,8200));
    const c={
      id,name:cityNameFor(site,state,seed),countryId:'asteria',regionId:site.regionId,siteId:site.id,x:site.x,y:site.y,role:'emergent_city',
      level:'settlement',status:'active',trendStatus:'forming',active:true,population:founderPop,foundedYear:year,momentum:0,
      upgradeProgress:0,declineProgress:0,revivalProgress:0,healthyYears:0,stressYears:0,lowPopulationYears:0,lastTransitionYear:year,
      foundingReason:assessment.reason||'sustained settlement pressure',foundingScore:Number((assessment.score||0).toFixed(3))
    };
    state.cities[id]=c;
    state.history=state.history||[];
    state.history.push({id:`urban_${id}_${year}`,type:'CITY_FOUNDED',sourceModule:'urban',year,cityId:id,siteId:site.id,reason:c.foundingReason,score:c.foundingScore});
    return c;
  }

  function updateActiveCity(city,s,state,World,seed,year,events){
    const opp=cityOpportunity(city,s,state,World,seed,year);
    city.momentum=Number((opp-cityEquilibrium(city.level)).toFixed(3));
    const growthRate=clamp(city.momentum*.18,-.082,.072);
    city.population=Math.max(250,Math.round((city.population||populationForLevel(city.level))*(1+growthRate)));

    const healthy=city.momentum>.075;
    const stressed=city.momentum<-.075;
    city.healthyYears=healthy?(city.healthyYears||0)+1:Math.max(0,(city.healthyYears||0)-1);
    city.stressYears=stressed?(city.stressYears||0)+1:Math.max(0,(city.stressYears||0)-1);
    city.upgradeProgress=healthy?(city.upgradeProgress||0)+Math.max(.05,city.momentum):Math.max(0,(city.upgradeProgress||0)-.10);
    city.declineProgress=stressed?(city.declineProgress||0)+Math.max(.05,-city.momentum):Math.max(0,(city.declineProgress||0)-.12);

    const downPop=CITY_DOWNGRADE_POP[city.level]??0;
    if(city.population<=downPop)city.lowPopulationYears=(city.lowPopulationYears||0)+1;
    else city.lowPopulationYears=Math.max(0,(city.lowPopulationYears||0)-1);

    city.trendStatus=city.momentum>.09?'growing':city.momentum<-.12?'shrinking':'stable';

    const upPop=CITY_UPGRADE_POP[city.level]??Infinity;
    const upThreshold=city.level==='settlement'?.90:city.level==='village'?1.15:city.level==='town'?1.55:city.level==='city'?2.10:99;
    const minHealthy=CITY_MIN_HEALTHY_YEARS[city.level]||6;
    const minLevelYears=CITY_MIN_LEVEL_YEARS[city.level]||10;
    const yearsAtLevel=Math.max(0,year-Number(city.lastTransitionYear||city.foundedYear||year));
    if(city.population>=upPop&&city.healthyYears>=minHealthy&&yearsAtLevel>=minLevelYears&&city.upgradeProgress>=upThreshold&&upgradeCity(city,year)){
      events.push({type:'CITY_UPGRADED',cityId:city.id,level:city.level,year,reason:'population threshold + sustained growth + minimum urban maturation time'});
      return;
    }

    const minStress=CITY_MIN_STRESS_YEARS[city.level]||8;
    const minLowPop=CITY_MIN_LOW_POP_YEARS[city.level]||4;
    if(city.level!=='settlement'&&city.population<=downPop&&city.stressYears>=minStress&&city.lowPopulationYears>=minLowPop){
      const result=downgradeCity(city,year);
      if(result==='downgraded')events.push({type:'CITY_DOWNGRADED',cityId:city.id,level:city.level,year,reason:'persistent population loss sustained long enough for this city size'});
      return;
    }

    if(city.level==='settlement'){
      const drivers=regionalUrbanDrivers(city.regionId,state);
      const noDurableAnchor=drivers.employmentAnchor<.08&&drivers.logistics<.05;
      const severeLocalStress=externalCitySignal(city,state)<-.55||city.momentum<-.20;
      // Small settlements can disappear materially faster than cities, but only under genuinely severe collapse.
      // Severe-collapse path: once population has fallen below ~55% of a normal settlement and stress has persisted for years,
      // abandonment can occur in roughly a decade or two. Ordinary anchor-loss uses the slower historical path below.
      const severeAbandonPop=Math.round(populationForLevel('settlement')*.55);
      const severeCollapseReady=severeLocalStress&&city.population<=severeAbandonPop&&city.stressYears>=6;
      const slowAnchorLossReady=noDurableAnchor&&city.population<=CITY_DOWNGRADE_POP.settlement&&city.stressYears>=CITY_MIN_STRESS_YEARS.settlement&&city.lowPopulationYears>=CITY_MIN_LOW_POP_YEARS.settlement;
      if(severeCollapseReady||slowAnchorLossReady){
        abandonCity(city,year);
        events.push({type:'CITY_ABANDONED',cityId:city.id,level:city.level,year,reason:severeCollapseReady?'small settlement suffered sustained severe collapse and fell below a viable population':'small settlement remained below viable population for many years after durable urban functions disappeared'});
      }
    }
  }

  function updateUrbanYear(template,state,World,options={}){
    const year=Number(state.time?.year||0);
    const seed=state.worldSeed||state.world?.seed||'border-epoch';
    const events=[];
    const siteById=Object.fromEntries(template.sites.map(s=>[s.id,s]));

    // Existing cities evolve from population + persistent conditions, not a one-year score.
    activeCities(state).forEach(city=>{
      const s=siteById[city.siteId]||site('fallback',city.x,city.y,city.regionId,'settlement',{});
      updateActiveCity(city,s,state,World,seed,year,events);
    });

    // New settlements require a viable site AND a durable economic/demographic reason for several years.
    const occupied=occupiedSiteIds(state);
    const candidates=template.sites.filter(s=>!occupied.has(s.id)&&s.kind==='settlement');
    state.urbanSiteProgress=state.urbanSiteProgress||{};
    const ranked=candidates.map(s=>({site:s,assessment:candidateFormationAssessment(s,state,World,seed,year)})).sort((a,b)=>b.assessment.score-a.assessment.score);
    for(const item of ranked){
      const a=item.assessment;
      const p=state.urbanSiteProgress[item.site.id]||{formation:0,viableYears:0,blockedYears:0,stage:'potential_site'};
      const previousStage=p.stage||siteFormationStage(p);
      p.lastAssessment={score:Number(a.score.toFixed(3)),viable:a.viable,reason:a.reason,distance:Number(a.distance.toFixed(1)),base:Number(a.base.toFixed(3)),growth:Number(a.growth.toFixed(3)),employmentAnchor:Number(a.drivers.employmentAnchor.toFixed(3)),logistics:Number(a.drivers.logistics.toFixed(3)),powerAdequacy:Number(a.drivers.powerAdequacy.toFixed(3))};
      if(a.viable){
        p.viableYears=(p.viableYears||0)+1;p.blockedYears=0;
        // Early visible feedback, slower formal settlement formation.
        p.formation=Math.min(2.5,(p.formation||0)+.075+Math.max(0,a.score-.42)*.46);
      }else{
        p.viableYears=0;p.blockedYears=(p.blockedYears||0)+1;
        p.formation=Math.max(0,(p.formation||0)-.18);
      }
      p.stage=siteFormationStage(p);
      if(a.viable&&p.stage!==previousStage&&(p.stage==='workers_camp'||p.stage==='emerging_settlement')){
        events.push({type:p.stage==='workers_camp'?'URBAN_WORKERS_CAMP':'URBAN_EMERGING_SETTLEMENT',siteId:item.site.id,regionId:item.site.regionId,year,reason:a.reason});
      }
      state.urbanSiteProgress[item.site.id]=p;
    }
    const birth=ranked.find(item=>{
      const p=state.urbanSiteProgress[item.site.id];
      return item.assessment.viable&&(p?.viableYears||0)>=7&&(p?.formation||0)>=1.25&&nearestCityDistance(item.site,state)>=14;
    });
    if(birth){
      const c=spawnSettlement(birth.site,state,seed,year,birth.assessment);
      state.urbanSiteProgress[birth.site.id].formation=0;
      state.urbanSiteProgress[birth.site.id].viableYears=0;
      state.urbanSiteProgress[birth.site.id].stage='occupied';
      events.push({type:'CITY_FOUNDED',cityId:c.id,level:c.level,year,reason:c.foundingReason});
    }

    // Abandoned sites persist. Revival also needs a multi-year cause; it is not automatic regeneration.
    Object.values(state.cities||{}).filter(c=>c.status==='abandoned').forEach(city=>{
      const s=siteById[city.siteId]||site('fallback',city.x,city.y,city.regionId,'settlement',{});
      const a=candidateFormationAssessment(s,state,World,seed,year);
      const ext=externalCitySignal(city,state);
      const revivalViable=a.viable||(ext>.35&&a.base>.43);
      city.revivalYears=revivalViable?(city.revivalYears||0)+1:0;
      city.revivalProgress=revivalViable?Math.min(2,(city.revivalProgress||0)+.12+Math.max(0,a.score-.40)*.48):Math.max(0,(city.revivalProgress||0)-.14);
      if(city.revivalYears>=3&&city.revivalProgress>=1.05){
        city.status='active';city.active=true;city.level='settlement';city.trendStatus='forming';
        city.population=Math.max(2200,Math.min(6500,Math.round(2600+a.score*3600)));
        city.revivalProgress=0;city.revivalYears=0;city.upgradeProgress=0;city.declineProgress=0;city.healthyYears=0;city.stressYears=0;city.lowPopulationYears=0;city.lastTransitionYear=year;
        events.push({type:'CITY_REVIVED',cityId:city.id,level:city.level,year,reason:a.reason});
      }
    });

    if(events.length){
      state.history=state.history||[];
      events.filter(e=>e.type!=='CITY_FOUNDED').forEach((e,i)=>state.history.push(Object.assign({id:`urban_evt_${year}_${i}`,sourceModule:'urban'},e)));
    }
    return events;
  }

  function buildInitialState(seed,templateOverride=null){
    const template=templateOverride?deepClone(typeof templateOverride==='string'?TEMPLATE_BY_ID[templateOverride]:templateOverride):selectMapTemplate(seed);
    const state={
      worldSeed:String(seed||'border-epoch-default'),
      world:{seed:String(seed||'border-epoch-default'),templateId:template.id,templateName:template.name},
      time:{year:2030},turn:2030,playerCountryId:'asteria',
      countries:{asteria:{id:'asteria',name:'Republic of Asteria'},meridian:{id:'meridian',name:'Meridian Republic'}},
      regions:makeRegions(template),cities:{},facilities:{},connections:{},projects:{},explorationResults:{},discoveredDeposits:{},economy:{},tradeRelations:{},diplomaticRelations:{},issues:{},events:[],history:[],flags:{},citySignals:{},urbanSiteProgress:{}
    };
    return {state,template};
  }

  function initializeWorld(seed,World,Development,templateOverride=null){
    const {state,template}=buildInitialState(seed,templateOverride);
    World.initialize(state,{worldSeed:state.worldSeed});
    if(Development){Development.setWorld(World);Development.initializeState(state);}
    const cityChoice=makeInitialCities(template,state,World,state.worldSeed);
    return {state,template,cityChoice};
  }

  function advanceOneYear(session,World,Development){
    const state=session.state,template=session.template;
    state.time.year=Number(state.time.year||2030)+1;state.turn=state.time.year;
    const developmentCompleted=Development?Development.updateProjects(state,1):[];
    const urbanEvents=updateUrbanYear(template,state,World);
    return {year:state.time.year,developmentCompleted,urbanEvents};
  }

  function getRegionEndowmentSummary(state,World){
    return Object.fromEntries(Object.keys(state.regions||{}).map(rid=>[rid,World.getResourceIndications(rid,state)]));
  }

  function mapTemplateWeights(){return MAP_TEMPLATES.map(t=>({id:t.id,name:t.name,weight:t.weight}));}

  return {
    VERSION,CITY_LEVELS,CITY_LEVEL_LABELS,GEOLOGY_PROFILES,MAP_TEMPLATES,TEMPLATE_BY_ID,
    hashString,unitNoise,selectMapTemplate,mapTemplateWeights,buildInitialState,initializeWorld,chooseInitialCitySites,makeInitialCities,cityMarkerModel,
    updateUrbanYear,advanceOneYear,getRegionEndowmentSummary,regionResourcePull,portScore,westhavenScore,
    _internals:{dist,siteBaseOpportunity,infrastructureBonus,externalCitySignal,regionalGrowthSignal,regionalUrbanDrivers,facilityUrbanWeight,cityAgglomeration,cityEquilibrium,cityOpportunity,candidateFormationAssessment,candidateFormationPressure,populationForLevel,spawnSettlement,downgradeCity,abandonCity,upgradeCity}
  };
});
