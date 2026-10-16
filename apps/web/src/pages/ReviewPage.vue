<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { Review, Targets } from '@nri/contracts'
import { cycleOf, previousCycle, todayIn } from '@nri/core'
import PageHeader from '../components/PageHeader.vue'
import { apiFetch, ApiRequestError } from '../lib/api'
import { dateRangeLabel, monthYearLabel, rupees, yen } from '../lib/format'
import { useProfile } from '../lib/profile'
import {
  hasInvalidTargetField, isDirtyTargets, TARGET_CURRENCY, TARGET_KEYS, TARGET_LABELS, targetFieldsFrom, targetsPutFrom,
  targetStateText, type TargetFields, useCopyPreviousTargets,
} from '../lib/targetsForm'

const route = useRoute()
const router = useRouter()
const qc = useQueryClient()
const me = useProfile()

const paramCycle = computed(() => (typeof route.params.cycle === 'string' ? route.params.cycle : null))
// Bare `/review` -> `/review/<the cycle that just closed>`, using the same profile-driven cycle
// logic every other cycle picker in the app uses (cycleOf(todayIn(tz), startDay)).
watch(
  [() => me.data.value?.profile, paramCycle],
  ([profile, pc]) => {
    if (pc || !profile) return
    const current = cycleOf(todayIn(profile.timezone), profile.cycleStartDay)
    void router.replace(`/review/${previousCycle(current)}`)
  },
  { immediate: true },
)

const cycle = computed(() => paramCycle.value ?? '')
const reviewQ = useQuery({
  queryKey: ['review', cycle],
  queryFn: () => apiFetch(`/api/review/${cycle.value}`, {}, Review),
  enabled: () => !!cycle.value,
})
const review = computed(() => reviewQ.data.value)
const fmtFor = (key: (typeof TARGET_KEYS)[number]) => (TARGET_CURRENCY[key] === 'INR' ? rupees : yen)

type Step = 'summary' | 'balances' | 'targets'
const STEPS: { key: Step; label: string }[] = [{ key: 'summary', label: 'Summary' }, { key: 'balances', label: 'Balances' }, { key: 'targets', label: "Next cycle's targets" }]
const step = computed<Step>(() => {
  const s = route.query.step
  return s === 'balances' || s === 'targets' ? s : 'summary'
})
function goStep(s: Step) {
  void router.replace({ query: { ...route.query, step: s } })
}

// Step 1: closed-cycle summary rows (REV-1).
const summaryRows = computed(() => {
  if (!review.value) return []
  const s = review.value.summary
  const savings = review.value.targets.find((t) => t.key === 'savings')
  const keptSub = [
    s.savingsRatePct !== null ? `${s.savingsRatePct}% savings rate` : null,
    savings ? targetStateText(savings, yen) : null,
  ].filter(Boolean).join(' · ')
  return [
    { label: 'Income', value: yen(s.incomeJpy), sub: '' },
    { label: 'Spent', value: yen(s.spentJpy), sub: '' },
    { label: 'Sent home', value: yen(s.sentJpy), sub: s.sentJpy ? `${rupees(s.receivedPaise)} received` : '' },
    { label: 'Kept', value: yen(s.keptJpy), sub: keptSub },
  ]
})
const TONE_WORD = { bad: 'Over budget', warn: 'Watch', good: 'On track' } as const
const TONE_ICON = { bad: 'mdi-alert-circle', warn: 'mdi-clock-alert-outline', good: 'mdi-check-circle' } as const

// Step 3: next cycle's targets, prefilled from GET /api/targets/<nextCycle>.
const nextCycle = computed(() => review.value?.nextCycle ?? '')
const EMPTY_TARGETS: TargetFields = { savings: '', emergencyFund: '', remittance: '', prepayment: '' }
const nextTargetsQ = useQuery({
  queryKey: ['targets', nextCycle],
  queryFn: () => apiFetch(`/api/targets/${nextCycle.value}`, {}, Targets),
  enabled: () => !!review.value,
})
const nextFields = ref<TargetFields>({ ...EMPTY_TARGETS })
const nextFieldsInitial = ref<TargetFields>({ ...EMPTY_TARGETS })
let builtNextCycle: string | undefined
watch([() => nextTargetsQ.data.value?.cycle, () => nextTargetsQ.dataUpdatedAt.value], () => {
  const t = nextTargetsQ.data.value
  if (!t || t.cycle === builtNextCycle) return
  builtNextCycle = t.cycle
  const f = targetFieldsFrom(t)
  // Two distinct objects, not the same `f` twice — see BudgetsPage.vue's matching comment.
  nextFields.value = f
  nextFieldsInitial.value = { ...f }
}, { immediate: true })

