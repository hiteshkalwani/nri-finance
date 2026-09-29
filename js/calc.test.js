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

console.log('calc.test.js: cycles, currency & amortization — ALL PASS');
