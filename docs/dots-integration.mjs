// Example for a host that provides plugin calls. Never pass X credentials to Dots.
// This helper has no dependency on Source Watch's implementation.
// Pass the six-tool result, or the platform Plugin envelope; no X credentials.
export async function optionalXScout({sourceCandidates,entities=[],knownSourceUrls=[],callTool,timeoutMs=65000}){
 const invoke=async(name,args)=>scoutResult(await callTool(name,args));
 const safeSource=[...sourceCandidates],results=[];let timer,stopped=false,discovery='not_attempted';
 const finish=(status)=>{
  const posts=[...new Map(results.flatMap(r=>r.posts??[]).map(p=>[p.id,p])).values()];
  const map=new Map(results.flatMap(r=>r.candidates??[]).map(c=>[c.id,c]));
  // Only completed watchlist slices count. Never treat a hit as an independent X search.
  const terms=[...new Set(entities.filter(e=>typeof e==='string').map(e=>e.trim()).filter(Boolean))].slice(0,8);
  const fold=v=>String(v).normalize('NFKC').toLowerCase();
  const captured=new Map(results.filter(r=>r.tool==='scan_watchlist').flatMap(r=>r.posts??[]).map(p=>[p.id,p]));
  const hits=[];for(const p of captured.values()){
   const hay=fold([p.text,...(p.links??[])].join(' '));
   const matched=terms.filter(t=>hay.includes(fold(t)));if(matched.length)hits.push({post_id:p.id,url:p.url,entities:matched});
  }
  return {sourceCandidates:safeSource,xCandidates:[...map.values()],posts,xStatus:status,xDiscoveryStatus:discovery,
   watchlistKeywordMatches:{scope:'captured_watchlist_posts_only',posts_checked:captured.size,hits},next:'Gap Check → Verify/Rank',articleQuota:null};
 };
 const work=(async()=>{
  const health=await invoke('health_check',{});
  if(['auth_required','backend_error','config_error'].includes(health.status))return finish(health.status);
  if(health.health?.free_discovery_state==='FREE_BACKEND_BLOCKED')discovery='FREE_BACKEND_BLOCKED';
  let offset=0;
  for(let slice=0;slice<3&&!stopped;slice++){
   const r=await invoke('scan_watchlist',{offset,account_limit:4,per_user_limit:15});if(stopped)break;results.push(r);
   if(r.page.next_watchlist_offset===null)break;offset=r.page.next_watchlist_offset;
  }
  if(!stopped&&discovery!=='FREE_BACKEND_BLOCKED'){
   discovery='attempted';
   const r=await invoke('discover_x_signals',{entities:entities.slice(0,8),known_source_urls:knownSourceUrls.slice(0,50),include_unknown:true,limit:30});
   if(!stopped){results.push(r);if(r.errors?.some(e=>['READ_ENDPOINT_HTTP_404','FREE_BACKEND_BLOCKED'].includes(e.code))&&r.coverage?.succeeded===0)discovery='FREE_BACKEND_BLOCKED';}
  }
  return finish(discovery!=='FREE_BACKEND_BLOCKED'&&results.every(r=>r.status==='ok')?'ok':'partial');
 })();
 try{return await Promise.race([work,new Promise(resolve=>{timer=setTimeout(()=>{stopped=true;resolve(finish('timeout'));},timeoutMs);})]);}
 catch{if(discovery==='attempted')discovery='transport_error';return finish(results.length?'partial':'site_transport_error');}
 finally{clearTimeout(timer);}
}

export function scoutResult(reply){
 if(reply?.schema_version==='1.0.0')return reply;
 if(reply?.structuredContent?.schema_version==='1.0.0')return reply.structuredContent;
 for(const item of reply?.content??[]){if(item.type!=='text')continue;try{const value=JSON.parse(item.text);if(value?.schema_version==='1.0.0')return value;}catch{}}
 throw Error('SITE_TRANSPORT_OR_PROTOCOL_ERROR');
}
