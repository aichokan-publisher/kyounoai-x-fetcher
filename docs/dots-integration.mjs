// Example for a host that provides plugin calls. Never pass X credentials to Dots.
// This helper has no dependency on Source Watch's implementation.
// Pass the six-tool result, or the platform Plugin envelope; no X credentials.
export async function optionalXScout({sourceCandidates,entities=[],knownSourceUrls=[],callTool,timeoutMs=65000}){
 const invoke=async(name,args)=>scoutResult(await callTool(name,args));
 const safeSource=[...sourceCandidates];let timer;let stopped=false;
 const work=(async()=>{
  const health=await invoke('health_check',{});
  if(['auth_required','backend_error','config_error'].includes(health.status))return {sourceCandidates:safeSource,xCandidates:[],xStatus:health.status};
  const results=[];let offset=0;
  for(let slice=0;slice<3;slice++){
   if(stopped)break;
   const r=await invoke('scan_watchlist',{offset,account_limit:4,per_user_limit:15});results.push(r);
   if(r.page.next_watchlist_offset===null)break;offset=r.page.next_watchlist_offset;
  }
  const searchBlocked=health.health?.free_discovery_state==='FREE_BACKEND_BLOCKED';
  if(!stopped&&!searchBlocked)results.push(await invoke('discover_x_signals',{entities:entities.slice(0,8),known_source_urls:knownSourceUrls.slice(0,50),include_unknown:true,limit:30}));
  const map=new Map(results.flatMap(r=>r.candidates).map(c=>[c.id,c]));
  return {sourceCandidates:safeSource,xCandidates:[...map.values()],posts:results.flatMap(r=>r.posts),xStatus:!searchBlocked&&results.every(r=>r.status==='ok')?'ok':'partial',xDiscoveryStatus:searchBlocked?'FREE_BACKEND_BLOCKED':'attempted',next:'Gap Check → Verify/Rank',articleQuota:null};
 })();
 try{return await Promise.race([work,new Promise(resolve=>{timer=setTimeout(()=>{stopped=true;resolve({sourceCandidates:safeSource,xCandidates:[],xStatus:'timeout',next:'Continue Gap Check and Verify/Rank'});},timeoutMs);})]);}
 catch{return {sourceCandidates:safeSource,xCandidates:[],xStatus:'site_transport_error',next:'Continue Gap Check and Verify/Rank'};}
 finally{clearTimeout(timer);}
}

export function scoutResult(reply){
 if(reply?.schema_version==='1.0.0')return reply;
 if(reply?.structuredContent?.schema_version==='1.0.0')return reply.structuredContent;
 for(const item of reply?.content??[]){if(item.type!=='text')continue;try{const value=JSON.parse(item.text);if(value?.schema_version==='1.0.0')return value;}catch{}}
 throw Error('SITE_TRANSPORT_OR_PROTOCOL_ERROR');
}
