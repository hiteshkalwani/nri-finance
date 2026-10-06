<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useMutation, useQueryClient } from '@tanstack/vue-query'
import { Transaction, type NeedWant, type PaymentMethod } from '@nri/contracts'
import { todayIn } from '@nri/core'
import CategoryAvatar from '../components/CategoryAvatar.vue'
import { apiFetch, ApiRequestError } from '../lib/api'
import { activeCategories, useCategories } from '../lib/categories'
import {
  defaultsFor, lastUsedNeedWantHint, lastUsedPaymentHint, NEED_LABELS, PAYMENT_LABELS,
  parseAmount, previewJpy, type Currency,
} from '../lib/expenseForm'
import { dateHint, yen } from '../lib/format'
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

const selectedCategory = computed(() => active.value.find((c) => c.id === categoryId.value))

/**
 * Focus the amount field once, synchronously, right on mount — not via Vuetify's `autofocus`
 * prop. That prop's own mechanism (vuetify/lib/composables/autofocus.js) waits for an
 * IntersectionObserver to report the field visible, then waits *another* 50ms before calling
 * `focus()`. That delay is a real race (the known flake this guards against): typing into another
 * field inside that window — e.g. moving straight to the description field, by hand or in a test —
 * gets its focus stolen back to #amount once the delayed call finally fires. Focusing here instead,
 * once, with no delay and nothing to re-trigger it, removes the window entirely.
 *
 * The guard is "is focus already inside this page's form", not "is nothing focused at all"
 * (`=== document.body`): arriving here via the persistent sidebar/bottom-nav "Add expense" link
 * (App.vue, outside this `<router-view>`) leaves *that* link focused across the route change —
 * not body — so a body-only check would wrongly skip focusing #amount on every real navigation.
 * Only an element already inside this form (the user, or a test, got there first) should block it.
 */
const formRef = ref<{ contains: (n: Node | null) => boolean } | null>(null)
const amountFieldRef = ref<{ focus: () => void } | null>(null)
onMounted(() => {
  if (!formRef.value?.contains(document.activeElement)) amountFieldRef.value?.focus()
})

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

