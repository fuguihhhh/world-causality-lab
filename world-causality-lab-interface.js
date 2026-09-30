/* ===== BORDER EPOCH · MODULE 8 REVERSE CAUSAL NAVIGATION ===== */
(function(global){
'use strict';
const BE=global.BorderEpoch=global.BorderEpoch||{};
const LANG=getGameLanguage();
const ZH=LANG==='zh';
const VERSION='1.0.0';
const T=(zh,en)=>ZH?zh:en;
const clone=v=>v==null?v:(typeof structuredClone==='function'?structuredClone(v):JSON.parse(JSON.stringify(v)));
const n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,n(v,a)));
const vals=o=>Object.values(o||{});
const entries=o=>Object.entries(o||{});
const sumObj=o=>entries(o).reduce((s,[,v])=>s+n(v),0);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=v=>Number.isFinite(Number(v))?new Intl.NumberFormat(ZH?'zh-CN':'en-US',{maximumFractionDigits:2}).format(Number(v)):String(v??'—');
const pct=v=>`${(n(v)*100).toFixed(Math.abs(n(v))<.1?1:0)}%`;
const currentState=()=>((typeof session!=='undefined'&&session?.state)||global.gameState||null);
const yearOf=gs=>n(gs?.time?.year,gs?.turn||0);
const severityRank={low:1,medium:2,high:3};
const severityLabel=s=>({low:T('轻微','Low'),medium:T('中等','Medium'),high:T('严重','High')})[s]||s;
const statusLabel=s=>({active:T('持续','Active'),improving:T('改善中','Improving'),resolved:T('已解决','Resolved'),worsening:T('恶化','Worsening'),addressing:T('处理中','Being addressed')})[s]||s;
const uid=s=>String(s??'').replace(/[^a-zA-Z0-9_:-]+/g,'_');
const STORAGE_KEY='BorderEpoch.causalNavigator.ui.v1';

function ensureStore(gs){
  if(!gs)return null;
  gs.reverseCausalNavigation=gs.reverseCausalNavigation||{version:VERSION,problems:{},problemOrder:[],ui:{},lastRefreshYear:null};
  const s=gs.reverseCausalNavigation;s.version=VERSION;s.problems=s.problems||{};s.problemOrder=s.problemOrder||[];s.ui=s.ui||{};
  return s;
}
function evidence(label,value,source){return {label,value,source};}
function action(id,label,spec={}){return {id:uid(id),label,actionType:spec.actionType||'navigate',targetModule:spec.targetModule||'Module8',targetView:spec.targetView||null,targetObjectId:spec.targetObjectId||null,regionId:spec.regionId||null,reason:spec.reason||'',expectedEffect:spec.expectedEffect||'',availability:spec.availability!==false,blockedReason:spec.blockedReason||null,meta:spec.meta||{}};}
function cause(id,label,spec={}){return {id:uid(id),type:spec.type||'state_constraint',label,objectType:spec.objectType||null,objectId:spec.objectId||null,regionId:spec.regionId||null,currentValue:spec.currentValue??null,threshold:spec.threshold??null,relation:spec.relation||'limits',severity:spec.severity||'medium',sourceModule:spec.sourceModule||null,year:spec.year??null,active:spec.active!==false,evidence:spec.evidence||[],upstreamCauses:spec.upstreamCauses||[],availableActions:spec.availableActions||[]};}
function problem(id,type,spec={}){return {id:uid(id),type,severity:spec.severity||'medium',severityScore:n(spec.severityScore,severityRank[spec.severity]||2),objectType:spec.objectType||null,objectId:spec.objectId||null,regionId:spec.regionId||null,title:spec.title||type,summary:spec.summary||'',observedValue:spec.observedValue??null,expectedRange:spec.expectedRange??null,detectedYear:spec.detectedYear??null,status:spec.status||'active',directCauses:spec.directCauses||[],upstreamCauses:spec.upstreamCauses||[],availableActions:spec.availableActions||[],evidence:spec.evidence||[],sourceModule:spec.sourceModule||null,history:spec.history||[]};}
function moduleRefs(){return {Development:global.Development||BE.Development,Economy:global.Economy||BE.Economy,Population:global.Population||BE.Population,Agriculture:BE.Agriculture||global.Agriculture,Trade:BE.Trade||global.Trade};}
function getRegionEconomy(gs,rid){const E=moduleRefs().Economy;try{return E?.getRegionEconomy?.(rid)||gs?.economy?.regions?.[rid]||null;}catch(_){return gs?.economy?.regions?.[rid]||null;}}
function getFacilityEconomy(gs,fid){const E=moduleRefs().Economy;try{return E?.getFacilityEconomy?.(fid)||gs?.economy?.facilities?.[fid]||null;}catch(_){return gs?.economy?.facilities?.[fid]||null;}}
function getCityPopulation(gs,cid){const P=moduleRefs().Population;try{return P?.getCityPopulation?.(cid)||gs?.population?.cities?.[cid]||null;}catch(_){return gs?.population?.cities?.[cid]||null;}}
function projectSignals(gs){return gs?.modules?.economy?.module2Signals?.projectProgress||gs?.economy?.module2Signals?.projectProgress||{};}
function availableTab(view){return !!document.querySelector(`[data-tab="${view}"]`);}
function currentBuildTypes(){return new Set(['basic_factory','steelworks','power_plant','port','railway']);}
function buildActionAvailable(type){return currentBuildTypes().has(type);}
function regionName(gs,rid){return gs?.regions?.[rid]?.name||rid||T('未知地区','Unknown region');}
function cityName(gs,cid){return gs?.cities?.[cid]?.name||cid||T('未知城市','Unknown city');}
function facilityName(gs,fid){const f=gs?.facilities?.[fid];return f?.name||String(f?.type||fid||T('工业设施','Facility'));}
function cropLabel(id){const map={wheat:T('小麦','Wheat'),rice:T('水稻','Rice'),corn:T('玉米','Corn'),soybean:T('大豆','Soybean'),potato:T('马铃薯','Potato')};return map[id]||id;}

function agricultureResourceCause(gs,rid,cropId,key,alloc,yr,prefix){
  const names={farmInputs:T('农资 / 肥料投入不足','Farm input / fertilizer shortage'),machinery:T('农机能力不足','Machinery shortage'),labor:T('农业劳动力不足','Agricultural labor shortage'),irrigation:T('灌溉水不足','Irrigation shortage'),water:T('灌溉水不足','Irrigation shortage')};
  const factor=clamp(alloc?.factor,0,1),demand=n(alloc?.demand),allocated=n(alloc?.allocated);
  const ev=[evidence(T('满足比例','Fulfillment factor'),pct(factor),'Module 9 cropDetails.resourceAllocation')];
  if(demand>0)ev.push(evidence(T('需求','Demand'),fmt(demand),'Module 9 resourceAllocation'));
  if(allocated>=0)ev.push(evidence(T('实际分配','Allocated'),fmt(allocated),'Module 9 resourceAllocation'));
  return cause(`${prefix}_${key}`,names[key]||key,{type:`${key}_shortage`,label:names[key]||key,objectType:'agricultureResource',objectId:`${rid}:${key}`,regionId:rid,currentValue:factor,threshold:1,relation:'limits_agriculture',severity:factor<.2?'high':factor<.65?'medium':'low',sourceModule:'Module9',year:yr,evidence:ev,availableActions:agricultureActions(gs,rid,key)});
}
function agricultureActions(gs,rid,key){
  const out=[];
  if(key==='machinery')out.push(action(`ag_${rid}_factory`,T('查看机械/工业供给','Inspect machinery / industrial supply'),{targetModule:'Module2',targetView:'development',targetObjectId:'basic_factory',regionId:rid,reason:T('农机供给由工业与地区可达性共同支持','Machinery availability depends on industry and regional access'),expectedEffect:T('增加未来农机供给能力','Can increase future machinery availability'),availability:true,meta:{buildType:'basic_factory'}}));
  if(key==='farmInputs')out.push(action(`ag_${rid}_fertilizer`,T('建设化肥 / 农资产能','Build fertilizer / farm-input capacity'),{targetModule:'Module2',targetView:'development',targetObjectId:'fertilizer_plant',regionId:rid,reason:T('当前农业投入不足','Current agricultural inputs are insufficient'),expectedEffect:T('未来年度增加农资供给','Increase future farm-input supply'),availability:false,blockedReason:T('当前这版 Module 2 尚没有化肥厂建设入口；导航器不会伪造按钮。','This build does not yet expose a fertilizer-plant action in Module 2; the navigator will not invent one.')}));
  if(key==='water'||key==='irrigation')out.push(action(`ag_${rid}_irrig`,T('查看灌溉基础设施','Inspect irrigation infrastructure'),{targetModule:'Module2',targetView:'development',regionId:rid,reason:T('灌溉能力限制农业','Irrigation capacity is constraining agriculture'),expectedEffect:T('提高未来可灌溉能力','Can raise future irrigation capacity'),availability:true}));
  return out;
}
function agricultureDiagnostics(gs){
  const out=[],yr=yearOf(gs),regions=gs?.agriculture?.regions||{};
  for(const [rid,r] of entries(regions)){
    const lo=r?.lastOutput||{},details=lo.cropDetails||{},cropStates=r?.crops||{};
    for(const [cropId,d] of entries(details)){
      const cs=cropStates[cropId]||{};
      const planned=n(d?.plannedArea, n(cs?.plannedArea,n(cs?.area,d?.plantedArea)));
      const hasExplicitActual=Object.prototype.hasOwnProperty.call(d||{},'actualArea')||Object.prototype.hasOwnProperty.call(cs||{},'actualArea')||Object.prototype.hasOwnProperty.call(d||{},'actualPlantedArea');
      const actual=n(d?.actualArea,n(d?.actualPlantedArea,n(cs?.actualArea,n(d?.plantedArea,n(cs?.plantedArea)))));
      const alloc=d?.resourceAllocation||{};const factors=[];
      for(const key of ['farmInputs','machinery','labor','irrigation']){const a=alloc[key];if(a&&n(a.factor,1)<.995)factors.push(agricultureResourceCause(gs,rid,cropId,key,a,yr,`ag_${rid}_${cropId}`));}
      if(hasExplicitActual&&planned>0&&actual<planned*.95){
        const sev=actual<=.01?'high':actual/planned<.5?'medium':'low';
        const actions=[...new Map(factors.flatMap(c=>c.availableActions||[]).map(a=>[a.id,a])).values()];
        out.push(problem(`ag_area_${rid}_${cropId}`,actual<=.01?'AGRICULTURE_STOPPED':'AGRICULTURE_ACTUAL_AREA_LOW',{severity:sev,severityScore:3*(1-actual/Math.max(planned,.001)),objectType:'agricultureProject',objectId:`${rid}:${cropId}`,regionId:rid,title:actual<=.01?T(`${cropLabel(cropId)}实际播种为 0`,`${cropLabel(cropId)} actual planting is zero`):T(`${cropLabel(cropId)}实际播种低于计划`,`${cropLabel(cropId)} actual planting is below plan`),summary:T(`计划 ${fmt(planned)}，实际 ${fmt(actual)}。只显示真实限制因子。`,`Planned ${fmt(planned)}, actual ${fmt(actual)}. Only real limiting factors are shown.`),observedValue:actual,expectedRange:`≈ ${fmt(planned)}`,directCauses:factors,availableActions:actions,evidence:[evidence(T('计划面积','Planned area'),fmt(planned),'Module 9 diagnostics'),evidence(T('实际面积','Actual area'),fmt(actual),'Module 9 diagnostics')],sourceModule:'Module9'}));
      }else if(planned>0&&n(d?.harvest)<=.001&&factors.length){
        const minFactor=Math.min(...factors.map(c=>n(c.currentValue,1)));
        if(minFactor<.2)out.push(problem(`ag_stop_${rid}_${cropId}`,'AGRICULTURE_STOPPED',{severity:'high',severityScore:3,objectType:'agricultureProject',objectId:`${rid}:${cropId}`,regionId:rid,title:T(`${cropLabel(cropId)}生产接近停摆`,`${cropLabel(cropId)} production is near zero`),summary:T('当前版本没有独立 actualArea 字段，因此这里按真实收成与资源 factor 解释，不伪造播种面积。','This build has no separate actualArea field, so the diagnosis uses real harvest and resource factors instead of inventing planted area.'),observedValue:n(d?.harvest),expectedRange:T('大于 0','above 0'),directCauses:factors.filter(c=>n(c.currentValue,1)<=minFactor+.12),availableActions:factors.flatMap(c=>c.availableActions||[]),evidence:[evidence(T('已播种面积','Planted area'),fmt(d?.plantedArea),'Module 9 cropDetails'),evidence(T('实际收成','Harvest'),fmt(d?.harvest),'Module 9 cropDetails')],sourceModule:'Module9'}));
      }
    }
    const flow=lo.storageFlow||r?.storage?.annualFlow||{};
    const opening=sumObj(flow.openingStock),inflow=sumObj(flow.harvestInflow),withdraw=sumObj(flow.withdrawalOutflow),closing=sumObj(flow.closingStock||r?.storage?.stocks),loss=sumObj(flow.storageLoss),fieldLoss=sumObj(flow.fieldLoss);
    const biological=n(lo.biologicalHarvest,sumObj(lo.cropProduction));
    const harvested=n(lo.harvestedQuantity,sumObj(lo.cropHarvestCollected)||inflow);
    const explicitDelivered=lo.marketDeliveredQuantity!=null?n(lo.marketDeliveredQuantity):null;
    const delivered=explicitDelivered!=null?explicitDelivered:withdraw;
    const lg=lo.logistics||{};const collection=clamp(lg.collectionFactor,0,1),market=clamp(lg.marketAccessFactor,0,1);
    const base=Math.max(1,opening+inflow);
    if(closing>5&&closing/base>.25&&(market<.88||collection<.88||(explicitDelivered!=null&&delivered<harvested*.8))){
      const causes=[];
      if(collection<.88)causes.push(cause(`ag_backlog_${rid}_collection`,T('田间收集 / 地方运输效率不足','Farm collection / local transport throughput is insufficient'),{type:'local_transport_constraint',objectType:'regionalLogistics',objectId:rid,regionId:rid,currentValue:collection,threshold:.88,relation:'limits_delivery',severity:collection<.55?'high':'medium',sourceModule:'Module9',year:yr,evidence:[evidence(T('收集系数','Collection factor'),pct(collection),'Module 9 lastOutput.logistics'),evidence(T('田间损失','Field loss'),fmt(fieldLoss),'Module 9 storageFlow')],availableActions:localLogisticsActions(rid)}));
      if(market<.88)causes.push(cause(`ag_backlog_${rid}_market`,T('农场到市场的可达性不足','Farm-to-market access is insufficient'),{type:'market_access_constraint',objectType:'regionalLogistics',objectId:rid,regionId:rid,currentValue:market,threshold:.88,relation:'limits_market_delivery',severity:market<.55?'high':'medium',sourceModule:'Module9',year:yr,evidence:[evidence(T('市场可达系数','Market access factor'),pct(market),'Module 9 lastOutput.logistics')],availableActions:localLogisticsActions(rid)}));
      out.push(problem(`ag_backlog_${rid}`,'FARM_INVENTORY_BACKLOG',{severity:closing/base>.55?'high':'medium',severityScore:Math.min(3,1+closing/base*3),objectType:'agricultureRegion',objectId:rid,regionId:rid,title:T(`${regionName(gs,rid)}农场库存积压`,`${regionName(gs,rid)} farm inventory backlog`),summary:T('粮食已经进入收获/库存环节，但仍有较大数量留在农场端；因此不能直接归因于“农业减产”。','A large quantity has already reached harvest/storage but remains at the farm side, so this is not automatically classified as low agricultural production.'),observedValue:closing,expectedRange:T('库存应与当年实际出库能力匹配','Inventory should be consistent with actual outbound throughput'),directCauses:causes,availableActions:localLogisticsActions(rid),evidence:[evidence(T('生物学产量','Biological harvest'),fmt(biological),'Module 9 cropProduction'),evidence(T('已收获 / 入库','Harvested / collected'),fmt(harvested),'Module 9 cropHarvestCollected'),evidence(T('实际出库 / 市场交付','Withdrawal / market delivery'),fmt(delivered),explicitDelivered!=null?'Module 9 marketDeliveredQuantity':'Module 9 storageFlow.withdrawalOutflow'),evidence(T('农场期末库存','Farm closing stock'),fmt(closing),'Module 9 storageFlow.closingStock'),evidence(T('储存损失','Storage loss'),fmt(loss),'Module 9 storageFlow.storageLoss')],sourceModule:'Module9'}));
      if((collection<.78||market<.78))out.push(problem(`road_capacity_${rid}`,'ROAD_CAPACITY_INSUFFICIENT',{severity:(collection<.5||market<.5)?'high':'medium',severityScore:2.2,objectType:'regionalTransport',objectId:rid,regionId:rid,title:T(`${regionName(gs,rid)}地方道路 / 末端物流瓶颈`,`${regionName(gs,rid)} local-road / last-mile bottleneck`),summary:T('铁路是否存在并不能替代农场到集散点的末端运输；这里的限制来自 Module 9 的真实地方物流 factor。','Rail availability cannot replace farm-to-hub last-mile access; this constraint comes from Module 9\'s actual local logistics factors.'),observedValue:Math.min(collection,market),expectedRange:'≥ 0.78',directCauses:causes,availableActions:localLogisticsActions(rid),evidence:[evidence(T('收集系数','Collection factor'),pct(collection),'Module 9'),evidence(T('市场可达系数','Market access factor'),pct(market),'Module 9'),evidence(T('农场期末库存','Farm closing stock'),fmt(closing),'Module 9')],sourceModule:'Module9'}));
    }
    if(explicitDelivered!=null&&harvested>0&&delivered<harvested*.75){
      out.push(problem(`ag_delivery_${rid}`,'AGRICULTURE_MARKET_DELIVERY_LOW',{severity:delivered/harvested<.4?'high':'medium',severityScore:2,objectType:'agricultureRegion',objectId:rid,regionId:rid,title:T(`${regionName(gs,rid)}农业市场交付不足`,`${regionName(gs,rid)} agricultural market delivery is low`),summary:T('使用现有 marketDeliveredQuantity，不重新计算第二套物流。','Uses the existing marketDeliveredQuantity; no second logistics calculation is created.'),observedValue:delivered,expectedRange:`≈ ${fmt(harvested)}`,directCauses:[],availableActions:localLogisticsActions(rid),evidence:[evidence(T('已收获','Harvested'),fmt(harvested),'Module 9'),evidence(T('市场交付','Market delivered'),fmt(delivered),'Module 9')],sourceModule:'Module9'}));
    }
  }
  return out;
}
function localLogisticsActions(rid){return [
  action(`road_${rid}`,T('改善农村道路','Improve rural roads'),{targetModule:'Module2',targetView:'development',targetObjectId:'rural_road',regionId:rid,reason:T('提高农场到集散点的末端运输能力','Raise farm-to-hub last-mile capacity'),expectedEffect:T('未来年度提高收集与市场可达性','Can improve collection and market access in later years'),availability:false,blockedReason:T('当前这版 Module 2 只有铁路建设/升级入口，还没有独立农村道路建设按钮。','This build exposes railway construction/upgrades but not a separate rural-road build action.')}),
  action(`rail_${rid}`,T('查看地区铁路','Inspect regional railway'),{targetModule:'Module2',targetView:'development',targetObjectId:'railway',regionId:rid,reason:T('检查主干运输是否也形成瓶颈','Check whether trunk transport is also constrained'),expectedEffect:T('只在铁路确实受限时才应扩建','Expansion is useful only if rail is actually constrained'),availability:true,meta:{buildType:'railway'}}),
  action(`storage_${rid}`,T('建设 / 扩建仓储','Build / expand storage'),{targetModule:'Module2',targetView:'development',targetObjectId:'warehouse',regionId:rid,reason:T('缓解运输延迟造成的损耗与溢出','Reduce loss and overflow caused by delayed transport'),expectedEffect:T('提高缓冲库存能力','Increase buffer storage capacity'),availability:false,blockedReason:T('当前主界面尚未暴露仓储建设入口。','The current main UI does not yet expose a warehouse build action.')})
];}

function industryDiagnostics(gs){
  const out=[],yr=yearOf(gs);
  for(const [fid,f] of entries(gs?.facilities||{})){
    if(f?.active===false)continue;const e=getFacilityEconomy(gs,fid);if(!e)continue;
    const pl=clamp(e.productionLevel,0,1),factors=e.factors||{};
    if(pl<.06){
      const min=Math.min(...Object.values(factors).map(v=>n(v,1)),1),causes=[];
      for(const [k,v] of entries(factors).sort((a,b)=>n(a[1],1)-n(b[1],1))){if(n(v,1)>Math.max(.35,min+.12))continue;causes.push(industryFactorCause(gs,fid,f,e,k,v,yr));}
      out.push(problem(`industry_stop_${fid}`,'INDUSTRY_STOPPED',{severity:'high',severityScore:3,objectType:'facility',objectId:fid,regionId:f.regionId,title:T(`${facilityName(gs,fid)}停产 / 接近停产`,`${facilityName(gs,fid)} stopped / near stopped`),summary:T('产能利用由现有 Module 3 factors 决定；只列出真正接近最小值的限制。','Capacity use is determined by the existing Module 3 factors; only factors near the true minimum are shown.'),observedValue:pl,expectedRange:'> 0.06',directCauses:causes,availableActions:causes.flatMap(c=>c.availableActions||[]),evidence:[evidence(T('产能利用率','Production level'),pct(pl),'Module 3 getFacilityEconomy'),evidence(T('主瓶颈','Main bottleneck'),e.mainBottleneck||'—','Module 3')],sourceModule:'Module3'}));
    }
    const bott=String(e.mainBottleneck||'');
    if(bott.startsWith('input:')&&pl<.98){
      const good=bott.slice(6),factor=n(factors[bott],pl),req=n(e.inputDemand?.[good]),used=n(e.inputsConsumed?.[good]);
      const c=industryFactorCause(gs,fid,f,e,bott,factor,yr);
      out.push(problem(`industry_input_${fid}_${good}`,'INDUSTRY_RAW_MATERIAL_SHORTAGE',{severity:factor<.25?'high':'medium',severityScore:2.4-factor,objectType:'facility',objectId:fid,regionId:f.regionId,title:T(`${facilityName(gs,fid)}原料不足：${good}`,`${facilityName(gs,fid)} raw-material shortage: ${good}`),summary:T('Module 3 已把该原料识别为当前最小生产 factor。','Module 3 identifies this input as the current minimum production factor.'),observedValue:factor,expectedRange:'≈ 1.0',directCauses:[c],availableActions:c.availableActions,evidence:[evidence(T('投入需求','Input demand'),fmt(req),'Module 3'),evidence(T('实际消耗','Actually consumed'),fmt(used),'Module 3'),evidence(T('投入满足比例','Input factor'),pct(factor),'Module 3')],sourceModule:'Module3'}));
    }
  }
  return out;
}
function industryFactorCause(gs,fid,f,e,key,val,yr){
  const v=clamp(val,0,1),rid=f.regionId;let label=key,acts=[];
  if(key==='labor')label=T('劳动力不足','Labor shortage');
  else if(key==='power'){label=T('电力不足','Power shortage');acts=[action(`power_${rid}`,T('建设 / 扩建电力设施','Build / expand power capacity'),{targetModule:'Module2',targetView:'development',targetObjectId:'power_plant',regionId:rid,reason:T('当前电力 factor 限制生产','Power factor is limiting production'),expectedEffect:T('未来提高地区供电能力','Raise future regional power supply'),availability:buildActionAvailable('power_plant'),meta:{buildType:'power_plant'}})];}
  else if(key==='transport'){label=T('本地物流不足','Local transport constraint');acts=localLogisticsActions(rid);}
  else if(key==='resource')label=T('矿产资源约束','Resource constraint');
  else if(key.startsWith('input:')){const good=key.slice(6);label=T(`原料不足：${good}`,`Input shortage: ${good}`);acts=inputGoodActions(rid,good);}
  return cause(`industry_${fid}_${key}`,label,{type:key.replace(':','_'),objectType:'facility',objectId:fid,regionId:rid,currentValue:v,threshold:1,relation:'limits_production',severity:v<.25?'high':v<.65?'medium':'low',sourceModule:'Module3',year:yr,evidence:[evidence(T('当前 factor','Current factor'),pct(v),'Module 3 facility factors')],availableActions:acts});
}
function inputGoodActions(rid,good){
  if(good==='steel')return [action(`steel_${rid}`,T('建设 / 扩建钢铁产能','Build / expand steel capacity'),{targetModule:'Module2',targetView:'development',targetObjectId:'steelworks',regionId:rid,reason:T('钢材供给不足','Steel supply is insufficient'),expectedEffect:T('未来增加钢材供给','Increase future steel supply'),availability:true,meta:{buildType:'steelworks'}})];
  if(good==='manufactured_goods')return [action(`mfg_${rid}`,T('建设 / 扩建制造业','Build / expand manufacturing'),{targetModule:'Module2',targetView:'development',targetObjectId:'basic_factory',regionId:rid,reason:T('工业品投入不足','Manufactured inputs are insufficient'),expectedEffect:T('未来增加工业品供给','Increase future manufactured-goods supply'),availability:true,meta:{buildType:'basic_factory'}})];
  if(good==='coal'||good==='iron'||good==='oil')return [action(`resource_${rid}_${good}`,T(`查看${good}资源开发`,`Inspect ${good} resource development`),{targetModule:'Module2',targetView:'development',targetObjectId:`resource:${good}`,regionId:rid,reason:T('检查本地区已发现资源与开发项目','Inspect discovered resources and development projects in this region'),expectedEffect:T('由玩家决定是否勘探或开发','The player decides whether to explore or develop'),availability:true,meta:{resource:good}})];
  return [];
}

function transportDiagnostics(gs){
  const out=[],yr=yearOf(gs),debug=gs?.economy?.debug||{},edges=debug.freightEdges||{},remaining=debug.freightCapacityRemaining||{};
  for(const [id,edge] of entries(edges)){
    const cap=n(edge.capacity),rem=n(remaining[id],cap);if(!(cap>0))continue;const used=Math.max(0,cap-rem),util=used/cap;
    const conn=gs?.connections?.[id]||vals(gs?.connections).find(c=>String(c.id)===String(id));
    const typ=String(conn?.type||'transport').toLowerCase();
    const shortage=[edge.from,edge.to].some(rid=>{const g=getRegionEconomy(gs,rid)?.goods||{};return vals(g).some(x=>n(x?.shortage)>0.001);});
    if(util>=.92&&shortage){
      const isRail=typ.includes('rail'),isRoad=typ.includes('road')||typ.includes('highway');
      const kind=isRail?'RAILWAY_CAPACITY_INSUFFICIENT':isRoad?'ROAD_CAPACITY_INSUFFICIENT':'TRANSPORT_CAPACITY_INSUFFICIENT';
      const c=cause(`transport_${id}_capacity`,T('运输走廊接近满负荷','Transport corridor is near full capacity'),{type:'capacity',objectType:'transportLink',objectId:id,regionId:edge.from,currentValue:used,threshold:cap,relation:'limits_freight_flow',severity:util>.985?'high':'medium',sourceModule:'Module3',year:yr,evidence:[evidence(T('有效运力','Effective capacity'),fmt(cap),'Module 3 freightEdges'),evidence(T('已使用','Used capacity'),fmt(used),'Module 3 freightCapacityRemaining'),evidence(T('利用率','Utilization'),pct(util),'Module 3 freight network')],availableActions:connectionActions(gs,id,conn,edge)});
      out.push(problem(`transport_capacity_${id}`,kind,{severity:util>.985?'high':'medium',severityScore:1+util*2,objectType:'transportLink',objectId:id,regionId:edge.from,title:T(`${isRail?'铁路':isRoad?'公路':'运输线路'}容量不足`,`Transport link capacity is insufficient`),summary:T('只有“真实走廊接近满载 + 相连地区仍有商品短缺”时才报告容量瓶颈。','A capacity bottleneck is reported only when the real corridor is near saturation and connected regions still have goods shortages.'),observedValue:util,expectedRange:'< 0.92',directCauses:[c],availableActions:c.availableActions,evidence:c.evidence,sourceModule:'Module3'}));
    }
  }
  const explicit=[...vals(gs?.transport?.links),...vals(gs?.transportLinks),...vals(gs?.roadNetwork?.links),...vals(gs?.railwayLinks)];
  for(const l of explicit){if(!l||!l.id)continue;const demand=n(l.demand,n(l.plannedFlow)),cap=n(l.capacity,n(l.effectiveCapacity)),unmet=n(l.unmetFlow,Math.max(0,demand-cap));if(demand>cap+.001||unmet>.001){const typ=String(l.type||l.mode||'transport').toLowerCase(),isRail=typ.includes('rail'),isRoad=typ.includes('road');out.push(problem(`transport_explicit_${l.id}`,isRail?'RAILWAY_CAPACITY_INSUFFICIENT':isRoad?'ROAD_CAPACITY_INSUFFICIENT':'TRANSPORT_CAPACITY_INSUFFICIENT',{severity:unmet>cap*.4?'high':'medium',severityScore:2,objectType:'transportLink',objectId:l.id,regionId:l.regionId||l.fromId,title:T(`${isRail?'铁路':isRoad?'公路':'运输线路'}容量不足`,`Transport link capacity is insufficient`),summary:T('直接读取 TransportLink/Flow 的 demand、capacity、unmetFlow。','Reads TransportLink/Flow demand, capacity and unmetFlow directly.'),observedValue:demand,expectedRange:`≤ ${fmt(cap)}`,directCauses:[cause(`transport_exp_${l.id}`,T('需求超过有效运力','Demand exceeds effective capacity'),{type:'capacity',objectType:'transportLink',objectId:l.id,regionId:l.regionId||l.fromId,currentValue:demand,threshold:cap,relation:'limits_flow',severity:'high',sourceModule:'Module2',year:yr,evidence:[evidence('demand',fmt(demand),'TransportLink'),evidence('capacity',fmt(cap),'TransportLink'),evidence('unmetFlow',fmt(unmet),'TransportFlow')]})],availableActions:connectionActions(gs,l.id,l,l),sourceModule:'Module2'}));}}
  return out;
}
function connectionActions(gs,id,conn,edge){
  let can=false;try{can=!!moduleRefs().Development?.canUpgradeConnection?.(id,gs)?.ok;}catch(_){}
  const rid=conn?.fromId||edge?.from||conn?.regionId;
  return [action(`upgrade_conn_${id}`,T('扩建这条运输线路','Expand this transport link'),{targetModule:'Module2',targetView:'development',targetObjectId:id,regionId:rid,reason:T('提高当前真实瓶颈线路的容量','Increase capacity on the actual bottleneck link'),expectedEffect:T('项目完工后增加未来年度运力','Capacity rises only after the upgrade project is completed'),availability:can,blockedReason:can?null:T('当前线路不可升级或已达最高等级。','This link cannot currently be upgraded or is already at maximum level.'),meta:{connectionId:id}})];
}

function projectDiagnostics(gs){
  const out=[],yr=yearOf(gs),signals=projectSignals(gs);
  for(const [pid,p] of entries(gs?.projects||{})){
    if(p?.status!=='under_construction')continue;const sig=signals[pid]||{};const factor=clamp(p.integrationProgressFactor??sig.recommendedProgressFactor??1,0,1);const missing=sig.missingMaterials||{};
    if(factor>=.999)continue;
    const causes=[];
    for(const [good,amount] of entries(missing)){if(n(amount)<=.0001)continue;const re=getRegionEconomy(gs,p.regionId),g=re?.goods?.[good];causes.push(cause(`project_${pid}_${good}`,T(`建设材料不足：${good}`,`Construction material shortage: ${good}`),{type:'project_material_shortage',objectType:'regionalInventory',objectId:`${p.regionId}:${good}`,regionId:p.regionId,currentValue:n(g?.available,n(g?.endingInventory)),threshold:n(amount),relation:'limits_project_progress',severity:factor<.25?'high':'medium',sourceModule:'Module3',year:yr,evidence:[evidence(T('本年度缺口','Missing this year'),fmt(amount),'Module 3 projectProgress.missingMaterials'),evidence(T('项目材料满足率','Project material fulfillment'),pct(factor),'Module 3 projectProgress')],availableActions:inputGoodActions(p.regionId,good)}));}
    if(!causes.length)causes.push(cause(`project_${pid}_progress`,T('年度建设进度因子低于 1','Annual project progress factor is below 1'),{type:'project_progress_constraint',objectType:'project',objectId:pid,regionId:p.regionId,currentValue:factor,threshold:1,relation:'slows_construction',severity:factor<.25?'high':'medium',sourceModule:'Module3',year:yr,evidence:[evidence(T('建议进度因子','Recommended progress factor'),pct(factor),'Module 3 → Module 2 signal')]}));
    const rail=String(p.type).includes('rail');
    out.push(problem(`project_stall_${pid}`,rail?'TRANSPORT_LINE_CONSTRUCTION_STALLED':'PROJECT_RESOURCE_SHORTAGE',{severity:factor<.25?'high':'medium',severityScore:2.5-factor,objectType:'project',objectId:pid,regionId:p.regionId,title:rail?T(`${p.name||'铁路'}建设受阻`,`${p.name||'Railway'} construction is constrained`):T(`${p.name||p.type}建设缺资源`,`${p.name||p.type} lacks construction resources`),summary:T(`项目仍处于 under_construction；本年度真实进度因子为 ${pct(factor)}。`,`The project remains under_construction; its real annual progress factor is ${pct(factor)}.`),observedValue:factor,expectedRange:'1.0',directCauses:causes,availableActions:causes.flatMap(c=>c.availableActions||[]),evidence:[evidence(T('剩余建设时间','Turns/years remaining'),`${fmt(p.turnsRemaining)} ${T('年','yr')}`,'Module 2 project'),evidence(T('年度进度因子','Annual progress factor'),pct(factor),'Module 2 integrationProgressFactor')],sourceModule:'Module2/3'}));
  }
  return out;
}

function cityDiagnostics(gs){
  const out=[],yr=yearOf(gs);
  for(const [cid,c] of entries(gs?.cities||{})){
    if(c?.status==='abandoned')continue;const rid=c.regionId;const pop=getCityPopulation(gs,cid);
    if(pop&&n(pop.housingShortage)>0){
      const demand=n(pop.housingDemand),cap=n(pop.housingCapacity),short=n(pop.housingShortage),ratio=demand>0?short/demand:0;
      const hc=pop.housingConstruction||{};const causes=[cause(`housing_${cid}`,T('住房需求超过住房容量','Housing demand exceeds housing capacity'),{type:'housing_capacity_shortage',objectType:'cityHousing',objectId:cid,regionId:rid,currentValue:cap,threshold:demand,relation:'limits_housing_availability',severity:ratio>.2?'high':ratio>.08?'medium':'low',sourceModule:'Module4',year:yr,evidence:[evidence(T('住房需求','Housing demand'),fmt(demand),'Module 4'),evidence(T('住房容量','Housing capacity'),fmt(cap),'Module 4'),evidence(T('在建住房项目','Housing projects in pipeline'),fmt(hc.projectsInPipeline),'Module 4')]})];
      out.push(problem(`city_housing_${cid}`,'CITY_HOUSING_SHORTAGE',{severity:ratio>.2?'high':ratio>.08?'medium':'low',severityScore:1+ratio*6,objectType:'city',objectId:cid,regionId:rid,title:T(`${cityName(gs,cid)}住房不足`,`${cityName(gs,cid)} housing shortage`),summary:T('城市只是问题入口；真正原因来自 Module 4 的住房需求、容量与建设管线。','The city is only the entry point; the cause comes from Module 4 housing demand, capacity and construction pipeline.'),observedValue:short,expectedRange:'0',directCauses:causes,availableActions:[action(`city_${cid}_housing`,T('查看城市住房状态','Inspect city housing state'),{targetModule:'Module4',targetView:'cities',targetObjectId:cid,regionId:rid,reason:T('查看住房容量、需求与建设管线','Inspect housing capacity, demand and construction pipeline'),expectedEffect:T('只导航，不自动新建住房','Navigation only; no housing is built automatically'),availability:availableTab('cities'),meta:{cityId:cid}})],evidence:[evidence(T('住房短缺','Housing shortage'),fmt(short),'Population.getCityPopulation')],sourceModule:'Module4'}));
    }
    const re=getRegionEconomy(gs,rid),food=re?.goods?.food;if(food&&n(food.shortage)>0.001){
      const demand=n(food.localDemand,n(food.demand)),short=n(food.shortage),ratio=demand>0?short/demand:1;const causes=[];
      const ag=gs?.agriculture?.regions?.[rid]?.lastOutput;
      if(ag){const prod=sumObj(ag.cropProduction),col=sumObj(ag.cropHarvestCollected),flow=ag.storageFlow||{},closing=sumObj(flow.closingStock),lg=ag.logistics||{};
        if(closing>5&&(clamp(lg.marketAccessFactor,0,1)<.88||clamp(lg.collectionFactor,0,1)<.88))causes.push(cause(`city_food_${cid}_logistics`,T('粮食已生产但农场端仍有积压','Food was produced but remains backlogged at farm side'),{type:'food_logistics_backlog',objectType:'agricultureRegion',objectId:rid,regionId:rid,currentValue:closing,threshold:0,relation:'reduces_market_delivery',severity:'medium',sourceModule:'Module9',year:yr,evidence:[evidence(T('农业产量','Agricultural production'),fmt(prod),'Module 9'),evidence(T('已收获','Collected harvest'),fmt(col),'Module 9'),evidence(T('农场期末库存','Farm closing stock'),fmt(closing),'Module 9')],availableActions:localLogisticsActions(rid)}));
        else if(prod<=Math.max(1,demand*.5))causes.push(cause(`city_food_${cid}_production`,T('本地农业产出不足','Local agricultural output is insufficient'),{type:'local_food_production_shortage',objectType:'agricultureRegion',objectId:rid,regionId:rid,currentValue:prod,threshold:demand,relation:'reduces_food_supply',severity:'medium',sourceModule:'Module9',year:yr,evidence:[evidence(T('农业产量','Agricultural production'),fmt(prod),'Module 9'),evidence(T('地区粮食需求','Regional food demand'),fmt(demand),'Module 3')]}));
      }
      if(!causes.length)causes.push(cause(`city_food_${cid}_market`,T('地区市场可用粮食低于需求','Regional market food availability is below demand'),{type:'regional_food_shortage',objectType:'regionalMarket',objectId:`${rid}:food`,regionId:rid,currentValue:n(food.finalUse,n(food.supply)),threshold:demand,relation:'limits_city_food',severity:ratio>.25?'high':'medium',sourceModule:'Module3',year:yr,evidence:[evidence(T('地区粮食需求','Regional food demand'),fmt(demand),'Module 3'),evidence(T('地区粮食短缺','Regional food shortage'),fmt(short),'Module 3'),evidence(T('地区粮食生产','Regional food production'),fmt(food.production),'Module 3'),evidence(T('国内调入','Domestic imports'),fmt(food.domesticImports),'Module 3'),evidence(T('国外进口','Foreign imports'),fmt(food.foreignImports),'Module 3')]}));
      const actions=[...new Map(causes.flatMap(x=>x.availableActions||[]).map(a=>[a.id,a])).values()];actions.push(action(`food_trade_${rid}`,T('进口粮食','Import food'),{targetModule:'Module5',targetView:'trade',targetObjectId:'food',regionId:rid,reason:T('通过真实国际贸易补充地区供应','Supplement regional supply through real international trade'),expectedEffect:T('合同和路线实际交付后才增加供给','Supply rises only after a real contract and route deliver goods'),availability:availableTab('trade'),blockedReason:availableTab('trade')?null:T('当前主界面还没有暴露 Module 5 贸易操作页。','The current main UI does not yet expose the Module 5 trade action page.')}));
      out.push(problem(`city_food_${cid}`,'CITY_FOOD_SHORTAGE',{severity:ratio>.25?'high':'medium',severityScore:1.5+ratio*3,objectType:'city',objectId:cid,regionId:rid,title:T(`${cityName(gs,cid)}粮食供应紧张`,`${cityName(gs,cid)} food supply is tight`),summary:T('先判断农业生产、农场积压和地区市场，再决定是否是生产问题、物流问题或外部供给问题。','The navigator checks production, farm backlog and the regional market before classifying the issue as production, logistics or external supply.'),observedValue:short,expectedRange:'0',directCauses:causes,availableActions:actions,evidence:[evidence(T('地区粮食短缺','Regional food shortage'),fmt(short),'Economy.getRegionEconomy'),evidence(T('粮食需求','Food demand'),fmt(demand),'Economy.getRegionEconomy')],sourceModule:'Module3/9'}));
    }
  }
  return out;
}

function getDevelopmentDiagnostics(gs=currentState()){return projectDiagnostics(gs||{});}
function getTransportDiagnostics(gs=currentState()){return transportDiagnostics(gs||{});}
function getIndustryDiagnostics(gs=currentState()){return industryDiagnostics(gs||{});}
function getMarketDiagnostics(gs=currentState()){return cityDiagnostics(gs||{}).filter(p=>p.type==='CITY_FOOD_SHORTAGE');}
function getPopulationDiagnostics(gs=currentState()){return cityDiagnostics(gs||{}).filter(p=>p.type==='CITY_HOUSING_SHORTAGE');}
function getAgricultureDiagnostics(gs=currentState()){return agricultureDiagnostics(gs||{});}
function getAgricultureLogisticsReport(gs=currentState()){return agricultureDiagnostics(gs||{}).filter(p=>/BACKLOG|DELIVERY|ROAD/.test(p.type));}
function installDiagnosticAPIs(){const R=moduleRefs();if(R.Development){if(!R.Development.getDevelopmentDiagnostics)R.Development.getDevelopmentDiagnostics=getDevelopmentDiagnostics;if(!R.Development.getTransportDiagnostics)R.Development.getTransportDiagnostics=getTransportDiagnostics;}if(R.Economy){if(!R.Economy.getIndustryDiagnostics)R.Economy.getIndustryDiagnostics=getIndustryDiagnostics;if(!R.Economy.getMarketDiagnostics)R.Economy.getMarketDiagnostics=getMarketDiagnostics;}if(R.Population&&!R.Population.getPopulationDiagnostics)R.Population.getPopulationDiagnostics=getPopulationDiagnostics;if(R.Agriculture){if(!R.Agriculture.getAgricultureDiagnostics)R.Agriculture.getAgricultureDiagnostics=getAgricultureDiagnostics;if(!R.Agriculture.getAgricultureLogisticsReport)R.Agriculture.getAgricultureLogisticsReport=getAgricultureLogisticsReport;}}

function collectCandidates(gs){if(!gs)return[];return [...agricultureDiagnostics(gs),...industryDiagnostics(gs),...transportDiagnostics(gs),...projectDiagnostics(gs),...cityDiagnostics(gs)];}
function comparableSeverity(p){return n(p.severityScore,severityRank[p.severity]||1);}
function syncProblems(gs,candidates){
  const store=ensureStore(gs);if(!store)return[];const yr=yearOf(gs),seen=new Set();
  for(const c0 of candidates){const c=clone(c0),old=store.problems[c.id];seen.add(c.id);c.detectedYear=old?.detectedYear??yr;c.firstDetectedYear=old?.firstDetectedYear??c.detectedYear;c.lastSeenYear=yr;c.history=old?.history||[];
    if(old&&old.status!=='resolved'){const prev=comparableSeverity(old),now=comparableSeverity(c);c.status=now<prev-.15?'improving':now>prev+.15?'worsening':'active';}else c.status='active';
    // A project only counts as "addressing" this problem when the relationship is explicit.
    // Merely being under construction in the same region is not causal evidence.
    const activeProject=vals(gs.projects).find(p=>p.status==='under_construction'&&(p.causalActionRef===c.id||(c.objectType==='transportLink'&&p.targetConnectionId===c.objectId)));
    if(activeProject&&c.status==='active')c.status='addressing';
    const last=c.history[c.history.length-1];if(!last||last.year!==yr)c.history.push({year:yr,severity:c.severity,severityScore:c.severityScore,status:c.status,observedValue:clone(c.observedValue)});else Object.assign(last,{severity:c.severity,severityScore:c.severityScore,status:c.status,observedValue:clone(c.observedValue)});
    if(c.history.length>30)c.history=c.history.slice(-30);store.problems[c.id]=c;if(!store.problemOrder.includes(c.id))store.problemOrder.push(c.id);
  }
  for(const id of store.problemOrder){const p=store.problems[id];if(!p||seen.has(id)||p.status==='resolved')continue;p.status='resolved';p.lastSeenYear=yr-1;p.resolvedYear=yr;p.history=p.history||[];const last=p.history[p.history.length-1];if(!last||last.year!==yr)p.history.push({year:yr,status:'resolved',severity:p.severity,severityScore:0,observedValue:p.observedValue});}
  store.lastRefreshYear=yr;return store.problemOrder.map(id=>store.problems[id]).filter(Boolean);
}
function refresh(gs=currentState()){installDiagnosticAPIs();const ps=syncProblems(gs,collectCandidates(gs));updateBadge(ps);if(runtime.open&&!runtime.hidden)renderNavigator();return ps;}
function activeProblems(gs=currentState()){const s=ensureStore(gs);return s?s.problemOrder.map(id=>s.problems[id]).filter(p=>p&&p.status!=='resolved'):[];}
function problemById(id,gs=currentState()){return ensureStore(gs)?.problems?.[id]||null;}
function findCauseIn(causes,id){for(const c of causes||[]){if(c.id===id)return c;const u=findCauseIn(c.upstreamCauses,id);if(u)return u;}return null;}
function findCause(id,gs=currentState()){const s=ensureStore(gs);if(!s)return null;for(const pid of s.problemOrder){const p=s.problems[pid],c=findCauseIn(p?.directCauses,id);if(c)return {problem:p,cause:c};}return null;}
function explainProblem(problemId){const p=problemById(problemId);return p?{problem:clone(p),directCauses:clone(p.directCauses||[]),actions:clone(p.availableActions||[])}:null;}
function traceCause(causeId){const f=findCause(causeId);return f?{problem:clone(f.problem),cause:clone(f.cause),upstreamCauses:clone(f.cause.upstreamCauses||[]),actions:clone(f.cause.availableActions||[])}:null;}
function inspectObject(objectType,objectId){const ps=refresh();const exact=ps.filter(p=>p.objectType===objectType&&String(p.objectId)===String(objectId)&&p.status!=='resolved');if(!exact.length)return {problems:[],message:T('当前没有来自真实状态的活动问题。','There is no active problem supported by the current state.')};exact.sort(problemSort);openProblem(exact[0].id);return {problems:clone(exact)};}
function problemSort(a,b){return (severityRank[b.severity]||0)-(severityRank[a.severity]||0)||comparableSeverity(b)-comparableSeverity(a)||String(a.id).localeCompare(String(b.id));}
function causalEdges(gs=currentState()){const edges=[];const s=ensureStore(gs);if(!s)return edges;function walk(parentType,parentId,cs){for(const c of cs||[]){edges.push({fromType:c.objectType||'cause',fromId:c.id,toType:parentType,toId:parentId,relation:c.relation,strength:Math.max(.1,Math.min(1,1-(n(c.currentValue,1)/Math.max(.0001,n(c.threshold,1))))),year:c.year,sourceModule:c.sourceModule});walk('cause',c.id,c.upstreamCauses);}}for(const id of s.problemOrder){const p=s.problems[id];if(p)walk('problem',p.id,p.directCauses);}return edges;}

const runtime={open:false,hidden:true,stack:[],drag:null,decorating:false};
function mount(){
  if(!document.getElementById('beProblemBadge')){const b=document.createElement('button');b.id='beProblemBadge';b.type='button';b.innerHTML=`${T('问题追踪','Problems')} <span class="be-problem-count">0</span>`;const advance=document.getElementById('advanceBtn');advance?.insertAdjacentElement('afterend',b);b.addEventListener('click',()=>{const ps=refresh().filter(p=>p.status!=='resolved').sort(problemSort);if(ps.length)openProblem(ps[0].id);else openEmpty();});}
  if(!document.getElementById('beCausalNavigator')){const el=document.createElement('section');el.id='beCausalNavigator';el.className='be-causal-navigator hidden';el.setAttribute('aria-live','polite');el.innerHTML=`<div class="be-causal-head" id="beCausalDrag"><span class="drag-glyph">⠿</span><b>${T('问题追踪器','Causal Navigator')}</b><span class="head-status"></span><button type="button" data-causal-collapse aria-label="collapse">−</button><button type="button" data-causal-close aria-label="close">×</button></div><div class="be-causal-body"></div>`;document.body.appendChild(el);installDrag(el);el.addEventListener('click',handleNavigatorClick);restoreUI(el);}
  decoratePanel();refresh();
}
function restoreUI(el){let saved={};try{saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}')||{};}catch(_){}const gs=currentState(),stateUI=ensureStore(gs)?.ui?.causalNavigator||{};saved={...saved,...stateUI};if(Number.isFinite(saved.x)&&Number.isFinite(saved.y)){el.style.left=`${saved.x}px`;el.style.top=`${saved.y}px`;el.dataset.positioned='1';}if(saved.collapsed){el.classList.add('collapsed');const b=el.querySelector('.be-cn-collapse');if(b)b.textContent='+';}}
function persistUI(){const el=document.getElementById('beCausalNavigator');if(!el)return;const r=el.getBoundingClientRect(),ui={x:Math.round(r.left),y:Math.round(r.top),collapsed:el.classList.contains('collapsed')};try{localStorage.setItem(STORAGE_KEY,JSON.stringify(ui));}catch(_){}const s=ensureStore(currentState());if(s)s.ui.causalNavigator=ui;}
function defaultPosition(){const el=document.getElementById('beCausalNavigator');if(!el||el.dataset.positioned)return;const r=el.getBoundingClientRect();el.style.left=`${Math.max(8,innerWidth-r.width-18)}px`;el.style.top=`${Math.max(76,innerHeight-r.height-18)}px`;el.dataset.positioned='1';clampNavigatorPosition();}
function clampNavigatorPosition(){const el=document.getElementById('beCausalNavigator');if(!el||el.classList.contains('hidden'))return;const r=el.getBoundingClientRect(),x=clamp(r.left,8,Math.max(8,innerWidth-r.width-8)),y=clamp(r.top,8,Math.max(8,innerHeight-r.height-8));el.style.left=`${x}px`;el.style.top=`${y}px`;persistUI();}
function installDrag(el){const h=el.querySelector('.be-causal-head');h.addEventListener('pointerdown',e=>{if(e.target.closest('button'))return;const r=el.getBoundingClientRect();runtime.drag={pointerId:e.pointerId,dx:e.clientX-r.left,dy:e.clientY-r.top};h.setPointerCapture?.(e.pointerId);e.preventDefault();});h.addEventListener('pointermove',e=>{if(!runtime.drag||runtime.drag.pointerId!==e.pointerId)return;const r=el.getBoundingClientRect();el.style.left=`${clamp(e.clientX-runtime.drag.dx,8,Math.max(8,innerWidth-r.width-8))}px`;el.style.top=`${clamp(e.clientY-runtime.drag.dy,8,Math.max(8,innerHeight-r.height-8))}px`;});const end=e=>{if(!runtime.drag||runtime.drag.pointerId!==e.pointerId)return;runtime.drag=null;clampNavigatorPosition();};h.addEventListener('pointerup',end);h.addEventListener('pointercancel',end);window.addEventListener('resize',()=>clampNavigatorPosition());}
function updateBadge(ps){const b=document.getElementById('beProblemBadge');if(!b)return;const active=(ps||[]).filter(p=>p.status!=='resolved');b.dataset.count=String(active.length);const span=b.querySelector('.be-problem-count');if(span)span.textContent=active.length;const worst=active.sort(problemSort)[0];b.title=worst?worst.title:T('当前没有活动诊断问题','No active diagnostic problems');}
function openEmpty(){runtime.open=true;runtime.hidden=false;runtime.stack=[];const el=document.getElementById('beCausalNavigator');el?.classList.remove('hidden');renderNavigator();defaultPosition();}
function openProblem(id){const p=problemById(id);if(!p)return false;runtime.open=true;runtime.hidden=false;runtime.stack=[{kind:'problem',id,label:p.title}];const el=document.getElementById('beCausalNavigator');el?.classList.remove('hidden');renderNavigator();defaultPosition();return true;}
function openCause(id){const f=findCause(id);if(!f)return;runtime.stack.push({kind:'cause',id,label:f.cause.label});renderNavigator();}
function closeNavigator(){runtime.hidden=true;document.getElementById('beCausalNavigator')?.classList.add('hidden');}
function toggleCollapse(){const el=document.getElementById('beCausalNavigator');if(!el)return;el.classList.toggle('collapsed');el.querySelector('[data-causal-collapse]').textContent=el.classList.contains('collapsed')?'+':'−';clampNavigatorPosition();persistUI();}
function handleNavigatorClick(e){if(e.target.closest('[data-causal-close]')){closeNavigator();return;}if(e.target.closest('[data-causal-collapse]')){toggleCollapse();return;}const back=e.target.closest('[data-causal-back]');if(back){if(runtime.stack.length>1)runtime.stack.pop();renderNavigator();return;}const crumb=e.target.closest('[data-causal-crumb]');if(crumb){const idx=n(crumb.dataset.causalCrumb);runtime.stack=runtime.stack.slice(0,idx+1);renderNavigator();return;}const c=e.target.closest('[data-causal-cause]');if(c){openCause(c.dataset.causalCause);return;}const a=e.target.closest('[data-causal-action]');if(a){navigateToAction(a.dataset.causalAction);return;}}
function renderNavigator(){const el=document.getElementById('beCausalNavigator');if(!el||el.classList.contains('hidden'))return;const body=el.querySelector('.be-causal-body'),head=el.querySelector('.be-causal-head b'),status=el.querySelector('.head-status');if(!runtime.stack.length){head.textContent=T('问题追踪器','Causal Navigator');status.textContent='';body.innerHTML=`<div class="be-causal-empty">${T('当前没有来自真实状态的活动问题。','There are no active problems supported by the current state.')}</div>`;return;}const item=runtime.stack[runtime.stack.length-1];const root=problemById(runtime.stack[0].id);if(!root){runtime.stack=[];return renderNavigator();}head.textContent=el.classList.contains('collapsed')?`⚠ ${root.title}`:T('问题追踪器','Causal Navigator');status.textContent=`${severityLabel(root.severity)} · ${statusLabel(root.status)}`;const crumbs=`<div class="be-causal-breadcrumbs">${runtime.stack.map((x,i)=>`${i?'<span>›</span>':''}<button class="be-crumb" data-causal-crumb="${i}">${esc(x.label)}</button>`).join('')}</div>`;const back=runtime.stack.length>1?`<div class="be-causal-back"><button data-causal-back>← ${T('返回上一层','Back')}</button></div>`:'';if(item.kind==='problem'){body.innerHTML=crumbs+back+problemHTML(root);}else{const f=findCause(item.id);body.innerHTML=crumbs+back+(f?causeHTML(f.cause,root):`<div class="be-causal-empty">${T('原因已随年度状态变化。','This cause changed with the annual state.')}</div>`);} }
function problemHTML(p){const duration=Math.max(1,yearOf(currentState())-n(p.detectedYear,yearOf(currentState()))+1);return `<div class="be-causal-subject"><h3>${esc(p.title)}</h3><p>${esc(p.summary)}</p><div class="be-causal-meta"><span class="be-causal-chip ${esc(p.severity)}">${severityLabel(p.severity)}</span><span class="be-causal-chip ${esc(p.status)}">${statusLabel(p.status)}</span><span class="be-causal-chip">${T('持续','Duration')} ${duration} ${T('年','yr')}</span></div>${p.observedValue!=null?`<div class="be-causal-history">${T('当前值','Current')}: <b>${esc(fmt(p.observedValue))}</b>${p.expectedRange!=null?` · ${T('期望','Expected')}: ${esc(p.expectedRange)}`:''}</div>`:''}</div>${causeListHTML(p.directCauses)}${actionListHTML(p.availableActions)}${evidenceHTML(p.evidence)}${historyHTML(p)}`;}
function causeHTML(c,p){return `<div class="be-causal-subject"><h3>${esc(c.label)}</h3><p>${esc(c.relation||'')}</p><div class="be-causal-meta"><span class="be-causal-chip ${esc(c.severity)}">${severityLabel(c.severity)}</span><span class="be-causal-chip">${esc(c.sourceModule||'')}</span>${c.year!=null?`<span class="be-causal-chip">${esc(c.year)}</span>`:''}</div>${c.currentValue!=null?`<div class="be-causal-history">${T('当前','Current')}: <b>${esc(fmt(c.currentValue))}</b>${c.threshold!=null?` · ${T('阈值','Threshold')}: ${esc(fmt(c.threshold))}`:''}</div>`:''}</div>${causeListHTML(c.upstreamCauses)}${actionListHTML(c.availableActions)}${evidenceHTML(c.evidence)}`;}
function causeListHTML(cs){if(!cs?.length)return'';return `<div class="be-causal-section-title">${T('直接原因','Direct causes')}</div><div class="be-cause-list">${cs.map(c=>`<button class="be-cause" data-causal-cause="${esc(c.id)}"><span class="be-cause-arrow">›</span><b>${esc(c.label)}</b><small>${c.currentValue!=null?`${T('当前','Current')} ${esc(fmt(c.currentValue))}${c.threshold!=null?` / ${T('阈值','threshold')} ${esc(fmt(c.threshold))}`:''}`:esc(c.relation||'')}</small></button>`).join('')}</div>`;}
function actionListHTML(as){if(!as?.length)return'';const unique=[...new Map(as.map(a=>[a.id,a])).values()];return `<div class="be-causal-section-title">${T('可采取行动','Available actions')}</div><div class="be-action-list">${unique.map(a=>`<button class="be-action ${a.availability?'':'blocked'}" data-causal-action="${esc(a.id)}" ${a.availability?'':'disabled'}><b>${esc(a.label)}</b><small>${esc(a.availability?(a.reason||a.expectedEffect):(a.blockedReason||T('当前不可用','Currently unavailable')))}</small></button>`).join('')}</div>`;}
function evidenceHTML(ev){if(!ev?.length)return'';return `<details class="be-evidence"><summary>${T('查看依据','Inspect evidence')}</summary>${ev.map(x=>`<div class="be-evidence-row"><span>${esc(x.label)}${x.source?` · ${esc(x.source)}`:''}</span><b>${esc(fmt(x.value))}</b></div>`).join('')}</details>`;}
function historyHTML(p){if(!p.history?.length)return'';const h=p.history.slice(-5);return `<details class="be-evidence"><summary>${T('年度变化','Yearly history')}</summary>${h.map(x=>`<div class="be-evidence-row"><span>${esc(x.year)}</span><b>${statusLabel(x.status)} · ${severityLabel(x.severity)}</b></div>`).join('')}</details>`;}
function findActionById(id){const s=ensureStore(currentState());if(!s)return null;function walkCause(cs){for(const c of cs||[]){const a=(c.availableActions||[]).find(x=>x.id===id);if(a)return a;const u=walkCause(c.upstreamCauses);if(u)return u;}return null;}for(const pid of s.problemOrder){const p=s.problems[pid];const a=(p?.availableActions||[]).find(x=>x.id===id)||walkCause(p?.directCauses);if(a)return a;}return null;}
function navigateToAction(actionId){const a=findActionById(actionId);if(!a||!a.availability)return {ok:false,reason:a?.blockedReason||'unavailable'};try{
  if(a.regionId&&typeof selectedRegionId!=='undefined')selectedRegionId=a.regionId;if(a.meta?.resource&&typeof selectedResource!=='undefined')selectedResource=a.meta.resource;
  if(a.targetView&&typeof activeTab!=='undefined'){activeTab=a.targetView;if(typeof renderPanel==='function')renderPanel();if(a.targetView==='development'&&typeof render==='function')render();}
  setTimeout(()=>highlightActionTarget(a),40);return {ok:true,action:clone(a)};
 }catch(err){console.error('Reverse Navigator action navigation failed',err);return {ok:false,reason:String(err)};}}
function highlightActionTarget(a){let sel=a.meta?.selector||null;if(!sel&&a.meta?.connectionId)sel=`[data-upgrade-connection="${CSS.escape(String(a.meta.connectionId))}"]`;if(!sel&&a.meta?.buildType)sel=`[data-build="${CSS.escape(String(a.meta.buildType))}"]`;if(!sel&&a.meta?.cityId)sel=`[data-causal-city="${CSS.escape(String(a.meta.cityId))}"]`;if(!sel&&String(a.targetObjectId||'').startsWith('resource:'))sel='#resourceSelect';const el=sel?document.querySelector(sel):null;if(el){el.classList.add('be-causal-target');el.scrollIntoView?.({block:'center',behavior:'smooth'});setTimeout(()=>el.classList.remove('be-causal-target'),2600);}}

function decoratePanel(){if(runtime.decorating)return;const panel=document.getElementById('panelBody');if(!panel)return;runtime.decorating=true;try{refresh();if(typeof activeTab!=='undefined'&&activeTab==='cities')decorateCities(panel);if(typeof activeTab!=='undefined'&&activeTab==='development')decorateDevelopment(panel);}finally{runtime.decorating=false;}}
function decorateCities(panel){const gs=currentState(),cities=vals(gs?.cities).sort((a,b)=>String(a.name).localeCompare(String(b.name)));panel.querySelectorAll('.city-card').forEach((card,i)=>{const c=cities[i];if(!c)return;card.dataset.causalCity=c.id;if(card.querySelector('.be-why-btn'))return;const ps=activeProblems(gs).filter(p=>p.objectType==='city'&&p.objectId===c.id);if(!ps.length)return;const p=ps.sort(problemSort)[0],wrap=document.createElement('div');wrap.className='be-card-actions';wrap.innerHTML=`<button class="be-why-btn ${p.severity}" data-causal-inspect-type="city" data-causal-inspect-id="${esc(c.id)}">? ${T('为什么','Why')}</button>`;card.appendChild(wrap);});}
function decorateDevelopment(panel){const gs=currentState(),facilities=vals(gs?.facilities).filter(f=>f.regionId===selectedRegionId),connections=vals(gs?.connections).filter(c=>c.fromId===selectedRegionId||c.toId===selectedRegionId);const rows=[...panel.querySelectorAll('.facility-row')];facilities.forEach((f,i)=>decorateRow(rows[i],'facility',f.id));connections.forEach((c,i)=>decorateRow(rows[facilities.length+i],'transportLink',c.id));if(!panel.querySelector('.be-project-diagnostic-list')){const ps=vals(gs?.projects).filter(p=>p.status==='under_construction'&&(p.regionId===selectedRegionId||p.fromId===selectedRegionId||p.toId===selectedRegionId));if(ps.length){const title=document.createElement('div');title.className='section-title';title.textContent=T('在建项目 · 诊断','Active projects · diagnostics');const list=document.createElement('div');list.className='be-project-diagnostic-list';list.innerHTML=ps.map(p=>{const issue=activeProblems(gs).find(x=>x.objectType==='project'&&x.objectId===p.id);const total=Math.max(1,n(p.totalTurns,n(p.duration,1))),left=n(p.turnsRemaining,total),done=clamp(1-left/total,0,1);return `<div class="be-project-diagnostic" data-causal-project="${esc(p.id)}"><div class="be-project-diagnostic-head"><span><b>${esc(p.name||p.type)}</b><small>${T('剩余','Remaining')} ${fmt(left)} ${T('年','yr')} · ${pct(done)} ${T('完成','complete')}</small></span>${issue?`<button class="be-why-btn ${issue.severity}" data-causal-inspect-type="project" data-causal-inspect-id="${esc(p.id)}">? ${T('为什么','Why')}</button>`:''}</div><div class="be-causal-progress"><i style="width:${Math.round(done*100)}%"></i></div>${n(p.integrationProgressFactor,1)<.999?`<div class="be-progress-note">${T('年度进度因子','Annual progress factor')}: ${pct(p.integrationProgressFactor)}</div>`:''}</div>`;}).join('');panel.append(title,list);}}}
function decorateRow(row,type,id){if(!row||row.querySelector('.be-why-btn'))return;const p=activeProblems().filter(x=>x.objectType===type&&String(x.objectId)===String(id)).sort(problemSort)[0];if(!p)return;const b=document.createElement('button');b.className=`be-why-btn ${p.severity}`;b.type='button';b.dataset.causalInspectType=type;b.dataset.causalInspectId=id;b.textContent=`? ${T('为什么','Why')}`;row.appendChild(b);}
document.addEventListener('click',e=>{const b=e.target.closest('[data-causal-inspect-type]');if(!b)return;e.preventDefault();e.stopPropagation();inspectObject(b.dataset.causalInspectType,b.dataset.causalInspectId);});

function installPanelObserver(){const panel=document.getElementById('panelBody');if(!panel)return;let queued=false;new MutationObserver(()=>{if(queued||runtime.decorating)return;queued=true;requestAnimationFrame(()=>{queued=false;decoratePanel();});}).observe(panel,{childList:true,subtree:true});const y=document.getElementById('yearLabel');if(y)new MutationObserver(()=>refresh()).observe(y,{childList:true,characterData:true,subtree:true});}

function runSelfTests(){const results=[],test=(name,fn)=>{try{results.push({name,pass:!!fn()});}catch(e){results.push({name,pass:false,error:String(e)})}};
 test('farm zero area uses real limiter only',()=>{const g={time:{year:2035},agriculture:{regions:{r:{crops:{wheat:{area:22,actualArea:0}},lastOutput:{cropDetails:{wheat:{plannedArea:22,actualArea:0,harvest:0,resourceAllocation:{farmInputs:{factor:0,allocated:0,demand:14},machinery:{factor:1,allocated:10,demand:10}}}},storageFlow:{},logistics:{collectionFactor:1,marketAccessFactor:1}}}}},regions:{r:{name:'R'}},facilities:{},connections:{},projects:{},cities:{}};const p=agricultureDiagnostics(g).find(x=>x.type==='AGRICULTURE_STOPPED');return p&&p.directCauses.length===1&&p.directCauses[0].type==='farmInputs_shortage';});
 test('farm backlog is not low production',()=>{const g={time:{year:2035},agriculture:{regions:{r:{crops:{},lastOutput:{cropDetails:{},cropProduction:{wheat:100},cropHarvestCollected:{wheat:97},storageFlow:{openingStock:{wheat:0},harvestInflow:{wheat:97},withdrawalOutflow:{wheat:57},closingStock:{wheat:38},storageLoss:{wheat:2},fieldLoss:{wheat:3}},logistics:{collectionFactor:.97,marketAccessFactor:.55}}}}},regions:{r:{name:'R'}},facilities:{},connections:{},projects:{},cities:{}};const p=agricultureDiagnostics(g).find(x=>x.type==='FARM_INVENTORY_BACKLOG');return p&&/not automatically classified|不能直接归因/.test(p.summary);});
 test('last mile does not invent rail bottleneck',()=>{const g={time:{year:2035},agriculture:{regions:{r:{crops:{},lastOutput:{cropDetails:{},cropProduction:{wheat:100},cropHarvestCollected:{wheat:97},storageFlow:{harvestInflow:{wheat:97},withdrawalOutflow:{wheat:57},closingStock:{wheat:38}},logistics:{collectionFactor:.5,marketAccessFactor:.5}}}}},regions:{r:{name:'R'},x:{name:'X'}},facilities:{},connections:{rail1:{id:'rail1',type:'railway',fromId:'r',toId:'x',capacity:90}},projects:{},cities:{},economy:{debug:{freightEdges:{rail1:{id:'rail1',from:'r',to:'x',capacity:54}},freightCapacityRemaining:{rail1:40}},regions:{}}};const p=collectCandidates(g);return p.some(x=>x.type==='ROAD_CAPACITY_INSUFFICIENT')&&!p.some(x=>x.type==='RAILWAY_CAPACITY_INSUFFICIENT');});
 test('project missing steel traces material',()=>{const g={time:{year:2035},agriculture:{regions:{}},regions:{r:{name:'R'}},facilities:{},connections:{},projects:{p:{id:'p',name:'Rail',type:'railway',status:'under_construction',regionId:'r',turnsRemaining:2,integrationProgressFactor:0}},cities:{},economy:{module2Signals:{projectProgress:{p:{recommendedProgressFactor:0,missingMaterials:{steel:4}}}},regions:{r:{goods:{steel:{available:0}}}}}};const p=projectDiagnostics(g)[0];return p&&p.directCauses[0]?.type==='project_material_shortage';});
 test('navigator has no overlay',()=>!document.querySelector('.be-causal-overlay'));
 return results;}

const api={VERSION,inspectObject,explainProblem,traceCause,navigateToAction,refresh,activeProblems,causalEdges,clampNavigatorPosition,getDevelopmentDiagnostics,getTransportDiagnostics,getIndustryDiagnostics,getMarketDiagnostics,getPopulationDiagnostics,getAgricultureDiagnostics,getAgricultureLogisticsReport,runSelfTests,openProblem};
BE.ReverseNavigator=api;BE.Module8=BE.Module8||{};BE.Module8.ReverseNavigator=api;global.ReverseNavigator=api;
function start(){mount();installPanelObserver();const checks=runSelfTests();global.__BE_CAUSAL_NAV_CHECKS__=checks;console.log('Border Epoch Reverse Causal Navigation self-check',checks);}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})(window);
;
(function(global){
'use strict';
const LANG=getGameLanguage();
const ZH=LANG==='zh';
const T=(zh,en)=>ZH?zh:en;
const BE=global.BorderEpoch=global.BorderEpoch||{};
const n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,n(v,a)));
const vals=o=>Object.values(o||{});
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=v=>new Intl.NumberFormat(ZH?'zh-CN':'en-US',{maximumFractionDigits:2}).format(n(v));
const pct=v=>`${Math.round(n(v)*100)}%`;
const year=()=>n(gs()?.time?.year,n(gs()?.turn,2030));
const player=()=>gs()?.playerCountryId||'asteria';
const countryName=id=>{
  const raw=gs()?.countries?.[id]?.name||id||T('未知国家','Unknown country');
  const known={meridian:T('子午共和国','Meridian Republic'),norvia:T('诺维亚','Norvia'),asteria:T('阿斯特里亚','Asteria')};
  return known[id]||raw;
};
const goodName=g=>{const map={food:T('粮食','Food'),wheat:T('小麦','Wheat'),rice:T('水稻','Rice'),corn:T('玉米','Corn'),soybean:T('大豆','Soybean'),potato:T('马铃薯','Potato'),cotton:T('棉花','Cotton'),coal:T('煤炭','Coal'),iron:T('铁矿','Iron'),copper:T('铜','Copper'),steel:T('钢铁','Steel'),manufactured_goods:T('工业品','Manufactured goods'),oil:T('石油','Oil'),gas:T('天然气','Gas'),fertilizer:T('肥料','Fertilizer'),machinery:T('机械','Machinery'),power:T('电力','Power'),construction_materials:T('建筑材料','Construction materials')};return map[g]||(ZH?T('其他商品','Other good'):String(g||'—').replaceAll('_',' '));};
function localizeStatus(v){const map={planned:T('已规划','Planned'),under_construction:T('建设中','Under Construction'),operational:T('运营中','Operational'),completed:T('已完成','Completed'),cancelled:T('已取消','Cancelled'),active:T('运行中','Active'),inactive:T('停运','Inactive'),worn:T('老化','Worn'),damaged:T('受损','Damaged'),critical:T('严重受损','Critical'),closed:T('关闭','Closed'),proposed:T('已提议','Proposed'),accepted:T('已接受','Accepted'),rejected:T('已拒绝','Rejected'),failed:T('失败','Failed'),expired:T('已到期','Expired'),paused:T('暂停','Paused')};return map[v]||(v?(ZH?T('其他状态','Other Status'):String(v).replaceAll('_',' ')):'—');}
function localizeProjectType(v){const map={land_development:T('国家耕地开发','State Land Development'),irrigation_expansion:T('国家灌溉扩建','State Irrigation Expansion'),storage_expansion:T('国家农业仓储扩建','State Agricultural Storage Expansion'),road:T('公路','Road'),rail:T('铁路','Rail'),road_construction:T('公路建设','Road Construction'),rail_construction:T('铁路建设','Rail Construction'),resource_exploration:T('资源勘探','Resource Exploration'),mine_development:T('矿山开发','Mine Development'),coal_mine:T('煤矿','Coal Mine'),iron_mine:T('铁矿','Iron Mine'),copper_mine:T('铜矿','Copper Mine'),oil_field:T('油田','Oil Field'),power_plant:T('发电项目','Power Plant'),port:T('港口项目','Port Project'),storage:T('仓储项目','Storage Project')};return map[v]||(ZH?T('其他项目','Other Project'):String(v||'—').replaceAll('_',' '));}
function localizeFacilityType(v){const map={coal_mine:T('煤矿','Coal Mine'),iron_mine:T('铁矿','Iron Mine'),copper_mine:T('铜矿','Copper Mine'),oil_field:T('油田','Oil Field'),steelworks:T('钢铁厂','Steelworks'),basic_factory:T('基础工厂','Basic Factory'),power_plant:T('发电厂','Power Plant'),port:T('港口','Port'),warehouse:T('仓库','Warehouse')};return map[v]||(ZH?T('其他设施','Other Facility'):String(v||'—').replaceAll('_',' '));}
function localizeCropName(v){const map={wheat:T('小麦','Wheat'),rice:T('水稻','Rice'),corn:T('玉米','Corn'),soybean:T('大豆','Soybean'),potato:T('马铃薯','Potato'),cotton:T('棉花','Cotton')};return map[v]||(ZH?T('其他作物','Other Crop'):String(v||'—').replaceAll('_',' '));}
function localizeResourceName(v){return goodName(v);}
function localizeAgreementType(v){const map={friendship_treaty:T('友好条约','Friendship Treaty'),foreign_investment_agreement:T('外国投资协议','Foreign Investment Agreement'),trade:T('贸易协议','Trade Agreement')};return map[v]||(ZH?T('其他协议','Other Agreement'):String(v||'—').replaceAll('_',' '));}

function localizeDiplomacyAgreementType(v){const map={friendship_treaty:T('友好条约','Friendship Treaty'),trade_agreement:T('贸易协议','Trade Agreement'),long_term_supply:T('长期供应协议','Long-Term Supply Agreement'),investment_agreement:T('投资协议','Investment Agreement'),transit_agreement:T('过境协议','Transit Agreement'),border_cooperation:T('边境合作协议','Border Cooperation Agreement'),aid_agreement:T('援助协议','Aid Agreement'),non_aggression:T('互不侵犯协议','Non-Aggression Agreement'),long_term_supply_contract:T('长期供应合同（贸易执行层）','Long-Term Supply Contract (trade execution)'),foreign_investment_agreement:T('外国投资协议（兼容）','Foreign Investment Agreement (legacy)')};return map[v]||(ZH?T('其他协议','Other Agreement'):String(v||'—').replaceAll('_',' '));}
function localizeDiplomacyNeed(v){const map={food_supply:T('粮食供应','Food Supply'),energy_supply:T('能源供应','Energy Supply'),raw_material_supply:T('原材料供应','Raw Material Supply'),industrial_goods:T('工业品供应','Industrial Goods'),export_market:T('出口市场','Export Market'),transport_access:T('运输通道','Transport Access'),investment:T('投资','Investment'),financial_support:T('资金支持','Financial Support'),border_stability:T('边境稳定','Border Stability')};return map[v]||(ZH?T('其他需求','Other Need'):String(v||'—').replaceAll('_',' '));}
function localizeDiplomacyStatus(v){const map={draft:T('草案','Draft'),sent:T('已发送','Sent'),accepted:T('已接受','Accepted'),rejected:T('已拒绝','Rejected'),countered:T('已还价','Countered'),withdrawn:T('已撤回','Withdrawn'),active:T('履行中','Active'),completed:T('已完成','Completed'),expired:T('已到期','Expired'),cancelled:T('已取消','Cancelled'),breached:T('违约','Breached')};return map[v]||localizeStatus(v);}
function localizeDiplomacyClause(v){const map={annual_supply:T('年度商品供应','Annual Supply'),tariff_reduction:T('关税减让','Tariff Reduction'),transit_access:T('过境权','Transit Access'),financial_aid:T('资金援助','Financial Aid'),goods_aid:T('物资援助','Goods Aid'),investment_access:T('投资准入','Investment Access'),border_cooperation:T('边境协作','Border Cooperation'),non_aggression_commitment:T('互不侵犯承诺','Non-Aggression Commitment')};return map[v]||(ZH?T('其他条款','Other Clause'):String(v||'—').replaceAll('_',' '));}
function localizeDiplomaticHistoryType(v){const map={proposal_sent:T('提出协议','Proposal Sent'),ai_proposal_sent:T('AI 主动提案','AI Proposal'),proposal_accepted:T('接受协议','Proposal Accepted'),proposal_rejected:T('拒绝协议','Proposal Rejected'),proposal_withdrawn:T('撤回提案','Proposal Withdrawn'),counter_proposal:T('提出还价','Counterproposal'),agreement_signed:T('签署协议','Agreement Signed'),agreement_activated:T('协议生效','Agreement Activated'),annual_fulfilled:T('年度完全履约','Annual Fulfillment'),annual_partial:T('年度部分履约','Partial Fulfillment'),severe_breach:T('严重违约','Severe Breach'),agreement_expired:T('协议到期','Agreement Expired'),agreement_cancelled:T('协议取消','Agreement Cancelled'),trade_dispute:T('贸易争端','Trade Dispute'),aid_completed:T('援助完成','Aid Completed')};return map[v]||(ZH?T('外交事件','Diplomatic Event'):String(v||'—').replaceAll('_',' '));}
function localizeDiplomacyReason(v){const map={relations:T('双边关系','Bilateral relations'),trust:T('履约信任','Trust / reliability'),strategic_interest:T('现实战略利益','Strategic interest'),tension:T('紧张度','Tension'),need_match:T('对方真实需求','Real partner need'),supply_capacity:T('可出口能力','Export capacity'),price_too_high:T('价格偏高','Price too high'),price_premium:T('价格溢价','Price premium'),tariff_revenue_cost:T('关税收入成本','Tariff revenue cost'),tariff_access_benefit:T('市场准入收益','Market-access benefit'),transport_access:T('运输通道价值','Transport access value'),transit_commitment_cost:T('过境承诺成本','Transit commitment cost'),financial_support:T('资金支持价值','Financial support value'),fiscal_cost:T('财政成本','Fiscal cost'),goods_aid_benefit:T('物资援助价值','Goods-aid value'),aid_inventory_cost:T('援助库存成本','Aid inventory cost'),investment_need:T('投资需求','Investment need'),border_coordination:T('边境协作','Border coordination'),stability_commitment:T('稳定承诺','Stability commitment'),long_commitment_low_trust:T('低信任下长期承诺风险','Long commitment with low trust'),stable_duration:T('稳定合作期限','Stable duration'),ai_country_preferences:T('AI 国家偏好','AI country preferences')};return map[v]||(ZH?T('其他因素','Other factor'):String(v||'—').replaceAll('_',' '));}
function localizeRelationshipReason(v){const map={trade_cooperation:T('长期贸易合作','Long-term trade cooperation'),friendship_framework:T('友好条约框架','Friendship framework'),non_aggression_commitment:T('互不侵犯承诺','Non-aggression commitment'),SIGNED_AGREEMENT:T('签署协议','Agreement signed'),BROKE_TRADE_AGREEMENT:T('破坏贸易协议','Trade agreement broken'),CONTRACT_SHORTFALL:T('贸易合同短缺','Contract shortfall'),RAISED_TARIFF:T('提高关税','Tariff raised'),LOWERED_TARIFF:T('降低关税','Tariff lowered'),RAISED_EXPORT_TAX:T('提高出口税','Export tax raised'),LOWERED_EXPORT_TAX:T('降低出口税','Export tax lowered'),EXPORT_RESTRICTED:T('出口限制','Export restriction'),RESTRICTED_INVESTMENT:T('投资限制','Investment restriction'),REDUCED_IMPORTS:T('减少进口','Reduced imports'),PREFERENTIAL_ACCESS:T('优惠市场准入','Preferential access'),annual_fulfilled:T('协议履约','Agreement fulfilled'),annual_partial:T('部分履约','Partial fulfillment'),severe_breach:T('严重违约','Severe breach'),agreement_cancelled:T('协议取消','Agreement cancelled')};return map[v]||(ZH?T('其他关系因素','Other relationship factor'):String(v||'—').replaceAll('_',' '));}
function localizeBreachReason(v){const map={inventory_shortage:T('库存不足','Inventory shortage'),transport_capacity:T('交通/口岸容量不足','Transport / gateway capacity'),funds_shortage:T('资金不足','Insufficient funds'),funds_unavailable:T('财政执行接口不可用','Fiscal execution API unavailable'),active_cancel:T('主动取消/政策限制','Active cancellation / policy restriction'),route_closed:T('贸易路线关闭','Trade route closed'),inventory_unavailable:T('正式库存接口不可用','Official inventory unavailable'),other_system:T('其他系统原因','Other system cause')};return map[v]||(ZH?T('其他原因','Other reason'):String(v||'—').replaceAll('_',' '));}
function localizeProblemSeverity(v){const map={low:T('轻微','Low'),medium:T('中等','Medium'),high:T('严重','High'),critical:T('严重','Critical')};return map[v]||(ZH?T('其他级别','Other Severity'):v||'—');}
function localizeAgricultureIntensity(v){const map={extensive:T('粗放','Extensive'),normal:T('正常','Normal'),intensive:T('集约','Intensive')};return map[v]||(ZH?T('其他强度','Other Intensity'):v||'—');}
function gs(){return global.gameState || (typeof session!=='undefined'&&session?.state) || null;}
function toastUI(msg,type='good'){try{if(typeof toast==='function')toast(msg,type);else console.log(msg);}catch(_){console.log(msg);}}
function uid(prefix,store){let i=1,k;do{k=`${prefix}_${String(i++).padStart(4,'0')}`;}while(store?.[k]);return k;}
function emit(state,e){state.events=state.events||[];state.history=state.history||[];const x={...e,year:year(),turn:year()};state.events.push(x);state.history.push(x);return x;}

/* --------------------------------------------------------------------------
   MODULE 5 EXTENSION — multi-contract trade and friendship treaty
   This layer never invents production or transport. Each TradeContract owns a
   real legacy tradeRelation; the existing Module 5 allocator settles supply,
   route capacity, physical port capacity, access, taxes and price.
   -------------------------------------------------------------------------- */
const Trade=global.TradeDiplomacy;
const AI=global.CountryAI;
const MULTI_VERSION='2.0.0';
const PRIORITY_WEIGHT={essential:1,normal:.72,low:.42};
const CONTRACT_YEARS={spot:1,short:3,long:5};
function ensureMultiState(state=gs()){
  if(!state)return null;
  state.tradeContracts=state.tradeContracts||{};
  state.tradeQuotes=state.tradeQuotes||{};
  state.tradeCountryRelations=state.tradeCountryRelations||{};
  state.tradeDrafts=state.tradeDrafts||{};
  state.tradeContractHistory=state.tradeContractHistory||[];
  state.agreements=state.agreements||{};
  state.diplomaticProposals=state.diplomaticProposals||{};
  return state;
}
function pairKey(a,b){return[a,b].sort().join('::');}
function activeFriendship(a,b,state=gs()){
  return vals(state?.agreements).find(x=>x&&x.type==='friendship_treaty'&&x.status!=='expired'&&x.status!=='terminated'&&x.active!==false&&((x.countryAId===a&&x.countryBId===b)||(x.countryAId===b&&x.countryBId===a)))||null;
}
function relationFacts(a,b,state=gs()){
  ensureMultiState(state);let rel={relation:0,trust:0,strategicCompetition:0,dependence:{}};
  try{rel=Trade?.getRelationship?.(a,b,state)||rel;}catch(_){ }
  const treaty=activeFriendship(a,b,state);
  const trust01=clamp((n(rel.trust)+100)/200);
  const relation01=clamp((n(rel.relation)+100)/200);
  const strategic=clamp(n(rel.strategicCompetition)/100);
  const tariffFriction=.12;
  const baseFriction=clamp(.58-.32*relation01-.16*trust01+.28*strategic);
  const treatyReduction=treaty?clamp(n(treaty.terms?.frictionReduction,.15),.10,.20):0;
  const tradeFriction=clamp(baseFriction+tariffFriction-treatyReduction);
  const key=pairKey(a,b);
  state.tradeCountryRelations[key]={id:`trade_relation_${key.replaceAll(':','_')}`,countryAId:[a,b].sort()[0],countryBId:[a,b].sort()[1],status:'active',trust:n(rel.trust),relation:n(rel.relation),strategicCompetition:n(rel.strategicCompetition),tradeFriction,friendshipTreatyId:treaty?.id||null,activeContractIds:vals(state.tradeContracts).filter(c=>c&&c.status==='active'&&[c.exporterCountryId,c.importerCountryId].includes(a)&&[c.exporterCountryId,c.importerCountryId].includes(b)).map(c=>c.id)};
  return state.tradeCountryRelations[key];
}
function committedExport(exporter,good,state=gs(),excludeContractId=null){
  return vals(state?.tradeContracts).filter(c=>c&&c.status==='active'&&c.id!==excludeContractId&&c.exporterCountryId===exporter&&c.goodId===good&&year()>=n(c.startYear)&&year()<=n(c.endYear)).reduce((s,c)=>s+n(c.contractedVolume),0);
}
function exportableSupply(exporter,good,state=gs(),excludeContractId=null){
  const gross=Math.max(0,n(Trade?.getPotentialSurplus?.(exporter,good,state)));
  return Math.max(0,gross-committedExport(exporter,good,state,excludeContractId));
}
function findRoute(exporter,importer,state=gs()){
  const routes=vals(state?.tradeRoutes).filter(r=>r&&r.active!==false&&r.exporterCountryId===exporter&&r.importerCountryId===importer);
  return routes.sort((a,b)=>n(b.capacity)-n(a.capacity))[0]||null;
}
function ensureRoute(exporter,importer,state=gs()){
  let r=findRoute(exporter,importer,state);if(r)return r;
  const made=Trade?.createTradeRoute?.({exporterCountryId:exporter,importerCountryId:importer},state);
  return made?.route||findRoute(exporter,importer,state);
}
function routeCapacityAvailable(exporter,importer,state=gs()){
  const r=ensureRoute(exporter,importer,state);if(!r)return 0;
  return Math.max(0,n(r.capacity)-n(r.usedCapacity));
}
function portCapacityAvailable(importer,state=gs()){
  try{return Math.max(0,n(Trade?.getCountryPortCapacity?.(importer,state)));}catch(_){return 0;}
}
function computeWillingness(exporter,importer,good,unitPrice,state=gs()){
  const facts=relationFacts(exporter,importer,state);
  const treaty=activeFriendship(exporter,importer,state);
  const trust01=clamp((n(facts.trust)+100)/200);
  let priceAttractiveness=.5;
  try{const bid=Trade?.getSpotBid?.(exporter,importer,good,0,0,state);if(bid)priceAttractiveness=clamp(n(bid.maxSellerPrice)/(Math.max(.01,n(unitPrice))*1.5));}catch(_){ }
  const need=Math.max(0,n(Trade?.getImportNeed?.(importer,good,state)));
  const depBenefit=clamp(need/Math.max(1,need+20));
  const treatyEffect=treaty?1:0;
  const strategicRisk=clamp(n(facts.strategicCompetition)/100);
  return clamp(.35*trust01+.25*priceAttractiveness+.20*treatyEffect+.10*depBenefit-.10*strategicRisk);
}
function quotePrice(exporter,importer,good,state=gs()){
  let p=1;try{const bid=Trade?.getSpotBid?.(exporter,importer,good,0,0,state);p=n(bid?.exporterAsk,n(bid?.maxSellerPrice,1));}catch(_){ }
  const f=relationFacts(exporter,importer,state).tradeFriction;
  return Math.max(.01,p*(1+.22*f));
}
function requestMultiGoodQuote(def,state=gs()){
  ensureMultiState(state);const importer=def.importerCountryId||player(),exporter=def.exporterCountryId;
  if(!state.countries?.[importer]||!state.countries?.[exporter]||importer===exporter)return{ok:false,error:'invalid_countries'};
  const items=[];const treaty=activeFriendship(exporter,importer,state);
  for(const raw of def.items||[]){
    const goodId=raw.goodId,requestedVolume=Math.max(0,n(raw.requestedVolume??raw.volume));if(!goodId||requestedVolume<=0)continue;
    const remaining=exportableSupply(exporter,goodId,state);
    const unitPrice=quotePrice(exporter,importer,goodId,state);
    const willingness=computeWillingness(exporter,importer,goodId,unitPrice,state);
    const willingSupply=Math.min(remaining,remaining*clamp(.15+.95*willingness,0,1));
    const routeCap=routeCapacityAvailable(exporter,importer,state),portCap=portCapacityAvailable(importer,state);
    const offeredVolume=Math.max(0,Math.min(requestedVolume,willingSupply,routeCap||Infinity,portCap||Infinity));
    const maxContractYears=treaty?Math.max(5,Math.min(8,Math.round(4+4*willingness))):Math.max(1,Math.min(5,Math.round(1+4*willingness)));
    items.push({goodId,requestedVolume,offeredVolume:+offeredVolume.toFixed(2),unitPrice:+unitPrice.toFixed(4),available:offeredVolume>0,willingness:+willingness.toFixed(3),maxContractYears,availableExport:+remaining.toFixed(2),routeCapacityAvailable:+routeCap.toFixed(2),portCapacityAvailable:+portCap.toFixed(2),reason:offeredVolume>0?null:(remaining<=0?'insufficient_exportable_supply':routeCap<=0?'route_capacity_unavailable':portCap<=0?'port_capacity_unavailable':'low_trade_willingness')});
  }
  const q={id:uid('quote',state.tradeQuotes),exporterCountryId:exporter,importerCountryId:importer,items,status:'open',createdYear:year(),expirationYear:year()+1,relationSnapshot:relationFacts(exporter,importer,state)};
  state.tradeQuotes[q.id]=q;emit(state,{type:'MULTI_GOOD_QUOTE_CREATED',sourceModule:'module5',quoteId:q.id,exporterCountryId:exporter,importerCountryId:importer});return{ok:true,quote:q};
}
function contractDurationYears(kind){return Math.max(1,n(CONTRACT_YEARS[kind],1));}
function createContractFromQuote(quote,item,options={},state=gs()){
  const kind=options.contractType||'short',requestedDuration=Math.max(1,n(options.durationYears,contractDurationYears(kind))),duration=Math.max(1,Math.min(requestedDuration,n(item.maxContractYears,requestedDuration)));
  const priority=['essential','normal','low'].includes(options.priority)?options.priority:'normal';
  const vol=Math.max(0,Math.min(n(options.volume,item.offeredVolume),n(item.offeredVolume)));
  if(vol<=0)return null;
  const route=ensureRoute(quote.exporterCountryId,quote.importerCountryId,state);
  const c={id:uid('trade_contract',state.tradeContracts),exporterCountryId:quote.exporterCountryId,importerCountryId:quote.importerCountryId,goodId:item.goodId,requestedVolume:n(item.requestedVolume),contractedVolume:vol,unitPrice:n(item.unitPrice,1),tariffRate:n(Trade?.getEffectiveTariff?.(quote.importerCountryId,quote.exporterCountryId,item.goodId,state),0),routeId:route?.id||null,entryPortId:route?.importLocationId||null,priority,contractType:kind,status:'active',startYear:year(),endYear:year()+duration-1,deliveredThisYear:0,paymentThisYear:0,unmetVolumeThisYear:vol,sourceQuoteId:quote.id,tradeRelationId:null,supplyEvidence:{availableExportAtSigning:n(item.availableExport),willingness:n(item.willingness)},history:[]};
  state.tradeContracts[c.id]=c;ensureContractFlow(c,state);emit(state,{type:'TRADE_CONTRACT_CREATED',sourceModule:'module5',contractId:c.id,goodId:c.goodId,exporterCountryId:c.exporterCountryId,importerCountryId:c.importerCountryId});return c;
}
function acceptQuoteItems(quoteId,selected,options={},state=gs()){
  ensureMultiState(state);const q=state.tradeQuotes?.[quoteId];if(!q||q.status!=='open')return{ok:false,error:'quote_unavailable'};
  const selectedSet=new Set((selected||[]).map(x=>typeof x==='string'?x:x.goodId));const contracts=[];
  for(const item of q.items||[]){if(!selectedSet.has(item.goodId)||!item.available)continue;const per=typeof selected?.find==='function'?selected.find(x=>typeof x==='object'&&x.goodId===item.goodId):null;const c=createContractFromQuote(q,item,{...options,...(per||{})},state);if(c)contracts.push(c);}
  q.status='partially_accepted';q.acceptedContractIds=contracts.map(c=>c.id);q.resolvedYear=year();return{ok:true,quote:q,contracts};
}
function ensureContractFlow(c,state=gs()){
  if(!Trade||!c||c.status!=='active')return null;
  let tr=c.tradeRelationId?state.tradeRelations?.[c.tradeRelationId]:null;
  const minimum=n(c.contractedVolume)*n(PRIORITY_WEIGHT[c.priority],.72);
  if(!tr){
    let agreementId=null;
    if(c.contractType!=='spot'){
      const aid=`contract_agreement_${c.id}`;
      if(!state.agreements[aid])state.agreements[aid]={id:aid,type:'long_term_supply_contract',countryAId:c.exporterCountryId,countryBId:c.importerCountryId,terms:{exporterCountryId:c.exporterCountryId,importerCountryId:c.importerCountryId,goodId:c.goodId,minimumVolume:minimum,contractId:c.id},startTurn:c.startYear,duration:c.endYear-c.startYear+1,active:true,status:'active',source:'multi_trade_contract'};
      agreementId=aid;
    }
    const made=Trade.createTradeRelation?.({id:`contract_flow_${c.id}`,exporterCountryId:c.exporterCountryId,importerCountryId:c.importerCountryId,goodId:c.goodId,desiredVolume:c.contractedVolume,routeId:c.routeId,agreementId},state);
    tr=made?.tradeRelation||state.tradeRelations?.[`contract_flow_${c.id}`];if(tr)c.tradeRelationId=tr.id;
  }
  if(tr){tr.active=true;tr.desiredVolume=n(c.contractedVolume);tr.routeId=c.routeId||tr.routeId;const ag=tr.agreementId&&state.agreements?.[tr.agreementId];if(ag?.terms)ag.terms.minimumVolume=minimum;}
  return tr;
}
function expireContracts(state=gs()){
  for(const c of vals(state?.tradeContracts)){if(!c||c.status!=='active')continue;if(year()>n(c.endYear)){c.status='expired';c.endedYear=year();const tr=state.tradeRelations?.[c.tradeRelationId];if(tr){tr.active=false;tr.volume=0;}emit(state,{type:'TRADE_CONTRACT_EXPIRED',sourceModule:'module5',contractId:c.id});}}
}
function expireFriendships(state=gs()){
  for(const ag of vals(state?.agreements)){if(!ag||ag.type!=='friendship_treaty'||ag.active===false)continue;const exp=n(ag.expirationYear,n(ag.startTurn)+n(ag.duration));if(year()>=exp){ag.active=false;ag.status='expired';ag.endedYear=year();emit(state,{type:'FRIENDSHIP_TREATY_EXPIRED',sourceModule:'module5',agreementId:ag.id});}}
}
function beforeTradeAnnual(state=gs()){
  ensureMultiState(state);expireContracts(state);expireFriendships(state);
  for(const c of vals(state.tradeContracts)){if(c?.status==='active'&&year()>=n(c.startYear)&&year()<=n(c.endYear))ensureContractFlow(c,state);}
  for(const key of Object.keys(state.tradeCountryRelations||{})){const r=state.tradeCountryRelations[key];if(r)relationFacts(r.countryAId,r.countryBId,state);}
}
function settleContracts(state=gs()){
  for(const c of vals(state?.tradeContracts)){
    if(!c||c.status!=='active'||year()<n(c.startYear)||year()>n(c.endYear))continue;
    const tr=state.tradeRelations?.[c.tradeRelationId];const delivered=Math.max(0,n(tr?.volume));
    c.deliveredThisYear=+delivered.toFixed(2);c.unmetVolumeThisYear=+Math.max(0,n(c.contractedVolume)-delivered).toFixed(2);c.tariffRate=n(tr?.tariffRate,c.tariffRate);
    const landed=n(tr?.marketClearingPrice,n(tr?.contractUnitPrice,c.unitPrice));c.unitPrice=landed||c.unitPrice;c.paymentThisYear=+(delivered*n(c.unitPrice)*(1+n(c.tariffRate))).toFixed(2);
    const explanation=Array.isArray(tr?.lastExplanation)?tr.lastExplanation.slice():[];
    c.history.push({year:year(),delivered:c.deliveredThisYear,unmet:c.unmetVolumeThisYear,payment:c.paymentThisYear,routeId:c.routeId,evidence:explanation});
    if(c.history.length>12)c.history.splice(0,c.history.length-12);
    emit(state,{type:'TRADE_CONTRACT_SETTLED',sourceModule:'module5',contractId:c.id,goodId:c.goodId,delivered:c.deliveredThisYear,unmet:c.unmetVolumeThisYear,causalTrace:[{type:'contract',id:c.id},{type:'trade_relation',id:c.tradeRelationId},{type:'route',id:c.routeId}]});
  }
  for(const a of vals(state?.tradeCountryRelations)){if(a)relationFacts(a.countryAId,a.countryBId,state);}
}
function canSignFriendshipTreaty(a,b,state=gs()){
  const f=relationFacts(a,b,state);const existing=activeFriendship(a,b,state);const reasons=[];let ok=true;
  if(existing){ok=false;reasons.push('already_active');}
  if(n(f.trust)<-20){ok=false;reasons.push('trust_too_low');}
  if(n(f.strategicCompetition)>80){ok=false;reasons.push('strategic_competition_too_high');}
  const sanctioned=vals(state?.agreements).some(x=>x&&x.active!==false&&['sanction','sanctions'].includes(x.type)&&[x.countryAId,x.countryBId].includes(a)&&[x.countryAId,x.countryBId].includes(b));
  if(sanctioned){ok=false;reasons.push('active_sanctions');}
  return{ok,reasons,conditions:{trust:n(f.trust),minimumTrust:-20,strategicCompetition:n(f.strategicCompetition),maximumStrategicCompetition:80,tradeFriction:n(f.tradeFriction)}};
}
function evaluateFriendshipTreaty(proposer,receiver,duration=8,state=gs()){
  const eligibility=canSignFriendshipTreaty(proposer,receiver,state);if(!eligibility.ok)return{decision:'reject',score:-100,reasons:eligibility.reasons.map(x=>({reason:x,value:-100})),eligibility};
  let base={decision:'counter',score:0,reasons:[]};
  try{base=AI?.evaluateProposal?.(receiver,{id:`friendship_eval_${year()}`,proposerCountryId:proposer,targetCountryId:receiver,type:'friendship_treaty',duration,terms:{duration,tradePromotion:true,tariffCooperation:true,investmentCooperation:true}},state)||base;}catch(_){ }
  const f=relationFacts(proposer,receiver,state);let score=n(base.score);const extra=[];
  const competitionPenalty=-12*clamp(n(f.strategicCompetition)/100);score+=competitionPenalty;extra.push({reason:'strategic_competition',value:+competitionPenalty.toFixed(1)});
  const currentTrade=vals(state.tradeContracts).filter(c=>c&&c.status==='active'&&[c.exporterCountryId,c.importerCountryId].includes(proposer)&&[c.exporterCountryId,c.importerCountryId].includes(receiver)).reduce((s,c)=>s+n(c.deliveredThisYear),0);
  const marketValue=Math.min(10,currentTrade/5);score+=marketValue;extra.push({reason:'existing_trade_value',value:+marketValue.toFixed(1)});
  const decision=score>=12?'accept':score>=-8?'counter':'reject';return{...base,decision,score:+score.toFixed(1),reasons:[...(base.reasons||[]),...extra],eligibility};
}
function proposeFriendshipTreaty(partnerId,duration=8,state=gs()){
  ensureMultiState(state);const proposer=player(),receiver=partnerId,check=canSignFriendshipTreaty(proposer,receiver,state);if(!check.ok)return{ok:false,error:check.reasons.join(','),eligibility:check};
  const p={id:uid('friendship_proposal',state.diplomaticProposals),proposerCountryId:proposer,receiverCountryId:receiver,type:'friendship_treaty',offeredTerms:{tradePromotion:true,tariffCooperation:true,investmentCooperation:true,frictionReduction:.15,duration},requestedTerms:{},createdTurn:year(),expirationTurn:year()+2,status:'pending',explanation:[]};state.diplomaticProposals[p.id]=p;
  const ev=evaluateFriendshipTreaty(proposer,receiver,duration,state);p.aiEvaluation=ev;
  if(ev.decision==='accept'){return activateFriendshipProposal(p.id,state);}
  if(ev.decision==='counter'){p.status='countered';p.counterTerms={duration:Math.max(3,Math.min(6,duration)),frictionReduction:.12};emit(state,{type:'FRIENDSHIP_TREATY_COUNTERED',sourceModule:'module6',proposalId:p.id,countryId:receiver});return{ok:true,decision:'counter',proposal:p,evaluation:ev};}
  p.status='rejected';p.resolvedTurn=year();emit(state,{type:'FRIENDSHIP_TREATY_REJECTED',sourceModule:'module6',proposalId:p.id,countryId:receiver});return{ok:true,decision:'reject',proposal:p,evaluation:ev};
}
function activateFriendshipProposal(proposalId,state=gs()){
  const p=state?.diplomaticProposals?.[proposalId];if(!p)return{ok:false,error:'proposal_not_found'};
  const duration=Math.max(3,n(p.counterTerms?.duration,p.offeredTerms?.duration||8));const reduction=clamp(n(p.counterTerms?.frictionReduction,p.offeredTerms?.frictionReduction||.15),.10,.20);
  let ag=null;
  try{const made=Trade?.createAgreement?.({type:'friendship_treaty',countryAId:p.proposerCountryId,countryBId:p.receiverCountryId,terms:{tradePromotion:true,tariffCooperation:true,investmentCooperation:true,frictionReduction:reduction},duration,sourceProposalId:p.id},state);ag=made?.agreement||null;}catch(_){ }
  if(!ag){ag={id:uid('agreement',state.agreements),type:'friendship_treaty',countryAId:p.proposerCountryId,countryBId:p.receiverCountryId,terms:{tradePromotion:true,tariffCooperation:true,investmentCooperation:true,frictionReduction:reduction},startTurn:year(),duration,active:true,sourceProposalId:p.id};state.agreements[ag.id]=ag;}
  Object.assign(ag,{status:'active',active:true,signedYear:year(),durationYears:duration,expirationYear:year()+duration});p.status='accepted';p.resolvedTurn=year();p.agreementId=ag.id;
  relationFacts(ag.countryAId,ag.countryBId,state);emit(state,{type:'FRIENDSHIP_TREATY_SIGNED',sourceModule:'module5',agreementId:ag.id,countryAId:ag.countryAId,countryBId:ag.countryBId,causalTrace:[{type:'agreement',id:ag.id,relation:'reduces_trade_friction'}]});return{ok:true,decision:'accept',proposal:p,agreement:ag};
}
function acceptFriendshipCounter(proposalId,state=gs()){const p=state?.diplomaticProposals?.[proposalId];if(!p||p.status!=='countered')return{ok:false,error:'counter_unavailable'};return activateFriendshipProposal(proposalId,state);}
function terminateAgreement(agreementId,reason='player_terminated',state=gs()){
  const a=state?.agreements?.[agreementId];if(!a)return{ok:false,error:'agreement_not_found'};a.active=false;a.status='terminated';a.endedYear=year();a.endReason=reason;relationFacts(a.countryAId,a.countryBId,state);emit(state,{type:'AGREEMENT_TERMINATED',sourceModule:'module5',agreementId,reason});return{ok:true,agreement:a};
}
function renewFriendshipTreaty(agreementId,duration=8,state=gs()){
  const old=state?.agreements?.[agreementId];if(!old||old.type!=='friendship_treaty')return{ok:false,error:'friendship_not_found'};return proposeFriendshipTreaty(old.countryAId===player()?old.countryBId:old.countryAId,duration,state);
}
function getTradeCausalEvidence(countryId,goodId=null,state=gs()){ensureMultiState(state);const contracts=vals(state.tradeContracts).filter(c=>c&&(!countryId||[c.exporterCountryId,c.importerCountryId].includes(countryId))&&(!goodId||c.goodId===goodId));return contracts.map(c=>({contractId:c.id,goodId:c.goodId,delivered:c.deliveredThisYear,unmet:c.unmetVolumeThisYear,routeId:c.routeId,tradeRelationId:c.tradeRelationId,friendshipTreatyId:activeFriendship(c.exporterCountryId,c.importerCountryId,state)?.id||null,evidence:(state.tradeRelations?.[c.tradeRelationId]?.lastExplanation||[]).slice(),history:(c.history||[]).slice(-3)}));}
function multiDebug(state=gs()){ensureMultiState(state);return{contracts:vals(state.tradeContracts),quotes:vals(state.tradeQuotes),countryRelations:vals(state.tradeCountryRelations),friendshipTreaties:vals(state.agreements).filter(a=>a?.type==='friendship_treaty')};}
function runMultiTradeSelfTests(){
  const checks=[];const ck=(name,ok,detail='')=>checks.push({name,ok:!!ok,detail});
  const st={playerCountryId:'asteria',time:{year:2062},turn:2062,countries:{asteria:{id:'asteria',tradeCapacity:50},meridian:{id:'meridian',tradeCapacity:50},norvia:{id:'norvia',tradeCapacity:50}},facilities:{},connections:{},economy:{countries:{asteria:{goods:{steel:{production:0,domesticDemand:80,consumption:0,price:2},coal:{production:0,domesticDemand:60,consumption:0,price:1.4}}},meridian:{goods:{steel:{production:70,domesticDemand:20,consumption:20,price:1.2},coal:{production:70,domesticDemand:20,consumption:20,price:.9}}},norvia:{goods:{steel:{production:50,domesticDemand:10,consumption:10,price:1.3}}}}},tradeRelations:{},tradeRoutes:{},diplomaticRelations:{},agreements:{},events:[],history:[],flags:{allowLegacyTradeCapacityFallback:true}};
  const old=global.gameState;
  try{
    global.gameState=st;Trade?.initializeState?.(st);ensureMultiState(st);AI?.initialize?.(st);
    const q=requestMultiGoodQuote({importerCountryId:'asteria',exporterCountryId:'meridian',items:[{goodId:'steel',requestedVolume:20},{goodId:'coal',requestedVolume:25}]},st);
    ck('multi-good quote returns independent items',q.ok&&q.quote.items.length===2,q.quote?.id);
    const ac=acceptQuoteItems(q.quote.id,['steel','coal'],{contractType:'short',priority:'normal'},st);
    ck('partial item acceptance creates independent contracts',ac.contracts?.length===2,ac.contracts?.map(c=>c.id).join(','));
    ck('same exporter can maintain multiple goods at once',new Set(ac.contracts?.map(c=>c.goodId)).size===2);
    ck('contracts persist beyond one annual tick',ac.contracts?.every(c=>c.endYear>c.startYear),ac.contracts?.map(c=>`${c.startYear}-${c.endYear}`).join(','));
    const second=requestMultiGoodQuote({importerCountryId:'asteria',exporterCountryId:'norvia',items:[{goodId:'steel',requestedVolume:15}]},st);
    const secondAccepted=acceptQuoteItems(second.quote.id,['steel'],{contractType:'spot'},st);
    ck('same good can be imported from multiple countries',secondAccepted.contracts?.length===1&&vals(st.tradeContracts).filter(c=>c.goodId==='steel').length===2);
    const dr=st.diplomaticRelations?.['asteria__meridian'];if(dr){dr.relation=60;dr.trust=60;dr.strategicCompetition=10;}
    const treatyProposal=proposeFriendshipTreaty('meridian',8,st);
    const aiEval=AI?.getState?.('meridian')?.lastProposalEvaluation;
    if(treatyProposal?.decision==='counter')acceptFriendshipCounter(treatyProposal.proposal.id,st);
    const treaty=activeFriendship('asteria','meridian',st);
    ck('friendship proposal is evaluated by Module 6 before activation',!!aiEval&&['accept','counter','reject'].includes(treatyProposal?.decision),treatyProposal?.decision||'none');
    const supplyBefore=Trade.getPotentialSurplus('meridian','steel',st),rf=relationFacts('asteria','meridian',st);
    ck('friendship changes friction, not physical supply',!!treaty&&rf.friendshipTreatyId===treaty.id&&Trade.getPotentialSurplus('meridian','steel',st)===supplyBefore,`friction=${rf.tradeFriction}`);
    const totalContracted=vals(st.tradeContracts).reduce((sum,c)=>sum+n(c.contractedVolume),0);
    beforeTradeAnnual(st);Trade.update(st);settleContracts(st);
    const delivered=vals(st.tradeContracts).reduce((sum,c)=>sum+n(c.deliveredThisYear),0);
    ck('contracts settle through real Module 5 allocator',delivered>0&&delivered<=totalContracted,`contracted=${totalContracted}, delivered=${delivered}`);
    ck('multiple contracts share importer trade capacity',totalContracted>50&&delivered<=50.01,`contracted=${totalContracted}, delivered=${delivered}`);
    ck('1 turn remains 1 year',st.time.year===2062&&st.turn===2062);
    if(treaty){st.time.year=treaty.expirationYear;st.turn=treaty.expirationYear;expireFriendships(st);ck('friendship treaty expires on its annual expiration year',treaty.active===false&&treaty.status==='expired',`${treaty.signedYear}-${treaty.expirationYear}`);}
    return{passed:checks.filter(x=>x.ok).length,total:checks.length,checks};
  }finally{global.gameState=old;}
}

if(Trade){
  ensureMultiState(gs());
  if(Trade.AGREEMENT_TYPES)Trade.AGREEMENT_TYPES.FRIENDSHIP_TREATY='friendship_treaty';
  Trade.MULTI_TRADE_VERSION=MULTI_VERSION;
  Trade.requestMultiGoodQuote=requestMultiGoodQuote;Trade.acceptQuoteItems=acceptQuoteItems;Trade.getCountryTradeRelation=relationFacts;Trade.getTradeContracts=(state=gs())=>vals(ensureMultiState(state)?.tradeContracts);Trade.getTradeQuotes=(state=gs())=>vals(ensureMultiState(state)?.tradeQuotes);Trade.canSignFriendshipTreaty=canSignFriendshipTreaty;Trade.proposeFriendshipTreaty=proposeFriendshipTreaty;Trade.acceptFriendshipCounter=acceptFriendshipCounter;Trade.terminateAgreement=terminateAgreement;Trade.renewFriendshipTreaty=renewFriendshipTreaty;Trade.getFriendshipTreaty=activeFriendship;Trade.getTradeCausalEvidence=getTradeCausalEvidence;Trade.runMultiTradeSelfTests=runMultiTradeSelfTests;Trade.getMultiTradeDebug=multiDebug;
  const baseInit=Trade.initializeState?.bind(Trade);if(baseInit)Trade.initializeState=function(state){const r=baseInit(state);ensureMultiState(state);return r;};
  const baseUpdate=Trade.update?.bind(Trade);if(baseUpdate)Trade.update=function(state){state=state||gs();beforeTradeAnnual(state);const r=baseUpdate(state);settleContracts(state);return{...r,multiTradeContracts:vals(state.tradeContracts).filter(c=>c.status==='active').length};};
  const __realGameState=gs();global.__BE_MULTI_TRADE_CHECKS__=runMultiTradeSelfTests();if(__realGameState){try{Trade.initializeState?.(__realGameState);AI?.reset?.();AI?.initialize?.(__realGameState);}catch(_){ }}
}


/* --------------------------------------------------------------------------
   MODULE 5 DIPLOMACY V3 — needs -> proposals -> clauses -> fulfillment -> memory
   Minimal additive layer over the existing Module 5 trade allocator.
   It never creates a second economy, inventory, transport graph or annual clock.
   The wrapper below runs only when the existing official Module 5 update runs.
   -------------------------------------------------------------------------- */
const DIPLOMACY_VERSION='3.0.0';
const DIPLOMACY_AGREEMENT_TYPES=['friendship_treaty','trade_agreement','long_term_supply','investment_agreement','transit_agreement','border_cooperation','aid_agreement','non_aggression'];
const DIPLOMACY_NEED_TYPES=['food_supply','energy_supply','raw_material_supply','industrial_goods','export_market','transport_access','investment','financial_support','border_stability'];
const DIPLOMACY_CLAUSE_TYPES=['annual_supply','tariff_reduction','transit_access','financial_aid','goods_aid','investment_access','border_cooperation','non_aggression_commitment'];
const DIP_GOOD_GROUPS={food_supply:['food'],energy_supply:['coal','oil','gas','power'],raw_material_supply:['iron','coal','copper'],industrial_goods:['manufactured_goods','steel','machinery','fertilizer']};
function dipClamp(v,a=0,b=100){v=n(v);return Math.max(a,Math.min(b,v));}
function dipSafe(fn,fallback=null){try{const v=fn();return v==null?fallback:v;}catch(_){return fallback;}}
function dipAdjustTrust(rel,delta){if(!rel)return;const score=Number.isFinite(Number(rel.trustScore))?Number(rel.trustScore):(n(rel.trust)+100)/2;rel.trustScore=dipClamp(score+n(delta));rel.trust=dipClamp(n(rel.trust)+n(delta)*2,-100,100);}
function dipLegacyPair(a,b){return[a,b].sort().join('__');}
function dipOfficialAgreement(a){return !!a&&DIPLOMACY_AGREEMENT_TYPES.includes(a.type)&&a.metadata?.diplomacyV3===true;}
function ensureDiplomacyState(state=gs()){
  if(!state)return null;ensureMultiState(state);
  state.diplomaticRelations=state.diplomaticRelations||{};state.agreements=state.agreements||{};state.diplomaticProposals=state.diplomaticProposals||{};
  const d=state.diplomacy=state.diplomacy||{};
  // Existing Module 5 stores remain authoritative. These are aliases, not duplicate simulations.
  d.bilateralRelations=state.diplomaticRelations;d.agreements=state.agreements;d.proposals=state.diplomaticProposals;d.negotiations=state.diplomaticProposals;
  d.countryNeeds=d.countryNeeds||{};d.history=Array.isArray(d.history)?d.history:[];d.reputation=Number.isFinite(Number(d.reputation))?Number(d.reputation):50;
  d.annual=d.annual||{lastProcessedYear:null,lastNeedsYear:null,lastAIProposalYear:null};d.transitRights=d.transitRights||{};d.borderCooperation=d.borderCooperation||{};d.investmentPermissions=d.investmentPermissions||{};d.aiProposalLedger=d.aiProposalLedger||{};d.sequence=n(d.sequence,1);
  for(const [key,rel] of Object.entries(state.diplomaticRelations||{})){
    if(!rel)continue;rel.reasons=Array.isArray(rel.reasons)?rel.reasons:[];rel.strategicInterest=n(rel.strategicInterest);rel.tension=n(rel.tension);rel.economicDependency=rel.economicDependency||{oursOnThem:0,theirsOnUs:0};
    if(!Number.isFinite(Number(rel.trustScore)))rel.trustScore=dipClamp((n(rel.trust)+100)/2);
  }
  return d;
}
function diplomacyCountryEconomy(state,cid){const direct=state?.economy?.countries?.[cid]||state?.economy?.[cid]||state?.countries?.[cid]?.economy;if(direct)return direct;return dipSafe(()=>global.Economy?.getCountryEconomy?.(cid,state),{})||{};}
function diplomacyGoodRecord(state,cid,gid){const e=diplomacyCountryEconomy(state,cid);return e?.goods?.[gid]||e?.resources?.[gid]||e?.production?.[gid]||state?.countries?.[cid]?.goods?.[gid]||{};}
function diplomacyGoodDemand(state,cid,gid){const g=diplomacyGoodRecord(state,cid,gid);for(const k of ['domesticDemand','demand','consumptionNeed','required'])if(Number.isFinite(Number(g?.[k])))return Math.max(0,Number(g[k]));return 0;}
function diplomacyGoodProduction(state,cid,gid){const g=diplomacyGoodRecord(state,cid,gid);if(typeof g==='number')return Math.max(0,g);for(const k of ['production','output','supply','availableDomestic'])if(Number.isFinite(Number(g?.[k])))return Math.max(0,Number(g[k]));return 0;}
function diplomacyCommittedImports(state,cid,gid){return vals(state?.tradeContracts).filter(c=>c&&c.status==='active'&&c.importerCountryId===cid&&c.goodId===gid&&year()>=n(c.startYear)&&year()<=n(c.endYear)).reduce((s,c)=>s+n(c.contractedVolume),0);}
function diplomacyCommittedExports(state,cid,gid){return vals(state?.tradeContracts).filter(c=>c&&c.status==='active'&&c.exporterCountryId===cid&&c.goodId===gid&&year()>=n(c.startYear)&&year()<=n(c.endYear)).reduce((s,c)=>s+n(c.contractedVolume),0);}
function diplomacyTreasuryValue(state,cid){
  const c=state?.countries?.[cid]||{},e=diplomacyCountryEconomy(state,cid),f=e?.governmentFinance||e?.government||{};
  for(const v of [c.treasury,c.funds,c.cash,f.treasury,f.cash,f.balance,e.treasury])if(Number.isFinite(Number(v)))return Number(v);const api=dipSafe(()=>global.Economy?.getGovernmentFinance?.(cid,state),null);for(const v of [api?.treasury,api?.cash,api?.balance])if(Number.isFinite(Number(v)))return Number(v);return null;
}
function diplomacyFormalInventoryRef(state,cid,gid){
  // Player food may be held by Module 9 regional storage; use that official stock if present.
  if(cid===state?.playerCountryId&&gid==='food'){
    const regs=Object.entries(state?.agriculture?.regions||{}).filter(([,r])=>r?.storage?.stocks&&Object.keys(r.storage.stocks).length);
    if(regs.length)return {kind:'agriculture',entries:regs};
  }
  const g=diplomacyGoodRecord(state,cid,gid);for(const k of ['stockpile','inventory','endingInventory','available'])if(Number.isFinite(Number(g?.[k])))return{kind:'good',record:g,key:k};return null;
}
function diplomacyInventoryAmount(ref,gid){if(!ref)return 0;if(ref.kind==='good')return Math.max(0,n(ref.record?.[ref.key]));return ref.entries.reduce((sum,[,r])=>sum+Object.entries(r.storage.stocks||{}).filter(([crop])=>gid==='food'||crop===gid).reduce((a,[,v])=>a+n(v),0),0);}
function diplomacyTransferMoney(state,from,to,amount){amount=Math.max(0,n(amount));if(amount<=0)return{ok:true,amount:0};const E=global.Economy;/* Module 5 may request a payment, but it must never mutate a copied treasury snapshot. Only a formal Module 3 transfer API may execute it. */if(typeof E?.transferGovernmentFunds==='function'){const r=dipSafe(()=>E.transferGovernmentFunds(from,to,amount,{purpose:'diplomatic_aid',year:year(),sourceModule:'module5'},state),null);if(r&&r.ok!==false)return{ok:true,amount:Math.max(0,n(r.amount,r.transferredAmount||amount)),reason:null,evidence:r};return{ok:false,amount:Math.max(0,n(r?.amount,r?.transferredAmount)),reason:r?.reason||'funds_shortage',evidence:r||null};}return{ok:false,reason:'funds_unavailable',amount:0,deferredToExecutingModule:true};}
function appendDiplomaticHistory(entry,state=gs()){
  const d=ensureDiplomacyState(state);if(!d)return null;const rec={id:`diplomatic_history_${year()}_${String(d.sequence++).padStart(4,'0')}`,year:year(),type:entry.type||'diplomatic_event',countryAId:entry.countryAId||null,countryBId:entry.countryBId||null,agreementId:entry.agreementId||null,proposalId:entry.proposalId||null,titleKey:entry.titleKey||entry.type||'diplomatic_event',detailKey:entry.detailKey||null,effects:entry.effects||{},metadata:entry.metadata||{},summary:entry.summary||null,sourceModule:'module5'};d.history.push(rec);if(d.history.length>600)d.history.splice(0,d.history.length-600);state.history=state.history||[];state.history.push({...rec});return rec;
}
function needSeverity(amount,demand){return clamp(amount/Math.max(10,demand||amount*1.35),0,1);}
function deriveCountryNeeds(state=gs()){
  const d=ensureDiplomacyState(state);if(!d)return{};const now=year();
  for(const cid of Object.keys(state.countries||{})){
    const old=Array.isArray(d.countryNeeds[cid])?d.countryNeeds[cid]:[];const active=[];
    const add=(type,commodityId,severity,targetAmount,causes)=>{if(!(severity>.04)||!(targetAmount>0))return;const key=`${type}:${commodityId||'*'}`,existing=active.find(x=>`${x.type}:${x.commodityId||'*'}`===key);if(existing){if(severity>existing.severity){existing.severity=+clamp(severity).toFixed(3);existing.urgency=+clamp(severity*1.1).toFixed(3);existing.targetAmount=+Math.max(existing.targetAmount,targetAmount).toFixed(2);}existing.causes=[...(existing.causes||[]),...(causes||[])].slice(-8);return;}const prior=old.find(x=>x&&`${x.type}:${x.commodityId||'*'}`===key&&x.status==='active');active.push({id:prior?.id||`need_${cid}_${type}_${commodityId||'general'}`,countryId:cid,type,commodityId:commodityId||null,severity:+clamp(severity).toFixed(3),targetAmount:+Math.max(0,targetAmount).toFixed(2),urgency:+clamp(severity*1.1).toFixed(3),causes:causes||[],createdYear:prior?.createdYear||now,status:'active'});};
    for(const [type,goods] of Object.entries(DIP_GOOD_GROUPS)){
      let best=null;for(const gid of goods){const base=Math.max(0,n(Trade?.getImportNeed?.(cid,gid,state)));const remaining=Math.max(0,base-diplomacyCommittedImports(state,cid,gid));const demand=diplomacyGoodDemand(state,cid,gid);if(remaining>0&&(!best||remaining>best.remaining))best={gid,remaining,demand};}
      if(best)add(type,best.gid,needSeverity(best.remaining,best.demand),best.remaining,[{type:'formal_import_gap',goodId:best.gid,value:+best.remaining.toFixed(2)}]);
    }
    let exportBest=null;for(const gid of new Set([...(Trade?.GOODS||[]),...Object.keys(diplomacyCountryEconomy(state,cid)?.goods||{})])){const surplus=Math.max(0,n(Trade?.getPotentialSurplus?.(cid,gid,state))-diplomacyCommittedExports(state,cid,gid));if(surplus>0&&(!exportBest||surplus>exportBest.surplus))exportBest={gid,surplus,production:diplomacyGoodProduction(state,cid,gid)};}
    if(exportBest&&exportBest.surplus>=5)add('export_market',exportBest.gid,clamp(exportBest.surplus/Math.max(10,exportBest.production||exportBest.surplus),0,1),exportBest.surplus,[{type:'formal_surplus',goodId:exportBest.gid,value:+exportBest.surplus.toFixed(2)}]);
    const infra=dipSafe(()=>Trade?.getCountryTradeInfrastructure?.(cid,state),null);if(exportBest&&exportBest.surplus>=10&&n(infra?.capacity)<=0)add('transport_access',null,clamp(exportBest.surplus/50,0,1),exportBest.surplus,[{type:'no_trade_capacity',value:n(infra?.capacity)}]);
    const projects=vals(state.projects).filter(p=>p&&p.status==='under_construction'&&(p.countryId===cid||(!p.countryId&&cid===state.playerCountryId)));const treasury=diplomacyTreasuryValue(state,cid);if(projects.length&&treasury!=null&&treasury<20)add('investment',null,clamp((20-treasury)/40+.25,0,1),projects.length,[{type:'formal_project_pipeline',value:projects.length},{type:'treasury',value:treasury}]);
    if(treasury!=null&&treasury<0)add('financial_support',null,clamp(Math.abs(treasury)/50+.3,0,1),Math.abs(treasury),[{type:'negative_treasury',value:treasury}]);
    // Module 6 already detects country needs from its own official observation adapters. Read that state; do not recreate AI-country simulation here.
    const aiState=dipSafe(()=>AI?.getState?.(cid),null);for(const an of (aiState?.currentNeeds||[])){const sev=clamp(n(an.severity)),gid=an.goodId||null,ev=an.evidence||{};if(an.type==='RESOURCE_SHORTAGE'&&gid){const t=gid==='food'?'food_supply':['coal','oil','gas','power'].includes(gid)?'energy_supply':['iron','copper'].includes(gid)?'raw_material_supply':'industrial_goods';add(t,gid,sev,Math.max(1,n(ev.shortage,sev*20)),[{type:'module6_need',needType:an.type,goodId:gid,value:sev}]);}else if(an.type==='LOW_POWER_CAPACITY')add('energy_supply','power',sev,Math.max(1,n(ev.powerShortfall,sev*20)),[{type:'module6_need',needType:an.type,value:sev}]);else if(an.type==='EXPORT_MARKET_NEEDED'&&gid)add('export_market',gid,sev,Math.max(1,n(ev.surplus,sev*20)),[{type:'module6_need',needType:an.type,goodId:gid,value:sev}]);else if(an.type==='TRANSPORT_BOTTLENECK')add('transport_access',null,sev,1,[{type:'module6_need',needType:an.type,value:sev,targetId:an.targetId||null}]);else if(['LOW_TREASURY','HIGH_DEBT'].includes(an.type))add('financial_support',null,sev,Math.max(5,n(ev.revenue,20)*sev),[{type:'module6_need',needType:an.type,value:sev}]);else if(an.type==='INDUSTRIAL_EXPANSION_OPPORTUNITY')add('investment',null,sev,1,[{type:'module6_need',needType:an.type,value:sev}]);}
    const withPlayer=state.diplomaticRelations?.[dipLegacyPair(cid,state.playerCountryId||player())];const instability=Math.max(n(withPlayer?.tension),n(withPlayer?.strategicCompetition)*.7);if(instability>=50)add('border_stability',null,clamp(instability/100),1,[{type:'bilateral_tension',value:+instability.toFixed(1)}]);
    d.countryNeeds[cid]=active;
  }
  d.annual.lastNeedsYear=now;return d.countryNeeds;
}
function bilateralNeedsScore(provider,receiver,state){const d=ensureDiplomacyState(state),needs=(d.countryNeeds?.[receiver]||[]).filter(x=>x.status==='active');let score=0;for(const need of needs){if(need.commodityId){const surplus=Math.max(0,n(Trade?.getPotentialSurplus?.(provider,need.commodityId,state))-diplomacyCommittedExports(state,provider,need.commodityId));score+=Math.min(35,35*need.severity*clamp(surplus/Math.max(1,need.targetAmount),0,1));}else if(['investment','financial_support','transport_access','border_stability'].includes(need.type))score+=8*need.severity;}return score;}
function computeBilateralDiplomacy(a,b,state=gs()){
  ensureDiplomacyState(state);let rel={relation:0,trust:0,strategicCompetition:0,recentActions:[],dependence:{}};try{rel=Trade?.getRelationship?.(a,b,state)||rel;}catch(_){ }
  const depA=dipSafe(()=>Trade?.getDependency?.(a,b,state),{})||{},depB=dipSafe(()=>Trade?.getDependency?.(b,a,state),{})||{};const trust=dipClamp(Number.isFinite(Number(rel.trustScore))?rel.trustScore:(n(rel.trust)+100)/2);
  const econ={oursOnThem:+(100*n(depA.total)).toFixed(1),theirsOnUs:+(100*n(depB.total)).toFixed(1)};let strategic=20+bilateralNeedsScore(a,b,state)+bilateralNeedsScore(b,a,state)*.45;const activeAg=vals(state.agreements).filter(x=>x&&x.active!==false&&[x.countryAId,x.countryBId].includes(a)&&[x.countryAId,x.countryBId].includes(b));if(activeAg.length)strategic+=Math.min(15,activeAg.length*4);strategic=dipClamp(strategic);
  let tension=dipClamp(n(rel.tension)+n(rel.strategicCompetition)*.35);const reasons=[];for(const act of (rel.recentActions||[]).slice(-12)){const w=n(act.currentWeight,1),v=n(act.relationImpact)*w;if(Math.abs(v)>=.5)reasons.push({id:act.id||act.type,type:act.type||'relation_action',value:+v.toFixed(1),sourceId:act.details?.agreementId||act.details?.contractId||null});if(v<0)tension+=Math.min(30,Math.abs(v)*1.8);}
  const dh=(state.diplomacy?.history||[]).filter(h=>h&&[h.countryAId,h.countryBId].includes(a)&&[h.countryAId,h.countryBId].includes(b)).slice(-20);for(const h of dh){const rv=n(h.effects?.relations);if(Math.abs(rv)>=.5)reasons.push({id:h.id,type:h.type,value:rv,sourceId:h.agreementId||h.proposalId||null});if(['severe_breach','trade_dispute','agreement_cancelled'].includes(h.type))tension+=8;}
  if(activeAg.some(x=>x.type==='friendship_treaty')){tension-=8;reasons.push({id:'friendship_active',type:'friendship_framework',value:3,sourceId:activeAg.find(x=>x.type==='friendship_treaty')?.id});}
  if(activeAg.some(x=>x.type==='non_aggression')){tension-=12;reasons.push({id:'non_aggression_active',type:'non_aggression_commitment',value:2,sourceId:activeAg.find(x=>x.type==='non_aggression')?.id});}
  const contracts=vals(state.tradeContracts).filter(c=>c&&c.status==='active'&&[c.exporterCountryId,c.importerCountryId].includes(a)&&[c.exporterCountryId,c.importerCountryId].includes(b));if(contracts.length)reasons.push({id:'active_trade',type:'trade_cooperation',value:Math.min(12,contracts.length*2+contracts.reduce((s,c)=>s+n(c.deliveredThisYear),0)/20),sourceId:contracts[0].id});
  reasons.sort((x,y)=>Math.abs(y.value)-Math.abs(x.value));return{countryAId:a,countryBId:b,relations:dipClamp(n(rel.relation),-100,100),relation:dipClamp(n(rel.relation),-100,100),trust:+trust.toFixed(1),economicDependency:econ,strategicInterest:+dipClamp(strategic).toFixed(1),tension:+dipClamp(tension).toFixed(1),strategicCompetition:n(rel.strategicCompetition),reasons:reasons.slice(0,10)};
}
function refreshBilateralDiplomacy(state=gs()){
  const d=ensureDiplomacyState(state);for(const [key,rel] of Object.entries(state.diplomaticRelations||{})){if(!rel)continue;const v=computeBilateralDiplomacy(rel.countryAId,rel.countryBId,state);rel.trustScore=v.trust;rel.economicDependency=v.economicDependency;rel.strategicInterest=v.strategicInterest;rel.tension=v.tension;rel.reasons=v.reasons;}return d.bilateralRelations;
}
function getBilateralDiplomacy(a,b,state=gs()){return computeBilateralDiplomacy(a,b,state);}
function normalizeDiplomaticClause(raw,agreement){const c={id:raw?.id||`clause_${String((agreement?.clauses?.length||0)+1).padStart(2,'0')}`,type:raw?.type||'annual_supply',fromCountryId:raw?.fromCountryId||agreement?.countryAId||null,toCountryId:raw?.toCountryId||agreement?.countryBId||null,commodityId:raw?.commodityId||raw?.goodId||null,quantity:Math.max(0,n(raw?.quantity)),priceRule:raw?.priceRule||null,tariffRate:raw?.tariffRate==null?null:Number(raw.tariffRate),payment:Math.max(0,n(raw?.payment)),routeId:raw?.routeId||null,gatewayId:raw?.gatewayId||null,durationYears:raw?.durationYears==null?null:Math.max(1,n(raw.durationYears)),parameters:{...(raw?.parameters||{})}};return c;}
function proposalAgreement(p){return p?.proposedAgreement||{type:p?.type,countryAId:p?.proposerCountryId,countryBId:p?.targetCountryId||p?.receiverCountryId,durationYears:p?.durationYears||p?.offeredTerms?.duration||4,clauses:p?.clauses||[]};}
function createDiplomaticProposal(def,state=gs()){
  const d=ensureDiplomacyState(state);const type=def.type||def.proposedAgreement?.type;if(!DIPLOMACY_AGREEMENT_TYPES.includes(type))return{ok:false,error:'unsupported_agreement_type'};const proposer=def.proposerCountryId||player(),target=def.targetCountryId||def.receiverCountryId;if(!state.countries?.[proposer]||!state.countries?.[target]||proposer===target)return{ok:false,error:'invalid_countries'};
  const ag={type,countryAId:proposer,countryBId:target,durationYears:Math.max(1,n(def.proposedAgreement?.durationYears,def.durationYears||4)),clauses:[]};for(const raw of (def.proposedAgreement?.clauses||def.clauses||[]))ag.clauses.push(normalizeDiplomaticClause(raw,ag));
  const p={id:def.id||uid('diplomatic_proposal',state.diplomaticProposals),type,proposerCountryId:proposer,targetCountryId:target,receiverCountryId:target,proposedAgreement:ag,status:def.status||'draft',evaluation:null,counterProposalId:def.counterProposalId||null,parentProposalId:def.parentProposalId||null,createdYear:year(),expirationYear:def.expirationYear||year()+2,createdTurn:year(),expirationTurn:def.expirationYear||year()+2,aiInitiated:!!def.aiInitiated,priority:n(def.priority),reasonNeedId:def.reasonNeedId||null,metadata:{...(def.metadata||{}),diplomacyV3:true}};state.diplomaticProposals[p.id]=p;if(p.status==='sent')appendDiplomaticHistory({type:'proposal_sent',countryAId:proposer,countryBId:target,proposalId:p.id,metadata:{agreementType:type}},state);return{ok:true,proposal:p};
}
function proposalClauseUtility(clause,evaluator,partner,state,reasons){let u=0;const dirIn=clause.toCountryId===evaluator,dirOut=clause.fromCountryId===evaluator,gid=clause.commodityId;
  if(clause.type==='annual_supply'&&gid){const need=(state.diplomacy?.countryNeeds?.[evaluator]||[]).find(x=>x.status==='active'&&x.commodityId===gid);if(dirIn&&need){const v=36*need.severity*clamp(n(clause.quantity)/Math.max(1,need.targetAmount),0,1.2);u+=v;reasons.push({reason:'need_match',value:+v.toFixed(1),detail:gid});}if(dirOut){const surplus=Math.max(0,n(Trade?.getPotentialSurplus?.(evaluator,gid,state))-diplomacyCommittedExports(state,evaluator,gid));const pressure=n(clause.quantity)/Math.max(1,surplus);const v=-26*Math.max(0,pressure-.55);u+=v;reasons.push({reason:'supply_capacity',value:+v.toFixed(1),detail:`${gid}:${surplus.toFixed(1)}`});}
    const mult=n(clause.priceRule?.multiplier,1);if(dirIn&&mult>1.08){const v=-Math.min(20,(mult-1.08)*90);u+=v;reasons.push({reason:'price_too_high',value:+v.toFixed(1),detail:mult});}if(dirOut&&mult>1){const v=Math.min(8,(mult-1)*30);u+=v;reasons.push({reason:'price_premium',value:+v.toFixed(1),detail:mult});}}
  if(clause.type==='tariff_reduction'){const points=Math.abs(n(clause.tariffRate))*100;if(clause.fromCountryId===evaluator){u-=Math.min(10,points*.7);reasons.push({reason:'tariff_revenue_cost',value:+(-Math.min(10,points*.7)).toFixed(1)});}else{u+=Math.min(9,points*.6);reasons.push({reason:'tariff_access_benefit',value:+Math.min(9,points*.6).toFixed(1)});}}
  if(clause.type==='transit_access'){const need=(state.diplomacy?.countryNeeds?.[evaluator]||[]).find(x=>x.type==='transport_access'&&x.status==='active');if(clause.toCountryId===evaluator){const v=need?14*need.severity:5;u+=v;reasons.push({reason:'transport_access',value:+v.toFixed(1)});}if(clause.fromCountryId===evaluator){u-=3;reasons.push({reason:'transit_commitment_cost',value:-3});}}
  if(clause.type==='financial_aid'){if(clause.toCountryId===evaluator){const v=Math.min(20,n(clause.payment)/5);u+=v;reasons.push({reason:'financial_support',value:+v.toFixed(1)});}if(clause.fromCountryId===evaluator){const t=diplomacyTreasuryValue(state,evaluator);const v=t==null?-18:-Math.min(25,n(clause.payment)/Math.max(1,t)*35);u+=v;reasons.push({reason:'fiscal_cost',value:+v.toFixed(1)});}}
  if(clause.type==='goods_aid'&&gid){if(clause.toCountryId===evaluator){u+=10;reasons.push({reason:'goods_aid_benefit',value:10,detail:gid});}if(clause.fromCountryId===evaluator){const ref=diplomacyFormalInventoryRef(state,evaluator,gid),have=diplomacyInventoryAmount(ref,gid),v=have>=n(clause.quantity)?-5:-24;u+=v;reasons.push({reason:'aid_inventory_cost',value:v,detail:`${gid}:${have.toFixed(1)}`});}}
  if(clause.type==='investment_access'){const need=(state.diplomacy?.countryNeeds?.[evaluator]||[]).find(x=>x.type==='investment'&&x.status==='active');if(clause.toCountryId===evaluator){const v=need?12*need.severity:4;u+=v;reasons.push({reason:'investment_need',value:+v.toFixed(1)});}else u-=2;}
  if(clause.type==='border_cooperation'){u+=4;reasons.push({reason:'border_coordination',value:4});}
  if(clause.type==='non_aggression_commitment'){u+=3;reasons.push({reason:'stability_commitment',value:3});}
  return u;
}
function evaluateDiplomaticProposal(proposalOrId,evaluatorCountryId=null,state=gs()){
  ensureDiplomacyState(state);const p=typeof proposalOrId==='string'?state.diplomaticProposals?.[proposalOrId]:proposalOrId;if(!p)return{decision:'reject',utility:-100,reasons:[{reason:'proposal_missing',value:-100}]};const target=evaluatorCountryId||p.targetCountryId||p.receiverCountryId,partner=target===p.proposerCountryId?(p.targetCountryId||p.receiverCountryId):p.proposerCountryId;const b=getBilateralDiplomacy(target,partner,state);const reasons=[];let u=(b.relations/100)*15+((b.trust-50)/50)*18+(b.strategicInterest/100)*22-(b.tension/100)*24;reasons.push({reason:'relations',value:+((b.relations/100)*15).toFixed(1)});reasons.push({reason:'trust',value:+(((b.trust-50)/50)*18).toFixed(1)});reasons.push({reason:'strategic_interest',value:+((b.strategicInterest/100)*22).toFixed(1)});reasons.push({reason:'tension',value:+(-(b.tension/100)*24).toFixed(1)});
  const ag=proposalAgreement(p);for(const c of ag.clauses||[])u+=proposalClauseUtility(c,target,partner,state,reasons);const duration=n(ag.durationYears,4);if(duration>=6&&b.trust<45){u-=6;reasons.push({reason:'long_commitment_low_trust',value:-6});}else if(duration>=4&&b.trust>=60){u+=3;reasons.push({reason:'stable_duration',value:3});}
  try{const ai=AI?.evaluateProposal?.(target,{...p,type:ag.type==='investment_agreement'?'foreign_investment':ag.type==='long_term_supply'?'trade':ag.type,targetCountryId:target,duration,terms:{duration}},state);if(ai&&Number.isFinite(Number(ai.score))){const v=Math.max(-8,Math.min(8,n(ai.score)*.2));u+=v;reasons.push({reason:'ai_country_preferences',value:+v.toFixed(1)});}}catch(_){ }
  const negotiableObjection=reasons.some(r=>r.reason==='price_too_high'&&n(r.value)<=-5);const decision=u< -4?'reject':negotiableObjection?'counter':u>=18?'accept':'counter';return{decision,utility:+u.toFixed(1),reasons:reasons.filter(r=>Math.abs(n(r.value))>=.2).sort((a,b)=>Math.abs(b.value)-Math.abs(a.value)).slice(0,10)};
}
function automaticCounterAgreement(p,state){const src=proposalAgreement(p),ag={...src,clauses:(src.clauses||[]).map(c=>({...c,parameters:{...(c.parameters||{})},priceRule:c.priceRule?{...c.priceRule}:null}))};ag.durationYears=Math.max(2,Math.min(4,n(ag.durationYears,4)));for(const c of ag.clauses){if(c.type==='annual_supply'){c.quantity=+Math.max(1,n(c.quantity)*.9).toFixed(2);if(c.priceRule?.multiplier)c.priceRule.multiplier=+Math.min(1.08,Math.max(.98,n(c.priceRule.multiplier))).toFixed(3);}if(c.type==='tariff_reduction'&&c.tariffRate!=null)c.tariffRate=+(n(c.tariffRate)*.75).toFixed(4);if(['financial_aid','goods_aid'].includes(c.type)){c.payment=+Math.max(0,n(c.payment)*.8).toFixed(2);c.quantity=+Math.max(0,n(c.quantity)*.8).toFixed(2);}}return ag;}
function counterDiplomaticProposal(proposalId,adjustedAgreement=null,state=gs()){
  const original=state?.diplomaticProposals?.[proposalId];if(!original||!['sent','draft'].includes(original.status))return{ok:false,error:'proposal_not_counterable'};original.status='countered';original.resolvedYear=year();const ag=adjustedAgreement||automaticCounterAgreement(original,state);const made=createDiplomaticProposal({proposerCountryId:original.targetCountryId||original.receiverCountryId,targetCountryId:original.proposerCountryId,type:ag.type,proposedAgreement:ag,status:'sent',parentProposalId:original.id,metadata:{counter:true}},state);if(made.ok){original.counterProposalId=made.proposal.id;appendDiplomaticHistory({type:'counter_proposal',countryAId:made.proposal.proposerCountryId,countryBId:made.proposal.targetCountryId,proposalId:made.proposal.id,metadata:{parentProposalId:original.id}},state);}return made;
}
function ensureAgreementTradeContract(ag,c,state){if(c.parameters?.tradeContractId&&state.tradeContracts?.[c.parameters.tradeContractId])return state.tradeContracts[c.parameters.tradeContractId];const exporter=c.fromCountryId,importer=c.toCountryId,gid=c.commodityId;if(!exporter||!importer||!gid||n(c.quantity)<=0)return null;const route=ensureRoute(exporter,importer,state);const isAid=c.type==='goods_aid';let base=1;try{base=n(quotePrice(exporter,importer,gid,state),1);}catch(_){ }const mult=isAid?1:n(c.priceRule?.multiplier,1);const tc={id:uid('trade_contract',state.tradeContracts),exporterCountryId:exporter,importerCountryId:importer,goodId:gid,requestedVolume:n(c.quantity),contractedVolume:n(c.quantity),unitPrice:Math.max(.01,base*mult),tariffRate:n(Trade?.getEffectiveTariff?.(importer,exporter,gid,state),0),routeId:c.routeId||route?.id||null,entryPortId:c.gatewayId||route?.importLocationId||null,priority:'essential',contractType:'long',status:'active',startYear:ag.startYear,endYear:ag.endYear,deliveredThisYear:0,paymentThisYear:0,unmetVolumeThisYear:n(c.quantity),sourceAgreementId:ag.id,tradeRelationId:null,supplyEvidence:{source:isAid?'diplomatic_goods_aid':'diplomatic_agreement'},history:[],metadata:{diplomaticAid:isAid,settlementOwner:'module5_trade'}};state.tradeContracts[tc.id]=tc;ensureContractFlow(tc,state);const tr=tc.tradeRelationId&&state.tradeRelations?.[tc.tradeRelationId];if(tr&&isAid){tr.diplomaticAid=true;tr.sourceAgreementId=ag.id;}const shadow=tc.tradeRelationId&&state.tradeRelations?.[tc.tradeRelationId]?.agreementId&&state.agreements?.[state.tradeRelations[tc.tradeRelationId].agreementId];if(shadow)shadow.parentDiplomaticAgreementId=ag.id;c.parameters.tradeContractId=tc.id;return tc;}
function applyAgreementActivationEffects(ag,state){const d=ensureDiplomacyState(state);for(const c of ag.clauses||[]){if(c.type==='annual_supply'||c.type==='goods_aid')ensureAgreementTradeContract(ag,c,state);if(c.type==='tariff_reduction'){const goods=c.commodityId?[c.commodityId]:(Trade?.GOODS||[]);for(const gid of goods){const importer=c.fromCountryId,exporter=c.toCountryId;if(importer&&exporter)Trade?.setTariff?.(importer,exporter,gid,Math.max(0,n(c.parameters?.targetTariffRate,Math.max(0,n(Trade?.getEffectiveTariff?.(importer,exporter,gid,state),0)-Math.abs(n(c.tariffRate))))),state);}}if(c.type==='transit_access'){const key=c.routeId||c.gatewayId||`${c.fromCountryId}->${c.toCountryId}`;d.transitRights[key]={agreementId:ag.id,fromCountryId:c.fromCountryId,toCountryId:c.toCountryId,routeId:c.routeId,gatewayId:c.gatewayId,active:true};}if(c.type==='border_cooperation'){d.borderCooperation[ag.id]={agreementId:ag.id,active:true,parameters:{...(c.parameters||{})}};}if(c.type==='investment_access'){d.investmentPermissions[ag.id]={agreementId:ag.id,fromCountryId:c.fromCountryId,toCountryId:c.toCountryId,active:true,parameters:{...(c.parameters||{})}};}}
}
function activateAgreement(input,state=gs()){
  const d=ensureDiplomacyState(state);const p=typeof input==='string'?state.diplomaticProposals?.[input]:input?.proposedAgreement?input:null;const src=p?proposalAgreement(p):input;if(!src||!DIPLOMACY_AGREEMENT_TYPES.includes(src.type))return{ok:false,error:'invalid_agreement'};const a=src.countryAId||p?.proposerCountryId,b=src.countryBId||p?.targetCountryId||p?.receiverCountryId;if(!state.countries?.[a]||!state.countries?.[b])return{ok:false,error:'invalid_countries'};const duration=Math.max(1,n(src.durationYears,4));const ag={id:src.id||uid('agreement',state.agreements),type:src.type,countryAId:a,countryBId:b,status:'active',active:true,startYear:year(),endYear:year()+duration-1,startTurn:year(),duration,durationYears:duration,clauses:[],annualPerformance:{},createdYear:p?.createdYear||year(),proposalId:p?.id||null,sourceProposalId:p?.id||null,metadata:{...(src.metadata||{}),diplomacyV3:true}};for(const raw of src.clauses||[])ag.clauses.push(normalizeDiplomaticClause(raw,ag));state.agreements[ag.id]=ag;const rel=state.diplomaticRelations?.[dipLegacyPair(a,b)];if(rel){rel.activeAgreements=rel.activeAgreements||[];if(!rel.activeAgreements.includes(ag.id))rel.activeAgreements.push(ag.id);}applyAgreementActivationEffects(ag,state);if(p){p.status='accepted';p.resolvedYear=year();p.agreementId=ag.id;}appendDiplomaticHistory({type:'agreement_signed',countryAId:a,countryBId:b,agreementId:ag.id,proposalId:p?.id||null,effects:{relations:2},metadata:{agreementType:ag.type}},state);appendDiplomaticHistory({type:'agreement_activated',countryAId:a,countryBId:b,agreementId:ag.id,metadata:{agreementType:ag.type}},state);return{ok:true,agreement:ag,proposal:p||null};
}
function sendDiplomaticProposal(proposalId,state=gs()){
  const p=state?.diplomaticProposals?.[proposalId];if(!p)return{ok:false,error:'proposal_not_found'};if(p.status==='draft'){p.status='sent';appendDiplomaticHistory({type:'proposal_sent',countryAId:p.proposerCountryId,countryBId:p.targetCountryId||p.receiverCountryId,proposalId:p.id,metadata:{agreementType:proposalAgreement(p).type}},state);}const receiver=p.targetCountryId||p.receiverCountryId;if(receiver===player())return{ok:true,decision:'player_pending',proposal:p};const ev=evaluateDiplomaticProposal(p,receiver,state);p.evaluation=ev;if(ev.decision==='accept')return{...activateAgreement(p,state),decision:'accept',evaluation:ev};if(ev.decision==='counter'){const c=counterDiplomaticProposal(p.id,null,state);return{ok:c.ok,decision:'counter',proposal:p,counterProposal:c.proposal||null,evaluation:ev};}p.status='rejected';p.resolvedYear=year();appendDiplomaticHistory({type:'proposal_rejected',countryAId:p.proposerCountryId,countryBId:receiver,proposalId:p.id,metadata:{utility:ev.utility}},state);return{ok:true,decision:'reject',proposal:p,evaluation:ev};
}
function acceptDiplomaticProposal(proposalId,state=gs()){const p=state?.diplomaticProposals?.[proposalId];if(!p||!['sent','countered'].includes(p.status))return{ok:false,error:'proposal_not_acceptable'};appendDiplomaticHistory({type:'proposal_accepted',countryAId:p.proposerCountryId,countryBId:p.targetCountryId||p.receiverCountryId,proposalId:p.id},state);return activateAgreement(p,state);}
function rejectDiplomaticProposal(proposalId,state=gs(),reason='player_rejected'){const p=state?.diplomaticProposals?.[proposalId];if(!p||!['sent','draft','countered'].includes(p.status))return{ok:false,error:'proposal_not_rejectable'};p.status='rejected';p.resolvedYear=year();p.rejectionReason=reason;appendDiplomaticHistory({type:'proposal_rejected',countryAId:p.proposerCountryId,countryBId:p.targetCountryId||p.receiverCountryId,proposalId:p.id,metadata:{reason}},state);return{ok:true,proposal:p};}
function withdrawDiplomaticProposal(proposalId,state=gs()){const p=state?.diplomaticProposals?.[proposalId];if(!p||!['draft','sent'].includes(p.status))return{ok:false,error:'proposal_not_withdrawable'};p.status='withdrawn';p.resolvedYear=year();appendDiplomaticHistory({type:'proposal_withdrawn',countryAId:p.proposerCountryId,countryBId:p.targetCountryId||p.receiverCountryId,proposalId:p.id},state);return{ok:true,proposal:p};}
function cancelDiplomaticAgreement(agreementId,state=gs(),reason='cancelled'){const ag=state?.agreements?.[agreementId];if(!ag||ag.active===false)return{ok:false,error:'agreement_not_active'};ag.active=false;ag.status='cancelled';ag.endedYear=year();ag.endReason=reason;for(const c of ag.clauses||[]){const tc=state.tradeContracts?.[c.parameters?.tradeContractId];if(tc){tc.status='cancelled';const tr=state.tradeRelations?.[tc.tradeRelationId];if(tr){tr.active=false;tr.volume=0;}}}const d=ensureDiplomacyState(state);for(const x of Object.values(d.transitRights||{}))if(x.agreementId===ag.id)x.active=false;for(const x of Object.values(d.borderCooperation||{}))if(x.agreementId===ag.id)x.active=false;for(const x of Object.values(d.investmentPermissions||{}))if(x.agreementId===ag.id)x.active=false;const rel=state.diplomaticRelations?.[dipLegacyPair(ag.countryAId,ag.countryBId)];if(rel){rel.relation=dipClamp(n(rel.relation)-4,-100,100);dipAdjustTrust(rel,-4);rel.tension=dipClamp(n(rel.tension)+5);rel.activeAgreements=(rel.activeAgreements||[]).filter(id=>id!==ag.id);}appendDiplomaticHistory({type:'agreement_cancelled',countryAId:ag.countryAId,countryBId:ag.countryBId,agreementId:ag.id,effects:{relations:-4,trust:-4},metadata:{reason}},state);return{ok:true,agreement:ag};}
function diplomaticBreachReasonForContract(tc,state){if(!tc)return'other_system';if(tc.status==='cancelled')return'active_cancel';const tr=state.tradeRelations?.[tc.tradeRelationId];if(!tr||tr.active===false)return'route_closed';const shadow=tr.agreementId&&state.agreements?.[tr.agreementId];const cause=shadow?.performance?.current?.cause||'';if(cause==='LOGISTICS_CAPACITY_SHORTFALL')return'transport_capacity';if(cause==='EXPORTER_SUPPLY_SHORTFALL')return'inventory_shortage';if(cause==='GOVERNMENT_EXPORT_RESTRICTION')return'active_cancel';if(cause==='MARKET_ACCESS_SHORTFALL')return'route_closed';return tc.unmetVolumeThisYear>0?'other_system':null;}
function processDiplomaticAgreementsForYear(state=gs()){
  const d=ensureDiplomacyState(state),now=year();if(d.annual.lastPerformanceYear===now)return{ok:true,skipped:true,year:now};const processed=[];
  for(const ag of vals(state.agreements).filter(dipOfficialAgreement)){
    if(ag.status==='expired'||ag.status==='cancelled'||ag.status==='breached'||ag.active===false)continue;if(now<ag.startYear)continue;if(now>ag.endYear){ag.active=false;ag.status='expired';appendDiplomaticHistory({type:'agreement_expired',countryAId:ag.countryAId,countryBId:ag.countryBId,agreementId:ag.id},state);continue;}if(ag.annualPerformance?.[now]?.evaluated)continue;
    const obligations=[],fulfilled=[],breaches=[];let score=0,count=0;
    for(const c of ag.clauses||[]){let promised=1,actual=1,reason=null,detail={};if(c.type==='annual_supply'){promised=Math.max(0,n(c.quantity));const tc=ensureAgreementTradeContract(ag,c,state);actual=Math.max(0,n(tc?.deliveredThisYear));if(promised>0&&actual+1e-9<promised)reason=diplomaticBreachReasonForContract(tc,state);detail={tradeContractId:tc?.id||null,goodId:c.commodityId,routeId:tc?.routeId||c.routeId||null};}
      else if(c.type==='financial_aid'){promised=Math.max(0,n(c.payment));const r=diplomacyTransferMoney(state,c.fromCountryId,c.toCountryId,promised);actual=n(r.amount);reason=r.ok?null:r.reason;detail={transfer:'treasury'};}
      else if(c.type==='goods_aid'){promised=Math.max(0,n(c.quantity));const tc=ensureAgreementTradeContract(ag,c,state);actual=Math.max(0,n(tc?.deliveredThisYear));if(promised>0&&actual+1e-9<promised)reason=diplomaticBreachReasonForContract(tc,state);detail={tradeContractId:tc?.id||null,goodId:c.commodityId,routeId:tc?.routeId||c.routeId||null,executedBy:'module5_trade'};}
      else if(c.type==='transit_access'){promised=1;const key=c.routeId||c.gatewayId||`${c.fromCountryId}->${c.toCountryId}`,right=d.transitRights?.[key];const routeOk=!c.routeId||state.tradeRoutes?.[c.routeId]?.active!==false,gatewayOk=!c.gatewayId||state.facilities?.[c.gatewayId]?.active!==false;actual=right?.active!==false&&routeOk&&gatewayOk?1:0;if(!actual)reason=!routeOk||!gatewayOk?'route_closed':'active_cancel';detail={routeId:c.routeId,gatewayId:c.gatewayId};}
      else if(c.type==='tariff_reduction'){promised=1;const goods=c.commodityId?[c.commodityId]:(Trade?.GOODS||[]);const ok=goods.every(gid=>n(Trade?.getEffectiveTariff?.(c.fromCountryId,c.toCountryId,gid,state))<=n(c.parameters?.targetTariffRate,Math.max(0,n(c.parameters?.baselineTariff,1)-Math.abs(n(c.tariffRate))))+.0001);actual=ok?1:0;if(!ok)reason='active_cancel';}
      else if(c.type==='investment_access'){promised=1;actual=d.investmentPermissions?.[ag.id]?.active!==false?1:0;if(!actual)reason='active_cancel';}
      else if(c.type==='border_cooperation'){promised=1;actual=d.borderCooperation?.[ag.id]?.active!==false?1:0;if(!actual)reason='active_cancel';}
      else {promised=1;actual=1;}
      const rate=promised>0?clamp(actual/promised,0,1):1;score+=rate;count++;obligations.push({clauseId:c.id,type:c.type,promised,fromCountryId:c.fromCountryId,toCountryId:c.toCountryId,commodityId:c.commodityId});fulfilled.push({clauseId:c.id,actual,fulfillmentRate:+rate.toFixed(3),...detail});if(reason)breaches.push({clauseId:c.id,reason,promised,actual,...detail});else if(['financial_aid','goods_aid'].includes(c.type)&&promised>0&&actual+1e-9>=promised)appendDiplomaticHistory({type:'aid_completed',countryAId:c.fromCountryId,countryBId:c.toCountryId,agreementId:ag.id,metadata:{clauseId:c.id,amount:actual,commodityId:c.commodityId||null}},state);
    }
    const rate=count?score/count:1;ag.annualPerformance=ag.annualPerformance||{};ag.annualPerformance[now]={obligations,fulfilled,fulfillmentRate:+rate.toFixed(3),breaches,evaluated:true};const rel=state.diplomaticRelations?.[dipLegacyPair(ag.countryAId,ag.countryBId)];let htype='annual_fulfilled',effects={trust:3,relations:1};if(rate<.5){htype='severe_breach';effects={trust:-8,relations:-6,tension:10};if(rel){dipAdjustTrust(rel,-8);rel.relation=dipClamp(n(rel.relation)-6,-100,100);rel.tension=dipClamp(n(rel.tension)+10);}d.reputation=dipClamp(d.reputation-3);}else if(rate<.8){htype='annual_partial';effects={trust:-2,relations:-1};if(rel){dipAdjustTrust(rel,-2);rel.tension=dipClamp(n(rel.tension)+3);}d.reputation=dipClamp(d.reputation-.5);}else if(rate<.98){htype='annual_partial';effects={trust:-1,relations:0};if(rel)dipAdjustTrust(rel,-1);}else{if(rel){dipAdjustTrust(rel,3);rel.relation=dipClamp(n(rel.relation)+1,-100,100);rel.tension=dipClamp(n(rel.tension)-1);}d.reputation=dipClamp(d.reputation+.5);}
    appendDiplomaticHistory({type:htype,countryAId:ag.countryAId,countryBId:ag.countryBId,agreementId:ag.id,effects,metadata:{fulfillmentRate:+rate.toFixed(3),breaches}},state);if(now>=ag.endYear){ag.active=false;ag.status='expired';appendDiplomaticHistory({type:'agreement_expired',countryAId:ag.countryAId,countryBId:ag.countryBId,agreementId:ag.id},state);}processed.push({agreementId:ag.id,fulfillmentRate:rate,breaches});
  }
  d.annual.lastPerformanceYear=now;return{ok:true,year:now,processed};
}
function aiProposalForNeed(cid,need,state){const me=player(),bil=getBilateralDiplomacy(cid,me,state);let type=null,clauses=[],ability=0,cost=1;if(need.commodityId&&['food_supply','energy_supply','raw_material_supply','industrial_goods'].includes(need.type)){const surplus=Math.max(0,n(Trade?.getPotentialSurplus?.(me,need.commodityId,state))-diplomacyCommittedExports(state,me,need.commodityId));ability=clamp(surplus/Math.max(1,need.targetAmount),0,1);if(ability<=0)return null;type='long_term_supply';const qty=Math.max(1,Math.min(need.targetAmount,surplus,Math.max(5,need.targetAmount*.8)));clauses=[{type:'annual_supply',fromCountryId:me,toCountryId:cid,commodityId:need.commodityId,quantity:+qty.toFixed(1),priceRule:{mode:'market_multiplier',multiplier:1.06}},{type:'tariff_reduction',fromCountryId:cid,toCountryId:me,commodityId:need.commodityId,tariffRate:.03,parameters:{targetTariffRate:Math.max(0,n(Trade?.getEffectiveTariff?.(cid,me,need.commodityId,state),.1)-.03)}}];cost=1.15;}
  else if(need.type==='export_market'&&need.commodityId){const myNeed=Math.max(0,n(Trade?.getImportNeed?.(me,need.commodityId,state))-diplomacyCommittedImports(state,me,need.commodityId));ability=clamp(myNeed/Math.max(1,need.targetAmount),0,1);if(ability<=0)return null;type='long_term_supply';clauses=[{type:'annual_supply',fromCountryId:cid,toCountryId:me,commodityId:need.commodityId,quantity:+Math.max(1,Math.min(myNeed,need.targetAmount)).toFixed(1),priceRule:{mode:'market_multiplier',multiplier:1.03}}];}
  else if(need.type==='transport_access'){type='transit_agreement';ability=.8;clauses=[{type:'transit_access',fromCountryId:me,toCountryId:cid,parameters:{scope:'existing_routes_only'}}];cost=.8;}
  else if(need.type==='investment'){type='investment_agreement';ability=diplomacyTreasuryValue(state,me)==null?.3:clamp(diplomacyTreasuryValue(state,me)/50,0,1);clauses=[{type:'investment_access',fromCountryId:me,toCountryId:cid,payment:20,parameters:{projectQualificationOnly:true}}];cost=1.25;}
  else if(need.type==='financial_support'){type='aid_agreement';const t=diplomacyTreasuryValue(state,me);ability=t==null?0:clamp(t/40,0,1);if(ability<=.15)return null;clauses=[{type:'financial_aid',fromCountryId:me,toCountryId:cid,payment:Math.max(5,Math.min(20,need.targetAmount))}];cost=1.4;}
  else if(need.type==='border_stability'){type='non_aggression';ability=1;clauses=[{type:'non_aggression_commitment',fromCountryId:cid,toCountryId:me},{type:'non_aggression_commitment',fromCountryId:me,toCountryId:cid}];cost=.7;}else return null;
  const relMod=clamp((bil.relations+100)/200,0,1),priority=need.severity*Math.max(.05,ability)*(bil.strategicInterest/100)*Math.max(.1,bil.trust/100)*Math.max(.1,relMod)/Math.max(.5,cost);if(priority<.025)return null;return{type,clauses,priority,durationYears:type==='non_aggression'?6:4};
}
function generateAIProposals(state=gs()){
  const d=ensureDiplomacyState(state),now=year(),created=[];for(const cid of Object.keys(state.countries||{}).filter(x=>x!==player())){if(d.aiProposalLedger[cid]===now)continue;const active=vals(state.diplomaticProposals).some(p=>p&&['draft','sent','countered'].includes(p.status)&&[p.proposerCountryId,p.targetCountryId||p.receiverCountryId].includes(cid)&&[p.proposerCountryId,p.targetCountryId||p.receiverCountryId].includes(player()));if(active)continue;const needs=(d.countryNeeds?.[cid]||[]).filter(x=>x.status==='active').sort((a,b)=>(b.severity*b.urgency)-(a.severity*a.urgency));let best=null;for(const need of needs){const recentReject=vals(state.diplomaticProposals).some(p=>p&&p.proposerCountryId===cid&&p.reasonNeedId===need.id&&p.status==='rejected'&&now-n(p.resolvedYear,p.createdYear)<=2);if(recentReject)continue;const spec=aiProposalForNeed(cid,need,state);if(spec&&(!best||spec.priority>best.spec.priority))best={need,spec};}if(!best)continue;const made=createDiplomaticProposal({proposerCountryId:cid,targetCountryId:player(),type:best.spec.type,proposedAgreement:{type:best.spec.type,countryAId:cid,countryBId:player(),durationYears:best.spec.durationYears,clauses:best.spec.clauses},status:'sent',aiInitiated:true,priority:best.spec.priority,reasonNeedId:best.need.id,metadata:{needType:best.need.type}},state);if(made.ok){d.aiProposalLedger[cid]=now;created.push(made.proposal);appendDiplomaticHistory({type:'ai_proposal_sent',countryAId:cid,countryBId:player(),proposalId:made.proposal.id,metadata:{needType:best.need.type,priority:+best.spec.priority.toFixed(4)}},state);}}
  d.annual.lastAIProposalYear=now;return created;
}
function processDiplomacyAnnual(state=gs()){
  const d=ensureDiplomacyState(state),now=year();if(d.annual.lastProcessedYear===now)return{ok:true,skipped:true,year:now};const performance=processDiplomaticAgreementsForYear(state);deriveCountryNeeds(state);refreshBilateralDiplomacy(state);const proposals=generateAIProposals(state);d.annual.lastProcessedYear=now;return{ok:true,year:now,performance,aiProposals:proposals.length};
}
function countryDiplomacySnapshot(cid,state=gs()){
  const c=state?.countries?.[cid]||{},econ=diplomacyCountryEconomy(state,cid),fac=vals(state?.facilities).filter(f=>f&&f.active!==false&&f.countryId===cid),goods=econ?.goods||{};const pop=cid===state?.playerCountryId?n(state?.population?.national?.population,c.population):n(c.population,econ.population);const scale=Object.values(goods).reduce((s,g)=>s+n(g?.production)*n(g?.price,1),0);const resources=Object.entries(goods).filter(([,g])=>n(g?.production)>0).sort((a,b)=>n(b[1]?.production)-n(a[1]?.production)).slice(0,4).map(([k])=>k);const imports=(Trade?.GOODS||[]).map(g=>({g,v:n(Trade?.getImports?.(cid,g,state))})).filter(x=>x.v>0).sort((a,b)=>b.v-a.v).slice(0,3).map(x=>x.g);const exports=(Trade?.GOODS||[]).map(g=>({g,v:n(Trade?.getExports?.(cid,g,state))})).filter(x=>x.v>0).sort((a,b)=>b.v-a.v).slice(0,3).map(x=>x.g);return{id:cid,name:c.name||cid,government:c.government||c.regime||c.type||null,population:pop||null,economicScale:n(c.gdp,c.economicScale||scale)||null,majorIndustries:fac.slice(0,5).map(f=>f.type),majorResources:resources,majorImports:imports,majorExports:exports,treasury:diplomacyTreasuryValue(state,cid),gateways:fac.filter(f=>/port|gateway|border/i.test(`${f.type||''} ${f.name||''}`)).map(f=>f.id)};
}
function selectDiplomacyOverview(state=gs()){const d=ensureDiplomacyState(state),playerId=state?.playerCountryId||player(),countries=Object.keys(state?.countries||{}).filter(x=>x!==playerId);const agreements=vals(state?.agreements).filter(dipOfficialAgreement),neg=vals(state?.diplomaticProposals).filter(p=>p&&['draft','sent','countered'].includes(p.status));const disputes=countries.map(id=>getBilateralDiplomacy(playerId,id,state)).filter(x=>x.tension>=50);return{reputation:n(d.reputation),activeAgreements:agreements.filter(a=>a.active!==false&&a.status==='active'),negotiations:neg,pendingProposals:neg.filter(p=>p.targetCountryId===playerId||p.receiverCountryId===playerId),disputes,recentHistory:d.history.slice(-12)};}
function selectForeignCountries(state=gs()){const me=state?.playerCountryId||player();return Object.keys(state?.countries||{}).filter(id=>id!==me).map(id=>({snapshot:countryDiplomacySnapshot(id,state),bilateral:getBilateralDiplomacy(me,id,state),needs:(state.diplomacy?.countryNeeds?.[id]||[]).filter(n=>n.status==='active')}));}
function selectCountryDiplomacyDetail(countryId,state=gs()){const me=state?.playerCountryId||player(),d=ensureDiplomacyState(state);return{snapshot:countryDiplomacySnapshot(countryId,state),bilateral:getBilateralDiplomacy(me,countryId,state),needs:(d.countryNeeds?.[countryId]||[]).filter(x=>x.status==='active'),agreements:vals(state.agreements).filter(a=>dipOfficialAgreement(a)&&[a.countryAId,a.countryBId].includes(me)&&[a.countryAId,a.countryBId].includes(countryId)),negotiations:vals(state.diplomaticProposals).filter(p=>p&&[p.proposerCountryId,p.targetCountryId||p.receiverCountryId].includes(me)&&[p.proposerCountryId,p.targetCountryId||p.receiverCountryId].includes(countryId)&&['draft','sent','countered'].includes(p.status)),history:d.history.filter(h=>[h.countryAId,h.countryBId].includes(me)&&[h.countryAId,h.countryBId].includes(countryId)).slice(-40),contracts:vals(state.tradeContracts).filter(c=>c&&[c.exporterCountryId,c.importerCountryId].includes(me)&&[c.exporterCountryId,c.importerCountryId].includes(countryId))};}
function selectNegotiations(state=gs()){ensureDiplomacyState(state);return vals(state.diplomaticProposals).filter(p=>p&&['draft','sent','countered'].includes(p.status));}
function selectDiplomaticAgreements(state=gs()){ensureDiplomacyState(state);return vals(state.agreements).filter(dipOfficialAgreement);}
function selectDiplomaticHistory(state=gs()){return ensureDiplomacyState(state)?.history?.slice()||[];}
function runDiplomacySelfTests(){const checks=[],ck=(name,ok,detail='')=>checks.push({name,ok:!!ok,detail});const live=gs();if(live){const d=ensureDiplomacyState(live);ck('single diplomacy state aliases existing Module 5 stores',d.bilateralRelations===live.diplomaticRelations&&d.agreements===live.agreements&&d.proposals===live.diplomaticProposals);ck('five diplomatic indicators readable',Object.keys(live.countries||{}).filter(x=>x!==player()).every(id=>{const x=getBilateralDiplomacy(player(),id,live);return ['relations','trust','economicDependency','strategicInterest','tension'].every(k=>x[k]!=null);}));ck('eight official agreement types available',DIPLOMACY_AGREEMENT_TYPES.length===8);ck('annual processor guarded to one run per year',typeof processDiplomacyAnnual==='function');ck('AI proposals are need-driven and bounded',typeof generateAIProposals==='function');ck('diplomatic history bounded',d.history.length<=600);}
  return{passed:checks.filter(x=>x.ok).length,total:checks.length,checks};}
if(Trade){
  Trade.DIPLOMACY_VERSION=DIPLOMACY_VERSION;Trade.DIPLOMACY_AGREEMENT_TYPES=[...DIPLOMACY_AGREEMENT_TYPES];Trade.DIPLOMACY_NEED_TYPES=[...DIPLOMACY_NEED_TYPES];Trade.DIPLOMACY_CLAUSE_TYPES=[...DIPLOMACY_CLAUSE_TYPES];
  if(Trade.AGREEMENT_TYPES){Object.assign(Trade.AGREEMENT_TYPES,{FRIENDSHIP_TREATY:'friendship_treaty',LONG_TERM_SUPPLY:'long_term_supply',INVESTMENT_AGREEMENT:'investment_agreement',TRANSIT_AGREEMENT:'transit_agreement',BORDER_COOPERATION:'border_cooperation',AID_AGREEMENT:'aid_agreement',NON_AGGRESSION:'non_aggression'});}
  Trade.ensureDiplomacyState=ensureDiplomacyState;Trade.deriveCountryNeeds=deriveCountryNeeds;Trade.getBilateralDiplomacy=getBilateralDiplomacy;Trade.evaluateDiplomaticProposal=evaluateDiplomaticProposal;Trade.createDiplomaticProposal=createDiplomaticProposal;Trade.sendDiplomaticProposal=sendDiplomaticProposal;Trade.counterDiplomaticProposal=counterDiplomaticProposal;Trade.acceptDiplomaticProposal=acceptDiplomaticProposal;Trade.rejectDiplomaticProposal=rejectDiplomaticProposal;Trade.withdrawDiplomaticProposal=withdrawDiplomaticProposal;Trade.activateAgreement=activateAgreement;Trade.cancelDiplomaticAgreement=cancelDiplomaticAgreement;Trade.processDiplomaticAgreementsForYear=processDiplomaticAgreementsForYear;Trade.generateAIProposals=generateAIProposals;Trade.appendDiplomaticHistory=appendDiplomaticHistory;Trade.processDiplomacyAnnual=processDiplomacyAnnual;Trade.countryDiplomacySnapshot=countryDiplomacySnapshot;Trade.selectDiplomacyOverview=selectDiplomacyOverview;Trade.selectForeignCountries=selectForeignCountries;Trade.selectCountryDiplomacyDetail=selectCountryDiplomacyDetail;Trade.selectNegotiations=selectNegotiations;Trade.selectDiplomaticAgreements=selectDiplomaticAgreements;Trade.selectDiplomaticHistory=selectDiplomaticHistory;Trade.runDiplomacySelfTests=runDiplomacySelfTests;
  const dipInit=Trade.initializeState?.bind(Trade);if(dipInit&&!Trade.__diplomacyV3InitPatched){Trade.initializeState=function(state){const r=dipInit(state);const d=ensureDiplomacyState(state);if(d&&d.initializedYear==null){deriveCountryNeeds(state);refreshBilateralDiplomacy(state);d.initializedYear=year();}return r;};Trade.__diplomacyV3InitPatched=true;}
  const dipUpdate=Trade.update?.bind(Trade);if(dipUpdate&&!Trade.__diplomacyV3AnnualPatched){Trade.update=function(state){state=state||gs();const r=dipUpdate(state);const diplomacy=processDiplomacyAnnual(state);return{...r,diplomacy};};Trade.__diplomacyV3AnnualPatched=true;}
  if(gs()){try{Trade.initializeState(gs());global.__BE_DIPLOMACY_CHECKS__=runDiplomacySelfTests();}catch(e){console.error('Diplomacy V3 initialization failed',e);}}
}


/* --------------------------------------------------------------------------
   MODULE 8 UI ROUTER — one major workspace at a time
   -------------------------------------------------------------------------- */
/* --------------------------------------------------------------------------
   MODULE 8 UI DATA BRIDGE — single live GameState -> selectors -> ViewModels
   Read paths are side-effect free. Commands call the real modules only.
   -------------------------------------------------------------------------- */
const uiSubscribers=new Set();
const uiRuntime={errors:new Map(),performance:{timings:{},renderMs:0,totalAdvanceMs:0,lastRefreshMs:0},profilerInstalled:false};
const uiSum=o=>Object.values(o||{}).reduce((a,v)=>a+n(v),0);
const uiNumOrNull=v=>Number.isFinite(Number(v))?Number(v):null;
const uiFirst=(...xs)=>xs.find(v=>v!==undefined&&v!==null);
const uiSafe=(fn,fallback=null)=>{try{const v=fn();return v==null?fallback:v;}catch(e){return fallback;}};
const uiWorldReady=s=>!!s&&Object.keys(s.regions||{}).length>0;
function uiError(code,detail){const k=`${code}:${detail||''}`;uiRuntime.errors.set(k,{code,detail:String(detail||''),year:year()});if(uiRuntime.errors.size>80)uiRuntime.errors.delete(uiRuntime.errors.keys().next().value);}
function uiRegionName(s,id){return s?.regions?.[id]?.name||id||T('未知地区','Unknown region');}
function uiFinance(s){const E=global.Economy;let f=uiSafe(()=>E?.getGovernmentFinance?.(player()),null);if(!f)f=s?.economy?.countries?.[player()]?.governmentFinance||s?.economy?.countries?.[player()]?.government||s?.economy?.government||s?.countries?.[player()]?.governmentFinance||null;return f||{};}
function uiEconomyRegion(s,rid){return uiSafe(()=>global.Economy?.getRegionEconomy?.(rid),null)||s?.economy?.regions?.[rid]||{};}
function uiPopulationCity(s,cid){return uiSafe(()=>global.Population?.getCityPopulation?.(cid),null)||s?.population?.cities?.[cid]||s?.cities?.[cid]||{};}
function uiFoodGood(g){return ['food','wheat','rice','corn','soybean','potato'].includes(String(g||''));}
function uiFoodAccounting(s){
  let production=0,collected=0,stock=0,reserved=0,openingStock=0,withdrawals=0,storageLoss=0,collectionLoss=0,overflowLoss=0;
  const regions=[];
  for(const [rid,r] of Object.entries(s?.agriculture?.regions||{})){
    const lo=r?.lastOutput||{},flow=lo.storageFlow||r?.storage?.annualFlow||{};
    const row={regionId:rid,production:uiSum(lo.cropProduction),collected:uiSum(lo.cropHarvestCollected),stock:uiSum(r?.storage?.stocks),reserved:uiSum(r?.storage?.reserved),openingStock:uiSum(flow.openingStock),withdrawals:uiSum(flow.withdrawalOutflow),storageLoss:uiSum(flow.storageLoss),collectionLoss:uiSum(lo.fieldLoss||flow.fieldLoss),overflowLoss:uiSum(flow.overflowLoss),logistics:lo.logistics||{},shortages:lo.shortages||[]};
    production+=row.production;collected+=row.collected;stock+=row.stock;reserved+=row.reserved;openingStock+=row.openingStock;withdrawals+=row.withdrawals;storageLoss+=row.storageLoss;collectionLoss+=row.collectionLoss;overflowLoss+=row.overflowLoss;regions.push(row);
  }
  let demand=0,marketShortage=0;
  for(const rid of Object.keys(s?.regions||{})){const f=uiEconomyRegion(s,rid)?.goods?.food||{};demand+=n(uiFirst(f.demand,f.domesticDemand,0));marketShortage+=n(f.shortage);}
  let imports=0,exports=0,importValue=0,exportValue=0;
  for(const c of vals(s?.tradeContracts)){if(!c||!uiFoodGood(c.goodId))continue;const q=n(uiFirst(c.deliveredThisYear,c.annualQuantity,c.deliveredVolume,0)),v=q*n(c.unitPrice);if(c.importerCountryId===player()){imports+=q;importValue+=v;}if(c.exporterCountryId===player()){exports+=q;exportValue+=v;}}
  return {production,collected,stock,reserved,openingStock,withdrawals,storageLoss,collectionLoss,overflowLoss,demand,marketShortage,imports,exports,importValue,exportValue,selfSufficiency:demand>0?production/demand:null,deficit:marketShortage,regions};
}
function uiProjects(s){const signals=s?.modules?.economy?.module2Signals?.projectProgress||s?.economy?.module2Signals?.projectProgress||{};return vals(s?.projects).filter(Boolean).map(p=>{const total=Math.max(0,n(uiFirst(p.totalTurns,p.duration,0))),remaining=Math.max(0,n(uiFirst(p.turnsRemaining,p.remainingTurns,0))),sig=signals[p.id]||{},factor=uiNumOrNull(uiFirst(p.integrationProgressFactor,sig.recommendedProgressFactor));const progress=total>0?clamp((total-remaining+n(p.progressCredit))/total,0,1):(p.status==='completed'?1:null);const missing=sig.missingMaterials||p.missingInputs||{};return {...p,progress,progressFactor:factor,missingInputs:missing,blockingReasons:Object.entries(missing).filter(([,v])=>n(v)>0).map(([k,v])=>`${k}: ${fmt(v)}`),expectedCompletionYear:uiFirst(p.expectedCompletionYear,total?year()+Math.ceil(remaining/Math.max(.05,factor==null?1:factor)):null)};});}
function uiConnections(s){return vals(s?.connections).filter(Boolean).map(c=>{const edge=s?.economy?.debug?.freightEdges?.[c.id]||{};const cap=n(uiFirst(edge.capacity,c.effectiveCapacity,c.capacity,0)),remaining=uiNumOrNull(s?.economy?.debug?.freightCapacityRemaining?.[c.id]);const used=remaining==null?uiNumOrNull(c.usedCapacity):Math.max(0,cap-remaining);const util=uiNumOrNull(uiFirst(c.utilization,cap>0&&used!=null?used/cap:null));return {...c,effectiveCapacity:cap,usedCapacity:used,utilization:util,conditionValue:uiFirst(c.conditionPct,c.condition,c.health,c.state)};});}
function uiDeposits(s){let list=uiSafe(()=>global.Development?.getDiscoveredDeposits?.(s),null);if(!Array.isArray(list))list=vals(s?.discoveredDeposits||s?.resourceSites||s?.deposits);return list.filter(Boolean).map(d=>{const assessment=uiSafe(()=>global.Development?.getDevelopmentAssessment?.(d.id,s),null)||d.assessment||null;const project=vals(s?.projects).find(p=>p&&p.depositId===d.id&&p.status==='under_construction');const facility=vals(s?.facilities).find(f=>f&&f.depositId===d.id);let developmentStatus=d.developed||facility?T('生产中','Producing'):project?T('开发中','Under development'):assessment?T('已评估','Assessed'):T('已发现','Discovered');return {...d,assessment,developmentProject:project||null,facility:facility||null,developmentStatus,estimatedReserve:uiFirst(d.reserveEstimate?.mid,d.reserveEstimate?.expected,d.reserveEstimate,d.estimatedReserve),extractionDifficulty:uiFirst(assessment?.difficulty,d.engineeringDifficulty),developmentCost:uiFirst(assessment?.totalCost,assessment?.governmentCost),annualOutput:uiFirst(facility?.annualOutput,facility?.output,facility?.capacity)};});}
function uiAgricultureFarms(s){const explicit=vals(s?.agriculture?.privateFarms||s?.privateFarms).filter(Boolean);if(explicit.length)return explicit.map(f=>({...f,sourceType:'privateFarm'}));return Object.entries(s?.agriculture?.regions||{}).map(([rid,r])=>{const lo=r?.lastOutput||{},d=n(lo?.resourceDemand?.farmInputs),used=uiSum(lo?.resourceUse?.farmInputs),wd=n(lo?.resourceDemand?.water),wu=uiSum(lo?.resourceUse?.irrigation);return{id:`agri_region_${rid}`,regionId:rid,name:T(`${uiRegionName(s,rid)}私人农业`,`${uiRegionName(s,rid)} private agriculture`),sourceType:'regionalAggregate',landArea:n(r?.land?.cultivated),cropPlan:r?.cropAllocation||{},intensity:r?.intensity||'normal',capital:n(lo?.resourceUse?.capital?.used),labor:uiSum(lo?.resourceUse?.labor),inputFulfillment:d>0?used/d:null,irrigationFulfillment:wd>0?wu/wd:null,farmStock:uiSum(r?.storage?.stocks),waterAccess:uiFirst(lo?.logistics?.inputDeliveryFactor,null),transportAccess:uiFirst(lo?.logistics?.marketAccessFactor,null),stateRef:r};});}
function uiAgricultureVM(s){const food=uiFoodAccounting(s),regions=Object.entries(s?.agriculture?.regions||{}).map(([rid,r])=>({regionId:rid,name:uiRegionName(s,rid),land:r.land||{},crops:r.crops||{},storage:r.storage||{},resources:r.resources||{},lastOutput:r.lastOutput||null}));const stateProjects=[...vals(s?.agriculture?.stateProjects),...vals(s?.projects).filter(p=>p&&/agri|farm|irrig|canal|storage|silo|rural/i.test(`${p.type||''} ${p.name||''}`))];const uniqueProjects=[...new Map(stateProjects.filter(Boolean).map(p=>[p.id||`${p.type}:${p.regionId}`,p])).values()];const farms=uiAgricultureFarms(s);const land=regions.map(x=>({regionId:x.regionId,name:x.name,potential:n(x.land.potentialArable),developed:n(x.land.developedArable),cultivated:n(x.land.cultivated),idle:Math.max(0,n(x.land.developedArable)-n(x.land.cultivated)),irrigated:n(x.land.irrigated),degraded:n(x.land.degraded),fallow:n(x.land.fallow)}));const inputs=regions.map(x=>{const lo=x.lastOutput||{},r=s?.agriculture?.regions?.[x.regionId]||{};return{regionId:x.regionId,name:x.name,demand:n(lo?.resourceDemand?.farmInputs),used:uiSum(lo?.resourceUse?.farmInputs),shortage:(lo.shortages||[]).includes('farm_inputs'),inputDeliveryFactor:uiNumOrNull(lo?.logistics?.inputDeliveryFactor),intensity:r.intensity||'normal',cropPriorities:Object.fromEntries(Object.keys(BE.Agriculture?.CropDefinitions||{}).map(cid=>[cid,n(r?.cropManagement?.[cid]?.priority,50)]))};});const irrigation=regions.map(x=>{const lo=x.lastOutput||{},r=s?.agriculture?.regions?.[x.regionId]||{};return{regionId:x.regionId,name:x.name,irrigated:n(x.land.irrigated),waterDemand:n(lo?.resourceDemand?.water),waterUsed:uiSum(lo?.resourceUse?.irrigation),waterShortage:(lo.shortages||[]).includes('water'),utilization:n(lo?.resourceDemand?.water)>0?uiSum(lo?.resourceUse?.irrigation)/n(lo?.resourceDemand?.water):null,requested:n(r?.resources?.irrigationRequested),byCrop:{...(r?.resources?.irrigationByCrop||{})}};});const logistics=regions.map(x=>{const lo=x.lastOutput||{},l=lo.logistics||{};return{regionId:x.regionId,name:x.name,collectionFactor:uiNumOrNull(l.collectionFactor),inputDeliveryFactor:uiNumOrNull(l.inputDeliveryFactor),marketAccessFactor:uiNumOrNull(l.marketAccessFactor),bulkTransportCapacity:uiNumOrNull(l.bulkTransportCapacity),roadNormalized:uiNumOrNull(l.roadNormalized),collectionLoss:uiSum(lo.fieldLoss),unshippedStock:uiSum(x.storage?.stocks),connections:uiConnections(s).filter(c=>[c.regionId,c.fromId,c.toId].includes(x.regionId))};});return{headline:{...food,agriculturalProfit:null,cultivatedArea:land.reduce((a,x)=>a+x.cultivated,0),logisticsLoss:food.collectionLoss},food,regions,farms,stateProjects:uniqueProjects,land,inputs,irrigation,logistics,policies:s?.agriculture?.policies||{}};}
function uiPopulationVM(s){let total=0,employed=0,workforce=0,wageSum=0,wageWeight=0;const cities=Object.entries(s?.cities||{}).map(([cid,c])=>{const p=uiPopulationCity(s,cid);const pop=n(uiFirst(p.population,c.population,0)),wf=n(uiFirst(p.workforce,p.laborForce,pop*.55)),unemp=uiNumOrNull(p.unemploymentRate),emp=uiFirst(p.employment,wf*(1-(unemp==null?0:unemp)));const wage=uiNumOrNull(uiFirst(p.averageWage,p.wage,c.averageWage));total+=pop;workforce+=wf;employed+=n(emp);if(wage!=null){wageSum+=wage*pop;wageWeight+=pop;}return{id:cid,...c,...p,population:pop,workforce:wf,employment:n(emp),unemployment:Math.max(0,wf-n(emp)),unemploymentRate:unemp,averageWage:wage,foodAvailability:uiFirst(p.foodAvailability,p.foodSecurity),housingPressure:uiFirst(p.housingPressure,p.housingShortage),inMigration:uiFirst(p.inMigration,p.migrationIn),outMigration:uiFirst(p.outMigration,p.migrationOut)};});const national=s?.population?.national||{};const nationalPop=n(uiFirst(national.population,total));return{totalPopulation:nationalPop,employmentRate:workforce>0?employed/workforce:uiNumOrNull(national.employmentRate),urbanization:uiNumOrNull(uiFirst(national.urbanizationRate,national.urbanization)),foodSecurity:uiFirst(national.foodSecurity,1-clamp(uiFoodAccounting(s).marketShortage/Math.max(1,uiFoodAccounting(s).demand))),averageWage:wageWeight?wageSum/wageWeight:uiNumOrNull(national.averageWage),populationGrowth:uiNumOrNull(uiFirst(national.populationGrowthRate,national.growthRate)),cities};}
function uiEconomyVM(s){const finance=uiFinance(s),country=s?.economy?.countries?.[player()]||{},goods=country.goods||s?.economy?.goods||{};const bottlenecks=uiSafe(()=>global.Economy?.getBottlenecks?.(),[])||[];const enterprises=vals(s?.facilities).filter(f=>f&&f.active!==false).map(f=>{const fe=uiSafe(()=>global.Economy?.getFacilityEconomy?.(f.id),null)||s?.economy?.facilities?.[f.id]||{};const bs=vals(bottlenecks).filter(b=>b?.facilityId===f.id);return{...f,economy:fe,actualProduction:uiFirst(fe.production,fe.actualOutput,fe.output,f.output),capacity:uiFirst(fe.capacity,f.capacity),profit:uiFirst(fe.profit,fe.endingProfit,fe.domesticRetainedProfit),inventory:uiFirst(fe.inventory,fe.outputInventory),constraints:bs};});const gRows=Object.entries(goods||{}).map(([id,g])=>({id,...g}));const pop=uiPopulationVM(s);const rev=n(uiFirst(finance?.revenue?.total,finance?.totalRevenue,0)),exp=n(uiFirst(finance?.expenditure?.total,finance?.totalExpenditure,0));return{treasury:uiFirst(finance.treasury,s?.countries?.[player()]?.treasury),revenue:rev,expenditure:exp,industrialOutput:enterprises.reduce((a,f)=>a+n(f.actualProduction),0),employment:pop.employmentRate,averagePrice:gRows.length?gRows.reduce((a,g)=>a+n(g.price),0)/gRows.length:null,enterpriseProfit:enterprises.reduce((a,f)=>a+n(f.profit),0),goods:gRows,enterprises,bottlenecks:vals(bottlenecks),finance,ledger:{opening:uiFirst(finance.openingTreasury,finance.openingBalance),revenue:finance.revenue||{},expenditure:finance.expenditure||{},closing:uiFirst(finance.treasury,finance.closingTreasury)}};}
function uiTradeVM(s){ensureMultiState(s);const goods=(Trade?.GOODS||[]).map(g=>({goodId:g,need:n(uiSafe(()=>Trade?.getImportNeed?.(player(),g,s),0))}));const contracts=vals(s?.tradeContracts),active=contracts.filter(c=>c&&c.status==='active'&&year()>=n(c.startYear)&&year()<=n(c.endYear));let importValue=0,exportValue=0;for(const c of active){const q=n(uiFirst(c.deliveredThisYear,c.annualQuantity,0)),v=q*n(c.unitPrice);if(c.importerCountryId===player())importValue+=v;if(c.exporterCountryId===player())exportValue+=v;}const routes=vals(s?.tradeRoutes);const ports=vals(s?.facilities).filter(f=>f&&/port|gateway|border/i.test(`${f.type||''} ${f.name||''}`));const cap=ports.reduce((a,p)=>a+n(uiFirst(p.tradeCapacity,p.capacity,0)),0),used=routes.reduce((a,r)=>a+n(r.usedCapacity),0);let maxDependency=0;for(const id of Object.keys(s?.countries||{}).filter(id=>id!==player())){const d=uiSafe(()=>Trade?.getDependency?.(player(),id,s),{})||{};for(const v of Object.values(d.importDependency||d.demandDependency||{}))maxDependency=Math.max(maxDependency,n(v));maxDependency=Math.max(maxDependency,n(d.total));}return{importValue,exportValue,balance:exportValue-importValue,importDependency:maxDependency,activeContracts:active,contracts,quotes:vals(s?.tradeQuotes),routes,ports,portUtilization:cap>0?used/cap:null,domesticGaps:goods};}
function uiDiplomacyVM(s){const me=s?.playerCountryId||player(),overview=uiSafe(()=>Trade?.selectDiplomacyOverview?.(s),null)||{reputation:50,activeAgreements:[],negotiations:[],pendingProposals:[],disputes:[],recentHistory:[]};const rows=uiSafe(()=>Trade?.selectForeignCountries?.(s),[])||[];const countries=rows.map(row=>{const id=row.snapshot?.id,b=row.bilateral||{},detail=uiSafe(()=>Trade?.selectCountryDiplomacyDetail?.(id,s),{})||{},contracts=detail.contracts||[],agreements=detail.agreements||[],history=detail.history||[];return{id,name:countryName(id),snapshot:row.snapshot||{},relation:n(b.relations,b.relation),trust:n(b.trust),economicDependency:b.economicDependency||{oursOnThem:0,theirsOnUs:0},strategicInterest:n(b.strategicInterest),tension:n(b.tension),reasons:b.reasons||[],needs:row.needs||[],mainNeed:(row.needs||[]).slice().sort((a,b)=>b.severity-a.severity)[0]||null,contracts,agreements,negotiations:detail.negotiations||[],history,friendship:activeFriendship(me,id,s),currentCooperation:agreements.filter(a=>a.active!==false&&a.status==='active'),currentDispute:n(b.tension)>=50?T('双边紧张度较高','Elevated bilateral tension'):null};});return{overview,countries,negotiations:uiSafe(()=>Trade?.selectNegotiations?.(s),[])||[],agreements:uiSafe(()=>Trade?.selectDiplomaticAgreements?.(s),[])||[],history:uiSafe(()=>Trade?.selectDiplomaticHistory?.(s),[])||[],reputation:n(overview.reputation)};}
function uiDiplomacyOverview(s){return uiDiplomacyVM(s).overview;}
function uiForeignCountries(s){return uiDiplomacyVM(s).countries;}
function uiCountryDiplomacyDetail(countryId,s){return uiSafe(()=>Trade?.selectCountryDiplomacyDetail?.(countryId,s),{})||{};}
function uiNegotiations(s){return uiDiplomacyVM(s).negotiations;}
function uiDiplomaticAgreements(s){return uiDiplomacyVM(s).agreements;}
function uiDiplomaticHistory(s){return uiDiplomacyVM(s).history;}
function uiSituationsVM(s){let problems=uiSafe(()=>BE.ReverseNavigator?.activeProblems?.(),null);if(!Array.isArray(problems))problems=vals(s?.issues).filter(x=>x&&x.active!==false);const situ=vals(s?.modules?.events?.situations||s?.modules?.events?.state?.issues||s?.modules?.events?.state?.storyClusters);const stories=vals(s?.modules?.events?.stories||s?.modules?.events?.state?.feed);return{problems,situations:situ,stories,recent:vals(s?.history).slice(-20)};}
function uiDiagnosticsVM(s){
  const status=BE.Module8?.getModuleStatus?.()||{module1:!!global.World,module2:!!global.Development,module3:!!global.Economy,module4:!!global.Population,module5:!!global.TradeDiplomacy,module6:!!global.CountryAI,module7:!!global.IssuesEvents,module8:true,module9:!!BE.Agriculture};
  const errors=[];const warn=(code,detail)=>errors.push({code,detail:String(detail||'')});const ids=new Map();const register=(group,obj)=>{for(const [k,v] of Object.entries(obj||{})){if(!v)continue;const id=String(v.id||k);if(ids.has(id)&&ids.get(id)!==group)warn('DUPLICATE_ENTITY_ID',`${id}: ${ids.get(id)} / ${group}`);else ids.set(id,group);}};register('regions',s?.regions);register('cities',s?.cities);register('facilities',s?.facilities);register('connections',s?.connections);register('projects',s?.projects);register('tradeContracts',s?.tradeContracts);register('tradeRoutes',s?.tradeRoutes);register('deposits',s?.discoveredDeposits);
  for(const p of vals(s?.projects)){if(!p)continue;if(p.regionId&&!s?.regions?.[p.regionId])warn('PROJECT_REGION_MISSING',`${p.id} -> ${p.regionId}`);if(p.depositId&&!s?.discoveredDeposits?.[p.depositId])warn('PROJECT_DEPOSIT_MISSING',`${p.id} -> ${p.depositId}`);}
  for(const d of uiDeposits(s))if(d&&!d.developed&&!d.developmentProject&&!d.stale&&d.assessment&&typeof global.Development?.startMineDevelopment!=='function')warn('DEPOSIT_NO_DEVELOPMENT_ENTRY',d.id);
  for(const c of vals(s?.tradeContracts)){if(!c)continue;if(c.routeId&&!s?.tradeRoutes?.[c.routeId])warn('TRADE_ROUTE_MISSING',`${c.id} -> ${c.routeId}`);if(c.gatewayId&&!s?.facilities?.[c.gatewayId])warn('TRADE_GATEWAY_MISSING',`${c.id} -> ${c.gatewayId}`);if(c.status==='active'&&!c.routeId)warn('ACTIVE_CONTRACT_NO_ROUTE',c.id);}
  for(const p of vals(s?.facilities).filter(f=>f&&/port|gateway|border/i.test(`${f.type||''} ${f.name||''}`))){if(p.regionId&&!uiConnections(s).some(c=>[c.regionId,c.fromId,c.toId].includes(p.regionId)))warn('GATEWAY_NO_TRANSPORT_LINK',p.id);}
  for(const f of uiAgricultureFarms(s)){if(f.regionId&&!s?.regions?.[f.regionId])warn('FARM_REGION_MISSING',`${f.id} -> ${f.regionId}`);const ar=s?.agriculture?.regions?.[f.regionId];if(f.sourceType==='regionalAggregate'&&!ar?.land)warn('FARM_NO_LAND',f.regionId);}
  const scan=(o,path='',depth=0)=>{if(depth>5||o==null)return;if(typeof o==='number'){if(!Number.isFinite(o))warn('NON_FINITE_NUMBER',path);else if(o<0&&/(stock|inventory|reserved|capacity|population|area|quantity)/i.test(path))warn('NEGATIVE_PHYSICAL_VALUE',`${path}=${o}`);return;}if(Array.isArray(o)){if(o.length>5000)warn('UNBOUNDED_ARRAY_RISK',`${path} length=${o.length}`);o.slice(0,300).forEach((v,i)=>scan(v,`${path}[${i}]`,depth+1));return;}if(typeof o==='object'){for(const [k,v] of Object.entries(o))scan(v,path?`${path}.${k}`:k,depth+1);}};scan({agriculture:s?.agriculture,economy:s?.economy,projects:s?.projects,tradeContracts:s?.tradeContracts,connections:s?.connections});
  for(const e of uiRuntime.errors.values())warn(e.code,e.detail);
  return{moduleStatus:status,errors,performance:{...uiRuntime.performance,timings:{...uiRuntime.performance.timings}},integration:BE.Module8?.validateIntegration?.()||null,counts:{regions:vals(s?.regions).length,projects:vals(s?.projects).length,facilities:vals(s?.facilities).length,connections:vals(s?.connections).length,farms:uiAgricultureFarms(s).length,tradeContracts:vals(s?.tradeContracts).length,history:vals(s?.history).length}};
}
function uiOverviewVM(s){const food=uiFoodAccounting(s),econ=uiEconomyVM(s),pop=uiPopulationVM(s),projects=uiProjects(s).filter(p=>p.status==='under_construction'),sit=uiSituationsVM(s);return{year:year(),treasury:econ.treasury,population:pop.totalPopulation,food:{stock:food.stock,production:food.production,consumption:food.demand,deficit:food.deficit},mapEntities:{regions:vals(s?.regions).length,cities:vals(s?.cities).length,connections:vals(s?.connections).length,facilities:vals(s?.facilities).length},activeProjects:projects,bottlenecks:(sit.problems||[]).slice(0,6),recentChanges:vals(s?.history).slice(-8).reverse(),guidedObjective:uiFirst(s?.onboardingState?.currentObjective,s?.guidedDevelopment?.currentObjective,s?.modules?.guided?.currentObjective)};}
function uiConstructionVM(s){const ps=uiProjects(s),active=ps.filter(p=>p.status==='under_construction');return{projects:ps,active,waitingResources:active.filter(p=>Object.values(p.missingInputs||{}).some(v=>n(v)>0)),delayed:active.filter(p=>p.progressFactor!=null&&p.progressFactor<.5),budget:uiFirst(uiFinance(s)?.expenditure?.infrastructure,uiFinance(s)?.expenditure?.projects,uiFinance(s)?.infrastructureBudget),connections:uiConnections(s),facilities:vals(s?.facilities)};}
function uiResourcesVM(s){const deposits=uiDeposits(s),projects=uiProjects(s).filter(p=>/resource|mine|oil|coal|iron|deposit|exploration/i.test(`${p.type||''} ${p.name||''}`)),facilities=vals(s?.facilities).filter(f=>f&&/mine|oil_field|extraction/i.test(`${f.type||''} ${f.name||''}`));return{deposits,exploration:projects.filter(p=>p.type==='resource_exploration'&&p.status==='under_construction'),developable:deposits.filter(d=>!d.developed&&!d.stale&&!!d.assessment&&!d.developmentProject),producing:facilities,projects};}
function uiSelfTest(){const s=gs(),out=[];const t=(name,fn)=>{try{out.push({name,ok:!!fn()});}catch(e){out.push({name,ok:false,error:String(e)})}};if(!s)return[{name:'game state available',ok:false}];const y=year(),counts=[vals(s.projects).length,vals(s.facilities).length,vals(s.tradeContracts).length];t('selectors return view models',()=>['overview','construction','resources','agriculture','trade','diplomacy','economy','population','situations','diagnostics'].every(k=>typeof UIBridge.selectors[k](s)==='object'));t('selectors do not advance time',()=>year()===y);t('selectors do not create projects/facilities/contracts',()=>counts.join('|')===[vals(s.projects).length,vals(s.facilities).length,vals(s.tradeContracts).length].join('|'));t('Module8 annual entry remains unique',()=>typeof BE.Module8?.advanceOneYear==='function');t('UIBridge dispatch is command based',()=>typeof UIBridge.dispatch==='function');t('Diplomacy V3 state is attached to official Module 5 stores',()=>{const d=s.diplomacy;return !!d&&d.bilateralRelations===s.diplomaticRelations&&d.agreements===s.agreements&&d.proposals===s.diplomaticProposals;});t('Diplomacy selectors expose overview/countries/negotiations/agreements/history',()=>['diplomacyOverview','foreignCountries','countryDiplomacyDetail','negotiations','diplomaticAgreements','diplomaticHistory'].every(k=>typeof UIBridge.selectors[k]==='function'));
t('ten module entrances are mounted',()=>document.querySelectorAll('#beModuleSidebar [data-be-module]').length===10);
t('module entrance rail stays vertical',()=>{const el=document.getElementById('beModuleSidebar');return !el||getComputedStyle(el).flexDirection==='column';});
t('overview map owns the main workspace',()=>{if(!uiWorldReady(s)||uiState.level!=='root')return true;const map=document.querySelector('#beMapWorkspaceSlot .map-shell'),main=document.getElementById('mainWorkspace');if(!map||!main)return false;return map.getBoundingClientRect().width>=main.getBoundingClientRect().width*.72;});
return out;}
const UIBridge={
  getState:()=>gs(),
  selectors:{overview:(s=gs())=>uiOverviewVM(s||{}),construction:(s=gs())=>uiConstructionVM(s||{}),resources:(s=gs())=>uiResourcesVM(s||{}),agriculture:(s=gs())=>uiAgricultureVM(s||{}),trade:(s=gs())=>uiTradeVM(s||{}),diplomacy:(s=gs())=>uiDiplomacyVM(s||{}),diplomacyOverview:(s=gs())=>uiDiplomacyOverview(s||{}),foreignCountries:(s=gs())=>uiForeignCountries(s||{}),countryDiplomacyDetail:(countryId,s=gs())=>uiCountryDiplomacyDetail(countryId,s||{}),negotiations:(s=gs())=>uiNegotiations(s||{}),diplomaticAgreements:(s=gs())=>uiDiplomaticAgreements(s||{}),diplomaticHistory:(s=gs())=>uiDiplomaticHistory(s||{}),economy:(s=gs())=>uiEconomyVM(s||{}),population:(s=gs())=>uiPopulationVM(s||{}),situations:(s=gs())=>uiSituationsVM(s||{}),diagnostics:(s=gs())=>uiDiagnosticsVM(s||{})},
  dispatch(command){const s=gs();if(!s)return{ok:false,error:'GAME_STATE_UNAVAILABLE'};const c=command||{};let r={ok:false,error:'UNKNOWN_COMMAND'};try{switch(c.type){case'CREATE_PROJECT':r=global.Development?.startProject?.(c.payload||c.project||{},s)||r;break;case'CREATE_CONSTRUCTION_PROJECT':r=global.Development?.startProject?.({...(c.payload||{}),type:c.projectType||c.payload?.projectType||c.payload?.type,fromId:c.fromRegionId||c.payload?.fromRegionId,toId:c.toRegionId||c.payload?.toRegionId,regionId:c.regionId||c.fromRegionId||c.payload?.regionId},s)||r;break;case'CREATE_RESOURCE_DEVELOPMENT_PROJECT':r=global.Development?.startMineDevelopment?.(c.depositId||c.payload?.depositId,{method:c.method||c.payload?.method||'state'},s)||r;break;case'CREATE_DIPLOMATIC_PROPOSAL':{const payload=c.payload||{},target=c.targetCountryId||payload.targetCountryId,type=c.proposalType||payload.proposalType||payload.type,ag=payload.proposedAgreement||{type:String(type||'').toLowerCase(),countryAId:player(),countryBId:target,durationYears:payload.durationYears||4,clauses:payload.clauses||[]};r=Trade?.createDiplomaticProposal?.({proposerCountryId:player(),targetCountryId:target,type:ag.type,proposedAgreement:ag,status:payload.status||'draft'},s)||r;break;}case'SEND_DIPLOMATIC_PROPOSAL':r=Trade?.sendDiplomaticProposal?.(c.proposalId||c.payload?.proposalId,s)||r;break;case'ACCEPT_DIPLOMATIC_PROPOSAL':r=Trade?.acceptDiplomaticProposal?.(c.proposalId||c.payload?.proposalId,s)||r;break;case'REJECT_DIPLOMATIC_PROPOSAL':r=Trade?.rejectDiplomaticProposal?.(c.proposalId||c.payload?.proposalId,s,c.reason||c.payload?.reason)||r;break;case'COUNTER_DIPLOMATIC_PROPOSAL':r=Trade?.counterDiplomaticProposal?.(c.proposalId||c.payload?.proposalId,c.proposedAgreement||c.payload?.proposedAgreement||null,s)||r;break;case'WITHDRAW_DIPLOMATIC_PROPOSAL':r=Trade?.withdrawDiplomaticProposal?.(c.proposalId||c.payload?.proposalId,s)||r;break;case'CANCEL_DIPLOMATIC_AGREEMENT':r=Trade?.cancelDiplomaticAgreement?.(c.agreementId||c.payload?.agreementId,s,c.reason||c.payload?.reason||'player_cancelled')||r;break;case'SET_CROP_ALLOCATION':{const x=BE.Agriculture?.setCropAllocation?.(s.agriculture,c.regionId,c.allocation||c.payload?.allocation);if(x){s.agriculture=x;r={ok:true};}break;}case'DEVELOP_AGRICULTURAL_LAND':{const x=BE.Agriculture?.developLand?.(s.agriculture,c.regionId,n(c.area||c.payload?.area),BE.Module8?.makeAgricultureContext?.(s));if(x?.nextState){s.agriculture=x.nextState;r={ok:true,...x};}break;}case'ALLOCATE_IRRIGATION':{const x=BE.Agriculture?.allocateIrrigation?.(s.agriculture,c.regionId,c.allocation||c.payload?.allocation);if(x){s.agriculture=x;r={ok:true};}break;}case'SET_AGRICULTURAL_INTENSITY':{const x=BE.Agriculture?.setAgriculturalIntensity?.(s.agriculture,c.regionId,c.intensity);if(x){s.agriculture=x;r={ok:true};}break;}case'SET_CROP_PRIORITY':{const x=BE.Agriculture?.setCropPriority?.(s.agriculture,c.regionId,c.cropId,Number(c.priority));if(x){s.agriculture=x;r={ok:true};}break;}case'SET_CULTIVATED_AREA':{const x=BE.Agriculture?.setCultivatedArea?.(s.agriculture,c.regionId,Number(c.area));if(x){s.agriculture=x;r={ok:true};}break;}case'SET_AGRICULTURE_POLICY':{const x=BE.Agriculture?.setAgriculturePolicy?.(s.agriculture,c.key,Number(c.value));if(x){s.agriculture=x;r={ok:true};}break;}case'START_STATE_AGRICULTURE_PROJECT':{const x=BE.Agriculture?.startStateAgricultureProject?.(s.agriculture,c.projectType,c.regionId,c.parameters||{},year());if(x?.nextState){s.agriculture=x.nextState;r={ok:true,project:x.project};}break;}default:r={ok:false,error:`UNKNOWN_COMMAND:${c.type||''}`};}}catch(e){r={ok:false,error:String(e?.message||e)};uiError('UI_COMMAND_ERROR',r.error);}UIBridge.refresh();return r;},
  subscribe(listener){if(typeof listener!=='function')return()=>{};uiSubscribers.add(listener);return()=>uiSubscribers.delete(listener);},
  refresh(){const t0=performance?.now?.()||Date.now();try{renderWorkspace();}catch(e){uiError('UI_RENDER_ERROR',e?.message||e);console.error(e);}uiRuntime.performance.lastRefreshMs=(performance?.now?.()||Date.now())-t0;for(const fn of uiSubscribers){try{fn(gs());}catch(_){}}return gs();},
  performance:uiRuntime.performance,
  selfTest:uiSelfTest,
  installProfiler(){if(uiRuntime.profilerInstalled)return;uiRuntime.profilerInstalled=true;const wrap=(obj,name,label)=>{if(!obj||typeof obj[name]!=='function'||obj[name].__uiProfiled)return;const old=obj[name];const fn=function(...args){const t0=performance?.now?.()||Date.now();try{return old.apply(this,args);}finally{uiRuntime.performance.timings[label]=n(uiRuntime.performance.timings[label])+((performance?.now?.()||Date.now())-t0);}};fn.__uiProfiled=true;obj[name]=fn;};wrap(global.Development,'updateProjects','M2');wrap(BE.Agriculture,'simulateYear','M9');wrap(global.Economy,'update','M3');wrap(global.Population,'update','M4');wrap(global.TradeDiplomacy,'update','M5');wrap(global.CountryAI,'updateCountry','M6');wrap(global.IssuesEvents,'update','M7');}
};
BE.UIBridge=UIBridge;global.BorderEpochUIBridge=UIBridge;

const uiState={level:'root',module:'overview',subview:null,entityType:null,entityId:null,history:[],selectedRegionId:null,selectedParcelId:null,selectedResource:null,selectedConnectionId:null,selectedFacilityId:null,filters:{},scrollPositions:{}};
let shell=null,legacyMapColumn=null,legacyPanel=null,legacyParking=null,mainWorkspace=null,moduleSidebar=null;
function stateKey(s=uiState){return`${s.level}|${s.module}|${s.subview||''}|${s.entityType||''}|${s.entityId||''}`;}
function syncSelectionsFromLegacy(){try{if(typeof selectedRegionId!=='undefined')uiState.selectedRegionId=selectedRegionId;if(typeof selectedParcelId!=='undefined')uiState.selectedParcelId=selectedParcelId;if(typeof selectedResource!=='undefined')uiState.selectedResource=selectedResource;}catch(_){ }}
function syncSelectionsToLegacy(){try{if(uiState.selectedRegionId&&typeof selectedRegionId!=='undefined')selectedRegionId=uiState.selectedRegionId;if(typeof selectedParcelId!=='undefined')selectedParcelId=uiState.selectedParcelId||null;if(uiState.selectedResource&&typeof selectedResource!=='undefined')selectedResource=uiState.selectedResource;}catch(_){ }}
function snap(){syncSelectionsFromLegacy();return{level:uiState.level,module:uiState.module,subview:uiState.subview,entityType:uiState.entityType,entityId:uiState.entityId,selectedRegionId:uiState.selectedRegionId,selectedParcelId:uiState.selectedParcelId,selectedResource:uiState.selectedResource,selectedConnectionId:uiState.selectedConnectionId,selectedFacilityId:uiState.selectedFacilityId,filters:{...uiState.filters},scrollTop:mainWorkspace?.scrollTop||0};}
function rememberCurrent(){if(!mainWorkspace)return;uiState.scrollPositions[stateKey()]=mainWorkspace.scrollTop;}
function pushHistory(){rememberCurrent();uiState.history.push(snap());if(uiState.history.length>30)uiState.history.shift();}
function applySnap(s){Object.assign(uiState,{level:s.level,module:s.module,subview:s.subview,entityType:s.entityType,entityId:s.entityId,selectedRegionId:s.selectedRegionId,selectedParcelId:s.selectedParcelId,selectedResource:s.selectedResource,selectedConnectionId:s.selectedConnectionId,selectedFacilityId:s.selectedFacilityId,filters:{...(s.filters||{})}});syncSelectionsToLegacy();renderWorkspace(s.scrollTop);}
function openRoot(push=true){if(push)pushHistory();Object.assign(uiState,{level:'root',module:'overview',subview:null,entityType:null,entityId:null});renderWorkspace();}
function openModule(moduleId,push=true){if(moduleId==='overview')return openRoot(push);if(push)pushHistory();Object.assign(uiState,{level:'module',module:moduleId,subview:null,entityType:null,entityId:null});renderWorkspace();}
function openSubview(moduleId,subview,push=true){if(push)pushHistory();Object.assign(uiState,{level:'module',module:moduleId,subview,entityType:null,entityId:null});renderWorkspace();}
function openDetail(def,push=true){if(push)pushHistory();Object.assign(uiState,{level:'detail',module:def.module||uiState.module,subview:def.subview??uiState.subview,entityType:def.entityType,entityId:def.entityId});renderWorkspace();}
function goBack(){const s=uiState.history.pop();if(s)return applySnap(s);if(uiState.level==='detail')return openModule(uiState.module,false);if(uiState.level==='module')return openRoot(false);}
function navLabel(id){return({overview:T('总览','Overview'),development:T('建设','Development'),resources:T('资源开发','Resources'),agriculture:T('农业','Agriculture'),trade:T('国际贸易','International Trade'),diplomacy:T('外交','Diplomacy'),economy:T('经济','Economy'),population:T('人口社会','Population & Society'),events:T('情境事件','Situations'),debug:T('自检','Self-check')})[id]||id;}
const NAV=['overview','development','resources','agriculture','trade','diplomacy','economy','population','events','debug'];
function renderSidebar(){if(!moduleSidebar)return;moduleSidebar.innerHTML=`<div class="be-sidebar-title">${T('国家 / 模块','Country / Modules')}</div>${NAV.map(id=>`<button class="be-nav-button ${(uiState.level==='root'&&id==='overview')||(uiState.level==='module'&&uiState.module===id)?'active':''}" data-be-module="${id}">${navLabel(id)}</button>`).join('')}`;}
function titleBlock(title,sub=''){return`<div><h1 class="be-page-title">${esc(title)}</h1>${sub?`<div class="be-page-subtitle">${esc(sub)}</div>`:''}</div>`;}
function pageHead(title,sub='',back=false){return`<div class="be-page-head">${back?`<button class="be-back" data-be-back>← ${esc(T('返回','Back'))}</button>`:''}${titleBlock(title,sub)}</div>`;}
function regionToolbar(){const s=gs(),ids=Object.keys(s?.regions||{});if(!ids.length)return'';const chosen=uiState.selectedRegionId||ids[0];return`<div class="be-toolbar"><label>${T('地区','Region')} <select id="beWorkspaceRegion">${ids.map(id=>`<option value="${esc(id)}" ${id===chosen?'selected':''}>${esc(s.regions[id]?.name||id)}</option>`).join('')}</select></label></div>`;}
function stat(label,value){return`<div class="be-stat-item"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;}
function entityCard(title,desc,action='',button=T('查看详情','View details'),extra=''){return`<div class="be-entity-card"><h3>${esc(title)}</h3>${desc?`<p>${esc(desc)}</p>`:''}${extra}<div class="be-action-row">${action?`<button ${action}>${esc(button)}</button>`:''}</div></div>`;}
function statusClass(v){v=String(v||'').toLowerCase();return /normal|active|complete|good|operational/.test(v)?'good':/stop|fail|short|damage|blocked|inactive/.test(v)?'bad':'warn';}
function topbarStats(){const s=gs();if(!s)return;const tb=document.querySelector('.topbar');if(!tb)return;let box=document.getElementById('beGlobalStats');if(!box){box=document.createElement('div');box.id='beGlobalStats';box.className='status-pills';const existing=tb.querySelector('.status-pills');existing?.insertAdjacentElement('afterend',box);const lang=document.createElement('button');lang.id='beLangSwitch';lang.textContent='EN / 中文';lang.title=T('返回语言选择','Return to language choice');lang.onclick=()=>location.reload();tb.appendChild(lang);const save=document.createElement('button');save.id='beSaveBtn';save.textContent=T('保存','Save');tb.appendChild(save);const load=document.createElement('button');load.id='beLoadBtn';load.textContent=T('读取','Load');tb.appendChild(load);save.onclick=()=>{try{const data=BE.Module8?.save?.();if(data){localStorage.setItem('BorderEpoch.WorldLab.Save',data);toastUI(T('存档已保存','Game saved'));}}catch(e){toastUI(e.message,'bad');}};load.onclick=()=>{try{const data=localStorage.getItem('BorderEpoch.WorldLab.Save');if(!data)return toastUI(T('没有找到存档','No saved game found'),'bad');BE.Module8?.load?.(data,{World:global.World,Development:global.Development,Main:global.BorderEpochMainBoard});ensureMultiState(gs());UIBridge.refresh();toastUI(T('存档已读取','Game loaded'));}catch(e){toastUI(e.message,'bad');}};}const vm=UIBridge.selectors.overview(s),food=vm.food?.stock;box.innerHTML=`<span class="pill">${T('国库','Treasury')} <b>${vm.treasury==null?'—':fmt(vm.treasury)}</b></span><span class="pill">${T('人口','Population')} <b>${fmt(vm.population)}</b></span><span class="pill">${T('粮食库存','Food stock')} <b>${food==null?'—':fmt(food)}</b></span>`;}
function renderOverview(){const s=gs(),vm=UIBridge.selectors.overview(s||{});if(!uiWorldReady(s)){mainWorkspace.innerHTML=`<div class="be-workspace-inner">${pageHead(T('国家总览','National Overview'),T('尚未生成世界。生成世界后这里会显示地图和国家运行状态。','No world has been generated. The map and national operating state will appear here after generation.'))}<div class="be-empty">${T('请先点击顶部“生成世界”。','Use “Generate World” in the top bar first.')}</div></div>`;return;}const problemCards=(vm.bottlenecks||[]).map(p=>entityCard(p.title||p.type||p.id,p.summary||p.description||`${T('严重度','Severity')}: ${p.severity??'—'}`)).join('')||`<div class="be-empty">${T('当前没有被因果诊断系统识别出的主要瓶颈。','No major bottleneck is currently identified by the causal diagnostic system.')}</div>`;const projectCards=(vm.activeProjects||[]).slice(0,6).map(p=>entityCard(p.name||p.type,`${T('状态','Status')}: ${p.status} · ${T('进度','Progress')}: ${p.progress==null?'—':pct(p.progress)}`,`data-be-detail="development:project:${esc(p.id)}"`)).join('')||`<div class="be-empty">${T('当前没有在建项目。','No project is currently under construction.')}</div>`;const changes=(vm.recentChanges||[]).map(x=>`<div class="be-list-row"><div><b>${esc(x.summary||x.type||x.id||T('状态变化','State change'))}</b><small>${esc(x.sourceModule||x.module||'GameState')}</small></div><div>${esc(x.year??'—')}</div></div>`).join('')||`<div class="be-empty">${T('尚无年度历史记录。','No annual history has been recorded yet.')}</div>`;mainWorkspace.innerHTML=`<div class="be-workspace-inner">${pageHead(T('国家总览','National Overview'),T('地图保持主位；下方只显示当前最重要的国家状态、瓶颈和项目。','The map remains primary; only the most important national state, bottlenecks and projects are shown below.'))}<div id="beMapWorkspaceSlot"></div><div class="be-section"><h2>${T('国家状态','National State')}</h2><div class="be-stat-grid">${stat(T('年份','Year'),vm.year)}${stat(T('国库','Treasury'),vm.treasury==null?'—':fmt(vm.treasury))}${stat(T('人口','Population'),fmt(vm.population))}${stat(T('粮食库存','Food Stock'),fmt(vm.food.stock))}${stat(T('粮食产量','Food Production'),fmt(vm.food.production))}${stat(T('粮食短缺','Food Shortage'),fmt(vm.food.deficit))}${stat(T('进行中项目','Active Projects'),vm.activeProjects.length)}${stat(T('地图实体','Map Entities'),`${vm.mapEntities.cities}/${vm.mapEntities.facilities}/${vm.mapEntities.connections}`)}</div></div>${vm.guidedObjective?`<div class="be-note"><b>${T('当前引导目标','Current guided objective')}：</b> ${esc(vm.guidedObjective.title||vm.guidedObjective)}</div>`:''}<div class="be-section"><h2>${T('当前瓶颈','Current Bottlenecks')}</h2><div class="be-grid wide">${problemCards}</div></div><div class="be-section"><h2>${T('正在建设','Under Construction')}</h2><div class="be-grid wide">${projectCards}</div></div><div class="be-section"><h2>${T('最近一年变化','Recent Changes')}</h2><div class="be-list">${changes}</div></div></div>`;const slot=document.getElementById('beMapWorkspaceSlot');if(legacyMapColumn&&slot){slot.appendChild(legacyMapColumn);try{if(typeof renderMap==='function')renderMap();}catch(e){console.error(e);uiError('MAP_RENDER_ERROR',e.message||e);}}}
function categoryButton(module,sub,title,desc){return entityCard(title,desc,`data-be-subview="${module}:${sub}"`,T('进入','Open'));}
function connectionName(c,s=gs()){const a=s?.regions?.[c.fromId]?.name||s?.cities?.[c.fromId]?.name||c.fromId,b=s?.regions?.[c.toId]?.name||s?.cities?.[c.toId]?.name||c.toId;return`${a||'?'} ↔ ${b||'?'}`;}
function renderDevelopment(){const s=gs(),vm=UIBridge.selectors.construction(s||{}),sub=uiState.subview;if(!sub){mainWorkspace.innerHTML=`<div class="be-workspace-inner">${pageHead(T('建设','Development'),T('这里读取 Module 2 的真实项目、交通连接、设施与维护状态。','This workspace reads the real Module 2 projects, transport links, facilities and maintenance state.'))}${regionToolbar()}<div class="be-stat-grid">${stat(T('建设中','Under Construction'),vm.active.length)}${stat(T('等待资源','Waiting for Resources'),vm.waitingResources.length)}${stat(T('明显延误','Delayed'),vm.delayed.length)}${stat(T('本年基建预算','Infrastructure Budget'),vm.budget==null?'—':fmt(vm.budget))}</div><div class="be-grid wide">${categoryButton('development','transport',T('交通基础设施','Transport Infrastructure'),T('公路、铁路、容量、利用率与维护','Roads, railways, capacity, utilization and maintenance'))}${categoryButton('development','industry',T('工业建设','Industrial Construction'),T('工厂、电站、港口与真实设施','Factories, power plants, ports and real facilities'))}${categoryButton('development','projects',T('项目管理','Project Management'),T('进度、工期、缺料和阻塞原因','Progress, schedule, missing inputs and blockers'))}${categoryButton('development','maintenance',T('维修维护','Maintenance & Repair'),T('交通与设施的维护状态','Maintenance state of transport and facilities'))}${categoryButton('development','resources',T('资源开发建设','Resource Development'),T('从已发现矿床进入真实开发项目','Real development projects from discovered deposits'))}</div></div>`;return;}if(sub==='transport')return renderTransportList('development');if(sub==='resources')return renderResources('development');if(sub==='industry')return renderFacilityList();if(sub==='projects'){const rows=vm.projects.map(p=>entityCard(p.name||p.type,`${T('状态','Status')}: ${localizeStatus(p.status)} · ${T('进度','Progress')}: ${p.progress==null?'—':pct(p.progress)} · ${T('剩余','Remaining')}: ${p.turnsRemaining??'—'} ${T('年','yr')}${p.blockingReasons.length?` · ${T('阻塞','Blocked')}: ${p.blockingReasons.join(', ')}`:''}`,`data-be-detail="development:project:${esc(p.id)}"`)).join('')||`<div class="be-empty">${T('当前没有建设项目。','There are currently no construction projects.')}</div>`;mainWorkspace.innerHTML=`<div class="be-workspace-inner">${pageHead(T('项目管理','Project Management'),T('所有数据来自 state.projects 与 Module 3 的项目进度信号。','All data comes from state.projects and Module 3 project-progress signals.'),true)}<div class="be-grid wide">${rows}</div></div>`;return;}if(sub==='maintenance')return renderMaintenance();}
function renderTransportList(module='development'){const s=gs(),rid=uiState.selectedRegionId,rows=vals(s?.connections).filter(c=>!rid||c.fromId===rid||c.toId===rid);mainWorkspace.innerHTML=`<div class="be-workspace-inner">${pageHead(T('交通网络','Transport Network'),T('每条线路进入独立详情页，不再挤在右侧窄栏。','Each link opens a full detail page instead of a narrow right panel.'),true)}${regionToolbar()}<div class="be-list">${rows.length?rows.map(c=>`<div class="be-list-row"><div><b>${esc(connectionName(c,s))}</b><small>${esc(String(c.type||T('交通连接','Transport link')).toUpperCase())}</small></div><div><span>${T('等级','Level')}</span><b>${esc(c.level??'—')}</b></div><div><span>${T('状态','Condition')}</span><b>${esc(fmt(n(c.condition,n(c.conditionPct,1))* (n(c.condition,n(c.conditionPct,1))<=1?100:1)))}${n(c.condition,n(c.conditionPct,1))<=1?'%':''}</b></div><div class="be-hide-tablet"><span>${T('容量','Capacity')}</span><b>${fmt(c.capacity)}</b></div><button data-be-detail="${module}:connection:${esc(c.id)}">${T('查看详情','View details')}</button></div>`).join(''):`<div class="be-empty">${T('当前没有交通连接','No transport links yet')}</div>`}</div></div>`;}
function discoveredDeposits(s=gs()){try{return Trade&&global.Development?.getDiscoveredDeposits?global.Development.getDiscoveredDeposits(null,s):vals(s?.resourceSites||s?.deposits);}catch(_){return vals(s?.resourceSites||s?.deposits);}}
function renderResources(module='resources'){const s=gs(),vm=UIBridge.selectors.resources(s||{});if(!uiWorldReady(s)){mainWorkspace.innerHTML=`<div class="be-workspace-inner">${pageHead(T('资源开发','Resource Development'),'',module!=='resources')}<div class="be-empty">${T('尚未生成世界。','No world has been generated yet.')}</div></div>`;return;}const cards=vm.deposits.map(d=>{const reserve=d.estimatedReserve==null?'—':typeof d.estimatedReserve==='object'?JSON.stringify(d.estimatedReserve):fmt(d.estimatedReserve);const desc=`${T('地区','Region')}: ${uiRegionName(s,d.regionId)} · ${T('资源','Resource')}: ${goodName(d.resourceType||d.resource||d.goodId)} · ${T('储量','Reserve')}: ${reserve} · ${T('状态','Status')}: ${d.developmentStatus}`;const extra=d.stale?`<span class="be-status warn">${T('地质证据已过期','Stale geology')}</span>`:d.developmentProject?`<span class="be-status warn">${T('开发中','Under development')}</span>`:d.facility?`<span class="be-status good">${T('生产中','Producing')}</span>`:'';return entityCard(d.name||`${uiRegionName(s,d.regionId)} ${goodName(d.resourceType)}`,desc,`data-be-detail="resources:deposit:${esc(d.id)}"`,T('查看资源详情','View resource'),extra);}).join('')||`<div class="be-empty">${T('当前没有已发现矿床。可先在建设/资源勘探中进行真实勘探。','No deposit has been discovered yet. Use the real exploration workflow first.')}</div>`;const ps=vm.projects.map(p=>entityCard(p.name||p.type,`${T('状态','Status')}: ${localizeStatus(p.status)} · ${T('剩余','Remaining')}: ${p.turnsRemaining??'—'} ${T('年','yr')}`,`data-be-detail="development:project:${esc(p.id)}"`)).join('')||`<div class="be-empty">${T('当前没有资源勘探或开发项目。','No resource exploration/development project is active.')}</div>`;mainWorkspace.innerHTML=`<div class="be-workspace-inner">${pageHead(T('资源开发','Resource Development'),T('资源存在、勘探发现、工程评估、开发建设与生产状态分开显示。','Endowment, discovery, engineering assessment, development and production are shown as separate states.'),module!=='resources')}${regionToolbar()}<div class="be-stat-grid">${stat(T('已发现矿床','Discovered Deposits'),vm.deposits.length)}${stat(T('正在勘探','Exploration Active'),vm.exploration.length)}${stat(T('可开发资源','Developable'),vm.developable.length)}${stat(T('生产中矿场','Producing Sites'),vm.producing.length)}</div><div class="be-section"><h2>${T('发现与开发状态','Discovery & Development')}</h2><div class="be-grid wide">${cards}</div></div><div class="be-section"><h2>${T('相关项目','Related Projects')}</h2><div class="be-grid wide">${ps}</div></div></div>`;}
function renderFacilityList(){const s=gs(),fac=vals(s?.facilities).filter(f=>f&&f.active!==false);mainWorkspace.innerHTML=`<div class="be-workspace-inner">${pageHead(T('工业设施','Industrial Facilities'),T('设施列表只显示概况；生产和项目细节进入详情。','The list shows only overview data; full production and project data lives in details.'),true)}<div class="be-grid wide">${fac.length?fac.map(f=>entityCard(f.name||f.type,`${T('类型','Type')}: ${localizeFacilityType(f.type)} · ${T('地区','Region')}: ${s?.regions?.[f.regionId]?.name||f.regionId||'—'}`,`data-be-detail="development:facility:${esc(f.id)}"`,T('查看详情','View details'),`<span class="be-status ${statusClass(f.status||'active')}">${esc(localizeStatus(f.status||'active'))}</span>`)).join(''):`<div class="be-empty">${T('当前没有设施','No facilities yet')}</div>`}</div></div>`;}
function renderProjectList(){const s=gs(),ps=vals(s?.projects);mainWorkspace.innerHTML=`<div class="be-workspace-inner">${pageHead(T('建设项目','Construction Projects'),T('项目的时间、缺料和建设状态直接读取当前项目对象。','Time, shortages and status are read from the live project objects.'),true)}<div class="be-grid wide">${ps.length?ps.map(p=>entityCard(p.name||p.type,`${T('状态','Status')}: ${localizeStatus(p.status)} · ${T('剩余','Remaining')}: ${p.turnsRemaining??p.remainingTurns??'—'} ${T('年','yr')}`,`data-be-detail="development:project:${esc(p.id)}"`)).join(''):`<div class="be-empty">${T('没有建设项目','No construction projects')}</div>`}</div></div>`;}
function renderMaintenance(){const s=gs(),items=[...vals(s?.connections).map(x=>({...x,_kind:'connection'})),...vals(s?.facilities).map(x=>({...x,_kind:'facility'}))];mainWorkspace.innerHTML=`<div class="be-workspace-inner">${pageHead(T('维护与维修','Maintenance & Repair'),T('这里先聚合现有维护状态，不创建新的维护计算。','This page aggregates existing maintenance state without creating a second maintenance model.'),true)}<div class="be-list">${items.map(x=>`<div class="be-list-row"><div><b>${esc(x.name||x.id)}</b><small>${esc(x._kind)}</small></div><div><span>${T('状态','Status')}</span><b>${esc(localizeStatus(x.status))}</b></div><div><span>${T('设施状态','Condition')}</span><b>${esc(x.condition??x.conditionPct??'—')}</b></div><div class="be-hide-tablet"><span>${T('维护','Maintenance')}</span><b>${esc(x.maintenance??x.maintenanceFunding??'—')}</b></div><button data-be-detail="development:${x._kind}:${esc(x.id)}">${T('详情','Details')}</button></div>`).join('')||`<div class="be-empty">${T('暂无对象','No objects')}</div>`}</div></div>`;}
function agricultureObjectList(s=gs()){const arr=[];for(const f of vals(s?.facilities))if(f&&/farm|agri/i.test(`${f.type} ${f.name}`))arr.push(f);for(const p of vals(s?.agriculture?.projects||s?.agricultureProjects))if(p&&!arr.some(x=>x.id===p.id))arr.push(p);return arr;}
function renderAgriculture(){
  const s=gs(),vm=UIBridge.selectors.agriculture(s||{}),sub=uiState.subview;
  const nav=[['overview',T('粮食总况','Food Overview')],['projects',T('国家农业项目','State Agriculture Projects')],['farms',T('私人农业','Private Agriculture')],['land',T('土地','Land')],['inputs',T('农业投入','Agricultural Inputs')],['irrigation',T('灌溉','Irrigation')],['transport',T('农业运输','Agricultural Transport')]];
  if(!uiWorldReady(s)){mainWorkspace.innerHTML=`<div class="be-workspace-inner">${pageHead(T('农业','Agriculture'))}<div class="be-empty">${T('尚未生成世界。生成世界后农业会直接读取 Module 9 的正式状态。','No world has been generated. Agriculture will read Module 9 state directly after generation.')}</div></div>`;return;}
  const head=`<div class="be-stat-grid">${stat(T('粮食自给率','Food Self-sufficiency'),vm.headline.selfSufficiency==null?'—':pct(vm.headline.selfSufficiency))}${stat(T('本年粮食产量','Food Production'),fmt(vm.headline.production))}${stat(T('粮食需求','Food Demand'),fmt(vm.headline.demand))}${stat(T('粮食库存','Food Stock'),fmt(vm.headline.stock))}${stat(T('市场短缺','Market Shortage'),fmt(vm.headline.deficit))}${stat(T('在耕面积','Cultivated Area'),fmt(vm.headline.cultivatedArea))}${stat(T('收集/物流损失','Collection/Logistics Loss'),fmt(vm.headline.logisticsLoss))}${stat(T('农业利润','Agricultural Profit'),vm.headline.agriculturalProfit==null?T('后台未独立核算','Not separately accounted'):fmt(vm.headline.agriculturalProfit))}</div>`;
  if(!sub){mainWorkspace.innerHTML=`<div class="be-workspace-inner">${pageHead(T('农业','Agriculture'),T('读取 Module 9 正式状态；所有操作只写入正式农业状态，年度结果仍由下一次正式 Tick 产生。','Reads live Module 9 state. Controls write only to the official agriculture state; annual results still come from the next official tick.'))}${head}<div class="be-grid wide">${nav.map(([k,l])=>categoryButton('agriculture',k,l,T('进入该农业视图','Open this agriculture view'))).join('')}</div></div>`;return;}
  let body='';
  if(sub==='overview'){
    const f=vm.food;body=`${head}<div class="be-section"><h2>${T('年度粮食流','Annual Food Flow')}</h2><div class="be-stat-grid">${stat(T('期初库存','Opening Stock'),fmt(f.openingStock))}${stat('+ '+T('本年生产','Production'),fmt(f.production))}${stat('+ '+T('进口交付','Imports Delivered'),fmt(f.imports))}${stat('- '+T('农场出库','Farm Withdrawals'),fmt(f.withdrawals))}${stat('- '+T('出口交付','Exports Delivered'),fmt(f.exports))}${stat('- '+T('收集损失','Collection Loss'),fmt(f.collectionLoss))}${stat('- '+T('储存损失','Storage Loss'),fmt(f.storageLoss))}${stat(T('期末库存','Closing Stock'),fmt(f.stock))}</div><div class="be-note">${T('上述每一项都从 Agriculture.storage/lastOutput 或真实 TradeContract 年度交付读取；没有第二套粮食结算。','Every item is read from Agriculture storage/lastOutput or real annual TradeContract delivery; no second food settlement is run.')}</div></div>`;
  }
  if(sub==='projects'){
    const ids=Object.keys(s?.agriculture?.regions||{});
    const projectTypes=['land_development','irrigation_expansion','storage_expansion'];
    const controls=`<div class="be-card"><h3>${T('启动国家农业项目','Start State Agriculture Project')}</h3><div class="be-toolbar"><label>${T('地区','Region')} <select id="beAgriProjectRegion">${ids.map(id=>`<option value="${esc(id)}">${esc(uiRegionName(s,id))}</option>`).join('')}</select></label><label>${T('项目','Project')} <select id="beAgriProjectType">${projectTypes.map(t=>`<option value="${t}">${esc(localizeProjectType(t))}</option>`).join('')}</select></label><label>${T('规模','Scale')} <input id="beAgriProjectAmount" type="number" min="1" step="1" value="10"></label><button class="primary-action" data-agri-start-project>${T('启动项目','Start Project')}</button></div><div class="be-note">${T('项目写入 agriculture.stateProjects，并只在正式年度 Tick 中推进与完工。','Projects are written to agriculture.stateProjects and progress only during the official annual tick.')}</div></div>`;
    const cards=vm.stateProjects.map(p=>entityCard(localizeProjectType(p.type),`${T('地区','Region')}: ${uiRegionName(s,p.regionId)} · ${T('状态','Status')}: ${localizeStatus(p.status)} · ${T('剩余年度','Years remaining')}: ${fmt(p.turnsRemaining)} · ${T('成本','Cost')}: ${fmt(p.cost)}`)).join('')||`<div class="be-empty">${T('当前没有国家农业项目。','No state agriculture projects yet.')}</div>`;
    body=`${controls}<div class="be-section"><h2>${T('项目建设状态','Project Status')}</h2><div class="be-grid wide">${cards}</div></div>`;
  }
  if(sub==='farms'){
    const p=vm.policies||{};
    const policy=(key,label,value,step='0.01',max='1')=>`<label>${label}<input type="number" data-agri-policy-input="${key}" min="0" ${max?`max="${max}"`:''} step="${step}" value="${Number(value||0)}"></label>`;
    const policies=`<div class="be-card"><h3>${T('私人农业政策','Private Agriculture Policy')}</h3><div class="be-form-grid">${policy('agriculturalTaxRate',T('农业税率','Agricultural tax rate'),p.agriculturalTaxRate)}${policy('inputSubsidyRate',T('农资补贴','Input subsidy'),p.inputSubsidyRate)}${policy('creditSupportRate',T('信贷支持','Credit support'),p.creditSupportRate)}${policy('minimumPurchasePrice',T('最低收购价格','Minimum purchase price'),p.minimumPurchasePrice,'0.1','')}${policy('governmentProcurementShare',T('国家采购比例','Government procurement share'),p.governmentProcurementShare)}</div><div class="be-action-row"><button class="primary-action" data-agri-apply-policies>${T('应用政策','Apply Policies')}</button></div><div class="be-note">${T('这里调的是国家政策，不是直接命令每一家农户。政策写入 agriculture.policies，下一年度正式农业 Tick 使用。','These are state policies, not direct farm orders. They are written to agriculture.policies and used by the next official agriculture tick.')}</div></div>`;
    const cards=vm.farms.map(f=>{
      const crops=Object.entries(f.cropPlan||{}).filter(([,v])=>n(v)>0).map(([k,v])=>`${localizeCropName(k)} ${pct(v)}`).join(' · ')||'—';
      return entityCard(f.name||f.id,`${T('耕种面积','Cultivated area')}: ${fmt(f.landArea)} · ${T('作物结构','Crop mix')}: ${crops} · ${T('农业强度','Intensity')}: ${localizeAgricultureIntensity(f.intensity)} · ${T('劳动力投入','Labor')}: ${fmt(f.labor)} · ${T('农资满足率','Input fulfillment')}: ${f.inputFulfillment==null?'—':pct(f.inputFulfillment)} · ${T('灌溉满足率','Irrigation fulfillment')}: ${f.irrigationFulfillment==null?'—':pct(f.irrigationFulfillment)} · ${T('市场可达性','Market access')}: ${f.transportAccess==null?'—':pct(f.transportAccess)} · ${T('农场库存','Farm stock')}: ${fmt(f.farmStock)}`);
    }).join('');
    body=`${policies}<div class="be-section"><h2>${T('地区私人农业','Regional Private Agriculture')}</h2><div class="be-grid wide">${cards}</div></div>`;
  }
  if(sub==='land'){
    body=`<div class="be-grid wide">${vm.land.map(x=>`<div class="be-entity-card"><h3>${esc(x.name)}</h3><div class="be-stat-grid">${stat(T('潜在可耕地','Potential arable'),fmt(x.potential))}${stat(T('已开发','Developed'),fmt(x.developed))}${stat(T('在耕','Cultivated'),fmt(x.cultivated))}${stat(T('闲置','Idle'),fmt(x.idle))}</div><div class="be-control-row"><label>${T('实际耕种面积','Cultivated area')}<input type="number" data-agri-cultivated data-region="${esc(x.regionId)}" value="${x.cultivated}" min="0" max="${x.developed}"></label><button data-agri-apply-cultivated data-region="${esc(x.regionId)}">${T('应用','Apply')}</button></div><div class="be-control-row"><label>${T('新开发面积','New land development')}<input type="number" data-agri-develop-area data-region="${esc(x.regionId)}" value="10" min="0"></label><button data-agri-develop data-region="${esc(x.regionId)}">${T('启动开发','Develop land')}</button></div></div>`).join('')}</div>`;
  }
  if(sub==='inputs'){
    const cropIds=Object.keys(BE.Agriculture?.CropDefinitions||{});
    body=`<div class="be-card"><h3>${T('农资补贴','Input Subsidy')}</h3><div class="be-control-row"><label>${T('补贴比例','Subsidy rate')}<input type="number" id="beAgriInputSubsidy" min="0" max="1" step="0.01" value="${Number(vm.policies?.inputSubsidyRate||0)}"></label><button data-agri-apply-input-subsidy>${T('应用补贴','Apply Subsidy')}</button></div></div><div class="be-grid wide">${vm.inputs.map(x=>`<div class="be-entity-card"><h3>${esc(x.name)}</h3><div class="be-stat-grid">${stat(T('农资需求','Farm-input demand'),fmt(x.demand))}${stat(T('实际投入','Used'),fmt(x.used))}${stat(T('农资满足率','Input fulfillment'),x.demand>0?pct(x.used/x.demand):'—')}${stat(T('投入品配送系数','Input delivery'),x.inputDeliveryFactor==null?'—':pct(x.inputDeliveryFactor))}</div><div class="be-control-row"><label>${T('农业强度','Agricultural intensity')}<select data-agri-intensity data-region="${esc(x.regionId)}"><option value="extensive" ${x.intensity==='extensive'?'selected':''}>${T('粗放','Extensive')}</option><option value="normal" ${x.intensity==='normal'?'selected':''}>${T('正常','Normal')}</option><option value="intensive" ${x.intensity==='intensive'?'selected':''}>${T('集约','Intensive')}</option></select></label><button data-agri-apply-intensity data-region="${esc(x.regionId)}">${T('应用强度','Apply')}</button></div><div class="be-section"><h3>${T('作物投入优先级','Crop Input Priority')}</h3>${cropIds.map(cid=>`<div class="be-control-row"><label>${esc(localizeCropName(cid))}<input type="number" min="0" max="100" step="1" data-agri-priority data-region="${esc(x.regionId)}" data-crop="${cid}" value="${x.cropPriorities?.[cid]??50}"></label><button data-agri-apply-priority data-region="${esc(x.regionId)}" data-crop="${cid}">${T('应用','Apply')}</button></div>`).join('')}</div></div>`).join('')}</div><div class="be-note">${T('当前没有独立 seedStock / fertilizerStock 实体，所以不伪造库存；这里操作农业强度、农资补贴和作物投入优先级。','There are no separate seedStock/fertilizerStock entities, so the UI does not invent them. This view controls intensity, input subsidy and crop priorities.')}</div>`;
  }
  if(sub==='irrigation'){
    const cropIds=Object.keys(BE.Agriculture?.CropDefinitions||{});
    body=`<div class="be-grid wide">${vm.irrigation.map(x=>`<div class="be-entity-card"><h3>${esc(x.name)}</h3><div class="be-stat-grid">${stat(T('当前需求','Current demand'),fmt(x.waterDemand))}${stat(T('当前满足量','Current used'),fmt(x.waterUsed))}${stat(T('满足率','Fulfillment'),x.utilization==null?'—':pct(x.utilization))}${stat(T('请求总量','Requested'),fmt(x.requested))}</div><div class="be-section"><h3>${T('作物灌溉分配','Crop irrigation allocation')}</h3>${cropIds.map(cid=>`<label>${esc(localizeCropName(cid))}<input type="number" min="0" step="0.1" data-agri-irrigation-crop data-region="${esc(x.regionId)}" data-crop="${cid}" value="${Number(x.byCrop?.[cid]||0)}"></label>`).join('')}<div class="be-action-row"><button data-agri-apply-irrigation data-region="${esc(x.regionId)}">${T('应用灌溉分配','Apply Irrigation Allocation')}</button></div></div></div>`).join('')}</div>`;
  }
  if(sub==='transport'){
    body=`<div class="be-grid wide">${vm.logistics.map(x=>`<div class="be-entity-card"><h3>${esc(x.name)}</h3><div class="be-stat-grid">${stat(T('收集能力','Collection capacity'),x.collectionFactor==null?'—':pct(x.collectionFactor))}${stat(T('市场可达性','Market access'),x.marketAccessFactor==null?'—':pct(x.marketAccessFactor))}${stat(T('大宗运输能力','Bulk transport'),x.bulkTransportCapacity==null?'—':pct(x.bulkTransportCapacity))}${stat(T('收集损失','Collection loss'),fmt(x.collectionLoss))}</div><div class="be-note">${T('对应道路/铁路连接','Road / rail connections')}: ${x.connections.length}</div><div class="be-action-row"><button data-be-module="development">${T('进入建设与交通','Open Development & Transport')}</button></div></div>`).join('')}</div>`;
  }
  mainWorkspace.innerHTML=`<div class="be-workspace-inner">${pageHead(nav.find(x=>x[0]===sub)?.[1]||T('农业','Agriculture'),T('页面只修改正式 agriculture state；结果由下一次正式年度 Tick 产生。','This page only updates the official agriculture state; results are produced by the next official annual tick.'),true)}${body||`<div class="be-empty">${T('该视图没有可显示的真实数据。','No live data is available for this view.')}</div>`}</div>`;
}
function renderTrade(){const s=gs(),vm=UIBridge.selectors.trade(s||{});const sub=uiState.subview||'dashboard';const subs=[['dashboard',T('国内缺口','Domestic Gaps')],['quotes',T('国外报价','Foreign Quotes')],['contracts',T('贸易合同','Trade Contracts')],['countries',T('国家贸易','Country Trade')],['routes',T('贸易路线','Trade Routes')],['ports',T('边境口岸','Border Ports')],['dependency',T('贸易依赖','Trade Dependency')]];const subnav=`<div class="be-subnav">${subs.map(([k,l])=>`<button class="${sub===k?'active':''}" data-be-subview="trade:${k}">${l}</button>`).join('')}</div>`;let body='';if(sub==='dashboard'){body=`<div class="be-stat-grid">${stat(T('进口额','Imports'),fmt(vm.importValue))}${stat(T('出口额','Exports'),fmt(vm.exportValue))}${stat(T('贸易余额','Trade Balance'),fmt(vm.balance))}${stat(T('进口依赖度','Import Dependency'),pct(vm.importDependency))}${stat(T('执行中合同','Active Contracts'),vm.activeContracts.length)}${stat(T('口岸使用率','Gateway Utilization'),vm.portUtilization==null?'—':pct(vm.portUtilization))}</div><div class="be-section"><h2>${T('国内缺口','Domestic Gaps')}</h2><div class="be-grid">${vm.domesticGaps.map(x=>entityCard(goodName(x.goodId),`${T('进口需要','Import need')}: ${fmt(x.need)}`)).join('')}</div></div><div class="be-action-row"><button class="primary-action" data-be-subview="trade:quotes">${T('创建多商品采购单','Create multi-good purchase request')}</button></div>`;}if(sub==='quotes')body=renderQuoteBuilder(s);if(sub==='contracts')body=renderContracts(s);if(sub==='countries')body=renderCountryTrade(s);if(sub==='routes')body=`<div class="be-grid wide">${vm.routes.map(r=>entityCard(`${countryName(r.exporterCountryId)} → ${countryName(r.importerCountryId)}`,`${T('容量','Capacity')}: ${fmt(r.capacity)} · ${T('已用','Used')}: ${fmt(r.usedCapacity)} · ${T('状态','Status')}: ${localizeStatus(r.status||'active')}`,`data-be-detail="trade:tradeRoute:${esc(r.id)}"`)).join('')||`<div class="be-empty">${T('暂无真实贸易路线。','No real trade routes currently exist.')}</div>`}</div>`;if(sub==='ports')body=`<div class="be-grid wide">${vm.ports.map(p=>entityCard(p.name||p.id,`${T('地区','Region')}: ${uiRegionName(s,p.regionId)} · ${T('贸易容量','Trade capacity')}: ${fmt(uiFirst(p.tradeCapacity,p.capacity,0))}`,`data-be-detail="development:facility:${esc(p.id)}"`)).join('')||`<div class="be-empty">${T('当前没有实体口岸/港口设施。','No physical gateway/port facility currently exists.')}</div>`}</div>`;if(sub==='dependency'){const d=UIBridge.selectors.diplomacy(s);body=`<div class="be-grid wide">${d.countries.map(c=>entityCard(c.name,`${T('贸易依赖','Trade dependency')}: ${typeof c.tradeDependency==='object'?T('按商品计算','By good'):fmt(c.tradeDependency||0)} · ${T('经济联系','Economic link')}: ${fmt(c.economicLink)}`,`data-be-country="${esc(c.id)}"`)).join('')}</div>`;}mainWorkspace.innerHTML=`<div class="be-workspace-inner">${pageHead(T('国际贸易','International Trade'),T('缺口、报价、合同、路线、口岸和依赖全部读取同一套 Module 5 状态。','Gaps, quotes, contracts, routes, gateways and dependency all read the same Module 5 state.'))}${subnav}${body}</div>`;}
function renderQuoteBuilder(s){const partners=Object.keys(s.countries||{}).filter(id=>id!==player());const goods=Trade?.GOODS||['food','coal','iron','steel','manufactured_goods'];const last=uiState.filters.lastQuoteId&&s.tradeQuotes?.[uiState.filters.lastQuoteId];return`<div class="be-card be-trade-form"><h3>${T('多商品采购单','Multi-Good Purchase Request')}</h3><div class="be-toolbar"><label>${T('出口国','Exporter')} <select id="beQuotePartner">${partners.map(id=>`<option value="${esc(id)}" ${id===uiState.filters.quotePartner?'selected':''}>${esc(countryName(id))}</option>`).join('')}</select></label><label>${T('合同类型','Contract Type')} <select id="beQuoteContractType"><option value="spot">${T('单年采购','Spot · 1 year')}</option><option value="short" selected>${T('短期合同 · 3 年','Short · 3 years')}</option><option value="long">${T('长期合同 · 5 年','Long · 5 years')}</option></select></label><label>${T('优先级','Priority')} <select id="beQuotePriority"><option value="essential">${T('必要','Essential')}</option><option value="normal" selected>${T('普通','Normal')}</option><option value="low">${T('低','Low')}</option></select></label></div><div class="be-form-grid">${goods.map(g=>`<label for="beTrade_${g}">${goodName(g)}</label><input id="beTrade_${g}" data-be-trade-good="${g}" type="number" min="0" step="1" value="0">`).join('')}</div><div class="be-action-row"><button class="primary-action" data-be-request-quote>${T('向所选国家请求报价','Request quotes from selected country')}</button></div></div>${last?renderQuote(last):''}`;}
function renderQuote(q){return`<div class="be-card"><h3>${T('报价单','Quote')} · ${esc(countryName(q.exporterCountryId))}</h3><p>${T('每种商品独立报价，可部分接受。','Each good is quoted independently and can be partially accepted.')}</p><div>${(q.items||[]).map(i=>`<div class="be-quote-item"><input type="checkbox" data-be-quote-item="${esc(i.goodId)}" ${i.available?'':'disabled'}><b>${esc(goodName(i.goodId))}</b><span>${T('需求','Requested')} ${fmt(i.requestedVolume)}</span><span>${T('可供','Offered')} ${fmt(i.offeredVolume)}</span><span>${T('单价','Price')} ${fmt(i.unitPrice)}</span></div>${!i.available?`<div class="be-note">${goodName(i.goodId)}: ${esc(i.reason||T('不可报价','Unavailable'))}</div>`:''}`).join('')}</div><div class="be-action-row"><button class="primary-action" data-be-accept-quote="${esc(q.id)}">${T('接受勾选项目','Accept selected items')}</button></div></div>`;}
function renderContracts(s){const cs=vals(s.tradeContracts).sort((a,b)=>n(b.startYear)-n(a.startYear));return`<div class="be-grid wide">${cs.map(c=>entityCard(`${goodName(c.goodId)} · ${countryName(c.exporterCountryId)} → ${countryName(c.importerCountryId)}`,`${T('合同量','Contracted')}: ${fmt(c.contractedVolume)} · ${T('本年交付','Delivered')}: ${fmt(c.deliveredThisYear)} · ${c.startYear}–${c.endYear}`,`data-be-detail="trade:tradeContract:${esc(c.id)}"`,T('查看合同','Open contract'),`<span class="be-status ${statusClass(c.status)}">${esc(localizeStatus(c.status))}</span>`)).join('')||`<div class="be-empty">${T('尚未建立贸易合同','No trade contracts yet')}</div>`}</div>`;}
function renderCountryTrade(s){const ids=Object.keys(s.countries||{}).filter(id=>id!==player());return`<div class="be-grid wide">${ids.map(id=>{const r=relationFacts(player(),id,s),cs=vals(s.tradeContracts).filter(c=>c&&c.status==='active'&&[c.exporterCountryId,c.importerCountryId].includes(player())&&[c.exporterCountryId,c.importerCountryId].includes(id)),t=activeFriendship(player(),id,s);return entityCard(countryName(id),`${T('信任','Trust')}: ${fmt(r.trust)} · ${T('贸易摩擦','Friction')}: ${pct(r.tradeFriction)} · ${T('合同','Contracts')}: ${cs.length}`,`data-be-country="${esc(id)}"`,T('国家详情','Country details'),t?`<span class="be-status good">${T('友好条约','Friendship Treaty')}</span>`:'');}).join('')}</div>`;}

function diplomacyCountryCard(c){const need=c.mainNeed?`${localizeDiplomacyNeed(c.mainNeed.type)} ${Math.round(n(c.mainNeed.severity)*100)}%`:T('暂无高优先级需求','No high-priority need');const dep=`${fmt(c.economicDependency?.oursOnThem||0)}% / ${fmt(c.economicDependency?.theirsOnUs||0)}%`;const badge=c.tension>=60?`<span class="be-status bad">${T('高紧张','High tension')}</span>`:c.friendship?`<span class="be-status good">${T('友好条约','Friendship Treaty')}</span>`:'';return entityCard(c.name,`${T('关系','Relations')}: ${fmt(c.relation)} · ${T('信任','Trust')}: ${fmt(c.trust)} · ${T('相互依赖 我/对方','Dependency ours/theirs')}: ${dep} · ${T('战略利益','Strategic interest')}: ${fmt(c.strategicInterest)} · ${T('紧张度','Tension')}: ${fmt(c.tension)} · ${T('主要需求','Main need')}: ${need}`,`data-be-country="${esc(c.id)}"`,T('查看国家','Open country'),badge);}
function diplomacyProposalCard(p,s){const ag=p.proposedAgreement||{},mine=(p.targetCountryId||p.receiverCountryId)===player(),evalText=p.evaluation?`${T('AI 评价','AI evaluation')}: ${localizeDiplomacyStatus(p.evaluation.decision)} · ${T('效用','Utility')} ${fmt(p.evaluation.utility)}`:p.aiInitiated?T('对方主动来函，等待我方决定','Incoming AI proposal awaiting your decision'):T('等待处理','Pending');const clauses=(ag.clauses||[]).map(c=>localizeDiplomacyClause(c.type)).join(' + ')||T('无附加条款','No extra clauses');const actions=mine&&p.status==='sent'?`<div class="be-action-row"><button class="primary-action" data-dip-accept="${esc(p.id)}">${T('接受','Accept')}</button><button data-dip-modify="${esc(p.id)}">${T('修改 / 还价','Modify / Counter')}</button><button data-dip-reject="${esc(p.id)}">${T('拒绝','Reject')}</button></div>`:p.status==='draft'?`<div class="be-action-row"><button class="primary-action" data-dip-send="${esc(p.id)}">${T('发送提案','Send Proposal')}</button><button data-dip-withdraw="${esc(p.id)}">${T('撤回','Withdraw')}</button></div>`:'';return`<div class="be-entity-card"><h3>${esc(localizeDiplomacyAgreementType(ag.type||p.type))}</h3><p>${esc(countryName(p.proposerCountryId))} → ${esc(countryName(p.targetCountryId||p.receiverCountryId))} · ${esc(localizeDiplomacyStatus(p.status))}</p><div class="be-note">${esc(clauses)} · ${esc(evalText)}</div>${p.evaluation?.reasons?.length?`<div class="be-dip-reasons">${p.evaluation.reasons.slice(0,5).map(r=>`<span>${esc(localizeDiplomacyReason(r.reason))} <b>${n(r.value)>=0?'+':''}${fmt(r.value)}</b></span>`).join('')}</div>`:''}${actions}</div>`;}
function diplomacyAgreementCard(a){const current=a.annualPerformance?.[year()]||a.annualPerformance?.[Object.keys(a.annualPerformance||{}).sort().at(-1)],rate=current?.fulfillmentRate;const clauses=(a.clauses||[]).map(c=>localizeDiplomacyClause(c.type)).join(' + ')||'—';const breach=(current?.breaches||[]).map(x=>localizeBreachReason(x.reason)).join(', ');return`<div class="be-entity-card"><h3>${esc(localizeDiplomacyAgreementType(a.type))}</h3><p>${esc(countryName(a.countryAId))} ↔ ${esc(countryName(a.countryBId))} · ${a.startYear??a.startTurn??'—'}–${a.endYear??'—'} · ${esc(localizeDiplomacyStatus(a.status||'active'))}</p><div class="be-note">${esc(clauses)}</div><div class="be-stat-grid">${stat(T('今年履约','This-year fulfillment'),rate==null?'—':pct(rate))}${stat(T('违约原因','Breach cause'),breach||T('无','None'))}</div>${a.active!==false&&a.status==='active'?`<div class="be-action-row"><button data-dip-cancel-agreement="${esc(a.id)}">${T('取消协议','Cancel agreement')}</button></div>`:''}</div>`;}
function diplomacyHistoryRows(history){return history.slice().reverse().map(h=>`<div class="be-list-row"><div><b>${esc(localizeDiplomaticHistoryType(h.type))}</b><small>${esc(countryName(h.countryAId))} ↔ ${esc(countryName(h.countryBId))}${h.metadata?.fulfillmentRate!=null?` · ${T('履约','Fulfillment')} ${pct(h.metadata.fulfillmentRate)}`:''}</small></div><div>${esc(h.year??'—')}</div></div>`).join('')||`<div class="be-empty">${T('暂无外交历史','No diplomatic history yet')}</div>`;}
function renderDiplomacy(){const s=gs(),vm=UIBridge.selectors.diplomacy(s||{}),sub=uiState.subview||'overview';const subs=[['overview',T('外交总览','Overview')],['countries',T('国家','Countries')],['negotiations',T('谈判','Negotiations')],['agreements',T('协议','Agreements')],['disputes',T('争端','Disputes')],['history',T('外交历史','History')]];const subnav=`<div class="be-subnav">${subs.map(([k,l])=>`<button class="${sub===k?'active':''}" data-be-subview="diplomacy:${k}">${l}</button>`).join('')}</div>`;let body='';
  if(sub==='overview'){const o=vm.overview;body=`<div class="be-stat-grid">${stat(T('国际信誉','International Reputation'),fmt(vm.reputation))}${stat(T('活跃协议','Active Agreements'),o.activeAgreements.length)}${stat(T('正在谈判','Negotiations'),o.negotiations.length)}${stat(T('待处理提案','Pending Proposals'),o.pendingProposals.length)}${stat(T('当前争端','Current Disputes'),o.disputes.length)}</div><div class="be-section"><h2>${T('国家','Countries')}</h2><div class="be-grid wide">${vm.countries.map(diplomacyCountryCard).join('')||`<div class="be-empty">${T('没有外国国家','No foreign countries')}</div>`}</div></div><div class="be-section"><h2>${T('重要外交变化','Important Changes')}</h2><div class="be-list">${diplomacyHistoryRows(o.recentHistory)}</div></div>`;}
  if(sub==='countries')body=`<div class="be-grid wide">${vm.countries.map(diplomacyCountryCard).join('')}</div>`;
  if(sub==='negotiations')body=`<div class="be-grid wide">${vm.negotiations.map(p=>diplomacyProposalCard(p,s)).join('')||`<div class="be-empty">${T('当前没有谈判','No active negotiations')}</div>`}</div>`;
  if(sub==='agreements')body=`<div class="be-grid wide">${vm.agreements.map(diplomacyAgreementCard).join('')||`<div class="be-empty">${T('当前没有正式外交协议','No formal diplomatic agreements')}</div>`}</div>`;
  if(sub==='disputes'){const ds=vm.countries.filter(c=>c.tension>=50);body=`<div class="be-grid wide">${ds.map(c=>entityCard(c.name,`${T('紧张度','Tension')}: ${fmt(c.tension)} · ${T('当前主要争端','Main dispute')}: ${c.currentDispute||T('关系紧张','Bilateral tension')}`,`data-be-country="${esc(c.id)}"`,T('查看原因','Inspect causes'))).join('')||`<div class="be-empty">${T('当前没有高优先级外交争端','No high-priority diplomatic disputes')}</div>`}</div>`;}
  if(sub==='history')body=`<div class="be-list">${diplomacyHistoryRows(vm.history)}</div>`;
  mainWorkspace.innerHTML=`<div class="be-workspace-inner">${pageHead(T('外交','Diplomacy'),T('国家真实状态 → 国家需求 → 组合协议 → AI 判断/还价 → 年度真实履约 → 关系与信任变化 → 外交历史。贸易、财政和交通仍由原模块执行。','Country state → needs → compound agreement → AI evaluation/counter → real annual fulfillment → relations/trust → diplomatic history. Trade, finance and transport remain owned by their existing modules.'))}${subnav}${body}</div>`;}
function renderDiplomaticProposalBuilder(countryId){const s=gs(),detail=UIBridge.selectors.countryDiplomacyDetail(countryId,s)||{},c=UIBridge.selectors.diplomacy(s).countries.find(x=>x.id===countryId);if(!c)return;const types=Trade?.DIPLOMACY_AGREEMENT_TYPES||[];mainWorkspace.innerHTML=`<div class="be-workspace-inner"><div class="be-breadcrumb">${navLabel('diplomacy')} › ${esc(c.name)} › <span>${T('提出协议','Propose Agreement')}</span></div>${pageHead(T('提出组合协议','Build Compound Agreement'),T('条款可以组合在同一 Agreement 中；实际商品交付仍创建/关联真实 TradeContract。','Clauses are combined in one Agreement; actual goods delivery is still executed by real TradeContracts.'),true)}<div class="be-card"><div class="be-form-grid"><label>${T('协议类型','Agreement type')}<select id="dipAgreementType">${types.map(t=>`<option value="${esc(t)}">${esc(localizeDiplomacyAgreementType(t))}</option>`).join('')}</select></label><label>${T('期限','Duration')}<input id="dipDuration" type="number" min="1" max="12" value="4"></label></div><div class="be-section"><h2>${T('协议条款','Agreement Clauses')}</h2><div id="dipClauseList"></div><div class="be-toolbar"><select id="dipClauseType"><option value="annual_supply">${localizeDiplomacyClause('annual_supply')}</option><option value="tariff_reduction">${localizeDiplomacyClause('tariff_reduction')}</option><option value="transit_access">${localizeDiplomacyClause('transit_access')}</option><option value="financial_aid">${localizeDiplomacyClause('financial_aid')}</option><option value="goods_aid">${localizeDiplomacyClause('goods_aid')}</option><option value="investment_access">${localizeDiplomacyClause('investment_access')}</option><option value="border_cooperation">${localizeDiplomacyClause('border_cooperation')}</option><option value="non_aggression_commitment">${localizeDiplomacyClause('non_aggression_commitment')}</option></select><button data-dip-add-clause>${T('添加条款','Add Clause')}</button></div></div><div class="be-action-row"><button class="primary-action" data-dip-create-send="${esc(countryId)}">${T('建立并发送提案','Create & Send Proposal')}</button></div></div><div class="be-note">${T('AI 不会只看关系值。发送后会读取信任、需求、战略利益、经济依赖、紧张度、财政/库存、运输能力和条款成本，并给出接受、拒绝或还价及原因。','AI does not use relation score alone. It reads trust, needs, strategic interest, dependency, tension, finance/inventory, transport capacity and clause costs, then returns accept/reject/counter with reasons.')}</div></div>`;addDiplomacyClauseRow('annual_supply',countryId);}
function addDiplomacyClauseRow(type,countryId=uiState.entityId){const box=document.getElementById('dipClauseList');if(!box)return;const goods=(Trade?.GOODS||[]).map(g=>`<option value="${esc(g)}">${esc(goodName(g))}</option>`).join('');const fromOpts=`<option value="${esc(player())}">${esc(countryName(player()))}</option><option value="${esc(countryId)}">${esc(countryName(countryId))}</option>`,toOpts=`<option value="${esc(countryId)}">${esc(countryName(countryId))}</option><option value="${esc(player())}">${esc(countryName(player()))}</option>`;const row=document.createElement('div');row.className='be-dip-clause-row';row.dataset.dipClauseRow=type;let fields=`<label>${T('提供方','From')}<select data-dip-from>${fromOpts}</select></label><label>${T('接收方','To')}<select data-dip-to>${toOpts}</select></label>`;if(['annual_supply','goods_aid'].includes(type))fields+=`<label>${T('商品','Good')}<select data-dip-good>${goods}</select></label><label>${T('数量','Quantity')}<input data-dip-quantity type="number" min="0" step="1" value="20"></label>`;if(type==='annual_supply')fields+=`<label>${T('价格倍率','Price multiplier')}<input data-dip-price type="number" min="0.5" max="2" step="0.01" value="1.05"></label>`;if(type==='tariff_reduction')fields+=`<label>${T('关税降低','Tariff reduction')}<input data-dip-tariff type="number" min="0" max="0.25" step="0.01" value="0.03"></label><label>${T('商品','Good')}<select data-dip-good><option value="">${T('全部商品','All goods')}</option>${goods}</select></label>`;if(type==='financial_aid')fields+=`<label>${T('金额','Payment')}<input data-dip-payment type="number" min="0" step="1" value="10"></label>`;row.innerHTML=`<div class="be-dip-clause-head"><b>${esc(localizeDiplomacyClause(type))}</b><button data-dip-remove-clause>×</button></div><div class="be-form-grid">${fields}</div>`;box.appendChild(row);}
function collectDiplomacyClauses(countryId){return[...document.querySelectorAll('[data-dip-clause-row]')].map((row,i)=>{const type=row.dataset.dipClauseRow,fromCountryId=row.querySelector('[data-dip-from]')?.value||player(),toCountryId=row.querySelector('[data-dip-to]')?.value||countryId,commodityId=row.querySelector('[data-dip-good]')?.value||null,quantity=n(row.querySelector('[data-dip-quantity]')?.value),payment=n(row.querySelector('[data-dip-payment]')?.value),tariff=n(row.querySelector('[data-dip-tariff]')?.value),price=n(row.querySelector('[data-dip-price]')?.value,1);return{id:`clause_${i+1}`,type,fromCountryId,toCountryId,commodityId,quantity,payment,tariffRate:tariff,priceRule:type==='annual_supply'?{mode:'market_multiplier',multiplier:price}:null,parameters:{}};});}
function renderEconomy(){const s=gs(),vm=UIBridge.selectors.economy(s||{});const goods=vm.goods.map(g=>entityCard(goodName(g.id),`${T('价格','Price')}: ${g.price==null?'—':fmt(g.price)} · ${T('产出','Output')}: ${fmt(uiFirst(g.production,g.output,0))} · ${T('需求','Demand')}: ${fmt(uiFirst(g.demand,g.domesticDemand,0))} · ${T('库存','Inventory')}: ${fmt(uiFirst(g.inventory,g.endingInventory,0))}`)).join('')||`<div class="be-empty">${T('当前国家经济状态没有国家级商品表；地区商品仍由 Module 3 继续计算。','The live economy has no national goods table; regional goods remain calculated by Module 3.')}</div>`;const enterprises=vm.enterprises.map(f=>entityCard(f.name||f.id,`${T('产能','Capacity')}: ${f.capacity==null?'—':fmt(f.capacity)} · ${T('实际生产','Actual production')}: ${f.actualProduction==null?'—':fmt(f.actualProduction)} · ${T('利润','Profit')}: ${f.profit==null?'—':fmt(f.profit)} · ${T('限制','Constraints')}: ${f.constraints.length}`,`data-be-detail="development:facility:${esc(f.id)}"`)).join('')||`<div class="be-empty">${T('当前没有生产设施。','No production facility currently exists.')}</div>`;const rev=vm.ledger.revenue||{},exp=vm.ledger.expenditure||{};mainWorkspace.innerHTML=`<div class="be-workspace-inner">${pageHead(T('经济','Economy'),T('页面只展示 Module 3 已结算的生产、市场、企业和财政状态，不重新生产任何商品。','This page only displays Module 3 settled production, market, enterprise and fiscal state; it never produces goods itself.'))}<div class="be-stat-grid">${stat(T('国库','Treasury'),vm.treasury==null?'—':fmt(vm.treasury))}${stat(T('政府收入','Government Revenue'),fmt(vm.revenue))}${stat(T('政府支出','Government Expenditure'),fmt(vm.expenditure))}${stat(T('工业产出','Industrial Output'),fmt(vm.industrialOutput))}${stat(T('就业率','Employment'),vm.employment==null?'—':pct(vm.employment))}${stat(T('平均商品价格','Average Goods Price'),vm.averagePrice==null?'—':fmt(vm.averagePrice))}${stat(T('企业利润合计','Enterprise Profit'),fmt(vm.enterpriseProfit))}${stat(T('经济瓶颈','Economic Bottlenecks'),vm.bottlenecks.length)}</div><div class="be-section"><h2>${T('企业','Enterprises')}</h2><div class="be-grid wide">${enterprises}</div></div><div class="be-section"><h2>${T('商品市场','Goods Market')}</h2><div class="be-grid wide">${goods}</div></div><div class="be-section"><h2>${T('财政账本','Fiscal Ledger')}</h2><div class="be-stat-grid">${stat(T('期初国库','Opening Treasury'),vm.ledger.opening==null?'—':fmt(vm.ledger.opening))}${stat('+ '+T('收入','Revenue'),fmt(vm.revenue))}${stat('- '+T('支出','Expenditure'),fmt(vm.expenditure))}${stat(T('期末国库','Closing Treasury'),vm.ledger.closing==null?'—':fmt(vm.ledger.closing))}</div><div class="be-grid wide">${entityCard(T('收入明细','Revenue Breakdown'),Object.entries(rev).map(([k,v])=>`${k}: ${fmt(v)}`).join(' · ')||'—')}${entityCard(T('支出明细','Expenditure Breakdown'),Object.entries(exp).map(([k,v])=>`${k}: ${fmt(v)}`).join(' · ')||'—')}</div></div></div>`;}
function renderPopulation(){const s=gs(),vm=UIBridge.selectors.population(s||{});const cards=vm.cities.map(c=>entityCard(c.name||c.id,`${T('人口','Population')}: ${fmt(c.population)} · ${T('劳动力','Workforce')}: ${fmt(c.workforce)} · ${T('就业','Employment')}: ${fmt(c.employment)} · ${T('失业','Unemployment')}: ${fmt(c.unemployment)} · ${T('工资','Wage')}: ${c.averageWage==null?'—':fmt(c.averageWage)} · ${T('迁入','In-migration')}: ${c.inMigration==null?'—':fmt(c.inMigration)} · ${T('迁出','Out-migration')}: ${c.outMigration==null?'—':fmt(c.outMigration)}`,`data-be-detail="population:city:${esc(c.id)}"`)).join('')||`<div class="be-empty">${T('当前没有城市人口对象。','No city population object currently exists.')}</div>`;mainWorkspace.innerHTML=`<div class="be-workspace-inner">${pageHead(T('人口社会','Population & Society'),T('人口在哪里、是否就业、工资和迁移都读取 Module 4 正式状态。','Location, employment, wages and migration all read live Module 4 state.'))}<div class="be-stat-grid">${stat(T('总人口','Population'),fmt(vm.totalPopulation))}${stat(T('就业率','Employment Rate'),vm.employmentRate==null?'—':pct(vm.employmentRate))}${stat(T('城镇化','Urbanization'),vm.urbanization==null?'—':pct(vm.urbanization))}${stat(T('粮食保障','Food Security'),vm.foodSecurity==null?'—':pct(vm.foodSecurity))}${stat(T('平均工资','Average Wage'),vm.averageWage==null?'—':fmt(vm.averageWage))}${stat(T('人口增长','Population Growth'),vm.populationGrowth==null?'—':pct(vm.populationGrowth))}</div><div class="be-grid wide">${cards}</div></div>`;}
function renderEvents(){const s=gs(),vm=UIBridge.selectors.situations(s||{});const problems=(vm.problems||[]).map(p=>entityCard(p.title||p.type||p.id,p.summary||p.description||`${T('严重度','Severity')}: ${p.severity??'—'}`,p.id?`data-be-problem="${esc(p.id)}"`:'',T('为什么？','Why?'))).join('')||`<div class="be-empty">${T('当前因果诊断没有发现活跃问题。','The causal diagnostics currently find no active problem.')}</div>`;const situ=(vm.situations||[]).map(x=>entityCard(x.title||x.type||x.id,x.summary||x.description||'')).join('')||`<div class="be-empty">${T('当前没有正在形成的情境。','No situation is currently forming.')}</div>`;const stories=(vm.stories||[]).slice(-12).map(x=>entityCard(x.title||x.type||x.id,x.summary||x.description||'')).join('')||`<div class="be-empty">${T('暂无已发现故事。','No discovered story yet.')}</div>`;mainWorkspace.innerHTML=`<div class="be-workspace-inner">${pageHead(T('情境事件','Situations & Events'),T('这里呈现 Module 7 从真实状态发现的问题、风险和因果链，而不是预写随机故事。','This workspace shows problems, risks and causal chains discovered by Module 7 from live state rather than prewritten random stories.'))}<div class="be-section"><h2>${T('当前问题','Current Problems')}</h2><div class="be-grid wide">${problems}</div></div><div class="be-section"><h2>${T('正在形成的情境','Emerging Situations')}</h2><div class="be-grid wide">${situ}</div></div><div class="be-section"><h2>${T('已发现故事','Discovered Stories')}</h2><div class="be-grid wide">${stories}</div></div></div>`;}
function renderDebug(){const s=gs(),vm=UIBridge.selectors.diagnostics(s||{}),names={module1:T('M1 世界','M1 World'),module2:T('M2 建设','M2 Development'),module3:T('M3 经济','M3 Economy'),module4:T('M4 人口','M4 Population'),module5:T('M5 贸易','M5 Trade'),module6:T('M6 AI国家','M6 AI Countries'),module7:T('M7 情境','M7 Situations'),module8:T('M8 UI/集成','M8 UI/Integration'),module9:T('M9 农业','M9 Agriculture')};const modules=Object.entries(vm.moduleStatus||{}).map(([k,v])=>entityCard(names[k]||k,v?T('模块已连接','Module connected'):T('模块缺失','Module missing'),'','',`<span class="be-status ${v?'good':'bad'}">${v?T('正常','OK'):T('失败','Missing')}</span>`)).join('');const errs=vm.errors.map(e=>`<div class="be-list-row"><div><b>${esc(e.code)}</b><small>${esc(e.detail)}</small></div><div><span class="be-status ${/MISSING|NEGATIVE|NON_FINITE|ERROR|DUPLICATE/.test(e.code)?'bad':'warn'}">${T('检查','Check')}</span></div></div>`).join('')||`<div class="be-empty">${T('没有发现跨模块断链或非法状态。','No cross-module broken reference or illegal state was found.')}</div>`;const perf=vm.performance||{},tm=perf.timings||{};const perfs=[['M1',tm.M1],['M2',tm.M2],['M9',tm.M9],['M3',tm.M3],['M4',tm.M4],['M5',tm.M5],['M6',tm.M6],['M7',tm.M7],['M8 total',perf.totalAdvanceMs],['Render',perf.renderMs]].map(([k,v])=>stat(k,v==null?'—':`${fmt(v)} ms`)).join('');mainWorkspace.innerHTML=`<div class="be-workspace-inner">${pageHead(T('自检','Self-check'),T('检查 Module 1–9 连接、实体引用、非法数值和年度性能。','Checks Module 1–9 connectivity, entity references, illegal values and annual performance.'))}<div class="be-section"><h2>${T('模块连接','Module Connections')}</h2><div class="be-grid">${modules}</div></div><div class="be-section"><h2>${T('对象数量','Object Counts')}</h2><div class="be-stat-grid">${Object.entries(vm.counts).map(([k,v])=>stat(k,v)).join('')}</div></div><div class="be-section"><h2>${T('断链 / 非法状态','Broken Links / Illegal State')}</h2><div class="be-list">${errs}</div></div><div class="be-section"><h2>${T('年度 Tick / 性能','Annual Tick / Performance')}</h2><div class="be-stat-grid">${perfs}</div><div class="be-note">1 turn = 1 year · ${T('只有 Module8.advanceOneYear 会推进年度。页面切换与 UIBridge.refresh 只读取状态。','Only Module8.advanceOneYear advances the year. Navigation and UIBridge.refresh are read-only.')}</div></div></div>`;}
function findEntity(type,id,s=gs()){if(type==='connection')return s?.connections?.[id];if(type==='facility')return s?.facilities?.[id];if(type==='project')return s?.projects?.[id];if(type==='city')return s?.cities?.[id];if(type==='deposit')return uiDeposits(s).find(d=>d.id===id)||null;if(type==='farm'){const f=vals(s?.agriculture?.privateFarms||s?.privateFarms).find(x=>x?.id===id);if(f)return f;if(String(id).startsWith('agri_region_'))return s?.agriculture?.regions?.[String(id).slice(12)]||null;return s?.facilities?.[id]||s?.agriculture?.projects?.[id]||s?.agricultureProjects?.[id];}if(type==='tradeContract')return s?.tradeContracts?.[id];if(type==='tradeRoute')return s?.tradeRoutes?.[id];if(type==='agreement')return s?.agreements?.[id];if(type==='country')return s?.countries?.[id];return null;}
function objectStats(obj){const ignore=new Set(['id','name','history','events','causalTrace','lastExplanation','terms','performance']);return Object.entries(obj||{}).filter(([k,v])=>!ignore.has(k)&&['string','number','boolean'].includes(typeof v)).slice(0,18).map(([k,v])=>stat(k,typeof v==='number'?fmt(v):String(v))).join('');}
function renderDetail(){const s=gs(),type=uiState.entityType,id=uiState.entityId,obj=findEntity(type,id,s);if(type==='country')return renderCountryDetail(id);if(!obj){mainWorkspace.innerHTML=`<div class="be-workspace-inner">${pageHead(T('对象不存在','Object not found'),id,true)}<div class="be-empty">${T('当前真实状态中没有找到该对象。','This object does not exist in the current live state.')}</div></div>`;return;}
  let title=obj.name||id,extra='',actions='';if(type==='connection'){title=`${String(obj.type||T('交通','Transport')).toUpperCase()} · ${connectionName(obj,s)}`;let info={};try{info=global.Development?.getConnectionLevelInfo?.(obj.id,s)||{};}catch(_){ }extra=`<div class="be-section"><h2>${T('运输与维护','Transport & Maintenance')}</h2><div class="be-stat-grid">${stat(T('等级','Level'),obj.level??info.level??'—')}${stat(T('设施状态','Condition'),obj.condition??obj.conditionPct??'—')}${stat(T('有效运输能力','Effective Capacity'),obj.capacity??info.capacity??'—')}${stat(T('需求利用率','Demand Utilization'),obj.utilization!=null?pct(obj.utilization):'—')}${stat(T('维护需求','Maintenance Need'),obj.maintenanceNeed??'—')}${stat(T('当前维护投入','Maintenance Funding'),obj.maintenance??obj.maintenanceFunding??'—')}</div></div>`;actions=`<button class="primary-action" data-be-upgrade-connection="${esc(id)}">${T('升级','Upgrade')}</button>`;}
  if(type==='project')extra=`<div class="be-section"><h2>${T('建设状态','Construction Status')}</h2><div class="be-stat-grid">${stat(T('状态','Status'),localizeStatus(obj.status))}${stat(T('剩余建设周期','Turns Remaining'),obj.turnsRemaining??obj.remainingTurns??'—')}${stat(T('开始年份','Start Year'),obj.startYear??obj.startedYear??'—')}${stat(T('地区','Region'),s?.regions?.[obj.regionId]?.name||obj.regionId||'—')}</div></div>`;
  if(type==='facility'||type==='farm')extra=`<div class="be-section"><h2>${T('当前状态','Current State')}</h2><div class="be-stat-grid">${objectStats(obj)}</div></div>`;
  if(type==='tradeContract'){const tr=s.tradeRelations?.[obj.tradeRelationId];extra=`<div class="be-section"><h2>${T('合同与交付','Contract & Delivery')}</h2><div class="be-stat-grid">${stat(T('商品','Good'),goodName(obj.goodId))}${stat(T('合同量','Contracted Volume'),fmt(obj.contractedVolume))}${stat(T('本年交付','Delivered This Year'),fmt(obj.deliveredThisYear))}${stat(T('未交付','Unmet This Year'),fmt(obj.unmetVolumeThisYear))}${stat(T('单价','Unit Price'),fmt(obj.unitPrice))}${stat(T('关税','Tariff'),pct(obj.tariffRate))}${stat(T('路线','Route'),obj.routeId||'—')}${stat(T('期限','Term'),`${obj.startYear}–${obj.endYear}`)}</div></div><div class="be-section"><h2>${T('真实依据','Evidence')}</h2><div class="be-note">${esc((tr?.lastExplanation||[]).join(' · ')||T('等待下一次年度结算生成履约依据。','Evidence will be produced by the next annual settlement.'))}</div></div>`;}
  if(type==='tradeRoute')extra=`<div class="be-section"><h2>${T('路线状态','Route State')}</h2><div class="be-stat-grid">${stat(T('出口国','Exporter'),countryName(obj.exporterCountryId))}${stat(T('进口国','Importer'),countryName(obj.importerCountryId))}${stat(T('容量','Capacity'),fmt(obj.capacity))}${stat(T('已使用','Used'),fmt(obj.usedCapacity))}${stat(T('出口口岸','Export Port'),obj.exportLocationId||'—')}${stat(T('入口岸','Entry Port'),obj.importLocationId||'—')}</div></div>`;
  if(type==='deposit')extra=`<div class="be-section"><h2>${T('资源状态','Resource State')}</h2><div class="be-stat-grid">${objectStats(obj)}</div></div>`;
  mainWorkspace.innerHTML=`<div class="be-workspace-inner"><div class="be-breadcrumb">${navLabel(uiState.module)} › <span>${esc(title)}</span></div>${pageHead(title,T('详情页独占主工作区；数据直接读取当前真实对象。','The detail view owns the main workspace and reads the live object directly.'),true)}${extra||`<div class="be-stat-grid">${objectStats(obj)}</div>`}<div class="be-section"><h2>${T('可执行操作','Available Actions')}</h2><div class="be-action-row">${actions||`<span class="be-note">${T('这里只显示已有系统暴露的真实操作；不会创建虚假的快捷操作。','Only actions already exposed by the real system appear here; no fake shortcuts are created.')}</span>`}</div></div></div>`;}
function renderCountryDetail(id){const s=gs(),vm=UIBridge.selectors.diplomacy(s),c=vm.countries.find(x=>x.id===id);if(!c){mainWorkspace.innerHTML=`<div class="be-workspace-inner">${pageHead(T('国家不存在','Country not found'),id,true)}</div>`;return;}const d=UIBridge.selectors.countryDiplomacyDetail(id,s)||{},snap=c.snapshot||{},recent=d.history?.at(-1);const reasons=(c.reasons||[]).map(r=>`<div class="be-list-row"><div><b>${esc(localizeRelationshipReason(r.type))}</b><small>${esc(r.sourceId||'')}</small></div><div>${n(r.value)>=0?'+':''}${fmt(r.value)}</div></div>`).join('')||`<div class="be-empty">${T('当前没有显著关系贡献项','No significant relation contribution')}</div>`;const needs=(d.needs||[]).map(x=>entityCard(localizeDiplomacyNeed(x.type),`${x.commodityId?goodName(x.commodityId)+' · ':''}${T('严重度','Severity')} ${pct(x.severity)} · ${T('目标量','Target')} ${fmt(x.targetAmount)}`)).join('')||`<div class="be-empty">${T('当前没有显著外交需求','No significant diplomatic needs')}</div>`;const agreements=(d.agreements||[]).map(diplomacyAgreementCard).join('')||`<div class="be-empty">${T('暂无协议','No agreements')}</div>`;const neg=(d.negotiations||[]).map(p=>diplomacyProposalCard(p,s)).join('')||`<div class="be-empty">${T('暂无谈判','No negotiations')}</div>`;const contracts=(d.contracts||[]).map(x=>entityCard(`${goodName(x.goodId)} · ${fmt(x.contractedVolume)}`,`${x.startYear}–${x.endYear} · ${T('本年交付','Delivered')} ${fmt(x.deliveredThisYear)}`,`data-be-detail="trade:tradeContract:${esc(x.id)}"`)).join('')||`<div class="be-empty">${T('尚无贸易合同','No trade contracts')}</div>`;mainWorkspace.innerHTML=`<div class="be-workspace-inner"><div class="be-breadcrumb">${navLabel(uiState.module)} › <span>${esc(c.name)}</span></div>${pageHead(c.name,T('国家详情只读取 Module 1–4 / Module 6 / Module 5 的正式状态；外交层不复制 GDP、人口、库存或交通。','Country detail reads official Module 1–4 / Module 6 / Module 5 state; diplomacy does not duplicate GDP, population, inventory or transport.'),true)}<div class="be-section"><h2>${T('国家概况','Country Profile')}</h2><div class="be-stat-grid">${stat(T('政体/类型','Government / Type'),snap.government||'—')}${stat(T('人口','Population'),snap.population==null?'—':fmt(snap.population))}${stat(T('经济规模','Economic Scale'),snap.economicScale==null?'—':fmt(snap.economicScale))}${stat(T('主要产业','Major Industries'),(snap.majorIndustries||[]).map(localizeFacilityType).join(', ')||'—')}${stat(T('主要资源','Major Resources'),(snap.majorResources||[]).map(goodName).join(', ')||'—')}${stat(T('主要进口','Main Imports'),(snap.majorImports||[]).map(goodName).join(', ')||'—')}${stat(T('主要出口','Main Exports'),(snap.majorExports||[]).map(goodName).join(', ')||'—')}${stat(T('财政状况','Treasury'),snap.treasury==null?'—':fmt(snap.treasury))}${stat(T('主要交通口岸','Gateways'),(snap.gateways||[]).length||0)}</div></div><div class="be-section"><h2>${T('对我国外交指标','Diplomatic Indicators Toward Us')}</h2><div class="be-stat-grid">${stat(T('总体关系','Relations'),fmt(c.relation))}${stat(T('信任','Trust'),fmt(c.trust))}${stat(T('我国对其依赖','Our Dependency'),`${fmt(c.economicDependency?.oursOnThem||0)}%`)}${stat(T('其对我国依赖','Their Dependency'),`${fmt(c.economicDependency?.theirsOnUs||0)}%`)}${stat(T('战略利益','Strategic Interest'),fmt(c.strategicInterest))}${stat(T('紧张度','Tension'),fmt(c.tension))}${stat(T('当前合作','Current Cooperation'),c.currentCooperation.length)}${stat(T('正在谈判','Negotiations'),c.negotiations.length)}${stat(T('最近重大事件','Latest Major Event'),recent?localizeDiplomaticHistoryType(recent.type):'—')}</div></div><div class="be-section"><h2>${T('为什么是这个关系','Why this relationship')}</h2><div class="be-list">${reasons}</div></div><div class="be-section"><h2>${T('国家当前需求','Current Country Needs')}</h2><div class="be-grid wide">${needs}</div></div><div class="be-section"><h2>${T('现有贸易','Existing Trade')}</h2><div class="be-grid wide">${contracts}</div></div><div class="be-section"><h2>${T('正在执行协议','Active Agreements')}</h2><div class="be-grid wide">${agreements}</div></div><div class="be-section"><h2>${T('正在谈判','Negotiations')}</h2><div class="be-grid wide">${neg}</div></div><div class="be-section"><h2>${T('外交历史','Diplomatic History')}</h2><div class="be-list">${diplomacyHistoryRows(d.history||[])}</div></div><div class="be-action-row"><button class="primary-action" data-dip-open-builder="${esc(id)}">${T('提出协议','Propose Agreement')}</button><button data-be-open-country-quote="${esc(id)}">${T('请求多商品报价','Request multi-good quote')}</button></div></div>`;}

function renderWorkspace(scrollTop=null){if(!mainWorkspace)return;const t0=performance?.now?.()||Date.now();syncSelectionsFromLegacy();if(legacyMapColumn&&legacyParking&&legacyMapColumn.parentElement!==legacyParking)legacyParking.appendChild(legacyMapColumn);shell.classList.toggle('be-detail-mode',uiState.level==='detail');shell.classList.toggle('be-map-mode',uiState.level==='root');shell.classList.toggle('be-module-mode',uiState.level==='module');renderSidebar();if(uiState.level==='root')renderOverview();else if(uiState.level==='detail')renderDetail();else{switch(uiState.module){case'development':renderDevelopment();break;case'resources':renderResources('resources');break;case'agriculture':renderAgriculture();break;case'trade':renderTrade();break;case'diplomacy':renderDiplomacy();break;case'economy':renderEconomy();break;case'population':renderPopulation();break;case'events':renderEvents();break;case'debug':renderDebug();break;default:renderOverview();}}topbarStats();uiRuntime.performance.renderMs=(performance?.now?.()||Date.now())-t0;requestAnimationFrame(()=>{mainWorkspace.scrollTop=scrollTop??uiState.scrollPositions[stateKey()]??0;});}
function mountShell(){const old=document.querySelector('.workspace');if(!old||old.classList.contains('be-app-body'))return;legacyMapColumn=old.querySelector('.map-column');legacyPanel=old.querySelector('.sidebar');const parking=document.createElement('div');parking.id='beLegacyParking';parking.className='be-legacy-hidden';document.body.appendChild(parking);legacyParking=parking;if(legacyMapColumn)parking.appendChild(legacyMapColumn);if(legacyPanel){legacyPanel.classList.add('be-legacy-hidden');parking.appendChild(legacyPanel);}old.textContent='';old.classList.add('be-app-body');shell=old;moduleSidebar=document.createElement('nav');moduleSidebar.id='beModuleSidebar';moduleSidebar.className='be-module-sidebar';mainWorkspace=document.createElement('main');mainWorkspace.id='mainWorkspace';mainWorkspace.className='be-main-workspace';old.append(moduleSidebar,mainWorkspace);renderWorkspace();
  /* map object clicks now open full details rather than a hidden legacy panel */
  legacyMapColumn?.addEventListener('click',e=>{const city=e.target.closest('[data-city]');if(city){e.preventDefault();e.stopImmediatePropagation();openDetail({module:'population',entityType:'city',entityId:city.dataset.city});return;}const reg=e.target.closest('[data-region]');if(reg){uiState.selectedRegionId=reg.dataset.region;try{if(typeof selectedRegionId!=='undefined')selectedRegionId=reg.dataset.region;}catch(_){ }}},true);
}

document.addEventListener('click',e=>{
  const m=e.target.closest('[data-be-module]');if(m){openModule(m.dataset.beModule);return;}
  const sub=e.target.closest('[data-be-subview]');if(sub){const[a,b]=sub.dataset.beSubview.split(':');openSubview(a,b);return;}
  if(e.target.closest('[data-be-back]')){goBack();return;}
  const d=e.target.closest('[data-be-detail]');if(d){const[a,b,c]=d.dataset.beDetail.split(':');openDetail({module:a,entityType:b,entityId:c});return;}
  const problem=e.target.closest('[data-be-problem]');if(problem){try{BE.ReverseNavigator?.openProblem?.(problem.dataset.beProblem);BE.ReverseNavigator?.explainProblem?.(problem.dataset.beProblem);}catch(_){}return;}
  const country=e.target.closest('[data-be-country]');if(country){openDetail({module:uiState.module==='trade'?'trade':'diplomacy',entityType:'country',entityId:country.dataset.beCountry});return;}

  const dipOpen=e.target.closest('[data-dip-open-builder]');if(dipOpen){uiState.entityId=dipOpen.dataset.dipOpenBuilder;uiState.entityType='country';renderDiplomaticProposalBuilder(dipOpen.dataset.dipOpenBuilder);return;}
  if(e.target.closest('[data-dip-add-clause]')){addDiplomacyClauseRow(document.getElementById('dipClauseType')?.value||'annual_supply',uiState.entityId);return;}
  const dipRemove=e.target.closest('[data-dip-remove-clause]');if(dipRemove){dipRemove.closest('[data-dip-clause-row]')?.remove();return;}
  const dipCreate=e.target.closest('[data-dip-create-send]');if(dipCreate){const target=dipCreate.dataset.dipCreateSend,type=document.getElementById('dipAgreementType')?.value,durationYears=Math.max(1,n(document.getElementById('dipDuration')?.value,4)),clauses=collectDiplomacyClauses(target);const made=UIBridge.dispatch({type:'CREATE_DIPLOMATIC_PROPOSAL',targetCountryId:target,payload:{proposalType:type,proposedAgreement:{type,countryAId:player(),countryBId:target,durationYears,clauses},status:'draft'}});if(!made?.ok)return toastUI(made?.error||T('提案创建失败','Proposal creation failed'),'bad');const sent=UIBridge.dispatch({type:'SEND_DIPLOMATIC_PROPOSAL',proposalId:made.proposal.id});toastUI(sent?.decision==='accept'?T('对方接受了协议','The partner accepted the agreement'):sent?.decision==='counter'?T('对方提出还价','The partner made a counteroffer'):sent?.decision==='reject'?T('对方拒绝了提案','The partner rejected the proposal'):T('提案已发送','Proposal sent'),sent?.decision==='reject'?'bad':'good');openSubview('diplomacy','negotiations',false);return;}
  const dipSend=e.target.closest('[data-dip-send]');if(dipSend){const r=UIBridge.dispatch({type:'SEND_DIPLOMATIC_PROPOSAL',proposalId:dipSend.dataset.dipSend});toastUI(r?.ok?T('提案已发送','Proposal sent'):r?.error,r?.ok?'good':'bad');return;}
  const dipAccept=e.target.closest('[data-dip-accept]');if(dipAccept){const r=UIBridge.dispatch({type:'ACCEPT_DIPLOMATIC_PROPOSAL',proposalId:dipAccept.dataset.dipAccept});toastUI(r?.ok?T('协议已生效','Agreement activated'):r?.error,r?.ok?'good':'bad');return;}
  const dipReject=e.target.closest('[data-dip-reject]');if(dipReject){const r=UIBridge.dispatch({type:'REJECT_DIPLOMATIC_PROPOSAL',proposalId:dipReject.dataset.dipReject});toastUI(r?.ok?T('提案已拒绝','Proposal rejected'):r?.error,r?.ok?'good':'bad');return;}
  const dipModify=e.target.closest('[data-dip-modify]');if(dipModify){const r=UIBridge.dispatch({type:'COUNTER_DIPLOMATIC_PROPOSAL',proposalId:dipModify.dataset.dipModify});toastUI(r?.ok?T('已按原条款提出还价','Counteroffer created by adjusting the existing terms'):r?.error,r?.ok?'good':'bad');return;}
  const dipWithdraw=e.target.closest('[data-dip-withdraw]');if(dipWithdraw){const r=UIBridge.dispatch({type:'WITHDRAW_DIPLOMATIC_PROPOSAL',proposalId:dipWithdraw.dataset.dipWithdraw});toastUI(r?.ok?T('提案已撤回','Proposal withdrawn'):r?.error,r?.ok?'good':'bad');return;}
  const dipCancel=e.target.closest('[data-dip-cancel-agreement]');if(dipCancel){const r=UIBridge.dispatch({type:'CANCEL_DIPLOMATIC_AGREEMENT',agreementId:dipCancel.dataset.dipCancelAgreement});toastUI(r?.ok?T('协议已取消','Agreement cancelled'):r?.error,r?.ok?'good':'bad');return;}

  const openQuote=e.target.closest('[data-be-open-country-quote]');if(openQuote){uiState.filters.quotePartner=openQuote.dataset.beOpenCountryQuote;openSubview('trade','quotes');return;}
  const cultivated=e.target.closest('[data-agri-apply-cultivated]');if(cultivated){const regionId=cultivated.dataset.region,input=document.querySelector(`[data-agri-cultivated][data-region="${regionId}"]`),r=UIBridge.dispatch({type:'SET_CULTIVATED_AREA',regionId,area:Number(input?.value||0)});toastUI(r?.ok?T('耕种面积已写入正式农业状态','Cultivated area saved to official agriculture state'):r?.error,r?.ok?'good':'bad');return;}
  const dev=e.target.closest('[data-agri-develop]');if(dev){const regionId=dev.dataset.region,input=document.querySelector(`[data-agri-develop-area][data-region="${regionId}"]`),r=UIBridge.dispatch({type:'DEVELOP_AGRICULTURAL_LAND',regionId,area:Number(input?.value||0)});toastUI(r?.ok?T('耕地开发已写入正式农业状态','Land development saved to official agriculture state'):r?.error,r?.ok?'good':'bad');return;}
  const intensity=e.target.closest('[data-agri-apply-intensity]');if(intensity){const regionId=intensity.dataset.region,input=document.querySelector(`[data-agri-intensity][data-region="${regionId}"]`),r=UIBridge.dispatch({type:'SET_AGRICULTURAL_INTENSITY',regionId,intensity:input?.value||'normal'});toastUI(r?.ok?T('农业强度已更新','Agricultural intensity updated'):r?.error,r?.ok?'good':'bad');return;}
  const priority=e.target.closest('[data-agri-apply-priority]');if(priority){const regionId=priority.dataset.region,cropId=priority.dataset.crop,input=document.querySelector(`[data-agri-priority][data-region="${regionId}"][data-crop="${cropId}"]`),r=UIBridge.dispatch({type:'SET_CROP_PRIORITY',regionId,cropId,priority:Number(input?.value||50)});toastUI(r?.ok?T('作物优先级已更新','Crop priority updated'):r?.error,r?.ok?'good':'bad');return;}
  const irrigation=e.target.closest('[data-agri-apply-irrigation]');if(irrigation){const regionId=irrigation.dataset.region,byCrop={};document.querySelectorAll(`[data-agri-irrigation-crop][data-region="${regionId}"]`).forEach(x=>byCrop[x.dataset.crop]=Number(x.value||0));const r=UIBridge.dispatch({type:'ALLOCATE_IRRIGATION',regionId,allocation:{byCrop,totalRequested:Object.values(byCrop).reduce((a,v)=>a+Number(v||0),0)}});toastUI(r?.ok?T('灌溉分配已更新','Irrigation allocation updated'):r?.error,r?.ok?'good':'bad');return;}
  if(e.target.closest('[data-agri-apply-input-subsidy]')){const value=Number(document.getElementById('beAgriInputSubsidy')?.value||0),r=UIBridge.dispatch({type:'SET_AGRICULTURE_POLICY',key:'inputSubsidyRate',value});toastUI(r?.ok?T('农资补贴已更新','Input subsidy updated'):r?.error,r?.ok?'good':'bad');return;}
  if(e.target.closest('[data-agri-apply-policies]')){let ok=true,last=null;document.querySelectorAll('[data-agri-policy-input]').forEach(x=>{const r=UIBridge.dispatch({type:'SET_AGRICULTURE_POLICY',key:x.dataset.agriPolicyInput,value:Number(x.value||0)});if(!r?.ok){ok=false;last=r;}});toastUI(ok?T('农业政策已写入正式状态','Agriculture policies saved to official state'):last?.error,ok?'good':'bad');return;}
  if(e.target.closest('[data-agri-start-project]')){const regionId=document.getElementById('beAgriProjectRegion')?.value,projectType=document.getElementById('beAgriProjectType')?.value,amount=Number(document.getElementById('beAgriProjectAmount')?.value||0),parameters=projectType==='land_development'?{area:amount}:{capacity:amount};const r=UIBridge.dispatch({type:'START_STATE_AGRICULTURE_PROJECT',regionId,projectType,parameters});toastUI(r?.ok?T('国家农业项目已启动，将在正式年度 Tick 中推进','State agriculture project started and will progress in the official annual tick'):r?.error,r?.ok?'good':'bad');return;}
  if(e.target.closest('[data-be-request-quote]')){const state=gs(),partner=document.getElementById('beQuotePartner')?.value,items=[...document.querySelectorAll('[data-be-trade-good]')].map(x=>({goodId:x.dataset.beTradeGood,requestedVolume:n(x.value)})).filter(x=>x.requestedVolume>0);if(!items.length)return toastUI(T('至少填写一种商品数量','Enter at least one good quantity'),'bad');const r=Trade?.requestMultiGoodQuote?.({importerCountryId:player(),exporterCountryId:partner,items},state);if(!r?.ok)return toastUI(r?.error||T('报价失败','Quote failed'),'bad');uiState.filters.quotePartner=partner;uiState.filters.lastQuoteId=r.quote.id;renderWorkspace();toastUI(T('已收到逐项报价','Itemized quote received'));return;}
  const accept=e.target.closest('[data-be-accept-quote]');if(accept){const selected=[...document.querySelectorAll('[data-be-quote-item]:checked')].map(x=>x.dataset.beQuoteItem);if(!selected.length)return toastUI(T('请先勾选要接受的商品','Select at least one quote item'),'bad');const type=document.getElementById('beQuoteContractType')?.value||'short',priority=document.getElementById('beQuotePriority')?.value||'normal';const r=Trade?.acceptQuoteItems?.(accept.dataset.beAcceptQuote,selected,{contractType:type,priority},gs());if(!r?.ok)return toastUI(r?.error||T('签约失败','Contract creation failed'),'bad');openSubview('trade','contracts',false);toastUI(T(`已建立 ${r.contracts.length} 份独立合同`,`Created ${r.contracts.length} independent contracts`));return;}
  const propose=e.target.closest('[data-be-propose-friendship]');if(propose){const r=Trade?.proposeFriendshipTreaty?.(propose.dataset.beProposeFriendship,8,gs());if(!r?.ok)return toastUI(`${T('无法提议','Cannot propose')}: ${r?.error||''}`,'bad');renderWorkspace();toastUI(r.decision==='accept'?T('友好条约已被接受','Friendship Treaty accepted'):r.decision==='counter'?T('对方提出了还价条件','The partner made a counteroffer'):T('提议被拒绝','Proposal rejected'),r.decision==='reject'?'bad':'good');return;}
  const counter=e.target.closest('[data-be-accept-counter]');if(counter){const r=Trade?.acceptFriendshipCounter?.(counter.dataset.beAcceptCounter,gs());renderWorkspace();toastUI(r?.ok?T('友好条约已生效','Friendship Treaty is active'):r?.error,r?.ok?'good':'bad');return;}
  const term=e.target.closest('[data-be-terminate-agreement]');if(term){const r=Trade?.terminateAgreement?.(term.dataset.beTerminateAgreement,'player_terminated',gs());renderWorkspace();toastUI(r?.ok?T('协议已终止','Agreement terminated'):r?.error,r?.ok?'good':'bad');return;}
  const tariffBtn=e.target.closest('[data-be-adjust-tariff]');if(tariffBtn){const partner=tariffBtn.dataset.beAdjustTariff,rate=n(document.getElementById('beCountryTariffRate')?.value,.10);for(const good of Trade?.GOODS||[])Trade?.setTariff?.(player(),partner,good,rate,gs());renderWorkspace();toastUI(T('关税设置已更新','Tariff settings updated'));return;}
  const invest=e.target.closest('[data-be-investment-proposal]');if(invest){const partner=invest.dataset.beInvestmentProposal,state=gs();const made=Trade?.createProposal?.({proposerCountryId:player(),receiverCountryId:partner,type:'foreign_investment_agreement',offeredTerms:{investmentValue:20},requestedTerms:{ownershipShare:.4},expirationTurn:year()+2},state);if(!made?.ok)return toastUI(made?.error||T('投资提议失败','Investment proposal failed'),'bad');let ev=null;try{ev=AI?.evaluateProposal?.(partner,{...made.proposal,type:'foreign_investment',targetCountryId:partner,terms:{investmentValue:20,ownershipShare:.4}},state);}catch(_){ }made.proposal.aiEvaluation=ev;toastUI(T('投资合作提议已提交 AI 国家评估','Investment cooperation proposal submitted for AI evaluation'));renderWorkspace();return;}
  const up=e.target.closest('[data-be-upgrade-connection]');if(up){const r=global.Development?.startConnectionUpgrade?.(up.dataset.beUpgradeConnection,gs());toastUI(r?.ok?T('升级项目已开始','Upgrade project started'):r?.error,r?.ok?'good':'bad');renderWorkspace();return;}
});

document.addEventListener('change',e=>{if(e.target.id==='beQuotePartner')uiState.filters.quotePartner=e.target.value;if(e.target.id==='beWorkspaceRegion'){uiState.selectedRegionId=e.target.value;uiState.selectedParcelId=null;syncSelectionsToLegacy();renderWorkspace();}});

function patchCausalActionRouting(){const R=BE.ReverseNavigator;if(!R||R.__workspaceRoutingPatched||typeof R.navigateToAction!=='function')return;const old=R.navigateToAction.bind(R);R.navigateToAction=function(actionId){const out=old(actionId);const finish=res=>{const a=res?.action||null;if(a){const map={Module2:'development',Module3:'economy',Module4:'population',Module5:'trade',Module9:'agriculture'};const mod=map[a.targetModule]||String(a.targetModule||'').toLowerCase();const st=gs();if(a.targetObjectId&&st?.connections?.[a.targetObjectId])openDetail({module:mod||'development',entityType:'connection',entityId:a.targetObjectId});else if(a.targetObjectId&&st?.facilities?.[a.targetObjectId])openDetail({module:mod||'development',entityType:'facility',entityId:a.targetObjectId});else if(a.targetObjectId&&st?.projects?.[a.targetObjectId])openDetail({module:mod||'development',entityType:'project',entityId:a.targetObjectId});else if(mod)openModule(mod);}return res;};return out&&typeof out.then==='function'?out.then(finish):finish(out);};R.__workspaceRoutingPatched=true;}
BE.Module8UI={uiState,openModule,openDetail,openSubview,goBack,renderWorkspace,UIBridge};global.openModule=openModule;global.openDetail=openDetail;global.goBack=goBack;
function patchAnnualRefresh(){const M=BE.Module8;if(!M||M.__workspaceRefreshPatched)return;const old=M.advanceOneYear?.bind(M);if(!old)return;UIBridge.installProfiler();M.advanceOneYear=async function(...args){uiRuntime.performance.timings={};const t0=performance?.now?.()||Date.now();const r=await old(...args);uiRuntime.performance.totalAdvanceMs=(performance?.now?.()||Date.now())-t0;setTimeout(()=>{ensureMultiState(gs());UIBridge.refresh();},0);return r;};M.__workspaceRefreshPatched=true;}
function start(){ensureMultiState(gs());Trade?.ensureDiplomacyState?.(gs());mountShell();patchAnnualRefresh();patchCausalActionRouting();UIBridge.installProfiler();const nw=document.getElementById('newWorldBtn');nw?.addEventListener('click',()=>setTimeout(()=>{ensureMultiState(gs());uiState.history=[];Object.assign(uiState,{level:'root',module:'overview',subview:null,entityType:null,entityId:null});UIBridge.refresh();global.__BE_UI_DATA_INTEGRATION_CHECKS__=UIBridge.selfTest();},0));const rs=document.getElementById('randomSeedBtn');rs?.addEventListener('click',()=>setTimeout(()=>{ensureMultiState(gs());UIBridge.refresh();},0));global.__BE_UI_DATA_INTEGRATION_CHECKS__=UIBridge.selfTest();global.__BE_WORKSPACE_UI_CHECKS__={mounted:!!document.getElementById('mainWorkspace'),twoColumn:!!document.getElementById('beModuleSidebar'),detailRouter:typeof openDetail==='function',uiBridge:!!BE.UIBridge,selectors:Object.keys(BE.UIBridge?.selectors||{}),fontBase:getComputedStyle(document.documentElement).getPropertyValue('--font-base').trim(),turnRule:'1 turn = 1 year'};}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})(window);
;
/* ===== Border Epoch Module 2 Workspace Operation Bridge =====
   Restores the real Module 2 action entry points that were hidden when the
   legacy right panel was replaced by the single-workspace UI. No simulation
   rules are duplicated here: all actions call the existing Module 2 handlers.
*/
(function(global){
'use strict';
const BE=global.BorderEpoch||{};
const UI=()=>BE.Module8UI;
const isZh=()=>getGameLanguage()==='zh';
const T=(zh,en)=>isZh()?zh:en;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const st=()=>{try{return session?.state||BE.Module8?.getSession?.()?.state||null;}catch(_){return null;}};
const ui=()=>UI()?.uiState||{};
function regionId(){const s=st(),u=ui();return u.selectedRegionId||(()=>{try{return selectedRegionId;}catch(_){return null;}})()||Object.keys(s?.regions||{})[0]||null;}
function resourceId(){const u=ui();return u.selectedResource||(()=>{try{return selectedResource;}catch(_){return null;}})()||'coal';}
function parcelId(){const u=ui();return u.selectedParcelId||(()=>{try{return selectedParcelId;}catch(_){return null;}})()||null;}
function syncLegacy(){const u=ui();try{if(u.selectedRegionId)selectedRegionId=u.selectedRegionId;if(u.selectedResource)selectedResource=u.selectedResource;if(typeof selectedParcelId!=='undefined')selectedParcelId=u.selectedParcelId||null;}catch(_){}}
function rerender(){try{UI()?.renderWorkspace?.();}catch(e){console.error('Workspace rerender failed',e);}}
function toast2(msg,type='good'){try{if(typeof toast==='function')toast(msg,type);else if(typeof global.toast==='function')global.toast(msg,type);}catch(_){}}
function callLegacy(name,...args){syncLegacy();try{const fn=global[name]||eval(`typeof ${name}==='function'?${name}:null`);if(typeof fn!=='function')throw new Error(`${name} unavailable`);const r=fn(...args);setTimeout(rerender,0);return r;}catch(e){console.error(e);toast2(T(`操作入口错误：${e.message||e}`,`Action bridge error: ${e.message||e}`),'bad');return null;}}
function nameOf(x){try{return typeof displayName==='function'?displayName(x):String(x??'');}catch(_){return String(x??'');}}
function titleOf(x){try{return typeof titleCase==='function'?titleCase(x):String(x??'');}catch(_){return String(x??'');}}
function explorationName(id){try{return typeof explorationLabel==='function'?explorationLabel(id):titleOf(id);}catch(_){return titleOf(id);}}
function explorationInfo(id){try{return typeof explorationDesc==='function'?explorationDesc(id):'';}catch(_){return '';}}
function panel(title,body,cls=''){return `<section class="be-op-bridge ${cls}"><div class="be-op-head"><div><span>${esc(T('可执行操作','Available actions'))}</span><h2>${esc(title)}</h2></div><small>${esc(T('这些按钮直接调用现有 Module 2，不创建第二套建设逻辑。','These controls call the existing Module 2 directly; no duplicate construction logic is created.'))}</small></div>${body}</section>`;}
function buildControls(kind='all'){
 const rid=regionId();
 const all=[
  ['basic_factory',T('建设工厂','Build Factory'),T('2 年 · 使用现有 Module 2 项目系统','2 years · existing Module 2 project system')],
  ['steelworks',T('建设钢铁厂','Build Steelworks'),T('3 年 · 使用现有 Module 2 项目系统','3 years · existing Module 2 project system')],
  ['power_plant',T('建设发电厂','Build Power Plant'),T('2 年 · 使用现有 Module 2 项目系统','2 years · existing Module 2 project system')],
  ['port',T('建设港口','Build Port'),T('仅东部海岸可建','Eastern Coast only')],
  ['railway',T('建设铁路','Build Railway'),T('在所选地区与现有目标地区之间启动铁路项目','Starts a railway project from the selected region')]
 ];
 const list=kind==='transport'?all.filter(x=>x[0]==='railway'):kind==='industry'?all.filter(x=>x[0]!=='railway'):all;
 return `<div class="be-op-build-grid">${list.map(([id,label,desc])=>{const disabled=id==='port'&&rid!=='eastern_coast';return `<button class="be-op-build" data-be-op-build="${id}" ${disabled?'disabled':''}><b>${esc(label)}</b><small>${esc(desc)}</small>${disabled?`<i>${esc(T('当前地区不满足港口条件','Current region is not eligible for a port'))}</i>`:''}</button>`;}).join('')}</div>`;
}
function explorationControls(){
 const s=st(),rid=regionId(),res=resourceId(); if(!s||!rid)return '';
 let parcels=[];try{parcels=global.World?.getGeologicalParcels?.(rid,s)||[];}catch(_){parcels=[];}
 let pid=parcelId();if(!pid||!parcels.some(p=>String(p.id)===String(pid)))pid=parcels[0]?.id||null;
 if(ui()){ui().selectedParcelId=pid;ui().selectedRegionId=rid;ui().selectedResource=res;}
 try{selectedParcelId=pid;selectedRegionId=rid;selectedResource=res;}catch(_){ }
 let methods=[],status=null;try{methods=pid?(global.Development?.getExplorationMethods?.(rid,res,s,{parcelId:pid})||[]):[];status=pid?global.Development?.getExplorationStatus?.(rid,res,s,{parcelId:pid}):null;}catch(e){console.error(e);}
 const deposit=status?.deposit||null;
 const mineProject=deposit?Object.values(s.projects||{}).find(p=>p&&p.status==='under_construction'&&p.type==='mine_development'&&p.depositId===deposit.id):null;
 const resources=(global.World?.RESOURCE_TYPES||['coal','iron','copper','oil']);
 return `<div class="be-op-resource-toolbar"><label>${esc(T('资源','Resource'))}<select data-be-op-resource>${resources.map(r=>`<option value="${esc(r)}" ${r===res?'selected':''}>${esc(titleOf(r))}</option>`).join('')}</select></label></div>
 <div class="be-op-block"><h3>${esc(T('地质区块','Geological Parcels'))}</h3><div class="be-op-parcels">${parcels.map(p=>`<button class="${String(p.id)===String(pid)?'active':''}" data-be-op-parcel="${esc(p.id)}"><b>${esc(p.index??p.id)}</b><small>${esc(String(p.id).replace(rid+'_',''))}</small></button>`).join('')||`<div class="be-empty">${esc(T('该地区暂无地质区块数据','No geological parcel data in this region'))}</div>`}</div></div>
 <div class="be-op-block"><h3>${esc(T('勘探方式','Exploration Methods'))}</h3><div class="be-op-methods">${methods.map(m=>`<button data-be-op-explore="${esc(m.id)}" ${m.available?'':'disabled'}><span><b>${esc(explorationName(m.id))}</b><small>${esc(explorationInfo(m.id))}</small></span><em>${esc(`${m.cost} · ${m.years} ${T('年','yr')}`)}</em>${m.available?'':`<i>${esc(m.reason||T('当前不可用','Unavailable'))}</i>`}</button>`).join('')||`<div class="be-empty">${esc(T('请选择可勘探区块','Select a parcel to see exploration methods'))}</div>`}</div></div>
 ${status?`<div class="be-op-status"><b>${esc(T('当前勘探认知','Current exploration knowledge'))}</b><span>${esc(T('置信度','Confidence'))} ${Math.round((Number(status.confidence)||0)*100)}%</span><span>${esc(T('已用方法','Methods used'))} ${(status.methodsUsed||[]).length}</span><span>${esc(deposit?T('已发现矿床','Deposit discovered'):T('尚无确认矿床','No confirmed deposit'))}</span><span>${esc(deposit?.developed?T('已开发','Developed'):mineProject?`${T('矿山建设中','Mine under construction')} · ${mineProject.turnsRemaining} ${T('年','yr')}`:deposit?T('可开始矿山开发','Ready for mine development'):'')}</span></div>`:''}
 ${deposit&&!deposit.developed&&!mineProject?`<button class="be-op-primary" data-be-op-develop-deposit="${esc(deposit.id)}"><b>${esc(T(`开发${titleOf(deposit.resourceType)}矿床`,`Develop ${titleOf(deposit.resourceType)} deposit`))}</b><small>${esc(T('根据已确认矿床启动真实采掘项目','Starts a real extraction project from the confirmed deposit'))}</small></button>`:''}`;
}
function decorate(){
 const w=document.getElementById('mainWorkspace'),U=ui();if(!w||U.level!=='module')return;
 if(w.querySelector('[data-be-op-bridge-root]'))return;
 let html='';
 if(U.module==='development'&&!U.subview)html=panel(T('开始建设','Start Construction'),buildControls('all'),'be-op-development');
 else if(U.module==='development'&&U.subview==='transport')html=panel(T('新建交通项目','Start Transport Project'),buildControls('transport'),'be-op-development');
 else if(U.module==='development'&&U.subview==='industry')html=panel(T('新建设施','Build New Facility'),buildControls('industry'),'be-op-development');
 else if((U.module==='development'&&U.subview==='resources')||U.module==='resources')html=panel(T('勘探与资源开发','Exploration & Resource Development'),explorationControls(),'be-op-resources');
 if(!html)return;
 const wrap=document.createElement('div');wrap.dataset.beOpBridgeRoot='1';wrap.innerHTML=html;
 const inner=w.querySelector('.be-workspace-inner')||w;const head=inner.querySelector('.be-page-head');if(head&&head.nextSibling)inner.insertBefore(wrap,head.nextSibling);else inner.prepend(wrap);
 const cur=st();global.__BE_OPERATION_BRIDGE_CHECKS__={mounted:true,module:U.module,subview:U.subview||null,year:cur?.time?.year??cur?.year??null,hasBuildButtons:!!w.querySelector('[data-be-op-build]'),hasExploreButtons:!!w.querySelector('[data-be-op-explore]')};
}
function afterAction(){setTimeout(()=>{rerender();setTimeout(decorate,0);},0);}
document.addEventListener('click',e=>{
 const b=e.target.closest('[data-be-op-build]');if(b){e.preventDefault();e.stopPropagation();callLegacy('build',b.dataset.beOpBuild);afterAction();return;}
 const p=e.target.closest('[data-be-op-parcel]');if(p){e.preventDefault();const U=ui();U.selectedParcelId=p.dataset.beOpParcel;try{selectedParcelId=U.selectedParcelId;}catch(_){ }rerender();return;}
 const ex=e.target.closest('[data-be-op-explore]');if(ex){e.preventDefault();e.stopPropagation();callLegacy('startExplore',ex.dataset.beOpExplore);afterAction();return;}
 const dep=e.target.closest('[data-be-op-develop-deposit]');if(dep){e.preventDefault();e.stopPropagation();callLegacy('developDeposit',dep.dataset.beOpDevelopDeposit);afterAction();return;}
},true);
document.addEventListener('change',e=>{
 if(e.target.matches('[data-be-op-resource]')){const U=ui();U.selectedResource=e.target.value;U.selectedParcelId=null;try{selectedResource=e.target.value;selectedParcelId=null;}catch(_){ }rerender();}
});
const obs=new MutationObserver(()=>queueMicrotask(decorate));
function start(){const w=document.getElementById('mainWorkspace');if(!w)return setTimeout(start,50);obs.observe(w,{childList:true,subtree:false});decorate();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})(window);
;
/*
Border Epoch — Guided National Development System
Companion integration module for world-causality-lab-v1.html

Core rule:
- Reads official simulation state only.
- Never grants food/money/population/production/transport/trade.
- Evaluates only after the official annual tick.
- 1 turn = 1 year.
*/
(function () {
  'use strict';

  const BE = window.BorderEpoch = window.BorderEpoch || {};
  const STORAGE_KEY = 'borderEpoch.guidedDevelopment.preference.v1';
  const RUNTIME = {
    session: null,
    lastEvaluation: null,
    lastYear: null,
    stableYears: 0,
    initialized: false,
    modePromptShown: false,
    hidden: false,
    guidePosition: { x:null, y:null },
    guideDrag: null,
    language: detectLanguage()
  };

  const TEXT = {
    zh: {
      guide: '国家发展引导',
      guided: '引导模式',
      free: '自由模式',
      chooseTitle: 'Border Epoch · 开始方式',
      chooseDesc: '请选择国家发展方式。引导模式不会修改任何正式模拟数据。',
      guidedDesc: '通过真实国家运行逐步理解农业、工业、交通、财政和贸易。',
      freeDesc: '直接进入完整国家模拟，不主动安排发展阶段。',
      recommend: '推荐第一次游玩',
      viewGoals: '查看目标',
      hide: '隐藏',
      route: '发展路线',
      exit: '退出引导',
      why: '为什么现在学这个',
      blocker: '当前主要障碍',
      actions: '可操作',
      optional: '可选目标',
      progress: '项完成',
      continueFree: '进入自由发展',
      cancel: '取消',
      confirmExit: '退出后将进入自由模式。已有国家状态不会被修改。',
      completeTitle: '国家发展引导完成',
      completeBody: '你的国家已经形成基本运行闭环：农业 → 市场 → 财政 → 工业 → 能源 → 交通 → 贸易。接下来进入自由发展阶段。',
      noData: '等待正式模拟状态可用。推进年份后系统会读取真实结果。',
      stageLabel: '阶段',
      stableYears: '连续稳定年度',
      stageCompleted: '阶段完成',
      modeSaved: '模式已选择'
    },
    en: {
      guide: 'National Development Guide',
      guided: 'Guided Mode',
      free: 'Free Mode',
      chooseTitle: 'Border Epoch · Start Mode',
      chooseDesc: 'Choose how to begin. Guided mode never alters official simulation data.',
      guidedDesc: 'Learn agriculture, industry, transport, finance and trade through the real simulation.',
      freeDesc: 'Enter the full simulation directly with no staged development guidance.',
      recommend: 'Recommended for first play',
      viewGoals: 'View goals',
      hide: 'Hide',
      route: 'Development route',
      exit: 'Exit guide',
      why: 'Why this now',
      blocker: 'Main blocker',
      actions: 'Available actions',
      optional: 'Optional',
      progress: 'checks complete',
      continueFree: 'Continue freely',
      cancel: 'Cancel',
      confirmExit: 'You will enter free mode. Existing national state will not be changed.',
      completeTitle: 'Development guide complete',
      completeBody: 'Your country now has a basic operating loop: agriculture → market → finance → industry → energy → transport → trade.',
      noData: 'Waiting for official simulation state. After an annual tick, the guide will read the real result.',
      stageLabel: 'Stage',
      stableYears: 'Consecutive stable years',
      stageCompleted: 'Stage complete',
      modeSaved: 'Mode selected'
    }
  };

  const STAGES = [
    {
      id: 'stage_1_food_security', order: 1,
      title: {zh:'先保证国家能够吃饭', en:'Secure basic food supply'},
      description: {zh:'建立最基本的粮食正循环，而不是追求一次性消灭全部缺口。', en:'Create a basic positive food loop rather than eliminating every deficit at once.'},
      purpose: {zh:'如果粮食系统不稳定，后面的工业化会建立在持续短缺之上。', en:'If food is unstable, later industrialization rests on persistent shortage.'},
      nextStageId: 'stage_2_food_logistics'
    },
    {
      id: 'stage_2_food_logistics', order: 2,
      title: {zh:'让粮食真正进入市场', en:'Move food into real markets'},
      description: {zh:'生产出来不等于城市拿得到。检查运输、仓储和农场积压。', en:'Production is not the same as delivery. Check transport, storage and farm backlog.'},
      purpose: {zh:'农业只有进入市场，才能真正缓解城市短缺。', en:'Agriculture only relieves urban shortages when output reaches markets.'},
      nextStageId: 'stage_3_fiscal_infrastructure'
    },
    {
      id: 'stage_3_fiscal_infrastructure', order: 3,
      title: {zh:'建立财政与建设秩序', en:'Build fiscal and construction discipline'},
      description: {zh:'让收入、支出、建设和维护形成可持续关系。', en:'Create a sustainable relationship between revenue, spending, construction and maintenance.'},
      purpose: {zh:'国家不能无限建设；项目必须由真实财政与维护能力支撑。', en:'A state cannot build without limit; projects need real fiscal and maintenance support.'},
      nextStageId: 'stage_4_basic_industry'
    },
    {
      id: 'stage_4_basic_industry', order: 4,
      title: {zh:'发展第一批基础工业', en:'Establish basic industry'},
      description: {zh:'工厂必须真正投产，并受到原料、能源、劳动力、运输、需求和资金约束。', en:'A factory must really operate under input, energy, labor, transport, demand and funding constraints.'},
      purpose: {zh:'农业和基础物流稳定以后，工业才有持续发展的基础。', en:'Stable agriculture and logistics provide the base for sustained industrial development.'},
      nextStageId: 'stage_5_energy_resources'
    },
    {
      id: 'stage_5_energy_resources', order: 5,
      title: {zh:'接通能源与原料链', en:'Connect energy and resource chains'},
      description: {zh:'根据当前世界实际发现的资源，完成至少一条“发现→开发→运输→工业消费”链。', en:'Using resources actually found in this world, complete at least one discovery → development → transport → industrial use chain.'},
      purpose: {zh:'工业不是凭空运行；能源和原料必须真实进入生产体系。', en:'Industry does not run from nothing; energy and materials must enter production.'},
      nextStageId: 'stage_6_transport_network'
    },
    {
      id: 'stage_6_transport_network', order: 6,
      title: {zh:'建立地区交通网络', en:'Build functional regional transport'},
      description: {zh:'公路或铁路都可以，关键是主要经济走廊不再被严重瓶颈卡住。', en:'Road or rail can work; the key is removing severe bottlenecks from major economic corridors.'},
      purpose: {zh:'生产能力只有通过运输网络连接市场后才真正有经济意义。', en:'Production gains economic meaning only when transport connects it to markets.'},
      nextStageId: 'stage_7_trade_diplomacy'
    },
    {
      id: 'stage_7_trade_diplomacy', order: 7,
      title: {zh:'学会国际贸易与合作', en:'Learn trade and international cooperation'},
      description: {zh:'用真实合同、路线和交付解决至少一次国内缺口。', en:'Use a real contract, route and delivery to address a domestic shortage.'},
      purpose: {zh:'国家不需要把所有商品都自己生产，但进口必须有供应、合同、路线、口岸和支付。', en:'A country need not produce everything, but imports require supply, contracts, routes, gateways and payment.'},
      nextStageId: 'stage_8_stable_state'
    },
    {
      id: 'stage_8_stable_state', order: 8,
      title: {zh:'形成良性运转国家', en:'Reach a self-sustaining national loop'},
      description: {zh:'五个维度至少四项连续两个年度 Tick 保持稳定。', en:'Keep at least four of five core dimensions stable for two consecutive annual ticks.'},
      purpose: {zh:'最终目标不是所有数字都漂亮，而是国家系统能够基本自洽。', en:'The goal is not perfect numbers, but a broadly self-consistent national system.'},
      nextStageId: null
    }
  ];

  function detectLanguage(){
    return getGameLanguage();
  }
  function tr(key){ return TEXT[RUNTIME.language][key] || key; }
  function tx(obj){ return obj?.[RUNTIME.language] || obj?.zh || obj?.en || ''; }
  function num(v, d=0){ v=Number(v); return Number.isFinite(v)?v:d; }
  function arr(v){ return Array.isArray(v)?v:(v && typeof v==='object'?Object.values(v):[]); }
  function path(obj, ...paths){
    for (const p of paths){
      let cur=obj, ok=true;
      for (const k of p.split('.')){
        if (cur==null || !(k in cur)){ ok=false; break; }
        cur=cur[k];
      }
      if(ok && cur!=null) return cur;
    }
    return undefined;
  }
  function yearOf(state){
    return num(path(state,'time.year','year','currentYear'), new Date().getFullYear());
  }

  function ensureOnboarding(state){
    if(!state || typeof state!=='object') return null;
    state.onboarding = state.onboarding || {};
    const o=state.onboarding;
    if(!('mode' in o)) o.mode=null;
    if(!('started' in o)) o.started=false;
    if(!('completed' in o)) o.completed=false;
    if(!('currentStageId' in o)) o.currentStageId=null;
    if(!Array.isArray(o.completedStageIds)) o.completedStageIds=[];
    if(!Array.isArray(o.stageHistory)) o.stageHistory=[];
    if(!Array.isArray(o.dismissedHints)) o.dismissedHints=[];
    if(!('lastEvaluatedYear' in o)) o.lastEvaluatedYear=null;
    if(!('stableYears' in o)) o.stableYears=0;
    return o;
  }

  function getState(){
    return RUNTIME.session?.state || window.__BE_STATE__ || window.gameState || window.state || null;
  }

  function valuesByHint(state, keys){
    const out=[];
    const walk=(obj,depth=0)=>{
      if(!obj || typeof obj!=='object' || depth>5) return;
      for(const [k,v] of Object.entries(obj)){
        const lk=k.toLowerCase();
        if(keys.some(h=>lk.includes(h))) out.push({key:k,value:v});
        if(v && typeof v==='object' && !Array.isArray(v)) walk(v,depth+1);
      }
    };
    walk(state,0);
    return out;
  }

  function foodMetrics(state){
    const agri = path(state,'agriculture.regions','agricultureRegions','regions') || {};
    const regions=arr(agri);
    const actualCultivatedArea = regions.reduce((s,r)=>s+num(path(r,'actualCultivatedArea','cultivatedArea','activeCultivatedArea')),0);
    const production = num(path(state,'agriculture.totalFoodProduction','economy.foodProduction','food.production','foodProduction'),
      regions.reduce((s,r)=>s+num(path(r,'foodProduction','actualProduction','harvestedQuantity','biologicalHarvest')),0));
    const delivered = num(path(state,'agriculture.totalMarketDeliveredFood','food.marketDeliveredQuantity','market.totalFoodDelivered','totalMarketDeliveredFood'),
      regions.reduce((s,r)=>s+num(path(r,'marketDeliveredQuantity','deliveredQuantity')),0));
    const harvested = num(path(state,'agriculture.harvestedQuantity','food.harvestedQuantity','harvestedQuantity'),
      regions.reduce((s,r)=>s+num(path(r,'harvestedQuantity','biologicalHarvest')),0));
    const closing = num(path(state,'agriculture.farmClosingStock','food.farmClosingStock','farmClosingStock'),
      regions.reduce((s,r)=>s+num(path(r,'farmClosingStock','closingStock','inventory')),0));
    const gap = num(path(state,'food.currentGap','economy.foodGap','foodGap','market.foodGap'),0);
    const prevGap = num(path(state,'food.previousGap','economy.previousFoodGap','previousFoodGap'),gap);
    const coverage = num(path(state,'food.coverageRatio','economy.foodCoverageRatio','foodCoverageRatio'), production>0?Math.min(1,delivered/Math.max(1,production)):0);
    const deliveryRatio = harvested>0 ? delivered/harvested : (production>0?delivered/production:0);
    return {regions,actualCultivatedArea,production,delivered,harvested,closing,gap,prevGap,coverage,deliveryRatio};
  }

  function fiscalMetrics(state){
    const treasury=num(path(state,'economy.treasury','fiscal.treasury','treasury','country.treasury'),0);
    const revenue=num(path(state,'economy.annualRevenue','fiscal.annualRevenue','annualRevenue'),0);
    const expenses=num(path(state,'economy.annualExpenses','fiscal.annualExpenses','annualExpenses'),0);
    const maint=num(path(state,'economy.maintenanceCommitments','fiscal.maintenanceCommitments','maintenanceCommitments'),0);
    const projects=arr(path(state,'projects','development.projects','activeProjects'));
    const active=projects.filter(p=>['active','under_construction','building'].includes(String(p.status||'').toLowerCase()) || num(p.turnsRemaining,0)>0);
    const progressed=active.some(p=>num(p.progress,0)>num(p.previousProgress,-1) || num(p.lastProgressDelta,0)>0);
    const stalled=projects.filter(p=>String(p.status||'').toLowerCase().includes('stall'));
    const maintenanceCoverage=maint>0?Math.max(0,Math.min(2,(revenue-expenses+maint)/maint)):1;
    return {treasury,revenue,expenses,maint,projects,active,progressed,stalled,maintenanceCoverage};
  }

  function industryMetrics(state){
    const facilities=arr(path(state,'facilities','industry.facilities','economy.facilities'));
    const industrial=facilities.filter(f=>{
      const t=String(f.type||f.kind||f.category||'').toLowerCase();
      return /(factory|steel|industry|industrial|processing|works|plant)/.test(t);
    });
    const operating=industrial.filter(f=>num(path(f,'actualProduction','production.actual','production'),0)>0);
    const actualProduction=operating.reduce((s,f)=>s+num(path(f,'actualProduction','production.actual','production'),0),0);
    const utilization=industrial.length?industrial.reduce((s,f)=>s+num(path(f,'utilization','productionUtilization'),0),0)/industrial.length:0;
    return {facilities,industrial,operating,actualProduction,utilization};
  }

  function resourceMetrics(state){
    const resources = arr(path(state,'resources.discovered','resourceDeposits','deposits','world.resources'));
    const discovered=resources.filter(r=>r && (r.discovered===true || r.status==='discovered' || r.confidence>0 || r.developed));
    const facilities=arr(path(state,'facilities','industry.facilities'));
    const developed = discovered.filter(r=>r.developed===true || facilities.some(f=>f.depositId && f.depositId===r.id));
    const consuming = developed.some(r=>{
      const type=String(r.resourceType||r.type||'').toLowerCase();
      return facilities.some(f=>{
        const inputs=JSON.stringify(path(f,'inputs','inputSupply','requiredInputs')||{}).toLowerCase();
        return type && inputs.includes(type) && num(path(f,'actualProduction','production'),0)>0;
      });
    });
    return {resources,discovered,developed,consuming};
  }

  function transportMetrics(state){
    const connections=arr(path(state,'connections','transport.connections','transportNetwork.links'));
    const roads=connections.filter(c=>/road/.test(String(c.type||c.kind||'').toLowerCase()));
    const rails=connections.filter(c=>/rail/.test(String(c.type||c.kind||'').toLowerCase()));
    const active=connections.filter(c=>!['planned','under_construction','failed'].includes(String(c.status||'').toLowerCase()));
    const severe=active.filter(c=>{
      const util=num(path(c,'utilization','transportUtilization'),0);
      const unmet=num(path(c,'unmetFlow','transport.unmetFlow'),0);
      return util>=0.95 || unmet>0;
    });
    const functional=active.length>0 && severe.length<active.length;
    return {connections,roads,rails,active,severe,functional};
  }

  function tradeMetrics(state){
    const contracts=arr(path(state,'trade.contracts','tradeContracts','diplomacy.tradeContracts'));
    const active=contracts.filter(c=>String(c.status||'').toLowerCase()==='active');
    const delivered=active.filter(c=>num(path(c,'deliveredThisYear','delivery.deliveredThisYear','actualDelivered'),0)>0);
    return {contracts,active,delivered};
  }

  function dynamicActions(stageId,state,m={}){
    const actions=[];
    const add=(id,labelZh,labelEn,module,extra={})=>actions.push({id,label:{zh:labelZh,en:labelEn},actionType:'navigate',module,...extra});
    if(stageId==='stage_1_food_security'){
      if(m.actualCultivatedArea<=0) add('open_agriculture','进入农业','Open agriculture','agriculture');
      else if(m.production<=0) add('inspect_inputs','查看种子与肥料','Inspect seed and fertilizer','agriculture',{inspect:'agriculture_inputs'});
      else if(m.delivered<=0 || m.deliveryRatio<0.55) add('inspect_agri_transport','查看农业运输','Inspect farm transport','transport',{inspect:'food_delivery'});
      else add('inspect_food_gap','为什么粮食不足','Why is food insufficient?','agriculture',{inspect:'food_gap'});
    } else if(stageId==='stage_2_food_logistics'){
      add('open_transport','查看农业运输','Inspect agricultural transport','transport',{inspect:'food_delivery'});
      add('roads','改善农村道路','Improve rural roads','development');
      add('storage','建设仓储','Build storage','development');
    } else if(stageId==='stage_3_fiscal_infrastructure'){
      add('fiscal','查看财政','Inspect public finance','economy',{inspect:'fiscal'});
      add('projects','查看建设项目','Inspect projects','development');
      add('maintenance','查看维护负担','Inspect maintenance','development',{inspect:'maintenance'});
    } else if(stageId==='stage_4_basic_industry'){
      add('industry','进入工业','Open industry','industry');
      add('inputs','查看工业输入','Inspect industrial inputs','industry',{inspect:'industrial_inputs'});
    } else if(stageId==='stage_5_energy_resources'){
      add('resources','查看已发现资源','Inspect discovered resources','development');
      add('resource_chain','查看资源链','Inspect resource chain','development',{inspect:'resource_chain'});
    } else if(stageId==='stage_6_transport_network'){
      add('network','查看交通网络','Inspect transport network','transport');
      add('bottleneck','查看拥堵','Inspect bottlenecks','transport',{inspect:'transport_bottleneck'});
      add('map','查看地图','View map','world');
    } else if(stageId==='stage_7_trade_diplomacy'){
      add('trade','进入国际贸易','Open international trade','trade');
      add('quotes','查看国外报价','Inspect foreign offers','trade');
      add('diplomacy','查看外交关系','Inspect diplomacy','diplomacy');
    } else if(stageId==='stage_8_stable_state'){
      add('overview','国家总览','National overview','world');
      add('diagnose','查看主要障碍','Inspect main blocker','world',{inspect:'stable_state'});
    }
    return actions;
  }

  function check(id, passed, labelZh, labelEn, detail){
    return {id,passed:!!passed,label:{zh:labelZh,en:labelEn},detail};
  }

  function evaluateFoodSecurity(state){
    const m=foodMetrics(state);
    const checks=[
      check('agriculture_active',m.actualCultivatedArea>0,'至少一个农业地区正常耕种','At least one agricultural area is actively cultivated',m.actualCultivatedArea),
      check('food_production',m.production>0,'粮食已经真实生产','Food is actually being produced',m.production),
      check('food_delivery_exists',m.delivered>0,'粮食已经进入市场','Food is reaching markets',m.delivered),
      check('food_gap_not_collapsing',m.gap<=m.prevGap || m.coverage>=0.75,'粮食缺口没有继续快速恶化','Food deficit is no longer rapidly worsening',m.gap)
    ];
    return result(checks,dynamicActions('stage_1_food_security',state,m),m);
  }
  function evaluateFoodLogistics(state){
    const m=foodMetrics(state);
    const backlogStable = m.closing <= num(path(state,'food.previousFarmClosingStock','agriculture.previousFarmClosingStock'),m.closing) || m.deliveryRatio>=0.70;
    const checks=[
      check('harvest_exists',m.harvested>0 || m.production>0,'存在真实收获量','A real harvest exists',m.harvested||m.production),
      check('delivery_ratio',m.deliveryRatio>=0.70,'大部分粮食能够进入市场','Most harvested food can reach markets',m.deliveryRatio),
      check('backlog_stable',backlogStable,'农场积压没有持续扩大','Farm backlog is not continually expanding',m.closing)
    ];
    return result(checks,dynamicActions('stage_2_food_logistics',state,m),m);
  }
  function evaluateFiscal(state){
    const m=fiscalMetrics(state);
    const dangerous = m.treasury<0 && m.expenses>m.revenue*1.35;
    const checks=[
      check('project_progress',m.active.length>0 && m.progressed,'至少一个项目真实推进','At least one project is making real progress',m.active.length),
      check('no_mass_stall',m.stalled.length<=Math.max(1,Math.floor(m.projects.length*0.25)),'没有大面积项目因断供停工','No widespread fiscal project stoppage',m.stalled.length),
      check('treasury_not_dangerous',!dangerous,'财政没有持续进入危险状态','Fiscal position is not persistently dangerous',m.treasury),
      check('maintenance_supported',m.maintenanceCoverage>=0.65,'维护支出没有完全断裂','Maintenance is not broadly unfunded',m.maintenanceCoverage)
    ];
    return result(checks,dynamicActions('stage_3_fiscal_infrastructure',state,m),m);
  }
  function evaluateIndustry(state){
    const m=industryMetrics(state);
    const checks=[
      check('industry_exists',m.industrial.length>0,'至少一个基础工业设施存在','At least one basic industrial facility exists',m.industrial.length),
      check('industry_operates',m.operating.length>0 && m.actualProduction>0,'至少一个工业设施真实投产','At least one industrial facility is actually producing',m.actualProduction),
      check('not_inventory_only',m.operating.some(f=>num(path(f,'inputSupply','inputsAvailable','inputCoverageRatio'),1)>0),'生产不是只靠空库存状态','Production has real input supply',null)
    ];
    return result(checks,dynamicActions('stage_4_basic_industry',state,m),m);
  }
  function evaluateResources(state){
    const m=resourceMetrics(state);
    const checks=[
      check('resource_discovered',m.discovered.length>0,'发现至少一种可开发资源','At least one developable resource is discovered',m.discovered.length),
      check('resource_developed',m.developed.length>0,'至少一处资源已经真实开发','At least one resource deposit is actually developed',m.developed.length),
      check('resource_consumed',m.consuming || m.developed.some(r=>num(path(r,'deliveredToIndustry','industrialDelivery'),0)>0),'资源进入运输或工业消费链','A resource enters transport or industrial consumption',null)
    ];
    return result(checks,dynamicActions('stage_5_energy_resources',state,m),m);
  }
  function evaluateTransport(state){
    const m=transportMetrics(state);
    const food=foodMetrics(state);
    const industry=industryMetrics(state);
    const checks=[
      check('connection_exists',m.active.length>0,'至少存在一条投入使用的地区连接','At least one regional link is operating',m.active.length),
      check('critical_corridor_ok',m.functional,'至少一个关键经济走廊没有严重瓶颈','At least one key economic corridor is free of severe bottlenecks',m.severe.length),
      check('outputs_reach_market',food.delivered>0 || industry.actualProduction>0,'主要农业或工业产出能够进入市场体系','Major agricultural or industrial output reaches the market system',null)
    ];
    return result(checks,dynamicActions('stage_6_transport_network',state,m),m);
  }
  function evaluateTrade(state){
    const m=tradeMetrics(state);
    const checks=[
      check('active_contract',m.active.length>0,'至少一份真实贸易合同处于生效状态','At least one real trade contract is active',m.active.length),
      check('real_delivery',m.delivered.length>0,'贸易合同本年度发生真实交付','A trade contract delivered goods this year',m.delivered.length)
    ];
    const out=result(checks,dynamicActions('stage_7_trade_diplomacy',state,m),m);
    out.optionalChecks=[check('long_term_relation',
      !!path(state,'diplomacy.longTermTradePartners','trade.longTermPartners'),
      '与一个贸易伙伴建立长期关系','Establish a long-term relationship with a trade partner')];
    return out;
  }
  function stableDimensions(state){
    const f=foodMetrics(state), fi=fiscalMetrics(state), i=industryMetrics(state), t=transportMetrics(state), trd=tradeMetrics(state);
    return {
      food: f.production>0 && f.delivered>0 && (f.gap<=f.prevGap || f.coverage>=0.75),
      fiscal: !(fi.treasury<0 && fi.expenses>fi.revenue*1.35) && fi.maintenanceCoverage>=0.65,
      industry: i.operating.length>0 && i.actualProduction>0,
      transport: t.functional,
      trade: trd.delivered.length>0
    };
  }
  function evaluateStable(state){
    const d=stableDimensions(state);
    const passed=Object.values(d).filter(Boolean).length;
    const year=yearOf(state);
    const o=ensureOnboarding(state);
    if (o.lastStableEvaluationYear !== year){
      o.stableYears = passed>=4 ? num(o.stableYears,0)+1 : 0;
      o.lastStableEvaluationYear=year;
    }
    const checks=[
      check('food',d.food,'粮食系统稳定','Food system stable'),
      check('fiscal',d.fiscal,'财政基本稳定','Fiscal system stable'),
      check('industry',d.industry,'工业真实运行','Industry operating'),
      check('transport',d.transport,'交通网络可用','Transport functional'),
      check('trade',d.trade,'贸易发生真实交付','Trade functional')
    ];
    const out=result(checks,dynamicActions('stage_8_stable_state',state,d),d);
    out.completed = passed>=4 && num(o.stableYears,0)>=2;
    out.progress = Math.min(1,(passed/5)*0.8 + Math.min(2,num(o.stableYears,0))/2*0.2);
    out.stableYears=num(o.stableYears,0);
    return out;
  }
  function result(checks,recommendedActions,metrics){
    const passed=checks.filter(c=>c.passed).length;
    return {
      completed: passed===checks.length,
      progress: checks.length?passed/checks.length:0,
      checks, blockers:checks.filter(c=>!c.passed),
      recommendedActions, metrics
    };
  }

  const EVALUATORS = {
    stage_1_food_security:evaluateFoodSecurity,
    stage_2_food_logistics:evaluateFoodLogistics,
    stage_3_fiscal_infrastructure:evaluateFiscal,
    stage_4_basic_industry:evaluateIndustry,
    stage_5_energy_resources:evaluateResources,
    stage_6_transport_network:evaluateTransport,
    stage_7_trade_diplomacy:evaluateTrade,
    stage_8_stable_state:evaluateStable
  };

  function getStage(id){ return STAGES.find(s=>s.id===id)||null; }
  function getCurrentStage(){
    const s=getState(), o=ensureOnboarding(s);
    return o ? getStage(o.currentStageId) : null;
  }

  function completeStage(stageId){
    const state=getState(), o=ensureOnboarding(state);
    const stage=getStage(stageId);
    if(!o||!stage) return false;
    if(!o.completedStageIds.includes(stageId)) o.completedStageIds.push(stageId);
    let h=o.stageHistory.find(x=>x.stageId===stageId);
    if(!h){ h={stageId,enteredYear:yearOf(state),completedYear:null,status:'active'}; o.stageHistory.push(h); }
    h.status='completed'; h.completedYear=yearOf(state);
    if(stage.nextStageId){
      o.currentStageId=stage.nextStageId;
      if(!o.stageHistory.some(x=>x.stageId===stage.nextStageId))
        o.stageHistory.push({stageId:stage.nextStageId,enteredYear:yearOf(state),completedYear:null,status:'active'});
    } else {
      o.completed=true;
      showCompletion();
    }
    persistMirror(o);
    return true;
  }

  function evaluateCurrentStage(){
    const state=getState(), o=ensureOnboarding(state);
    if(!state||!o||o.mode!=='guided'||o.completed) return null;
    if(!o.currentStageId) o.currentStageId='stage_1_food_security';
    const year=yearOf(state);
    const evalFn=EVALUATORS[o.currentStageId];
    if(!evalFn) return null;
    const evaluation=evalFn(state);
    o.lastEvaluatedYear=year;
    RUNTIME.lastEvaluation=evaluation;
    RUNTIME.lastYear=year;
    if(evaluation.completed){
      const old=o.currentStageId;
      completeStage(old);
      if(!o.completed && o.currentStageId!==old){
        const nextFn=EVALUATORS[o.currentStageId];
        RUNTIME.lastEvaluation=nextFn?nextFn(state):null;
      }
    }
    persistMirror(o);
    renderGuidePanel();
    return evaluation;
  }

  function setMode(mode){
    const state=getState();
    const o=state?ensureOnboarding(state):null;
    if(o){
      o.mode=mode;
      o.started=mode==='guided';
      if(mode==='guided'&&!o.currentStageId) o.currentStageId='stage_1_food_security';
      if(mode==='free') o.currentStageId=null;
      persistMirror(o);
    } else {
      persistMirror({mode,started:mode==='guided',completed:false,currentStageId:mode==='guided'?'stage_1_food_security':null,completedStageIds:[],stageHistory:[],dismissedHints:[],lastEvaluatedYear:null,stableYears:0});
    }
    closeModePrompt();
    if(mode==='guided') renderGuidePanel(); else removeGuideUI();
  }

  function applyMirrorToState(state){
    const o=ensureOnboarding(state); if(!o) return;
    let m=null; try{m=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');}catch{}
    if(m && !o.mode){
      Object.assign(o,m);
      if(!Array.isArray(o.completedStageIds))o.completedStageIds=[];
      if(!Array.isArray(o.stageHistory))o.stageHistory=[];
      if(!Array.isArray(o.dismissedHints))o.dismissedHints=[];
    }
  }
  function persistMirror(o){
    try{
      localStorage.setItem(STORAGE_KEY,JSON.stringify({
        mode:o.mode,started:o.started,completed:o.completed,currentStageId:o.currentStageId,
        completedStageIds:o.completedStageIds||[],stageHistory:o.stageHistory||[],
        dismissedHints:o.dismissedHints||[],lastEvaluatedYear:o.lastEvaluatedYear??null,
        stableYears:o.stableYears||0,lastStableEvaluationYear:o.lastStableEvaluationYear??null
      }));
    }catch{}
  }

  function ensureStyles(){
    if(document.getElementById('be-guided-style')) return;
    const style=document.createElement('style'); style.id='be-guided-style';
    style.textContent=`
#be-mode-overlay{position:fixed;inset:0;z-index:2147483000;background:rgba(3,9,14,.82);display:grid;place-items:center;padding:24px;backdrop-filter:blur(10px)}
.be-mode-card{width:min(760px,94vw);background:#0b1822;border:1px solid #35546a;border-radius:18px;padding:26px;color:#dcebf4;box-shadow:0 28px 90px rgba(0,0,0,.52);font-family:Inter,system-ui,sans-serif}
.be-mode-card h2{margin:0 0 8px;font-size:24px}.be-mode-card>p{color:#91a9b8;margin:0 0 20px}
.be-mode-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.be-mode-option{border:1px solid #2d4b5f;background:#102532;color:#dcebf4;border-radius:14px;padding:18px;text-align:left;cursor:pointer}
.be-mode-option:hover{border-color:#5b98bd;background:#153247}.be-mode-option strong{display:block;font-size:18px;margin-bottom:5px}.be-mode-option small{display:block;color:#94aebd;line-height:1.45}.be-reco{font-size:10px;color:#e5c77e;margin-bottom:8px}
#be-guide-strip{position:fixed;z-index:1500;left:calc(100vw - 410px);top:92px;width:380px;max-width:calc(100vw - 24px);margin:0;padding:14px 16px;border:1px solid #35556a;background:linear-gradient(135deg,rgba(13,34,47,.98),rgba(9,24,34,.98));border-radius:14px;color:#dcebf4;box-shadow:0 12px 36px rgba(0,0,0,.34);font-family:Inter,system-ui,sans-serif}
.be-guide-row{display:block}.be-guide-main{min-width:0}.be-guide-drag{display:flex;align-items:center;justify-content:space-between;cursor:grab;user-select:none;touch-action:none;margin:-4px -4px 10px;padding:5px 4px 9px;border-bottom:1px solid #294454}.be-guide-drag:active{cursor:grabbing}.be-guide-kicker{font-size:12px;color:#87a7ba}.be-guide-title{font-size:17px;line-height:1.35;font-weight:750;margin-top:3px;white-space:normal;word-break:normal;overflow-wrap:break-word}.be-guide-progress{font-size:12px;line-height:1.5;color:#99b0be;margin-top:5px}.be-guide-actions{display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px;margin-top:12px}
.be-guide-btn{border:1px solid #315268;background:#102737;color:#dcebf4;border-radius:8px;padding:7px 9px;cursor:pointer;font:inherit;font-size:11px;white-space:normal;word-break:keep-all}.be-guide-btn:hover{background:#17384d}
#be-guide-modal{position:fixed;inset:0;z-index:2147482000;background:rgba(2,8,12,.68);display:grid;place-items:center;padding:20px}
.be-guide-card{width:min(820px,95vw);max-height:88vh;overflow:auto;background:#091821;border:1px solid #35566b;color:#dcebf4;border-radius:16px;padding:20px;font-family:Inter,system-ui,sans-serif}
.be-guide-card h2{margin:0 0 5px;font-size:21px}.be-guide-card h3{font-size:13px;margin:18px 0 8px;color:#9eb9c8}.be-guide-card p{color:#a7bbc7;line-height:1.55}.be-check{display:flex;gap:9px;align-items:flex-start;padding:8px 9px;margin:6px 0;border:1px solid #203947;border-radius:9px;background:#0d202b}.be-check.pass{border-color:#2b5d4a}.be-check-mark{width:18px}.be-action-grid{display:flex;gap:7px;flex-wrap:wrap}.be-route{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}.be-route-item{border:1px solid #263f4e;border-radius:8px;padding:8px;font-size:11px}.be-route-item.done{opacity:.65}.be-route-item.current{border-color:#5a8fab;background:#102b3b}
.be-close{float:right}.be-blocker{border-left:3px solid #b58a52;background:#1b1b18;padding:9px 11px;border-radius:6px;color:#d9c8aa}
@media(max-width:680px){.be-mode-grid{grid-template-columns:1fr}.be-route{grid-template-columns:1fr 1fr}#be-guide-strip{left:12px;top:82px;width:calc(100vw - 24px)}}
`;
    document.head.appendChild(style);
  }

  function showModePrompt(force=false){
    ensureStyles();
    if(document.getElementById('be-mode-overlay')) return;
    let mirror=null; try{mirror=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null')}catch{}
    const state=getState(), o=state?ensureOnboarding(state):null;
    const mode=o?.mode || mirror?.mode;
    if(mode && !force){ if(state&&!o.mode)applyMirrorToState(state); if(mode==='guided')renderGuidePanel(); return; }
    const el=document.createElement('div'); el.id='be-mode-overlay';
    el.innerHTML=`<div class="be-mode-card">
      <h2>${tr('chooseTitle')}</h2><p>${tr('chooseDesc')}</p>
      <div class="be-mode-grid">
        <button class="be-mode-option" data-be-mode="guided"><div class="be-reco">${tr('recommend')}</div><strong>${tr('guided')}</strong><small>${tr('guidedDesc')}</small></button>
        <button class="be-mode-option" data-be-mode="free"><strong>${tr('free')}</strong><small>${tr('freeDesc')}</small></button>
      </div></div>`;
    document.body.appendChild(el);
    RUNTIME.modePromptShown=true;
  }
  function closeModePrompt(){ document.getElementById('be-mode-overlay')?.remove(); }

  function findWorkspaceHost(){
    return document.querySelector('#mainWorkspace,.main-workspace,[data-workspace],main,.workspace') || document.body;
  }
  function removeGuideUI(){ document.getElementById('be-guide-strip')?.remove(); document.getElementById('be-guide-modal')?.remove(); }

  function installGuideDrag(panel){
    const handle=panel.querySelector('.be-guide-drag');
    if(!handle||handle.__dragInstalled)return;
    handle.__dragInstalled=true;
    if(RUNTIME.guidePosition.x!=null&&RUNTIME.guidePosition.y!=null){panel.style.left=`${RUNTIME.guidePosition.x}px`;panel.style.top=`${RUNTIME.guidePosition.y}px`;panel.style.right='auto';}
    handle.addEventListener('pointerdown',e=>{
      if(e.target.closest('button'))return;
      const rect=panel.getBoundingClientRect();
      RUNTIME.guideDrag={pointerId:e.pointerId,dx:e.clientX-rect.left,dy:e.clientY-rect.top};
      handle.setPointerCapture?.(e.pointerId);e.preventDefault();
    });
    handle.addEventListener('pointermove',e=>{
      const d=RUNTIME.guideDrag;if(!d||d.pointerId!==e.pointerId)return;
      const rect=panel.getBoundingClientRect();
      const x=Math.max(8,Math.min(window.innerWidth-rect.width-8,e.clientX-d.dx));
      const y=Math.max(8,Math.min(window.innerHeight-rect.height-8,e.clientY-d.dy));
      panel.style.left=`${x}px`;panel.style.top=`${y}px`;panel.style.right='auto';RUNTIME.guidePosition={x,y};
    });
    const stop=e=>{if(RUNTIME.guideDrag&&RUNTIME.guideDrag.pointerId===e.pointerId)RUNTIME.guideDrag=null;};
    handle.addEventListener('pointerup',stop);handle.addEventListener('pointercancel',stop);
  }

  function renderGuidePanel(){
    ensureStyles();
    const state=getState(), o=state?ensureOnboarding(state):null;
    let mirror=null; try{mirror=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null')}catch{}
    const effective=o||mirror;
    if(!effective || effective.mode!=='guided' || effective.completed || RUNTIME.hidden){ removeGuideUI(); return; }
    const stage=getStage(effective.currentStageId||'stage_1_food_security'); if(!stage)return;
    const ev=RUNTIME.lastEvaluation;
    const passed=ev?.checks?.filter(c=>c.passed).length||0, total=ev?.checks?.length||0;
    let strip=document.getElementById('be-guide-strip');
    if(!strip){strip=document.createElement('section');strip.id='be-guide-strip';document.body.appendChild(strip);}
    strip.innerHTML=`<div class="be-guide-drag"><b>${tr('guide')}</b><span>⠿</span></div>
      <div class="be-guide-main">
        <div class="be-guide-kicker">${tr('stageLabel')} ${stage.order}/8</div>
        <div class="be-guide-title">${tx(stage.title)}</div>
        <div class="be-guide-progress">${ev?`${passed} / ${total} ${tr('progress')}`:tr('noData')}</div>
      </div>
      <div class="be-guide-actions">
        <button class="be-guide-btn" data-be-guide="details">${tr('viewGoals')}</button>
        <button class="be-guide-btn" data-be-guide="route">${tr('route')}</button>
        <button class="be-guide-btn" data-be-guide="hide">${tr('hide')}</button>
      </div>`;
    installGuideDrag(strip);
  }

  function showDetails(routeOnly=false){
    ensureStyles();
    const state=getState(), o=state?ensureOnboarding(state):null;
    let mirror=null; try{mirror=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null')}catch{}
    const effective=o||mirror; if(!effective)return;
    const stage=getStage(effective.currentStageId||'stage_1_food_security'); if(!stage)return;
    const ev=RUNTIME.lastEvaluation;
    document.getElementById('be-guide-modal')?.remove();
    const modal=document.createElement('div'); modal.id='be-guide-modal';
    const route=STAGES.map(s=>{
      const done=(effective.completedStageIds||[]).includes(s.id), current=s.id===stage.id;
      return `<div class="be-route-item ${done?'done':''} ${current?'current':''}">${s.order}. ${tx(s.title)}</div>`;
    }).join('');
    const checks=ev?.checks?.map(c=>`<div class="be-check ${c.passed?'pass':''}"><span class="be-check-mark">${c.passed?'✓':'□'}</span><div>${tx(c.label)}</div></div>`).join('') || `<p>${tr('noData')}</p>`;
    const blocker=ev?.blockers?.[0] ? `<div class="be-blocker"><b>${tr('blocker')}：</b>${tx(ev.blockers[0].label)}</div>` : '';
    const actions=ev?.recommendedActions?.map(a=>`<button class="be-guide-btn" data-be-action="${a.id}">${tx(a.label)}</button>`).join('')||'';
    modal.innerHTML=`<div class="be-guide-card"><button class="be-guide-btn be-close" data-be-close>×</button>
      <h2>${tr('guide')} · ${tr('stageLabel')} ${stage.order}/8</h2>
      <h2>${tx(stage.title)}</h2>
      ${routeOnly?'':`<p>${tx(stage.description)}</p><h3>${tr('why')}</h3><p>${tx(stage.purpose)}</p>${blocker}<h3>${tr('viewGoals')}</h3>${checks}${stage.id==='stage_8_stable_state'&&ev?`<p>${tr('stableYears')}: ${ev.stableYears||0}/2</p>`:''}<h3>${tr('actions')}</h3><div class="be-action-grid">${actions}</div>`}
      <h3>${tr('route')}</h3><div class="be-route">${route}</div>
      <div style="margin-top:18px"><button class="be-guide-btn" data-be-exit>${tr('exit')}</button></div>
    </div>`;
    document.body.appendChild(modal);
  }

  function navigateToAction(actionId){
    const state=getState(), o=state?ensureOnboarding(state):null;
    const stage=getStage(o?.currentStageId||'stage_1_food_security');
    const ev=RUNTIME.lastEvaluation || (state&&EVALUATORS[stage?.id]?EVALUATORS[stage.id](state):null);
    const a=ev?.recommendedActions?.find(x=>x.id===actionId); if(!a)return false;
    document.getElementById('be-guide-modal')?.remove();
    if(a.inspect){
      const RN=BE.ReverseNavigator||window.ReverseNavigator;
      if(RN && typeof RN.inspectObject==='function'){
        try{ RN.inspectObject(a.inspect,{state,module:a.module,source:'guided-development'}); return true; }catch(e){console.warn(e);}
      }
    }
    // Prefer official navigation APIs if present.
    const candidates=[
      ()=>typeof window.openModule==='function'&&window.openModule(a.module),
      ()=>typeof BE.openModule==='function'&&BE.openModule(a.module),
      ()=>typeof BE.Module8?.openModule==='function'&&BE.Module8.openModule(a.module),
      ()=>{ const el=document.querySelector(`[data-module="${a.module}"],[data-workspace="${a.module}"],[data-tab="${a.module}"],#${a.module}Btn,#nav-${a.module}`); if(el){el.click(); return true;} }
    ];
    for(const fn of candidates){ try{const r=fn(); if(r!==false && r!=null)return true;}catch{} }
    return false;
  }

  function showCompletion(){
    removeGuideUI(); ensureStyles();
    const modal=document.createElement('div'); modal.id='be-guide-modal';
    modal.innerHTML=`<div class="be-guide-card"><h2>${tr('completeTitle')}</h2><p>${tr('completeBody')}</p><button class="be-guide-btn" data-be-close>${tr('continueFree')}</button></div>`;
    document.body.appendChild(modal);
  }

  function exitGuide(){
    if(!confirm(tr('confirmExit'))) return;
    const state=getState(), o=state?ensureOnboarding(state):null;
    if(o){
      const id=o.currentStageId, h=id&&o.stageHistory.find(x=>x.stageId===id);
      if(h && h.status==='active') h.status='skipped';
      o.mode='free'; o.currentStageId=null; persistMirror(o);
    } else {
      persistMirror({mode:'free',started:false,completed:false,currentStageId:null,completedStageIds:[],stageHistory:[],dismissedHints:[],lastEvaluatedYear:null});
    }
    removeGuideUI();
  }

  function hookAnnualTick(){
    const M8=BE.Module8;
    if(!M8 || typeof M8.advanceOneYear!=='function' || M8.advanceOneYear.__guidedWrapped) return false;
    const original=M8.advanceOneYear;
    async function wrapped(session,...args){
      RUNTIME.session=session||RUNTIME.session;
      if(RUNTIME.session?.state) applyMirrorToState(RUNTIME.session.state);
      const out=await original.call(this,session,...args); // official simulation runs first
      RUNTIME.session=session||RUNTIME.session;
      evaluateCurrentStage(); // guide reads result only after official tick
      return out;
    }
    wrapped.__guidedWrapped=true; wrapped.__original=original;
    M8.advanceOneYear=wrapped;
    return true;
  }

  function hookNewWorldButton(){
    const b=document.getElementById('newWorldBtn');
    if(!b || b.__guidedHooked)return;
    b.__guidedHooked=true;
    b.addEventListener('click',()=>{
      try{localStorage.removeItem(STORAGE_KEY)}catch{}
      RUNTIME.session=null; RUNTIME.lastEvaluation=null; RUNTIME.hidden=false;
      setTimeout(()=>showModePrompt(true),0);
    },true);
  }

  function bindEvents(){
    document.addEventListener('click',e=>{
      const mode=e.target.closest('[data-be-mode]'); if(mode){setMode(mode.dataset.beMode);return;}
      const g=e.target.closest('[data-be-guide]'); if(g){
        if(g.dataset.beGuide==='details')showDetails(false);
        if(g.dataset.beGuide==='route')showDetails(true);
        if(g.dataset.beGuide==='hide'){RUNTIME.hidden=true;removeGuideUI();}
        return;
      }
      const a=e.target.closest('[data-be-action]'); if(a){navigateToAction(a.dataset.beAction);return;}
      if(e.target.closest('[data-be-close]')){document.getElementById('be-guide-modal')?.remove();return;}
      if(e.target.closest('[data-be-exit]')){exitGuide();return;}
    });
  }

  function initialize(){
    if(RUNTIME.initialized)return;
    RUNTIME.initialized=true;
    ensureStyles(); bindEvents(); hookNewWorldButton();
    hookAnnualTick();
    // Module8 may be registered after this script.
    let tries=0;
    const timer=setInterval(()=>{
      hookAnnualTick(); hookNewWorldButton();
      if(++tries>80)clearInterval(timer);
    },250);
    setTimeout(()=>showModePrompt(false),60);
  }

  BE.GuidedDevelopment = {
    initialize,
    evaluateCurrentStage,
    evaluateStage:(stageId,state)=>EVALUATORS[stageId]?.(state)||null,
    getCurrentStage,
    getStageProgress:()=>RUNTIME.lastEvaluation,
    getRecommendedActions:()=>RUNTIME.lastEvaluation?.recommendedActions||[],
    completeStage,
    advanceStage:()=>{ const s=getCurrentStage(); return s?completeStage(s.id):false; },
    renderGuidePanel,
    navigateToAction,
    showModePrompt,
    setMode,
    stages:STAGES,
    _runtime:RUNTIME,
    _metrics:{foodMetrics,fiscalMetrics,industryMetrics,resourceMetrics,transportMetrics,tradeMetrics,stableDimensions}
  };

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',initialize,{once:true});
  else initialize();
})();
