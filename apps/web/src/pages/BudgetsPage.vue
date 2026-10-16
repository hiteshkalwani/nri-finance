<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { Budgets, Dashboard, Targets, type TargetKey } from '@nri/contracts'
import { nextCycle, previousCycle } from '@nri/core'
import PageHeader from '../components/PageHeader.vue'
import { apiFetch, ApiRequestError } from '../lib/api'
import {
  type BudgetField, budgetFieldsFrom, changedBudgetItems, hasInvalidBudget, isDirtyBudgets, stateWord,
} from '../lib/budgetsForm'
import { safeColor } from '../lib/color'
import { cycleLabel, monthYearLabel, rupees, yen } from '../lib/format'
import { flash } from '../lib/flash'
import { useProfile } from '../lib/profile'
import {
  hasInvalidTargetField, isDirtyTargets, TARGET_CURRENCY, TARGET_KEYS, TARGET_LABELS, targetFieldsFrom, targetsPutFrom,
  targetStateText, type TargetFields, useCopyPreviousTargets,
} from '../lib/targetsForm'

const route = useRoute()
const router = useRouter()
const qc = useQueryClient()
const me = useProfile()
const startDay = computed(() => me.data.value?.profile?.cycleStartDay ?? 25)

const cycleParam = computed(() => (typeof route.query.cycle === 'string' ? route.query.cycle : ''))
const budgetsQ = useQuery({
  queryKey: ['budgets', cycleParam],
  queryFn: () => apiFetch(`/api/budgets${cycleParam.value ? `?cycle=${cycleParam.value}` : ''}`, {}, Budgets),
  retry: (n, e) => !(e instanceof ApiRequestError && e.status === 409) && n < 2,
})
const b = computed(() => budgetsQ.data.value)
const needsProfile = computed(() => budgetsQ.error.value instanceof ApiRequestError && budgetsQ.error.value.status === 409)
const cycle = computed(() => b.value?.cycle ?? '')

const targetsQ = useQuery({
  queryKey: ['targets', cycle],
  queryFn: () => apiFetch(`/api/targets/${cycle.value}`, {}, Targets),
  enabled: () => !!b.value,
})
// Only for the "actual vs target" figures (TGT-2) — the dashboard already computes target-vs-actual
// for an arbitrary cycle, so this reuses it instead of duplicating that aggregation client-side.
const dashQ = useQuery({
  queryKey: ['dashboard', cycle],
  queryFn: () => apiFetch(`/api/dashboard?cycle=${cycle.value}`, {}, Dashboard),
  enabled: () => !!b.value,
})
const targetRowFor = (key: TargetKey) => dashQ.data.value?.targets.find((r) => r.key === key)
const fmtFor = (key: TargetKey) => (TARGET_CURRENCY[key] === 'INR' ? rupees : yen)

// shortcut: unlike UpdateBalancesPage, a background refetch mid-edit just rebuilds from scratch
// on a real cycle change only — doesn't merge per-field "is this one actually being edited right
// now" the way balances does; fine until budgets/targets see the same kind of concurrent-edit bug.
const budgetFields = ref<BudgetField[]>([])
let builtBudgetsCycle: string | undefined
watch([() => b.value?.cycle, () => budgetsQ.dataUpdatedAt.value], () => {
  if (!b.value || b.value.cycle === builtBudgetsCycle) return
  builtBudgetsCycle = b.value.cycle
  budgetFields.value = budgetFieldsFrom(b.value.rows)
}, { immediate: true })
const fieldByCategory = computed(() => new Map(budgetFields.value.map((f) => [f.categoryId, f])))
function fieldFor(categoryId: string): BudgetField {
  return fieldByCategory.value.get(categoryId) ?? { categoryId, text: '', initial: '' }
}
function setBudgetText(categoryId: string, value: string) {
  const f = fieldFor(categoryId)
  f.text = value
  if (!fieldByCategory.value.has(categoryId)) budgetFields.value.push(f)
}

const EMPTY_TARGETS: TargetFields = { savings: '', emergencyFund: '', remittance: '', prepayment: '' }
const targetFields = ref<TargetFields>({ ...EMPTY_TARGETS })
const targetFieldsInitial = ref<TargetFields>({ ...EMPTY_TARGETS })
let builtTargetsCycle: string | undefined
watch([() => targetsQ.data.value?.cycle, () => targetsQ.dataUpdatedAt.value], () => {
  const t = targetsQ.data.value
  if (!t || t.cycle === builtTargetsCycle) return
  builtTargetsCycle = t.cycle
  const f = targetFieldsFrom(t)
  // Two distinct objects, not the same `f` twice: Vue's reactive() proxy cache would otherwise
  // hand back the *same* proxy for both refs (same underlying raw object), so editing one field
  // would silently edit its own "initial" too and dirty-checking could never fire.
  targetFields.value = f
  targetFieldsInitial.value = { ...f }
}, { immediate: true })

