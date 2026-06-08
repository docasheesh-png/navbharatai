import React, { useState } from 'react';
import axios from 'axios';

export function VertexDebug() {
  const [loading, setLoading] = useState(false);
  const [reply, setReply] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleTest = async () => {
    setLoading(true);
    setReply(null);
    setError(null);
    try {
      const res = await axios.get('/api/test-vertex');
      setReply(res.data.reply);
    } catch (err: any) {
      setError(err.message || 'Failed to test vertex');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-4 right-4 p-4 bg-gray-900 border border-gray-700 rounded-lg shadow-lg z-50">
      <button 
        onClick={handleTest}
        disabled={loading}
        className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded transition-colors disabled:opacity-50"
      >
        {loading ? 'Testing Vertex...' : 'Test Vertex AI'}
      </button>
      {(reply || error) && (
        <div className="mt-2 p-2 bg-black text-white rounded text-xs max-w-xs break-words border border-gray-700">
          {error ? <span className="text-red-400">Error: {error}</span> : <span>Reply: {reply}</span>}
        </div>
      )}
    </div>
  );
}
