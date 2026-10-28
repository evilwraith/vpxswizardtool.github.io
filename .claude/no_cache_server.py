"""Static file server that disables caching, for local dev/testing.

Usage: python .claude/no_cache_server.py [port]
"""
import errno
import http.server
import ipaddress
import socket
import sys

# Tailscale gives out IPv4 addresses from the CGNAT range, which ipaddress
# does not count as private. Its IPv6 range (fd7a:115c:a1e0::/48) is a ULA,
# which it already does.
TAILSCALE_V4 = ipaddress.ip_network('100.64.0.0/10')


class NoCacheHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()


def is_local_client(host):
    """True for this PC, the home LAN and tailnet devices; False for anything
    on the public internet."""
    ip = ipaddress.ip_address(host.split('%')[0])
    ip = getattr(ip, 'ipv4_mapped', None) or ip
    return ip.is_private or (ip.version == 4 and ip in TAILSCALE_V4)


class LocalOnlyServer(http.server.ThreadingHTTPServer):
    """One thread per connection, so a client holding a connection open
    (a VS Code window did) cannot block every other request. Listens on every
    interface so a phone on the LAN or tailnet can test the site, but drops
    any connection from a public address."""
    # HTTPServer turns SO_REUSEADDR on, and on Windows that lets a second
    # copy bind a port this one already holds, with no error. Off, a second
    # start fails loudly instead of racing this one for requests.
    allow_reuse_address = False

    def verify_request(self, request, client_address):
        if is_local_client(client_address[0]):
            return True
        sys.stderr.write(f'Refused non-local client {client_address[0]}\n')
        return False


class DualStackServer(LocalOnlyServer):
    """Listens on IPv6 with IPv4 mapped in, so `localhost` works whether the
    browser resolves it to ::1 or 127.0.0.1."""
    address_family = socket.AF_INET6

    def server_bind(self):
        self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        super().server_bind()


def make_server(port):
    try:
        return DualStackServer(('::', port), NoCacheHTTPRequestHandler)
    except OSError as err:
        if err.errno not in (errno.EAFNOSUPPORT, errno.EPROTONOSUPPORT, errno.ENOPROTOOPT):
            raise
        print(f'IPv6 unavailable ({err}); serving IPv4 only - use http://127.0.0.1:{port}')
        return LocalOnlyServer(('', port), NoCacheHTTPRequestHandler)


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8934
    with make_server(port) as httpd:
        print(f'Serving on port {port} with caching disabled')
        httpd.serve_forever()
