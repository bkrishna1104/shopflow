# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# Multi-stage build.
#   Stage 1 (deps):    install ONLY production dependencies.
#   Stage 2 (runtime): copy deps + source into a clean image.
# WHY: the final image has no npm cache, no test files, no devDependencies
#      -> smaller image, faster pulls on EKS, fewer CVEs for Trivy to flag.
# ---------------------------------------------------------------------------
# Base image written literally (not via ARG) so Dependabot can see and update it.
FROM node:24-alpine AS deps
WORKDIR /app
# Copy ONLY the package files first, so `npm ci` is cached until dependencies change.
COPY package.json package-lock.json ./
# npm ci = exact versions from package-lock.json (reproducible), unlike npm install.
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24-alpine AS runtime
ENV NODE_ENV=production

# Security hardening (this is what the Trivy gate checks):
#  - apk upgrade: pick up Alpine security patches released after the base image was built.
#  - remove npm/npx/corepack: the app is started with `node` directly, so the package
#    managers are dead weight in production, and their bundled dependencies are a
#    frequent source of HIGH CVEs in image scans. Less software = smaller attack surface.
RUN apk upgrade --no-cache \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public

# The version is baked in at build time by Jenkins (--build-arg APP_VERSION=1.4.2)
# and shows up in logs, metrics labels and the X-App-Version header.
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
LABEL org.opencontainers.image.version=${APP_VERSION} \
      org.opencontainers.image.source="https://github.com/bkrishna1104/shopflow"

# Never run as root: if the app is compromised, the attacker is not root in the container.
USER node
EXPOSE 8080

# Run node DIRECTLY (not `npm start`): npm does not forward SIGTERM to the app,
# which would break graceful shutdown during Kubernetes rollouts.
CMD ["node", "src/server.js"]