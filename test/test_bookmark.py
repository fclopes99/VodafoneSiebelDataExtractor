"""End-to-end test of the bookmark.

Starts Chrome, opens a Siebel-like page with fake paging, runs the bookmark exactly like a click
on the bookmarks bar, presses "Extract to Excel" in the panel, and checks the downloaded Excel file.

    python test/test_bookmark.py                      # uses test/synthetic_page.html
    python test/test_bookmark.py path/to/saved.html   # a real saved Siebel page (never commit those)
"""
import glob
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, ".."))
import build  # noqa: E402
from cdp import Tab, http_get_json  # noqa: E402
from check_xlsx import check  # noqa: E402

PORT = 9339
CASES = [  # name, records, start at record, how the pager reacts, columns ("all" or a number)
    ("45 records (last page overlaps)", 45, 0, "click", "all"),
    ("42 records", 42, 0, "click", "all"),
    ("40 records (exact pages)", 40, 0, "click", "all"),
    ("20 records (one page)", 20, 0, "click", "all"),
    ("7 records", 7, 0, "click", "all"),
    ("start on page 2", 65, 21, "click", "all"),
    ("21 records, pager ignores click()", 21, 0, "mousedown", "all"),
    ("45 records, only Siebel command works", 45, 21, "siebel", "all"),
    ("first 8 columns (default)", 42, 0, "click", None),
    ("first 1 column", 42, 0, "click", 1),
    ("first 5 columns", 25, 0, "click", 5),
    ("first 15 columns", 42, 0, "click", 15),
]
INVALID_COUNTS = ["0", "16", "100", "-2", "3.5", "abc", "", " "]
PANEL = "document.getElementById('siebel-table-extractor-panel').shadowRoot"


def find_chrome():
    paths = [os.environ.get("STE_CHROME", ""),
             r"C:\Program Files\Google\Chrome\Application\chrome.exe",
             r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
             "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"]
    return next((p for p in paths if p and os.path.isfile(p)), None)


