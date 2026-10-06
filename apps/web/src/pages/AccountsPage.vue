<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDisplay } from 'vuetify'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  Account, AccountList, type AccountType, MeResponse, NetWorthResponse, type NetWorthSpan, type ProfileInput,
} from '@nri/contracts'
import { jpyFromInrPaise } from '@nri/core'
import AccountDialog from '../components/AccountDialog.vue'
import NetWorthChart from '../components/NetWorthChart.vue'
import PageHeader from '../components/PageHeader.vue'
import { apiFetch, ApiRequestError } from '../lib/api'
import { groupByType, inOtherCurrency, loadShowIn, saveShowIn, type ShowIn } from '../lib/accounts'
import { monthYearLabel, rupees, yen } from '../lib/format'
import { useProfile } from '../lib/profile'

const { xs } = useDisplay()
const qc = useQueryClient()
const me = useProfile()

const TYPE_ICON: Record<AccountType, string> = {
  bank: 'mdi-bank-outline', cash: 'mdi-cash', fd: 'mdi-finance', investment: 'mdi-chart-line', card: 'mdi-credit-card-outline',
}
const SPAN_OPTIONS: { value: NetWorthSpan; label: string }[] = [
  { value: '6', label: '6 cycles' }, { value: '12', label: '12 cycles' }, { value: 'all', label: 'All' },
]
const ASSET_COLORS = ['rgb(var(--v-theme-primary-accent))', 'rgb(var(--v-theme-secondary))']
const LIAB_COLOR = 'rgb(var(--v-theme-error-accent))'

const showIn = ref<ShowIn>(loadShowIn())
function setShowIn(v: ShowIn) {
  showIn.value = v
  saveShowIn(v)
}
const span = ref<NetWorthSpan>('12')
const summaryMode = ref<'totals' | 'percent'>('totals')

const accountsQ = useQuery({
  queryKey: ['accounts', 'all'],
  queryFn: () => apiFetch('/api/accounts?include=archived', {}, AccountList),
})
const networthQ = useQuery({
  queryKey: ['networth', span],
  queryFn: () => apiFetch(`/api/networth?span=${span.value}`, {}, NetWorthResponse),
  retry: (n, e) => !(e instanceof ApiRequestError && e.status === 409) && n < 2,
})
const needsProfile = computed(() => networthQ.error.value instanceof ApiRequestError && networthQ.error.value.status === 409)

const nw = computed(() => networthQ.data.value ?? null)
const rate = computed(() => nw.value?.rate ?? '1')
const items = computed(() => accountsQ.data.value?.items ?? [])
const active = computed(() => items.value.filter((a) => !a.archived))
const archived = computed(() => items.value.filter((a) => a.archived))

type Row = Account & { amount: number | null; source: 'this' | 'carried' | 'none'; fromCycle: string | null; changeAmount: number | null }
const nwByAccount = computed(() => new Map((nw.value?.accounts ?? []).map((r) => [r.accountId, r])))
const rows = computed<Row[]>(() => active.value.map((a) => {
  const r = nwByAccount.value.get(a.id)
  return { ...a, amount: r?.amount ?? null, source: r?.source ?? 'none', fromCycle: r?.fromCycle ?? null, changeAmount: r?.changeAmount ?? null }
}))
const groups = computed(() => groupByType(rows.value))

// The big "No accounts yet." empty state is for *no accounts at all* — an all-archived user
// (e.g. just archived their only account) still has the Archived section to unarchive from, so
// that must stay reachable rather than being hidden behind this card too.
const hasAnyAccounts = computed(() => items.value.length > 0)
const hasAnyBalances = computed(() => rows.value.some((r) => r.amount !== null))

function ownAmount(amount: number, currency: 'JPY' | 'INR'): string {
  return currency === 'JPY' ? yen(amount) : rupees(amount)
}
function otherAmount(amount: number, currency: 'JPY' | 'INR'): string {
  const other = inOtherCurrency(amount, currency, rate.value)
  return currency === 'JPY' ? `≈ ${rupees(other)}` : `≈ ${yen(other)}`
}
function groupTotalLabel(g: { rows: Row[] }): string {
  const vals = g.rows.filter((r) => r.amount !== null).map((r) => (r.currency === showIn.value ? r.amount! : inOtherCurrency(r.amount!, r.currency, rate.value)))
  if (!vals.length) return '—'
  const total = vals.reduce((a, b) => a + b, 0)
  return showIn.value === 'JPY' ? yen(total) : rupees(total)
}

