import { createApp } from 'vue'
import { createVuetify } from 'vuetify'
import 'vuetify/styles'
import '@mdi/font/css/materialdesignicons.css'
import { VueQueryPlugin } from '@tanstack/vue-query'
import App from './App.vue'
import { router } from './router'
import { setOnUnauthorized } from './lib/api'
import { redirectToLogin } from './lib/unauthorized'

setOnUnauthorized(() => void redirectToLogin(router))

createApp(App)
  .use(router)
  .use(VueQueryPlugin)
  .use(createVuetify({ theme: { defaultTheme: 'light' } }))
  .mount('#app')
