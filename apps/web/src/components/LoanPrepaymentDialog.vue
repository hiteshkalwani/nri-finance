<script setup lang="ts">
import { ref, watch } from 'vue'
import { useDisplay } from 'vuetify'
import { useMutation, useQueryClient } from '@tanstack/vue-query'
import type { PlannedPrepaymentsInput } from '@nri/contracts'
import { apiFetch, ApiRequestError } from '../lib/api'
import { parseAmount } from '../lib/balancesForm'
import { cycleFromMonthIndex, monthIndexFromCycle } from '../lib/loanForm'

const props = defineProps<{
  modelValue: boolean
  loanId: string
  startCycle: string
  planned: { cycle: string; amountPaise: number }[]
}>()
const emit = defineEmits<{ 'update:modelValue': [boolean] }>()
const { xs } = useDisplay()
const qc = useQueryClient()

type Row = { cycle: string; amountText: string }
const rows = ref<Row[]>([])
const error = ref('')

function reset() {
  rows.value = props.planned.length
    ? props.planned.map((p) => ({ cycle: p.cycle, amountText: String(p.amountPaise / 100) }))
    : [{ cycle: props.startCycle, amountText: '' }]
  error.value = ''
}
watch(() => props.modelValue, (open) => { if (open) reset() })

function addRow() {
  rows.value.push({ cycle: cycleFromMonthIndex(monthIndexFromCycle(rows.value.at(-1)?.cycle ?? props.startCycle, props.startCycle) + 1, props.startCycle), amountText: '' })
}
function removeRow(i: number) {
  rows.value.splice(i, 1)
}

function close() {
  emit('update:modelValue', false)
}

const save = useMutation({
  mutationFn: (body: PlannedPrepaymentsInput) => apiFetch(`/api/loans/${props.loanId}/planned-prepayments`, { method: 'PUT', body: JSON.stringify(body) }),
  onSuccess: async () => {
    await Promise.all([qc.invalidateQueries({ queryKey: ['loans', 'schedule', props.loanId] }), qc.invalidateQueries({ queryKey: ['dashboard'] })])
    close()
  },
  onError: (e) => { error.value = e instanceof ApiRequestError ? e.message : 'Could not save the planned prepayments' },
})

function submit() {
  error.value = ''
  // Blank rows are just dropped — a row started then left empty was never meant as a prepayment.
  const items: { monthIndex: number; amountPaise: number }[] = []
  for (const r of rows.value) {
    if (!r.amountText.trim()) continue
    const amount = parseAmount(r.amountText, 'INR')
    if (typeof amount !== 'number' || amount <= 0 || !/^\d{4}-\d{2}$/.test(r.cycle)) { error.value = 'Check each row has a month and a ₹ amount'; return }
    items.push({ monthIndex: monthIndexFromCycle(r.cycle, props.startCycle), amountPaise: amount })
  }
  if (new Set(items.map((i) => i.monthIndex)).size !== items.length) { error.value = 'Each month can only appear once'; return }
  save.mutate({ items })
}
</script>

<template>
  <v-dialog :model-value="modelValue" :fullscreen="xs" max-width="480" @update:model-value="emit('update:modelValue', $event)">
    <v-card>
      <div class="tx-hd"><h2>Plan a prepayment</h2></div>
      <div class="rows">
        <div v-for="(row, i) in rows" :key="i" class="prow">
          <v-text-field v-model="row.cycle" :label="`Month`" type="month" density="compact" hide-details />
          <v-text-field v-model="row.amountText" label="Extra (₹)" inputmode="decimal" density="compact" hide-details />
          <v-btn icon="mdi-close" variant="text" size="small" :aria-label="`Remove row ${i + 1}`" @click="removeRow(i)" />
        </div>
        <v-btn variant="text" prepend-icon="mdi-plus" size="small" class="align-self-start" @click="addRow">Add month</v-btn>
      </div>
      <v-alert v-if="error" type="error" variant="tonal" class="mx-5 mb-3">{{ error }}</v-alert>
      <v-card-actions class="px-5 pb-5">
        <v-spacer />
        <v-btn variant="outlined" @click="close">Cancel</v-btn>
        <v-btn color="primary" :loading="save.isPending.value" @click="submit">Save</v-btn>
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
.rows {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 20px 4px;
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
