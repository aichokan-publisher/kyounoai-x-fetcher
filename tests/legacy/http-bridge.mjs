import {ScoutError} from '../../lib/scout/errors.mjs';
import {normalizeV2} from '../../lib/scout/normalize.mjs';
// Optional independently authorized read service. No service is provisioned by this adapter.
// Bridge must implement only GET /v1/post, /v1/user-posts, /v1/search and return a v2-shaped public-post payload.
export class HttpBridgeAdapter{
 constructor(env,transport){this.id='http_bridge';this.transport=transport;this.origin=env.X_SCOUT_BRIDGE_ORIGIN;this.token=env.X_SCOUT_BRIDGE_TOKEN;this.capabilities=['get_post','get_user_posts','search_x'];}
 configured(){return !!(this.origin&&this.token);}
 async read(path,args){if(!this.configured())throw new ScoutError('AUTH_MISSING');let base;
  try{base=new URL(this.origin);}catch{throw new ScoutError('CONFIG_INVALID');}
  if(base.protocol!=='https:'||base.origin!==this.origin||base.port||base.username||base.password||!base.hostname.includes('.')||/^[\d.]+$|:|(^|\.)(localhost|local|internal|test|invalid)$/.test(base.hostname))throw new ScoutError('CONFIG_INVALID');
  const url=new URL(path,base);for(const [k,v]of Object.entries(args))if(v!==undefined)url.searchParams.set(k,String(v));
  return normalizeV2(await this.transport.json(url,{token:this.token,origin:base.origin}),{backend:this.id});
 }
 get_post(args){return this.read('/v1/post',args);}
 get_user_posts(args){return this.read('/v1/user-posts',args);}
 search_x(args){return this.read('/v1/search',args);}
}
