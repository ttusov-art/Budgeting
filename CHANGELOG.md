# Changelog

## 2026-10-31 l
- New **Purchases** screen for the weekly routine: import the Revolut statement (CSV), sort each purchase into common or personal, then record the withdrawal from the shared pocket.
- The app remembers per shop what you chose and suggests it next time ("Accept suggestions").
- Already-imported transactions are skipped, so overlapping exports are fine.
- Common purchases count as wallet spending as soon as they are sorted; withdrawals in a later month don't count twice.
- Personal purchases and imported statements stay on the phone; only common purchases and withdrawals are shared.
- Manual "add common purchase" for cash. Badge on the tab shows how many purchases wait to be sorted.
- Tabs/shortcuts: 1 Wallet, 2 Purchases, 3 Month, 4 Big costs, 5 Settings; I = import.

## 2026-10-31 k
- Month screen order follows the monthly routine: fixed costs → this month's money → big costs → lock → transfers → summary.
- "Lock budget": once agreed, salaries, wallet budget, carry-over and the fixed-cost list become read-only and the big-cost shares are frozen. Ticking costs as paid and marking transfers still work. "Unlock" reopens it.
- Wallet shows a reminder while the month's budget isn't locked.

## 2026-10-31 j
- Month: tap a deposit box to mark the transfer as done ("To transfer" ↔ "✓ Transferred"); synced, one record per person.
- "Private money each" moved to the bottom of the transfers panel.

## 2026-10-31 i
- Swiping now gives visible feedback: the page follows your finger, slides out when switching, bounces back at the first/last screen, and glides back when the swipe was too short.

## 2026-10-31 h
- Swiping between screens is more sensitive (shorter, slower and more diagonal swipes count).

## 2026-10-31 g
- Swipe left/right to move between Wallet, Month, Big costs and Settings (phones).

## 2026-10-31 f
- Android status and navigation bars now match the app background (no bright green edges).
- Entry titles wrap instead of running under the amount.

## 2026-10-31 e
- Version shown at the top of the Wallet page.
- "Add purchase" removed: check-ins use the actual Revolut balance.
- New "Add money" (shortcut A): personal money put into the wallet. It raises the balance but is not counted as negative spending and does not raise the budget.
- Carry-over is automatic: a month starts with the previous month's last check-in balance (can be overridden on the Month screen).
- Budget vs. actual compares spending with the agreed wallet budget only.

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
