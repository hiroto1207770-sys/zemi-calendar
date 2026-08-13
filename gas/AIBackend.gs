/**
 * Zemi Calendar v51 AI gateway.
 * Add dispatchAiV50_(body) near the start of the existing doPost dispatcher and
 * return its non-null result. Existing storage stays authoritative.
 */
var AI_V50_ACTIONS_={create:1,update:1,delete:1,complete:1,search:1,summarize:1,notify:1};
var AI_V50_MODEL_='gemini-3.5-flash-lite';

function dispatchAiV50_(b){
  if(!b||['aiPlan','aiExecute','aiSessionEnd','aiAuditSearch'].indexOf(b.action)<0)return null;
  var ctx=aiAuthV50_(b);
  if(b.action==='aiPlan')return aiPlanV50_(b,ctx);
  if(b.action==='aiExecute')return aiExecuteV50_(b,ctx);
  if(b.action==='aiSessionEnd'){aiAuditV50_(ctx,b,'session_end',b.reason||'closed',[],[]);return {ok:true};}
  if(!ctx.isAdmin)throw new Error('管理者権限が必要です');
  return {rows:aiAuditSearchV50_(b)};
}

function aiAuthV50_(b){
  var state=aiLoadStateV50_(), me=String(b.me||''),dev=String(b.dev||'');
  if(!me||!dev)throw new Error('本人確認が必要です');
  var claims=(state.claims||{})[me],list=Array.isArray(claims)?claims:(claims?[claims]:[]);
  if(list.indexOf(dev)<0)throw new Error('この端末は選択されたユーザーとして確認されていません');
  return {state:state,me:me,devHash:aiHashV50_(dev),isAdmin:aiIsAdminV50_(me,b),sessionId:String(b.sessionId||'').slice(0,100)};
}

function aiPlanV50_(b,ctx){
  var q=String(b.q||'').trim(); if(!q)throw new Error('質問が空です');
  var safe=aiVisibleV50_(ctx.state,ctx.me), local=aiLocalAnswerV50_(q,safe,ctx.me,ctx.state.members||[]);
  aiAuditV50_(ctx,b,'question',q,[],[]);
  if(local){var lp={version:1,reply:local,needsClarification:false,candidates:[],operations:[]};aiAuditV50_(ctx,b,'response',local,[],[]);return {plan:lp,local:true};}
  var members=aiVisibleMembersV50_(ctx.state,ctx.me,safe), names=aiResolveNamesV50_(q,members);
  if(names.ambiguous.length){
    var reply='名前を特定できません。候補から選んでください: '+names.ambiguous.map(function(x){return x.input+' → '+x.candidates.join(' / ');}).join('、');
    var ap={version:1,reply:reply,needsClarification:true,candidates:names.ambiguous,operations:[]};
    aiAuditV50_(ctx,b,'clarification',reply,[],[]);return {plan:ap,local:true};
  }
  var prompt=aiPromptV50_(q,safe,members,b.history||[],ctx.me,ctx.state.members||[]),plan=aiGeminiV50_(prompt);
  plan=aiValidatePlanV50_(plan,safe,members);
  aiAuditV50_(ctx,b,'proposal',plan.reply,plan.operations,[]);return {plan:plan,local:false};
}

function aiExecuteV50_(b,ctx){
  var ops=aiValidatePlanV50_({version:1,reply:'',operations:b.operations||[]},aiVisibleV50_(ctx.state,ctx.me),aiVisibleMembersV50_(ctx.state,ctx.me,aiVisibleV50_(ctx.state,ctx.me))).operations;
  var lock=LockService.getScriptLock(); if(!lock.tryLock(10000))throw new Error('サーバーが混み合っています');
  var results=[];
  try{
    var state=aiLoadStateV50_();
    ops.forEach(function(op){
      try{results.push(aiApplyOneV50_(state,ctx,op));}catch(e){results.push({ok:false,targetId:op.targetId||'',reason:String(e.message||e)});}
    });
    aiSaveStateV50_(state);
  }finally{lock.releaseLock();}
  var verified=aiLoadStateV50_();
  results.forEach(function(r){if(r.ok&&r.targetId)r.verified=!!(verified.items||[]).some(function(i){return i.id===r.targetId;});});
  aiAuditV50_(ctx,b,'execution','',ops,results);return {results:results};
}

