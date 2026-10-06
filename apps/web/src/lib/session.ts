import { ref } from 'vue'
import { useQueryClient } from '@tanstack/vue-query'
import { useRouter } from 'vue-router'
import { supabase } from './supabase'
import { undo } from './undo'

/** Session-expiry dialog state, shared by the API client and the dialog component. */
export const session = { dialogOpen: ref(false) }
export const openSignIn = () => { session.dialogOpen.value = true }
export const closeSignIn = () => { session.dialogOpen.value = false }

/**
 * Sign-out, shared by the shell (App.vue's sidebar/top-bar) and Settings' Account card so both use
 * exactly the same steps: clear every cached query and any pending Undo (nothing from this account
 * may survive into the next session), then return to the login page.
 */
export function useSignOut() {
  const qc = useQueryClient()
  const router = useRouter()
  return async function signOut() {
    qc.clear()
    undo.pending.value = null
    await supabase.auth.signOut()
    await router.push('/login')
  }
}
