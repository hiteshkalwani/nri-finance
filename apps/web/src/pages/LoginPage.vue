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
  <div class="d-flex flex-column align-center" style="min-height: 80vh; justify-content: center">
    <div class="mark mb-4">¥₹</div>
    <v-card class="mx-auto" max-width="420" width="100%">
      <v-card-title class="text-h5 font-weight-bold pt-6">Sign in</v-card-title>
      <v-card-text>
        <v-form @submit.prevent="submit">
          <v-text-field id="email" v-model="email" label="Email" type="email" autocomplete="username" required />
          <v-text-field id="password" v-model="password" label="Password" type="password" autocomplete="current-password" required />
          <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>
          <v-btn type="submit" color="primary" block :loading="busy">Sign in</v-btn>
        </v-form>
      </v-card-text>
    </v-card>
  </div>
</template>

<style scoped>
.mark {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: rgb(var(--v-theme-primary));
  color: #fff;
  display: grid;
  place-items: center;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.5px;
}
</style>
