(() => {
  const COLLAPSED_KEY = 'cps-collapsed';
  const SECTION_COLLAPSED_KEY = 'cps-section-collapsed';
  const WIDTH_KEY = 'cps-width';
  const MIN_WIDTH = 300;
  const MAX_WIDTH = 900;

  const reviewState = { files: [], index: -1 };

  let PR_URL = null;
  let els = null;

  configureMarkdownLibs();
  hookSpaNavigation();
  installKeyboardNavigation();

  chrome.runtime.onMessage.addListener((msg) => {
    if (!els) return;
    if (msg?.type === 'summary') renderSummary(msg.data, els);
    else if (msg?.type === 'findings') renderFindings(msg.data, els);
    else if (msg?.type === 'status') renderStatus(msg.status, els);
  });

  syncToLocation();

  function syncToLocation() {
    const nextPrUrl = canonicalPrUrl(window.location.href);
    const shouldShow = Boolean(nextPrUrl && onFilesTab());
    if (shouldShow) {
      if (els && PR_URL === nextPrUrl) return;
      if (els) unmountSidebar();
      PR_URL = nextPrUrl;
      reviewState.files = [];
      reviewState.index = -1;
      els = mountSidebar();
      applyPersistedCollapse();
      chrome.runtime.sendMessage({ type: 'subscribe', prUrl: PR_URL }).catch(() => {
        if (els) els.status.textContent = 'Extension background worker not reachable.';
      });
    } else if (els) {
      unmountSidebar();
    }
  }

  function unmountSidebar() {
    els?.root.remove();
    document.documentElement.classList.remove('cps-sidebar-mounted', 'cps-sidebar-collapsed');
    els = null;
    PR_URL = null;
    reviewState.files = [];
    reviewState.index = -1;
    chrome.runtime.sendMessage({ type: 'unsubscribe' }).catch(() => {});
  }

  function hookSpaNavigation() {
    const dispatch = () => window.dispatchEvent(new Event('cps:locationchange'));
    const origPush = history.pushState;
    const origReplace = history.replaceState;
    history.pushState = function (...args) {
      const ret = origPush.apply(this, args);
      dispatch();
      return ret;
    };
    history.replaceState = function (...args) {
      const ret = origReplace.apply(this, args);
      dispatch();
      return ret;
    };
    window.addEventListener('popstate', dispatch);
    window.addEventListener('cps:locationchange', syncToLocation);
  }

  function canonicalPrUrl(href) {
    const m = href.match(/^(https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+)/);
    return m ? m[1] : null;
  }

  function mountSidebar() {
    document.getElementById('claude-pr-sidebar')?.remove();
    document.documentElement.classList.add('cps-sidebar-mounted');
    applyPersistedWidth();

    const root = document.createElement('div');
    root.id = 'claude-pr-sidebar';
    root.innerHTML = `
      <div class="cps-header">
        <span class="cps-title">X-Ray</span>
        <button class="cps-toggle" title="Toggle sidebar" aria-label="Toggle sidebar">‹</button>
      </div>
      <div class="cps-body">
        <div class="cps-status">Waiting for /x-ray…</div>
        ${sectionHtml('why', '❓ PR background', '<div class="cps-why"></div>', true)}
        ${sectionHtml('order', '🗂️ Review order', '<div class="cps-order-hint">Navigate with [ and ]</div><ol class="cps-order"></ol>', true)}
        ${sectionHtml('findings', '🔎 Findings', '<div class="cps-findings"><em>Background /code-review running…</em></div>', false)}
      </div>
      <div class="cps-resize-handle" role="separator" aria-label="Resize sidebar" title="Drag to resize"></div>
    `;
    document.body.appendChild(root);

    root.querySelector('.cps-toggle').addEventListener('click', toggleSidebar);
    root.querySelectorAll('.cps-section-header').forEach((h) => {
      h.addEventListener('click', () => toggleSection(h.closest('.cps-section')));
    });
    installResizeHandle(root.querySelector('.cps-resize-handle'));

    return {
      root,
      toggleBtn: root.querySelector('.cps-toggle'),
      status: root.querySelector('.cps-status'),
      why: root.querySelector('.cps-why'),
      order: root.querySelector('.cps-order'),
      findings: root.querySelector('.cps-findings'),
      section: (name) => root.querySelector(`[data-section="${name}"]`),
    };
  }

  function sectionHtml(name, title, bodyHtml, hiddenByDefault) {
    return `
      <section class="cps-section" data-section="${name}"${hiddenByDefault ? ' hidden' : ''}>
        <div class="cps-section-header">
          <span class="cps-chevron">▾</span>
          <span>${title}</span>
        </div>
        <div class="cps-section-body">${bodyHtml}</div>
      </section>
    `;
  }

  function toggleSidebar() {
    const root = els.root;
    const nowCollapsed = !root.classList.contains('cps-collapsed');
    root.classList.toggle('cps-collapsed', nowCollapsed);
    document.documentElement.classList.toggle('cps-sidebar-collapsed', nowCollapsed);
    els.toggleBtn.textContent = nowCollapsed ? '›' : '‹';
    els.toggleBtn.setAttribute('title', nowCollapsed ? 'Open sidebar' : 'Collapse sidebar');
    try { localStorage.setItem(COLLAPSED_KEY, nowCollapsed ? '1' : '0'); } catch (_) {}
  }

  function toggleSection(section) {
    const name = section.dataset.section;
    const nowCollapsed = !section.classList.contains('cps-section-collapsed');
    section.classList.toggle('cps-section-collapsed', nowCollapsed);
    try {
      const state = JSON.parse(localStorage.getItem(SECTION_COLLAPSED_KEY) || '{}');
      state[name] = nowCollapsed;
      localStorage.setItem(SECTION_COLLAPSED_KEY, JSON.stringify(state));
    } catch (_) {}
  }

  function applyPersistedWidth() {
    try {
      const raw = localStorage.getItem(WIDTH_KEY);
      if (!raw) return;
      const w = Number(raw);
      if (Number.isFinite(w)) setWidth(w);
    } catch (_) {}
  }

  function setWidth(w) {
    const clamped = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, w));
    document.documentElement.style.setProperty('--cps-sidebar-width', clamped + 'px');
  }

  function installResizeHandle(handle) {
    if (!handle) return;
    let startX = 0;
    let startWidth = 0;

    const onMove = (e) => {
      const dx = e.clientX - startX;
      setWidth(startWidth + dx);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.documentElement.classList.remove('cps-resizing');
      const current = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cps-sidebar-width'));
      if (Number.isFinite(current)) {
        try { localStorage.setItem(WIDTH_KEY, String(current)); } catch (_) {}
      }
    };

    handle.addEventListener('mousedown', (e) => {
      if (els?.root.classList.contains('cps-collapsed')) return;
      e.preventDefault();
      startX = e.clientX;
      startWidth = els.root.getBoundingClientRect().width;
      document.documentElement.classList.add('cps-resizing');
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    handle.addEventListener('dblclick', () => {
      document.documentElement.style.removeProperty('--cps-sidebar-width');
      try { localStorage.removeItem(WIDTH_KEY); } catch (_) {}
    });
  }

  function applyPersistedCollapse() {
    try {
      if (localStorage.getItem(COLLAPSED_KEY) === '1') {
        els.root.classList.add('cps-collapsed');
        document.documentElement.classList.add('cps-sidebar-collapsed');
        els.toggleBtn.textContent = '›';
        els.toggleBtn.setAttribute('title', 'Open sidebar');
      }
      const state = JSON.parse(localStorage.getItem(SECTION_COLLAPSED_KEY) || '{}');
      Object.entries(state).forEach(([name, collapsed]) => {
        if (collapsed) els.section(name)?.classList.add('cps-section-collapsed');
      });
    } catch (_) {}
  }

  function renderStatus(status, els) {
    if (status === 'broker_offline') {
      els.status.hidden = false;
      els.status.textContent = 'Broker offline. Start it or run the skill again.';
    } else if (status === 'waiting') {
      els.status.hidden = false;
      els.status.textContent = 'Waiting for /x-ray…';
    } else if (status === 'connected') {
      els.status.hidden = true;
    }
  }

  function renderSummary(payload, els) {
    els.status.hidden = true;
    if (payload.why) {
      renderMarkdownInto(els.why, payload.why);
      els.section('why').hidden = false;
    }
    if (Array.isArray(payload.review_order) && payload.review_order.length) {
      els.order.innerHTML = '';
      reviewState.files = payload.review_order.map((it) => it.file);
      reviewState.index = -1;
      payload.review_order.forEach((item, idx) => {
        const li = document.createElement('li');
        li.dataset.reviewIndex = String(idx);
        li.appendChild(fileLink(item.file, null, () => goToReviewIndex(idx)));
        if (item.rationale) {
          const r = document.createElement('div');
          r.className = 'cps-rationale';
          renderMarkdownInto(r, item.rationale);
          li.appendChild(r);
        }
        els.order.appendChild(li);
      });
      els.section('order').hidden = false;
    }
  }

  function renderFindings(payload, els) {
    const items = Array.isArray(payload?.findings) ? payload.findings : [];
    els.findings.innerHTML = '';

    const groups = [
      { severity: 'critical', label: '⚠️ Critical', className: 'cps-finding-group-critical' },
      { severity: 'other',    label: '🟠 Other',    className: 'cps-finding-group-other' },
      { severity: 'general',  label: '🗒️ General',  className: 'cps-finding-group-general' },
    ];

    const bySeverity = { critical: [], other: [], general: [] };
    for (const f of items) {
      const key = bySeverity[f.severity] ? f.severity : 'other';
      bySeverity[key].push(f);
    }

    for (const group of groups) {
      const groupItems = bySeverity[group.severity];

      const groupEl = document.createElement('div');
      groupEl.className = `cps-finding-group ${group.className}`;

      const header = document.createElement('div');
      header.className = 'cps-finding-group-header';
      header.textContent = `${group.label} (${groupItems.length})`;
      groupEl.appendChild(header);

      for (const f of groupItems) {
        const div = document.createElement('div');
        div.className = 'cps-finding';
        div.dataset.severity = group.severity;
        if (f.file) {
          const activate = () => activateFinding(div, f.file, group.severity);
          div.appendChild(fileLink(f.file, f.line, activate));
          if (onFilesTab()) {
            div.classList.add('cps-finding-clickable');
            div.setAttribute('role', 'button');
            div.setAttribute('tabindex', '0');
            div.addEventListener('click', activate);
            div.addEventListener('keydown', (e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
            });
          }
        }
        const summary = document.createElement('div');
        summary.className = 'cps-finding-summary';
        renderMarkdownInto(summary, f.short_summary || f.summary || '');
        div.appendChild(summary);
        if (f.failure_scenario) {
          const fs = document.createElement('div');
          fs.className = 'cps-finding-scenario';
          renderMarkdownInto(fs, f.failure_scenario);
          div.appendChild(fs);
        }
        groupEl.appendChild(div);
      }

      els.findings.appendChild(groupEl);
    }
  }

  function onFilesTab() {
    return /\/pull\/\d+\/changes(\/|$|\?|#)/.test(window.location.pathname + window.location.search + window.location.hash);
  }

  function fileLink(filepath, line, onActivate) {
    const el = document.createElement('code');
    el.textContent = line ? `${filepath}:${line}` : filepath;
    if (!onFilesTab()) return el;

    el.className = 'cps-file-link';
    el.setAttribute('role', 'link');
    el.setAttribute('tabindex', '0');
    el.title = 'Scroll to this file';
    const activate = onActivate || (() => scrollToFile(filepath));
    el.addEventListener('click', (e) => { e.stopPropagation(); activate(); });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); activate(); }
    });
    return el;
  }

  function installKeyboardNavigation() {
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (e.key !== ']' && e.key !== '[') return;
      if (!onFilesTab()) return;
      if (!reviewState.files.length) return;
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
      e.preventDefault();
      e.stopPropagation();
      navigateReview(e.key === ']' ? 1 : -1);
    }, true);
  }

  function navigateReview(step) {
    const len = reviewState.files.length;
    if (!len) return;
    let next;
    if (reviewState.index < 0) {
      next = step > 0 ? 0 : len - 1;
    } else {
      next = Math.min(len - 1, Math.max(0, reviewState.index + step));
    }
    goToReviewIndex(next);
  }

  function activateFinding(findingEl, filepath, severity) {
    els.findings.querySelectorAll('.cps-finding.cps-current-finding').forEach((el) => {
      if (el !== findingEl) el.classList.remove('cps-current-finding');
    });
    findingEl.classList.add('cps-current-finding');

    document.querySelectorAll('.cps-current-finding-file').forEach((el) => {
      el.classList.remove('cps-current-finding-file');
      el.removeAttribute('data-cps-severity');
    });
    const target = findFileElement(filepath);
    if (target) {
      target.classList.add('cps-current-finding-file');
      target.setAttribute('data-cps-severity', severity || 'other');
    }
    scrollToFile(filepath);
  }

  function goToReviewIndex(i) {
    const filepath = reviewState.files[i];
    if (!filepath) return;
    reviewState.index = i;

    els.section('order')?.classList.remove('cps-section-collapsed');

    let currentLi = null;
    els.order.querySelectorAll('li').forEach((li) => {
      const isCurrent = Number(li.dataset.reviewIndex) === i;
      li.classList.toggle('cps-current', isCurrent);
      if (isCurrent) currentLi = li;
    });
    scrollSidebarTo(currentLi);

    document.querySelectorAll('.cps-current-file').forEach((el) => el.classList.remove('cps-current-file'));
    const target = findFileElement(filepath);
    if (target) target.classList.add('cps-current-file');
    const found = scrollToFile(filepath);
    if (currentLi) {
      currentLi.classList.toggle('cps-missing', !found);
      currentLi.title = found ? '' : `File not on page: ${filepath}`;
    }
  }

  function scrollSidebarTo(li) {
    if (!li) return;
    const body = els.root.querySelector('.cps-body');
    if (!body) return;
    const delta = li.getBoundingClientRect().top - body.getBoundingClientRect().top - 8;
    body.scrollTo({ top: body.scrollTop + delta, behavior: 'smooth' });
  }

  function stripLTR(s) {
    return (s || '').replace(/‎/g, '').trim();
  }

  function findFileElement(filepath) {
    const escaped = filepath.replace(/["\\]/g, '\\$&');
    const table = document.querySelector(`table[aria-label="Diff for: ${escaped}"]`);
    if (table) {
      return table.closest('[class*="diffEntry"]')
          || table.closest('[id^="diff-"]')
          || table;
    }
    for (const a of document.querySelectorAll('a[href^="#diff-"]')) {
      if (stripLTR(a.textContent) === filepath) {
        return a.closest('[class*="diffEntry"]')
            || a.closest('[id^="diff-"]')
            || a;
      }
    }
    const attrs = ['data-tagsearch-path', 'data-file-path', 'data-file-user-path', 'data-path'];
    for (const attr of attrs) {
      const el = document.querySelector(`[${attr}="${escaped}"]`);
      if (el) return el;
    }
    return null;
  }

  function scrollToFile(filepath) {
    const target = findFileElement(filepath);
    if (!target) {
      console.warn('[claude-pr-sidebar] could not locate file element for', filepath);
      return false;
    }
    const STICKY_OFFSET = 80;
    const top = target.getBoundingClientRect().top + window.scrollY - STICKY_OFFSET;
    window.scrollTo({ top, behavior: 'smooth' });
    if (!target.classList.contains('cps-current-file') && !target.classList.contains('cps-current-finding-file')) {
      target.style.transition = 'outline 0.6s ease';
      target.style.outline = '2px solid var(--fgColor-accent, #0969da)';
      setTimeout(() => { target.style.outline = 'none'; }, 900);
    }
    return true;
  }

  function configureMarkdownLibs() {
    if (typeof marked !== 'undefined' && typeof marked.setOptions === 'function') {
      marked.setOptions({ gfm: true, breaks: true });
    }
    if (typeof DOMPurify !== 'undefined' && typeof DOMPurify.addHook === 'function' && !DOMPurify.__cpsHookInstalled) {
      DOMPurify.addHook('afterSanitizeAttributes', (node) => {
        if (node.tagName === 'A') {
          node.setAttribute('target', '_blank');
          node.setAttribute('rel', 'noopener noreferrer');
        }
      });
      DOMPurify.__cpsHookInstalled = true;
    }
  }

  function renderMarkdownInto(el, text) {
    el.replaceChildren();
    if (text == null) return;
    const s = String(text);
    if (!s) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'cps-md';
    if (typeof marked === 'undefined' || typeof DOMPurify === 'undefined') {
      wrapper.textContent = s;
    } else {
      const html = marked.parse(s);
      wrapper.innerHTML = DOMPurify.sanitize(html);
    }
    el.appendChild(wrapper);
  }
})();
