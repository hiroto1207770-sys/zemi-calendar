const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');

function makeContext(){
  const store={claims:{A:['phone','pc'],B:['tablet']}};
  let uuidN=0;
  const ctx={
    metaGet_:(key,fallback)=>key in store?JSON.parse(JSON.stringify(store[key])):fallback,
    metaSet_:(key,value)=>{store[key]=JSON.parse(JSON.stringify(value));},
    canonicalIdentityV57_:value=>String(value||'').trim(),
    identityClaimDevsV57_:(name,claims)=>Array.isArray(claims[name])?claims[name]:[],
    Utilities:{
      DigestAlgorithm:{SHA_256:'sha256'},
      Charset:{UTF_8:'utf8'},
      computeDigest:(_alg,value)=>Array.from(crypto.createHash('sha256').update(String(value),'utf8').digest()).map(x=>x>127?x-256:x),
      getUuid:()=>`00000000-0000-4000-8000-${String(++uuidN).padStart(12,'0')}`
    }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname,'..','gas','DeviceTokenAuth.gs'),'utf8'),ctx);
  return {ctx,store};
}

test('a sync token is scoped to one claimed name and device',()=>{
  const {ctx}=makeContext();
  const token=ctx.syncTokenIssueV65_('A','pc');
  assert.ok(token.length>=32);
  assert.equal(ctx.syncTokenValidV65_({parameter:{me:'A',dev:'pc',syncToken:token}},null),true);
  assert.equal(ctx.syncTokenValidV65_({parameter:{me:'A',dev:'phone',syncToken:token}},null),false);
  assert.equal(ctx.syncTokenValidV65_({parameter:{me:'B',dev:'tablet',syncToken:token}},null),false);
  assert.equal(ctx.syncTokenValidV65_(null,{me:'A',dev:'pc',syncToken:'wrong'}),false);
});

test('removing a claim or revoking an identity invalidates its tokens only',()=>{
  const {ctx,store}=makeContext();
  const a=ctx.syncTokenIssueV65_('A','pc');
  const b=ctx.syncTokenIssueV65_('B','tablet');
  store.claims.A=['phone'];
  assert.equal(ctx.syncTokenValidV65_(null,{me:'A',dev:'pc',syncToken:a}),false);
  assert.equal(ctx.syncTokenValidV65_(null,{me:'B',dev:'tablet',syncToken:b}),true);
  assert.equal(ctx.syncTokenRevokeIdentityV65_('B'),true);
  assert.equal(ctx.syncTokenValidV65_(null,{me:'B',dev:'tablet',syncToken:b}),false);
});

test('only token digests are stored server-side',()=>{
  const {ctx,store}=makeContext();
  const token=ctx.syncTokenIssueV65_('A','pc');
  assert.notEqual(store.syncTokensV65.A.pc,token);
  assert.match(store.syncTokensV65.A.pc,/^[0-9a-f]{64}$/);
});
