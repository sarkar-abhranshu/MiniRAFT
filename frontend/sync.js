/**
 * sync.js - Board state synchronization logic
 * Handles initial state sync and stroke history replay
 */

// Sync state tracking
let isSyncing = false;
let syncRequested = false;

/**
 * Request board state synchronization from server
 * Called when WebSocket connection is established
 */
function requestSync() {
    if (syncRequested) {
        console.log('Sync already requested, skipping');
        return;
    }
    
    console.log('Requesting board state sync...');
    syncRequested = true;
    isSyncing = true;
    
    // Send sync request to server
    const syncMessage = {
        type: 'sync'
    };
    
    if (typeof sendMessage === 'function') {
        sendMessage(syncMessage);
    } else {
        console.error('sendMessage function not available');
        isSyncing = false;
    }
}

/**
 * Handle sync response from server
 * @param {Object} message - Sync response message
 */
function handleSyncResponse(message) {
    console.log('Received sync response');
    
    // Check if message contains stroke history
    if (message.strokes && Array.isArray(message.strokes)) {
        handleHistory({ strokes: message.strokes });
    } else {
        console.log('No stroke history in sync response');
        isSyncing = false;
    }
}

/**
 * Handle stroke history from server
 * Replays all strokes to rebuild the canvas state
 * @param {Object} message - Message containing stroke history
 */
function handleHistory(message) {
    if (!message.strokes || !Array.isArray(message.strokes)) {
        console.warn('Invalid history message format');
        isSyncing = false;
        return;
    }
    
    const strokes = message.strokes;
    console.log(`Replaying ${strokes.length} strokes...`);
    
    // Clear canvas before replaying
    if (typeof clearCanvas === 'function') {
        clearCanvas();
    }
    
    // Replay each stroke in order
    for (let i = 0; i < strokes.length; i++) {
        const stroke = strokes[i];
        
        // Draw the stroke
        if (typeof drawStroke === 'function') {
            drawStroke(stroke);
        }
    }
    
    console.log('Stroke replay complete');
    isSyncing = false;
}

/**
 * Check if currently syncing
 * @returns {boolean} True if syncing in progress
 */
function isSyncInProgress() {
    return isSyncing;
}

/**
 * Reset sync state (useful for reconnection)
 */
function resetSyncState() {
    isSyncing = false;
    syncRequested = false;
    console.log('Sync state reset');
}

/**
 * Handle connection reset
 * Called when WebSocket reconnects
 */
function handleConnectionReset() {
    resetSyncState();
    // Request sync will be called automatically by websocket.js on connection open
}

// Export flag for other modules to check sync status
window.isSyncInProgress = isSyncInProgress;

console.log('Sync module loaded');
