# Extract to Excel (Siebel)

A bookmark button for Chrome that exports a Siebel list to Excel. It reads **all pages** of the
list by clicking the "next" arrow for you, removes the rows Siebel repeats on the last page, and
saves an `.xlsx` file in the Downloads folder. It works in the Chrome window you already have open,
with nothing to install (company-managed Chrome blocks extensions and outside programs).

## Install (once)

1. Download **Install-Extract-to-Excel.html** from the latest release:
   https://github.com/fclopes99/VodafoneSiebelDataExtractor/releases/latest
2. Open it in Chrome and drag the green **Extract to Excel** button onto the bookmarks bar.

## Use

1. Open the list in Siebel, with the results showing.
2. Click **Extract to Excel** on the bookmarks bar. A small green panel appears.
3. Choose the columns: **only the first N columns** (1 to 15, it starts on 8 every time) or
   **all columns**.
4. Click **Extract to Excel** in the panel and wait until it says **Done!**
5. The Excel file is in **Downloads**, named with the client (cut at 40 characters), the list and the date, e.g.
   `DOMINGOS_EUSEBIO_TEIXEIRA_LOPES_LDA_Contratos_de_Permanencia_Activos_2026-11-13_1530.xlsx`.

If something goes wrong, the panel shows a red box: click **Copy error** and send the text.

## What ends up in the Excel file

- The columns you chose, in the same order as in Siebel (hidden columns are never exported).
- Header row: bold, slightly bigger, frozen at the top, with filter arrows.
- Amounts like `3,79` and short whole numbers like `30` → real numbers.
- `14-07-2025` → real date; `14-07-2025 16:25:36` → real date and time (dd-mm-yyyy).
- Long numbers (phone numbers, IMEI, IDs) and anything with letters → text, exactly as shown.
- Checkbox columns → `Y` / `N`.

## For developers

- `src/extractor.js` – finds the Siebel jqGrid list, pages through it, converts values. Rows are
  placed by their record number from the Siebel counter (`21 - 40 de 42+`), so the overlap on the
  last page is removed exactly.
- `src/xlsx.js` – a small `.xlsx` writer. `src/panel.js` – the on-page panel.
- `build.py` – packs the three files into one bookmark and writes `dist/Install-Extract-to-Excel.html`.
- `VERSION` – bump it for a new release. Every push to `main` is tested on Windows with Chrome and
  published as the release named after `VERSION` (`.github/workflows/build.yml`).

Tests (needs Chrome and `pip install openpyxl`):

```
python build.py
python test/test_bookmark.py
```

The test opens `test/synthetic_page.html` (made-up data, same structure as a Siebel list) with fake
paging (`test/mock_siebel.js`), runs the bookmark, and checks the downloaded Excel files.
`python test/test_bookmark.py <saved page.html>` runs it on a saved Siebel page.
**Never commit saved Siebel pages: they contain customer data.** `test/fixtures/` is git-ignored.
