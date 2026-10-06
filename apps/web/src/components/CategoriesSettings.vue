<script setup lang="ts">
import { ref } from 'vue'
import { useDisplay } from 'vuetify'
import { useMutation, useQueryClient } from '@tanstack/vue-query'
import { Category, CategoryList, type CategoryPatch } from '@nri/contracts'
import { apiFetch, ApiRequestError } from '../lib/api'
import { CATEGORY_ICONS, moveId, PALETTE, useCategories } from '../lib/categories'
import { safeColor } from '../lib/color'
import CategoryAvatar from './CategoryAvatar.vue'

const { xs } = useDisplay()
const qc = useQueryClient()
const cats = useCategories()
const newName = ref('')
const newColor = ref(PALETTE[0]!)
const newIcon = ref<string | null>(null)
const message = ref('')
const editing = ref<string | null>(null)
const editName = ref('')

const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['categories'] }), qc.invalidateQueries({ queryKey: ['dashboard'] })])
const fail = (e: unknown) => { message.value = e instanceof ApiRequestError ? e.message : 'Something went wrong' }

const add = useMutation({
  mutationFn: () =>
    apiFetch('/api/categories', { method: 'POST', body: JSON.stringify({ name: newName.value, color: newColor.value, icon: newIcon.value }) }, Category),
  onSuccess: async () => { newName.value = ''; newIcon.value = null; message.value = ''; await refresh() },
  onError: fail,
})
const patch = useMutation({
  mutationFn: ({ id, body }: { id: string; body: CategoryPatch }) =>
    apiFetch(`/api/categories/${id}`, { method: 'PATCH', body: JSON.stringify(body) }, Category),
  onSuccess: async () => { editing.value = null; message.value = ''; await refresh() },
  onError: fail,
})
const reorder = useMutation({
  mutationFn: (ids: string[]) => apiFetch('/api/categories/order', { method: 'PUT', body: JSON.stringify({ ids }) }, CategoryList),
  onSuccess: refresh,
  onError: fail,
})
const remove = useMutation({
  mutationFn: (id: string) => apiFetch(`/api/categories/${id}`, { method: 'DELETE' }),
  onSuccess: refresh,
  onError: fail,
})

function move(index: number, delta: number) {
  const ids = (cats.data.value ?? []).map((c) => c.id)
  const next = moveId(ids, index, delta)
  if (next !== ids) reorder.mutate(next)
}
function startEdit(c: Category) { editing.value = c.id; editName.value = c.name }
</script>

