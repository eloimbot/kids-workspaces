FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends docker.io \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/package.json backend/package-lock.json* ./
RUN npm install --omit=dev

COPY backend/src ./src
COPY backend/data ./data
COPY frontend/public ./frontend/public

ENV PORT=3000

CMD ["npm", "start"]