def wait(cond, timeout, what):
    t0 = time.time()
    while time.time() - t0 < timeout:
        v = cond()
        if v:
            return v
        time.sleep(0.3)
    raise AssertionError("timeout waiting for " + what)


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "synthetic_page.html")
    work = tempfile.mkdtemp(prefix="ste_test_")
    html = open(src, encoding="utf-8").read()
    html = re.sub(r"(?is)<script\b.*?</script>", "", html)
    html = re.sub(r"(?is)<link\b[^>]*>|<img\b[^>]*>|<iframe\b.*?</iframe>", "", html)
    page = os.path.join(work, "page.html")
    open(page, "w", encoding="utf-8").write(html)
    url = "file:///" + page.replace("\\", "/").lstrip("/")
    mock = open(os.path.join(HERE, "mock_siebel.js"), encoding="utf-8").read()
    _, href = build.bookmark_code()

    chrome = find_chrome()
    assert chrome, "Chrome not found (set STE_CHROME)"
    proc = subprocess.Popen([chrome, "--headless=new", "--no-sandbox", "--remote-debugging-port=%d" % PORT,
                             "--user-data-dir=" + os.path.join(work, "profile"), "--no-first-run", "about:blank"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    failed = 0
    try:
        wait(lambda: _version(), 30, "Chrome")
        print("Chrome:", _version(), "| bookmark size: %d KB" % (len(href) // 1024))
        ws = [t for t in http_get_json("http://127.0.0.1:%d/json/list" % PORT) if t["type"] == "page"][0]
        tab = Tab(ws["webSocketDebuggerUrl"])

        def open_page(total, start_at=0, mode="click"):
            tab.call("Page.navigate", {"url": url})
            time.sleep(1.0)
            tab.evaluate("window.__MOCK = {total: %d, startAt: %d, mode: %s}; true" % (total, start_at, json.dumps(mode)))
            tab.evaluate(mock + "\ntrue;")

        def click_bookmark():
            tab.evaluate("location.href = %s; true" % json.dumps(href))
            wait(lambda: tab.evaluate("!!document.getElementById('siebel-table-extractor-panel')"), 10, "panel")

        def panel_text():
            return tab.evaluate(PANEL + ".querySelector('.body').innerText")

        def set_columns(cols):
            """cols: "all" or a number, typed into the panel like a person would."""
            if cols == "all":
                tab.evaluate(PANEL + ".getElementById('cmAll').click(); true")
            else:
                tab.evaluate("(function(){var i=%s.getElementById('ncols'); i.focus(); i.value=%s;"
                             "i.dispatchEvent(new Event('input',{bubbles:true}));})(); true" % (PANEL, json.dumps(str(cols))))

        def start_disabled():
            return tab.evaluate(PANEL + ".getElementById('start').disabled")

        # ---- the default choice on a fresh browser: "first 8 columns"
        open_page(42)
        click_bookmark()
        d = tab.evaluate("[%s.getElementById('cmFirst').checked, %s.getElementById('ncols').value,"
                         " %s.getElementById('nall').textContent, %s.getElementById('colprev').textContent]" % ((PANEL,) * 4))
        all_cols = tab.evaluate("window.__steExtractor.detect()[0].columns")
        ok = d[0] is True and d[1] == "8" and d[2] == str(len(all_cols)) and d[3] == ", ".join(all_cols[:8])
        print(("PASS " if ok else "FAIL ") + "default is the first 8 columns %s" % d)
        failed += not ok

        # ---- file names: client first, accents removed, long names cut at 40 characters
        names = tab.evaluate("""[
          ['CLIENTE EXEMPLO ÁGUA & FILHOS LDA', 'CLIENTE_EXEMPLO_AGUA_FILHOS_LDA_Contratos_de_Permanencia_Activos_'],
          ['Construções São João Ção, Lda.', 'Construcoes_Sao_Joao_Cao_Lda_Contratos_de_Permanencia_Activos_'],
          ['EMPRESA MUITO GRANDE DE TELECOMUNICACOES E SERVICOS INTEGRADOS DO NORTE SA',
           'EMPRESA_MUITO_GRANDE_DE_TELECOMUNICACOES_Contratos_de_Permanencia_Activos_'],
          ['A                                       B C', 'A_B_C_Contratos_de_Permanencia_Activos_'],
          ['', 'Contratos_de_Permanencia_Activos_'],
        ].map(function (c) {
          var n = window.__steExtractor._test.fileNameFor('Contratos de Permanência Activos', c[0]);
          var client = c[0] ? n.split('_Contratos')[0] : '';
          return [n.indexOf(c[1]) === 0 && /^[A-Za-z0-9_\-]+\.xlsx$/.test(n) && client.length <= 40, n];
        })""")
        bad = [n for ok, n in names if not ok]
        print(("PASS " if not bad else "FAIL ") + "file names (accents removed, long names cut)" + (" %s" % bad if bad else ""))
        failed += bool(bad)

        # ---- wrong numbers block the button and show a message
        bad = []
        for v in INVALID_COUNTS:
            set_columns(v)
            vis = tab.evaluate("!" + PANEL + ".getElementById('colerr').classList.contains('hidden')")
            if not (start_disabled() and vis):
                bad.append(repr(v))
        tab.evaluate(PANEL + ".getElementById('start').click(); true")  # must do nothing
        time.sleep(0.5)
        if tab.evaluate("window.__steExtractor.status().state") == "running":
            bad.append("started with an invalid number")
        for v in ["1", "15", "8"]:
            set_columns(v)
            if start_disabled():
                bad.append("valid %s blocked" % v)
        set_columns("abc")
        set_columns("all")  # choosing "all" makes the button usable again
        if start_disabled():
            bad.append("'all' blocked after invalid number")
        print(("PASS " if not bad else "FAIL ") + "invalid column numbers are refused" + (" " + ", ".join(bad) if bad else ""))
        failed += bool(bad)

        # ---- the page script refuses invalid numbers too
        errs = tab.evaluate("[16, 0, 2.5, 'x'].map(function(n){try{window.__steExtractor.start(0,{maxColumns:n});"
                            "return 'accepted';}catch(e){return 'refused';}})")
        ok = errs == ["refused"] * 4
        print(("PASS " if ok else "FAIL ") + "page script refuses invalid numbers %s" % errs)
        failed += not ok

        # ---- every opening starts again on "first 8 columns" (nothing is remembered)
        state = "[%s.getElementById('cmFirst').checked, %s.getElementById('ncols').value]" % (PANEL, PANEL)
        set_columns("all")
        tab.evaluate("document.getElementById('siebel-table-extractor-panel').shadowRoot.querySelector('.x').click(); true")
        click_bookmark()  # same page, panel reopened
        d = tab.evaluate(state)
        set_columns(3)
        open_page(42)
        click_bookmark()  # page reloaded
        d2 = tab.evaluate(state)
        ok = d == [True, "8"] and d2 == [True, "8"]
        print(("PASS " if ok else "FAIL ") + "panel always opens on the first 8 columns %s %s" % (d, d2))
        failed += not ok

        for name, total, start_at, mode, cols in CASES:
            dl = os.path.join(work, "dl_%d_%d_%s_%s" % (total, start_at, mode, cols))
            os.makedirs(dl)
            tab.call("Browser.setDownloadBehavior", {"behavior": "allow", "downloadPath": dl})
            open_page(total, start_at, mode)
            click_bookmark()
            if cols is not None:
                set_columns(cols)
            all_cols = tab.evaluate("window.__steExtractor.detect()[0].columns")
            n = 8 if cols is None else (len(all_cols) if cols == "all" else cols)
            expected_headers = all_cols[:n]
            tab.evaluate(PANEL + ".getElementById('start').click(); true")
            busy = tab.evaluate("[%s.getElementById('ncols').disabled, %s.getElementById('cmAll').disabled]" % (PANEL, PANEL))
            text = wait(lambda: (lambda t: t if ("Done!" in t or "went wrong" in t) else None)(
                tab.evaluate(PANEL + ".querySelector('.body').innerText")), 120, "extraction")
            files = wait(lambda: [f for f in glob.glob(os.path.join(dl, "*.xlsx"))], 15, "download")
            problems = [] if "Done!" in text else ["panel: " + text]
            fname = os.path.basename(files[0])
            if src.endswith("synthetic_page.html") and not fname.startswith(
                    "CLIENTE_EXEMPLO_AGUA_FILHOS_LDA_Contratos_de_Permanencia_Activos_20"):
                problems.append("file name: " + fname)
            problems += check(files[0], total, expected_headers)
            if busy != [True, True]:
                problems.append("column choice not locked while running")
            if "%d columns exported" % len(expected_headers) not in text:
                problems.append("column count not shown: " + text)
            if "Please check" in text:
                problems.append("warning shown: " + text)
            if "Siebel total: %d" % total not in text:
                problems.append("total not shown: " + text)
            failed += bool(problems)
            print(("PASS " if not problems else "FAIL ") + name + ("  -> %s, %d columns" % (fname, len(expected_headers)) if total == 45 and mode == "click" or cols != "all" else "") + ("" if not problems else "\n   " + "\n   ".join(problems)))

        # Pager that never reacts: an error with diagnostics, not a hang
        open_page(42, 0, "dead")
        click_bookmark()
        tab.evaluate(PANEL + ".getElementById('start').click(); true")
        wait(lambda: tab.evaluate(PANEL + ".getElementById('errtext').value"), 90, "error report")
        rep = tab.evaluate(PANEL + ".getElementById('errtext').value")
        ok = "Tried: click (no change); mouse events (no change); Siebel command (failed" in rep and "Button HTML" in rep
        print(("PASS " if ok else "FAIL ") + "dead pager gives an error report with diagnostics")
        failed += not ok
        if not ok:
            print(rep)

        # Clicking the bookmark a second time just shows the panel again
        open_page(42)
        click_bookmark()
        click_bookmark()
        n = tab.evaluate("document.querySelectorAll('#siebel-table-extractor-panel').length")
        print(("PASS " if n == 1 else "FAIL ") + "second click reuses the panel")
        failed += n != 1

        # A panel left open by an older version is replaced by the new one
        tab.evaluate("document.getElementById('siebel-table-extractor-panel').dataset.version = '0.0.1';"
                     "window.__steExtractor.version = '0.0.1'; true")
        click_bookmark()
        v = tab.evaluate("[document.querySelectorAll('#siebel-table-extractor-panel').length,"
                         " document.getElementById('siebel-table-extractor-panel').dataset.version]")
        ok = v == [1, open(os.path.join(HERE, "..", "VERSION")).read().strip()]
        print(("PASS " if ok else "FAIL ") + "old panel replaced by new version %s" % v)
        failed += not ok

        # Stop button
        tab.evaluate(PANEL + ".getElementById('start').click(); true")
        time.sleep(1.0)
        tab.evaluate(PANEL + ".getElementById('stop').click(); true")
        text = wait(lambda: (lambda t: t if "Stopped" in t else None)(
            tab.evaluate(PANEL + ".querySelector('.body').innerText")), 30, "stop")
        print("PASS stop button")

        # Page without a list
        tab.call("Page.navigate", {"url": "data:text/html,<h1>Not Siebel</h1>"})
        time.sleep(0.5)
        click_bookmark()
        text = tab.evaluate(PANEL + ".querySelector('.body').innerText")
        ok = "No Siebel list" in text
        print(("PASS " if ok else "FAIL ") + "page without a list")
        failed += not ok
        tab.close()
    finally:
        proc.terminate()
        time.sleep(0.5)
        shutil.rmtree(work, ignore_errors=True)
    print("FAILED: %d" % failed if failed else "ALL PASSED")
    sys.exit(1 if failed else 0)


def _version():
    try:
        return http_get_json("http://127.0.0.1:%d/json/version" % PORT, timeout=1).get("Browser")
    except Exception:
        return None


if __name__ == "__main__":
    main()
