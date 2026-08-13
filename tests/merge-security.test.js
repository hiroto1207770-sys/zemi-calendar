const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.resolve(__dirname,'..','gas','MergeSecurity.gs'),'utf8');
const ctx={
  Utilities:{formatDate:()=> '8/13 12:00'},
  Session:{getScriptTimeZone:()=> 'Asia/Tokyo'},
  aiTaskTargetsV51_:(i,members)=>i.who&&i.who.length?i.who:members.map(m=>m.name)
};
vm.createContext(ctx);vm.runInContext(source,ctx);

const base=()=>({members:[{name:'A'},{name:'B'}],projects:[],items:[
  {id:'i1',type:'event',title:'original',createdBy:'A',comments:[],updatedAt:1},
  {id:'i2',type:'task',title:'task',createdBy:'A',who:['B'],completionMode:'individual',doneBy:{},comments:[],done:false,updatedAt:1}
]});

test('project mutations require verified admin',()=>{
  assert.throws(()=>ctx.secureChangedV54_({projects:[{id:'p'}]},base(),{me:'B',isAdmin:false}),/管理者/);
});

test('new items are attributed to the verified caller',()=>{
  const out=ctx.secureChangedV54_({items:[{id:'new',type:'event',createdBy:'A'}]},base(),{me:'B',isAdmin:false});
  assert.equal(out.items[0].createdBy,'B');
});

test('non-owners cannot rewrite another creators item',()=>{
  const incoming={...base().items[0],title:'hacked'};
  assert.throws(()=>ctx.secureChangedV54_({items:[incoming]},base(),{me:'B',isAdmin:false}),/権限/);
});

test('assigned members can only change their own completion state',()=>{
  const incoming={...base().items[1],title:'hacked',doneBy:{B:{done:true,at:2}}};
  const out=ctx.secureChangedV54_({items:[incoming]},base(),{me:'B',isAdmin:false}).items[0];
  assert.equal(out.title,'task');
  assert.equal(out.doneBy.B.done,true);
});

test('members may append one attributed comment without rewriting the item',()=>{
  const incoming={...base().items[0],title:'hacked',comments:[{by:'A',text:'hello'}]};
  const out=ctx.secureChangedV54_({items:[incoming]},base(),{me:'B',isAdmin:false}).items[0];
  assert.equal(out.title,'original');
  assert.equal(out.comments[0].by,'B');
  assert.equal(out.comments[0].text,'hello');
});

test('AI asks for a name only when a registered alias is genuinely ambiguous',()=>{
  const ai={};vm.createContext(ai);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname,'..','gas','AIBackend.gs'),'utf8'),ai);
  const members=[
    {name:'椙山真衣',displayName:'まい',aliases:['まい']},
    {name:'山田芽衣',displayName:'めい',aliases:['まい']}
  ];
  assert.equal(ai.aiResolveNamesV50_('今日の予定を教えて',members).ambiguous.length,0);
  assert.equal(ai.aiResolveNamesV50_('まいの予定を教えて',members).ambiguous.length,1);
});
