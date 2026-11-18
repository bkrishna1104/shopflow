// Prometheus metrics.
// WHY: Argo Rollouts (Phase 9) decides "promote or roll back" by querying
// Prometheus for these exact series: request count by status code (5xx rate)
// and the duration histogram (P95 latency). Every service exposes the same
// names so ONE AnalysisTemplate works for all five.
import client from 'prom-client';

const SKIP_PATHS = ['/metrics', '/health/live', '/health/ready'];

export function createMetrics({ serviceName, version }) {
  const register = new client.Registry();
  // Every series carries service + version, so Grafana can compare v1 vs v2.
  register.setDefaultLabels({ service: serviceName, version });
  client.collectDefaultMetrics({ register }); // CPU, memory, event-loop lag, GC

  const httpRequests = new client.Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests',
    labelNames: ['method', 'route', 'status_code'],
    registers: [register],
  });

  const httpDuration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [register],
  });

  function middleware(req, res, next) {
    if (SKIP_PATHS.includes(req.path)) return next();
    const stopTimer = httpDuration.startTimer();
    res.on('finish', () => {
      // Use the route TEMPLATE (/users/:id), never the raw URL (/users/42),
      // otherwise every id creates a new time series ("cardinality explosion").
      const route = req.route ? `${req.baseUrl}${req.route.path}` : 'unmatched';
      const labels = { method: req.method, route, status_code: String(res.statusCode) };
      httpRequests.inc(labels);
      stopTimer(labels);
    });
    next();
  }

  // Helper so each service can add its own business metrics to the same registry.
  function counter(name, help, labelNames = []) {
    return new client.Counter({ name, help, labelNames, registers: [register] });
  }

  return { register, middleware, counter };
}
