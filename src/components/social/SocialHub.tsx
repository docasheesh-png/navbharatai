import React, { useState } from 'react';
import { db, auth } from '../../lib/firebase';
import { collection, addDoc, query, orderBy, onSnapshot } from 'firebase/firestore';

export const SocialHub = () => {
  const [activeTab, setActiveTab] = useState<'feed' | 'profile'>('feed');
  
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
           <p className="text-gray-400">Feed coming soon using Firestore...</p>
        </div>
      )}
    </div>
  );
};
