// Live acceptance logic; no fixture, seeded post URL or seeded expected post ID.
// invoke(name,args) must call installed Site plugin or authenticated /api/check.
export async function runAcceptance(invoke,{now=Date.now()}={}){
 const anchorStart='2026-10-03T15:00:00.000Z';
 const anchorEnd=new Date(Math.min(Date.parse('2026-10-06T00:00:00.000Z'),now-30000)).toISOString();
 const regression={name:'account_and_time_regression',input:{handle:'thsottiaux',start_time:anchorStart,end_time:anchorEnd,limit:100},status:'not_run',pages:0,post:null,errors:[]};
 let cursor;let match;
 for(let page=0;page<4;page++){
  const r=await invoke('get_user_posts',{...regression.input,...(cursor?{cursor}:{})});regression.pages++;
  if(!['ok','partial'].includes(r.status)){regression.status=r.status==='auth_required'?'blocked_by_auth':'blocked_by_backend';regression.errors=r.errors;break;}
  match=r.posts.find(p=>/\b28\b/.test(p.text)&&/codex/i.test(p.text)&&/work/i.test(p.text)&&/full\s+reset/i.test(p.text)&&/(ship|release)/i.test(p.text));
  if(match){regression.post=match;regression.status='discovered_needs_detail';break;}
  cursor=r.page.next_cursor;if(!cursor){regression.status='not_found_in_returned_range';break;}
  if(page===3)regression.status='inconclusive_page_budget';
 }
 if(match){const detail=await invoke('get_post',{id:match.id});const post=detail.posts.find(p=>p.id===match.id);regression.status=post?.author.handle.toLowerCase()==='thsottiaux'&&post.created_at&&post.text&&post.url&&Array.isArray(post.relationships)?'passed':'detail_failed';regression.post=post??match;regression.errors=detail.errors;}
 const end=new Date(now-30000).toISOString();
 const discovery=await invoke('discover_x_signals',{start_time:new Date(now-36*3600000).toISOString(),end_time:end,include_unknown:true,limit:30});
 const unknown={name:'author_independent_last_36h',status:discovery.status==='auth_required'?'blocked_by_auth':discovery.posts.length?'retrieved_needs_primary_source_and_gap_verification':discovery.status==='ok'?'no_candidates':'blocked_by_backend',input:{start_time:new Date(now-36*3600000).toISOString(),end_time:end,include_unknown:true,limit:30},result:discovery,acceptance_note:'Pass only after multiple candidates have primary-source checks AND documented major-media Gap Check. Unknown media_gap never means not covered.'};
 return {checked_at:new Date().toISOString(),regression,unknown,fixtures_used:false};
}
