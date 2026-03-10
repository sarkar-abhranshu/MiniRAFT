/**
 * canvas.js - Drawing logic for the distributed drawing board
 * Handles mouse events, stroke generation, and rendering
 */

// Global variables
let canvas;
let ctx;
let isDrawing = false;
let lastX = 0;
let lastY = 0;

// Current brush settings (managed by ui.js)
let currentColor = '#000000';
let currentSize = 3;

/**
 * Initialize canvas and set up event listeners
 */
function initCanvas() {
    canvas = document.getElementById('board');
    if (!canvas) {
        console.error('Canvas element not found');
        return;
    }
    
    ctx = canvas.getContext('2d');
    
    // Set canvas drawing properties
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    // Set up mouse event listeners
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseleave', handleMouseUp);
    
    console.log('Canvas initialized');
}

/**
 * Handle mouse down event - start drawing
 */
function handleMouseDown(e) {
    isDrawing = true;
    const rect = canvas.getBoundingClientRect();
    lastX = e.clientX - rect.left;
    lastY = e.clientY - rect.top;
}

/**
 * Handle mouse move event - draw if mouse is down
 */
function handleMouseMove(e) {
    if (!isDrawing) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Create stroke object
    const stroke = {
        type: 'stroke',
        x: x,
        y: y,
        prevX: lastX,
        prevY: lastY,
        color: currentColor,
        size: currentSize
    };
    
    // Send stroke to server via WebSocket
    sendStroke(stroke);
    
    // Update last position
    lastX = x;
    lastY = y;
}

/**
 * Handle mouse up event - stop drawing
 */
function handleMouseUp() {
    isDrawing = false;
}

/**
 * Send stroke to server via WebSocket
 * @param {Object} stroke - Stroke object to send
 */
function sendStroke(stroke) {
    if (typeof sendMessage === 'function') {
        sendMessage(stroke);
    } else {
        console.warn('WebSocket not ready, cannot send stroke');
    }
}

/**
 * Draw a stroke on the canvas
 * This function is called when receiving strokes from the server
 * @param {Object} stroke - Stroke object containing drawing data
 */
function drawStroke(stroke) {
    if (!ctx) {
        console.error('Canvas context not initialized');
        return;
    }
    
    // Set drawing style from stroke data
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.size;
    
    // Draw the line
    ctx.beginPath();
    
    // If we have previous coordinates, draw a line
    if (stroke.prevX !== undefined && stroke.prevY !== undefined) {
        ctx.moveTo(stroke.prevX, stroke.prevY);
        ctx.lineTo(stroke.x, stroke.y);
    } else {
        // Otherwise, draw a dot at the current position
        ctx.moveTo(stroke.x, stroke.y);
        ctx.lineTo(stroke.x, stroke.y);
    }
    
    ctx.stroke();
}

/**
 * Clear the entire canvas
 */
function clearCanvas() {
    if (ctx && canvas) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        console.log('Canvas cleared');
    }
}

// Initialize canvas when DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCanvas);
} else {
    initCanvas();
}
