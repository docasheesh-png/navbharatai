import { jsxDevRuntimeUrl } from './jsxDevRuntimeFacade';
import type { FileSystem } from '../types/index';

// ── Preview harness: injected into EVERY preview so it can never silently go blank ──
// Catches runtime errors + detects empty render → shows a friendly overlay instead of a white page.
export const PREVIEW_HARNESS = `<style>
.__nb_overlay{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;background:#0d1117;font-family:system-ui,-apple-system,sans-serif;z-index:2147483647}
.__nb_card{max-width:520px;width:100%;background:#161b22;border:1px solid rgba(245,158,11,0.25);border-radius:16px;padding:24px;color:#c9d1d9;box-sizing:border-box}
.__nb_h{font-weight:800;color:#f59e0b;font-size:13px;margin-bottom:10px;text-transform:uppercase;letter-spacing:.06em}
.__nb_card pre{white-space:pre-wrap;word-break:break-word;background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:10px;font-size:11px;line-height:1.5;color:#ff7b72;max-height:180px;overflow:auto;margin:0}
.__nb_s{margin-top:12px;font-size:12px;color:#8b949e;line-height:1.5}
.__nb_btn{margin-top:14px;display:inline-block;padding:9px 16px;border-radius:8px;border:none;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit}
.__nb_btn_ai{background:#2ea043;color:#fff}
.__nb_btn_ai:hover{background:#3fb950}
.__nb_btn_code{background:#30363d;color:#c9d1d9;border:1px solid #484f58}
.__nb_btn_code:hover{background:#3a414b}
</style>
<script>
(function(){
  function esc(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;");}
  function classifyBug(kind,msg){
    var m=String(msg||'');
    var sysPatterns=[/Could not load the preview compiler/i,/Failed to load React from CDN/i,/network blocked/i,/CORS/i,/Failed to fetch dynamically imported module/i,/ChunkLoadError/i,/Loading chunk/i,/NetworkError/i,/ERR_INTERNET_DISCONNECTED/i,/ERR_CONNECTION/i,/insecure/i];
    for(var i=0;i<sysPatterns.length;i++){if(sysPatterns[i].test(m))return 'coding';}
    return 'ai';
  }
  function buildAiPrompt(kind,msg){
    return 'Preview me ek bug aaya hai. Root-cause audit karo aur SIRF is specific bug ko fix karo — kisi bhi dusri working feature ya unrelated file ko mat todna/change karna.\\n\\nError type: '+kind+'\\nError message: '+msg+'\\n\\nInstructions:\\n1. Exact file aur line dhundo jo is error ki wajah hai.\\n2. Root cause identify karo (sirf symptom nahi).\\n3. Minimal fix apply karo jo zaroori hai.\\n4. App ke kisi aur part ko modify/remove/refactor mat karo.\\n5. Fix ke baad preview bina error ke render hona chahiye.';
  }
  function buildCodeReport(kind,msg){
    return '=== NavBharatAI Preview Bug Report ===\\nType: Coding/System issue (manual fix needed)\\nKind: '+kind+'\\nMessage: '+msg+'\\nURL: '+location.href+'\\nUserAgent: '+navigator.userAgent+'\\nTime: '+new Date().toISOString();
  }
  function copyText(text){
    var ok=false;
    try{if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text);ok=true;}}catch(e){}
    if(!ok){
      try{
        var ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.left='-9999px';
        document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);ok=true;
      }catch(e){}
    }
    return ok;
  }
  function show(kind,msg){
    if(document.getElementById('__nb_err'))return;
    var cls=classifyBug(kind,msg);
    var btnHtml=cls==='ai'
      ? '<button id="__nb_fixbtn" class="__nb_btn __nb_btn_ai">Fix Bug</button>'
      : '<button id="__nb_fixbtn" class="__nb_btn __nb_btn_code">Coding Bug</button>';
    var o=document.createElement('div');o.id='__nb_err';o.className='__nb_overlay';
    o.innerHTML='<div class="__nb_card"><div class="__nb_h">'+esc(kind)+'</div>'+(msg?('<pre>'+esc(msg)+'</pre>'):'')+'<div class="__nb_s">All files are loaded in Code Studio. Ask the AI to fix or convert this app and the preview will update.</div>'+btnHtml+'<div id="__nb_fixmsg" class="__nb_s" style="display:none"></div></div>';
    (document.body||document.documentElement).appendChild(o);
    var btn=document.getElementById('__nb_fixbtn');
    if(!btn)return;
    btn.addEventListener('click',function(){
      var fm=document.getElementById('__nb_fixmsg');
      if(cls==='ai'){
        var prompt=buildAiPrompt(kind,msg);
        try{window.parent.postMessage({type:'nb-ai-fix',prompt:prompt},'*');}catch(e){}
        if(fm){fm.style.display='block';fm.textContent='Prompt chat box me bhar diya gaya — Send dabao fix karne ke liye.';}
      }else{
        var report=buildCodeReport(kind,msg);
        var copied=copyText(report);
        try{window.parent.postMessage({type:'nb-code-bug',report:report},'*');}catch(e){}
        if(fm){fm.style.display='block';fm.textContent=copied?'Bug report clipboard me copy ho gaya.':'Auto-copy nahi hua — manually copy karein.';}
      }
    });
  }
  window.__nbShowError=function(m){show('Preview Error',m);};
  window.addEventListener('error',function(e){show('Preview Error',(e&&e.message)||(e&&e.error&&e.error.message)||'Script error');});
  window.addEventListener('unhandledrejection',function(e){show('Preview Error',(e&&e.reason&&e.reason.message)||(e&&e.reason)||'Promise rejected');});
  function isEmpty(){
    if(window.__nbLoading)return false;
    var t=(document.body&&document.body.innerText||'').trim();
    var v=document.querySelector('canvas,svg,img,video,input,button,#root *,#app *,[data-reactroot] *');
    return !t&&!v;
  }
  // Check at 4s then 7s — React+CDN can take 4-6s on slow connections; don't show false "empty" while loading.
  setTimeout(function(){
    if(document.getElementById('__nb_err')||!isEmpty())return;
    setTimeout(function(){
      if(!document.getElementById('__nb_err')&&isEmpty())show('Preview is empty','The app rendered nothing — it may need a build step, or hit a runtime error.');
    },3000);
  },4000);
})();
</script>`;

