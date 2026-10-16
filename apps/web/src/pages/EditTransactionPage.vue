<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { AccountList, Budgets, Transaction, type NeedWant, type PaymentMethod } from '@nri/contracts'
import { cycleOf, decimalFromPaise } from '@nri/core'
import CategoryAvatar from '../components/CategoryAvatar.vue'
import { apiFetch, ApiRequestError } from '../lib/api'
import { quickAddHint } from '../lib/budgetsForm'
import { useCategories } from '../lib/categories'
import { accountOptionsFor, amountPatchFor, NEED_LABELS, PAYMENT_LABELS, parseAmount, type Currency } from '../lib/expenseForm'
import { toRestoreInput } from '../lib/ledger'
import { useProfile } from '../lib/profile'
import { undo } from '../lib/undo'

const route = useRoute()
const router = useRouter()
const qc = useQueryClient()
const cats = useCategories()
const me = useProfile()
const id = computed(() => String(route.params.id))
const accounts = useQuery({
  queryKey: ['accounts', 'all'],
  queryFn: async () => (await apiFetch('/api/accounts?include=archived', {}, AccountList)).items,
})
const row = useQuery({
  queryKey: ['transactions', 'one', id],
  queryFn: async () => {
    try {
      return await apiFetch(`/api/transactions/${id.value}`, {}, Transaction)
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 404) return null
      throw e
    }
  },
})

const amount = ref('')
const currency = ref<Currency>('JPY')
const categoryId = ref('')
const accountId = ref<string | null>(null)
const occurredOn = ref('')
const paymentMethod = ref<PaymentMethod>('bank')
const needWant = ref<NeedWant>('need')
const description = ref('')
const notes = ref('')
const error = ref('')

watch(() => row.data.value, (t) => {
  if (!t) return
  currency.value = t.enteredCurrency
  amount.value = t.enteredCurrency === 'INR' && t.amountInrPaise !== null ? decimalFromPaise(t.amountInrPaise) : String(t.amountJpy)
  categoryId.value = t.categoryId; accountId.value = t.accountId
  occurredOn.value = t.occurredOn; paymentMethod.value = t.paymentMethod; needWant.value = t.needWant
  description.value = t.description; notes.value = t.notes
}, { immediate: true })

const choices = computed(() => (cats.data.value ?? []).filter((c) => !c.archived || c.id === row.data.value?.categoryId))
const accountChoices = computed(() => accountOptionsFor(accounts.data.value ?? [], row.data.value?.accountId))