// Net worth card — the headline total, its series and both are re-expressed at the planning rate
// when `showIn` is '₹' (spec §4.1's "In ¥ / In ₹" toggle); `combinedJpy` is always the JPY baseline.
function formatValue(n: number): string {
  return showIn.value === 'JPY' ? yen(n) : rupees(n)
}
const totalLabel = computed(() => (nw.value ? formatValue(showIn.value === 'JPY' ? nw.value.current.combinedJpy : inOtherCurrency(nw.value.current.combinedJpy, 'JPY', rate.value)) : '—'))
const changeLabelNw = computed(() => {
  if (!nw.value) return null
  const { changeJpy, changePct } = nw.value.current
  if (changeJpy === null || changePct === null) return null
  const amt = showIn.value === 'JPY' ? Math.abs(changeJpy) : inOtherCurrency(Math.abs(changeJpy), 'JPY', rate.value)
  return { up: changeJpy >= 0, text: `${changeJpy >= 0 ? '↑' : '↓'} ${formatValue(amt)} (${Math.abs(changePct).toFixed(1)}%)` }
})
const chartLabels = computed(() => (nw.value?.series ?? []).map((s) => monthYearLabel(s.cycle)))
const chartValues = computed(() => (nw.value?.series ?? []).map((s) => (showIn.value === 'JPY' ? s.combinedJpy : inOtherCurrency(s.combinedJpy, 'JPY', rate.value))))

// Summary — Assets (Japan, India) and Liabilities (Cards), per spec §4.1; always derived from the
// API's own JPY/paise aggregates (not from the account rows), then re-expressed via `showIn`.
const assetsRowsJpy = computed(() => (nw.value ? [
  { name: 'Japan', jpy: nw.value.assets.japanJpy },
  { name: 'India', jpy: jpyFromInrPaise(nw.value.assets.indiaPaise, rate.value) },
] : []))
const liabRowsJpy = computed(() => (nw.value ? [{ name: 'Cards', jpy: nw.value.liabilities.japanJpy + jpyFromInrPaise(nw.value.liabilities.indiaPaise, rate.value) }] : []))
const assetsTotalJpy = computed(() => assetsRowsJpy.value.reduce((a, r) => a + r.jpy, 0))
const liabTotalJpy = computed(() => liabRowsJpy.value.reduce((a, r) => a + r.jpy, 0))
function amountInShowIn(jpy: number): string {
  return showIn.value === 'JPY' ? yen(jpy) : rupees(inOtherCurrency(jpy, 'JPY', rate.value))
}
function pctOf(jpy: number, totalJpy: number): string {
  return totalJpy > 0 ? `${Math.round((jpy / totalJpy) * 1000) / 10}%` : '—'
}
function pctWidth(jpy: number, totalJpy: number): string {
  return totalJpy > 0 ? `${(jpy / totalJpy) * 100}%` : '0%'
}

const efGoalJpy = computed(() => nw.value?.emergencyFund.goalJpy ?? null)
const efBalanceLabel = computed(() => (nw.value ? amountInShowIn(nw.value.emergencyFund.balanceJpy) : '—'))
const efPct = computed(() => {
  if (!nw.value || efGoalJpy.value === null || efGoalJpy.value <= 0) return null
  return Math.min(100, Math.round((nw.value.emergencyFund.balanceJpy / efGoalJpy.value) * 100))
})

const refreshAccounts = () => Promise.all([qc.invalidateQueries({ queryKey: ['accounts'] }), qc.invalidateQueries({ queryKey: ['networth'] })])
const archiveError = ref('')
const toggleArchive = useMutation({
  mutationFn: ({ id, archived: a }: { id: string; archived: boolean }) => apiFetch(`/api/accounts/${id}`, { method: 'PATCH', body: JSON.stringify({ archived: a }) }, Account),
  onSuccess: async () => { archiveError.value = ''; await refreshAccounts() },
  onError: (e) => { archiveError.value = e instanceof ApiRequestError ? e.message : 'Something went wrong' },
})
function archive(row: Row) { toggleArchive.mutate({ id: row.id, archived: true }) }
function unarchive(a: Account) { toggleArchive.mutate({ id: a.id, archived: false }) }
const showArchived = ref(false)

