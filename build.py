"""Builds dist/Install-Extract-to-Excel.html: a page with a button to drag to the bookmarks bar.

The bookmark contains the whole extractor (src/*.js). Clicking it on a Siebel list opens the panel.

    python build.py
"""
import html
import os
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))


def read(*parts):
    with open(os.path.join(HERE, *parts), encoding="utf-8") as f:
        return f.read()


def bookmark_code():
    version = read("VERSION").strip()
    code = (
        "(function(){"
        "if(!window.__steExtractor||window.__steExtractor.version!==%r){"
        "window.__STE_VERSION=%r;\n%s\n%s\n}\n%s\n})();void 0;"
        % (version, version, read("src", "xlsx.js"), read("src", "extractor.js"), read("src", "panel.js"))
    )
    return version, "javascript:" + urllib.parse.quote(code, safe="")


PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Install Extract to Excel</title>
<style>
  body {{ font: 17px/1.5 "Segoe UI", Arial, sans-serif; color: #1f2933; background: #f5f7fa; margin: 0; }}
  main {{ max-width: 680px; margin: 40px auto; background: #fff; border-radius: 12px; padding: 32px 36px;
          box-shadow: 0 4px 20px rgba(0,0,0,.08); }}
  h1 {{ margin-top: 0; font-size: 26px; }}
  ol {{ padding-left: 24px; }}
  li {{ margin: 14px 0; }}
  .drag {{ display: inline-block; background: #1d6f42; color: #fff; font-weight: 700; font-size: 19px;
           padding: 14px 26px; border-radius: 10px; text-decoration: none; cursor: grab; margin: 8px 0; }}
  .center {{ text-align: center; margin: 18px 0; }}
  kbd {{ background: #eef1f4; border: 1px solid #c7d0db; border-radius: 4px; padding: 1px 6px; font-size: 15px; }}
  .note {{ background: #fff8e1; border: 1px solid #f0c36d; border-radius: 8px; padding: 12px 16px; font-size: 15px; }}
  details {{ margin-top: 22px; font-size: 15px; color: #52606d; }}
  button {{ font: inherit; padding: 8px 14px; border-radius: 6px; border: 1px solid #c7d0db; background: #f5f7fa; cursor: pointer; }}
  .small {{ font-size: 13px; color: #6b7280; margin-top: 26px; }}
</style>
</head>
<body>
<main>
  <h1>Install "Extract to Excel"</h1>
  <ol>
    <li>Make sure the <b>bookmarks bar</b> is visible under the address bar.
        If not, press <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>B</kbd>.</li>
    <li>With the mouse, <b>drag the green button below onto the bookmarks bar</b> and let go.
      <div class="center"><a class="drag" id="bm" href="{href}">Extract to Excel</a></div>
    </li>
    <li>Done! You can close this page. You can also delete the <b>Test</b> bookmark.</li>
  </ol>

  <h2>How to use it</h2>
  <ol>
    <li>Open the list in Siebel, with the results showing.</li>
    <li>Click <b>Extract to Excel</b> on the bookmarks bar. A small green panel appears at the top right.</li>
    <li>Click <b>Extract to Excel</b> in the panel and wait. Don't use that Siebel tab until it says <b>Done!</b></li>
    <li>The Excel file is in your <b>Downloads</b> folder.</li>
  </ol>
  <p class="note">If something goes wrong, the panel shows a red box. Click <b>Copy error</b> and send the text.</p>

  <details>
    <summary>Dragging doesn't work?</summary>
    <p>Right-click the bookmarks bar &rarr; <b>Add page…</b>. Name: <b>Extract to Excel</b>.
       For the URL, click this button and paste (<kbd>Ctrl</kbd> + <kbd>V</kbd>):
       <button id="copy">Copy the URL</button> <span id="copied"></span></p>
  </details>
  <p class="small">Version {version}. To update: delete the old bookmark and drag the new button.</p>
</main>
<script>
  document.getElementById("bm").addEventListener("click", function (e) {{
    e.preventDefault();
    alert("Don't click it here: drag it onto the bookmarks bar.");
  }});
  document.getElementById("copy").addEventListener("click", function () {{
    var url = document.getElementById("bm").getAttribute("href");
    var done = function () {{ document.getElementById("copied").textContent = "Copied!"; }};
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, function () {{ fallback(url); done(); }});
    else {{ fallback(url); done(); }}
  }});
  function fallback(text) {{
    var t = document.createElement("textarea"); t.value = text; document.body.appendChild(t);
    t.select(); document.execCommand("copy"); t.remove();
  }}
</script>
</body>
</html>
"""


def main():
    version, href = bookmark_code()
    os.makedirs(os.path.join(HERE, "dist"), exist_ok=True)
    out = os.path.join(HERE, "dist", "Install-Extract-to-Excel.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(PAGE.format(href=html.escape(href, quote=True), version=version))
    print("%s  (version %s, bookmark %d KB)" % (out, version, len(href) // 1024))


if __name__ == "__main__":
    main()