function aiApplyOneV50_(state,ctx,op){
  var items=state.items||[],projects=state.projects||[],item=op.targetId&&items.filter(function(i){return i.id===op.targetId;})[0];
  if(op.action!=='create'){
    if(!item||!aiCanSeeV50_(item,ctx.me,projects))throw new Error('対象が存在しないか閲覧権限がありません');
  }
  if(item&&['update','delete','notify'].indexOf(op.action)>=0&&!aiCanMutateV54_(item,ctx))throw new Error('作成者または管理者だけが変更できます');
  if(op.action==='create'){
    var p=op.projectId&&projects.filter(function(x){return x.id===op.projectId&&!x.deleted;})[0];
    if(op.projectId&&!p)throw new Error('プロジェクトが存在しません');
    if(op.team){var tm=p&&(p.teams||[]).filter(function(t){return t.name===op.team;})[0];if(!tm||((tm.members||[]).indexOf(ctx.me)<0))throw new Error('共有先チームを利用する権限がありません');}
    var dup=items.some(function(i){return !i.deleted&&i.type===(op.type||'event')&&i.title===op.title&&i.date===op.date&&(i.time||'')===(op.time||'');});
    if(dup)throw new Error('重複する予定があります');
    var itemType=op.type||'event',id='i'+Date.now()+Math.floor(Math.random()*1000),n={id:id,type:itemType,title:op.title,date:op.date,endDate:op.endDate||'',time:op.time||'',endTime:op.endTime||'',pj:op.projectId||'',other:'',team:op.team||'',teamPj:op.team?op.projectId:'',who:op.who||[],visibility:op.visibility||'all',note:op.note||'',tentative:!!op.tentative,remind:op.remind||'',completionMode:itemType==='task'?'individual':'shared',doneBy:{},done:false,doneAt:0,deleted:false,createdBy:ctx.me,updatedAt:Date.now(),rep:'none',days:[],until:'',comments:[],skip:[],notes:{}};
    items.push(n);state.items=items;return {ok:true,targetId:id};
  }
  if(op.action==='delete')item.deleted=true;
  else if(op.action==='complete'){if(item.type!=='task')throw new Error('予定は完了にできません');if(!aiSetTaskDoneV51_(item,ctx.me,true,state.members||[],projects,Date.now()))throw new Error('このやることの担当者ではありません');}
  else if(op.action==='update'){
    ['title','date','endDate','time','endTime','note','remind'].forEach(function(k){if(op[k]!==''&&op[k]!=null)item[k]=op[k];});
  }else if(op.action==='notify'){item.remind=op.remind||item.remind||'0';}
  else throw new Error('この操作は実行対象ではありません');
  item.updatedAt=Date.now();return {ok:true,targetId:item.id};
}

function aiCanMutateV54_(item,ctx){return !!(ctx&&item&&(ctx.isAdmin||item.createdBy===ctx.me));}

