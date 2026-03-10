/**
 * ui.js - Toolbar and UI interaction logic
 * Manages brush settings and user controls
 */

// UI elements
let colorPicker;
let brushSizeSlider;
let brushSizeDisplay;
let clearButton;

/**
 * Initialize UI elements and event listeners
 */
function initUI() {
    // Get UI elements
    colorPicker = document.getElementById('colorPicker');
    brushSizeSlider = document.getElementById('brushSize');
    brushSizeDisplay = document.getElementById('brushSizeValue');
    clearButton = document.getElementById('clearBtn');
    
    if (!colorPicker || !brushSizeSlider || !brushSizeDisplay || !clearButton) {
        console.error('UI elements not found');
        return;
    }
    
    // Set up event listeners
    setupColorPicker();
    setupBrushSize();
    setupClearButton();
    
    console.log('UI initialized');
}

/**
 * Set up color picker functionality
 */
function setupColorPicker() {
    // Update current color when color picker changes
    colorPicker.addEventListener('change', (e) => {
        currentColor = e.target.value;
        console.log('Color changed to:', currentColor);
    });
    
    // Also handle input event for real-time updates
    colorPicker.addEventListener('input', (e) => {
        currentColor = e.target.value;
    });
    
    // Initialize current color
    currentColor = colorPicker.value;
}

/**
 * Set up brush size slider functionality
 */
function setupBrushSize() {
    // Update current size when slider changes
    brushSizeSlider.addEventListener('input', (e) => {
        currentSize = parseInt(e.target.value);
        brushSizeDisplay.textContent = currentSize;
    });
    
    brushSizeSlider.addEventListener('change', (e) => {
        currentSize = parseInt(e.target.value);
        brushSizeDisplay.textContent = currentSize;
        console.log('Brush size changed to:', currentSize);
    });
    
    // Initialize current size
    currentSize = parseInt(brushSizeSlider.value);
}

/**
 * Set up clear button functionality
 */
function setupClearButton() {
    clearButton.addEventListener('click', () => {
        console.log('Clear button clicked');
        
        // Send clear message to server
        const clearMessage = {
            type: 'clear'
        };
        
        if (typeof sendMessage === 'function') {
            sendMessage(clearMessage);
            console.log('Clear message sent to server');
        } else {
            console.warn('WebSocket not ready, cannot send clear message');
        }
    });
}

/**
 * Get current brush color
 * @returns {string} Current brush color
 */
function getCurrentColor() {
    return currentColor;
}

/**
 * Get current brush size
 * @returns {number} Current brush size
 */
function getCurrentSize() {
    return currentSize;
}

/**
 * Set brush color programmatically
 * @param {string} color - Color hex code
 */
function setColor(color) {
    currentColor = color;
    if (colorPicker) {
        colorPicker.value = color;
    }
}

/**
 * Set brush size programmatically
 * @param {number} size - Brush size (1-20)
 */
function setSize(size) {
    currentSize = Math.max(1, Math.min(20, size)); // Clamp between 1 and 20
    if (brushSizeSlider) {
        brushSizeSlider.value = currentSize;
    }
    if (brushSizeDisplay) {
        brushSizeDisplay.textContent = currentSize;
    }
}

// Initialize UI when DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUI);
} else {
    initUI();
}