const nextCopy = useCopyPreviousTargets(() => nextCycle.value, (t) => {
  const f = targetFieldsFrom(t)
  nextFields.value = f
  nextFieldsInitial.value = { ...f }
})

const nextDirty = computed(() => isDirtyTargets(nextFields.value, nextFieldsInitial.value))
const nextInvalid = computed(() => hasInvalidTargetField(nextFields.value))
const saveError = ref('')
const saveNextMut = useMutation({
  mutationFn: () => {
    const body = targetsPutFrom(nextFields.value)
    return apiFetch(`/api/targets/${nextCycle.value}`, { method: 'PUT', body: JSON.stringify(body) }, Targets)
  },
  onSuccess: async () => {
    nextFieldsInitial.value = { ...nextFields.value }
    saveError.value = ''
    await qc.invalidateQueries({ queryKey: ['review'] })
  },
  onError: (e) => { saveError.value = e instanceof ApiRequestError ? e.message : 'Could not save' },
})
const done = computed(() => (review.value?.nextTargetsSet && !nextDirty.value) || saveNextMut.isSuccess.value)
function saveNext() {
  if (nextInvalid.value) return
  saveError.value = ''
  saveNextMut.mutate()
}
</script>

<template>
  <v-alert v-if="reviewQ.error.value" type="error" variant="tonal">{{ reviewQ.error.value.message }}</v-alert>
  <template v-else-if="review">
    <PageHeader title="Cycle review">
      <span class="muted">{{ dateRangeLabel(review.start, review.end) }}</span>
    </PageHeader>

    <ol class="stepper" role="tablist" aria-label="Review steps">
      <li v-for="(s, i) in STEPS" :key="s.key">
        <button type="button" role="tab" :aria-selected="step === s.key" :class="{ on: step === s.key }" @click="goStep(s.key)">
          <b>{{ i + 1 }}</b>{{ s.label }}
          <v-icon v-if="s.key === 'balances' && review.balancesDone" size="14" color="success" aria-label="done">mdi-check</v-icon>
          <v-icon v-if="s.key === 'targets' && done" size="14" color="success" aria-label="done">mdi-check</v-icon>
        </button>
      </li>
    </ol>

    <div class="grid2">
      <v-card v-if="step === 'summary'">
        <div class="tx-hd"><h2>How the cycle went</h2></div>
        <div v-for="r in summaryRows" :key="r.label" class="trow">
          <span class="n">{{ r.label }}</span>
          <span class="v"><b class="num">{{ r.value }}</b></span>
          <span v-if="r.sub" class="st muted">{{ r.sub }}</span>
        </div>
        <div v-if="review.targets.length" class="target-list">
          <div v-for="t in review.targets" :key="t.key" class="trow">
            <span class="n">{{ TARGET_LABELS[t.key] }}</span>
            <span class="v"><b class="num">{{ fmtFor(t.key)(t.actualValue) }}</b> <span class="muted">/ {{ fmtFor(t.key)(t.targetValue) }}</span></span>
            <span class="st" :class="t.met ? 'text-success' : 'text-error'">{{ targetStateText(t, fmtFor(t.key)) }}</span>
          </div>
        </div>
        <div class="highlights">
          <div class="eyebrow mb-2">Worth a look</div>
          <p v-if="!review.highlights.length" class="muted mb-0">Nothing stands out this cycle.</p>
          <div v-for="(h, i) in review.highlights" :key="i" class="hl" :class="h.tone">
            <v-icon size="16" class="mr-1" aria-hidden="true">{{ TONE_ICON[h.tone] }}</v-icon>
            <b>{{ TONE_WORD[h.tone] }}:</b> {{ h.text }}
          </div>
        </div>
      </v-card>

      <v-card v-else-if="step === 'balances'" style="grid-column: 1 / -1; max-width: 640px">
        <div class="tx-hd"><h2>Enter this cycle's balances</h2></div>
        <p class="px-5 muted">Update each account's balance for {{ monthYearLabel(review.cycle) }} — about 2 minutes.</p>
        <div class="px-5 pb-5 d-flex ga-2 flex-wrap">
          <v-btn
            color="primary"
            :to="`/accounts/balances?cycle=${review.cycle}&next=${encodeURIComponent(`/review/${review.cycle}?step=balances`)}`"
          >
            {{ review.balancesDone ? 'Update balances' : 'Go to balances' }}
          </v-btn>
          <v-btn v-if="review.balancesDone" variant="outlined" @click="goStep('targets')">Continue to targets</v-btn>
        </div>
        <p v-if="review.balancesDone" class="px-5 pb-4 mb-0"><v-icon color="success" size="16" class="mr-1">mdi-check-circle</v-icon>Balances recorded for this cycle.</p>
      </v-card>

      <v-card v-else style="grid-column: 1 / -1; max-width: 640px">
        <div class="tx-hd">
          <h2>Next cycle's targets ({{ monthYearLabel(nextCycle) }})</h2>
          <div class="right"><v-btn variant="outlined" size="small" :loading="nextCopy.pending.value" @click="nextCopy.copy">Copy this cycle</v-btn></div>
        </div>
        <p v-if="done" class="px-5 done-msg mb-0"><v-icon color="success" size="18" class="mr-1">mdi-check-circle</v-icon><b>Review done</b> — next cycle's targets are set.</p>
        <v-alert v-if="nextCopy.error.value" type="error" variant="tonal" class="mx-5 mb-2" density="compact">{{ nextCopy.error.value }}</v-alert>
        <div v-for="key in TARGET_KEYS" :key="key" class="trow">
          <v-text-field
            v-model="nextFields[key]"
            :label="`${TARGET_LABELS[key]} (${TARGET_CURRENCY[key] === 'INR' ? '₹' : '¥'})`"
            inputmode="decimal"
            :prefix="TARGET_CURRENCY[key] === 'INR' ? '₹' : '¥'"
            density="comfortable"
            hide-details="auto"
          />
        </div>
        <v-alert v-if="saveError" type="error" variant="tonal" class="mx-5 mb-2">{{ saveError }}</v-alert>
        <div class="px-5 pb-5 d-flex ga-2">
          <v-btn color="primary" :loading="saveNextMut.isPending.value" :disabled="nextInvalid || !nextDirty" @click="saveNext">Save targets</v-btn>
          <v-btn to="/" variant="outlined">Go to Dashboard</v-btn>
        </div>
      </v-card>

      <v-card v-if="step === 'summary'" class="next-card" style="align-self: start">
        <div class="tx-hd"><h2>Next</h2></div>
        <p class="px-5 mb-3 muted">Enter this cycle's account balances (about 2 minutes), then set next cycle's targets. You can stop at any step and come back.</p>
        <div class="px-5 pb-5 d-flex ga-2">
          <v-btn color="primary" class="flex-grow-1" @click="goStep('balances')">Continue to balances</v-btn>
          <v-btn to="/" variant="outlined">Later</v-btn>
        </div>
      </v-card>
    </div>
  </template>
  <v-progress-linear v-else indeterminate />
