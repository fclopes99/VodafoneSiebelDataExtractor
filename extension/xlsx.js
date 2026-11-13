// Minimal .xlsx writer (no external libraries).
// Exposes window.__SteXlsx.build({sheetName, headers, rows}) -> Uint8Array
// Each cell in rows is {t:"s", v:string} | {t:"n", v:number} | {t:"d", v:serial} | {t:"dt", v:serial} | null
(function () {
  if (window.__SteXlsx) return;

  // ---------- ZIP (stored, no compression) ----------
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function zip(files) {
    // files: [{name, data: Uint8Array}]
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
      const nameBytes = enc.encode(f.name);
      const crc = crc32(f.data);
      const size = f.data.length;
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true); // UTF-8 names
      local.setUint16(8, 0, true); // stored
      local.setUint16(10, 0, true);
      local.setUint16(12, 0x21, true); // 1980-01-01
      local.setUint32(14, crc, true);
      local.setUint32(18, size, true);
      local.setUint32(22, size, true);
      local.setUint16(26, nameBytes.length, true);
      local.setUint16(28, 0, true);
      parts.push(new Uint8Array(local.buffer), nameBytes, f.data);

      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, 20, true);
      cd.setUint16(6, 20, true);
      cd.setUint16(8, 0x0800, true);
      cd.setUint16(10, 0, true);
      cd.setUint16(12, 0, true);
      cd.setUint16(14, 0x21, true);
      cd.setUint32(16, crc, true);
      cd.setUint32(20, size, true);
      cd.setUint32(24, size, true);
      cd.setUint16(28, nameBytes.length, true);
      cd.setUint32(42, offset, true);
      central.push(new Uint8Array(cd.buffer), nameBytes);
      offset += 30 + nameBytes.length + size;
    }
    const cdSize = central.reduce((s, p) => s + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);
    const all = parts.concat(central, [new Uint8Array(end.buffer)]);
    const total = all.reduce((s, p) => s + p.length, 0);
    const out = new Uint8Array(total);
    let pos = 0;
    for (const p of all) { out.set(p, pos); pos += p.length; }
    return out;
  }

  // ---------- XLSX ----------
  function esc(s) {
    return String(s)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function colName(i) {
    let s = "";
    i += 1;
    while (i > 0) {
      const m = (i - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      i = Math.floor((i - 1) / 26);
    }
    return s;
  }

  function safeSheetName(name) {
    let n = String(name || "Data").replace(/[\[\]:*?\/\\]/g, " ").replace(/\s+/g, " ").trim();
    if (!n) n = "Data";
    return n.slice(0, 31);
  }

  // Style ids (cellXfs index)
  const S_DEFAULT = 0, S_HEADER = 1, S_DATE = 2, S_DATETIME = 3;

  const STYLES =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="2">' +
    '<numFmt numFmtId="164" formatCode="dd\\-mm\\-yyyy"/>' +
    '<numFmt numFmtId="165" formatCode="dd\\-mm\\-yyyy\\ hh:mm:ss"/>' +
    "</numFmts>" +
    '<fonts count="2">' +
    '<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><b/><sz val="12"/><name val="Calibri"/><family val="2"/></font>' +
    "</fonts>" +
    '<fills count="3">' +
    '<fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFD9E1F2"/><bgColor indexed="64"/></patternFill></fill>' +
    "</fills>" +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="4">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    "</cellXfs>" +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    "</styleSheet>";

  function build({ sheetName, headers, rows }) {
    const name = safeSheetName(sheetName);
    const nCols = headers.length;
    const lastCol = colName(Math.max(nCols - 1, 0));
    const lastRow = rows.length + 1;

    // Column widths from content length
    const widths = headers.map((h) => Math.min(Math.max(String(h).length * 1.2 + 4, 8), 60));
    for (const r of rows) {
      for (let c = 0; c < nCols; c++) {
        const cell = r[c];
        if (!cell) continue;
        let len;
        if (cell.t === "d") len = 10;
        else if (cell.t === "dt") len = 19;
        else len = String(cell.raw != null ? cell.raw : cell.v).length;
        widths[c] = Math.min(Math.max(widths[c], len + 2), 60);
      }
    }

    const out = [];
    out.push(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<dimension ref="A1:' + lastCol + lastRow + '"/>' +
        '<sheetViews><sheetView workbookViewId="0" tabSelected="1">' +
        '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
        '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>' +
        "</sheetView></sheetViews>" +
        '<sheetFormatPr defaultRowHeight="15"/>' +
        "<cols>"
    );
    widths.forEach((w, i) => {
      out.push('<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w.toFixed(1) + '" customWidth="1"/>');
    });
    out.push("</cols><sheetData>");

    // Header row
    out.push('<row r="1" ht="20" customHeight="1">');
    headers.forEach((h, c) => {
      out.push('<c r="' + colName(c) + '1" t="inlineStr" s="' + S_HEADER + '"><is><t xml:space="preserve">' + esc(h) + "</t></is></c>");
    });
    out.push("</row>");

    rows.forEach((r, ri) => {
      const rn = ri + 2;
      out.push('<row r="' + rn + '">');
      for (let c = 0; c < nCols; c++) {
        const cell = r[c];
        if (!cell || cell.v === "" || cell.v == null) continue;
        const ref = colName(c) + rn;
        if (cell.t === "n") out.push('<c r="' + ref + '"><v>' + cell.v + "</v></c>");
        else if (cell.t === "d") out.push('<c r="' + ref + '" s="' + S_DATE + '"><v>' + cell.v + "</v></c>");
        else if (cell.t === "dt") out.push('<c r="' + ref + '" s="' + S_DATETIME + '"><v>' + cell.v + "</v></c>");
        else out.push('<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + esc(cell.v) + "</t></is></c>");
      }
      out.push("</row>");
    });

    out.push("</sheetData>");
    if (nCols > 0) out.push('<autoFilter ref="A1:' + lastCol + lastRow + '"/>');
    out.push('<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>');
    out.push("</worksheet>");

    const quoted = "'" + name.replace(/'/g, "''") + "'";
    const workbook =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="' + esc(name) + '" sheetId="1" r:id="rId1"/></sheets>' +
      (nCols > 0
        ? '<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">' +
          esc(quoted) + "!$A$1:$" + lastCol + "$" + lastRow + "</definedName></definedNames>"
        : "") +
      "</workbook>";

    const enc = new TextEncoder();
    const files = [
      {
        name: "[Content_Types].xml",
        text:
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          "</Types>",
      },
      {
        name: "_rels/.rels",
        text:
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          "</Relationships>",
      },
      { name: "xl/workbook.xml", text: workbook },
      {
        name: "xl/_rels/workbook.xml.rels",
        text:
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
          '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
          "</Relationships>",
      },
      { name: "xl/styles.xml", text: STYLES },
      { name: "xl/worksheets/sheet1.xml", text: out.join("") },
    ];
    return zip(files.map((f) => ({ name: f.name, data: enc.encode(f.text) })));
  }

  window.__SteXlsx = { build };
})();
