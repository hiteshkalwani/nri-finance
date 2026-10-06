<script setup lang="ts">
import { computed } from 'vue'
import type { NetWorthResponse } from '@nri/contracts'
import { emergencyFundPct, netWorthChangeDisplay } from '../lib/accounts'
import { yen } from '../lib/format'

// `null` while the Dashboard's own `/api/networth` query is still loading (or errored) — both
// cards then show their own indeterminate bar rather than any figures.
const props = defineProps<{ nw: NetWorthResponse | null }>()

// Spec §4.4: an empty `series` means the user has never saved a balance — neither card's figures
// mean anything yet, so both show the same "Update balances to see this." empty state instead.
const hasBalances = computed(() => (props.nw?.series.length ?? 0) > 0)
const change = computed(() => (props.nw ? netWorthChangeDisplay(props.nw.current.changeJpy, props.nw.current.changePct, yen) : null))
const efGoalJpy = computed(() => props.nw?.emergencyFund.goalJpy ?? null)
const efPct = computed(() => (props.nw ? emergencyFundPct(props.nw.emergencyFund.balanceJpy, efGoalJpy.value) : null))
</script>

<template>
  <v-card class="nwc">
    <div class="hd"><div class="eyebrow">Net worth</div></div>
    <v-progress-linear v-if="!nw" indeterminate />
    <template v-else-if="hasBalances">
      <div class="nw-body">
        <b class="num" data-testid="networth">{{ yen(nw.current.combinedJpy) }}</b>
        <template v-if="change">
          <span :class="change.up ? 'text-success' : 'text-error'" class="font-weight-medium num">{{ change.text }}</span>
          <span class="muted">since last cycle</span>
        </template>
        <span v-else class="muted">first cycle</span>
      </div>
      <div class="card-ft"><v-btn to="/accounts" variant="text" size="small">View accounts</v-btn></div>
    </template>
    <p v-else class="pa-5 mb-0 text-medium-emphasis">
      <router-link to="/accounts/balances">Update balances to see this.</router-link>
    </p>
  </v-card>

  <v-card class="nwc" data-testid="emergency-fund">
    <div class="hd"><div class="eyebrow">Emergency fund</div></div>
    <v-progress-linear v-if="!nw" indeterminate />
    <template v-else-if="hasBalances">
      <div class="ef">
        <div class="efv">
          <b class="num">{{ yen(nw.emergencyFund.balanceJpy) }}</b>
          <span v-if="efGoalJpy !== null">of {{ yen(efGoalJpy) }} goal</span>
        </div>
        <div v-if="efGoalJpy !== null" class="bar-mini">
          <i :style="{ width: `${efPct ?? 0}%`, background: 'rgb(var(--v-theme-success-accent))' }" />
        </div>
        <div class="efm">
          <template v-if="nw.emergencyFund.monthsCovered !== null">
            Covers <b class="num">{{ nw.emergencyFund.monthsCovered.toFixed(1) }} months</b> of spending
          </template>
          <template v-else>—</template>
        </div>
      </div>
    </template>
    <p v-else class="pa-5 mb-0 text-medium-emphasis">
      <router-link to="/accounts/balances">Update balances to see this.</router-link>
    </p>
  </v-card>
</template>

<style scoped>
.hd {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 20px 4px;
}
.nw-body {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  padding: 2px 20px 14px;
}
.nw-body b {
  font-size: 22px;
  letter-spacing: -0.3px;
}
.muted {
  color: rgb(var(--v-theme-on-surface-variant));
}
.card-ft {
  padding: 0 20px 16px;
}
.ef {
  padding: 2px 20px 18px;
}
.efv {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 8px;
}
.efv b {
  font-size: 18px;
}
.efv span {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 13px;
}
.bar-mini {
  height: 8px;
  border-radius: 999px;
  background: rgb(var(--v-theme-surface-variant));
  overflow: hidden;
}
.bar-mini i {
  display: block;
  height: 100%;
}
.efm {
  margin-top: 8px;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 13px;
}
.efm b {
  color: rgb(var(--v-theme-on-surface));
}
</style>
