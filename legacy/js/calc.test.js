// js/calc.test.js
// TZ is pinned before any Date is touched so local-date tests are deterministic and match
// the user's real timezone (JST) rather than whatever the CI/dev machine happens to be in.
process.env.TZ = 'Asia/Tokyo';
const assert = require('assert');
const Calc = require('./calc.js');

// Cycle boundary tests
assert.strictEqual(Calc.getCycleForDate('2026-08-24'), '2026-08', 'Aug 24 belongs to cycle ending Aug 24');
assert.strictEqual(Calc.getCycleForDate('2026-08-25'), '2026-09', 'Aug 25 starts the cycle ending Sep 24');
assert.strictEqual(Calc.getCycleForDate('2026-09-24'), '2026-09', 'Sep 24 belongs to cycle 2026-09');
assert.strictEqual(Calc.getCycleForDate('2026-09-25'), '2026-10', 'Sep 25 starts cycle 2026-10');
assert.strictEqual(Calc.getCycleForDate('2026-12-25'), '2027-01', 'Dec 25 rolls into next calendar year');

const bounds = Calc.getCycleBounds('2026-09');
assert.strictEqual(bounds.start.getFullYear(), 2026);
assert.strictEqual(bounds.start.getMonth(), 7); // August, zero-indexed
assert.strictEqual(bounds.start.getDate(), 25);
assert.strictEqual(bounds.end.getMonth(), 8); // September
assert.strictEqual(bounds.end.getDate(), 24);

// Currency tests
assert.strictEqual(Calc.jpyToInr(21500, 2.15), 10000);
assert.strictEqual(Calc.inrToJpy(10000, 2.15), 21500);
assert.strictEqual(Calc.formatCurrency(10000, 'INR'), '₹10,000');
assert.strictEqual(Calc.formatCurrency(21500, 'JPY'), '¥21,500');

// Amortization tests
const schedule = Calc.buildAmortizationSchedule({
  principal: 100000, annualRatePct: 12, emi: 10000, tenureMonths: 12, extras: {}
});
assert.strictEqual(schedule[0].opening, 100000);
assert.strictEqual(schedule[0].interest, 1000); // 100000 * (12/100/12)
assert.strictEqual(schedule[0].closing, 91000); // 100000 + 1000 - 10000

// Overpay clamp: huge extra prepayment must not go negative
const clampSchedule = Calc.buildAmortizationSchedule({
  principal: 5000, annualRatePct: 12, emi: 1000, tenureMonths: 12,
  extras: { 1: 999999 }
});
assert.strictEqual(clampSchedule[0].closing, 0, 'closing balance clamps at 0, never negative');
assert.strictEqual(clampSchedule.length, 1, 'schedule stops once principal hits 0');

assert.strictEqual(Calc.getPayoffMonth(clampSchedule), 1);
assert.strictEqual(Calc.getPayoffMonth([{month: 1, closing: 500}]), null);

// SIP projection tests — takes a real calendar payoffYear (not a loan-month offset guessed
// against the projection's own startYear, which was Review Finding #8: it silently assumed
// loan month 1 always falls in the projection's startYear).
const sip = Calc.buildSipProjection({
  startingMonthlyINR: 100000, annualStepUpPct: 10, estimatedReturnPct: 11,
  startYear: 2027, endYear: 2029, payoffYear: 2028, postLoanMonthlyRedirectINR: 78500
});
assert.strictEqual(sip.length, 3);
assert.strictEqual(sip[0].monthlySip, 100000); // year 0, no step-up yet
assert.strictEqual(sip[0].postLoanRedirect, 0); // 2027 < payoffYear 2028
assert.strictEqual(Math.round(sip[1].monthlySip), 110000); // year 1: +10%
assert.strictEqual(sip[1].postLoanRedirect, 78500); // 2028 >= payoffYear 2028
assert.strictEqual(sip[0].opening, 0);
assert.ok(sip[1].opening > 0, 'opening balance carries forward from prior year closing');

// loanMonthToYear: maps a 1-based loan-month index to the real calendar year it falls in,
// anchored on the loan's actual startCycle — this is what replaces the buggy offset above.
assert.strictEqual(Calc.loanMonthToYear(1, '2026-09'), 2026, 'loan month 1 (cycle 2026-09) falls in 2026');
assert.strictEqual(Calc.loanMonthToYear(4, '2026-09'), 2026, 'loan month 4 (cycle 2026-12) is still 2026');
assert.strictEqual(Calc.loanMonthToYear(5, '2026-09'), 2027, 'loan month 5 (cycle 2027-01) rolls into 2027');
assert.strictEqual(Calc.loanMonthToYear(15, '2026-09'), 2027, 'Review Finding #8 example: month 15 (cycle 2027-11) is 2027, not 2028');
assert.strictEqual(Calc.loanMonthToYear(17, '2026-09'), 2028, 'loan month 17 (cycle 2028-01) rolls into 2028');

