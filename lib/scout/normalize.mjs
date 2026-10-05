import { ScoutError } from './errors.mjs';
export const ID=/^[0-9]{1,25}$/;
export const HANDLE=/^[A-Za-z0-9_]{1,15}$/;
export function safeUrl(raw){
 try{const u=new URL(raw);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)return null;u.hash='';return u.toString();}catch{return null;}
}
export function canonicalLink(raw){const safe=safeUrl(raw);if(!safe)return null;const u=new URL(safe);for(const k of [...u.searchParams.keys()])if(/^utm_|^(ref|source|s|t)$/.test(k))u.searchParams.delete(k);return u.toString().replace(/\/$/,'');}
export function postUrl(id,handle){return HANDLE.test(handle??'')?`https://x.com/${handle}/status/${id}`:`https://x.com/i/web/status/${id}`;}
const metric=n=>Number.isFinite(n)&&n>=0?Math.floor(n):null;
export function normalizeV2(payload,{backend='normalized_read',retrieved_at=new Date().toISOString()}={}){
 if(!payload||typeof payload!=='object'||(payload.data!==undefined&&!Array.isArray(payload.data)&&typeof payload.data!=='object'))throw new ScoutError('UPSTREAM_SCHEMA_CHANGED');
 if(payload.data===undefined&&payload.meta?.result_count!==0)throw new ScoutError(payload.errors?'UPSTREAM_PARTIAL':'UPSTREAM_SCHEMA_CHANGED');
 const records=payload.data===undefined?[]:Array.isArray(payload.data)?payload.data:[payload.data];
 const users=new Map((payload.includes?.users??[]).map(u=>[u.id,u]));
 const refs=new Map((payload.includes?.tweets??payload.includes?.posts??[]).map(p=>[p.id,p]));
 const mediaMap=new Map((payload.includes?.media??[]).map(m=>[m.media_key,m]));
 const posts=[];let rejected=0;
 for(const p of records){
  const u=users.get(p.author_id); const long=p.note_post??p.note_tweet;
  const text=long?.text??p.text;
  if(!ID.test(p.id??'')||typeof text!=='string'||!u||!HANDLE.test(u.username??'')||typeof u.name!=='string'||!Number.isFinite(Date.parse(p.created_at))){rejected++;continue;}
  const references=p.referenced_posts??p.referenced_tweets??[];
  if(!Array.isArray(references)||references.some(r=>!ID.test(r.id??'')||!['replied_to','quoted','retweeted','reposted'].includes(r.type))){rejected++;continue;}
  const relationships=references.map(r=>{const ref=refs.get(r.id);const author=users.get(ref?.author_id);return {type:({replied_to:'reply',quoted:'quote',retweeted:'repost',reposted:'repost'})[r.type],post_id:r.id,url:postUrl(r.id,author?.username),author_handle:author?.username??null,reference_resolved:!!ref};});
  const links=[...new Set([...(p.entities?.urls??[]),...(long?.entities?.urls??[])].map(x=>safeUrl(x.unwound_url??x.expanded_url??x.url)).filter(Boolean))].slice(0,30);
  const media=(p.attachments?.media_keys??[]).slice(0,16).map(key=>{const m=mediaMap.get(key);return {type:['photo','video','animated_gif'].includes(m?.type)?m.type:'unknown',url:safeUrl(m?.url??m?.preview_image_url),duration_ms:metric(m?.duration_ms)};});
  const pm=p.public_metrics??{};
  posts.push({id:p.id,url:postUrl(p.id,u.username),author:{name:u.name,handle:u.username},created_at:new Date(p.created_at).toISOString(),text,relationships,quote_urls:relationships.filter(r=>r.type==='quote').map(r=>r.url),retrieved_at,media,has_image:media.some(m=>m.type==='photo'),has_video:media.some(m=>['video','animated_gif'].includes(m.type)),links,has_links:links.length>0,metrics:{likes:metric(pm.like_count),reposts:metric(pm.repost_count??pm.retweet_count),replies:metric(pm.reply_count),quotes:metric(pm.quote_count),views:metric(pm.impression_count)},provenance:{backend,source_type:'x_post',content_trust:'untrusted_external',verification_status:'candidate_only',relation_completeness:relationships.some(r=>!r.reference_resolved)?'partial':'complete',text_completeness:long?.text?'long_form':'api_text'}});
 }
 if(records.length&&!posts.length)throw new ScoutError('UPSTREAM_SCHEMA_CHANGED');
 return {posts:dedupe(posts),next_cursor:typeof payload.meta?.next_token==='string'?payload.meta.next_token:null,truncated:false,warnings:[...(rejected?[{code:'UPSTREAM_SCHEMA_CHANGED',count:rejected}]:[]),...(payload.errors?.length?[{code:'UPSTREAM_PARTIAL',count:payload.errors.length}]:[])]};
}
export function dedupe(posts){const map=new Map();for(const p of posts){const old=map.get(p.id);if(!old||p.retrieved_at>old.retrieved_at)map.set(p.id,p);}return [...map.values()].sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)||b.id.localeCompare(a.id));}
