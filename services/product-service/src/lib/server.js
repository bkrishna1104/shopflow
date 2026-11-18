// Starts the HTTP server and handles GRACEFUL SHUTDOWN.
//
// WHY this matters for canary releases: during a rollout Kubernetes sends SIGTERM
// to old pods. Removing the pod from the load balancer happens *in parallel*, so
// for a few seconds traffic still arrives. If we exit instantly those requests
// fail -> 5xx spike -> Argo Rollouts thinks the release is bad and rolls back.
// So: mark not-ready, wait SHUTDOWN_DELAY_MS, finish in-flight requests, close DB.
export function startServer({ app, port, logger, pool, state, shutdownDelayMs = 0 }) {
  const server = app.listen(port, () => logger.info({ port }, 'server listening'));
  // e.g. EADDRINUSE (port already taken): log clearly and exit non-zero so
  // Docker/Kubernetes notice and restart, instead of a half-alive process.
  server.on('error', (err) => {
    logger.fatal({ err }, 'server failed to start');
    process.exit(1);
  });

  let stopping = false;
  async function shutdown(signal) {
    if (stopping) return;
    stopping = true;
    logger.info({ signal, shutdownDelayMs }, 'shutdown started');
    state.shuttingDown = true; // /health/ready now returns 503
    await new Promise((r) => setTimeout(r, shutdownDelayMs));
    server.close(async () => {
      await pool.end();
      logger.info('shutdown complete');
      process.exit(0);
    });
    server.closeIdleConnections();
    setTimeout(() => {
      logger.error('forced exit after timeout');
      process.exit(1);
    }, 10000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  return server;
}
