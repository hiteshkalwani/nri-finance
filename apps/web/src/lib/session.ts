import { ref } from 'vue'

/** Session-expiry dialog state, shared by the API client and the dialog component. */
export const session = { dialogOpen: ref(false) }
export const openSignIn = () => { session.dialogOpen.value = true }
export const closeSignIn = () => { session.dialogOpen.value = false }
