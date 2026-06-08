import React, { useState, useEffect } from 'react';
import ProductTable from '../components/ProductTable';
import ProductForm from '../components/ProductForm';

export default function InventoryPage() {
    const [products, setProducts] = useState<any[]>([]);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);
    
    const fetchProducts = async () => {
        try {
            const res = await fetch('/api/products');
            setProducts(await res.json());
        } catch { alert('Error fetching products'); }
        finally { setLoading(false); }
    };
    useEffect(() => { fetchProducts(); }, []);
    
    const createProduct = async (data: any) => {
        await fetch('/api/products', { method: 'POST', body: JSON.stringify(data), headers: {'Content-Type': 'application/json'}});
        fetchProducts();
    };
    const deleteProduct = async (id: string) => {
        await fetch(`/api/products/${id}`, { method: 'DELETE' });
        fetchProducts();
    };

    const filtered = products.filter(p => p.name.toLowerCase().includes(search.toLowerCase()));

    return (
        <div className="p-4">
            <h1 className="text-2xl font-bold mb-4">Inventory</h1>
            <input onChange={e => setSearch(e.target.value)} placeholder="Search products..." className="border p-2 mb-4 w-full" />
            {loading ? <p>Loading...</p> : 
                <>
                    <ProductForm onSubmit={createProduct} />
                    <ProductTable products={filtered} onDelete={deleteProduct} />
                </>
            }
        </div>
    );
}