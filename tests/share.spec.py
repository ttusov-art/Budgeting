"""
Checks the "Share → Household Budget" route: Android sends the statement
to ./share-target as a form POST, the service worker parks it, and the app
imports it on the Purchases screen. Also checks the "Open with" route
(file handler) and an empty share.
Run:  python3 tests/share.spec.py
"""
import sys, threading, functools, re
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = (ROOT / "tests" / "fixtures" / "revolut-week1.csv").read_text(encoding="utf-8")

class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

srv = ThreadingHTTPServer(("localhost", 8791), functools.partial(Quiet, directory=str(ROOT)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = "http://localhost:8791/"

results = []
def check(name, cond):
    results.append(bool(cond))
    print(("  ok   " if cond else "  FAIL ") + name)

SHARE = """async ({ text, name }) => {
  const form = new FormData();
  if (text !== null) form.append('statement', new File([text], name, { type: 'text/csv' }));
  form.append('title', 'Statement');
  const r = await fetch('share-target', { method: 'POST', body: form });
  return { url: r.url, redirected: r.redirected };
}"""

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context()
    page = ctx.new_page()
    page.goto(BASE)
    page.evaluate("navigator.serviceWorker.ready")
    page.reload()
    page.wait_for_function("!!navigator.serviceWorker.controller")

    manifest = page.evaluate("fetch('manifest.webmanifest').then(r => r.json())")
    check("manifest declares a share target for CSV files",
          manifest.get("share_target", {}).get("method") == "POST"
          and "text/csv" in manifest["share_target"]["params"]["files"][0]["accept"])
    check("manifest declares a CSV file handler", "text/csv" in manifest.get("file_handlers", [{}])[0].get("accept", {}))

    # 1) Share a statement
    r = page.evaluate(SHARE, {"text": FIXTURE, "name": "account-statement.csv"})
    # (fetch drops the "#buys" part of the address it was sent to; a real launch keeps it)
    check("share is redirected into the app (%s)" % r["url"], r["redirected"] and r["url"].endswith("/?shared=1"))
    page.goto(r["url"] + "#buys")
    page.wait_for_selector("#toast.show")
    msg = page.locator("#toast").inner_text()
    check("shared statement is imported (toast: %s)" % msg.strip(), re.search(r"[1-9]\d* new purchase", msg))
    check("address is cleaned up after import", page.url.endswith("/#buys"))
    rows = page.locator("main .list li").count()
    check("purchases wait in To sort", rows > 0)
    cache_left = page.evaluate("caches.open('household-budget-shared').then(c => c.keys()).then(k => k.length)")
    check("the parked file is removed after import", cache_left == 0)

    # 2) Sharing the same file again: nothing duplicated
    r = page.evaluate(SHARE, {"text": FIXTURE, "name": "account-statement.csv"})
    page.goto(r["url"] + "#buys")
    page.wait_for_selector("#toast.show")
    msg = page.locator("#toast").inner_text()
    check("sharing again adds nothing new (toast: %s)" % msg.strip(), "0 new purchases" in msg and "already imported" in msg)

    # 3) Share without a file
    r = page.evaluate(SHARE, {"text": None, "name": ""})
    page.goto(r["url"] + "#buys")
    page.wait_for_selector("#toast.show")
    check("empty share explains what to do", "No statement file arrived" in page.locator("#toast").inner_text())

    # 4) Reloading after an import doesn't import again
    page.reload()
    page.wait_for_timeout(300)
    check("reload doesn't re-import", not page.locator("#toast.show").count())
    b.close()

srv.shutdown()
print(f"{sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)
