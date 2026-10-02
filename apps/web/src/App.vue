<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import { supabase } from './lib/supabase'

const route = useRoute()
const router = useRouter()
async function signOut() {
  await supabase.auth.signOut()
  await router.push('/login')
}
</script>

<template>
  <v-app>
    <v-app-bar v-if="!route.meta.public" density="comfortable" title="NRI Finance">
      <v-btn to="/" variant="text">Home</v-btn>
      <v-btn to="/settings" variant="text">Settings</v-btn>
      <v-btn variant="text" @click="signOut">Sign out</v-btn>
    </v-app-bar>
    <v-main>
      <v-container class="py-6" style="max-width: 760px">
        <router-view />
      </v-container>
    </v-main>
  </v-app>
</template>
