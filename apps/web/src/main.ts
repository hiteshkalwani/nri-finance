import { createApp } from 'vue'
import { createVuetify } from 'vuetify'
import 'vuetify/styles'
import '@mdi/font/css/materialdesignicons.css'
import '@fontsource-variable/inter'
import './styles/app.css'
import { VueQueryPlugin } from '@tanstack/vue-query'
import App from './App.vue'
import { router } from './router'
import { setOnUnauthorized } from './lib/api'
import { handleUnauthorized } from './lib/unauthorized'
import { vuetifyOptions } from './theme'
import { loadThemePref, prefersDarkNow, resolveTheme } from './lib/themePref'

setOnUnauthorized(() => void handleUnauthorized(router))

// Resolve the stored/system theme before creating Vuetify (and so before the first paint), so the
// app never flashes the wrong theme — createVuetify generates its theme <style> synchronously.
const initialTheme = resolveTheme(loadThemePref(), prefersDarkNow())

createApp(App)
  .use(router)
  .use(VueQueryPlugin)
  .use(createVuetify({ ...vuetifyOptions, theme: { ...vuetifyOptions.theme, defaultTheme: initialTheme } }))
  .mount('#app')
