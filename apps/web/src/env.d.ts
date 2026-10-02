/// <reference types="vite/client" />
interface ImportMetaEnv { readonly VITE_SUPABASE_URL: string; readonly VITE_SUPABASE_ANON_KEY: string }
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const c: DefineComponent
  export default c
}
