import { Router, Request, Response, NextFunction } from 'express';
import { productService } from '../services/ProductService.js';
import { orderService } from '../services/OrderService.js';
import { InventoryError } from '../services/InventoryService.js';
import { apiResponse } from '../utils/web.js';

const router = Router();

interface CartItem { id: string; name: string; qty: number; price: number; }
interface ReactCartItem { pid: string; quantity: unknown; }

function getCart(req: Request): CartItem[] {
  return (req.session as any).cart || [];
}

router.get('/cart', (req: Request, res: Response) => {
  res.redirect(301, '/app/cart');
});

router.post('/cart/add', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { productId, qty } = req.body;
    const product = await productService.findById(productId);
    if (!product) return res.redirect('/app/products');
    const cart: CartItem[] = (req.session as any).cart || [];
    const existing = cart.find(i => i.id === productId);
    if (existing) existing.qty += parseInt(qty) || 1;
    else cart.push({ id: product.id, name: product.name, qty: parseInt(qty) || 1, price: product.onSale ? product.salePrice : product.price });
    (req.session as any).cart = cart;
    res.redirect('/app/cart');
  } catch (err) { next(err); }
});

router.post('/cart/update', (req: Request, res: Response) => {
  const { productId, qty } = req.body;
  const cart: CartItem[] = (req.session as any).cart || [];
  const item = cart.find(i => i.id === productId);
  if (item) item.qty = parseInt(qty) || 1;
  (req.session as any).cart = cart;
  res.redirect('/app/cart');
});

router.post('/cart/remove', (req: Request, res: Response) => {
  const { productId } = req.body;
  (req.session as any).cart = ((req.session as any).cart || []).filter((i: CartItem) => i.id !== productId);
  res.redirect('/app/cart');
});

router.post('/cart/checkout', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.isAuthenticated()) {
      if (req.accepts('html', 'json') === 'json') {
        return res.status(401).json(apiResponse('error', 'Please sign in to check out'));
      }
      const redirect = req.body.appReturnTo === '/app/cart' ? '/app/cart' : '/cart';
      return res.redirect('/app/login?redirect=' + encodeURIComponent(redirect));
    }

    const cart = req.body.cartJson ? await buildCartFromReactPayload(String(req.body.cartJson)) : getCart(req);
    if (!cart.length) {
      if (req.accepts('html', 'json') === 'json') {
        return res.status(400).json(apiResponse('error', 'Your cart is empty'));
      }
      return res.redirect(req.body.appReturnTo === '/app/cart' ? '/app/cart' : '/cart');
    }
    const user = req.user as any;
    const amount = cart.reduce((sum, i) => sum + i.qty * i.price, 0);
    await orderService.create({
      orderNum: 'ORD-' + Date.now(),
      amount,
      cart: JSON.stringify(cart),
      shipped: false,
      userId: user.id,
    } as any, user.id);
    (req.session as any).cart = [];
    const redirect = req.body.appReturnTo === '/app/cart' ? '/app/user/orders' : '/user/orders';
    if (req.accepts('html', 'json') === 'json') return res.json(apiResponse('success', 'Order created', { redirect }));
    res.redirect(redirect);
  } catch (err) {
    if (err instanceof InventoryError) {
      if (req.accepts('html', 'json') === 'json') return res.status(err.status).json(apiResponse('error', err.message));
      return res.redirect('/app/cart?error=' + encodeURIComponent(err.message));
    }
    next(err);
  }
});

async function buildCartFromReactPayload(cartJson: string): Promise<CartItem[]> {
  let items: unknown;
  try {
    items = JSON.parse(cartJson);
  } catch {
    throw new InventoryError('Cart must be a JSON array', 400);
  }
  if (!Array.isArray(items) || items.some(item => !item || typeof item.pid !== 'string' || !item.pid)) {
    throw new InventoryError('Cart items must have a product ID', 400);
  }
  const validItems: ReactCartItem[] = items;
  const products = await Promise.all(validItems.map(item => productService.findById(item.pid)));
  const cart: CartItem[] = [];
  validItems.forEach((item, index) => {
    const product = products[index];
    if (!product) throw new InventoryError('A product in your cart is no longer available', 404);
    const quantity = typeof item.quantity === 'number'
      ? item.quantity
      : typeof item.quantity === 'string' && /^-?\d+$/.test(item.quantity)
        ? Number(item.quantity)
        : NaN;
    if (!Number.isSafeInteger(quantity) || quantity === 0) {
      throw new InventoryError('Cart quantities must be nonzero whole numbers', 400);
    }
    cart.push({
      id: product.id,
      name: product.name,
      qty: quantity,
      price: Number(product.onSale ? product.salePrice : product.price),
    });
  });
  return cart;
}

export { router as cartRouter };