// BUD-2: same remaining-budget hint as QuickAddPage, for this expense's own cycle.
const budgetCycle = computed(() => cycleOf(occurredOn.value, me.data.value?.profile?.cycleStartDay ?? 25))
const budgetsQ = useQuery({
  queryKey: ['budgets', budgetCycle],
  queryFn: () => apiFetch(`/api/budgets?cycle=${budgetCycle.value}`, {}, Budgets),
  enabled: () => !!categoryId.value && !!occurredOn.value,
})
const budgetHint = computed(() => {
  const r = budgetsQ.data.value?.rows.find((r2) => r2.categoryId === categoryId.value)
  return r ? quickAddHint(r) : null
})
const refresh = () => Promise.all(['transactions', 'dashboard', 'categories'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
const fail = (e: unknown) => { error.value = e instanceof ApiRequestError ? e.message : 'Could not save' }

const save = useMutation({
  mutationFn: () => {
    const t = row.data.value!
    const parsedAmount = parseAmount(amount.value, currency.value)
    if (!parsedAmount) throw new ApiRequestError(400, 'VALIDATION_FAILED', currency.value === 'JPY' ? 'Enter a whole number of yen' : 'Enter rupees with up to two decimals')
    const body = {
      ...amountPatchFor(t, currency.value, parsedAmount), // an unchanged ₹ amount is not re-converted at today's rate
      categoryId: categoryId.value, accountId: accountId.value, occurredOn: occurredOn.value,
      paymentMethod: paymentMethod.value, needWant: needWant.value, description: description.value, notes: notes.value,
    }
    return apiFetch(`/api/transactions/${t.id}`, { method: 'PATCH', body: JSON.stringify(body) }, Transaction)
  },
  onSuccess: async () => { await refresh(); await router.push('/spend') },
  onError: fail,
})
const remove = useMutation({
  mutationFn: () => apiFetch(`/api/transactions/${row.data.value!.id}`, { method: 'DELETE' }),
  onSuccess: async () => { undo.pending.value = toRestoreInput(row.data.value!); await refresh(); await router.push('/spend') },
  onError: fail,
})
</script>

<template>
  <h1 class="text-h5 font-weight-bold mb-4">Edit expense</h1>
  <v-progress-linear v-if="row.isLoading.value" indeterminate />
  <v-alert v-else-if="!row.data.value" type="warning" variant="tonal">That expense no longer exists. <router-link to="/spend">Back to the ledger</router-link></v-alert>
  <v-form v-else class="quick-add" @submit.prevent="save.mutate()">
    <div class="amount-card">
      <div class="row1">
        <v-text-field
          id="amount" v-model="amount" :label="currency === 'JPY' ? 'Amount (¥)' : 'Amount (₹)'" inputmode="decimal"
          variant="plain" hide-details class="amount-input num"
        />
        <v-btn-toggle v-model="currency" mandatory density="comfortable" class="cur" aria-label="Currency">
          <v-btn value="JPY" aria-label="Yen" :aria-pressed="currency === 'JPY'">¥</v-btn>
          <v-btn value="INR" aria-label="Rupees" :aria-pressed="currency === 'INR'">₹</v-btn>
        </v-btn-toggle>
      </div>
    </div>

    <v-select v-model="categoryId" :items="choices" item-title="name" item-value="id" label="Category">
      <template #item="{ item, props: itemProps }">
        <v-list-item v-bind="itemProps">
          <template #prepend><CategoryAvatar :category="item" :size="24" /></template>
        </v-list-item>
      </template>
      <template #selection="{ item }">
        <CategoryAvatar :category="item" :size="20" class="mr-2" />{{ item.name }}
      </template>
    </v-select>
    <div v-if="budgetHint" class="hint budget-hint" :class="{ 'text-error': budgetHint.startsWith('Over') }">{{ budgetHint }}</div>
    <v-select v-model="accountId" :items="accountChoices" item-title="name" item-value="id" label="Account (optional)" clearable />
    <v-text-field v-model="occurredOn" label="Date" type="date" />

    <div class="lbl">Paid with</div>
    <v-chip-group v-model="paymentMethod" mandatory role="radiogroup" aria-label="Payment method" class="chip-row">
      <v-chip v-for="(label, key) in PAYMENT_LABELS" :key="key" :value="key" variant="outlined" :ripple="false" role="radio" :aria-checked="paymentMethod === key" class="c2">
        <v-icon v-if="paymentMethod === key" size="13" start aria-hidden="true">mdi-check</v-icon>{{ label }}
      </v-chip>
    </v-chip-group>
    <div class="lbl">Need or want</div>
    <v-chip-group v-model="needWant" mandatory role="radiogroup" aria-label="Need or want" class="chip-row">
      <v-chip v-for="(label, key) in NEED_LABELS" :key="key" :value="key" variant="outlined" :ripple="false" role="radio" :aria-checked="needWant === key" class="c2">
        <v-icon v-if="needWant === key" size="13" start aria-hidden="true">mdi-check</v-icon>{{ label }}
      </v-chip>
    </v-chip-group>

    <v-text-field id="description" v-model="description" label="Description" counter="200" maxlength="200" class="mt-2" />
    <v-textarea v-model="notes" label="Notes" counter="2000" maxlength="2000" rows="2" auto-grow />
    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>
    <div class="d-flex ga-2">
      <v-btn type="submit" color="primary" :loading="save.isPending.value">Save</v-btn>
      <v-btn to="/spend" variant="text">Cancel</v-btn>
      <v-spacer />
      <v-btn color="error" variant="tonal" :loading="remove.isPending.value" @click="remove.mutate()">Delete</v-btn>
    </div>
  </v-form>
</template>

<style scoped>
.quick-add {
  max-width: 560px;
}

.amount-card {
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgb(var(--v-border-color));
  border-radius: 16px;
  padding: 16px;
  margin-bottom: 16px;
}
.row1 {
  display: flex;
  align-items: center;
  gap: 10px;
}
.amount-input {
  flex: 1 1 auto;
}
.amount-input :deep(.v-field) {
  padding: 0;
}
.amount-input :deep(.v-field__input) {
  font-size: 38px;
  font-weight: 700;
  letter-spacing: -0.8px;
  padding: 0;
  min-height: auto;
}
.amount-input :deep(.v-field__input input) {
  font-size: 38px;
  font-weight: 700;
  letter-spacing: -0.8px;
}
.amount-input :deep(.v-label) {
  font-size: 13px;
}
.cur {
  flex: none;
  border: 1px solid rgb(var(--v-border-color));
  border-radius: 10px;
  box-shadow: none;
  height: auto;
}
.cur :deep(.v-btn) {
  min-width: 42px;
  height: 36px;
  border-radius: 0;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface-variant));
  background: rgb(var(--v-theme-surface));
}
/* See QuickAddPage.vue's matching rule: white-on-`primary` used to fail spec §7's 4.5:1 minimum in
   both themes (3.12:1 light, 2.53:1 dark); `primary-darken-1` + white clears it in light (6.72:1),
   and dark theme's own `on-primary` token (dark text, 6.65:1) clears it there instead. */
.cur :deep(.v-btn--active.v-theme--light) {
  background: rgb(var(--v-theme-primary-darken-1));
  color: #fff;
}
.cur :deep(.v-btn--active.v-theme--dark) {
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
}

.hint {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 12.5px;
  margin-top: 6px;
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
</style>
