// CyberGuard Popup Script

console.log('CyberGuard popup loaded');

// Live Data
const appData = {
    totalAnalyzed: 0,
    flagged: 0,
    flaggedThisWeek: 0,
    trendData: [0, 0, 0, 0, 0, 0, 0]
};

// DOM Elements
const detectorPanel = document.getElementById('detectorPanel');
const dashboardPanel = document.getElementById('dashboardPanel');
const settingsPanel = document.getElementById('settingsPanel');

const openDashboardBtn = document.getElementById('openDashboard');
const openSettingsBtn = document.getElementById('openSettings');
const openSettingsFromDashboardBtn = document.getElementById('openSettingsFromDashboard');
const backFromDashboardBtn = document.getElementById('backFromDashboard');
const backFromSettingsBtn = document.getElementById('backFromSettings');

const scanningToggle = document.getElementById('scanningToggle');
const scanningStatus = document.getElementById('scanningStatus');

// Track navigation history
let previousPanel = 'detector';

// Initialize
function init() {
    console.log('Initializing CyberGuard popup');
    
    loadSettings();
    loadDetections();
    setupEventListeners();
    
    // Draw chart after a small delay to ensure canvas is ready
    setTimeout(drawTrendChart, 100);
}

// Panel Navigation
function showPanel(panelName) {
    detectorPanel.classList.add('hidden');
    dashboardPanel.classList.add('hidden');
    settingsPanel.classList.add('hidden');
    
    switch(panelName) {
        case 'detector':
            detectorPanel.classList.remove('hidden');
            break;
        case 'dashboard':
            dashboardPanel.classList.remove('hidden');
            setTimeout(drawTrendChart, 50);
            break;
        case 'settings':
            settingsPanel.classList.remove('hidden');
            break;
    }
}

// Load Settings
function loadSettings() {
    if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.sync.get(['scanningEnabled'], (result) => {
            const scanningEnabled = result.scanningEnabled !== undefined ? result.scanningEnabled : true;
            
            scanningToggle.checked = scanningEnabled;
            
            updateScanningStatus(scanningEnabled);
        });
        
        chrome.storage.local.get(['stats'], (result) => {
            if (result.stats) {
                appData.totalAnalyzed = result.stats.totalAnalyzed || appData.totalAnalyzed;
                appData.flagged = result.stats.flagged || appData.flagged;
                appData.flaggedThisWeek = result.stats.flaggedThisWeek || appData.flaggedThisWeek;
                updateStats();
            }
        });
    } else {
        updateScanningStatus(true);
    }
}

function sendSettingToActiveTab(action, enabled) {
    if (typeof chrome === 'undefined' || !chrome.tabs) return;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) return;
        chrome.tabs.sendMessage(tabs[0].id, { action, enabled }).catch((err) => {
            console.log('Could not send message to content script:', err);
        });
    });
}

// Save Settings
function saveSettings() {
    if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.sync.set({
            scanningEnabled: scanningToggle.checked
        }, () => {
            console.log('Settings saved');
        });
    }
}

// Load detections and stats from storage and backend
function loadDetections() {
    if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.local.get(['detections', 'stats'], (result) => {
            if (result.stats) {
                appData.totalAnalyzed = result.stats.totalAnalyzed || 0;
                appData.flaggedThisWeek = result.stats.flaggedThisWeek || 0;
            }
            const detections = result.detections || [];
            // Real-time flagged count = number of stored detections
            appData.flagged = detections.length;
            renderDetections(detections);
            updateTrendChart(detections);
            updateStats();
        });
        
        // Fetch latest weekly stats from backend for the trend chart
        fetch('http://localhost:5000/api/stats')
            .then(r => r.ok ? r.json() : null)
            .catch(() => null)
            .then(data => {
                if (data) {
                    appData.flaggedThisWeek = data.flagged_this_week || 0;
                    appData.totalAnalyzed = data.total_analyzed || appData.totalAnalyzed;
                    updateStats();
                }
            });
    }
}

