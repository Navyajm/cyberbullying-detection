// CyberGuard Content Script - Scans social media for cyberbullying

console.log('CyberGuard content script loaded');

// Configuration
const API_BASE_URL = 'http://localhost:5000/api';
let isScanning = true;
let isDetectionEnabled = true;
let scannedComments = new Set();
let flaggedTexts = new Map(); // text -> {severity, result} - persists flagged state
let stats = {
    totalAnalyzed: 0,
    flagged: 0
};

// Load existing cumulative stats from storage on startup
chrome.storage.local.get(['stats'], (res) => {
    if (res.stats) {
        stats.totalAnalyzed = res.stats.totalAnalyzed || 0;
        stats.flagged = res.stats.flagged || 0;
    }
});

// Load scanning/detection settings from storage on startup
chrome.storage.sync.get(['scanningEnabled', 'detectionEnabled'], (res) => {
    if (res.scanningEnabled !== undefined) {
        isScanning = res.scanningEnabled;
    }
    if (res.detectionEnabled !== undefined) {
        isDetectionEnabled = res.detectionEnabled;
    }
    console.log('CyberGuard settings loaded:', { isScanning, isDetectionEnabled });
});

// Keep tab state in sync even if toggle changed from another tab/popup instance
if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync') return;

        if (changes.scanningEnabled) {
            isScanning = changes.scanningEnabled.newValue !== undefined
                ? changes.scanningEnabled.newValue
                : true;
            console.log('CyberGuard scanning updated from storage:', isScanning);
        }

        if (changes.detectionEnabled) {
            isDetectionEnabled = changes.detectionEnabled.newValue !== undefined
                ? changes.detectionEnabled.newValue
                : true;
            console.log('CyberGuard detection updated from storage:', isDetectionEnabled);
        }

        if (isScanning && isDetectionEnabled) {
            setTimeout(scanComments, 0);
        }
    });
}

// Platform detection
const platform = detectPlatform();

function detectPlatform() {
    const hostname = window.location.hostname;
    if (hostname.includes('youtube.com')) return 'youtube';
    if (hostname.includes('twitter.com') || hostname.includes('x.com')) return 'twitter';
    if (hostname.includes('instagram.com')) return 'instagram';
    if (hostname.includes('facebook.com')) return 'facebook';
    if (hostname.includes('reddit.com')) return 'reddit';
    return 'unknown';
}

// Get comment selectors based on platform
function getCommentSelectors() {
    const selectors = {
        youtube: '#content-text',
        twitter: '[data-testid="tweetText"]',
        instagram: 'span._ap3a._aaco._aacw._aacx._aad7._aade',
        facebook: '[dir="auto"]',
        reddit: '.md p, .RichTextJSON-root p, [data-testid="comment"] p, [slot="comment"] p, div[id^="t1_"] p, [data-click-id="text"] p, .Comment p, .top-level-reply p, p[class*="comment"]'
    };
    return selectors[platform] || 'p, span, div[class*="comment"]';
}