const dialogOpen = ref(false)
const editingAccount = ref<Account | null>(null)
function openAdd() { editingAccount.value = null; dialogOpen.value = true }
function openEdit(row: Row) { editingAccount.value = row; dialogOpen.value = true }

const efDialogOpen = ref(false)
const efGoalInput = ref('')
function openEfDialog() {
  efGoalInput.value = efGoalJpy.value !== null ? String(efGoalJpy.value) : ''
  efDialogOpen.value = true
}
const saveEfGoal = useMutation({
  mutationFn: (goal: number | null) => {
    const p = me.data.value!.profile!
    const body: ProfileInput = {
      salaryJpy: p.salaryJpy, planningRateJpyPerInr: p.planningRateJpyPerInr, cycleStartDay: p.cycleStartDay,
      timezone: p.timezone, emergencyFundGoalJpy: goal,
    }
    return apiFetch('/api/me', { method: 'PUT', body: JSON.stringify(body) }, MeResponse)
  },
  onSuccess: async (data) => {
    qc.setQueryData(['me'], data)
    await qc.invalidateQueries({ queryKey: ['networth'] })
    efDialogOpen.value = false
  },
})
function submitEfGoal() {
  const trimmed = efGoalInput.value.trim()
  const goal = trimmed === '' ? null : Number(trimmed)
  if (goal !== null && (!Number.isFinite(goal) || goal < 0)) return
  saveEfGoal.mutate(goal)
}
</script>