// In-iframe mini-bundler: transpiles JSX/TSX with Babel, resolves relative imports,
// and loads ALL bare deps via esm.sh (importmap from package.json). Failures surface via the harness.
export const PREVIEW_BOOTSTRAP = `
(function(){
  var FILES=window.__FILES||{};var ENTRY=window.__ENTRY||'';var IMAP=window.__IMAP||{};var ESM='https://esm.sh/';
  // Polyfill import.meta.env (Vite) and process.env (Node/CRA) so apps don't throw on startup
  if(typeof process==='undefined')window.process={env:{NODE_ENV:'production'}};
  window.__importMetaEnv__=window.__importMetaEnv__||{};
  function fail(m){if(window.__nbShowError)window.__nbShowError(m);}
  function loadScript(url){return new Promise(function(res){var s=document.createElement('script');s.src=url;s.onload=res;s.onerror=res;document.head.appendChild(s);});}
  function dirname(p){var i=p.lastIndexOf('/');return i<0?'':p.slice(0,i);}
  function normalize(p){var a=p.split('/'),o=[];for(var i=0;i<a.length;i++){var s=a[i];if(s===''||s==='.')continue;if(s==='..')o.pop();else o.push(s);}return o.join('/');}
  function resolve(importer,spec){
    var base=spec.charAt(0)==='/'?spec.slice(1):normalize((dirname(importer)?dirname(importer)+'/':'')+spec);
    var t=[base,base+'.tsx',base+'.ts',base+'.jsx',base+'.js',base+'.mjs',base+'.json',base+'.css',base+'/index.tsx',base+'/index.ts',base+'/index.jsx',base+'/index.js'];
    for(var i=0;i<t.length;i++){if(Object.prototype.hasOwnProperty.call(FILES,t[i]))return t[i];}
    return base;
  }
  function injectCss(src){var s=document.createElement('style');s.textContent=src;document.head.appendChild(s);}
  function interop(ns){
    if(!ns)return{__esModule:true,default:ns};
    var m={__esModule:true};
    // Object.assign copies enumerable own props (works for most modules)
    try{Object.assign(m,ns);}catch(e){}
    // getOwnPropertyNames also catches non-enumerable own props on ES module namespace objects
    try{Object.getOwnPropertyNames(ns).forEach(function(k){if(k==='__esModule')return;try{if(m[k]==null)m[k]=ns[k];}catch(e){}});}catch(e){}
    if(m.default===undefined)m.default=ns;
    return m;
  }
  var bareCache={},cache={};
  function requireMod(path){
    if(cache[path])return cache[path].exports;
    var src=FILES[path];
    if(src==null)throw new Error('Module not found: '+path);
    if(/\\.css$/.test(path)){injectCss(src);cache[path]={exports:{}};return cache[path].exports;}
    if(/\\.json$/.test(path)){cache[path]={exports:JSON.parse(src)};return cache[path].exports;}
    if(/\\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/.test(path)){cache[path]={exports:{default:src,__esModule:true}};return cache[path].exports;}
    var isTs=/\\.tsx?$/.test(path),isTsx=/\\.tsx$/.test(path);
    var presets=isTs?[['react',{runtime:'automatic'}],['typescript',{isTSX:isTsx,allExtensions:true,allowDeclareFields:true}]]:[['react',{runtime:'automatic'}]];
    // Replace import.meta.* — not valid inside new Function() (non-module context)
    src=src.replace(/import\\.meta\\.env\\b/g,'(window.__importMetaEnv__||{})');
    src=src.replace(/import\\.meta\\.url\\b/g,'location.href');
    src=src.replace(/import\\.meta\\b/g,'{env:(window.__importMetaEnv__||{}),url:location.href}');
    var code;
    try{code=Babel.transform(src,{filename:path,presets:presets,plugins:['transform-modules-commonjs'],sourceType:'module'}).code;}
    catch(e){throw new Error('Compile '+path+': '+e.message);}
    var module={exports:{}};cache[path]=module;
    var req=function(spec){
      // Vite/shadcn-style @/ alias (e.g. @/components/ui/button) → resolve under src/
      if(spec.length>2&&spec.charAt(0)==='@'&&spec.charAt(1)==='/'){return requireMod(resolve(path,'/src/'+spec.slice(2)));}
      if(spec.charAt(0)!=='.'&&spec.charAt(0)!=='/'){if(bareCache[spec])return bareCache[spec];throw new Error('Missing dependency: '+spec);}
      return requireMod(resolve(path,spec));
    };
    try{(new Function('require','module','exports',code))(req,module,module.exports);}
    catch(e){throw new Error('Run '+path+': '+e.message);}
    return module.exports;
  }
  function collectBare(){
    var found={},re=/(?:from|import|require\\(|import\\()\\s*['"]([^'"]+)['"]/g;
    Object.keys(FILES).forEach(function(p){var src=FILES[p]||'',m;re.lastIndex=0;while((m=re.exec(src))){var s=m[1];if(s&&s.charAt(0)!=='.'&&s.charAt(0)!=='/'&&!(s.charAt(0)==='@'&&s.charAt(1)==='/'))found[s]=true;}});
    return Object.keys(found);
  }
  // Resolve a bare import spec against an importmap: map hit first, then esm.sh.
  function specUrlFrom(map,spec){
    // Already a full URL (https://) or protocol-relative (//) — use as-is
    if(spec.indexOf('://')>0||spec.slice(0,2)==='//')return spec;
    if(map[spec])return map[spec];
    var root=spec.charAt(0)==='@'?spec.split('/').slice(0,2).join('/'):spec.split('/')[0];
    // Sub-path insertion only works on esm.sh bases — a vendored same-origin facade module has no
    // sub-path files, so an unmapped deep import of a vendored root goes to plain esm.sh instead.
    if(map[root]&&map[root].indexOf(ESM)===0){
      // Insert the subpath BEFORE any query string, else "zustand/middleware"
      // becomes ".../zustand@4?external=react,react-dom/middleware" (subpath
      // swallowed into the query) → wrong module → "persist is not a function".
      var b=map[root],q='',qi=b.indexOf('?');
      if(qi>=0){q=b.slice(qi);b=b.slice(0,qi);}
      return b+spec.slice(root.length)+q;
    }
    return ESM+spec;
  }
  // Primary map (may point React at the same-origin vendored runtime) and the pure-CDN map the
  // per-spec fallback retries from when a vendored facade fails to load.
  var CDNIMAP=window.__CDN_IMAP||IMAP;
  function specUrl(spec){return specUrlFrom(IMAP,spec);}
  function specUrlCdn(spec){return specUrlFrom(CDNIMAP,spec);}
  var forced=['react','react-dom','react-dom/client','react/jsx-runtime','react/jsx-dev-runtime'];
  window.__nbLoading=true;
  (async function(){
    try{
      // Primary compiler is self-hosted (same-origin <script src> in <head>). If that
      // failed, fall back through multiple CDNs before giving up.
      var babelCdns=['https://cdn.jsdelivr.net/npm/@babel/standalone@7.26.4/babel.min.js','https://unpkg.com/@babel/standalone@7.26.4/babel.min.js','https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.26.4/babel.min.js'];
      for(var bi=0;bi<babelCdns.length&&typeof Babel==='undefined';bi++){await loadScript(babelCdns[bi]);}
      if(typeof Babel==='undefined'){window.__nbLoading=false;fail('Could not load the preview compiler (network blocked?). Check internet connection.');return;}
      var bare;try{bare=collectBare();}catch(ce){bare=[];}
      forced.forEach(function(s){if(bare.indexOf(s)<0)bare.push(s);});
      var failedDeps=[];
      await Promise.all(bare.map(async function(spec){
        try{bareCache[spec]=interop(await import(specUrl(spec)));}
        catch(e){
          // The primary URL failed (e.g. the same-origin vendored React facade could not load its
          // UMD). Retry ONCE from the pure-CDN map before recording the dep as failed.
          var alt=specUrlCdn(spec);
          if(alt!==specUrl(spec)){
            try{bareCache[spec]=interop(await import(alt));console.warn('[preview] loaded',spec,'from the CDN after the same-origin runtime failed');return;}
            catch(e2){failedDeps.push(spec);console.warn('[preview] failed to load',spec,e2&&e2.message);return;}
          }
          failedDeps.push(spec);console.warn('[preview] failed to load',spec,e&&e.message);
        }
      }));
      // BUG A2 FIX: Only hard-fail on React load error if the app actually imports React.
      // Vanilla ES module apps don't need React — killing them here was wrong.
      var needsReact=bare.indexOf('react')>=0||bare.indexOf('react-dom')>=0;
      if(needsReact&&(!bareCache['react']||!bareCache['react-dom/client'])){
        window.__nbLoading=false;
        fail('Failed to load React from CDN'+(failedDeps.length?' (blocked: '+failedDeps.slice(0,3).join(', ')+')':'')+'. Check internet connection.');
        return;
      }
      if(!ENTRY){window.__nbLoading=false;fail('No runnable entry file found in this app.');return;}
      var mod=requireMod(ENTRY);
      // Auto-mount: if the entry only exports a React component (no ReactDOM.render call),
      // mount it automatically so component-only entry files work without a separate main.jsx.
      if(mod&&!document.getElementById('__nb_err')){
        var rootEl=document.getElementById('root')||document.getElementById('app');
        if(rootEl&&rootEl.childElementCount===0){
          var Comp=mod.default||(typeof mod==='function'?mod:null);
          if(Comp&&typeof Comp==='function'){
            var rdc=bareCache['react-dom/client'],jsx=bareCache['react/jsx-runtime'],rc=bareCache['react'];
            try{
              var el=(jsx&&jsx.jsx)?jsx.jsx(Comp,{}):(rc&&rc.createElement)?rc.createElement(Comp,null):null;
              if(el){if(rdc&&rdc.createRoot)rdc.createRoot(rootEl).render(el);else if(rdc&&rdc.render)rdc.render(el,rootEl);}
            }catch(ae){}
          }
        }
      }
    }catch(e){fail((e&&e.message)||String(e));}
    finally{window.__nbLoading=false;}
  })();
})();`;