// Check if text contains Hinglish (Hindi words in Roman script mixed with English)
// Expanded list to match backend improvements
function isHinglish(text) {
    const words = text.toLowerCase().split(/\s+/).map(w => w.replace(/[^a-z]/g, ''));

    // Strong Hindi markers — words that do NOT exist in English
    const strongMarkers = new Set([
        'hai', 'hain', 'hota', 'hoti', 'tha', 'thi', 'hun', 'hu',
        'mein', 'kya', 'kyu', 'kyun', 'kaise', 'kahan', 'kaun', 'kab',
        'nahi', 'nahin', 'nhi', 'mat',
        'yeh', 'woh', 'wahi', 'yahi', 'ye', 'wo',
        'tum', 'aap', 'hum', 'mera', 'meri', 'tera', 'teri', 'uska', 'uski', 'iska', 'iski',
        'bhi', 'aur', 'lekin', 'phir', 'toh', 'magar', 'par',
        'bohot', 'bahut', 'zyada', 'bilkul', 'ekdum', 'sabse', 'kaafi',
        'accha', 'achha', 'bura', 'sahi', 'galat', 'theek', 'kharab', 'bekaar',
        'dekh', 'dekho', 'bata', 'batao', 'bolo', 'suno', 'sun', 'bol',
        'karo', 'karna', 'karke', 'karenge', 'karega', 'karunga', 'karungi',
        'jao', 'jaao', 'aao', 'aaja', 'chal', 'nikal',
        'yaar', 'bhai', 'banda', 'bandi', 'dost', 'bro',
        'wala', 'wali', 'wale', 'waala', 'waali', 'waale',
        'abhi', 'pehle', 'baad', 'jaldi', 'dheere',
        'paisa', 'kaam', 'ghar', 'duniya', 'log',
        'dikhta', 'dikhti', 'lagta', 'lagti',
        'kuch', 'kitna', 'kitni', 'koi', 'kisi',
        'isko', 'usko', 'inhe', 'unhe', 'isme', 'usme', 'ispe', 'uspe',
        'mujhe', 'tujhe', 'humein',
        'apna', 'apni', 'apne',
        'kahi', 'kahin', 'kabhi'
    ]);

    // Toxic Hindi words — if even ONE is present, it's definitely Hinglish abuse
    const toxicHindi = new Set([
        'chutiya', 'kamina', 'kamini', 'harami', 'haramkhor',
        'saala', 'saali', 'bakwas', 'faltu', 'gadha',
        'bewakoof', 'bewkoof', 'pagal', 'paagal', 'ghatiya',
        'nalayak', 'nikamma', 'wahiyat', 'kachra', 'tatti',
        'randi', 'madarchod', 'behenchod', 'bhosdike', 'lodu',
        'kutti', 'kutta', 'dhakkan', 'phattu', 'tharki',
        'chapri', 'chhapri', 'nalla', 'aukat', 'maarunga',
        'besharam', 'badtameez', 'jahil', 'lafanga',
        'chamaar', 'bhangi', 'hijra', 'chakka',
        'bhosdi', 'gand', 'gaand', 'lawda', 'lauda', 'choot',
        'rand', 'chinaal', 'kutiya'
    ]);

    let hindiCount = 0;
    let hasToxicHindi = false;
    for (const word of words) {
        if (word.length >= 2 && strongMarkers.has(word)) {
            hindiCount++;
        }
        if (toxicHindi.has(word)) {
            hasToxicHindi = true;
        }
    }

    // Hinglish if: has a toxic Hindi word, OR has 2+ Hindi marker words
    if (hasToxicHindi) return true;
    if (words.length < 5 && hindiCount >= 1) return true; // Short phrase check
    return hindiCount >= 2;
}

// Call backend API for cyberbullying detection
async function detectCyberbullying(text) {
    if (!isDetectionEnabled) {
        return {
            isBullying: false,
            severity: 'none',
            confidence: 0,
            category: 'disabled',
            explanation: 'Detection disabled',
            method: 'disabled'
        };
    }

    try {
        const response = await fetch(`${API_BASE_URL}/detect`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                text: text,
                use_llm: true  // Use LLM for better accuracy
            })
        });

        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }

        const result = await response.json();

        return {
            isBullying: result.is_cyberbullying && (result.method === 'hinglish_check' ? false : true),
            severity: result.severity || (result.is_cyberbullying ? 'high' : 'none'),
            confidence: result.confidence || 0.5,
            category: result.category || 'unknown',
            explanation: result.explanation || '',
            method: result.method || 'unknown'
        };
    } catch (error) {
        console.error('CyberGuard API error, using fallback:', error);
        // Fallback to local keyword detection if API fails
        return detectWithKeywordsFallback(text);
    }
}

