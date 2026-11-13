"""Everything except the window: finding/launching Chrome, listing tabs, running the extraction."""
import base64
import json
import os
import platform
import subprocess
import sys
import time

from cdp import CDPError, Tab, http_get_json
from version import VERSION

PORT = 9222
APP_DIR = os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~/.local/share"), "SiebelTableExtractor")
PROFILE_DIR = os.path.join(APP_DIR, "ChromeProfile")
SETTINGS_FILE = os.path.join(APP_DIR, "settings.json")
LOG_FILE = os.path.join(APP_DIR, "log.txt")


class ExtractError(Exception):
    """An error with a message meant for the user plus technical details."""

    def __init__(self, message, details=""):
        super().__init__(message)
        self.details = details


# ---------------------------------------------------------------- files / settings
def resource_path(*parts):
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, *parts)


def load_settings():
    try:
        with open(SETTINGS_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_settings(data):
    try:
        os.makedirs(APP_DIR, exist_ok=True)
        with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    except OSError:
        pass


def write_log(text):
    try:
        os.makedirs(APP_DIR, exist_ok=True)
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(time.strftime("%Y-%m-%d %H:%M:%S") + "  " + text + "\n")
    except OSError:
        pass


def downloads_folder():
    if os.name == "nt":
        try:
            import winreg
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                                r"Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders") as k:
                path = winreg.QueryValueEx(k, "{374DE290-123F-4565-9164-39C4925E467B}")[0]
                if os.path.isdir(path):
                    return path
        except OSError:
            pass
    path = os.path.join(os.path.expanduser("~"), "Downloads")
    return path if os.path.isdir(path) else os.path.expanduser("~")


