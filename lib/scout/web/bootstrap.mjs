// Query-pair and legacy bundle extraction adapted from x-native (MIT, Jason Poindexter).
// See docs/vendor/x-native-LICENSE.txt. No upstream filesystem cache or CLI is imported.
import {ScoutError} from '../errors.mjs';
export const READ_OPERATIONS=['SearchTimeline','UserByScreenName','UserTweetsAndReplies','UserTweets','TweetResultByRestId','TweetDetail'];
const QID=/^[A-Za-z0-9_-]{8,128}$/;
let cached=null;
export function resetWebMetadata(){cached=null;}
export function extractQueryIds(js){
 const out={};
 for(const m of js.matchAll(/["\']?queryId["\']?:\s*["']([^"']+)["'],\s*["\']?operationName["\']?:\s*["'](\w+)["']/g))if(READ_OPERATIONS.includes(m[2])&&QID.test(m[1]))out[m[2]]=m[1];
 for(const m of js.matchAll(/["\']?operationName["\']?:\s*["'](\w+)["'](?:(?!operationName:)[\s\S]){0,200}?["\']?queryId["\']?:\s*["']([^"']+)["']/g))if(READ_OPERATIONS.includes(m[1])&&QID.test(m[2])&&!out[m[1]])out[m[1]]=m[2];
 return out;
}
export function bundleUrls(text,base='https://x.com/'){
 const out=[];const raw=[...text.matchAll(/https:\/\/abs\.twimg\.com\/(?:responsive-web\/client-web|x-web\/x-web)[\w./-]+\.js/g)].map(m=>m[0]);
 if(new URL(base).origin==='https://abs.twimg.com')raw.push(...[...text.matchAll(/["'](\.\.?\/[^"'\s?#]+\.js)["']/g)].map(m=>m[1]));
 for(const value of raw){const u=new URL(value,base);if(u.origin==='https://abs.twimg.com'&&/^\/(responsive-web\/client-web|x-web\/x-web)[\w./-]+\.js$/.test(u.pathname))out.push(u.toString());}
 return [...new Set(out)];
}
export function extractPublicBearer(js){return js.match(/["'](AAAAA[A-Za-z0-9%_-]{50,250})["']/)?.[1]??null;}
export function metadataOverrides(env){
 let qids={};if(env.X_WEB_QUERY_IDS_JSON){try{qids=JSON.parse(env.X_WEB_QUERY_IDS_JSON);}catch{throw new ScoutError('CONFIG_INVALID');}}
 if(!qids||typeof qids!=='object'||Array.isArray(qids)||Object.entries(qids).some(([k,v])=>!READ_OPERATIONS.includes(k)||typeof v!=='string'||!QID.test(v)))throw new ScoutError('CONFIG_INVALID');
 let features=null;if(env.X_WEB_FEATURES_JSON){try{features=JSON.parse(env.X_WEB_FEATURES_JSON);}catch{throw new ScoutError('CONFIG_INVALID');}if(!features||typeof features!=='object'||Array.isArray(features)||Object.entries(features).some(([k,v])=>!/^\w{1,120}$/.test(k)||typeof v!=='boolean')||Object.keys(features).length>100)throw new ScoutError('CONFIG_INVALID');}
 const bearer=env.X_WEB_BEARER?.trim()||null;if(bearer&&!/^AAAAA[A-Za-z0-9%_-]{50,250}$/.test(bearer))throw new ScoutError('CONFIG_INVALID');
 return {qids,bearer,features};
}
export async function webMetadata(env,transport,{cookie=null,force=false,trace=null,page='https://x.com/'}={}){
 const pageUrl=new URL(page);if(pageUrl.origin!=='https://x.com'||!['/','/home','/search'].includes(pageUrl.pathname)||pageUrl.username||pageUrl.password)throw new ScoutError('CONFIG_INVALID');
 const pinned=metadataOverrides(env);
 if(pinned.bearer&&Object.keys(pinned.qids).length)return {...pinned,checked_at:new Date().toISOString(),source:'owner_web_config',bundles_read:0};
 if(!force&&cached&&Date.now()-cached.at<1800000)return {...cached.value,qids:{...cached.value.qids,...pinned.qids},bearer:pinned.bearer??cached.value.bearer,features:pinned.features};
 const html=await transport.text(pageUrl,{origin:'https://x.com',free_backend:true,headers:cookie?{Cookie:cookie}:{},max_bytes:2000000});
 const queue=bundleUrls(html);if(!queue.length)throw new ScoutError('UPSTREAM_SCHEMA_CHANGED');
 // The authenticated cookie is NEVER sent to the public asset origin.
 const qids={...pinned.qids};let bearer=pinned.bearer;const seen=new Set();let error=null;
 while(queue.length&&seen.size<8){
  const raw=queue.shift();if(seen.has(raw))continue;seen.add(raw);
  let js;try{js=await transport.text(new URL(raw),{origin:'https://abs.twimg.com',free_backend:true,max_bytes:5000000});}catch(e){error=e;break;}
  Object.assign(qids,extractQueryIds(js),pinned.qids);bearer??=extractPublicBearer(js);
  const imported=bundleUrls(js,raw).filter(x=>!seen.has(x));
  if(trace)trace.push({file:new URL(raw).pathname.split('/').at(-1),bytes:js.length,imports:imported.map(u=>new URL(u).pathname.split('/').at(-1)).slice(0,80),read_operations:Object.keys(extractQueryIds(js)),bearer_found:!!extractPublicBearer(js),operation_mentions:READ_OPERATIONS.filter(op=>js.includes(op)),query_id_mentions:(js.match(/queryId/g)??[]).length});
  queue.push(...imported);queue.sort((a,b)=>Number(/api|graphql|client|main|index|search|tweet/.test(b))-Number(/api|graphql|client|main|index|search|tweet/.test(a)));
  if(bearer&&qids.SearchTimeline&&qids.UserByScreenName&&(qids.UserTweetsAndReplies||qids.UserTweets)&&(qids.TweetResultByRestId||qids.TweetDetail))break;
 }
 if(!bearer)throw error??new ScoutError('UPSTREAM_SCHEMA_CHANGED');
 const value={qids,bearer,features:pinned.features,checked_at:new Date().toISOString(),source:'x_web_bundles',bundles_read:seen.size};
 cached={at:Date.now(),value};return value;
}
