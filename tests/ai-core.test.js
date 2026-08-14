const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const AI=require('../ai-core.js');

test('aliases resolve but ambiguous initials do not auto-resolve',()=>{
  const ms=[{name:'テスト花子',displayName:'はな',kana:'てすとはなこ',aliases:['hana']},{name:'例示華',displayName:'はな',kana:'れいじはな',aliases:['hana']}];
  assert.equal(AI.resolveName('テスト花子',ms).member.name,'テスト花子');
  assert.equal(AI.resolveName('hana',ms).status,'ambiguous');
});
test('private and team data are excluded for outsiders',()=>{
  const db={projects:[{id:'p',teams:[{name:'Boost',members:['A']}]}],items:[
    {id:'1',pj:'p',visibility:'all',team:'',deleted:false},{id:'2',pj:'p',visibility:'members',who:['A'],deleted:false},{id:'3',pj:'p',visibility:'all',team:'Boost',deleted:false}
  ]};
  assert.deepEqual(AI.visibleSnapshot(db,'B').items.map(x=>x.id),['1']);
});
test('strict schema rejects unknown actions and fields',()=>{
  assert.throws(()=>AI.validatePlan({version:1,operations:[{action:'eval'}]}));
  assert.throws(()=>AI.validatePlan({version:1,code:'x',operations:[]}));
  assert.equal(AI.validatePlan({version:1,operations:[{action:'create',type:'event',title:'x',date:'2026-08-04'}]}).operations.length,1);
});
test('individual tasks keep completion separate for every target member',()=>{
  const members=[{name:'A'},{name:'B'},{name:'C'}],projects=[];
  const task={type:'task',completionMode:'individual',visibility:'all',who:[],done:false,doneBy:{}};
  assert.deepEqual(AI.taskTargets(task,members,projects),['A','B','C']);
  assert.equal(AI.setTaskDoneFor(task,'A',true,members,projects,100),true);
  assert.equal(AI.isTaskDoneFor(task,'A',members,projects),true);
  assert.equal(AI.isTaskDoneFor(task,'B',members,projects),false);
  assert.equal(AI.isTaskFullyDone(task,members,projects),false);
  AI.setTaskDoneFor(task,'B',true,members,projects,110);
  AI.setTaskDoneFor(task,'C',true,members,projects,120);
  assert.equal(AI.isTaskFullyDone(task,members,projects),true);
  assert.deepEqual(AI.taskProgress(task,members,projects),{done:3,total:3,targets:['A','B','C']});
});
test('team targets and shared tasks preserve the intended completion behavior',()=>{
  const members=[{name:'A'},{name:'B'},{name:'C'}];
  const projects=[{id:'p',teams:[{name:'Boost',members:['A','B']}]}];
  const teamTask={type:'task',pj:'p',team:'Boost',completionMode:'individual',done:false,doneBy:{}};
  assert.deepEqual(AI.taskTargets(teamTask,members,projects),['A','B']);
  assert.equal(AI.setTaskDoneFor(teamTask,'C',true,members,projects,100),false);
  const shared={type:'task',completionMode:'shared',done:false};
  AI.setTaskDoneFor(shared,'A',true,members,projects,200);
  assert.equal(AI.isTaskDoneFor(shared,'B',members,projects),true);
});
test('per-member completion merges by each member timestamp',()=>{
  const merged=AI.mergeDoneBy({A:{done:true,at:100},B:{done:false,at:120}},{A:{done:false,at:90},B:{done:true,at:130}});
  assert.deepEqual(merged,{A:{done:true,at:100},B:{done:true,at:130}});
});
test('personal assignment migration keeps only the confirmed member complete',()=>{
  const task={id:'i1',type:'task',done:true,doneAt:90,updatedAt:90};
  assert.equal(AI.migrateTaskCompletion(task,['利用者A'],'v51-personal-task',100),true);
  assert.equal(task.completionMode,'individual');
  assert.deepEqual(task.doneBy,{'利用者A':{done:true,at:100}});
  assert.equal(task.done,false);
  assert.equal(AI.migrateTaskCompletion(task,['別の人'],'v51-personal-task',200),false);
  assert.deepEqual(Object.keys(task.doneBy),['利用者A']);
});
test('app version is initialized before startup and matches the service worker',()=>{
  const root=path.resolve(__dirname,'..');
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
  const manifest=fs.readFileSync(path.join(root,'manifest.json'),'utf8');
  const appVersion=(html.match(/window\.__ZEMI_APP_V__='(\d+)'/)||[])[1];
  const workerVersion=(sw.match(/const V = 'zemi-calendar-v(\d+)'/)||[])[1];
  assert.ok(appVersion,'APP_V must be declared');
  assert.equal(workerVersion,appVersion);
  assert.match(html,new RegExp(`ai-core\\.js\\?v=${appVersion}`));
  assert.match(manifest,new RegExp(`"start_url": "\\./\\?pwa=${appVersion}"`));
  assert.ok(html.indexOf("window.__ZEMI_APP_V__='")<html.indexOf('src="ai-core.js'));
  assert.match(html,/boot\(\)\.catch\(/);
});

test('startup recovery works before app code and service worker never returns HTML for failed assets',()=>{
  const root=path.resolve(__dirname,'..');
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
  assert.ok(html.indexOf('window.__zemiSafeReload')<html.indexOf('src="ai-core.js'));
  assert.match(html,/id="bootGuard"/);
  assert.match(html,/startsWith\('zemi-calendar-v'\)/);
  assert.match(html,/updateViaCache:'none'/);
  const v=(html.match(/window\.__ZEMI_APP_V__='(\d+)'/)||[])[1];
  assert.match(sw,new RegExp(`ai-core\\.js\\?v=${v}`));
  assert.match(sw,/caches\.match\(e\.request, \{ ignoreSearch: true \}\)/);
  assert.doesNotMatch(sw,/catch\(\(\) => caches\.match\('\.\/index\.html'\)\)/);
  assert.match(html,/DB=\{projects:\[\],items:\[\]\}/);
});

test('sync has a deadline, persists signatures, and does not overlap load with pending writes',()=>{
  const html=fs.readFileSync(path.resolve(__dirname,'..','index.html'),'utf8');
  assert.match(html,/const API_TIMEOUT_MS=\d+;/);
  assert.match(html,/AbortController/);
  assert.match(html,/serverSig/);
  assert.match(html,/if\(pending\.length&&!\(await flush\(true\)\)\)throw new Error\('save_failed'\)/);
  assert.doesNotMatch(html,/Promise\.all\(\[ flush\(true\), API\.load\(\) \]\)/);
  assert.match(html,/if\(_syncPromise\)return _syncPromise/);
  assert.match(html,/if\(Date\.now\(\)<_syncCooldownUntil\)/);
  assert.match(html,/if\(String\(e\.message\)==='timeout'\)_syncCooldownUntil=Date\.now\(\)\+20000/);
  assert.match(html,/const waits=\[15000,30000,60000\]/);
  assert.match(html,/_syncDeadline=Date\.now\(\)\+API_TIMEOUT_MS/);
  assert.match(html,/Math\.min\(limit,_syncDeadline-Date\.now\(\)\)/);
});
test('seminar membership follows the member registry instead of a visible project roster',()=>{
  const members=[{name:'A'},{name:'B'},{name:'C'}];
  const projects=[{id:'zemi',name:'ゼミ',members:['A'],teams:[]}];
  const task={type:'task',pj:'zemi',team:'ゼミ',completionMode:'individual',done:false,doneBy:{}};
  assert.deepEqual(AI.taskTargets(task,members,projects),['A','B','C']);
});

test('ordinary members cannot edit other creators items or project structure in the UI',()=>{
  const html=fs.readFileSync(path.resolve(__dirname,'..','index.html'),'utf8');
  assert.match(html,/const canModifyItem = i =>/);
  assert.match(html,/withActions&&canManageApp\(\)/);
  assert.match(html,/if\(editing&&!canModifyItem\(editing\)\)/);
  assert.match(html,/プロジェクト構成は管理者だけが変更できます/);
});

test('AI verifies the device and only falls back when the GAS action is unsupported',()=>{
  const html=fs.readFileSync(path.resolve(__dirname,'..','index.html'),'utf8');
  assert.match(html,/async function ensureAIIdentity\(\)/);
  assert.match(html,/action:'aiPlan'/);
  assert.match(html,/action:'ai',contents/);
  assert.match(html,/読み取り専用互換モード/);
  assert.match(html,/unknown action\|未対応の操作\|action not found/);
  assert.doesNotMatch(html,/if\(\/timeout.*throw e;\s*return legacy\(\)/s);
  assert.match(html,/body\.name=body\.name\|\|ME/);
});

test('the seminar registry is hidden from project-and-role UI selectors',()=>{
  const html=fs.readFileSync(path.resolve(__dirname,'..','index.html'),'utf8');
  assert.match(html,/const isSeminarGroup=/);
  assert.match(html,/const selectableProjects=\(\)=>activeProjects\(\)\.filter\(p=>!isSeminarGroup\(p\)\)/);
  assert.match(html,/selectableProjects\(\)\.map\(p=>progRow\(p,true\)\)/);
  assert.match(html,/const pjOpts=selectableProjects\(\)/);
});

test('a targeted server logout clears only the currently selected identity without clearing app data',()=>{
  const html=fs.readFileSync(path.resolve(__dirname,'..','index.html'),'utf8');
  assert.match(html,/function clearSelectedIdentity\(\)/);
  assert.match(html,/\/\^logout:\/\.test/);
  assert.match(html,/if\(identityResetKey\(ME\)==='b9tpvp'&&!LS\.get\('identityResetV61',false\)\)/);
  assert.doesNotMatch(html,/localStorage\.clear\(\)/);
});

test('privacy, identity recovery, cache scope, and Gemini data mode fail closed',()=>{
  const root=path.resolve(__dirname,'..');
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
  const gas=fs.readFileSync(path.join(root,'gas','AIBackend.gs'),'utf8');
  const privacy=fs.readFileSync(path.join(root,'privacy.html'),'utf8');
  assert.match(html,/const MEMBERS0 = \[\]/);
  assert.doesNotMatch(html,/みおり|ゆいの|そうた|大翔|山田|佐藤|鈴木|高橋/);
  assert.doesNotMatch(html,/prompt\('このゼミの「合言葉」/);
  assert.match(html,/if\(!ME&&old&&old\.me\)return/);
  assert.match(html,/samesite=strict;secure/);
  assert.doesNotMatch(html,/\.unregister\(/);
  assert.match(sw,/zemi-calendar-v/);
  assert.match(gas,/GEMINI_DATA_MODE/);
  assert.match(gas,/!==['"]paid['"]/);
  assert.match(privacy,/利用目的/);
  assert.match(privacy,/外部送信/);
  assert.match(privacy,/保存、訂正、削除、問い合わせ/);
});

test('display names never become a second login identity',()=>{
  const html=fs.readFileSync(path.resolve(__dirname,'..','index.html'),'utf8');
  assert.match(html,/function canonicalIdentityName\(/);
  assert.match(html,/function selectableMembers\(/);
  assert.match(html,/const chosen=canonicalIdentityName\(/);
  assert.match(html,/canonicalMe!==ME/);
  assert.match(html,/canonicalIdentityName\(k\)===canonical/);
  const gas=fs.readFileSync(path.resolve(__dirname,'..','gas','AIBackend.gs'),'utf8');
  assert.match(gas,/canonicalIdentityV57_/);
});

test('free Gemini operation stays local and is disclosed',()=>{
  const root=path.resolve(__dirname,'..');
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const gas=fs.readFileSync(path.join(root,'gas','AIBackend.gs'),'utf8');
  const privacy=fs.readFileSync(path.join(root,'privacy.html'),'utf8');
  assert.match(gas,/if\(!aiExternalAllowedV58_\(\)\)/);
  assert.match(gas,/aiLocalFallbackV58_/);
  assert.match(html,/無料枠では外部AIへ予定を送りません/);
  assert.match(privacy,/無料枠運用ではGoogle Gemini APIへ予定・質問を送信せず/);
});