</template>

<style scoped>
.muted {
  color: rgb(var(--v-theme-on-surface-variant));
}
.stepper {
  display: flex;
  gap: 10px;
  list-style: none;
  padding: 0;
  margin: 0 0 16px;
  flex-wrap: wrap;
}
.stepper button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 14px 7px 8px;
  border: 1px solid rgb(var(--v-border-color));
  border-radius: 99px;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface-variant));
  font-weight: 500;
  font-size: 13.5px;
}
.stepper button b {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: rgb(var(--v-theme-surface-variant));
  font-size: 11.5px;
}
.stepper button.on {
  color: rgb(var(--v-theme-on-surface));
  border-color: rgb(var(--v-theme-primary-accent));
}
.stepper button.on b {
  background: rgb(var(--v-theme-primary-accent));
  color: rgb(var(--v-theme-on-primary));
}
.grid2 {
  display: grid;
  grid-template-columns: 1fr 340px;
  gap: 16px;
  align-items: start;
}
@media (max-width: 1100px) {
  .grid2 {
    grid-template-columns: minmax(0, 1fr);
  }
}
.tx-hd {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 20px;
  flex-wrap: wrap;
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
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 4px 12px;
  padding: 11px 20px;
  border-top: 1px solid rgb(var(--v-border-color));
}
.trow .n {
  font-weight: 600;
}
.trow .v {
  text-align: right;
}
.trow .st {
  grid-column: 1 / -1;
  font-size: 12.5px;
  font-weight: 600;
}
.target-list {
  border-top: 2px solid rgb(var(--v-border-color));
}
.eyebrow {
  font-size: 12px;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: rgb(var(--v-theme-on-surface-variant));
  font-weight: 600;
}
.highlights {
  padding: 14px 20px 18px;
  border-top: 1px solid rgb(var(--v-border-color));
}
.hl {
  display: flex;
  align-items: flex-start;
  padding: 9px 12px;
  border-radius: 10px;
  margin-top: 6px;
  font-weight: 500;
  font-size: 13.5px;
}
.hl.bad {
  background: rgba(var(--v-theme-error-accent), 0.14);
  color: rgb(var(--v-theme-error));
}
.hl.warn {
  background: rgba(var(--v-theme-warning), 0.16);
  color: rgb(var(--v-theme-warning));
}
.hl.good {
  background: rgba(var(--v-theme-success-accent), 0.14);
  color: rgb(var(--v-theme-success));
}
.done-msg {
  padding-top: 14px;
}
</style>
