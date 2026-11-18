import {XCookieAdapter} from '../lib/scout/adapters/x-cookie.mjs';
import {ReadTransport} from '../lib/scout/transport.mjs';
import {ScoutError} from '../lib/scout/errors.mjs';
import {readEnvironment} from '../fetcher/runtime.mjs';

const env=await readEnvironment();
const queryId='vLHjqbDv7TPFMBkIIO1nOA';
env.X_WEB_QUERY_IDS_JSON=JSON.stringify({SearchTimeline:queryId});
const features=JSON.parse(env.X_WEB_FEATURES_JSON);
features.post_ctas_fetch_enabled=true;
features.x_elections_post_context_enabled=true;
features.responsive_web_made_on_x_label_enabled=false;
env.X_WEB_FEATURES_JSON=JSON.stringify(features);
let http=null,attempts=0;
const transport=new ReadTransport({fetcher:async(url,init)=>{
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
console.log('SCOUT_RESULT '+JSON.stringify({attempts,http,posts,error,feature_count:Object.keys(features).length}));
if(error||posts===0)process.exitCode=1;
