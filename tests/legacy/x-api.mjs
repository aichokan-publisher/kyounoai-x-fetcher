import {ScoutError} from '../../lib/scout/errors.mjs';
import {normalizeV2} from '../../lib/scout/normalize.mjs';
export class XApiAdapter{
 constructor(env,transport){this.id='x_api';this.token=env.X_API_BEARER_TOKEN;this.transport=transport;this.legacy=env.X_API_DIALECT==='legacy';this.capabilities=['get_post','get_user_posts','search_x'];}
 configured(){return typeof this.token==='string'&&this.token.trim().length>0;}
 fields(){return this.legacy?{'tweet.fields':'id,text,author_id,created_at,referenced_tweets,entities,attachments,public_metrics,note_tweet',expansions:'author_id,referenced_tweets.id,referenced_tweets.id.author_id,attachments.media_keys','user.fields':'id,name,username','media.fields':'type,url,preview_image_url,duration_ms'}:{'post.fields':'id,text,created_at,entities,attachments,public_metrics,note_post',expansions:'author_id,referenced_posts,attachments.media_keys','user.fields':'id,name,username','media.fields':'type,url,preview_image_url,duration_ms'};}
 async request(path,params={}){if(!this.configured())throw new ScoutError('AUTH_MISSING');
  if(!/^\/2\/(tweets\/\d+|tweets\/search\/(recent|all)|users\/by\/username\/[A-Za-z0-9_]+|users\/\d+\/tweets)$/.test(path))throw new ScoutError('INVALID_INPUT');
  const url=new URL(path,'https://api.x.com');for(const [k,v] of Object.entries(params))if(v!==undefined&&v!==null)url.searchParams.set(k,String(v));
  return this.transport.json(url,{token:this.token,origin:'https://api.x.com'});
 }
 normalize(data){return normalizeV2(data,{backend:this.id});}
 async get_post({id}){return this.normalize(await this.request(`/2/tweets/${id}`,this.fields()));}
 async get_user_posts({handle,start_time,end_time,limit=30,cursor}){
  const user=await this.request(`/2/users/by/username/${handle}`,{'user.fields':'id,name,username'});
  if(!/^\d+$/.test(user.data?.id??''))throw new ScoutError(user.errors?'NOT_FOUND':'UPSTREAM_SCHEMA_CHANGED');
  return this.normalize(await this.request(`/2/users/${user.data.id}/tweets`,{...this.fields(),start_time,end_time,max_results:Math.max(5,limit),pagination_token:cursor}));
 }
 async search_x({query,start_time,end_time,limit=30,cursor,archive=false}){
  return this.normalize(await this.request(`/2/tweets/search/${archive?'all':'recent'}`,{...this.fields(),query,start_time,end_time,max_results:Math.max(10,limit),next_token:cursor,sort_order:'recency'}));
 }
}
