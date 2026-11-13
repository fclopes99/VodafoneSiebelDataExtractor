"""Tiny Chrome DevTools Protocol client (standard library only).

Talks to Chrome on 127.0.0.1 over a WebSocket. Written by hand so that no proxy
settings on the computer can get in the way and no extra packages are needed.
"""
import base64
import json
import os
import socket
import struct
import urllib.parse
import urllib.request


class CDPError(Exception):
    pass


def http_get_json(url, timeout=3):
    """GET a JSON document from Chrome's local debugging server, ignoring any proxy."""
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(url, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


class WebSocket:
    def __init__(self, url, timeout=30):
        u = urllib.parse.urlparse(url)
        if u.scheme != "ws":
            raise CDPError("Unsupported WebSocket address: " + url)
        host, port = u.hostname, u.port or 80
        path = u.path + ("?" + u.query if u.query else "")
        self.sock = socket.create_connection((host, port), timeout=timeout)
        self.sock.settimeout(timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        req = (
            "GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\nUpgrade: websocket\r\n"
            "Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
        ).format(path=path, host=host, port=port, key=key)
        self.sock.sendall(req.encode())
        resp = b""
        while b"\r\n\r\n" not in resp:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise CDPError("Chrome closed the connection during the handshake.")
            resp += chunk
        head, self._buf = resp.split(b"\r\n\r\n", 1)
        status_line = head.split(b"\r\n", 1)[0].decode(errors="replace")
        if " 101 " not in status_line + " ":
            raise CDPError("Chrome refused the connection: " + head.decode(errors="replace")[:500])

    def _read(self, n):
        while len(self._buf) < n:
            chunk = self.sock.recv(max(65536, n - len(self._buf)))
            if not chunk:
                raise CDPError("The connection to Chrome was closed (was the tab or Chrome closed?).")
            self._buf += chunk
        data, self._buf = self._buf[:n], self._buf[n:]
        return data

    def _send_frame(self, opcode, payload):
        header = bytes([0x80 | opcode])
        n = len(payload)
        if n < 126:
            header += bytes([0x80 | n])
        elif n < 65536:
            header += bytes([0x80 | 126]) + struct.pack(">H", n)
        else:
            header += bytes([0x80 | 127]) + struct.pack(">Q", n)
        mask = os.urandom(4)
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload)) if n < 4096 else _mask_fast(payload, mask)
        self.sock.sendall(header + mask + masked)

    def send(self, text):
        self._send_frame(0x1, text.encode("utf-8"))

    def recv(self):
        message = b""
        while True:
            b1, b2 = self._read(2)
            fin, opcode = b1 & 0x80, b1 & 0x0F
            n = b2 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._read(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._read(8))[0]
            mask = self._read(4) if b2 & 0x80 else None
            payload = self._read(n)
            if mask:
                payload = _mask_fast(payload, mask)
            if opcode == 0x8:
                raise CDPError("Chrome closed the connection (was the tab closed?).")
            if opcode == 0x9:
                self._send_frame(0xA, payload)
                continue
            if opcode == 0xA:
                continue
            message += payload
            if fin:
                return message.decode("utf-8")

    def close(self):
        try:
            self._send_frame(0x8, b"")
        except OSError:
            pass
        try:
            self.sock.close()
        except OSError:
            pass


def _mask_fast(data, mask):
    n = len(data)
    m = int.from_bytes((mask * (n // 4 + 1))[:n], "big")
    return (int.from_bytes(data, "big") ^ m).to_bytes(n, "big") if n else b""


class Tab:
    """A connection to one Chrome tab."""

    def __init__(self, ws_url, timeout=30):
        self.ws = WebSocket(ws_url, timeout=timeout)
        self._id = 0

    def call(self, method, params=None):
        self._id += 1
        my_id = self._id
        self.ws.send(json.dumps({"id": my_id, "method": method, "params": params or {}}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == my_id:
                if "error" in msg:
                    raise CDPError("{}: {}".format(method, msg["error"].get("message", msg["error"])))
                return msg.get("result", {})
            # events are ignored

    def evaluate(self, expression, await_promise=False):
        res = self.call("Runtime.evaluate", {
            "expression": expression,
            "returnByValue": True,
            "awaitPromise": await_promise,
        })
        if "exceptionDetails" in res:
            d = res["exceptionDetails"]
            exc = d.get("exception", {})
            desc = exc.get("description") or d.get("text") or json.dumps(d)[:1000]
            raise CDPError("Error inside the page: " + desc)
        return res.get("result", {}).get("value")

    def close(self):
        self.ws.close()
