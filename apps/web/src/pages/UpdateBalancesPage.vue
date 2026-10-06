<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { useDisplay } from 'vuetify'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { BalancesResponse, NetWorthResponse, type BalanceRow } from '@nri/contracts'
import { jpyFromInrPaise, nextCycle, previousCycle } from '@nri/core'
import PageHeader from '../components/PageHeader.vue'
import { apiFetch, ApiRequestError } from '../lib/api'
import { changedEntries, type FieldState, isDirty, netWorthAfterSaving, parseAmount, toText } from '../lib/balancesForm'
import { flash } from '../lib/flash'
import { cycleLabel, dateRangeLabel, MONTHS, monthYearLabel, yen } from '../lib/format'
import { useProfile } from '../lib/profile'

const route = useRoute()
const router = useRouter()
const { xs } = useDisplay()
const qc = useQueryClient()
const me = useProfile()
const startDay = computed(() => me.data.value?.profile?.cycleStartDay ?? 25)

const cycleParam = computed(() => (typeof route.query.cycle === 'string' ? route.query.cycle : ''))
const balQ = useQuery({
  queryKey: ['balances', cycleParam],
  queryFn: () => apiFetch(`/api/balances${cycleParam.value ? `?cycle=${cycleParam.value}` : ''}`, {}, BalancesResponse),
  retry: (n, e) => !(e instanceof ApiRequestError && e.status === 409) && n < 2,
})
const b = computed(() => balQ.data.value)
const needsProfile = computed(() => balQ.error.value instanceof ApiRequestError && balQ.error.value.status === 409)

// Keyed off the GET's own resolved `cycle` (same reasoning as Dashboard's "recent expenses" query),
// not the raw route query — an empty `?cycle=` resolves to the current cycle server-side, and this
// must follow that resolution rather than request its own default.
const nwCycle = computed(() => b.value?.cycle ?? '')
const nwQ = useQuery({
  queryKey: ['networth', nwCycle],
  queryFn: () => apiFetch(`/api/networth?cycle=${nwCycle.value}`, {}, NetWorthResponse),
  enabled: () => !!b.value,
})

// One field per row, rebuilt whenever a *different* cycle's data arrives (keyed on the cycle
// string, not the row objects themselves, so a background refetch of the same cycle — e.g. after
// Save invalidates ['balances'] — never stomps on text the user is mid-typing).
const fields = ref<FieldState[]>([])
watch(
  () => b.value?.cycle,
  () => {
    if (!b.value) return
    fields.value = b.value.rows.map((r) => {
      const text = toText(r.amount, r.currency)
      return { accountId: r.accountId, text, initial: text, currency: r.currency }
    })
  },
  { immediate: true },
)
const fieldByAccount = computed(() => new Map(fields.value.map((f) => [f.accountId, f])))
function fieldFor(row: BalanceRow): FieldState {
  return fieldByAccount.value.get(row.accountId)!
}

// Rows arrive pre-sorted Japan-then-India (spec §3), so grouping is just a run-length split, not a re-sort.
const groupedRows = computed(() => {
  const out: { country: 'JP' | 'IN'; label: string; rows: BalanceRow[] }[] = []
  for (const r of b.value?.rows ?? []) {
    const last = out[out.length - 1]
    if (last && last.country === r.country) last.rows.push(r)
    else out.push({ country: r.country, label: r.country === 'JP' ? 'Japan' : 'India', rows: [r] })
  }
  return out
})

const monthOnly = (cycle: string) => MONTHS[Number(cycle.slice(5, 7)) - 1]!
/** "from <Mon>" only while the row is still showing its carried-forward value untouched (spec §4.3) — editing it clears the hint. */
function fromHint(row: BalanceRow): string | null {
  const f = fieldFor(row)
  if (row.source !== 'carried' || !row.fromCycle || f.text !== f.initial) return null
  return `from ${monthOnly(row.fromCycle)}`
}
/** Live "≈ ¥…" for a ₹ row, at the planning rate the GET response itself carries. */
function approxYen(row: BalanceRow): string | null {
  if (row.currency !== 'INR' || !b.value) return null
  const parsed = parseAmount(fieldFor(row).text, 'INR')
  if (typeof parsed !== 'number') return null
  return `≈ ${yen(jpyFromInrPaise(parsed, b.value.rate))}`
}

const serverFieldErrors = ref<Record<string, string>>({})
function fieldErrorFor(row: BalanceRow): string | undefined {
  const f = fieldFor(row)
  const parsed = parseAmount(f.text, f.currency)
  if (parsed === 'invalid') return row.currency === 'JPY' ? 'Enter a whole yen amount' : 'Enter an amount with up to 2 decimals'
  return serverFieldErrors.value[row.accountId]
}

const hasInvalid = computed(() => fields.value.some((f) => parseAmount(f.text, f.currency) === 'invalid'))
const entriesToSave = computed(() => (b.value ? changedEntries(fields.value, b.value.rows) : []))
const dirty = computed(() => isDirty(fields.value))

