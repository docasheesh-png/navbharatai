import React, { useState } from 'react';
export default function ProductForm({ onSubmit }: { onSubmit: (data: any) => void }) {
    const [name, setName] = useState('');
    const [price, setPrice] = useState(0);
    const [quantity, setQuantity] = useState(0);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!name || price < 0 || quantity < 0) return alert('Invalid inputs');
        onSubmit({ id: Date.now().toString(), name, price, quantity });
        setName(''); setPrice(0); setQuantity(0);
    };

    return (
        <form onSubmit={handleSubmit} className="p-4 border rounded mb-4">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Name" className="border m-1 p-1" />
            <input type="number" value={price} onChange={e => setPrice(Number(e.target.value))} placeholder="Price" className="border m-1 p-1" />
            <input type="number" value={quantity} onChange={e => setQuantity(Number(e.target.value))} placeholder="Quantity" className="border m-1 p-1" />
            <button type="submit" className="bg-blue-500 text-white p-1">Add Product</button>
        </form>
    );
}