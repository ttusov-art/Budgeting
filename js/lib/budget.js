// Budget calculations. Pure functions only: they take plain data and
// return plain data, never touch the page or storage. That makes them
// easy to test and easy to reason about.
//
// Payers: 't' (Tõnis), 'k' (Kristiina), 'wallet' (paid from the shared wallet).

import { monthsBetween, daysInMonth, daysElapsed } from './months.js';

export const PEOPLE = ['t', 'k'];

/**
 * Monthly shares of the "big costs" for one month.
 *  - oneoff:   amount spread evenly over `months` months from `start`
 *  - periodic: a bill every `period` months (12 = yearly, 3 = quarterly),
 *              set aside as amount / period every month from `start` on
 *              (until `end`, if given)
 * Shares are whole cents. For one-offs the last month takes the rounding
 * remainder, so the shares always add up to the exact amount.
 */
export function spreadSharesForMonth(spreads, monthKey) {
  const shares = [];
  for (const s of spreads) {
    if (!s.start || monthKey < s.start) continue;
    const index = monthsBetween(s.start, monthKey); // 0 for the first month

    if (s.kind === 'oneoff') {
      const n = Math.max(1, s.months || 1);
      if (index >= n) continue;
      const base = Math.floor(s.amount / n);
      const amount = index === n - 1 ? s.amount - base * (n - 1) : base;
      shares.push({ id: s.id, name: s.name, amount, payer: s.payer, note: `${index + 1} of ${n}` });
    } else {
      if (s.end && monthKey > s.end) continue;
      const period = Math.max(1, s.period || 12);
      shares.push({
        id: s.id, name: s.name, amount: Math.round(s.amount / period), payer: s.payer,
        note: period === 12 ? 'yearly bill' : period === 3 ? 'quarterly bill' : `every ${period} months`,
      });
    }
  }
  return shares;
}

/**
 * The month's money plan: totals and how much each person deposits
 * into the shared wallet.
 *
 * Household total = fixed costs + big-cost shares + wallet budget.
 * Each person carries their share of that (split.t / split.k, default 50/50).
 * Deposit = share − costs that person already paid from their own account.
 * A negative deposit means that person paid more than their share.
 */
export function monthPlan({ fixed, spreadShares, walletBudget, split }) {
  const costs = [...fixed, ...spreadShares];
  const fixedTotal = sum(fixed.map((c) => c.amount));
  const spreadTotal = sum(spreadShares.map((c) => c.amount));
  const householdTotal = fixedTotal + spreadTotal + (walletBudget || 0);

  const ratioT = split && typeof split.t === 'number' ? split.t : 0.5;
  // Round Tõnis's share; Kristiina gets the exact rest, so nothing is lost to rounding.
  const shareT = Math.round(householdTotal * ratioT);
  const share = { t: shareT, k: householdTotal - shareT };

  const paid = { t: 0, k: 0, wallet: 0 };
  for (const c of costs) paid[c.payer in paid ? c.payer : 'wallet'] += c.amount;

  const deposit = { t: share.t - paid.t, k: share.k - paid.k };

  return {
    fixedTotal,
    spreadTotal,
    walletBudget: walletBudget || 0,
    householdTotal,
    share,
    paid,
    deposit,
    // What lands in the wallet: the spending budget plus costs paid from the wallet.
    walletIn: deposit.t + deposit.k,
    walletPaidCosts: paid.wallet,
  };
}

/**
 * Spent so far in the wallet for one month.
 * A check-in says "this much is spent this month, as of this date".
 * Purchases logged after the latest check-in are added on top;
 * purchases before it are assumed to be included in the check-in.
 */
export function spentSoFar(checkins, purchases) {
  const byTime = (a, b) => (a.date + (a.createdAt || '')).localeCompare(b.date + (b.createdAt || ''));
  const sortedCheckins = [...checkins].sort(byTime);
  const last = sortedCheckins[sortedCheckins.length - 1];

  if (!last) return { spent: sum(purchases.map((p) => p.amount)), lastCheckin: null, purchasesSince: purchases.length };

  const after = purchases.filter((p) => byTime(p, last) > 0);
  return {
    spent: last.spent + sum(after.map((p) => p.amount)),
    lastCheckin: last,
    purchasesSince: after.length,
  };
}

/**
 * Pace of spending compared with an even spread over the month.
 * pace < 1 means less spent than planned so far (good).
 */
export function walletPace({ budget, spent, monthKey, todayKey }) {
  const days = daysInMonth(monthKey);
  const elapsed = daysElapsed(monthKey, todayKey);
  const daily = budget / days;
  const expected = Math.round(daily * elapsed);
  const remaining = budget - spent;
  const daysLeft = days - elapsed;

  return {
    days,
    elapsed,
    daysLeft,
    dailyBudget: Math.round(daily),
    weeklyBudget: Math.round(daily * 7),
    expected,
    actualDaily: elapsed > 0 ? Math.round(spent / elapsed) : 0,
    actualWeekly: elapsed > 0 ? Math.round((spent / elapsed) * 7) : 0,
    pace: expected > 0 ? spent / expected : 0,
    aheadBy: expected - spent, // positive = under plan
    remaining,
    perDayLeft: daysLeft > 0 ? Math.round(remaining / daysLeft) : remaining,
  };
}

function sum(list) {
  return list.reduce((a, b) => a + (b || 0), 0);
}
