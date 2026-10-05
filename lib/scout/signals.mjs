import {canonicalLink} from './normalize.mjs';
export function buildCandidates(posts,{watchlist=[],known_source_urls=[],covered_topics=[],competitor_urls=[]}={},observations=new Map()){
 const accounts=new Map(watchlist.map(a=>[a.handle.toLowerCase(),a]));
 const known=new Set(known_source_urls.map(canonicalLink)); const covered=new Set(competitor_urls.map(canonicalLink));
 const groups=new Map();
 for(const p of posts){
  const external=p.links.map(canonicalLink).filter(u=>u&&!['x.com','twitter.com','t.co'].includes(new URL(u).hostname));
  const key=external[0]??p.relationships.find(r=>r.type!=='reply')?.url??p.url;
  const g=groups.get(key)??[];g.push(p);groups.set(key,g);
 }
 const candidates=[...groups.entries()].map(([key,evidence])=>{
  const authors=[...new Set(evidence.filter(p=>!p.relationships.some(r=>r.type==='repost')).map(p=>p.author.handle.toLowerCase()))];
  const affiliations=new Set(authors.map(h=>accounts.get(h)?.group??`unreviewed:${h}`));
  const urls=[...new Set(evidence.flatMap(p=>p.links).map(canonicalLink).filter(Boolean))];
  const directUrls=urls.filter(u=>!['x.com','twitter.com','t.co'].includes(new URL(u).hostname));
  const high=evidence.some(p=>accounts.get(p.author.handle.toLowerCase())?.high_signal);
  const seen=directUrls.some(u=>known.has(u))||covered_topics.some(t=>evidence.some(p=>p.text.toLowerCase().includes(t.toLowerCase())));
  const alreadyCovered=directUrls.some(u=>covered.has(u));
  let delta=null,minutes=null;let first=true;
  for(const p of evidence){const old=observations.get(p.id);if(!old)continue;first=false;const interval=(Date.parse(p.retrieved_at)-Date.parse(old.observed_at))/60000;const change=(p.metrics.likes??0)+(p.metrics.replies??0)+(p.metrics.reposts??0)+(p.metrics.quotes??0)-old.engagement;if(interval>=1&&change>=0&&(delta===null||change>delta)){delta=change;minutes=interval;}}
  const rationale=[];if(high)rationale.push('Configured high-signal account; claims still require verification.');if(authors.length>1)rationale.push(`${authors.length} distinct non-repost authors share a source; independence is not established.`);if(delta!==null&&delta>0)rationale.push('Engagement increased between two observed snapshots; this alone does not prove a trend.');if(directUrls.length)rationale.push('External source links available for Verify.');if(!seen&&known.size)rationale.push('Not matched in the supplied Source Watch context; not proof of novelty.');if(!alreadyCovered&&covered.size)rationale.push('No exact URL match in supplied competitor context; broader Gap Check required.');if(!rationale.length)rationale.push('Discovery lead requiring editorial review; no independent corroboration yet.');
  return {id:`x:${evidence[0].id}`,evidence_post_ids:evidence.map(p=>p.id),rationale,signals:{high_signal_author:high,distinct_authors:authors.length,independent_groups_observed:affiliations.size,independence:'not_verified',engagement_delta:delta,growth_window_minutes:minutes,first_observed_here:first,novelty:seen?'seen_in_supplied_context':known.size||covered_topics.length?'new_to_supplied_context':'unknown',reader_interest:'needs_editorial_review',media_gap:alreadyCovered?'covered_in_supplied_context':covered.size?'possible_gap':'unknown'},primary_source_candidates:[...directUrls.map(url=>({url,kind:new URL(url).hostname==='arxiv.org'?'paper':new URL(url).hostname==='github.com'?'repository':new URL(url).hostname==='huggingface.co'?'model_card':'website',verified:false})),...evidence.filter(p=>!p.relationships.some(r=>r.type==='repost')).slice(0,3).map(p=>({url:p.url,kind:'author_statement',verified:false}))].slice(0,50),requires_verification:true};
 });
 // Qualitative bands: evidence/context first. No absolute popularity score or minimum likes.
 return candidates.sort((a,b)=>Number(b.signals.high_signal_author)-Number(a.signals.high_signal_author)||Number(b.signals.distinct_authors>1)-Number(a.signals.distinct_authors>1)||Number(b.signals.media_gap==='possible_gap')-Number(a.signals.media_gap==='possible_gap')||Number((b.signals.engagement_delta??0)>0)-Number((a.signals.engagement_delta??0)>0)).slice(0,30);
}
