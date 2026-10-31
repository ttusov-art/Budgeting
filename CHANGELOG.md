# Changelog

## 2026-10-31 d
- Fix: "Reload" for a new version could bring back the old version on the laptop for up to 10 minutes (GitHub Pages caching). The service worker now has Chrome re-check every file, and Reload clears saved copies first.
- New test: tests/update.spec.py checks updates arrive through GitHub-like caching.

## 2026-10-31 c
- Check-ins now record the **balance left in the wallet**; spent = start balance − balance. A new check-in replaces the previous one instead of mixing totals.
- Month: optional "Left in the wallet from last month"; the summary shows what the wallet starts the month with.
- Older "spent so far" check-ins are still understood.

## 2026-10-31 b
- Salaries per month: the leftover of both salaries (after fixed costs, big costs and the wallet) is split evenly as private money; deposits follow from that.
- Each salary syncs as its own record, so both phones can enter theirs at the same time.
- "Copy last month" also copies the salaries.
- Fix: keyboard shortcuts were ignored right after closing a form with Esc.

## 2026-10-31 a — first version
- Month setup: wallet budget, fixed costs with payer and "paid" tick, copy from last month.
- Deposits for each person (half of the household total minus own payments).
- Wallet: weekly check-ins, single purchases, pace vs. plan, daily/weekly figures.
- Big costs: one-off purchases spread over months, recurring bills set aside monthly.
- Sync between phones through a private Google Sheet (Apps Script), works offline.
- Undo/redo, keyboard shortcuts, backup/restore, install to home screen, new-version banner.
