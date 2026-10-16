<script setup lang="ts">
import { computed } from 'vue'
import type { Dashboard } from '@nri/contracts'
import { stateWord } from '../lib/budgetsForm'
import { safeColor } from '../lib/color'
import { rupees, yen } from '../lib/format'
import { targetStateText, TARGET_CURRENCY, TARGET_LABELS } from '../lib/targetsForm'

// Both cards are hidden entirely when there's nothing to show (DASH-9/TGT-2), same pattern as
// NetWorthEmergencyFundCards' loan/sip cards — never an empty-state card nobody asked to see.
const props = defineProps<{ budgets: Dashboard['budgets']; targets: Dashboard['targets'] }>()
const hasBudgetAlerts = computed(() => props.budgets.rows.length > 0)
const fmtFor = (key: (typeof props.targets)[number]['key']) => (TARGET_CURRENCY[key] === 'INR' ? rupees : yen)
</script>

<template>
  <v-card v-if="hasBudgetAlerts" class="btc" data-testid="budgets-card">
    <div class="hd">
      <div class="eyebrow">Budgets</div>
      <span class="muted">{{ budgets.overCount }} over · {{ budgets.nearCount }} near</span>
    </div>
    <div v-for="row in budgets.rows" :key="row.categoryId" class="kv">
      <span><span class="dot" aria-hidden="true" :style="{ background: safeColor(row.color) }" />{{ row.name }}</span>
      <span class="num">
        <b :class="row.state === 'over' ? 'text-error' : row.state === 'near' ? 'text-warning' : ''">{{ stateWord(row) }}</b>
        <span v-if="row.pct !== null" class="muted ml-1">{{ row.pct }}%</span>
      </span>
    </div>
    <div class="card-ft"><v-btn to="/budgets" variant="text" size="small">View budgets</v-btn></div>
  </v-card>

  <v-card v-if="targets.length" class="btc" data-testid="targets-card">
    <div class="hd"><div class="eyebrow">Targets</div></div>
    <div v-for="row in targets" :key="row.key" class="kv">
      <span>{{ TARGET_LABELS[row.key] }}</span>
      <span class="num">
        <b>{{ fmtFor(row.key)(row.actualValue) }}</b>
        <span class="muted"> / {{ fmtFor(row.key)(row.targetValue) }}</span>
        <b class="ml-1" :class="row.met ? 'text-success' : 'text-error'">{{ targetStateText(row, fmtFor(row.key)) }}</b>
      </span>
    </div>
  </v-card>
</template>

<style scoped>
.hd {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 20px 10px;
  flex-wrap: wrap;
}
.eyebrow {
  font-size: 12px;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: rgb(var(--v-theme-on-surface-variant));
  font-weight: 600;
}
.muted {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 12.5px;
}
.kv {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  border-top: 1px solid rgb(var(--v-border-color));
  font-size: 13.5px;
}
.kv > span:first-child {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex: none;
}
.card-ft {
  padding: 2px 16px 12px;
}
</style>
