<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDisplay } from 'vuetify'
import { useQueryClient } from '@tanstack/vue-query'
import SignInDialog from './components/SignInDialog.vue'
import { supabase } from './lib/supabase'
import { undo } from './lib/undo'
import { useThemePref } from './lib/useThemePref'

const route = useRoute()
const router = useRouter()
const qc = useQueryClient()
const { xs } = useDisplay()
const signedInPage = computed(() => !route.meta.public)
const nav = [
  { title: 'Dashboard', icon: 'mdi-home-outline', to: '/' },
  { title: 'Spend', icon: 'mdi-credit-card-outline', to: '/spend' },
  { title: 'Settings', icon: 'mdi-cog-outline', to: '/settings' },
]

const { pref: themePref, cycleThemePref } = useThemePref()
const themeWord = computed(() => (themePref.value === 'system' ? 'System' : themePref.value === 'light' ? 'Light' : 'Dark'))
const themeIcon = computed(() =>
  themePref.value === 'system' ? 'mdi-theme-light-dark' : themePref.value === 'light' ? 'mdi-white-balance-sunny' : 'mdi-weather-night',
)
const themeAriaLabel = computed(() => `Theme: ${themeWord.value}`)

async function signOut() {
  qc.clear() // nothing from this account stays in memory
  undo.pending.value = null // a pending Undo must not survive sign-out into the next session
  await supabase.auth.signOut()
  await router.push('/login')
}
</script>

<template>
  <v-app>
    <template v-if="signedInPage">
      <!-- Wide: a permanent sidebar carries the brand, nav and sign out; each page renders its own
           header row (Tasks 5-8's PageHeader), so there is no app bar here. -->
      <v-navigation-drawer v-if="!xs" permanent width="232" color="background" class="side-drawer">
        <div class="brand">
          <span class="mark">¥₹</span>
          <span>NRI Finance</span>
        </div>
        <v-list nav density="comfortable" class="px-2">
          <v-list-item
            v-for="n in nav"
            :key="n.to"
            :to="n.to"
            :prepend-icon="n.icon"
            :title="n.title"
            :exact="n.to === '/'"
            rounded="lg"
            active-class="bg-surface-variant"
          />
        </v-list>
        <template #append>
          <v-divider class="mb-2" />
          <v-btn
            variant="text"
            block
            class="justify-start px-4 mb-1"
            :prepend-icon="themeIcon"
            :aria-label="themeAriaLabel"
            @click="cycleThemePref"
          >
            {{ themeWord }}
          </v-btn>
          <v-btn variant="text" block class="justify-start px-4 mb-2" prepend-icon="mdi-logout" @click="signOut">
            Sign out
          </v-btn>
        </template>
      </v-navigation-drawer>

      <!-- Phone: a compact top bar with just the brand, a theme toggle, and a bottom nav with the raised "+". -->
      <v-app-bar v-else density="compact" flat color="background" class="top-bar">
        <span class="mark ml-2">¥₹</span>
        <v-app-bar-title class="font-weight-bold">NRI Finance</v-app-bar-title>
        <v-btn
          variant="text"
          size="small"
          class="mr-2"
          :prepend-icon="themeIcon"
          :aria-label="themeAriaLabel"
          @click="cycleThemePref"
        >
          {{ themeWord }}
        </v-btn>
      </v-app-bar>

      <v-bottom-navigation v-if="xs" grow color="primary" bg-color="surface" class="bottom-nav">
        <v-btn to="/" exact><v-icon>mdi-home-outline</v-icon><span>Dashboard</span></v-btn>
        <v-btn to="/spend" exact><v-icon>mdi-credit-card-outline</v-icon><span>Spend</span></v-btn>
        <v-btn icon to="/spend/new" aria-label="Add expense" class="add-expense-fab">
          <v-icon>mdi-plus</v-icon>
        </v-btn>
        <v-btn to="/settings"><v-icon>mdi-dots-horizontal</v-icon><span>More</span></v-btn>
      </v-bottom-navigation>
    </template>

    <v-main>
      <v-container class="py-6" :style="{ maxWidth: xs ? undefined : '1100px' }">
        <router-view />
      </v-container>
    </v-main>
    <SignInDialog />
  </v-app>
</template>

<style scoped>
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 700;
  font-size: 15px;
  padding: 4px 8px 18px;
}
.mark {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
  display: grid;
  place-items: center;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: -0.5px;
  flex: none;
}
.side-drawer {
  border-right: 1px solid rgb(var(--v-border-color));
}
.top-bar {
  border-bottom: 1px solid rgb(var(--v-border-color));
}
.bottom-nav {
  overflow: visible;
}
.add-expense-fab {
  flex: 0 0 auto !important;
  width: 42px !important;
  min-width: 42px !important;
  height: 42px !important;
  padding: 0 !important;
  border-radius: 50% !important;
  background: rgb(var(--v-theme-primary)) !important;
  /* `on-primary`, not a hardcoded white: white-on-`primary` used to fail spec §7's 4.5:1 minimum
     in both themes (controller ruling, task 8 — see theme.ts). */
  color: rgb(var(--v-theme-on-primary));
  margin-top: -14px;
  box-shadow: 0 4px 12px rgba(240, 104, 46, 0.35);
}
</style>
