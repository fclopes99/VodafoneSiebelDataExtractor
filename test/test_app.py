"""End-to-end test of the app's extraction (everything except the window).

Starts Chrome with remote debugging, opens a Siebel-like page with fake paging,
runs core.extract() exactly like the app does, and checks the Excel file.

    python test/test_app.py                      # uses test/synthetic_page.html
    python test/test_app.py path/to/saved.html   # uses a real saved Siebel page (never commit those)
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "app"))
import core  # noqa: E402
from check_xlsx import check  # noqa: E402

PORT = 9339
CASES = [
    ("45 records (last page overlaps)", 45, 0),
    ("42 records", 42, 0),
    ("40 records (exact pages)", 40, 0),
    ("20 records (one page)", 20, 0),
    ("7 records", 7, 0),
    ("start on page 2", 65, 21),
]


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "synthetic_page.html")
    work = tempfile.mkdtemp(prefix="ste_test_")
    html = open(src, encoding="utf-8").read()
    html = re.sub(r"(?is)<script\b.*?</script>", "", html)
    html = re.sub(r"(?is)<link\b[^>]*>|<img\b[^>]*>", "", html)
    page = os.path.join(work, "page.html")
    open(page, "w", encoding="utf-8").write(html)
    mock = open(os.path.join(HERE, "mock_siebel.js"), encoding="utf-8").read()

    chrome = core.find_chrome()
    assert chrome, "Chrome not found (set STE_CHROME)"
    profile = os.path.join(work, "profile")
    proc = subprocess.Popen([chrome, "--headless=new", "--no-sandbox", "--remote-debugging-port=%d" % PORT,
                             "--user-data-dir=" + profile, "--no-first-run", "about:blank"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    failed = 0
    try:
        for _ in range(60):
            if core.chrome_version(PORT):
                break
            time.sleep(0.5)
        print("Chrome:", core.chrome_version(PORT))
        tab = core.list_tabs(PORT)[0]
        url = "file:///" + page.replace("\\", "/").lstrip("/")
        for name, total, start_at in CASES:
            conn = core.connect(tab)
            conn.call("Page.navigate", {"url": url})
            time.sleep(1.0)
            conn.evaluate("window.__MOCK = {total: %d, startAt: %d}; true" % (total, start_at))
            conn.evaluate(mock + "\ntrue;")
            conn.close()

            lists = core.detect_lists(tab)
            assert len(lists) == 1 and lists[0]["title"] == "Contratos de Permanência Activos", lists
            msgs = []
            res = core.extract(tab, 0, lambda m, f: msgs.append(m), lambda: False, out_dir=work)
            problems = check(res["path"], total)
            if res["warnings"]:
                problems.append("warnings: %s" % res["warnings"])
            if res["rows"] != total or res["total"] != total:
                problems.append("rows %s total %s" % (res["rows"], res["total"]))
            ok = not problems
            failed += not ok
            print(("PASS " if ok else "FAIL ") + name + "  (%d rows, %d pages, %d progress updates)%s" % (
                res["rows"], res["pages"], len(msgs), "" if ok else "\n   " + "\n   ".join(problems)))

        # Stop button
        conn = core.connect(tab)
        conn.call("Page.navigate", {"url": url})
        time.sleep(1.0)
        conn.evaluate("window.__MOCK = {total: 200}; true")
        conn.evaluate(mock + "\ntrue;")
        conn.close()
        t0 = time.time()
        res = core.extract(tab, 0, lambda m, f: None, lambda: time.time() - t0 > 1.5, out_dir=work)
        print(("PASS " if res is None else "FAIL ") + "stop button")
        failed += res is not None

        # Page without a list
        conn = core.connect(tab)
        conn.call("Page.navigate", {"url": "about:blank"})
        time.sleep(0.5)
        conn.close()
        empty = core.detect_lists(tab)
        print(("PASS " if empty == [] else "FAIL ") + "page without a list")
        failed += empty != []
    finally:
        proc.terminate()
        time.sleep(0.5)
        shutil.rmtree(work, ignore_errors=True)
    print("FAILED: %d" % failed if failed else "ALL PASSED")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
