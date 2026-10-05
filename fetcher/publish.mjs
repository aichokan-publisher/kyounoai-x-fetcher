import {readFile} from 'node:fs/promises';
import {validateSnapshot} from '../lib/scout/adapters/snapshot.mjs';
import {OUTPUT_SCHEMA,POST_SCHEMA,validate} from '../lib/scout/schema.mjs';
// This mutation saves an artifact to GitHub. It cannot call X or send X cookies.
async function main(){
 const repo=process.env.GITHUB_REPOSITORY,token=process.env.GH_TOKEN,ref=process.env.GITHUB_REF_NAME??'main';
 if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo??'')||!token)throw Error();
 const headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'};
 let saved=0;
 for(const filename of ['x-scout-acceptance.json','x-scout-snapshot.json']){
 let text;try{text=await readFile(new URL('../data/'+filename,import.meta.url),'utf8');}catch(e){if(e.code==='ENOENT')continue;throw e;}
 const result=JSON.parse(text);
 if(filename==='x-scout-snapshot.json')validateSnapshot(result);
 else{if(result.fixtures_used!==false||result.execution_environment!=='node-free-fetcher'||result.paid_backends_allowed!==false)throw Error();validate(OUTPUT_SCHEMA,result.unknown.result);if(result.regression.post)validate(POST_SCHEMA,result.regression.post);}
 if(Buffer.byteLength(text)>1500000)throw Error();
 const url='https://api.github.com/repos/'+repo+'/contents/data/'+filename;
 const prior=await fetch(url+'?ref='+encodeURIComponent(ref),{headers,signal:AbortSignal.timeout(10000)});let sha;
 if(prior.ok)sha=(await prior.json()).sha;else if(prior.status!==404)throw Error();
 const r=await fetch(url,{method:'PUT',headers,body:JSON.stringify({message:'Update public X observation snapshot',branch:ref,content:Buffer.from(text).toString('base64'),...sha?{sha}:{}}),signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Error();saved++;
 }
 if(!saved)throw Error();console.log('PUBLIC_OBSERVATIONS_SAVED');
}
main().catch(()=>{console.error('SNAPSHOT_SAVE_FAILED');process.exitCode=1;});
