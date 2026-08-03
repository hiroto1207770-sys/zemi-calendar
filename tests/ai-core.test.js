const assert=require('node:assert/strict');
const test=require('node:test');
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
