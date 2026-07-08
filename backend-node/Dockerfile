FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=development

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    ffmpeg \
    g++ \
    make \
    pkg-config \
    python3 \
  && rm -rf /var/lib/apt/lists/*

COPY backend-node/package*.json backend-node/.npmrc ./
RUN npm ci

COPY backend-node/src ./src
COPY backend-node/migrations ./migrations
COPY backend-node/configs ./configs
COPY backend-node/prompts ./prompts
COPY backend-node/scripts ./scripts
COPY backend-node/test ./test

EXPOSE 5679

CMD ["npm", "start"]
