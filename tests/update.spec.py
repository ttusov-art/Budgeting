"""
Checks that a new version on the server reaches an open app on reload,
with GitHub Pages' 10-minute caching (Cache-Control: max-age=600).
Works on a temporary copy of the app, because it changes version files.
Run:  python3 tests/update.spec.py
"""
import sys, threading, functools, re, shutil, tempfile
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from playwright.sync_api import sync_playwright
SITE = Path(tempfile.mkdtemp()) / 'site'
shutil.copytree(Path(__file__).resolve().parent.parent, SITE, ignore=shutil.ignore_patterns('tests'))
class GH(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'max-age=600')  # like GitHub Pages
        super().end_headers()
    def log_message(self, *a):
        pass
srv = ThreadingHTTPServer(("localhost", 8790), functools.partial(GH, directory=str(SITE)))
threading.Thread(target=srv.serve_forever, daemon=True).start()

def set_version(v):
    import time; time.sleep(1.2)  # the test server compares file times in whole seconds
    p = SITE/'js/version.js'; p.write_text(re.sub(r"'[^']*'", f"'{v}'", p.read_text(), count=1))
    (SITE/'version.json').write_text('{ "version": "%s" }\n' % v)

def shown_version(page):
    page.evaluate("location.hash = 'settings'")
    page.wait_for_timeout(100)
    return re.search(r"version (\S+ \S)", page.locator("main").inner_text()).group(1)

ok = True
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(); page = ctx.new_page()
    set_version('2026-10-31 d')
    page.goto("http://localhost:8790/")
    page.evaluate("navigator.serviceWorker.ready")
    page.reload(); page.wait_for_timeout(300)
    print("controlled by SW:", page.evaluate("!!navigator.serviceWorker.controller"))
    print("before:", shown_version(page))
    # New version appears on the server while the page is open
    set_version('2026-10-31 e')
    page.reload()
    page.wait_for_timeout(300)
    v = shown_version(page)
    print("after plain reload:", v); ok &= v.endswith('e')
    # Banner path: simulate the 30-minute check finding a newer version
    set_version('2026-10-31 f')
    page.evaluate("document.getElementById('update-banner').hidden = false")
    with page.expect_navigation():
        page.click("#reload-btn")
    page.wait_for_load_state()
    v = shown_version(page)
    print("after banner Reload:", v); ok &= v.endswith('f')
    b.close()
srv.shutdown()
print("PASS" if ok else "FAIL")
sys.exit(0 if ok else 1)
