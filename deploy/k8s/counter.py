#!/usr/bin/env python3
"""Tiny self-hosted download counter for the PolyglotFormFill site.

Persistence WITHOUT a PersistentVolume (the OCI free tier is out of block-volume quota): the two
tallies live in a Kubernetes ConfigMap ("ppf-counter-state"), which the pod reads on start and
PATCHes on each increment via the in-cluster API using its ServiceAccount token. That survives pod
restarts and re-deploys at zero cost. If the API is briefly unavailable, counting continues in memory
and is flushed on the next successful write — a download must never fail because the tally couldn't save.

Privacy: stores ONLY two integers. Never logs IPs, user agents, or any request detail — counting a
download is an aggregate metric with no user content and no PII. Servers here serve DOWNWARD only.

Endpoints (behind the nginx ingress at the site host):
  GET /counts   -> {"exe": N, "ext": M}   (JSON; read by the site banner)
  GET /dl/exe   -> 302 to the installer, incrementing the exe tally
  GET /dl/ext   -> 302 to the extension zip, incrementing the ext tally
  GET /healthz  -> "ok"
"""
import json
import os
import ssl
import threading
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SA = "/var/run/secrets/kubernetes.io/serviceaccount"
API = "https://kubernetes.default.svc"
CM = os.environ.get("COUNTER_CM", "ppf-counter-state")
SEED = {"exe": int(os.environ.get("COUNTER_SEED_EXE", "0")), "ext": int(os.environ.get("COUNTER_SEED_EXT", "0"))}
TARGET = {"exe": "/download/PolyglotFormFill-Setup.exe", "ext": "/download/polyglotformfill-extension.zip"}

try:
    NS = open(SA + "/namespace").read().strip()
    _CTX = ssl.create_default_context(cafile=SA + "/ca.crt")
except Exception:
    NS, _CTX = "default", None

_lock = threading.Lock()
_state = {"exe": 0, "ext": 0}   # in-memory truth; mirrored to the ConfigMap


def _token():
    return open(SA + "/token").read().strip()


def _api(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method)
    req.add_header("Authorization", "Bearer " + _token())
    req.add_header("Accept", "application/json")
    req.add_header("Content-Type", "application/merge-patch+json" if method == "PATCH" else "application/json")
    with urllib.request.urlopen(req, context=_CTX, timeout=5) as r:
        return json.loads(r.read() or b"{}")


def _load():
    try:
        cm = _api("GET", "/api/v1/namespaces/%s/configmaps/%s" % (NS, CM))
        d = cm.get("data") or {}
        return {"exe": int(d.get("exe", "0")), "ext": int(d.get("ext", "0"))}
    except Exception:
        return None


def _persist():
    try:
        _api("PATCH", "/api/v1/namespaces/%s/configmaps/%s" % (NS, CM),
             {"data": {"exe": str(_state["exe"]), "ext": str(_state["ext"])}})
        return True
    except Exception:
        return False


def _totals():
    return {"exe": _state["exe"] + SEED["exe"], "ext": _state["ext"] + SEED["ext"]}


def _bump(which):
    with _lock:
        _state[which] = _state.get(which, 0) + 1
        _persist()  # best-effort; in-memory already updated so /counts is immediately correct


class Handler(BaseHTTPRequestHandler):
    server_version = "ppf-counter"

    def log_message(self, *args):  # never log requests (no IPs, no PII)
        return

    def _json(self, obj, code=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _redirect(self, location):
        self.send_response(302)
        self.send_header("Location", location)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def do_GET(self):
        path = self.path.split("?", 1)[0].rstrip("/")
        if path == "/healthz":
            self.send_response(200); self.send_header("Content-Length", "2"); self.end_headers(); self.wfile.write(b"ok"); return
        if path == "/counts":
            self._json(_totals()); return
        if path in ("/dl/exe", "/dl/ext"):
            which = "exe" if path.endswith("exe") else "ext"
            try:
                _bump(which)
            except Exception:
                pass
            self._redirect(TARGET[which]); return
        self._json({"error": "not found"}, code=404)


if __name__ == "__main__":
    loaded = _load()
    if loaded:
        _state.update(loaded)
    port = int(os.environ.get("PORT", "8080"))
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
