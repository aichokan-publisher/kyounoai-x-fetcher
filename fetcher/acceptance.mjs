import {mkdir,writeFile,rename,appendFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {runAcceptance} from '../checks/acceptance.mjs';
import {runTool} from '../lib/scout/service.mjs';
import {redact,ScoutError,safeError} from '../lib/scout/errors.mjs';
import {OUTPUT_SCHEMA,validate} from '../lib/scout/schema.mjs';
import {MemoryState,readEnvironment} from './runtime.mjs';
const terminalCodes=new Set(['AUTH_MISSING','AUTH_EXPIRED','FREE_BACKEND_BLOCKED','RATE_LIMITED']);
export async function runFetcherAcceptance(env,{invoke=null,now=Date.now()}={}){
 const state=new MemoryState();let terminal=null;
 const backend=invoke??((name,args)=>runTool(name,args,{...env,X_SCOUT_BACKENDS:'x_cookie'},{store:state}));
 const call=async(name,args)=>{
  if(terminal)return {schema_version:'1.0.0',tool:name,status:terminal.code.startsWith('AUTH_')?'auth_required':'backend_error',retrieved_at:new Date().toISOString(),posts:[],candidates:[],errors:[terminal],warnings:[],coverage:{requested:0,succeeded:0,failed:0,complete:false,requests:0,reason:'SESSION_STOPPED'},page:{next_cursor:null,next_watchlist_offset:null,has_more:false},health:null,continue_source_watch:true};
  const result=redact(await backend(name,args),env);
  validate(OUTPUT_SCHEMA,result);
  const stop=result.errors.find(e=>terminalCodes.has(e.code));
  if(stop)terminal=safeError(new ScoutError(stop.code,{retry_at:stop.retry_at}),'x_cookie',name);
  return result;
 };
 const report=redact(await runAcceptance(call,{now}),env);
 return {...report,execution_environment:'node-free-fetcher',paid_backends_allowed:false,session_terminal_code:terminal?.code??null,primary_source_verification:'pending',media_gap_verification:'pending'};
}
async function main(){
 const result=await runFetcherAcceptance(await readEnvironment());
 const dir=new URL('../data/',import.meta.url);await mkdir(dir,{recursive:true});
 const output=fileURLToPath(new URL('x-scout-acceptance.json',dir));
 await writeFile(output+'.tmp',JSON.stringify(result));await rename(output+'.tmp',output);
 if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,'capture_allowed='+String(!result.session_terminal_code)+'\n');
 console.log(JSON.stringify({regression:result.regression.status,unknown:result.unknown.status,unknown_posts:result.unknown.result.posts.length,unknown_candidates:result.unknown.result.candidates.length,fixtures_used:false,primary_and_gap_verification:'pending'}));
 if(result.regression.status!=='passed'||!result.unknown.result.candidates.length)process.exitCode=2;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])main().catch(()=>{console.error('FREE_ACCEPTANCE_FAILED');process.exitCode=1;});
