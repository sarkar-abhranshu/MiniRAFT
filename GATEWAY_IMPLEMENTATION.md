# Gateway Implementation Guide (Updated)

## Goal

The `gateway/` service is the single WebSocket entrypoint for browser clients.

- Receives drawing commands from clients (`stroke`, `clear`).
- Forwards commands **only** to the current RAFT **leader**.
- Broadcasts **only committed** commands to all connected clients.

The leader is discovered by polling replicas’ `GET /status` endpoint.

---

## Services and Ports

- Gateway (WebSocket): `ws://localhost:4000`
- Replica1 (REST): `http://localhost:5001`
- Replica2 (REST): `http://localhost:5002`
- Replica3 (REST): `http://localhost:5003`

When running in Docker Compose, replicas are addressed by service name:

- `http://replica1:5001`, `http://replica2:5002`, `http://replica3:5003`

---

## Folder

`gateway/` contains:

- `server.js` — WebSocket server + leader-forwarding write path
- `leaderManager.js` — polls replicas to track the current leader
- `clientManager.js` — tracks WebSocket clients and broadcasts
- `Dockerfile` — Node 18 Alpine + nodemon (hot reload)
- `package.json` — `ws` dependency + `nodemon` dev script

---

## Runtime Configuration

Environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | WebSocket listen port |
| `REPLICAS` | `http://replica1:5001,http://replica2:5002,http://replica3:5003` | Replica base URLs |
| `LEADER_POLL` | `1000` | Leader polling interval in ms |

---

## Message Flow

### 1) Client sends stroke

1. Browser sends `{ "type": "stroke", ... }` to gateway over WebSocket.
2. Gateway forwards it to the current leader:

   `POST <leader>/client-stroke` with `{ command: <originalMessage> }`

3. Leader replicates to followers (`POST /append-entries`) and commits when it gets a majority.
4. Leader returns `{ committedMessage: <originalMessage> }`.
5. Gateway broadcasts the committed message to all clients and adds it to history.

### 2) Client sends clear

Same as stroke, except the committed message is `{ "type": "clear" }` and gateway resets its history.

### 3) Client sync

- Browser sends `{ "type": "sync" }` to gateway.
- Gateway replies with `{ "type": "sync", "strokes": [...] }` from its committed history.

---

## Notes

- The gateway does **not** broadcast uncommitted strokes.
- If there is no leader available, the gateway replies to the client with `{ type: "error" }`.
- Leader discovery is done by polling `GET /status` on replicas; leader changes are handled without crashing.

---

## Run

### Docker Compose

```bash
docker compose up --build
```

Then open `frontend/index.html`.

### Local

```bash
cd replica && npm install
NODE_ID=replica1 PORT=5001 PEERS=http://localhost:5002,http://localhost:5003 npm start
NODE_ID=replica2 PORT=5002 PEERS=http://localhost:5001,http://localhost:5003 npm start
NODE_ID=replica3 PORT=5003 PEERS=http://localhost:5001,http://localhost:5002 npm start

cd ..\gateway && npm install && npm start
```
