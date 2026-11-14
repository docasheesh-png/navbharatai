// AUTOPSY e41fdb21 (2026-11-14), item Q-3: JOURNEY_NOT_RUN "the submit control was not present" on a Notes app
// whose Add Note button was on screen. CLASS: fields and submit taken from two different components that share
// field ids — the conditionally rendered editor's "Save Changes" paired with the always-visible form's inputs.
import { describe, it, expect } from 'vitest';
import { deriveJourneys, renderedOnlyBehindACondition } from '../src/server/AgentV3/journeyDerivation';

const editor = `import { useState } from "react";
export default function NoteEditor({note,onUpdateNote,onCancelEdit}:any){ const [title,setTitle]=useState(note.title); const [content,setContent]=useState(note.content);
 return (<div><label htmlFor="note-title">Title</label><input id="note-title" type="text" value={title} onChange={(e)=>setTitle(e.target.value)}/>
 <label htmlFor="note-content">Content</label><textarea id="note-content" value={content} onChange={(e)=>setContent(e.target.value)}/>
 <button onClick={()=>onUpdateNote({...note,title,content})}>Save Changes</button><button onClick={onCancelEdit}>Cancel</button></div>);}`;
const create = `import { useState } from "react";
export default function NewNoteForm({onCreateNote}:any){ const [title,setTitle]=useState(""); const [content,setContent]=useState("");
 const handleSubmit=(e:any)=>{e.preventDefault(); onCreateNote(title,content);};
 return (<form onSubmit={handleSubmit}><label htmlFor="note-title">Title</label><input id="note-title" type="text" value={title} onChange={(e)=>setTitle(e.target.value)}/>
 <label htmlFor="note-content">Content</label><textarea id="note-content" value={content} onChange={(e)=>setContent(e.target.value)}/>
 <button type="submit">Add Note</button></form>);}`;
const list = `export default function NoteList({notes}:any){return <div>{notes.map((n:any)=><div key={n.id}>{n.title}</div>)}</div>}`;
const app = (body: string) => `import { useState } from "react";
import NoteList from "./components/NoteList";
import NoteEditor from "./components/NoteEditor";
import NewNoteForm from "./components/NewNoteForm";
export default function App(){ const [sel,setSel]=useState<any>(null); const notes:any[]=[];
 return (<div>${body}<NoteList notes={notes}/></div>);}`;
const files = (body: string) => ({ 'src/App.tsx': app(body), 'src/components/NoteList.tsx': list, 'src/components/NoteEditor.tsx': editor, 'src/components/NewNoteForm.tsx': create });

describe('the journey pairs fields with the submit of the form that is on screen', () => {
  it('🔴 the real shape: editor imported first, shown only after a selection', () => {
    const j = deriveJourneys({ files: files('<NewNoteForm onCreateNote={()=>{}}/>{sel && <NoteEditor note={sel} onUpdateNote={()=>{}} onCancelEdit={()=>{}}/>}'), routes: ['/'] } as any);
    expect(j[0].submit).toEqual({ kind: 'text', value: 'Add Note' });
  });
  it('the ternary form of the same condition is read the same way', () => {
    const j = deriveJourneys({ files: files('<NewNoteForm onCreateNote={()=>{}}/>{sel ? <NoteEditor note={sel} onUpdateNote={()=>{}} onCancelEdit={()=>{}}/> : null}'), routes: ['/'] } as any);
    expect(j[0].submit).toEqual({ kind: 'text', value: 'Add Note' });
  });
  it('the guard test itself: guarded vs always rendered', () => {
    const f = files('');
    const g = app('{sel && <NoteEditor note={sel} />}<NewNoteForm />');
    expect(renderedOnlyBehindACondition(g, 'src/components/NoteEditor.tsx', 'src/App.tsx', f)).toBe(true);
    expect(renderedOnlyBehindACondition(g, 'src/components/NewNoteForm.tsx', 'src/App.tsx', f)).toBe(false);
  });
  it('opposite class: a form that is ONLY behind a condition is demoted, never dropped', () => {
    const only = { ...files('{sel && <NoteEditor note={sel} onUpdateNote={()=>{}} onCancelEdit={()=>{}}/>}'), 'src/components/NewNoteForm.tsx': 'export default function NewNoteForm(){return null}' };
    const j = deriveJourneys({ files: only, routes: ['/'] } as any);
    expect(j.some((x) => x.submit && (x.submit as any).value === 'Save Changes')).toBe(true);
  });
});
