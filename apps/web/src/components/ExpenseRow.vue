<script setup lang="ts">
import { computed } from 'vue'
import { useDisplay } from 'vuetify'
import type { Category, Transaction } from '@nri/contracts'
import { NEED_LABELS, PAYMENT_LABELS } from '../lib/expenseForm'
import { rupees, yen } from '../lib/format'
import CategoryAvatar from './CategoryAvatar.vue'

const props = defineProps<{ t: Transaction; category: Category | undefined }>()

const { xs } = useDisplay()

const description = computed(() => props.t.description.trim() || '(no description)')
// A single fallback object for both the avatar's initial and the name shown beside it, so they
// never disagree (an empty colour routes through lib/color's neutral fallback).
const avatarCategory = computed(() => props.category ?? { name: 'Uncategorised', color: '', icon: null })
</script>

<template>
  <router-link :to="`/spend/${t.id}`" class="row expense-row text-body-medium" :class="{ compact: xs }">
    <span class="d">{{ description }}</span>
    <span class="c">
      <CategoryAvatar :category="avatarCategory" :size="24" />
      <span>{{ avatarCategory.name }}</span>
    </span>
    <template v-if="!xs">
      <span class="chip">{{ PAYMENT_LABELS[t.paymentMethod] }}</span>
      <span class="chip" :class="{ want: t.needWant === 'want' }">{{ NEED_LABELS[t.needWant] }}</span>
    </template>
    <span class="amt num">
      {{ yen(t.amountJpy) }}
      <small v-if="t.enteredCurrency === 'INR' && t.amountInrPaise !== null">{{ rupees(t.amountInrPaise) }}</small>
    </span>
    <span v-if="!xs" class="chev" aria-hidden="true">›</span>
  </router-link>
</template>

<style scoped>
.row {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(0, 1.1fr) minmax(0, 0.9fr) 70px 110px 18px;
  gap: 12px;
  align-items: center;
  padding: 12px 20px;
  border-top: 1px solid rgb(var(--v-border-color));
  text-decoration: none;
  color: rgb(var(--v-theme-on-surface));
}
/* Phone (xs): only description, category and amount remain, per spec; fewer grid children
   need a simpler template rather than the 6-column desktop layout. */
.row.compact {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
}
.row:hover {
  background: rgb(var(--v-theme-surface-variant));
  cursor: pointer;
}
.row:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 2px;
}
.d {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.c {
  display: flex;
  gap: 8px;
  align-items: center;
  overflow: hidden;
  white-space: nowrap;
  color: rgb(var(--v-theme-on-surface-variant));
}
.chip {
  font-size: 12px;
  border: 1px solid rgb(var(--v-border-color));
  border-radius: 999px;
  padding: 2px 9px;
  color: rgb(var(--v-theme-on-surface-variant));
  justify-self: start;
  white-space: nowrap;
}
.chip.want {
  border-color: rgb(var(--v-theme-primary));
  /* Not --v-theme-primary: the bright accent fails spec §7's 4.5:1 text-contrast minimum against
     this same tint in light theme (2.74:1 rest / 2.36:1 hover) — primary-darken-1 is a darker
     shade of the same hue that clears it in both themes (see src/theme.ts, apps/web/test/theme.test.ts). */
  color: rgb(var(--v-theme-primary-darken-1));
  background: rgba(var(--v-theme-primary), 0.12);
}
.amt {
  text-align: right;
  font-weight: 600;
}
.amt small {
  display: block;
  color: rgb(var(--v-theme-on-surface-variant));
  font-weight: 500;
  font-size: 11.5px;
}
.chev {
  color: rgb(var(--v-theme-on-surface-variant));
  opacity: var(--v-medium-emphasis-opacity);
}
</style>