# ---------------------------------------------------------------- Chrome
def find_chrome():
    candidates = []
    if os.name == "nt":
        for env in ("PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"):
            base = os.environ.get(env)
            if base:
                candidates.append(os.path.join(base, "Google", "Chrome", "Application", "chrome.exe"))
        try:
            import winreg
            for root in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
                try:
                    with winreg.OpenKey(root, r"Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe") as k:
                        candidates.append(winreg.QueryValueEx(k, None)[0])
                except OSError:
                    pass
        except ImportError:
            pass
    else:
        candidates += ["/usr/bin/google-chrome", "/usr/bin/chromium", "/opt/pw-browsers/chromium/chrome-linux/chrome",
                       "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
    env_path = os.environ.get("STE_CHROME")
    if env_path:
        candidates.insert(0, env_path)
    for c in candidates:
        if c and os.path.isfile(c):
            return c
    return None


def chrome_version(port=PORT):
    """Returns Chrome's version string if our Chrome is reachable, else None."""
    try:
        return http_get_json("http://127.0.0.1:%d/json/version" % port, timeout=1.5).get("Browser")
    except Exception:
        return None


def launch_chrome(url="", port=PORT, extra_args=None, wait=20):
    chrome = find_chrome()
    if not chrome:
        raise ExtractError("Google Chrome was not found on this computer.",
                           "Looked in Program Files, Local AppData and the registry.")
    os.makedirs(PROFILE_DIR, exist_ok=True)
    args = [chrome, "--remote-debugging-port=%d" % port, "--user-data-dir=" + PROFILE_DIR,
            "--no-first-run", "--no-default-browser-check"]
    args += extra_args or []
    if url:
        args.append(url)
    write_log("Launching: " + " ".join(args))
    flags = 0
    if os.name == "nt":
        flags = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    subprocess.Popen(args, creationflags=flags, close_fds=True,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    t0 = time.time()
    while time.time() - t0 < wait:
        if chrome_version(port):
            return
        time.sleep(0.5)
    raise ExtractError(
        "Chrome opened, but this app could not connect to it.",
        "Nothing answered on 127.0.0.1:%d after %d seconds. Possible causes: your company's Chrome settings "
        "block remote debugging (policy RemoteDebuggingAllowed), or another program uses port %d." % (port, wait, port))


def list_tabs(port=PORT):
    """Open web pages in our Chrome, or None if Chrome is not reachable."""
    try:
        items = http_get_json("http://127.0.0.1:%d/json/list" % port, timeout=1.5)
    except Exception:
        return None
    tabs = []
    for t in items:
        if t.get("type") != "page" or not t.get("webSocketDebuggerUrl"):
            continue
        if t.get("url", "").startswith(("devtools://", "chrome-extension://", "chrome://")):
            continue
        tabs.append({"id": t["id"], "title": t.get("title") or "(no title)", "url": t.get("url", ""),
                     "ws": t["webSocketDebuggerUrl"]})
    return tabs


# ---------------------------------------------------------------- extraction
def _page_script():
    parts = []
    for name in ("xlsx.js", "extractor.js"):
        with open(resource_path("js", name), encoding="utf-8") as f:
            parts.append(f.read())
    return "window.__STE_VERSION = %s;\n" % json.dumps(VERSION) + "\n".join(parts) + "\ntrue;"


def connect(tab):
    try:
        return Tab(tab["ws"])
    except (OSError, CDPError) as e:
        raise ExtractError("Could not connect to the selected tab. Click Refresh and try again.", repr(e))


def inject(conn):
    current = conn.evaluate("(window.__steExtractor && window.__steExtractor.version) || ''")
    if current != VERSION:
        conn.evaluate("delete window.__steExtractor; delete window.__SteXlsx; true")
        conn.evaluate(_page_script())


def detect_lists(tab):
    """Returns [{index, title, counter, id}] for the lists with data in this tab."""
    conn = connect(tab)
    try:
        inject(conn)
        return json.loads(conn.evaluate("JSON.stringify(window.__steExtractor.detect())"))
    finally:
        conn.close()


def extract(tab, list_index, on_progress, should_stop, out_dir=None):
    """Runs the extraction in the tab and saves the .xlsx. Returns a result dict."""
    conn = connect(tab)
    try:
        inject(conn)
        conn.evaluate("window.__steExtractor.start(%d)" % int(list_index))
        stop_sent = False
        while True:
            time.sleep(0.4)
            if should_stop() and not stop_sent:
                conn.evaluate("window.__steExtractor.stop()")
                stop_sent = True
            raw = conn.evaluate("window.__steExtractor ? JSON.stringify(window.__steExtractor.status()) : ''")
            if not raw:
                raise ExtractError("The Siebel page was reloaded or changed during the extraction. Please try again.")
            st = json.loads(raw)
            if st["state"] == "running":
                on_progress(st.get("message") or "", st.get("fraction"))
                continue
            if st["state"] == "stopped":
                return None
            if st["state"] == "error":
                first = st["error"].split("Error: ", 1)[-1].split("\n", 1)[0]
                raise ExtractError(first, st["error"])
            if st["state"] == "done":
                break
            raise ExtractError("Unexpected state from the page: %r" % st.get("state"), raw)

        on_progress("Saving the Excel file...", None)
        res = json.loads(conn.evaluate("JSON.stringify(window.__steExtractor.takeResult())"))
    finally:
        conn.close()

    data = base64.b64decode(res.pop("base64"))
    out_dir = out_dir or downloads_folder()
    path = os.path.join(out_dir, res["name"])
    root, ext = os.path.splitext(path)
    i = 2
    while os.path.exists(path):
        path = "%s (%d)%s" % (root, i, ext)
        i += 1
    try:
        with open(path, "wb") as f:
            f.write(data)
    except OSError as e:
        raise ExtractError("Could not save the Excel file in " + out_dir, repr(e))
    res["path"] = path
    write_log("Saved %s (%d rows, total %s, %d pages, %d warnings)" % (
        path, res["rows"], res["total"], res["pages"], len(res["warnings"])))
    return res


def error_report(message, details, tab=None):
    lines = [
        "=== Siebel Table Extractor - error report ===",
        "App version: " + VERSION,
        "Time: " + time.strftime("%Y-%m-%d %H:%M:%S"),
        "Windows: " + platform.platform(),
        "Chrome: " + (chrome_version() or "not connected"),
        "Tab: " + ((tab or {}).get("title", "-")),
        "",
        "Problem: " + message,
    ]
    if details:
        lines += ["", "Details:", details]
    return "\n".join(lines)