<template>
  <v-alert v-if="needsProfile" type="info" variant="tonal">
    Set up your profile first in <router-link to="/settings">Settings</router-link>.
  </v-alert>
  <v-alert v-else-if="networthQ.error.value" type="error" variant="tonal">{{ networthQ.error.value.message }}</v-alert>
  <template v-else-if="nw && accountsQ.data.value">
    <PageHeader title="Accounts">
      <div class="seg" role="group" aria-label="Show amounts in">
        <v-btn :ripple="false" :class="{ on: showIn === 'JPY' }" :aria-pressed="showIn === 'JPY'" variant="text" @click="setShowIn('JPY')">In ¥</v-btn>
        <v-btn :ripple="false" :class="{ on: showIn === 'INR' }" :aria-pressed="showIn === 'INR'" variant="text" @click="setShowIn('INR')">In ₹</v-btn>
      </div>
      <v-btn to="/accounts/balances" variant="outlined" prepend-icon="mdi-swap-horizontal">Update balances</v-btn>
      <v-btn v-if="!xs" color="primary" prepend-icon="mdi-plus" @click="openAdd">Add account</v-btn>
    </PageHeader>

    <template v-if="!hasAnyAccounts">
      <v-card class="empty-card">
        <p class="mb-3">No accounts yet.</p>
        <v-btn color="primary" prepend-icon="mdi-plus" @click="openAdd">Add account</v-btn>
      </v-card>
    </template>
    <template v-else>
      <v-card>
        <div class="hd" style="align-items: flex-start">
          <div>
            <div class="eyebrow">Net worth · Japan + India at ¥{{ nw.rate }} per ₹1</div>
            <div class="nw">
              <b class="num" data-testid="net-worth-total">{{ totalLabel }}</b>
              <template v-if="changeLabelNw">
                <span :class="changeLabelNw.up ? 'text-success' : 'text-error'" class="font-weight-medium num">{{ changeLabelNw.text }}</span>
                <span class="muted">since last cycle</span>
              </template>
              <span v-else class="muted">first cycle</span>
            </div>
          </div>
          <div class="seg" role="group" aria-label="Period" style="margin-top: 4px">
            <v-btn
              v-for="opt in SPAN_OPTIONS" :key="opt.value" :ripple="false" :class="{ on: span === opt.value }"
              :aria-pressed="span === opt.value" variant="text" @click="span = opt.value"
            >{{ opt.label }}</v-btn>
          </div>
        </div>
        <NetWorthChart v-if="hasAnyBalances" :labels="chartLabels" :values="chartValues" :format-value="formatValue" />
        <p v-else class="pa-5 mb-0 text-medium-emphasis">Update balances to start your net worth.</p>
      </v-card>

      <div class="grid2">
        <div class="groups-col">
          <v-card v-for="g in groups" :key="g.type">
            <div class="grp-hd">
              <h3>{{ g.label }}</h3>
              <span class="tot num">{{ g.type === 'card' ? '−' : '' }}{{ groupTotalLabel(g) }}</span>
            </div>
            <div v-for="row in g.rows" :key="row.id" class="acct" :class="{ compact: xs }">
              <span class="av" aria-hidden="true"><v-icon size="18">{{ TYPE_ICON[row.type] }}</v-icon></span>
              <div class="nm-wrap">
                <div class="nm">
                  <span class="nm-text">{{ row.name }}</span>
                  <span class="tag ctag">{{ row.country }}</span>
                  <span v-if="row.isEmergencyFund" class="tag eftag">Emergency fund</span>
                </div>
                <div class="sub">{{ row.country === 'JP' ? 'Japan' : 'India' }} · {{ row.currency }}</div>
              </div>
              <div v-if="!xs" class="chg">
                <span v-if="row.source === 'none'" class="muted">No balance yet</span>
                <span v-else-if="row.source === 'carried'" class="muted">updated {{ monthYearLabel(row.fromCycle!) }}</span>
                <span v-else-if="row.changeAmount !== null" class="num" :class="row.changeAmount! >= 0 ? 'text-success' : 'text-error'">
                  {{ row.changeAmount! >= 0 ? '↑' : '↓' }} {{ ownAmount(Math.abs(row.changeAmount!), row.currency) }}
                </span>
              </div>
              <div class="val num">
                <template v-if="row.amount !== null">
                  {{ ownAmount(row.amount, row.currency) }}<span v-if="row.type === 'card'" class="muted"> owed</span>
                  <small>{{ otherAmount(row.amount, row.currency) }}</small>
                </template>
                <template v-else>—</template>
              </div>
              <v-menu>
                <template #activator="{ props: menuProps }">
                  <v-btn v-bind="menuProps" icon="mdi-dots-vertical" variant="text" size="small" :aria-label="`More actions for ${row.name}`" />
                </template>
                <v-list density="compact">
                  <v-list-item prepend-icon="mdi-pencil-outline" title="Edit" @click="openEdit(row)" />
                  <v-list-item prepend-icon="mdi-archive-outline" title="Archive" @click="archive(row)" />
                </v-list>
              </v-menu>
            </div>
          </v-card>

          <v-alert v-if="archiveError" type="error" variant="tonal" closable @click:close="archiveError = ''">{{ archiveError }}</v-alert>

          <v-card v-if="archived.length">
            <button type="button" class="grp-hd archived-toggle" :aria-expanded="showArchived" @click="showArchived = !showArchived">
              <span class="chev2" :class="{ open: showArchived }" aria-hidden="true">›</span>
              <h3>Archived ({{ archived.length }})</h3>
            </button>
            <div v-if="showArchived">
              <div v-for="a in archived" :key="a.id" class="archived-row">
                <span class="nm">{{ a.name }}</span>
                <span class="sub muted">{{ a.country }} · {{ a.currency }}</span>
                <v-btn size="small" variant="outlined" @click="unarchive(a)">Unarchive</v-btn>
              </div>
            </div>
          </v-card>

          <v-btn v-if="xs" color="primary" block prepend-icon="mdi-plus" @click="openAdd">Add account</v-btn>
        </div>

        <v-card class="summary" style="align-self: start">
          <div class="tx-hd">
            <h2>Summary</h2>
            <div class="right">
              <div class="seg" role="group" aria-label="Summary display" style="margin: 0">
                <v-btn :ripple="false" :class="{ on: summaryMode === 'totals' }" :aria-pressed="summaryMode === 'totals'" variant="text" size="small" @click="summaryMode = 'totals'">Totals</v-btn>
                <v-btn :ripple="false" :class="{ on: summaryMode === 'percent' }" :aria-pressed="summaryMode === 'percent'" variant="text" size="small" @click="summaryMode = 'percent'">Percent</v-btn>
              </div>
            </div>
          </div>
          <div class="sumblk">
            <div class="h">Assets<b class="num">{{ amountInShowIn(assetsTotalJpy) }}</b></div>
            <div class="stack"><i v-for="(r, i) in assetsRowsJpy" :key="r.name" :style="{ width: pctWidth(r.jpy, assetsTotalJpy), background: ASSET_COLORS[i] }" /></div>
            <div v-for="(r, i) in assetsRowsJpy" :key="r.name" class="kv2">
              <span class="dot" :style="{ background: ASSET_COLORS[i] }" />{{ r.name }}<b class="num">{{ summaryMode === 'totals' ? amountInShowIn(r.jpy) : pctOf(r.jpy, assetsTotalJpy) }}</b>
            </div>
          </div>
          <div class="sumblk">
            <div class="h">Liabilities<b class="num">{{ amountInShowIn(liabTotalJpy) }}</b></div>
            <div class="stack"><i :style="{ width: '100%', background: LIAB_COLOR }" /></div>
            <div v-for="r in liabRowsJpy" :key="r.name" class="kv2">
              <span class="dot" :style="{ background: LIAB_COLOR }" />{{ r.name }}<b class="num">{{ summaryMode === 'totals' ? amountInShowIn(r.jpy) : pctOf(r.jpy, liabTotalJpy) }}</b>
            </div>
          </div>
          <div class="ef">
            <div class="eyebrow">Emergency fund</div>
            <div class="efv">
              <b class="num" data-testid="ef-balance">{{ efBalanceLabel }}</b>
              <span v-if="efGoalJpy !== null">of {{ amountInShowIn(efGoalJpy) }} goal</span>
            </div>
            <div v-if="efGoalJpy !== null" class="bar-mini" style="height: 8px"><i :style="{ width: `${efPct ?? 0}%`, background: 'rgb(var(--v-theme-success-accent))' }" /></div>
            <div v-if="nw.emergencyFund.monthsCovered !== null" class="efm">
              Covers <b class="num">{{ nw.emergencyFund.monthsCovered!.toFixed(1) }} months</b> of spending (3-cycle average {{ yen(nw.emergencyFund.avgSpendJpy ?? 0) }})
            </div>
            <div class="ef-actions">
              <v-btn variant="text" size="small" prepend-icon="mdi-pencil-outline" @click="openEfDialog">
                {{ efGoalJpy === null ? 'Set a goal' : 'Edit emergency-fund goal' }}
              </v-btn>
            </div>
          </div>
        </v-card>
      </div>
    </template>

    <AccountDialog v-model="dialogOpen" :account="editingAccount" />

    <v-dialog v-model="efDialogOpen" max-width="360">
      <v-card>
        <div class="tx-hd"><h2>{{ efGoalJpy === null ? 'Set a goal' : 'Edit emergency-fund goal' }}</h2></div>
        <v-form class="px-5" @submit.prevent="submitEfGoal">
          <v-text-field id="ef-goal" v-model="efGoalInput" label="Emergency-fund goal (¥)" type="number" />
        </v-form>
        <v-alert v-if="saveEfGoal.error.value" type="error" variant="tonal" class="mx-5 mb-3">{{ saveEfGoal.error.value.message }}</v-alert>
        <v-card-actions class="px-5 pb-5">
          <v-spacer />
          <v-btn variant="outlined" @click="efDialogOpen = false">Cancel</v-btn>
          <v-btn color="primary" :loading="saveEfGoal.isPending.value" @click="submitEfGoal">Save</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </template>
  <v-progress-linear v-else indeterminate />
