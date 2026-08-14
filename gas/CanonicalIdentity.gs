/**
 * Display names are labels only. Every authenticated operation must use the
 * canonical roster name so an old nickname row cannot become a second user.
 */
function identityKeyV57_(v){return String(v||'').replace(/^\s+|\s+$/g,'').toLowerCase();}

function canonicalIdentityV57_(value){
  var raw=String(value||'').trim(),key=identityKeyV57_(raw);
  if(!key)return '';
  var display=metaGet_('display',{})||{},members=metaGet_('members',[])||[],owners=[];
  members.forEach(function(m){
    var name=String((m&&m.name)||'');
    if(identityKeyV57_(name)!==key&&identityKeyV57_(display[name])===key)owners.push(name);
  });
  return owners.length===1?owners[0]:raw;
}

function identityClaimDevsV57_(name,claims){
  var canonical=canonicalIdentityV57_(name),out=[];
  Object.keys(claims||{}).forEach(function(k){
    if(canonicalIdentityV57_(k)!==canonical)return;
    var v=claims[k],rows=Array.isArray(v)?v:(v?[v]:[]);
    rows.forEach(function(dev){if(out.indexOf(dev)<0)out.push(dev);});
  });
  return out;
}