// Build trend data from actual detections grouped by day of week
function updateTrendChart(detections) {
    const now = Date.now();
    const dayMs = 86400000;
    const weekData = [0, 0, 0, 0, 0, 0, 0]; // Mon-Sun
    
    detections.forEach(d => {
        if (!d.timestamp) return;
        const age = now - d.timestamp;
        if (age > 7 * dayMs) return; // Only last 7 days
        const dayIndex = new Date(d.timestamp).getDay(); // 0=Sun, 1=Mon...
        const mapped = dayIndex === 0 ? 6 : dayIndex - 1; // Convert to Mon=0, Sun=6
        weekData[mapped]++;
    });
    
    appData.trendData = weekData;
    
    // Update the weekly trend label with consolidated weekly count
    const trendEl = document.querySelector('.trend-change');
    if (trendEl) {
        const weeklyCount = appData.flaggedThisWeek || weekData.reduce((a, b) => a + b, 0);
        if (weeklyCount > 0) {
            trendEl.textContent = `${weeklyCount} flagged`;
            trendEl.style.color = '#ef4444';
        } else {
            trendEl.textContent = '0 flagged';
            trendEl.style.color = '#10b981';
        }
    }
    
    drawTrendChart();
}

// Render detections into the list
function renderDetections(detections) {
    const list = document.getElementById('detectedList');
    if (!list) return;
    
    if (detections.length === 0) {
        list.innerHTML = '<div class="empty-state">No cyberbullying detected yet</div>';
        return;
    }
    
    // Deduplicate by text
    const seen = new Set();
    const unique = detections.filter(d => {
        if (seen.has(d.text)) return false;
        seen.add(d.text);
        return true;
    });
    
    list.innerHTML = '';
    unique.slice(0, 20).forEach(d => {
        const severity = d.severity || 'low';
        const explanation = d.explanation || d.category || 'Flagged as potentially harmful';
        
        const item = document.createElement('div');
        item.className = 'detected-item';
        item.innerHTML = `
            <div class="detected-icon flagged-icon">
                <svg viewBox="0 0 24 24"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line></svg>
            </div>
            <div class="detected-content">
                <div class="detected-text">"${escapeHtml(d.text)}"</div>
                <div class="detected-footer">
                    <span class="severity-badge flagged-badge">FLAGGED</span>
                    <button class="info-btn" title="${escapeHtml(explanation)}">?</button>
                </div>
            </div>`;
        
        item.querySelector('.info-btn').addEventListener('click', () => {
            alert(`Why was this flagged?\n\nCategory: ${d.category || 'N/A'}\nConfidence: ${d.confidence ? Math.round(d.confidence * 100) + '%' : 'N/A'}\nReason: ${explanation}`);
        });
        
        list.appendChild(item);
    });
}

function getSeverityIcon(severity) {
    const icons = {
        low: '<svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>',
        medium: '<svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"></path></svg>',
        high: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>'
    };
    return icons[severity] || icons.low;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Update Stats Display
function updateStats() {
    document.getElementById('totalAnalyzed').textContent = formatNumber(appData.totalAnalyzed);
    // "Flagged" box shows real-time count (total detections), not weekly
    document.getElementById('totalFlagged').textContent = appData.flagged;
}

// Format Number with Commas
function formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Update Scanning Status
function updateScanningStatus(isEnabled) {
    if (isEnabled) {
        scanningStatus.textContent = 'Scanning active chats';
        scanningStatus.classList.remove('paused');
    } else {
        scanningStatus.textContent = 'Scanning paused';
        scanningStatus.classList.add('paused');
    }
}

// Draw Trend Chart
function drawTrendChart() {
    const canvas = document.getElementById('trendChart');
    if (!canvas || canvas.offsetWidth === 0) return;
    
    const ctx = canvas.getContext('2d');
    const data = appData.trendData;
    
    // Set canvas size with device pixel ratio for sharp rendering
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.offsetWidth * dpr;
    canvas.height = canvas.offsetHeight * dpr;
    ctx.scale(dpr, dpr);
    
    const width = canvas.offsetWidth;
    const height = canvas.offsetHeight;
    const padding = 10;
    const dataPoints = data.length;
    
    ctx.clearRect(0, 0, width, height);
    
    const maxValue = Math.max(...data);
    const minValue = Math.min(...data);
    const range = maxValue - minValue || 1;
    
    const points = data.map((value, index) => {
        const x = padding + (index * (width - padding * 2)) / (dataPoints - 1);
        const y = height - padding - ((value - minValue) / range) * (height - padding * 2);
        return { x, y };
    });
    
    // Draw gradient fill
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, 'rgba(139, 92, 246, 0.4)');
    gradient.addColorStop(1, 'rgba(139, 92, 246, 0.02)');
    
    ctx.beginPath();
    ctx.moveTo(points[0].x, height - padding);
    ctx.lineTo(points[0].x, points[0].y);
    
    for (let i = 1; i < points.length; i++) {
        const xc = (points[i - 1].x + points[i].x) / 2;
        const yc = (points[i - 1].y + points[i].y) / 2;
        ctx.quadraticCurveTo(points[i - 1].x, points[i - 1].y, xc, yc);
    }
    ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
    ctx.lineTo(points[points.length - 1].x, height - padding);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();
    
    // Draw smooth line
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    
    for (let i = 1; i < points.length; i++) {
        const xc = (points[i - 1].x + points[i].x) / 2;
        const yc = (points[i - 1].y + points[i].y) / 2;
        ctx.quadraticCurveTo(points[i - 1].x, points[i - 1].y, xc, yc);
    }
    ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
    
    ctx.strokeStyle = '#8b5cf6';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    
    // Draw points
    points.forEach((point) => {
        ctx.beginPath();
        ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#8b5cf6';
        ctx.fill();
        ctx.strokeStyle = '#121019';
        ctx.lineWidth = 2;
        ctx.stroke();
    });
}

