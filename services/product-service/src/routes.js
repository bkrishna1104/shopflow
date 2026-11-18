import { Router } from 'express';
import { HttpError } from './lib/errors.js';
import { positiveInt, nonNegativeInt, nonEmptyString, pagination } from './lib/validate.js';

export function productsRouter({ repo }) {
  const router = Router();

  // POST /products {sku, name, price_paise, stock}
  // Money is stored as INTEGER paise (₹499.00 = 49900), never as a float:
  // 0.1 + 0.2 = 0.30000000000000004 is not acceptable for payments.
  router.post('/', async (req, res) => {
    const product = await repo.create({
      sku: nonEmptyString(req.body?.sku, 'sku', 50),
      name: nonEmptyString(req.body?.name, 'name'),
      pricePaise: positiveInt(req.body?.price_paise, 'price_paise'),
      stock: nonNegativeInt(req.body?.stock ?? 0, 'stock'),
    });
    res.status(201).location(`/products/${product.id}`).json(product);
  });

  router.get('/', async (req, res) => {
    res.json(await repo.list(pagination(req.query)));
  });

  router.get('/:id', async (req, res) => {
    const product = await repo.findById(positiveInt(req.params.id, 'id'));
    if (!product) throw new HttpError(404, 'product not found');
    res.json(product);
  });

  // POST /products/:id/reserve {quantity} -> 200 | 404 | 409 insufficient stock
  router.post('/:id/reserve', async (req, res) => {
    const id = positiveInt(req.params.id, 'id');
    const quantity = positiveInt(req.body?.quantity, 'quantity');
    const product = await repo.reserve(id, quantity);
    if (product) return res.json(product);
    // Reservation failed: figure out why, to return the right status code.
    const existing = await repo.findById(id);
    if (!existing) throw new HttpError(404, 'product not found');
    throw new HttpError(409, 'insufficient stock', { available: existing.stock, requested: quantity });
  });

  // POST /products/:id/release {quantity}
  router.post('/:id/release', async (req, res) => {
    const product = await repo.release(positiveInt(req.params.id, 'id'), positiveInt(req.body?.quantity, 'quantity'));
    if (!product) throw new HttpError(404, 'product not found');
    res.json(product);
  });

  return router;
}
