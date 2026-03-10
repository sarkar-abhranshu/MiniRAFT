# Distributed Real-Time Drawing Board

A collaborative drawing application that allows multiple users to draw simultaneously on a shared canvas using WebSocket communication.

## Project Structure

```
Frontend/
├── frontend/
│   ├── index.html      # Main HTML page
│   ├── style.css       # Styling
│   ├── canvas.js       # Drawing logic
│   ├── websocket.js    # WebSocket connection
│   ├── ui.js          # Toolbar controls
│   └── sync.js        # State synchronization
├── backend/
│   ├── server.js      # WebSocket server
│   └── package.json   # Node.js dependencies
└── .gitignore
```

## Features

- ✅ Real-time collaborative drawing
- ✅ Multi-user support
- ✅ Color picker
- ✅ Adjustable brush size (1-20px)
- ✅ Clear board functionality
- ✅ Auto-reconnect on disconnect
- ✅ Connection status indicator
- ✅ Board state synchronization

## Technologies Used

**Frontend:**
- Vanilla JavaScript
- HTML5 Canvas API
- WebSocket API

**Backend:**
- Node.js
- ws (WebSocket library)

## Installation & Setup

### Prerequisites
- Node.js (v14 or higher)
- npm

### Backend Setup

1. Navigate to the backend directory:
```bash
cd backend
```

2. Install dependencies:
```bash
npm install
```

3. Start the server:
```bash
npm start
```

The server will start on `ws://localhost:8080`

### Frontend Setup

1. Navigate to the frontend directory:
```bash
cd frontend
```

2. Open `index.html` in your web browser:
```bash
# Windows
start index.html

# Mac/Linux
open index.html
```

## Usage

1. Start the backend server
2. Open the frontend in multiple browser tabs/windows
3. Draw on the canvas - strokes appear in all connected clients in real-time
4. Use the toolbar to:
   - Change brush color
   - Adjust brush size
   - Clear the board (synced across all clients)

## How It Works

### Frontend Architecture

- **canvas.js**: Handles mouse events and drawing logic
- **websocket.js**: Manages WebSocket connection and message routing
- **ui.js**: Controls toolbar interactions
- **sync.js**: Handles board state synchronization for new clients

### Backend Architecture

The server acts as a message broker:
1. Accepts WebSocket connections
2. Receives stroke/clear messages
3. Broadcasts to all connected clients
4. Maintains stroke history for new client synchronization

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

## Future Enhancements

- [ ] Eraser tool
- [ ] Shape tools (rectangle, circle, line)
- [ ] Undo/Redo functionality
- [ ] Export canvas as image
- [ ] User cursors visibility
- [ ] Chat functionality
- [ ] Room/session management
- [ ] Authentication

## License

MIT

## Author

Created as a distributed systems project demonstrating real-time synchronization with WebSockets.
