<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { z } from 'zod'
import {
  AccountList, Loan, Remittance, type RemittanceInput, type RemittancePurpose, type RemittanceService,
} from '@nri/contracts'
import { decimalFromPaise, todayIn } from '@nri/core'
import PageHeader from '../components/PageHeader.vue'
import { apiFetch, ApiRequestError } from '../lib/api'
import { parseAmount } from '../lib/balancesForm'
import { flash } from '../lib/flash'
import { useProfile } from '../lib/profile'
import {
  effectiveRateText, inAccounts, jpAccounts, loanPickerState, needsLoan, PURPOSE_LABELS, SERVICE_LABELS,
  toRemittanceInput, vsPlanText,
} from '../lib/remittanceForm'
import { undo } from '../lib/undo'

const route = useRoute()
const router = useRouter()
const qc = useQueryClient()
const me = useProfile()
const id = computed(() => (typeof route.params.id === 'string' ? route.params.id : null))
const isEdit = computed(() => id.value !== null)

const accountsQ = useQuery({
  queryKey: ['accounts', 'all'],
  queryFn: async () => (await apiFetch('/api/accounts?include=archived', {}, AccountList)).items,
})
const loansQ = useQuery({ queryKey: ['loans'], queryFn: () => apiFetch('/api/loans', {}, z.array(Loan)) })
const existingQ = useQuery({
  queryKey: ['remittances', 'one', id],
  enabled: () => isEdit.value,
  queryFn: async () => {
    try {
      return await apiFetch(`/api/remittances/${id.value}`, {}, Remittance)
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 404) return null
      throw e
    }
  },
})

const sentOn = ref(todayIn('Asia/Tokyo'))
const service = ref<RemittanceService>('wise')
const jpyText = ref('')
const inrText = ref('')
const feeText = ref('0')
const fromAccountId = ref<string | null>(null)
const toAccountId = ref<string | null>(null)
const purpose = ref<RemittancePurpose>('family')
const loanId = ref<string | null>(null)
const notes = ref('')
const error = ref('')
const fieldErrors = ref<Record<string, string>>({})

function snapshotText(): string {
  return JSON.stringify([
    sentOn.value, service.value, jpyText.value, inrText.value, feeText.value,
    fromAccountId.value, toAccountId.value, purpose.value, loanId.value, notes.value,
  ])
}
const initialSnapshot = ref(snapshotText())
const dirty = computed(() => snapshotText() !== initialSnapshot.value)

// Only apply the profile's timezone-based "today" default while creating and before the user has
// touched anything — same reasoning as QuickAddPage's own date default — then fold it into the
// clean snapshot so it never registers as an edit.
let defaultsApplied = false
watch(() => me.data.value?.profile, (p) => {
  if (!p || isEdit.value || defaultsApplied) return
  sentOn.value = todayIn(p.timezone)
  defaultsApplied = true
  initialSnapshot.value = snapshotText()
}, { immediate: true })

// The loan picker's own readiness: true once an edit's existing row has been applied (or
// immediately, for a new transfer) — guards the auto-pick/validate watch below from clobbering
// the server's own `loanId` with its own best guess the instant this page mounts.
const ready = ref(!isEdit.value)
watch(() => existingQ.data.value, (r) => {
  if (!r) return
  sentOn.value = r.sentOn
  service.value = r.service
  jpyText.value = String(r.jpySent)
  inrText.value = decimalFromPaise(r.inrPaise)
  feeText.value = String(r.feeJpy)
  fromAccountId.value = r.fromAccountId
  toAccountId.value = r.toAccountId
  purpose.value = r.purpose
  loanId.value = r.loanId
  initialSnapshot.value = snapshotText()
  ready.value = true
}, { immediate: true })

const loans = computed(() => loansQ.data.value ?? [])
const loanState = computed(() => loanPickerState(loans.value))
watch([purpose, loanState], () => {
  if (!ready.value) return
  if (!needsLoan(purpose.value)) { loanId.value = null; return }
  if (loanState.value.kind === 'auto') loanId.value = loanState.value.loan.id
  else if (loanState.value.kind === 'select' && !loans.value.some((l) => l.id === loanId.value)) loanId.value = null
})

const planningRate = computed(() => me.data.value?.profile?.planningRateJpyPerInr ?? '1')
const parsedJpy = computed(() => parseAmount(jpyText.value, 'JPY'))
const parsedInr = computed(() => parseAmount(inrText.value, 'INR'))
const liveReady = computed(() => typeof parsedJpy.value === 'number' && parsedJpy.value > 0 && typeof parsedInr.value === 'number' && parsedInr.value > 0)
const liveRateText = computed(() => (liveReady.value ? effectiveRateText(parsedJpy.value as number, parsedInr.value as number) : null))
const liveVsPlan = computed(() => (liveReady.value ? vsPlanText(parsedJpy.value as number, parsedInr.value as number, planningRate.value) : null))

