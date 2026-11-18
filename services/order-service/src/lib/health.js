// Kubernetes health endpoints.
//  /health/live  -> "is the process alive?"  If this fails, K8s RESTARTS the pod.
//                   It must NOT check the DB: a DB outage would restart every pod
//                   in a loop and make things worse.
//  /health/ready -> "can I serve traffic?"  If this fails, K8s stops SENDING traffic
//                   to the pod (no restart). It checks the DB, and returns 503
//                   while shutting down so in-flight rollouts drain cleanly.
import { Router } from 'express';

export function healthRouter({ db, serviceName, version, state }) {
  const router = Router();

  router.get('/health/live', (req, res) => {
    res.json({ status: 'UP', service: serviceName, version });
  });

  router.get('/health/ready', async (req, res) => {
    if (state.shuttingDown) {
      return res.status(503).json({ status: 'SHUTTING_DOWN', service: serviceName, version });
    }
    try {
      if (db) await db.query('SELECT 1'); // services without a DB (web-ui) are ready if alive
      res.json({ status: 'READY', service: serviceName, version });
    } catch {
      res.status(503).json({ status: 'NOT_READY', reason: 'database unreachable', service: serviceName, version });
    }
  });

  return router;
}