// Setup Event Listeners
function setupEventListeners() {
    // Navigation
    openDashboardBtn.addEventListener('click', () => {
        previousPanel = 'detector';
        showPanel('dashboard');
    });
    
    openSettingsBtn.addEventListener('click', () => {
        previousPanel = 'detector';
        showPanel('settings');
    });
    
    openSettingsFromDashboardBtn.addEventListener('click', () => {
        previousPanel = 'dashboard';
        showPanel('settings');
    });
    
    backFromDashboardBtn.addEventListener('click', () => {
        showPanel('detector');
    });
    
    backFromSettingsBtn.addEventListener('click', () => {
        showPanel(previousPanel);
    });
    
    // Scanning Toggle
    scanningToggle.addEventListener('change', () => {
        updateScanningStatus(scanningToggle.checked);
        saveSettings();
        sendSettingToActiveTab('toggleScanning', scanningToggle.checked);
    });
    
    // Language Settings
    document.getElementById('languageSettings')?.addEventListener('click', () => {
        alert('Language settings: Currently set to Hinglish. Other languages coming soon!');
    });
    
    document.getElementById('languageSettingsModal')?.addEventListener('click', () => {
        alert('Language settings: Currently set to Hinglish. Other languages coming soon!');
    });
    
    // Report Issue
    document.getElementById('reportIssue')?.addEventListener('click', () => {
        alert('Report feature coming soon! You can report issues via email for now.');
    });
    
    // Report False Positive
    document.getElementById('reportFalsePositive')?.addEventListener('click', () => {
        alert('Report False Positive: This feature will allow you to report incorrectly flagged content.');
    });
    
    // Suggest Correction
    document.getElementById('suggestCorrection')?.addEventListener('click', () => {
        alert('Suggest Correction: Help us improve by suggesting corrections to our detection model.');
    });
}

// Listen for Messages from Background/Content Scripts
if (typeof chrome !== 'undefined' && chrome.runtime) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'updateStats') {
            appData.totalAnalyzed = request.data.totalAnalyzed || appData.totalAnalyzed;
            appData.flagged = request.data.flagged || appData.flagged;
            appData.flaggedThisWeek = request.data.flaggedThisWeek || appData.flaggedThisWeek;
            updateStats();
            loadDetections();
            sendResponse({status: 'success'});
        }
        return true;
    });
}

// Listen for storage changes to update popup in real-time
if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local') {
            if (changes.detections) {
                const detections = changes.detections.newValue || [];
                appData.flagged = detections.length;
                renderDetections(detections);
                updateTrendChart(detections);
                updateStats();
            }
            if (changes.stats) {
                const s = changes.stats.newValue;
                appData.totalAnalyzed = s.totalAnalyzed || 0;
                appData.flaggedThisWeek = s.flaggedThisWeek || 0;
                updateStats();
            }
        }
    });
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// Poll storage every 500ms to keep popup in sync (real-time updates)
setInterval(() => {
    loadDetections();
}, 500);

// Redraw chart on window resize
window.addEventListener('resize', () => {
    drawTrendChart();
});
