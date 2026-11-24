import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Router, Request, Response, NextFunction } from 'express';
import { InventoryError, inventoryService } from '../../services/InventoryService.js';
import { apiResponse } from '../../utils/web.js';
import { logger } from '../../utils/logger.js';

declare module 'express-session' {
  interface SessionData {
    inventoryCsrfToken?: string;
  }
}

const router = Router();

function handleError(err: unknown, res: Response) {
  if (err instanceof InventoryError) return res.status(err.status).json(apiResponse('error', err.message));
  const name = err instanceof Error ? err.name.replace(/[\r\n\u2028\u2029]/g, '') : 'UnknownError';
  logger.error(`Inventory operation failed: ${name}`);
  return res.status(500).json(apiResponse('error', 'Inventory operation failed'));
}

router.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.get('origin');
  if (origin) {
    let host: string;
    try { host = new URL(origin).host; }
    catch { return res.status(403).json(apiResponse('error', 'Invalid request origin')); }
    if (host !== req.get('host')) return res.status(403).json(apiResponse('error', 'Invalid request origin'));
  }
  next();
});

/**
 * @openapi
 * /admin/inventory/csrf-token:
 *   get:
 *     tags: [Inventory]
 *     summary: Get the session-bound token required for inventory updates
 *     responses:
 *       200:
 *         description: CSRF token for the current administrator session
 */
router.get('/csrf-token', (req: Request, res: Response) => {
  const token = req.session.inventoryCsrfToken ?? randomBytes(32).toString('hex');
  req.session.inventoryCsrfToken = token;
  // The global CORS policy reflects origins; this secret must remain same-origin.
  res.removeHeader('Access-Control-Allow-Origin');
  res.removeHeader('Access-Control-Allow-Credentials');
  res.set('Cache-Control', 'no-store');
  res.json(apiResponse('success', 'OK', { token }));
});

/**
 * @openapi
 * /admin/inventory:
 *   get:
 *     tags: [Inventory]
 *     summary: List inventory (admin session required)
 *     responses:
 *       200:
 *         description: Products with stock levels and low-stock thresholds
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const products = await inventoryService.list();
    res.json(apiResponse('success', 'OK', products));
  } catch (err) { handleError(err, res); }
});

/**
 * @openapi
 * /admin/inventory/{productId}/movements:
 *   get:
 *     tags: [Inventory]
 *     summary: List stock movements (admin session required)
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Stock movement history
 */
router.get('/:productId/movements', async (req: Request, res: Response) => {
  try {
    res.json(apiResponse('success', 'OK', await inventoryService.history(req.params.productId)));
  } catch (err) { handleError(err, res); }
});

/**
 * @openapi
 * /admin/inventory/{productId}:
 *   put:
 *     tags: [Inventory]
 *     summary: Adjust stock and threshold (admin session required)
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema: { type: string }
 *       - in: header
 *         name: X-CSRF-Token
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [stockLevel, lowStockThreshold, expectedStockLevel]
 *             properties:
 *               stockLevel: { type: integer, minimum: 0 }
 *               lowStockThreshold: { type: integer, minimum: 0 }
 *               expectedStockLevel: { type: integer, minimum: 0 }
 *     responses:
 *       200:
 *         description: Inventory updated
 *       403:
 *         description: Missing or invalid CSRF token
 *       409:
 *         description: Stock changed since it was loaded
 */
router.put('/:productId', async (req: Request, res: Response) => {
  const token = req.get('X-CSRF-Token');
  const expected = req.session.inventoryCsrfToken;
  if (!token || !expected || !/^[0-9a-f]{64}$/.test(token) || !/^[0-9a-f]{64}$/.test(expected) ||
      !timingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(expected, 'hex'))) {
    return res.status(403).json(apiResponse('error', 'Invalid inventory request token'));
  }
  try {
    const user = req.user as { id: string };
    const product = await inventoryService.adjust(
      req.params.productId, req.body.stockLevel, req.body.lowStockThreshold, req.body.expectedStockLevel, user.id,
    );
    res.json(apiResponse('success', 'Inventory updated', product));
  } catch (err) { handleError(err, res); }
});

export { router as inventoryRouter };