// todayLocal: uses local calendar fields, never UTC — Review Finding #5. Constructed from an
// explicit ISO string with a fixed UTC instant, so this is deterministic regardless of the
// TZ pin above (it proves the function reads LOCAL fields, not that the pin worked).
const earlyMorningJST = new Date('2026-09-25T03:00:00+09:00'); // = 2026-09-24T18:00:00Z
assert.strictEqual(Calc.todayLocal(earlyMorningJST), '2026-09-25', 'local (JST) calendar date at this instant is the 25th');
assert.notStrictEqual(earlyMorningJST.toISOString().slice(0, 10), Calc.todayLocal(earlyMorningJST),
  'the UTC date (24th) and the local JST date (25th) genuinely differ at this instant — proves this is not just calling toISOString');

// Category normalization
assert.strictEqual(Calc.normalizeCategory('Eating out'), 'Eating Out');
assert.strictEqual(Calc.normalizeCategory('Groceries (Costco)'), 'Groceries');
assert.strictEqual(Calc.normalizeCategory('some unknown label'), 'Other');

// Filter/sort
const txns = [
  { id: 'a', date: '2026-08-26', categoryId: 'groceries', amountINR: 500, amountJPY: 850, description: 'Milk', paymentMethod: 'Cash', needWant: 'Need', notes: '' },
  { id: 'b', date: '2026-09-01', categoryId: 'wants', amountINR: 2000, amountJPY: 3400, description: 'Massage', paymentMethod: 'Credit Card', needWant: 'Want', notes: '' },
  { id: 'c', date: '2026-09-20', categoryId: 'groceries', amountINR: 300, amountJPY: 510, description: 'Veg', paymentMethod: 'Cash', needWant: 'Need', notes: '' }
];
const filtered = Calc.filterTransactions(txns, { categoryId: 'groceries' });
assert.strictEqual(filtered.length, 2);

const searched = Calc.filterTransactions(txns, { search: 'massage' });
assert.strictEqual(searched.length, 1);
assert.strictEqual(searched[0].id, 'b');

const sortedAsc = Calc.sortTransactions(txns, 'amountINR', 'asc');
assert.deepStrictEqual(sortedAsc.map(t => t.id), ['c', 'a', 'b']);
const sortedDesc = Calc.sortTransactions(txns, 'amountINR', 'desc');
assert.deepStrictEqual(sortedDesc.map(t => t.id), ['b', 'a', 'c']);

// Aggregate
const agg = Calc.aggregateByCycle(txns);
assert.strictEqual(agg['2026-09'].totalINR, 2800); // Aug26->cycle 2026-09, Sep1&Sep20 same cycle: 500+2000+300
assert.strictEqual(agg['2026-09'].byCategory['groceries'], 800);

// JPY totals alongside the existing INR ones (additive — for an NRI whose day-to-day
// spending is JPY-native, the Dashboard/Reports/Emergency-Fund views need JPY sums too,
// without disturbing any existing INR-based consumer of this function).
assert.strictEqual(agg['2026-09'].totalJPY, 4760, '850 (Aug26) + 3400 (Sep1) + 510 (Sep20) = 4760');
assert.strictEqual(agg['2026-09'].byCategoryJPY['groceries'], 1360, '850 + 510 = 1360');
assert.strictEqual(agg['2026-09'].byCategoryJPY['wants'], 3400);

// Review Finding #6: a non-default cycleStartDay must actually change how these two group
// transactions, not just the current-cycle label computed elsewhere in the app.
const customStartDay = 10;
// With cycleStartDay=10: Aug 26 (>=10) -> cycle 2026-09; Sep 1 (<10) -> cycle 2026-09;
// Sep 20 (>=10) -> cycle 2026-10. So the 25th-default grouping (all three in 2026-09) changes.
const aggCustom = Calc.aggregateByCycle(txns, customStartDay);
assert.strictEqual(aggCustom['2026-09'].totalINR, 2500, 'Aug 26 + Sep 1 group into cycle 2026-09 when cycleStartDay=10');
assert.strictEqual(aggCustom['2026-10'].totalINR, 300, 'Sep 20 moves into cycle 2026-10 when cycleStartDay=10 (it stayed in 2026-09 under the default 25)');

const filteredCustom = Calc.filterTransactions(txns, { cycle: '2026-10', cycleStartDay: customStartDay });
assert.strictEqual(filteredCustom.length, 1, 'filterTransactions honors a non-default cycleStartDay too');
assert.strictEqual(filteredCustom[0].id, 'c');

// Cycle-to-loan-month mapping
assert.strictEqual(Calc.cycleToLoanMonth('2026-09', '2026-09'), 1, 'start cycle is loan month 1');
assert.strictEqual(Calc.cycleToLoanMonth('2026-10', '2026-09'), 2);
assert.strictEqual(Calc.cycleToLoanMonth('2027-09', '2026-09'), 13, 'wraps across a calendar year');

console.log('calc.test.js: cycles, currency, amortization, SIP projection (payoffYear), transaction helpers (custom cycleStartDay), loan-month mapping & todayLocal — ALL PASS');
