<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query'
import { MeResponse } from '@nri/contracts'
import { apiFetch } from '../lib/api'

const me = useQuery({ queryKey: ['me'], queryFn: () => apiFetch('/api/me', {}, MeResponse) })
const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`
</script>

<template>
  <h1 class="text-h5 mb-4">Welcome</h1>
  <v-progress-linear v-if="me.isLoading.value" indeterminate />
  <v-alert v-else-if="me.error.value" type="error" variant="tonal">{{ me.error.value.message }}</v-alert>
  <template v-else-if="me.data.value">
    <p class="mb-4">Signed in as {{ me.data.value.email }}</p>
    <v-card v-if="me.data.value.profile">
      <v-card-text>
        <div data-testid="salary">Salary: {{ yen(me.data.value.profile.salaryJpy) }} / month</div>
        <div>Cycle starts on day {{ me.data.value.profile.cycleStartDay }} ({{ me.data.value.profile.timezone }})</div>
        <div>Planning rate: ¥{{ me.data.value.profile.planningRateJpyPerInr }} per ₹1</div>
      </v-card-text>
    </v-card>
    <v-alert v-else type="info" variant="tonal">
      No profile yet. Go to <router-link to="/settings">Settings</router-link> to import your v1 data or enter it.
    </v-alert>
  </template>
</template>
