// ==UserScript==
// @name         GitHub Actions Workflow Filter
// @namespace    https://github.com/
// @version      0.1.1
// @description  Adds a filter box to the workflows sidebar on GitHub Actions pages
// @updateURL    https://raw.githubusercontent.com/waterfausett/gh-toolkit/master/gh-actions-workflow-filter.user.js
// @downloadURL  https://raw.githubusercontent.com/waterfausett/gh-toolkit/master/gh-actions-workflow-filter.user.js
// @match        https://github.com/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(() => {
  'use strict';

  const INPUT_ID = 'tm-workflow-filter';
  const COUNT_ID = 'tm-workflow-filter-count';
  const STORAGE_KEY = 'workflowFilter';

  const isActionsPage = () => /^\/[^/]+\/[^/]+\/actions(\/|$)/.test(location.pathname);

  const findSidebar = () =>
    document.querySelector('nav[aria-label*="workflows" i]') ||
    document.querySelector('a[href*="/actions/workflows/"]')?.closest('nav');

  const workflowItems = (sidebar) =>
    [...sidebar.querySelectorAll('a[href*="/actions/workflows/"]')]
      .map((link) => link.closest('li'))
      .filter(Boolean);

  const expandCollapsedList = (sidebar) => {
    const showMore = [...sidebar.querySelectorAll('button')].find((b) =>
      /show more/i.test(b.textContent),
    );
    showMore?.click();
  };

  const applyFilter = (sidebar, query) => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length) expandCollapsedList(sidebar);

    const items = workflowItems(sidebar);
    let visible = 0;
    for (const item of items) {
      const text = item.textContent.toLowerCase();
      const match = terms.every((term) => text.includes(term));
      item.style.display = match ? '' : 'none';
      if (match) visible += 1;
    }

    const count = document.getElementById(COUNT_ID);
    if (count) count.textContent = terms.length ? `${visible} of ${items.length}` : '';
  };

  const readSavedQuery = () => {
    try {
      return GM_getValue(STORAGE_KEY, '');
    } catch {
      return '';
    }
  };

  const saveQuery = (query) => {
    try {
      GM_setValue(STORAGE_KEY, query);
    } catch {
      // Persistence is a convenience; filtering works without it.
    }
  };

  const buildControls = (sidebar) => {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'padding: 4px 8px 8px;';

    const field = document.createElement('div');
    field.style.cssText = 'position: relative;';

    const input = document.createElement('input');
    input.id = INPUT_ID;
    input.type = 'text';
    input.placeholder = 'Filter workflows…';
    input.autocomplete = 'off';
    input.className = 'form-control input-sm';
    input.style.cssText = 'width: 100%; padding-right: 28px;';
    input.value = readSavedQuery();

    const clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.setAttribute('aria-label', 'Clear filter');
    clearButton.textContent = '✕';
    clearButton.className = 'btn-octicon color-fg-muted';
    clearButton.style.cssText =
      'position: absolute; right: 4px; top: 50%; transform: translateY(-50%); line-height: 1;';

    const count = document.createElement('div');
    count.id = COUNT_ID;
    count.className = 'color-fg-muted text-small';
    count.style.cssText = 'margin-top: 4px;';

    const update = () => {
      clearButton.style.display = input.value ? '' : 'none';
      saveQuery(input.value);
      applyFilter(sidebar, input.value);
    };
    const clear = () => {
      input.value = '';
      update();
      input.focus();
    };

    input.addEventListener('input', update);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') clear();
    });
    clearButton.addEventListener('click', clear);
    clearButton.style.display = input.value ? '' : 'none';

    field.append(input, clearButton);
    wrapper.append(field, count);
    return { wrapper, input };
  };

  const ensureControls = () => {
    if (!isActionsPage()) return;
    const sidebar = findSidebar();
    if (!sidebar) return;

    const existing = document.getElementById(INPUT_ID);
    if (existing && sidebar.contains(existing)) {
      applyFilter(sidebar, existing.value);
      return;
    }

    const { wrapper, input } = buildControls(sidebar);
    const list = sidebar.querySelector('ul');
    if (list) list.before(wrapper);
    else sidebar.prepend(wrapper);
    applyFilter(sidebar, input.value);
  };

  // GitHub navigates via Turbo/React without full page loads, so the sidebar
  // is re-rendered underneath us and the controls must be re-injected.
  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      ensureControls();
    });
  }).observe(document.body, { childList: true, subtree: true });

  ensureControls();
})();
