// Service worker: does all network I/O with the local broker.
// Content scripts message us with their PR URL; we poll the broker
// and push updates back to the requesting tab. Polling (not SSE) so
// this survives MV3 service-worker suspension without needing to hold
// a persistent connection.

const BROKER = 'http://127.0.0.1:47821';
const POLL_MS = 1500;

// tabId -> { prUrl, timer, lastSummaryHash, lastFindingsHash }
const subs = new Map();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!sender.tab) return;
  const tabId = sender.tab.id;

  if (msg?.type === 'subscribe' && typeof msg.prUrl === 'string') {
    stopPolling(tabId);
    startPolling(tabId, msg.prUrl);
    sendResponse({ ok: true });
    return true;
  }
  if (msg?.type === 'unsubscribe') {
    stopPolling(tabId);
    sendResponse({ ok: true });
    return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => stopPolling(tabId));

function stopPolling(tabId) {
  const s = subs.get(tabId);
  if (s?.timer) clearTimeout(s.timer);
  subs.delete(tabId);
}

function startPolling(tabId, prUrl) {
  const state = { prUrl, timer: null, lastSummary: null, lastFindings: null, brokerDown: false };
  subs.set(tabId, state);
  const url = `${BROKER}/pr/${encodeURIComponent(prUrl)}`;

  const tick = async () => {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (r.status === 404) {
        pushStatus(tabId, 'waiting');
      } else if (r.ok) {
        const body = await r.json();
        const summaryStr = body.summary ? JSON.stringify(body.summary) : null;
        const findingsStr = body.findings ? JSON.stringify(body.findings) : null;
        if (summaryStr && summaryStr !== state.lastSummary) {
          state.lastSummary = summaryStr;
          send(tabId, { type: 'summary', data: body.summary });
        }
        if (findingsStr && findingsStr !== state.lastFindings) {
          state.lastFindings = findingsStr;
          send(tabId, { type: 'findings', data: body.findings });
        }
      }
      if (state.brokerDown) {
        state.brokerDown = false;
        pushStatus(tabId, 'connected');
      }
    } catch (_) {
      if (!state.brokerDown) {
        state.brokerDown = true;
        pushStatus(tabId, 'broker_offline');
      }
    }
    if (subs.has(tabId)) {
      state.timer = setTimeout(tick, POLL_MS);
    }
  };
  tick();
}

function send(tabId, message) {
  chrome.tabs.sendMessage(tabId, message).catch(() => {});
}

function pushStatus(tabId, status) {
  send(tabId, { type: 'status', status });
}
