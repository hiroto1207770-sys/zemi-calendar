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
    const s=visibleSnapshot(db,user), open=s.items.filter(i=>i.type==='task'&&!i.done), overdue=open.filter(i=>i.date&&i.date<today);
    return {projectCount:s.projects.length,itemCount:s.items.length,openTaskCount:open.length,overdueCount:overdue.length};
  }
  return {ACTIONS,normalize:norm,memberTerms,resolveName,canSeeItem,visibleSnapshot,validatePlan,duplicates,localSummary};
});
