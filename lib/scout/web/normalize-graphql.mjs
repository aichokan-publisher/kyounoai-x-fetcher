import {ScoutError} from '../errors.mjs';
import {normalizeV2,ID,HANDLE} from '../normalize.mjs';
export function graphqlFailure(payload){
 const errors=payload?.errors;if(!Array.isArray(errors)||!errors.length)return null;
 const codes=errors.map(e=>Number(e.code));
 if(codes.some(c=>[32,89,215].includes(c)))return 'AUTH_EXPIRED';
 if(codes.includes(88))return 'RATE_LIMITED';
 if(codes.some(c=>[64,326,353].includes(c)))return 'FREE_BACKEND_BLOCKED';
 if(codes.some(c=>[34,144,179].includes(c)))return 'NOT_FOUND';
 if(errors.some(e=>/feature|query.?id|operation.*not.*found/i.test(String(e.message))))return 'UPSTREAM_SCHEMA_CHANGED';
 return 'UPSTREAM_REJECTED';
}
export function normalizeGraphql(payload,{backend='x_cookie',id=null,retrieved_at=new Date().toISOString()}={}){
 if(!payload||typeof payload!=='object'||!payload.data||typeof payload.data!=='object')throw new ScoutError(graphqlFailure(payload)??'UPSTREAM_SCHEMA_CHANGED');
 const failure=graphqlFailure(payload);if(failure&&failure!=='UPSTREAM_REJECTED')throw new ScoutError(failure);
 const primary=[];let cursor=null;let hasTimeline=false;let skippedPrivate=false;let unavailable=false;
 function walk(node,depth=0){
  if(depth>45)throw new ScoutError('UPSTREAM_SCHEMA_CHANGED');if(!node||typeof node!=='object')return;
  if(Array.isArray(node)){for(const n of node)walk(n,depth+1);return;}
  if(node.promotedMetadata||node.promoted_metadata)return;
  if(Array.isArray(node.instructions))hasTimeline=true;
  if(node.cursorType==='Bottom'&&typeof node.value==='string')cursor=node.value;
  if(['TweetUnavailable','TweetTombstone','UserUnavailable'].includes(node.__typename)){unavailable=true;return;}
  if(typeof node.legacy?.full_text==='string'&&ID.test(node.rest_id??node.legacy.id_str??'')){primary.push(node);return;}
  for(const[k,v]of Object.entries(node))if(!['quoted_status_result','retweeted_status_result','user_results'].includes(k))walk(v,depth+1);
 }
 walk(payload.data);
 const users=new Map(),references=new Map(),media=new Map();
 function unwrap(t){return t?.tweet??t;}
 function convert(input,depth=0){
  if(depth>3)return null;const t=unwrap(input);if(!t||!ID.test(t.rest_id??t.legacy?.id_str??''))return null;
  const l=t.legacy??{},u=t.core?.user_results?.result??{};
  if(u.legacy?.protected===true||u.privacy?.protected===true){skippedPrivate=true;return null;}
  const uc=u.core??{},ul=u.legacy??{};const handle=uc.screen_name??ul.screen_name,name=uc.name??ul.name;const authorId=u.rest_id??l.user_id_str;
  if(!HANDLE.test(handle??'')||typeof name!=='string'||!ID.test(authorId??''))return null;
  users.set(authorId,{id:authorId,username:handle,name});
  const pid=t.rest_id??l.id_str;const p={id:pid,author_id:authorId,text:l.full_text,created_at:l.created_at,entities:l.entities,referenced_tweets:[],public_metrics:{like_count:l.favorite_count,retweet_count:l.retweet_count,reply_count:l.reply_count,quote_count:l.quote_count,impression_count:Number(t.views?.count)||undefined}};
  const note=t.note_tweet?.note_tweet_results?.result;if(typeof note?.text==='string')p.note_tweet={text:note.text,entities:note.entity_set};
  if(ID.test(l.in_reply_to_status_id_str??'')){p.referenced_tweets.push({type:'replied_to',id:l.in_reply_to_status_id_str});if(HANDLE.test(l.in_reply_to_screen_name??'')&&ID.test(l.in_reply_to_user_id_str??'')){users.set(l.in_reply_to_user_id_str,{id:l.in_reply_to_user_id_str,username:l.in_reply_to_screen_name,name:l.in_reply_to_screen_name});references.set(l.in_reply_to_status_id_str,{id:l.in_reply_to_status_id_str,author_id:l.in_reply_to_user_id_str});}}
  for(const[field,type,fallback]of[['quoted_status_result','quoted',l.quoted_status_id_str],['retweeted_status_result','retweeted',l.retweeted_status_id_str]]){
   const ref=unwrap(t[field]?.result??l[field]?.result);const refId=ref?.rest_id??ref?.legacy?.id_str??fallback;
   if(ID.test(refId??'')){p.referenced_tweets.push({type,id:refId});const converted=convert(ref,depth+1);if(converted)references.set(refId,converted);}
  }
  p.attachments={media_keys:[]};for(const[index,m]of(l.extended_entities?.media??l.entities?.media??[]).entries()){
   const key=m.media_key??m.id_str??(pid+'-'+index);p.attachments.media_keys.push(key);media.set(key,{media_key:key,type:m.type,url:m.media_url_https,preview_image_url:m.media_url_https,duration_ms:m.video_info?.duration_millis});
  }
  return p;
 }
 const records=primary.map(p=>convert(p)).filter(Boolean);const chosen=id?records.filter(p=>p.id===id):records;
 if(id&&!chosen.length)throw new ScoutError(unavailable?'NOT_FOUND':skippedPrivate?'ACCESS_DENIED':'UPSTREAM_SCHEMA_CHANGED');
 if(!chosen.length&&!hasTimeline)throw new ScoutError(unavailable?'NOT_FOUND':'UPSTREAM_SCHEMA_CHANGED');
 if(primary.length&&!records.length&&!skippedPrivate)throw new ScoutError('UPSTREAM_SCHEMA_CHANGED');
 const result=normalizeV2({data:chosen,includes:{users:[...users.values()],tweets:[...references.values()],media:[...media.values()]},meta:{result_count:chosen.length,next_token:cursor}},{backend,retrieved_at});
 if(failure)result.warnings.push({code:'UPSTREAM_PARTIAL'});
 if(skippedPrivate)result.warnings.push({code:'NON_PUBLIC_POSTS_EXCLUDED'});
 return result;
}
