(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.ZemiAI=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const ACTIONS=new Set(['create','update','delete','complete','search','summarize','notify']);
  const TYPES=new Set(['event','task']);
  const text=v=>String(v==null?'':v).normalize('NFKC').trim();
  const norm=v=>text(v).toLocaleLowerCase('ja').replace(/[\s　・･._\-]/g,'');
  const uniq=a=>[...new Set(a.filter(Boolean))];
  const memberName=m=>text(typeof m==='string'?m:m&&m.name);
  function taskTargets(i,members,projects){
    if(!i||i.type!=='task') return [];
    if(Array.isArray(i.who)&&i.who.length) return uniq(i.who.map(text));
    if(i.team){
      const p=(projects||[]).find(p=>p.id===(i.teamPj||i.pj));
      if(p&&String(p.name||'').normalize('NFKC').trim()==='ゼミ') return uniq((members||[]).map(memberName));
      const tm=p&&(p.teams||[]).find(t=>t.name===i.team);
      if(tm) return uniq((tm.members||[]).map(text));
      if(p&&p.name===i.team) return uniq((p.members||[]).map(text));
    }
    return uniq((members||[]).map(memberName));
  }
  function completionRecord(v){
    if(v&&typeof v==='object') return {done:!!v.done,at:Number(v.at)||0};
    if(typeof v==='number') return {done:v>0,at:Math.abs(v)};
    return {done:!!v,at:0};
  }
  function normalizeDoneBy(v){
    const out={};
    if(!v||typeof v!=='object'||Array.isArray(v)) return out;
    Object.keys(v).forEach(k=>{const n=text(k);if(n)out[n]=completionRecord(v[k]);});
    return out;
  }
  function isIndividualTask(i){return !!i&&i.type==='task'&&i.completionMode==='individual';}
  function isTaskDoneFor(i,user,members,projects){
    if(!i||i.type!=='task') return !!(i&&i.done);
    if(!isIndividualTask(i)) return !!i.done;
    const u=text(user); if(!u||!taskTargets(i,members,projects).includes(u)) return false;
    return completionRecord((i.doneBy||{})[u]).done;
  }
  function isTaskFullyDone(i,members,projects){
    if(!i||i.type!=='task') return !!(i&&i.done);
    if(!isIndividualTask(i)) return !!i.done;
    const targets=taskTargets(i,members,projects);
    return !!targets.length&&targets.every(u=>completionRecord((i.doneBy||{})[u]).done);
  }
  function taskProgress(i,members,projects){
    const targets=taskTargets(i,members,projects);
    if(!isIndividualTask(i)) return {done:i&&i.done?targets.length:0,total:targets.length,targets};
    return {done:targets.filter(u=>completionRecord((i.doneBy||{})[u]).done).length,total:targets.length,targets};
  }
  function setTaskDoneFor(i,user,value,members,projects,at){
    if(!i||i.type!=='task') return false;
    const stamp=Number(at)||Date.now();
    if(!isIndividualTask(i)){i.done=!!value;i.doneAt=i.done?stamp:0;return true;}
    const u=text(user),targets=taskTargets(i,members,projects);
    if(!u||!targets.includes(u)) return false;
    i.doneBy=normalizeDoneBy(i.doneBy);i.doneBy[u]={done:!!value,at:stamp};
    i.done=isTaskFullyDone(i,members,projects);
    i.doneAt=i.done?Math.max(...targets.map(n=>completionRecord(i.doneBy[n]).at)):0;
    return true;
  }
  function mergeDoneBy(a,b){
    const aa=normalizeDoneBy(a),bb=normalizeDoneBy(b),out={...aa};
    Object.keys(bb).forEach(k=>{if(!out[k]||completionRecord(bb[k]).at>=completionRecord(out[k]).at)out[k]=bb[k];});
    return out;
  }
  function migrateTaskCompletion(i,completedMembers,marker,at){
    if(!i||i.type!=='task'||!marker||i.completionMigration===marker) return false;
    const stamp=Number(at)||Date.now(),doneBy={};
    uniq((completedMembers||[]).map(text)).forEach(n=>{doneBy[n]={done:true,at:stamp};});
    i.completionMode='individual';i.doneBy=doneBy;i.done=false;i.doneAt=0;
    i.completionMigration=marker;i.updatedAt=Math.max(stamp,(Number(i.updatedAt)||0)+1);
    return true;
  }
  function memberTerms(m){
    return uniq([m.name,m.displayName,m.display,m.realName,m.kana,m.hiragana,m.nickname,m.nick,...(Array.isArray(m.aliases)?m.aliases:[])].map(text));
  }
  function resolveName(input,members){
    const q=norm(input); if(!q) return {status:'none',candidates:[]};
    const scored=(members||[]).map(m=>{
      const terms=memberTerms(m), ns=terms.map(norm); let score=0,why='';
      if(ns.includes(q)){score=100;why='exact';}
      else if(ns.some(x=>x.startsWith(q)||q.startsWith(x))){score=80;why='prefix';}
      else if(ns.some(x=>x.includes(q)||q.includes(x))){score=60;why='partial';}
      return {member:m,score,why,terms};
    }).filter(x=>x.score).sort((a,b)=>b.score-a.score||text(a.member.name).localeCompare(text(b.member.name),'ja'));
    if(!scored.length) return {status:'none',candidates:[]};
    const top=scored[0].score, candidates=scored.filter(x=>x.score===top);
    return candidates.length===1?{status:'resolved',member:candidates[0].member,match:candidates[0].why,candidates}
      :{status:'ambiguous',candidates};
  }
  function canSeeItem(i,user,projects){
    if(!i||i.deleted) return false;
    if(i.visibility==='members') return !!user&&((i.who||[]).includes(user)||i.createdBy===user);
    if(i.team){
      const p=(projects||[]).find(p=>p.id===(i.teamPj||i.pj));
      const tm=p&&(p.teams||[]).find(t=>t.name===i.team);
      return !!user&&(((tm&&tm.members)||[]).includes(user)||(i.who||[]).includes(user)||i.createdBy===user);
    }
    return true;
  }
  function visibleSnapshot(db,user){
    const projects=(db.projects||[]).filter(p=>!p.deleted);
    const items=(db.items||[]).filter(i=>canSeeItem(i,user,projects));
    const pids=new Set(items.map(i=>i.pj).filter(Boolean));
    return {projects:projects.filter(p=>pids.has(p.id)||!p.members||!p.members.length||p.members.includes(user)),items};
  }
  function validatePlan(raw){
    if(!raw||typeof raw!=='object'||Array.isArray(raw)) throw new Error('AI出力がJSONオブジェクトではありません');
    const allowed=new Set(['version','reply','needsClarification','candidates','operations']);
    Object.keys(raw).forEach(k=>{if(!allowed.has(k))throw new Error('未許可フィールド: '+k);});
    if(raw.version!==1) throw new Error('未対応スキーマ版');
    const ops=Array.isArray(raw.operations)?raw.operations:[];
    if(ops.length>100) throw new Error('操作件数が上限を超えています');
    return {version:1,reply:text(raw.reply).slice(0,2000),needsClarification:!!raw.needsClarification,
      candidates:Array.isArray(raw.candidates)?raw.candidates.slice(0,20):[],operations:ops.map((o,n)=>{
        if(!o||!ACTIONS.has(o.action)) throw new Error(`操作${n+1}のactionが不正です`);
        const x={action:o.action,targetId:text(o.targetId),type:text(o.type),title:text(o.title).slice(0,100),date:text(o.date),endDate:text(o.endDate),time:text(o.time),endTime:text(o.endTime),projectId:text(o.projectId),team:text(o.team),who:Array.isArray(o.who)?o.who.map(text):[],visibility:o.visibility==='members'?'members':'all',note:text(o.note).slice(0,2000),tentative:!!o.tentative,remind:text(o.remind)};
        if(x.type&&!TYPES.has(x.type)) throw new Error(`操作${n+1}のtypeが不正です`);
        if(x.date&&!/^\d{4}-\d{2}-\d{2}$/.test(x.date)) throw new Error(`操作${n+1}の日付が不正です`);
        if(x.time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(x.time)) throw new Error(`操作${n+1}の時刻が不正です`);
        if(['update','delete','complete','notify'].includes(x.action)&&!x.targetId) throw new Error(`操作${n+1}にtargetIdが必要です`);
        return x;
      })};
  }
  function duplicates(op,items){return (items||[]).filter(i=>!i.deleted&&i.type===(op.type||'event')&&norm(i.title)===norm(op.title)&&i.date===op.date&&(i.time||'')===(op.time||''));}
  function localSummary(db,user,today){
    const s=visibleSnapshot(db,user),members=db.members||[],projects=db.projects||[];
    const open=s.items.filter(i=>i.type==='task'&&!isTaskDoneFor(i,user,members,projects)), overdue=open.filter(i=>i.date&&i.date<today);
    return {projectCount:s.projects.length,itemCount:s.items.length,openTaskCount:open.length,overdueCount:overdue.length};
  }
  return {ACTIONS,normalize:norm,memberTerms,resolveName,canSeeItem,visibleSnapshot,validatePlan,duplicates,localSummary,
    taskTargets,normalizeDoneBy,isIndividualTask,isTaskDoneFor,isTaskFullyDone,taskProgress,setTaskDoneFor,mergeDoneBy,migrateTaskCompletion};
});
