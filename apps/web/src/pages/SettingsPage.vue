<script setup lang="ts">
import { ref, watch } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { ImportResult, MeResponse, ProfileInput, type V1Document } from '@nri/contracts'
import { apiFetch } from '../lib/api'
import { parseV1File } from '../lib/importFile'
import CategoriesSettings from '../components/CategoriesSettings.vue'

const qc = useQueryClient()
const me = useQuery({ queryKey: ['me'], queryFn: () => apiFetch('/api/me', {}, MeResponse) })
const form = ref({ salaryJpy: 0, planningRateJpyPerInr: '1.7', cycleStartDay: 25, timezone: 'Asia/Tokyo' })
watch(() => me.data.value?.profile, (p) => { if (p) form.value = { ...p } }, { immediate: true })
const formError = ref('')

const save = useMutation({
  mutationFn: (body: ProfileInput) => apiFetch('/api/me', { method: 'PUT', body: JSON.stringify(body) }, MeResponse),
  onSuccess: (data) => qc.setQueryData(['me'], data),
})
function submitProfile() {
  const parsed = ProfileInput.safeParse({
    ...form.value, salaryJpy: Number(form.value.salaryJpy), cycleStartDay: Number(form.value.cycleStartDay),
  })
  formError.value = parsed.success ? '' : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
  if (parsed.success) save.mutate(parsed.data)
}

const importMessage = ref('')
const importError = ref('')
const runImport = useMutation({
  mutationFn: (doc: V1Document) => apiFetch('/api/import/v1', { method: 'POST', body: JSON.stringify(doc) }, ImportResult),
  onSuccess: (r) => {
    const i = r.inserted
    importMessage.value =
      `Imported ${i.transactions} transactions, ${i.remittances} remittances, ${i.categories} categories, ${i.accounts} accounts.` +
      (r.skippedRows.length ? ` Skipped ${r.skippedRows.length}: ${r.skippedRows.join(', ')}` : '')
    void qc.invalidateQueries({ queryKey: ['me'] })
  },
})
async function onFile(files: File | File[] | null) {
  const file = Array.isArray(files) ? files[0] : files
  importMessage.value = ''
  importError.value = ''
  runImport.reset()
  if (!file) return
  const parsed = parseV1File(await file.text())
  if (!parsed.ok) { importError.value = parsed.message; return }
  runImport.mutate(parsed.doc)
}
</script>

<template>
  <h1 class="text-h5 mb-4">Settings</h1>
  <v-card class="mb-6">
    <v-card-title>Profile</v-card-title>
    <v-card-text>
      <v-form @submit.prevent="submitProfile">
        <v-text-field id="salary" v-model.number="form.salaryJpy" label="Monthly salary (¥)" type="number" />
        <v-text-field id="rate" v-model="form.planningRateJpyPerInr" label="Planning rate (¥ per ₹1)" />
        <v-text-field id="start-day" v-model.number="form.cycleStartDay" label="Cycle start day" type="number" />
        <v-text-field id="timezone" v-model="form.timezone" label="Timezone" />
        <v-alert v-if="formError || save.error.value" type="error" variant="tonal" class="mb-4">
          {{ formError || save.error.value?.message }}
        </v-alert>
        <v-btn type="submit" color="primary" :loading="save.isPending.value">Save profile</v-btn>
        <span v-if="save.isSuccess.value" class="ml-3">Saved</span>
      </v-form>
    </v-card-text>
  </v-card>
  <CategoriesSettings />
  <v-card>
    <v-card-title>Import from v1</v-card-title>
    <v-card-text>
      <p class="mb-3">Choose your <code>finance-data.json</code>. Importing twice does not create duplicates.</p>
      <v-file-input id="import-file" label="finance-data.json" accept="application/json" @update:model-value="onFile" />
      <v-alert v-if="importMessage" type="success" variant="tonal">{{ importMessage }}</v-alert>
      <v-alert v-if="importError || runImport.error.value" type="error" variant="tonal">
        {{ importError || runImport.error.value?.message }}
      </v-alert>
    </v-card-text>
  </v-card>
</template>