function aiCanSeeV50_(i,me,projects){
  if(!i||i.deleted)return false;
  if(i.visibility==='members')return (i.who||[]).indexOf(me)>=0||i.createdBy===me;
  if(i.team){var p=(projects||[]).filter(function(x){return x.id===(i.teamPj||i.pj);})[0],tm=p&&(p.teams||[]).filter(function(t){return t.name===i.team;})[0];return !!tm&&((tm.members||[]).indexOf(me)>=0||(i.who||[]).indexOf(me)>=0||i.createdBy===me);}
  return true;
}
function aiTaskTargetsV51_(i,members,projects){
  var out=[],seen={};function add(n){n=String(n||'');if(n&&!seen[n]){seen[n]=1;out.push(n);}}
  if((i.who||[]).length){(i.who||[]).forEach(add);return out;}
  if(i.team){var p=(projects||[]).filter(function(x){return x.id===(i.teamPj||i.pj);})[0],tm=p&&(p.teams||[]).filter(function(t){return t.name===i.team;})[0];
    if(tm){(tm.members||[]).forEach(add);return out;}if(p&&p.name===i.team){(p.members||[]).forEach(add);return out;}}
  (members||[]).forEach(function(m){add(typeof m==='string'?m:m.name);});return out;
}
function aiTaskDoneForV51_(i,me,members,projects){
  if(i.completionMode!=='individual')return !!i.done;
  if(aiTaskTargetsV51_(i,members,projects).indexOf(me)<0)return false;
  var r=(i.doneBy||{})[me];return !!(r&&typeof r==='object'?r.done:r);
}
function aiSetTaskDoneV51_(i,me,value,members,projects,ts){
  if(i.completionMode!=='individual'){i.done=!!value;i.doneAt=i.done?ts:0;return true;}
  var targets=aiTaskTargetsV51_(i,members,projects);if(targets.indexOf(me)<0)return false;
  i.doneBy=i.doneBy&&typeof i.doneBy==='object'?i.doneBy:{};i.doneBy[me]={done:!!value,at:ts};
  i.done=targets.length>0&&targets.every(function(n){var r=i.doneBy[n];return !!(r&&typeof r==='object'?r.done:r);});
  i.doneAt=i.done?ts:0;return true;
}
function aiVisibleV50_(s,me){var ps=(s.projects||[]).filter(function(p){return !p.deleted;}),is=(s.items||[]).filter(function(i){return aiCanSeeV50_(i,me,ps);});var ids={};is.forEach(function(i){if(i.pj)ids[i.pj]=1;});return {projects:ps.filter(function(p){return ids[p.id]||!(p.members||[]).length||(p.members||[]).indexOf(me)>=0;}),items:is};}
function aiVisibleMembersV50_(s,me,safe){var allowed={};allowed[me]=1;(safe.items||[]).forEach(function(i){(i.who||[]).forEach(function(n){allowed[n]=1;});});(safe.projects||[]).forEach(function(p){(p.teams||[]).forEach(function(t){if((t.members||[]).indexOf(me)>=0)(t.members||[]).forEach(function(n){allowed[n]=1;});});});return (s.members||[]).filter(function(m){return allowed[m.name];});}
function aiResolveNamesV50_(q,members){
  // 質問文の一般語を人名候補として拾わない。登録済みの氏名・表示名・別名そのものが
  // 文中に現れ、かつ同じ呼び名が複数人に対応するときだけ確認を返す。
  var nq=aiNormV50_(q),byTerm={},amb=[];
  (members||[]).forEach(function(m){aiMemberTermsV50_(m).forEach(function(raw){var t=aiNormV50_(raw);if(t.length<2)return;(byTerm[t]=byTerm[t]||[]).push(m.name);});});
  Object.keys(byTerm).forEach(function(t){var names=byTerm[t].filter(function(n,i,a){return a.indexOf(n)===i;});if(names.length>1&&nq.indexOf(t)>=0)amb.push({input:t,candidates:names});});
  return {ambiguous:amb};
}
function aiMemberTermsV50_(m){return [m.name,m.displayName,m.display,m.realName,m.kana,m.hiragana,m.nickname,m.nick].concat(m.aliases||[]).filter(String);}
function aiNormV50_(v){return String(v||'').toLowerCase().replace(/[\s　・･._\-]/g,'');}

