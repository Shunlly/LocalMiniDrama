FROM node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0

WORKDIR /app

ENV NODE_ENV=development
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

COPY frontweb/package*.json ./
RUN npm ci
RUN npx playwright install --with-deps chromium

COPY frontweb/Dockerfile ./Dockerfile
COPY frontweb/index.html ./index.html
COPY frontweb/Dockerfile.prod ./Dockerfile.prod
COPY frontweb/nginx.conf ./nginx.conf
COPY frontweb/vite.config.js ./vite.config.js
COPY frontweb/public ./public
COPY docs /docs
COPY frontweb/public /frontweb/public
COPY frontweb/src ./src
COPY frontweb/scripts ./scripts
COPY frontweb/test ./test
COPY frontweb/browser-fixtures ./browser-fixtures
COPY backend-node/src/utils/runtimeInstanceId.js /backend-node/src/utils/runtimeInstanceId.js
COPY backend-node/scripts/e2e-provider.js /backend-node/scripts/e2e-provider.js
COPY backend-node/Dockerfile /backend-node/Dockerfile
COPY backend-node/docker-entrypoint.sh /backend-node/docker-entrypoint.sh
COPY docker-compose.yml /docker-compose.yml
COPY .github/workflows/ci.yml /.github/workflows/ci.yml
COPY .github/workflows/release.yml /.github/workflows/release.yml
COPY .gitignore /.gitignore

RUN chown -R node:node /ms-playwright
RUN chown -R node:node /app
USER node

EXPOSE 3013

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
