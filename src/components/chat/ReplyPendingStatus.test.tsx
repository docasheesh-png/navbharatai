import { describe,it,expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReplyPendingStatus } from './ReplyPendingStatus';
describe('honest normal-chat pending status',()=>{
 it.each([false,true])('renders only actual pending=%s state',pending=>{
  const html=renderToStaticMarkup(<ReplyPendingStatus pending={pending}/>);
  if(!pending){expect(html).toBe('');return;}
  expect(html).toContain('Preparing your reply… 🤔');expect(html).toContain('aria-live="polite"');expect(html).toContain('role="status"');expect(html).not.toMatch(/provider|Surplus|Cheaper|reasoning|progress|%/i);
 });
 it('does not mark the live announcement busy and defer its announcement',()=>{
  expect(renderToStaticMarkup(<ReplyPendingStatus pending/>)).not.toContain('aria-busy');
 });
});
