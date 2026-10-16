<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useDisplay } from 'vuetify'
import { useMutation, useQueryClient } from '@tanstack/vue-query'
import { SipPlan, type SipPlanInput } from '@nri/contracts'
import { apiFetch, ApiRequestError } from '../lib/api'
import { parseAmount } from '../lib/balancesForm'
import { allocationTotalPct } from '../lib/sipForm'

const props = defineProps<{ modelValue: boolean; plan: SipPlan | null }>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; saved: [SipPlan] }>()
const { xs } = useDisplay()
const qc = useQueryClient()

const startingMonthlyText = ref('')
const stepUpPct = ref('')
const expectedReturnPct = ref('')
const startYear = ref('')
const endYear = ref('')
const redirectEmiAfterPayoff = ref(false)
type AllocRow = { fundName: string; pct: string }
const allocations = ref<AllocRow[]>([])
const error = ref('')

const total = computed(() => allocationTotalPct(allocations.value))
const totalOk = computed(() => total.value === 100)

function reset() {
  const p = props.plan
  startingMonthlyText.value = p ? String(p.startingMonthlyPaise / 100) : ''
  stepUpPct.value = p?.stepUpPct ?? '0'
  expectedReturnPct.value = p?.expectedReturnPct ?? ''
  const thisYear = new Date().getFullYear()
  startYear.value = p ? String(p.startYear) : String(thisYear)
  endYear.value = p ? String(p.endYear) : String(thisYear + 10)
  redirectEmiAfterPayoff.value = p?.redirectEmiAfterPayoff ?? false
  allocations.value = p && p.allocations.length ? p.allocations.map((a) => ({ fundName: a.fundName, pct: a.pct })) : [{ fundName: '', pct: '' }]
  error.value = ''
}
watch(() => props.modelValue, (open) => { if (open) reset() })

function addRow() {
  allocations.value.push({ fundName: '', pct: '' })
}
function removeRow(i: number) {
  allocations.value.splice(i, 1)
}

function close() {
  emit('update:modelValue', false)
}

const save = useMutation({
  mutationFn: (body: SipPlanInput) => apiFetch('/api/sip', { method: 'PUT', body: JSON.stringify(body) }, SipPlan),
  onSuccess: async (saved) => {
    await Promise.all([qc.invalidateQueries({ queryKey: ['sip'] }), qc.invalidateQueries({ queryKey: ['dashboard'] })])
    emit('saved', saved)
    close()
  },
  onError: (e) => { error.value = e instanceof ApiRequestError ? e.message : 'Something went wrong' },
})

function submit() {
  error.value = ''
  const startingMonthly = parseAmount(startingMonthlyText.value, 'INR')
  const sy = Number(startYear.value)
  const ey = Number(endYear.value)
  if (typeof startingMonthly !== 'number' || startingMonthly <= 0) { error.value = 'Enter a starting monthly amount in ₹'; return }
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(stepUpPct.value)) { error.value = 'Enter a step-up like 10'; return }
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(expectedReturnPct.value)) { error.value = 'Enter an expected return like 12'; return }
  if (!Number.isInteger(sy) || !Number.isInteger(ey) || ey < sy) { error.value = 'Check the start/end years'; return }
  if (!totalOk.value) { error.value = 'Allocations must add up to 100%'; return }
  const allocs = allocations.value.filter((a) => a.fundName.trim())
  if (!allocs.length) { error.value = 'Add at least one fund'; return }

  save.mutate({
    startingMonthlyPaise: startingMonthly, stepUpPct: stepUpPct.value, expectedReturnPct: expectedReturnPct.value,
    startYear: sy, endYear: ey, redirectEmiAfterPayoff: redirectEmiAfterPayoff.value, allocations: allocs,
  }, { onError: (e) => { error.value = e instanceof ApiRequestError ? e.message : 'Something went wrong' } })
}
</script>

<template>
  <v-dialog :model-value="modelValue" :fullscreen="xs" max-width="520" @update:model-value="emit('update:modelValue', $event)">
    <v-card>
      <div class="tx-hd"><h2>{{ plan ? 'Edit plan' : 'Set up plan' }}</h2></div>
      <v-form class="fgrid" @submit.prevent="submit">
        <div class="two-col">
          <v-text-field id="sip-monthly" v-model="startingMonthlyText" label="Starting monthly (₹)" inputmode="decimal" />
          <v-text-field id="sip-stepup" v-model="stepUpPct" label="Step-up (%/yr)" inputmode="decimal" />
        </div>
        <div class="two-col">
          <v-text-field id="sip-return" v-model="expectedReturnPct" label="Expected return (%)" inputmode="decimal" />
          <v-switch v-model="redirectEmiAfterPayoff" label="Redirect EMI after payoff" color="primary" hide-details />
        </div>
        <div class="two-col">
          <v-text-field id="sip-start-year" v-model="startYear" label="Start year" inputmode="numeric" />
          <v-text-field id="sip-end-year" v-model="endYear" label="End year" inputmode="numeric" />
        </div>

        <div class="lbl">Allocation <span class="total" :class="{ off: !totalOk }">Total {{ total }}%</span></div>
        <div v-for="(row, i) in allocations" :key="i" class="prow">
          <v-text-field v-model="row.fundName" label="Fund" density="compact" hide-details />
          <v-text-field v-model="row.pct" label="%" inputmode="decimal" density="compact" hide-details style="max-width: 90px" />
          <v-btn icon="mdi-close" variant="text" size="small" :aria-label="`Remove fund ${i + 1}`" @click="removeRow(i)" />
        </div>
        <v-btn variant="text" prepend-icon="mdi-plus" size="small" class="align-self-start" @click="addRow">Add fund</v-btn>
      </v-form>
      <v-alert v-if="error" type="error" variant="tonal" class="mx-5 mb-3">{{ error }}</v-alert>
      <v-card-actions class="px-5 pb-5">
        <v-spacer />
        <v-btn variant="outlined" @click="close">Cancel</v-btn>
        <v-btn color="primary" :disabled="!totalOk" :loading="save.isPending.value" @click="submit">Save</v-btn>
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
.lbl {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  color: rgb(var(--v-theme-on-surface-variant));
  font-weight: 600;
}
.total {
  text-transform: none;
  letter-spacing: normal;
  font-weight: 700;
}
.total.off {
  color: rgb(var(--v-theme-error));
}
.prow {
  display: flex;
  gap: 8px;
  align-items: center;
}
.prow > *:not(.v-btn) {
  flex: 1 1 0;
  min-width: 0;
}
</style>
