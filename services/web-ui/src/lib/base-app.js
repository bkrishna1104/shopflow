// The common Express skeleton shared by all five services.
// Each service only supplies `mount(app)` to add its own routes.
import express from 'express';
import { pinoHttp } from 'pino-http';
import { healthRouter } from './health.js';
import { notFound, errorHandler } from './errors.js';

export function createBaseApp({ serviceName, version, db, logger, metrics, state, mount }) {
  const app = express();
  app.disable('x-powered-by'); // don't advertise the framework to attackers
  app.use(express.json({ limit: '100kb' }));

  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url.startsWith('/health') || req.url === '/metrics' },
    }),
  );

  // Every response says which version served it — you will SEE the canary split.
  app.use((req, res, next) => {
    res.set('X-App-Version', version);
    res.set('X-Service', serviceName);
    next();
  });

  app.use(metrics.middleware);
  app.use(healthRouter({ db, serviceName, version, state }));
  app.get('/metrics', async (req, res) => {
    res.set('Content-Type', metrics.register.contentType);
    res.send(await metrics.register.metrics());
  });

  mount(app);

  app.use(notFound);
  app.use(errorHandler(logger));
  return app;
}
