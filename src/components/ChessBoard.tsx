import React, { useState } from 'react';
export default function ChessBoard() {
    const [board, setBoard] = useState(Array(8).fill(null).map(() => Array(8).fill(null)));
    return <div className="grid grid-cols-8 gap-0 border border-black w-96 h-96">
        {board.flat().map((_, i) => <div key={i} className={`w-12 h-12 ${(Math.floor(i / 8) + i % 8) % 2 === 0 ? 'bg-white' : 'bg-gray-800'}`}></div>)}
    </div>;
}