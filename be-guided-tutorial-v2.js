/* ===== Border Epoch Guided Operations Tutorial System v1 =====
 * Civilization-style, step-by-step operational guidance.
 * Integration rule: reads the official GameState/UI only; it never simulates a year,
 * grants resources, alters treasury/production/trade outcomes, or bypasses AI diplomacy.
 */
(function(global){
'use strict';
const BE = global.BorderEpoch = global.BorderEpoch || {};
if (BE.GuidedTutorial?.VERSION) return;

const VERSION='1.2.0';
global.__BE_GUIDED_TUTORIAL_V2_LOADED__={version:VERSION,loadedAt:Date.now()};
const ALLOWED_RULES=new Set(['clicked','view-active','state-equals','state-greater-than','state-less-than','project-created','policy-changed','trade-created','year-advanced','agreement-created','proposal-evaluated','problem-improved','target-visible']);
const R={initialized:false,enabled:false,active:false,startYear:null,currentYear:null,currentStageId:null,currentStepId:null,targetFound:false,targetSemanticId:null,targetSelector:null,lastError:null,lastYear:null,lastState:null,lastStepBaseline:null,stepBoundTo:null,repositionQueued:false,observer:null,unsubscribe:null,strict:false,clicked:new Set(),changed:new Set(),runtimeSkipped:[],yearSnapshots:{},problem:null,pendingGuided:false,legacyWrapped:false,launchMounted:false,pollTimer:null};

const T=(zh,en)=>{try{return global.getGameLanguage?.()==='en'?en:zh}catch(_){return zh}};
const vals=v=>Array.isArray(v)?v:(v&&typeof v==='object'?Object.values(v):[]);
const num=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const state=()=>BE.UIBridge?.getState?.()||global.__BE_STATE__||global.gameState||global.state||null;
const yearOf=s=>num(s?.time?.year??s?.year??s?.currentYear,0);
const path=(obj,p)=>{let x=obj;for(const k of String(p||'').split('.')){if(!k)continue;if(x==null||!(k in x))return undefined;x=x[k];}return x;};
const textOf=el=>(el?.textContent||'').replace(/\s+/g,' ').trim();
const q=s=>{try{return document.querySelector(s)}catch(_){return null}};
const qa=s=>{try{return [...document.querySelectorAll(s)]}catch(_){return []}};
const firstVisible=els=>els.find(el=>el&&el.isConnected&&el.getClientRects().length&&!el.disabled)||els.find(el=>el&&el.isConnected)||null;
const byText=(sel,words)=>firstVisible(qa(sel).filter(el=>words.some(w=>textOf(el).toLowerCase().includes(String(w).toLowerCase()))));
const navModule=id=>document.querySelector(`[data-be-module="${id}"]`);
const navSubview=(m,s)=>document.querySelector(`[data-be-subview="${m}:${s}"]`);
const uiState=()=>BE.Module8UI?.uiState||{};

function projects(s=state()){return vals(s?.projects||s?.development?.projects);}
function agriProjects(s=state()){return vals(s?.agriculture?.stateProjects||s?.agriculture?.projects||s?.agricultureProjects);}
function tradeContracts(s=state()){return vals(s?.tradeContracts||s?.trade?.contracts);}
function proposals(s=state()){return vals(s?.diplomaticProposals||s?.diplomacy?.proposals||s?.proposals);}
function agreements(s=state()){return vals(s?.agreements||s?.diplomacy?.agreements);}
function food(s=state()){
  let vm=null;try{vm=BE.UIBridge?.selectors?.overview?.(s)?.food}catch(_){}
  const production=num(vm?.production??s?.agriculture?.lastOutput?.totalFoodProduction??s?.agriculture?.totalFoodProduction??s?.foodProduction);
  const stock=num(vm?.stock??s?.agriculture?.storage?.food??s?.food?.stock??s?.economy?.goods?.food?.available);
  const deficit=num(vm?.deficit??s?.food?.currentGap??s?.economy?.foodGap);
  const demand=num(vm?.consumption??s?.food?.demand??s?.agriculture?.lastOutput?.foodDemand);
  return {production,stock,deficit,demand,balance:production-demand};
}
function fiscal(s=state()){
  let vm=null;try{vm=BE.UIBridge?.selectors?.economy?.(s)}catch(_){}
  const treasury=num(vm?.treasury??s?.economy?.treasury??s?.treasury);
  const revenue=num(vm?.revenue??s?.economy?.annualRevenue??s?.fiscal?.annualRevenue);
  const expenditure=num(vm?.expenditure??s?.economy?.annualExpenses??s?.fiscal?.annualExpenses);
  return {treasury,revenue,expenditure,balance:revenue-expenditure};
}
function activeProject(s=state()){
  return projects(s).find(p=>/under_construction|active|building/i.test(String(p?.status||'')))||null;
}
function missingGood(s=state()){
  const ps=projects(s);
  for(const p of ps){
    const miss=p?.missingInputs||p?.missingMaterials||p?.materialShortfall||{};
    const entries=Object.entries(miss).filter(([,v])=>num(v)>0).sort((a,b)=>num(b[1])-num(a[1]));
    if(entries.length)return {goodId:entries[0][0],amount:num(entries[0][1]),project:p};
  }
  let vm=null;try{vm=BE.UIBridge?.selectors?.trade?.(s)}catch(_){}
  const g=vals(vm?.domesticGaps).sort((a,b)=>num(b.need)-num(a.need))[0];
  return g?{goodId:g.goodId,amount:num(g.need),project:null}:null;
}
function discoveredDeposit(s=state()){
  let vm=null;try{vm=BE.UIBridge?.selectors?.resources?.(s)}catch(_){}
  return vals(vm?.developable)[0]||vals(vm?.deposits)[0]||null;
}
function currentTutorial(s=state()){
  if(!s||typeof s!=='object')return null;
  s.tutorial=s.tutorial||{};
  const t=s.tutorial;
  if(!Array.isArray(t.completedStages))t.completedStages=[];
  if(!Array.isArray(t.completedSteps))t.completedSteps=[];
  if(!Array.isArray(t.skippedSteps))t.skippedSteps=[];
  if(!('enabled'in t))t.enabled=false;
  if(!('active'in t))t.active=false;
  if(!('startYear'in t))t.startYear=null;
  if(!('lastStageId'in t))t.lastStageId=null;
  if(!('lastStepId'in t))t.lastStepId=null;
  return t;
}
function stageYear(s=state()){
  const t=currentTutorial(s);const y=yearOf(s);
  if(!t)return 1;if(t.startYear==null)t.startYear=y;
  return Math.max(1,Math.min(10,(y-t.startYear)+1));
}
function viewIs(module,subview=null){const u=uiState();return u.module===module&&(subview==null||u.subview===subview);}

/* Semantic target registry: tutorial steps refer to semantic IDs, not raw selectors. */
const TargetRegistry=new Map();
function registerTutorialTarget(id,resolver,selectorHint=null){TargetRegistry.set(id,{resolver,selectorHint});}
function resolveTarget(id){const r=TargetRegistry.get(id);if(!r)return null;try{return r.resolver?.()||null}catch(e){R.lastError=`TARGET:${id}:${e.message}`;return null;}}
registerTutorialTarget('menu.agriculture',()=>navModule('agriculture'),'[data-be-module="agriculture"]');
registerTutorialTarget('menu.economy',()=>navModule('economy'),'[data-be-module="economy"]');
registerTutorialTarget('menu.development',()=>navModule('development'),'[data-be-module="development"]');
registerTutorialTarget('menu.trade',()=>navModule('trade'),'[data-be-module="trade"]');
registerTutorialTarget('menu.resources',()=>navModule('resources'),'[data-be-module="resources"]');
registerTutorialTarget('menu.diplomacy',()=>navModule('diplomacy'),'[data-be-module="diplomacy"]');
registerTutorialTarget('menu.overview',()=>navModule('overview'),'[data-be-module="overview"]');
registerTutorialTarget('agriculture.farms',()=>navSubview('agriculture','farms'),'[data-be-subview="agriculture:farms"]');
registerTutorialTarget('agriculture.inputs',()=>navSubview('agriculture','inputs'),'[data-be-subview="agriculture:inputs"]');
registerTutorialTarget('agriculture.land',()=>navSubview('agriculture','land'),'[data-be-subview="agriculture:land"]');
registerTutorialTarget('agriculture.projects',()=>navSubview('agriculture','projects'),'[data-be-subview="agriculture:projects"]');
registerTutorialTarget('agriculture.intensity',()=>firstVisible(qa('[data-agri-intensity]')),'[data-agri-intensity]');
registerTutorialTarget('agriculture.intensity.apply',()=>firstVisible(qa('[data-agri-apply-intensity]')),'[data-agri-apply-intensity]');
registerTutorialTarget('agriculture.cultivated',()=>firstVisible(qa('[data-agri-cultivated]')),'[data-agri-cultivated]');
registerTutorialTarget('agriculture.cultivated.apply',()=>firstVisible(qa('[data-agri-apply-cultivated]')),'[data-agri-apply-cultivated]');
registerTutorialTarget('agriculture.project.type',()=>q('#beAgriProjectType'),'#beAgriProjectType');
registerTutorialTarget('agriculture.project.start',()=>q('[data-agri-start-project]'),'[data-agri-start-project]');
registerTutorialTarget('economy.revenue',()=>byText('.be-stat-item',['政府收入','Government Revenue']));
registerTutorialTarget('economy.expenditure',()=>byText('.be-stat-item',['政府支出','Government Expenditure']));
registerTutorialTarget('economy.treasury',()=>byText('.be-stat-item',['国库','Treasury']));
registerTutorialTarget('economy.balance',()=>byText('.be-section,.be-stat-item',['财政账本','Fiscal Ledger','期末国库','Closing Treasury']));
registerTutorialTarget('development.build',()=>{
  const preferred=['basic_factory','steelworks','steel','power_plant','factory','port','railway'];
  const bs=qa('[data-be-op-build]').filter(x=>!x.disabled);
  for(const p of preferred){const hit=bs.find(x=>String(x.dataset.beOpBuild||'').toLowerCase().includes(p));if(hit)return hit;}
  return firstVisible(bs);
},'[data-be-op-build]');
registerTutorialTarget('development.project',()=>firstVisible(qa('[data-be-detail^="development:project:"]')),'[data-be-detail^="development:project:"]');
registerTutorialTarget('trade.quotes',()=>navSubview('trade','quotes'),'[data-be-subview="trade:quotes"]');
registerTutorialTarget('trade.good',()=>{const g=missingGood()?.goodId;return g?q(`[data-be-trade-good="${CSS.escape(String(g))}"]`):firstVisible(qa('[data-be-trade-good]'));},'[data-be-trade-good]');
registerTutorialTarget('trade.partner',()=>q('#beQuotePartner'),'#beQuotePartner');
registerTutorialTarget('trade.request',()=>q('[data-be-request-quote]'),'[data-be-request-quote]');
registerTutorialTarget('trade.quote.item',()=>firstVisible(qa('[data-be-quote-item]:not(:disabled)')),'[data-be-quote-item]');
registerTutorialTarget('trade.accept',()=>firstVisible(qa('[data-be-accept-quote]')),'[data-be-accept-quote]');
registerTutorialTarget('resources.explore',()=>firstVisible(qa('[data-be-op-explore]')),'[data-be-op-explore]');
registerTutorialTarget('resources.develop',()=>firstVisible(qa('[data-be-op-develop-deposit]')),'[data-be-op-develop-deposit]');
registerTutorialTarget('diplomacy.country',()=>firstVisible(qa('[data-be-country]')),'[data-be-country]');
registerTutorialTarget('diplomacy.relations',()=>byText('.be-stat-item',['总体关系','Relations']));
registerTutorialTarget('diplomacy.trust',()=>byText('.be-stat-item',['信任','Trust']));
registerTutorialTarget('diplomacy.needs',()=>byText('.be-section',['国家当前需求','Current Country Needs']));
registerTutorialTarget('diplomacy.builder',()=>firstVisible(qa('[data-dip-open-builder]')),'[data-dip-open-builder]');
registerTutorialTarget('diplomacy.type',()=>q('#dipAgreementType'),'#dipAgreementType');
registerTutorialTarget('diplomacy.send',()=>firstVisible(qa('[data-dip-create-send]')),'[data-dip-create-send]');
registerTutorialTarget('action.advanceYear',()=>{
  const direct=q('#advanceBtn');if(direct)return direct;
  const exact=['推进一年','下一年','结束本年','Advance Year','Next Year','End Turn','Advance one year'];
  let b=byText('button',exact);if(b)return b;
  return firstVisible(qa('button').filter(x=>/advance.*year|next.*year|end.*turn|advanceoneyear/i.test(`${x.id} ${x.className} ${x.getAttribute('onclick')||''} ${x.dataset.action||''}`)));
},'visible button text: 推进一年 / Advance Year');
registerTutorialTarget('debug.tutorial',()=>q('#be-guided-tutorial-diagnostics'));

function step(id,title,text,target,rule,extra={}){return {id,title,text,target,actionType:'click',completionRule:rule,nextStep:null,optional:false,fallbackTarget:null,...extra};}
const STAGES=[
 {id:'year1_agriculture',year:1,title:'建立基本粮食生产',interactionMode:'strict',steps:[
  step('y1_open_agriculture','打开农业','点击左侧“农业”。','menu.agriculture',{type:'view-active',module:'agriculture'}),
  step('y1_open_inputs','进入农业投入','农业强度的真实控件在“投入”视图，点击进入。','agriculture.inputs',{type:'view-active',module:'agriculture',subview:'inputs'}),
  step('y1_set_intensity','设置正常农业强度','将一个地区的农业强度设为“正常”，然后点击“应用强度”。','agriculture.intensity.apply',{type:'policy-changed',kind:'agri-intensity'}, {why:'这一步调用现有 SET_AGRICULTURAL_INTENSITY，不直接修改产量。'}),
  step('y1_open_land','进入耕地管理','点击“土地/耕地”视图。','agriculture.land',{type:'view-active',module:'agriculture',subview:'land'}),
  step('y1_cultivated','确认实际耕种面积','在已有已开发耕地范围内设置实际耕种面积，再点击“应用”。','agriculture.cultivated.apply',{type:'policy-changed',kind:'cultivated-area'},{optional:true}),
  step('y1_advance','推进第 1 年','完成操作后，点击正式“推进一年”。','action.advanceYear',{type:'year-advanced'})
 ]},
 {id:'year2_agriculture_project',year:2,title:'启动国家农业项目',interactionMode:'strict',steps:[
  step('y2_open_agri','返回农业','点击“农业”。','menu.agriculture',{type:'view-active',module:'agriculture'}),
  step('y2_projects','打开国家农业项目','点击“国家农业项目/项目”视图。','agriculture.projects',{type:'view-active',module:'agriculture',subview:'projects'}),
  step('y2_choose_project','选择农业项目','根据当前状态选择土地开发、灌溉扩张或仓储扩张。','agriculture.project.type',{type:'clicked'},{why:'推荐仅来自真实粮食状态；不会随机选择，也不会替你启动。'}),
  step('y2_start_project','启动项目','点击“启动项目”。','agriculture.project.start',{type:'project-created',scope:'agriculture'}),
  step('y2_advance','推进第 2 年','让正式农业 Tick 推进项目。','action.advanceYear',{type:'year-advanced'})
 ]},
 {id:'year3_fiscal',year:3,title:'看懂基础财政',interactionMode:'strict',steps:[
  step('y3_open_economy','打开经济','点击左侧“经济”。','menu.economy',{type:'view-active',module:'economy'}),
  step('y3_revenue','查看政府收入','点击或查看“政府收入”。','economy.revenue',{type:'clicked'}),
  step('y3_expenditure','查看政府支出','查看“政府支出”。','economy.expenditure',{type:'clicked'}),
  step('y3_treasury','查看国库与年度结算','查看国库和财政账本。','economy.balance',{type:'clicked'}),
  step('y3_policy','财政政策操作','当前正式经济 UI 若没有可调财政政策控件，本步骤会安全跳过，不虚构税率按钮。',null,{type:'target-visible'},{optional:true,requiresFiscalControl:true}),
  step('y3_advance','推进第 3 年','观察真实财政年度结算。','action.advanceYear',{type:'year-advanced'})
 ]},
 {id:'year4_first_industry',year:4,title:'开始第一项工业建设',interactionMode:'soft',steps:[
  step('y4_open_development','打开建设','点击“建设”。','menu.development',{type:'view-active',module:'development'}),
  step('y4_build','选择真实基础建设项目','点击当前建设列表中真实存在且可建的基础工业/材料项目。','development.build',{type:'project-created',scope:'development'},{optional:true}),
  step('y4_project','查看项目状态','查看刚创建的项目，确认成本、材料与工期。','development.project',{type:'clicked'},{optional:true}),
  step('y4_advance','推进第 4 年','让正式项目系统运行一年。','action.advanceYear',{type:'year-advanced'})
 ]},
 {id:'year5_trade',year:5,title:'用贸易解决真实材料缺口',interactionMode:'soft',steps:[
  step('y5_open_trade','打开国际贸易','点击“国际贸易”。','menu.trade',{type:'view-active',module:'trade'}),
  step('y5_quotes','进入国外报价','点击“国外报价”。','trade.quotes',{type:'view-active',module:'trade',subview:'quotes'}),
  step('y5_good','填写缺少商品数量','在真实缺口商品输入框填写需要进口的数量。','trade.good',{type:'policy-changed',kind:'trade-input'},{optional:true}),
  step('y5_partner','选择供应国','选择一个真实可报价国家。','trade.partner',{type:'clicked'}),
  step('y5_request','请求报价','点击“请求报价”。','trade.request',{type:'policy-changed',kind:'quote-created'}),
  step('y5_select','勾选可接受报价','勾选至少一个真实可供商品。','trade.quote.item',{type:'policy-changed',kind:'quote-selected'}),
  step('y5_accept','建立真实贸易合同','点击“接受勾选项目”。','trade.accept',{type:'trade-created'}),
  step('y5_advance','推进第 5 年','让正式贸易结算发生交付。','action.advanceYear',{type:'year-advanced'})
 ]},
 {id:'year6_construction',year:6,title:'观察正式建设推进',interactionMode:'soft',steps:[
  step('y6_open_development','回到建设','点击“建设”。','menu.development',{type:'view-active',module:'development'}),
  step('y6_project','查看在建项目','打开一个真实项目详情。','development.project',{type:'clicked'},{optional:true}),
  step('y6_advance','推进第 6 年','项目进度只由正式年度 Tick 推进。','action.advanceYear',{type:'year-advanced'})
 ]},
 {id:'year7_feedback',year:7,title:'看懂建设与经济反馈',interactionMode:'soft',steps:[
  step('y7_project','查看项目进度','在建设中查看真实项目进度。','menu.development',{type:'view-active',module:'development'}),
  step('y7_economy','查看经济反馈','进入“经济”，观察工业产出、就业、企业利润与财政。','menu.economy',{type:'view-active',module:'economy'}),
  step('y7_advance','推进第 7 年','再推进一年观察变化。','action.advanceYear',{type:'year-advanced'})
 ]},
 {id:'year8_resources',year:8,title:'建立国内资源来源',interactionMode:'soft',steps:[
  step('y8_open_resources','打开资源开发','点击“资源开发”。','menu.resources',{type:'view-active',module:'resources'}),
  step('y8_resource_action','勘探或开发真实资源','若已有可开发矿床就开发；否则先进行真实勘探。','resources.develop',{type:'project-created',scope:'development'},{optional:true,fallbackTarget:'resources.explore',dynamicResource:true}),
  step('y8_advance','推进第 8 年','让资源项目按正式年度 Tick 推进。','action.advanceYear',{type:'year-advanced'})
 ]},
 {id:'year9_diplomacy',year:9,title:'完成一次真实外交提案',interactionMode:'soft',steps:[
  step('y9_open_diplomacy','打开外交','点击“外交”。','menu.diplomacy',{type:'view-active',module:'diplomacy'}),
  step('y9_country','选择一个国家','优先选择此前有贸易往来的国家；没有则选择任一真实国家。','diplomacy.country',{type:'clicked'}),
  step('y9_relations','查看关系','查看总体关系。','diplomacy.relations',{type:'clicked'},{optional:true}),
  step('y9_trust','查看信任','查看信任。','diplomacy.trust',{type:'clicked'},{optional:true}),
  step('y9_needs','查看对方需求','查看该国当前需求。','diplomacy.needs',{type:'clicked'},{optional:true}),
  step('y9_builder','提出协议','点击“提出协议”。','diplomacy.builder',{type:'clicked'}),
  step('y9_send','建立并发送真实提案','选择简单贸易/长期供应类型后发送。AI 可接受、拒绝或还价。','diplomacy.send',{type:'proposal-evaluated'}),
  step('y9_advance','推进第 9 年','让协议/关系进入正式年度履约。','action.advanceYear',{type:'year-advanced'})
 ]},
 {id:'year10_problem',year:10,title:'独立处理一个真实国家问题',interactionMode:'soft',steps:[
  step('y10_problem','查看当前最明显的问题','系统只指出问题和入口，不再逐按钮替你决定。','menu.overview',{type:'clicked'},{dynamicProblem:true}),
  step('y10_route','进入正确模块','根据问题进入农业、经济、贸易或建设。',null,{type:'view-active'},{dynamicProblem:true}),
  step('y10_resolve','尝试改善问题','使用正式系统操作；问题指标改善后完成。',null,{type:'problem-improved'},{dynamicProblem:true,optional:true})
 ]}
];
for(const st of STAGES)st.steps.forEach((x,i)=>x.nextStep=st.steps[i+1]?.id||null);

function allSteps(){return STAGES.flatMap(s=>s.steps);}
function getStage(id){return STAGES.find(s=>s.id===id)||null;}
function getStep(id){return allSteps().find(s=>s.id===id)||null;}
function currentStage(s=state()){
 const t=currentTutorial(s);return getStage(t?.currentStageId)||STAGES.find(x=>x.year===stageYear(s))||STAGES[0];
}
function currentStep(s=state()){
 const t=currentTutorial(s);const st=currentStage(s);return getStep(t?.currentStepId)||st?.steps.find(x=>!t?.completedSteps.includes(x.id)&&!t?.skippedSteps.some(z=>(z.id||z)===x.id))||st?.steps[0]||null;
}
function baseline(s=state()){
 return {year:yearOf(s),projectIds:new Set(projects(s).map(x=>x?.id)),agriProjectIds:new Set(agriProjects(s).map(x=>x?.id)),tradeIds:new Set(tradeContracts(s).map(x=>x?.id)),proposalIds:new Set(proposals(s).map(x=>x?.id)),agreementIds:new Set(agreements(s).map(x=>x?.id)),food:food(s),fiscal:fiscal(s),agri:JSON.stringify(s?.agriculture||{}),quoteIds:new Set(vals(s?.tradeQuotes).map(x=>x?.id))};
}

function recommendAgricultureProject(s=state()){
 const f=food(s);if(f.production<=0||f.balance<0)return 'land_development';
 const regs=vals(s?.agriculture?.regions);const irrigation=regs.reduce((a,r)=>a+num(r?.irrigationFulfillment??r?.irrigationCoverage),0)/Math.max(1,regs.length);
 if(irrigation<0.7)return 'irrigation_expansion';return 'storage_expansion';
}
function setProjectRecommendation(){const el=q('#beAgriProjectType');if(!el)return;const rec=recommendAgricultureProject();const opt=[...el.options].find(o=>o.value===rec);if(opt)el.title=T(`推荐：${opt.textContent}` ,`Recommended: ${opt.textContent}`);}
function fiscalControl(){
 const candidates=qa('input,select,button').filter(el=>/tax|税率|财政政策|fiscal policy|income tax|corporate tax/i.test(`${el.id} ${el.name} ${el.dataset?.action||''} ${textOf(el.closest('label')||el)}`));
 return firstVisible(candidates.filter(x=>!x.closest('#be-guided-tutorial-tooltip')));
}
function chooseProblem(s=state()){
 const f=food(s),fi=fiscal(s),miss=missingGood(s),ps=projects(s),stalled=ps.find(p=>/stall|blocked|paused/i.test(String(p?.status||'')));
 if(f.deficit>0 || (f.demand>0&&f.production<f.demand*.8))return {id:'food',label:'粮食严重不足',module:'agriculture',target:'menu.agriculture',baseline:f.deficit||Math.max(0,f.demand-f.production)};
 if(fi.treasury<0 || fi.balance<0&&fi.treasury<Math.max(10,fi.expenditure))return {id:'treasury',label:'国库/年度财政危险',module:'economy',target:'menu.economy',baseline:fi.treasury};
 if(stalled)return {id:'stalled',label:'建设项目停工',module:'development',target:'menu.development',baseline:1,projectId:stalled.id};
 if(miss)return {id:'materials',label:`建设材料不足：${miss.goodId}`,module:'trade',target:'menu.trade',baseline:miss.amount};
 let vm=null;try{vm=BE.UIBridge?.selectors?.trade?.(s)}catch(_){}
 const gap=vals(vm?.domesticGaps).sort((a,b)=>num(b.need)-num(a.need))[0];if(gap)return {id:'industrial',label:`商品缺口：${gap.goodId}`,module:'trade',target:'menu.trade',baseline:num(gap.need),goodId:gap.goodId};
 return {id:'overview',label:'检查国家当前主要瓶颈',module:'overview',target:'menu.overview',baseline:null};
}
function problemImproved(p,s=state()){
 if(!p)return false;if(p.id==='food'){const f=food(s);return (f.deficit||Math.max(0,f.demand-f.production))<num(p.baseline);}
 if(p.id==='treasury')return fiscal(s).treasury>num(p.baseline);
 if(p.id==='stalled'){const x=projects(s).find(z=>z.id===p.projectId);return !x||!/stall|blocked|paused/i.test(String(x.status||''));}
 if(p.id==='materials'){const m=missingGood(s);return !m||m.amount<num(p.baseline);}
 if(p.id==='industrial'){let vm=null;try{vm=BE.UIBridge?.selectors?.trade?.(s)}catch(_){};const x=vals(vm?.domesticGaps).find(g=>g.goodId===p.goodId);return !x||num(x.need)<num(p.baseline);}
 return viewIs('overview');
}

function adaptStep(st,sp){
 if(!sp)return null;
 if(sp.requiresFiscalControl){const el=fiscalControl();if(el){TargetRegistry.set('economy.fiscal.control',{resolver:()=>fiscalControl(),selectorHint:'existing fiscal control'});return {...sp,target:'economy.fiscal.control',text:'调整一个当前正式 UI 已经存在的财政政策，然后观察预计影响。',completionRule:{type:'policy-changed',kind:'fiscal-control'}};}return {...sp,__skip:'CURRENT_UI_HAS_NO_MUTABLE_FISCAL_POLICY_CONTROL'};}
 if(sp.dynamicResource){return {...sp,target:resolveTarget('resources.develop')?'resources.develop':'resources.explore'};}
 if(sp.dynamicProblem){R.problem=R.problem||chooseProblem();if(sp.id==='y10_problem')return {...sp,title:R.problem.label,text:`当前优先问题：${R.problem.label}。点击查看入口。`,target:R.problem.target};if(sp.id==='y10_route')return {...sp,target:R.problem.target,completionRule:{type:'view-active',module:R.problem.module}};}
 if(sp.id==='y2_choose_project'){const rec=recommendAgricultureProject();return {...sp,text:`推荐优先选择：${rec}。你也可以根据当前真实状态选择其他正式项目。`};}
 if(sp.id==='y5_good'){const m=missingGood();if(!m)return {...sp,__skip:'NO_REAL_TRADE_OR_MATERIAL_GAP'};return {...sp,text:`当前优先缺口：${m.goodId}，约 ${m.amount.toFixed(1)}。在对应输入框填写需要采购的数量。`};}
 if(sp.id==='y6_project'&&!activeProject())return {...sp,__skip:'NO_ACTIVE_PROJECT_TO_INSPECT'};
 if(sp.id==='y4_project'&&!projects().length)return {...sp,__skip:'NO_PROJECT_CREATED'};
 if(sp.id==='y1_cultivated'&&!resolveTarget('agriculture.cultivated.apply'))return {...sp,__skip:'NO_ADJUSTABLE_CULTIVATED_AREA_CONTROL'};
 return sp;
}

function evaluateRule(rule,sp,s=state()){
 if(!rule)return false;const b=R.lastStepBaseline||baseline(s);
 switch(rule.type){
  case'clicked': return R.clicked.has(sp.id);
  case'view-active': return viewIs(rule.module,rule.subview??null);
  case'target-visible': return !!resolveTarget(sp.target);
  case'year-advanced': return yearOf(s)>num(b.year);
  case'project-created': return rule.scope==='agriculture'?agriProjects(s).some(x=>x?.id&&!b.agriProjectIds.has(x.id)):projects(s).some(x=>x?.id&&!b.projectIds.has(x.id));
  case'trade-created': return tradeContracts(s).some(x=>x?.id&&!b.tradeIds.has(x.id));
  case'agreement-created': return agreements(s).some(x=>x?.id&&!b.agreementIds.has(x.id));
  case'proposal-evaluated': return proposals(s).some(x=>x?.id&&!b.proposalIds.has(x.id)&&(/accepted|rejected|countered|sent/i.test(String(x.status||''))||x.evaluation||x.aiEvaluation));
  case'policy-changed':{
    if(rule.kind==='agri-intensity'||rule.kind==='cultivated-area')return JSON.stringify(s?.agriculture||{})!==b.agri;
    if(rule.kind==='trade-input')return !!resolveTarget('trade.good')&&num(resolveTarget('trade.good')?.value)>0;
    if(rule.kind==='quote-created')return vals(s?.tradeQuotes).some(x=>x?.id&&!b.quoteIds.has(x.id));
    if(rule.kind==='quote-selected')return qa('[data-be-quote-item]:checked').length>0;
    if(rule.kind==='fiscal-control')return R.changed.has(sp.id);
    return R.changed.has(sp.id);
  }
  case'state-equals': return path(s,rule.path)===rule.value;
  case'state-greater-than': return num(path(s,rule.path))>num(rule.value??path(R.lastState,rule.path));
  case'state-less-than': return num(path(s,rule.path))<num(rule.value??path(R.lastState,rule.path));
  case'problem-improved': return problemImproved(R.problem,s);
 }
 return false;
}

function ensureStyle(){if(q('#be-guided-tutorial-style'))return;const s=document.createElement('style');s.id='be-guided-tutorial-style';s.textContent=`
#be-guided-tutorial-ring{position:fixed;z-index:2147482504;border:3px solid #ffd36a;border-radius:10px;box-shadow:0 0 0 4px rgba(255,211,106,.22),0 0 24px rgba(255,211,106,.65);pointer-events:none;animation:beTutorialPulse 1.25s ease-in-out infinite}
@keyframes beTutorialPulse{50%{box-shadow:0 0 0 8px rgba(255,211,106,.08),0 0 34px rgba(255,211,106,.8)}}
#be-guided-tutorial-arrow{position:fixed;inset:0;z-index:2147482503;pointer-events:none;width:100vw;height:100vh}
.be-guided-blocker{position:fixed;z-index:2147482498;background:rgba(0,0,0,.52);pointer-events:auto}
#be-guided-tutorial-tooltip{position:fixed;z-index:2147482505;width:min(360px,calc(100vw - 24px));background:rgba(8,22,31,.98);border:1px solid #54768b;border-radius:14px;color:#e8f2f8;padding:14px 15px;box-shadow:0 18px 55px rgba(0,0,0,.48);font-family:Inter,system-ui,sans-serif;line-height:1.45}
#be-guided-tutorial-tooltip .be-gt-kicker{font-size:11px;color:#99b8c9;margin-bottom:3px}#be-guided-tutorial-tooltip h3{font-size:17px;margin:0 0 7px}#be-guided-tutorial-tooltip p{font-size:13px;margin:0;color:#c2d3dc}#be-guided-tutorial-tooltip details{font-size:12px;color:#a9c1ce;margin-top:8px}#be-guided-tutorial-tooltip .be-gt-actions{display:flex;gap:7px;margin-top:11px;flex-wrap:wrap}#be-guided-tutorial-tooltip button{font:inherit;font-size:11px;border:1px solid #385d73;background:#102b3b;color:#e6f0f5;border-radius:8px;padding:6px 8px;cursor:pointer}#be-guided-tutorial-tooltip button:hover{background:#173e54}
#be-guided-tutorial-resume{position:fixed;right:14px;bottom:14px;z-index:2147482000;border:1px solid #42687d;background:#102838;color:#d9eaf3;border-radius:999px;padding:8px 12px;font:12px Inter,system-ui,sans-serif;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.3)}
#be-guided-year-result{position:fixed;z-index:2147482600;left:50%;top:18%;transform:translateX(-50%);width:min(520px,90vw);background:#0b1d28;color:#e9f3f8;border:1px solid #55778c;border-radius:15px;padding:18px;box-shadow:0 22px 70px rgba(0,0,0,.5);font-family:Inter,system-ui,sans-serif}#be-guided-year-result h3{margin:0 0 8px}#be-guided-year-result .be-gt-result-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px}#be-guided-year-result button{margin-top:12px}
#be-guided-tutorial-diagnostics .be-gt-check{display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.06)}
@media(max-width:700px){#be-guided-tutorial-tooltip{width:calc(100vw - 20px)}}`;
document.head.appendChild(s);}
function clearOverlay(removeResume=false){q('#be-guided-tutorial-ring')?.remove();q('#be-guided-tutorial-arrow')?.remove();q('#be-guided-tutorial-tooltip')?.remove();qa('.be-guided-blocker').forEach(x=>x.remove());if(removeResume)q('#be-guided-tutorial-resume')?.remove();R.stepBoundTo=null;}
function ensureResume(){let b=q('#be-guided-tutorial-resume');if(!b){b=document.createElement('button');b.id='be-guided-tutorial-resume';b.textContent=T('重新打开引导','Resume Tutorial');b.onclick=()=>resume();document.body.appendChild(b);}b.style.display=R.enabled&&!R.active?'block':'none';}
function hideLegacyGuide(){try{if(BE.GuidedDevelopment?._runtime)BE.GuidedDevelopment._runtime.hidden=true}catch(_){}q('#be-guide-strip')?.remove();q('#be-guide-modal')?.remove();}
function strictBlockers(rect){qa('.be-guided-blocker').forEach(x=>x.remove());if(!R.strict)return;const parts=[[0,0,innerWidth,Math.max(0,rect.top-6)],[0,Math.max(0,rect.bottom+6),innerWidth,Math.max(0,innerHeight-rect.bottom-6)],[0,Math.max(0,rect.top-6),Math.max(0,rect.left-6),rect.height+12],[Math.min(innerWidth,rect.right+6),Math.max(0,rect.top-6),Math.max(0,innerWidth-rect.right-6),rect.height+12]];for(const [l,t,w,h] of parts){if(w<=0||h<=0)continue;const d=document.createElement('div');d.className='be-guided-blocker';Object.assign(d.style,{left:l+'px',top:t+'px',width:w+'px',height:h+'px'});document.body.appendChild(d);}}
function placeTooltip(tip,rect){const w=tip.offsetWidth||360,h=tip.offsetHeight||140,g=18;let left=rect.right+g,top=Math.max(10,rect.top);if(left+w>innerWidth-10)left=Math.max(10,rect.left-w-g);if(left<10){left=Math.min(innerWidth-w-10,Math.max(10,rect.left));top=rect.bottom+g;}if(top+h>innerHeight-10)top=Math.max(10,innerHeight-h-10);tip.style.left=left+'px';tip.style.top=top+'px';}
function drawArrow(tip,targetRect){let svg=q('#be-guided-tutorial-arrow');if(!svg){svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.id='be-guided-tutorial-arrow';svg.innerHTML='<defs><marker id="beGtArrowHead" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#ffd36a"/></marker></defs><line id="beGtArrowLine" stroke="#ffd36a" stroke-width="3" marker-end="url(#beGtArrowHead)"/>';document.body.appendChild(svg);}const tr=tip.getBoundingClientRect(),line=svg.querySelector('#beGtArrowLine'),tx=targetRect.left+targetRect.width/2,ty=targetRect.top+targetRect.height/2,cx=tr.left+tr.width/2,cy=tr.top+tr.height/2;line.setAttribute('x1',cx);line.setAttribute('y1',cy);line.setAttribute('x2',tx);line.setAttribute('y2',ty);}
function scheduleReposition(){if(R.repositionQueued)return;R.repositionQueued=true;requestAnimationFrame(()=>{R.repositionQueued=false;reposition();});}
function reposition(){if(!R.active)return;const sp=adaptStep(currentStage(),currentStep());if(!sp||sp.__skip)return;const el=sp.target?resolveTarget(sp.target):null;if(!el){R.targetFound=false;return;}R.targetFound=true;const rect=el.getBoundingClientRect();let ring=q('#be-guided-tutorial-ring');if(!ring){ring=document.createElement('div');ring.id='be-guided-tutorial-ring';document.body.appendChild(ring);}Object.assign(ring.style,{left:(rect.left-5)+'px',top:(rect.top-5)+'px',width:(rect.width+10)+'px',height:(rect.height+10)+'px'});strictBlockers(rect);const tip=q('#be-guided-tutorial-tooltip');if(tip){placeTooltip(tip,rect);drawArrow(tip,rect);}}
function renderTooltip(){clearOverlay(false);ensureStyle();hideLegacyGuide();const s=state(),st=currentStage(s);let sp=adaptStep(st,currentStep(s));if(!sp)return finish();if(sp.__skip){skipStep(sp.id,sp.__skip);return;}
 R.strict=st.interactionMode==='strict';R.currentYear=yearOf(s);R.currentStageId=st.id;R.currentStepId=sp.id;R.targetSemanticId=sp.target||null;R.lastStepBaseline=R.lastStepBaseline||baseline(s);
 const el=sp.target?resolveTarget(sp.target):null;R.targetFound=!!el;R.targetSelector=TargetRegistry.get(sp.target)?.selectorHint||null;
 const idx=st.steps.findIndex(x=>x.id===sp.id)+1;const tip=document.createElement('section');tip.id='be-guided-tutorial-tooltip';tip.innerHTML=`<div class="be-gt-kicker">${T('第','Year ')} ${st.year}${T(' 年','')} · ${T('第','Step ')} ${idx}/${st.steps.length} ${T('步','')}</div><h3>${sp.title}</h3><p>${sp.text}</p>${sp.why?`<details><summary>${T('为什么？','Why?')}</summary>${sp.why}</details>`:''}<div class="be-gt-actions"><button data-be-gt-skip>${T('跳过当前步骤','Skip step')}</button><button data-be-gt-close>${T('关闭引导','Close tutorial')}</button></div>`;document.body.appendChild(tip);
 if(el){try{el.scrollIntoView({block:'nearest',inline:'nearest',behavior:'smooth'})}catch(_){}scheduleReposition();}else{handleMissingTarget(sp);}
 ensureResume();decorateDebugPage();}
function handleMissingTarget(sp){let tries=0;const attempt=()=>{if(!R.active||currentStep()?.id!==sp.id)return;const t=sp.target&&resolveTarget(sp.target);if(t){renderTooltip();return;}if(++tries<4){requestAnimationFrame(attempt);return;}if(sp.fallbackTarget&&resolveTarget(sp.fallbackTarget)){sp.target=sp.fallbackTarget;renderTooltip();return;}if(sp.optional){skipStep(sp.id,'TARGET_NOT_FOUND_OPTIONAL');return;}R.lastError=`TARGET_NOT_FOUND:${sp.id}:${sp.target}`;console.warn('[GuidedTutorial] target not found:',sp.id,sp.target);};requestAnimationFrame(attempt);}

function markComplete(id){const s=state(),t=currentTutorial(s);if(!t||t.completedSteps.includes(id))return false;t.completedSteps.push(id);t.lastStepId=id;R.lastStepBaseline=null;R.clicked.delete(id);R.changed.delete(id);const st=currentStage(s),i=st.steps.findIndex(x=>x.id===id),next=st.steps.slice(i+1).find(x=>!t.completedSteps.includes(x.id)&&!t.skippedSteps.some(z=>(z.id||z)===x.id));if(next){t.currentStepId=next.id;renderTooltip();return true;}completeStage(st.id);return true;}
function skipStep(id,reason='USER_SKIPPED'){const s=state(),t=currentTutorial(s);if(!t)return false;if(!t.skippedSteps.some(z=>(z.id||z)===id))t.skippedSteps.push({id,reason,year:yearOf(s)});R.runtimeSkipped.push({id,reason});R.lastStepBaseline=null;const st=currentStage(s),i=st.steps.findIndex(x=>x.id===id),next=st.steps.slice(i+1).find(x=>!t.completedSteps.includes(x.id)&&!t.skippedSteps.some(z=>(z.id||z)===x.id));if(next){t.currentStepId=next.id;renderTooltip();}else completeStage(st.id);return true;}
function completeStage(id){const s=state(),t=currentTutorial(s),st=getStage(id);if(!t||!st)return false;if(!t.completedStages.includes(id))t.completedStages.push(id);t.lastStageId=id;const next=STAGES.find(x=>x.year===st.year+1);if(!next){finish();return true;}t.currentStageId=next.id;t.currentStepId=next.steps[0].id;R.lastStepBaseline=null;renderTooltip();return true;}
function finish(){const s=state(),t=currentTutorial(s);if(t){t.active=false;t.enabled=false;t.completed=true;t.currentStageId=null;t.currentStepId=null;}R.active=false;R.enabled=false;clearOverlay(true);showCompletion();}
function showCompletion(){let d=q('#be-guided-year-result');d?.remove();d=document.createElement('section');d.id='be-guided-year-result';d.innerHTML=`<h3>${T('前 10 年操作引导完成','10-year operations tutorial complete')}</h3><p>${T('你已经实际操作过农业、财政阅读、建设、贸易、资源与外交。此后进入自由运行，正式 GameState 和年度 Tick 保持不变。','You have operated agriculture, finance reading, development, trade, resources and diplomacy. The game now continues freely with the same official GameState and annual tick.')}</p><button data-be-gt-result-close>${T('进入自由运行','Continue freely')}</button>`;document.body.appendChild(d);}
function showYearResult(before,after,st){q('#be-guided-year-result')?.remove();const d=document.createElement('section');d.id='be-guided-year-result';const bf=before?.food||{},af=after?.food||{},bi=before?.fiscal||{},ai=after?.fiscal||{};d.innerHTML=`<h3>${T(`第 ${st.year} 年结果`,`Year ${st.year} result`)}</h3><div class="be-gt-result-grid"><span>${T('粮食产量','Food production')}</span><b>${num(bf.production).toFixed(1)} → ${num(af.production).toFixed(1)}</b><span>${T('粮食缺口','Food deficit')}</span><b>${num(bf.deficit).toFixed(1)} → ${num(af.deficit).toFixed(1)}</b><span>${T('政府收入','Revenue')}</span><b>${num(bi.revenue).toFixed(1)} → ${num(ai.revenue).toFixed(1)}</b><span>${T('国库','Treasury')}</span><b>${num(bi.treasury).toFixed(1)} → ${num(ai.treasury).toFixed(1)}</b></div><button data-be-gt-result-close>${T('继续','Continue')}</button>`;document.body.appendChild(d);}

function evaluateCurrentStep(){if(!R.active)return false;const s=state(),st=currentStage(s),raw=currentStep(s),sp=adaptStep(st,raw);if(!sp)return false;if(sp.__skip){skipStep(sp.id,sp.__skip);return true;}const ok=evaluateRule(sp.completionRule,sp,s);if(ok){const wasYear=sp.completionRule?.type==='year-advanced',before=R.lastStepBaseline;markComplete(sp.id);if(wasYear&&before){showYearResult(before,baseline(s),st);}return true;}return false;}
function onYearAdvanced(s=state()){R.currentYear=yearOf(s);evaluateCurrentStep();}
function onStateUpdated(s=state()){if(!s)return;if(!R.active&&legacyWantsGuided(s))attemptPendingStart();const y=yearOf(s);if(R.lastYear==null)R.lastYear=y;if(y!==R.lastYear){R.lastYear=y;onYearAdvanced(s);}else evaluateCurrentStep();R.lastState=s;scheduleReposition();decorateDebugPage();}
function onViewChanged(){evaluateCurrentStep();renderTooltip();}
function highlightTarget(){renderTooltip();}
function scrollToTarget(){const sp=adaptStep(currentStage(),currentStep()),el=sp?.target&&resolveTarget(sp.target);el?.scrollIntoView?.({block:'center',inline:'nearest'});scheduleReposition();return !!el;}
function bindTarget(){renderTooltip();return R.targetFound;}

function legacyWantsGuided(s=state()){return !!(R.pendingGuided||s?.onboarding?.mode==='guided'||s?.onboardingState?.mode==='guided'||s?.guidedDevelopment?.mode==='guided');}
function start(){const s=state();if(!s){R.pendingGuided=true;R.lastError='GAME_STATE_UNAVAILABLE';return false;}R.pendingGuided=false;const t=currentTutorial(s);t.enabled=true;t.active=true;t.completed=false;if(t.startYear==null)t.startYear=yearOf(s);const sy=stageYear(s),st=STAGES.find(x=>x.year===sy)||STAGES[0];t.currentStageId=t.currentStageId&&getStage(t.currentStageId)?t.currentStageId:st.id;const actual=getStage(t.currentStageId)||st;t.currentStepId=t.currentStepId&&getStep(t.currentStepId)?t.currentStepId:(actual.steps.find(x=>!t.completedSteps.includes(x.id)&&!t.skippedSteps.some(z=>(z.id||z)===x.id))||actual.steps[0]).id;R.enabled=true;R.active=true;R.startYear=t.startYear;R.lastYear=yearOf(s);R.problem=null;hideLegacyGuide();renderTooltip();mountLaunchButton();return true;}
function stop(){const t=currentTutorial();if(t){t.enabled=false;t.active=false;}R.enabled=false;R.active=false;clearOverlay(false);ensureResume();mountLaunchButton();return true;}
function disable(){const t=currentTutorial();if(t){t.enabled=false;t.active=false;}R.enabled=false;R.active=false;clearOverlay(true);mountLaunchButton();return true;}
function pause(){R.active=false;const t=currentTutorial();if(t)t.active=false;clearOverlay(false);ensureResume();mountLaunchButton();return true;}
function resume(){const t=currentTutorial();if(!t)return start();t.enabled=true;t.active=true;R.enabled=true;R.active=true;hideLegacyGuide();renderTooltip();mountLaunchButton();return true;}
function goToStage(id){const s=state(),t=currentTutorial(s),st=getStage(id);if(!t||!st)return false;t.currentStageId=id;t.currentStepId=st.steps[0].id;R.lastStepBaseline=null;renderTooltip();return true;}
function goToStep(id){const s=state(),t=currentTutorial(s),sp=getStep(id);if(!t||!sp)return false;t.currentStepId=id;t.currentStageId=STAGES.find(x=>x.steps.some(y=>y.id===id))?.id||t.currentStageId;R.lastStepBaseline=null;renderTooltip();return true;}
function completeStep(){const sp=currentStep();return sp?markComplete(sp.id):false;}

function getStatus(){const s=state(),t=currentTutorial(s);const sp=currentStep(s);return {version:VERSION,enabled:!!t?.enabled,active:!!t?.active,currentYear:yearOf(s),tutorialYear:stageYear(s),currentStageId:t?.currentStageId||null,currentStepId:t?.currentStepId||null,targetFound:R.targetFound,targetSemanticId:R.targetSemanticId,targetSelector:R.targetSelector,completionRule:sp?.completionRule||null,completedSteps:[...(t?.completedSteps||[])],skippedSteps:[...(t?.skippedSteps||[])],lastError:R.lastError,annualTickOwner:'BorderEpoch.Module8.advanceOneYear',stateOwner:'official GameState.tutorial'};}
function selfTest(){const ids=allSteps().map(x=>x.id),duplicates=ids.filter((x,i)=>ids.indexOf(x)!==i);const s=state(),t=currentTutorial(s);const staticCore=['menu.agriculture','menu.economy','menu.development','menu.trade','menu.resources','menu.diplomacy'];const checks=[];const add=(name,ok,detail='')=>checks.push({name,ok:!!ok,detail});add('Controller initialized',R.initialized);add('Stage count is 10',STAGES.length===10,STAGES.length);add('Step IDs are unique',duplicates.length===0,duplicates.join(','));add('Completion rule types valid',allSteps().every(x=>ALLOWED_RULES.has(x.completionRule?.type)),allSteps().filter(x=>!ALLOWED_RULES.has(x.completionRule?.type)).map(x=>x.id).join(','));add('Year mapping is 1..10',STAGES.every((x,i)=>x.year===i+1));add('Core target registry present',staticCore.every(x=>TargetRegistry.has(x)));add('Advance-year target registry present',TargetRegistry.has('action.advanceYear'));add('No second GameState',!!s&&t===s.tutorial,'tutorial stored on official GameState');add('No second annual tick',!('advanceYear' in API)&&!('tick' in API),'reads Module8 tick only');add('Tutorial does not expose treasury mutation',!('setTreasury' in API));add('Tutorial does not expose production mutation',!('setProduction' in API));add('Tutorial does not expose trade-result mutation',!('forceTrade' in API));add('Diplomacy uses existing proposal UI',TargetRegistry.has('diplomacy.send'));add('Overlay can be cleared',typeof clearOverlay==='function');add('Save/load path is official state',!!s&&Object.prototype.hasOwnProperty.call(s,'tutorial'));global.__BE_GUIDED_TUTORIAL_CHECKS__=checks;return checks;}
function decorateDebugPage(){if(!viewIs('debug'))return;const host=q('#mainWorkspace .be-workspace-inner');if(!host||q('#be-guided-tutorial-diagnostics'))return;const sec=document.createElement('div');sec.className='be-section';sec.id='be-guided-tutorial-diagnostics';const checks=selfTest();sec.innerHTML=`<h2>Guided Tutorial</h2><div class="be-note">${T('只读取正式 GameState；年度推进仍由 Module8.advanceOneYear 独占。','Reads only the official GameState; annual advancement remains owned exclusively by Module8.advanceOneYear.')}</div>${checks.map(c=>`<div class="be-gt-check"><span>${c.name}</span><b class="be-status ${c.ok?'good':'bad'}">${c.ok?'OK':'FAIL'}</b></div>`).join('')}`;host.appendChild(sec);}


function notify(msg,bad=false){
 try{if(typeof global.toastUI==='function')return global.toastUI(msg,bad?'bad':'good');}catch(_){}
 let el=q('#be-gt-notice');if(!el){el=document.createElement('div');el.id='be-gt-notice';el.style.cssText='position:fixed;right:18px;bottom:18px;z-index:2147483646;background:#0b1c27;color:#e7f1f7;border:1px solid #3d647c;border-radius:10px;padding:10px 14px;box-shadow:0 10px 30px rgba(0,0,0,.35);font:14px/1.4 system-ui;max-width:min(420px,88vw)';document.body.appendChild(el);}el.textContent=msg;setTimeout(()=>el?.remove(),3200);
}
function mountLaunchButton(){
 const sidebar=document.getElementById('beModuleSidebar');if(!sidebar)return false;
 let b=sidebar.querySelector('[data-be-guided-launch]');
 if(!b){b=document.createElement('button');b.className='be-nav-button';b.dataset.beGuidedLaunch='1';const research=sidebar.querySelector('[data-be-research-launch]'),debug=sidebar.querySelector('[data-be-module="debug"]');if(research?.nextSibling)sidebar.insertBefore(b,research.nextSibling);else if(debug)sidebar.insertBefore(b,debug);else sidebar.appendChild(b);}
 b.textContent=R.active?T('引导中','Guided'):T('引导','Guide');
b.title=T('打开/继续逐点击国家发展引导','Open or continue the step-by-step national development tutorial');
if(!b.__beGuidedDirectBound){
  b.__beGuidedDirectBound=true;
  b.addEventListener('click',function(e){
    e.preventDefault();e.stopPropagation();
    if(R.active){renderTooltip();scrollToTarget();notify(T('引导已打开','Guide opened'));}
    else{
      const st=state();
      if(!st){R.pendingGuided=true;notify(T('正在等待国家状态生成，生成世界后会自动开始引导。','Waiting for the game state; the guide will start after world generation.'));}
      else{syncLegacyMode('guided'); if(start()) notify(T('逐点击引导已启动','Step-by-step guide started')); else notify(T('引导启动失败，请查看自检。','Guide failed to start; check Self-check.'),true);}
    }
    mountLaunchButton();
  },false);
}
R.launchMounted=true;return true;
}
function syncLegacyMode(mode){
 const s=state();if(s){s.onboarding=s.onboarding||{};s.onboarding.mode=mode;s.onboarding.started=mode==='guided';}
 if(mode==='guided'){R.pendingGuided=true;attemptPendingStart();}else if(mode==='free'){R.pendingGuided=false;disable();}
}
function wrapLegacyGuide(){
 const L=BE.GuidedDevelopment;if(!L||R.legacyWrapped)return false;
 if(typeof L.setMode==='function'){
   const old=L.setMode.bind(L);
   L.setMode=function(mode,...args){const out=old(mode,...args);queueMicrotask(()=>syncLegacyMode(mode));return out;};
 }
 R.legacyWrapped=true;return true;
}
function pollIntegration(){
 wrapLegacyGuide();mountLaunchButton();
 if(!R.unsubscribe&&BE.UIBridge?.subscribe)R.unsubscribe=BE.UIBridge.subscribe(onStateUpdated);
 const s=state();if(s&&legacyWantsGuided(s)&&!R.active)attemptPendingStart();
 try{const pref=JSON.parse(localStorage.getItem('borderEpoch.guidedDevelopment.preference.v1')||'null');if(pref?.mode==='guided'&&!R.active){R.pendingGuided=true;attemptPendingStart();}}catch(_){}
 if(R.active)mountLaunchButton();
}
function handleClick(e){const launch=e.target.closest?.('[data-be-guided-launch]');if(launch){e.preventDefault();e.stopPropagation();if(R.active){renderTooltip();scrollToTarget();notify(T('引导已打开','Guide opened'));}else{const st=state();if(!st){R.pendingGuided=true;notify(T('正在等待国家状态生成，生成世界后会自动开始引导。','Waiting for the game state; the guide will start after world generation.'));}else{syncLegacyMode('guided');if(start())notify(T('逐点击引导已启动','Step-by-step guide started'));else notify(T('引导启动失败，请查看自检。','Guide failed to start; check Self-check.'),true);}}mountLaunchButton();return;}const mode=e.target.closest?.('[data-be-mode]');if(mode){if(mode.dataset.beMode==='guided'){R.pendingGuided=true;queueMicrotask(()=>{if(!start())R.lastError='WAITING_FOR_GAME_STATE';});}else if(mode.dataset.beMode==='free'){R.pendingGuided=false;queueMicrotask(()=>disable());}return;}
 const nw=e.target.closest?.('#newWorldBtn');if(nw&&legacyWantsGuided()){R.pendingGuided=true;queueMicrotask(()=>attemptPendingStart());}
 if(e.target.closest?.('[data-be-gt-skip]')){e.preventDefault();const sp=currentStep();if(sp)skipStep(sp.id,'USER_SKIPPED');return;}
 if(e.target.closest?.('[data-be-gt-close]')){e.preventDefault();pause();return;}
 if(e.target.closest?.('[data-be-gt-result-close]')){q('#be-guided-year-result')?.remove();if(R.enabled)renderTooltip();return;}
 if(!R.active)return;const sp=adaptStep(currentStage(),currentStep());if(!sp||sp.__skip)return;const target=sp.target?resolveTarget(sp.target):null;if(target&&(e.target===target||target.contains(e.target))){R.clicked.add(sp.id);setTimeout(()=>{evaluateCurrentStep();if(R.active)renderTooltip();},0);}
 if(sp.id==='y9_country'&&e.target.closest?.('[data-be-country]'))R.clicked.add(sp.id);
}
function attemptPendingStart(){const s=state();if(!s||!legacyWantsGuided(s))return false;if(R.active)return true;return start();}
function handleChange(e){if(!R.active)return;const sp=adaptStep(currentStage(),currentStep());if(!sp)return;const target=sp.target?resolveTarget(sp.target):null;if(target&&(e.target===target||target.contains(e.target))){R.changed.add(sp.id);setTimeout(()=>evaluateCurrentStep(),0);} }
function init(){if(R.initialized)return;R.initialized=true;ensureStyle();document.addEventListener('click',handleClick,true);document.addEventListener('change',handleChange,true);global.addEventListener('resize',scheduleReposition);global.addEventListener('scroll',scheduleReposition,true);R.observer=new MutationObserver(()=>{scheduleReposition();decorateDebugPage();mountLaunchButton();wrapLegacyGuide();if(!R.active&&legacyWantsGuided())attemptPendingStart();if(R.active){const sp=adaptStep(currentStage(),currentStep());if(sp?.target&&!R.targetFound&&resolveTarget(sp.target))renderTooltip();}});R.observer.observe(document.documentElement,{childList:true,subtree:true});pollIntegration();R.pollTimer=setInterval(pollIntegration,1000);
 const s=state();if(s){R.lastYear=yearOf(s);const t=currentTutorial(s);if((t.enabled&&t.active)||legacyWantsGuided(s)){if(!(t.enabled&&t.active))start();else{R.enabled=true;R.active=true;hideLegacyGuide();renderTooltip();}}}else{try{const pref=JSON.parse(localStorage.getItem('borderEpoch.guidedDevelopment.preference.v1')||'null');if(pref?.mode==='guided')R.pendingGuided=true;}catch(_){}}
 selfTest();}

const API={VERSION,enabled:false,active:false,currentYear:null,currentStageId:null,currentStepId:null,completedSteps:[],skippedSteps:[],start,stop,disable,pause,resume,goToStage,goToStep,completeStep,evaluateCurrentStep,renderOverlay:renderTooltip,clearOverlay,highlightTarget,scrollToTarget,bindTarget,onYearAdvanced,onStateUpdated,onViewChanged,getStatus,selfTest,registerTutorialTarget,TargetRegistry,stages:STAGES};
Object.defineProperties(API,{enabled:{get:()=>R.enabled},active:{get:()=>R.active},currentYear:{get:()=>R.currentYear},currentStageId:{get:()=>currentTutorial()?.currentStageId||null},currentStepId:{get:()=>currentTutorial()?.currentStepId||null},completedSteps:{get:()=>currentTutorial()?.completedSteps||[]},skippedSteps:{get:()=>currentTutorial()?.skippedSteps||[]}});
BE.GuidedTutorial=API;global.GuidedTutorial=API;
function safeInit(){try{init();}catch(e){R.lastError='INIT:'+String(e?.message||e);global.__BE_GUIDED_TUTORIAL_FATAL__=R.lastError;console.error('[GuidedTutorial] init failed',e);}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',safeInit,{once:true});else safeInit();
})(window);
