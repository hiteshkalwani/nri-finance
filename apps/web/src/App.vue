<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDisplay } from 'vuetify'
import { useQueryClient } from '@tanstack/vue-query'
import SignInDialog from './components/SignInDialog.vue'
import { supabase } from './lib/supabase'

const route = useRoute()
const router = useRouter()
const qc = useQueryClient()
const { smAndDown } = useDisplay()
const signedInPage = computed(() => !route.meta.public)
const nav = [
  { title: 'Dashboard', icon: 'mdi-view-dashboard-outline', to: '/' },
  { title: 'Spend', icon: 'mdi-format-list-bulleted', to: '/spend' },
  { title: 'Settings', icon: 'mdi-cog-outline', to: '/settings' },
]

async function signOut() {
  qc.clear() // nothing from this account stays in memory
  await supabase.auth.signOut()
  await router.push('/login')
}
</script>

<template>
  <v-app>
    <template v-if="signedInPage">
      <v-app-bar density="comfortable" title="NRI Finance">
        <template #append>
          <v-btn v-if="!smAndDown" to="/spend/new" color="primary" variant="flat" prepend-icon="mdi-plus">Add expense</v-btn>
          <v-btn variant="text" @click="signOut">Sign out</v-btn>
        </template>
      </v-app-bar>
      <v-navigation-drawer v-if="!smAndDown" permanent width="200">
        <v-list nav>
          <v-list-item v-for="n in nav" :key="n.to" :to="n.to" :prepend-icon="n.icon" :title="n.title" :exact="n.to === '/'" />
        </v-list>
      </v-navigation-drawer>
      <v-bottom-navigation v-else grow>
        <v-btn to="/" exact><v-icon>mdi-view-dashboard-outline</v-icon><span>Dashboard</span></v-btn>
        <v-btn to="/spend" exact><v-icon>mdi-format-list-bulleted</v-icon><span>Spend</span></v-btn>
        <v-btn to="/spend/new" color="primary" aria-label="Add expense"><v-icon>mdi-plus-circle</v-icon><span>Add</span></v-btn>
        <v-btn to="/settings"><v-icon>mdi-dots-horizontal</v-icon><span>More</span></v-btn>
      </v-bottom-navigation>
    </template>
    <v-main>
      <v-container class="py-6" style="max-width: 1100px">
        <router-view />
      </v-container>
    </v-main>
    <SignInDialog />
  </v-app>
</template>