// Local keyword-based fallback detection with categories and explanations
function detectWithKeywordsFallback(text) {
    const t = text.toLowerCase();

    // Only flag Hinglish text — skip pure English
    if (!isHinglish(text)) {
        return {
            isBullying: false,
            severity: 'none',
            confidence: 0.1,
            category: 'none',
            explanation: '',
            method: 'keyword_fallback'
        };
    }

    // Each entry: [keyword, severity, category, explanation]
    const keywords = [
        // HIGH — abusive slurs and threats
        ['chutiya', 'high', 'insult', 'Contains abusive Hindi slur'],
        ['madarchod', 'high', 'insult', 'Contains severe abusive language'],
        ['behenchod', 'high', 'insult', 'Contains severe abusive language'],
        ['bhosdike', 'high', 'insult', 'Contains severe abusive slur'],
        ['bhosdiwale', 'high', 'insult', 'Contains severe abusive slur'],
        ['randi', 'high', 'insult', 'Contains gendered abusive slur'],
        ['haramkhor', 'high', 'insult', 'Contains abusive Hindi slur'],
        ['harami', 'high', 'insult', 'Contains abusive Hindi slur'],
        ['kutta', 'high', 'insult', 'Dehumanizing insult (dog)'],
        ['kutti', 'high', 'insult', 'Dehumanizing gendered insult'],
        ['kamina', 'high', 'insult', 'Contains abusive Hindi slur'],
        ['kamini', 'high', 'insult', 'Contains gendered abusive slur'],
        ['saala', 'high', 'insult', 'Contains abusive Hindi term'],
        ['saali', 'high', 'insult', 'Contains gendered abusive term'],
        ['lodu', 'high', 'insult', 'Contains vulgar abusive term'],
        ['gand', 'high', 'insult', 'Contains vulgar language'],
        ['maar dunga', 'high', 'threat', 'Contains violent threat in Hindi'],
        ['maarunga', 'high', 'threat', 'Contains violent threat in Hindi'],
        ['jaan se maar', 'high', 'threat', 'Contains death threat in Hindi'],
        ['kaat dunga', 'high', 'threat', 'Contains violent threat in Hindi'],
        ['gaali', 'high', 'insult', 'References abusive language'],
        ['bhag yahan se', 'high', 'harassment', 'Hostile dismissal in Hindi'],
        ['teri maa', 'high', 'insult', 'Maternal insult in Hindi'],
        ['tera baap', 'high', 'insult', 'Paternal insult in Hindi'],
        ['aukat', 'high', 'harassment', 'Demeaning social status attack'],
        ['nikal', 'high', 'harassment', 'Hostile dismissal in Hindi'],

        // MEDIUM — moderate insults, body shaming, discrimination
        ['gadha', 'medium', 'insult', 'Called someone a donkey (gadha)'],
        ['gadhe', 'medium', 'insult', 'Called someone a donkey (gadhe)'],
        ['bewakoof', 'medium', 'insult', 'Called someone foolish (bewakoof)'],
        ['bewkoof', 'medium', 'insult', 'Called someone foolish (bewkoof)'],
        ['pagal', 'medium', 'insult', 'Called someone crazy (pagal)'],
        ['paagal', 'medium', 'insult', 'Called someone crazy (paagal)'],
        ['chapri', 'medium', 'discrimination', 'Classist slur (chapri)'],
        ['chhapri', 'medium', 'discrimination', 'Classist slur (chhapri)'],
        ['ghatiya', 'medium', 'insult', 'Called something/someone inferior'],
        ['nalayak', 'medium', 'insult', 'Called someone worthless (nalayak)'],
        ['nikamma', 'medium', 'insult', 'Called someone useless (nikamma)'],
        ['nikammi', 'medium', 'insult', 'Called someone useless (nikammi)'],
        ['tharki', 'medium', 'harassment', 'Called someone a pervert'],
        ['ganda', 'medium', 'insult', 'Called something/someone dirty'],
        ['gandi', 'medium', 'insult', 'Called something/someone dirty'],
        ['chup kar', 'medium', 'harassment', 'Aggressive silencing (chup kar)'],
        ['chamaar', 'medium', 'discrimination', 'Caste-based slur'],
        ['bhangi', 'medium', 'discrimination', 'Caste-based slur'],
        ['moti', 'medium', 'body_shaming', 'Body shaming (calling fat)'],
        ['mota', 'medium', 'body_shaming', 'Body shaming (calling fat)'],
        ['kaali', 'medium', 'discrimination', 'Colorism/skin shade shaming'],
        ['kaala', 'medium', 'discrimination', 'Colorism/skin shade shaming'],
        ['chal hat', 'medium', 'harassment', 'Dismissive/hostile language'],
        ['bhag', 'medium', 'harassment', 'Hostile dismissal in Hindi'],
        ['chup ho ja', 'medium', 'harassment', 'Aggressive silencing'],
        ['band kar', 'medium', 'harassment', 'Aggressive silencing'],
        ['nalla', 'medium', 'insult', 'Called someone idle/useless'],
        ['dhakkan', 'medium', 'insult', 'Called someone stupid (dhakkan)'],
        ['phattu', 'medium', 'insult', 'Called someone a coward'],
        ['namard', 'medium', 'insult', 'Gendered insult questioning manhood'],
        ['hijra', 'medium', 'discrimination', 'Transphobic slur'],
        ['chakka', 'medium', 'discrimination', 'Transphobic slur'],

        // LOW — mild toxicity, dismissive language
        ['bakwas', 'low', 'insult', 'Called something nonsense (bakwas)'],
        ['faltu', 'low', 'insult', 'Called something worthless (faltu)'],
        ['bekar', 'low', 'insult', 'Called something useless (bekar)'],
        ['bekaar', 'low', 'insult', 'Called something useless (bekaar)'],
        ['wahiyat', 'low', 'insult', 'Called something terrible (wahiyat)'],
        ['kachra', 'low', 'insult', 'Called something garbage (kachra)'],
        ['tatti', 'low', 'insult', 'Vulgar dismissal (tatti)'],
        ['ullu', 'low', 'insult', 'Called someone an owl/fool (ullu)'],
        ['buddhu', 'low', 'insult', 'Called someone a simpleton'],
        ['ajeeb', 'low', 'insult', 'Called someone/something weird'],
        ['jhalli', 'low', 'insult', 'Called someone silly (jhalli)'],
        ['jhalla', 'low', 'insult', 'Called someone silly (jhalla)'],
        ['chep', 'low', 'insult', 'Called someone clingy/annoying'],
        ['kameena', 'low', 'insult', 'Mild form of abusive term'],
        ['bevda', 'low', 'insult', 'Called someone a drunkard'],
        ['lafanga', 'low', 'insult', 'Called someone a loafer'],
        ['lukkha', 'low', 'insult', 'Called someone idle/useless'],
        ['besharam', 'low', 'insult', 'Called someone shameless'],
        ['badtameez', 'low', 'insult', 'Called someone ill-mannered'],
        ['jahil', 'low', 'insult', 'Called someone ignorant'],
    ];

    for (const [word, severity, category, explanation] of keywords) {
        if (t.includes(word)) {
            return {
                isBullying: true,
                severity,
                confidence: severity === 'high' ? 0.9 : severity === 'medium' ? 0.75 : 0.6,
                category,
                explanation,
                method: 'keyword_fallback'
            };
        }
    }

    return {
        isBullying: false,
        severity: 'none',
        confidence: 0.1,
        category: 'none',
        explanation: '',
        method: 'keyword_fallback'
    };
}