<template>
  <v-card class="mb-6">
    <div class="tx-hd"><h2>Categories</h2></div>
    <div class="cat-add">
      <v-text-field
        id="new-category" v-model="newName" label="New category" density="compact" hide-details style="min-width: 160px"
        @keyup.enter="add.mutate()"
      />
      <v-menu>
        <template #activator="{ props }"><v-btn v-bind="props" icon size="small" :color="newColor" aria-label="Colour" /></template>
        <div class="d-flex flex-wrap ga-1 pa-2 bg-surface" style="max-width: 200px" role="radiogroup" aria-label="Colour">
          <v-btn v-for="c in PALETTE" :key="c" icon size="x-small" :color="c" :aria-label="c" :aria-checked="newColor === c" role="radio" :ripple="false"
            :variant="newColor === c ? 'outlined' : 'flat'" @click="newColor = c" />
        </div>
      </v-menu>
      <v-menu>
        <template #activator="{ props }">
          <v-btn v-bind="props" variant="outlined" size="small" icon aria-label="Icon">
            <span v-if="newIcon" aria-hidden="true">{{ newIcon }}</span>
            <v-icon v-else>mdi-emoticon-outline</v-icon>
          </v-btn>
        </template>
        <div class="icon-menu bg-surface" role="radiogroup" aria-label="Icon">
          <v-btn
            v-for="opt in CATEGORY_ICONS" :key="opt.icon" variant="text" size="small" icon :ripple="false" role="radio"
            :aria-label="opt.name" :aria-checked="newIcon === opt.icon" @click="newIcon = opt.icon"
          >{{ opt.icon }}</v-btn>
          <v-btn variant="text" size="small" :ripple="false" role="radio" aria-label="No icon" :aria-checked="newIcon === null" class="no-icon" @click="newIcon = null">
            No icon
          </v-btn>
        </div>
      </v-menu>
      <v-btn color="primary" :loading="add.isPending.value" :disabled="!newName.trim()" @click="add.mutate()">Add</v-btn>
    </div>
    <v-alert v-if="message" type="error" variant="tonal" class="mx-5 mb-3" closable @click:close="message = ''">{{ message }}</v-alert>
    <div
      v-for="(c, i) in cats.data.value ?? []" :key="c.id" class="crow" :class="{ 'text-disabled': c.archived }"
    >
      <CategoryAvatar :category="c" :size="32" />
      <div class="name-cell">
        <template v-if="editing === c.id">
          <v-text-field v-model="editName" label="Category name" density="compact" hide-details autofocus
            @keyup.enter="patch.mutate({ id: c.id, body: { name: editName } })" @keyup.escape="editing = null" />
          <v-btn icon="mdi-check" variant="text" size="small" aria-label="Save name" @click="patch.mutate({ id: c.id, body: { name: editName } })" />
          <v-btn icon="mdi-close" variant="text" size="small" aria-label="Cancel rename" @click="editing = null" />
        </template>
        <template v-else>
          <span class="dot" :style="{ background: safeColor(c.color) }" aria-hidden="true" />
          <span>{{ c.name }}<span v-if="c.archived"> (archived)</span></span>
        </template>
      </div>
      <div class="acts">
        <v-menu>
          <template #activator="{ props }"><v-btn v-bind="props" icon="mdi-palette-outline" variant="text" size="small" :aria-label="`Colour for ${c.name}`" /></template>
          <div class="d-flex flex-wrap ga-1 pa-2 bg-surface" style="max-width: 200px" role="radiogroup" aria-label="Colour">
            <v-btn v-for="p in PALETTE" :key="p" icon size="x-small" :color="p" :aria-label="p" :aria-checked="c.color === p" role="radio" :ripple="false"
              :variant="c.color === p ? 'outlined' : 'flat'" @click="patch.mutate({ id: c.id, body: { color: p } })" />
          </div>
        </v-menu>
        <v-menu>
          <template #activator="{ props }">
            <v-btn v-bind="props" variant="text" size="small" icon :aria-label="`Icon for ${c.name}`">
              <span v-if="c.icon" aria-hidden="true">{{ c.icon }}</span>
              <v-icon v-else>mdi-emoticon-outline</v-icon>
            </v-btn>
          </template>
          <div class="icon-menu bg-surface" role="radiogroup" aria-label="Icon">
            <v-btn
              v-for="opt in CATEGORY_ICONS" :key="opt.icon" variant="text" size="small" icon :ripple="false" role="radio"
              :aria-label="opt.name" :aria-checked="c.icon === opt.icon" @click="patch.mutate({ id: c.id, body: { icon: opt.icon } })"
            >{{ opt.icon }}</v-btn>
            <v-btn
              variant="text" size="small" :ripple="false" role="radio" aria-label="No icon" :aria-checked="c.icon === null" class="no-icon"
              @click="patch.mutate({ id: c.id, body: { icon: null } })"
            >No icon</v-btn>
          </div>
        </v-menu>
        <v-btn icon="mdi-pencil-outline" variant="text" size="small" :aria-label="`Rename ${c.name}`" @click="startEdit(c)" />
        <!-- Reorder discoverability (M1 regression, fix round 1): ↑ ↓ are inline again on wide
             screens, where there's room; only on phones do they move into the "More actions"
             menu alongside archive/delete, which stay in the menu on both breakpoints — a phone
             width has no room for 7 always-visible action icons (verified with Playwright — every
             row showed just an avatar and icons once there was). -->
        <template v-if="!xs">
          <v-btn icon="mdi-arrow-up" variant="text" size="small" :aria-label="`Move ${c.name} up`" :disabled="i === 0" @click="move(i, -1)" />
          <v-btn
            icon="mdi-arrow-down" variant="text" size="small" :aria-label="`Move ${c.name} down`"
            :disabled="i === (cats.data.value?.length ?? 0) - 1" @click="move(i, 1)"
          />
        </template>
        <v-menu>
          <template #activator="{ props }"><v-btn v-bind="props" icon="mdi-dots-vertical" variant="text" size="small" :aria-label="`More actions for ${c.name}`" /></template>
          <v-list density="compact">
            <template v-if="xs">
              <v-list-item :disabled="i === 0" prepend-icon="mdi-arrow-up" :title="`Move ${c.name} up`" @click="move(i, -1)" />
              <v-list-item
                :disabled="i === (cats.data.value?.length ?? 0) - 1" prepend-icon="mdi-arrow-down" :title="`Move ${c.name} down`" @click="move(i, 1)"
              />
            </template>
            <v-list-item
              :prepend-icon="c.archived ? 'mdi-archive-arrow-up-outline' : 'mdi-archive-outline'" :title="`${c.archived ? 'Unarchive' : 'Archive'} ${c.name}`"
              @click="patch.mutate({ id: c.id, body: { archived: !c.archived } })"
            />
            <v-list-item v-if="!c.inUse" prepend-icon="mdi-delete-outline" :title="`Delete ${c.name}`" @click="remove.mutate(c.id)" />
          </v-list>
        </v-menu>
      </div>
    </div>
  </v-card>
</template>

<style scoped>
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
.cat-add {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 0 20px 16px;
}
.crow {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 10px 20px;
  border-top: 1px solid rgb(var(--v-border-color));
  /* v-card's root is a flex column (Vuetify default), which gives every direct child an
     automatic `min-width: auto` — i.e. its min-content size, not 0. With up to 7 action icons in
     `.acts` (a non-shrinking grid track), that min-content is wider than a phone viewport, which
     forced this row (and, via it, the card/page) to overflow horizontally — which in turn fed a
     bogus inflated width into Vuetify's bottom-nav layout measurement and made the nav unclickable
     at some scroll positions (reproduced with the Pixel 7 e2e profile). `overflow: hidden` resets
     the automatic minimum to 0 per the flexbox spec, so the row shrinks to the viewport and its
     own columns (not the row) decide what gives: the name column, not the actions. */
  min-width: 0;
  overflow: hidden;
}
.name-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  overflow: hidden;
}
.name-cell > span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex: none;
}
.acts {
  display: flex;
  gap: 2px;
  justify-content: flex-end;
}
.icon-menu {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 2px;
  padding: 8px;
  max-width: 230px;
}
.icon-menu .no-icon {
  grid-column: 1 / -1;
  font-size: 12px;
}
</style>
