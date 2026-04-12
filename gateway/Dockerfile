# syntax=docker/dockerfile:1
FROM node:18-alpine

WORKDIR /app

COPY gateway/package*.json ./
RUN npm install

COPY gateway/ ./
COPY frontend/ /app/frontend/

CMD ["npm", "run", "dev"]
