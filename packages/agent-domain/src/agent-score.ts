import { CID } from "multiformats/cid";
/** Pure canonical agent scoring shared by the application and indexer worker. */
export const AGENT_SCORE_WEIGHTS = {
  metadata: 0.20, endpoints: 0.18, social: 0.09, compliance: 0.15,
  quality: 0.16, popularity: 0.05, freshness: 0.07, verifiedRevenue: 0.10,
} as const;
export type AgentScoreWeightKey = keyof typeof AGENT_SCORE_WEIGHTS;
export function scoreWeightPercent(key: AgentScoreWeightKey): string { return `${Math.round(AGENT_SCORE_WEIGHTS[key] * 100)}%`; }
export type TrustDimensionValues = { metadata:number; endpoints:number; social:number; compliance:number; quality:number; popularity:number; freshness:number; verifiedRevenue:number };
export interface AgentScoreInput {
  name:string; description:string; image:string; metadata:Array<{key:string;value:string}>; services:Array<{name:string;endpoint:string}>;
  scoreWallet:number; x402Support:boolean; binanceCompatible:boolean; totalFeedback:number; scoreQuality:number; lastActiveAt:Date;
  isVerifiedRevenue?:boolean; perfWinRate?:number|null; perfMonthlyPnlUsd?:number|null; perfBurnToEarnRatio?:number|null;
}
export interface AgentScoreResult { score:number; hotScore:number; scoreMetadata:number; scoreEndpoints:number; scoreSocial:number; scoreCompliance:number; scoreFreshness:number; scoreQuality:number; scorePopularity:number; scoreVerifiedRevenue:number }
export type AgentSocialScore = { score:number; twitter:boolean; website:boolean; github:boolean; discord:boolean; telegram:boolean };
function finite(v:number,l:string){if(!Number.isFinite(v))throw new Error(`${l} must be finite`);return v}
function clamp100(v:number){return Math.max(0,Math.min(100,finite(v,"score dimension")))}
function canonicalMetadata(rows:Array<{key:string;value:string}>|null|undefined){
 const out=new Map<string,string>();for(const e of rows??[]){if(typeof e.key!=="string"||typeof e.value!=="string")continue;const key=e.key.normalize("NFC").trim().toLocaleLowerCase("en-US");if(key&&!out.has(key))out.set(key,e.value.normalize("NFC").trim())}return out;
}
function getCanonicalMeta(metadata:ReadonlyMap<string,string>,keys:readonly string[]){for(const k of keys){const v=metadata.get(k);if(v)return v}return null}
function publicHostname(hostname:string){const host=hostname.toLowerCase().replace(/^\[|\]$/g,"");if(!host||host==="localhost"||host.endsWith(".localhost")||host.endsWith(".local")||host.endsWith(".internal")||host.endsWith(".lan"))return false;if(host.includes(":")){if(host==="::"||host==="::1"||host.startsWith("fc")||host.startsWith("fd")||/^fe[89ab]/.test(host))return false;return true}const parts=host.split(".");if(parts.length===4&&parts.every(part=>/^(?:0|[1-9][0-9]{0,2})$/.test(part))){const octets=parts.map(Number);if(octets.some(part=>part>255))return false;const[a,b]=octets;return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===198&&(b===18||b===19)))}return true}
function httpsUrl(v:string|null|undefined){if(!v)return null;try{const u=new URL(v);return u.protocol==="https:"&&!u.username&&!u.password&&publicHostname(u.hostname)?u:null}catch{return null}}
function hostMatches(h:string|null,d:string){return h===d||h?.endsWith(`.${d}`)===true}
const WEBSITE_META_KEYS=["website","uri","url"] as const,TWITTER_META_KEYS=["twitter","x"] as const,GITHUB_META_KEYS=["github"] as const,DISCORD_META_KEYS=["discord"] as const,TELEGRAM_META_KEYS=["telegram"] as const;
type CanonicalService = { name:string; endpoint:string; kind:"https"|"ipfs"|"did"|"ens"|"email"|"chain"; url:URL|null };
function typedEndpoint(value:string):Omit<CanonicalService,"name">|null{
 const raw=value.normalize("NFC").trim(); if(!raw||raw.length>2048||/[\u0000-\u001f\u007f]/.test(raw))return null;
 const web=httpsUrl(raw); if(web)return{endpoint:web.toString(),kind:"https",url:web};
 if(raw.startsWith("ipfs://")){const remainder=raw.slice(7),slash=remainder.indexOf("/"),root=slash<0?remainder:remainder.slice(0,slash),path=slash<0?"":remainder.slice(slash);try{const cid=CID.parse(root);return{endpoint:`ipfs://${cid.toV1().toString()}${path}`,kind:"ipfs",url:null}}catch{return null}}
 if(/^did:[a-z0-9]+:[A-Za-z0-9._:%-]+(?:[/?#][^\s]*)?$/.test(raw))return{endpoint:raw,kind:"did",url:null};
 if(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+eth$/i.test(raw))return{endpoint:raw.toLowerCase(),kind:"ens",url:null};
 const email=raw.startsWith("mailto:")?raw.slice(7):raw;if(!raw.includes("://")&&/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(email))return{endpoint:`mailto:${email}`,kind:"email",url:null};
 if(/^[a-z0-9-]{3,8}:[A-Za-z0-9_-]{1,32}:[A-Za-z0-9._%+-]{1,128}$/.test(raw))return{endpoint:raw,kind:"chain",url:null};
 return null;
}
function canonicalServices(rows:Array<{name:string;endpoint:string}>|null|undefined){
 const seen=new Set<string>(), out:CanonicalService[]=[];
 for(const s of rows??[]){if(typeof s.name!=="string"||typeof s.endpoint!=="string")continue;const name=s.name.normalize("NFC").trim().toLocaleLowerCase("en-US"),parsed=typedEndpoint(s.endpoint);if(!name||!parsed)continue;const key=`${name}\0${parsed.kind}\0${parsed.endpoint}`;if(seen.has(key))continue;seen.add(key);out.push({name,...parsed})}
 return out;
}
export function protocolTrustScoreFromDimensions(d:TrustDimensionValues){const w=AGENT_SCORE_WEIGHTS;return Math.round(clamp100(d.metadata)*w.metadata+clamp100(d.endpoints)*w.endpoints+clamp100(d.social)*w.social+clamp100(d.compliance)*w.compliance+clamp100(d.quality)*w.quality+clamp100(d.popularity)*w.popularity+clamp100(d.freshness)*w.freshness+clamp100(d.verifiedRevenue)*w.verifiedRevenue)}
function scoreMetadataFromCanonical(name:string,description:string,image:string,metadata:ReadonlyMap<string,string>,metadataWebsite=httpsUrl(getCanonicalMeta(metadata,WEBSITE_META_KEYS))){let p=0;if(name?.trim())p+=20;const trimmedDescription=description?.trim();if(trimmedDescription){p+=20;if(trimmedDescription.length>50)p+=10}if(image?.trim())p+=20;if(metadataWebsite)p+=15;let extra=0;for(const key of metadata.keys()){if(key==="agentwallet"||key==="banner")continue;extra+=1;if(extra>=6)break}if(extra>=3)p+=5;if(extra>=6)p+=5;return Math.min(100,p)}
export function scoreMetadataDimension(name:string,description:string,image:string,metadata:Array<{key:string;value:string}>|null|undefined){return scoreMetadataFromCanonical(name,description,image,canonicalMetadata(metadata))}
function computeSocialFromCanonical(metadata:ReadonlyMap<string,string>,parsed:readonly CanonicalService[],metadataWebsite=httpsUrl(getCanonicalMeta(metadata,WEBSITE_META_KEYS))):AgentSocialScore{
 const mh=(keys:readonly string[])=>httpsUrl(getCanonicalMeta(metadata,keys))?.hostname.toLowerCase()??null;
 const th=mh(TWITTER_META_KEYS),dh=mh(DISCORD_META_KEYS),gh=mh(TELEGRAM_META_KEYS);
 let twitter=hostMatches(th,"x.com")||hostMatches(th,"twitter.com");
 let website=Boolean(metadataWebsite);
 let github=hostMatches(mh(GITHUB_META_KEYS),"github.com");
 let discord=hostMatches(dh,"discord.com")||hostMatches(dh,"discord.gg");
 let telegram=hostMatches(gh,"t.me")||hostMatches(gh,"telegram.me");
 for(const service of parsed){if(service.name==="web"||service.name==="website")website=true;const host=service.url?.hostname.toLowerCase();if(!host)continue;if(!twitter&&(hostMatches(host,"x.com")||hostMatches(host,"twitter.com")))twitter=true;if(!github&&hostMatches(host,"github.com"))github=true;if(!discord&&(hostMatches(host,"discord.com")||hostMatches(host,"discord.gg")))discord=true;if(!telegram&&(hostMatches(host,"t.me")||hostMatches(host,"telegram.me")))telegram=true}
 const score=Math.min(100,(twitter?25:0)+(website?25:0)+(github?20:0)+(discord?15:0)+(telegram?15:0));return{score,twitter,website,github,discord,telegram};
}
export function computeSocialScore(metadata:Array<{key:string;value:string}>|null|undefined,services:Array<{name:string;endpoint:string}>|null|undefined){return computeSocialFromCanonical(canonicalMetadata(metadata),canonicalServices(services))}
export function scoreSocialDimension(m:Array<{key:string;value:string}>|null|undefined,s:Array<{name:string;endpoint:string}>|null|undefined){return computeSocialScore(m,s).score}
const ENDPOINT=[28,22,16,12,8] as const;
function scoreEndpointsFromCanonical(services:readonly CanonicalService[]){const n=services.length;let p=0;for(let i=0;i<n;i++)p+=i<ENDPOINT.length?ENDPOINT[i]!:4;return Math.min(100,p)}
export function scoreEndpointsDimension(s:Array<{name:string;endpoint:string}>|null|undefined){return scoreEndpointsFromCanonical(canonicalServices(s))}
export function scoreComplianceDimension(w:number,x:boolean,b:boolean){finite(w,"scoreWallet");return Math.min(100,(w>0?25:0)+(x?35:0)+(b?25:0))}
export function scoreFreshnessDimension(d:Date){if(Number.isNaN(d.getTime()))return 0;const h=(Date.now()-d.getTime())/3600000;if(h<=24)return 92;if(h<=72)return 78;if(h<=168)return 62;if(h<=720)return 38;if(h<=2160)return 12;return 0}
export function scorePopularityDimension(n:number){finite(n,"totalFeedback");if(!Number.isSafeInteger(n)||n<0)throw new Error("totalFeedback must be a non-negative safe integer");return Math.min(100,Math.round(Math.log2(n+1)*15))}
export function scoreVerifiedRevenueDimension(i:{isVerifiedRevenue?:boolean;perfWinRate?:number|null;perfMonthlyPnlUsd?:number|null;perfBurnToEarnRatio?:number|null}){if(!i.isVerifiedRevenue)return 0;const w=finite(i.perfWinRate??0,"perfWinRate"),p=finite(i.perfMonthlyPnlUsd??0,"perfMonthlyPnlUsd"),b=i.perfBurnToEarnRatio==null?null:finite(i.perfBurnToEarnRatio,"perfBurnToEarnRatio");return Math.min(100,Math.round(Math.min(w*100*.4,40)+(p>0?30:0)+(b==null?0:Math.max(0,30-b*10))))}
export type AgentScoreDimensions=Omit<AgentScoreResult,"score"|"hotScore">;
function validateAgentScoreDimensions(d:AgentScoreDimensions){finite(d.scoreMetadata,"scoreMetadata");finite(d.scoreEndpoints,"scoreEndpoints");finite(d.scoreSocial,"scoreSocial");finite(d.scoreCompliance,"scoreCompliance");finite(d.scoreFreshness,"scoreFreshness");finite(d.scoreQuality,"scoreQuality");finite(d.scorePopularity,"scorePopularity");finite(d.scoreVerifiedRevenue,"scoreVerifiedRevenue")}
export function combineAgentScoreDimensions(d:AgentScoreDimensions):AgentScoreResult{validateAgentScoreDimensions(d);const score=protocolTrustScoreFromDimensions({metadata:d.scoreMetadata,endpoints:d.scoreEndpoints,social:d.scoreSocial,compliance:d.scoreCompliance,quality:d.scoreQuality,popularity:d.scorePopularity,freshness:d.scoreFreshness,verifiedRevenue:d.scoreVerifiedRevenue});const boost=d.scoreFreshness>=75?1.1:d.scoreFreshness>=45?1.05:1,hotScore=Math.max(0,Math.round(score*boost));finite(score,"score");finite(hotScore,"hotScore");return{...d,score,hotScore}}
export function computeAgentScoreWithSocial(i:AgentScoreInput):{scores:AgentScoreResult;social:AgentSocialScore}{finite(i.scoreQuality,"scoreQuality");const metadata=canonicalMetadata(i.metadata),services=canonicalServices(i.services),metadataWebsite=httpsUrl(getCanonicalMeta(metadata,WEBSITE_META_KEYS)),social=computeSocialFromCanonical(metadata,services,metadataWebsite);return{scores:combineAgentScoreDimensions({scoreMetadata:scoreMetadataFromCanonical(i.name,i.description,i.image,metadata,metadataWebsite),scoreEndpoints:scoreEndpointsFromCanonical(services),scoreSocial:social.score,scoreCompliance:scoreComplianceDimension(i.scoreWallet,i.x402Support,i.binanceCompatible),scoreFreshness:scoreFreshnessDimension(i.lastActiveAt),scoreQuality:clamp100(i.scoreQuality),scorePopularity:scorePopularityDimension(i.totalFeedback),scoreVerifiedRevenue:scoreVerifiedRevenueDimension(i)}),social}}
export function computeAgentScore(i:AgentScoreInput):AgentScoreResult{return computeAgentScoreWithSocial(i).scores}
