# MiniRAFT — Distributed Real-Time Drawing Board

A collaborative drawing application backed by a simplified RAFT consensus protocol. Multiple browser clients draw on a shared canvas; strokes are coordinated through a WebSocket Gateway that detects and adapts to leader changes in the RAFT cluster.

## Architecture

```
Browser Canvas  (ws://localhost:8080)
      ↕  WebSocket
┌─────────────────────────────────────────────┐
│     Gateway Server (backend/)               │
│  • Detects current RAFT leader              │
│  • Broadcasts strokes via WebSocket         │
│  • Maintains client connections             │
│  • Syncs state to new clients               │
└─────────────────────────────────────────────┘
      ↕  HTTP (leader detection)
┌─────────────┬─────────────┬─────────────┐
│  replica1   │  replica2   │  replica3   │
│  port 5001  │  port 5002  │  port 5003  │
│             │             │             │
│  RAFT node  │  RAFT node  │  RAFT node  │
│  Leader:    │  Follower   │  Follower   │
│  (elected)  │             │             │
└─────────────┴─────────────┴─────────────┘
```

## Project Structure

```
├── frontend/
│   ├── index.html          # Main HTML page
│   ├── style.css           # Styling
│   ├── canvas.js           # Drawing logic
│   ├── websocket.js        # WebSocket connection
│   ├── ui.js               # Toolbar controls
│   └── sync.js             # State synchronization
├── backend/
│   ├── server.js           # Main gateway orchestrator
│   ├── leaderManager.js    # Detects current RAFT leader
│   ├── clientManager.js    # Manages WebSocket clients
│   ├── replicaClient.js    # HTTP client for replicas
│   ├── Dockerfile
│   └── package.json
├── replica/                # RAFT replica node
│   ├── server.js           # Express entry point + startup
│   ├── raftNode.js         # Node state & transitions
│   ├── election.js         # Election logic & heartbeat loop
│   ├── rpc.js              # /request-vote & /heartbeat handlers
│   ├── timers.js           # Election & heartbeat timers
│   ├── package.json
│   └── Dockerfile
├── docker-compose.yml      # Runs gateway + 3 replicas
└── README.md
```

## Features

**Drawing board**
- ✅ Real-time collaborative drawing
- ✅ Multi-user support
- ✅ Color picker
- ✅ Adjustable brush size (1–20px)
- ✅ Clear board functionality
- ✅ Auto-reconnect on disconnect
- ✅ Connection status indicator
- ✅ Board state synchronization for new clients

**Gateway**
- ✅ Maintains multiple concurrent client connections
- ✅ Detects current RAFT leader via polling
- ✅ Handles leader changes gracefully
- ✅ Broadcasts strokes to all connected clients
- ✅ Recovers from replica failures
- ✅ Provides full state sync to new clients

**Mini-RAFT consensus**
- ✅ Leader election with random timeouts (500–800 ms)
- ✅ Majority vote (2 of 3 nodes)
- ✅ Heartbeat suppression of spurious elections (150 ms interval)
- ✅ Split-vote handling — losing candidates revert to FOLLOWER and retry
- ✅ Automatic re-election on leader failure
- ✅ Higher-term detection — any node discovering a newer term steps down immediately
- ✅ `GET /status` endpoint on each replica for inspection

## Technologies Used

**Frontend:** Vanilla JavaScript, HTML5 Canvas API, WebSocket API

**Gateway:** Node.js, `ws` (no external HTTP libraries needed—uses native `http` module)

**Replica nodes:** Node.js, Express, `axios` (for inter-replica RPCs)

**Infrastructure:** Docker, Docker Compose

## Running the Project

### Prerequisites
- Node.js v18+
- npm
- Docker + Docker Compose (recommended)

---

### Option 1: Run with Docker Compose (Recommended)

```bash
cd MiniRAFT
docker-compose up --build
```

This starts:
- **Gateway** on port `8080` (WebSocket)
- **Replica 1** on port `5001` (HTTP)
- **Replica 2** on port `5002` (HTTP)
- **Replica 3** on port `5003` (HTTP)

Once you see leader election logs, open the frontend:

```bash
open frontend/index.html   # macOS
start frontend/index.html  # Windows
```

Open multiple tabs and draw simultaneously.

**Simulate leader failure:**

```bash
# In another terminal, while docker-compose is running
docker stop replica2

# Wait ~1 second, you'll see re-election logs
# Gateway automatically detects new leader and continues

docker start replica2  # node rejoins as FOLLOWER
```

---

### Option 2: Run Locally (No Docker)

**Terminal 1: Start all 3 replicas**

```bash
cd replica && npm install

# Tab 1
NODE_ID=replica1 PORT=5001 PEERS=http://localhost:5002,http://localhost:5003 node server.js

# Tab 2
NODE_ID=replica2 PORT=5002 PEERS=http://localhost:5001,http://localhost:5003 node server.js

# Tab 3
NODE_ID=replica3 PORT=5003 PEERS=http://localhost:5001,http://localhost:5002 node server.js
```

**Terminal 2: Start the gateway**

```bash
cd backend && npm install && npm start
# Gateway will start polling replicas at http://localhost:5001-5003
```

**Terminal 3: Open the frontend**

```bash
open frontend/index.html
```

**Check replica status:**

```bash
curl http://localhost:5001/status
curl http://localhost:5002/status
curl http://localhost:5003/status
```

---

## Gateway Architecture

The gateway is a modular system that separates concerns:

### `server.js` — Main Orchestrator

Initializes and coordinates all subsystems:

