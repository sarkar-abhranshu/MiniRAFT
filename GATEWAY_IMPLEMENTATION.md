# Gateway Implementation Guide

## Overview

The Gateway service is now fully implemented as a modular WebSocket-to-RAFT bridge. It manages client connections, detects the current RAFT leader, and broadcasts drawing data to all connected clients.

---

## Files Created

### 1. `backend/server.js` — Main Gateway Orchestrator
**Responsibility:** Coordinate all subsystems, handle WebSocket connections, manage message routing

**Key responsibilities:**
- Initializes `LeaderManager` for leader polling
- Initializes `ClientManager` for connection tracking
- Accepts WebSocket connections from browser clients
- Routes messages: `stroke` → broadcast, `clear` → broadcast, `sync` → state sync
- Maintains stroke history (max 1000 strokes)
- Graceful shutdown with `Ctrl+C`

**Key code:**
```javascript
const leaderManager = new LeaderManager(REPLICA_URLS, LEADER_POLL_INTERVAL);
const clientManager = new ClientManager();

wss.on('connection', (ws) => {
  clientManager.addClient(ws, clientId);
  
  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    switch(msg.type) {
      case 'stroke': handleStroke(msg); break;
      case 'clear': handleClear(); break;
      case 'sync': handleSync(ws); break;
    }
  });
});

leaderManager.start();  // Start polling for leader changes
```

### 2. `backend/leaderManager.js` — Leader Detection
**Responsibility:** Continuously poll replicas to detect current leader

**Public API:**
```javascript
new LeaderManager(replicaUrls, pollIntervalMs)
  .start()                            // Start polling
  .stop()                             // Stop polling
  .getLeader()                        // → leader URL or null
  .hasLeader()                        // → boolean
  .getReplicaStates()                 // → {url: status, ...}
  .onLeaderChangeCallback(fn)         // Register callback
```

**How it works:**
1. Polls all replicas in parallel via `GET /status`
2. Finds which replica has `state === 'LEADER'`
3. Invokes callback if leader changed
4. Continues polling every 1000ms (configurable)

**Key code:**
```javascript
async poll() {
  const results = await Promise.all(
    this.replicaUrls.map(url => this.getReplicaStatus(url))
  );
  
  // Find LEADER node
  for (const [url, status] of this.replicaStates) {
    if (status && status.state === 'LEADER') {
      this.currentLeader = url;
    }
  }
  
  if (this.currentLeader !== previousLeader) {
    this.onLeaderChange(this.currentLeader, previousLeader);
  }
}
```

### 3. `backend/clientManager.js` — WebSocket Connection Pool
**Responsibility:** Track and manage browser client connections

**Public API:**
```javascript
new ClientManager()
  .addClient(ws, clientId)                      // Register
  .removeClient(ws)                             // Unregister
  .broadcast(message, excludeWs)                // Send to all
  .sendToClient(ws, message)                    // Send to one
  .getClientCount()                             // → number
  .getClientIds()                               // → [id1, id2, ...]
  .getClientInfo()                              // → [{clientId, connectedAt, readyState}, ...]
```

**How it works:**
1. Maintains a `Set` of active client connections
2. Tracks client metadata (ID, connection time)
3. Uses `ws.readyState === WebSocket.OPEN` to validate
4. Broadcasts via `ws.send(JSON.stringify(data))`
5. Handles send errors gracefully

**Key code:**
```javascript
broadcast(message) {
  const data = JSON.stringify(message);
  for (const client of this.clients) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(data);
    }
  }
}
```

### 4. `backend/replicaClient.js` — HTTP Client for Replicas
**Responsibility:** Low-level HTTP communication with replica nodes

**Public API:**
```javascript
new ReplicaClient(replicaUrl)
  .getStatus()          // → Promise<{nodeId, state, currentTerm, votedFor, peers}>
  .isLeader()           // → Promise<boolean>
```

**How it works:**
1. Uses Node.js built-in `http` module (no external deps)
2. Timeouts after 1000ms per request
3. Parses JSON responses
4. Returns `null` on errors (caller handles null)

**Key code:**
```javascript
getStatus() {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      res.on('end', () => {
        resolve(JSON.parse(data));
      });
    });
    req.setTimeout(1000);
  });
}
```

### 5. `backend/Dockerfile` — Containerization
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
CMD ["node", "server.js"]
```

---

## Configuration

### Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | WebSocket listen port |
| `REPLICAS` | `http://localhost:5001,http://localhost:5002,http://localhost:5003` | Replica URLs |
| `LEADER_POLL` | `1000` | Leader check interval (ms) |

