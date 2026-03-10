# syntax=docker/dockerfile:1
FROM node:20-alpine

# Create app directory
WORKDIR /app

# Install dependencies first (layer caching)
COPY package.json ./
RUN npm install --omit=dev

# Copy source files
COPY . .

# NODE_ID and PORT are injected at runtime via docker-compose environment
CMD ["node", "server.js"]
