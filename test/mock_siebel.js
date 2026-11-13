// Turns a saved Siebel page into a fake paging list (for tests only).
// window.__MOCK = { total, startAt }
(function () {
  const cfg = window.__MOCK || {};
  const N = cfg.total || 45, PAGE = 20, GRID = "s_1_l";
  const table = document.getElementById(GRID);
  const tbody = table.tBodies[0];
  const template = table.querySelector("tr.jqgrow");
  const counter = document.getElementById("s_1_rc");
  const load = document.getElementById("load_" + GRID);
  const pad = (n) => String(n).padStart(2, "0");
  const records = [];
  for (let i = 1; i <= N; i++) {
    records.push({
      VDF_Service_Identifier: String(910000000 + i),
      VDF_Product_Name: "Product " + i,
      TLCL_Monthly_Fine: i + ",50",
      Agreement_Start_Date: pad((i % 28) + 1) + "-0" + ((i % 9) + 1) + "-2025",
      VDF_Upgrade_IMEI: "35" + String(1000000000000 + i),
      TLCL_Duration: String(i),
    });
  }
  let start = 1, maxSeen = 0;
  function render() {
    const end = Math.min(start + PAGE - 1, N);
    maxSeen = Math.max(maxSeen, end);
    Array.from(tbody.querySelectorAll("tr.jqgrow")).forEach((r) => r.remove());
    for (let k = start; k <= end; k++) {
      const tr = template.cloneNode(true);
      const rowId = String(k - start + 1);
      tr.id = rowId;
      tr.querySelectorAll("td[id]").forEach((td) => {
        const key = td.id.replace(/^\d+_s_1_l_/, "");
        td.id = rowId + "_s_1_l_" + key;
        const rec = records[k - 1];
        if (key in rec) { td.textContent = rec[key]; td.title = rec[key]; }
      });
      tbody.appendChild(tr);
    }
    counter.textContent = start + " - " + end + " de " + N + (maxSeen >= N ? "" : "+");
    const atStart = start === 1, atEnd = end >= N;
    for (const [w, dis] of [["first", atStart], ["prev", atStart], ["next", atEnd], ["last", atEnd]]) {
      document.getElementById(w + "_pager_" + GRID).classList.toggle("ui-state-disabled", dis);
    }
  }
  function go(fn) {
    load.style.display = "block";
    setTimeout(() => { fn(); render(); load.style.display = "none"; }, 300 + Math.random() * 500);
  }
  const btn = (w) => document.getElementById(w + "_pager_" + GRID);
  btn("next").addEventListener("click", function () {
    if (this.classList.contains("ui-state-disabled")) return;
    go(() => { start += PAGE; if (start + PAGE - 1 > N) start = Math.max(1, N - PAGE + 1); });
  });
  btn("first").addEventListener("click", function () {
    if (this.classList.contains("ui-state-disabled")) return;
    go(() => { start = 1; });
  });
  if (cfg.startAt) start = cfg.startAt;
  render();
})();
