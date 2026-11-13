"""Checks an exported Excel file produced from the fake paging list (test/mock_siebel.js)."""
import datetime
import sys

import openpyxl


def check(path, total, headers=None):
    """headers: the exact header row expected (None = don't compare)."""
    ws = openpyxl.load_workbook(path).active
    rows = list(ws.iter_rows(values_only=True))
    hdr, data = list(rows[0]), rows[1:]
    ci = {h: i for i, h in enumerate(hdr)}
    problems = []
    if headers is not None and hdr != list(headers):
        problems.append("headers %s, expected %s" % (hdr, list(headers)))
    if len(data) != total:
        problems.append("%d data rows, expected %d" % (len(data), total))
    if "Serviço" in ci:
        ids = [r[ci["Serviço"]] for r in data]
        if ids != [str(910000000 + i) for i in range(1, total + 1)]:
            problems.append("ids wrong/out of order: %s ..." % ids[:3])
    first = data[0] if data else ()
    expect = {
        "Multa Mensal s/ IVA": lambda v: v == 1.5,
        "Data de Início": lambda v: isinstance(v, datetime.datetime),
        "Actualizado em": lambda v: isinstance(v, datetime.datetime) and v.hour == 16,
        "IMEI": lambda v: isinstance(v, str),
        "Duração": lambda v: v == 1,
        "Pendente": lambda v: v in ("Y", "N"),
    }
    for col, ok in expect.items():
        if col in ci and first and not ok(first[ci[col]]):
            problems.append("%s has wrong value/type: %r" % (col, first[ci[col]]))
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
