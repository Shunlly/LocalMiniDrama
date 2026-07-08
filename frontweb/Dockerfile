FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=development
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY frontweb/package*.json ./
RUN npm ci

COPY frontweb/index.html ./index.html
COPY frontweb/vite.config.js ./vite.config.js
COPY frontweb/public ./public
COPY frontweb/src ./src
COPY frontweb/scripts ./scripts
COPY frontweb/test ./test

EXPOSE 3013

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