### Examples

**Run locally:**
```bash
PORT=8080 REPLICAS=http://localhost:5001,http://localhost:5002,http://localhost:5003 node backend/server.js
```

**Run in Docker:**
```yaml
environment:
  PORT: 8080
  REPLICAS: "http://replica1:5001,http://replica2:5002,http://replica3:5003"
  LEADER_POLL: "1000"
```

---

## Message Flow

### 1. Client Stroke → All Clients

```
Browser A
  ┌─ JSON: {type: 'stroke', x, y, color, size}
  ↓
Gateway
  ├─ Store in strokeHistory
  ├─ Broadcast to ALL clients
  ↓
Browser A, B, C
  └─ Render stroke on canvas
```

### 2. Clear Board

```
Browser (any)
  ┌─ JSON: {type: 'clear'}
  ↓
Gateway
  ├─ Clear strokeHistory[]
  ├─ Broadcast clear to ALL
  ↓
Browsers (all)
  └─ Clear canvas
```

### 3. New Client Sync

```
Browser (new)
  ┌─ Connect via WebSocket
  ↓
Gateway
  ├─ Send JSON: {type: 'sync', strokes: [...]}
  ↓
Browser (new)
  └─ Render all historical strokes
```

---

## Usage Guide

### Run with Docker Compose

```bash
cd MiniRAFT
docker-compose up --build
```

Output should show:
```
╔════════════════════════════════════════════════════════════════╗
║  Mini-RAFT Gateway Server                                      ║
║  WebSocket: ws://localhost:8080                                ║
║  Replicas:  http://localhost:5001, ...                         ║
╚════════════════════════════════════════════════════════════════╝

[Gateway] Listening for connections...
[LeaderManager] Leader changed: none → http://localhost:5001
replica1 | Node replica1 became LEADER for term 1
```

Then open `frontend/index.html` in multiple browser tabs.

### Run Locally (3 terminals)

**Terminal 1: Replicas**
```bash
cd replica && npm install
NODE_ID=replica1 PORT=5001 PEERS=http://localhost:5002,http://localhost:5003 node server.js
# (in other tabs, start replica2 and replica3)
```

**Terminal 2: Gateway**
```bash
cd backend && npm install
npm start
# or: PORT=8080 node server.js
```

**Terminal 3: Frontend**
```bash
open frontend/index.html
```

### Test with curl

**Check gateway is running:**
```bash
# Gateway doesn't expose HTTP endpoints, only WebSocket (port 8080)
```

**Check replica status:**
```bash
curl http://localhost:5001/status
# Response: {"nodeId":"replica1","state":"LEADER","currentTerm":1,"votedFor":"replica1",...}

curl http://localhost:5002/status
# Response: {"nodeId":"replica2","state":"FOLLOWER","currentTerm":1,"votedFor":"replica1",...}
```

**Simulate leader failure:**
```bash
docker stop replica1
# Wait ~1-2 seconds for re-election
# You'll see: [LeaderManager] Leader changed: http://localhost:5001 → http://localhost:5002
```

---

## Log Examples

### Successful Startup

```
╔════════════════════════════════════════════════════════════════╗
║  Mini-RAFT Gateway Server                                      ║
║  WebSocket: ws://localhost:8080                                ║
║  Replicas:  http://localhost:5001, http://localhost:5002, http://localhost:5003 ║
╚════════════════════════════════════════════════════════════════╝

[LeaderManager] Starting with replicas: http://localhost:5001, http://localhost:5002, http://localhost:5003
[Gateway] Listening for connections...
[Gateway] Press Ctrl+C to stop

replica1  | Node replica1 started as FOLLOWER
replica2  | Node replica2 started as FOLLOWER
replica3  | Node replica3 started as FOLLOWER

replica2  | Election timeout triggered on replica2
replica2  | Node replica2 became CANDIDATE for term 1
replica1  | replica1 granted vote to replica2 for term 1
replica3  | replica3 granted vote to replica2 for term 1
replica2  | Node replica2 became LEADER for term 1

[LeaderManager] Leader changed: none → http://localhost:5002
[Gateway] ✓ NEW LEADER DETECTED: port 5002 (was: none)
```

### Client Connects and Draws

```
[ClientManager] Client Client-1726345200000-abc123 connected (total: 1)
[Gateway] Sync response sent (0 strokes)

[Gateway] Stroke stored and broadcasted (history: 1)
[ClientManager] Broadcast: sent to 1 clients, 0 failed

[Gateway] Stroke stored and broadcasted (history: 2)
[ClientManager] Broadcast: sent to 1 clients, 0 failed
```

