import {ScoutError} from '../errors.mjs';
import {POST_SCHEMA,validate} from '../schema.mjs';
import {dedupe} from '../normalize.mjs';
export function snapshotUrl(value){
 let url;try{url=new URL(value);}catch{throw new ScoutError('CONFIG_INVALID');}
 if(url.origin!=='https://raw.githubusercontent.com'||url.username||url.password||url.search||url.hash||!/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+\/x-scout-snapshot\.json$/.test(url.pathname))throw new ScoutError('CONFIG_INVALID');
 return url;
}
export function queryKey(q){return q.trim().replace(/\s+/g,' ');}
export function validateSnapshot(s,now=Date.now()){
 if(!s||s.version!==1||!Number.isFinite(Date.parse(s.generated_at))||Date.parse(s.generated_at)>now+60000||!s.user_posts||typeof s.user_posts!=='object'||Array.isArray(s.user_posts)||!s.searches||typeof s.searches!=='object'||Array.isArray(s.searches))throw new ScoutError('UPSTREAM_SCHEMA_CHANGED');
 if(now-Date.parse(s.generated_at)>30*3600000)throw new ScoutError('SNAPSHOT_STALE');
 let total=0;for(const rows of[...Object.values(s.user_posts),...Object.values(s.searches)]){
  if(!rows||!Array.isArray(rows.posts)||rows.posts.length>100||!Array.isArray(rows.errors)||rows.errors.some(e=>typeof e?.code!=='string'))throw new ScoutError('UPSTREAM_SCHEMA_CHANGED');
  for(const p of rows.posts){try{validate(POST_SCHEMA,p);}catch{throw new ScoutError('UPSTREAM_SCHEMA_CHANGED');}if(Date.parse(p.retrieved_at)>now+60000)throw new ScoutError('UPSTREAM_SCHEMA_CHANGED');total++;}
 }
 if(total>1000)throw new ScoutError('UPSTREAM_SCHEMA_CHANGED');return s;
}
export class SnapshotAdapter{
 constructor(env,transport){this.id='snapshot';this.env=env;this.transport=transport;this.capabilities=['get_post','get_user_posts','search_x'];this.snapshot=null;}
 configured(){return !!this.env.X_SCOUT_SNAPSHOT_URL;}
 async load(){if(!this.configured())throw new ScoutError('CONFIG_INVALID');this.snapshot??=validateSnapshot(await this.transport.json(snapshotUrl(this.env.X_SCOUT_SNAPSHOT_URL),{origin:'https://raw.githubusercontent.com',free_backend:true}));return this.snapshot;}
 rows(record,{start_time,end_time,limit=30,cursor}={}){
  if(!record)throw new ScoutError('SNAPSHOT_QUERY_NOT_CAPTURED');
  if(!record.posts.length&&record.errors.length)throw new ScoutError(record.errors[0].code);
  let posts=dedupe(record.posts).filter(p=>(!start_time||p.created_at>=start_time)&&(!end_time||p.created_at<end_time));
  const offset=cursor?Number(cursor):0;if(!Number.isSafeInteger(offset)||offset<0||offset>1000)throw new ScoutError('INVALID_INPUT');
  const more=posts.length>offset+limit;posts=posts.slice(offset,offset+limit).map(p=>({...p,provenance:{...p.provenance,backend:'snapshot'}}));
  return {posts,next_cursor:more?String(offset+limit):null,truncated:false,warnings:[{code:'SNAPSHOT_BOUNDED_CAPTURE'},...record.errors.length?[{code:'SNAPSHOT_CAPTURE_PARTIAL'}]:[]]};
 }
 async get_post({id}){const s=await this.load();const p=dedupe([...Object.values(s.user_posts),...Object.values(s.searches)].flatMap(r=>r.posts)).find(p=>p.id===id);if(!p)throw new ScoutError('NOT_FOUND');return this.rows({posts:[p],errors:[]},{limit:1});}
 async get_user_posts(args){const s=await this.load();return this.rows(s.user_posts[args.handle.toLowerCase()],args);}
 async search_x(args){const s=await this.load();return this.rows(s.searches[queryKey(args.query)],args);}
}
