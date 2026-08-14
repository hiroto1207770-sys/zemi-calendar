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
  const restricted=base();restricted.projects=[{id:'p1',teams:[{name:'班1',members:['A']}]}];
  assert.throws(()=>ctx.secureChangedV54_({items:[{id:'new2',type:'event',pj:'p1',team:'班1'}]},restricted,{me:'B',isAdmin:false}),/登録/);
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

test('hidden items, unsafe ids, and oversized batches are rejected',()=>{
  const hidden=base();hidden.items[0].visibility='members';hidden.items[0].who=['A'];
  const incoming={...hidden.items[0],comments:[{text:'probe'}]};
  assert.throws(()=>ctx.secureChangedV54_({items:[incoming]},hidden,{me:'B',isAdmin:false}),/閲覧/);
  assert.throws(()=>ctx.secureChangedV54_({items:[{id:'__proto__'}]},base(),{me:'B',isAdmin:false}),/ID/);
  assert.throws(()=>ctx.secureChangedV54_({items:Array.from({length:501},(_,i)=>({id:'x'+i}))},base(),{me:'B',isAdmin:false}),/件数/);
});

test('AI asks for a name only when a registered alias is genuinely ambiguous',()=>{
  const ai={};vm.createContext(ai);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname,'..','gas','AIBackend.gs'),'utf8'),ai);
  const members=[
    {name:'テスト花子',displayName:'はな',aliases:['はな']},
    {name:'例示華',displayName:'はな',aliases:['はな']}
  ];
  assert.equal(ai.aiResolveNamesV50_('今日の予定を教えて',members).ambiguous.length,0);
  assert.equal(ai.aiResolveNamesV50_('はなの予定を教えて',members).ambiguous.length,1);
});
