# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# Multi-stage build.
#   Stage 1 (deps):    install ONLY production dependencies.
#   Stage 2 (runtime): copy deps + source into a clean image.
# WHY: the final image has no npm cache, no test files, no devDependencies
#      -> smaller image, faster pulls on EKS, fewer CVEs for Trivy to flag.
# ---------------------------------------------------------------------------
ARG NODE_IMAGE=node:24-alpine

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
# Copy ONLY the package files first. Docker caches each layer; as long as
# package*.json don't change, `npm ci` is skipped on rebuilds (seconds, not minutes).
COPY package.json package-lock.json ./
# npm ci = exact versions from package-lock.json (reproducible), unlike npm install.
RUN npm ci --omit=dev && npm cache clean --force

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

# The version is baked in at build time by Jenkins (--build-arg APP_VERSION=1.4.2)
# and shows up in logs, metrics labels and the X-App-Version header.
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
LABEL org.opencontainers.image.version=${APP_VERSION} \
      org.opencontainers.image.source="https://github.com/YOUR_GITHUB_USER/shopflow"

# Never run as root: if the app is compromised, the attacker is not root in
# the container. The official node image ships a ready-made 'node' user.
USER node
EXPOSE 8080

# Run node DIRECTLY (not `npm start`): npm does not forward SIGTERM to the app,
# which would break graceful shutdown during Kubernetes rollouts.
CMD ["node", "src/server.js"]
