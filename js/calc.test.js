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

console.log('calc.test.js: cycles & currency — ALL PASS');
