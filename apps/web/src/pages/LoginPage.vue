<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { safeNext } from '../lib/next'
import { supabase } from '../lib/supabase'

const email = ref('')
const password = ref('')
const error = ref('')
const busy = ref(false)
const route = useRoute()
const router = useRouter()

async function submit() {
  busy.value = true
  error.value = ''
  const { error: e } = await supabase.auth.signInWithPassword({ email: email.value, password: password.value })
  busy.value = false
  if (e) { error.value = 'Email or password is incorrect.'; return }
  await router.replace(safeNext(route.query.next))
}
</script>

<template>
  <v-card class="mx-auto mt-12" max-width="420">
    <v-card-title>Sign in</v-card-title>
    <v-card-text>
      <v-form @submit.prevent="submit">
        <v-text-field id="email" v-model="email" label="Email" type="email" autocomplete="username" required />
        <v-text-field id="password" v-model="password" label="Password" type="password" autocomplete="current-password" required />
        <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>
        <v-btn type="submit" color="primary" block :loading="busy">Sign in</v-btn>
      </v-form>
    </v-card-text>
  </v-card>
</template>
