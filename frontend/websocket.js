/**
 * websocket.js - WebSocket communication with backend gateway
 * Handles connection, message routing, and reconnection logic
 */

// WebSocket configuration
const WS_URL = 'ws://localhost:8080';
const RECONNECT_DELAY = 3000; // 3 seconds

// Global WebSocket instance
let ws = null;
let reconnectTimer = null;
let isConnected = false;

/**
 * Initialize WebSocket connection
 */
function initWebSocket() {
    console.log('Connecting to WebSocket server at:', WS_URL);
    updateStatus('connecting');
    
    try {
        ws = new WebSocket(WS_URL);
        
        // Connection opened
        ws.onopen = handleOpen;
        
        // Message received
        ws.onmessage = handleMessage;
        
        // Connection closed
        ws.onclose = handleClose;
        
        // Connection error
        ws.onerror = handleError;
        
    } catch (error) {
        console.error('WebSocket connection error:', error);
        scheduleReconnect();
    }
}

/**
 * Handle WebSocket connection open
 */
function handleOpen(event) {
    console.log('WebSocket connection established');
    isConnected = true;
    updateStatus('connected');
    
    // Clear any pending reconnect timer
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    
    // Request board state synchronization
    // COMMENTED OUT FOR TESTING
    // if (typeof requestSync === 'function') {
    //     requestSync();
    // }
}

/**
 * Handle incoming WebSocket messages
 * @param {MessageEvent} event - WebSocket message event
 */
function handleMessage(event) {
    try {
        // Parse incoming JSON message
        const message = JSON.parse(event.data);
        
        console.log('Received message:', message.type);
        
        // Route message based on type
        switch (message.type) {
            case 'stroke':
                // Forward stroke to canvas for rendering
                if (typeof drawStroke === 'function') {
                    drawStroke(message);
                }
                break;
                
            case 'clear':
                // Clear the canvas
                if (typeof clearCanvas === 'function') {
                    clearCanvas();
                }
                break;
                
            // COMMENTED OUT FOR TESTING
            // case 'sync':
            //     // Forward sync data to sync.js
            //     if (typeof handleSyncResponse === 'function') {
            //         handleSyncResponse(message);
            //     }
            //     break;
                
            // case 'history':
            //     // Handle stroke history for synchronization
            //     if (typeof handleHistory === 'function') {
            //         handleHistory(message);
            //     }
            //     break;
                
            default:
                console.warn('Unknown message type:', message.type);
        }
        
    } catch (error) {
        console.error('Error parsing message:', error);
    }
}

/**
 * Handle WebSocket connection close
 */
function handleClose(event) {
    console.log('WebSocket connection closed');
    isConnected = false;
    updateStatus('disconnected');
    
    // Attempt to reconnect
    scheduleReconnect();
}

/**
 * Handle WebSocket error
 */
function handleError(error) {
    console.error('WebSocket error:', error);
    updateStatus('disconnected');
}

/**
 * Schedule reconnection attempt
 */
function scheduleReconnect() {
    if (reconnectTimer) return; // Already scheduled
    
    console.log(`Reconnecting in ${RECONNECT_DELAY / 1000} seconds...`);
    
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        initWebSocket();
    }, RECONNECT_DELAY);
}

/**
 * Send a message through WebSocket
 * @param {Object} message - Message object to send
 */
function sendMessage(message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        try {
            ws.send(JSON.stringify(message));
        } catch (error) {
            console.error('Error sending message:', error);
        }
    } else {
        console.warn('WebSocket not connected, cannot send message');
    }
}

/**
 * Update connection status display
 * @param {string} status - Status: 'connecting', 'connected', or 'disconnected'
 */
function updateStatus(status) {
    const statusEl = document.getElementById('status');
    if (!statusEl) return;
    
    statusEl.className = 'status ' + status;
    
    switch (status) {
        case 'connected':
            statusEl.textContent = 'Connected';
            break;
        case 'connecting':
            statusEl.textContent = 'Connecting...';
            break;
        case 'disconnected':
            statusEl.textContent = 'Disconnected';
            break;
    }
}

/**
 * Close WebSocket connection
 */
function closeWebSocket() {
    if (ws) {
        ws.close();
        ws = null;
    }
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
}

// Initialize WebSocket when script loads
initWebSocket();

// Clean up on page unload
window.addEventListener('beforeunload', closeWebSocket);
