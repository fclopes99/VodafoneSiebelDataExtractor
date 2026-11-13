// On-page panel for the bookmark version. Uses window.__steExtractor (app/js/extractor.js).
(function () {
  "use strict";
  const ID = "siebel-table-extractor-panel";
  const old = document.getElementById(ID);
  if (old) { old.style.display = "block"; if (window.__steShowPanel) window.__steShowPanel(); return; }

  const api = window.__steExtractor;
  const host = document.createElement("div");
  host.id = ID;
  host.style.cssText = "position:fixed;top:12px;right:12px;z-index:2147483647;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      .box { font: 14px/1.4 "Segoe UI", Arial, sans-serif; color:#1f2933; background:#fff; width:360px;
             border:1px solid #c7d0db; border-radius:10px; box-shadow:0 8px 28px rgba(0,0,0,.22); overflow:hidden; }
      .head { display:flex; align-items:center; justify-content:space-between; background:#1d6f42; color:#fff;
              padding:10px 14px; font-weight:600; font-size:15px; }
      .x { background:none; border:none; color:#fff; font-size:20px; cursor:pointer; line-height:1; padding:0 4px; }
      .body { padding:14px; }
      .label { font-size:12px; color:#52606d; }
      .value { font-weight:600; }
      .small { font-size:12px; color:#52606d; margin-top:2px; }
      select { width:100%; font:inherit; padding:6px; border:1px solid #c7d0db; border-radius:6px; margin-top:4px; }
      button.main { width:100%; font:inherit; font-size:15px; font-weight:600; padding:10px; border:none; border-radius:8px;
                    cursor:pointer; background:#1d6f42; color:#fff; margin-top:12px; }
      button.main:disabled { background:#9aa5b1; cursor:default; }
      button.sec { font:inherit; padding:7px 12px; border:1px solid #c7d0db; border-radius:6px; background:#f5f7fa; cursor:pointer; margin-top:8px; }
      .status { margin-top:12px; }
      .bar { height:8px; background:#e4e7eb; border-radius:4px; overflow:hidden; margin-top:6px; }
      .bar > div { height:100%; width:0; background:#1d6f42; transition:width .2s; }
      .bar.indet > div { width:30%; animation: slide 1.2s infinite ease-in-out; }
      @keyframes slide { 0% { margin-left:-30%; } 100% { margin-left:100%; } }
      .ok { background:#e3f9e5; border:1px solid #91d7a0; color:#0e5a26; padding:10px; border-radius:8px; margin-top:12px; }
      .warn { background:#fff8e1; border:1px solid #f0c36d; color:#6b4a00; padding:10px; border-radius:8px; margin-top:12px; font-size:13px; }
      .err { background:#ffebee; border:1px solid #ef9a9a; color:#8a1c1c; padding:10px; border-radius:8px; margin-top:12px; }
      textarea { width:100%; box-sizing:border-box; height:110px; font:12px/1.3 Consolas, monospace; margin-top:8px;
                 border:1px solid #c7d0db; border-radius:6px; padding:6px; }
      .hidden { display:none !important; }
    </style>
    <div class="box">
      <div class="head"><span>Extract to Excel</span><button class="x" title="Close">×</button></div>
      <div class="body">
        <div id="pick"></div>
        <button class="main" id="start">Extract to Excel</button>
        <button class="sec hidden" id="stop">Stop</button>
        <div class="status" id="status"></div>
        <div class="bar hidden" id="bar"><div></div></div>
        <div id="result"></div>
        <div class="err hidden" id="err">
          <b>Something went wrong.</b><br>Click <b>Copy error</b> and send the text.
          <textarea id="errtext" readonly></textarea>
          <button class="sec" id="copy">Copy error</button> <span id="copied" class="small"></span>
        </div>
      </div>
    </div>`;
  document.documentElement.appendChild(host);
  const $ = (id) => root.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  let lists = [];
  let timer = null;
  let lastFile = null;

  function report(err) {
    return ["=== Siebel Table Extractor - error report ===",
      "Version: " + api.version + " (bookmark)",
      "Time: " + new Date().toString(),
      "Browser: " + navigator.userAgent,
      "", String(err)].join("\n");
  }

  function showError(text) {
    $("err").classList.remove("hidden");
    $("errtext").value = text;
    $("copied").textContent = "";
  }

  function setBar(fraction) {
    const bar = $("bar");
    bar.classList.remove("hidden");
    if (fraction == null) { bar.classList.add("indet"); bar.firstElementChild.style.width = ""; }
    else { bar.classList.remove("indet"); bar.firstElementChild.style.width = Math.round(fraction * 100) + "%"; }
  }

  function download(base64, name) {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const a = document.createElement("a");
    a.href = url; a.download = name; a.style.display = "none";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  }

  function detect() {
    $("result").innerHTML = ""; $("err").classList.add("hidden"); $("bar").classList.add("hidden"); $("status").textContent = "";
    try { lists = api.detect(); } catch (e) { lists = []; showError(report(e && e.stack || e)); }
    if (!lists.length) {
      $("pick").innerHTML = '<div class="warn">No Siebel list with data was found on this page.<br><br>Open the list in Siebel (with the results showing) and click the bookmark again.</div>';
      $("start").disabled = true;
      return;
    }
    $("start").disabled = false;
    if (lists.length === 1) {
      $("pick").innerHTML = '<div class="label">List found</div><div class="value">' + esc(lists[0].title) +
        '</div><div class="small" id="ctr">' + esc(lists[0].counter) + "</div>";
    } else {
      $("pick").innerHTML = '<div class="label">Choose the list</div><select id="sel">' +
        lists.map((l, i) => '<option value="' + i + '">' + esc(l.title + (l.counter ? "  (" + l.counter + ")" : "")) + "</option>").join("") + "</select>";
    }
  }

  function finish() {
    clearInterval(timer); timer = null;
    $("start").disabled = false; $("start").textContent = "Extract again";
    $("stop").classList.add("hidden"); $("bar").classList.add("hidden");
  }

  function poll() {
    let st;
    try { st = api.status(); } catch (e) { finish(); showError(report(e && e.stack || e)); return; }
    const ctr = $("ctr"); if (ctr && st.counter) ctr.textContent = st.counter;
    if (st.state === "running") { $("status").textContent = st.message; setBar(st.fraction); return; }
    finish();
    if (st.state === "stopped") { $("status").textContent = "Stopped. No file was created."; return; }
    if (st.state === "error") { $("status").textContent = ""; showError(report(st.error)); return; }
    if (st.state === "done") {
      const r = api.takeResult();
      lastFile = r;
      download(r.base64, r.name);
      $("status").textContent = "";
      let html = '<div class="ok"><b>Done!</b> ' + r.rows + " rows exported" + (r.total != null ? " (Siebel total: " + r.total + ")" : "") +
        ".<br>The file <b>" + esc(r.name) + '</b> is in your Downloads folder.<br><button class="sec" id="again">Download again</button></div>';
      if (r.warnings.length) html += '<div class="warn"><b>Please check:</b><br>' + r.warnings.map(esc).join("<br>") + "</div>";
      $("result").innerHTML = html;
      $("again").addEventListener("click", () => download(lastFile.base64, lastFile.name));
    }
  }

  $("start").addEventListener("click", () => {
    if (timer) return;
    $("result").innerHTML = ""; $("err").classList.add("hidden");
    const sel = $("sel");
    try { api.start(sel ? +sel.value : 0); } catch (e) { showError(report(e && e.stack || e)); return; }
    $("start").disabled = true;
    $("stop").classList.remove("hidden");
    $("status").textContent = "Starting..."; setBar(null);
    timer = setInterval(poll, 400);
  });
  $("stop").addEventListener("click", () => { api.stop(); $("status").textContent = "Stopping..."; });
  $("copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("errtext").value); }
    catch (_) { $("errtext").select(); document.execCommand("copy"); }
    $("copied").textContent = "Copied!";
  });
  root.querySelector(".x").addEventListener("click", () => { if (timer) api.stop(); host.style.display = "none"; });

  window.__steShowPanel = () => { if (!timer) detect(); };
  detect();
})();
