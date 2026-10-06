import { ref } from 'vue'

/**
 * A one-shot success message for the *next* page the user lands on after a navigation — e.g.
 * Update balances finishing and sending the user back to Accounts with "Balances saved for Oct
 * 2026". The receiving page should read it once on mount and immediately null it out (see
 * AccountsPage.vue), so it never resurfaces on a later visit or a page refresh.
 */
export const flash = { message: ref<string | null>(null) }