const today = computed(() => todayIn(profile.value?.timezone ?? 'Asia/Tokyo'))
const parsed = computed(() => parseAmount(amount.value, currency.value))
const preview = computed(() => (currency.value === 'INR' && profile.value ? previewJpy(amount.value, profile.value.planningRateJpyPerInr) : null))
const paymentHint = computed(() => lastUsedPaymentHint(selectedCategory.value, paymentMethod.value))
const needWantHint = computed(() => lastUsedNeedWantHint(selectedCategory.value, needWant.value))

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
  <h1 class="text-h5 font-weight-bold mb-4">Add expense</h1>
  <v-alert v-if="me.data.value && !profile" type="info" variant="tonal">
    Set up your profile first in <router-link to="/settings">Settings</router-link>.
  </v-alert>
  <v-form v-else ref="formRef" class="quick-add" @submit.prevent="submit">
    <div class="amount-card">
      <div class="row1">
        <v-text-field
          id="amount" ref="amountFieldRef" v-model="amount" :label="currency === 'JPY' ? 'Amount (¥)' : 'Amount (₹)'"
          inputmode="decimal" variant="plain" hide-details class="amount-input num"
        />
        <v-btn-toggle v-model="currency" mandatory density="comfortable" class="cur" aria-label="Currency">
          <v-btn value="JPY" aria-label="Yen" :aria-pressed="currency === 'JPY'">¥</v-btn>
          <v-btn value="INR" aria-label="Rupees" :aria-pressed="currency === 'INR'">₹</v-btn>
        </v-btn-toggle>
      </div>
      <div v-if="preview !== null" class="preview">≈ {{ yen(preview) }} at the planning rate</div>
      <div class="hint">{{ dateHint(occurredOn, today) }}</div>
    </div>

    <div class="lbl">Category</div>
    <!-- `ripple="false"` on every chip below (category, payment, need/want): the click-feedback
         ripple is a separate element (`.v-ripple__animation`, inside `.v-ripple__container`) from
         `.v-chip__overlay` above — fix round 1's overlay opacity:0 rule was right but incomplete.
         Its fade-out is a real CSS transition (0.3s, vuetify/lib/directives/ripple's
         `.v-ripple__animation--out`), so a screenshot/a real click followed by a quick glance can
         still catch it mid-fade as a dark, semi-transparent wash over the tile (confirmed in a
         real browser via getComputedStyle: `.v-ripple__animation--in`'s background-color was a
         near-black colour at opacity 0.25, `data-is-hiding="true"`, ~150ms after the click — well
         short of the 300ms fade). Disabling ripple here removes the element outright, so there is
         nothing left that could ever paint over the tile regardless of timing. -->
    <v-chip-group v-model="categoryId" mandatory show-arrows="never" role="radiogroup" aria-label="Category" class="cat-group">
      <v-chip v-for="c in active" :key="c.id" :value="c.id" variant="outlined" :ripple="false" role="radio" :aria-checked="categoryId === c.id" class="cat-tile">
        <CategoryAvatar :category="c" :size="30" />
        <span class="cat-name">{{ c.name }}</span>
        <v-icon v-if="categoryId === c.id" size="13" class="cat-check" aria-hidden="true">mdi-check-circle</v-icon>
      </v-chip>
    </v-chip-group>

    <v-text-field id="date" v-model="occurredOn" label="Date" type="date" class="mt-2" density="compact" />

    <div class="lbl">Paid with <span v-if="paymentHint" class="lbl-note">· last used for {{ paymentHint }}</span></div>
    <v-chip-group v-model="paymentMethod" mandatory role="radiogroup" aria-label="Payment method" class="chip-row">
      <v-chip
        v-for="(label, key) in PAYMENT_LABELS" :key="key" :value="key" variant="outlined" :ripple="false" role="radio"
        :aria-checked="paymentMethod === key" class="c2"
      >
        <v-icon v-if="paymentMethod === key" size="13" start aria-hidden="true">mdi-check</v-icon>{{ label }}
      </v-chip>
    </v-chip-group>

    <div class="lbl">Need or want <span v-if="needWantHint" class="lbl-note">· last used for {{ needWantHint }}</span></div>
    <v-chip-group v-model="needWant" mandatory role="radiogroup" aria-label="Need or want" class="chip-row">
      <v-chip
        v-for="(label, key) in NEED_LABELS" :key="key" :value="key" variant="outlined" :ripple="false" role="radio"
        :aria-checked="needWant === key" class="c2"
      >
        <v-icon v-if="needWant === key" size="13" start aria-hidden="true">mdi-check</v-icon>{{ label }}
      </v-chip>
    </v-chip-group>

    <v-text-field id="description" v-model="description" label="Description (optional)" counter="200" maxlength="200" class="mt-2" />
    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>
    <v-btn type="submit" color="primary" size="large" block class="save-btn" :loading="save.isPending.value">Save</v-btn>
  </v-form>

  <v-snackbar :model-value="!!saved" timeout="6000" @update:model-value="saved = null">
    <v-icon size="16" class="mr-1" aria-hidden="true">mdi-check-circle</v-icon>
    <span data-testid="saved">{{ saved }}</span>
    <template #actions>
      <v-btn variant="text" @click="saved = null">Add another</v-btn>
      <v-btn variant="text" @click="router.push('/spend')">View in ledger</v-btn>
    </template>
  </v-snackbar>
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
/* White-on-`primary` fails spec §7's 4.5:1 text-contrast minimum in both themes (measured
   3.12:1 light, 2.53:1 dark — `primary` is a bright/light accent in both). `primary-darken-1`
   (src/theme.ts) is a darker shade of the same hue for light theme (6.72:1 with white here); dark
   theme's `primary` is already light enough that dark text reads cleanly against it instead
   (6.65:1) — there's no "on-primary" token for that in theme.ts, so it's the one hardcoded value
   here, matching light theme's own on-surface/on-background hex exactly (verified in
   theme.test.ts, not just eyeballed). */
