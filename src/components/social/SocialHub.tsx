import React, { useEffect, useState } from 'react';
import { db, auth } from '../../lib/firebase';
import { collection, addDoc, query, orderBy, onSnapshot } from 'firebase/firestore';

export const SocialHub = () => {
  const [activeTab, setActiveTab] = useState<'feed' | 'profile'>('feed');
  const [posts, setPosts] = useState<Array<{ id: string; content: string; userId: string; timestamp: string }>>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const feedQuery = query(collection(db, 'posts'), orderBy('timestamp', 'desc'));
    return onSnapshot(feedQuery, (snapshot) => {
      setPosts(snapshot.docs.map(post => ({ id: post.id, ...post.data() } as { id: string; content: string; userId: string; timestamp: string })));
    }, () => setError('Unable to load the social feed.'));
  }, []);

  const publish = async () => {
    const user = auth.currentUser;
    const content = draft.trim();
    if (!user || !content) return;
    try {
      await addDoc(collection(db, 'posts'), { userId: user.uid, type: 'text', content, timestamp: new Date().toISOString() });
      setDraft('');
    } catch {
      setError('Unable to publish this post.');
    }
  };
  
  return (
    <div className="flex flex-col h-full bg-[#0d1117] text-white p-6 overflow-y-auto">
      <header className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-bold">Social Hub</h1>
        <div className="flex gap-4">
           {['feed', 'profile'].map(tab => (
             <button 
                key={tab} 
                className={`uppercase text-xs font-black tracking-widest ${activeTab === tab ? 'text-indigo-400' : 'text-gray-500'}`}
                onClick={() => setActiveTab(tab as any)}
             >{tab}</button>
           ))}
        </div>
      </header>

      {activeTab === 'feed' && (
        <div className="space-y-6">
           <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
             <textarea value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={2000} placeholder="Share an update…" className="w-full min-h-24 bg-transparent text-sm outline-none resize-none" />
             <button onClick={publish} disabled={!auth.currentUser || !draft.trim()} className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold disabled:opacity-40">Publish</button>
           </div>
           {error && <p className="text-sm text-red-400">{error}</p>}
           {posts.length === 0 ? <p className="text-gray-400">No posts yet. Start the conversation.</p> : posts.map(post => (
             <article key={post.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
               <p className="text-sm whitespace-pre-wrap">{post.content}</p>
               <p className="mt-3 text-[10px] text-gray-500">{new Date(post.timestamp).toLocaleString()}</p>
             </article>
           ))}
        </div>
      )}
    </div>
  );
};
