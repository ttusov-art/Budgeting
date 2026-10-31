// Unit tests for the pure logic in js/lib.
// Run with:  node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseCents, formatCents, centsToInput } from '../js/lib/money.js';
import { addMonths, monthsBetween, daysInMonth, daysElapsed } from '../js/lib/months.js';
import { spreadSharesForMonth, monthPlan, spentSoFar, walletPace, walletStartBalance, lastBalance } from '../js/lib/budget.js';
import { mergeRecords } from '../js/lib/merge.js';

test('parseCents understands German and English number styles', () => {
  assert.equal(parseCents('12,30'), 1230);
  assert.equal(parseCents('12.30'), 1230);
  assert.equal(parseCents('1.234,56'), 123456);
  assert.equal(parseCents('1,234.56'), 123456);
  assert.equal(parseCents('950'), 95000);
  assert.equal(parseCents(' 7,5 € '), 750);
  assert.equal(parseCents('-5'), -500);
  assert.equal(parseCents('abc'), null);
  assert.equal(parseCents(''), null);
});

test('formatting', () => {
  assert.equal(formatCents(123456).replace(/\s/g, ' '), '1.234,56 €');
  assert.equal(centsToInput(1230), '12,30');
});

test('month helpers', () => {
  assert.equal(addMonths('2026-10', 3), '2027-01');
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(monthsBetween('2026-10', '2027-01'), 3);
  assert.equal(daysInMonth('2026-02'), 28);
  assert.equal(daysInMonth('2028-02'), 29);
  assert.equal(daysElapsed('2026-10', '2026-10-31'), 31);
  assert.equal(daysElapsed('2026-10', '2026-10-03'), 3);
  assert.equal(daysElapsed('2026-09', '2026-10-03'), 30);
  assert.equal(daysElapsed('2026-11', '2026-10-03'), 0);
});

test('one-off big cost is spread exactly, remainder in last month', () => {
  const spreads = [{ id: 'a', name: 'Washer', kind: 'oneoff', amount: 10000, months: 3, start: '2026-10', payer: 't' }];
  const shares = ['2026-09', '2026-10', '2026-11', '2026-12', '2027-01']
    .map((m) => spreadSharesForMonth(spreads, m));
  assert.equal(shares[0].length, 0);
  assert.deepEqual(shares.slice(1, 4).map((s) => s[0].amount), [3333, 3333, 3334]);
  assert.equal(shares[4].length, 0);
});

test('periodic bill sets aside amount / period every month', () => {
  const spreads = [{ id: 'b', name: 'Insurance', kind: 'periodic', amount: 36000, period: 12, start: '2026-01', payer: 'k' }];
  assert.equal(spreadSharesForMonth(spreads, '2026-10')[0].amount, 3000);
  assert.equal(spreadSharesForMonth(spreads, '2025-12').length, 0);
  const ended = [{ ...spreads[0], end: '2026-06' }];
  assert.equal(spreadSharesForMonth(ended, '2026-07').length, 0);
});

test('month plan: leftover of both salaries is split evenly, deposits fill the wallet', () => {
  const plan = monthPlan({
    fixed: [
      { amount: 100000, payer: 'k' }, // rent, Kristiina pays
      { amount: 5000, payer: 't' },   // Tõnis pays
    ],
    spreadShares: [{ amount: 3000, payer: 't' }],
    walletBudget: 80000,
    incomes: { t: 300000, k: 250000 },
  });
  assert.equal(plan.householdTotal, 188000);
  assert.equal(plan.leftover, 362000);              // 5500 − 1880
  assert.deepEqual(plan.privateMoney, { t: 181000, k: 181000 });
  // Tõnis: 3000 − 80 own costs − 1810 private = 1110 into the wallet
  // Kristiina: 2500 − 1000 rent − 1810 private = −310 → gets 310 back
  assert.deepEqual(plan.deposit, { t: 111000, k: -31000 });
  assert.equal(plan.walletIn, 80000);
  assert.ok(plan.hasIncomes);
});

test('month plan: costs paid from the wallet raise the deposits', () => {
  const plan = monthPlan({ fixed: [{ amount: 2000, payer: 'wallet' }], spreadShares: [], walletBudget: 10000, incomes: { t: 50000, k: 50000 } });
  assert.equal(plan.walletIn, 12000);
  assert.equal(plan.deposit.t + plan.deposit.k, 12000);
});

test('odd cents: private halves add up exactly', () => {
  const plan = monthPlan({ fixed: [], spreadShares: [], walletBudget: 0, incomes: { t: 10001, k: 0 } });
  assert.equal(plan.privateMoney.t + plan.privateMoney.k, 10001);
  assert.equal(plan.hasIncomes, false);
});

test('balance check-ins: spent = start − balance; a second check-in replaces the first', () => {
  const checkins = [
    { date: '2026-10-07', createdAt: 'a', balance: 70000 },
    { date: '2026-10-14', createdAt: 'b', balance: 52000 },
  ];
  assert.equal(spentSoFar(checkins, 93000).spent, 41000);
  assert.equal(spentSoFar([], 93000).spent, 0);
});

test('top-ups raise the balance without counting as negative spending', () => {
  const checkins = [{ date: '2026-10-20', createdAt: 'b', balance: 30000 }];
  const topups = [
    { date: '2026-10-15', createdAt: 'x', amount: 10000 }, // before the check-in → counted
    { date: '2026-10-25', createdAt: 'y', amount: 5000 },  // after → only for later check-ins
  ];
  // start 93000 + 10000 added − 30000 balance = 73000 spent
  assert.equal(spentSoFar(checkins, 93000, topups).spent, 73000);
});

test('carry-over source: balance of the last check-in', () => {
  assert.deepEqual(lastBalance([
    { date: '2026-09-30', createdAt: 'b', balance: 4200 },
    { date: '2026-09-23', createdAt: 'a', balance: 20000 },
    { date: '2026-09-10', createdAt: 'c', spent: 100 },
  ]), { balance: 4200, date: '2026-09-30' });
  assert.equal(lastBalance([]), null);
});

test('wallet start: deposits + carry-over − paid wallet costs', () => {
  const fixed = [{ amount: 2000, payer: 'wallet', paid: true }, { amount: 500, payer: 'wallet', paid: false }];
  const plan = monthPlan({ fixed, spreadShares: [], walletBudget: 10000, incomes: { t: 50000, k: 50000 } });
  assert.equal(plan.walletIn, 12500);
  assert.equal(walletStartBalance({ plan, carryOver: 3000, fixed }), 12500 + 3000 - 2000);
});

test('wallet pace matches the sheet logic', () => {
  const p = walletPace({ budget: 93000, spent: 87039, monthKey: '2026-10', todayKey: '2026-10-31' });
  assert.equal(p.dailyBudget, 3000);
  assert.equal(p.weeklyBudget, 21000);
  assert.equal(Math.round(p.pace * 10000) / 100, 93.59);
  assert.equal(p.aheadBy, 5961);
});

test('merge: newer wins, older ignored', () => {
  const local = { a: { id: 'a', updatedAt: '2026-10-02', v: 1 } };
  const { records, changedIds } = mergeRecords(local, [
    { id: 'a', updatedAt: '2026-10-01', v: 0 },
    { id: 'b', updatedAt: '2026-10-01', v: 5 },
  ]);
  assert.equal(records.a.v, 1);
  assert.equal(records.b.v, 5);
  assert.deepEqual(changedIds, ['b']);
});