.cur :deep(.v-btn--active.v-theme--light) {
  background: rgb(var(--v-theme-primary-darken-1));
  color: #fff;
}
.cur :deep(.v-btn--active.v-theme--dark) {
  background: rgb(var(--v-theme-primary));
  color: #1d1d1f;
}
.preview,
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
.lbl-note {
  text-transform: none;
  letter-spacing: 0;
  font-weight: 500;
}

/* The category grid keeps v-chip-group for its radiogroup/keyboard behaviour (role="radiogroup",
   each chip role="radio"), but its default rendering is a single scrolling row (VSlideGroup) —
   overridden here into the mockup's tile grid (3 per row on phones, 6 on wide). */
.cat-group :deep(.v-slide-group__container) {
  overflow: visible;
}
.cat-group :deep(.v-slide-group__prev),
.cat-group :deep(.v-slide-group__next) {
  display: none !important;
}
.cat-group :deep(.v-slide-group__content) {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 8px;
  flex-wrap: unset;
  /* `.v-slide-group__content` is itself a flex item of `.v-slide-group__container` (built for a
     horizontally-scrolling row, sized to its content's natural width by default) — width/flex here
     make it fill that container instead, so the grid's `1fr` tracks divide the real available
     width rather than the content's own hug-width. */
  width: 100%;
  flex: 1 1 auto;
  transform: none !important;
}
@media (max-width: 600px) {
  .cat-group :deep(.v-slide-group__content) {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
.cat-group :deep(.v-chip) {
  margin: 0;
  height: auto;
  width: 100%;
  min-width: 0;
  max-width: none;
  box-sizing: border-box;
  flex-direction: column;
  justify-content: center;
  padding: 10px 6px;
  border-radius: 12px;
  border: 1px solid rgb(var(--v-border-color));
  background: rgb(var(--v-theme-surface));
  font-size: 12.5px;
  font-weight: 500;
  position: relative;
}
.cat-group :deep(.v-chip__content) {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
}
.cat-name {
  display: block;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
}
.cat-group :deep(.v-chip--selected) {
  background: rgb(var(--v-theme-surface)) !important;
  border-color: rgb(var(--v-theme-primary));
  box-shadow: 0 0 0 2px rgba(var(--v-theme-primary), 0.16);
}
/* The chip's own `.v-chip__overlay` paints `currentColor` over the chip at some opacity for its
   interaction states (hover/focus/selected) — independent of the `background` above, which it
   sits on top of. Left alone, the selected state's overlay shows as a muddy grey wash over the
   tile (on-surface currentColor at low opacity) instead of the mockup's unchanged white/surface
   tile with just a border + ring. Suppressing it keeps the tile's own background visible; the
   border, ring and check icon still carry the selected signal. */
.cat-group :deep(.v-chip--selected .v-chip__overlay) {
  opacity: 0 !important;
}
.cat-check {
  position: absolute;
  top: 4px;
  right: 4px;
  color: rgb(var(--v-theme-primary));
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
/* Selected payment/need-want chip is an inverse (dark-on-light / light-on-dark) fill, not the
   accent colour — matches the mockup's `.c2.on` and keeps the selected state a shape+fill signal
   (plus the check icon above), not colour alone (spec §7). */
.chip-row :deep(.v-chip--selected) {
  background: rgb(var(--v-theme-on-surface));
  border-color: rgb(var(--v-theme-on-surface));
  color: rgb(var(--v-theme-surface));
}

.save-btn {
  margin-top: 8px;
  border-radius: 14px;
  padding: 14px 0;
  font-size: 15px;
}
</style>
