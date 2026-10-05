<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDisplay } from 'vuetify'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { Transaction, TransactionPage, type NeedWant, type PaymentMethod } from '@nri/contracts'
import { cycleOf, lastCycles, todayIn } from '@nri/core'
import ExpenseRow from '../components/ExpenseRow.vue'
import PageHeader from '../components/PageHeader.vue'
import { apiFetch, ApiRequestError, retryUnlessClientError } from '../lib/api'
import { useCategories } from '../lib/categories'
import { NEED_LABELS, PAYMENT_LABELS } from '../lib/expenseForm'
import { cycleLabel, yen } from '../lib/format'
import { groupByDate, isPartialPageGroup, pageCount } from '../lib/groups'
import {
  coercePage,
  coerceSearch,
  PAGE_SIZE,
  routeQueryFrom,
  routeSearchValue,
  SORT_OPTIONS,
  sortFromRoute,
  sortFromValue,
  sortValue,
  toApiQuery,
  type LedgerState,
} from '../lib/ledger'
import { useProfile } from '../lib/profile'
import { undo } from '../lib/undo'

const route = useRoute()
const router = useRouter()
const qc = useQueryClient()
const { xs } = useDisplay()
const me = useProfile()
const cats = useCategories()
const startDay = computed(() => me.data.value?.profile?.cycleStartDay ?? 25)
const current = computed(() => cycleOf(todayIn(me.data.value?.profile?.timezone ?? 'Asia/Tokyo'), startDay.value))
const cycleOptions = computed(() => [
  { title: 'All cycles', value: 'all' },
  ...lastCycles(current.value, 24).reverse().map((c) => ({ title: cycleLabel(c, startDay.value), value: c })),
])
const catOf = (id: string) => cats.data.value?.find((c) => c.id === id)
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
  // Explicit here too (main.ts sets the same as the app-wide default): a 4xx filter/sort/page
  // combination will never succeed by retrying it, so don't make the error message wait on it.
  retry: retryUnlessClientError,
})

