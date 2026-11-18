import {XCookieAdapter} from '../lib/scout/adapters/x-cookie.mjs';
import {ReadTransport} from '../lib/scout/transport.mjs';
import {ScoutError} from '../lib/scout/errors.mjs';
import {readEnvironment} from '../fetcher/runtime.mjs';

const env=await readEnvironment();
const queryId=JSON.parse(env.X_WEB_QUERY_IDS_JSON).SearchTimeline;
const features=JSON.parse(env.X_WEB_FEATURES_JSON);
let diagnostic=null;
let http=null,attempts=0;
const transport=new ReadTransport({observer:e=>{if(e.stage==='read_404')diagnostic={content_kind:e.content_kind,shape:e.shape};},fetcher:async(url,init)=>{
 const u=new URL(url);
 if(u.pathname.includes('/i/api/graphql/')){
  const v=JSON.parse(u.searchParams.get('variables'));
  if(++attempts!==1||u.origin!=='https://x.com'||u.pathname!=='/i/api/graphql/'+queryId+'/SearchTimeline'||init.method!=='GET'||v.rawQuery!=='AI'||v.product!=='Latest'||v.count!==20||u.searchParams.has('fieldToggles'))throw new ScoutError('CONFIG_INVALID');
 }
 const r=await fetch(url,init);
 if(u.pathname.endsWith('/SearchTimeline'))http=r.status;
 return r;
}});
let posts=0,error=null;
try{const result=await new XCookieAdapter(env,transport).search_x({query:'AI',limit:20});posts=result.posts.length;}
catch(e){error=e instanceof ScoutError?e.code:'BACKEND_UNAVAILABLE';}
console.log('SCOUT_RESULT '+JSON.stringify({attempts,http,posts,error,diagnostic,feature_count:Object.keys(features).length}));
if(error||posts===0)process.exitCode=1;
