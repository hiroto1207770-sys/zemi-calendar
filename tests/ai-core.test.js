const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const AI=require('../ai-core.js');

test('aliases resolve but ambiguous initials do not auto-resolve',()=>{
  const ms=[{name:'椙山真衣',displayName:'まい',kana:'すぎやままい',aliases:['M']},{name:'山田芽衣',displayName:'めい',kana:'やまだめい',aliases:['M']}];
  assert.equal(AI.resolveName('まい',ms).member.name,'椙山真衣');
  assert.equal(AI.resolveName('M',ms).status,'ambiguous');
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
test('existing personal assignment migration keeps only the confirmed member complete',()=>{
  const task={id:'i1',type:'task',done:true,doneAt:90,updatedAt:90};
  assert.equal(AI.migrateTaskCompletion(task,['村山美織梨'],'v51-personal-photo',100),true);
  assert.equal(task.completionMode,'individual');
  assert.deepEqual(task.doneBy,{'村山美織梨':{done:true,at:100}});
  assert.equal(task.done,false);
  assert.equal(AI.migrateTaskCompletion(task,['別の人'],'v51-personal-photo',200),false);
  assert.deepEqual(Object.keys(task.doneBy),['村山美織梨']);
});
test('app version is initialized before startup and matches the service worker',()=>{
  const root=path.resolve(__dirname,'..');
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
  const manifest=fs.readFileSync(path.join(root,'manifest.json'),'utf8');
  const appVersion=(html.match(/window\.__ZEMI_APP_V__='(\d+)'/)||[])[1];
  const workerVersion=(sw.match(/const V = 'zemi-v(\d+)'/)||[])[1];
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
  assert.match(html,/filter\(x=>x\.startsWith\('zemi-v'\)\)/);
  assert.match(html,/updateViaCache:'none'/);
  assert.match(sw,/ai-core\.js\?v=53/);
  assert.match(sw,/caches\.match\(e\.request, \{ ignoreSearch: true \}\)/);
  assert.doesNotMatch(sw,/catch\(\(\) => caches\.match\('\.\/index\.html'\)\)/);
  assert.match(html,/DB=\{projects:\[\],items:\[\]\}/);
});
