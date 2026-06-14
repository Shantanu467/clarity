#!/usr/bin/env python3
"""Minimal static file server for local preview of Clarity.
Serves the directory this script lives in, on the port given as argv[1]
(default 8000). Used by .claude/launch.json for the preview panel.
"""
import os
import sys
import http.server
import socketserver

ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(ROOT)
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        # avoid stale cache during development
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


class Server(socketserver.TCPServer):
    allow_reuse_address = True


with Server(("0.0.0.0", PORT), Handler) as httpd:
    print(f"Serving {ROOT}")
    print(f"  On this Mac:      http://localhost:{PORT}")
    print(f"  On your phone:    http://<this-Mac-LAN-IP>:{PORT}  (same Wi-Fi)")
    httpd.serve_forever()
