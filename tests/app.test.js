// tests/app.test.js — headless regression suite for index.html, run via:
//   node tests/app.test.js
// Requires (dev-only, see package.json): jsdom, fake-indexeddb.
//
// This session has no real Chrome available, so the real File System Access API
// (showOpenFilePicker/showSaveFilePicker, live disk writes, permission prompts) cannot be
// exercised here — FileStorage.handle is instead a small in-memory stand-in (makeFakeHandle)
// that implements just the surface FileStorage actually calls (getFile().text(),
// createWritable().write()/close()). That still fully exercises Store's own logic (dirty
// tracking, validation, seeding) against a realistic backing store; it does not prove the
// real browser API behaves the same way. A one-time real-Chrome check is still recommended
// before relying on this app with real financial data.
//
// Note on jsdom + `const`: top-level `const`/`let` declared inside a classic <script> tag
// (App, Store, FileStorage, LocalMirror, UI, Tabs) do NOT become `window.*` properties —
// only `var`s and functions do. Every access below goes through `window.eval('<expr>')`
// (or an async wrapper around it) rather than `window.Store`/`window.FileStorage` etc.
// `window.Calc` is the one exception (calc.js explicitly assigns `window.Calc = Calc`), but
// this file still routes it through eval for consistency.
process.env.TZ = 'Asia/Tokyo';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');
require('fake-indexeddb/auto');

const rootDir = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');

function FakeChart(canvasEl, config) { this.canvasEl = canvasEl; this.config = config; }
FakeChart.prototype.destroy = function() {};
function FakeModal() {}
FakeModal.prototype.show = function() {};
FakeModal.prototype.hide = function() {};

function newDom() {
  return new JSDOM(html, {
    runScripts: 'dangerously', resources: undefined, url: 'http://localhost/index.html',
    beforeParse(window) {
      window.indexedDB = global.indexedDB;
      window.Chart = FakeChart;
      window.bootstrap = { Modal: FakeModal };
    }
  });
}

// Runs `expr` inside the dom's realm and returns its value, JSON round-tripped back into
// this (Node) realm so assert.deepStrictEqual etc. never trip on cross-realm prototypes.
function run(dom, expr) {
  return dom.window.eval(expr);
}
function runJson(dom, expr) {
  const raw = dom.window.eval(`JSON.stringify(${expr})`);
  return raw === undefined ? undefined : JSON.parse(raw);
}
// For an async (Promise-returning) expression in the dom's realm.
async function runAsync(dom, expr) {
  return await dom.window.eval(expr);
}
function setSeed(dom, seedObj) {
  dom.window.__injected = seedObj;
  run(dom, `Store.data = window.__injected; Store.ready = true;`);
}
function fireEvent(dom, el, type) {
  el.dispatchEvent(new dom.window.Event(type, { bubbles: true }));
}

// A FileSystemFileHandle-like stand-in implementing only what FileStorage calls.
function makeFakeHandle(dom, initialText) {
  dom.window.__fakeHandleText = initialText;
  dom.window.__fakeHandle = {
    kind: 'file',
    getFile() { return Promise.resolve({ text: () => Promise.resolve(dom.window.__fakeHandleText) }); },
    createWritable() {
      return Promise.resolve({
        write(content) { dom.window.__fakeHandleText = content; return Promise.resolve(); },
        close() { return Promise.resolve(); }
      });
    },
    requestPermission() { return Promise.resolve('granted'); }
  };
  return dom.window.__fakeHandle;
}
function readFakeHandle(dom) { return dom.window.__fakeHandleText; }
function breakFakeHandleWrites(dom) {
  run(dom, `window.__fakeHandle.createWritable = () => Promise.reject(new Error('simulated permission revoked'))`);
}
function fixFakeHandleWrites(dom) {
  run(dom, `window.__fakeHandle.createWritable = () => Promise.resolve({
    write(content) { window.__fakeHandleText = content; return Promise.resolve(); },
    close() { return Promise.resolve(); }
  })`);
}

let passCount = 0;
function pass(label) { passCount++; console.log('PASS:', label); }

