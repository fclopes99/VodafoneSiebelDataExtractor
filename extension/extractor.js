// Siebel Table Extractor - runs inside the Siebel tab.
// Finds the Siebel list (jqGrid), walks through every page with the "next" arrow,
// removes the rows Siebel repeats on the last page, and downloads an .xlsx file.
(function () {
  "use strict";

  if (window.__steExtractor) {
    window.__steExtractor.show();
    return;
  }

  const VERSION = (() => {
    try { return chrome.runtime.getManifest().version; } catch (_) { return "dev"; }
  })();

  const PAGE_TIMEOUT_MS = 60000; // max wait for Siebel to load one page
  const MAX_PAGES = 5000;

  // ------------------------------------------------------------------ utils
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (s) => String(s == null ? "" : s).replace(/ /g, " ").replace(/[ \t]+\n/g, "\n").trim();

  const logLines = [];
  function log(msg) {
    const line = new Date().toISOString().slice(11, 19) + "  " + msg;
    logLines.push(line);
    if (logLines.length > 200) logLines.shift();
  }

  function isHidden(el) {
    if (!el) return true;
    if (el.style && el.style.display === "none") return true;
    try {
      const cs = el.ownerDocument.defaultView.getComputedStyle(el);
      return cs.display === "none";
    } catch (_) {
      return false;
    }
  }

  // All documents we can reach: the page plus same-origin iframes.
  function allDocuments() {
    const docs = [document];
    for (let i = 0; i < docs.length; i++) {
      docs[i].querySelectorAll("iframe, frame").forEach((f) => {
        try { if (f.contentDocument) docs.push(f.contentDocument); } catch (_) { /* cross-origin */ }
      });
    }
    return docs;
  }

  // ------------------------------------------------------------------ Siebel grid helpers
  function findGrids() {
    const grids = [];
    for (const doc of allDocuments()) {
      doc.querySelectorAll("table.ui-jqgrid-btable[id]").forEach((table) => {
        const rows = table.querySelectorAll("tr.jqgrow");
        if (!rows.length || isHidden(table)) return;
        grids.push(describeGrid(table));
      });
    }
    return grids;
  }

  function describeGrid(table) {
    const doc = table.ownerDocument;
    const id = table.id; // e.g. "s_1_l"
    const applet = table.closest(".siebui-applet") || table.closest("[id^='S_A']");
    let title = "";
    if (applet) {
      const t = applet.querySelector(".siebui-applet-title");
      if (t) title = clean(t.textContent);
    }
    if (!title) title = clean(table.getAttribute("summary")) || id;

    let counter = doc.getElementById(id.replace(/_l$/, "_rc"));
    if (!counter && applet) counter = applet.querySelector(".siebui-row-counter");

    return { id, doc, table, title, counter };
  }

  function getColumns(grid) {
    const { id, doc, table } = grid;
    const box = table.closest(".ui-jqgrid") || doc;
    let ths = Array.from(box.querySelectorAll("table.ui-jqgrid-htable th[id^='" + id + "_']"));
    if (!ths.length) ths = Array.from(doc.querySelectorAll("th[id^='" + id + "_']"));
    const cols = [];
    ths.forEach((th, index) => {
      const key = th.id.slice(id.length + 1);
      if (key === "cb" || key === "rn" || key === "subgrid") return;
      if (isHidden(th)) return;
      const label = clean(th.textContent) || clean(th.getAttribute("title")) || key;
      cols.push({ key, label, index });
    });
    return cols;
  }

  function isFlagCell(td) {
    const lb = td.getAttribute("aria-labelledby") || "";
    if (/checkbox/i.test(lb)) return true;
    return !!td.querySelector("[class*='icon-checkbox'], input[type='checkbox']");
  }

  function readCell(td) {
    if (!td) return "";
    if (isFlagCell(td)) {
      const cb = td.querySelector("input[type='checkbox']");
      if (cb) return cb.checked ? "Y" : "N";
      if (td.querySelector(".siebui-icon-checkbox-checked")) return "Y";
      const t = clean(td.getAttribute("title"));
      if (/^(selecionado|seleccionado|checked|sim|yes|y)$/i.test(t)) return "Y";
      return "N";
    }
    // A selected row can be in edit mode, with an input field inside the cell.
    const input = td.querySelector("input:not([type='checkbox']):not([type='hidden']), textarea, select");
    if (input) {
      if (input.tagName === "SELECT") {
        const o = input.options[input.selectedIndex];
        return clean(o ? o.text : input.value);
      }
      return clean(input.value);
    }
    let text = td.innerText;
    if (text == null || text === "") text = td.textContent;
    text = clean(text);
    if (!text) text = clean(td.getAttribute("title"));
    return text;
  }

  function readRows(grid, cols) {
    const { id, doc, table } = grid;
    const rows = [];
    table.querySelectorAll("tr.jqgrow").forEach((tr) => {
      if (isHidden(tr)) return;
      const values = cols.map((c) => {
        let td = doc.getElementById(tr.id + "_" + id + "_" + c.key);
        if (!td) td = tr.querySelector("td[aria-describedby='" + id + "_" + c.key + "']");
        if (!td) td = tr.cells[c.index];
        return readCell(td);
      });
      rows.push(values);
    });
    return rows;
  }

  // "21 - 40 de 42+"  ->  {start:21, end:40, total:42, more:true}
  function parseCounter(text) {
    const t = clean(text).replace(/(\d)[.,  ](?=\d{3}\b)/g, "$1");
    let m = t.match(/(\d+)\s*-\s*(\d+)\s*\D*?\s*(\d+)\s*(\+)?/);
    if (m) return { start: +m[1], end: +m[2], total: +m[3], more: !!m[4], text: clean(text) };
    m = t.match(/^(\d+)\s*\D+\s*(\d+)\s*(\+)?$/); // "1 de 1"
    if (m) return { start: +m[1], end: +m[1], total: +m[2], more: !!m[3], text: clean(text) };
    return null;
  }

  function counterText(grid) {
    return grid.counter ? clean(grid.counter.textContent) : "";
  }

  function pagerButton(grid, which) {
    return grid.doc.getElementById(which + "_pager_" + grid.id);
  }

  function isEnabled(btn) {
    return !!btn && !btn.classList.contains("ui-state-disabled") && !isHidden(btn);
  }

  function clickPager(btn) {
    const target = btn.querySelector("span[role='button'], span.ui-icon") || btn;
    target.click();
  }

  function pageSignature(grid) {
    const first = grid.table.querySelector("tr.jqgrow");
    const last = grid.table.querySelectorAll("tr.jqgrow");
    const lastRow = last[last.length - 1];
    return [
      counterText(grid),
      last.length,
      first ? clean(first.textContent).slice(0, 300) : "",
      lastRow ? clean(lastRow.textContent).slice(0, 300) : "",
    ].join("|");
  }

  function isLoading(grid) {
    const load = grid.doc.getElementById("load_" + grid.id);
    return !!load && !isHidden(load);
  }

  // Siebel can rebuild the grid table; re-find it by id.
  function refreshGrid(grid) {
    const t = grid.doc.getElementById(grid.id);
    if (t && t !== grid.table) {
      const fresh = describeGrid(t);
      grid.table = fresh.table;
      grid.counter = fresh.counter;
    } else if (grid.counter && !grid.counter.isConnected) {
      grid.counter = describeGrid(grid.table).counter;
    }
  }

  async function waitForPageChange(grid, before, what) {
    const t0 = Date.now();
    let changedAt = 0;
    let lastSig = before;
    while (Date.now() - t0 < PAGE_TIMEOUT_MS) {
      if (state.stopRequested) throw new UserStop();
      await sleep(150);
      refreshGrid(grid);
      if (isLoading(grid)) continue;
      const sig = pageSignature(grid);
      if (sig !== before) {
        // Wait until the page stops changing (rows can render in steps).
        if (sig !== lastSig) { lastSig = sig; changedAt = Date.now(); continue; }
        if (Date.now() - changedAt >= 400) return;
      }
    }
    throw new Error(
      "Siebel did not load the " + what + " page within " + PAGE_TIMEOUT_MS / 1000 + " seconds. " +
      "Counter shows: \"" + counterText(grid) + "\"."
    );
  }

  // ------------------------------------------------------------------ value conversion
  function serial(y, mo, d, h, mi, s) {
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
    const dt = Date.UTC(y, mo - 1, d);
    const check = new Date(dt);
    if (check.getUTCDate() !== d) return null; // e.g. 31-02
    return (dt - Date.UTC(1899, 11, 30)) / 86400000 + (h * 3600 + mi * 60 + s) / 86400;
  }

  function toCell(text) {
    if (text === "" || text == null) return null;
    let m = text.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/);
    if (m) {
      const v = serial(+m[3], +m[2], +m[1], 0, 0, 0);
      if (v != null) return { t: "d", v };
    }
    m = text.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (m) {
      const v = serial(+m[3], +m[2], +m[1], +m[4], +m[5], +(m[6] || 0));
      if (v != null) return { t: "dt", v };
    }
    const n = text.replace(/[\s €]/g, "");
    // Portuguese decimals / thousands: "3,79", "1.234,50", "1.234", "-0,5"
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(n) || /^-?\d+,\d+$/.test(n)) {
      const v = parseFloat(n.replace(/\./g, "").replace(",", "."));
      if (isFinite(v)) return { t: "n", v, raw: text };
    }
    // Plain integers: short ones become numbers; long ones (phones, IMEI, IDs) stay text.
    if (/^-?\d+$/.test(n)) {
      const digits = n.replace("-", "");
      if (digits.length <= 6 && (digits === "0" || digits[0] !== "0")) return { t: "n", v: parseInt(n, 10), raw: text };
    }
    return { t: "s", v: text };
  }

  function fileNameFor(title) {
    const base = String(title || "Siebel_list")
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "Siebel_list";
    const d = new Date();
    const p = (x) => String(x).padStart(2, "0");
    return base + "_" + d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "_" + p(d.getHours()) + p(d.getMinutes()) + ".xlsx";
  }

  function download(bytes, name) {
    const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  }

  // ------------------------------------------------------------------ extraction
  class UserStop extends Error { constructor() { super("Stopped by user."); } }

  const state = {
    running: false,
    stopRequested: false,
    grid: null,
    pages: 0,
    lastResult: null,
    lastCounter: "",
  };

  async function extract(grid, onProgress) {
    state.pages = 0;
    log("Start. Grid " + grid.id + " \"" + grid.title + "\", counter \"" + counterText(grid) + "\"");

    const cols = getColumns(grid);
    if (!cols.length) throw new Error("Could not find the column headers of the list \"" + grid.title + "\".");
    log("Columns (" + cols.length + "): " + cols.map((c) => c.key).join(", "));

    // Go to the first page if we are not on it.
    const first = pagerButton(grid, "first");
    if (isEnabled(first)) {
      onProgress("Going back to the first page...");
      const before = pageSignature(grid);
      clickPager(first);
      await waitForPageChange(grid, before, "first");
      log("Moved to first page. Counter \"" + counterText(grid) + "\"");
    }

    const byIndex = new Map(); // record number -> row values
    const fallbackRows = []; // used only when the counter cannot be read
    const fallbackSeen = new Set();
    let usedFallback = false;
    let lastInfo = null;
    let prevStart = 0;
    const warnings = [];

    while (true) {
      if (state.stopRequested) throw new UserStop();
      state.pages++;
      if (state.pages > MAX_PAGES) throw new Error("Stopped after " + MAX_PAGES + " pages (safety limit).");

      const ctext = counterText(grid);
      state.lastCounter = ctext;
      const info = parseCounter(ctext);
      const rows = readRows(grid, cols);
      log("Page " + state.pages + ": counter \"" + ctext + "\", " + rows.length + " rows");

      if (info) {
        if (info.start <= prevStart && state.pages > 1 && info.end <= (lastInfo ? lastInfo.end : 0)) {
          throw new Error("The list did not move forward (counter still \"" + ctext + "\").");
        }
        const expected = info.end - info.start + 1;
        if (rows.length !== expected) {
          const w = "Page " + state.pages + ": counter \"" + ctext + "\" says " + expected + " rows but " + rows.length + " were found.";
          warnings.push(w);
          log("WARNING " + w);
        }
        rows.forEach((r, i) => byIndex.set(info.start + i, r));
        prevStart = info.start;
        lastInfo = info;
      } else {
        usedFallback = true;
        for (const r of rows) {
          const key = r.join("\u0001");
          if (!fallbackSeen.has(key)) { fallbackSeen.add(key); fallbackRows.push(r); }
        }
      }

      const collected = usedFallback ? fallbackRows.length : byIndex.size;
      const total = lastInfo ? lastInfo.total + (lastInfo.more ? "+" : "") : "?";
      onProgress("Reading page " + state.pages + "...  " + collected + " of " + total + " rows", lastInfo && !lastInfo.more ? collected / lastInfo.total : null);

      const next = pagerButton(grid, "next");
      if (!isEnabled(next)) {
        log("Next button disabled - last page reached.");
        break;
      }
      const before = pageSignature(grid);
      clickPager(next);
      await waitForPageChange(grid, before, "next");
    }

    let rows;
    let total = null;
    if (usedFallback) {
      warnings.push("The record counter could not be read, so repeated rows were removed by comparing their content. Identical rows in Siebel would appear only once.");
      if (byIndex.size) warnings.push("Mixed counter readings; check the result.");
      rows = Array.from(byIndex.keys()).sort((a, b) => a - b).map((k) => byIndex.get(k)).concat(fallbackRows);
    } else {
      const keys = Array.from(byIndex.keys()).sort((a, b) => a - b);
      rows = keys.map((k) => byIndex.get(k));
      if (lastInfo && !lastInfo.more) {
        total = lastInfo.total;
        const missing = [];
        for (let i = 1; i <= total; i++) if (!byIndex.has(i)) missing.push(i);
        if (missing.length) {
          warnings.push("Siebel reports " + total + " records but " + missing.length + " are missing (record numbers " + missing.slice(0, 15).join(", ") + (missing.length > 15 ? ", ..." : "") + ").");
        }
        if (keys.length && keys[keys.length - 1] > total) warnings.push("Found record numbers above the total of " + total + ".");
      } else if (lastInfo) {
        warnings.push("Siebel did not report a final total (counter: \"" + lastInfo.text + "\"). Please check the row count.");
      }
    }
    log("Finished: " + rows.length + " rows, " + state.pages + " pages, total " + total + ", warnings " + warnings.length);
    return { cols, rows, total, warnings, pages: state.pages };
  }

  function buildWorkbook(grid, result) {
    const headers = result.cols.map((c) => c.label);
    const rows = result.rows.map((r) => r.map(toCell));
    return window.__SteXlsx.build({ sheetName: grid.title, headers, rows });
  }

  function errorReport(err) {
    const g = state.grid;
    return [
      "=== Siebel Table Extractor - error report ===",
      "Version: " + VERSION,
      "Time: " + new Date().toString(),
      "Page: " + location.origin + location.pathname,
      "Browser: " + navigator.userAgent,
      "List: " + (g ? g.title + " (" + g.id + ")" : "-"),
      "Counter: " + (g ? counterText(g) : "-"),
      "Pages read: " + state.pages,
      "",
      "Error: " + (err && err.message ? err.message : String(err)),
      err && err.stack ? "Stack:\n" + err.stack : "",
      "",
      "Log:",
      logLines.slice(-60).join("\n"),
    ].join("\n");
  }

  // ------------------------------------------------------------------ panel UI
  let host, root, els = {};
  let grids = [];

  function buildPanel() {
    host = document.createElement("div");
    host.id = "siebel-table-extractor-panel";
    host.style.cssText = "position:fixed;top:12px;right:12px;z-index:2147483647;";
    root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        .box { font: 14px/1.4 "Segoe UI", Arial, sans-serif; color:#1f2933; background:#fff;
               width: 360px; border:1px solid #c7d0db; border-radius:10px;
               box-shadow: 0 8px 28px rgba(0,0,0,.22); overflow:hidden; }
        .head { display:flex; align-items:center; justify-content:space-between;
                background:#1d6f42; color:#fff; padding:10px 14px; font-weight:600; font-size:15px; }
        .x { background:none; border:none; color:#fff; font-size:20px; cursor:pointer; line-height:1; padding:0 4px; }
        .body { padding:14px; }
        .row { margin-bottom:10px; }
        .label { font-size:12px; color:#52606d; margin-bottom:2px; }
        .value { font-weight:600; word-break:break-word; }
        select { width:100%; font:inherit; padding:6px; border:1px solid #c7d0db; border-radius:6px; }
        button.main { width:100%; font:inherit; font-size:15px; font-weight:600; padding:10px; border:none;
                      border-radius:8px; cursor:pointer; background:#1d6f42; color:#fff; }
        button.main:hover { background:#185c37; }
        button.main:disabled { background:#9aa5b1; cursor:default; }
        button.sec { font:inherit; padding:7px 12px; border:1px solid #c7d0db; border-radius:6px;
                     background:#f5f7fa; cursor:pointer; margin-top:8px; }
        button.sec:hover { background:#e4e7eb; }
        .status { margin-top:12px; }
        .bar { height:8px; background:#e4e7eb; border-radius:4px; overflow:hidden; margin-top:6px; display:none; }
        .bar > div { height:100%; width:0; background:#1d6f42; transition:width .2s; }
        .bar.indet > div { width:30%; animation: slide 1.2s infinite ease-in-out; }
        @keyframes slide { 0% { margin-left:-30%; } 100% { margin-left:100%; } }
        .ok { background:#e3f9e5; border:1px solid #91d7a0; color:#0e5a26; padding:10px; border-radius:8px; margin-top:12px; }
        .warn { background:#fff8e1; border:1px solid #f0c36d; color:#6b4a00; padding:10px; border-radius:8px; margin-top:10px; font-size:13px; }
        .err { background:#ffebee; border:1px solid #ef9a9a; color:#8a1c1c; padding:10px; border-radius:8px; margin-top:12px; }
        textarea { width:100%; box-sizing:border-box; height:120px; font:12px/1.3 Consolas, monospace; margin-top:8px;
                   border:1px solid #c7d0db; border-radius:6px; padding:6px; resize:vertical; }
        .hidden { display:none !important; }
        .small { font-size:12px; color:#52606d; margin-top:8px; }
      </style>
      <div class="box">
        <div class="head"><span>Table Extractor</span><button class="x" title="Close">×</button></div>
        <div class="body">
          <div class="row" id="pick"></div>
          <button class="main" id="start">Extract to Excel</button>
          <button class="sec hidden" id="stop">Stop</button>
          <div class="status" id="status"></div>
          <div class="bar" id="bar"><div></div></div>
          <div id="result"></div>
          <div class="err hidden" id="err">
            <b>Something went wrong.</b><br>
            Click <b>Copy error</b> and send the text to whoever maintains this tool.
            <textarea id="errtext" readonly></textarea>
            <button class="sec" id="copy">Copy error</button>
            <span id="copied" class="small hidden">Copied!</span>
          </div>
        </div>
      </div>`;
    document.documentElement.appendChild(host);
    els = {
      pick: root.getElementById("pick"),
      start: root.getElementById("start"),
      stop: root.getElementById("stop"),
      status: root.getElementById("status"),
      bar: root.getElementById("bar"),
      result: root.getElementById("result"),
      err: root.getElementById("err"),
      errtext: root.getElementById("errtext"),
      copy: root.getElementById("copy"),
      copied: root.getElementById("copied"),
    };
    root.querySelector(".x").addEventListener("click", () => {
      if (state.running) { state.stopRequested = true; }
      host.style.display = "none";
    });
    els.start.addEventListener("click", run);
    els.stop.addEventListener("click", () => {
      state.stopRequested = true;
      els.stop.disabled = true;
      setStatus("Stopping...");
    });
    els.copy.addEventListener("click", async () => {
      const text = els.errtext.value;
      try {
        await navigator.clipboard.writeText(text);
      } catch (_) {
        els.errtext.focus();
        els.errtext.select();
        document.execCommand("copy");
      }
      els.copied.classList.remove("hidden");
      setTimeout(() => els.copied.classList.add("hidden"), 2000);
    });
  }

  function setStatus(text, fraction) {
    els.status.textContent = text || "";
    const ctr = root.getElementById("ctr");
    if (ctr && state.grid) ctr.textContent = counterText(state.grid);
    if (fraction === undefined) return;
    els.bar.style.display = "block";
    if (fraction == null) {
      els.bar.classList.add("indet");
      els.bar.firstElementChild.style.width = "";
    } else {
      els.bar.classList.remove("indet");
      els.bar.firstElementChild.style.width = Math.round(Math.min(fraction, 1) * 100) + "%";
    }
  }

  function hideBar() { els.bar.style.display = "none"; }

  function showError(err) {
    els.err.classList.remove("hidden");
    els.errtext.value = errorReport(err);
  }

  function escHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function detect() {
    els.result.innerHTML = "";
    els.err.classList.add("hidden");
    hideBar();
    setStatus("");
    try {
      grids = findGrids();
    } catch (e) {
      grids = [];
      showError(e);
    }
    if (!grids.length) {
      els.pick.innerHTML =
        '<div class="warn">No Siebel list with data was found on this page.<br><br>' +
        "Open the list in Siebel (with the results visible) and click the extension icon again.</div>";
      els.start.disabled = true;
      return;
    }
    els.start.disabled = false;
    if (grids.length === 1) {
      const g = grids[0];
      els.pick.innerHTML =
        '<div class="label">List found</div><div class="value">' + escHtml(g.title) + "</div>" +
        '<div class="small" id="ctr">' + escHtml(counterText(g) || "") + "</div>";
    } else {
      els.pick.innerHTML = '<div class="label">Choose the list to extract</div><select id="sel"></select>';
      const sel = root.getElementById("sel");
      grids.forEach((g, i) => {
        const o = document.createElement("option");
        o.value = String(i);
        o.textContent = g.title + (counterText(g) ? "  (" + counterText(g) + ")" : "");
        sel.appendChild(o);
      });
    }
  }

  function selectedGrid() {
    if (grids.length === 1) return grids[0];
    const sel = root.getElementById("sel");
    return grids[sel ? +sel.value : 0];
  }

  async function run() {
    if (state.running) return;
    const grid = selectedGrid();
    if (!grid) return;
    state.grid = grid;
    state.running = true;
    state.stopRequested = false;
    els.start.disabled = true;
    els.stop.classList.remove("hidden");
    els.stop.disabled = false;
    els.result.innerHTML = "";
    els.err.classList.add("hidden");
    setStatus("Starting...", null);
    try {
      const result = await extract(grid, (msg, frac) => setStatus(msg, frac === undefined ? null : frac));
      setStatus("Creating the Excel file...", null);
      await sleep(30);
      const bytes = buildWorkbook(grid, result);
      const name = fileNameFor(grid.title);
      download(bytes, name);
      state.lastResult = { bytes, name };
      hideBar();
      setStatus("");
      let html =
        '<div class="ok"><b>Done!</b> ' + result.rows.length + " rows exported" +
        (result.total != null ? " (Siebel total: " + result.total + ")" : "") + ".<br>" +
        "The file <b>" + escHtml(name) + "</b> was saved to your Downloads folder." +
        '<br><button class="sec" id="again">Download again</button></div>';
      if (result.warnings.length) {
        html += '<div class="warn"><b>Please check:</b><br>' + result.warnings.map(escHtml).join("<br>") + "</div>";
      }
      els.result.innerHTML = html;
      root.getElementById("again").addEventListener("click", () => download(state.lastResult.bytes, state.lastResult.name));
    } catch (e) {
      hideBar();
      if (e instanceof UserStop) {
        setStatus("Stopped. No file was created.");
        log("Stopped by user.");
      } else {
        setStatus("");
        log("ERROR " + (e && e.message));
        showError(e);
      }
    } finally {
      state.running = false;
      els.start.disabled = false;
      els.start.textContent = "Extract again";
      els.stop.classList.add("hidden");
    }
  }

  function show() {
    if (!host || !host.isConnected) buildPanel();
    host.style.display = "block";
    if (!state.running) detect();
  }

  window.__steExtractor = { show, _test: { parseCounter, toCell, fileNameFor } };
  show();
})();
