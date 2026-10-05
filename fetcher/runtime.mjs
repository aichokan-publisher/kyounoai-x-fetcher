import {readFile} from 'node:fs/promises';
export class MemoryState {
 constructor(){this.failed=false;this.rows=new Map();}
 async state(){return [...this.rows.values()];}
 async setState(id,code,retry_at=null){this.rows.set(id,{id,code,retry_at,checked_at:new Date().toISOString()});}
 async health(){return 'ok';}
 async observe(){return new Map();}
}
export async function readEnvironment(source=process.env){
 const env=Object.fromEntries(['X_AUTH_TOKEN','X_CT0','X_WEB_BEARER','X_WEB_QUERY_IDS_JSON','X_WEB_FEATURES_JSON','X_SCOUT_WATCHLIST_JSON'].filter(k=>typeof source[k]==='string').map(k=>[k,source[k]]));
 env.X_SCOUT_FETCH_PLAN_JSON=await readFile(new URL('./plan.json',import.meta.url),'utf8');
 const metadata=JSON.parse(await readFile(new URL('./read-metadata.json',import.meta.url),'utf8'));
 env.X_WEB_QUERY_IDS_JSON ||= JSON.stringify(metadata.query_ids);
 env.X_WEB_FEATURES_JSON ||= JSON.stringify(metadata.features);
 env.X_SCOUT_BACKENDS='x_cookie';
 return env;
}
