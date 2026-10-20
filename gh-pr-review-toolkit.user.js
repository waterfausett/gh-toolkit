// ==UserScript==
// @name         GitHub PR Review Toolkit
// @namespace    https://github.com/waterfausett
// @version      0.10.6
// @description  Viewed-state across pushes, thread navigation, noise hiding, ownership, ticket chips, snippets and stats panel for GitHub PRs.
// @updateURL    https://raw.githubusercontent.com/waterfausett/gh-toolkit/master/gh-pr-review-toolkit.user.js
// @downloadURL  https://raw.githubusercontent.com/waterfausett/gh-toolkit/master/gh-pr-review-toolkit.user.js
// @match        https://github.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      github.com
// @connect      raw.githubusercontent.com
// @connect      patch-diff.githubusercontent.com
// @run-at       document-idle
// ==/UserScript==

(() => {
  "use strict";

  const DEFAULTS = {
    features: {
      nav: true,
      ownership: true,
      collapseGenerated: true,
      collapseTests: true,
      dimTestsInTree: true,
      whitespace: false,
      viewedAcrossPushes: true,
      threads: true,
      hideNoise: true,
      snippets: true,
      tickets: true,
      stats: true,
      changedFilter: true,
      nextUnviewed: true,
      copyPermalink: true,
      checksTab: false,
      reviewButton: true,
      pendingReviewGuard: true,
      sinceLastLook: true,
    },
    snippets: {
      nit: "nit: ",
      q: "question: ",
      block: "blocking: ",
      thought: "thought: ",
      lgtm: "LGTM 🚢",
      test: "Can we add a test covering this?",
      why: "Could you add a note on why this is needed?",
    },
    ticketRules: [
      { pattern: "\\bAB#\\d+\\b", url: "", ado: true },
      { pattern: "\\b[A-Z][A-Z0-9]{1,9}-\\d+\\b", url: "https://linear.app/issue/{id}", branchIgnoreCase: true },
    ],
    ticketIgnorePrefixes: [
      "utf", "sha", "iso", "cve", "rfc", "http", "tls", "ssl", "aes", "rsa", "gpt", "pep", "md",
      "fix", "bug", "pr", "rc", "wip", "step", "task", "issue", "test", "node", "py", "v",
      "feature", "feat", "hotfix", "bugfix", "release", "chore", "refactor", "version", "ticket", "story",
    ],
    generatedPatterns: [
      "(^|/)(package-lock\\.json|uv\\.lock|poetry\\.lock|yarn\\.lock|pnpm-lock\\.yaml)$",
      "(^|/)__snapshots__/",
      "\\.snap$",
      "\\.min\\.(js|css)$",
      "(^|/)dist/",
    ],
    adoBase: "",
    myOwners: [],
    minePatterns: [],
  };

  const FEATURE_GROUPS = [
    {
      title: "Navigation",
      features: [
        { key: "nav", label: "Always-visible tab nav", hint: "Alt+1–4" },
        { key: "threads", label: "Unresolved thread navigator", hint: "Alt+J / Alt+K" },
        { key: "nextUnviewed", label: "Jump to next / previous unviewed file", hint: "Alt+N / Alt+Shift+N" },
        { key: "changedFilter", label: "\"Changed since viewed\" in the file filter" },
        { key: "reviewButton", label: "Review button", hint: "Alt+R", note: "Opens GitHub's review dialog, going to Files first if needed" },
      ],
    },
    {
      title: "Files",
      features: [
        { key: "ownership", label: "Mark files owned by others in the file tree", note: "Uses CODEOWNERS" },
        { key: "collapseGenerated", label: "Collapse generated files" },
        { key: "collapseTests", label: "Collapse test files" },
        { key: "dimTestsInTree", label: "Dim test files in the file tree" },
        { key: "whitespace", label: "Open files tab with whitespace hidden" },
        { key: "viewedAcrossPushes", label: "Viewed-state across pushes" },
        { key: "copyPermalink", label: "Copy selected lines as a quote with link", hint: "Alt+C" },
        { key: "sinceLastLook", label: "New commits since your last look", note: "Your last look is when you last marked a file Viewed" },
      ],
    },
    {
      title: "Comments",
      features: [
        { key: "hideNoise", label: "Hide bot comments" },
        { key: "snippets", label: "Snippet expander", hint: ";trigger + space" },
        { key: "tickets", label: "Ticket chips" },
        { key: "pendingReviewGuard", label: "Warn before leaving with an unsubmitted review", note: "Only when your pending review has comments" },
      ],
    },
    {
      title: "Panel",
      features: [
        { key: "stats", label: "Change stats" },
        { key: "checksTab", label: "Checks nav item opens the Checks tab", note: "Off: scrolls to the checks summary on Conversation" },
      ],
    },
  ];

  const store = {
    get: (key, fallback) => {
      const value = GM_getValue(key);
      return value === undefined ? fallback : value;
    },
    set: (key, value) => GM_setValue(key, value),
  };

  const cyrb53 = (text) => {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ code, 2654435761);
      h2 = Math.imul(h2 ^ code, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  };

  const storageSalt = (() => {
    let salt = store.get("salt");
    if (!salt) {
      salt = crypto.randomUUID();
      store.set("salt", salt);
    }
    return salt;
  })();

  // Synchronous because every caller sits in the render path; SubtleCrypto is async-only.
  const digest = (text) => cyrb53(`${storageSalt}:${text}`);

  const DAY_MS = 24 * 60 * 60 * 1000;
  const PR_RETENTION_MS = 90 * DAY_MS;

  const touchPr = (id) => {
    const lastSeen = store.get("prLastSeen", {});
    if (Date.now() - (lastSeen[id] ?? 0) < DAY_MS) return;
    store.set("prLastSeen", { ...lastSeen, [id]: Date.now() });
  };

  const pruneStalePrs = () => {
    const now = Date.now();
    if (now - store.get("lastPrunedAt", 0) < DAY_MS) return;
    const lastSeen = store.get("prLastSeen", {});
    for (const [id, seenAt] of Object.entries(lastSeen)) {
      if (now - seenAt < PR_RETENTION_MS) continue;
      GM_deleteValue(`v3:viewed:${id}`);
      GM_deleteValue(`v3:changedFilter:${id}`);
      GM_deleteValue(`v3:lastLook:${id}`);
      delete lastSeen[id];
    }
    store.set("prLastSeen", lastSeen);
    store.set("lastPrunedAt", now);
  };

  const migrateLegacyKeys = () => {
    const LEGACY_VIEWED = "viewed:v2:";
    const LEGACY_FILTER = "changedFilter:";
    for (const key of GM_listValues()) {
      if (key.startsWith(LEGACY_VIEWED)) {
        const records = Object.fromEntries(
          Object.entries(GM_getValue(key) ?? {}).map(([path, sha]) => [digest(path), sha]),
        );
        const id = digest(key.slice(LEGACY_VIEWED.length));
        store.set(`v3:viewed:${id}`, records);
        touchPr(id);
      } else if (key.startsWith(LEGACY_FILTER)) {
        const id = digest(key.slice(LEGACY_FILTER.length));
        store.set(`v3:changedFilter:${id}`, GM_getValue(key));
        touchPr(id);
      } else {
        continue;
      }
      GM_deleteValue(key);
    }
  };
  migrateLegacyKeys();
  pruneStalePrs();

  const loadConfig = () => {
    const saved = store.get("config", {});
    return { ...DEFAULTS, ...saved, features: { ...DEFAULTS.features, ...saved.features } };
  };
  let config = loadConfig();
  const saveConfig = () => {
    const overrides = Object.fromEntries(
      Object.entries(config).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(DEFAULTS[key])),
    );
    store.set("config", overrides);
  };

  const h = (tag, props = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === "class") el.className = value;
      else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
      else if (value !== false && value != null) el.setAttribute(key, value === true ? "" : value);
    }
    el.append(...kids.flat().filter((kid) => kid != null && kid !== false));
    return el;
  };

  const debounce = (fn, ms) => {
    let timer;
    return () => {
      clearTimeout(timer);
      timer = setTimeout(fn, ms);
    };
  };

  const FILES_PATH = /\/(files|changes)(\/|$)/;

  const prContext = () => {
    const m = location.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (!m) return null;
    const [, owner, repo, number] = m;
    return { owner, repo, number: Number(number), key: `${owner}/${repo}#${number}` };
  };

  const fetchText = (url, headers = {}) =>
    new Promise((resolve) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        headers,
        onload: (res) => resolve(res.status < 300 ? res.responseText : null),
        onerror: () => resolve(null),
        ontimeout: () => resolve(null),
      });
    });

  const parseDiff = (text) => {
    const files = [];
    let current = null;
    let inHunk = false;
    for (const line of text.split("\n")) {
      if (line.startsWith("diff --git ")) {
        const m = line.match(/^diff --git a\/(.+) b\/(.+)$/);
        current = { filename: m ? m[2] : line.slice(11), sha: "", additions: 0, deletions: 0 };
        files.push(current);
        inHunk = false;
      } else if (!current) {
        continue;
      } else if (line.startsWith("@@")) {
        inHunk = true;
      } else if (!inHunk && line.startsWith("index ")) {
        current.sha = line.match(/\.\.([0-9a-f]+)/)?.[1]?.slice(0, 7) ?? "";
      } else if (inHunk && line.startsWith("+")) {
        current.additions += 1;
      } else if (inHunk && line.startsWith("-")) {
        current.deletions += 1;
      }
    }
    return files;
  };

  // .patch skips merge commits, so the head comes from the commits route instead: JSON when asked for it, else the page's embedded copy.
  const commitsRoute = (text) => {
    try {
      return JSON.parse(text).payload?.pullRequestsCommitsRoute;
    } catch {}
    for (const [, json] of text.matchAll(/<script type="application\/json" data-target="react-app\.embeddedData">([\s\S]*?)<\/script>/g)) {
      try {
        const route = JSON.parse(json).payload?.pullRequestsCommitsRoute;
        if (route) return route;
      } catch {}
    }
    return null;
  };

  // The live-update channel name embeds the head SHA; a mismatch means the commit list is partial.
  const channelSha = (channel) => {
    try {
      return JSON.parse(atob(channel.split("--")[0])).c.match(/:commit:([0-9a-f]{40})$/)?.[1] ?? null;
    } catch {
      return null;
    }
  };

  const parseCommitOids = (text) => {
    const route = text ? commitsRoute(text) : null;
    if (!route || route.truncated) return null;
    const oids = (route.commitGroups ?? [])
      .flatMap((group) => group.commits ?? [])
      .map((commit) => commit.oid)
      .filter((oid) => /^[0-9a-f]{40}$/.test(oid ?? ""));
    const head = channelSha(route.metadata?.commitHeadShaChannel ?? "");
    return oids.length && (!head || head === oids.at(-1)) ? oids : null;
  };

  const loadCommitOids = async (pr) =>
    parseCommitOids(
      await fetchText(`https://github.com/${pr.owner}/${pr.repo}/pull/${pr.number}/commits`, {
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest",
        "GitHub-Verified-Fetch": "true",
      }),
    );

  const state = {
    pr: null,
    files: null,
    shas: new Map(),
    codeowners: null,
    hashToPath: new Map(),
    version: 0,
    loadedAt: 0,
    commitOids: null,
  };
  const userExpanded = new Set();
  let panelOpen = store.get("panelOpen", true);
  let lastSignature = "";
  let threadCursor = -1;

  const codeownersRegex = (pattern) => {
    const anchored = pattern.startsWith("/") || pattern.slice(0, -1).includes("/");
    const body = pattern.replace(/^\//, "").replace(/\/$/, "");
    let source = "";
    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (c === "*" && body[i + 1] === "*") {
        i += 1;
        if (body[i + 1] === "/") {
          i += 1;
          source += "(?:.*/)?";
        } else {
          source += ".*";
        }
      } else if (c === "*") source += "[^/]*";
      else if (c === "?") source += "[^/]";
      else source += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
    return new RegExp(`^${anchored ? "" : "(?:.*/)?"}${source}(?:/.*)?$`);
  };

  const parseCodeowners = (text) =>
    text
      .split("\n")
      .map((line) => line.replace(/#.*$/, "").trim())
      .filter(Boolean)
      .map((line) => {
        const [pattern, ...owners] = line.split(/\s+/);
        return { re: codeownersRegex(pattern), owners: owners.map((o) => o.toLowerCase().replace(/^@/, "")) };
      });

  const loadCodeowners = async (pr) => {
    for (const path of [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"]) {
      const text = await fetchText(`https://github.com/${pr.owner}/${pr.repo}/raw/HEAD/${path}`);
      if (text && !/^\s*</.test(text)) return parseCodeowners(text);
    }
    return null;
  };

  const sha256Hex = async (text) => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  };

  const loadData = async (pr) => {
    const [diffText, codeowners, commitOids] = await Promise.all([
      fetchText(`https://github.com/${pr.owner}/${pr.repo}/pull/${pr.number}.diff`),
      loadCodeowners(pr),
      config.features.sinceLastLook ? loadCommitOids(pr) : null,
    ]);
    const files = diffText?.startsWith("diff --git") ? parseDiff(diffText) : null;
    const hashToPath = new Map(
      await Promise.all((files ?? []).map(async (f) => [`diff-${await sha256Hex(f.filename)}`, f.filename])),
    );
    if (state.pr?.key !== pr.key) return;
    Object.assign(state, {
      hashToPath,
      files,
      codeowners,
      shas: new Map((files ?? []).map((f) => [f.filename, f.sha])),
      version: state.version + 1,
      loadedAt: Date.now(),
      commitOids,
    });
    applyChangedFilter();
    renderPanel(true);
  };

  const resetState = (pr) => {
    Object.assign(state, {
      pr,
      files: null,
      shas: new Map(),
      codeowners: null,
      hashToPath: new Map(),
      loadedAt: 0,
      version: state.version + 1,
      commitOids: null,
    });
    userExpanded.clear();
    threadCursor = -1;
    applyNoiseDefault();
  };

  const CLASSIC_FILE_SEL = "div.file[data-tagsearch-path]";
  const VIEWED_CONTROL_SEL = [
    "input.js-reviewed-checkbox",
    "input[type='checkbox'][name='viewed']",
    "input[type='checkbox'][aria-label*='viewed' i]",
    "button[aria-pressed][aria-label*='viewed' i]",
  ].join(", ");

  const isViewed = (control) =>
    control.matches("input") ? control.checked : control.getAttribute("aria-pressed") === "true";

  // The newer diff's Viewed button flips aria-pressed after its click handler runs, so the new state is observed rather than read on click.
  const onViewedChange = (control, callback) => {
    if (control.matches("input")) {
      control.addEventListener("change", callback);
      return;
    }
    control.addEventListener("click", () => {
      const observer = new MutationObserver(callback);
      observer.observe(control, { attributes: true, attributeFilter: ["aria-pressed"] });
      setTimeout(() => observer.disconnect(), 5000);
    });
  };

  const distinctPaths = (el) =>
    new Set([...el.querySelectorAll("[data-file-path]")].map((node) => node.dataset.filePath)).size;

  const fileContainer = (anchor) => {
    let best = null;
    for (let el = anchor.closest("[id^='diff-']"); el; el = el.parentElement?.closest("[id^='diff-']")) {
      if (distinctPaths(el) === 1) best = el;
    }
    if (best) return best;
    let el = anchor.parentElement;
    for (let depth = 0; depth < 6 && el.parentElement && distinctPaths(el.parentElement) === 1; depth++) {
      el = el.parentElement;
    }
    return el;
  };

  const CHEVRON_SEL =
    "button[aria-expanded], button:has(svg.octicon-chevron-down), button:has(svg.octicon-chevron-right)";

  const FILE_ID = /^diff-[0-9a-f]{64}$/;
  const domPaths = new Map();
  const pendingIds = new Set();
  const attempts = new Map();

  const pathCandidates = (el) => {
    const candidates = new Set();
    for (const node of [...el.querySelectorAll("*")].slice(0, 60)) {
      const raws = [
        node.children.length ? "" : node.textContent,
        node.getAttribute("aria-label"),
        node.getAttribute("title"),
        node.dataset.path,
        node.dataset.filePath,
      ];
      for (const raw of raws) {
        const text = raw?.replace(/[\u200e\u200f\u202a-\u202e]/g, "").trim();
        if (!text || text.length > 500) continue;
        candidates.add(text);
        const afterColon = text.split(": ").slice(1).join(": ");
        if (afterColon) candidates.add(afterColon);
      }
    }
    return [...candidates];
  };

  const resolveDomPaths = () => {
    for (const el of document.querySelectorAll("[id^='diff-']")) {
      const { id } = el;
      if (!FILE_ID.test(id) || domPaths.has(id) || pendingIds.has(id) || state.hashToPath.has(id)) continue;
      if ((attempts.get(id) ?? 0) >= 3 || !el.querySelector(CHEVRON_SEL)) continue;
      attempts.set(id, (attempts.get(id) ?? 0) + 1);
      pendingIds.add(id);
      (async () => {
        for (const candidate of pathCandidates(el)) {
          if (`diff-${await sha256Hex(candidate)}` === id) {
            domPaths.set(id, candidate);
            break;
          }
        }
        pendingIds.delete(id);
        if (domPaths.has(id)) scan();
      })();
    }
  };

  const fileEntries = () => {
    const entries = new Map();
    for (const el of document.querySelectorAll(CLASSIC_FILE_SEL)) {
      const header = el.querySelector(".file-header");
      entries.set(el, { el, path: el.dataset.tagsearchPath, actions: header?.querySelector(".file-actions") ?? header });
    }
    for (const anchor of document.querySelectorAll("[data-file-path]")) {
      const el = fileContainer(anchor);
      if (el && !entries.has(el)) entries.set(el, { el, path: anchor.dataset.filePath, actions: anchor.parentElement });
    }
    for (const [id, path] of new Map([...domPaths, ...state.hashToPath])) {
      const el = document.getElementById(id);
      const actions = el?.querySelector(CHEVRON_SEL)?.parentElement;
      if (el && actions && !entries.has(el)) entries.set(el, { el, path, actions });
    }
    return [...entries.values()].filter((entry) => entry.path && entry.actions);
  };
  const findFileEl = (path) => fileEntries().find((entry) => entry.path === path)?.el;

  const isGenerated = (path) => config.generatedPatterns.some((p) => new RegExp(p).test(path));

  const categoryOf = (path) => {
    if (isGenerated(path)) return "generated";
    if (/(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[jt]sx?$|_test\.py$|(^|\/)test_[^/]*\.py$/.test(path)) return "tests";
    if (/^docs\/|\.mdx?$/.test(path)) return "docs";
    if (/^\.github\/|Dockerfile|\.ya?ml$|\.toml$|\.json$|\.tf$|(^|\/)(infra|helm)\//.test(path)) return "config";
    return "source";
  };

  const knownPaths = () => (state.files ? state.files.map((f) => f.filename) : fileEntries().map((entry) => entry.path));

  const myOwnerSet = () =>
    new Set(
      [...config.myOwners, document.querySelector("meta[name='user-login']")?.content]
        .filter(Boolean)
        .map((owner) => owner.toLowerCase().replace(/^@/, "")),
    );

  const isMine = (path) => {
    if (config.minePatterns.some((pattern) => new RegExp(pattern).test(path))) return true;
    if (!state.codeowners) return config.minePatterns.length ? false : null;
    const rule = state.codeowners.findLast((r) => r.re.test(path));
    if (!rule) return false;
    const mine = myOwnerSet();
    return rule.owners.some((owner) => mine.has(owner));
  };

  const ownershipMode = () => {
    if (!config.features.ownership) return "off";
    const saved = store.get("ownershipMode", "mark");
    return saved === "hide" ? saved : "mark";
  };

  const viewedKey = () => `v3:viewed:${digest(state.pr.key)}`;
  const viewedRecords = () => store.get(viewedKey(), {});

  const lastLookKey = () => `v3:lastLook:${digest(state.pr.key)}`;

  const recordLastLook = () => {
    const head = state.commitOids?.at(-1);
    if (head) store.set(lastLookKey(), head);
  };

  const sinceLastLook = () => {
    const oids = state.commitOids;
    const seen = config.features.sinceLastLook && state.pr && oids ? store.get(lastLookKey(), "") : "";
    if (!seen || seen === oids.at(-1)) return null;
    const index = oids.indexOf(seen);
    return { seen, head: oids.at(-1), count: oids.length - 1 - index, rewritten: index < 0 };
  };

  // A force-pushed SHA is no longer in the PR, so GitHub's PR range view 404s; a plain compare still renders.
  const lastLookHref = ({ seen, head, rewritten }) => {
    const { owner, repo, number } = state.pr;
    return rewritten ? `/${owner}/${repo}/compare/${seen}..${head}` : `/${owner}/${repo}/pull/${number}/files/${seen}..${head}`;
  };

  const badge = (text, tone) => h("span", { class: `prr-badge prr-${tone}` }, text);

  const setCollapsed = ({ el, actions }, collapsed) => {
    for (const child of el.children) child.classList.toggle("prr-body-hidden", collapsed && !child.contains(actions));
  };

  const findChevron = ({ el }) => el.querySelector(CHEVRON_SEL);

  const isChevronExpanded = (btn) =>
    btn.hasAttribute("aria-expanded")
      ? btn.getAttribute("aria-expanded") === "true"
      : Boolean(btn.querySelector("svg.octicon-chevron-down"));

  let clickingChevron = false;

  const collapseNatively = (chevron, path) => {
    if (!chevron.dataset.prrBound) {
      chevron.dataset.prrBound = "1";
      chevron.addEventListener("click", () => {
        if (clickingChevron) return;
        if (isChevronExpanded(chevron)) userExpanded.delete(path);
        else userExpanded.add(path);
      });
    }
    if (isChevronExpanded(chevron) && !userExpanded.has(path)) {
      clickingChevron = true;
      chevron.click();
      clickingChevron = false;
    }
  };

  const processFile = (entry) => {
    const { el, path, actions } = entry;
    if (el.dataset.prrVersion === String(state.version) && actions.querySelector(".prr-marker")) return;
    el.dataset.prrVersion = String(state.version);

    el.querySelectorAll(".prr-badge, .prr-btn, .prr-marker").forEach((node) => node.remove());
    setCollapsed(entry, false);
    actions.prepend(h("span", { class: "prr-marker", hidden: true }));

    const collapseReason =
      (config.features.collapseGenerated && isGenerated(path) && "Generated") ||
      (config.features.collapseTests && categoryOf(path) === "tests" && "Tests");
    if (collapseReason) {
      const chevron = findChevron(entry);
      if (chevron) {
        collapseNatively(chevron, path);
      } else {
        let collapsed = !userExpanded.has(path);
        setCollapsed(entry, collapsed);
        actions.prepend(
          h(
            "button",
            {
              class: "prr-btn",
              type: "button",
              onclick: (e) => {
                e.preventDefault();
                e.stopPropagation();
                collapsed = !collapsed;
                if (collapsed) userExpanded.delete(path);
                else userExpanded.add(path);
                setCollapsed(entry, collapsed);
              },
            },
            `${collapseReason}: toggle`,
          ),
        );
      }
    }

    if (config.features.viewedAcrossPushes) {
      const recorded = viewedRecords()[digest(path)];
      const current = state.shas.get(path);
      if (recorded && current && recorded !== current) {
        actions.prepend(badge("changed since you viewed it", "warn"));
      }
      const control = el.querySelector(VIEWED_CONTROL_SEL);
      if (control && !control.dataset.prrBound) {
        control.dataset.prrBound = "1";
        onViewedChange(control, () => {
          const records = viewedRecords();
          const sha = state.shas.get(path);
          if (isViewed(control) && sha) records[digest(path)] = sha;
          else delete records[digest(path)];
          store.set(viewedKey(), records);
          applyChangedFilter();
          renderPanel(true);
        });
      }
    }

    if (config.features.sinceLastLook) {
      const control = el.querySelector(VIEWED_CONTROL_SEL);
      if (control && !control.dataset.prrLookBound) {
        control.dataset.prrLookBound = "1";
        onViewedChange(control, () => {
          if (!isViewed(control)) return;
          recordLastLook();
          renderPanel(true);
        });
      }
    }
  };

  const treeLabel = (item) => item.querySelector(":scope > div")?.textContent.replace(/\s+/g, " ").trim() ?? "";

  const treePath = (item) => {
    const label = item.getAttribute("aria-label") ?? "";
    if (item.id && label && (item.id === label || item.id.endsWith(`/${label}`))) return item.id;
    const parts = [];
    for (let el = item; el; el = el.parentElement?.closest("[role='treeitem']")) parts.unshift(treeLabel(el));
    return parts.join("/");
  };

  const isTreeFolder = (item) => item.hasAttribute("aria-expanded") || Boolean(item.querySelector(":scope > [role='group']"));

  const setTreeMark = (item, kind, title, marked) => {
    const row = item.querySelector(":scope > div");
    const content = row?.querySelector(":scope > [class*='TreeView-item-content']") ?? row;
    if (!content) return;
    const existing = content.querySelector(`:scope > .prr-tree-dot-${kind}`);
    if (marked && !existing) {
      content.append(h("span", { class: `prr-tree-dot prr-tree-dot-${kind}`, title }));
    } else if (!marked && existing) {
      existing.remove();
    }
  };

  const outsideChangedSet = (path, folder, changedPaths) =>
    folder ? !changedPaths.some((changed) => changed.startsWith(`${path}/`)) : !changedPaths.includes(path);

  const processTree = () => {
    const dimTests = config.features.dimTestsInTree;
    const ownership = ownershipMode();
    const changedPaths = config.features.viewedAcrossPushes && state.pr ? changedSinceViewed() : [];
    const filterByChanged = changedFilterActive();
    for (const item of document.querySelectorAll("[role='tree'] [role='treeitem']")) {
      const folder = isTreeFolder(item);
      const path = dimTests || ownership !== "off" || changedPaths.length ? treePath(item) : "";
      const isTest = dimTests && categoryOf(folder ? `${path}/_` : path) === "tests";
      const notMine = ownership !== "off" && !folder && isMine(path) === false;
      item.classList.toggle("prr-tree-dim", isTest);
      item.classList.toggle("prr-tree-notmine", notMine && ownership === "mark");
      setTreeMark(item, "notmine", "Not mine (CODEOWNERS)", notMine && ownership === "mark");
      setTreeMark(item, "changed", "Changed since you viewed it", !folder && changedPaths.includes(path));
      item.classList.toggle(
        "prr-tree-hide",
        (notMine && ownership === "hide") || (filterByChanged && outsideChangedSet(path, folder, changedPaths)),
      );
    }
  };

  const isBotAuthor = (item) => {
    const author = item.querySelector("a.author, a[data-hovercard-type='app']");
    const name = author?.textContent?.trim() ?? "";
    return /\[bot\]$/i.test(name) || /^copilot/i.test(name) || author?.getAttribute("href")?.startsWith("/apps/");
  };

  const applyNoiseDefault = () => document.body.classList.toggle("prr-hide-noise", config.features.hideNoise);

  const processNoise = () => {
    for (const item of document.querySelectorAll(".js-timeline-item:not([data-prr-noise])")) {
      item.dataset.prrNoise = "1";
      if (isBotAuthor(item)) item.classList.add("prr-noise");
    }
  };

  const unresolvedThreads = () =>
    [...document.querySelectorAll("[data-resolved='false']")].filter(
      (el) => !el.parentElement?.closest("[data-resolved='false']"),
    );

  const flash = (el) => {
    el.classList.add("prr-flash");
    setTimeout(() => el.classList.remove("prr-flash"), 1500);
  };

  const toast = (message) => {
    document.getElementById("prr-toast")?.remove();
    const el = h("div", { id: "prr-toast" }, message);
    document.body.append(el);
    setTimeout(() => el.remove(), 2000);
  };

  const stepThread = (direction) => {
    const threads = unresolvedThreads();
    if (!threads.length) return;
    threadCursor = (threadCursor + direction + threads.length) % threads.length;
    const target = threads[threadCursor];
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    flash(target);
  };

  const findChecksHeading = () =>
    [...document.querySelectorAll("h2, h3")].find(
      (el) => el.textContent.length < 80 && /\bchecks?\b/i.test(el.textContent) && !el.closest(".timeline-comment, .js-comment") && el.getClientRects().length,
    );

  const JUMP_WAIT_MS = 10_000;

  const onConversationTab = () => currentTab()?.suffix === "";

  // No trailing \b: the newer Files view renders a long and a short label in the same button ("Submit reviewReview") and hides one with CSS.
  const REVIEW_LABEL = /^(review changes|submit review|finish (your )?review)/i;

  // The dialog's own "Submit review" button shares the label, so anything inside a form or dialog is skipped: we only ever open the dialog, never submit it.
  const findReviewButton = () =>
    [...document.querySelectorAll("summary, button")].find(
      (el) =>
        !el.closest("#prr-panel, form, dialog, [role='dialog'], details-dialog") &&
        el.getAttribute("type") !== "submit" &&
        (/\bReviewMenuButton__/.test(el.className) ||
          REVIEW_LABEL.test((el.getAttribute("aria-label") || el.textContent).replace(/\s+/g, " ").trim())) &&
        el.getClientRects().length,
    );

  const CHECKS_VIEWPORT_OFFSET = 0.3;
  const CHECKS_SETTLE_MS = 2500;
  const CHECKS_SETTLE_TOLERANCE_PX = 4;
  const USER_SCROLL_EVENTS = ["wheel", "touchstart", "keydown", "mousedown"];

  // Lazy timeline content and GitHub's own scroll restoration move the merge box after we land, so the position is re-applied until it stops drifting or the user takes over.
  const scrollToChecks = (heading) => {
    const topOffset = () => window.innerHeight * CHECKS_VIEWPORT_OFFSET;
    const drift = () => heading.getBoundingClientRect().top - topOffset();
    heading.scrollIntoView({ block: "start", behavior: "auto" });
    scrollBy({ top: drift(), behavior: "auto" });
    flash(heading.closest("section, .merge-status-list, li, div") ?? heading);

    const stop = () => {
      clearInterval(timer);
      USER_SCROLL_EVENTS.forEach((type) => removeEventListener(type, stop, true));
    };
    const timer = setInterval(() => {
      if (!heading.isConnected) return stop();
      if (Math.abs(drift()) > CHECKS_SETTLE_TOLERANCE_PX) scrollBy({ top: drift(), behavior: "auto" });
    }, 100);
    setTimeout(stop, CHECKS_SETTLE_MS);
    USER_SCROLL_EVENTS.forEach((type) => addEventListener(type, stop, { capture: true, once: true }));
  };

  // A jump goes to a tab, waits for something on it to render, then acts on it.
  const JUMPS = {
    checks: {
      key: "prr-jump-checks",
      here: onConversationTab,
      href: () => tabHref(NAV_TABS[0]),
      find: findChecksHeading,
      land: scrollToChecks,
      missing: "Couldn't find the checks section on this page",
    },
    review: {
      key: "prr-jump-review",
      here: () => FILES_PATH.test(location.pathname),
      href: () => tabHref(NAV_TABS[3]),
      find: findReviewButton,
      land: (button) => button.click(),
      missing: "Couldn't find GitHub's review button on this page",
    },
  };

  const clearJump = (jump) => {
    try {
      sessionStorage.removeItem(jump.key);
    } catch {}
  };

  // The target renders after navigation, and the 1.5s full-load fallback in goTo wipes in-memory state, so the pending jump is persisted.
  const awaitJump = (jump, deadline) => {
    const timer = setInterval(() => {
      const target = jump.here() && jump.find();
      if (!target && Date.now() < deadline) return;
      clearInterval(timer);
      clearJump(jump);
      if (target) jump.land(target);
      else toast(jump.missing);
    }, 250);
  };

  const startJump = (jump) => {
    if (jump.here()) {
      const target = jump.find();
      if (target) jump.land(target);
      else toast(jump.missing);
      return;
    }
    const deadline = Date.now() + JUMP_WAIT_MS;
    try {
      sessionStorage.setItem(jump.key, String(deadline));
    } catch {}
    goTo(jump.href());
    awaitJump(jump, deadline);
  };

  const jumpToChecks = () => startJump(JUMPS.checks);

  const openReview = () => startJump(JUMPS.review);

  const resumeJumps = () =>
    Object.values(JUMPS).forEach((jump) => {
      let deadline = 0;
      try {
        deadline = Number(sessionStorage.getItem(jump.key));
      } catch {}
      if (deadline > Date.now()) awaitJump(jump, deadline);
      else clearJump(jump);
    });

  const nextFlaggedIndex = (flags, from, direction) => {
    const count = flags.length;
    for (let step = 1; step <= count; step++) {
      const index = (((from + direction * step) % count) + count) % count;
      if (flags[index]) return index;
    }
    return -1;
  };

  const collapsedByRule = (path) =>
    !userExpanded.has(path) &&
    ((config.features.collapseGenerated && isGenerated(path)) || (config.features.collapseTests && categoryOf(path) === "tests"));

  const isUnviewed = (el) => {
    const control = el.querySelector(VIEWED_CONTROL_SEL);
    return Boolean(control) && !isViewed(control);
  };

  // Sticky headers keep a file's top edge below 0 after scrollIntoView, so "current" tolerates that offset.
  const CURRENT_FILE_TOLERANCE_PX = 80;

  const stepUnviewed = (direction) => {
    const rendered = fileEntries().filter(({ el }) => el.getClientRects().length);
    // fileEntries can return a wrapper around several files; only the innermost entries are single files.
    const entries = rendered
      .filter(({ el }) => !rendered.some((other) => other.el !== el && el.contains(other.el)))
      .sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    const current = entries.findLastIndex(({ el }) => el.getBoundingClientRect().top <= CURRENT_FILE_TOLERANCE_PX);
    const flags = entries.map(({ el, path }) => isUnviewed(el) && !collapsedByRule(path));
    const target = entries[nextFlaggedIndex(flags, direction > 0 ? current : Math.max(current, 0), direction)];
    if (!target) {
      const hasControls = entries.some(({ el }) => el.querySelector(VIEWED_CONTROL_SEL));
      toast(hasControls ? "No unviewed files" : "Couldn't find the Viewed controls on this page");
      return;
    }
    target.el.scrollIntoView({ block: "start", behavior: "smooth" });
    flash(target.el);
  };

  const cellSide = (cell) => (/delet|\bleft\b/i.test(`${cell.className} ${cell.dataset.diffSide ?? ""}`) ? "L" : "R");

  const rowLine = (row) => {
    const cell = [...row.querySelectorAll("[data-line-number]")].at(-1);
    return cell ? { side: cellSide(cell), n: Number(cell.dataset.lineNumber) } : null;
  };

  const lineFragment = (start, end) => {
    if (!start || !end) return "";
    if (start.side === end.side && start.n === end.n) return `${start.side}${start.n}`;
    return `${start.side}${start.n}-${end.side}${end.n}`;
  };

  const selectedRows = (range) => {
    const rowOf = (node) => (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)?.closest("tr");
    const first = rowOf(range.startContainer);
    let last = rowOf(range.endContainer);
    // A triple-click selection ends at offset 0 of the row after the last selected one.
    if (last && last !== first && range.endOffset === 0) last = last.previousElementSibling ?? last;
    return [first, last];
  };

  const quoteMarkdown = (path, url, fragment, text) => {
    const fence = text.includes("```") ? "````" : "```";
    const language = path.match(/\.([a-z0-9]+)$/i)?.[1] ?? "";
    return `[\`${path}\`${fragment ? ` ${fragment}` : ""}](${url})\n\n${fence}${language}\n${text}\n${fence}\n`;
  };

  const copyQuote = () => {
    const selection = getSelection();
    const text = selection?.toString().replace(/\s+$/, "");
    if (!text) {
      toast("Select code in the diff first");
      return;
    }
    const range = selection.getRangeAt(0);
    const entry = fileEntries().find(({ el }) => el.contains(range.commonAncestorContainer));
    if (!entry) {
      toast("Select lines within a single file in the diff");
      return;
    }
    const [first, last] = selectedRows(range);
    const fragment = first && last ? lineFragment(rowLine(first), rowLine(last)) : "";
    const { owner, repo, number } = state.pr;
    const anchor = entry.el.id ? `#${entry.el.id}${fragment}` : "";
    const url = `https://github.com/${owner}/${repo}/pull/${number}${filesSuffix()}${anchor}`;
    GM_setClipboard(quoteMarkdown(entry.path, url, fragment, text), "text");
    toast(fragment ? "Copied quote with link" : "Copied quote with file link (line numbers not found)");
  };

  const discoverAdoBase = () => {
    if (config.adoBase) return config.adoBase;
    const href = document.querySelector("a[href*='/_workitems/edit/']")?.href;
    const base = href?.match(/^(https:\/\/[^?#]*?)\/_workitems\/edit\//)?.[1];
    if (base) store.set("adoBase", base);
    return base ?? store.get("adoBase", "");
  };

  const ticketMatches = () => {
    const sources = [
      { text: document.title },
      { text: document.querySelector(".js-issue-title")?.textContent },
      ...[...document.querySelectorAll(".head-ref, [class*='head-ref'], a[href*='/tree/']")]
        .slice(0, 3)
        .map((el) => ({ text: el.textContent, branch: true })),
    ].filter((source) => source.text);
    const ignored = new Set(config.ticketIgnorePrefixes);
    const seen = new Map();
    for (const { pattern, url, branchIgnoreCase, ado } of config.ticketRules) {
      const adoBase = ado ? discoverAdoBase() : "";
      for (const { text, branch } of sources) {
        const re = new RegExp(pattern, branch && branchIgnoreCase ? "gi" : "g");
        for (const match of text.match(re) ?? []) {
          const id = match.toUpperCase();
          if (ignored.has(id.split("-")[0].toLowerCase()) || seen.has(id)) continue;
          const link = ado && adoBase ? `${adoBase}/_workitems/edit/${id.replace(/\D/g, "")}` : url.replace("{id}", encodeURIComponent(id));
          seen.set(id, link);
        }
      }
    }
    return [...seen];
  };

  const statsByCategory = () => {
    const totals = {};
    for (const file of state.files ?? []) {
      const cat = categoryOf(file.filename);
      totals[cat] ??= { files: 0, additions: 0, deletions: 0 };
      totals[cat].files += 1;
      totals[cat].additions += file.additions;
      totals[cat].deletions += file.deletions;
    }
    return totals;
  };

  const changedSinceViewed = () => {
    const records = viewedRecords();
    return [...state.shas]
      .filter(([path, sha]) => records[digest(path)] !== undefined && records[digest(path)] !== sha)
      .map(([path]) => path);
  };

  const changedFilterKey = () => `v3:changedFilter:${digest(state.pr.key)}`;

  const changedFilterActive = () =>
    Boolean(
      config.features.changedFilter &&
        state.pr &&
        changedSinceViewed().length &&
        store.get(changedFilterKey(), false),
    );

  const applyChangedFilter = () => {
    if (state.files && !changedSinceViewed().length) store.set(changedFilterKey(), false);
    const changedPaths = changedFilterActive() ? changedSinceViewed() : null;
    for (const { el, path } of fileEntries()) {
      el.classList.toggle("prr-filter-hide", Boolean(changedPaths) && !changedPaths.includes(path));
    }
    processTree();
  };

  const setChangedFilter = (on) => {
    store.set(changedFilterKey(), on);
    applyChangedFilter();
    injectFilterItem();
  };

  const CHANGED_ITEM_ID = "prr-changed-filter";

  // The menu is React-owned, so the row is cloned from GitHub's own "Viewed files" item to inherit its markup and theming.
  const injectFilterItem = () => {
    const existing = document.getElementById(CHANGED_ITEM_ID);
    const viewed = [...document.querySelectorAll("[data-component='ActionMenu.Overlay'] li[role='menuitemcheckbox']")].find(
      (item) => item.textContent.trim() === "Viewed files",
    );
    if (!viewed) {
      existing?.remove();
      return;
    }
    const changedCount = config.features.changedFilter && state.pr ? changedSinceViewed().length : 0;
    if (!changedCount) {
      existing?.remove();
      return;
    }
    const label = `Changed since viewed (${changedCount})`;
    const active = String(changedFilterActive());
    let item = existing;
    if (!item || item.previousElementSibling !== viewed) {
      existing?.remove();
      item = viewed.cloneNode(true);
      item.id = CHANGED_ITEM_ID;
      item.removeAttribute("aria-keyshortcuts");
      item.setAttribute("aria-labelledby", `${CHANGED_ITEM_ID}--label`);
      item.querySelector("[data-component='ActionList.Item.Label']").id = `${CHANGED_ITEM_ID}--label`;
      const toggle = () => setChangedFilter(!changedFilterActive());
      item.addEventListener("click", toggle);
      item.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        toggle();
      });
      viewed.after(item);
    }
    const labelEl = item.querySelector("[data-component='ActionList.Item.Label']");
    if (labelEl.textContent !== label) labelEl.textContent = label;
    if (item.getAttribute("aria-checked") !== active) item.setAttribute("aria-checked", active);
  };

  const section = (title, ...body) => h("div", { class: "prr-section" }, h("div", { class: "prr-title" }, title), ...body);

  const inlineSection = (title, control, ...detail) =>
    h(
      "div",
      { class: "prr-section" },
      h("div", { class: "prr-row" }, h("span", { class: "prr-title prr-inline-title" }, title), control),
      ...detail,
    );

  const buildSections = () => {
    const out = [];
    if (state.loadedAt && !state.files) {
      out.push(
        section(
          "PR data unavailable",
          h("div", { class: "prr-muted" }, "Couldn't fetch this PR's diff with your GitHub session, so stats, ownership and viewed-state are off."),
        ),
      );
    }

    if (config.features.stats && state.files) {
      const totals = statsByCategory();
      out.push(
        section(
          "Changes",
          ...Object.entries(totals)
            .sort((a, b) => b[1].additions + b[1].deletions - (a[1].additions + a[1].deletions))
            .map(([cat, t]) =>
              h(
                "div",
                { class: "prr-row" },
                h("span", {}, `${cat} (${t.files})`),
                h("span", {}, h("span", { class: "prr-add" }, `+${t.additions}`), " ", h("span", { class: "prr-del" }, `−${t.deletions}`)),
              ),
            ),
        ),
      );
    }

    if (config.features.viewedAcrossPushes && state.pr) {
      const changed = changedSinceViewed();
      if (changed.length) {
        out.push(
          section(
            `Changed since viewed (${changed.length})`,
            ...changed.slice(0, 8).map((path) =>
              h(
                "a",
                {
                  href: "#",
                  class: "prr-block",
                  title: path,
                  onclick: (e) => {
                    e.preventDefault();
                    findFileEl(path)?.scrollIntoView({ block: "start", behavior: "smooth" });
                  },
                },
                path.split("/").slice(-2).join("/"),
              ),
            ),
          ),
        );
      }
    }

    if (config.features.threads) {
      const count = unresolvedThreads().length;
      if (count) {
        out.push(
          inlineSection(
            `Unresolved threads (${count})`,
            h(
              "span",
              { class: "prr-seg" },
              h("button", { class: "prr-btn", type: "button", onclick: () => stepThread(-1) }, "◀ Prev"),
              h("button", { class: "prr-btn", type: "button", onclick: () => stepThread(1) }, "Next ▶"),
            ),
          ),
        );
      }
    }

    if (config.features.hideNoise) {
      const noise = document.querySelectorAll(".prr-noise").length;
      if (noise) {
        out.push(
          inlineSection(
            `Bot comments (${noise})`,
            h(
              "button",
              {
                class: "prr-btn",
                type: "button",
                onclick: () => {
                  document.body.classList.toggle("prr-hide-noise");
                  renderPanel(true);
                },
              },
              document.body.classList.contains("prr-hide-noise") ? "Show" : "Hide",
            ),
          ),
        );
      }
    }

    if (config.features.ownership && FILES_PATH.test(location.pathname) && (state.codeowners || config.minePatterns.length)) {
      const verdicts = knownPaths().map(isMine);
      const mode = ownershipMode();
      out.push(
        inlineSection(
          "Ownership",
          h(
            "span",
            { class: "prr-seg" },
            ...["mark", "hide"].map((option) =>
              h(
                "button",
                {
                  class: `prr-btn${option === mode ? " prr-on" : ""}`,
                  type: "button",
                  onclick: () => {
                    store.set("ownershipMode", option);
                    processTree();
                    renderPanel(true);
                  },
                },
                option,
              ),
            ),
          ),
          h("div", { class: "prr-muted" }, `Mine ${verdicts.filter((v) => v === true).length} · Not mine ${verdicts.filter((v) => v === false).length} (● in the file tree)`),
        ),
      );
    }

    const look = sinceLastLook();
    if (look) {
      out.push(
        inlineSection(
          look.rewritten ? "Force-pushed since your last look" : `${look.count} new commit${look.count === 1 ? "" : "s"} since your last look`,
          h(
            "span",
            { class: "prr-look" },
            h("a", { class: "prr-chip", href: lastLookHref(look), title: `${look.seen.slice(0, 7)}..${look.head.slice(0, 7)}` }, "View changes"),
            h(
              "button",
              {
                class: "prr-btn",
                type: "button",
                title: "Treat the current head as seen",
                onclick: () => {
                  recordLastLook();
                  renderPanel(true);
                },
              },
              "Dismiss",
            ),
          ),
          look.rewritten
            ? h("div", { class: "prr-muted" }, "The commit you last saw is no longer in this PR, so this compares it directly with the new head. After a rebase that includes base-branch changes too.")
            : null,
        ),
      );
    }

    return out;
  };

  const NAV_TABS = [
    { label: "Conversation", suffix: "" },
    { label: "Commits", suffix: "/commits" },
    { label: "Checks", suffix: "/checks", jumpsToSummary: true },
    { label: "Files", suffix: "/files" },
  ];

  const filesSuffix = () => {
    if (/\/pull\/\d+\/changes/.test(location.pathname)) store.set("filesSuffix", "/changes");
    else if (/\/pull\/\d+\/files/.test(location.pathname)) store.set("filesSuffix", "/files");
    return store.get("filesSuffix", "/files");
  };

  const jumps = (tab) => tab.jumpsToSummary && !config.features.checksTab;

  const activateTab = (tab) => (jumps(tab) ? jumpToChecks() : goTo(tabHref(tab)));

  const tabHref = (tab) =>
    `/${state.pr.owner}/${state.pr.repo}/pull/${state.pr.number}${tab.suffix === "/files" ? filesSuffix() : tab.suffix}`;

  const currentTab = () => {
    const segment = location.pathname.match(/\/pull\/\d+\/(commits|checks|files|changes)/)?.[1];
    const suffix = segment ? `/${segment === "changes" ? "files" : segment}` : "";
    return NAV_TABS.find((tab) => tab.suffix === suffix);
  };

  const goTo = (href) => {
    const from = location.href;
    const link = h("a", { href, hidden: true });
    document.body.append(link);
    link.click();
    setTimeout(() => {
      link.remove();
      if (location.href === from) location.assign(href);
    }, 1500);
  };

  const ticketChips = () =>
    config.features.tickets
      ? ticketMatches().map(([id, url]) =>
          url
            ? h("a", { class: "prr-chip", href: url, target: "_blank", rel: "noreferrer", title: `Open ${id}` }, id)
            : h("span", { class: "prr-chip", title: "No link known for this ticket; see adoBase in the config" }, id),
        )
      : [];

  const ticketRow = () => {
    const chips = ticketChips();
    return chips.length ? h("div", { class: "prr-tickets" }, ...chips) : null;
  };

  const navRow = () => {
    const current = currentTab();
    return h(
      "div",
      { class: "prr-nav" },
      ...NAV_TABS.map((tab, index) =>
        h(
          "a",
          {
            class: `prr-tab${tab === current ? " prr-current" : ""}`,
            href: jumps(tab) ? "#" : tabHref(tab),
            title: `Alt+${index + 1}`,
            onclick: (e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              activateTab(tab);
            },
          },
          jumps(tab) ? `${tab.label} ↓` : tab.label,
        ),
      ),
    );
  };

  let modalReturnFocus = null;

  const closeModal = () => {
    document.getElementById("prr-modal")?.remove();
    // renderPanel replaces the panel's buttons, so the opener may be detached by now.
    const label = modalReturnFocus?.getAttribute?.("aria-label");
    const opener = modalReturnFocus?.isConnected ? modalReturnFocus : label && document.querySelector(`#prr-panel [aria-label="${label}"]`);
    opener?.focus?.();
    modalReturnFocus = null;
  };

  const openModal = (name, title, ...body) => {
    modalReturnFocus = document.activeElement;
    const card = h(
      "div",
      { class: "prr-modal-card", role: "dialog", "aria-modal": "true", "aria-labelledby": "prr-modal-title", tabindex: "-1" },
      h(
        "div",
        { class: "prr-bar" },
        h("strong", { id: "prr-modal-title" }, title),
        h("button", { class: "prr-btn", type: "button", "aria-label": "Close", onclick: closeModal }, "✕"),
      ),
      ...body,
    );
    const backdrop = h(
      "div",
      {
        id: "prr-modal",
        "data-modal": name,
        onclick: (event) => event.target === backdrop && closeModal(),
        onkeydown: (event) => {
          if (event.key !== "Escape") return;
          event.stopPropagation();
          closeModal();
        },
      },
      card,
    );
    document.body.append(backdrop);
    card.focus();
  };

  const toggleModal = (name, open) => {
    const current = document.getElementById("prr-modal");
    if (!current) return open();
    const sameModal = current.dataset.modal === name;
    closeModal();
    if (!sameModal) open();
  };

  const SHORTCUTS = [
    { keys: ["Alt", "1–4"], label: "Conversation, Commits, Checks, Files", feature: "nav" },
    { keys: ["Alt", "N"], label: "Next unviewed file", feature: "nextUnviewed", filesOnly: true },
    { keys: ["Alt", "Shift", "N"], label: "Previous unviewed file", feature: "nextUnviewed", filesOnly: true },
    { keys: ["Alt", "C"], label: "Copy selected code as a quote with link", feature: "copyPermalink", filesOnly: true },
    { keys: ["Alt", "R"], label: "Open GitHub's review dialog", feature: "reviewButton" },
    { keys: ["Alt", "J"], label: "Next unresolved thread", feature: "threads" },
    { keys: ["Alt", "K"], label: "Previous unresolved thread", feature: "threads" },
    { keys: ["Alt", ","], label: "Open settings" },
    { keys: ["Alt", "/"], label: "Show this help" },
  ];

  const shortcutRow = ({ keys, label, filesOnly }) =>
    h(
      "div",
      { class: "prr-help-row" },
      h("span", { class: "prr-help-keys" }, ...keys.flatMap((key, i) => [i ? h("span", { class: "prr-muted" }, "+") : null, h("kbd", {}, key)])),
      h("span", {}, label, filesOnly ? h("span", { class: "prr-muted" }, " · Files tab only") : null),
    );

  const toggleHelp = () =>
    toggleModal("help", () => {
      const rows = SHORTCUTS.filter((s) => !s.feature || config.features[s.feature]).map(shortcutRow);
      openModal("help", "Keyboard shortcuts", h("div", { class: "prr-section" }, ...rows));
    });

  const applyConfigChange = () => {
    applyNoiseDefault();
    document.querySelectorAll(`[data-prr-version]`).forEach((el) => delete el.dataset.prrVersion);
    state.version += 1;
    scan();
    renderPanel(true);
  };

  const settingRow = ({ key, label, hint, note }) =>
    h(
      "label",
      { class: "prr-setting" },
      h("span", { class: "prr-setting-text" }, label, note ? h("span", { class: "prr-muted prr-setting-note" }, note) : null),
      hint ? h("span", { class: "prr-muted prr-setting-hint" }, hint) : null,
      h("input", {
        type: "checkbox",
        class: "prr-switch",
        role: "switch",
        checked: config.features[key],
        onchange: (e) => {
          config.features[key] = e.target.checked;
          saveConfig();
          applyConfigChange();
        },
      }),
    );

  const toggleSettings = () =>
    toggleModal("settings", () => {
      const resetDefaults = () => {
        store.set("config", {});
        config = loadConfig();
        applyConfigChange();
        closeModal();
        toggleSettings();
      };
      openModal(
        "settings",
        "Settings",
        ...FEATURE_GROUPS.map((group) => h("div", { class: "prr-section" }, h("div", { class: "prr-title" }, group.title), ...group.features.map(settingRow))),
        h(
          "div",
          { class: "prr-section prr-row" },
          h("span", { class: "prr-muted prr-modal-footnote" }, "Snippets, ticket rules and patterns: Edit config (JSON) in the Tampermonkey menu."),
          h("button", { class: "prr-btn", type: "button", onclick: resetDefaults }, "Reset to defaults"),
        ),
      );
    });

  const ensurePanel = () => {
    let panel = document.getElementById("prr-panel");
    if (!panel) {
      panel = h("div", { id: "prr-panel" });
      document.body.append(panel);
    }
    return panel;
  };

  const renderPanel = (force = false) => {
    if (!state.pr) return;
    const signature = JSON.stringify([
      state.version,
      unresolvedThreads().length,
      document.querySelectorAll(".prr-noise").length,
      document.body.classList.contains("prr-hide-noise"),
      panelOpen,
      ownershipMode(),
      config.features.tickets ? ticketMatches().map(([id, url]) => id + url).join() : "",
      location.pathname,
    ]);
    if (!force && signature === lastSignature) return;
    lastSignature = signature;

    const panel = ensurePanel();
    panel.classList.toggle("prr-closed", !panelOpen);
    const bar = h(
      "div",
      { class: "prr-bar" },
      h("strong", {}, "PR toolkit"),
      h(
        "span",
        { class: "prr-tools" },
        config.features.reviewButton
          ? h("button", { class: "prr-btn prr-review", type: "button", title: "Open GitHub's review dialog (Alt+R)", onclick: openReview }, "Review")
          : null,
        h("button", { class: "prr-btn", type: "button", title: "Scroll to top", onclick: () => scrollTo({ top: 0, behavior: "smooth" }) }, "↑ Top"),
        h("button", { class: "prr-btn", type: "button", title: "Keyboard shortcuts (Alt+/)", "aria-label": "Keyboard shortcuts", onclick: toggleHelp }, "?"),
        h("button", { class: "prr-btn", type: "button", title: "Settings (Alt+,)", "aria-label": "Settings", onclick: toggleSettings }, "⚙"),
        h("button", { class: "prr-btn", type: "button", title: "Refresh data", onclick: () => state.pr && loadData(state.pr) }, "↻"),
        h("button", { class: "prr-btn", type: "button", onclick: () => { panelOpen = !panelOpen; store.set("panelOpen", panelOpen); renderPanel(true); } }, panelOpen ? "–" : "+"),
      ),
    );
    panel.replaceChildren(bar, ...[config.features.nav ? navRow() : null, ticketRow()].filter(Boolean), ...(panelOpen ? buildSections() : []));
  };

  const expandSnippet = (event) => {
    if (!config.features.snippets) return;
    const ta = event.target;
    if (!(ta instanceof HTMLTextAreaElement) || event.inputType !== "insertText" || event.data !== " ") return;
    const before = ta.value.slice(0, ta.selectionStart);
    const match = before.match(/(^|\s);(\w+) $/);
    const text = match && config.snippets[match[2]];
    if (!text) return;
    const start = ta.selectionStart - match[2].length - 2;
    ta.setSelectionRange(start, ta.selectionStart);
    // Comment boxes are React-controlled; assigning .value would not update their state.
    document.execCommand("insertText", false, text);
  };

  const redirectWithWhitespaceHidden = () => {
    if (!config.features.whitespace || !FILES_PATH.test(location.pathname)) return;
    const params = new URLSearchParams(location.search);
    const guard = `prr-w:${state.pr.key}`;
    if (params.has("w") || sessionStorage.getItem(guard)) return;
    sessionStorage.setItem(guard, "1");
    params.set("w", "1");
    allowLeaving();
    location.replace(`${location.pathname}?${params}`);
  };

  // Set before navigations that stay on the PR (or were already confirmed) so beforeunload doesn't prompt. The window covers goTo's 1.5s full-load fallback and slow in-app loads that end in a full load.
  let leavingAllowedUntil = 0;
  const allowLeaving = () => {
    leavingAllowedUntil = Date.now() + 10_000;
  };

  const findKey = (root, key) => {
    const stack = [root];
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== "object") continue;
      if (Object.hasOwn(node, key)) return node[key];
      for (const value of Object.values(node)) stack.push(value);
    }
    return undefined;
  };

  // Server state at page load, from the React payload. Only trusted when that payload was rendered for this PR.
  const payloadPendingCount = () => {
    const prPath = `/${state.pr.owner}/${state.pr.repo}/pull/${state.pr.number}`.toLowerCase();
    for (const app of document.querySelectorAll("react-app[initial-path]")) {
      const initial = app.getAttribute("initial-path").toLowerCase();
      if (initial !== prPath && !initial.startsWith(`${prPath}/`)) continue;
      const json = app.querySelector("script[data-target='react-app.embeddedData']")?.textContent ?? "";
      if (!json.includes('"viewerPendingReview"')) continue;
      try {
        const review = findKey(JSON.parse(json), "viewerPendingReview");
        if (review?.id) return review.comments?.length ?? 0;
      } catch {}
    }
    return 0;
  };

  // Classic Files: GitHub keeps .js-pending-review-comment-count in sync. React Files: the review button's count is the pending comment count. Null when neither is on the page.
  const livePendingCount = () => {
    const classic = [...document.querySelectorAll(".js-pending-review-comment-count")];
    const buttons = [...document.querySelectorAll("button[class*='ReviewMenuButton__']")];
    if (!classic.length && !buttons.length) return null;
    const counters = [...classic, ...buttons.map((button) => button.querySelector("[data-component='ButtonCounter']"))];
    return Math.max(0, ...counters.map((el) => parseInt(el?.textContent ?? "", 10) || 0));
  };

  // The last value read from the page sticks, so moving to a tab without a review button keeps it.
  const pendingReview = { key: "", count: 0 };

  const pendingReviewCount = () => {
    if (!config.features.pendingReviewGuard || !state.pr) return 0;
    if (pendingReview.key !== state.pr.key) Object.assign(pendingReview, { key: state.pr.key, count: payloadPendingCount() });
    const live = livePendingCount();
    if (live !== null) pendingReview.count = live;
    return pendingReview.count;
  };

  const prPathOf = (pathname) => pathname.match(/^\/[^/]+\/[^/]+\/pull\/\d+/)?.[0].toLowerCase() ?? "";

  const leavesPr = (url) => {
    const prPath = prPathOf(location.pathname);
    const path = url.pathname.toLowerCase();
    return Boolean(prPath) && path !== prPath && !path.startsWith(`${prPath}/`);
  };

  const pendingMessage = (count) =>
    `You have a pending review with ${count} comment${count === 1 ? "" : "s"} you haven't submitted. Nobody else can see ${count === 1 ? "it" : "them"} until you submit the review.\n\nLeave this pull request anyway?`;

  // Same-origin links usually navigate in-app without beforeunload, so they are confirmed here; other origins unload the page and beforeunload covers them.
  const guardLeavingClick = (event) => {
    if (!config.features.pendingReviewGuard || !state.pr) return;
    const link = event.target?.closest?.("a[href]");
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if ((link.target && link.target !== "_self") || link.hasAttribute("download")) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin) return;
    if (!leavesPr(url)) {
      allowLeaving();
      return;
    }
    const count = pendingReviewCount();
    if (!count) return;
    if (confirm(pendingMessage(count))) {
      allowLeaving();
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  // Submitting from the React review dialog sets location.href before the button's count re-renders, so an open dialog means "submitting", not "leaving".
  const reviewDialogOpen = () =>
    Boolean(document.querySelector("#anchored-review-title, [role='dialog'][aria-label='Review changes'], dialog[aria-label='Review changes']"));

  const guardUnload = (event) => {
    if (Date.now() < leavingAllowedUntil || reviewDialogOpen() || !pendingReviewCount()) return;
    event.preventDefault();
    event.returnValue = "";
  };

  const scan = () => {
    const pr = prContext();
    if (!pr) {
      document.getElementById("prr-panel")?.remove();
      state.pr = null;
      return;
    }
    if (pr.key !== state.pr?.key) {
      resetState(pr);
      loadData(pr);
      touchPr(digest(pr.key));
    }
    redirectWithWhitespaceHidden();
    resolveDomPaths();
    fileEntries().forEach(processFile);
    processNoise();
    applyChangedFilter();
    renderPanel();
    pendingReviewCount();
  };

  GM_addStyle(`
    #prr-panel { position: fixed; right: 16px; bottom: 16px; z-index: 90; width: 320px; max-height: 70vh; overflow: auto;
      font-size: 12px; line-height: 1.5; background: var(--overlay-bgColor, var(--bgColor-default, #fff)); color: var(--fgColor-default, #1f2328);
      border: 1px solid var(--borderColor-default, #d0d7de); border-radius: 12px; overscroll-behavior: contain;
      box-shadow: var(--shadow-floating-large, 0 8px 24px rgba(140,149,159,.2)), 0 1px 3px rgba(31,35,40,.12);
      scrollbar-width: thin; }
    #prr-panel.prr-closed { width: auto; overflow: hidden; }
    .prr-bar { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 8px 8px 8px 14px;
      position: sticky; top: 0; z-index: 1; background: inherit; border-bottom: 1px solid var(--borderColor-muted, #d8dee4); }
    .prr-bar strong { font-size: 13px; font-weight: 600; }
    .prr-tools { display: flex; align-items: center; gap: 2px; }
    .prr-closed .prr-bar { border-bottom: 0; padding: 6px 6px 6px 14px; }
    .prr-nav { display: flex; gap: 2px; margin: 8px 10px; padding: 2px; border-radius: 8px; background: var(--bgColor-muted, #f6f8fa); }
    .prr-tab { flex: 1; padding: 3px 4px; border-radius: 6px; text-align: center; white-space: nowrap;
      color: var(--fgColor-muted, #656d76); text-decoration: none; transition: background-color .12s, color .12s; }
    .prr-tab:hover { color: var(--fgColor-default, #1f2328); text-decoration: none; }
    .prr-current { color: var(--fgColor-default, #1f2328); font-weight: 600; background: var(--bgColor-default, #fff);
      box-shadow: 0 0 0 1px var(--borderColor-muted, #d8dee4), 0 1px 2px rgba(31,35,40,.08); }
    .prr-section { padding: 10px 14px; border-top: 1px solid var(--borderColor-muted, #d8dee4); }
    .prr-title { font-weight: 600; margin-bottom: 6px; color: var(--fgColor-muted, #656d76); }
    .prr-row { display: flex; justify-content: space-between; gap: 8px; align-items: center; padding: 1px 0;
      font-variant-numeric: tabular-nums; }
    .prr-block { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 1px 0; }
    .prr-muted { color: var(--fgColor-muted, #656d76); }
    .prr-add { color: var(--fgColor-success, #1a7f37); }
    .prr-del { color: var(--fgColor-danger, #cf222e); }
    .prr-btn { font: inherit; font-size: 12px; line-height: 20px; padding: 0 8px; margin-left: 4px; cursor: pointer; border-radius: 6px;
      border: 1px solid var(--borderColor-default, #d0d7de); background: var(--bgColor-muted, #f6f8fa); color: inherit;
      transition: background-color .12s, border-color .12s; }
    .prr-btn:hover { background: var(--control-bgColor-hover, #eaeef2); }
    .prr-btn:focus-visible, .prr-tab:focus-visible { outline: 2px solid var(--focus-outlineColor, #0969da); outline-offset: 1px; }
    .prr-tools .prr-btn { margin: 0; min-width: 24px; padding: 0 6px; border-color: transparent; background: transparent; color: var(--fgColor-muted, #656d76); }
    .prr-tools .prr-btn:hover { background: var(--control-bgColor-hover, #eaeef2); color: var(--fgColor-default, #1f2328); }
    .prr-tools .prr-review { margin-right: 4px; font-weight: 500; border-color: var(--borderColor-default, #d0d7de); color: var(--fgColor-default, #1f2328); }
    .prr-section .prr-btn:first-of-type { margin-left: 0; }
    .prr-inline-title { margin-bottom: 0; }
    .prr-seg { display: flex; }
    .prr-seg .prr-btn { margin-left: 0; border-radius: 0; }
    .prr-seg .prr-btn + .prr-btn { margin-left: -1px; }
    .prr-seg .prr-btn:first-child { border-radius: 6px 0 0 6px; }
    .prr-seg .prr-btn:last-child { border-radius: 0 6px 6px 0; }
    .prr-tickets { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 10px 8px; }
    .prr-chip { display: inline-block; margin: 0; padding: 0 8px; border-radius: 999px; font-weight: 500; text-decoration: none;
      background: var(--bgColor-accent-muted, #ddf4ff); color: var(--fgColor-accent, #0969da); }
    a.prr-chip:hover { text-decoration: underline; }
    span.prr-chip { background: var(--bgColor-muted, #f6f8fa); color: var(--fgColor-muted, #656d76); }
    .prr-badge { font-size: 11px; padding: 1px 6px; margin-right: 6px; border-radius: 999px; }
    .prr-warn { background: var(--bgColor-attention-muted, #fff8c5); color: var(--fgColor-attention, #9a6700); }
    .prr-tree-dim > div { opacity: .55; }
    .prr-on { font-weight: 600; background: var(--bgColor-accent-muted, #ddf4ff); }
    .prr-badge.prr-muted { border: 1px solid var(--borderColor-default, #d0d7de); }
    .prr-tree-hide { display: none !important; }
    .prr-tree-dot { flex: none; align-self: center; width: 7px; height: 7px; margin: 0 8px 0 6px; border-radius: 50%; }
    .prr-tree-dot-notmine { background: var(--fgColor-attention, #9a6700); }
    .prr-tree-dot-changed { background: var(--fgColor-accent, #0969da); }
    .prr-body-hidden, .prr-filter-hide { display: none !important; }
    #prr-toast { position: fixed; left: 50%; bottom: 24px; z-index: 100; transform: translateX(-50%); padding: 6px 14px;
      font-size: 12px; border-radius: 8px; background: var(--bgColor-emphasis, #24292f); color: var(--fgColor-onEmphasis, #fff);
      box-shadow: 0 4px 12px rgba(31,35,40,.25); pointer-events: none; }
    #prr-modal { position: fixed; inset: 0; z-index: 110; display: flex; align-items: center; justify-content: center;
      background: rgba(31,35,40,.45); }
    .prr-modal-card { width: min(420px, calc(100vw - 32px)); max-height: 90vh; overflow: auto; font-size: 13px; line-height: 1.5; outline: none;
      background: var(--overlay-bgColor, var(--bgColor-default, #fff)); color: var(--fgColor-default, #1f2328);
      border: 1px solid var(--borderColor-default, #d0d7de); border-radius: 12px;
      box-shadow: var(--shadow-floating-large, 0 8px 24px rgba(140,149,159,.2)), 0 1px 3px rgba(31,35,40,.12); }
    .prr-modal-card .prr-bar { border-bottom: 0; }
    .prr-modal-card .prr-section { padding: 10px 14px 12px; }
    .prr-modal-card .prr-row { gap: 16px; }
    .prr-modal-footnote { flex: 1; font-size: 11px; }
    .prr-modal-card .prr-row .prr-btn { flex: none; margin: 0; white-space: nowrap; }
    .prr-setting { display: flex; align-items: center; gap: 12px; margin: 0 -8px; padding: 6px 8px; border-radius: 8px; cursor: pointer; font-weight: 400; }
    .prr-setting:hover { background: var(--bgColor-muted, #f6f8fa); }
    .prr-setting-text { flex: 1; min-width: 0; }
    .prr-setting-note { display: block; font-size: 11px; }
    .prr-setting-hint { flex: none; font-size: 11px; }
    .prr-switch { appearance: none; -webkit-appearance: none; flex: none; position: relative; width: 28px; height: 16px; margin: 0; cursor: pointer;
      border-radius: 999px; background: var(--bgColor-neutral-muted, #afb8c1); transition: background-color .12s; }
    .prr-switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: #fff;
      box-shadow: 0 1px 2px rgba(31,35,40,.3); transition: transform .12s; }
    .prr-switch:checked { background: var(--bgColor-accent-emphasis, #0969da); }
    .prr-switch:checked::after { transform: translateX(12px); }
    .prr-switch:focus-visible { outline: 2px solid var(--focus-outlineColor, #0969da); outline-offset: 2px; }
    .prr-help-row { display: flex; align-items: baseline; gap: 12px; padding: 4px 0; }
    .prr-help-keys { flex: 0 0 150px; display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
    .prr-modal-card kbd { padding: 1px 6px; font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; border-radius: 6px;
      border: 1px solid var(--borderColor-default, #d0d7de); border-bottom-width: 2px; background: var(--bgColor-muted, #f6f8fa); }
    body.prr-hide-noise .prr-noise { display: none !important; }
    .prr-flash { outline: 3px solid var(--borderColor-accent-emphasis, #0969da); outline-offset: 2px; }
    .prr-look { display: flex; align-items: center; gap: 6px; flex: none; }
    .prr-look .prr-btn { margin: 0; }
  `);

  GM_registerMenuCommand("Edit config (JSON)", () => {
    const edited = prompt("Config JSON (snippets, ticketRules, ticketIgnorePrefixes, adoBase, generatedPatterns, myOwners, minePatterns, features):", JSON.stringify(config));
    if (edited === null) return;
    try {
      config = { ...DEFAULTS, ...JSON.parse(edited) };
      config.features = { ...DEFAULTS.features, ...config.features };
      saveConfig();
      state.version += 1;
      scan();
      renderPanel(true);
    } catch (err) {
      alert(`Invalid JSON: ${err.message}`);
    }
  });
  GM_registerMenuCommand("Reset config", () => {
    store.set("config", {});
    config = loadConfig();
    state.version += 1;
    scan();
    renderPanel(true);
  });

  document.addEventListener("input", expandSnippet, true);
  document.addEventListener("keydown", (event) => {
    if (config.features.nav && state.pr && event.altKey && !event.ctrlKey && !event.metaKey) {
      const tab = NAV_TABS[Number(event.code.replace("Digit", "")) - 1];
      if (tab) {
        event.preventDefault();
        activateTab(tab);
        return;
      }
    }
    const altOnly = event.altKey && !event.ctrlKey && !event.metaKey;
    if (altOnly && state.pr && event.code === "Slash") {
      event.preventDefault();
      toggleHelp();
      return;
    }
    if (altOnly && state.pr && config.features.reviewButton && event.code === "KeyR") {
      event.preventDefault();
      openReview();
      return;
    }
    if (altOnly && state.pr && event.code === "Comma") {
      event.preventDefault();
      toggleSettings();
      return;
    }
    if (altOnly && state.pr && FILES_PATH.test(location.pathname)) {
      if (config.features.nextUnviewed && event.code === "KeyN") {
        event.preventDefault();
        stepUnviewed(event.shiftKey ? -1 : 1);
        return;
      }
      if (config.features.copyPermalink && event.code === "KeyC") {
        event.preventDefault();
        copyQuote();
        return;
      }
    }
    if (!config.features.threads || !altOnly) return;
    if (event.code === "KeyJ") stepThread(1);
    else if (event.code === "KeyK") stepThread(-1);
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.pr && Date.now() - state.loadedAt > 60_000) loadData(state.pr);
  });
  addEventListener("click", guardLeavingClick, true);
  addEventListener("submit", allowLeaving, true);
  addEventListener("beforeunload", guardUnload);
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "F5" || ((event.ctrlKey || event.metaKey) && event.code === "KeyR")) allowLeaving();
    },
    true,
  );

  let filterItemQueued = false;
  const scheduleFilterItem = () => {
    if (filterItemQueued) return;
    filterItemQueued = true;
    requestAnimationFrame(() => {
      filterItemQueued = false;
      injectFilterItem();
    });
  };

  new MutationObserver(debounce(scan, 300)).observe(document.body, { childList: true, subtree: true });
  new MutationObserver(scheduleFilterItem).observe(document.body, { childList: true, subtree: true });
  scan();
  resumeJumps();
})();
