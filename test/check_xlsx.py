import sys, json, datetime, openpyxl
path, total = sys.argv[1], int(sys.argv[2])
wb = openpyxl.load_workbook(path)
ws = wb.active
rows = list(ws.iter_rows(values_only=True))
hdr = rows[0]; data = rows[1:]
ci = {h: i for i, h in enumerate(hdr)}
ids = [r[ci["Serviço"]] for r in data]
expect = [str(910000000 + i) for i in range(1, total + 1)]
problems = []
if ids != expect: problems.append("ids mismatch: %s..." % ids[:3])
if not isinstance(data[0][ci["Multa Mensal s/ IVA"]], float): problems.append("fine not number")
if data[0][ci["Multa Mensal s/ IVA"]] != 1.5: problems.append("fine value %r" % data[0][ci["Multa Mensal s/ IVA"]])
if not isinstance(data[0][ci["Data de Início"]], datetime.datetime): problems.append("date not date")
if not isinstance(data[0][ci["Actualizado em"]], datetime.datetime): problems.append("datetime not date")
if not isinstance(data[0][ci["IMEI"]], str): problems.append("IMEI not text")
if data[0][ci["Duração"]] != 1: problems.append("duration %r" % data[0][ci["Duração"]])
if data[0][ci["Pendente"]] not in ("Y", "N"): problems.append("flag %r" % data[0][ci["Pendente"]])
h = ws["A1"]
if not (h.font.b and h.font.sz == 12): problems.append("header style")
if ws.freeze_panes != "A2": problems.append("freeze %r" % ws.freeze_panes)
if not ws.auto_filter.ref: problems.append("no filter")
print(json.dumps({"ok": not problems, "rows": len(data), "cols": len(hdr), "problems": problems,
                  "sheet": ws.title, "sample": [str(v) for v in data[0][:9]]}, ensure_ascii=False))