const copy = useCopyPreviousTargets(() => cycle.value, (t) => {
  const f = targetFieldsFrom(t)
  targetFields.value = f
  targetFieldsInitial.value = { ...f }
})

function barColor(row: { state: 'over' | 'near' | 'under' | null; color: string }): string {
  if (row.state === 'over') return 'rgb(var(--v-theme-error-accent))'
  if (row.state === 'near') return 'rgb(var(--v-theme-warning))'
  return safeColor(row.color)
}

const budgetedRows = computed(() => (b.value?.rows ?? []).filter((r) => r.budgetJpy !== null))
const totalSpent = computed(() => budgetedRows.value.reduce((sum, r) => sum + r.spentJpy, 0))
const totalBudget = computed(() => budgetedRows.value.reduce((sum, r) => sum + (r.budgetJpy ?? 0), 0))
const totalPct = computed(() => (totalBudget.value > 0 ? Math.round((totalSpent.value * 1000) / totalBudget.value) / 10 : null))

function go(c: string) {
  void router.replace({ query: { ...route.query, cycle: c } })
}

const budgetsDirty = computed(() => isDirtyBudgets(budgetFields.value))
const targetsDirty = computed(() => isDirtyTargets(targetFields.value, targetFieldsInitial.value))
const dirty = computed(() => budgetsDirty.value || targetsDirty.value)
const hasInvalid = computed(() => hasInvalidBudget(budgetFields.value) || hasInvalidTargetField(targetFields.value))

const formError = ref('')
const saveMut = useMutation({
  mutationFn: async () => {
    const items = changedBudgetItems(budgetFields.value)
    const tasks: Promise<unknown>[] = []
    if (items.length) tasks.push(apiFetch('/api/budgets', { method: 'PUT', body: JSON.stringify({ cycle: cycle.value, items }) }, Budgets))
    if (targetsDirty.value) {
      const body = targetsPutFrom(targetFields.value)
      if (body) tasks.push(apiFetch(`/api/targets/${cycle.value}`, { method: 'PUT', body: JSON.stringify(body) }, Targets))
    }
    await Promise.all(tasks)
  },
  onSuccess: async () => {
    budgetFields.value = budgetFields.value.map((f) => ({ ...f, initial: f.text }))
    targetFieldsInitial.value = { ...targetFields.value }
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['budgets'] }),
      qc.invalidateQueries({ queryKey: ['targets'] }),
      qc.invalidateQueries({ queryKey: ['dashboard'] }),
    ])
    flash.message.value = `Saved for ${monthYearLabel(cycle.value)}`
  },
  onError: (e) => { formError.value = e instanceof ApiRequestError ? e.message : 'Could not save' },
})
const canSave = computed(() => dirty.value && !hasInvalid.value && !saveMut.isPending.value)
function save() {
  if (!canSave.value) return
  formError.value = ''
  saveMut.mutate()
}

