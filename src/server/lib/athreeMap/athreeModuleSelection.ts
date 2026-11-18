const MODULE_WORDS: Record<string, string[]> = {
  sea: ['sea', 'ocean', 'samudra', 'samundar', 'sagar', 'beach', 'coast', 'shore', 'waves', 'lehar', 'boat', 'naav', 'island', 'dweep', 'sea level', 'समुद्र', 'समंदर', 'लहर'],
  plants: ['tree', 'trees', 'ped', 'jungle', 'forest', 'grass', 'ghaas', 'plants', 'paudhe', 'bagicha', 'garden', 'woods', 'पेड़', 'पेड़', 'पेड़ों', 'पेड़ों', 'जंगल', 'घास', 'पौधे'],
  rivers: ['river', 'rivers', 'nadi', 'lake', 'talab', 'jheel', 'pond', 'stream', 'waterfall', 'jharna', 'नदी', 'नदियां', 'नदियाँ', 'झील', 'तालाब'],
  sky: ['sky', 'aasmaan', 'asman', 'weather', 'mausam', 'rain', 'baarish', 'barish', 'night', 'raat', 'sunset', 'sunrise', 'cloud', 'clouds', 'baadal', 'fog', 'kohra', 'storm', 'toofan', 'time of day', 'day and night', 'din raat', 'आसमान', 'बारिश', 'मौसम', 'बादल', 'रात'],
  roads: ['road', 'roads', 'sadak', 'highway', 'race', 'racing', 'track', 'circuit', 'runway', 'bridge', 'pul', 'city', 'village', 'gaon', 'street', 'town', 'सड़क', 'सड़क', 'पुल', 'गांव'],
  vehicles: ['car', 'cars', 'gaadi', 'gadi', 'bike', 'bikes', 'motorcycle', 'drive', 'driving', 'vehicle', 'vehicles', 'racing', 'race', 'truck', 'कार', 'कारें', 'गाड़ी', 'गाड़ी', 'बाइक', 'वाहन'],
};
const ALL_WORDS = ['everything', 'sab kuch', 'sabkuch', 'poora', 'pura', 'full map', 'all modules', 'sabhi', 'all of it', 'complete map', 'सब कुछ', 'सभी'];

export interface AthreeModules { modules:string[]; excluded:string[]; reason:string }
/** Bounded phrase grammar, not general natural-language understanding. Explicit exclusions win.
 * Prefix no/without/except extends through a list until punctuation or a positive reset.
 * Hindi/Hinglish nahi/mat immediately after a feature belongs to that feature only.
 */
export function athreeModulesFor(prompt:string):AthreeModules {
 const tokens=String(prompt??'').normalize('NFKC').toLowerCase().replace(/don['’]t/g,'dont').replace(/\b(no|without|exclude) (?:optional )?modules\b/g,'$1 all modules').match(/[a-z0-9\u0900-\u097f]+|[.,;!?\n]/g)??[];
 const all=Object.keys(MODULE_WORDS), hits:Record<string,string[]>={},excluded=new Set<string>();
 const prefix=new Set(['no','not','never','without','except','exclude','excluding','avoid','remove','dont','बिना','हटाओ','छोड़कर']);
 const suffix=new Set(['nahi','nahin','nhi','mat','नहीं','नही','मत']);
 const reset=new Set(['but','with','add','include','want','chahiye','chaiye','चाहिए','चाहिये','लेकिन','मगर','साथ']);
 const connectors=new Set(['and','or','aur','ya','और','या','bhi','भी','ko','को','bilkul','बिल्कुल']);
 type Mention={start:number;end:number;modules:string[];word:string;all:boolean};
 const mentions:Mention[]=[];
 for(let i=0;i<tokens.length;i++) {
  let best=0,mods:string[]=[],word='',whole=false;
  for(const [m,words] of [...Object.entries(MODULE_WORDS),['*',ALL_WORDS] as [string,string[]]])for(const phrase of words) {
   const p=phrase.split(' ');if(p.length<best||!p.every((t,j)=>tokens[i+j]===t))continue;
   if(p.length>best){best=p.length;mods=[];whole=false;word=phrase;}
   if(m==='*')whole=true;else if(!mods.includes(m))mods.push(m);
  }
  if(best){mentions.push({start:i,end:i+best,modules:mods,word,all:whole});i+=best-1;}
 }
 const consumed=new Set<number>(),negative=new Set<Mention>();
 for(let k=0;k<mentions.length;k++) {
  const m=mentions[k],next=mentions[k+1]?.start??tokens.length;
  // A postfix negative applies only across optional particles, never another feature or clause.
  for(let j=m.end;j<next;j++) {
   if(suffix.has(tokens[j]) || (tokens[j]==='not' && ['needed','wanted','required','allowed'].includes(tokens[j+1]))){
    negative.add(m);consumed.add(j);
    // Hindi/Hinglish list suffix: ped aur gaadi nahi excludes both named features.
    for(let prev=k-1;prev>=0;prev--){
     const gap=tokens.slice(mentions[prev].end,mentions[prev+1].start);
     if(!gap.length||!gap.every(t=>connectors.has(t)))break;
     negative.add(mentions[prev]);
    }
    break;
   }
   if(!connectors.has(tokens[j]) && !['is','are','should','be'].includes(tokens[j]))break;
  }
 }
 const at=new Map(mentions.map(m=>[m.start,m]));let neg=false,wantsAll=false,negativeHasFeature=false;
 for(let i=0;i<tokens.length;i++) {
  const t=tokens[i];if(consumed.has(i))continue;
  const m=at.get(i);
  if(m){const denied=neg||negative.has(m);const mods=m.all?all:m.modules;
   if(m.all&&!denied)wantsAll=true;
   for(const mod of mods){if(denied)excluded.add(mod);else if(!m.all)(hits[mod]??=[]).push(m.word);}
   if(neg)negativeHasFeature=true; i=m.end-1;continue;
  }
  if(t==='not' && tokens[i+1]==='only')continue;
  if(prefix.has(t)||suffix.has(t)){neg=true;negativeHasFeature=false;}
  else if(reset.has(t)||/^[.,;!?\n]$/.test(t)){
   // do not include/add/want X is still a negative prefix, not a positive reset.
   if(!(neg&&!negativeHasFeature&&['add','include','want','chahiye','chaiye','चाहिए','चाहिये'].includes(t))){neg=false;negativeHasFeature=false;}
  }
 }
 const chosen=(wantsAll||mentions.length===0?all:all.filter(m=>hits[m])).filter(m=>!excluded.has(m));
 const denied=all.filter(m=>excluded.has(m));
 const reason=(wantsAll?'The request asks for everything except explicit exclusions.':mentions.length===0?'The request names no particular feature, so every module is included.':'Only what the request asks for: '+chosen.map(m=>m+' ('+(hits[m]??[]).slice(0,2).join(', ')+')').join('; ')+'.')+(denied.length?' Excluded by request: '+denied.join(', ')+'.':'');
 return {modules:chosen,excluded:denied,reason};
}
/** Use for model-supplied include: it may narrow selection but never override owner exclusions. */
export function enforceAthreeModuleExclusions(include:readonly string[],decision:AthreeModules):string[] {
 const result:string[]=[];
 for(const raw of include){const m=raw.toLowerCase().trim();if(decision.excluded.includes(m))throw new Error('User excluded Athree module: '+m);if(!result.includes(m))result.push(m);}
 // Keep native generator diagnostics for unknown include names; do not change legacy acceptance.
 return result;
}
