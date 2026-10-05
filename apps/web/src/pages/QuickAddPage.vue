<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useMutation, useQueryClient } from '@tanstack/vue-query'
import { Transaction, type NeedWant, type PaymentMethod } from '@nri/contracts'
import { todayIn } from '@nri/core'
import { apiFetch, ApiRequestError } from '../lib/api'
import { activeCategories, useCategories } from '../lib/categories'
import { defaultsFor, NEED_LABELS, PAYMENT_LABELS, parseAmount, previewJpy, type Currency } from '../lib/expenseForm'
import { yen } from '../lib/format'
import { useProfile } from '../lib/profile'

const router = useRouter()
const qc = useQueryClient()
const me = useProfile()
const cats = useCategories()
const profile = computed(() => me.data.value?.profile ?? null)
const active = computed(() => activeCategories(cats.data.value ?? []))

const amount = ref('')
const currency = ref<Currency>('JPY')
const categoryId = ref<string | null>(null)
const occurredOn = ref(todayIn('Asia/Tokyo'))
const paymentMethod = ref<PaymentMethod>('bank')
const needWant = ref<NeedWant>('need')
const description = ref('')
const error = ref('')
const saved = ref<string | null>(null)

// Only apply the profile's timezone-based "today" while the user hasn't touched the date themselves,
// so a cold load (profile query resolving after the user already edited the date) doesn't clobber their edit.
const dateTouched = ref(false)
let settingDefaultDate = false
watch(occurredOn, () => { if (!settingDefaultDate) dateTouched.value = true })
watch(profile, (p) => {
  if (p && !dateTouched.value) {
    settingDefaultDate = true
    occurredOn.value = todayIn(p.timezone)
    settingDefaultDate = false
  }
}, { immediate: true })
watch(categoryId, (id) => {
  const d = defaultsFor(active.value.find((c) => c.id === id))
  paymentMethod.value = d.paymentMethod
  needWant.value = d.needWant
})

const parsed = computed(() => parseAmount(amount.value, currency.value))
const preview = computed(() => (currency.value === 'INR' && profile.value ? previewJpy(amount.value, profile.value.planningRateJpyPerInr) : null))

const save = useMutation({
  mutationFn: () =>
    apiFetch('/api/transactions', {
      method: 'POST',
      body: JSON.stringify({
        ...parsed.value, categoryId: categoryId.value, occurredOn: occurredOn.value,
        paymentMethod: paymentMethod.value, needWant: needWant.value, description: description.value,
      }),
    }, Transaction),
  onSuccess: async (t) => {
    const name = active.value.find((c) => c.id === t.categoryId)?.name ?? ''
    saved.value = `Saved ${yen(t.amountJpy)} · ${name}`
    amount.value = ''
    description.value = ''
    error.value = ''
    await Promise.all(['transactions', 'dashboard', 'categories'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
  },
  onError: (e) => { error.value = e instanceof ApiRequestError ? e.message : 'Could not save' },
})

function submit() {
  error.value = ''
  if (!parsed.value) { error.value = currency.value === 'JPY' ? 'Enter a whole number of yen' : 'Enter rupees with up to two decimals'; return }
  if (!categoryId.value) { error.value = 'Choose a category'; return }
  save.mutate()
}
</script>

<template>
  <h1 class="text-h5 mb-4">Add expense</h1>
  <v-alert v-if="me.data.value && !profile" type="info" variant="tonal">
    Set up your profile first in <router-link to="/settings">Settings</router-link>.
  </v-alert>
  <v-form v-else style="max-width: 560px" @submit.prevent="submit">
    <div class="d-flex ga-2 align-start">
      <v-text-field id="amount" v-model="amount" :label="currency === 'JPY' ? 'Amount (¥)' : 'Amount (₹)'" inputmode="decimal"
        autofocus class="text-h5" :hint="preview !== null ? `≈ ${yen(preview)} at the planning rate` : ''" persistent-hint />
      <v-btn-toggle v-model="currency" mandatory density="comfortable" class="mt-2" aria-label="Currency">
        <v-btn value="JPY" aria-label="Yen">¥</v-btn><v-btn value="INR" aria-label="Rupees">₹</v-btn>
      </v-btn-toggle>
    </div>
    <div class="text-subtitle-2 mt-4 mb-2">Category</div>
    <v-chip-group v-model="categoryId" column mandatory selected-class="text-primary" role="radiogroup" aria-label="Category">
      <v-chip v-for="c in active" :key="c.id" :value="c.id" filter variant="outlined" role="radio" :aria-checked="categoryId === c.id">
        <v-icon start :color="c.color">mdi-circle</v-icon>{{ c.name }}
      </v-chip>
    </v-chip-group>
    <v-text-field id="date" v-model="occurredOn" label="Date" type="date" class="mt-4" />
    <div class="d-flex flex-wrap ga-4">
      <div>
        <div class="text-subtitle-2 mb-2">Payment method</div>
        <v-chip-group v-model="paymentMethod" mandatory role="radiogroup" aria-label="Payment method">
          <v-chip v-for="(label, key) in PAYMENT_LABELS" :key="key" :value="key" filter role="radio" :aria-checked="paymentMethod === key">{{ label }}</v-chip>
        </v-chip-group>
      </div>
      <div>
        <div class="text-subtitle-2 mb-2">Need or want</div>
        <v-chip-group v-model="needWant" mandatory role="radiogroup" aria-label="Need or want">
          <v-chip v-for="(label, key) in NEED_LABELS" :key="key" :value="key" filter role="radio" :aria-checked="needWant === key">{{ label }}</v-chip>
        </v-chip-group>
      </div>
    </div>
    <v-text-field id="description" v-model="description" label="Description (optional)" counter="200" maxlength="200" />
    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>
    <v-btn type="submit" color="primary" size="large" :loading="save.isPending.value">Save</v-btn>
  </v-form>
  <v-snackbar :model-value="!!saved" timeout="6000" @update:model-value="saved = null">
    <span data-testid="saved">{{ saved }}</span>
    <template #actions>
      <v-btn variant="text" @click="saved = null">Add another</v-btn>
      <v-btn variant="text" @click="router.push('/spend')">View in ledger</v-btn>
    </template>
  </v-snackbar>
</template>
