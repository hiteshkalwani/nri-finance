<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useDisplay } from 'vuetify'
import { useMutation, useQueryClient } from '@tanstack/vue-query'
import { LoanDetail, type LoanInput, type LoanPatch } from '@nri/contracts'
import { apiFetch, ApiRequestError } from '../lib/api'
import { parseAmount } from '../lib/balancesForm'

const props = defineProps<{ modelValue: boolean; loan: LoanDetail | null }>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; saved: [LoanDetail] }>()
const { xs } = useDisplay()
const qc = useQueryClient()

const name = ref('')
const principalText = ref('')
const annualRatePct = ref('')
const emiText = ref('')
const tenureMonths = ref('')
const startCycle = ref('')
const closed = ref(false)
const fieldErrors = ref<Record<string, string>>({})
const formError = ref('')

const isEdit = computed(() => props.loan !== null)
const title = computed(() => (isEdit.value ? `Edit ${props.loan!.name}` : 'Add loan'))

function reset() {
  const l = props.loan
  name.value = l?.name ?? ''
  principalText.value = l ? String(l.principalPaise / 100) : ''
  annualRatePct.value = l?.annualRatePct ?? ''
  emiText.value = l ? String(l.emiPaise / 100) : ''
  tenureMonths.value = l ? String(l.tenureMonths) : ''
  startCycle.value = l?.startCycle ?? ''
  closed.value = l?.closedAt !== null && l?.closedAt !== undefined
  fieldErrors.value = {}
  formError.value = ''
}
watch(() => props.modelValue, (open) => { if (open) reset() })

function close() {
  emit('update:modelValue', false)
}

const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['loans'] }), qc.invalidateQueries({ queryKey: ['dashboard'] })])

const create = useMutation({
  mutationFn: (body: LoanInput) => apiFetch('/api/loans', { method: 'POST', body: JSON.stringify(body) }, LoanDetail),
  onSuccess: async (saved) => { await refresh(); emit('saved', saved); close() },
})
const edit = useMutation({
  mutationFn: (body: LoanPatch) => apiFetch(`/api/loans/${props.loan!.id}`, { method: 'PATCH', body: JSON.stringify(body) }, LoanDetail),
  onSuccess: async (saved) => { await refresh(); emit('saved', saved); close() },
})
const saving = computed(() => create.isPending.value || edit.isPending.value)

/** Maps a 400's `details[].path` onto the field it belongs to — same pattern as AccountDialog.vue. */
function applyApiError(e: unknown) {
  fieldErrors.value = {}
  formError.value = ''
  if (!(e instanceof ApiRequestError)) { formError.value = 'Something went wrong'; return }
  const details = e.details
  if (Array.isArray(details) && details.length) {
    const next: Record<string, string> = {}
    for (const issue of details as { path?: unknown[]; message?: string }[]) {
      const field = typeof issue.path?.[0] === 'string' ? issue.path[0] : null
      if (field) next[field] = issue.message ?? e.message
    }
    if (Object.keys(next).length) { fieldErrors.value = next; return }
  }
  formError.value = e.message
}

function submit() {
  fieldErrors.value = {}
  formError.value = ''
  const principal = parseAmount(principalText.value, 'INR')
  const emi = parseAmount(emiText.value, 'INR')
  const tenure = Number(tenureMonths.value)
  if (!name.value.trim()) { fieldErrors.value.name = 'Name is required'; return }
  if (typeof principal !== 'number' || principal <= 0) { fieldErrors.value.principalPaise = 'Enter rupees with up to two decimals'; return }
  if (!/^\d{1,2}(\.\d{1,3})?$/.test(annualRatePct.value)) { fieldErrors.value.annualRatePct = 'Enter a rate like 8.5'; return }
  if (typeof emi !== 'number' || emi <= 0) { fieldErrors.value.emiPaise = 'Enter rupees with up to two decimals'; return }
  if (!Number.isInteger(tenure) || tenure < 1) { fieldErrors.value.tenureMonths = 'Enter months, 1 or more'; return }
  if (!/^\d{4}-\d{2}$/.test(startCycle.value)) { fieldErrors.value.startCycle = 'Choose a start month'; return }

  const fields = { name: name.value, principalPaise: principal, annualRatePct: annualRatePct.value, emiPaise: emi, tenureMonths: tenure, startCycle: startCycle.value }
  if (isEdit.value) edit.mutate({ ...fields, closed: closed.value }, { onError: applyApiError })
  else create.mutate(fields, { onError: applyApiError })
}
</script>

<template>
  <v-dialog :model-value="modelValue" :fullscreen="xs" max-width="480" @update:model-value="emit('update:modelValue', $event)">
    <v-card>
      <div class="tx-hd"><h2>{{ title }}</h2></div>
      <v-form class="fgrid" @submit.prevent="submit">
        <v-text-field id="loan-name" v-model="name" label="Name" :error-messages="fieldErrors.name" />
        <div class="two-col">
          <v-text-field id="loan-principal" v-model="principalText" label="Principal (₹)" inputmode="decimal" :error-messages="fieldErrors.principalPaise" />
          <v-text-field id="loan-rate" v-model="annualRatePct" label="Annual rate (%)" inputmode="decimal" :error-messages="fieldErrors.annualRatePct" />
        </div>
        <div class="two-col">
          <v-text-field id="loan-emi" v-model="emiText" label="EMI (₹)" inputmode="decimal" :error-messages="fieldErrors.emiPaise" />
          <v-text-field id="loan-tenure" v-model="tenureMonths" label="Tenure (months)" inputmode="numeric" :error-messages="fieldErrors.tenureMonths" />
        </div>
        <v-text-field id="loan-start" v-model="startCycle" label="Start cycle" type="month" :error-messages="fieldErrors.startCycle" />
        <v-switch v-if="isEdit" v-model="closed" :label="closed ? 'Closed' : 'Open'" color="primary" hide-details />
      </v-form>
      <v-alert v-if="formError" type="error" variant="tonal" class="mx-5 mb-3">{{ formError }}</v-alert>
      <v-card-actions class="px-5 pb-5">
        <v-spacer />
        <v-btn variant="outlined" @click="close">Cancel</v-btn>
        <v-btn color="primary" :loading="saving" @click="submit">Save</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.tx-hd {
  padding: 18px 20px 4px;
}
.tx-hd h2 {
  font-size: 18px;
  margin: 0;
  font-weight: 700;
}
.fgrid {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 12px 20px 4px;
}
.two-col {
  display: flex;
  gap: 12px;
}
.two-col > * {
  flex: 1 1 0;
  min-width: 0;
}
</style>