// ── Universal multi-format file viewer ───────────────────────────────────────
// Renders ANY file type when a workspace has no index.html: markdown, source code
// (syntax-highlighted), JSON, CSV/TSV tables, images, SVG, PDF, audio, video, HTML
// and plain text. Self-contained doc with a file sidebar; CDN libs degrade gracefully.
export const UNIVERSAL_VIEWER_CSS = `
:root{color-scheme:dark}*{box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:#0d1117;color:#c9d1d9}
.nbv-app{display:flex;height:100vh;width:100vw;overflow:hidden}
.nbv-side{width:248px;min-width:248px;background:#161b22;border-right:1px solid #21262d;display:flex;flex-direction:column;overflow:hidden}
.nbv-brand{padding:13px 14px;font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:#8b949e;border-bottom:1px solid #21262d;display:flex;align-items:center;gap:6px}
.nbv-cnt{margin-left:auto;font-weight:600;color:#6e7681;font-size:10px}
.nbv-list{overflow:auto;flex:1;padding:6px}
.nbv-fileitem{display:flex;align-items:center;gap:8px;width:100%;border:0;background:transparent;color:#adbac7;text-align:left;padding:7px 9px;border-radius:8px;cursor:pointer;font-size:12.5px;font-family:inherit}
.nbv-fileitem:hover{background:#1c2330}
.nbv-fileitem.active{background:rgba(31,111,235,.22);color:#fff}
.nbv-ico{flex:0 0 auto;font-size:13px;width:16px;text-align:center}
.nbv-ftxt{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nbv-main{flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0}
.nbv-topbar{display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid #21262d;background:#0d1117;flex:0 0 auto}
.nbv-mobilesel{display:none;background:#161b22;color:#c9d1d9;border:1px solid #30363d;border-radius:8px;padding:6px 10px;font-size:12px;max-width:60%}
.nbv-head{display:flex;align-items:center;gap:10px;min-width:0}
.nbv-fname{font-weight:700;font-size:13px;color:#e6edf3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nbv-badge{font-size:9px;font-weight:800;letter-spacing:.08em;background:rgba(31,111,235,.13);color:#58a6ff;border:1px solid rgba(31,111,235,.27);padding:2px 6px;border-radius:6px;flex:0 0 auto}
.nbv-size{font-size:10px;color:#6e7681;flex:0 0 auto}
.nbv-content{flex:1;overflow:auto;position:relative;min-height:0}
.nbv-md{max-width:880px;margin:0 auto;padding:28px 36px;line-height:1.65;font-size:15px}
.nbv-md h1,.nbv-md h2{border-bottom:1px solid #21262d;padding-bottom:.3em}
.nbv-md h1,.nbv-md h2,.nbv-md h3,.nbv-md h4{color:#e6edf3;margin-top:1.4em}
.nbv-md a{color:#58a6ff;text-decoration:none}.nbv-md a:hover{text-decoration:underline}
.nbv-md code{background:#161b22;border:1px solid #21262d;border-radius:5px;padding:.15em .4em;font-size:.88em}
.nbv-md pre{background:#161b22;border:1px solid #21262d;border-radius:10px;padding:14px;overflow:auto}
.nbv-md pre code{background:transparent;border:0;padding:0}
.nbv-md table{border-collapse:collapse;width:100%;margin:1em 0}
.nbv-md th,.nbv-md td{border:1px solid #30363d;padding:6px 12px}
.nbv-md img{max-width:100%}
.nbv-md blockquote{border-left:3px solid #30363d;margin:1em 0;padding:0 1em;color:#8b949e}
.nbv-codewrap{display:flex;min-height:100%}
.nbv-gutter{user-select:none;text-align:right;padding:16px 10px;color:#484f58;font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;background:#0d1117;border-right:1px solid #21262d;white-space:pre;flex:0 0 auto}
.nbv-code{margin:0;flex:1;padding:16px;overflow:auto;font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;background:#0d1117!important}
.nbv-code code{font:inherit;background:transparent;white-space:pre}
.nbv-pre{margin:0;padding:18px;white-space:pre-wrap;word-break:break-word;font:12.5px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;color:#c9d1d9}
.nbv-tablewrap{padding:16px;overflow:auto}
.nbv-tablemeta{font-size:11px;color:#6e7681;margin-bottom:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em}
.nbv-table{border-collapse:collapse;font-size:12.5px}
.nbv-table th{position:sticky;top:0;background:#1b2433;color:#58a6ff;font-weight:700}
.nbv-table th,.nbv-table td{border:1px solid #21262d;padding:6px 12px;text-align:left;white-space:nowrap}
.nbv-table tbody tr:nth-child(even){background:#0f141b}
.nbv-media{display:flex;align-items:center;justify-content:center;min-height:100%;padding:24px}
.nbv-checker{background-image:linear-gradient(45deg,#161b22 25%,transparent 25%),linear-gradient(-45deg,#161b22 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#161b22 75%),linear-gradient(-45deg,transparent 75%,#161b22 75%);background-size:20px 20px;background-position:0 0,0 10px,10px -10px,-10px 0}
.nbv-img{max-width:100%;max-height:88vh;object-fit:contain;box-shadow:0 8px 40px rgba(0,0,0,.5);border-radius:4px}
.nbv-svg{max-width:90%;max-height:80vh}
.nbv-pdf{width:100%;height:100%;border:0;position:absolute;inset:0}
.nbv-htmlframe{width:100%;height:100%;border:0;background:#fff;position:absolute;inset:0}
.nbv-audio{width:80%;max-width:520px}
.nbv-video{max-width:100%;max-height:85vh;border-radius:6px}
.nbv-note{padding:18px;margin:24px;background:#161b22;border:1px solid rgba(245,158,11,.27);border-radius:10px;color:#d29922;font-size:13px;max-width:600px}
.nbv-single .nbv-side{display:none}
@media(max-width:680px){.nbv-side{display:none}.nbv-mobilesel{display:block}}`;

