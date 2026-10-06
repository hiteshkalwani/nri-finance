<script setup lang="ts">
import { ref, watch } from 'vue'
import { useDisplay } from 'vuetify'
import { useMutation, useQueryClient } from '@tanstack/vue-query'
import { ImportResult, MeResponse, ProfileInput, type V1Document } from '@nri/contracts'
import CategoriesSettings from '../components/CategoriesSettings.vue'
import PageHeader from '../components/PageHeader.vue'
import { apiFetch } from '../lib/api'
import { parseV1File } from '../lib/importFile'
import { useProfile } from '../lib/profile'
import { useSignOut } from '../lib/session'
import { useThemePref } from '../lib/useThemePref'

const { xs } = useDisplay()
const qc = useQueryClient()
const signOut = useSignOut()
const me = useProfile()
const form = ref({ salaryJpy: 0, planningRateJpyPerInr: '1.7', cycleStartDay: 25, timezone: 'Asia/Tokyo' })
watch(() => me.data.value?.profile, (p) => { if (p) form.value = { ...p } }, { immediate: true })
const formError = ref('')

const save = useMutation({
  mutationFn: (body: ProfileInput) => apiFetch('/api/me', { method: 'PUT', body: JSON.stringify(body) }, MeResponse),
  onSuccess: (data) => qc.setQueryData(['me'], data),
})
function submitProfile() {
  const parsed = ProfileInput.safeParse({
    ...form.value, salaryJpy: Number(form.value.salaryJpy), cycleStartDay: Number(form.value.cycleStartDay),
  })
  formError.value = parsed.success ? '' : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
  if (parsed.success) save.mutate(parsed.data)
}

