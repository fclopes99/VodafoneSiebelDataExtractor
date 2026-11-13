// Siebel Table Extractor - page script.
// The desktop app injects this into the Siebel tab (through Chrome's remote debugging).
// It finds the Siebel list (jqGrid), walks through every page with the "next" arrow,
// removes the rows Siebel repeats on the last page, and builds an .xlsx file (xlsx.js).
//
// API (window.__steExtractor):
//   version            - script version, set by the app in window.__STE_VERSION
//   detect()           - [{index, title, counter}] lists with data on the page
//   start(index, opts) - starts extracting list #index in the background
//                        opts.maxColumns: export only the first N columns (1-15); empty = all
//   status()           - {state: idle|running|done|error|stopped, message, fraction, error}
//   stop()             - asks a running extraction to stop
//   takeResult()       - {name, base64, rows, total, pages, warnings} once state is "done"
(function () {
  "use strict";

  const VERSION = window.__STE_VERSION || "dev";
  const PAGE_TIMEOUT_MS = 60000; // max wait for Siebel to load one page
  const MAX_PAGES = 5000;

  // ------------------------------------------------------------------ utils
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (s) => String(s == null ? "" : s).replace(/ /g, " ").replace(/[ \t]+\n/g, "\n").trim();

  const logLines = [];
  function log(msg) {
    const line = new Date().toISOString().slice(11, 19) + "  " + msg;
    logLines.push(line);
    if (logLines.length > 300) logLines.shift();
  }

  function isHidden(el) {
    if (!el) return true;
    if (el.style && el.style.display === "none") return true;
    try {
      return el.ownerDocument.defaultView.getComputedStyle(el).display === "none";
    } catch (_) {
      return false;
    }
  }

  // The page plus any same-origin iframes.
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
        if (!table.querySelectorAll("tr.jqgrow").length || isHidden(table)) return;
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
    if (/checkbox/i.test(td.getAttribute("aria-labelledby") || "")) return true;
    return !!td.querySelector("[class*='icon-checkbox'], input[type='checkbox']");
  }

  function readCell(td) {
    if (!td) return "";
    if (isFlagCell(td)) {
      const cb = td.querySelector("input[type='checkbox']");
      if (cb) return cb.checked ? "Y" : "N";
      if (td.querySelector(".siebui-icon-checkbox-checked")) return "Y";
      if (/^(selecionado|seleccionado|checked|sim|yes|y)$/i.test(clean(td.getAttribute("title")))) return "Y";
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
      rows.push(cols.map((c) => {
        let td = doc.getElementById(tr.id + "_" + id + "_" + c.key);
        if (!td) td = tr.querySelector("td[aria-describedby='" + id + "_" + c.key + "']");
        if (!td) td = tr.cells[c.index];
        return readCell(td);
      }));
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

  const counterText = (grid) => (grid && grid.counter ? clean(grid.counter.textContent) : "");
  const pagerButton = (grid, which) => grid.doc.getElementById(which + "_pager_" + grid.id);
  const isEnabled = (btn) => !!btn && !btn.classList.contains("ui-state-disabled") && !isHidden(btn);

  // ---- Ways to press a pager button. Siebel may ignore a plain click(), so there are several,
  // tried in order until the page changes. The one that works is reused for the next pages.
  function pagerTarget(btn) {
    return btn.querySelector("span[role='button'], span.ui-icon") || btn;
  }

  function mouseSequence(btn) {
    const el = pagerTarget(btn);
    const r = el.getBoundingClientRect();
    const view = el.ownerDocument.defaultView;
    const opts = { bubbles: true, cancelable: true, view, button: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    const P = view.PointerEvent || view.MouseEvent;
    el.dispatchEvent(new P("pointerover", opts));
    el.dispatchEvent(new view.MouseEvent("mouseover", opts));
    el.dispatchEvent(new view.MouseEvent("mouseenter", Object.assign({}, opts, { bubbles: false })));
    el.dispatchEvent(new P("pointerdown", Object.assign({ buttons: 1 }, opts)));
    el.dispatchEvent(new view.MouseEvent("mousedown", Object.assign({ buttons: 1 }, opts)));
    if (el.focus) el.focus();
    el.dispatchEvent(new P("pointerup", opts));
    el.dispatchEvent(new view.MouseEvent("mouseup", opts));
    el.dispatchEvent(new view.MouseEvent("click", opts));
  }

  function siebelApplet(grid) {
    const SA = grid.doc.defaultView.SiebelApp;
    if (!SA || !SA.S_App || !SA.S_App.GetActiveView) throw new Error("SiebelApp is not available on this page");
    const view = SA.S_App.GetActiveView();
    const map = view.GetAppletMap();
    for (const name in map) {
      const a = map[name];
      let fullId = "";
      try { fullId = a.GetFullId(); } catch (_) { continue; }
      const box = grid.doc.getElementById(fullId) || grid.doc.getElementById("s_" + fullId + "_div");
      if (box && box.contains(grid.table)) return { SA, applet: a, name, fullId };
    }
    throw new Error("No Siebel applet contains the list " + grid.id);
  }

  const PAGER_CONSTANTS = {
    next: ["PAG_NEXT_SET"],
    first: ["PAG_FIRST_SET", "PAG_FIRST_RECORD"],
  };

  function siebelCommand(grid, which) {
    const { SA, applet, name } = siebelApplet(grid);
    const consts = SA.Constants;
    const evName = consts.get("PHYEVENT_VSCROLL_LIST");
    const pag = PAGER_CONSTANTS[which].map((c) => consts.get(c)).find((v) => v != null && v !== "");
    if (!evName || pag == null) throw new Error("Siebel paging constants not found (" + evName + ", " + pag + ")");
    log("Siebel command on applet \"" + name + "\": OnControlEvent(" + evName + ", " + pag + ")");
    applet.GetPModel().OnControlEvent(evName, pag);
  }

  function keyboardEnter(btn) {
    const el = pagerTarget(btn);
    const view = el.ownerDocument.defaultView;
    if (el.focus) el.focus();
    for (const type of ["keydown", "keypress", "keyup"]) {
      el.dispatchEvent(new view.KeyboardEvent(type, { bubbles: true, cancelable: true, key: "Enter", code: "Enter", keyCode: 13, which: 13 }));
    }
  }

  const PRESS_METHODS = [
    ["click", (grid, btn) => pagerTarget(btn).click()],
    ["mouse events", (grid, btn) => mouseSequence(btn)],
    ["Siebel command", (grid, btn, which) => siebelCommand(grid, which)],
    ["Enter key", (grid, btn) => keyboardEnter(btn)],
  ];
  let workingMethod = -1;

  function describePager(grid, btn) {
    const lines = [];
    try {
      lines.push("Button HTML: " + (btn ? btn.outerHTML.slice(0, 600) : "not found"));
      const jq = grid.doc.defaultView.jQuery;
      if (jq && jq._data && btn) {
        const names = (el) => Object.keys(jq._data(el, "events") || {}).join(",") || "none";
        lines.push("jQuery events: td=" + names(btn) + " span=" + names(pagerTarget(btn)) +
          " pager=" + names(btn.closest(".ui-jqgrid-pager") || btn) + " document=" + names(grid.doc));
      }
      const SA = grid.doc.defaultView.SiebelApp;
      lines.push("SiebelApp: " + (SA ? "yes" : "no"));
      if (SA) {
        try { const a = siebelApplet(grid); lines.push("Applet: " + a.name + " (" + a.fullId + ")"); } catch (e) { lines.push("Applet: " + e.message); }
        try {
          lines.push("Constants: " + ["PHYEVENT_VSCROLL_LIST", "PAG_NEXT_SET", "PAG_FIRST_SET", "PAG_PREV_SET", "PAG_LAST_SET"]
            .map((c) => c + "=" + SA.Constants.get(c)).join(" "));
        } catch (e) { lines.push("Constants: " + e.message); }
      }
    } catch (e) {
      lines.push("Diagnostics failed: " + e.message);
    }
    return lines;
  }

  // Presses the pager button and waits for the new page.
  async function pressPager(grid, which, what) {
    const before = pageSignature(grid);
    const order = workingMethod >= 0 ? [workingMethod] : PRESS_METHODS.map((_, i) => i);
    const tried = [];
    for (const i of order) {
      const [name, fn] = PRESS_METHODS[i];
      const btn = pagerButton(grid, which);
      try {
        fn(grid, btn, which);
      } catch (e) {
        tried.push(name + " (failed: " + e.message + ")");
        log("Press '" + which + "' with " + name + " failed: " + e.message);
        continue;
      }
      // The first time, give each method a short time; once one works, use the full timeout.
      const limit = workingMethod >= 0 ? PAGE_TIMEOUT_MS : 8000;
      if (await waitForPageChange(grid, before, limit)) {
        if (workingMethod !== i) log("Paging works with: " + name);
        workingMethod = i;
        return;
      }
      tried.push(name + " (no change)");
      log("Press '" + which + "' with " + name + ": page did not change");
    }
    describePager(grid, pagerButton(grid, which)).forEach(log);
    throw new Error("Siebel did not load the " + what + " page. Tried: " + tried.join("; ") +
      ". Counter shows: \"" + counterText(grid) + "\".");
  }

  function pageSignature(grid) {
    const rows = grid.table.querySelectorAll("tr.jqgrow");
    const first = rows[0], last = rows[rows.length - 1];
    return [
      counterText(grid),
      rows.length,
      first ? clean(first.textContent).slice(0, 300) : "",
      last ? clean(last.textContent).slice(0, 300) : "",
    ].join("|");
  }

  function isLoading(grid) {
    const load = grid.doc.getElementById("load_" + grid.id);
    return !!load && !isHidden(load);
  }

  // Siebel can rebuild the grid table; find it again by id.
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

  // Returns true once the page changed and settled, false after limitMs without a change.
  async function waitForPageChange(grid, before, limitMs) {
    const t0 = Date.now();
    let changedAt = 0;
    let lastSig = before;
    while (Date.now() - t0 < limitMs || (changedAt && Date.now() - t0 < PAGE_TIMEOUT_MS)) {
      if (job.stopRequested) throw new UserStop();
      await sleep(150);
      refreshGrid(grid);
      if (isLoading(grid)) continue;
      const sig = pageSignature(grid);
      if (sig !== before) {
        // Wait until the page stops changing (rows can render in steps).
        if (sig !== lastSig) { lastSig = sig; changedAt = Date.now(); continue; }
        if (Date.now() - changedAt >= 400) return true;
      }
    }
    return false;
  }

  // ------------------------------------------------------------------ value conversion
  function serial(y, mo, d, h, mi, s) {
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
    const dt = Date.UTC(y, mo - 1, d);
    if (new Date(dt).getUTCDate() !== d) return null; // e.g. 31-02
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

  // Letters and digits only, accents removed: "Água Lda." -> "Agua_Lda"
  function safeName(text, max) {
    return String(text || "")
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, max).replace(/_+$/, "");
  }

  // The client the page is about: the "Cliente:NAME" breadcrumb at the top of Siebel,
  // or else the title of the "Titular da conta" box.
  function findClient() {
    for (const doc of allDocuments()) {
      const crumbs = Array.from(doc.querySelectorAll(".siebui-crumb, #siebui-threadbar li"))
        .map((el) => clean(el.textContent)).filter((t) => /^cliente\s*:/i.test(t));
      if (crumbs.length) return clean(crumbs[crumbs.length - 1].replace(/^cliente\s*:/i, ""));
    }
    for (const doc of allDocuments()) {
      for (const box of doc.querySelectorAll("[id^='S_A']")) {
        if (!/titular da conta/i.test(box.getAttribute("aria-label") || "")) continue;
        const t = box.querySelector(".siebui-applet-title label, .siebui-applet-title");
        if (t && clean(t.textContent)) return clean(t.textContent);
      }
    }
    return "";
  }

  const MAX_CLIENT_CHARS = 40; // long client names are cut so the file name stays short

  function fileNameFor(title, client) {
    const base = [safeName(client, MAX_CLIENT_CHARS), safeName(title, 60) || "Siebel_list"].filter(Boolean).join("_");
    const d = new Date();
    const p = (x) => String(x).padStart(2, "0");
    return base + "_" + d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "_" + p(d.getHours()) + p(d.getMinutes()) + ".xlsx";
  }

  function toBase64(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  // ------------------------------------------------------------------ extraction
  class UserStop extends Error { constructor() { super("Stopped by user."); } }

  const job = {
    state: "idle",
    message: "",
    fraction: null,
    error: "",
    stopRequested: false,
    grid: null,
    pages: 0,
    result: null,
  };

  function progress(message, fraction) {
    job.message = message;
    job.fraction = fraction == null ? null : Math.min(fraction, 1);
  }

  const MAX_COLUMNS_LIMIT = 15;

  async function extract(grid, maxColumns) {
    job.pages = 0;
    workingMethod = -1;
    log("Start. Grid " + grid.id + " \"" + grid.title + "\", counter \"" + counterText(grid) + "\", columns: " +
      (maxColumns ? "first " + maxColumns : "all"));

    let cols = getColumns(grid);
    if (!cols.length) throw new Error("Could not find the column headers of the list \"" + grid.title + "\".");
    if (maxColumns) cols = cols.slice(0, maxColumns);
    log("Columns (" + cols.length + "): " + cols.map((c) => c.key).join(", "));

    // Go to the first page if we are not on it.
    const first = pagerButton(grid, "first");
    if (isEnabled(first)) {
      progress("Going back to the first page...");
      await pressPager(grid, "first", "first");
      log("Moved to first page. Counter \"" + counterText(grid) + "\"");
    }

    const byIndex = new Map(); // record number -> row values
    const fallbackRows = []; // used only when the counter cannot be read
    const fallbackSeen = new Set();
    let usedFallback = false;
    let lastInfo = null;
    const warnings = [];

    while (true) {
      if (job.stopRequested) throw new UserStop();
      job.pages++;
      if (job.pages > MAX_PAGES) throw new Error("Stopped after " + MAX_PAGES + " pages (safety limit).");

      const ctext = counterText(grid);
      const info = parseCounter(ctext);
      const rows = readRows(grid, cols);
      log("Page " + job.pages + ": counter \"" + ctext + "\", " + rows.length + " rows");

      if (info) {
        if (lastInfo && info.start <= lastInfo.start && info.end <= lastInfo.end) {
          throw new Error("The list did not move forward (counter still \"" + ctext + "\").");
        }
        const expected = info.end - info.start + 1;
        if (rows.length !== expected) {
          const w = "Page " + job.pages + ": counter \"" + ctext + "\" says " + expected + " rows but " + rows.length + " were found.";
          warnings.push(w);
          log("WARNING " + w);
        }
        rows.forEach((r, i) => byIndex.set(info.start + i, r));
        lastInfo = info;
      } else {
        usedFallback = true;
        for (const r of rows) {
          const key = r.join("\u0001");
          if (!fallbackSeen.has(key)) { fallbackSeen.add(key); fallbackRows.push(r); }
        }
      }

      const collected = byIndex.size + fallbackRows.length;
      const totalTxt = lastInfo ? lastInfo.total + (lastInfo.more ? "+" : "") : "?";
      progress("Reading page " + job.pages + "...  " + collected + " of " + totalTxt + " rows",
        lastInfo && !lastInfo.more ? collected / lastInfo.total : null);

      const next = pagerButton(grid, "next");
      if (!isEnabled(next)) {
        log("Next button disabled - last page reached.");
        break;
      }
      await pressPager(grid, "next", "next");
    }

    let rows;
    let total = null;
    if (usedFallback) {
      warnings.push("The record counter could not be read, so repeated rows were removed by comparing their content. Rows that are completely identical in Siebel appear only once.");
      rows = Array.from(byIndex.keys()).sort((a, b) => a - b).map((k) => byIndex.get(k)).concat(fallbackRows);
    } else {
      const keys = Array.from(byIndex.keys()).sort((a, b) => a - b);
      rows = keys.map((k) => byIndex.get(k));
      if (lastInfo && !lastInfo.more) {
        total = lastInfo.total;
        const missing = [];
        for (let i = 1; i <= total; i++) if (!byIndex.has(i)) missing.push(i);
        if (missing.length) {
          warnings.push("Siebel reports " + total + " records but " + missing.length + " are missing (record numbers " +
            missing.slice(0, 15).join(", ") + (missing.length > 15 ? ", ..." : "") + ").");
        }
        if (keys.length && keys[keys.length - 1] > total) warnings.push("Found record numbers above the total of " + total + ".");
      } else if (lastInfo) {
        warnings.push("Siebel did not report a final total (counter: \"" + lastInfo.text + "\"). Please check the row count.");
      }
    }
    log("Finished: " + rows.length + " rows, " + job.pages + " pages, total " + total + ", warnings " + warnings.length);
    return { cols, rows, total, warnings, pages: job.pages };
  }

  function errorReport(err) {
    const g = job.grid;
    return [
      "Page script version: " + VERSION,
      "Page: " + location.origin + location.pathname,
      "List: " + (g ? g.title + " (" + g.id + ")" : "-"),
      "Counter: " + (g ? counterText(g) : "-"),
      "Pages read: " + job.pages,
      "Error: " + (err && err.message ? err.message : String(err)),
      err && err.stack ? "Stack:\n" + err.stack : "",
      "",
      "Page log:",
      logLines.slice(-80).join("\n"),
    ].join("\n");
  }

  let lastGrids = [];

  function detect() {
    lastGrids = findGrids();
    const client = findClient();
    return lastGrids.map((g, index) => {
      const columns = getColumns(g).map((c) => c.label);
      return { index, title: g.title, counter: counterText(g), id: g.id, client, columns };
    });
  }

  function start(index, opts) {
    if (job.state === "running") return false;
    let maxColumns = opts && opts.maxColumns;
    if (maxColumns != null && maxColumns !== "") {
      maxColumns = Number(maxColumns);
      if (!Number.isInteger(maxColumns) || maxColumns < 1 || maxColumns > MAX_COLUMNS_LIMIT) {
        throw new Error("The number of columns must be a whole number from 1 to " + MAX_COLUMNS_LIMIT + ".");
      }
    } else {
      maxColumns = null;
    }
    if (!lastGrids.length) detect();
    const grid = lastGrids[index || 0];
    if (!grid) throw new Error("No Siebel list with data was found in this tab.");
    Object.assign(job, { state: "running", message: "Starting...", fraction: null, error: "", stopRequested: false, grid, pages: 0, result: null });
    (async () => {
      try {
        const res = await extract(grid, maxColumns);
        progress("Creating the Excel file...");
        await sleep(20);
        const bytes = window.__SteXlsx.build({
          sheetName: grid.title,
          headers: res.cols.map((c) => c.label),
          rows: res.rows.map((r) => r.map(toCell)),
        });
        job.result = {
          name: fileNameFor(grid.title, findClient()),
          base64: toBase64(bytes),
          rows: res.rows.length,
          columns: res.cols.length,
          total: res.total,
          pages: res.pages,
          warnings: res.warnings,
          title: grid.title,
        };
        job.state = "done";
        job.message = "Done";
      } catch (e) {
        if (e instanceof UserStop) {
          job.state = "stopped";
          job.message = "Stopped. No file was created.";
          log("Stopped by user.");
        } else {
          log("ERROR " + (e && e.message));
          job.state = "error";
          job.error = errorReport(e);
        }
      }
    })();
    return true;
  }

  function status() {
    return { state: job.state, message: job.message, fraction: job.fraction, error: job.error, counter: counterText(job.grid) };
  }

  function takeResult() {
    const r = job.result;
    job.result = null;
    if (job.state === "done") job.state = "idle";
    return r;
  }

  window.__steExtractor = {
    version: VERSION,
    detect,
    start,
    status,
    stop: () => { job.stopRequested = true; },
    takeResult,
    _test: { parseCounter, toCell, fileNameFor, findClient },
  };
})();
