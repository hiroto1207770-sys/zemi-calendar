/**
 * Zemi Calendar v54 merge authorization.
 *
 * In the production doPost merge route, call:
 *   body.changed = secureChangedV54_(body.changed, state, {
 *     me: verifiedName,
 *     isAdmin: verifiedAdmin
 *   });
 * only AFTER the name/device/PIN claim and admin secret have been verified,
 * and BEFORE applying the normal LWW merge.
 */
function secureChangedV54_(changed,state,ctx){
  changed=changed||{};state=state||{};ctx=ctx||{};
  var rawSize=JSON.stringify(changed).length;
  if(rawSize>500000)throw new Error('送信データが大きすぎます');
  var me=String(ctx.me||'');
  if(!me)throw new Error('本人確認が必要です');
  var currentProjects=indexByIdV54_(state.projects||[]),currentItems=indexByIdV54_(state.items||[]);
  var projectRows=Array.isArray(changed.projects)?changed.projects:[],itemRows=Array.isArray(changed.items)?changed.items:[];
  if(projectRows.length>100||itemRows.length>500)throw new Error('一度に送信できる件数を超えています');
  var projects=projectRows.map(function(p){
    if(!ctx.isAdmin)throw new Error('プロジェクト構成は管理者だけが変更できます');
    assertSafeIdV54_(p&&p.id);
    return p;
  });
  var items=itemRows.map(function(incoming){
    if(!incoming||!incoming.id)throw new Error('不正なデータです');
    assertSafeIdV54_(incoming.id);
    var old=currentItems[incoming.id];
    if(!old){
      var created=JSON.parse(JSON.stringify(incoming));
      created.createdBy=me;
      if(!canSeeItemV54_(created,me,state.projects||[]))throw new Error('指定した公開範囲または班に登録されていません');
      created.updatedAt=Date.now();return created;
    }
    if(ctx.isAdmin||old.createdBy===me)return incoming;
    return secureMemberDeltaV54_(old,incoming,me,state.members||[],state.projects||[]);
  });
  return {projects:projects,items:items};
}

function secureMemberDeltaV54_(old,incoming,me,members,projects){
  if(!canSeeItemV54_(old,me,projects))throw new Error('この項目を閲覧する権限がありません');
  var out=JSON.parse(JSON.stringify(old)),changed=false,ts=Date.now();
  // 担当タスクの本人分の完了状態だけを受け付ける。
  if(old.type==='task'&&old.completionMode==='individual'){
    var targets=typeof aiTaskTargetsV51_==='function'?aiTaskTargetsV51_(old,members,projects):[];
    if(targets.indexOf(me)>=0){
      var next=((incoming.doneBy||{})[me]||{}),prev=((old.doneBy||{})[me]||{});
      var nextDone=!!(typeof next==='object'?next.done:next),prevDone=!!(typeof prev==='object'?prev.done:prev);
      if(nextDone!==prevDone){
        out.doneBy=out.doneBy&&typeof out.doneBy==='object'?out.doneBy:{};
        out.doneBy[me]={done:nextDone,at:ts};changed=true;
      }
    }
  }
  // 閲覧できる項目への新しいコメント1件だけを追記できる。既存コメントの変更・削除は拒否。
  var before=Array.isArray(old.comments)?old.comments:[],after=Array.isArray(incoming.comments)?incoming.comments:[];
  if(after.length===before.length+1){
    var c=after[after.length-1]||{},txt=String(c.text||'').trim();
    if(txt){out.comments=before.concat([{by:me,text:txt.slice(0,1000),at:Utilities.formatDate(new Date(),Session.getScriptTimeZone()||'Asia/Tokyo','M/d HH:mm'),d:String(c.d||'').slice(0,10)}]);changed=true;}
  }
  if(!changed)throw new Error('この項目を変更する権限がありません');
  if(typeof aiTaskTargetsV51_==='function'&&out.type==='task'&&out.completionMode==='individual'){
    var all=aiTaskTargetsV51_(out,members,projects);
    out.done=all.length>0&&all.every(function(n){var r=(out.doneBy||{})[n];return !!(r&&typeof r==='object'?r.done:r);});
    out.doneAt=out.done?ts:0;
  }
  out.updatedAt=ts;return out;
}

function assertSafeIdV54_(id){id=String(id||'');if(!id||id.length>100||id==='__proto__'||id==='prototype'||id==='constructor')throw new Error('不正なIDです');}
function canSeeItemV54_(i,me,projects){
  if(!i||i.deleted)return false;
  if(i.visibility==='members'&&Array.isArray(i.who)&&i.who.indexOf(me)<0&&i.createdBy!==me)return false;
  if(i.team){var p=(projects||[]).filter(function(x){return x&&x.id===i.pj;})[0],t=p&&(p.teams||[]).filter(function(x){return x&&x.name===i.team;})[0];if(!t||(t.members||[]).indexOf(me)<0)return false;}
  return true;
}
function indexByIdV54_(rows){var out=Object.create(null);(rows||[]).forEach(function(x){if(x&&x.id){assertSafeIdV54_(x.id);out[x.id]=x;}});return out;}
