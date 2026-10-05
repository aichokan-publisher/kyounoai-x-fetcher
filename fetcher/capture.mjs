import {writeFile,readFile,mkdir,rename} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {runTool,watchlistConfig} from '../lib/scout/service.mjs';
import {queryKey,validateSnapshot} from '../lib/scout/adapters/snapshot.mjs';
import {redact} from '../lib/scout/errors.mjs';
import {MemoryState,readEnvironment} from './runtime.mjs';
export async function captureSnapshot(env,{invoke=null,now=Date.now()}={}){
 const state=new MemoryState();const config=watchlistConfig(env);let plan={entities:[],queries:[]};
 if(env.X_SCOUT_FETCH_PLAN_JSON){try{plan=JSON.parse(env.X_SCOUT_FETCH_PLAN_JSON);}catch{throw Error('CONFIG_INVALID');}}
 if(!Array.isArray(plan.entities)||!Array.isArray(plan.queries)||plan.entities.length>8||plan.queries.length>4||[...plan.entities,...plan.queries].some(q=>typeof q!=='string'||q.length>512))throw Error('CONFIG_INVALID');
 const window={start_time:new Date(now-36*3600000).toISOString(),end_time:new Date(now-30000).toISOString()};
 const snapshot={version:1,generated_at:new Date(now).toISOString(),window,user_posts:{},searches:{}};
 const call=invoke??((name,args)=>runTool(name,args,{...env,X_SCOUT_BACKENDS:'x_cookie'},{store:state}));
 let terminal=null;const stopped=()=>({posts:[],errors:[{code:terminal}]});
 for(const a of config.accounts.slice(0,10)){
  const result=terminal?stopped():await call('get_user_posts',{handle:a.handle,...window,limit:50});
  snapshot.user_posts[a.handle.toLowerCase()]={posts:result.posts,errors:result.errors.map(e=>({code:e.code}))};
  if(result.errors.some(e=>['AUTH_MISSING','AUTH_EXPIRED','FREE_BACKEND_BLOCKED'].includes(e.code)))terminal=result.errors.find(e=>['AUTH_MISSING','AUTH_EXPIRED','FREE_BACKEND_BLOCKED'].includes(e.code)).code;
 }
 const entities=plan.entities.map(e=>e.replace(/["\\\r\n]/g,' ').trim()).filter(Boolean);
 const queries=[...new Set([...entities.length?['('+entities.map(e=>'"'+e+'"').join(' OR ')+') -is:retweet']:[],...plan.queries,...config.discovery_queries])].slice(0,6);
 for(const query of queries){
  const result=terminal?stopped():await call('search_x',{query,...window,limit:30});
  snapshot.searches[queryKey(query)]={posts:result.posts,errors:result.errors.map(e=>({code:e.code}))};
  if(result.errors.some(e=>['AUTH_MISSING','AUTH_EXPIRED','FREE_BACKEND_BLOCKED'].includes(e.code)))terminal=result.errors.find(e=>['AUTH_MISSING','AUTH_EXPIRED','FREE_BACKEND_BLOCKED'].includes(e.code)).code;
 }
 return validateSnapshot(redact(snapshot,env),now);
}
async function main(){
 // Secrets remain in process env. Never print values, upstream messages or stacks.
 const env=await readEnvironment();
 const result=await captureSnapshot(env);const output=new URL('../data/x-scout-snapshot.json',import.meta.url);
 await mkdir(new URL('../data/',import.meta.url),{recursive:true});const temp=fileURLToPath(output)+'.tmp';await writeFile(temp,JSON.stringify(result));await rename(temp,output);
 const rows=[...Object.values(result.user_posts),...Object.values(result.searches)];console.log(JSON.stringify({generated_at:result.generated_at,captures:rows.length,posts:rows.reduce((n,r)=>n+r.posts.length,0),codes:[...new Set(rows.flatMap(r=>r.errors.map(e=>e.code)))]}));
 if(!rows.some(r=>r.posts.length))process.exitCode=2;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])main().catch(()=>{console.error('FREE_FETCHER_FAILED');process.exitCode=1;});