// Inject styles for highlighting
function injectStyles() {
    if (document.getElementById('cyberguard-styles')) return;

    const styles = document.createElement('style');
    styles.id = 'cyberguard-styles';
    styles.textContent = `
        .cyberguard-highlight {
            position: relative;
            border-radius: 4px;
            transition: all 0.3s ease;
        }
        
        .cyberguard-highlight-low {
            background: rgba(239, 68, 68, 0.15) !important;
            border-left: 3px solid #ef4444 !important;
        }
        
        .cyberguard-highlight-medium {
            background: rgba(239, 68, 68, 0.15) !important;
            border-left: 3px solid #ef4444 !important;
        }
        
        .cyberguard-highlight-high {
            background: rgba(239, 68, 68, 0.15) !important;
            border-left: 3px solid #ef4444 !important;
        }
        
        .cyberguard-badge {
            position: absolute;
            top: -8px;
            right: -8px;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 9px;
            font-weight: 700;
            letter-spacing: 0.5px;
            z-index: 1000;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }
        
        .cyberguard-badge-low {
            background: #421c1c;
            color: #ef4444;
        }
        
        .cyberguard-badge-medium {
            background: #421c1c;
            color: #ef4444;
        }
        
        .cyberguard-badge-high {
            background: #421c1c;
            color: #ef4444;
        }
        
        .cyberguard-actions {
            display: flex;
            gap: 8px;
            margin-top: 8px;
            padding: 8px;
            background: rgba(0, 0, 0, 0.05);
            border-radius: 6px;
        }
        
        .cyberguard-btn {
            padding: 6px 12px;
            border: none;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
        }
        
        .cyberguard-btn-hide {
            background: #fee2e2;
            color: #dc2626;
        }
        
        .cyberguard-btn-hide:hover {
            background: #fecaca;
        }
        
        .cyberguard-btn-block {
            background: #e5e7eb;
            color: #374151;
        }
        
        .cyberguard-btn-block:hover {
            background: #d1d5db;
        }
        
        .cyberguard-hidden {
            display: none !important;
        }
        
        .cyberguard-hidden-notice {
            padding: 12px;
            background: #fef3c7;
            border: 1px solid #f59e0b;
            border-radius: 6px;
            color: #92400e;
            font-size: 12px;
            margin: 8px 0;
        }
        
        .cyberguard-tooltip {
            position: absolute;
            z-index: 10000;
            background: #1e1b26;
            border-radius: 8px;
            padding: 12px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            animation: cyberguard-fadeIn 0.2s ease;
        }
        
        @keyframes cyberguard-fadeIn {
            from { opacity: 0; transform: translateY(5px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        .cyberguard-tooltip-content {
            color: white;
        }
        
        .cyberguard-tooltip-severity {
            display: inline-block;
            padding: 3px 8px;
            border-radius: 4px;
            font-size: 10px;
            font-weight: 700;
            margin-bottom: 8px;
        }
        
        .cyberguard-tooltip-message {
            font-size: 12px;
            color: #d1d5db;
            line-height: 1.5;
        }
        
        .cyberguard-tooltip-arrow {
            position: absolute;
            bottom: -6px;
            left: 20px;
            width: 12px;
            height: 12px;
            background: #1e1b26;
            transform: rotate(45deg);
        }
    `;
    document.head.appendChild(styles);
}

