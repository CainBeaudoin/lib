# Static dev server with caching disabled, so edited ES modules always reload.
# Usage: python3 tools/serve.py [port] [dir]
import sys, functools, http.server

class NoCache(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".wav": "audio/wav", ".ogg": "audio/ogg"}
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8790
root = sys.argv[2] if len(sys.argv) > 2 else "."
http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(NoCache, directory=root)).serve_forever()