export const UNIVERSAL_VIEWER_JS = `
(function(){
  var V=window.__NBV||{};var FILES=V.files||{};
  var paths=Object.keys(FILES).filter(function(p){return FILES[p]!=null;});
  function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  function base(p){return p.split('/').pop();}
  function extOf(p){var b=base(p),i=b.lastIndexOf('.');return i>0?b.slice(i+1).toLowerCase():'';}
  function bytes(s){try{return new Blob([s]).size;}catch(e){return (s||'').length;}}
  function human(n){return n<1024?n+' B':n<1048576?(n/1024).toFixed(1)+' KB':(n/1048576).toFixed(2)+' MB';}
  function mimeFor(e){var m={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',bmp:'image/bmp',ico:'image/x-icon',avif:'image/avif',svg:'image/svg+xml',pdf:'application/pdf',mp3:'audio/mpeg',wav:'audio/wav',ogg:'audio/ogg',m4a:'audio/mp4',aac:'audio/aac',flac:'audio/flac',mp4:'video/mp4',webm:'video/webm',mov:'video/quicktime',mkv:'video/x-matroska'};return m[e]||'application/octet-stream';}
  function typeOf(p){var e=extOf(p);
    if(/^(md|markdown|mdx)$/.test(e))return 'md';
    if(/^(png|jpg|jpeg|gif|webp|bmp|ico|avif|apng)$/.test(e))return 'img';
    if(e==='svg')return 'svg';
    if(e==='pdf')return 'pdf';
    if(/^(mp3|wav|ogg|m4a|aac|flac)$/.test(e))return 'audio';
    if(/^(mp4|webm|mov|mkv|avi|m4v)$/.test(e))return 'video';
    if(/^(csv|tsv)$/.test(e))return 'csv';
    if(/^(json|jsonc|geojson|map|json5)$/.test(e))return 'json';
    if(/^(html|htm)$/.test(e))return 'html';
    if(/^(txt|text|log)$/.test(e)||e==='')return 'text';
    return 'code';}
  var ICON={md:'📝',img:'🖼️',svg:'🖼️',pdf:'📕',audio:'🎵',video:'🎬',csv:'📊',json:'🔧',html:'🌐',text:'📄',code:'❮❯'};
  var LANG={js:'javascript',mjs:'javascript',cjs:'javascript',jsx:'javascript',ts:'typescript',tsx:'typescript',py:'python',rb:'ruby',go:'go',rs:'rust',java:'java',c:'c',h:'c',cpp:'cpp',cc:'cpp',hpp:'cpp',cs:'csharp',php:'php',swift:'swift',kt:'kotlin',kts:'kotlin',scala:'scala',sh:'bash',bash:'bash',zsh:'bash',sql:'sql',yaml:'yaml',yml:'yaml',toml:'ini',ini:'ini',cfg:'ini',conf:'ini',xml:'xml',vue:'xml',svelte:'xml',css:'css',scss:'scss',less:'less',dart:'dart',lua:'lua',r:'r',pl:'perl',ex:'elixir',exs:'elixir',clj:'clojure',hs:'haskell',gradle:'gradle',dockerfile:'dockerfile',makefile:'makefile',json:'json'};
  function srcFor(p,c,t){c=c||'';var s=c.trim();
    if(/^(data:|https?:\\/\\/|blob:)/.test(s))return s;
    if(t==='svg')return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(c);
    var b=c.replace(/\\s+/g,'');
    if(/^[A-Za-z0-9+/=]+$/.test(b)&&b.length>16)return 'data:'+mimeFor(extOf(p))+';base64,'+b;
    return s;}
  function parseDelim(c,d){var rows=[],row=[],cur='',q=false,i=0,ch;
    for(;i<c.length;i++){ch=c[i];
      if(q){if(ch==='"'){if(c[i+1]==='"'){cur+='"';i++;}else q=false;}else cur+=ch;}
      else{if(ch==='"')q=true;else if(ch===d){row.push(cur);cur='';}else if(ch==='\\n'){row.push(cur);rows.push(row);row=[];cur='';}else if(ch==='\\r'){}else cur+=ch;}}
    if(cur!==''||row.length){row.push(cur);rows.push(row);}
    return rows;}
  function rMd(c){var d=document.createElement('article');d.className='nbv-md';
    try{if(window.marked&&window.DOMPurify){var mk=window.marked.parse(c,{breaks:true,gfm:true});d.innerHTML=window.DOMPurify.sanitize(mk);if(window.hljs)d.querySelectorAll('pre code').forEach(function(b){try{window.hljs.highlightElement(b);}catch(e){}});return d;}}catch(e){}
    var pre=document.createElement('pre');pre.className='nbv-pre';pre.textContent=c;d.appendChild(pre);return d;}
  function rCode(c,lang){var wrap=document.createElement('div');wrap.className='nbv-codewrap';
    var gut=document.createElement('div');gut.className='nbv-gutter';var n=c.split('\\n').length;var g='';for(var k=1;k<=n;k++)g+=k+'\\n';gut.textContent=g;
    var pre=document.createElement('pre');pre.className='nbv-code hljs';var code=document.createElement('code');
    try{if(window.hljs){var r=(lang&&window.hljs.getLanguage(lang))?window.hljs.highlight(c,{language:lang}):window.hljs.highlightAuto(c);code.innerHTML=r.value;}else code.textContent=c;}catch(e){code.textContent=c;}
    pre.appendChild(code);wrap.appendChild(gut);wrap.appendChild(pre);return wrap;}
  function rJson(c){var t=c;try{t=JSON.stringify(JSON.parse(c),null,2);}catch(e){}return rCode(t,'json');}
  function rCsv(c,d){var rows=parseDelim(c,d);var wrap=document.createElement('div');wrap.className='nbv-tablewrap';
    if(!rows.length){wrap.textContent='(empty)';return wrap;}
    var meta=document.createElement('div');meta.className='nbv-tablemeta';meta.textContent=rows.length+' rows × '+(rows[0]?rows[0].length:0)+' cols';wrap.appendChild(meta);
    var t=document.createElement('table');t.className='nbv-table';var thead=document.createElement('thead');var htr=document.createElement('tr');
    rows[0].forEach(function(h){var th=document.createElement('th');th.textContent=h;htr.appendChild(th);});thead.appendChild(htr);t.appendChild(thead);
    var tb=document.createElement('tbody');for(var r=1;r<rows.length;r++){var tr=document.createElement('tr');rows[r].forEach(function(cell){var td=document.createElement('td');td.textContent=cell;tr.appendChild(td);});tb.appendChild(tr);}
    t.appendChild(tb);wrap.appendChild(t);return wrap;}
  function rImg(p,c,t){var d=document.createElement('div');d.className='nbv-media nbv-checker';var img=document.createElement('img');img.className='nbv-img';img.alt=base(p);
    img.onerror=function(){d.innerHTML='';var note=document.createElement('div');note.className='nbv-note';note.textContent='Cannot display this image. Showing raw content:';d.appendChild(note);d.appendChild(rCode(c,'xml'));};
    img.src=srcFor(p,c,t);d.appendChild(img);return d;}
  function rSvg(p,c){var d=document.createElement('div');d.className='nbv-media nbv-checker';
    try{if(window.DOMPurify){d.innerHTML=window.DOMPurify.sanitize(c,{USE_PROFILES:{svg:true,svgFilters:true}});var s=d.querySelector('svg');if(s)s.classList.add('nbv-svg');return d;}}catch(e){}
    var img=document.createElement('img');img.className='nbv-img';img.src=srcFor(p,c,'svg');d.appendChild(img);return d;}
  function rPdf(p,c){var s=srcFor(p,c,'pdf');if(!/^(data:|https?:|blob:)/.test(s)){var note=document.createElement('div');note.className='nbv-note';note.textContent='PDF preview needs a data: URL or http(s) link; this file has no renderable PDF data.';return note;}var o=document.createElement('iframe');o.className='nbv-pdf';o.src=s;return o;}
  function rMedia(p,c,t){var d=document.createElement('div');d.className='nbv-media';var el=document.createElement(t==='audio'?'audio':'video');el.className='nbv-'+t;el.controls=true;el.src=srcFor(p,c,t);d.appendChild(el);return d;}
  function rHtml(c){var f=document.createElement('iframe');f.className='nbv-htmlframe';f.setAttribute('sandbox','allow-scripts allow-forms allow-popups allow-modals');f.srcdoc=c;return f;}
  function rText(c){var pre=document.createElement('pre');pre.className='nbv-pre';pre.textContent=c;return pre;}
  function render(p){var c=FILES[p]||'';var t=typeOf(p);
    if(t==='md')return rMd(c);
    if(t==='img')return rImg(p,c,t);
    if(t==='svg')return rSvg(p,c);
    if(t==='pdf')return rPdf(p,c);
    if(t==='audio'||t==='video')return rMedia(p,c,t);
    if(t==='csv')return rCsv(c,extOf(p)==='tsv'?'\\t':',');
    if(t==='json')return rJson(c);
    if(t==='html')return rHtml(c);
    if(t==='text')return rText(c);
    return rCode(c,LANG[extOf(p)]||null);}
  function select(p){
    var items=document.querySelectorAll('.nbv-fileitem');for(var i=0;i<items.length;i++)items[i].classList.toggle('active',items[i].getAttribute('data-p')===p);
    var sel=document.getElementById('nbv-select');if(sel)sel.value=p;
    var c=FILES[p]||'',t=typeOf(p);
    var head=document.getElementById('nbv-head');head.innerHTML='';
    var name=document.createElement('span');name.className='nbv-fname';name.textContent=ICON[t]+' '+p;
    var badge=document.createElement('span');badge.className='nbv-badge';badge.textContent=t.toUpperCase();
    var size=document.createElement('span');size.className='nbv-size';size.textContent=human(bytes(c));
    head.appendChild(name);head.appendChild(badge);head.appendChild(size);
    var body=document.getElementById('nbv-body');body.innerHTML='';
    try{body.appendChild(render(p));}catch(e){var er=document.createElement('pre');er.className='nbv-pre';er.textContent='Render error: '+((e&&e.message)||e);body.appendChild(er);}}
  function pickPrimary(){
    if(V.primary&&FILES[V.primary]!=null)return V.primary;
    var pri=['README.md','readme.md','Readme.md','index.md','index.html','index.htm'];
    for(var i=0;i<pri.length;i++)if(FILES[pri[i]]!=null)return pri[i];
    var md=paths.filter(function(p){return typeOf(p)==='md';});if(md.length)return md[0];
    var docs=paths.filter(function(p){return typeOf(p)!=='code';});if(docs.length)return docs[0];
    return paths[0];}
  if(paths.length===0){document.body.innerHTML='<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:#6e7681;font-family:system-ui;text-align:center"><div><div style="font-size:42px">📂</div><div style="margin-top:10px;font-size:14px">No files to preview yet.</div></div></div>';return;}
  paths.sort();
  var sb=document.getElementById('nbv-files');var selEl=document.getElementById('nbv-select');
  paths.forEach(function(p){var t=typeOf(p);
    var it=document.createElement('button');it.className='nbv-fileitem';it.setAttribute('data-p',p);
    it.innerHTML='<span class="nbv-ico">'+ICON[t]+'</span><span class="nbv-ftxt">'+esc(p)+'</span>';
    it.onclick=function(){select(p);};sb.appendChild(it);
    var op=document.createElement('option');op.value=p;op.textContent=p;selEl.appendChild(op);});
  document.getElementById('nbv-count').textContent=paths.length+(paths.length===1?' file':' files');
  selEl.onchange=function(e){select(e.target.value);};
  if(paths.length<=1)document.body.classList.add('nbv-single');
  select(pickPrimary());
})();`;

