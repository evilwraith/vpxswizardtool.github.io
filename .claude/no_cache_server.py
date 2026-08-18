"""Static file server that disables caching, for local dev/testing.

Usage: python .claude/no_cache_server.py [port]
"""
import http.server
import socketserver
import sys


class NoCacheHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8934
    with socketserver.TCPServer(('', port), NoCacheHTTPRequestHandler) as httpd:
        print(f'Serving on port {port} with caching disabled')
        httpd.serve_forever()
