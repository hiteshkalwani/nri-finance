import { createApp } from 'vue'
import { createVuetify } from 'vuetify'
import 'vuetify/styles'
import '@mdi/font/css/materialdesignicons.css'
import '@fontsource-variable/inter'
import './styles/app.css'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import App from './App.vue'
import { router } from './router'
import { retryUnlessClientError, setOnUnauthorized } from './lib/api'
import { handleUnauthorized } from './lib/unauthorized'
import { vuetifyOptions } from './theme'
import { loadThemePref, prefersDarkNow, resolveTheme } from './lib/themePref'

setOnUnauthorized(() => void handleUnauthorized(router))

// Resolve the stored/system theme before creating Vuetify (and so before the first paint), so the
// app never flashes the wrong theme — createVuetify generates its theme <style> synchronously.
const initialTheme = resolveTheme(loadThemePref(), prefersDarkNow())

// A 4xx (bad input, unauthorized, not found, a filter the API rejects, …) is wrong as a request,
// not transiently failed — vue-query's own default (retry: 3, unconditionally) would otherwise
// retry something that can never succeed. A query that needs its own exception (e.g. Dashboard's
// 409 "needs profile") sets its own `retry` option, which overrides this default as usual.
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: retryUnlessClientError } } })

createApp(App)
  .use(router)
  .use(VueQueryPlugin, { queryClient })
  .use(createVuetify({ ...vuetifyOptions, theme: { ...vuetifyOptions.theme, defaultTheme: initialTheme } }))
  .mount('#app')
