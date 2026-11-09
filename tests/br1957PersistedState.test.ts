import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { persistedStateFindings, persistedStateBuildWarnings } from '../src/server/AgentV3/persistedStateCheck';
import { qualityNote, filesANoteStillFlags, MAX_NOTE_LINES } from '../src/server/AgentV3/writeTimeQualityCheck';
import previews from './fixtures/br1957-storage-previews.json';
const city = (body: string) => `import {useState,useEffect} from 'react';
export function useCityStorage(){const [city,setCity]=useState(null);useEffect(()=>{${body}},[]);return city;}`;
const theme = (body: string) => `import {useState,useEffect} from 'react';
export function useTheme(){const [theme,setTheme]=useState('light');useEffect(()=>{${body}},[]);return theme;}`;
const scan = (code: string) => persistedStateFindings('src/hooks/useStorage.ts', code);
describe('BR1957 F8 persisted browser state boundaries', () => {
  it.each(previews.previews.map((p, i) => [i, p.responsePreview] as const))('warns on exact retained capped L0%s preview, without inventing its suffix', (i, preview) => {
    const [, file, source] = preview.match(/^<<<FILE (.*?)>>>\n([\s\S]*)$/)!;
    expect(persistedStateFindings(file, source).map(x => x.type)).toContain(i ? 'persisted-theme-mode' : 'persisted-json-state');
    expect(qualityNote(file, source)).toMatch(/runtime shape guard|light\|dark\|auto whitelist/);
  });
  it.each([
    "const raw=localStorage.getItem('city');if(raw){const value=JSON.parse(raw);setCity(value);}",
    "try{const raw=localStorage.getItem('city');setCity(JSON.parse(raw));}catch{}",
    "const raw=window.localStorage.getItem('city');const value=JSON.parse(raw) as City;setCity(value);",
    "const raw=globalThis.sessionStorage['getItem']('city');const value=JSON['parse'](raw);const alias=(value!);const commit=setCity;commit(alias);",
    "const store=localStorage;const read=store.getItem;const raw=read('city');const parse=JSON.parse;setCity(parse(raw));",
    "const value=JSON.parse(localStorage.getItem('city')||'null');if(value)setCity(value);",
    "const value=JSON.parse(localStorage.getItem('city'));if(typeof value==='object'&&value)setCity(value);",
    "// typeof value.lat==='number'; isCity(value)\nsetCity(JSON.parse(localStorage.getItem('city')));",
  ])('detects direct/alias/cast/try/truthy bypass: %s', body => {
    expect(scan(city(body)).map(x => x.type)).toContain('persisted-json-state');
  });
  it.each([
    "const raw=localStorage.getItem('theme') as Theme; if(raw)setTheme(raw);",
    "const raw=sessionStorage.getItem('theme');setTheme(raw||'light');",
    "const raw=localStorage.getItem('theme');const alias=raw?raw:'light';setTheme(alias);",
    "const raw=localStorage.getItem('theme');if(raw!=='garbage')setTheme(raw);",
    "const raw=localStorage.getItem('theme');if(raw==='light'||raw==='sepia')setTheme(raw);",
    "const raw=localStorage.getItem('theme');if(raw==='dark'||true)setTheme(raw);",
    "const raw=localStorage.getItem('theme');document.documentElement.setAttribute('data-theme',raw);",
  ])('never mistakes a theme cast/truthy/fallback for a whitelist: %s', body => {
    expect(scan(theme(body)).map(x => x.type)).toContain('persisted-theme-mode');
  });
  it.each([
    "const value=JSON.parse(localStorage.getItem('city'));if(value&&typeof value.name==='string'&&typeof value.lat==='number'&&Number.isFinite(value.lat)&&Math.abs(value.lat)<=90&&typeof value.lon==='number'&&Math.abs(value.lon)<=180)setCity(value);",
    "const value=JSON.parse(localStorage.getItem('city'));if(isValidCity(value))setCity(value);",
    "const value=JSON.parse(localStorage.getItem('city'));setCity(decodeCity(value));",
    "const value=JSON.parse(localStorage.getItem('city'));if(!isCity(value))return;setCity(value);",
    "const value=JSON.parse(localStorage.getItem('city'));if(!isCity(value)){}else setCity(value);",
    "const value=JSON.parse(localStorage.getItem('city'));if(Array.isArray(value))setCity(value);",
    "setCity({name:'Delhi',lat:28.6,lon:77.2});",
    "const value=JSON.parse(responseBody);setCity(value);",
  ])('preserves explicit validators/guards and non-storage flows: %s', body => {
    expect(scan(city(body))).toEqual([]);
  });
  it.each([
    "const raw=localStorage.getItem('theme');if(raw==='light'||raw==='dark'||raw==='auto')setTheme(raw);",
    "const raw=localStorage.getItem('theme');if(['light','dark'].includes(raw))setTheme(raw);",
    "const modes=['light','dark','auto'] as const; const raw=localStorage.getItem('theme');modes.includes(raw)&&setTheme(raw);",
    "const raw=localStorage.getItem('theme');const safe=raw==='light'||raw==='dark'?raw:'light';setTheme(safe);",
    "const raw=localStorage.getItem('theme');setTheme(raw==='light'||raw==='dark'||raw==='auto'?raw:'light');",
    "const raw=localStorage.getItem('theme');setTheme(validateTheme(raw));",
    "setTheme('dark');",
    "const raw=localStorage.getItem('theme');if(!['light','dark','auto'].includes(raw))return;setTheme(raw);",
    "const raw=localStorage.getItem('theme');setTheme(!['light','dark'].includes(raw)?'light':raw);",
  ])('preserves the app supported enum subset without adding auto or mutating storage: %s', body => {
    expect(scan(theme(body))).toEqual([]);
  });
  it('checks eager/lazy React initializers as well as setters, including renamed useState', () => {
    for (const init of ["JSON.parse(localStorage.getItem('city'))", "()=>JSON.parse(localStorage.getItem('city'))", "()=>{const p=JSON.parse(localStorage.getItem('city'));return p;}"]) {
      expect(scan(`import{useState as state}from'react';const [city,setCity]=state(${init});`).map(x=>x.type)).toContain('persisted-json-state');
    }
    expect(scan(`import * as React from 'react';const [theme,setTheme]=React.useState(()=>localStorage.getItem('theme'));`).map(x=>x.type)).toContain('persisted-theme-mode');
  });
  it('binds aliases to actual symbols; a sibling function cannot poison a safe state write', () => {
    const code=city("const value=JSON.parse(localStorage.getItem('city'));setCity(value);")+`\nfunction other(){const value={name:'Delhi'}; const setCity=(x)=>x;setCity(value);}`;
    expect(scan(code)).toHaveLength(1);
    expect(scan(city("const value=JSON.parse(localStorage.getItem('city'));function inner(value){setCity(value);}inner({name:'Delhi'});"))).toEqual([]);
  });
  it('does not let another symbol’s valid guard mask the unsafe value', () => {
    expect(scan(city("const value=JSON.parse(localStorage.getItem('city'));const other=JSON.parse(localStorage.getItem('other'));if(isCity(other))setCity(value);"))).toHaveLength(1);
  });
  it('does not let a containing guard validate a callback that executes later', () => {
    expect(scan(theme("const raw=localStorage.getItem('theme');if(raw==='dark')setTimeout(()=>setTheme(raw),100);"))).toHaveLength(1);
  });
  it('does not run fixture/generated/vendor/documentation paths or inspect comment strings', () => {
    for(const path of ['src/hooks/a.test.ts','src/__tests__/a.ts','node_modules/x.ts','dist/a.ts','README.md','src/a.d.ts'])expect(persistedStateFindings(path,city("setCity(JSON.parse(localStorage.getItem('city')));"))).toEqual([]);
    expect(scan("// setCity(JSON.parse(localStorage.getItem('city')))\nconst s=\"localStorage.getItem('theme')\";")).toEqual([]);
  });
  it('warns shared write-time and still-flagged measurement, even for hook-only files; kill switch unchanged', () => {
    const path='src/hooks/useCityStorage.ts', code=city("setCity(JSON.parse(localStorage.getItem('city')));");
    const note=qualityNote(path,code);
    expect(note).toContain('Quality check on '+path); expect(note).toContain('runtime shape guard');
    expect(note.split('\n').filter(x=>x.trim().startsWith('•')).length).toBeLessThanOrEqual(MAX_NOTE_LINES);
    expect(filesANoteStillFlags({[path]:code},[path])).toEqual([path]);
    expect(qualityNote(path,code,{AGENTV3_WRITE_QUALITY:'off'})).toBe('');
    expect(code).toBe(city("setCity(JSON.parse(localStorage.getItem('city')));"));
  });
  it('reports the same unresolved build warning without JSX or a perfect-page dependency', () => {
    const path='src/hooks/useCityStorage.ts', code=city("setCity(JSON.parse(localStorage.getItem('city')));");
    expect(persistedStateBuildWarnings({[path]:code})).toEqual(scan(code).map(f=>`${path}: ${f.message}`));
    const route=readFileSync('src/server/routes/agentv3.ts','utf8');
    const start=route.indexOf('for (const message of persistedStateBuildWarnings(integrityFiles))');
    expect(start).toBeGreaterThan(0);
    expect(route.slice(start,start+250)).toContain("severity: 'warning', code: 'PERSISTED_STATE_BOUNDARY', ...obs(message)");
    expect(start).toBeLessThan(route.indexOf('const quality = hasUserApp ? lintBuiltApp(integrityFiles) : null;'));
  });
  it('does not confuse shadowed globals or custom hooks with actual browser/React owners', () => {
    expect(scan(`function demo(localStorage){${city("setCity(JSON.parse(localStorage.getItem('city')));")}}`)).toEqual([]);
    expect(scan(`const useState=()=>[null,x=>x];const [city,setCity]=useState();setCity(JSON.parse(localStorage.getItem('city')));`)).toEqual([]);
    expect(scan(`const custom={useState:()=>[null,x=>x]};const [city,setCity]=custom.useState();setCity(JSON.parse(localStorage.getItem('city')));`)).toEqual([]);
  });
  it('all existing write lanes retain the one shared note path and data/lane ownership', () => {
    const dispatcher=readFileSync('src/server/AgentV3/ToolDispatcher.ts','utf8');
    expect(dispatcher).toContain('const q = qualityNote(p, files[p]);');
    expect(dispatcher).toContain('if (writesAreUnread())');
    expect(dispatcher).toContain('qualityNotedFiles');
    const check=readFileSync('src/server/AgentV3/persistedStateCheck.ts','utf8');
    expect(check).not.toMatch(/\.setItem\(|\.removeItem\(|\.clear\(|eval\(|new Function/);
  });
});
