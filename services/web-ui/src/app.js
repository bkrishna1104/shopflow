import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createBaseApp } from './lib/base-app.js';
import { apiRouter } from './routes.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

export function createApp({ serviceName, version, clients, logger, metrics, state }) {
  return createBaseApp({
    serviceName, version, logger, metrics, state,
    db: null, // web-ui has no database: readiness = process is up
    mount: (app) => {
      app.use('/api', apiRouter({ clients, serviceName, version }));
      // The page itself: plain HTML/CSS/JS, no build step, so the CI pipeline
      // stays the same as for the other services (npm ci -> test -> docker build).
      app.use(express.static(publicDir, { maxAge: 0 }));
    },
  });
}