// Same unsaved-changes guard as UpdateBalancesPage.vue — a Vuetify dialog, not window.confirm.
const leaveConfirmOpen = ref(false)
let resolveLeave: ((ok: boolean) => void) | null = null
function confirmDiscard(): true | Promise<boolean> {
  if (!dirty.value) return true
  return new Promise<boolean>((resolve) => {
    resolveLeave = resolve
    leaveConfirmOpen.value = true
  })
}
onBeforeRouteLeave(confirmDiscard)
onBeforeRouteUpdate(confirmDiscard)
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
  <v-alert v-else-if="budgetsQ.error.value" type="error" variant="tonal">{{ budgetsQ.error.value.message }}</v-alert>
  <template v-else-if="b">
    <PageHeader title="Budgets &amp; targets">
      <div class="cycle-pill">
        <v-btn icon="mdi-chevron-left" variant="text" size="small" aria-label="Previous cycle" @click="go(previousCycle(b.cycle))" />
        <span data-testid="cycle-label">{{ cycleLabel(b.cycle, startDay) }}</span>
        <v-btn icon="mdi-chevron-right" variant="text" size="small" aria-label="Next cycle" @click="go(nextCycle(b.cycle))" />
      </div>
    </PageHeader>

    <div class="grid2">
      <v-card>
        <div class="hd">
          <div>
            <div class="eyebrow">Category budgets</div>
            <div class="range">{{ yen(totalSpent) }} of {{ yen(totalBudget) }}<span v-if="totalPct !== null"> · {{ totalPct }}%</span></div>
          </div>
        </div>
        <div v-for="row in b.rows" :key="row.categoryId" class="brow">
          <div class="t">
            <span><span class="dot" aria-hidden="true" :style="{ background: safeColor(row.color) }" />{{ row.name }}</span>
            <span class="st" :class="row.state === 'over' ? 'text-error' : row.state === 'near' ? 'text-warning' : 'muted'">{{ stateWord(row) }}</span>
          </div>
          <div class="amt-row">
            <v-text-field
              :model-value="fieldFor(row.categoryId).text"
              :label="`Budget for ${row.name}`"
              inputmode="decimal"
              prefix="¥"
              placeholder="No budget"
              density="comfortable"
              hide-details="auto"
              style="max-width: 200px"
              @update:model-value="(v) => setBudgetText(row.categoryId, v)"
            />
            <span class="muted num">{{ yen(row.spentJpy) }} spent</span>
          </div>
          <div v-if="row.budgetJpy !== null" class="track"><i :style="{ width: `${Math.min(row.pct ?? 0, 100)}%`, background: barColor(row) }" /></div>
        </div>
        <p class="note muted">Changes apply from {{ monthYearLabel(b.cycle) }} onwards.</p>
      </v-card>

      <v-card>
        <div class="tx-hd">
          <h2>Cycle targets</h2>
          <div class="right"><v-btn variant="outlined" size="small" :loading="copy.pending.value" @click="copy.copy">Copy last cycle</v-btn></div>
        </div>
        <v-alert v-if="copy.error.value" type="error" variant="tonal" class="mx-5 mb-2" density="compact">{{ copy.error.value }}</v-alert>
        <div v-for="key in TARGET_KEYS" :key="key" class="trow">
          <v-text-field
            v-model="targetFields[key]"
            :label="`${TARGET_LABELS[key]} (${TARGET_CURRENCY[key] === 'INR' ? '₹' : '¥'})`"
            inputmode="decimal"
            :prefix="TARGET_CURRENCY[key] === 'INR' ? '₹' : '¥'"
            density="comfortable"
            hide-details="auto"
          />
          <div v-if="targetRowFor(key)" class="actual">
            <span class="muted num">{{ fmtFor(key)(targetRowFor(key)!.actualValue) }} / {{ fmtFor(key)(targetRowFor(key)!.targetValue) }}</span>
            <b :class="targetRowFor(key)!.met ? 'text-success' : 'text-error'">{{ targetStateText(targetRowFor(key)!, fmtFor(key)) }}</b>
          </div>
        </div>
      </v-card>
    </div>

    <v-alert v-if="formError" type="error" variant="tonal" class="mt-3">{{ formError }}</v-alert>

    <div class="save-footer">
      <v-btn color="primary" :loading="saveMut.isPending.value" :disabled="!canSave" @click="save">Save</v-btn>
    </div>

    <v-dialog v-model="leaveConfirmOpen" max-width="420" persistent>
      <v-card>
        <v-card-title>Discard unsaved changes?</v-card-title>
        <v-card-text>Budgets or targets you typed on this screen haven't been saved yet.</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="outlined" @click="keepEditing">Keep editing</v-btn>
          <v-btn color="error" @click="discardChanges">Discard changes</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="copy.confirmOpen.value" max-width="420" persistent>
      <v-card>
        <v-card-title>Replace this cycle's targets?</v-card-title>
        <v-card-text>{{ cycleLabel(b.cycle, startDay) }} already has targets set.</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="outlined" @click="copy.cancel">Cancel</v-btn>
          <v-btn color="primary" :loading="copy.pending.value" @click="copy.overwrite">Replace</v-btn>
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
.grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  /* Same clearance UpdateBalancesPage.vue's `.rows-end-spacer` gives its own sticky footer: with
     enough categories to need scrolling, the last row must never end up tucked behind the
     sticky Save bar below it. */
  margin-bottom: 96px;
}
@media (max-width: 1100px) {
  .grid2 {
    grid-template-columns: minmax(0, 1fr);
  }
}
.hd {
  padding: 16px 20px 8px;
}
.eyebrow {
  font-size: 12px;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: rgb(var(--v-theme-on-surface-variant));
  font-weight: 600;
}
.range {
  font-size: 16px;
  font-weight: 700;
  margin-top: 2px;
}
.muted {
  color: rgb(var(--v-theme-on-surface-variant));
}
.brow {
  padding: 10px 20px;
  border-top: 1px solid rgb(var(--v-border-color));
}
.brow .t {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  font-weight: 600;
}
.brow .t .st {
  font-size: 12.5px;
  font-weight: 600;
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
  margin-right: 8px;
}
.amt-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.track {
  height: 8px;
  border-radius: 99px;
  background: rgb(var(--v-theme-surface-variant));
  overflow: hidden;
  margin-top: 8px;
}
.track i {
  display: block;
  height: 100%;
}
.note {
  padding: 10px 20px 16px;
  font-size: 12.5px;
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
.trow {
  padding: 10px 20px;
  border-top: 1px solid rgb(var(--v-border-color));
}
.actual {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 6px;
  font-size: 13px;
}
.save-footer {
  position: sticky;
  bottom: 0;
  z-index: 2;
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
  padding: 16px 22px;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgb(var(--v-border-color));
  border-radius: 12px;
  box-shadow: 0 -6px 16px rgba(0, 0, 0, 0.08);
}
@media (max-width: 599px) {
  .save-footer {
    bottom: 56px;
  }
}
</style>
