/* Border Epoch — Research Panel Integration (minimal UI bridge)
   Restores the existing Research Forge HMI entry without changing simulation rules.
*/
(function(global){
'use strict';
const BE=global.BorderEpoch=global.BorderEpoch||{};
const RUNTIME={installed:false,lastError:null,buttonMounted:false,hmiInstalled:false};
function lang(){try{return (global.getGameLanguage?.()||global.__BE_LANG__||document.documentElement.lang||'zh').toLowerCase().startsWith('zh')?'zh':'en';}catch(_){return'zh';}}
function T(zh,en){return lang()==='zh'?zh:en;}
function getState(){
  try{return BE.UIBridge?.getState?.()||global.BorderEpochUIBridge?.getState?.()||global.__BE_STATE__||global.gameState||global.state||null;}catch(e){RUNTIME.lastError=String(e?.message||e);return null;}
}
function installHMI(){
  if(RUNTIME.hmiInstalled&&global.BorderEpochResearchForge?.instance)return true;
  const Forge=global.BorderEpochResearchForge;
  if(!Forge?.install){RUNTIME.lastError='RESEARCH_FORGE_HMI_UNAVAILABLE';return false;}
  try{
    Forge.install({
      getGameState:getState,
      researchAPI:BE.Research||global.BorderEpochResearch||null,
      languageProvider:lang,
      onClose:()=>{},
      onNavigate:target=>{try{global.openModule?.(target);}catch(_){}}
    });
    RUNTIME.hmiInstalled=!!Forge.instance;
    return RUNTIME.hmiInstalled;
  }catch(e){RUNTIME.lastError=String(e?.message||e);console.error('[ResearchPanel] install failed',e);return false;}
}
function open(){if(!installHMI())return false;try{global.BorderEpochResearchForge.open();return true;}catch(e){RUNTIME.lastError=String(e?.message||e);return false;}}
function mountButton(){
  const sidebar=document.getElementById('beModuleSidebar');
  if(!sidebar)return false;
  let b=sidebar.querySelector('[data-be-research-launch]');
  if(!b){
    b=document.createElement('button');
    b.className='be-nav-button';
    b.dataset.beResearchLaunch='1';
    b.textContent=T('科研','Research');
    b.title=T('打开科研能力、技术问题、研究项目与工程可能面板','Open capabilities, technical problems, research projects and engineering possibilities');
    const debug=sidebar.querySelector('[data-be-module="debug"]');
    if(debug)sidebar.insertBefore(b,debug);else sidebar.appendChild(b);
  } else b.textContent=T('科研','Research');
  RUNTIME.buttonMounted=true;
  return true;
}
function refresh(){installHMI();mountButton();}
function selfCheck(){
  const state=getState();
  const checks=[
    ['Research Module 10 API',!!(BE.Research||global.BorderEpochResearch)],
    ['Research catalog',!!global.BorderEpochResearchForgeCatalog],
    ['Research Forge Core',!!global.BorderEpochResearchForgeCore],
    ['Research Forge Bridge',!!global.BorderEpochResearchForgeBridge],
    ['Research Forge HMI',!!global.BorderEpochResearchForge],
    ['Research HMI installed',!!global.BorderEpochResearchForge?.instance],
    ['Research sidebar entry',!!document.querySelector('#beModuleSidebar [data-be-research-launch]')],
    ['Shared GameState available',!!state],
    ['Single official research API',!!BE.Research]
  ].map(([name,ok])=>({name,ok:!!ok}));
  try{const core=global.BorderEpochResearchForgeCore; if(core?.runSelfCheck){const x=core.runSelfCheck();checks.push({name:'Research Forge core self-check',ok:!!x?.ok,detail:x});}}catch(e){checks.push({name:'Research Forge core self-check',ok:false,error:String(e?.message||e)});}
  return {ok:checks.every(x=>x.ok),checks,lastError:RUNTIME.lastError};
}
function start(){
  if(RUNTIME.installed)return;RUNTIME.installed=true;
  refresh();
  document.addEventListener('click',e=>{if(e.target.closest('[data-be-research-launch]')){e.preventDefault();e.stopPropagation();open();}},true);
  const sidebarHost=document.body;
  const obs=new MutationObserver(()=>{if(!document.querySelector('#beModuleSidebar [data-be-research-launch]'))queueMicrotask(mountButton);});
  obs.observe(sidebarHost,{childList:true,subtree:true});
  global.addEventListener('languagechange',refresh);
  BE.ResearchPanel={open,refresh,getStatus:()=>({...RUNTIME,stateAvailable:!!getState()}),selfCheck};
  global.openResearchForge=open;
  global.__BE_RESEARCH_PANEL_CHECKS__=selfCheck();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})(window);
