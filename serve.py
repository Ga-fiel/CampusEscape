import http.server, socketserver, os

BASE_PORT = 8911
ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(ROOT)

class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

class ReuseTCPServer(socketserver.TCPServer):
    allow_reuse_address = True   # 避免 TIME_WAIT 导致的占用

# 端口被占用就自动往后找一个可用的
port = BASE_PORT
while True:
    try:
        httpd = ReuseTCPServer(('127.0.0.1', port), H)
        break
    except OSError:
        port += 1
        if port > BASE_PORT + 20:
            raise

print(f'serving on http://127.0.0.1:{port}')
httpd.serve_forever()
