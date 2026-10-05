import defaults from '../../config/watchlist.json' with {type:'json'};
import {ScoutError,safeError,redact,bounded} from './errors.mjs';
import {ReadTransport} from './transport.mjs';
import {StateStore} from './store.mjs';
import {SCHEMA_VERSION,OUTPUT_SCHEMA,inputFor,timeWindow,validate} from './schema.mjs';
import {dedupe,HANDLE} from './normalize.mjs';
import {buildCandidates} from './signals.mjs';
export function watchlistConfig(env){
 let config=defaults;
 if(env.X_SCOUT_WATCHLIST_JSON){try{config=JSON.parse(env.X_SCOUT_WATCHLIST_JSON);}catch{throw new ScoutError('CONFIG_INVALID');}}
 if(config.version!==1||!Array.isArray(config.accounts)||config.accounts.length>100||!Array.isArray(config.discovery_queries)||config.discovery_queries.length>4)throw new ScoutError('CONFIG_INVALID');
 for(const a of config.accounts)if(!HANDLE.test(a.handle??'')||typeof a.group!=='string'||a.group.length>80||typeof a.high_signal!=='boolean')throw new ScoutError('CONFIG_INVALID');
 if(config.discovery_queries.some(q=>typeof q!=='string'||q.length>512||!q.trim()))throw new ScoutError('CONFIG_INVALID');
 const map=new Map(config.accounts.map(a=>[a.handle.toLowerCase(),{handle:a.handle,group:a.group,high_signal:a.high_signal}]));
 return {accounts:[...map.values()],discovery_queries:config.discovery_queries};
}
const baseResult=tool=>({schema_version:SCHEMA_VERSION,tool,status:'unknown',retrieved_at:new Date().toISOString(),posts:[],candidates:[],errors:[],warnings:[],coverage:{requested:0,succeeded:0,failed:0,complete:false,requests:0,reason:null},page:{next_cursor:null,next_watchlist_offset:null,has_more:false},health:null,continue_source_watch:true});
const failoverCodes=new Set(['BACKEND_UNAVAILABLE','NETWORK_ERROR','TIMEOUT','UPSTREAM_SCHEMA_CHANGED','RUNTIME_DEPENDENCY_ERROR']);
function resultStatus(out){if(out.errors.length===0)return out.warnings.length?'partial':'ok';if(out.coverage.succeeded>0)return 'partial';if(out.errors.some(e=>e.code==='CONFIG_INVALID'||e.code==='INVALID_INPUT'))return 'config_error';if(out.errors.some(e=>['AUTH_MISSING','AUTH_EXPIRED'].includes(e.code)))return 'auth_required';return 'backend_error';}
export async function createService(env,{fetcher=fetch,adapterOverrides=null,store=null}={}){
 const transport=new ReadTransport({fetcher});const state=store??new StateStore(env.DB);const prior=await state.state();const loadErrors=[];const adapters=[];
 const order=(env.X_SCOUT_BACKENDS??'x_cookie').split(',').map(x=>x.trim());
 if(new Set(order).size!==order.length||order.some(x=>!['x_cookie','snapshot'].includes(x)))throw new ScoutError('CONFIG_INVALID');
 for(const id of order){try{
  if(adapterOverrides){const a=adapterOverrides.find(a=>a.id===id);if(!a)throw Error();adapters.push(a);continue;}
  if(id==='x_cookie'){const{XCookieAdapter}=await import('./adapters/x-cookie.mjs');adapters.push(new XCookieAdapter(env,transport));}
  else{const{SnapshotAdapter}=await import('./adapters/snapshot.mjs');adapters.push(new SnapshotAdapter(env,transport));}
 }catch{loadErrors.push(safeError(new ScoutError('RUNTIME_DEPENDENCY_ERROR'),id,null));}}
 const sessionFailures=new Map();const live=new Map(prior.map(x=>[x.id,x]));
 async function call(capability,args){
  const attempts=[];
  for(const adapter of adapters){
   const key=`${adapter.id}:${capability}`;
   const globalFailure=sessionFailures.get(adapter.id);const prev=live.get(key);
   try{
    if(globalFailure)throw new ScoutError(globalFailure.code,{retry_at:globalFailure.retry_at});
    if(!adapter.capabilities.includes(capability))throw new ScoutError('UNSUPPORTED');
    if(prev?.retry_at&&Date.parse(prev.retry_at)>Date.now())throw new ScoutError(prev.code,{retry_at:prev.retry_at});
    const data=await adapter[capability](args);
    const rec={id:key,code:'OK',checked_at:new Date().toISOString(),retry_at:null};live.set(key,rec);await state.setState(key,'OK');
    return {data,backend:adapter.id,attempts};
   }catch(error){const e=safeError(error,adapter.id,capability);attempts.push(e);
    live.set(key,{id:key,code:e.code,checked_at:new Date().toISOString(),retry_at:e.retry_at});await state.setState(key,e.code,e.retry_at);
    if(['AUTH_MISSING','AUTH_EXPIRED'].includes(e.code))sessionFailures.set(adapter.id,e);
    // Never route around authentication, access restrictions, or rate limits.
    if(!failoverCodes.has(e.code))break;
   }
  }
  return {data:null,backend:null,attempts:attempts.length?attempts:loadErrors.length?loadErrors:[safeError(new ScoutError('BACKEND_UNAVAILABLE'),null,capability)]};
 }
 async function execute(name,args={}){
  inputFor(name,args);if(!['get_post','health_check'].includes(name))args={...args,...timeWindow(args)};const out=baseResult(name);let config;
  try{config=watchlistConfig(env);}catch(e){if(['scan_watchlist','discover_x_signals'].includes(name))throw e;if(name==='health_check')out.errors.push(safeError(e));config={accounts:[],discovery_queries:[]};}
  out.errors.push(...loadErrors);
  const sources=[];
  async function collect(capability,a,label=capability){
   out.coverage.requested++;const r=await call(capability,a);
   if(r.data){out.coverage.succeeded++;out.posts.push(...r.data.posts);for(const w of r.data.warnings??[])out.warnings.push(w.code);if(r.attempts.length)out.errors.push(...r.attempts);sources.push({source:label,backend:r.backend,status:'ok',count:r.data.posts.length,next_cursor:r.data.next_cursor});return r.data;}
   out.coverage.failed++;out.errors.push(...r.attempts.map(e=>({...e,capability:label})));sources.push({source:label,backend:r.attempts.at(-1)?.backend??null,status:'failed',count:0,next_cursor:null});return null;
  }
  if(name==='health_check'){
   if(args.deep){const win=timeWindow({});const timeline=await collect('get_user_posts',{handle:config.accounts[0]?.handle??'thsottiaux',...win,limit:5},'get_user_posts');await collect('search_x',{query:'(AI OR LLM) -is:retweet',...win,limit:10},'search_x');if(timeline?.posts[0])await collect('get_post',{id:timeline.posts[0].id},'get_post');out.posts=[];}
   const storage=await state.health();const capabilities=[];
   for(const adapter of adapters)for(const capability of adapter.capabilities){const rec=live.get(`${adapter.id}:${capability}`);const fresh=rec&&Date.now()-Date.parse(rec.checked_at)<3600000;const code=!adapter.configured()?(adapter.id==='snapshot'?'CONFIG_INVALID':'AUTH_MISSING'):fresh?rec.code:'UNTESTED';capabilities.push({backend:adapter.id,capability,code,checked_at:rec?.checked_at??null,retry_at:rec?.retry_at??null});}
   const codes=capabilities.map(c=>c.code);const ok=codes.filter(c=>c==='OK').length;
   const searchCodes=capabilities.filter(c=>c.capability==='search_x').map(c=>c.code);
   // Operational discovery gate; a stale/404 query does not prove an IP or authentication block.
   const discoveryState=searchCodes.includes('OK')?'READY':searchCodes.some(c=>['AUTH_MISSING','AUTH_EXPIRED'].includes(c))?'COOKIE_REQUIRED':searchCodes.length&&searchCodes.every(c=>c!=='UNTESTED')?'FREE_BACKEND_BLOCKED':'UNVERIFIED';
   out.health={runtime:'cloudflare-workers',mcp_schema_version:SCHEMA_VERSION,configured_backends:order,paid_backends_allowed:false,free_backend_state:codes.some(c=>['FREE_BACKEND_BLOCKED','RATE_LIMITED'].includes(c))?'FREE_BACKEND_BLOCKED':ok?(codes.every(c=>c==='OK')?'READY':'PARTIAL'):codes.some(c=>['AUTH_MISSING','AUTH_EXPIRED'].includes(c))?'COOKIE_REQUIRED':'UNVERIFIED',free_discovery_state:discoveryState,discovery_upstream_codes:[...new Set(searchCodes)],discovery_block_cause_confirmed:false,capabilities,storage,watchlist_accounts:config.accounts.length,required_secrets:adapters.filter(a=>!a.configured()).flatMap(a=>a.id==='x_cookie'?['X_AUTH_TOKEN','X_CT0']:[]),limits:{operation_timeout_ms:20000,fetch_timeout_ms:5000,max_upstream_requests:18,max_parallel_fetches:1,max_posts:100,watchlist_slice_max:4},checks_are_recent_observations:true,notes:['No guarantee of complete X coverage.','Discovery state describes availability, not the cause of an X access restriction.','If the entire Worker fails to load, Dots must classify a transport failure and continue Source Watch.']};
   out.status=(out.errors.some(e=>e.code==='CONFIG_INVALID')||codes.includes('CONFIG_INVALID'))?'config_error':codes.some(c=>['AUTH_MISSING','AUTH_EXPIRED'].includes(c))?(ok?'partial':'auth_required'):codes.every(c=>c==='OK')&&codes.length&&storage==='ok'&&!loadErrors.length?'ok':ok?'partial':codes.every(c=>c==='UNTESTED')&&!loadErrors.length?'unknown':'backend_error';
   if(storage!=='ok')out.errors.push(safeError(new ScoutError('STORAGE_UNAVAILABLE')));
   out.coverage.complete=out.status==='ok';
  }else{
   if(name==='get_post'){await collect(name,args);}
   else if(name==='get_user_posts'||name==='search_x'){
    const win=timeWindow(args);const data=await collect(name,{...args,...win});out.page.next_cursor=data?.next_cursor??null;out.page.has_more=!!out.page.next_cursor;
   }else if(name==='scan_watchlist'){
    const accounts=args.handles?[...new Set(args.handles.map(h=>h.toLowerCase()))].map(handle=>({handle})):config.accounts;
    const offset=args.offset??0;const count=args.account_limit??4;const selected=accounts.slice(offset,offset+count);const win=timeWindow(args);
    for(const account of selected)await collect('get_user_posts',{handle:account.handle,...win,limit:args.per_user_limit??15},`get_user_posts:${account.handle}`);
    if(offset+count<accounts.length)out.page.next_watchlist_offset=offset+count;
    out.page.has_more=out.page.next_watchlist_offset!==null||sources.some(s=>s.next_cursor);
   }else if(name==='discover_x_signals'){
    const win=timeWindow(args);const queries=[];
    const entities=(args.entities??[]).map(e=>e.replace(/["\\\r\n]/g,' ').trim()).filter(Boolean);
    if(entities.length)queries.push(`(${entities.map(e=>`"${e}"`).join(' OR ')}) -is:retweet`);
    queries.push(...args.queries??[]);
    if(args.include_unknown!==false)queries.push(...config.discovery_queries);
    const all=[...new Set(queries)];const selected=all.slice(0,6);if(!selected.length)throw new ScoutError('INVALID_INPUT');
    for(const query of selected){if(query.length>512)throw new ScoutError('INVALID_INPUT');await collect('search_x',{query,...win,limit:Math.min(args.limit??30,50)},`search_x:lane_${sources.length+1}`);}
    if(all.length>6)out.warnings.push('QUERY_BUDGET_TRUNCATED');
    out.page.has_more=sources.some(s=>s.next_cursor);
   }
   out.posts=dedupe(out.posts);if(out.posts.length>100){out.posts=out.posts.slice(0,100);out.warnings.push('RESULT_LIMIT_REACHED');out.page.has_more=true;}
   // Always enforce the requested half-open time window even if the provider returns an extra row.
   if(name!=='get_post'){const win=timeWindow(args);out.posts=out.posts.filter(p=>p.created_at>=win.start_time&&p.created_at<win.end_time);}
   // Revalidate normalized data before persisting observations or returning any adapter data.
   for(const p of out.posts){try{validate(OUTPUT_SCHEMA.properties.posts.items,p);}catch{throw new ScoutError('UPSTREAM_SCHEMA_CHANGED');}}
   const previous=await state.observe(out.posts);
   if(['scan_watchlist','discover_x_signals'].includes(name))out.candidates=buildCandidates(out.posts,{...args,watchlist:config.accounts},previous);
   if(state.failed){out.errors.push(safeError(new ScoutError('STORAGE_UNAVAILABLE')));out.warnings.push('GROWTH_HISTORY_UNAVAILABLE');}
   out.status=resultStatus(out);out.coverage.complete=!out.errors.length&&!out.warnings.length&&!out.page.has_more;
  }
  out.coverage.requests=transport.requests;
  if(out.page.has_more)out.coverage.reason='BOUNDED_PAGE_MORE_RESULTS_AVAILABLE';
  else if(!out.coverage.complete)out.coverage.reason=out.errors.some(e=>e.code==='FREE_BACKEND_BLOCKED')?'FREE_BACKEND_BLOCKED':out.status==='auth_required'?'AUTHENTICATION_REQUIRED':'PARTIAL_OR_UNVERIFIED_COVERAGE';
  if(sources.length)out.health={...(out.health??{}),sources};
  return redact(out,env);
 }
 return {execute,transport};
}
export async function runTool(name,args,env,options={}){
 try{const out=await bounded((async()=>{const service=await createService(env,options);return service.execute(name,args);})(),20000);validate(OUTPUT_SCHEMA,out);return out;}
 catch(error){const out=baseResult(name);out.errors=[safeError(error)];out.status=resultStatus(out);out.coverage.reason='OPERATION_FAILED_SOURCE_WATCH_UNAFFECTED';return redact(out,env);}
}