const netWorthAfter = computed(() => {
  if (!b.value || !nwQ.data.value) return null
  return netWorthAfterSaving(fields.value, b.value.rows, nwQ.data.value.current.combinedJpy, nwQ.data.value.rate)
})
const sinceLastCycle = computed(() => {
  const cur = nwQ.data.value?.current
  if (!cur || cur.changeJpy === null || netWorthAfter.value === null) return null
  return netWorthAfter.value - (cur.combinedJpy - cur.changeJpy)
})

function go(c: string) {
  void router.replace({ query: { ...route.query, cycle: c } })
}
function copyLastCycle() {
  fields.value = fields.value.map((f) => ({ ...f, text: f.initial }))
}

// The exact array last sent to PUT, kept only to map a 400's `details[].path` — `['entries', i,
// 'amount' | 'accountId']` — back onto the field at that same index (balances.ts's own validation
// shape; AccountDialog.vue's `applyApiError` does the equivalent for a flat `path: [field]`).
let lastSent: { accountId: string; amount: number }[] = []
const formError = ref('')
function applyApiError(e: unknown) {
  serverFieldErrors.value = {}
  formError.value = ''
  if (!(e instanceof ApiRequestError)) { formError.value = 'Something went wrong'; return }
  const details = e.details
  if (Array.isArray(details) && details.length) {
    const next: Record<string, string> = {}
    for (const issue of details as { path?: unknown[]; message?: string }[]) {
      const p = issue.path
      if (Array.isArray(p) && p[0] === 'entries' && typeof p[1] === 'number') {
        const entry = lastSent[p[1]]
        if (entry) next[entry.accountId] = issue.message ?? e.message
      }
    }
    if (Object.keys(next).length) { serverFieldErrors.value = next; return }
  }
  formError.value = e.message
}

const saveMut = useMutation({
  mutationFn: (entries: { accountId: string; amount: number }[]) =>
    apiFetch('/api/balances', { method: 'PUT', body: JSON.stringify({ cycle: b.value!.cycle, entries }) }, BalancesResponse),
  onSuccess: async () => {
    // Mark every field clean before navigating away — it really was just saved — so the unsaved-
    // changes guard below doesn't fire on this page's own redirect to Accounts.
    fields.value = fields.value.map((f) => ({ ...f, initial: f.text }))
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['balances'] }),
      qc.invalidateQueries({ queryKey: ['networth'] }),
      qc.invalidateQueries({ queryKey: ['accounts'] }),
    ])
    flash.message.value = `Balances saved for ${monthYearLabel(b.value!.cycle)}`
    await router.push('/accounts')
  },
  onError: applyApiError,
})
const canSave = computed(() => !hasInvalid.value && entriesToSave.value.length > 0 && !saveMut.isPending.value)
function save() {
  if (!b.value || !canSave.value) return
  serverFieldErrors.value = {}
  formError.value = ''
  lastSent = entriesToSave.value
  saveMut.mutate(lastSent)
}

// Leaving with unsaved changes (spec §4.3): a Vuetify dialog, not window.confirm — the guard
// itself just returns a Promise<boolean> that resolves once the dialog's own buttons answer it.
const leaveConfirmOpen = ref(false)
let resolveLeave: ((ok: boolean) => void) | null = null
onBeforeRouteLeave(() => {
  if (!dirty.value) return true
  return new Promise<boolean>((resolve) => {
    resolveLeave = resolve
    leaveConfirmOpen.value = true
  })
})
function keepEditing() {
  leaveConfirmOpen.value = false
  resolveLeave?.(false)
  resolveLeave = null
}
function discardChanges() {
  leaveConfirmOpen.value = false
  resolveLeave?.(true)
  resolveLeave = null
}

