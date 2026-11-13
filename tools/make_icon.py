"""Draws the app icon (green table) and writes app/icon.ico. Run once; the result is committed."""
import os
import struct
import zlib


def png(n):
    G, W, H, T = (29, 111, 66, 255), (255, 255, 255, 255), (200, 230, 210, 255), (0, 0, 0, 0)
    r = n * 0.18
    m = n * 0.2
    lw = max(1, n // 16)
    rows = []
    for y in range(n):
        row = []
        for x in range(n):
            cx, cy = min(x, n - 1 - x), min(y, n - 1 - y)
            if cx < r and cy < r and (r - cx) ** 2 + (r - cy) ** 2 > r * r:
                row.append(T)
                continue
            if m <= x < n - m and m <= y < n - m:
                gx, gy = (x - m) / (n - 2 * m), (y - m) / (n - 2 * m)
                if gy < 0.3:
                    row.append(H)
                    continue
                k = lw / (n - 2 * m) / 2 + 0.01
                line = abs(gx - 0.4) < k or abs(gy - 0.3) < k or abs(gy - 0.65) < k
                row.append(G if line else W)
            else:
                row.append(G)
        rows.append(row)
    raw = b"".join(b"\x00" + bytes(c for p in row for c in p) for row in rows)

    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", n, n, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


sizes = [16, 24, 32, 48, 64, 128, 256]
images = [png(s) for s in sizes]
out = struct.pack("<HHH", 0, 1, len(sizes))
offset = 6 + 16 * len(sizes)
for s, data in zip(sizes, images):
    out += struct.pack("<BBBBHHII", s % 256, s % 256, 0, 0, 1, 32, len(data), offset)
    offset += len(data)
out += b"".join(images)
path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "icon.ico")
open(path, "wb").write(out)
print("wrote", path)
