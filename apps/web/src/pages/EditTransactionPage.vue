<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { AccountList, Transaction, type NeedWant, type PaymentMethod } from '@nri/contracts'
import { decimalFromPaise } from '@nri/core'
import { apiFetch, ApiRequestError } from '../lib/api'
import { useCategories } from '../lib/categories'
import { NEED_LABELS, PAYMENT_LABELS, parseAmount, type Currency } from '../lib/expenseForm'
import { toCreateInput } from '../lib/ledger'
import { undo } from '../lib/undo'

const route = useRoute()
const router = useRouter()
const qc = useQueryClient()
const cats = useCategories()
const id = computed(() => String(route.params.id))
const accounts = useQuery({ queryKey: ['accounts'], queryFn: async () => (await apiFetch('/api/accounts', {}, AccountList)).items })
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
const refresh = () => Promise.all(['transactions', 'dashboard', 'categories'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
const fail = (e: unknown) => { error.value = e instanceof ApiRequestError ? e.message : 'Could not save' }

const save = useMutation({
  mutationFn: () => {
    const t = row.data.value!
    const parsedAmount = parseAmount(amount.value, currency.value)
    if (!parsedAmount) throw new ApiRequestError(400, 'VALIDATION_FAILED', currency.value === 'JPY' ? 'Enter a whole number of yen' : 'Enter rupees with up to two decimals')
    const unchanged = currency.value === t.enteredCurrency &&
      ('amountJpy' in parsedAmount ? parsedAmount.amountJpy === t.amountJpy : parsedAmount.amountInrPaise === t.amountInrPaise)
    const body = {
      ...(unchanged ? {} : parsedAmount), // an unchanged ₹ amount is not re-converted at today's rate
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
  onSuccess: async () => { undo.pending.value = toCreateInput(row.data.value!); await refresh(); await router.push('/spend') },
  onError: fail,
})
</script>

<template>
  <h1 class="text-h5 mb-4">Edit expense</h1>
  <v-progress-linear v-if="row.isLoading.value" indeterminate />
  <v-alert v-else-if="!row.data.value" type="warning" variant="tonal">That expense no longer exists. <router-link to="/spend">Back to the ledger</router-link></v-alert>
  <v-form v-else style="max-width: 560px" @submit.prevent="save.mutate()">
    <div class="d-flex ga-2 align-start">
      <v-text-field id="amount" v-model="amount" :label="currency === 'JPY' ? 'Amount (¥)' : 'Amount (₹)'" inputmode="decimal" />
      <v-btn-toggle v-model="currency" mandatory density="comfortable" class="mt-2" aria-label="Currency">
        <v-btn value="JPY" aria-label="Yen">¥</v-btn><v-btn value="INR" aria-label="Rupees">₹</v-btn>
      </v-btn-toggle>
    </div>
    <v-select v-model="categoryId" :items="choices" item-title="name" item-value="id" label="Category" />
    <v-select v-model="accountId" :items="accounts.data.value ?? []" item-title="name" item-value="id" label="Account (optional)" clearable />
    <v-text-field v-model="occurredOn" label="Date" type="date" />
    <v-select v-model="paymentMethod" :items="Object.entries(PAYMENT_LABELS).map(([value, title]) => ({ value, title }))" label="Payment method" />
    <v-select v-model="needWant" :items="Object.entries(NEED_LABELS).map(([value, title]) => ({ value, title }))" label="Need or want" />
    <v-text-field id="description" v-model="description" label="Description" counter="200" maxlength="200" />
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