</template>

<style scoped>
.seg {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border: 1px solid rgb(var(--v-border-color));
  border-radius: 10px;
}
.seg .v-btn {
  min-width: 0;
}
.seg :deep(.v-btn.on.v-theme--light) {
  background: rgb(var(--v-theme-primary-darken-1));
  color: #fff;
}
.seg :deep(.v-btn.on.v-theme--dark) {
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
}

.empty-card {
  padding: 32px 22px;
  text-align: center;
}

.hd {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px 22px 6px;
  flex-wrap: wrap;
}
.nw {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 4px;
}
.nw b {
  font-size: 26px;
  letter-spacing: -0.3px;
}
.muted {
  color: rgb(var(--v-theme-on-surface-variant));
}

.grid2 {
  display: grid;
  grid-template-columns: 1fr 340px;
  gap: 16px;
  margin-top: 16px;
}
@media (max-width: 1100px) {
  .grid2 {
    grid-template-columns: minmax(0, 1fr);
  }
}
.groups-col {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}

.grp-hd {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 20px;
  width: 100%;
  background: none;
  border: 0;
  text-align: left;
}
.grp-hd h3 {
  margin: 0;
  font-size: 16px;
}
.grp-hd .tot {
  margin-left: auto;
  font-weight: 700;
  font-size: 16px;
}
.archived-toggle {
  cursor: pointer;
}
.chev2 {
  color: rgb(var(--v-theme-on-surface-variant));
  transition: transform 0.15s;
  display: inline-block;
}
.chev2.open {
  transform: rotate(90deg);
}

