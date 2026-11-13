"""Checks an exported Excel file produced from the fake paging list (test/mock_siebel.js)."""
import datetime
import sys

import openpyxl


def check(path, total):
    ws = openpyxl.load_workbook(path).active
    rows = list(ws.iter_rows(values_only=True))
    hdr, data = rows[0], rows[1:]
    ci = {h: i for i, h in enumerate(hdr)}
    problems = []
    ids = [r[ci["Serviço"]] for r in data]
    if ids != [str(910000000 + i) for i in range(1, total + 1)]:
        problems.append("ids wrong/out of order: %s ..." % ids[:3])
    first = data[0]
    if first[ci["Multa Mensal s/ IVA"]] != 1.5:
        problems.append("amount not a number: %r" % first[ci["Multa Mensal s/ IVA"]])
    if not isinstance(first[ci["Data de Início"]], datetime.datetime):
        problems.append("date not a date")
    if not isinstance(first[ci["Actualizado em"]], datetime.datetime):
        problems.append("date-time not a date")
    if not isinstance(first[ci["IMEI"]], str):
        problems.append("IMEI not text")
    if first[ci["Duração"]] != 1:
        problems.append("duration %r" % first[ci["Duração"]])
    if first[ci["Pendente"]] not in ("Y", "N"):
        problems.append("flag %r" % first[ci["Pendente"]])
    if "cb" in ci or None in ci:
        problems.append("hidden column exported")
    h = ws["A1"]
    if not (h.font.b and h.font.sz == 12):
        problems.append("header not bold/12")
    if ws.freeze_panes != "A2":
        problems.append("header not frozen")
    if not ws.auto_filter.ref:
        problems.append("no filter")
    return problems


if __name__ == "__main__":
    p = check(sys.argv[1], int(sys.argv[2]))
    print("OK" if not p else "\n".join(p))
