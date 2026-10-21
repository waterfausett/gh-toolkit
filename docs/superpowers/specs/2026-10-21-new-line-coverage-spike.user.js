// ==UserScript==
// @name         SPIKE: PR coverage on new lines
// @namespace    https://github.com/waterfausett
// @version      0.0.1
// @description  Throwaway: can we get Cobertura coverage from Actions artifacts with only the session cookie?
// @match        https://github.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      github.com
// @connect      *
// ==/UserScript==

(() => {
  "use strict";

  const log = (...a) => console.log("%c[cov-spike]", "color:#bf3989;font-weight:bold", ...a);

  const req = (url, responseType) =>
    new Promise((resolve) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        responseType,
        onload: (res) => resolve(res),
        onerror: (e) => resolve({ status: 0, error: e }),
        ontimeout: () => resolve({ status: 0, error: "timeout" }),
      });
    });

  const html = (text) => new DOMParser().parseFromString(text, "text/html");

  // --- zip (central directory + native deflate-raw) ---
  const inflate = async (bytes) =>
    new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());

  const unzip = async (buf, want) => {
    const dv = new DataView(buf);
    const u8 = new Uint8Array(buf);
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("not a zip (no EOCD)");
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const out = [];
    const names = [];
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("bad central dir entry");
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true);
      const elen = dv.getUint16(p + 30, true);
      const clen = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nlen));
      names.push(name);
      p += 46 + nlen + elen + clen;
      if (!want(name)) continue;
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      const raw = u8.subarray(start, start + csize);
      const data = method === 0 ? raw : method === 8 ? await inflate(raw) : null;
      if (!data) { log("skip (compression method", method, ")", name); continue; }
      out.push({ name, text: new TextDecoder().decode(data) });
    }
    return { names, files: out };
  };

  // --- cobertura ---
  // path -> Map(line -> hits); a line is covered if any report hit it.
  const addCobertura = (xmlText, cov) => {
    const doc = new DOMParser().parseFromString(xmlText, "text/xml");
    const sources = [...doc.querySelectorAll("sources > source")].map((s) => s.textContent.trim().replace(/\/$/, ""));
    let classes = 0;
    for (const cls of doc.querySelectorAll("class[filename]")) {
      classes++;
      const fn = cls.getAttribute("filename");
      const keys = [fn, ...sources.map((s) => `${s}/${fn}`)];
      const lines = new Map();
      for (const l of cls.querySelectorAll("line[number]")) {
        const n = Number(l.getAttribute("number"));
        lines.set(n, Math.max(lines.get(n) ?? 0, Number(l.getAttribute("hits")) || 0));
      }
      for (const k of keys) {
        const prev = cov.get(k);
        if (!prev) { cov.set(k, new Map(lines)); continue; }
        for (const [n, h] of lines) prev.set(n, Math.max(prev.get(n) ?? 0, h));
      }
    }
    return { sources, classes };
  };

  const findCoverage = (path, cov) => {
    const strong = [...cov.keys()].filter((k) => k === path || k.endsWith("/" + path));
    if (strong.length) return cov.get(strong.sort((a, b) => a.length - b.length)[0]);
    const weak = [...cov.keys()].filter((k) => path.endsWith("/" + k)).sort((a, b) => b.length - a.length);
    return weak.length ? cov.get(weak[0]) : null;
  };

  // --- diff: added lines (new-side numbers) per file ---
  const addedLines = (diff) => {
    const files = new Map();
    let cur = null;
    let n = 0;
    for (const line of diff.split("\n")) {
      if (line.startsWith("diff --git ")) { cur = null; continue; }
      if (line.startsWith("+++ ")) {
        const path = line.slice(4).replace(/^b\//, "");
        cur = path === "/dev/null" ? null : path;
        if (cur) files.set(cur, []);
        continue;
      }
      const h = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
      if (h) { n = Number(h[1]); continue; }
      if (!cur || line.startsWith("--- ")) continue;
      if (line[0] === "+") files.get(cur).push(n++);
      else if (line[0] === " ") n++;
    }
    return files;
  };

  const sizeMB = (t) => {
    const m = t.match(/([\d.]+)\s*(KB|MB|GB|Bytes?)/i);
    if (!m) return null;
    return Number(m[1]) * ({ kb: 1 / 1024, mb: 1, gb: 1024 }[m[2].toLowerCase()] ?? 1 / 1048576);
  };

  const run = async () => {
    const m = location.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (!m) return alert("Open a PR first");
    const [, owner, repo, num] = m;
    const base = `https://github.com/${owner}/${repo}`;
    console.group("[cov-spike] " + `${owner}/${repo}#${num}`);
    try {
      // 1. runs for the PR head, from the checks page
      const checks = await req(`${base}/pull/${num}/checks`);
      log("checks page", checks.status, (checks.responseText || "").length, "chars");
      const runIds = [...new Set([...(checks.responseText || "").matchAll(/\/actions\/runs\/(\d+)/g)].map((x) => x[1]))];
      log("run ids found:", runIds);
      if (!runIds.length) throw new Error("no Actions runs found on the checks page");

      // 2. artifacts per run, from the run page
      const artifacts = [];
      for (const id of runIds) {
        const page = await req(`${base}/actions/runs/${id}`);
        const doc = html(page.responseText || "");
        const rows = [...doc.querySelectorAll("[data-artifact-id]")];
        for (const r of rows) {
          const tds = r.querySelectorAll("td");
          artifacts.push({
            run: id,
            id: r.getAttribute("data-artifact-id"),
            name: r.querySelector(".text-bold")?.textContent.trim(),
            size: tds[1]?.textContent.trim(),
            expired: /expired/i.test(r.textContent),
          });
        }
        log(`run ${id}: page ${page.status}, ${rows.length} artifact rows`);
      }
      console.table(artifacts);

      let picked = artifacts.filter((a) => /cov/i.test(a.name) && !a.expired);
      if (!picked.length) {
        log("no artifact names match /cov/i; trying every artifact under 50 MB");
        picked = artifacts.filter((a) => !a.expired && (sizeMB(a.size ?? "") ?? 0) < 50);
      }

      // 3. download + unzip + parse
      const cov = new Map();
      for (const a of picked) {
        const t0 = performance.now();
        const res = await req(`${base}/actions/runs/${a.run}/artifacts/${a.id}`, "arraybuffer");
        const bytes = res.response?.byteLength ?? 0;
        log(`artifact "${a.name}": status ${res.status}, ${(bytes / 1048576).toFixed(2)} MB, ${Math.round(performance.now() - t0)} ms, final host ${res.finalUrl ? new URL(res.finalUrl).host : "?"}`);
        if (res.status !== 200 || !bytes) { log("  download failed", res.error ?? res.responseHeaders); continue; }
        try {
          const { names, files } = await unzip(res.response, (n) => /\.xml$/i.test(n));
          log(`  zip has ${names.length} entries; xml:`, files.map((f) => f.name));
          for (const f of files) {
            if (!/<coverage[\s>]/.test(f.text.slice(0, 2000))) continue;
            const r = addCobertura(f.text, cov);
            log(`  cobertura ${f.name}: ${r.classes} files, sources`, r.sources);
          }
        } catch (e) {
          log("  unzip/parse failed:", e);
        }
      }
      log("coverage keys (first 10):", [...cov.keys()].slice(0, 10));

      // 4. intersect with the PR's added lines
      const diff = await req(`${base}/pull/${num}.diff`);
      const added = addedLines(diff.responseText || "");
      const rows = [];
      let totCov = 0, totHit = 0;
      for (const [path, lines] of added) {
        if (!lines.length) continue;
        const fc = findCoverage(path, cov);
        if (!fc) { rows.push({ path, added: lines.length, measured: "-", covered: "-", pct: "no data", missed: "" }); continue; }
        const measured = lines.filter((l) => fc.has(l));
        const missed = measured.filter((l) => !fc.get(l));
        totCov += measured.length;
        totHit += measured.length - missed.length;
        rows.push({
          path,
          added: lines.length,
          measured: measured.length,
          covered: measured.length - missed.length,
          pct: measured.length ? Math.round((100 * (measured.length - missed.length)) / measured.length) + "%" : "n/a",
          missed: missed.join(", "),
        });
      }
      console.table(rows);
      const summary = totCov
        ? `New-line coverage: ${totHit}/${totCov} = ${((100 * totHit) / totCov).toFixed(1)}%`
        : "No measured new lines (no coverage matched the changed files)";
      log(summary);
      alert(`[cov-spike] ${summary}\n\nDetails are in the DevTools console.`);
    } catch (e) {
      log("FAILED:", e);
      alert("[cov-spike] failed: " + e.message + "\nSee the DevTools console.");
    } finally {
      console.groupEnd();
    }
  };

  GM_registerMenuCommand("Coverage spike: run on this PR", run);
})();