function buildBody(): RemittanceInput | null {
  fieldErrors.value = {}
  error.value = ''
  const jpy = parseAmount(jpyText.value, 'JPY')
  const inr = parseAmount(inrText.value, 'INR')
  const fee = parseAmount(feeText.value, 'JPY')
  if (typeof jpy !== 'number' || jpy <= 0) { fieldErrors.value.jpySent = 'Enter a whole number of yen'; return null }
  if (typeof inr !== 'number' || inr <= 0) { fieldErrors.value.inrPaise = 'Enter rupees with up to two decimals'; return null }
  if (typeof fee !== 'number' || fee < 0) { fieldErrors.value.feeJpy = 'Enter a whole number of yen, 0 or more'; return null }
  if (fee > jpy) { fieldErrors.value.feeJpy = 'Fee cannot exceed ¥ sent'; return null }
  if (needsLoan(purpose.value) && !loanId.value) {
    fieldErrors.value.loanId = loanState.value.kind === 'none' ? 'No loan yet' : 'Choose a loan'
    return null
  }
  return {
    sentOn: sentOn.value, jpySent: jpy, inrPaise: inr, feeJpy: fee, service: service.value,
    fromAccountId: fromAccountId.value, toAccountId: toAccountId.value, purpose: purpose.value,
    loanId: needsLoan(purpose.value) ? loanId.value : null, notes: notes.value,
  }
}

/** Maps a 400's `details[].path` (e.g. `['loanId']`) onto the field it belongs to — same pattern as AccountDialog.vue. */
function applyApiError(e: unknown) {
  fieldErrors.value = {}
  error.value = ''
  if (!(e instanceof ApiRequestError)) { error.value = 'Something went wrong'; return }
  const details = e.details
  if (Array.isArray(details) && details.length) {
    const next: Record<string, string> = {}
    for (const issue of details as { path?: unknown[]; message?: string }[]) {
      const field = typeof issue.path?.[0] === 'string' ? issue.path[0] : null
      if (field) next[field] = issue.message ?? e.message
    }
    if (Object.keys(next).length) { fieldErrors.value = next; return }
  }
  error.value = e.message
}

