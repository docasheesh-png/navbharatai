import { Product } from '../models/Product';
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
};