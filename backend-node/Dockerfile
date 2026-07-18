FROM node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS dependencies

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    g++ \
    make \
    pkg-config \
    python3 \
  && rm -rf /var/lib/apt/lists/*

COPY backend-node/package*.json backend-node/.npmrc ./
RUN npm ci --omit=dev --no-audit
COPY scripts/runtime-config-policy.cjs /policy/runtime-config-policy.cjs
COPY backend-node/configs/config.yaml /policy/config.yaml
RUN node /policy/runtime-config-policy.cjs /policy/config.yaml /app/config.runtime.yaml

# The entrypoint needs root only to repair ownership on the bind-mounted data directory,
# then immediately execs the requested process as node via setpriv.
FROM node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS runtime

WORKDIR /app

ENV NODE_ENV=production

RUN apt-get update \
  && apt-get upgrade -y --no-install-recommends \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=dependencies --chown=node:node /app/package.json /app/package-lock.json ./

COPY --chown=node:node backend-node/src ./src
COPY --chown=node:node backend-node/migrations ./migrations
COPY --from=dependencies --chown=node:node /app/config.runtime.yaml ./configs/config.yaml
COPY --chown=node:node backend-node/prompts ./prompts
COPY --chown=node:node backend-node/scripts ./scripts
COPY --from=dependencies --chown=root:root /policy/runtime-config-policy.cjs /usr/local/lib/localminidrama/runtime-config-policy.cjs
COPY --chown=root:root backend-node/docker-entrypoint.sh /usr/local/bin/localminidrama-entrypoint

RUN sed -i 's/\r$//' /usr/local/bin/localminidrama-entrypoint \
  && mkdir -p /app/data \
  && chown node:node /app/data \
  && chmod 0755 /usr/local/bin/localminidrama-entrypoint

ARG LOCALMINIDRAMA_BUILD_REVISION=unknown
LABEL org.opencontainers.image.revision="${LOCALMINIDRAMA_BUILD_REVISION}"

ENTRYPOINT ["/usr/local/bin/localminidrama-entrypoint"]

EXPOSE 5679

FROM runtime AS verification

COPY --chown=node:node backend-node/test ./test
COPY --chown=node:node docker-compose.yml /docker-compose.yml
COPY --chown=node:node .dockerignore /.dockerignore
COPY --chown=node:node scripts/verify-docker-artifact.cjs /scripts/verify-docker-artifact.cjs
COPY --chown=node:node scripts/runtime-config-policy.cjs /scripts/runtime-config-policy.cjs
COPY --chown=node:node frontweb/nginx.conf /frontweb/nginx.conf

CMD ["npm", "run", "verify"]

FROM runtime AS production

RUN rm -rf /usr/local/lib/node_modules/npm \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx

CMD ["node", "src/server.js"]
