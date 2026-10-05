import {ScoutError} from './errors.mjs';
export class ReadTransport{
 constructor({fetcher=fetch,deadline=Date.now()+18000,max_requests=18,observer=null}={}){this.fetcher=fetcher;this.deadline=deadline;this.max_requests=max_requests;this.requests=0;this.observer=observer;}
 json(url,{token,origin,...options}={}){return this.read(url,{origin,headers:token?{Authorization:'Bearer '+token}:{},...options,format:'json'});}
 text(url,options={}){return this.read(url,{...options,format:'text'});}
 async read(url,{origin,headers={},format='json',free_backend=false,max_bytes=1500000}={}){
  if(url.origin!==origin||url.protocol!=='https:'||url.username||url.password)throw new ScoutError('CONFIG_INVALID');
  if(this.requests>=this.max_requests||Date.now()>=this.deadline)throw new ScoutError('BUDGET_EXHAUSTED');
  this.requests++;const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),Math.max(1,Math.min(5000,this.deadline-Date.now())));
  try{
   const response=await this.fetcher(url.toString(),{method:'GET',redirect:'manual',headers:{Accept:format==='json'?'application/json':'text/html,application/javascript',...headers},signal:controller.signal});
   this.observer?.({stage:'http',origin:url.origin,operation:url.pathname.split('/').at(-1),status:response.status});
   const fail=code=>{response.body?.cancel().catch(()=>{});throw new ScoutError(code,code==='FREE_BACKEND_BLOCKED'?{retry_at:new Date(Date.now()+900000).toISOString()}:{});};
   if(response.status===401)fail('AUTH_EXPIRED');
   if(response.status===403)fail(free_backend?'FREE_BACKEND_BLOCKED':'ACCESS_DENIED');
   if(response.status===402)fail(free_backend?'FREE_BACKEND_BLOCKED':'CREDIT_REQUIRED');
   if(response.status===429){const seconds=Number(response.headers.get('retry-after'));const reset=Number(response.headers.get('x-rate-limit-reset'));const t=seconds>0?Date.now()+seconds*1000:reset>0?reset*1000:Date.now()+900000;response.body?.cancel().catch(()=>{});throw new ScoutError('RATE_LIMITED',{retry_at:new Date(Math.min(t,Date.now()+86400000)).toISOString()});}
   if(response.status===404)fail('NOT_FOUND');
   if(response.status>=500)fail('BACKEND_UNAVAILABLE');
   if(response.status>=300&&response.status<400)fail(free_backend?'FREE_BACKEND_BLOCKED':'ACCESS_DENIED');
   // A bounded JSON 400 is useful for detecting changed required read features.
   if(!response.ok&&!(response.status===400&&format==='json'&&response.headers.get('content-type')?.includes('json')))fail('UPSTREAM_REJECTED');
   if(format==='json'&&!response.headers.get('content-type')?.includes('json'))fail(free_backend?'FREE_BACKEND_BLOCKED':'UPSTREAM_SCHEMA_CHANGED');
   const reader=response.body?.getReader();if(!reader)throw new ScoutError('UPSTREAM_SCHEMA_CHANGED');
   const chunks=[];let size=0;
   while(true){const{done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max_bytes){await reader.cancel();throw new ScoutError('UPSTREAM_SCHEMA_CHANGED');}chunks.push(value);}
   const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.byteLength;}
   const body=new TextDecoder().decode(bytes);
   if(format==='text')return body;
   let parsed;try{parsed=JSON.parse(body);}catch{throw new ScoutError('UPSTREAM_SCHEMA_CHANGED');}
   this.observer?.({stage:'json',operation:url.pathname.split('/').at(-1),body:parsed});
   if(!response.ok)throw new ScoutError(Array.isArray(parsed?.errors)&&parsed.errors.some(e=>/feature|query.?id|operation.*not.*found/i.test(String(e.message)))?'UPSTREAM_SCHEMA_CHANGED':'UPSTREAM_REJECTED');
   return parsed;
  }catch(e){if(e instanceof ScoutError)throw e;throw new ScoutError(controller.signal.aborted?'TIMEOUT':'NETWORK_ERROR');}finally{clearTimeout(timer);}
 }
}
