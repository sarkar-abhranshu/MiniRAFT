/**
 * Simple WebSocket Gateway Server for Distributed Drawing Board
 * Listens on ws://localhost:8080
 */

const WebSocket = require('ws');

// Configuration
const PORT = 8080;

// Create WebSocket server
const wss = new WebSocket.Server({ port: PORT });

// Store all active connections
const clients = new Set();

// Store stroke history for synchronization
const strokeHistory = [];

console.log(`WebSocket server started on ws://localhost:${PORT}`);
console.log('Waiting for connections...\n');

/**
 * Handle new client connections
 */
wss.on('connection', (ws, req) => {
    const clientId = `Client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    console.log(`✓ ${clientId} connected`);
    console.log(`  Total clients: ${wss.clients.size}`);
    
    // Add client to set
    clients.add(ws);
    ws.clientId = clientId;
    
    /**
     * Handle messages from client
     */
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            
            console.log(`← ${clientId}: ${message.type}`);
            
            // Route message by type
            switch (message.type) {
                case 'stroke':
                    handleStroke(message, ws);
                    break;
                    
                case 'clear':
                    handleClear(message, ws);
                    break;
                    
                case 'sync':
                    handleSync(message, ws);
                    break;
                    
                default:
                    console.log(`  Unknown message type: ${message.type}`);
            }
            
        } catch (error) {
            console.error(`  Error parsing message from ${clientId}:`, error.message);
        }
    });
    
    /**
     * Handle client disconnect
     */
    ws.on('close', () => {
        clients.delete(ws);
        console.log(`✗ ${clientId} disconnected`);
        console.log(`  Total clients: ${wss.clients.size}\n`);
    });
    
    /**
     * Handle errors
     */
    ws.on('error', (error) => {
        console.error(`  Error with ${clientId}:`, error.message);
    });
});

/**
 * Handle stroke messages
 * Store and broadcast to all clients
 */
function handleStroke(stroke, sender) {
    // Store stroke in history
    strokeHistory.push(stroke);
    
    // Keep only last 1000 strokes to prevent memory issues
    if (strokeHistory.length > 1000) {
        strokeHistory.shift();
    }
    
    // Broadcast to all connected clients
    broadcast(stroke, sender);
}

/**
 * Handle clear board messages
 * Clear history and broadcast to all clients
 */
function handleClear(message, sender) {
    console.log('  Clearing board and history');
    
    // Clear stroke history
    strokeHistory.length = 0;
    
    // Broadcast clear to all clients
    broadcast(message, sender);
}

/**
 * Handle sync requests
 * Send stroke history to requesting client
 */
function handleSync(message, client) {
    console.log(`  Sending ${strokeHistory.length} strokes to ${client.clientId}`);
    
    // Send stroke history back to client
    const syncResponse = {
        type: 'sync',
        strokes: strokeHistory
    };
    
    try {
        client.send(JSON.stringify(syncResponse));
        console.log(`→ Sync response sent to ${client.clientId}`);
    } catch (error) {
        console.error(`  Error sending sync to ${client.clientId}:`, error.message);
    }
}

/**
 * Broadcast message to all connected clients
 * @param {Object} message - Message to broadcast
 * @param {WebSocket} sender - Original sender (optional, to exclude echo)
 */
function broadcast(message, sender = null) {
    const data = JSON.stringify(message);
    let sentCount = 0;
    
    wss.clients.forEach((client) => {
        // Send to all clients (including sender for confirmation)
        if (client.readyState === WebSocket.OPEN) {
            try {
                client.send(data);
                sentCount++;
            } catch (error) {
                console.error(`  Error broadcasting to ${client.clientId}:`, error.message);
            }
        }
    });
    
    console.log(`→ Broadcasted to ${sentCount} client(s)\n`);
}

/**
 * Handle server errors
 */
wss.on('error', (error) => {
    console.error('WebSocket server error:', error);
});

/**
 * Graceful shutdown
 */
process.on('SIGINT', () => {
    console.log('\nShutting down server...');
    
    wss.clients.forEach((client) => {
        client.close();
    });
    
    wss.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

console.log('Ready to accept connections!');
console.log('Press Ctrl+C to stop the server\n');