```javascript
const wss = new WebSocket.Server({ port: 8080 });
const clientManager = new ClientManager();
const leaderManager = new LeaderManager(replicaUrls);

// Start polling for leader changes
leaderManager.start();

// Handle incoming WebSocket connections from clients
wss.on('connection', (ws) => {
  clientManager.addClient(ws, clientId);
  // Route messages: stroke → broadcast
  ws.on('message', (data) => {
    const message = JSON.parse(data);
    if (message.type === 'stroke') {
      clientManager.broadcast(message);
    }
  });
});
```

### `leaderManager.js` — Leader Detection

Constantly polls `/status` endpoints to find the current leader:

```javascript
const leaderMgr = new LeaderManager(
  ['http://localhost:5001', 'http://localhost:5002', 'http://localhost:5003'],
  1000  // poll every 1 second
);

leaderMgr.onLeaderChangeCallback((newLeader, oldLeader) => {
  console.log(`Leader changed: ${oldLeader} → ${newLeader}`);
});

leaderMgr.start();  // Start polling
```

**Key methods:**
- `getLeader()` — Returns current leader URL or null
- `hasLeader()` — Boolean check
- `poll()` — Manually trigger status check
- `getReplicaStates()` — View all replica states

### `clientManager.js` — WebSocket Connection Pool

Maintains connections to all browser clients:

```javascript
const clientMgr = new ClientManager();

// Add client
clientMgr.addClient(ws, 'Client-123');

// Broadcast to all clients
clientMgr.broadcast({ type: 'stroke', x: 100, y: 200 });

// Send to specific client
clientMgr.sendToClient(ws, { type: 'sync', strokes: [...] });

// Get info
console.log(clientMgr.getClientCount());     // 5
console.log(clientMgr.getClientIds());       // ['Client-1', 'Client-2', ...]
```

### `replicaClient.js` — HTTP Client for Replicas

Low-level HTTP helper for querying replica endpoints:

```javascript
const replica = new ReplicaClient('http://localhost:5001');

const status = await replica.getStatus();
console.log(status);  // { nodeId: 'replica1', state: 'LEADER', ... }

const isLeader = await replica.isLeader();  // boolean
```

---

## Message Protocol

**WebSocket messages sent by frontend:**

**Stroke:**
```json
{
  "type": "stroke",
  "x": 150,
  "y": 200,
  "prevX": 145,
  "prevY": 195,
  "color": "#FF0000",
  "size": 5
}
```

**Clear:**
```json
{
  "type": "clear"
}
```

**Sync Request:**
```json
{
  "type": "sync"
}
```

**Gateway responses to clients:**

**Stroke broadcast:**
```json
{
  "type": "stroke",
  "x": 150,
  "y": 200,
  "prevX": 145,
  "prevY": 195,
  "color": "#FF0000",
  "size": 5
}
```

**Board sync:**
```json
{
  "type": "sync",
  "strokes": [
    { "type": "stroke", "x": 10, "y": 20, ... },
    { "type": "stroke", "x": 15, "y": 25, ... },
    ...
  ]
}
```

---

## RAFT RPC Endpoints

Each replica exposes these HTTP endpoints:

**GET /status**
```bash
curl http://localhost:5001/status
```
Response:
```json
{
  "nodeId": "replica1",
  "state": "LEADER",
  "currentTerm": 3,
  "votedFor": "replica1",
  "peers": ["http://replica2:5002", "http://replica3:5003"]
}
```

**POST /request-vote** (internal)
```json
{ "term": 3, "candidateId": "replica2" }
→ { "term": 3, "voteGranted": true }
```

**POST /heartbeat** (internal)
```json
{ "term": 3, "leaderId": "replica1" }
→ { "term": 3, "success": true }
```

---

## Environment Variables

**Gateway (backend/server.js):**

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | WebSocket listen port |
| `REPLICAS` | `http://localhost:5001,...` | Comma-separated replica URLs |
| `LEADER_POLL` | `1000` | Leader detection poll interval (ms) |

**Example:**
```bash
PORT=8080 LEADER_POLL=500 node backend/server.js
```

**In Docker:**
```yaml
environment:
  PORT: 8080
  REPLICAS: "http://replica1:5001,http://replica2:5002,http://replica3:5003"
  LEADER_POLL: "1000"
```

---

## Example Logs

### Clean election

```
[Gateway] Starting with replicas: http://localhost:5001, http://localhost:5002, http://localhost:5003
[Gateway] Listening for connections...
[LeaderManager] Leader changed: none → http://localhost:5001
replica1  | Node replica1 became LEADER for term 1
replica1  | Leader replica1 sending heartbeat (term 1)
```

### Leader failure and re-election

```
# (simulate: docker stop replica1)
replica2  | Election timeout triggered on replica2
replica2  | Node replica2 became CANDIDATE for term 2
replica3  | replica3 granted vote to replica2 for term 2
replica2  | Node replica2 became LEADER for term 2
[LeaderManager] Leader changed: http://localhost:5001 → http://localhost:5002
[Gateway] ✓ NEW LEADER DETECTED: port 5002 (was: 5001)
```

### Multiple clients drawing

```
[ClientManager] Client Client-1 connected (total: 1)
[ClientManager] Client Client-2 connected (total: 2)
[ClientManager] Client Client-3 connected (total: 3)
[Gateway] Stroke stored and broadcasted (history: 5)
[ClientManager] Broadcast: sent to 3 clients, 0 failed
```

---

## Future Enhancements

- [ ] Log replication — route strokes through RAFT leader for durability
- [ ] Persistent state — durable `currentTerm` / `votedFor` across restarts
- [ ] Advanced drawing tools — eraser, shapes, layers
- [ ] Undo/Redo functionality
- [ ] Canvas export (PNG, SVG)
- [ ] Authentication and authorization
- [ ] Performance metrics and monitoring

---

## License

MIT

## Author

Created as a distributed systems project demonstrating real-time synchronization with WebSockets and the RAFT consensus algorithm.

