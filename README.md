# Siebel Table Extractor

A small Windows program that exports a Siebel list to Excel. It reads **all pages** of the list
by clicking the "next" arrow for you, removes the rows Siebel repeats on the last page, and
saves an `.xlsx` file in your Downloads folder.

## Download

Get **SiebelTableExtractor.exe** from the latest release:
https://github.com/fclopes99/VodafoneSiebelDataExtractor/releases/latest

Nothing to install: save it somewhere (for example your Desktop) and double-click it.
If Windows shows *"Windows protected your PC"*, click **More info** → **Run anyway**.

## Use

1. **Open Chrome** – click **Open Chrome** in the app. This opens a separate Chrome window that
   the app can read (your normal Chrome can't be used, Chrome doesn't allow it).
   The first time, log in to Siebel in that window. You can type the Siebel address in the app
   so Chrome opens it directly; it is remembered.
2. **Choose the tab** – in that Chrome window, open the Siebel list and search so the results
   show. The tab appears in the app's list; select it.
3. **Extract** – click **Extract to Excel**. Don't use Siebel in that tab until it finishes.
   When it says **Done!**, click **Open file**.

The app always starts from the first page. At the end it compares the number of rows with the
total Siebel reports and shows **Please check** if they don't match.

### If something goes wrong

The app shows the problem in red. Click **Copy error** and send the copied text so it can be fixed.
A log is also kept in `%LOCALAPPDATA%\SiebelTableExtractor\log.txt`.

## What ends up in the Excel file

- Only the columns visible in Siebel, in the same order.
- Header row: bold, slightly bigger, frozen at the top, with filter arrows.
- Amounts like `3,79` and short whole numbers like `30` → real numbers.
- `14-07-2025` → real date; `14-07-2025 16:25:36` → real date and time (shown as dd-mm-yyyy).
- Long numbers (phone numbers, IMEI, IDs) and anything with letters → text, exactly as shown.
- Checkbox columns → `Y` / `N`.

## How it works (for developers)

- `app/main.py` – the window (tkinter).
- `app/core.py` – starts Chrome with `--remote-debugging-port=9222` and its own profile in
  `%LOCALAPPDATA%\SiebelTableExtractor\ChromeProfile` (Chrome ignores remote debugging on the
  default profile), lists tabs, runs the extraction and saves the file.
- `app/cdp.py` – a small Chrome DevTools Protocol client using only the standard library
  (ignores proxy settings, which matters on company PCs).
- `app/js/extractor.js` – injected into the Siebel tab: finds the Siebel jqGrid list, pages
  through it and converts values. Rows are placed by their record number from the Siebel
  counter (`21 - 40 de 42+`), so the overlap on the last page is removed exactly.
- `app/js/xlsx.js` – a small `.xlsx` writer.

### Tests

```
pip install openpyxl
python test/test_app.py
```

This starts Chrome, opens `test/synthetic_page.html` (made-up data with the same structure as a
Siebel list) with fake paging (`test/mock_siebel.js`), and checks the Excel files.
`python test/test_app.py <saved page.html>` runs the same tests on a saved Siebel page.
**Never commit saved Siebel pages: they contain customer data.** `test/fixtures/` is git-ignored.

### Building the exe

GitHub Actions tests and builds the exe on Windows (`.github/workflows/build.yml`). Every push to
`main` publishes it as the release named after `app/version.py` (bump the version for a new release). To build locally on Windows:

```
pip install pyinstaller
pyinstaller --onefile --windowed --name SiebelTableExtractor --icon app/icon.ico --add-data "app/js;js" --add-data "app/icon.ico;." --paths app app/main.py
```
