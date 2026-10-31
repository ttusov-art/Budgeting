# Household Budget

A shared household budget for two people, replacing the monthly Google Sheet.
Once a month: enter salaries, the wallet budget and fixed costs, and the app tells each person their
private money and how much to deposit into the shared wallet (Revolut). During the month: check in
with the Revolut balance and see whether you are ahead of or behind plan.

Setup: see **SETUP.md**. Updates are tested and pushed to this repository directly; after a push, press **Reload** in the app's update banner.

## How the money works

Every month you enter both salaries, agree on the wallet size, and list the fixed costs.

- **Household costs** = fixed costs + this month's share of big costs + wallet budget.
- **Leftover** = both salaries − household costs. It is split **evenly in two** as private money.
- **Deposit into the wallet** = your salary − the costs you pay from your own account − your private half.
  (Kristiina's costs are the old `*`, Tõnis's the old `**`; you pick the payer per cost.)
  Together the two deposits always equal the wallet budget (plus any costs paid from the wallet).
  A negative deposit means that person gets that amount back.
- **Pace** = spent so far ÷ (wallet budget × days elapsed ÷ days in month). Below 100 % = under plan.
- **Check-in** = the actual Revolut balance. Spent = start balance + money added − balance.
- **Start balance** = deposits + carry-over − fixed costs paid from the wallet (ticked as paid).
- **Carry-over** = automatically the previous month's last check-in balance; can be typed over on the
  Month screen (empty = automatic). Check in on the last day of a month for an exact carry-over.
- **Add money** = personal money put into the wallet (e.g. when the pace is too high). Raises the balance,
  never counts as negative spending.
- **Budget vs. actual** always compares spending with the agreed wallet budget only.
- **Big costs**: a one-off purchase is spread evenly over N months; a recurring bill (yearly,
  half-yearly, quarterly) sets aside amount ÷ period every month. The share counts as paid by
  whoever pays the bill.

## Screens

| Screen | What it does |
| --- | --- |
| Wallet | Budget left, pace vs. plan, daily/weekly figures, check-ins and added money; app version |
| Month | Transfers to the wallet (tap when done) and private money, salaries, wallet budget, fixed costs (tick when paid), summary; "copy last month" |
| Big costs | Spread purchases and recurring bills |
| Settings | Names, whose phone, sync, backup, shortcuts, privacy |

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `1` `2` `3` `4` | Wallet / Month / Big costs / Settings |
| `←` `→` | Previous / next month |
| `T` | Jump to this month |
| `C` | Check in the Revolut balance |
| `A` | Add money to the wallet |
| `N` | Add big cost (on Big costs) |
| `F` | Add fixed cost |
| `Ctrl+Z` / `Ctrl+Y` (or `Ctrl+Shift+Z`) | Undo / redo |
| `Ctrl+S` | Sync now |
| `Enter` / `Esc` | Save / close a form |
| `?` | Show shortcuts |

Shortcuts don't fire while you type in a field.

On a phone, **swipe left / right** to move between the four screens.

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
`settings`, `month` (wallet budget), `income` (one per person per month, so both phones can enter theirs at once), `fixed`, `spread`, `checkin` (balance), `topup` (money added), `transfer` (deposit done, one per person per month). Amounts are whole
cents. Deleting marks a record `deleted` so the deletion can reach the other phone. When both phones
changed the same record, the newer change wins.

## Tests

```
node --test tests/lib.test.mjs     # logic
python3 tests/app.spec.py          # app on Pixel 7 + 1366 px laptop, incl. two-phone sync (fake Sheet)
python3 tests/update.spec.py       # a new version arrives on reload despite GitHub's caching
```

## Privacy

- Data is kept in the browser on each phone and in **your own** Google Sheet via **your own** Apps Script.
- The sync key is stored only on the phones and in the script's properties, never in this repository or in backups.
- No analytics, no tracking, no third-party code or fonts.
- "Forget this phone" in Settings removes everything locally; delete the Sheet to remove the rest.

## Credits

No third-party libraries. System fonts. Built with Claude.
