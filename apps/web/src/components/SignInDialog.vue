<script setup lang="ts">
import { ref } from 'vue'
import { useQueryClient } from '@tanstack/vue-query'
import { closeSignIn, session } from '../lib/session'
import { supabase } from '../lib/supabase'

const qc = useQueryClient()
const email = ref('')
const password = ref('')
const error = ref('')
const busy = ref(false)

async function submit() {
  busy.value = true
  error.value = ''
  const { error: e } = await supabase.auth.signInWithPassword({ email: email.value, password: password.value })
  busy.value = false
  if (e) { error.value = 'Email or password is incorrect.'; return }
  password.value = ''
  closeSignIn()
  await qc.invalidateQueries() // refetch whatever failed with 401; forms keep their state
}
</script>

<template>
  <v-dialog :model-value="session.dialogOpen.value" persistent max-width="420">
    <v-card>
      <v-card-title class="text-h5 font-weight-bold pt-6">Your session expired</v-card-title>
      <v-card-text>
        <p class="mb-4">Sign in again to continue. Nothing you typed has been lost; save again after signing in.</p>
        <v-form @submit.prevent="submit">
          <v-text-field id="dialog-email" v-model="email" label="Email" type="email" autocomplete="username" />
          <v-text-field id="dialog-password" v-model="password" label="Password" type="password" autocomplete="current-password" />
          <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>
          <v-btn type="submit" color="primary" block :loading="busy">Sign in</v-btn>
        </v-form>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>
