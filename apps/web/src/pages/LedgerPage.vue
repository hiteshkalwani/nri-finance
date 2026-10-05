<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { Transaction, TransactionPage, type NeedWant, type PaymentMethod, type SortField } from '@nri/contracts'
import { cycleOf, lastCycles, todayIn } from '@nri/core'
import { apiFetch, ApiRequestError } from '../lib/api'
import { useCategories } from '../lib/categories'
import { NEED_LABELS, PAYMENT_LABELS } from '../lib/expenseForm'
import { cycleLabel, rupees, yen } from '../lib/format'
import { coerceSearch, PAGE_SIZE, routeQueryFrom, routeSearchValue, sortFromRoute, toApiQuery, type LedgerState } from '../lib/ledger'
import { useProfile } from '../lib/profile'
import { undo } from '../lib/undo'

const route = useRoute()
const router = useRouter()
const qc = useQueryClient()
const me = useProfile()
const cats = useCategories()
const startDay = computed(() => me.data.value?.profile?.cycleStartDay ?? 25)
const current = computed(() => cycleOf(todayIn(me.data.value?.profile?.timezone ?? 'Asia/Tokyo'), startDay.value))
const cycleOptions = computed(() => [
  { title: 'All cycles', value: 'all' },
  ...lastCycles(current.value, 24).reverse().map((c) => ({ title: cycleLabel(c, startDay.value), value: c })),
])
const catName = (id: string) => cats.data.value?.find((c) => c.id === id)
const str = (v: unknown) => (typeof v === 'string' && v ? v : null)

// "All" is explicit in the URL (?cycle=all) so the default can be the current cycle.
const cycleParam = computed(() => str(route.query.cycle) ?? current.value)
const apiQuery = computed(() => {
  const p = toApiQuery({ ...route.query, cycle: cycleParam.value === 'all' ? '' : cycleParam.value })
  return p.toString()
})
const page = useQuery({
  queryKey: ['transactions', apiQuery],
  queryFn: () => apiFetch(`/api/transactions?${apiQuery.value}`, {}, TransactionPage),
  placeholderData: keepPreviousData,
})

const search = ref(str(route.query.q) ?? '')
let timer: ReturnType<typeof setTimeout> | undefined
onUnmounted(() => {
  clearTimeout(timer)
  undo.pending.value = null // the snackbar has had its chance; don't resurface it on a later visit
})
// The URL is the source of truth: keep the box in sync on back/forward (or any other route-query
// change), but only schedule a push when the box actually differs from the URL — otherwise a resync
// from the route would itself re-trigger the debounce and fight the navigation that just happened.
watch(() => route.query.q, (v) => {
  const next = routeSearchValue(v)
  if (next !== search.value) search.value = next
})
watch(search, (v) => {
  // Vuetify's clearable × sets the model to null even though `search` is typed as string.
  const value = coerceSearch(v)
  clearTimeout(timer)
  if (value === routeSearchValue(route.query.q)) return
  timer = setTimeout(() => push({ q: value, page: 1 }), 300)
})

function state(): LedgerState {
  return {
    cycle: cycleParam.value === current.value ? null : cycleParam.value,
    categoryId: str(route.query.categoryId),
    paymentMethod: str(route.query.paymentMethod) as PaymentMethod | null,
    needWant: str(route.query.needWant) as NeedWant | null,
    q: str(route.query.q) ?? '',
    sort: sortFromRoute(route.query)[0]!,
    page: Number(str(route.query.page) ?? 1),
  }
}
// Explicit path: a late-firing (debounced) push must never land on whatever page the user has since navigated to.
function push(change: Partial<LedgerState>) { void router.replace({ path: '/spend', query: routeQueryFrom({ ...state(), ...change }) }) }
function onOptions(o: { page: number; sortBy: { key: string; order?: 'asc' | 'desc' | boolean }[] }) {
  const s = o.sortBy[0]
  push({ page: o.page, sort: s ? { key: s.key as SortField, order: s.order === 'asc' ? 'asc' : 'desc' } : { key: 'occurredOn', order: 'desc' } })
}

const headers = [
  { title: 'Date', key: 'occurredOn' },
  { title: 'Category', key: 'category' },
  { title: 'Description', key: 'description' },
  { title: 'Amount', key: 'amountJpy', align: 'end' as const },
  { title: 'Payment', key: 'paymentMethod' },
  { title: 'Need/want', key: 'needWant' },
]

