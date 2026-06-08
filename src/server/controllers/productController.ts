import { Request, Response } from 'express';
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
};