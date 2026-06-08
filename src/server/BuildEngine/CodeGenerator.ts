
import { BuildManifest } from './types';

export interface GeneratedFile {
  path: string;
  content: string;
}

export class CodeGeneratorV2 {
  generate(manifest: BuildManifest): GeneratedFile[] {
    return manifest.filesToGenerate.map((filePath) => ({
      path: filePath,
      content: this.generateContent(filePath, manifest),
    }));
  }

  private generateContent(filePath: string, manifest: BuildManifest): string {
    if (filePath === 'src/server/models/Product.ts') {
        return `export interface Product { id: string; name: string; price: number; quantity: number; }`;
    }
    if (filePath === 'src/components/ProductTable.tsx') {
        return `import React from 'react';
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
}`;
    }
    if (filePath === 'src/components/ProductForm.tsx') {
        return `import React, { useState } from 'react';
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
}`;
    }
    if (filePath === 'src/pages/InventoryPage.tsx') {
        return `import React, { useState, useEffect } from 'react';
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
        await fetch(\`/api/products/\${id}\`, { method: 'DELETE' });
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
}`;
    }
    if (filePath === 'src/server/routes/products.ts') {
        return `import { Router } from 'express';
import * as controller from '../controllers/productController';

const router = Router();
router.get('/', controller.getProducts);
router.post('/', controller.createProduct);
router.put('/:id', controller.updateProduct);
router.delete('/:id', controller.deleteProduct);

export default router;`;
    }
    if (filePath === 'src/server/controllers/productController.ts') {
        return `import { Request, Response } from 'express';
import { productService } from '../services/productService';

export const getProducts = async (req: Request, res: Response) => res.json(await productService.findAll());
export const createProduct = async (req: Request, res: Response) => res.status(201).json(await productService.create(req.body));
export const updateProduct = async (req: Request, res: Response) => {
    const updated = await productService.update(req.params.id, req.body);
    updated ? res.json(updated) : res.status(404).send('Not Found');
};
export const deleteProduct = async (req: Request, res: Response) => {
    await productService.delete(req.params.id);
    res.status(204).send();
};`;
    }
    if (filePath === 'src/server/services/productService.ts') {
        return `import { Product } from '../models/Product';
import fs from 'fs/promises';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'products.json');

const loadProducts = async (): Promise<Product[]> => {
    try { const data = await fs.readFile(DB_PATH, 'utf-8'); return JSON.parse(data); }
    catch { return []; }
};

const saveProducts = async (products: Product[]) => {
    await fs.writeFile(DB_PATH, JSON.stringify(products, null, 2));
};

export const productService = {
    findAll: async () => await loadProducts(),
    findById: async (id: string) => (await loadProducts()).find(p => p.id === id) || null,
    create: async (product: Product) => {
        const products = await loadProducts();
        products.push(product);
        await saveProducts(products);
        return product;
    },
    update: async (id: string, updated: Partial<Product>) => {
        const products = await loadProducts();
        const index = products.findIndex(p => p.id === id);
        if (index === -1) return null;
        products[index] = { ...products[index], ...updated } as Product;
        await saveProducts(products);
        return products[index];
    },
    delete: async (id: string) => {
        const products = await loadProducts();
        await saveProducts(products.filter(p => p.id !== id));
        return true;
    }
};`;
    }
    if (filePath === 'src/components/ChessBoard.tsx') {
        return `import React, { useState } from 'react';
export default function ChessBoard() {
    const [board, setBoard] = useState(Array(8).fill(null).map(() => Array(8).fill(null)));
    return <div className="grid grid-cols-8 gap-0 border border-black w-96 h-96">
        {board.flat().map((_, i) => <div key={i} className={\`w-12 h-12 \${(Math.floor(i / 8) + i % 8) % 2 === 0 ? 'bg-white' : 'bg-gray-800'}\`}></div>)}
    </div>;
}`;
    }
    if (filePath === 'src/server/game/Engine.ts') {
        return `export class ChessEngine {
    private board: any[][];
    constructor() { this.board = Array(8).fill(null).map(() => Array(8).fill(null)); }
    move(from: [number, number], to: [number, number]) { return true; }
}`;
    }
    return `// Generated manifest-driven file: ${filePath}`;
  }
}
