import { Request, Response } from 'express';
import { productService } from '../services/productService';

// NOTE: In Express 4 a rejected promise from an async handler is NOT forwarded to error
// middleware automatically — it surfaces as an unhandled rejection and the HTTP request
// hangs with no response. Every handler therefore wraps its body in try/catch and returns
// a 500 on failure instead of leaving the request open.

export const getProducts = async (_req: Request, res: Response) => {
  try {
    res.json(await productService.findAll());
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to fetch products' });
  }
};

export const createProduct = async (req: Request, res: Response) => {
  try {
    res.status(201).json(await productService.create(req.body));
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to create product' });
  }
};

export const updateProduct = async (req: Request, res: Response) => {
  try {
    const updated = await productService.update(req.params.id, req.body);
    updated ? res.json(updated) : res.status(404).send('Not Found');
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to update product' });
  }
};

export const deleteProduct = async (req: Request, res: Response) => {
  try {
    await productService.delete(req.params.id);
    res.status(204).send();
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to delete product' });
  }
};
