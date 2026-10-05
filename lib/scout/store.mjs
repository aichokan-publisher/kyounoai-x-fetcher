import {bounded} from './errors.mjs';
export class StateStore{
 constructor(db){this.db=db;this.failed=false;}
 async call(action,fallback=null){try{if(!this.db)throw Error();return await bounded(action(this.db),900,'STORAGE_UNAVAILABLE');}catch{this.failed=true;return fallback;}}
 async health(){return this.call(async db=>{await db.prepare('SELECT 1 FROM capability_state LIMIT 1').first();return 'ok';},'unavailable');}
 async state(){return this.call(async db=>(await db.prepare('SELECT id, code, checked_at, retry_at FROM capability_state').all()).results,[]);}
 async setState(id,code,retry_at=null){return this.call(db=>db.prepare('INSERT INTO capability_state (id,code,checked_at,retry_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET code=excluded.code,checked_at=excluded.checked_at,retry_at=excluded.retry_at').bind(id,code,new Date().toISOString(),retry_at).run());}
 async observe(posts){
  if(!posts.length)return new Map();
  return this.call(async db=>{
   const ids=posts.map(p=>p.id);const prev=(await db.prepare(`SELECT id,observed_at,engagement FROM observations WHERE id IN (${ids.map(()=>'?').join(',')})`).bind(...ids).all()).results;
   const map=new Map(prev.map(p=>[p.id,p]));const now=new Date().toISOString();
   await db.batch(posts.map(p=>db.prepare('INSERT INTO observations (id,observed_at,engagement) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET observed_at=excluded.observed_at,engagement=excluded.engagement WHERE observations.observed_at < ?').bind(p.id,now,(p.metrics.likes??0)+(p.metrics.replies??0)+(p.metrics.reposts??0)+(p.metrics.quotes??0),new Date(Date.now()-15*60000).toISOString())));
   await db.prepare('DELETE FROM observations WHERE observed_at < ?').bind(new Date(Date.now()-7*86400000).toISOString()).run();
   return map;
  },new Map());
 }
}