// Highlight detected comment
function highlightComment(element, severity, result) {
    // Skip if already highlighted
    if (element.classList.contains('cyberguard-highlight')) return;

    // Store in flaggedTexts so it persists across DOM re-renders
    const text = element.textContent.trim();
    if (text && !flaggedTexts.has(text)) {
        flaggedTexts.set(text, { severity, result });
    }

    applyHighlight(element, severity, result);
}

// Apply visual highlight to an element (used for initial and re-application)
function applyHighlight(element, severity, result) {
    if (element.classList.contains('cyberguard-highlight')) return;

    // Default to high if severity is undefined or weird
    const severityClass = severity && ['low', 'medium', 'high'].includes(severity) ? severity : 'high';

    // Add highlight class
    element.classList.add('cyberguard-highlight', `cyberguard-highlight-${severityClass}`);

    // Create badge
    const badge = document.createElement('div');
    badge.className = `cyberguard-badge cyberguard-badge-${severityClass}`;
    badge.textContent = 'FLAGGED';
    badge.title = result.explanation || 'Hinglish cyberbullying detected';

    element.style.position = 'relative';
    if (element.parentNode) {
        element.parentNode.insertBefore(badge, element.nextSibling);
    }

    // Create action buttons
    const actions = document.createElement('div');
    actions.className = 'cyberguard-actions';

    const hideBtn = document.createElement('button');
    hideBtn.className = 'cyberguard-btn cyberguard-btn-hide';
    hideBtn.textContent = 'Hide Comment';
    hideBtn.onclick = (e) => {
        e.stopPropagation();
        hideComment(element);
    };

    const blockBtn = document.createElement('button');
    blockBtn.className = 'cyberguard-btn cyberguard-btn-block';
    blockBtn.textContent = 'Block User Instructions';
    blockBtn.onclick = (e) => {
        e.stopPropagation();
        showBlockInstructions();
    };

    actions.appendChild(hideBtn);
    actions.appendChild(blockBtn);

    // Insert actions after the badge
    if (badge.parentNode) {
        badge.parentNode.insertBefore(actions, badge.nextSibling);
    }
}

// Re-apply highlights to previously flagged comments whose DOM was re-rendered
function reapplyHighlights() {
    if (flaggedTexts.size === 0) return;

    const selector = getCommentSelectors();
    const comments = (platform === 'reddit')
        ? querySelectorAllDeep(selector)
        : Array.from(document.querySelectorAll(selector));

    for (const comment of comments) {
        if (comment.classList && comment.classList.contains('cyberguard-highlight')) continue;
        const text = comment.textContent.trim();
        if (flaggedTexts.has(text)) {
            const { severity, result } = flaggedTexts.get(text);
            applyHighlight(comment, severity, result);
        }
    }
}

// Hide comment
function hideComment(element) {
    element.classList.add('cyberguard-hidden');

    // Also hide actions
    const actions = element.nextElementSibling;
    if (actions && actions.classList.contains('cyberguard-actions')) {
        actions.classList.add('cyberguard-hidden');
    }

    const notice = document.createElement('div');
    notice.className = 'cyberguard-hidden-notice';

    const text = document.createTextNode('⚠️ This comment was hidden by CyberGuard (potentially harmful content) ');
    notice.appendChild(text);

    const showBtn = document.createElement('button');
    showBtn.textContent = 'Show';
    showBtn.style.cssText = 'margin-left:8px;padding:2px 8px;cursor:pointer;border:1px solid #92400e;background:transparent;border-radius:4px;color:#92400e;';
    showBtn.addEventListener('click', () => {
        element.classList.remove('cyberguard-hidden');
        if (actions && actions.classList.contains('cyberguard-actions')) {
            actions.classList.remove('cyberguard-hidden');
        }
        notice.remove();
    });
    notice.appendChild(showBtn);

    element.parentNode.insertBefore(notice, element);
}

