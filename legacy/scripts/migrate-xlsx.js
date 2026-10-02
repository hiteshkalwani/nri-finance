// scripts/migrate-xlsx.js — one-off script, run manually, output committed as seed-data.json.
// Requires: npm install xlsx  (dev-time only, not part of the shipped app)
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const Calc = require('../js/calc.js');

const SOURCE = process.argv[2] || '/Users/hitesh/Downloads/Personal_Financial_Strategy_2026_2036 (1).xlsx';
const wb = XLSX.readFile(SOURCE);

const CATEGORY_LIST = [
  { id: 'groceries', name: 'Groceries', color: '#4caf50' },
  { id: 'eating-out', name: 'Eating Out', color: '#ff9800' },
  { id: 'fixed-obligations', name: 'Fixed Obligations', color: '#3f51b5' },
  { id: 'family-india', name: 'Family/India', color: '#9c27b0' },
  { id: 'wants', name: 'Wants', color: '#e91e63' },
  { id: 'transport', name: 'Transport', color: '#00bcd4' },
  { id: 'utilities', name: 'Utilities', color: '#607d8b' },
  { id: 'rent', name: 'Rent', color: '#795548' },
  { id: 'emergency-fund', name: 'Emergency Fund', color: '#009688' },
  { id: 'other', name: 'Other', color: '#9e9e9e' }
];
const nameToId = Object.fromEntries(CATEGORY_LIST.map(c => [c.name, c.id]));

const expensesSheet = wb.Sheets['Daily Expenses'];
const rows = XLSX.utils.sheet_to_json(expensesSheet, { range: 2, defval: '' });

const transactions = rows
  .filter(r => r.Date)
  .map((r, i) => {
    const normalizedName = Calc.normalizeCategory(String(r.Category || '').trim());
    const date = XLSX.SSF.format('yyyy-mm-dd', r.Date);
    return {
      id: `migrated-${i + 1}`,
      date,
      categoryId: nameToId[normalizedName] || 'other',
      description: String(r.Description || ''),
      amountJPY: Number(r['Amount JPY']) || 0,
      amountINR: Number(r['Amount INR']) || 0,
      paymentMethod: String(r['Payment Method'] || 'Cash'),
      needWant: String(r['Need/Want'] || 'Need'),
      notes: String(r.Notes || '')
    };
  });

const planSheet = wb.Sheets['Financial Plan'];
const cell = (ref) => planSheet[ref] ? planSheet[ref].v : 0;

const earliestDate = transactions.length ? transactions.map(t => t.date).sort()[0] : new Date().toISOString().slice(0, 10);
const homeLoanStartCycle = Calc.getCycleForDate(earliestDate, 25);

const seed = {
  settings: {
    salaryJPY: cell('E4'),
    jpyPerInr: cell('E5'),
    cycleStartDay: 25,
    emergencyFundTargetJPY: cell('E9'),
    homeLoan: {
      principalINR: cell('E10'),
      annualRatePct: cell('E11') * 100,
      emiINR: cell('E12'),
      tenureMonths: cell('E13'),
      startCycle: homeLoanStartCycle
    },
    sip: {
      startingMonthlyINR: cell('E14'),
      annualStepUpPct: cell('E17') * 100,
      estimatedReturnPct: 11,
      allocation: { Nifty50: 40, FlexiCap: 20, MidCap: 15, SmallCap: 10, GlobalEquity: 10, Gold: 5 }
    }
  },
  categories: CATEGORY_LIST,
  transactions,
  cycleTargets: [],
  homeLoanExtras: []
};

fs.writeFileSync(path.join(__dirname, '..', 'seed-data.json'), JSON.stringify(seed, null, 2));
console.log(`Migrated ${transactions.length} transactions to seed-data.json`);