const items = computed(() => page.data.value?.items ?? [])
const totalPages = computed(() => pageCount(page.data.value?.total ?? 0, PAGE_SIZE))
// Grouping (spec §4.2) only makes sense while the list is actually in date order — any other sort
// shows a flat list instead, same rows, no day headers.
const isDateSort = computed(() => sortFromRoute(route.query)[0]!.key === 'occurredOn')
const groups = computed(() => groupByDate(items.value))

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
    page: coercePage(route.query.page),
  }
}
// Explicit path: a late-firing (debounced) push must never land on whatever page the user has since navigated to.
function push(change: Partial<LedgerState>) { void router.replace({ path: '/spend', query: routeQueryFrom({ ...state(), ...change }) }) }

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
  <PageHeader title="Spend">
    <v-select
      :model-value="cycleParam"
      :items="cycleOptions"
      label="Cycle"
      density="compact"
      hide-details
      class="cycle-select"
      style="max-width: 220px"
      @update:model-value="(v) => push({ cycle: v === current ? null : v, page: 1 })"
    />
    <!-- The bottom-nav's raised "+" already covers Add expense on phones. -->
    <v-btn v-if="!xs" to="/spend/new" color="primary" prepend-icon="mdi-plus">Add expense</v-btn>
  </PageHeader>

  <v-card>
    <div class="filters">
      <v-select
        :model-value="state().categoryId"
        :items="cats.data.value ?? []"
        item-title="name"
        item-value="id"
        label="Category"
        clearable
        density="compact"
        hide-details
        style="flex: 0 0 160px"
        @update:model-value="(v) => push({ categoryId: v, page: 1 })"
      />
      <v-select
        :model-value="state().paymentMethod"
        :items="Object.entries(PAYMENT_LABELS).map(([value, title]) => ({ value, title }))"
        label="Payment method"
        clearable
        density="compact"
        hide-details
        style="flex: 0 0 205px"
        @update:model-value="(v) => push({ paymentMethod: v, page: 1 })"
      />
      <v-select
        :model-value="state().needWant"
        :items="Object.entries(NEED_LABELS).map(([value, title]) => ({ value, title }))"
        label="Need or want"
        clearable
        density="compact"
        hide-details
        style="flex: 0 0 180px"
        @update:model-value="(v) => push({ needWant: v, page: 1 })"
      />
      <v-text-field
        id="search"
        :model-value="search"
        label="Search"
        prepend-inner-icon="mdi-magnify"
        clearable
        density="compact"
        hide-details
        style="flex: 1 1 160px"
        @update:model-value="(v: string | null) => (search = coerceSearch(v))"
      />
      <v-select
        :model-value="sortValue(route.query)"
        :items="SORT_OPTIONS"
        label="Sort"
        density="compact"
        hide-details
        style="flex: 0 0 210px"
        @update:model-value="(v) => push({ sort: sortFromValue(v), page: 1 })"
      />
    </div>

    <div class="totbar" data-testid="ledger-total">
      <span><b class="num">{{ page.data.value?.total ?? 0 }}</b> expenses · <b class="num">{{ yen(page.data.value?.totalJpy ?? 0) }}</b></span>
      · <span>Needs <b class="num">{{ yen(page.data.value?.needJpy ?? 0) }}</b></span>
      · <span>Wants <b class="num">{{ yen(page.data.value?.wantJpy ?? 0) }}</b></span>
    </div>
    <v-progress-linear v-if="page.isFetching.value" indeterminate />

    <template v-if="page.error.value">
      <p class="pa-5 mb-0 text-error">
        {{ page.error.value instanceof ApiRequestError ? page.error.value.message : 'Could not load expenses.' }}
      </p>
    </template>
    <template v-else-if="!page.isFetching.value && items.length === 0">
      <p class="pa-5 mb-0 text-medium-emphasis">No expenses match these filters.</p>
    </template>
    <template v-else-if="isDateSort">
      <template v-for="(g, i) in groups" :key="g.date">
        <div class="day-row" role="heading" aria-level="3">
          <span>{{ g.label }}</span>
          <span class="num">{{ yen(g.totalJpy) }}{{ isPartialPageGroup(i, groups.length, totalPages, state().page) ? ' on this page' : '' }}</span>
        </div>
        <!-- Each day's rows are their own list — day-row headers sit outside it (role="heading"
             above), so role="list" here only ever has role="listitem" children (valid ARIA). -->
        <div role="list" :aria-label="`Expenses on ${g.label}`">
          <ExpenseRow v-for="t in g.rows" :key="t.id" :t="t" :category="catOf(t.categoryId)" role="listitem" />
        </div>
      </template>
    </template>
    <template v-else>
      <div role="list" aria-label="Expenses">
        <ExpenseRow v-for="t in items" :key="t.id" :t="t" :category="catOf(t.categoryId)" role="listitem" />
      </div>
    </template>
  </v-card>

  <div v-if="totalPages > 1" class="d-flex justify-center mt-4">
    <v-pagination :model-value="state().page" :length="totalPages" density="comfortable" @update:model-value="(p: number) => push({ page: p })" />
  </div>

  <v-snackbar :model-value="!!undo.pending.value" timeout="5000" @update:model-value="(v) => { if (!v) undo.pending.value = null }">
    Deleted
    <template #actions><v-btn variant="text" :loading="restore.isPending.value" @click="restore.mutate()">Undo</v-btn></template>
  </v-snackbar>
  <v-snackbar :model-value="!!restoreError" color="error" @update:model-value="(v) => { if (!v) restoreError = '' }">
    {{ restoreError }}
  </v-snackbar>
</template>

<style scoped>
/* Rounds the cycle select's field to echo the mockup's pill-shaped cycle picker (`.cycle`),
   rather than Vuetify's default outlined-field corners. */
.cycle-select :deep(.v-field) {
  border-radius: 10px;
}

.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 14px 20px;
  border-bottom: 1px solid rgb(var(--v-border-color));
}
/* Each select above sets its own `flex: 0 0 <width>` (fixed, no grow/shrink) rather than relying
   on the browser's default auto-sizing, which otherwise renders some selects a bit narrower than
   their label needs — that silently truncated "Payment method" to "Payment met…" with a cap this
   generous. The four fixed widths (plus Search's own flex-basis and the 8px gaps) are sized to
   fit on one row at the laptop width the mockup assumes (1280px, with the 232px sidebar) without
   any of them truncating — checked against "Payment method" and every SORT_OPTIONS title, the two
   widest labels. Search is the one control that actually flexes, so it absorbs whatever room is
   left over. Below 600px, every filter control takes the full row instead (its inline `flex`
   needs `!important` to win over that fixed basis). */
@media (max-width: 600px) {
  .filters > * {
    flex: 1 1 100% !important;
  }
}

.totbar {
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
  padding: 10px 20px;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 13px;
}
.totbar b {
  color: rgb(var(--v-theme-on-surface));
}
</style>
