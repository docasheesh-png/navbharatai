import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { sessionGreetingRule } from '../src/server/lib/sessionGreeting';
import { FREE_ANSWER_ALL_RULES } from '../src/server/lib/freeChatReplies';
import { freeChatModeGuide } from '../src/server/lib/freeChatModeGuide';
import { CREATOR_IDENTITY, INDIA_TERRITORIAL_INTEGRITY, LINK_POLICY, recencyDirective } from '../src/server/lib/prompts';
import { freeChainConfig } from '../src/server/AI/FreeChain/config';
import { trimForRung } from '../src/server/AI/FreeChain/trim';
import { quotaCapacity } from '../src/server/AI/FreeChain/quota';
/** Read actual route-owned pure prompt builders, not a smaller invented stand-in. No app/server boot or network. */
function actualSystemPrompt() {
 const source=readFileSync(new URL('../src/server/routes/chat.ts',import.meta.url),'utf8');
 const ast=ts.createSourceFile('chat.ts',source,ts.ScriptTarget.Latest,true);
 let language='',builder='';
 function visit(node:ts.Node) { if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.initializer){if(node.name.text==='LANGUAGE_RULE') language=node.initializer.getText(ast);if(node.name.text==='buildFreeSystemPrompt') builder=node.initializer.getText(ast);}ts.forEachChild(node,visit); }
 visit(ast);expect(language).not.toBe('');expect(builder).not.toBe('');
 const js=ts.transpile(`const build=${builder}; return build(undefined,true);`,{target:ts.ScriptTarget.ES2022});
 const base=new Function('LANGUAGE_RULE','sessionGreetingRule',js)(new Function(`return ${language}`)(),sessionGreetingRule) as string;
 return `${base}\n\n${freeChatModeGuide()}`.replace(/APP BUILDING — LEAD WITH NavBharatAI Pro[\s\S]*?(?=\nHARD LIMITS:)/,`${FREE_ANSWER_ALL_RULES}\n`).replace('(guide them to NavBharatAI Pro instead, per the rule above)','(for an app request, explain the idea instead, per the rule above)')+`\n\n${CREATOR_IDENTITY}\n\n${INDIA_TERRITORIAL_INTEGRITY}\n\n${recencyDirective()}\n\n${LINK_POLICY}\n\nReply in English.`;
}
describe('real ordinary chat prompt admission',()=>{
 it('keeps every standing rule and admits hello to default Groq without byte-as-token rejection',()=>{
 const system=actualSystemPrompt();expect(Buffer.byteLength(system)).toBeGreaterThan(9000);
 const cfg=freeChainConfig({});const rung=cfg.rungs.find(r=>r.id==='groq')!;
 const turn=trimForRung('hello',[],system,rung.maxInputTokens);
 expect(turn).not.toBeNull();expect(turn?.systemPrompt).toBe(system);
 expect(turn!.inputTokens+rung.maxOutputTokens).toBeLessThanOrEqual(quotaCapacity(rung.tpm,cfg.safetyMargin));
 });
});
