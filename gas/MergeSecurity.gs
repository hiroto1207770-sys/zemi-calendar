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
  var me=String(ctx.me||'');
  if(!me)throw new Error('本人確認が必要です');
  var currentProjects=indexByIdV54_(state.projects||[]),currentItems=indexByIdV54_(state.items||[]);
  var projects=(changed.projects||[]).map(function(p){
    if(!ctx.isAdmin)throw new Error('プロジェクト構成は管理者だけが変更できます');
    return p;
  });
  var items=(changed.items||[]).map(function(incoming){
    if(!incoming||!incoming.id)throw new Error('不正なデータです');
    var old=currentItems[incoming.id];
    if(!old){
      var created=JSON.parse(JSON.stringify(incoming));
      created.createdBy=me;created.updatedAt=Date.now();return created;
    }
    if(ctx.isAdmin||old.createdBy===me)return incoming;
    return secureMemberDeltaV54_(old,incoming,me,state.members||[],state.projects||[]);
  });
  return {projects:projects,items:items};
}

function secureMemberDeltaV54_(old,incoming,me,members,projects){
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

function indexByIdV54_(rows){var out={};(rows||[]).forEach(function(x){if(x&&x.id)out[x.id]=x;});return out;}