const refresh = () => Promise.all(['remittances', 'dashboard'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
const save = useMutation({
  mutationFn: (body: RemittanceInput) => (isEdit.value
    ? apiFetch(`/api/remittances/${id.value}`, { method: 'PATCH', body: JSON.stringify(body) }, Remittance)
    : apiFetch('/api/remittances', { method: 'POST', body: JSON.stringify(body) }, Remittance)),
  onSuccess: async () => {
    initialSnapshot.value = snapshotText() // clean before navigating — this page's own redirect must not trip the leave guard
    await refresh()
    flash.message.value = isEdit.value ? 'Transfer updated' : 'Transfer recorded'
    await router.push('/remit')
  },
  onError: applyApiError,
})
function submit() {
  const body = buildBody()
  if (body) save.mutate(body)
}
const remove = useMutation({
  mutationFn: () => apiFetch(`/api/remittances/${id.value}`, { method: 'DELETE' }),
  onSuccess: async () => {
    undo.pendingRemittance.value = toRemittanceInput(existingQ.data.value!)
    initialSnapshot.value = snapshotText()
    await refresh()
    flash.message.value = 'Transfer deleted'
    await router.push('/remit')
  },
  onError: (e) => { error.value = e instanceof ApiRequestError ? e.message : 'Could not delete that transfer' },
})

// Leaving with unsaved changes — same Vuetify-dialog pattern as UpdateBalancesPage.vue.
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
  <PageHeader :title="isEdit ? 'Edit transfer' : 'Record transfer'" />
  <v-progress-linear v-if="isEdit && existingQ.isLoading.value" indeterminate />
  <v-alert v-else-if="isEdit && !existingQ.data.value" type="warning" variant="tonal">
    That transfer no longer exists. <router-link to="/remit">Back to Remit</router-link>
  </v-alert>
  <v-form v-else class="remit-form" @submit.prevent="submit">
    <v-text-field id="sentOn" v-model="sentOn" label="Date" type="date" :error-messages="fieldErrors.sentOn" />

    <div class="lbl">Service</div>
    <v-chip-group v-model="service" mandatory role="radiogroup" aria-label="Service" class="chip-row">
      <v-chip
        v-for="(label, key) in SERVICE_LABELS" :key="key" :value="key" variant="outlined" :ripple="false" role="radio"
        :aria-checked="service === key" class="c2"
      >{{ label }}</v-chip>
    </v-chip-group>

    <div class="two-col">
      <v-text-field id="jpySent" v-model="jpyText" label="¥ sent" inputmode="decimal" :error-messages="fieldErrors.jpySent" />
      <v-text-field id="inrPaise" v-model="inrText" label="₹ received" inputmode="decimal" :error-messages="fieldErrors.inrPaise" />
    </div>
    <v-text-field id="feeJpy" v-model="feeText" label="Fee (¥)" inputmode="decimal" :error-messages="fieldErrors.feeJpy" />

    <div class="two-col">
      <v-select
        v-model="fromAccountId" :items="jpAccounts(accountsQ.data.value ?? [])" item-title="name" item-value="id"
        label="From (Japan account)" clearable :error-messages="fieldErrors.fromAccountId"
      />
      <v-select
        v-model="toAccountId" :items="inAccounts(accountsQ.data.value ?? [])" item-title="name" item-value="id"
        label="To (India account)" clearable :error-messages="fieldErrors.toAccountId"
      />
    </div>

    <div class="lbl">Purpose</div>
    <v-chip-group v-model="purpose" mandatory role="radiogroup" aria-label="Purpose" class="chip-row">
      <v-chip
        v-for="(label, key) in PURPOSE_LABELS" :key="key" :value="key" variant="outlined" :ripple="false" role="radio"
        :aria-checked="purpose === key" :disabled="needsLoan(key) && loanState.kind === 'none'" class="c2"
      >
        <v-icon v-if="purpose === key" size="13" start aria-hidden="true">mdi-check</v-icon>{{ label }}
        <span v-if="needsLoan(key) && loanState.kind === 'none'" class="chip-note"> · No loan yet</span>
      </v-chip>
    </v-chip-group>
    <template v-if="needsLoan(purpose)">
      <div v-if="loanState.kind === 'auto'" class="loan-auto">Loan: <b>{{ loanState.loan.name }}</b></div>
      <v-select
        v-else-if="loanState.kind === 'select'" v-model="loanId" :items="loanState.loans" item-title="name" item-value="id"
        label="Loan" :error-messages="fieldErrors.loanId" class="mt-2"
      />
      <div v-if="fieldErrors.loanId && loanState.kind !== 'select'" class="field-error">{{ fieldErrors.loanId }}</div>
    </template>

    <v-textarea id="notes" v-model="notes" label="Notes" counter="500" maxlength="500" rows="2" auto-grow class="mt-2" />

    <div v-if="liveRateText" class="rate-panel">
      <div><div class="eyebrow">Effective rate</div><b>{{ liveRateText }}</b></div>
      <div v-if="liveVsPlan">
        <div class="eyebrow">vs planning rate</div>
        <b :class="liveVsPlan.cls === 'good' ? 'text-success' : liveVsPlan.cls === 'bad' ? 'text-error' : ''">{{ liveVsPlan.text }}</b>
      </div>
    </div>

    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>
    <div class="d-flex ga-2">
      <v-btn type="submit" color="primary" :loading="save.isPending.value">Save</v-btn>
      <v-btn to="/remit" variant="text">Cancel</v-btn>
      <v-spacer />
      <v-btn v-if="isEdit" color="error" variant="tonal" :loading="remove.isPending.value" @click="remove.mutate()">Delete</v-btn>
    </div>
  </v-form>

  <v-dialog v-model="leaveConfirmOpen" max-width="420" persistent>
    <v-card>
      <v-card-title>Discard unsaved changes?</v-card-title>
      <v-card-text>This transfer hasn't been saved yet.</v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="outlined" @click="keepEditing">Keep editing</v-btn>
        <v-btn color="error" @click="discardChanges">Discard changes</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.remit-form {
  max-width: 560px;
}
.two-col {
  display: flex;
  gap: 12px;
}
.two-col > * {
  flex: 1 1 0;
  min-width: 0;
}
.lbl {
  font-size: 12px;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  color: rgb(var(--v-theme-on-surface-variant));
  font-weight: 600;
  margin: 12px 2px 8px;
}
.chip-row :deep(.v-slide-group__container) {
  overflow: visible;
}
.chip-row :deep(.v-slide-group__content) {
  flex-wrap: wrap;
  gap: 6px;
}
.chip-row :deep(.v-chip) {
  margin: 0;
  border: 1px solid rgb(var(--v-border-color));
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  font-weight: 500;
  font-size: 13px;
}
.chip-row :deep(.v-chip--selected) {
  background: rgb(var(--v-theme-on-surface));
  border-color: rgb(var(--v-theme-on-surface));
  color: rgb(var(--v-theme-surface));
}
.chip-note {
  color: rgb(var(--v-theme-on-surface-variant));
}
.loan-auto {
  padding: 10px 2px;
  font-size: 14px;
}
.field-error {
  color: rgb(var(--v-theme-error));
  font-size: 12px;
  margin: 2px 2px 0;
}
.rate-panel {
  display: flex;
  gap: 24px;
  flex-wrap: wrap;
  padding: 14px 16px;
  margin: 14px 0;
  border: 1px solid rgb(var(--v-border-color));
  border-radius: 12px;
  background: rgb(var(--v-theme-surface));
}
.rate-panel .eyebrow {
  font-size: 11.5px;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: rgb(var(--v-theme-on-surface-variant));
}
.rate-panel b {
  font-size: 15px;
}
</style>
