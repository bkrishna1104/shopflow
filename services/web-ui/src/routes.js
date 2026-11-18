// BFF = "Backend For Frontend".
// The browser talks ONLY to web-ui (/api/...). web-ui calls the internal services.
// WHY:
//  - In Kubernetes only web-ui is exposed through the Ingress; the 5 APIs stay
//    private inside the cluster (smaller attack surface).
//  - No CORS headaches: the page and its API share one origin.
//  - We expose only what the UI needs, with input checked here first.
import { Router } from 'express';
import { positiveInt } from './lib/validate.js';

// Relay a downstream answer as-is, plus which version handled it.
function relay(res, upstream) {
  if (upstream.version) res.set('X-Upstream-Version', upstream.version);
  res.status(upstream.status).json(upstream.data);
}

const SERVICE_NAMES = {
  users: 'user-service', products: 'product-service', orders: 'order-service',
  payments: 'payment-service', notifications: 'notification-service',
};

const userQuery = (query) => {
  const userId = positiveInt(query.user_id, 'user_id');
  return `?user_id=${userId}&limit=20`;
};

export function apiRouter({ clients, serviceName, version }) {
  const router = Router();

  router.get('/users', async (req, res) => relay(res, await clients.users.get('/users?limit=100')));

  router.post('/users', async (req, res) => {
    relay(res, await clients.users.post('/users', { name: req.body?.name, email: req.body?.email }));
  });

  router.get('/products', async (req, res) => relay(res, await clients.products.get('/products?limit=100')));

  router.post('/orders', async (req, res) => {
    relay(res, await clients.orders.post('/orders', {
      user_id: req.body?.user_id,
      product_id: req.body?.product_id,
      quantity: req.body?.quantity,
    }));
  });

  router.get('/orders', async (req, res) => relay(res, await clients.orders.get(`/orders${userQuery(req.query)}`)));

  router.get('/notifications', async (req, res) => {
    relay(res, await clients.notifications.get(`/notifications${userQuery(req.query)}`));
  });

  // Health + version of every service, for the "Services" strip in the UI.
  // During a canary, refreshing this shows some calls answered by v1, some by v2.
  router.get('/status', async (req, res) => {
    const checks = Object.entries(clients).map(async ([key, client]) => {
      const started = Date.now();
      try {
        const r = await client.get('/health/ready');
        return { service: r.data?.service ?? SERVICE_NAMES[key] ?? key, ok: r.ok, version: r.data?.version ?? r.version, latencyMs: Date.now() - started };
      } catch {
        return { service: SERVICE_NAMES[key] ?? key, ok: false, version: null, latencyMs: Date.now() - started };
      }
    });
    const services = await Promise.all(checks);
    res.json([{ service: serviceName, ok: true, version, latencyMs: 0 }, ...services]);
  });

  return router;
}