// Show block instructions
function showBlockInstructions() {
    const instructions = {
        youtube: '1. Click on the channel name\n2. Go to their channel page\n3. Click the flag icon\n4. Select "Block user"',
        twitter: '1. Click on the profile picture\n2. Click the "..." menu\n3. Select "Block @username"',
        instagram: '1. Tap on the username\n2. Tap the "..." menu\n3. Select "Block"',
        facebook: '1. Click on the person\'s name\n2. Click the "..." button on their profile\n3. Select "Block"',
        reddit: '1. Click on the username\n2. Go to their profile\n3. Click "More Options"\n4. Select "Block User"'
    };

    const platformInstructions = instructions[platform] || instructions.twitter;
    alert(`To block this user on ${platform}:\n\n${platformInstructions}\n\nThis will prevent them from seeing your content and interacting with you.`);
}

// Save detection by sending message to background script
function saveDetection(text, result) {
    try {
        const detectionData = {
            text: text,
            severity: result.severity || 'low',
            confidence: result.confidence || 0,
            category: result.category || 'unknown',
            explanation: result.explanation || '',
            platform: platform,
            method: result.method || 'keyword'
        };

        if (chrome.runtime) {
            chrome.runtime.sendMessage({
                action: 'newDetection',
                data: detectionData
            }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error('CyberGuard message error:', chrome.runtime.lastError);
                } else {
                    console.log('CyberGuard: sent detection to background:', response);
                }
            });
        }
    } catch (e) {
        console.error('CyberGuard saveDetection error:', e);
    }
}

// Save stats directly to chrome.storage.local
async function saveStats() {
    try {
        // Get weekly flagged count from backend
        let flaggedThisWeek = 0;
        try {
            const response = await fetch(`${API_BASE_URL}/stats`);
            if (response.ok) {
                const backendStats = await response.json();
                flaggedThisWeek = backendStats.flagged_this_week || 0;
            }
        } catch (e) {
            console.error('CyberGuard backend stats fetch error:', e);
        }
        
        chrome.storage.local.set({
            stats: {
                totalAnalyzed: stats.totalAnalyzed,
                flagged: stats.flagged,
                flaggedThisWeek: flaggedThisWeek
            }
        }, () => {
            if (chrome.runtime.lastError) {
                console.error('CyberGuard stats write error:', chrome.runtime.lastError);
            }
        });
    } catch (e) {
        console.error('CyberGuard saveStats error:', e);
    }
}

// Collect elements from shadow DOM (for Reddit's web components)
function querySelectorAllDeep(selector, root = document) {
    const results = Array.from(root.querySelectorAll(selector));

    // Also search inside shadow roots
    const allElements = root.querySelectorAll('*');
    for (const el of allElements) {
        if (el.shadowRoot) {
            results.push(...querySelectorAllDeep(selector, el.shadowRoot));
        }
    }
    return results;
}

// Scan comments on the page
async function scanComments() {
    if (!isScanning || !isDetectionEnabled) return;

    const selector = getCommentSelectors();
    let comments = (platform === 'reddit')
        ? querySelectorAllDeep(selector)
        : Array.from(document.querySelectorAll(selector));

    // Reddit fallback: if specific selectors found nothing, scan all <p> tags in comment areas
    if (platform === 'reddit' && comments.length === 0) {
        comments = querySelectorAllDeep('p');
    }

    console.log(`CyberGuard: found ${comments.length} elements to scan on ${platform}`);

    for (const comment of comments) {
        if (!isScanning || !isDetectionEnabled) break;

        // Skip elements already highlighted or injected by CyberGuard
        if (comment.classList && comment.classList.contains('cyberguard-highlight')) continue;
        try {
            if (comment.closest && comment.closest('.cyberguard-highlight, .cyberguard-actions, .cyberguard-hidden-notice, .cyberguard-tooltip, .cyberguard-badge')) continue;
        } catch (e) { /* closest may fail on shadow DOM elements */ }

        const text = comment.textContent.trim();

        // Skip if already scanned or too short
        if (scannedComments.has(text) || text.length < 5) continue; // Lowered limit from 10 to 5 for short Hinglish phrases

        scannedComments.add(text);
        stats.totalAnalyzed++;

        try {
            const result = await detectCyberbullying(text);

            if (result.isBullying) {
                stats.flagged++;
                highlightComment(comment, result.severity, result);
                saveDetection(text, result);
                // Log to backend for real-time dashboard tracking
                fetch(`${API_BASE_URL}/log-detection`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: text })
                }).catch(e => console.error('Failed to log detection:', e));
            }
        } catch (error) {
            console.error('CyberGuard detection error:', error);
        }
    }

    // Save stats to storage (popup reads from here)
    saveStats();
}

