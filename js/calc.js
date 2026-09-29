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

Calc.buildSipProjection = function({
  startingMonthlyINR, annualStepUpPct, estimatedReturnPct,
  startYear, endYear, payoffYear, postLoanMonthlyRedirectINR
}) {
  const rows = [];
  let opening = 0;
  for (let year = startYear; year <= endYear; year++) {
    const yearsElapsed = year - startYear;
    const monthlySip = startingMonthlyINR * Math.pow(1 + annualStepUpPct / 100, yearsElapsed);
    const postLoanRedirect = (payoffYear != null && year >= payoffYear)
      ? postLoanMonthlyRedirectINR : 0;
    const annualBase = monthlySip * 12;
    const totalAnnual = annualBase + postLoanRedirect * 12;
    const growth = (opening + totalAnnual / 2) * (estimatedReturnPct / 100);
    const closing = opening + totalAnnual + growth;
    rows.push({ year, monthlySip, annualBase, postLoanRedirect, totalAnnual, opening, growth, closing });
    opening = closing;
  }
  return rows;
};

Calc.CATEGORY_NORMALIZATION_MAP = {
  'Wants (Massage, shopping, hobbies, gifts, etc.)': 'Wants',
  'Fixed obligations (Home loan, rent, utilities, insurance, etc.)': 'Fixed Obligations',
  'Family / India (Transfers to India, parents, wife, etc.)': 'Family/India',
  'Eating out': 'Eating Out',
  'Groceries (Costco, Hanamasa, Welcia, etc.)': 'Groceries',
  'Groceries (Costco)': 'Groceries'
};

Calc.normalizeCategory = function(rawCategory) {
  return Calc.CATEGORY_NORMALIZATION_MAP[rawCategory] || 'Other';
};

Calc.filterTransactions = function(transactions, filters = {}) {
  const { cycle, categoryId, paymentMethod, needWant, search, cycleStartDay = 25 } = filters;
  return transactions.filter(t => {
    if (cycle && Calc.getCycleForDate(t.date, cycleStartDay) !== cycle) return false;
    if (categoryId && t.categoryId !== categoryId) return false;
    if (paymentMethod && t.paymentMethod !== paymentMethod) return false;
    if (needWant && t.needWant !== needWant) return false;
    if (search) {
      const hay = `${t.description} ${t.notes}`.toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    return true;
  });
};

Calc.sortTransactions = function(transactions, sortBy, direction = 'asc') {
  const sorted = [...transactions].sort((a, b) => {
    let av = a[sortBy], bv = b[sortBy];
    if (typeof av === 'string') av = av.toLowerCase();
    if (typeof bv === 'string') bv = bv.toLowerCase();
    if (av < bv) return -1;
    if (av > bv) return 1;
    return 0;
  });
  return direction === 'desc' ? sorted.reverse() : sorted;
};

Calc.aggregateByCycle = function(transactions, cycleStartDay = 25) {
  const map = {};
  for (const t of transactions) {
    const cycle = Calc.getCycleForDate(t.date, cycleStartDay);
    if (!map[cycle]) map[cycle] = { totalINR: 0, byCategory: {}, totalJPY: 0, byCategoryJPY: {} };
    map[cycle].totalINR += t.amountINR;
    map[cycle].byCategory[t.categoryId] = (map[cycle].byCategory[t.categoryId] || 0) + t.amountINR;
    map[cycle].totalJPY += t.amountJPY;
    map[cycle].byCategoryJPY[t.categoryId] = (map[cycle].byCategoryJPY[t.categoryId] || 0) + t.amountJPY;
  }
  return map;
};

Calc.cycleToLoanMonth = function(cycle, startCycle) {
  const [sy, sm] = startCycle.split('-').map(Number);
  const [cy, cm] = cycle.split('-').map(Number);
  return (cy - sy) * 12 + (cm - sm) + 1;
};

Calc.loanMonthToYear = function(loanMonth, startCycle) {
  const [sy, sm] = startCycle.split('-').map(Number);
  const totalMonthIndex = (sm - 1) + (loanMonth - 1);
  return sy + Math.floor(totalMonthIndex / 12);
};

Calc.todayLocal = function(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Calc;
}
if (typeof window !== 'undefined') {
  window.Calc = Calc;
}
