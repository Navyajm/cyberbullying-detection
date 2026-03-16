// CyberGuard Background Script

console.log('CyberGuard background script loaded');

// Store detections in memory (reloaded from storage on startup)
let detections = [];
let stats = {
    totalAnalyzed: 0,
    flagged: 0,
    flaggedThisWeek: 0
};

// Load existing data from storage on startup
chrome.storage.local.get(['detections', 'stats'], (result) => {
    if (result.detections) detections = result.detections;
    if (result.stats) stats = result.stats;
    console.log('CyberGuard loaded from storage:', detections.length, 'detections');
});

// Listen for messages from content scripts and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'newDetection') {
        // Skip if this text was already detected
        const isDuplicate = detections.some(d => d.text === request.data.text);
        if (isDuplicate) {
            sendResponse({ status: 'duplicate' });
            return true;
        }
        
        // Store detection
        detections.unshift({
            ...request.data,
            timestamp: Date.now(),
            tabId: sender.tab?.id
        });
        
        // Keep only last 100 detections
        if (detections.length > 100) {
            detections = detections.slice(0, 100);
        }
        
        // Store in local storage
        chrome.storage.local.set({ detections });
        
        sendResponse({ status: 'received' });
    }
    
    if (request.action === 'updateStats') {
        stats = request.data;
        chrome.storage.local.set({ stats });
        sendResponse({ status: 'updated' });
    }
    
    if (request.action === 'getDetections') {
        sendResponse({ detections });
    }
    
    if (request.action === 'getStats') {
        sendResponse({ stats });
    }
    
    return true;
});

// Initialize storage only if not already set (preserve history)
chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.get(['detections', 'stats'], (result) => {
        if (!result.detections) chrome.storage.local.set({ detections: [] });
        if (!result.stats) chrome.storage.local.set({ stats: { totalAnalyzed: 0, flagged: 0, flaggedThisWeek: 0 } });
    });
    
    chrome.storage.sync.set({
        scanningEnabled: true,
        detectionEnabled: true
    });
    
    console.log('CyberGuard installed and initialized');
});