// Text selection detection for manual check
document.addEventListener('mouseup', async () => {
    if (!isDetectionEnabled) return;

    const selectedText = window.getSelection().toString().trim();

    if (selectedText.length > 5 && selectedText.length < 500) {
        const result = await detectCyberbullying(selectedText);

        if (result.isBullying) {
            showTooltip(selectedText, result);
        }
    }
});

// Show tooltip for selected text
function showTooltip(text, result) {
    // Remove existing tooltip
    const existingTooltip = document.querySelector('.cyberguard-tooltip');
    if (existingTooltip) existingTooltip.remove();

    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    const tooltip = document.createElement('div');
    tooltip.className = 'cyberguard-tooltip';
    tooltip.style.left = `${rect.left + window.scrollX}px`;
    tooltip.style.top = `${rect.top + window.scrollY - 90}px`;

    tooltip.innerHTML = `
        <div class="cyberguard-tooltip-content">
            <div>
                <span class="cyberguard-tooltip-severity cyberguard-badge-${result.severity}">
                    ${result.severity ? result.severity.toUpperCase() : 'FLAGGED'}
                </span>
            </div>
            <div class="cyberguard-tooltip-message">
                ⚠️ Potential cyberbullying detected
                <br>Confidence: ${Math.round(result.confidence * 100)}%
                ${result.category ? `<br>Category: ${result.category}` : ''}
                ${result.method === 'hybrid_llm' || result.method === 'llm_direct' ? '<br><small>Analyzed by AI</small>' : ''}
            </div>
        </div>
        <div class="cyberguard-tooltip-arrow"></div>
    `;

    document.body.appendChild(tooltip);

    // Remove tooltip after 5 seconds or on click
    setTimeout(() => tooltip.remove(), 5000);
    document.addEventListener('click', () => tooltip.remove(), { once: true });
}

// Listen for messages from popup
if (typeof chrome !== 'undefined' && chrome.runtime) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'toggleScanning') {
            isScanning = request.enabled;
            console.log('CyberGuard scanning toggled:', isScanning);
            sendResponse({ status: 'success' });
        } else if (request.action === 'toggleDetection') {
            isDetectionEnabled = request.enabled;
            console.log('CyberGuard detection toggled:', isDetectionEnabled);
            sendResponse({ status: 'success' });
        }
        return true;
    });
}

// Start scanning when page loads
function initScanner() {
    console.log(`CyberGuard scanning ${platform} comments...`);

    // Inject styles
    injectStyles();

    // Initial scan
    setTimeout(scanComments, 1000);

    // Scan periodically for new comments
    setInterval(scanComments, 5000);

    // Re-apply highlights periodically (handles DOM re-renders by Twitter/X)
    setInterval(reapplyHighlights, 2000);

    // Observe DOM changes for dynamically loaded content
    const observer = new MutationObserver((mutations) => {
        // Ignore mutations caused by CyberGuard itself
        const isOwnMutation = mutations.every(m => {
            for (const node of m.addedNodes) {
                if (node.classList && (
                    node.classList.contains('cyberguard-highlight') ||
                    node.classList.contains('cyberguard-badge') ||
                    node.classList.contains('cyberguard-actions') ||
                    node.classList.contains('cyberguard-hidden-notice')
                )) return true;
            }
            return false;
        });
        if (isOwnMutation) return;

        // Debounce scanning
        clearTimeout(window.cyberguardScanTimeout);
        window.cyberguardScanTimeout = setTimeout(() => {
            reapplyHighlights();
            scanComments();
        }, 1000);
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initScanner);
} else {
    initScanner();
}
