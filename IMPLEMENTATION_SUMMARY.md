# Implementation Summary (Updated)

This repository was updated to match the required 4-service MiniRAFT architecture:

- `gateway` (WebSocket)
- `replica1`, `replica2`, `replica3` (independent Node.js REST services)

## What changed

### 1) Gateway service added

- New folder: `gateway/`
- WebSocket server uses `ws`
- Receives drawing messages and forwards `stroke`/`clear` **only** to current leader
- Broadcasts **only committed** strokes to all connected clients

### 2) Replica REST endpoints completed

Each replica exposes:

- `POST /request-vote`
- `POST /append-entries`
- `POST /heartbeat`
- `GET|POST /sync-log`

Additional internal endpoint used by gateway:

- `POST /client-stroke` (leader-only)

### 3) Docker + hot reload

- Services use `node:18-alpine`
- `nodemon` enabled for hot reload (`npm run dev`)
- Compose mounts volumes:
  - `./gateway:/app`
  - `./replica:/app`

### 4) Compose ports and networking

- Gateway: `4000`
- Replicas: `5001`, `5002`, `5003`
- Service-to-service URLs use Docker service names (not localhost)

## Files updated/added

- `gateway/*` (new)
- `replica/server.js`, `replica/rpc.js`, `replica/raftNode.js`, `replica/election.js`
- `replica/Dockerfile`, `replica/package.json`
- `docker-compose.yml`
- `frontend/websocket.js` (ws://localhost:4000)
- `README.md`