.acct {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) 130px minmax(0, 150px) 40px;
  gap: 12px;
  align-items: center;
  padding: 12px 20px;
  border-top: 1px solid rgb(var(--v-border-color));
  min-width: 0;
  overflow: hidden;
}
.acct.compact {
  grid-template-columns: 32px minmax(0, 1fr) minmax(0, 120px) 40px;
}
.av {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: rgb(var(--v-theme-surface-variant));
  color: rgb(var(--v-theme-on-surface-variant));
  flex: none;
}
.nm-wrap {
  min-width: 0;
  overflow: hidden;
}
.nm {
  display: flex;
  align-items: center;
  font-weight: 600;
  font-size: 15px;
  min-width: 0;
}
/* The name itself truncates with an ellipsis when the row is tight; the tags after it (country,
   "Emergency fund") never do — they're `flex: none`, so they stay fully readable instead of being
   swallowed into the ellipsis along with the name (fix round 1, caught in the 1280px screenshot). */
.nm-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.sub {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 12.5px;
}
.tag {
  flex: none;
  font-size: 11px;
  font-weight: 600;
  border-radius: 999px;
  padding: 1px 7px;
  margin-left: 6px;
  white-space: nowrap;
}
.tag.ctag {
  background: rgb(var(--v-theme-surface-variant));
  color: rgb(var(--v-theme-on-surface-variant));
}
.tag.eftag {
  background: rgba(var(--v-theme-success-accent), 0.16);
  color: rgb(var(--v-theme-success));
}
.chg {
  text-align: right;
  font-size: 13px;
}
.val {
  text-align: right;
  font-weight: 600;
  font-size: 15px;
}
.val small {
  display: block;
  color: rgb(var(--v-theme-on-surface-variant));
  font-weight: 500;
  font-size: 12px;
}

.archived-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 20px;
  border-top: 1px solid rgb(var(--v-border-color));
}
.archived-row .nm {
  flex: 1;
  min-width: 0;
}

.tx-hd {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 20px;
}
.tx-hd h2 {
  font-size: 16px;
  margin: 0;
  font-weight: 700;
}
.tx-hd .right {
  margin-left: auto;
}
.sumblk {
  padding: 14px 22px 16px;
  border-top: 1px solid rgb(var(--v-border-color));
}
.sumblk .h {
  display: flex;
  justify-content: space-between;
  font-weight: 600;
  margin-bottom: 10px;
}
.sumblk .h b {
  color: rgb(var(--v-theme-on-surface-variant));
  font-weight: 500;
}
.stack {
  display: flex;
  height: 10px;
  border-radius: 999px;
  overflow: hidden;
  gap: 2px;
  margin-bottom: 12px;
  background: rgb(var(--v-theme-surface-variant));
}
.stack i {
  display: block;
  height: 100%;
}
.kv2 {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 0;
}
.kv2 b {
  margin-left: auto;
  font-weight: 500;
}
.dot {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  flex: none;
}
.ef {
  padding: 14px 22px 18px;
  border-top: 1px solid rgb(var(--v-border-color));
}
.efv {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 4px 0 8px;
}
.efv b {
  font-size: 18px;
}
.efv span {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 13px;
}
.bar-mini {
  border-radius: 999px;
  background: rgb(var(--v-theme-surface-variant));
  overflow: hidden;
}
.bar-mini i {
  display: block;
  height: 100%;
}
.efm {
  margin-top: 8px;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 13px;
}
.efm b {
  color: rgb(var(--v-theme-on-surface));
}
.ef-actions {
  margin-top: 10px;
}
</style>
