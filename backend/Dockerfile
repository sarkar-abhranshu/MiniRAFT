# syntax=docker/dockerfile:1
FROM node:20-alpine

# Create app directory
WORKDIR /app

# Install dependencies first (layer caching)
COPY package.json ./
RUN npm install --omit=dev

# Copy source files
COPY . .

# PORT, REPLICAS, and LEADER_POLL are injected at runtime via docker-compose environment
CMD ["node", "server.js"]
