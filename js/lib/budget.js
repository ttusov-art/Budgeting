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
 * The month's money plan.
 *
 *   Household costs = fixed costs + big-cost shares + wallet budget
 *   Leftover        = both salaries − household costs
 *   Private money   = leftover split evenly in two (stays with each person)
 *   Deposit         = own salary − costs paid from own account − own private half
 *
 * The two deposits together always equal what the wallet needs
 * (wallet budget + costs paid from the wallet). A negative deposit means
 * that person gets money back from the other / the wallet.
 */
export function monthPlan({ fixed, spreadShares, walletBudget, incomes }) {
  const costs = [...fixed, ...spreadShares];
  const fixedTotal = sum(fixed.map((c) => c.amount));
  const spreadTotal = sum(spreadShares.map((c) => c.amount));
  const wallet = walletBudget || 0;
  const householdTotal = fixedTotal + spreadTotal + wallet;

  const income = { t: (incomes && incomes.t) || 0, k: (incomes && incomes.k) || 0 };
  const incomeTotal = income.t + income.k;
  const leftover = incomeTotal - householdTotal;

  // Floor Tõnis's half; Kristiina gets the exact rest, so no cent is lost to rounding.
  const privateT = Math.floor(leftover / 2);
  const privateMoney = { t: privateT, k: leftover - privateT };

  const paid = { t: 0, k: 0, wallet: 0 };
  for (const c of costs) paid[c.payer in paid ? c.payer : 'wallet'] += c.amount;

  const deposit = {
    t: income.t - paid.t - privateMoney.t,
    k: income.k - paid.k - privateMoney.k,
  };

  return {
    fixedTotal,
    spreadTotal,
    walletBudget: wallet,
    householdTotal,
    income,
    incomeTotal,
    hasIncomes: income.t > 0 && income.k > 0,
    leftover,
    privateMoney,
    paid,
    deposit,
    // What lands in the wallet: the spending budget plus costs paid from the wallet.
    walletIn: deposit.t + deposit.k,
    walletPaidCosts: paid.wallet,
  };
}

/**
 * What the wallet holds at the start of the month:
 * the deposits + anything carried over from last month
 * − fixed costs paid out of the wallet (only those ticked as paid).
 * Big-cost shares paid "from the wallet" are a reserve that stays in it,
 * so they are part of the deposits and don't need subtracting.
 */
export function walletStartBalance({ plan, carryOver, fixed }) {
  const paidFromWallet = fixed
    .filter((f) => f.payer === 'wallet' && f.paid)
    .reduce((a, f) => a + f.amount, 0);
  return plan.walletIn + (carryOver || 0) - paidFromWallet;
}

const byTime = (a, b) => (a.date + (a.createdAt || '')).localeCompare(b.date + (b.createdAt || ''));

/**
 * Spent at one check-in. A check-in records the actual balance of the
 * shared account. Personal money added before it ("top-ups") raised the
 * balance without being part of the budget, so:
 *   spent = start balance + top-ups so far − balance
 * (Older check-ins that stored "spent so far" directly are still understood.)
 */
export function checkinSpent(checkin, startBalance, topups = []) {
  if (checkin.balance === undefined || checkin.balance === null) return checkin.spent || 0;
  const added = sum(topups.filter((t) => byTime(t, checkin) <= 0).map((t) => t.amount));
  return startBalance + added - checkin.balance;
}

/** Spent so far this month = spent at the latest check-in. */
export function spentSoFar(checkins, startBalance = 0, topups = []) {
  const sorted = [...checkins].sort(byTime);
  const last = sorted[sorted.length - 1] || null;
  return {
    spent: last ? checkinSpent(last, startBalance, topups) : 0,
    lastCheckin: last,
  };
}

/**
 * Spent so far this month, including common purchases paid with private
 * money that haven't been withdrawn from the shared pocket yet.
 *
 *   spent = start + top-ups − balance            (what left the pocket, from the check-in)
 *         − withdrawals this month for earlier months' purchases (they belong to those months)
 *         + this month's common purchases not yet withdrawn at the check-in
 *
 * Without a check-in, spent = all of this month's common purchases.
 * `settlements` = all withdrawals (any month); `expenses` = common purchases (any month).
 */
