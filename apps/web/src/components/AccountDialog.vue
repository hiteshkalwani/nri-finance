<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useDisplay } from 'vuetify'
import { useMutation, useQueryClient } from '@tanstack/vue-query'
import { Account, type AccountCreate, type AccountPatch, type AccountType, type Country } from '@nri/contracts'
import { apiFetch, ApiRequestError } from '../lib/api'
import { TYPE_LABEL, TYPE_ORDER } from '../lib/accounts'

const props = defineProps<{ modelValue: boolean; account: Account | null }>()
const emit = defineEmits<{ 'update:modelValue': [boolean] }>()
const { xs } = useDisplay()
const qc = useQueryClient()

const name = ref('')
const country = ref<Country>('JP')
const type = ref<AccountType>('bank')
const isEmergencyFund = ref(false)
const fieldErrors = ref<Record<string, string>>({})
const formError = ref('')

const isEdit = computed(() => props.account !== null)
const title = computed(() => (isEdit.value ? `Edit ${props.account!.name}` : 'Add account'))
const currencyText = computed(() => (country.value === 'JP' ? 'Yen (¥)' : 'Rupees (₹)'))
// The API refuses to change an account's country once it has a balance snapshot (409, Task 3) —
// disabled here rather than letting the user hit that error after filling in everything else.
const countryLocked = computed(() => isEdit.value && props.account!.hasBalances)

function reset() {
  const a = props.account
  name.value = a?.name ?? ''
  country.value = a?.country ?? 'JP'
  type.value = a?.type ?? 'bank'
  isEmergencyFund.value = a?.isEmergencyFund ?? false
  fieldErrors.value = {}
  formError.value = ''
}
watch(() => props.modelValue, (open) => { if (open) reset() })

function close() {
  emit('update:modelValue', false)
}

// Includes `['balances']` (final review finding 1): adding or editing an account changes the
// rows Update balances should show — without invalidating it too, that page's own cached GET for
// the current cycle keeps whatever row set it had before this account existed/changed.
const refresh = () => Promise.all([
  qc.invalidateQueries({ queryKey: ['accounts'] }),
  qc.invalidateQueries({ queryKey: ['networth'] }),
  qc.invalidateQueries({ queryKey: ['balances'] }),
])

const create = useMutation({
  mutationFn: (body: AccountCreate) => apiFetch('/api/accounts', { method: 'POST', body: JSON.stringify(body) }, Account),
  onSuccess: async () => { await refresh(); close() },
})
const edit = useMutation({
  mutationFn: (body: AccountPatch) => apiFetch(`/api/accounts/${props.account!.id}`, { method: 'PATCH', body: JSON.stringify(body) }, Account),
  onSuccess: async () => { await refresh(); close() },
})
const saving = computed(() => create.isPending.value || edit.isPending.value)

/** Maps a zod issue's `path` (e.g. `['name']`) onto the field it belongs to; anything else surfaces as a form-level error. */
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
  if (!name.value.trim()) { fieldErrors.value = { name: 'Name is required' }; return }
  if (isEdit.value) {
    const body: AccountPatch = { name: name.value, type: type.value, isEmergencyFund: isEmergencyFund.value }
    if (!countryLocked.value) body.country = country.value
    edit.mutate(body, { onError: applyApiError })
  } else {
    create.mutate({ name: name.value, country: country.value, type: type.value, isEmergencyFund: isEmergencyFund.value }, { onError: applyApiError })
  }
}
</script>

<template>
  <v-dialog :model-value="modelValue" :fullscreen="xs" max-width="480" @update:model-value="emit('update:modelValue', $event)">
    <v-card>
      <div class="tx-hd"><h2>{{ title }}</h2></div>
      <v-form class="fgrid" @submit.prevent="submit">
        <v-text-field
          id="account-name" v-model="name" label="Name" :error-messages="fieldErrors.name"
        />
        <div>
          <div class="lbl">Country</div>
          <div class="seg" role="group" aria-label="Country">
            <v-btn
              v-for="c in (['JP', 'IN'] as const)" :key="c" :ripple="false" :class="{ on: country === c }"
              :aria-pressed="country === c" :disabled="countryLocked" variant="text" @click="country = c"
            >{{ c }}</v-btn>
          </div>
          <div class="hint">{{ currencyText }}<span v-if="countryLocked"> · This account has balances</span></div>
          <div v-if="fieldErrors.country" class="field-error">{{ fieldErrors.country }}</div>
        </div>
        <!-- No `aria-label` here (fix round 2, task 10): Vuetify's own `aria-labelledby` (pointing at
             this field's floating "Type" label) wins over any `aria-label` per the accessible-name
             computation order, so one would be silently dead — never reaching assistive tech or
             `getByLabel`. "Type" is already a unique, descriptive accessible name within this dialog. -->
        <v-select
          v-model="type" label="Type" :items="TYPE_ORDER.map((t) => ({ value: t, title: TYPE_LABEL[t] }))"
          :error-messages="fieldErrors.type"
        />
        <v-switch v-model="isEmergencyFund" label="Counts toward emergency fund" color="primary" hide-details />
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
.lbl {
  font-size: 12.5px;
  color: rgb(var(--v-theme-on-surface-variant));
  font-weight: 500;
  margin-bottom: 6px;
}
.seg {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border: 1px solid rgb(var(--v-border-color));
  border-radius: 10px;
}
.seg .v-btn {
  min-width: 64px;
}
.seg :deep(.v-btn.on.v-theme--light) {
  background: rgb(var(--v-theme-primary-darken-1));
  color: #fff;
}
.seg :deep(.v-btn.on.v-theme--dark) {
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
}
.hint {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 12.5px;
  margin-top: 6px;
}
.field-error {
  color: rgb(var(--v-theme-error));
  font-size: 12px;
  margin-top: 4px;
}
</style>
