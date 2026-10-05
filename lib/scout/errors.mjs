export const ERROR_CODES=['AUTH_MISSING','AUTH_EXPIRED','ACCESS_DENIED','RATE_LIMITED','CREDIT_REQUIRED','NOT_FOUND','UPSTREAM_PARTIAL','UPSTREAM_SCHEMA_CHANGED','UPSTREAM_REJECTED','BACKEND_UNAVAILABLE','NETWORK_ERROR','TIMEOUT','BUDGET_EXHAUSTED','STORAGE_UNAVAILABLE','RUNTIME_DEPENDENCY_ERROR','CONFIG_INVALID','INVALID_INPUT','UNSUPPORTED','FREE_BACKEND_BLOCKED','SNAPSHOT_STALE','SNAPSHOT_QUERY_NOT_CAPTURED'];
export class ScoutError extends Error {
 constructor(code, options={}) {super(code);this.name='ScoutError';this.code=ERROR_CODES.includes(code)?code:'BACKEND_UNAVAILABLE';this.retry_at=options.retry_at??null;}
}
export function safeError(e,backend=null,capability=null){
 const code=e instanceof ScoutError?e.code:'BACKEND_UNAVAILABLE';
 return {code,backend,capability,retryable:['RATE_LIMITED','BACKEND_UNAVAILABLE','NETWORK_ERROR','TIMEOUT','STORAGE_UNAVAILABLE'].includes(code),retry_at:e instanceof ScoutError?e.retry_at:null};
}
export function redact(value, env={}){
 const keys=['X_API_BEARER_TOKEN','X_SCOUT_BRIDGE_TOKEN','RUNTIME_PROBE_SECRET','X_AUTH_TOKEN','X_CT0','X_COOKIE','X_WEB_BEARER'];
 const keysToRedact=keys;
 const secrets=keysToRedact.flatMap(k=>typeof env[k]==='string'&&env[k].length>=6?[env[k],encodeURIComponent(env[k])]:[]);
 function clean(v){if(typeof v==='string'){for(const s of secrets)v=v.split(s).join('[REDACTED]');return v;}if(Array.isArray(v))return v.map(clean);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,clean(x)]));return v;}
 return clean(value);
}
export async function bounded(promise,ms,code='TIMEOUT'){
 let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new ScoutError(code)),ms)})]);}finally{clearTimeout(timer);}
}
