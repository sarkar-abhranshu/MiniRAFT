# MiniRAFT — Distributed Real-Time Drawing Board

A collaborative drawing application backed by a simplified RAFT consensus protocol. Multiple browser clients draw on a shared canvas; strokes are replicated across a cluster of 3 replica nodes that elect a leader using Mini-RAFT.

## Architecture

```
Browser Canvas
      ↕  WebSocket
Gateway Server  (backend/server.js  — port 8080)
      ↕  HTTP REST
┌─────────────┬─────────────┬─────────────┐
│  replica1   │  replica2   │  replica3   │
│  port 5001  │  port 5002  │  port 5003  │
│             │             │             │
│  RAFT node  │  RAFT node  │  RAFT node  │
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
│   ├── server.js           # WebSocket gateway server
│   └── package.json
├── replica/                # RAFT replica node
│   ├── server.js           # Express entry point + startup
│   ├── raftNode.js         # Node state & transitions
│   ├── election.js         # Election logic & heartbeat loop
│   ├── rpc.js              # /request-vote & /heartbeat handlers
│   ├── timers.js           # Election & heartbeat timers
│   ├── package.json
│   └── Dockerfile
├── docker-compose.yml      # Runs all 3 replicas
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

**Gateway:** Node.js, `ws`

**Replica nodes:** Node.js, Express, `axios` (for inter-replica HTTP RPCs)

**Infrastructure:** Docker, Docker Compose

## Running the Project

### Prerequisites
- Node.js v18+
- npm
- Docker + Docker Compose (for replica cluster)

---

### 1 — Run the RAFT replica cluster (Docker)

```bash
docker-compose up --build
```

All three replicas start, hold an election, and the winner begins sending heartbeats. Stop with `Ctrl+C`.

To simulate a leader crash and watch re-election:

```bash
# In a second terminal — kill whichever node is currently LEADER
docker stop replica2
# replica1 or replica3 will elect a new leader within 500–800 ms
docker start replica2   # rejoins as FOLLOWER
```

Inspect current state of any node:

```bash
curl http://localhost:5001/status   # replica1
curl http://localhost:5002/status   # replica2
curl http://localhost:5003/status   # replica3
```

---

### 2 — Run the RAFT replicas locally (no Docker)

```bash
cd replica && npm install
```

Open 3 terminal tabs:

```bash
# Tab 1
NODE_ID=replica1 PORT=5001 PEERS=http://localhost:5002,http://localhost:5003 node server.js

# Tab 2
NODE_ID=replica2 PORT=5002 PEERS=http://localhost:5001,http://localhost:5003 node server.js

# Tab 3
NODE_ID=replica3 PORT=5003 PEERS=http://localhost:5001,http://localhost:5002 node server.js
```

---

### 3 — Run the WebSocket gateway

```bash
cd backend && npm install && npm start
# Listens on ws://localhost:8080
```

### 4 — Open the frontend

```bash
open frontend/index.html   # macOS
start frontend/index.html  # Windows
```

Open multiple tabs to draw collaboratively.

## How It Works

### Frontend Architecture

- **canvas.js**: Handles mouse events and drawing logic
- **websocket.js**: Manages WebSocket connection and message routing
- **ui.js**: Controls toolbar interactions
- **sync.js**: Handles board state synchronization for new clients

### Gateway Architecture

The server acts as a message broker:
1. Accepts WebSocket connections
2. Receives stroke/clear messages
3. Broadcasts to all connected clients
4. Maintains stroke history for new client synchronization

### RAFT Architecture

Each replica is an independent Node.js process with five modules:

| Module | Responsibility |
|---|---|
| `raftNode.js` | State variables (`currentTerm`, `votedFor`, `state`) and transition methods (`becomeFollower/Candidate/Leader`) |
| `timers.js` | Election timer (random 500–800 ms) and heartbeat timer (150 ms) |
| `election.js` | Sends parallel `RequestVote` RPCs, tallies votes, detects majority, starts heartbeat loop |
| `rpc.js` | Express handlers for `POST /request-vote` and `POST /heartbeat` |
| `server.js` | Wires everything together; exposes `GET /status` for debugging |

**RAFT RPC endpoints:**

`POST /request-vote`
```json
{ "term": 3, "candidateId": "replica2" }
// Response:
{ "term": 3, "voteGranted": true }
```

`POST /heartbeat`
```json
{ "term": 3, "leaderId": "replica2" }
// Response:
{ "term": 3, "success": true }
```

### Message Protocol

**Stroke Message:**
```json
{
  "type": "stroke",
  "x": 150,
  "y": 200,
  "prevX": 145,
  "prevY": 195,
  "color": "#000000",
  "size": 3
}
```

**Clear Message:**
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

**Sync Response:**
```json
{
  "type": "sync",
  "strokes": [...]
}
```

## Example Logs

**Clean election (one winner):**
```
replica2  | Node replica2 started as FOLLOWER
replica2  | Election timeout triggered on replica2 (no heartbeat for 554ms)
replica2  | Node replica2 became CANDIDATE for term 1
replica2  | replica2 requesting votes for term 1 (need 2/3)
replica1  | replica1 granted vote to replica2 for term 1
replica3  | replica3 granted vote to replica2 for term 1
replica2  |   Received vote from http://replica1:5001 (total: 2)
replica2  | Node replica2 became LEADER for term 1
replica2  | Leader replica2 sending heartbeat (term 1)
```

**Split vote (two candidates at the same time):**
```
replica2  | Node replica2 became CANDIDATE for term 1
replica1  | Node replica1 became CANDIDATE for term 1
replica2  | replica2 denied vote to replica1 (already voted for replica2 in term 1)
replica1  | replica1 denied vote to replica2 (already voted for replica1 in term 1)
replica3  | replica3 granted vote to replica2 for term 1
replica2  | Node replica2 became LEADER for term 1
replica1  | replica1 did not win election for term 1 (got 1/2) — restarting timer
```

**Leader failure and re-election:**
```
# replica2 container stopped
replica1  | Election timeout triggered on replica1 (no heartbeat for 712ms)
replica1  | Node replica1 became CANDIDATE for term 2
replica3  | replica3 granted vote to replica1 for term 2
replica1  | Node replica1 became LEADER for term 2
replica1  | Leader replica1 sending heartbeat (term 2)
```

## Future Enhancements

- [ ] Log replication (append drawing strokes to the replicated log)
- [ ] Persistent state (durable `currentTerm` / `votedFor` across restarts)
- [ ] Route drawing strokes through the RAFT leader
- [ ] Eraser tool
- [ ] Shape tools (rectangle, circle, line)
- [ ] Undo/Redo functionality
- [ ] Export canvas as image

## License

MIT

## Author

Created as a distributed systems project demonstrating real-time synchronization with WebSockets and the RAFT consensus algorithm.
