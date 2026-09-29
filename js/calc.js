// js/calc.js — pure calculation engine. No DOM access. Tested via calc.test.js,
// then copied verbatim into index.html's #calc-engine script block (see Task 17).
const Calc = {};

Calc.getCycleForDate = function(dateStr, cycleStartDay = 25) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDate();
  let month = d.getMonth();
  let year = d.getFullYear();
  if (day >= cycleStartDay) {
    month += 1;
    if (month > 11) { month = 0; year += 1; }
  }
  return `${year}-${String(month + 1).padStart(2, '0')}`;
};

Calc.getCycleBounds = function(cycleLabel, cycleStartDay = 25) {
  const [y, m] = cycleLabel.split('-').map(Number);
  const endMonthIndex = m - 1;
  const end = new Date(y, endMonthIndex, cycleStartDay - 1);
  let startMonthIndex = endMonthIndex - 1;
  let startYear = y;
  if (startMonthIndex < 0) { startMonthIndex = 11; startYear -= 1; }
  const start = new Date(startYear, startMonthIndex, cycleStartDay);
  return { start, end };
};

Calc.jpyToInr = function(amountJPY, jpyPerInr) {
  return amountJPY / jpyPerInr;
};

Calc.inrToJpy = function(amountINR, jpyPerInr) {
  return amountINR * jpyPerInr;
};

Calc.formatCurrency = function(amount, currency) {
  const symbol = currency === 'JPY' ? '¥' : '₹';
  const rounded = Math.round(amount);
  return symbol + rounded.toLocaleString('en-IN');
};

Calc.buildAmortizationSchedule = function({ principal, annualRatePct, emi, tenureMonths, extras = {} }) {
  const monthlyRate = annualRatePct / 100 / 12;
  const rows = [];
  let opening = principal;
  for (let m = 1; m <= tenureMonths && opening > 0; m++) {
    const interest = opening * monthlyRate;
    const extra = extras[m] || 0;
    const closing = Math.max(0, opening + interest - emi - extra);
    rows.push({ month: m, opening, interest, emi, extra, closing });
    opening = closing;
  }
  return rows;
};

Calc.getPayoffMonth = function(schedule) {
  const row = schedule.find(r => r.closing === 0);
  return row ? row.month : null;
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Calc;
}
if (typeof window !== 'undefined') {
  window.Calc = Calc;
}
