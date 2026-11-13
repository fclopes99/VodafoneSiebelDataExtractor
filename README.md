# Siebel Table Extractor

A Chrome extension that exports a Siebel list to Excel. It reads **all pages** of the list
by clicking the "next" arrow, removes the rows Siebel repeats on the last page, and
downloads an `.xlsx` file.

## Install (one time)

1. Unzip the extension into a folder you will **keep**, for example
   `Documents\SiebelTableExtractor`. Chrome loads it from this folder every time, so don't delete it.
2. In Chrome, type `chrome://extensions` in the address bar and press Enter.
3. Turn on **Developer mode** (switch at the top right).
4. Click **Load unpacked** and choose the folder that contains `manifest.json`.
5. Pin it: click the puzzle icon 🧩 next to the address bar and click the pin next to
   **Siebel Table Extractor**. A green table icon appears in the toolbar.

If Chrome shows a message about developer-mode extensions when it starts, you can close it.

## Use

1. In Siebel, open the list and search so the results are showing.
2. Click the green table icon in the toolbar. A small panel opens at the top right of the page.
3. Click **Extract to Excel**. Don't use Siebel in that tab until it finishes.
4. When it shows **Done!**, the file is in your **Downloads** folder, named after the list
   (for example `Contratos_de_Permanencia_Activos_2026-11-13_1530.xlsx`).

The panel always starts from the first page. At the end it compares the number of rows with
the total Siebel reports, and shows a yellow **Please check** box if they don't match.

### If something goes wrong

The panel shows a red box. Click **Copy error** and send the copied text so it can be fixed.

## What ends up in the Excel file

- Only the columns visible in Siebel, in the same order.
- Header row: bold, slightly bigger, frozen at the top, with filter arrows.
- Amounts like `3,79` and short whole numbers like `30` → real numbers.
- `14-07-2025` → real date; `14-07-2025 16:25:36` → real date and time (shown as dd-mm-yyyy).
- Long numbers (phone numbers, IMEI, IDs) and anything with letters → text, exactly as shown.
- Checkbox columns → `Y` / `N`.

## Update to a new version

Replace the files in your folder with the new ones, open `chrome://extensions`, and click the
round reload arrow on the **Siebel Table Extractor** card.

## For developers

- `extension/` – the extension (Manifest V3, no external libraries).
  - `background.js` – injects the scripts when the toolbar icon is clicked.
  - `extractor.js` – finds the Siebel jqGrid list, pages through it, converts values, shows the panel.
  - `xlsx.js` – a small `.xlsx` writer.
- Rows are placed by their record number from the Siebel counter (`21 - 40 de 42+`), so the
  overlap on the last page is removed exactly.
- Tests: `node test/run_tests.js <saved Siebel page.html>` (needs Playwright and Python with
  `openpyxl`). The test turns a saved Siebel page into a fake paging list with made-up records.
  Don't commit saved Siebel pages: they contain customer data. `test/fixtures/` is git-ignored.
- Package: `./build.sh` → `dist/siebel-table-extractor-v<version>.zip`.
