// ==UserScript==
// @name         GitHub PR Review Toolkit
// @namespace    https://github.com/waterfausett
// @version      0.14.1
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
      reviewProgress: true,
      bulkViewed: true,
      filePalette: true,
      myPrs: true,
      suggestFromSelection: true,
      collapseTrivial: true,
      leftovers: true,
      depSummary: true,
      pendingReviewGuard: true,
      sinceLastLook: true,
      listBadges: true,
      ticketsElsewhere: true,
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
    leftoverPatterns: [
      { label: "console.log", pattern: "\\bconsole\\.(log|debug|trace|dir)\\(", files: "\\.[cm]?[jt]sx?$|\\.(vue|svelte|astro)$" },
      { label: "debugger", pattern: "^\\s*debugger\\s*;?\\s*$", files: "\\.[cm]?[jt]sx?$|\\.(vue|svelte|astro)$" },
      { label: ".only", pattern: "\\b(describe|it|test|context|suite)\\.only\\(", files: "\\.[cm]?[jt]sx?$" },
      { label: "print()", pattern: "^\\s*print\\(", files: "\\.py$" },
      { label: "breakpoint", pattern: "\\bbreakpoint\\(\\)|\\bi?pdb\\.set_trace\\(", files: "\\.py$" },
      { label: "TODO", pattern: "\\b(TODO|FIXME)\\b" },
      {
        label: "localhost",
        pattern: "\\b(localhost|127\\.0\\.0\\.1)\\b",
        exclude: "\\.(md|mdx|rst|txt)$|(^|/)(tests?|__tests__|e2e|docs?)/|\\.(test|spec)\\.|(^|/)\\.env|docker-compose|(^|/)\\.devcontainer/",
      },
    ],
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
        { key: "filePalette", label: "Quick file jump", hint: "Alt+P", note: "Fuzzy-find a file in this PR and jump to it" },
        { key: "myPrs", label: "My pull requests", hint: "Alt+M", note: "Opens the PRs you authored in the current repo, from any GitHub page" },
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
        { key: "collapseTrivial", label: "Collapse whitespace-only and rename-only files" },
        { key: "leftovers", label: "Flag debug leftovers in added lines", hint: "Alt+L / Alt+Shift+L", note: "console.log, debugger, TODO, .only( …: leftoverPatterns" },
        { key: "sinceLastLook", label: "New commits since your last look", note: "Your last look is when you last marked a file Viewed" },
      ],
    },
    {
      title: "Comments",
      features: [
        { key: "hideNoise", label: "Hide bot comments" },
        { key: "snippets", label: "Snippet expander", hint: ";trigger + space" },
        { key: "tickets", label: "Ticket chips" },
        { key: "suggestFromSelection", label: "Suggestion from selected lines", hint: "Alt+G", note: "Opens a comment with a suggestion block; never posts it" },
        { key: "pendingReviewGuard", label: "Warn before leaving with an unsubmitted review", note: "Only when your pending review has comments" },
      ],
    },
    {
      title: "Panel",
      features: [
        { key: "stats", label: "Change stats" },
        { key: "checksTab", label: "Checks nav item opens the Checks tab", note: "Off: scrolls to the checks summary on Conversation" },
        { key: "reviewProgress", label: "Review progress meter", note: "Weighted by changed lines; skips generated files and files owned by others" },
        { key: "bulkViewed", label: "Bulk mark viewed buttons", note: "Generated, test and not-mine files; Files tab only" },
        { key: "depSummary", label: "Dependency changes", note: "package.json, requirements*.txt, pyproject.toml" },
      ],
    },
    {
      title: "Elsewhere on GitHub",
      features: [
        { key: "listBadges", label: "Review badges in PR lists", note: "Your progress, new commits and unsubmitted reviews, as of your last visit" },
        { key: "ticketsElsewhere", label: "Ticket chips in lists, branches and commits" },
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
      GM_deleteValue(`v3:summary:${id}`);
      delete lastSeen[id];
    }
    store.set("prLastSeen", lastSeen);
    const pending = store.get("pendingReviews", {});
    store.set("pendingReviews", Object.fromEntries(Object.entries(pending).filter(([, entry]) => now - entry.at < PR_RETENTION_MS)));
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

  const stripWs = (text) => text.replace(/\s+/g, "");

  const NPM_SECTION = /^(dependencies|devDependencies|peerDependencies|optionalDependencies)$/;
  const NPM_VERSION = /^([~^<>=*]|v?\d|latest$|next$|(workspace|npm|file|link|portal|catalog|github|https?|git(\+[a-z]+)?):)/;
  const NOT_PACKAGES = new Set(["version", "node", "npm", "yarn", "pnpm", "python", "requires-python"]);
  const PEP508 = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(\[[^\]]*\])?\s*([^;]*)/;
  const POETRY_TABLE = /^tool\.poetry\.(group\.[^.]+\.)?(dev-)?dependencies$/;

  const pyName = (name) => name.toLowerCase().replace(/[-_.]+/g, "-");

  // strict: outside a known dependency list, only accept strings that carry a version operator.
  const pipRequirement = (spec, section, strict) => {
    const m = spec.trim().match(PEP508);
    const version = m?.[3].trim() ?? "";
    if (!m || (version && !/^([<>=!~]|@)/.test(version)) || (strict && !version)) return null;
    return { key: pyName(m[1]), name: m[1], version, section };
  };

  // Hunks often start inside a section, so side.section stays undefined until a header line is seen and entries are then guessed from shape.
  const npmEntries = (line, side) => {
    const open = line.match(/^\s*"([^"]+)"\s*:\s*\{/);
    if (open) side.section = NPM_SECTION.test(open[1]) && !/\}\s*,?\s*$/.test(line) ? open[1] : null;
    else if (/^\s*\}/.test(line)) side.section = null;
    const m = !open && line.match(/^(\s*)"([^"]+)"\s*:\s*"([^"]*)"/);
    if (!m) return [];
    const guessed =
      side.section === undefined && m[1].replace(/\t/g, "  ").length >= 4 && !NOT_PACKAGES.has(m[2]) && NPM_VERSION.test(m[3]);
    return side.section || guessed ? [{ key: m[2], name: m[2], version: m[3], section: side.section ?? "" }] : [];
  };

  const pipEntries = (line) => {
    const text = line.replace(/(^|\s)#.*$/, "").replace(/\\$/, "").trim();
    const req = text && !text.startsWith("-") && pipRequirement(text, "", false);
    return req ? [req] : [];
  };

  const pyprojectSection = (table, array) => {
    if (table === undefined) return array === "dependencies" || array === "requires" ? array : undefined;
    if (table === "project" && array === "dependencies") return "dependencies";
    if (table === "project.optional-dependencies") return `extra ${array}`;
    if (table === "dependency-groups") return `group ${array}`;
    if (table === "build-system" && array === "requires") return "build";
    return null;
  };

  const pyprojectEntries = (line, side) => {
    const text = line.replace(/(^|\s)#.*$/, "");
    const table = text.match(/^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*$/);
    if (table) {
      side.table = table[1].replace(/["'\s]/g, "");
      side.array = null;
      return [];
    }
    let body = text;
    const assign = !side.array && text.match(/^\s*("[^"]+"|'[^']+'|[\w.-]+)\s*=\s*(.*)$/);
    if (assign) {
      const key = assign[1].replace(/["']/g, "");
      const value = assign[2].trim();
      side.array = null;
      if (!value.startsWith("[")) {
        if (side.table !== undefined && !POETRY_TABLE.test(side.table)) return [];
        const version = value.match(/^"([^"]*)"/)?.[1] ?? value.match(/^\{.*\bversion\s*=\s*"([^"]*)"/)?.[1];
        if (version === undefined || NOT_PACKAGES.has(key)) return [];
        if (side.table === undefined && !/^([\^~]|[<>=!]=?)\s*\d/.test(version)) return [];
        return [{ key: pyName(key), name: key, version, section: side.table?.replace(/^tool\.poetry\./, "") ?? "" }];
      }
      side.array = key;
      body = value.slice(1);
    }
    if (side.array === null) return [];
    const section = pyprojectSection(side.table, side.array);
    const label = section ?? side.array ?? "";
    if (/\]/.test(body.replace(/"[^"]*"|'[^']*'/g, ""))) side.array = null;
    if (section === null) return [];
    return [...body.matchAll(/"([^"]*)"|'([^']*)'/g)]
      .map((m) => pipRequirement(m[1] ?? m[2], label, section === undefined))
      .filter(Boolean);
  };

  const MANIFESTS = [
    { re: /(^|\/)package\.json$/, entries: npmEntries },
    { re: /(^|\/)requirements[^/]*\.(txt|in)$/, entries: pipEntries },
    { re: /(^|\/)pyproject\.toml$/, entries: pyprojectEntries },
  ];

  const diffDeps = (before, after) => {
    const deps = [];
    for (const [key, { name, version, section }] of after) {
      const old = before.get(key);
      const moved = old?.section && section && old.section !== section;
      if (!old) deps.push({ change: "added", name, version, section });
      else if (old.version !== version || moved) deps.push({ change: "changed", name, version, section, from: old.version, fromSection: old.section });
    }
    for (const [key, { name, version, section }] of before) {
      if (!after.has(key)) deps.push({ change: "removed", name, version, section });
    }
    return deps;
  };

  const compileLeftoverRules = (patterns) =>
    patterns.flatMap((rule) => {
      const { pattern, label = pattern, files, exclude } = typeof rule === "string" ? { pattern: rule } : rule;
      try {
        return [{ label, re: new RegExp(pattern), files: files && new RegExp(files), exclude: exclude && new RegExp(exclude) }];
      } catch {
        return [];
      }
    });

  const MAX_LEFTOVERS_PER_FILE = 50;

  // Keeps per file only counts, flags, leftovers and dependency changes; hunk text is dropped as each hunk ends.
  const parseDiff = (text, leftoverRules = []) => {
    const files = [];
    let current = null;
    let scratch = null;
    let hunk = null;
    const endHunk = () => {
      if (!hunk) return;
      if (scratch.whitespaceOnly && hunk.oldText !== hunk.newText) scratch.whitespaceOnly = false;
      for (const item of hunk.leftovers) {
        if (!hunk.removed.has(stripWs(item.text)) && current.leftovers.length < MAX_LEFTOVERS_PER_FILE) current.leftovers.push(item);
      }
      hunk = null;
    };
    const endFile = () => {
      if (!current) return;
      endHunk();
      const { renamed, similarity, hunks, other, whitespaceOnly, oldDeps, newDeps } = scratch;
      if (renamed && !hunks && !other && similarity === 100) current.trivial = "renamed";
      else if (hunks && whitespaceOnly && !other) current.trivial = "whitespace";
      if (current.trivial) current.leftovers = [];
      current.deps = diffDeps(oldDeps, newDeps);
    };
    for (const line of text.split("\n")) {
      if (line.startsWith("diff --git ")) {
        endFile();
        const m = line.match(/^diff --git a\/(.+) b\/(.+)$/);
        current = { filename: m ? m[2] : line.slice(11), sha: "", additions: 0, deletions: 0, trivial: "", leftovers: [], deps: [] };
        scratch = { renamed: false, similarity: 0, hunks: 0, other: false, whitespaceOnly: true, oldDeps: new Map(), newDeps: new Map() };
        files.push(current);
      } else if (!current) {
        continue;
      } else if (line.startsWith("@@")) {
        endHunk();
        if (!scratch.hunks) {
          const path = current.filename;
          scratch.rules = leftoverRules.filter((rule) => (!rule.files || rule.files.test(path)) && !rule.exclude?.test(path));
          scratch.manifest = MANIFESTS.find((manifest) => manifest.re.test(path));
        }
        scratch.hunks += 1;
        hunk = { newLine: Number(line.match(/\+(\d+)/)?.[1] ?? 1), oldText: "", newText: "", removed: new Set(), leftovers: [] };
        scratch.oldSide = {};
        scratch.newSide = {};
        const context = line.replace(/^@@[^@]*@@ ?/, "");
        if (scratch.manifest && context) {
          scratch.manifest.entries(context, scratch.oldSide);
          scratch.manifest.entries(context, scratch.newSide);
        }
      } else if (!hunk) {
        if (line.startsWith("index ")) current.sha = line.match(/\.\.([0-9a-f]+)/)?.[1]?.slice(0, 7) ?? "";
        else if (line.startsWith("rename from ")) scratch.renamed = true;
        else if (line.startsWith("rename to ")) current.filename = line.slice(10);
        else if (line.startsWith("similarity index ")) scratch.similarity = parseInt(line.slice(17), 10);
        else if (/^(old mode|new mode|Binary files|GIT binary patch)/.test(line)) scratch.other = true;
      } else if (line[0] !== "\\") {
        const sign = line[0] ?? " ";
        const content = line.slice(1);
        if (sign === "+") current.additions += 1;
        else if (sign === "-") current.deletions += 1;
        if (scratch.whitespaceOnly) {
          const stripped = stripWs(content);
          if (sign !== "+") hunk.oldText += stripped;
          if (sign !== "-") hunk.newText += stripped;
        }
        if (sign === "+" && scratch.rules.length) {
          const rule = scratch.rules.find((r) => r.re.test(content));
          if (rule) hunk.leftovers.push({ line: hunk.newLine, label: rule.label, text: content.trim().slice(0, 120) });
        } else if (sign === "-" && scratch.rules.length) {
          hunk.removed.add(stripWs(content));
        }
        if (scratch.manifest) {
          if (sign !== "+") for (const entry of scratch.manifest.entries(content, scratch.oldSide)) if (sign === "-") scratch.oldDeps.set(entry.key, entry);
          if (sign !== "-") for (const entry of scratch.manifest.entries(content, scratch.newSide)) if (sign === "+") scratch.newDeps.set(entry.key, entry);
        }
        if (sign !== "-") hunk.newLine += 1;
      }
    }
    endFile();
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
    byPath: new Map(),
    pathToId: new Map(),
    commitOids: null,
  };
  const userExpanded = new Set();
  let panelOpen = store.get("panelOpen", true);
  let lastSignature = "";
  let threadCursor = -1;
  let leftoverCursor = -1;

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
    const files = diffText?.startsWith("diff --git") ? parseDiff(diffText, compileLeftoverRules(config.leftoverPatterns)) : null;
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
      byPath: new Map((files ?? []).map((f) => [f.filename, f])),
      pathToId: new Map([...hashToPath].map(([id, path]) => [path, id])),
      commitOids,
    });
    leftoverCursor = -1;
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
      byPath: new Map(),
      pathToId: new Map(),
      commitOids: null,
    });
    userExpanded.clear();
    threadCursor = -1;
    leftoverCursor = -1;
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

  const viewedKey = () => `v3:viewed:${digest(state.pr.key)}`;
  const viewedRecords = () => store.get(viewedKey(), {});

  const lastLookKey = (pr = state.pr) => `v3:lastLook:${digest(pr.key)}`;

  const recordLastLook = () => {
    const head = state.commitOids?.at(-1);
    if (head) store.set(lastLookKey(), head);
  };

  const sinceLastLook = (pr = state.pr, oids = state.commitOids) => {
    const seen = config.features.sinceLastLook && pr && oids ? store.get(lastLookKey(pr), "") : "";
    if (!seen || seen === oids.at(-1)) return null;
    const index = oids.indexOf(seen);
    return { seen, head: oids.at(-1), count: oids.length - 1 - index, rewritten: index < 0 };
  };

  // A force-pushed SHA is no longer in the PR, so GitHub's PR range view 404s; a plain compare still renders.
  const lastLookHref = ({ seen, head, rewritten }, pr = state.pr) => {
    const { owner, repo, number } = pr;
    return rewritten ? `/${owner}/${repo}/compare/${seen}..${head}` : `/${owner}/${repo}/pull/${number}/files/${seen}..${head}`;
  };

  const badge = (text, tone) => h("span", { class: `prr-badge prr-${tone}` }, text);

  const TRIVIAL_REASONS = { renamed: "Renamed", whitespace: "Whitespace only" };

  const trivialReason = (path) => (config.features.collapseTrivial && TRIVIAL_REASONS[state.byPath.get(path)?.trivial]) || "";

  const fileLeftovers = (path) => (config.features.leftovers && !isGenerated(path) && state.byPath.get(path)?.leftovers) || [];

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
      (config.features.collapseTests && categoryOf(path) === "tests" && "Tests") ||
      trivialReason(path);
    if (trivialReason(path)) actions.prepend(badge(trivialReason(path).toLowerCase(), "muted"));
    const leftovers = fileLeftovers(path);
    if (leftovers.length) {
      const title = leftovers.map((item) => `L${item.line} ${item.label}: ${item.text}`).join("\n");
      actions.prepend(Object.assign(badge(`${leftovers.length} leftover${leftovers.length === 1 ? "" : "s"}`, "warn"), { title }));
    }
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
    }

    // The progress meter reads these records off the Files tab, so they are kept while either feature is on.
    if (config.features.viewedAcrossPushes || config.features.reviewProgress) {
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
    const ownership = config.features.ownership;
    const changedPaths = config.features.viewedAcrossPushes && state.pr ? changedSinceViewed() : [];
    const filterByChanged = changedFilterActive();
    for (const item of document.querySelectorAll("[role='tree'] [role='treeitem']")) {
      const folder = isTreeFolder(item);
      const path = dimTests || ownership || changedPaths.length ? treePath(item) : "";
      const isTest = dimTests && categoryOf(folder ? `${path}/_` : path) === "tests";
      const notMine = ownership && !folder && isMine(path) === false;
      item.classList.toggle("prr-tree-dim", isTest);
      item.classList.toggle("prr-tree-notmine", notMine);
      setTreeMark(item, "notmine", "Not mine (CODEOWNERS)", notMine);
      setTreeMark(item, "changed", "Changed since you viewed it", !folder && changedPaths.includes(path));
      item.classList.toggle("prr-tree-hide", filterByChanged && outsideChangedSet(path, folder, changedPaths));
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

  const toast = (message, ms = 2000) => {
    document.getElementById("prr-toast")?.remove();
    const el = h("div", { id: "prr-toast" }, message);
    document.body.append(el);
    setTimeout(() => el.remove(), ms);
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

  // The target path is kept beside the jump's deadline so it survives the full-load fallback too.
  const FILE_TARGET_KEY = "prr-jump-file-target";
  let fileTargetMemo = {};

  const fileTarget = () => {
    try {
      return JSON.parse(sessionStorage.getItem(FILE_TARGET_KEY)) ?? fileTargetMemo;
    } catch {
      return fileTargetMemo;
    }
  };

  const findFileTarget = () => {
    const { path, id } = fileTarget();
    return (id && document.getElementById(id)) || (path && findFileEl(path)) || null;
  };

  const STICKY_GAP_PX = 8;
  const isPinned = (el) => ["sticky", "fixed"].includes(getComputedStyle(el).position);

  // GitHub pins its PR header and the diff toolbar to the top; a file's own sticky header doesn't count, since it moves with the file.
  const stickyTop = () => {
    const files = fileEntries().map((entry) => entry.el);
    let bottom = 0;
    for (let pass = 0; pass < 4; pass++) {
      let next = bottom;
      for (const hit of document.elementsFromPoint(innerWidth / 2, bottom + 1)) {
        for (let el = hit; el && el !== document.body; el = el.parentElement) {
          if (!isPinned(el) || el.closest("#prr-panel, #prr-toast") || files.some((file) => file.contains(el))) continue;
          next = Math.max(next, el.getBoundingClientRect().bottom);
        }
      }
      if (next <= bottom) break;
      bottom = next;
    }
    return bottom;
  };

  const fileOffset = (el) => el.getBoundingClientRect().top - stickyTop() - STICKY_GAP_PX;

  // A smooth scroll aims at a position fixed when it starts, but lazy-rendered files above and GitHub's collapsing header shift the layout
  // on the way, so it is corrected once it ends. The timeout drops the listener when the scroll never starts or the user takes over.
  const scrollToFile = (el, behavior = "auto") => {
    scrollTo({ top: scrollY + fileOffset(el), behavior });
    if (behavior !== "smooth") return;
    const settle = () => {
      clearTimeout(timer);
      const offset = el.isConnected ? fileOffset(el) : 0;
      if (Math.abs(offset) > 1 && Math.abs(offset) < innerHeight / 2) scrollTo({ top: scrollY + offset, behavior: "auto" });
    };
    const timer = setTimeout(() => removeEventListener("scrollend", settle), 2000);
    addEventListener("scrollend", settle, { once: true });
  };

  const landOnFile = (el) => {
    const { path } = fileTarget();
    try {
      sessionStorage.removeItem(FILE_TARGET_KEY);
    } catch {}
    if (path) expandFile(fileEntries().find((entry) => entry.el === el) ?? { el, path });
    if (!el.getClientRects().length) {
      toast("That file is hidden by a filter");
      return;
    }
    scrollToFile(el);
    flash(el);
    // Expanding and lazy-rendered files above shift the layout, so settle once more.
    setTimeout(() => el.isConnected && scrollToFile(el), 400);
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
    file: {
      key: "prr-jump-file",
      here: () => FILES_PATH.test(location.pathname),
      href: () => `${tabHref(NAV_TABS[3])}#${fileTarget().id ?? ""}`,
      find: findFileTarget,
      land: landOnFile,
      missing: "Couldn't find that file on this page",
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
    ((config.features.collapseGenerated && isGenerated(path)) ||
      (config.features.collapseTests && categoryOf(path) === "tests") ||
      Boolean(trivialReason(path)));

  const isUnviewed = (el) => {
    const control = el.querySelector(VIEWED_CONTROL_SEL);
    return Boolean(control) && !isViewed(control);
  };

  // Jumps land a file below the sticky headers, so "current" tolerates that offset.
  const CURRENT_FILE_TOLERANCE_PX = 80;

  const stepUnviewed = (direction) => {
    const rendered = fileEntries().filter(({ el }) => el.getClientRects().length);
    // fileEntries can return a wrapper around several files; only the innermost entries are single files.
    const entries = rendered
      .filter(({ el }) => !rendered.some((other) => other.el !== el && el.contains(other.el)))
      .sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    const threshold = Math.max(CURRENT_FILE_TOLERANCE_PX, stickyTop() + STICKY_GAP_PX + 2);
    const current = entries.findLastIndex(({ el }) => el.getBoundingClientRect().top <= threshold);
    const flags = entries.map(({ el, path }) => isUnviewed(el) && !collapsedByRule(path));
    const target = entries[nextFlaggedIndex(flags, direction > 0 ? current : Math.max(current, 0), direction)];
    if (!target) {
      const hasControls = entries.some(({ el }) => el.querySelector(VIEWED_CONTROL_SEL));
      toast(hasControls ? "No unviewed files" : "Couldn't find the Viewed controls on this page");
      return;
    }
    scrollToFile(target.el, "smooth");
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

  const jumpToFile = async (path) => {
    const id = `diff-${await sha256Hex(path)}`;
    fileTargetMemo = { path, id };
    try {
      sessionStorage.setItem(FILE_TARGET_KEY, JSON.stringify(fileTargetMemo));
    } catch {}
    const jump = JUMPS.file;
    if (!jump.here() || jump.find()) {
      startJump(jump);
      return;
    }
    // Files GitHub hasn't rendered yet load when their #diff- anchor becomes the hash, as the file tree's own links do.
    if (location.hash === `#${id}`) dispatchEvent(new HashChangeEvent("hashchange"));
    else location.hash = id;
    awaitJump(jump, Date.now() + JUMP_WAIT_MS);
  };

  const subsequence = (query, text) => {
    const positions = [];
    let from = 0;
    for (const char of query) {
      const index = text.indexOf(char, from);
      if (index < 0) return null;
      positions.push(index);
      from = index + 1;
    }
    return positions;
  };

  // Lower is better: basename matches rank above whole-path ones, then substrings, tight matches and early starts.
  const fuzzyScore = (query, path) => {
    const q = query.toLowerCase().replace(/\s+/g, "");
    if (!q) return 0;
    const lower = path.toLowerCase();
    const base = lower.slice(lower.lastIndexOf("/") + 1);
    const inBase = subsequence(q, base);
    const positions = inBase ?? subsequence(q, lower);
    if (!positions) return null;
    const at = (inBase ? base : lower).indexOf(q);
    const gaps = at >= 0 ? 0 : positions.at(-1) - positions[0] + 1 - q.length;
    return (inBase ? 0 : 1e6) + (at >= 0 ? 0 : 1e5) + Math.min(gaps, 999) * 100 + Math.min(at >= 0 ? at : positions[0], 99);
  };

  const rankPaths = (query, items) =>
    items
      .map((item, index) => ({ item, index, score: fuzzyScore(query, item.path) }))
      .filter((match) => match.score !== null)
      .sort((a, b) => a.score - b.score || a.index - b.index)
      .map((match) => match.item);

  const PALETTE_LIMIT = 50;

  const paletteItems = () => {
    const stats = new Map((state.files ?? []).map((f) => [f.filename, f]));
    const elements = new Map(fileEntries().map(({ el, path }) => [path, el]));
    const changed = config.features.viewedAcrossPushes && state.pr ? new Set(changedSinceViewed()) : new Set();
    const records = state.pr ? viewedRecords() : {};
    return knownPaths().map((path) => {
      const control = elements.get(path)?.querySelector(VIEWED_CONTROL_SEL);
      const sha = state.shas.get(path);
      const category = categoryOf(path);
      return {
        path,
        file: stats.get(path),
        viewed: control ? isViewed(control) : Boolean(sha) && records[digest(path)] === sha,
        changed: changed.has(path),
        notMine: config.features.ownership && isMine(path) === false,
        tag: category === "generated" || category === "tests" ? category : "",
      };
    });
  };

  const paletteRow = (item, index, onchoose, onhover) => {
    const slash = item.path.lastIndexOf("/");
    return h(
      "li",
      { class: "prr-palette-item", role: "option", id: `prr-palette-${index}`, title: item.path, onmousedown: (e) => e.preventDefault(), onclick: onchoose, onmousemove: onhover },
      h("span", { class: "prr-palette-name" }, h("strong", {}, item.path.slice(slash + 1)), slash > 0 ? h("span", { class: "prr-muted" }, ` ${item.path.slice(0, slash)}`) : null),
      h(
        "span",
        { class: "prr-palette-meta" },
        item.changed ? h("span", { class: "prr-tree-dot prr-tree-dot-changed", title: "Changed since you viewed it" }) : null,
        item.notMine ? h("span", { class: "prr-tree-dot prr-tree-dot-notmine", title: "Not mine (CODEOWNERS)" }) : null,
        item.tag ? h("span", { class: "prr-badge prr-muted" }, item.tag === "tests" ? "test" : item.tag) : null,
        item.viewed ? h("span", { class: "prr-muted", title: "Viewed" }, "✓") : null,
        item.file ? h("span", { class: "prr-add" }, `+${item.file.additions}`) : null,
        item.file ? h("span", { class: "prr-del" }, `−${item.file.deletions}`) : null,
      ),
    );
  };

  const togglePalette = () =>
    toggleModal("palette", () => {
      const items = paletteItems();
      let matches = [];
      let cursor = 0;
      const list = h("ul", { class: "prr-palette-list", role: "listbox", id: "prr-palette-list", "aria-label": "Files" });
      const input = h("input", {
        type: "text",
        class: "prr-palette-input",
        placeholder: "Jump to file…",
        role: "combobox",
        "aria-label": "File name",
        "aria-controls": "prr-palette-list",
        "aria-expanded": "true",
        autocomplete: "off",
        spellcheck: "false",
      });
      const choose = (item) => {
        closeModal();
        jumpToFile(item.path);
      };
      const move = (index) => {
        if (!matches.length) return;
        cursor = (index + matches.length) % matches.length;
        [...list.children].forEach((row, i) => row.setAttribute("aria-selected", String(i === cursor)));
        list.children[cursor]?.scrollIntoView({ block: "nearest" });
        input.setAttribute("aria-activedescendant", `prr-palette-${cursor}`);
      };
      const render = () => {
        matches = rankPaths(input.value, items).slice(0, PALETTE_LIMIT);
        list.replaceChildren(
          ...(matches.length
            ? matches.map((item, i) => paletteRow(item, i, () => choose(item), () => cursor !== i && move(i)))
            : [h("li", { class: "prr-muted prr-palette-empty" }, items.length ? "No matching files" : "No files found yet")]),
        );
        if (!matches.length) input.removeAttribute("aria-activedescendant");
        move(0);
      };
      input.addEventListener("input", render);
      input.addEventListener("keydown", (event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          move(cursor + (event.key === "ArrowDown" ? 1 : -1));
        } else if (event.key === "Enter" && matches[cursor]) {
          event.preventDefault();
          choose(matches[cursor]);
        }
      });
      openModal("palette", "Jump to file", h("div", { class: "prr-section prr-palette" }, input, list));
      render();
      input.focus();
    });

  const longestRun = (text, char) => Math.max(0, ...(text.match(new RegExp(`${char}+`, "g")) ?? []).map((run) => run.length));

  const suggestionBlock = (text) => {
    const fence = "`".repeat(Math.max(3, longestRun(text, "`") + 1));
    return `${fence}suggestion\n${text}\n${fence}\n`;
  };

  const codeCellAfter = (numberCell) => {
    let cell = numberCell.nextElementSibling;
    while (cell?.hasAttribute("data-line-number")) cell = cell.nextElementSibling;
    return cell;
  };

  // Diff markers and line numbers are drawn by CSS from data attributes in the classic view; the clone path drops marker elements elsewhere.
  const codeText = (cell) => {
    const inner = cell.matches(".blob-code-inner, .diff-text-inner") ? cell : cell.querySelector(".blob-code-inner, .diff-text-inner");
    if (inner) return inner.textContent;
    const clone = cell.cloneNode(true);
    clone.querySelectorAll("button, [class*='marker' i], .sr-only").forEach((node) => node.remove());
    return clone.textContent.replace(/\n$/, "");
  };

  const diffLine = (row) => {
    const numbered = [...row.querySelectorAll("[data-line-number]")].filter((cell) => /^\d+$/.test(cell.dataset.lineNumber));
    const cell = numbered.at(-1);
    if (!cell) return null;
    if (cellSide(cell) === "L") return { deleted: true };
    const code = codeCellAfter(cell);
    return code ? { row, cell, code, n: Number(cell.dataset.lineNumber), text: codeText(code) } : null;
  };

  const selectedNewLines = (first, last) => {
    const lines = [];
    let deleted = 0;
    for (let row = first; row; row = row.nextElementSibling) {
      const line = diffLine(row);
      if (line?.deleted) deleted += 1;
      else if (line) lines.push(line);
      if (row === last) return { lines, deleted };
    }
    return null;
  };

  const waitFor = (find, ms) =>
    new Promise((resolve) => {
      const deadline = Date.now() + ms;
      const timer = setInterval(() => {
        const found = find();
        if (!found && Date.now() < deadline) return;
        clearInterval(timer);
        resolve(found || null);
      }, 100);
    });

  const fireMouse = (el, types, init = {}) =>
    types.forEach((type) => el.dispatchEvent(new MouseEvent(type, { bubbles: !/enter$/.test(type), cancelable: true, view: window, ...init })));

  const COMMENT_BUTTON_SEL = "button.js-add-line-comment, button.add-line-comment, button[aria-label*='comment' i]";
  const COMMENT_WAIT_MS = 3000;

  // GitHub inserts the line's "+" button on hover, so the hover is simulated first.
  const commentButton = (line) => {
    for (const el of [line.row, line.cell, line.code]) fireMouse(el, ["pointerover", "pointerenter", "mouseover", "mouseenter", "mousemove"]);
    return [...line.row.querySelectorAll(COMMENT_BUTTON_SEL)].find((button) => button.type !== "submit" && !button.closest("form"));
  };

  // A range is selected the way a user does it, click the first line number and shift-click the last, before pressing "+" on the last line.
  const openLineComment = async (fileEl, start, end) => {
    const before = new Set(document.querySelectorAll("textarea"));
    const wasActive = document.activeElement;
    if (start !== end) {
      fireMouse(start.cell, ["mousedown", "mouseup", "click"]);
      fireMouse(end.cell, ["mousedown", "mouseup", "click"], { shiftKey: true });
    }
    const button = await waitFor(() => commentButton(end), 600);
    if (!button) return null;
    button.click();
    return waitFor(() => {
      const active = document.activeElement;
      if (active instanceof HTMLTextAreaElement && active !== wasActive && fileEl.contains(active)) return active;
      return [...fileEl.querySelectorAll("textarea")].find((ta) => !before.has(ta) && ta.getClientRects().length);
    }, COMMENT_WAIT_MS);
  };

  const insertText = (ta, text) => {
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    const insert = `${ta.value && !ta.value.endsWith("\n") ? "\n" : ""}${text}`;
    // Comment boxes are React-controlled, so a plain .value write is only the fallback.
    if (document.execCommand("insertText", false, insert)) return;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(ta, ta.value + insert);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const COMMENT_RANGE = /lines?\s+[^\d\s]{0,2}(\d+)\s+(?:to|through|-|–)\s+[^\d\s]{0,2}(\d+)/i;

  const formCoversRange = (ta, fileEl, start, end) => {
    for (let el = ta.parentElement, depth = 0; el && el !== fileEl && depth < 8; el = el.parentElement, depth++) {
      const m = el.textContent.match(COMMENT_RANGE);
      if (m) return Number(m[1]) === start.n && Number(m[2]) === end.n;
    }
    return false;
  };

  const suggestFromSelection = async () => {
    const selection = getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) {
      toast("Select lines in the diff first");
      return;
    }
    const range = selection.getRangeAt(0);
    const entry = fileEntries().find(({ el }) => el.contains(range.commonAncestorContainer));
    const [first, last] = selectedRows(range);
    const picked = entry && first && last ? selectedNewLines(first, last) : null;
    if (!picked) {
      toast("Select lines within a single file in the diff");
      return;
    }
    const { lines, deleted } = picked;
    if (!lines.length) {
      toast(deleted ? "Deleted lines can't take a suggestion; select lines on the new side" : "Couldn't read line numbers from the selection");
      return;
    }
    if (lines.some((line, i) => i && line.n !== lines[i - 1].n + 1)) {
      toast("Select lines within one hunk");
      return;
    }
    const start = lines[0];
    const end = lines.at(-1);
    const block = suggestionBlock(lines.map((line) => line.text).join("\n"));
    const where = start === end ? `line R${start.n}` : `lines R${start.n}–R${end.n}`;
    const ta = await openLineComment(entry.el, start, end);
    if (!ta) {
      GM_setClipboard(block, "text");
      toast(`Couldn't open a comment; suggestion copied. Comment on ${where} and paste it`);
      return;
    }
    insertText(ta, block);
    const skipped = deleted ? " (deleted lines left out)" : "";
    if (start !== end && !formCoversRange(ta, entry.el, start, end)) toast(`Suggestion added${skipped}; check the comment covers ${where} before posting`);
    else toast(`Suggestion added${skipped}; edit it and post when ready`);
  };

  const leftoverList = () =>
    (state.files ?? []).flatMap((file) => fileLeftovers(file.filename).map((item) => ({ path: file.filename, ...item })));

  // Classic rows carry id="<file id>R<n>"; otherwise fall back to the row whose last line number (as rowLine reads it) is the new-side line.
  const findLineRow = (entry, line) => {
    const id = entry.el.id || state.pathToId.get(entry.path);
    const cell = id && document.getElementById(`${id}R${line}`);
    if (cell) return cell.closest("tr") ?? cell;
    return [...entry.el.querySelectorAll(`[data-line-number="${line}"]`)]
      .map((node) => node.closest("tr"))
      .find((row) => row && rowLine(row)?.side === "R" && rowLine(row)?.n === line);
  };

  const expandFile = (entry) => {
    userExpanded.add(entry.path);
    const chevron = findChevron(entry);
    if (chevron && !isChevronExpanded(chevron)) {
      clickingChevron = true;
      chevron.click();
      clickingChevron = false;
    } else if ([...entry.el.children].some((child) => child.classList.contains("prr-body-hidden"))) {
      entry.el.querySelector(".prr-btn")?.click();
    }
    delete entry.el.dataset.prrVersion;
    if (entry.actions) processFile(entry);
  };

  const LINE_WAIT_MS = 3000;

  // Expanding a file or letting GitHub load it renders rows asynchronously, so the line is polled for.
  const revealLine = (item) => {
    const deadline = Date.now() + LINE_WAIT_MS;
    let seenEntry = false;
    let askedGithub = false;
    const attempt = () => {
      const entry = fileEntries().find(({ path }) => path === item.path);
      if (entry && !seenEntry) {
        seenEntry = true;
        expandFile(entry);
        entry.el.scrollIntoView({ block: "start", behavior: "auto" });
      }
      const row = entry && findLineRow(entry, item.line);
      if (row) {
        row.scrollIntoView({ block: "center", behavior: "smooth" });
        flash(row);
        return;
      }
      const id = state.pathToId.get(item.path);
      if (!entry && !askedGithub && id) {
        askedGithub = true;
        location.hash = `${id}R${item.line}`;
      }
      if (Date.now() < deadline) {
        setTimeout(attempt, 150);
      } else if (entry) {
        flash(entry.el);
        toast(`Line ${item.line} isn't rendered; the file may need "Load diff"`);
      } else {
        toast(`${item.path.split("/").at(-1)} isn't rendered yet`);
      }
    };
    attempt();
  };

  const jumpToLeftover = (item) => {
    const id = state.pathToId.get(item.path);
    if (FILES_PATH.test(location.pathname)) revealLine(item);
    else goTo(`${tabHref(NAV_TABS[3])}${id ? `#${id}R${item.line}` : ""}`);
  };

  const stepLeftover = (direction) => {
    const items = leftoverList();
    if (!items.length) {
      toast(state.files ? "No debug leftovers in added lines" : "PR diff not loaded yet");
      return;
    }
    leftoverCursor =
      leftoverCursor < 0 ? (direction > 0 ? 0 : items.length - 1) : (leftoverCursor + direction + items.length) % items.length;
    jumpToLeftover(items[leftoverCursor]);
  };

  const discoverAdoBase = () => {
    if (config.adoBase) return config.adoBase;
    const href = document.querySelector("a[href*='/_workitems/edit/']")?.href;
    const base = href?.match(/^(https:\/\/[^?#]*?)\/_workitems\/edit\//)?.[1];
    if (base) store.set("adoBase", base);
    return base ?? store.get("adoBase", "");
  };

  const prTicketSources = () => [
    { text: document.title },
    { text: document.querySelector(".js-issue-title")?.textContent },
    ...[...document.querySelectorAll(".head-ref, [class*='head-ref'], a[href*='/tree/']")]
      .slice(0, 3)
      .map((el) => ({ text: el.textContent, branch: true })),
  ];

  const ticketMatches = (allSources = prTicketSources()) => {
    const sources = allSources.filter((source) => source.text);
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

  const viewedControls = () => {
    const controls = new Map();
    if (!FILES_PATH.test(location.pathname)) return controls;
    const entries = fileEntries();
    for (const { el, path } of entries) {
      // fileEntries can return a wrapper around several files; only the innermost entries are single files.
      if (entries.some((other) => other.el !== el && el.contains(other.el))) continue;
      const control = el.querySelector(VIEWED_CONTROL_SEL);
      if (control) controls.set(path, control);
    }
    return controls;
  };

  // GitHub unticks a file when it changes, so a ticked control means the current SHA was viewed. Records of an older SHA are left alone: that is "changed since viewed".
  const syncViewedRecords = (live) => {
    const records = viewedRecords();
    let dirty = false;
    for (const [path, viewed] of live) {
      const sha = state.shas.get(path);
      const key = digest(path);
      if (!sha || viewed === (records[key] === sha)) continue;
      if (viewed) records[key] = sha;
      else delete records[key];
      dirty = true;
    }
    if (dirty) store.set(viewedKey(), records);
  };

  const isViewedNow = (path, live, records) => {
    const sha = state.shas.get(path);
    return live.get(path) ?? (Boolean(sha) && records[digest(path)] === sha);
  };

  const progressScope = () => (store.get("progressScope", "mine") === "all" ? "all" : "mine");

  const reviewProgress = (live, records, all = progressScope() === "all") => {
    const ownership = config.features.ownership;
    const p = { files: 0, viewedFiles: 0, lines: 0, viewedLines: 0, generated: 0, notMine: 0 };
    for (const { filename, additions, deletions } of state.files) {
      const reason = isGenerated(filename) ? "generated" : ownership && isMine(filename) === false ? "notMine" : null;
      if (reason) p[reason] += 1;
      if (reason && !all) continue;
      p.files += 1;
      p.lines += additions + deletions;
      if (isViewedNow(filename, live, records)) {
        p.viewedFiles += 1;
        p.viewedLines += additions + deletions;
      }
    }
    p.pct = Math.floor(100 * (p.lines ? p.viewedLines / p.lines : p.files ? p.viewedFiles / p.files : 0));
    return p;
  };

  const BULK_GROUPS = [
    { label: "Generated", test: (path) => isGenerated(path) },
    { label: "Tests", test: (path) => categoryOf(path) === "tests" },
    { label: "Not mine", test: (path) => config.features.ownership && isMine(path) === false },
  ];
  const BULK_CLICK_GAP_MS = 150;
  let bulkRunning = false;
  let reviewSnapshot = null;

  const liveViewed = (controls) => new Map([...controls].map(([path, control]) => [path, isViewed(control)]));

  const summaryKey = (pr) => `v3:summary:${digest(pr.key)}`;

  const MAX_DEP_TITLE_LINES = 12;
  const DEP_MARKS = { added: ["+", "prr-add"], removed: ["−", "prr-del"], changed: ["~", "prr-muted"] };

  const allDeps = () => (state.files ?? []).flatMap((file) => file.deps);

  const depCounts = (deps) => ({
    added: deps.filter((dep) => dep.change === "added").length,
    removed: deps.filter((dep) => dep.change === "removed").length,
    changed: deps.filter((dep) => dep.change === "changed").length,
  });

  const depBadgeText = ({ added, removed, changed }) =>
    ["deps", added && `+${added}`, removed && `−${removed}`, changed && `~${changed}`].filter(Boolean).join(" ");

  const depLine = ({ change, name, version, from }) =>
    `${DEP_MARKS[change][0]} ${name} ${change === "changed" && from !== version ? `${from} → ${version}` : (version ?? "")}`.trim();

  const depTitleLines = (deps) => [
    ...deps.slice(0, MAX_DEP_TITLE_LINES).map(depLine),
    deps.length > MAX_DEP_TITLE_LINES ? `and ${deps.length - MAX_DEP_TITLE_LINES} more` : null,
  ].filter(Boolean);

  // PR lists only have the stored records to go on, which lack line counts, so each visit leaves a small summary behind.
  const saveSummary = (snapshot) => {
    if (!config.features.listBadges || !state.files?.length) return;
    const records = viewedRecords();
    const summary = {};
    if (Object.keys(records).length) {
      const [mine, all] =
        snapshot?.progressBoth ?? [false, true].map((everything) => reviewProgress(liveViewed(viewedControls()), records, everything));
      Object.assign(summary, { mine: mine.pct, all: all.pct, mineFiles: mine.files, files: all.files, viewedFiles: all.viewedFiles });
    }
    const deps = allDeps();
    if (deps.length) summary.deps = { ...depCounts(deps), lines: depTitleLines(deps) };
    const saved = store.get(summaryKey(state.pr));
    if (!Object.keys(summary).length) {
      if (saved) GM_deleteValue(summaryKey(state.pr));
      return;
    }
    if (JSON.stringify(saved) !== JSON.stringify(summary)) store.set(summaryKey(state.pr), summary);
  };

  const reviewData = () => {
    if (!state.files || (!panelOpen && !(config.features.reviewProgress && FILES_PATH.test(location.pathname)))) return null;
    const bulkHere = config.features.bulkViewed && FILES_PATH.test(location.pathname);
    if (!config.features.reviewProgress && !bulkHere) return null;
    const live = liveViewed(viewedControls());
    if (config.features.reviewProgress) syncViewedRecords(live);
    const records = viewedRecords();
    const unviewed = state.files.map((f) => f.filename).filter((path) => !isViewedNow(path, live, records));
    return {
      progress: config.features.reviewProgress ? reviewProgress(live, records) : null,
      progressBoth: config.features.reviewProgress ? [reviewProgress(live, records, false), reviewProgress(live, records, true)] : null,
      bulk: bulkHere ? BULK_GROUPS.map((group) => unviewed.filter(group.test).length) : null,
    };
  };

  // Clicks GitHub's own Viewed controls so GitHub persists the state. Files GitHub hasn't rendered have no control yet.
  const markViewed = async (group) => {
    if (bulkRunning || !state.files) return;
    bulkRunning = true;
    renderPanel(true);
    let controls = viewedControls();
    const live = liveViewed(controls);
    const records = viewedRecords();
    const targets = state.files.map((f) => f.filename).filter((path) => group.test(path) && !isViewedNow(path, live, records));
    let marked = 0;
    let missing = 0;
    try {
      for (const path of targets) {
        if (controls.get(path)?.isConnected === false) controls = viewedControls();
        const control = controls.get(path);
        if (!control) {
          missing += 1;
          continue;
        }
        if (isViewed(control)) continue;
        control.click();
        marked += 1;
        await new Promise((resolve) => setTimeout(resolve, BULK_CLICK_GAP_MS));
      }
    } finally {
      bulkRunning = false;
      renderPanel(true);
    }
    const notLoaded = missing ? `${missing} not loaded yet — scroll down and run again` : "";
    if (marked) toast(notLoaded ? `Marked ${marked} viewed; ${notLoaded}` : `Marked ${marked} viewed`, notLoaded ? 5000 : 2000);
    else toast(notLoaded ? `None marked; ${notLoaded}` : "Nothing to mark", notLoaded ? 5000 : 2000);
  };

  const progressSection = (p) => {
    const all = progressScope() === "all";
    const excluded = [p.generated && `${p.generated} generated`, p.notMine && `${p.notMine} not yours`].filter(Boolean);
    const scopeToggle = excluded.length
      ? h(
          "span",
          { class: "prr-seg" },
          ...["mine", "all"].map((option) =>
            h(
              "button",
              {
                class: `prr-btn${option === progressScope() ? " prr-on" : ""}`,
                type: "button",
                title: option === "mine" ? "Skip generated files and files owned by others" : "Count every file",
                onclick: () => {
                  store.set("progressScope", option);
                  renderPanel(true);
                },
              },
              option,
            ),
          ),
        )
      : null;
    return inlineSection(
      "Review progress",
      scopeToggle,
      h(
        "div",
        { class: "prr-meter", role: "progressbar", "aria-label": "Review progress", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": p.pct },
        h("div", { class: "prr-meter-fill", style: `width: ${p.pct}%` }),
      ),
      h(
        "div",
        { title: FILES_PATH.test(location.pathname) ? "" : "Off the Files tab this counts the Viewed ticks this script has recorded for the current version of each file" },
        p.files ? `${p.pct}% · ${p.viewedFiles}/${p.files} files · ${p.viewedLines}/${p.lines} lines` : "No files to review",
      ),
      excluded.length ? h("div", { class: "prr-muted" }, `${all ? "incl." : "excl."} ${excluded.join(", ")}`) : null,
    );
  };

  // GitHub's own "3 / 12 viewed" counter differs between diff views, so it is found by its text rather than a selector.
  const VIEWED_COUNTER = /^\s*\d+\s*\/\s*\d+\s+(files\s+)?viewed\s*$/i;
  let viewedCounter = null;
  let counterSearchedAt = 0;

  const findViewedCounter = () => {
    if (viewedCounter?.isConnected) return viewedCounter;
    if (Date.now() - counterSearchedAt < 1000) return null;
    counterSearchedAt = Date.now();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => (/viewed/i.test(node.data) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      let el = node.parentElement;
      for (let depth = 0; el && depth < 3 && !el.closest("#prr-panel, #prr-modal"); depth++, el = el.parentElement) {
        if (VIEWED_COUNTER.test(el.textContent)) return (viewedCounter = el);
      }
    }
    return null;
  };

  // Keeps one toolkit element beside GitHub's counter, rebuilding it only when its content changes.
  const syncInline = (cls, counter, key, build, side) => {
    const existing = document.querySelector(`.${cls}`);
    const placed = existing && (side === "after" ? existing.previousElementSibling : existing.nextElementSibling) === counter;
    if (placed && existing.dataset.prrKey === key) return;
    existing?.remove();
    if (!counter || !key) return;
    const el = build();
    el.dataset.prrKey = key;
    counter[side](el);
  };

  const progressText = (mine, all) => {
    const split = mine.files && (mine.files !== all.files || mine.lines !== all.lines);
    if (split) return `${mine.pct}% of your lines · ${all.pct}% of all`;
    return all.files ? `${all.pct}% of lines` : "";
  };

  const progressTitle = (mine, all) => {
    const counts = (p) => `${p.viewedFiles}/${p.files} files · ${p.viewedLines}/${p.lines} lines`;
    const excluded = [mine.generated && `${mine.generated} generated`, mine.notMine && `${mine.notMine} not yours`].filter(Boolean);
    return [
      "PR toolkit",
      mine.files && excluded.length ? `Yours: ${counts(mine)} (excl. ${excluded.join(", ")})` : null,
      `Whole PR: ${counts(all)}`,
    ]
      .filter(Boolean)
      .join("\n");
  };

  const INLINE_CLASSES = ["prr-inline-progress", "prr-inline-leftovers", "prr-inline-deps"];
  const isInline = (node) => INLINE_CLASSES.some((cls) => node.classList?.contains(cls));

  const isIconOnly = (node) =>
    node &&
    !node.textContent.trim() &&
    (node.matches("svg") || Boolean(node.querySelector("svg"))) &&
    !node.matches("button, a, [role='button']") &&
    !node.querySelector("button, a, [role='button']");

  // GitHub's progress circle sits beside or around the counter text, so the leftovers badge goes before the whole group.
  const counterGroup = (counter) => {
    let el = counter;
    const text = (node) => [...node.childNodes].filter((child) => !isInline(child)).map((child) => child.textContent).join("");
    const wrapsOnlyCounter = (node) =>
      node !== document.body && VIEWED_COUNTER.test(text(node)) && !node.querySelector("button:not(.prr-inline-leftovers, .prr-inline-deps), a, [role='button']");
    while (el.parentElement && wrapsOnlyCounter(el.parentElement)) el = el.parentElement;
    let prev = el.previousElementSibling;
    while (prev && isInline(prev)) prev = prev.previousElementSibling;
    while (isIconOnly(prev)) {
      el = prev;
      prev = el.previousElementSibling;
    }
    return el;
  };

  const placeInlineIndicators = (snapshot) => {
    const here = FILES_PATH.test(location.pathname);
    const both = here ? snapshot?.progressBoth : null;
    const leftovers = here && config.features.leftovers ? leftoverList() : [];
    const deps = here && config.features.depSummary ? allDeps() : [];
    const counter = both || leftovers.length || deps.length ? findViewedCounter() : null;
    const text = both ? progressText(...both) : "";
    const title = both ? progressTitle(...both) : "";
    syncInline("prr-inline-progress", counter, text && `${text}|${title}`, () => h("span", { class: "prr-inline-progress", title }, text), "after");
    const count = leftovers.length;
    syncInline(
      "prr-inline-leftovers",
      counter && counterGroup(counter),
      count ? String(count) : "",
      () =>
        h(
          "button",
          { class: "prr-badge prr-warn prr-inline-leftovers", type: "button", title: "Debug leftovers in added lines: jump to the next (Alt+L)", onclick: () => stepLeftover(1) },
          `${count} leftover${count === 1 ? "" : "s"}`,
        ),
      "before",
    );
    const depText = deps.length ? depBadgeText(depCounts(deps)) : "";
    const depTitle = ["Dependency changes: show them in the panel", ...depTitleLines(deps)].join("\n");
    syncInline(
      "prr-inline-deps",
      counter && (document.querySelector(".prr-inline-leftovers") ?? counterGroup(counter)),
      depText && `${depText}|${depTitle}`,
      () => h("button", { class: "prr-badge prr-muted prr-inline-deps", type: "button", title: depTitle, onclick: showDepsInPanel }, depText),
      "before",
    );
  };

  const showDepsInPanel = () => {
    if (!panelOpen) {
      panelOpen = true;
      store.set("panelOpen", true);
      renderPanel(true);
    }
    document.querySelector("#prr-panel .prr-deps-section")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  const bulkSection = (counts) =>
    section(
      "Mark viewed",
      h(
        "div",
        { class: "prr-bulk" },
        ...BULK_GROUPS.map((group, i) =>
          counts[i]
            ? h(
                "button",
                {
                  class: "prr-btn",
                  type: "button",
                  disabled: bulkRunning,
                  title: `Tick Viewed on the ${counts[i]} unviewed ${group.label.toLowerCase()} files`,
                  onclick: () => markViewed(group),
                },
                `${group.label} (${counts[i]})`,
              )
            : null,
        ),
      ),
    );

  const section = (title, ...body) => h("div", { class: "prr-section" }, h("div", { class: "prr-title" }, title), ...body);

  const inlineSection = (title, control, ...detail) =>
    h(
      "div",
      { class: "prr-section" },
      h("div", { class: "prr-row" }, h("span", { class: "prr-title prr-inline-title" }, title), control),
      ...detail,
    );

  const MAX_PANEL_ROWS = 8;
  const MAX_DEP_ROWS = 25;

  const SECTION_TAGS = { devDependencies: "dev", peerDependencies: "peer", optionalDependencies: "optional", dependencies: "" };

  const depRow = ({ change, name, version, from, section, fromSection }) => {
    const [mark, tone] = DEP_MARKS[change];
    const tag = SECTION_TAGS[section] ?? section;
    const detail =
      change !== "changed" ? version : from === version ? `${fromSection} → ${section}` : `${from} → ${version}`;
    return h(
      "div",
      { class: "prr-row", title: [name, section, detail].filter(Boolean).join(" · ") },
      h("span", { class: "prr-dep-name" }, h("span", { class: tone }, mark), ` ${name}`, tag ? h("span", { class: "prr-muted" }, ` ${tag}`) : null),
      h("span", { class: "prr-muted prr-dep-version" }, detail),
    );
  };

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
                    const el = findFileEl(path);
                    if (el) scrollToFile(el, "smooth");
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

    // The meter is a summary, so it goes first.
    if (reviewSnapshot?.progress) out.unshift(progressSection(reviewSnapshot.progress));
    if (reviewSnapshot?.bulk?.some(Boolean)) out.push(bulkSection(reviewSnapshot.bulk));
    if (config.features.leftovers && state.files) {
      const items = leftoverList();
      if (items.length) {
        out.push(
          inlineSection(
            `Debug leftovers (${items.length})`,
            h(
              "span",
              { class: "prr-seg" },
              h("button", { class: "prr-btn", type: "button", title: "Alt+Shift+L", onclick: () => stepLeftover(-1) }, "◀ Prev"),
              h("button", { class: "prr-btn", type: "button", title: "Alt+L", onclick: () => stepLeftover(1) }, "Next ▶"),
            ),
            ...items.slice(0, MAX_PANEL_ROWS).map((item, index) =>
              h(
                "a",
                {
                  href: "#",
                  class: "prr-block",
                  title: `${item.path}:${item.line}\n${item.text}`,
                  onclick: (e) => {
                    e.preventDefault();
                    leftoverCursor = index;
                    jumpToLeftover(item);
                  },
                },
                `${item.path.split("/").at(-1)}:${item.line} `,
                h("span", { class: "prr-muted" }, item.label),
              ),
            ),
            items.length > MAX_PANEL_ROWS ? h("div", { class: "prr-muted" }, `and ${items.length - MAX_PANEL_ROWS} more (Alt+L)`) : null,
          ),
        );
      }
    }

    if (config.features.depSummary && state.files) {
      const manifests = state.files.filter((file) => file.deps.length);
      const total = manifests.reduce((sum, file) => sum + file.deps.length, 0);
      if (total) {
        let budget = MAX_DEP_ROWS;
        const body = manifests.flatMap((file) => {
          if (budget <= 0) return [];
          const rows = file.deps.slice(0, budget).map(depRow);
          budget -= rows.length;
          return [h("div", { class: "prr-block prr-muted prr-dep-file", title: file.filename }, file.filename), ...rows];
        });
        const deps = section(
          `Dependencies (${total})`,
          ...body,
          total > MAX_DEP_ROWS ? h("div", { class: "prr-muted" }, `and ${total - MAX_DEP_ROWS} more`) : null,
        );
        deps.classList.add("prr-deps-section");
        out.push(deps);
      }
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

  // Outside a repo there is no per-repo list, so GitHub's global /pulls (which defaults to "Created") is the fallback.
  const myPrsHref = () => {
    const login = document.querySelector("meta[name='user-login']")?.content;
    const nwo = state.pr ? `${state.pr.owner}/${state.pr.repo}` : document.querySelector("meta[name='octolytics-dimension-repository_nwo']")?.content;
    return login && nwo ? `/${nwo}/pulls/${encodeURIComponent(login)}` : "/pulls";
  };

  const ticketChip = ([id, url]) =>
    url
      ? h("a", { class: "prr-chip", href: url, target: "_blank", rel: "noreferrer", title: `Open ${id}` }, id)
      : h("span", { class: "prr-chip", title: "No link known for this ticket; see adoBase in the config" }, id);

  const ticketChips = () => (config.features.tickets ? ticketMatches().map(ticketChip) : []);

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
    { keys: ["Alt", "P"], label: "Jump to a file by name", feature: "filePalette" },
    { keys: ["Alt", "M"], label: "Open your pull requests", feature: "myPrs" },
    { keys: ["Alt", "G"], label: "Suggest a change on the selected lines", feature: "suggestFromSelection", filesOnly: true },
    { keys: ["Alt", "L"], label: "Next debug leftover", feature: "leftovers", filesOnly: true },
    { keys: ["Alt", "Shift", "L"], label: "Previous debug leftover", feature: "leftovers", filesOnly: true },
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
        const leftoverPatterns = JSON.stringify(config.leftoverPatterns);
        store.set("config", {});
        config = loadConfig();
        applyConfigChange();
        if (state.pr && JSON.stringify(config.leftoverPatterns) !== leftoverPatterns) loadData(state.pr);
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
    reviewSnapshot = reviewData();
    placeInlineIndicators(reviewSnapshot);
    saveSummary(reviewSnapshot);
    const signature = JSON.stringify([
      state.version,
      unresolvedThreads().length,
      document.querySelectorAll(".prr-noise").length,
      document.body.classList.contains("prr-hide-noise"),
      panelOpen,
      config.features.tickets ? ticketMatches().map(([id, url]) => id + url).join() : "",
      location.pathname,
      reviewSnapshot,
      bulkRunning,
      progressScope(),
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

  // Server state at page load, from the React payload. Only trusted when that payload was rendered for this PR; null when it says nothing.
  const payloadPendingCount = () => {
    const prPath = `/${state.pr.owner}/${state.pr.repo}/pull/${state.pr.number}`.toLowerCase();
    for (const app of document.querySelectorAll("react-app[initial-path]")) {
      const initial = app.getAttribute("initial-path").toLowerCase();
      if (initial !== prPath && !initial.startsWith(`${prPath}/`)) continue;
      const json = app.querySelector("script[data-target='react-app.embeddedData']")?.textContent ?? "";
      if (!json.includes('"viewerPendingReview"')) continue;
      try {
        const review = findKey(JSON.parse(json), "viewerPendingReview");
        return review?.id ? (review.comments?.length ?? 0) : 0;
      } catch {}
    }
    return null;
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
  const pendingReview = { key: "", count: 0, known: false };

  const pendingReviewCount = () => (config.features.pendingReviewGuard ? currentPendingCount() : 0);

  const currentPendingCount = () => {
    if (!state.pr) return 0;
    if (pendingReview.key !== state.pr.key) {
      const payload = payloadPendingCount();
      Object.assign(pendingReview, { key: state.pr.key, count: payload ?? 0, known: payload !== null });
    }
    const live = livePendingCount();
    if (live !== null) Object.assign(pendingReview, { count: live, known: true });
    return pendingReview.count;
  };

  // Stored under the plain PR key (unlike the hashed per-PR keys) so lists can name PRs that aren't on the current page; an entry only lives while a review is pending.
  const savePendingReview = () => {
    if (!config.features.listBadges || !state.pr) return;
    const count = currentPendingCount();
    const pending = store.get("pendingReviews", {});
    const entry = pending[state.pr.key];
    if (!count) {
      if (!entry || !pendingReview.known) return;
      delete pending[state.pr.key];
    } else {
      if (entry?.count === count && Date.now() - entry.at < DAY_MS) return;
      const title = document.title.split(" · ")[0].replace(/ by [\w-]+$/, "").trim();
      pending[state.pr.key] = { count, title: title || entry?.title || "", at: Date.now() };
    }
    store.set("pendingReviews", pending);
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

  const LIST_PAGE = /^\/(pulls|issues|search)(\/|$)|^\/[^/]+\/[^/]+\/(pulls|issues)(\/|$)/;
  const PR_HREF = /^(?:https:\/\/github\.com)?\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/;
  const OIDS_TTL_MS = 5 * 60_000;
  const OIDS_PARALLEL = 4;
  const oidsCache = new Map();
  const oidsQueue = [];
  let oidsInFlight = 0;

  const pumpOids = () => {
    while (oidsInFlight < OIDS_PARALLEL && oidsQueue.length) {
      const pr = oidsQueue.shift();
      oidsInFlight += 1;
      loadCommitOids(pr).then((oids) => {
        oidsCache.set(pr.key, { oids, at: Date.now() });
        oidsInFlight -= 1;
        pumpOids();
        decorateElsewhere();
      });
    }
  };

  // Only PRs with a recorded last look are fetched, so a list of PRs you never reviewed costs nothing.
  const cachedOids = (pr) => {
    const hit = oidsCache.get(pr.key);
    if (hit && (hit.pending || Date.now() - hit.at < OIDS_TTL_MS)) return hit.oids ?? null;
    oidsCache.set(pr.key, { ...hit, pending: true });
    oidsQueue.push(pr);
    pumpOids();
    return hit?.oids ?? null;
  };

  const listBadges = (pr) => {
    const summary = store.get(summaryKey(pr));
    const look = config.features.sinceLastLook && store.get(lastLookKey(pr)) ? sinceLastLook(pr, cachedOids(pr)) : null;
    const badges = [];
    if (summary?.files) {
      const scoped = summary.mineFiles > 0 && summary.mineFiles < summary.files;
      const pct = scoped ? summary.mine : summary.all;
      const share = scoped ? `${summary.mine}% of your lines, ${summary.all}% of all` : `${summary.all}% of lines`;
      const title = `${summary.viewedFiles}/${summary.files} files viewed · ${share} (as of your last visit)`;
      badges.push(h("span", { class: `prr-badge ${pct >= 100 ? "prr-done" : "prr-muted"}`, title }, pct >= 100 ? "✓ reviewed" : `${pct}% reviewed`));
    }
    if (summary?.deps && config.features.depSummary) {
      const title = ["Dependency changes (as of your last visit)", ...summary.deps.lines].join("\n");
      badges.push(h("span", { class: "prr-badge prr-muted", title }, depBadgeText(summary.deps)));
    }
    const pending = store.get("pendingReviews", {})[pr.key];
    if (pending) {
      const title = `Your unsubmitted review has ${pending.count} comment${pending.count === 1 ? "" : "s"} (as of your last visit)`;
      const href = `/${pr.owner}/${pr.repo}/pull/${pr.number}/files`;
      badges.push(h("a", { class: "prr-badge prr-warn", href, title }, `✎ ${pending.count} unsubmitted`));
    }
    if (look) {
      const text = look.rewritten ? "force-pushed" : `${look.count} new commit${look.count === 1 ? "" : "s"}`;
      const title = `Since your last look: ${look.seen.slice(0, 7)}..${look.head.slice(0, 7)}`;
      badges.push(h("a", { class: "prr-badge prr-new", href: lastLookHref(look, pr), title }, text));
    }
    return badges;
  };

  // React may re-render the host and drop our node, so each pass compares what it would insert with what is there.
  const placeMeta = (anchor, kids) => {
    const existing = anchor.nextElementSibling?.classList.contains("prr-meta") ? anchor.nextElementSibling : null;
    if (!kids.length) {
      existing?.remove();
      return;
    }
    const meta = h("span", { class: "prr-meta" }, ...kids);
    if (existing?.innerHTML === meta.innerHTML) return;
    if (existing) existing.replaceWith(meta);
    else anchor.after(meta);
  };

  const elsewhereTickets = (sources) =>
    config.features.tickets && config.features.ticketsElsewhere ? ticketMatches(sources).map(ticketChip) : [];

  const decoratePrLinks = () => {
    if (!LIST_PAGE.test(location.pathname) || !(config.features.listBadges || config.features.ticketsElsewhere)) return;
    for (const anchor of document.querySelectorAll("a[data-hovercard-type='pull_request'], a.js-navigation-open[href*='/pull/']")) {
      const m = anchor.getAttribute("href")?.match(PR_HREF);
      if (!m || !anchor.textContent.trim() || anchor.closest(".comment-body, .markdown-body, .prr-meta")) continue;
      const [, owner, repo, number] = m;
      const pr = { owner, repo, number: Number(number), key: `${owner}/${repo}#${number}` };
      placeMeta(anchor, [...(config.features.listBadges ? listBadges(pr) : []), ...elsewhereTickets([{ text: anchor.textContent }])]);
    }
  };

  const BRANCHES_PAGE = /^\/([^/]+)\/([^/]+)\/branches(\/|$)/;
  const COMMITS_PAGE = /^\/([^/]+)\/([^/]+)\/(commits|commit)(\/|$)/;
  const SHA_TEXT = /^[0-9a-f]{7,40}$/i;

  const decorateBranches = () => {
    const m = location.pathname.match(BRANCHES_PAGE);
    if (!m) return;
    const prefix = `/${m[1]}/${m[2]}/tree/`;
    for (const anchor of document.querySelectorAll(`a[href^="${prefix}"]`)) {
      const name = decodeURIComponent(anchor.getAttribute("href").slice(prefix.length));
      if (anchor.textContent.trim() !== name) continue;
      placeMeta(anchor, elsewhereTickets([{ text: name, branch: true }]));
    }
  };

  const decorateCommits = () => {
    const m = location.pathname.match(COMMITS_PAGE);
    if (!m) return;
    for (const anchor of document.querySelectorAll(`a[href^="/${m[1]}/${m[2]}/commit/"]`)) {
      const text = anchor.textContent.trim();
      if (!text || SHA_TEXT.test(text) || anchor.closest(".prr-meta")) continue;
      placeMeta(anchor, elsewhereTickets([{ text }]));
    }
    // A single commit's page shows its message as plain text; GitHub also puts it at the front of the document title.
    if (m[3] !== "commit") return;
    const message = document.title.split(" · ")[0].trim();
    const heading = [...document.querySelectorAll("main h1, main .commit-title")].find(
      (el) => el.textContent.trim() && message.startsWith(el.textContent.trim().slice(0, 40)),
    );
    if (heading) placeMeta(heading, elsewhereTickets([{ text: message }]));
  };

  let pendingListOpen = false;

  const placePendingList = () => {
    const entries = Object.entries(store.get("pendingReviews", {})).sort(([, a], [, b]) => b.at - a.at);
    const existing = document.getElementById("prr-pending");
    if (!config.features.listBadges || !LIST_PAGE.test(location.pathname) || !entries.length) {
      existing?.remove();
      return;
    }
    const signature = JSON.stringify([entries, pendingListOpen]);
    if (existing?.dataset.signature === signature) return;
    const toggle = () => {
      pendingListOpen = !pendingListOpen;
      placePendingList();
    };
    const box = h(
      "div",
      { id: "prr-pending", class: pendingListOpen ? "" : "prr-closed", "data-signature": signature },
      h("button", { class: "prr-btn prr-pending-toggle", type: "button", onclick: toggle }, `✎ ${entries.length} unsubmitted review${entries.length === 1 ? "" : "s"}`),
      pendingListOpen
        ? h(
            "div",
            { class: "prr-pending-list" },
            ...entries.map(([key, { count, title }]) => {
              const [, owner, repo, number] = key.match(/^([^/]+)\/([^#]+)#(\d+)$/);
              return h(
                "a",
                { class: "prr-pending-row", href: `/${owner}/${repo}/pull/${number}/files`, title: `${count} pending comment${count === 1 ? "" : "s"}` },
                h("span", { class: "prr-block" }, title || key),
                h("span", { class: "prr-muted" }, `${key} · ${count}`),
              );
            }),
            h("div", { class: "prr-muted prr-pending-note" }, "As of your last visit to each PR. Submitted elsewhere? Open the PR once to clear it."),
          )
        : null,
    );
    if (existing) existing.replaceWith(box);
    else document.body.append(box);
  };

  const decorateElsewhere = () => {
    if (state.pr) {
      document.getElementById("prr-pending")?.remove();
      return;
    }
    placePendingList();
    decoratePrLinks();
    if (config.features.tickets && config.features.ticketsElsewhere) {
      decorateBranches();
      decorateCommits();
    }
  };

  const scan = () => {
    const pr = prContext();
    if (!pr) {
      document.getElementById("prr-panel")?.remove();
      state.pr = null;
      decorateElsewhere();
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
    savePendingReview();
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
    .prr-badge { display: inline-flex; align-items: center; align-self: center; vertical-align: middle; font-size: 11px; line-height: 16px;
      padding: 1px 6px; margin-right: 6px; border-radius: 999px; white-space: nowrap; }
    .prr-inline-progress { display: inline-flex; align-items: center; align-self: center; vertical-align: middle; margin-left: 8px; font-size: 12px;
      white-space: nowrap; color: var(--fgColor-muted, #656d76); font-variant-numeric: tabular-nums; }
    .prr-inline-leftovers, .prr-inline-deps { margin: 0 8px 0 0; font-family: inherit; cursor: pointer; }
    .prr-inline-leftovers { border: 0; }
    .prr-inline-deps { color: var(--fgColor-muted, #656d76); background: transparent; }
    .prr-inline-leftovers:hover, .prr-inline-deps:hover { text-decoration: underline; }
    .prr-meta { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-left: 6px; vertical-align: middle;
      font-size: 11px; font-weight: 400; line-height: 16px; }
    .prr-meta .prr-badge { margin-right: 0; text-decoration: none; }
    .prr-meta .prr-chip { padding: 0 6px; }
    #prr-pending { position: fixed; right: 16px; bottom: 16px; z-index: 90; width: 320px; max-height: 60vh; overflow: auto; font-size: 12px;
      line-height: 1.5; background: var(--overlay-bgColor, var(--bgColor-default, #fff)); color: var(--fgColor-default, #1f2328);
      border: 1px solid var(--borderColor-default, #d0d7de); border-radius: 12px; box-shadow: var(--shadow-floating-large, 0 8px 24px rgba(140,149,159,.2)); }
    #prr-pending.prr-closed { width: auto; }
    #prr-pending .prr-pending-toggle { margin: 6px; border-color: transparent; background: transparent; font-weight: 500; }
    .prr-pending-list { border-top: 1px solid var(--borderColor-muted, #d8dee4); padding: 4px 0; }
    .prr-pending-row { display: block; padding: 4px 14px; color: inherit; text-decoration: none; }
    .prr-pending-row:hover { background: var(--control-bgColor-hover, #eaeef2); text-decoration: none; }
    .prr-pending-note { padding: 6px 14px 4px; font-size: 11px; }
    .prr-done { background: var(--bgColor-success-muted, #dafbe1); color: var(--fgColor-success, #1a7f37); }
    a.prr-new { background: var(--bgColor-accent-muted, #ddf4ff); color: var(--fgColor-accent, #0969da); }
    a.prr-new:hover { text-decoration: underline; }
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
    .prr-meter { height: 6px; margin: 6px 0 4px; border-radius: 999px; overflow: hidden; background: var(--bgColor-neutral-muted, #afb8c133); }
    .prr-meter-fill { height: 100%; border-radius: inherit; background: var(--bgColor-success-emphasis, #1f883d); transition: width .2s; }
    .prr-bulk { display: flex; flex-wrap: wrap; gap: 4px; }
    .prr-bulk .prr-btn { margin-left: 0; }
    .prr-btn:disabled { opacity: .6; cursor: progress; }
    #prr-modal[data-modal="palette"] { align-items: flex-start; padding-top: 12vh; }
    #prr-modal[data-modal="palette"] .prr-modal-card { width: min(640px, calc(100vw - 32px)); }
    .prr-palette-input { width: 100%; box-sizing: border-box; padding: 6px 10px; font: inherit; border-radius: 6px; color: inherit;
      border: 1px solid var(--borderColor-default, #d0d7de); background: var(--bgColor-default, #fff); }
    .prr-palette-input:focus { outline: 2px solid var(--focus-outlineColor, #0969da); outline-offset: -1px; }
    .prr-palette-list { list-style: none; margin: 8px -8px 0; padding: 0; max-height: 50vh; overflow: auto; }
    .prr-palette-item { display: flex; align-items: center; gap: 12px; padding: 4px 8px; border-radius: 6px; cursor: pointer; }
    .prr-palette-item[aria-selected="true"] { background: var(--bgColor-accent-muted, #ddf4ff); }
    .prr-palette-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .prr-palette-meta { flex: none; display: flex; align-items: center; gap: 6px; font-variant-numeric: tabular-nums; }
    .prr-palette-meta .prr-tree-dot, .prr-palette-meta .prr-badge { margin: 0; }
    .prr-palette-empty { padding: 4px 8px; }
    .prr-dep-file { margin-top: 4px; font-size: 11px; }
    .prr-dep-name, .prr-dep-version { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .prr-dep-version { flex: 0 1 auto; max-width: 55%; }
    .prr-look { display: flex; align-items: center; gap: 6px; flex: none; }
    .prr-look .prr-btn { margin: 0; }
  `);

  GM_registerMenuCommand("Edit config (JSON)", () => {
    const edited = prompt("Config JSON (snippets, ticketRules, ticketIgnorePrefixes, adoBase, generatedPatterns, myOwners, minePatterns, leftoverPatterns, features):", JSON.stringify(config));
    if (edited === null) return;
    try {
      const leftoverPatterns = JSON.stringify(config.leftoverPatterns);
      config = { ...DEFAULTS, ...JSON.parse(edited) };
      config.features = { ...DEFAULTS.features, ...config.features };
      saveConfig();
      state.version += 1;
      scan();
      renderPanel(true);
      // Leftovers are found while parsing the diff, so new patterns need a re-fetch.
      if (state.pr && JSON.stringify(config.leftoverPatterns) !== leftoverPatterns) loadData(state.pr);
    } catch (err) {
      alert(`Invalid JSON: ${err.message}`);
    }
  });
  GM_registerMenuCommand("Reset config", () => {
    const leftoverPatterns = JSON.stringify(config.leftoverPatterns);
    store.set("config", {});
    config = loadConfig();
    state.version += 1;
    scan();
    renderPanel(true);
    if (state.pr && JSON.stringify(config.leftoverPatterns) !== leftoverPatterns) loadData(state.pr);
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
    if (altOnly && config.features.myPrs && event.code === "KeyM") {
      event.preventDefault();
      goTo(myPrsHref());
      return;
    }
    if (altOnly && state.pr && config.features.filePalette && event.code === "KeyP") {
      event.preventDefault();
      togglePalette();
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
      if (config.features.suggestFromSelection && event.code === "KeyG") {
        event.preventDefault();
        suggestFromSelection();
        return;
      }
      if (config.features.leftovers && event.code === "KeyL") {
        event.preventDefault();
        stepLeftover(event.shiftKey ? -1 : 1);
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
