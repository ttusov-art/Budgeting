# Household Budget

A shared household budget for two people, replacing the monthly Google Sheet.
Once a month: set the wallet budget and fixed costs, and the app tells each person how much to
deposit into the shared wallet. During the month: check in weekly with "spent so far" (or log single
purchases) and see whether you are ahead of or behind plan.

Setup: see **SETUP.md**.

## How the money works

- **Household total** = fixed costs + this month's share of big costs + wallet budget.
- Each person carries **half** of it.
- **Deposit into the wallet** = your half − the costs you already pay from your own account.
  (Kristiina's costs are the old `*`, Tõnis's the old `**`; you pick the payer per cost.)
  A negative deposit means that person paid more than their half.
- **Pace** = spent so far ÷ (wallet budget × days elapsed ÷ days in month). Below 100 % = under plan.
- **Spent so far** = the latest check-in + purchases logged after it.
- **Big costs**: a one-off purchase is spread evenly over N months; a recurring bill (yearly,
  half-yearly, quarterly) sets aside amount ÷ period every month. The share counts as paid by
  whoever pays the bill.

## Screens

| Screen | What it does |
| --- | --- |
| Wallet | Left in the wallet, pace vs. plan, daily/weekly figures, check-ins and purchases |
| Month | Deposits, wallet budget, fixed costs (tick when paid), summary; "copy last month" |
| Big costs | Spread purchases and recurring bills |
| Settings | Names, whose phone, sync, backup, shortcuts, privacy |

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `1` `2` `3` `4` | Wallet / Month / Big costs / Settings |
| `←` `→` | Previous / next month |
| `T` | Jump to this month |
| `C` | Weekly check-in |
| `N` | Add purchase (on Big costs: add big cost) |
| `F` | Add fixed cost |
| `Ctrl+Z` / `Ctrl+Y` (or `Ctrl+Shift+Z`) | Undo / redo |
| `Ctrl+S` | Sync now |
| `Enter` / `Esc` | Save / close a form |
| `?` | Show shortcuts |

Shortcuts don't fire while you type in a field.

## Files

```
index.html             page structure
css/style.css          the look (light + dark mode)
js/main.js             starts the app, routing, wires modules together
js/state.js            data model; the only place that changes data (incl. undo/redo)
js/storage.js          storage on this device, backup file format
js/sync.js             sync with the Google Sheet
js/version.js          APP_VERSION (also in version.json)
js/lib/money.js        cents, parsing "12,30", formatting
js/lib/months.js       month keys like "2026-10"
js/lib/budget.js       deposits, big-cost shares, pace (pure functions)
js/lib/merge.js        merging records from two phones
js/ui/*.js             one file per screen + form dialog, shortcuts, helpers
apps-script/Code.gs    the backend you paste into the Google Sheet
sw.js, manifest.webmanifest, icons/   offline start and "Add to Home screen"
tests/                 unit tests + Playwright end-to-end tests (made-up data)
```

### Data model

Everything is a flat list of **records**, each with `id`, `type`, `updatedAt`, `deleted`, `by`:
`settings`, `month` (wallet budget), `fixed`, `spread`, `checkin`, `purchase`. Amounts are whole
cents. Deleting marks a record `deleted` so the deletion can reach the other phone. When both phones
changed the same record, the newer change wins.

## Tests

```
node --test tests/lib.test.mjs     # logic
python3 tests/app.spec.py          # app on Pixel 7 + 1366 px laptop, incl. two-phone sync (fake Sheet)
```

## Privacy

- Data is kept in the browser on each phone and in **your own** Google Sheet via **your own** Apps Script.
- The sync key is stored only on the phones and in the script's properties, never in this repository or in backups.
- No analytics, no tracking, no third-party code or fonts.
- "Forget this phone" in Settings removes everything locally; delete the Sheet to remove the rest.

## Credits

No third-party libraries. System fonts. Built with Claude.
