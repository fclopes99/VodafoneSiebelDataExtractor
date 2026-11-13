"""Siebel Table Extractor - desktop window."""
import os
import queue
import subprocess
import threading
import traceback

import tkinter as tk
from tkinter import ttk

import core
from version import VERSION

GREEN = "#1d6f42"
GREY = "#6b7280"
RED = "#b42318"
AMBER = "#8a5a00"


class App:
    def __init__(self, root):
        self.root = root
        self.q = queue.Queue()
        self.tabs = []
        self.running = False
        self.stop_flag = threading.Event()
        self.last_path = None
        self.settings = core.load_settings()

        root.title("Siebel Table Extractor")
        root.minsize(560, 600)
        try:
            root.iconbitmap(core.resource_path("icon.ico"))
        except tk.TclError:
            pass
        root.report_callback_exception = self.on_tk_error

        style = ttk.Style()
        if "vista" in style.theme_names():
            style.theme_use("vista")
        base = ("Segoe UI", 10)
        style.configure(".", font=base)
        style.configure("Title.TLabel", font=("Segoe UI", 15, "bold"))
        style.configure("Step.TLabelframe.Label", font=("Segoe UI", 11, "bold"))
        style.configure("Big.TButton", font=("Segoe UI", 12, "bold"), padding=(10, 8))
        style.configure("Small.TLabel", foreground=GREY, font=("Segoe UI", 9))

        outer = ttk.Frame(root, padding=14)
        outer.pack(fill="both", expand=True)

        head = ttk.Frame(outer)
        head.pack(fill="x")
        ttk.Label(head, text="Siebel Table Extractor", style="Title.TLabel").pack(side="left")
        ttk.Label(head, text="version " + VERSION, style="Small.TLabel").pack(side="right", anchor="s")

        # ---- Step 1
        s1 = ttk.LabelFrame(outer, text=" 1. Open Chrome for extraction ", style="Step.TLabelframe", padding=10)
        s1.pack(fill="x", pady=(12, 0))
        ttk.Label(s1, wraplength=500, justify="left",
                  text="This opens a separate Chrome window that this app can read. "
                       "The first time, log in to Siebel in that window. Next time you may already be logged in."
                  ).pack(anchor="w")
        row = ttk.Frame(s1)
        row.pack(fill="x", pady=(8, 0))
        ttk.Label(row, text="Siebel address:").pack(side="left")
        self.url_var = tk.StringVar(value=self.settings.get("siebel_url", ""))
        ttk.Entry(row, textvariable=self.url_var).pack(side="left", fill="x", expand=True, padx=(6, 0))
        ttk.Label(s1, text="Optional. Chrome opens this page. Leave empty to open a blank tab.",
                  style="Small.TLabel").pack(anchor="w")
        row = ttk.Frame(s1)
        row.pack(fill="x", pady=(8, 0))
        self.open_btn = ttk.Button(row, text="Open Chrome", command=self.open_chrome)
        self.open_btn.pack(side="left")
        self.conn_lbl = tk.Label(row, text="", font=("Segoe UI", 10))
        self.conn_lbl.pack(side="left", padx=10)

        # ---- Step 2
        s2 = ttk.LabelFrame(outer, text=" 2. Choose the tab with the Siebel list ", style="Step.TLabelframe", padding=10)
        s2.pack(fill="x", pady=(12, 0))
        lb_frame = ttk.Frame(s2)
        lb_frame.pack(fill="x")
        self.listbox = tk.Listbox(lb_frame, height=5, activestyle="none", font=("Segoe UI", 10),
                                  exportselection=False, selectbackground=GREEN)
        self.listbox.pack(side="left", fill="x", expand=True)
        sb = ttk.Scrollbar(lb_frame, orient="vertical", command=self.listbox.yview)
        sb.pack(side="left", fill="y")
        self.listbox.config(yscrollcommand=sb.set)
        self.listbox.bind("<<ListboxSelect>>", lambda e: self.show_url())
        row = ttk.Frame(s2)
        row.pack(fill="x", pady=(6, 0))
        self.url_lbl = ttk.Label(row, text="", style="Small.TLabel", wraplength=420)
        self.url_lbl.pack(side="left")
        ttk.Button(row, text="Refresh", command=self.refresh_tabs).pack(side="right")

        # ---- Step 3
        s3 = ttk.LabelFrame(outer, text=" 3. Extract ", style="Step.TLabelframe", padding=10)
        s3.pack(fill="both", expand=True, pady=(12, 0))
        row = ttk.Frame(s3)
        row.pack(fill="x")
        self.go_btn = ttk.Button(row, text="Extract to Excel", style="Big.TButton", command=self.start)
        self.go_btn.pack(side="left", fill="x", expand=True)
        self.stop_btn = ttk.Button(row, text="Stop", command=self.stop)
        self.status_lbl = ttk.Label(s3, text="", wraplength=500)
        self.status_lbl.pack(anchor="w", pady=(8, 0))
        self.bar = ttk.Progressbar(s3, mode="indeterminate")

        self.result = tk.Frame(s3)
        self.result_lbl = tk.Label(self.result, text="", justify="left", anchor="w", wraplength=500,
                                   font=("Segoe UI", 10))
        self.result_lbl.pack(fill="x", anchor="w")
        self.result_btns = ttk.Frame(self.result)
        ttk.Button(self.result_btns, text="Open file", command=self.open_file).pack(side="left")
        ttk.Button(self.result_btns, text="Show in folder", command=self.open_folder).pack(side="left", padx=6)
        self.warn_lbl = tk.Label(self.result, text="", justify="left", anchor="w", wraplength=500,
                                 fg=AMBER, font=("Segoe UI", 10))

        self.err = ttk.Frame(s3)
        tk.Label(self.err, text="Something went wrong.", fg=RED, font=("Segoe UI", 10, "bold")).pack(anchor="w")
        self.err_msg = tk.Label(self.err, text="", fg=RED, justify="left", anchor="w", wraplength=500,
                                font=("Segoe UI", 10))
        self.err_msg.pack(anchor="w", fill="x")
        ttk.Label(self.err, text="Click \"Copy error\" and send the text to whoever maintains this tool.",
                  style="Small.TLabel").pack(anchor="w", pady=(4, 0))
        self.err_text = tk.Text(self.err, height=7, font=("Consolas", 9), wrap="word")
        self.err_text.pack(fill="both", expand=True, pady=(4, 0))
        row = ttk.Frame(self.err)
        row.pack(fill="x", pady=(6, 0))
        ttk.Button(row, text="Copy error", command=self.copy_error).pack(side="left")
        self.copied_lbl = ttk.Label(row, text="", style="Small.TLabel")
        self.copied_lbl.pack(side="left", padx=8)

        self.root.after(100, self.poll_queue)
        self.refresh_tabs()

    # ------------------------------------------------------------ helpers
    def run_bg(self, fn, *args):
        def wrapper():
            try:
                fn(*args)
            except Exception as e:  # never let a thread die silently
                self.q.put(("error", (str(e), traceback.format_exc(), None)))
        threading.Thread(target=wrapper, daemon=True).start()

    def poll_queue(self):
        try:
            while True:
                kind, payload = self.q.get_nowait()
                getattr(self, "on_" + kind)(payload)
        except queue.Empty:
            pass
        self.root.after(100, self.poll_queue)

    def on_tk_error(self, exc, val, tb):
        self.on_error((str(val), "".join(traceback.format_exception(exc, val, tb)), None))

    def selected_tab(self):
        sel = self.listbox.curselection()
        return self.tabs[sel[0]] if sel and sel[0] < len(self.tabs) else None

    def clear_messages(self):
        self.result.pack_forget()
        self.err.pack_forget()
        self.status_lbl.config(text="")

    # ------------------------------------------------------------ step 1
    def open_chrome(self):
        url = self.url_var.get().strip()
        if url and "://" not in url:
            url = "https://" + url
        self.settings["siebel_url"] = self.url_var.get().strip()
        core.save_settings(self.settings)
        self.open_btn.config(state="disabled")
        self.clear_messages()
        self.status_lbl.config(text="Opening Chrome...")
        self.run_bg(self._open_chrome, url)

    def _open_chrome(self, url):
        try:
            core.launch_chrome(url)
            self.q.put(("chrome_opened", None))
        except core.ExtractError as e:
            self.q.put(("error", (str(e), e.details, None)))
        finally:
            self.q.put(("enable_open", None))

    def on_enable_open(self, _):
        self.open_btn.config(state="normal")

    def on_chrome_opened(self, _):
        self.status_lbl.config(text="Chrome is open. Log in to Siebel there if needed, open your list, "
                                    "then choose the tab in step 2.")
        self.refresh_tabs()

    # ------------------------------------------------------------ step 2
    def refresh_tabs(self, auto=False):
        if not auto or not self.running:
            self.run_bg(lambda: self.q.put(("tabs", core.list_tabs())))
        if auto:
            self.root.after(3000, lambda: self.refresh_tabs(auto=True))

    def on_tabs(self, tabs):
        if not hasattr(self, "_auto_started"):
            self._auto_started = True
            self.root.after(3000, lambda: self.refresh_tabs(auto=True))
        if tabs is None:
            self.conn_lbl.config(text="●  Not open yet", fg=GREY)
            tabs = []
        else:
            self.conn_lbl.config(text="●  Connected to Chrome", fg=GREEN)
        prev = self.selected_tab()
        prev_id = prev["id"] if prev else None
        if [(t["id"], t["title"]) for t in tabs] == [(t["id"], t["title"]) for t in self.tabs]:
            return
        self.tabs = tabs
        self.listbox.delete(0, "end")
        for t in tabs:
            self.listbox.insert("end", "  " + t["title"])
        idx = next((i for i, t in enumerate(tabs) if t["id"] == prev_id), None)
        if idx is None and tabs:
            idx = next((i for i, t in enumerate(tabs) if "siebel" in t["url"].lower()), 0)
        if idx is not None:
            self.listbox.selection_set(idx)
            self.listbox.see(idx)
        self.show_url()

    def show_url(self):
        t = self.selected_tab()
        self.url_lbl.config(text=t["url"][:120] if t else "")

    # ------------------------------------------------------------ step 3
    def start(self):
        if self.running:
            return
        self.clear_messages()
        tab = self.selected_tab()
        if not tab:
            self.status_lbl.config(text="First open Chrome (step 1) and choose the tab with the Siebel list (step 2).")
            return
        self.set_running(True)
        self.status_lbl.config(text="Looking for the list in the tab...")
        self.run_bg(self._detect, tab)

    def _detect(self, tab):
        try:
            self.q.put(("lists", (tab, core.detect_lists(tab))))
        except core.ExtractError as e:
            self.q.put(("error", (str(e), e.details, tab)))
        except Exception as e:
            self.q.put(("error", (str(e), traceback.format_exc(), tab)))

    def on_lists(self, payload):
        tab, lists = payload
        if not lists:
            self.set_running(False)
            self.status_lbl.config(text="No Siebel list with data was found in this tab.\n"
                                        "Open the list in Siebel (with the results showing) and try again.")
            return
        if len(lists) == 1:
            self.begin(tab, lists[0])
        else:
            self.choose_list(tab, lists)

    def choose_list(self, tab, lists):
        win = tk.Toplevel(self.root)
        win.title("Choose the list")
        win.transient(self.root)
        win.grab_set()
        frm = ttk.Frame(win, padding=14)
        frm.pack(fill="both", expand=True)
        ttk.Label(frm, text="This tab has more than one list. Which one do you want?").pack(anchor="w", pady=(0, 8))
        var = tk.IntVar(value=0)
        for i, l in enumerate(lists):
            text = l["title"] + ("   (" + l["counter"] + ")" if l.get("counter") else "")
            ttk.Radiobutton(frm, text=text, variable=var, value=i).pack(anchor="w", pady=2)
        chosen = {"ok": False}

        def ok():
            chosen["ok"] = True
            win.destroy()

        row = ttk.Frame(frm)
        row.pack(fill="x", pady=(10, 0))
        ttk.Button(row, text="Extract", command=ok).pack(side="right")
        ttk.Button(row, text="Cancel", command=win.destroy).pack(side="right", padx=6)
        self.root.wait_window(win)
        if chosen["ok"]:
            self.begin(tab, lists[var.get()])
        else:
            self.set_running(False)
            self.status_lbl.config(text="")

    def begin(self, tab, lst):
        self.stop_flag.clear()
        self.status_lbl.config(text="Extracting \"%s\"..." % lst["title"])
        self.run_bg(self._extract, tab, lst["index"])

    def _extract(self, tab, index):
        try:
            res = core.extract(tab, index,
                               lambda msg, frac: self.q.put(("progress", (msg, frac))),
                               self.stop_flag.is_set)
            self.q.put(("done", res))
        except core.ExtractError as e:
            self.q.put(("error", (str(e), e.details, tab)))
        except Exception as e:
            self.q.put(("error", (str(e), traceback.format_exc(), tab)))

    def stop(self):
        self.stop_flag.set()
        self.stop_btn.config(state="disabled")
        self.status_lbl.config(text="Stopping...")

    def set_running(self, running):
        self.running = running
        if running:
            self.go_btn.config(state="disabled")
            self.stop_btn.config(state="normal")
            self.stop_btn.pack(side="left", padx=(8, 0))
            self.bar.config(mode="indeterminate")
            self.bar.pack(fill="x", pady=(6, 0))
            self.bar.start(12)
        else:
            self.go_btn.config(state="normal")
            self.stop_btn.pack_forget()
            self.bar.stop()
            self.bar.pack_forget()

    def on_progress(self, payload):
        msg, frac = payload
        self.status_lbl.config(text=msg)
        if frac is None:
            if str(self.bar.cget("mode")) != "indeterminate":
                self.bar.config(mode="indeterminate")
                self.bar.start(12)
        else:
            if str(self.bar.cget("mode")) != "determinate":
                self.bar.stop()
                self.bar.config(mode="determinate", maximum=100)
            self.bar["value"] = frac * 100

    def on_done(self, res):
        self.set_running(False)
        if res is None:
            self.status_lbl.config(text="Stopped. No file was created.")
            return
        self.status_lbl.config(text="")
        self.last_path = res["path"]
        total = " (Siebel total: %s)" % res["total"] if res.get("total") is not None else ""
        self.result_lbl.config(fg=GREEN, text="Done! %d rows exported%s.\nSaved as: %s" % (
            res["rows"], total, res["path"]))
        self.result_btns.pack(anchor="w", pady=(6, 0))
        if res.get("warnings"):
            self.warn_lbl.config(text="Please check:\n• " + "\n• ".join(res["warnings"]))
            self.warn_lbl.pack(anchor="w", fill="x", pady=(8, 0))
        else:
            self.warn_lbl.pack_forget()
        self.result.pack(fill="x", pady=(10, 0))

    def on_error(self, payload):
        message, details, tab = payload
        self.set_running(False)
        self.status_lbl.config(text="")
        self.result.pack_forget()
        report = core.error_report(message, details, tab)
        core.write_log("ERROR\n" + report)
        self.err_msg.config(text=message)
        self.err_text.config(state="normal")
        self.err_text.delete("1.0", "end")
        self.err_text.insert("1.0", report)
        self.err_text.config(state="disabled")
        self.copied_lbl.config(text="")
        self.err.pack(fill="both", expand=True, pady=(10, 0))

    def copy_error(self):
        self.root.clipboard_clear()
        self.root.clipboard_append(self.err_text.get("1.0", "end").strip())
        self.copied_lbl.config(text="Copied! Now paste it in your message.")

    def open_file(self):
        if self.last_path and os.path.exists(self.last_path):
            if os.name == "nt":
                os.startfile(self.last_path)
            else:
                subprocess.Popen(["xdg-open", self.last_path])

    def open_folder(self):
        if self.last_path:
            if os.name == "nt":
                subprocess.Popen(["explorer", "/select,", os.path.normpath(self.last_path)])
            else:
                subprocess.Popen(["xdg-open", os.path.dirname(self.last_path)])


def main():
    if os.name == "nt":
        try:
            import ctypes
            ctypes.windll.shcore.SetProcessDpiAwareness(1)
        except Exception:
            pass
    root = tk.Tk()
    App(root)
    root.mainloop()


if __name__ == "__main__":
    try:
        main()
    except Exception:
        core.write_log("CRASH\n" + traceback.format_exc())
        raise