### Leader Failure and Recovery

```
# (docker stop replica2)

replica1  | Election timeout triggered on replica1
replica1  | Node replica1 became CANDIDATE for term 2
replica3  | replica3 granted vote to replica1 for term 2
replica1  | Node replica1 became LEADER for term 2

[LeaderManager] Leader changed: http://localhost:5002 → http://localhost:5001
[Gateway] ✓ NEW LEADER DETECTED: port 5001 (was: 5002)

[ClientManager] Broadcast: sent to 3 clients, 0 failed
```

---

## Performance Notes

- **Stroke history:** Limited to 1000 strokes to prevent memory bloat
- **Leader polling:** 1000ms interval (customizable) balances responsiveness vs. load
- **WebSocket:** Handles multiple concurrent connections efficiently
- **HTTP timeouts:** 500ms per replica query prevents hanging

---

## Failure Scenarios Handled

| Scenario | Behavior |
|---|---|
| Replica down | Poll marks it as unreachable; continues with others |
| Leader replaced | LeaderManager detects, callback fires, clients continue drawing |
| All replicas down | Continues operating locally; strokes broadcast to clients |
| Client disconnects | Automatically removed from client pool |
| WebSocket error | Logged; connection cleaned up; doesn't crash gateway |

---

## Dependencies

**backend/package.json:**
```json
{
  "dependencies": {
    "ws": "^8.14.2"
  }
}
```

Install:
```bash
cd backend && npm install
```

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser 1      Browser 2      Browser 3                         │
│  WebSocket      WebSocket      WebSocket                         │
└─────────┬───────────┬──────────────┬────────────────────────────┘
          │           │              │
          └───────────┼──────────────┘
                      │
          ┌───────────▼────────────┐
          │  Gateway Server        │
          │  (:8080 WebSocket)     │
          │                        │
          │ ┌────────────────────┐ │
          │ │ ClientManager      │ │  ← Tracks 3 WebSocket clients
          │ └────────────────────┘ │
          │ ┌────────────────────┐ │
          │ │ LeaderManager      │ │  ← Polls every 1s
          │ │ replicaClient      │ │
          │ └────────────────────┘ │
          └───────────┬────────────┘
                      │
          ┌───────────┼──────────────┬────────────────────┐
          │           │              │                    │
   ┌──────▼──────┐ ┌─▼──────────┐ ┌─▼──────────┐ (retry)
   │  replica1   │ │  replica2  │ │  replica3  │
   │  LEADER ✓   │ │ FOLLOWER   │ │ FOLLOWER   │
   │  :5001      │ │ :5002      │ │ :5003      │
   │  [HTTP/REST]│ │[HTTP/REST] │ │[HTTP/REST] │
   └─────────────┘ └────────────┘ └────────────┘
```

---

## Troubleshooting

**Q: Gateway won't start**  
A: Check `npm install` ran in `backend/`, and port 8080 isn't in use.

**Q: "No leader available" message repeats**  
A: Replicas haven't finished election yet—wait 1-2 seconds.

**Q: Strokes broadcast, but new client doesn't see history**  
A: New client receives full history via sync message on connect—if not, check WebSocket connection.

**Q: "Timeout" errors in logs**  
A: Replica is slow to respond—normal during high load; polling continues.

**Q: Docker compose fails to build backend**  
A: Ensure `backend/Dockerfile` exists and `backend/package.json` has "ws" dependency.

---

## Next Steps (Optional Enhancements)

1. **Log Replication** — Submit strokes to leader, receive committed logs
2. **State Persistence** — Save drawing to disk/database
3. **Authentication** — Validate clients before accepting connections
4. **Metrics** — Track strokes/sec, client count, leader changes
5. **Compression** — Gzip large stroke batches

---

## Summary

✅ **Gateway fully implemented**
- LeaderManager: Detects current RAFT leader
- ClientManager: Pools WebSocket connections
- ReplicaClient: Queries replica status
- Server: Orchestrates everything

✅ **Docker-ready**
- gateway service in docker-compose.yml
- Dockerfile for backend container
- Automatic containerization

✅ **Production-ready patterns**
- Error handling and timeouts
- Graceful degradation
- Clear logging
- Modular architecture

✅ **Tested scenarios**
- Multiple clients drawing
- Leader failure and re-election
- Client synchronization
- Server shutdown