function onBeforeUnload(e: BeforeUnloadEvent) {
  if (dirty.value) e.preventDefault()
}
onMounted(() => window.addEventListener('beforeunload', onBeforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', onBeforeUnload))
</script>

<template>
  <v-alert v-if="needsProfile" type="info" variant="tonal">
    Set up your profile first in <router-link to="/settings">Settings</router-link>.
  </v-alert>
  <v-alert v-else-if="balQ.error.value" type="error" variant="tonal">{{ balQ.error.value.message }}</v-alert>
  <template v-else-if="b">
    <PageHeader title="Update balances">
      <div class="cycle-pill">
        <v-btn icon="mdi-chevron-left" variant="text" size="small" aria-label="Previous cycle" @click="go(previousCycle(b.cycle))" />
        <span data-testid="cycle-label">{{ cycleLabel(b.cycle, startDay) }}</span>
        <v-btn icon="mdi-chevron-right" variant="text" size="small" aria-label="Next cycle" @click="go(nextCycle(b.cycle))" />
      </div>
    </PageHeader>
    <p class="subtitle">Review day · cycle {{ monthYearLabel(b.cycle) }} ({{ dateRangeLabel(b.start, b.end) }})</p>

    <v-card class="bal-card">
      <div class="hint-row">
        Prefilled with last cycle's balances. Change only what moved; ₹ accounts show the ¥ value at the planning rate.
      </div>
      <template v-for="g in groupedRows" :key="g.country">
        <div class="grp">{{ g.label }}</div>
        <div v-for="row in g.rows" :key="row.accountId" class="brow" :class="{ compact: xs }">
          <div class="nm-wrap">
            <div class="nm-text">{{ row.name }}</div>
            <div class="sub-row">
              <span v-if="row.type === 'card'" class="sub">owed</span>
              <span v-if="fromHint(row)" class="sub">{{ fromHint(row) }}</span>
            </div>
          </div>
          <div class="amt-wrap">
            <v-text-field
              :id="`bal-${row.accountId}`"
              v-model="fieldFor(row).text"
              :label="`Balance for ${row.name}`"
              inputmode="decimal"
              :prefix="row.currency === 'JPY' ? '¥' : '₹'"
              :error-messages="fieldErrorFor(row)"
              density="comfortable"
              hide-details="auto"
            />
            <div v-if="approxYen(row)" class="sub approx">{{ approxYen(row) }}</div>
          </div>
        </div>
      </template>
      <div class="rows-end-spacer" aria-hidden="true" />
    </v-card>

    <v-alert v-if="formError" type="error" variant="tonal" class="mt-3">{{ formError }}</v-alert>

    <div class="bal-footer">
      <div class="totals">
        <span class="sub">Net worth after saving</span>
        <b class="num">{{ netWorthAfter !== null ? yen(netWorthAfter) : '—' }}</b>
        <span
          v-if="sinceLastCycle !== null"
          class="num font-weight-medium"
          :class="sinceLastCycle >= 0 ? 'text-success' : 'text-error'"
        >{{ sinceLastCycle >= 0 ? '↑' : '↓' }} {{ yen(Math.abs(sinceLastCycle)) }} since last cycle</span>
      </div>
      <div class="actions">
        <v-btn variant="outlined" @click="copyLastCycle">Copy last cycle</v-btn>
        <v-btn color="primary" :loading="saveMut.isPending.value" :disabled="!canSave" @click="save">Save balances</v-btn>
      </div>
    </div>

    <v-dialog v-model="leaveConfirmOpen" max-width="420" persistent>
      <v-card>
        <v-card-title>Discard unsaved changes?</v-card-title>
        <v-card-text>Balances you typed on this screen haven't been saved yet.</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="outlined" @click="keepEditing">Keep editing</v-btn>
          <v-btn color="error" @click="discardChanges">Discard changes</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </template>
  <v-progress-linear v-else indeterminate />
</template>

<style scoped>
.cycle-pill {
  display: inline-flex;
  align-items: center;
  border: 1px solid rgb(var(--v-border-color));
  background: rgb(var(--v-theme-surface));
  border-radius: 10px;
  overflow: hidden;
}
.cycle-pill span {
  padding: 0 4px;
  font-weight: 600;
  min-width: 150px;
  text-align: center;
  font-size: 14px;
}
.subtitle {
  color: rgb(var(--v-theme-on-surface-variant));
  margin: -10px 0 16px;
  font-size: 14px;
}

.hint-row {
  padding: 14px 22px;
  color: rgb(var(--v-theme-on-surface-variant));
  border-bottom: 1px solid rgb(var(--v-border-color));
  font-size: 13.5px;
}
.grp {
  padding: 14px 22px 4px;
  font-weight: 700;
}
.brow {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 260px;
  gap: 16px;
  align-items: center;
  padding: 10px 22px;
  border-top: 1px solid rgb(var(--v-border-color));
  min-width: 0;
}
.brow.compact {
  grid-template-columns: minmax(0, 1fr);
  row-gap: 6px;
}
.nm-wrap {
  min-width: 0;
}
.nm-text {
  font-weight: 600;
  font-size: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sub-row {
  display: flex;
  gap: 8px;
  min-width: 0;
}
.sub {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 12.5px;
}
.amt-wrap {
  min-width: 0;
}
.approx {
  text-align: right;
  margin-top: 2px;
}
/* Enough clearance that, scrolled all the way down, the last field is never tucked right up
   against (or behind) the sticky footer below it — see the 390px "scrolled to bottom" screenshot. */
.rows-end-spacer {
  height: 96px;
}

.bal-footer {
  position: sticky;
  bottom: 0;
  z-index: 2;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 16px;
  padding: 16px 22px;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgb(var(--v-border-color));
  border-radius: 12px;
  box-shadow: 0 -6px 16px rgba(0, 0, 0, 0.08);
}
.bal-footer .totals {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
}
.bal-footer .actions {
  display: flex;
  gap: 8px;
  flex: none;
}
/* The phone bottom nav (App.vue's `.bottom-nav`, a fixed v-bottom-navigation) isn't itself part of
   this page's scroll container, so a plain `bottom: 0` would stick the footer underneath it —
   offset by its height (Vuetify's default 56px) only below the `xs` breakpoint (spec §5) where
   that nav exists at all. */
@media (max-width: 599px) {
  .bal-footer {
    bottom: 56px;
  }
}
</style>
