import React, { useState } from 'react';
import axios from 'axios';
import { Bot, Send, Loader2 } from 'lucide-react';

export const VertexTestChat: React.FC = () => {
    const [messages, setMessages] = useState<{ id: string; text: string; sender: 'user' | 'ai' }[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleSend = async () => {
        if (!input.trim()) return;
        
        const userMsg = input;
        setInput('');
        setMessages(prev => [...prev, { id: Date.now().toString(), text: userMsg, sender: 'user' }]);
        setIsLoading(true);

        try {
            const response = await axios.post('/api/chat', { message: userMsg });
            setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), text: response.data.reply, sender: 'ai' }]);
        } catch (error) {
            setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), text: 'Error: Failed to get response from Vertex AI.', sender: 'ai' }]);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="flex flex-col h-full bg-[#0d1117] text-white">
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.map(m => (
                    <div key={m.id} className={`flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`p-3 rounded-2xl max-w-[80%] ${m.sender === 'user' ? 'bg-indigo-600' : 'bg-[#161b22]'}`}>
                            {m.text}
                        </div>
                    </div>
                ))}
                {isLoading && <Loader2 className="animate-spin text-purple-400" />}
            </div>
            <div className="p-4 border-t border-white/10 flex gap-2">
                <input 
                    type="text" 
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    className="flex-1 bg-[#161b22] border-none rounded-xl p-3 outline-none"
                    placeholder="Test Vertex AI..."
                    onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                />
                <button onClick={handleSend} className="bg-purple-600 p-3 rounded-xl"><Send size={18} /></button>
            </div>
        </div>
    );
};