const restoreError = ref('')
const restore = useMutation({
  mutationFn: () => apiFetch('/api/transactions/restore', { method: 'POST', body: JSON.stringify(undo.pending.value) }, Transaction),
  onSuccess: async () => {
    undo.pending.value = null
    restoreError.value = ''
    await Promise.all(['transactions', 'dashboard', 'categories'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
  },
  // Keep the pending undo so the snackbar (and Undo button) stay available to retry.
  onError: (e) => { restoreError.value = e instanceof ApiRequestError ? e.message : 'Could not restore that expense' },
})
</script>

<template>
  <div class="d-flex align-center flex-wrap ga-2 mb-4">
    <h1 class="text-h5 mr-auto">Spend</h1>
    <v-btn to="/spend/new" color="primary" prepend-icon="mdi-plus">Add expense</v-btn>
  </div>
  <div class="d-flex flex-wrap ga-2 mb-2">
    <v-select :model-value="cycleParam" :items="cycleOptions" label="Cycle" density="compact" hide-details style="max-width: 260px"
      @update:model-value="(v) => push({ cycle: v === current ? null : v, page: 1 })" />
    <v-select :model-value="state().categoryId" :items="cats.data.value ?? []" item-title="name" item-value="id" label="Category"
      clearable density="compact" hide-details style="max-width: 200px" @update:model-value="(v) => push({ categoryId: v, page: 1 })" />
    <v-select :model-value="state().paymentMethod" :items="Object.entries(PAYMENT_LABELS).map(([value, title]) => ({ value, title }))"
      label="Payment" clearable density="compact" hide-details style="max-width: 170px" @update:model-value="(v) => push({ paymentMethod: v, page: 1 })" />
    <v-select :model-value="state().needWant" :items="Object.entries(NEED_LABELS).map(([value, title]) => ({ value, title }))"
      label="Need/want" clearable density="compact" hide-details style="max-width: 150px" @update:model-value="(v) => push({ needWant: v, page: 1 })" />
    <v-text-field id="search" :model-value="search" label="Search" prepend-inner-icon="mdi-magnify" clearable density="compact" hide-details
      style="max-width: 240px" @update:model-value="(v: string | null) => (search = coerceSearch(v))" />
  </div>
  <div class="text-body-2 mb-2" data-testid="ledger-total">
    {{ page.data.value?.total ?? 0 }} expenses · {{ yen(page.data.value?.totalJpy ?? 0) }}
  </div>
  <v-data-table-server
    :headers="headers" :items="page.data.value?.items ?? []" :items-length="page.data.value?.total ?? 0" :loading="page.isFetching.value"
    :page="state().page" :items-per-page="PAGE_SIZE" :items-per-page-options="[PAGE_SIZE]" :sort-by="sortFromRoute(route.query)"
    must-sort hover @update:options="onOptions" @click:row="(_e: unknown, { item }: { item: Transaction }) => router.push(`/spend/${item.id}`)">
    <template #[`item.category`]="{ item }">
      <v-icon size="x-small" :color="catName(item.categoryId)?.color">mdi-circle</v-icon> {{ catName(item.categoryId)?.name }}
    </template>
    <template #[`item.description`]="{ item }">
      <!-- A real link gives keyboard users a way to reach and open a row, not only a mouse click. -->
      <router-link :to="`/spend/${item.id}`" @click.stop>{{ item.description || '(no description)' }}</router-link>
    </template>
    <template #[`item.amountJpy`]="{ item }">
      <div>{{ yen(item.amountJpy) }}</div>
      <div v-if="item.amountInrPaise !== null" class="text-caption text-medium-emphasis">{{ rupees(item.amountInrPaise) }}</div>
    </template>
    <template #[`item.paymentMethod`]="{ item }">{{ PAYMENT_LABELS[item.paymentMethod] }}</template>
    <template #[`item.needWant`]="{ item }">{{ NEED_LABELS[item.needWant] }}</template>
    <template #no-data>No expenses match these filters.</template>
  </v-data-table-server>
  <v-snackbar :model-value="!!undo.pending.value" timeout="5000" @update:model-value="(v) => { if (!v) undo.pending.value = null }">
    Deleted
    <template #actions><v-btn variant="text" :loading="restore.isPending.value" @click="restore.mutate()">Undo</v-btn></template>
  </v-snackbar>
  <v-snackbar :model-value="!!restoreError" color="error" @update:model-value="(v) => { if (!v) restoreError = '' }">
    {{ restoreError }}
  </v-snackbar>
</template>
