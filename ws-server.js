const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const https = require('https');

const SCRIPT_URL = 'https://registry.npmmirror.com/page-agent/1.11.0/files/dist/iife/page-agent.demo.js?lang=en-US';
const AGENT_SCRIPT_PATH = path.join(__dirname, 'page-agent.js');
const API_URL = 'https://page-ag-testing-ohftxirgbn.cn-shanghai.fcapp.run/chat/completions';
const PORT = 8000;                                                                                                                                                                                                                                                              // ── Script download ──────────────────────────────────────────────────────────

function ensureAgentDownloaded() {
    return new Promise((resolve, reject) => {
        if (fs.existsSync(AGENT_SCRIPT_PATH)) {
            resolve();
            return;
        }

        https.get(SCRIPT_URL, (res) => {                                                                                                            let data = '';                                                                                                                          res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                fs.writeFileSync(AGENT_SCRIPT_PATH, data);
                resolve();
            });
        }).on('error', reject);                                                                                                             });                                                                                                                                 }

// ── API proxy ────────────────────────────────────────────────────────────────

function proxyApiRequest(requestData, callback) {
    const postData = JSON.stringify(requestData);
    const url = new URL(API_URL);

    const options = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Origin': 'https://page-ag-testing-ohftxirgbn.cn-shanghai.fcapp.run',
            'Referer': 'https://page-ag-testing-ohftxirgbn.cn-shanghai.fcapp.run/',
            'Accept': 'application/json',
            'Accept-Encoding': 'gzip, deflate, br',
            'Accept-Language': 'en-US,en;q=0.9',
            'Connection': 'keep-alive'
        }
    };

    const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
            if (res.statusCode === 403) {
                callback(new Error(`API returned 403`), null);
                return;
            }

            try {
                const parsed = JSON.parse(data);

                if (parsed.error) {
                    callback(new Error(`API Error: ${JSON.stringify(parsed.error)}`), null);
                    return;
                }

                if (!parsed.choices || !Array.isArray(parsed.choices)) {
                    callback(new Error(`Unexpected response shape: ${Object.keys(parsed).join(', ')}`), null);
                    return;
                }

                callback(null, parsed);
            } catch (e) {
                callback(new Error(`Invalid JSON: ${e.message}`), null);
            }
        });
    });

    req.on('error', (error) => callback(error, null));
    req.write(postData);
    req.end();
}

// ── WS client script served to the browser ──────────────────────────────────