/**
 * Strips leading markdown code fences from a string, preserving inner content.
 * Line-by-line: strip only the first and last fence lines, never touching inner content.
 */
export function stripFences(s: string): string {
  const trimmed = s.trimStart();
  if (!trimmed.startsWith('```')) return s;
  const lines = s.split(/\r?\n/);
  // Find first fence line (```lang) and last fence line (```)
  const first = lines.findIndex(l => /^```/.test(l.trim()));
  if (first === -1) return s;
  // Find matching closing fence after the opening line (scan from end for safety)
  let last = -1;
  for (let i = lines.length - 1; i > first; i--) { if (/^```\s*$/.test(lines[i].trim())) { last = i; break; } }
  if (last === -1) return lines.slice(first + 1).join('\n'); // no closing fence — strip opener only
  return lines.slice(first + 1, last).join('\n');
}

/** Builds a runnable in-iframe document for React/Vue/TS source apps. */
export function buildSourceAppPreview(f: FileSystem): string {
  const rawHtml = f['index.html'] || '';
  const srcExtRe = /\.(jsx|tsx|ts|js|mjs|cjs|css|json|png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i;
  const srcFiles: Record<string, string> = {};
  Object.keys(f).forEach(k => { if (srcExtRe.test(k) && !k.includes('node_modules')) srcFiles[k] = f[k]; });

  // Preview-only: react-router's BrowserRouter needs real History/URL which the
  // sandboxed iframe doesn't have → blank screen. Rewrite to HashRouter so routed
  // apps actually render in the preview. (The saved project files are untouched.)
  for (const k of Object.keys(srcFiles)) {
    if (/\.(jsx|tsx|js|ts|mjs)$/i.test(k) && typeof srcFiles[k] === 'string' && srcFiles[k].includes('BrowserRouter')) {
      srcFiles[k] = srcFiles[k]
        .replace(/createBrowserRouter/g, 'createHashRouter')
        .replace(/\bBrowserRouter\b/g, 'HashRouter');
    }
  }

  // Resolve the entry module
  let entry = '';
  const m = rawHtml.match(/<script[^>]+type=["']module["'][^>]+src=["']([^"']+)["']/i);
  if (m) entry = m[1].replace(/^\//, '').replace(/^\.\//, '');
  if (!entry || !srcFiles[entry]) {
    const cands = ['src/main.tsx','src/main.jsx','src/main.ts','src/index.tsx','src/index.jsx','src/index.ts','main.tsx','main.jsx','index.tsx','index.jsx','src/App.tsx','src/App.jsx','App.tsx','App.jsx'];
    // Prefer candidates that contain actual JSX/rendering code (not just re-exports)
    const hasRendering = (k: string) => {
      const v = srcFiles[k] || '';
      return /createRoot|ReactDOM|render\s*\(|ReactMount|hydrateRoot/.test(v) || /<[A-Z][A-Za-z]*[\s/>]/.test(v);
    };
    entry = cands.find(c => srcFiles[c] && hasRendering(c))
      || cands.find(c => srcFiles[c])
      || Object.keys(srcFiles).find(k => /\.(tsx|jsx)$/i.test(k) && hasRendering(k))
      || Object.keys(srcFiles).find(k => /\.(tsx|jsx)$/i.test(k))
      // Additive fallback: a React app authored entirely in plain .js/.ts/.mjs
      // (no .tsx/.jsx files) would otherwise resolve to no entry and render the
      // "No runnable entry file found" error. Only reached when nothing above matched.
      || Object.keys(srcFiles).find(k => /\.(js|mjs|ts)$/i.test(k) && hasRendering(k))
      || '';
  }

  // Reuse the app's <body> markup (minus module/external scripts) so #root etc. survive
  let bodyInner = '<div id="root"></div>';
  const bm = rawHtml.match(/<body[^>]*>([\s\S]*?)<\/body\s*>/i);
  if (bm) {
    bodyInner = bm[1]
      .replace(/<script[^>]*type=["']module["'][^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<script[^>]+src=["'][^"']+["'][^>]*>\s*<\/script>/gi, '');
    if (!/id=["'](root|app)["']/.test(bodyInner)) bodyInner += '<div id="root"></div>';
  }

  // Build importmap from package.json dependencies + always-needed React packages
  const ESM = 'https://esm.sh/';
  const pkgDeps: Record<string, string> = {};
  try {
    const pkg = JSON.parse(f['package.json'] || '{}');
    Object.assign(pkgDeps, pkg.dependencies || {}, pkg.devDependencies || {});
  } catch {}
  // Strip semver prefix (^1.2.3 → 1.2.3)
  const ver = (name: string) => {
    const v = pkgDeps[name];
    return v ? '@' + v.replace(/^[\^~>=<\s]*/,'').split(/\s/)[0] : '';
  };
  const reactVer = ver('react') || '@18.3.1';
  const rdVer = ver('react-dom') || '@18.3.1';
  const imapEntries: Record<string, string> = {
    'react': ESM + 'react' + reactVer,
    'react-dom': ESM + 'react-dom' + rdVer,
    'react-dom/client': ESM + 'react-dom' + rdVer + '/client',
    'react/jsx-runtime': ESM + 'react' + reactVer + '/jsx-runtime',
    // OUR OWN FACADE, never the CDN — see jsxDevRuntimeFacade.ts: React 19's production build
    // exports `jsxDEV` as `void 0`, and we emit jsxDEV calls on purpose for the Visual Editor.
    'react/jsx-dev-runtime': jsxDevRuntimeUrl(typeof location !== 'undefined' ? location.origin : ''),
  };
  // Add all package.json deps to importmap with version pins.
  // `?external=react,react-dom` makes esm.sh import (not bundle) React, so every
  // dep (react-router-dom, zustand, etc.) shares the ONE React instance from the
  // importmap. Without this, libs bundle their own React → "Invalid hook call" /
  // duplicate-React "Script error" in the preview.
  Object.keys(pkgDeps).forEach(pkg => {
    if (!imapEntries[pkg]) imapEntries[pkg] = ESM + pkg + ver(pkg) + '?external=react,react-dom';
  });

  // Safe JSON for embedding in <script> tags: escape </ to prevent </script> from
  // closing the tag early when file content contains that string.
  const sj = (v: unknown) => JSON.stringify(v).replace(/<\//g, '<\\/');

  // Load the compiler from NavBharatAI's OWN origin first (self-hosted, never
  // third-party-CDN-blocked); the bootstrap falls back to CDNs if this 404s.
  const ORIGIN = (typeof location !== 'undefined' && location.origin) ? location.origin : '';
  // VENDORED SAME-ORIGIN REACT (same design as ReactPreview.ts, admin 2026-08-03): serve React 18
  // itself from OUR origin (public/vendor/react18 — official UMD builds + ESM facades) so the
  // preview's foundation never depends on a third-party CDN. The un-overridden CDN importmap is
  // kept alongside (window.__CDN_IMAP) so the bootstrap can fall back to esm.sh per-specifier if a
  // facade fails. Only for React-18/unpinned apps — never silently substitute under React 19/17.
  // Escape hatch (client code — no server env here): window.__NBAI_VENDOR_REACT_OFF = true.
  const cdnImap = { ...imapEntries };
  const vendorEligible = !!ORIGIN
    && parseInt(reactVer.slice(1), 10) === 18
    && !(typeof window !== 'undefined' && (window as { __NBAI_VENDOR_REACT_OFF?: boolean }).__NBAI_VENDOR_REACT_OFF === true);
  let vendorScripts = '';
  if (vendorEligible) {
    const vb = ORIGIN + '/vendor/react18';
    imapEntries['react'] = vb + '/react.mjs';
    imapEntries['react-dom'] = vb + '/react-dom.mjs';
    imapEntries['react-dom/client'] = vb + '/react-dom-client.mjs';
    imapEntries['react/jsx-runtime'] = vb + '/jsx-runtime.mjs';
    imapEntries['react/jsx-dev-runtime'] = vb + '/jsx-dev-runtime.mjs';
    vendorScripts = '<script src="' + vb + '/react.production.min.js"></' + 'script>'
      + '<script src="' + vb + '/react-dom.production.min.js"></' + 'script>';
  }
  const importmap = JSON.stringify({ imports: imapEntries });
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + PREVIEW_HARNESS
    + vendorScripts
    + '<script type="importmap">' + importmap + '</' + 'script>'
    + '<script src="' + ORIGIN + '/vendor/babel.min.js"></' + 'script>'
    + '</head><body>' + bodyInner
    + '<script>window.__FILES=' + sj(srcFiles) + ';window.__ENTRY=' + sj(entry) + ';window.__IMAP=' + sj(imapEntries) + ';window.__CDN_IMAP=' + sj(cdnImap) + ';</' + 'script>'
    + '<script>' + PREVIEW_BOOTSTRAP + '</' + 'script>'
    + '</body></html>';
}

/** Builds a universal multi-format file viewer document (for workspaces without index.html). */
export function buildUniversalPreview(f: FileSystem): string {
  const sj = (v: unknown) => JSON.stringify(v).replace(/<\//g, '<\\/');
  const viewFiles: Record<string, string> = {};
  Object.keys(f).forEach(k => { if (f[k] != null && !k.includes('node_modules')) viewFiles[k] = f[k]; });
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + PREVIEW_HARNESS
    + '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css">'
    + '<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></' + 'script>'
    + '<script src="https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js"></' + 'script>'
    + '<script src="https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js"></' + 'script>'
    + '<style>' + UNIVERSAL_VIEWER_CSS + '</style></head><body>'
    + '<div class="nbv-app">'
    + '<aside class="nbv-side"><div class="nbv-brand">📁 Files <span id="nbv-count" class="nbv-cnt"></span></div><div id="nbv-files" class="nbv-list"></div></aside>'
    + '<main class="nbv-main"><div class="nbv-topbar"><select id="nbv-select" class="nbv-mobilesel"></select><div id="nbv-head" class="nbv-head"></div></div><div id="nbv-body" class="nbv-content"></div></main>'
    + '</div>'
    + '<script>window.__NBV=' + sj({ files: viewFiles, primary: '' }) + ';</' + 'script>'
    + '<script>' + UNIVERSAL_VIEWER_JS + '</' + 'script>'
    + '</body></html>';
}

/** Injects the never-blank error harness into a static HTML document. */
export function injectHarness(doc: string): string {
  if (doc.includes('id="__nb_err"') || doc.includes("id='__nb_err'") || doc.includes('__nbShowError')) return doc;
  if (/<\/head>/i.test(doc)) return doc.replace(/<\/head>/i, PREVIEW_HARNESS + '</head>');
  if (/<body[^>]*>/i.test(doc)) return doc.replace(/(<body[^>]*>)/i, '$1' + PREVIEW_HARNESS);
  return PREVIEW_HARNESS + doc;
}