function aiLocalAnswerV50_(q,s,me,allMembers){var today=Utilities.formatDate(new Date(),Session.getScriptTimeZone()||'Asia/Tokyo','yyyy-MM-dd');if(/(件数|いくつ|進捗|遅れ|期限超過)/.test(q)){var open=s.items.filter(function(i){return i.type==='task'&&!aiTaskDoneForV51_(i,me,allMembers,s.projects);}),late=open.filter(function(i){return i.date&&i.date<today;});return '閲覧できる範囲では、あなたの未完了タスクは'+open.length+'件、期限超過は'+late.length+'件です。';}return '';}
function aiPromptV50_(q,s,members,history,me,allMembers){var compact={today:Utilities.formatDate(new Date(),Session.getScriptTimeZone()||'Asia/Tokyo','yyyy-MM-dd'),projects:s.projects.map(function(p){return {id:p.id,name:p.name,teams:(p.teams||[]).map(function(t){return t.name;})};}),items:s.items.slice(0,300).map(function(i){return {id:i.id,type:i.type,title:i.title,date:i.date,time:i.time,endTime:i.endTime,pj:i.pj,team:i.team,who:i.who,done:i.type==='task'?aiTaskDoneForV51_(i,me,allMembers,s.projects):i.done,completionMode:i.completionMode||'shared',note:i.note,tentative:i.tentative};}),members:members.map(function(m){return {name:m.name,terms:aiMemberTermsV50_(m)};})};return '水野ゼミの一般ユーザー向けアシスタント。管理者操作、任意コード、未提示データを要求・推測しない。タスクのdoneは現在の利用者本人の完了状態。complete操作は各自方式なら本人だけを完了する。曖昧な名前はneedsClarification=trueで候補提示し操作を空にする。複数予定は1回で全件抽出する。質問:'+q+'\n短期履歴:'+JSON.stringify((history||[]).slice(-8))+'\n許可済みデータ:'+JSON.stringify(compact);}
function aiGeminiV50_(prompt){var key=PropertiesService.getScriptProperties().getProperty('GEMINI_KEY');if(!key)throw new Error('AIキーが未設定です');var model=PropertiesService.getScriptProperties().getProperty('GEMINI_MODEL')||AI_V50_MODEL_;var url='https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)+':generateContent?key='+encodeURIComponent(key);var schema={type:'OBJECT',required:['version','reply','needsClarification','candidates','operations'],properties:{version:{type:'INTEGER'},reply:{type:'STRING'},needsClarification:{type:'BOOLEAN'},candidates:{type:'ARRAY',items:{type:'OBJECT'}},operations:{type:'ARRAY',items:{type:'OBJECT',required:['action'],properties:{action:{type:'STRING'},targetId:{type:'STRING'},type:{type:'STRING'},title:{type:'STRING'},date:{type:'STRING'},endDate:{type:'STRING'},time:{type:'STRING'},endTime:{type:'STRING'},projectId:{type:'STRING'},team:{type:'STRING'},who:{type:'ARRAY',items:{type:'STRING'}},visibility:{type:'STRING'},note:{type:'STRING'},tentative:{type:'BOOLEAN'},remind:{type:'STRING'}}}}}};var res=UrlFetchApp.fetch(url,{method:'post',contentType:'application/json',muteHttpExceptions:true,payload:JSON.stringify({contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{temperature:0.1,responseMimeType:'application/json',responseJsonSchema:schema}})});if(res.getResponseCode()!==200)throw new Error('Gemini HTTP '+res.getResponseCode());return JSON.parse(JSON.parse(res.getContentText()).candidates[0].content.parts[0].text);}
function aiValidatePlanV50_(p,s,members){if(!p||p.version!==1)throw new Error('AI出力スキーマが不正です');var allowed={version:1,reply:1,needsClarification:1,candidates:1,operations:1};Object.keys(p).forEach(function(k){if(!allowed[k])throw new Error('未許可フィールドです');});p.operations=(p.operations||[]).slice(0,100).map(function(o){if(!AI_V50_ACTIONS_[o.action])throw new Error('未許可操作です');if(['update','delete','complete','notify'].indexOf(o.action)>=0&&!o.targetId)throw new Error('対象IDがありません');if(o.targetId&&!s.items.some(function(i){return i.id===o.targetId;}))throw new Error('対象への閲覧権限がありません');return o;});return {version:1,reply:String(p.reply||'').slice(0,2000),needsClarification:!!p.needsClarification,candidates:(p.candidates||[]).slice(0,20),operations:p.needsClarification?[]:p.operations};}

function aiAuditV50_(ctx,b,kind,message,ops,results){var ss=SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID')),sh=ss.getSheetByName('_AI監査')||ss.insertSheet('_AI監査');if(sh.getLastRow()===0)sh.appendRow(['日時','セッション','種別','ユーザー','端末ハッシュ','質問/応答','提案','結果','対象ID']);sh.appendRow([new Date(),ctx.sessionId,kind,ctx.me,ctx.devHash,String(message||'').slice(0,5000),JSON.stringify(ops||[]).slice(0,20000),JSON.stringify(results||[]).slice(0,20000),(ops||[]).map(function(o){return o.targetId||'';}).filter(String).join(',')]);sh.hideSheet();}
function aiAuditSearchV50_(b){var ss=SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID')),sh=ss.getSheetByName('_AI監査');if(!sh)return [];var v=sh.getDataRange().getValues(),q=String(b.query||'').toLowerCase();return v.slice(1).filter(function(r){return !q||r.join(' ').toLowerCase().indexOf(q)>=0;}).slice(-Math.min(Number(b.limit)||50,100));}
function aiHashV50_(v){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(v)).map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');}
function aiIsAdminV50_(me,b){return !!b.admin&&typeof checkAdminRequest_==='function'&&checkAdminRequest_(b)&&me===(PropertiesService.getScriptProperties().getProperty('ADMIN_NAME')||me);}

// Adapter names deliberately avoid exposing spreadsheet contents to the client.
function aiLoadStateV50_(){if(typeof loadState_==='function')return loadState_();if(typeof loadData_==='function')return loadData_();throw new Error('既存GASの読み込み関数を aiLoadStateV50_ に接続してください');}
function aiSaveStateV50_(s){if(typeof saveState_==='function')return saveState_(s);if(typeof saveData_==='function')return saveData_(s);throw new Error('既存GASの保存関数を aiSaveStateV50_ に接続してください');}
