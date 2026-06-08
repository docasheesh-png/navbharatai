import React from 'react';
export default function ProductTable({ products, onDelete }: { products: any[], onDelete: (id: string) => void }) {
    return (
        <table className="w-full border">
            <thead><tr><th>Name</th><th>Price</th><th>Quantity</th><th>Action</th></tr></thead>
            <tbody>
                {products.map(p => (
                    <tr key={p.id}>
                        <td>{p.name}</td><td>{p.price}</td><td>{p.quantity}</td>
                        <td><button onClick={() => onDelete(p.id)} className="text-red-500">Delete</button></td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}