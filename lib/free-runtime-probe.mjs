import {ReadTransport} from './scout/transport.mjs';
import {webMetadata,READ_OPERATIONS} from './scout/web/bootstrap.mjs';
import {normalizeGraphql} from './scout/web/normalize-graphql.mjs';
import {POST_SCHEMA,validate} from './scout/schema.mjs';
import {safeError,redact} from './scout/errors.mjs';
import {cookieAuth,XCookieAdapter} from './scout/adapters/x-cookie.mjs';
// Default is cookie-free. Owner-requested authenticated metadata uses only the fixed X origin.
// Neither mode proves authenticated post retrieval or exposes credential values.
export async function freeRuntimeProbe(env,{fetcher=fetch,authenticated=false,deep=false,page='root'}={}){
 const at=new Date().toISOString();const network=[];
 // Return only field names and numeric codes. Never raw response values or messages.
 const fields=v=>v&&typeof v==='object'&&!Array.isArray(v)?Object.keys(v).filter(k=>/^[A-Za-z_]{1,60}$/.test(k)).slice(0,30):[];
 const observer=e=>{if(!READ_OPERATIONS.includes(e.operation))return;if(e.stage==='http')network.push({operation:e.operation,status:e.status});else network.push({operation:e.operation,data_fields:fields(e.body?.data),result_fields:Object.fromEntries(fields(e.body?.data).map(k=>[k,fields(e.body.data[k])])),errors:(e.body?.errors??[]).slice(0,10).map(x=>({code:Number.isInteger(x.code)?x.code:null,missing_features:typeof x.message==='string'&&/features?[^.]{0,30}(?:null|missing|required)/i.test(x.message)?[...x.message.matchAll(/\b(?:[a-z][a-z0-9]+_){2,}[a-z0-9]+\b/g)].map(m=>m[0]).slice(0,50):[]}))});};
 const transport=new ReadTransport({fetcher,observer});let preparation;const trace=[];
 const pages={root:'https://x.com/',home:'https://x.com/home',search:'https://x.com/search?q=AI&f=live'};
 try{if(!pages[page])throw new Error();const cookie=authenticated?cookieAuth(env).cookie:null;const m=await webMetadata({},transport,{force:true,trace,cookie,page:pages[page]});preparation={status:'metadata_ready',read_operations_available:READ_OPERATIONS.filter(op=>!!m.qids[op]),web_bearer_discovered:!!m.bearer,bundles_read:m.bundles_read};}
 catch(e){preparation={status:e.code==='FREE_BACKEND_BLOCKED'?'FREE_BACKEND_BLOCKED':'metadata_unavailable',error:safeError(e,'x_cookie','bootstrap')};}
 let parser='failed';try{
  const p=normalizeGraphql({data:{tweetResult:{result:{rest_id:'123',legacy:{full_text:'SYNTHETIC_RUNTIME_CHECK',created_at:at},core:{user_results:{result:{rest_id:'7',core:{screen_name:'fixture_user',name:'Fixture'}}}}}}}},{id:'123'}).posts[0];validate(POST_SCHEMA,p);parser='passed';
 }catch{}
 const capability_checks=[];
 if(authenticated&&deep&&preparation?.status==='metadata_ready'){
  const adapter=new XCookieAdapter(env,transport);
  for(const[capability,args]of[['get_user_posts',{handle:'thsottiaux',limit:5}],['search_x',{query:'AI',limit:5}],['read_user_tweets',null]]){try{let r;if(capability==='read_user_tweets'){const user=await adapter.request('UserByScreenName',{screen_name:'thsottiaux',withSafetyModeUserFields:true});r=normalizeGraphql(await adapter.request('UserTweets',{userId:user.data?.user?.result?.rest_id,count:5,includePromotedContent:false,withVoice:true,withV2Timeline:true}));}else r=await adapter[capability](args);capability_checks.push({capability,status:'retrieved',posts:r.posts.length});}catch(e){capability_checks.push({capability,status:'failed',error:safeError(e,'x_cookie',capability)});if(['FREE_BACKEND_BLOCKED','AUTH_EXPIRED','RATE_LIMITED'].includes(e.code))break;}}
 }
 return redact({checked_at:at,runtime:'cloudflare-workers',module_loaded:true,additional_dependencies:0,filesystem_required:false,parser_fixture:parser,metadata_request_authenticated:authenticated,metadata_page:page,real_authenticated_retrieval:capability_checks.some(c=>c.status==='retrieved')?'observed':'not_proven',cookie_secrets_present:{X_AUTH_TOKEN:!!env.X_AUTH_TOKEN,X_CT0:!!env.X_CT0},paid_backend_available:false,requests:transport.requests,preparation,public_bundle_diagnostics:trace,capability_checks,read_request_diagnostics:network,continue_source_watch:true},env);
}