function buildClientScript() {
    return `(function () {
    'use strict';

    const ws = new WebSocket('ws://localhost:${PORT}');
    const pendingRequests = {};

    ws.onopen = function () {
        ws.send(JSON.stringify({ type: 'getScript', file: 'page-agent' }));
    };

    ws.onmessage = function (event) {
        const data = JSON.parse(event.data);

        if (data.type === 'script') {
            window.originalFetch = window.fetch;
            window.fetch = function (url, options) {
                if (url.includes('page-ag-testing-ohftxirgbn.cn-shanghai.fcapp.run/chat/completions')) {
                    return new Promise((resolve, reject) => {
                        const requestId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);

                        ws.send(JSON.stringify({
                            type: 'apiRequest',
                            requestId,
                            payload: JSON.parse(options.body)
                        }));

                        pendingRequests[requestId] = { resolve, reject };

                        setTimeout(() => {
                            if (pendingRequests[requestId]) {
                                delete pendingRequests[requestId];
                                reject(new Error('Request timeout'));
                            }
                        }, 30000);
                    });
                }

                return window.originalFetch(url, options);
            };

            const blob = new Blob([data.content], { type: 'application/javascript' });
            const blobUrl = URL.createObjectURL(blob);
            const script = document.createElement('script');
            script.src = blobUrl;
            script.onload = function() {
                URL.revokeObjectURL(blobUrl);
                initializePageAgent();
            };
            document.head.appendChild(script);
            return;
        }

        if (data.type === 'apiResponse') {
            const pending = pendingRequests[data.requestId];
            if (!pending) return;
            delete pendingRequests[data.requestId];

            if (data.error) {
                pending.reject(new Error(data.error));
                return;
            }

            pending.resolve(new Response(JSON.stringify(data.response), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            }));
        }
    };

    ws.onerror = function (err) {
        console.error('WebSocket error:', err);
    };

    function initializePageAgent() {
        // Check if pageAgent exists and set config
        if (window.pageAgent && window.pageAgent.config) {
            window.pageAgent.config.language = 'en-US';
            // After setting language, translate the UI
            translateUIToEnglish();
        } else {
            // If pageAgent doesn't exist yet, wait for it
            const checkInterval = setInterval(function() {
                if (window.pageAgent && window.pageAgent.config) {
                    window.pageAgent.config.language = 'en-US';
                    translateUIToEnglish();
                    clearInterval(checkInterval);
                }
            }, 100);

            // Safety timeout to prevent infinite checking
            setTimeout(function() {
                clearInterval(checkInterval);
                if (window.pageAgent && window.pageAgent.config) {
                    window.pageAgent.config.language = 'en-US';
                    translateUIToEnglish();
                } else {
                    console.warn('pageAgent not found after waiting');
                }
            }, 5000);
        }
    }

    function translateUIToEnglish() {
        // Translation mapping
        const translations = {
            '等待任务开始...': 'Waiting for task to start...',
            '准备就绪': 'Ready',
            '输入新任务，详细描述步骤，回车提交': 'Enter new task, describe steps in detail, press Enter to submit',
            '展开历史': 'Expand history',
            '关闭': 'Close'
        };

        // Function to translate text nodes
        function translateTextNodes(node) {
            if (node.nodeType === Node.TEXT_NODE) {
                const text = node.textContent.trim();
                if (text && translations[text]) {
                    node.textContent = translations[text];
                }
                return;
            }

            // Skip script and style elements
            if (node.tagName === 'SCRIPT' || node.tagName === 'STYLE') {
                return;
            }

            // Check for placeholder attributes
            if (node.tagName === 'INPUT' && node.placeholder) {
                const placeholder = node.placeholder;
                if (translations[placeholder]) {
                    node.placeholder = translations[placeholder];
                }
            }

            // Check for title attributes
            if (node.title && translations[node.title]) {
                node.title = translations[node.title];
            }

            // Recursively process child nodes
            for (let child of node.childNodes) {
                translateTextNodes(child);
            }
        }

        // Wait for DOM to be ready
        function performTranslation() {
            // Find the page-agent panel
            const panel = document.getElementById('page-agent-runtime_agent-panel');
            if (panel) {
                translateTextNodes(panel);
            }

            // Also translate any dynamically added elements using MutationObserver
            const observer = new MutationObserver(function(mutations) {
                mutations.forEach(function(mutation) {
                    if (mutation.type === 'childList') {
                        mutation.addedNodes.forEach(function(node) {
                            if (node.nodeType === Node.ELEMENT_NODE) {
                                translateTextNodes(node);
                            }
                        });
                    }
                });
            });

            // Start observing the panel for changes
            if (panel) {
                observer.observe(panel, {
                    childList: true,
                    subtree: true,
                    characterData: true
                });
            }

            // Also translate any status updates in history
            const historyItems = document.querySelectorAll('._historyContent_1tu05_402');
            historyItems.forEach(function(item) {
                const statusIcon = item.querySelector('._statusIcon_1tu05_403');
                if (statusIcon) {
                    // Keep the emoji, translate the text after it
                    const textNode = item.childNodes[1];
                    if (textNode && textNode.nodeType === Node.TEXT_NODE) {
                        const text = textNode.textContent.trim();
                        if (translations[text]) {
                            textNode.textContent = ' ' + translations[text];
                        }
                    }
                }
            });
        }

        // Run translation immediately and also after a short delay
        performTranslation();
        setTimeout(performTranslation, 100);
        setTimeout(performTranslation, 500);

        // Also set up a MutationObserver to catch dynamic changes
        const translationObserver = new MutationObserver(function() {
            // Check for new elements that need translation
            const inputs = document.querySelectorAll('input[placeholder]');
            inputs.forEach(function(input) {
                if (translations[input.placeholder]) {
                    input.placeholder = translations[input.placeholder];
                }
            });

            const statusTexts = document.querySelectorAll('._statusText_1tu05_166');
            statusTexts.forEach(function(el) {
                if (translations[el.textContent]) {
                    el.textContent = translations[el.textContent];
                }
            });

            const historyContents = document.querySelectorAll('._historyContent_1tu05_402');
            historyContents.forEach(function(item) {
                const textNode = item.childNodes[1];
                if (textNode && textNode.nodeType === Node.TEXT_NODE) {
                    const text = textNode.textContent.trim();
                    if (translations[text]) {
                        textNode.textContent = ' ' + translations[text];
                    }
                }
            });
        });

        translationObserver.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true
        });
    }

}());
`;
}

// ── WebSocket server ─────────────────────────────────────────────────────────

ensureAgentDownloaded().then(() => {
    const wss = new WebSocket.Server({ port: PORT });

    const clientScript = buildClientScript();

    wss.on('connection', (ws) => {
        ws.on('message', (message) => {
            let data;
            try {
                data = JSON.parse(message);
            } catch {
                return;
            }

            // Serve page-agent script
            if (data.type === 'getScript' && data.file === 'page-agent') {
                const content = fs.readFileSync(AGENT_SCRIPT_PATH, 'utf8');
                ws.send(JSON.stringify({ type: 'script', content }));
                return;
            }

            // Serve WS client script (for bookmarklet use)
            if (data.type === 'getScript' && data.file === 'client') {
                ws.send(JSON.stringify({ type: 'clientScript', content: clientScript }));
                return;
            }

            // Proxy API request
            if (data.type === 'apiRequest') {
                const requestId = data.requestId || 'unknown';

                proxyApiRequest(data.payload, (error, response) => {
                    if (error) {
                        ws.send(JSON.stringify({ type: 'apiResponse', requestId, error: error.message }));
                    } else {
                        ws.send(JSON.stringify({ type: 'apiResponse', requestId, response }));
                    }
                });
                return;
            }

            // Ping / keepalive
            if (data.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong' }));
            }
        });
    });

    console.log(`WebSocket proxy server running on ws://localhost:${PORT}`);
    console.log(`Bookmarklet: javascript:(function(){var s=new WebSocket('ws://localhost:8000');s.onopen=function(){s.send(JSON.stringify({type:'getScript',file:'client'}))};s.onmessage=function(e){var d=JSON.parse(e.data);if(d.type==='clientScript'){var b=new Blob([d.content],{type:'application/javascript'});var u=URL.createObjectURL(b);var el=document.createElement('script');el.src=u;document.head.appendChild(el);s.close()}}})();`);

}).catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
});
