# Changelog

## 3.1.1 – 2026-11-13
- Fix: a panel left open on the page by an older version was reused, so the old code ran.
  The new version now replaces it.

## 3.1.0 – 2026-11-13
- Fix: on the real Siebel, the "next" arrow ignored the click and the extraction stopped after
  page 1. If a click doesn't change the page, it now tries a full mouse click, Siebel's own paging
  command, and the Enter key, and keeps using the one that works.
- If paging still fails, the error report includes details about the arrow and Siebel.

## 3.0.0 – 2026-11-13
- Now a bookmark button that runs in the Chrome window already open (company-managed Chrome
  blocks extensions, and Chrome doesn't let outside programs control an open window).
- Removed the Windows app.

## 2.0.0 – 2026-11-13
- Now a Windows program (.exe) instead of a Chrome extension, because company-managed Chrome
  blocks self-installed extensions.
- The app opens its own Chrome window, lists its tabs, and extracts the chosen one.
- Errors are shown in the app with a "Copy error" button and written to a log file.

## 1.0.0 – 2026-11-13
- First version (Chrome extension): export every page of a Siebel list to Excel, removing rows
  repeated on the last page.