async function main() {
  // ── inline seed data is present, valid, and well-formed (Critical C2) ──────────────────
  {
    const dom = newDom();
    const seed = runJson(dom, `JSON.parse(document.getElementById('seed-data').textContent)`);
    assert.ok(Array.isArray(seed.transactions) && seed.transactions.length > 50, 'inline seed has the migrated transactions');
    assert.ok(Array.isArray(seed.categories) && seed.categories.length > 0, 'inline seed has categories');
    assert.ok(seed.settings && seed.settings.homeLoan && seed.settings.homeLoan.startCycle, 'inline seed has a homeLoan.startCycle');
    pass('inline #seed-data is present and well-formed (C2)');
  }

  // ── a genuinely empty file seeds from the inline data, not a broken empty doc (C2) ─────
  {
    const dom = newDom();
    makeFakeHandle(dom, ''); // brand new, empty file: the file:// first-run case
    run(dom, `FileStorage.handle = window.__fakeHandle`);
    await runAsync(dom, `Store.initFromFile()`);
    assert.strictEqual(run(dom, 'Store.ready'), true, 'app becomes ready after seeding an empty file');
    assert.ok(run(dom, 'Store.data.transactions.length') > 50, 'seeded data includes the migrated transactions');
    assert.ok(run(dom, 'Store.data.categories.length') > 0, 'seeded data includes categories (not the old broken empty [])');
    assert.ok(run(dom, 'Store.data.settings.homeLoan.startCycle'), 'seeded data includes homeLoan.startCycle (previously undefined, crashed the Home Loan tab)');
    run(dom, `App.showTab('home-loan')`); // must not throw
    pass('empty file:// first run seeds real data and Home Loan tab does not crash (C2)');
  }

  // ── an unreadable/invalid file is never silently overwritten (Important #1) ────────────
  {
    const dom = newDom();
    makeFakeHandle(dom, '{not valid json');
    run(dom, `FileStorage.handle = window.__fakeHandle`);
    await runAsync(dom, `Store.initFromFile()`);
    assert.strictEqual(run(dom, 'Store.ready'), false, 'app does not mark itself ready against corrupt data');
    assert.strictEqual(readFakeHandle(dom), '{not valid json', 'the corrupt file on disk was never overwritten');
  }
  {
    const dom = newDom();
    makeFakeHandle(dom, JSON.stringify({ some: 'other json file', nothing: 'to do with this app' }));
    run(dom, `FileStorage.handle = window.__fakeHandle`);
    await runAsync(dom, `Store.initFromFile()`);
    assert.strictEqual(run(dom, 'Store.ready'), false, 'app does not mark itself ready against a wrong-shape JSON file');
    assert.ok(readFakeHandle(dom).includes('other json file'), 'the unrelated file was never overwritten');
    pass('corrupt or wrong-shape data files are never silently overwritten (Important #1)');
  }

  // ── reconnecting never overwrites newer unsynced local edits (Critical C1) ─────────────
  {
    const dom = newDom();
    const initialDoc = {
      settings: { salaryJPY: 670000, jpyPerInr: 1.7, cycleStartDay: 25, emergencyFundTargetJPY: 0,
        homeLoan: { principalINR: 0, annualRatePct: 0, emiINR: 0, tenureMonths: 0, startCycle: '2026-09' },
        sip: { startingMonthlyINR: 0, annualStepUpPct: 0, estimatedReturnPct: 11, allocation: {} } },
      categories: [{ id: 'other', name: 'Other', color: '#999' }], transactions: [], cycleTargets: [], homeLoanExtras: []
    };
    makeFakeHandle(dom, JSON.stringify(initialDoc));
    run(dom, `FileStorage.handle = window.__fakeHandle`);
    await runAsync(dom, `Store.initFromFile()`);
    assert.strictEqual(run(dom, 'Store.data.transactions.length'), 0, 'starts with zero transactions');

    // Simulate a failed write (permission revoked / disk error mid-session).
    breakFakeHandleWrites(dom);
    dom.window.__newTxn = { id: 'unsynced-1', date: '2026-09-10', categoryId: 'other', amountINR: 500, amountJPY: 0, paymentMethod: 'Cash', needWant: 'Need', notes: '' };
    await runAsync(dom, `Store.mutate(d => { d.transactions.push(window.__newTxn); })`);
    assert.strictEqual(run(dom, 'LocalMirror.isDirty()'), true, 'a failed write marks the mirror dirty');
    assert.strictEqual(run(dom, 'Store.data.transactions.length'), 1, 'the edit is still in memory despite the failed file write');

    // "Reconnect" (permission re-granted): restore working writes, but the file's ON-DISK
    // content is the OLD data — simulating the file never having received the failed write.
    fixFakeHandleWrites(dom);
    dom.window.__staleDisk = JSON.stringify({ ...initialDoc, transactions: [] });
    run(dom, `window.__fakeHandleText = window.__staleDisk`);
    await runAsync(dom, `Store.syncAfterConnect()`);
    assert.strictEqual(run(dom, 'Store.data.transactions.length'), 1, 'reconnecting does NOT discard the unsynced edit (C1)');
    assert.strictEqual(run(dom, `Store.data.transactions[0].id`), 'unsynced-1');
    const nowOnDisk = JSON.parse(readFakeHandle(dom));
    assert.strictEqual(nowOnDisk.transactions.length, 1, 'the unsynced edit was pushed to the file on reconnect, not overwritten by it');
    assert.strictEqual(run(dom, 'LocalMirror.isDirty()'), false, 'dirty flag clears once the edit is confirmed written');
    pass('reconnect never discards newer unsynced edits (Critical C1)');
  }

  // ── Home Loan Balance dashboard card shows the CURRENT balance, not the final one (#4) ──
  {
    const dom = newDom();
    const seed = runJson(dom, `JSON.parse(document.getElementById('seed-data').textContent)`);
    const todayCycle = run(dom, `Calc.getCycleForDate(Calc.todayLocal(), 25)`);
    seed.settings.homeLoan = { principalINR: 100000, annualRatePct: 12, emiINR: 10000, tenureMonths: 12, startCycle: todayCycle };
    setSeed(dom, seed);
    run(dom, `Tabs.dashboard.render()`);
    const cards = dom.window.document.querySelectorAll('#dash-stat-cards .stat-card');
    const loanCard = Array.from(cards).find(c => c.textContent.includes('Home Loan Balance'));
    const shownValue = loanCard.querySelector('.fs-4').textContent;
    // startCycle == today's cycle, so "current loan month" is month 1 — its CLOSING balance
    // (100000 principal + 1000 interest - 10000 EMI = 91000) is what should show, NOT the
    // schedule's FINAL row's closing balance (0), which is what the pre-fix code always
    // showed regardless of where "today" actually falls in the schedule.
    assert.strictEqual(shownValue, run(dom, `Calc.formatCurrency(91000, 'INR')`),
      "loan balance card shows the balance at the CURRENT loan month, not the schedule's final row");
    pass('Home Loan Balance dashboard card shows the current-cycle balance (Important #4)');
  }

  // ── cycleStartDay actually changes how transactions are grouped app-wide (#6) ──────────
  {
    const dom = newDom();
    const seed = runJson(dom, `JSON.parse(document.getElementById('seed-data').textContent)`);
    seed.settings.cycleStartDay = 10;
    seed.transactions = [
      { id: 't1', date: '2026-09-05', categoryId: 'other', amountINR: 100, amountJPY: 0, paymentMethod: 'Cash', needWant: 'Need', notes: '' },
      { id: 't2', date: '2026-09-15', categoryId: 'other', amountINR: 200, amountJPY: 0, paymentMethod: 'Cash', needWant: 'Need', notes: '' }
    ];
    setSeed(dom, seed);
    run(dom, `App.showTab('transactions')`);
    const cycleOptions = Array.from(dom.window.document.querySelectorAll('#txn-filter-cycle option')).map(o => o.value).filter(Boolean);
    // With cycleStartDay=10: Sep5 (<10) -> cycle 2026-09; Sep15 (>=10) -> cycle 2026-10.
    assert.ok(cycleOptions.includes('2026-09') && cycleOptions.includes('2026-10'),
      'the two transactions land in different cycles once cycleStartDay=10 is actually applied');
    pass('cycleStartDay setting is actually applied end-to-end, not just in the current-cycle label (Important #6)');
  }

  // ── editing a transaction with quotes/HTML in its text does not corrupt it (#9) ────────
  {
    const dom = newDom();
    const { document } = dom.window;
    const seed = runJson(dom, `JSON.parse(document.getElementById('seed-data').textContent)`);
    setSeed(dom, seed);
    run(dom, `App.showTab('transactions')`);

    const trickyDescription = `12" pizza <b>deal</b> & "friends"`;
    run(dom, `Tabs.transactions.openForm(null)`);
    document.getElementById('f-date').value = '2026-09-10';
    document.getElementById('f-category').value = seed.categories[0].id;
    document.getElementById('f-description').value = trickyDescription;
    document.getElementById('f-amount-inr').value = '500';
    fireEvent(dom, document.getElementById('shared-modal-save'), 'click');
    const savedId = run(dom, `Store.data.transactions[Store.data.transactions.length - 1].id`);
    const saved = runJson(dom, `Store.data.transactions.find(t => t.id === ${JSON.stringify(savedId)})`);
    assert.strictEqual(saved.description, trickyDescription, 'description with quotes/HTML saved correctly on first save');

    // Re-open the SAME record — this is exactly where the old unescaped
    // `value="${existing.description}"` broke: the embedded `"` ended the attribute early,
    // truncating the input's value to `12`.
    run(dom, `Tabs.transactions.openForm(${JSON.stringify(savedId)})`);
    const reopenedValue = document.getElementById('f-description').value;
    assert.strictEqual(reopenedValue, trickyDescription, "reopening the edit form shows the full description, unbroken by its quote/angle-bracket characters (Important #9)");
    fireEvent(dom, document.getElementById('shared-modal-save'), 'click'); // no changes, just close
    run(dom, `Tabs.transactions.render()`);
    const cell = Array.from(document.querySelectorAll('#txn-table-container tbody tr'))
      .find(tr => tr.textContent.includes('pizza')).children[2];
    assert.strictEqual(cell.querySelector('b'), null, 'the description is rendered as text, not as HTML (no <b> element was created)');
    assert.ok(cell.textContent.includes('<b>deal</b>'), 'the literal "<b>deal</b>" text is visible, escaped, not executed as markup');
    pass('editing a transaction with quotes/HTML in its text round-trips safely (Important #9)');
  }

  // ── multi-line notes survive an edit (textarea, not input) ─────────────────────────────
  {
    const dom = newDom();
    const { document } = dom.window;
    const seed = runJson(dom, `JSON.parse(document.getElementById('seed-data').textContent)`);
    setSeed(dom, seed);
    const multilineNotes = 'line one\nline two\nline three';
    run(dom, `Tabs.transactions.openForm(null)`);
    document.getElementById('f-date').value = '2026-09-10';
    document.getElementById('f-category').value = seed.categories[0].id;
    document.getElementById('f-description').value = 'multiline test';
    document.getElementById('f-amount-inr').value = '10';
    document.getElementById('f-notes').value = multilineNotes;
    fireEvent(dom, document.getElementById('shared-modal-save'), 'click');
    const savedNotes = run(dom, `Store.data.transactions[Store.data.transactions.length - 1].notes`);
    assert.strictEqual(savedNotes, multilineNotes, 'multi-line notes are preserved (notes field is a textarea, not a single-line input)');
    pass('multi-line notes survive add/edit');
  }

  // ── live bidirectional JPY/INR conversion while typing (#10) ───────────────────────────
  {
    const dom = newDom();
    const { document } = dom.window;
    const seed = runJson(dom, `JSON.parse(document.getElementById('seed-data').textContent)`);
    seed.settings.jpyPerInr = 2;
    setSeed(dom, seed);
    run(dom, `Tabs.transactions.openForm(null)`);
    const inrInput = document.getElementById('f-amount-inr');
    const jpyInput = document.getElementById('f-amount-jpy');
    inrInput.value = '1000';
    fireEvent(dom, inrInput, 'input');
    assert.strictEqual(jpyInput.value, '2000', 'typing an INR amount live-updates the JPY field');
    jpyInput.value = '500';
    fireEvent(dom, jpyInput, 'input');
    assert.strictEqual(inrInput.value, '250', 'typing a JPY amount live-updates the INR field');
    pass('live bidirectional JPY/INR conversion while typing (Important #10)');
  }

  // ── category filter dropdown refreshes when a category is added later ─────────────────
  {
    const dom = newDom();
    const { document } = dom.window;
    const seed = runJson(dom, `JSON.parse(document.getElementById('seed-data').textContent)`);
    setSeed(dom, seed);
    run(dom, `App.showTab('transactions')`);
    const beforeOptions = document.getElementById('txn-filter-category').options.length;
    dom.window.__newCat = { id: 'new-cat', name: 'Brand New Category', color: '#123456' };
    await runAsync(dom, `Store.mutate(d => { d.categories.push(window.__newCat); })`);
    run(dom, `Tabs.transactions.render()`);
    const afterOptions = Array.from(document.getElementById('txn-filter-category').options).map(o => o.textContent);
    assert.ok(afterOptions.includes('Brand New Category'), 'a category added after the tab first rendered appears in the filter dropdown without a reload');
    assert.strictEqual(document.getElementById('txn-filter-category').options.length, beforeOptions + 1);
    pass('category filter dropdown refreshes when a new category is added');
  }

  // ── Emergency Fund running balance is cumulative and capped at the overall target ──────
  {
    const dom = newDom();
    const seed = runJson(dom, `JSON.parse(document.getElementById('seed-data').textContent)`);
    seed.settings.jpyPerInr = 2;
    seed.settings.emergencyFundTargetJPY = 2000; // = 1000 INR overall target
    seed.transactions = [
      { id: 'e1', date: '2026-08-26', categoryId: 'emergency-fund', amountINR: 600, amountJPY: 0, paymentMethod: 'Bank', needWant: 'Need', notes: '' },
      { id: 'e2', date: '2026-09-01', categoryId: 'emergency-fund', amountINR: 600, amountJPY: 0, paymentMethod: 'Bank', needWant: 'Need', notes: '' }
    ];
    setSeed(dom, seed);
    run(dom, `Tabs.emergencyFund.render()`);
    const summaryText = dom.window.document.getElementById('ef-running-summary').textContent;
    // 600 (cycle 2026-09, Aug26) + 600 (cycle 2026-09, Sep1) = 1200 cumulative, capped at 1000.
    assert.ok(summaryText.includes(run(dom, `Calc.formatCurrency(1000, 'INR')`)),
      'running balance is capped at the overall emergency fund target, not left uncapped at 1200');
    pass('Emergency Fund running balance is cumulative and capped at the overall target');
  }

  // ── Dashboard excludes emergency-fund contributions from "Spend" and savings rate ──────
  {
    const dom = newDom();
    const seed = runJson(dom, `JSON.parse(document.getElementById('seed-data').textContent)`);
    const todayCycle = run(dom, `Calc.getCycleForDate(Calc.todayLocal(), ${seed.settings.cycleStartDay})`);
    const [cy, cm] = todayCycle.split('-').map(Number);
    const dateInCurrentCycle = `${cy}-${String(cm).padStart(2, '0')}-01`;
    seed.settings.salaryJPY = 0; seed.settings.jpyPerInr = 1;
    seed.transactions = [
      { id: 'g1', date: dateInCurrentCycle, categoryId: 'groceries', amountINR: 100, amountJPY: 0, paymentMethod: 'Cash', needWant: 'Need', notes: '' },
      { id: 'e1', date: dateInCurrentCycle, categoryId: 'emergency-fund', amountINR: 300, amountJPY: 0, paymentMethod: 'Bank', needWant: 'Need', notes: '' }
    ];
    setSeed(dom, seed);
    run(dom, `Tabs.dashboard.render()`);
    const cards = dom.window.document.querySelectorAll('#dash-stat-cards .stat-card');
    const spendCard = Array.from(cards).find(c => c.textContent.includes('Spend ('));
    assert.strictEqual(spendCard.querySelector('.fs-4').textContent, run(dom, `Calc.formatCurrency(100, 'INR')`),
      '"Spend" card excludes the emergency-fund contribution (only the 100 groceries counts, not 400 total)');
    const efCard = Array.from(cards).find(c => c.textContent.includes('Emergency Fund'));
    assert.strictEqual(efCard.querySelector('.fs-4').textContent, run(dom, `Calc.formatCurrency(300, 'INR')`), 'Emergency Fund card shows its own actual contribution');
    pass('Dashboard excludes emergency-fund contributions from Spend/savings-rate (double-counting fix)');
  }

  // ── Backup import validates, confirms, and fully replaces data (Important #3) ──────────
  {
    const dom = newDom();
    dom.window.alert = () => {}; // jsdom has no window.alert
    dom.window.confirm = () => true;
    const seed = runJson(dom, `JSON.parse(document.getElementById('seed-data').textContent)`);
    setSeed(dom, seed);

    // Invalid JSON is rejected, nothing is replaced.
    const fileInput = dom.window.document.getElementById('btn-backup-import');
    dom.window.__badFile = new dom.window.File(['not json'], 'bad.json', { type: 'application/json' });
    dom.window.__badFile.text = () => Promise.resolve('not json');
    Object.defineProperty(fileInput, 'files', { value: [dom.window.__badFile], configurable: true });
    fireEvent(dom, fileInput, 'change');
    await new Promise(r => setTimeout(r, 20));
    assert.strictEqual(run(dom, 'Store.data.transactions.length'), seed.transactions.length, 'invalid JSON does not touch existing data');

    // Wrong-shape JSON (valid JSON, not a finance document) is rejected.
    const wrongShape = JSON.stringify({ hello: 'world' });
    dom.window.__wrongFile = new dom.window.File([wrongShape], 'wrong.json', { type: 'application/json' });
    dom.window.__wrongFile.text = () => Promise.resolve(wrongShape);
    Object.defineProperty(fileInput, 'files', { value: [dom.window.__wrongFile], configurable: true });
    fireEvent(dom, fileInput, 'change');
    await new Promise(r => setTimeout(r, 20));
    assert.strictEqual(run(dom, 'Store.data.transactions.length'), seed.transactions.length, 'wrong-shape JSON does not touch existing data');

    // A valid backup, once confirmed, fully replaces the data (not a shallow merge).
    const backup = { ...seed, transactions: [], settings: { ...seed.settings, salaryJPY: 555555 } };
    const backupText = JSON.stringify(backup);
    dom.window.__goodFile = new dom.window.File([backupText], 'good.json', { type: 'application/json' });
    dom.window.__goodFile.text = () => Promise.resolve(backupText);
    Object.defineProperty(fileInput, 'files', { value: [dom.window.__goodFile], configurable: true });
    fireEvent(dom, fileInput, 'change');
    await new Promise(r => setTimeout(r, 20));
    assert.strictEqual(run(dom, 'Store.data.transactions.length'), 0, 'a confirmed valid backup fully replaces transactions');
    assert.strictEqual(run(dom, 'Store.data.settings.salaryJPY'), 555555, 'a confirmed valid backup fully replaces settings');
    pass('backup import validates JSON shape and requires confirmation before replacing data (Important #3)');
  }

  // ── Backup import works even with no file connected yet (previously crashed) ───────────
  {
    const dom = newDom();
    dom.window.alert = () => {};
    dom.window.confirm = () => true;
    // Deliberately leave Store.data as null/not-ready — the pre-fix code crashed here with
    // "Cannot convert undefined or null to object" from Object.assign(null, imported).
    const seed = runJson(dom, `JSON.parse(document.getElementById('seed-data').textContent)`);
    const backupText = JSON.stringify(seed);
    const fileInput = dom.window.document.getElementById('btn-backup-import');
    dom.window.__freshFile = new dom.window.File([backupText], 'seed.json', { type: 'application/json' });
    dom.window.__freshFile.text = () => Promise.resolve(backupText);
    Object.defineProperty(fileInput, 'files', { value: [dom.window.__freshFile], configurable: true });
    fireEvent(dom, fileInput, 'change');
    await new Promise(r => setTimeout(r, 20));
    assert.strictEqual(run(dom, 'Store.ready'), true, 'importing a backup with no prior connected file succeeds instead of throwing');
    assert.ok(run(dom, 'Store.data.transactions.length') > 50, 'the imported data is now the active document');
    pass('backup import works with no file connected yet (previously threw)');
  }

  // ── SIP tab's payoff-linked redirect uses the real calendar year, not a guessed offset (#8) ──
  {
    const dom = newDom();
    const seed = runJson(dom, `JSON.parse(document.getElementById('seed-data').textContent)`);
    // Loan starts Sep 2026; a 12-month tenure with no extras pays off at loan month 12,
    // which is cycle 2027-08 (Aug 2027) — year 2027. A startYear=2027-anchored offset guess
    // (the pre-fix bug) would have placed the redirect in 2028 instead.
    seed.settings.homeLoan = { principalINR: 10000, annualRatePct: 0, emiINR: 834, tenureMonths: 12, startCycle: '2026-09' };
    setSeed(dom, seed);
    run(dom, `Tabs.sip.render()`);
    const title = run(dom, `UI._chartInstances.get(document.getElementById('chart-sip-growth')).config.options.plugins.title.text`);
    assert.ok(title.includes('month 12'), 'SIP chart title names the correct payoff month');
    const sipRows = runJson(dom, `Calc.buildSipProjection({
      startingMonthlyINR: ${seed.settings.sip.startingMonthlyINR}, annualStepUpPct: ${seed.settings.sip.annualStepUpPct},
      estimatedReturnPct: ${seed.settings.sip.estimatedReturnPct}, startYear: 2027, endYear: 2029,
      payoffYear: Calc.loanMonthToYear(12, '2026-09'), postLoanMonthlyRedirectINR: 834
    })`);
    assert.strictEqual(sipRows[0].postLoanRedirect, 834, 'the redirect is already active in 2027 (the correct calendar year), not deferred to 2028');
    pass("SIP tab's payoff-linked redirect uses the real calendar year (Important #8)");
  }

  console.log(`\ntests/app.test.js: ${passCount} checks — ALL PASS`);
}

main().catch(e => { console.error(e); process.exit(1); });
