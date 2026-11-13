// Usage: node test/run_tests.js <saved-siebel-page.html>
// Builds a fake paging list from the saved page, runs the extractor and checks the Excel files.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const src = process.argv[2];
if (!src) { console.error("Give the path of a saved Siebel page"); process.exit(2); }
const out = path.join(__dirname, "out");
fs.mkdirSync(out, { recursive: true });
const html = fs.readFileSync(src, "utf8")
  .replace(/<script\b[\s\S]*?<\/script>/gi, "")
  .replace(/<link\b[^>]*>/gi, "")
  .replace(/<img\b[^>]*>/gi, "");
const fixture = path.join(out, "page.html");
fs.writeFileSync(fixture, html);
const ext = path.join(__dirname, "..", "extension");

const cases = [
  { name: "45 records (last page overlaps)", total: 45 },
  { name: "42 records", total: 42 },
  { name: "40 records (exact pages)", total: 40 },
  { name: "20 records (one page)", total: 20 },
  { name: "7 records", total: 7 },
  { name: "start on page 2", total: 65, startAt: 21 },
];

(async () => {
  const browser = await chromium.launch();
  let failed = 0;
  for (const c of cases) {
    const page = await browser.newPage({ acceptDownloads: true });
    await page.goto("file://" + fixture);
    await page.evaluate((cfg) => { window.__MOCK = cfg; }, c);
    await page.addScriptTag({ path: path.join(__dirname, "mock_siebel.js") });
    await page.addScriptTag({ path: path.join(ext, "xlsx.js") });
    await page.addScriptTag({ path: path.join(ext, "extractor.js") });
    const dl = page.waitForEvent("download", { timeout: 120000 });
    await page.locator("#siebel-table-extractor-panel #start").click();
    const d = await dl;
    const file = path.join(out, c.total + (c.startAt ? "_p2" : "") + ".xlsx");
    await d.saveAs(file);
    const panel = await page.locator("#siebel-table-extractor-panel .body").innerText();
    await page.screenshot({ path: file.replace(".xlsx", ".png") });
    const res = JSON.parse(execFileSync("python3", [path.join(__dirname, "check_xlsx.py"), file, String(c.total)]).toString());
    const ok = res.ok && !/check:|wrong/i.test(panel);
    if (!ok) failed++;
    console.log((ok ? "PASS " : "FAIL ") + c.name + " -> " + JSON.stringify(res) + (ok ? "" : "\n" + panel));
    await page.close();
  }
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