const importMessage = ref('')
const importError = ref('')
const isDragOver = ref(false)
const runImport = useMutation({
  mutationFn: (doc: V1Document) => apiFetch('/api/import/v1', { method: 'POST', body: JSON.stringify(doc) }, ImportResult),
  onSuccess: (r) => {
    const i = r.inserted
    importMessage.value =
      `Imported ${i.transactions} transactions, ${i.remittances} remittances, ${i.categories} categories, ${i.accounts} accounts.` +
      (r.skippedRows.length ? ` Skipped ${r.skippedRows.length}: ${r.skippedRows.join(', ')}` : '')
    void Promise.all(['me', 'categories', 'transactions', 'dashboard'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
  },
})
async function onFile(files: File | File[] | null) {
  const file = Array.isArray(files) ? files[0] : files
  importMessage.value = ''
  importError.value = ''
  runImport.reset()
  if (!file) return
  const parsed = parseV1File(await file.text())
  if (!parsed.ok) { importError.value = parsed.message; return }
  runImport.mutate(parsed.doc)
}
function onInputChange(e: Event) {
  void onFile((e.target as HTMLInputElement).files?.[0] ?? null)
}
function onDrop(e: DragEvent) {
  isDragOver.value = false
  void onFile(e.dataTransfer?.files?.[0] ?? null)
}

const { pref: themePref, setThemePref } = useThemePref()
const THEME_OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const
</script>

<template>
  <PageHeader title="Settings">
    <!-- The bottom-nav's raised "+" already covers Add expense on phones. -->
    <v-btn v-if="!xs" to="/spend/new" color="primary" prepend-icon="mdi-plus">Add expense</v-btn>
  </PageHeader>
  <div class="grid2">
    <div class="col">
      <v-card class="mb-6">
        <div class="tx-hd"><h2>Profile</h2></div>
        <v-form class="fgrid" @submit.prevent="submitProfile">
          <v-text-field id="salary" v-model.number="form.salaryJpy" label="Monthly salary (¥)" type="number" />
          <v-text-field id="rate" v-model="form.planningRateJpyPerInr" label="Planning rate (¥ per ₹1)" />
          <v-text-field id="start-day" v-model.number="form.cycleStartDay" label="Cycle start day" type="number" />
          <v-text-field id="timezone" v-model="form.timezone" label="Timezone" />
        </v-form>
        <v-alert v-if="formError || save.error.value" type="error" variant="tonal" class="mx-5 mb-3">
          {{ formError || save.error.value?.message }}
        </v-alert>
        <div class="profile-actions">
          <v-btn color="primary" :loading="save.isPending.value" @click="submitProfile">Save profile</v-btn>
          <span v-if="save.isSuccess.value" class="ml-3">Saved</span>
        </div>
      </v-card>
      <CategoriesSettings />
    </div>
    <div class="col">
      <v-card class="mb-6">
        <div class="tx-hd"><h2>Import from v1</h2></div>
        <label
          for="import-file" class="drop" :class="{ dragover: isDragOver }"
          @dragover.prevent="isDragOver = true" @dragleave="isDragOver = false" @drop.prevent="onDrop"
        >
          Drop <b>finance-data.json</b> here, or <span class="link">choose a file</span>
          <br /><span class="hint">Importing twice never creates duplicates.</span>
        </label>
        <input id="import-file" type="file" accept="application/json" class="visually-hidden" @change="onInputChange" />
        <v-alert v-if="importMessage" type="success" variant="tonal" class="mx-5 mb-3">{{ importMessage }}</v-alert>
        <v-alert v-if="importError || runImport.error.value" type="error" variant="tonal" class="mx-5 mb-3">
          {{ importError || runImport.error.value?.message }}
        </v-alert>
      </v-card>
      <v-card class="mb-6">
        <div class="tx-hd"><h2>Account</h2></div>
        <div class="kv"><span class="text-medium-emphasis">Signed in as</span><b>{{ me.data.value?.email ?? '—' }}</b></div>
        <div class="account-actions"><v-btn variant="outlined" @click="signOut">Sign out</v-btn></div>
      </v-card>
      <v-card>
        <div class="tx-hd"><h2>Appearance</h2></div>
        <div class="seg" role="radiogroup" aria-label="Theme">
          <v-btn
            v-for="opt in THEME_OPTIONS" :key="opt.value" :ripple="false" role="radio" :aria-checked="themePref === opt.value"
            :class="{ on: themePref === opt.value }" variant="text" @click="setThemePref(opt.value)"
          >{{ opt.label }}</v-btn>
        </div>
      </v-card>
    </div>
  </div>
</template>

<style scoped>
.grid2 {
  display: grid;
  grid-template-columns: 1fr 340px;
  gap: 16px;
  margin-top: 16px;
}
@media (max-width: 1100px) {
  .grid2 {
    /* `minmax(0, 1fr)`, not bare `1fr`: a bare `1fr` track's automatic minimum size is its
       content's min-content, not 0 — and `.col`'s deepest content (CategoriesSettings' `.crow`
       action buttons, which don't shrink) has a min-content wider than a phone viewport. Without
       the explicit 0 minimum, that bubbled all the way up through `.col` and this track, forcing
       the whole settings column (and everything in it) to render ~470px wide on a 412px viewport —
       confirmed with Playwright on the Pixel 7 e2e profile, where the resulting horizontal overflow
       also corrupted Vuetify's bottom-nav width measurement and made the nav unclickable. */
    grid-template-columns: minmax(0, 1fr);
  }
}
.col {
  display: flex;
  flex-direction: column;
  gap: 16px;
  /* See the media query above: without this, `.col` (a grid item) contributes its content's
     min-content to `.grid2`'s track sizing instead of shrinking to fit it. */
  min-width: 0;
}
.col > :deep(.v-card) {
  margin-bottom: 0 !important;
}
.tx-hd {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 20px;
}
.tx-hd h2 {
  font-size: 16px;
  margin: 0;
  font-weight: 700;
}
.fgrid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 14px;
  padding: 0 20px;
}
@media (max-width: 760px) {
  .fgrid {
    grid-template-columns: 1fr;
  }
}
.profile-actions {
  display: flex;
  align-items: center;
  padding: 4px 20px 18px;
}
.drop {
  display: block;
  margin: 0 20px 18px;
  border: 1.5px dashed rgb(var(--v-border-color));
  border-radius: 12px;
  padding: 26px;
  text-align: center;
  cursor: pointer;
}
.drop.dragover {
  border-color: rgb(var(--v-theme-primary-accent));
  background: rgba(var(--v-theme-primary-accent), 0.06);
}
.drop .link {
  color: rgb(var(--v-theme-primary));
  text-decoration: underline;
}
.drop .hint {
  display: block;
  margin-top: 4px;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 12.5px;
}
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
}
.kv {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 20px;
  border-top: 1px solid rgb(var(--v-border-color));
}
.kv span {
  flex: none;
}
.kv b {
  text-align: right;
  word-break: break-all;
}
.account-actions {
  padding: 12px 20px 18px;
}
.seg {
  display: inline-flex;
  gap: 2px;
  margin: 0 20px 18px;
  padding: 3px;
  border: 1px solid rgb(var(--v-border-color));
  border-radius: 10px;
}
.seg .v-btn {
  min-width: 0;
}
/* Selected segment: `primary-darken-1` + white in light (the same accessible pairing as the ¥/₹
   toggle — src/theme.ts, apps/web/test/theme.test.ts); dark theme's own `on-primary` on `primary`
   itself, which is already light enough to read dark text cleanly (spec §7). */
.seg :deep(.v-btn.on.v-theme--light) {
  background: rgb(var(--v-theme-primary-darken-1));
  color: #fff;
}
.seg :deep(.v-btn.on.v-theme--dark) {
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
}
</style>
