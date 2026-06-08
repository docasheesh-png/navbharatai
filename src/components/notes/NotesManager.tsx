import { useState, useEffect } from 'react';
import { db } from '../../lib/firebase';
import { useAuth } from '../../lib/AuthContext';
import { collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, orderBy } from 'firebase/firestore';
import { Note } from '../../types/note';
import { Plus, Trash2, Edit2, Search } from 'lucide-react';

export const NotesManager = () => {
    const { user } = useAuth();
    const [notes, setNotes] = useState<Note[]>([]);
    const [search, setSearch] = useState('');
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);

    useEffect(() => {
        if (!user) return;
        const q = query(collection(db, 'notes'), where('userId', '==', user.uid), orderBy('updatedAt', 'desc'));
        return onSnapshot(q, (snapshot) => {
            setNotes(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Note)));
        });
    }, [user]);

    const saveNote = async () => {
        if (!user || !title) return;
        if (editingId) {
            await updateDoc(doc(db, 'notes', editingId), { title, content, updatedAt: serverTimestamp() });
            setEditingId(null);
        } else {
            await addDoc(collection(db, 'notes'), { title, content, userId: user.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
        }
        setTitle('');
        setContent('');
    };

    const deleteNote = async (id: string) => {
        await deleteDoc(doc(db, 'notes', id));
    };

    const filteredNotes = notes.filter(n => n.title.toLowerCase().includes(search.toLowerCase()));

    if (!user) return <div className="p-4">Please login to manage notes.</div>;

    return (
        <div className="p-6 max-w-4xl mx-auto space-y-6">
            <h1 className="text-3xl font-bold">Your Notes</h1>
            <input type="text" placeholder="Search..." className="w-full p-3 bg-gray-800 rounded-lg text-white" value={search} onChange={(e) => setSearch(e.target.value)} />
            
            <div className="bg-gray-800 p-4 rounded-lg space-y-3">
                <input type="text" placeholder="Title" className="w-full p-2 rounded bg-gray-700 text-white" value={title} onChange={(e) => setTitle(e.target.value)}/>
                <textarea placeholder="Content" className="w-full p-2 rounded bg-gray-700 text-white h-24" value={content} onChange={(e) => setContent(e.target.value)}></textarea>
                <button onClick={saveNote} className="bg-blue-600 px-4 py-2 rounded text-white flex gap-2"><Plus /> {editingId ? 'Update' : 'Add'}</button>
            </div>

            <div className="grid gap-4">
                {filteredNotes.map(note => (
                    <div key={note.id} className="bg-gray-700 p-4 rounded-lg flex justify-between items-start">
                        <div>
                            <h3 className="text-xl font-semibold">{note.title}</h3>
                            <p className="text-gray-300">{note.content}</p>
                        </div>
                        <div className="flex gap-2">
                           <button onClick={() => { setEditingId(note.id); setTitle(note.title); setContent(note.content); }}><Edit2 className="text-yellow-500" /></button>
                           <button onClick={() => deleteNote(note.id)}><Trash2 className="text-red-500" /></button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};
