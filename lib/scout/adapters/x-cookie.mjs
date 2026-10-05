import {ScoutError} from '../errors.mjs';
import {ID,HANDLE} from '../normalize.mjs';
import {webMetadata,READ_OPERATIONS,resetWebMetadata,metadataOverrides} from '../web/bootstrap.mjs';
import {READ_FEATURES} from '../web/features.mjs';
import {normalizeGraphql,graphqlFailure} from '../web/normalize-graphql.mjs';
// Entire network surface: fixed X read operations, GET only. No login or challenge handling.
export function cookieAuth(env){
 const auth=env.X_AUTH_TOKEN,csrf=env.X_CT0;
 if(!auth||!csrf)throw new ScoutError('AUTH_MISSING');
 if(![auth,csrf].every(s=>typeof s==='string'&&/^[A-Za-z0-9%._~-]{16,1024}$/.test(s)))throw new ScoutError('CONFIG_INVALID');
 return {cookie:'auth_token='+auth+'; ct0='+csrf,csrf};
}
export function webQuery(query,start,end){
 const q=query.replace(/(^|\s)-is:retweet(?=\s|$)/g,'$1-filter:retweets').replace(/(^|\s)is:retweet(?=\s|$)/g,'$1filter:retweets');
 if(!start||!end)return q;
 // Browser date operators cover a superset. Service enforces exact UTC half-open bounds.
 const since=new Date(start).toISOString().slice(0,10),until=new Date(Date.parse(end)+86400000).toISOString().slice(0,10);
 return '('+q+') since:'+since+' until:'+until;
}
export class XCookieAdapter{
 constructor(env,transport){this.id='x_cookie';this.env=env;this.transport=transport;this.capabilities=['get_post','get_user_posts','search_x'];this.metadata=null;this.configPromise=null;}
 configured(){return !!(this.env.X_AUTH_TOKEN&&this.env.X_CT0);}
 async config(){const auth=cookieAuth(this.env);this.configPromise??=webMetadata(this.env,this.transport,{cookie:auth.cookie});this.metadata??=await this.configPromise;return {auth,metadata:this.metadata};}
 async request(op,variables){
  if(!READ_OPERATIONS.includes(op))throw new ScoutError('INVALID_INPUT');
  const{auth,metadata}=await this.config();const qid=metadata.qids[op];if(!qid)throw new ScoutError('UPSTREAM_SCHEMA_CHANGED');
  const url=new URL('/i/api/graphql/'+qid+'/'+op,'https://x.com');
  const features=op==='SearchTimeline'?metadata.features??READ_FEATURES:{...READ_FEATURES,...metadata.features??{}};
  url.searchParams.set('variables',JSON.stringify(variables));url.searchParams.set('features',JSON.stringify(features));
  // Search matches the owner's ordinary Latest read request; it has no fieldToggles.
  if(op!=='SearchTimeline')url.searchParams.set('fieldToggles',JSON.stringify({withArticleRichContentState:true,withArticlePlainText:true,withGrokAnalyze:false,withDisallowedReplyControls:false}));
  let body;try{body=await this.transport.read(url,{origin:'https://x.com',free_backend:true,headers:{Authorization:'Bearer '+metadata.bearer,Cookie:auth.cookie,'x-csrf-token':auth.csrf,'x-twitter-auth-type':'OAuth2Session','x-twitter-active-user':'yes','x-twitter-client-language':'en'},format:'json'});}catch(e){if(e.code==='NOT_FOUND'){resetWebMetadata();const changed=new ScoutError('UPSTREAM_SCHEMA_CHANGED');changed.query_id_not_found=true;throw changed;}throw e;}
  const code=graphqlFailure(body);if(code&&code!=='UPSTREAM_REJECTED')throw new ScoutError(code,code==='RATE_LIMITED'?{retry_at:new Date(Date.now()+900000).toISOString()}:{});
  return body;
 }
 async get_post({id}){
  if(!ID.test(id??''))throw new ScoutError('INVALID_INPUT');const{metadata}=await this.config();
  const pinned=metadataOverrides(this.env).qids;
  const op=pinned.TweetDetail&&!pinned.TweetResultByRestId?'TweetDetail':metadata.qids.TweetResultByRestId?'TweetResultByRestId':'TweetDetail';
  const variables=op==='TweetResultByRestId'?{tweetId:id,withCommunity:true,includePromotedContent:false,withVoice:true}:{focalTweetId:id,with_rux_injections:false,includePromotedContent:false,withCommunity:true,withQuickPromoteEligibilityTweetFields:false,withBirdwatchNotes:true,withVoice:true};
  return normalizeGraphql(await this.request(op,variables),{backend:this.id,id});
 }
 async get_user_posts({handle,limit=30,cursor}){
  if(!HANDLE.test(handle??''))throw new ScoutError('INVALID_INPUT');
  const user=await this.request('UserByScreenName',{screen_name:handle,withSafetyModeUserFields:true});
  const result=user.data?.user?.result;if(!ID.test(result?.rest_id??''))throw new ScoutError(result?.__typename==='UserUnavailable'?'NOT_FOUND':'UPSTREAM_SCHEMA_CHANGED');
  if(result.legacy?.protected===true||result.privacy?.protected===true)throw new ScoutError('ACCESS_DENIED');
  const{metadata}=await this.config();const pinned=metadataOverrides(this.env).qids;let op=pinned.UserTweets&&!pinned.UserTweetsAndReplies?'UserTweets':metadata.qids.UserTweetsAndReplies?'UserTweetsAndReplies':'UserTweets';
  const variables={userId:result.rest_id,count:limit,includePromotedContent:false,withCommunity:true,withQuickPromoteEligibilityTweetFields:false,withVoice:true,withV2Timeline:true,...cursor?{cursor}:{}};
  let body;try{body=await this.request(op,variables);}catch(e){if(op!=='UserTweetsAndReplies'||!e.query_id_not_found||!metadata.qids.UserTweets)throw e;op='UserTweets';body=await this.request(op,variables);}
  const data=normalizeGraphql(body,{backend:this.id});
  data.posts=data.posts.filter(p=>p.author.handle.toLowerCase()===handle.toLowerCase());
  if(op==='UserTweets')data.warnings.push({code:'REPLY_COVERAGE_UNVERIFIED'});
  return data;
 }
 async search_x({query,start_time,end_time,limit=30,cursor}){
  if(typeof query!=='string'||!query.trim()||query.length>512)throw new ScoutError('INVALID_INPUT');
  return normalizeGraphql(await this.request('SearchTimeline',{rawQuery:webQuery(query,start_time,end_time),count:limit,querySource:'typed_query',product:'Latest',withGrokTranslatedBio:false,withQuickPromoteEligibilityTweetFields:false,...cursor?{cursor}:{}}),{backend:this.id});
 }
}