export function walletSpent({ checkins, startBalance, topups = [], expenses = [], settlements = [], monthKey }) {
  const sorted = [...checkins].sort(byTime);
  const last = sorted[sorted.length - 1] || null;
  const mine = expenses.filter((e) => e.month === monthKey);
  const byId = new Map(settlements.map((s) => [s.id, s]));
  const withdrawnBefore = (e, point) => {
    const s = e.settlementId && byId.get(e.settlementId);
    return Boolean(s) && byTime(s, point) <= 0;
  };

  if (!last) {
    const total = sum(mine.map((e) => e.amount));
    return { spent: total, lastCheckin: null, pending: sum(mine.filter((e) => !e.settlementId).map((e) => e.amount)) };
  }
  if (last.balance === undefined || last.balance === null) {
    return { spent: last.spent || 0, lastCheckin: last, pending: 0 }; // old-style check-in
  }

  const forOtherMonths = settlements
    .filter((s) => s.month === monthKey && byTime(s, last) <= 0)
    .reduce((acc, s) => acc + sum(Object.entries(s.parts || {}).filter(([m]) => m !== monthKey).map(([, v]) => v)), 0);
  const pending = sum(mine.filter((e) => !withdrawnBefore(e, last)).map((e) => e.amount));
  return {
    spent: checkinSpent(last, startBalance, topups) - forOtherMonths + pending,
    lastCheckin: last,
    pending,
  };
}

/** Balance of the latest check-in of a month, or null (used for carry-over). */
export function lastBalance(checkins) {
  const withBalance = checkins.filter((c) => c.balance !== undefined && c.balance !== null).sort(byTime);
  const last = withBalance[withBalance.length - 1];
  return last ? { balance: last.balance, date: last.date } : null;
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

// ---------- locking together ----------

/**
 * Short fingerprint of everything both people agree on when locking:
 * fixed costs (name, amount, payer), salaries, wallet budget, carry-over and
 * big-cost shares. Ticking costs as paid doesn't change it.
 */
export function budgetFingerprint({ fixed, incomes, walletBudget, carryOver, spreadShares }) {
  return hashText(JSON.stringify({
    f: fixed.map((c) => [c.name, c.amount, c.payer]).sort(),
    i: [incomes.t || 0, incomes.k || 0],
    w: walletBudget || 0,
    c: carryOver || 0,
    s: spreadShares.map((x) => [x.name, x.amount, x.payer]).sort(),
  }));
}

/**
 * Fingerprint of a month's final result, agreed when closing down the wallet:
 * the final balance, its date and what was spent. Sorting another common
 * purchase into the month or changing the balance gives a new fingerprint.
 */
export function closeFingerprint({ finalBalance, finalDate, spent }) {
  return hashText(JSON.stringify([finalBalance, finalDate, spent]));
}

// Short text hash (djb2). Not for security: only to notice that numbers changed.
function hashText(data) {
  let h = 5381;
  for (let i = 0; i < data.length; i++) h = ((h * 33) ^ data.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/**
 * What two people's votes mean for something both must agree on
 * (locking a budget, closing down a month's wallet).
 * done:  is it locked / closed now?
 * votes: { t: { want, fp } | null, k: … } with want = `on` or `off`
 * Returns { action: 'on' | 'off' | null, status: { t, k } } where status is
 * 'approved' | 'stale' (approved other numbers) | 'waiting' | `off` (asked to undo it).
 */
export function pairDecision({ done, votes, currentFp, on, off }) {
  const status = {};
  for (const p of ['t', 'k']) {
    const v = votes[p];
    if (done) status[p] = v && v.want === off ? off : 'waiting';
    else if (!v || v.want !== on) status[p] = 'waiting';
    else status[p] = currentFp != null && v.fp === currentFp ? 'approved' : 'stale';
  }
  let action = null;
  if (!done && status.t === 'approved' && status.k === 'approved') action = 'on';
  if (done && status.t === off && status.k === off) action = 'off';
  return { action, status };
}

/**
 * What the two votes mean for the lock.
 * Returns { action: 'lock' | 'unlock' | null, status: { t, k } } where status is
 * 'approved' | 'stale' (approved other numbers) | 'waiting' | 'unlock' (asked to unlock).
 */
export function lockDecision({ locked, votes, currentFp }) {
  const { action, status } = pairDecision({ done: locked, votes, currentFp, on: 'lock', off: 'unlock' });
  return { action: action === 'on' ? 'lock' : action === 'off' ? 'unlock' : null, status };
}

/**
 * What the two votes mean for closing down a month's wallet.
 * Returns { action: 'close' | 'reopen' | null, status: { t, k } } where status is
 * 'approved' (closed down) | 'stale' (closed down with other numbers) | 'waiting' | 'reopen'.
 * Without a final balance (currentFp null) nobody's close-down counts yet.
 */
export function closeDecision({ closed, votes, currentFp }) {
  const { action, status } = pairDecision({ done: closed, votes, currentFp, on: 'close', off: 'reopen' });
  return { action: action === 'on' ? 'close' : action === 'off' ? 'reopen' : null, status };
}
