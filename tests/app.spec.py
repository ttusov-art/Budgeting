"""
End-to-end tests with Playwright (made-up data only).

Run from the project folder:
    python3 tests/app.spec.py
It starts a local web server, fakes the Google Apps Script backend,
and drives the app on an Android phone profile and a laptop viewport.
Screenshots go to tests/screenshots/.
"""
import json
import re
import sys
import threading
import functools
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / "tests" / "screenshots"
SHOTS.mkdir(exist_ok=True)
PORT = 8765
BASE = f"http://localhost:{PORT}/"
SYNC_URL = "https://script.google.com/macros/s/TEST/exec"
KEY = "test-key-0123456789abcdef"
NOW = "2026-10-31T10:00:00+01:00"


# ---------- local web server ----------
class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def start_server():
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    srv = ThreadingHTTPServer(("localhost", PORT), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


# ---------- fake Apps Script: same logic as apps-script/Code.gs ----------
class FakeSheet:
    def __init__(self):
        self.rows = {}  # id -> {"rec":..., "seq":...}
        self.seq = 0
        self.lock = threading.Lock()

    def handle(self, route):
        body = json.loads(route.request.post_data or "{}")
        if body.get("key") != KEY:
            return route.fulfill(json={"ok": False, "error": "Wrong sync key."})
        if body.get("action") == "ping":
            return route.fulfill(json={"ok": True})
        with self.lock:
            for rec in body.get("records", []):
                old = self.rows.get(rec["id"])
                if old and old["rec"]["updatedAt"] >= rec["updatedAt"]:
                    continue
                self.seq += 1
                self.rows[rec["id"]] = {"rec": rec, "seq": self.seq}
            since = int(body.get("since") or 0)
            changed = [r["rec"] for r in self.rows.values() if r["seq"] > since]
            return route.fulfill(json={"ok": True, "serverTime": self.seq, "records": changed})


errors = []
checks = []


def check(name, cond):
    checks.append((name, bool(cond)))
    print(("  ok   " if cond else "  FAIL ") + name)


def new_page(browser, device=None, viewport=None, sheet=None):
    opts = dict(device or {})
    if viewport:
        opts["viewport"] = viewport
    ctx = browser.new_context(**opts, locale="en-GB", timezone_id="Europe/Berlin")
    page = ctx.new_page()
    page.clock.install(time=NOW)
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.on("console", lambda m: m.type == "error" and errors.append(f"console: {m.text}"))
    if sheet:
        page.route("https://script.google.com/**", sheet.handle)
    return ctx, page


def swipe(page, dx, dy=0, ms=150):
    """Simulate a one-finger swipe on the page (dx < 0 = right-to-left)."""
    page.evaluate("""async ([dx, dy, ms]) => {
        const x0 = 200, y0 = 450, el = document.querySelector('main');
        const touch = (x, y) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
        el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [touch(x0, y0)], changedTouches: [touch(x0, y0)] }));
        await new Promise(r => setTimeout(r, ms));
        const end = touch(x0 + dx, y0 + dy);
        el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [end] }));
    }""", [dx, dy, ms])
    page.wait_for_timeout(50)


def fill_form(page, values):
    dlg = page.locator("#form-dialog")
    for name, val in values.items():
        dlg.locator(f'[name="{name}"]:not([type="radio"])').first.fill(val) if not name.startswith("radio:") else None
    return dlg


def run(p):
    browser = p.chromium.launch()
    pixel = p.devices["Pixel 7"]

    # ===== 1. Phone: set up a month and use the wallet =====
    print("Phone flow (Pixel 7)")
    ctx, page = new_page(browser, device=pixel)
    page.goto(BASE + "#month")
    check("month title shows October 2026", page.locator("#month-title").inner_text() == "October 2026")
    page.get_by_role("button", name="Start empty").click()

    check("asks for salaries before showing deposits", "Enter both salaries" in page.locator("main").inner_text())
    page.fill("#wallet-budget", "930")
    page.keyboard.press("Enter")
    page.fill("#income-t", "3000")
    page.keyboard.press("Enter")
    page.fill("#income-k", "2500")
    page.keyboard.press("Enter")
    page.wait_for_timeout(100)

    # Fixed costs: rent paid by Kristiina, phone paid by Tõnis
    for name, amount, payer in [("Rent", "1000", "Kristiina"), ("Phone", "50", "Tõnis"), ("Netflix+Spotify", "25,98", "Tõnis")]:
        page.get_by_role("button", name=re.compile(r"\+ Add")).click()
        dlg = page.locator("#form-dialog")
        dlg.locator('[name="name"]').fill(name)
        dlg.locator('[name="amount"]').fill(amount)
        dlg.get_by_text(payer, exact=True).click()
        dlg.get_by_role("button", name="Save").click()
    # Total = 1000 + 50 + 25.98 + 930 = 2005.98 → 1002.99 each
    # Salaries 5500 − costs 2005.98 = leftover 3494.02 → 1747.01 private each
    # Tõnis: 3000 − 75.98 − 1747.01 = 1177.01 in; Kristiina: 2500 − 1000 − 1747.01 = −247.01 (gets back)
    dep_t = page.get_by_test_id("deposit-t").inner_text()
    dep_k = page.get_by_test_id("deposit-k").inner_text()
    check("private money 1.747,01 € each", "1.747,01" in page.get_by_test_id("private").inner_text())
    check("Tõnis deposits 1.177,01 €", "1.177,01" in dep_t and "into the wallet" in dep_t)
    check("Kristiina gets 247,01 € back", "247,01" in dep_k and "gets back" in dep_k)

    page.locator('[data-paid]').first.check()
    page.wait_for_timeout(50)
    check("ticking paid strikes the row through", page.locator(".row.is-paid").count() == 1)
    page.screenshot(path=str(SHOTS / "phone-412-month.png"), full_page=True)

    # Wallet
    page.get_by_role("link", name=re.compile("Wallet")).click()
    page.get_by_role("button", name=re.compile("Check in")).click()
    page.locator('#form-dialog [name="balance"]').fill("59,61")
    page.locator("#form-dialog").get_by_role("button", name="Save").click()
    pace = page.get_by_test_id("pace").inner_text()
    check("pace shows 93,6 % like the sheet", "93,6" in pace and "under plan" in pace)
    check("remaining 59,61 €", "59,61" in page.get_by_test_id("remaining").inner_text())
    # A second check-in replaces the balance; it must not stack on the first
    page.get_by_role("button", name=re.compile("Check in")).click()
    page.locator('#form-dialog [name="balance"]').fill("50")
    page.locator('#form-dialog [name="balance"]').press("Enter")
    check("second check-in: balance 50 € → 880 € spent, remaining 50 €", "50,00" in page.get_by_test_id("remaining").inner_text() and "880,00" in page.locator("main").inner_text())
    page.locator(".row-btn", has_text="Balance").filter(has_text="50,00").click()
    page.locator("#form-dialog").get_by_role("button", name="Delete").click()
    check("deleting it brings back the first check-in", "59,61" in page.get_by_test_id("remaining").inner_text())
    meta = page.evaluate("[...document.querySelectorAll('meta[name=theme-color]')].map(m => m.content + ' ' + m.media)")
    check("status bar colour follows light/dark background, not green", all("#2f6b4f" not in m for m in meta) and len(meta) == 2)
    check("version is shown on the wallet page", "2026-" in page.get_by_test_id("version").inner_text())
    check("no Add purchase button any more", page.get_by_role("button", name=re.compile("Add purchase")).count() == 0)

    # Kristiina tops up 100 € of personal money; the balance rises, spending doesn't go down
    page.get_by_role("button", name=re.compile("Add money")).click()
    dlg = page.locator("#form-dialog")
    dlg.locator('[name="amount"]').fill("100")
    dlg.get_by_text("Kristiina", exact=True).click()
    dlg.get_by_role("button", name="Save").click()
    page.get_by_role("button", name=re.compile("Check in")).click()
    page.locator('#form-dialog [name="balance"]').fill("120")
    page.locator('#form-dialog [name="balance"]').press("Enter")
    # spent = 930 start + 100 top-up − 120 balance = 910 → 20 left of the agreed 930
    check("top-up is not counted as spending (910 spent, 20 budget left)",
          "910,00" in page.get_by_test_id("spent").inner_text() and "20,00" in page.get_by_test_id("remaining").inner_text())
    check("balance line shows the top-up", "100,00 € topped up" in page.get_by_test_id("balance-line").inner_text().replace("\xa0", " "))
    page.screenshot(path=str(SHOTS / "phone-412-wallet.png"), full_page=True)

    for w in (340, 360):
        page.set_viewport_size({"width": w, "height": 800})
        page.wait_for_timeout(100)
        overlaps = page.evaluate("""() => [...document.querySelectorAll('.row-btn')].filter(b => {
            const t = b.querySelector('.title').getBoundingClientRect();
            const a = b.querySelector('.amount').getBoundingClientRect();
            return t.right > a.left + 1;
        }).length""")
        check(f"entry titles don't run under the amounts at {w}px", overlaps == 0)
        overflow = page.evaluate("document.documentElement.scrollWidth > window.innerWidth")
        check(f"no horizontal scroll at {w}px (wallet)", not overflow)
        page.screenshot(path=str(SHOTS / f"phone-{w}-wallet.png"), full_page=True)
        page.goto(BASE + "#month")
        overflow = page.evaluate("document.documentElement.scrollWidth > window.innerWidth")
        check(f"no horizontal scroll at {w}px (month)", not overflow)
        page.goto(BASE + "#wallet")

    # Swipe between screens
    page.goto(BASE + "#wallet")
    swipe(page, -150)
    check("swipe left: Wallet → Month", page.url.endswith("#month"))
    swipe(page, -150)
    check("swipe left: Month → Big costs", page.url.endswith("#big"))
    swipe(page, 150)
    check("swipe right: back to Month", page.url.endswith("#month"))
    swipe(page, 40, 300)
    check("scrolling down does not switch screens", page.url.endswith("#month"))
    swipe(page, -60, 30, ms=600)
    check("a short, slightly diagonal swipe counts (more sensitive)", page.url.endswith("#big"))
    swipe(page, 60, 30, ms=600)
    swipe(page, -150, ms=1500)
    check("a slow drag does not switch screens", page.url.endswith("#month"))
    page.goto(BASE + "#wallet")
    swipe(page, 150)
    check("swipe right on the first screen stays there", page.url.endswith("#wallet"))
    page.get_by_role("button", name=re.compile("Check in")).click()
    swipe(page, -150)
    check("no swipe while a form is open", page.url.endswith("#wallet"))
    page.keyboard.press("Escape")

    # Next month: copy from October
    page.set_viewport_size({"width": 412, "height": 915})
    page.goto(BASE + "#month")
    page.locator("#next-month").click()
    page.get_by_role("button", name="Copy from October 2026").click()
    check("November copied 3 fixed costs, all unpaid", page.locator("[data-paid]").count() == 3 and page.locator(".row.is-paid").count() == 0)
    check("November copied the salaries", page.input_value("#income-t") == "3000,00" and page.input_value("#income-k") == "2500,00")

    # Big cost: 300 € washer over 3 months paid by Tõnis, from November
    page.get_by_role("link", name=re.compile("Big costs")).click()
    page.get_by_role("button", name=re.compile(r"\+ Add")).click()
    dlg = page.locator("#form-dialog")
    dlg.locator('[name="name"]').fill("Washing machine")
    dlg.locator('[name="amount"]').fill("300")
    check("one-off shows months field, hides period", dlg.locator('[data-field="months"]').is_visible() and not dlg.locator('[data-field="period"]').is_visible())
    dlg.get_by_text("Tõnis", exact=True).click()
    dlg.get_by_role("button", name="Save").click()
    page.screenshot(path=str(SHOTS / "phone-412-bigcosts.png"), full_page=True)
    page.get_by_role("link", name=re.compile("Month")).click()
    # Costs 2105.98 → leftover 3394.02 → 1697.01 each; Tõnis 3000 − 175.98 − 1697.01 = 1127.01
    check("big cost share lowers private money and counts as Tõnis's payment", "1.127,01" in page.get_by_test_id("deposit-t").inner_text() and "1.697,01" in page.get_by_test_id("private").inner_text())
    # Carry-over: October's last check-in (120 €) carries into November automatically
    check("carry-over taken from October's last check-in", "120,00" in page.get_by_test_id("carry-hint").inner_text())
    check("November wallet starts with 930 + 120 = 1.050 €", "1.050,00" in page.get_by_test_id("wallet-start").inner_text())
    page.get_by_role("link", name=re.compile("Wallet")).click()
    page.get_by_role("button", name=re.compile("Check in")).click()
    page.locator('#form-dialog [name="balance"]').fill("1000")
    page.locator('#form-dialog [name="balance"]').press("Enter")
    check("budget vs actual uses only the agreed 930 € (50 spent → 880 left)",
          "880,00" in page.get_by_test_id("remaining").inner_text() and "of the agreed 930,00" in page.locator("main").inner_text())
    check("balance line mentions the carry-over", "120,00 € carried over" in page.get_by_test_id("balance-line").inner_text().replace("\xa0", " "))
    # Override the carry-over by hand, then back to automatic
    page.get_by_role("link", name=re.compile("Month")).click()
    page.fill("#carry-over", "150")
    page.keyboard.press("Enter")
    page.wait_for_timeout(100)
    check("typed carry-over overrides the automatic one", "1.080,00" in page.get_by_test_id("wallet-start").inner_text())
    page.fill("#carry-over", "")
    page.keyboard.press("Enter")
    page.wait_for_timeout(100)
    check("emptying the field goes back to automatic", "1.050,00" in page.get_by_test_id("wallet-start").inner_text())
    ctx.close()

    # ===== 2. Laptop with keyboard =====
    print("Laptop flow (1366 px, keyboard)")
    ctx, page = new_page(browser, viewport={"width": 1366, "height": 860})
    page.goto(BASE)
    page.keyboard.press("2")
    check("key 2 opens Month", page.url.endswith("#month"))
    page.get_by_role("button", name="Start empty").click()
    page.fill("#wallet-budget", "600")
    page.locator("body").click(position={"x": 5, "y": 400})
    page.keyboard.press("1")
    page.keyboard.press("c")
    check("C opens the check-in", page.locator("#form-dialog[open] h2").inner_text() == "Check in balance")
    page.keyboard.type("550")
    page.keyboard.press("Enter")
    check("check-in saved with keyboard (50 spent)", "550,00" in page.get_by_test_id("remaining").inner_text())
    page.keyboard.press("Control+z")
    page.wait_for_timeout(50)
    check("Ctrl+Z undoes the check-in", "600,00" in page.get_by_test_id("remaining").inner_text())
    page.keyboard.press("Control+y")
    page.wait_for_timeout(50)
    check("Ctrl+Y redoes it", "550,00" in page.get_by_test_id("remaining").inner_text())
    page.keyboard.press("a")
    check("A opens Add money", page.locator("#form-dialog[open] h2").inner_text() == "Add money to the wallet")
    page.keyboard.press("Escape")
    check("Esc closes the dialog", page.locator("#form-dialog[open]").count() == 0)
    expect(page.locator("#form-dialog")).not_to_have_attribute("open", "")
    page.keyboard.press("ArrowLeft")
    expect(page.locator("#month-title")).to_have_text("September 2026", timeout=2000)
    check("← goes to previous month", page.locator("#month-title").inner_text() == "September 2026")
    page.keyboard.press("t")
    check("T returns to this month", page.locator("#month-title").inner_text() == "October 2026")
    page.keyboard.press("Shift+?")
    check("? shows shortcut list", page.locator("#form-dialog[open] h2").inner_text() == "Keyboard shortcuts")
    page.screenshot(path=str(SHOTS / "laptop-1366-help.png"))
    page.keyboard.press("Escape")
    page.screenshot(path=str(SHOTS / "laptop-1366-wallet.png"), full_page=True)
    page.keyboard.press("4")
    page.screenshot(path=str(SHOTS / "laptop-1366-settings.png"), full_page=True)
    ctx.close()

    # ===== 3. Two phones syncing through the (fake) Sheet =====
    print("Sync between two phones")
    sheet = FakeSheet()
    ctx_t, tonis = new_page(browser, device=pixel, sheet=sheet)
    ctx_k, kris = new_page(browser, device=pixel, sheet=sheet)

    def connect(page, me):
        page.goto(BASE + "#settings")
        page.get_by_text(me, exact=True).first.click()
        page.fill("#sync-url", SYNC_URL)
        page.fill("#sync-key", KEY)
        page.get_by_role("button", name="Test and save").click()
        expect(page.locator("#sync-chip")).to_have_text(re.compile("Synced"), timeout=5000)

    connect(tonis, "Tõnis")
    connect(kris, "Kristiina")

    tonis.goto(BASE + "#month")
    tonis.get_by_role("button", name="Start empty").click()
    tonis.fill("#wallet-budget", "800")
    tonis.keyboard.press("Enter")
    tonis.keyboard.press("Control+s")
    tonis.wait_for_timeout(300)

    kris.goto(BASE + "#wallet")
    kris.keyboard.press("Control+s")
    expect(kris.get_by_test_id("remaining")).to_contain_text("800,00", timeout=5000)
    check("Kristiina's phone receives Tõnis's budget", True)

    # Both enter their own salary before syncing: neither may overwrite the other.
    kris.goto(BASE + "#month")
    tonis.fill("#income-t", "3100")
    tonis.keyboard.press("Enter")
    kris.fill("#income-k", "2600")
    kris.keyboard.press("Enter")
    tonis.keyboard.press("Control+s")
    tonis.wait_for_timeout(300)
    kris.keyboard.press("Control+s")
    kris.wait_for_timeout(300)
    tonis.keyboard.press("Control+s")
    expect(tonis.locator("#income-k")).to_have_value("2600,00", timeout=5000)
    check("salaries entered at the same time on both phones are both kept",
          kris.input_value("#income-t") == "3100,00" and tonis.input_value("#income-t") == "3100,00")
    kris.goto(BASE + "#wallet")

    kris.get_by_role("button", name=re.compile("Add money")).click()
    kris.locator('#form-dialog [name="amount"]').fill("45")
    kris.locator('#form-dialog [name="note"]').fill("Market week")
    kris.locator("#form-dialog").get_by_role("button", name="Save").click()
    kris.wait_for_timeout(2500)  # auto-sync after 2 s
    tonis.goto(BASE + "#wallet")
    tonis.keyboard.press("Control+s")
    expect(tonis.get_by_test_id("balance-line")).to_contain_text(re.compile(r"45,00\s€ topped up"), timeout=5000)
    check("Tõnis's phone receives Kristiina's top-up (auto-sync)", True)
    check("entry shows who added it (Kristiina, KM)", "Kristiina added money" in tonis.locator(".list").inner_text() and "KM" in tonis.locator(".list").inner_text())

    # Delete on one phone travels to the other
    tonis.get_by_text("Market week").click()
    tonis.locator("#form-dialog").get_by_role("button", name="Delete").click()
    tonis.keyboard.press("Control+s")
    tonis.wait_for_timeout(300)
    kris.keyboard.press("Control+s")
    expect(kris.get_by_test_id("balance-line")).not_to_contain_text("topped up", timeout=5000)
    check("deletion syncs to the other phone", True)

    # Offline edits wait and go out later
    ctx_k.set_offline(True)
    kris.evaluate("window.dispatchEvent(new Event('offline'))")
    kris.get_by_role("button", name=re.compile("Check in")).click()
    kris.locator('#form-dialog [name="balance"]').fill("700")
    kris.locator("#form-dialog").get_by_role("button", name="Save").click()
    kris.wait_for_timeout(300)
    check("offline chip shows waiting change", "waiting" in kris.locator("#sync-chip").inner_text())
    ctx_k.set_offline(False)
    kris.evaluate("window.dispatchEvent(new Event('online'))")
    expect(kris.locator("#sync-chip")).to_have_text(re.compile("Synced"), timeout=5000)
    tonis.keyboard.press("Control+s")
    expect(tonis.get_by_test_id("remaining")).to_contain_text("700,00", timeout=5000)
    check("offline check-in arrives after reconnecting", True)

    # Wrong key is refused
    kris.goto(BASE + "#settings")
    kris.fill("#sync-key", "wrong")
    kris.get_by_role("button", name="Test and save").click()
    expect(kris.locator("#toast")).to_contain_text("Wrong sync key", timeout=3000)
    check("wrong key is refused with a clear message", True)
    check("sheet never received the key in stored rows", all("key" not in r["rec"] for r in sheet.rows.values()))

    # Backup excludes the key
    with kris.expect_download() as dl:
        kris.get_by_role("button", name="Download backup").click()
    content = Path(dl.value.path()).read_text()
    check("backup contains records but not the sync key", '"records"' in content and KEY not in content)
    ctx_t.close()
    ctx_k.close()
    browser.close()


if __name__ == "__main__":
    srv = start_server()
    try:
        with sync_playwright() as p:
            run(p)
    except Exception as e:
        print("TEST CRASHED:", e)
        checks.append(("no crash", False))
    finally:
        srv.shutdown()
    if errors:
        print("Page errors:")
        for e in errors:
            print("  " + e)
    failed = [n for n, ok in checks if not ok]
    print(f"\n{len(checks) - len(failed)}/{len(checks)} checks passed, {len(errors)} page errors")
    sys.exit(1 if failed or errors else 0)
