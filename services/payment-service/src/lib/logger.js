// Structured JSON logging.
// WHY: in Kubernetes, logs from many pods go to one place (Loki/ELK). JSON lines
// with fixed fields (service, version) let you filter "only payment-service v2".
import pino from 'pino';

export function createLogger({ name, version, level = 'info' }) {
  return pino({
    name,
    level,
    base: { service: name, version },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
