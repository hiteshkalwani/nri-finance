// js/calc.test.js
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

// SIP projection tests
const sip = Calc.buildSipProjection({
  startingMonthlyINR: 100000, annualStepUpPct: 10, estimatedReturnPct: 11,
  startYear: 2027, endYear: 2029, payoffMonth: 15, postLoanMonthlyRedirectINR: 78500
});
assert.strictEqual(sip.length, 3);
assert.strictEqual(sip[0].monthlySip, 100000); // year 0, no step-up yet
assert.strictEqual(sip[0].postLoanRedirect, 0); // payoff at month 15 = year 2028, not yet in 2027
assert.strictEqual(Math.round(sip[1].monthlySip), 110000); // year 1: +10%
assert.strictEqual(sip[1].postLoanRedirect, 78500); // month 15 falls in year offset 1 -> 2028
assert.strictEqual(sip[0].opening, 0);
assert.ok(sip[1].opening > 0, 'opening balance carries forward from prior year closing');

// Category normalization
assert.strictEqual(Calc.normalizeCategory('Eating out'), 'Eating Out');
assert.strictEqual(Calc.normalizeCategory('Groceries (Costco)'), 'Groceries');
assert.strictEqual(Calc.normalizeCategory('some unknown label'), 'Other');

// Filter/sort
const txns = [
  { id: 'a', date: '2026-08-26', categoryId: 'groceries', amountINR: 500, description: 'Milk', paymentMethod: 'Cash', needWant: 'Need', notes: '' },
  { id: 'b', date: '2026-09-01', categoryId: 'wants', amountINR: 2000, description: 'Massage', paymentMethod: 'Credit Card', needWant: 'Want', notes: '' },
  { id: 'c', date: '2026-09-20', categoryId: 'groceries', amountINR: 300, description: 'Veg', paymentMethod: 'Cash', needWant: 'Need', notes: '' }
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

console.log('calc.test.js: cycles, currency, amortization, SIP projection & transaction helpers — ALL PASS');
