<script setup lang="ts">
import { ref } from 'vue'
import { useMutation, useQueryClient } from '@tanstack/vue-query'
import { Category, CategoryList, type CategoryPatch } from '@nri/contracts'
import { apiFetch, ApiRequestError } from '../lib/api'
import { moveId, PALETTE, useCategories } from '../lib/categories'

const qc = useQueryClient()
const cats = useCategories()
const newName = ref('')
const newColor = ref(PALETTE[0]!)
const message = ref('')
const editing = ref<string | null>(null)
const editName = ref('')

const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['categories'] }), qc.invalidateQueries({ queryKey: ['dashboard'] })])
const fail = (e: unknown) => { message.value = e instanceof ApiRequestError ? e.message : 'Something went wrong' }

const add = useMutation({
  mutationFn: () => apiFetch('/api/categories', { method: 'POST', body: JSON.stringify({ name: newName.value, color: newColor.value }) }, Category),
  onSuccess: async () => { newName.value = ''; message.value = ''; await refresh() },
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
    <v-card-title>Categories</v-card-title>
    <v-card-text>
      <v-alert v-if="message" type="error" variant="tonal" class="mb-4" closable @click:close="message = ''">{{ message }}</v-alert>
      <v-form class="d-flex ga-2 align-center flex-wrap mb-4" @submit.prevent="add.mutate()">
        <v-text-field id="new-category" v-model="newName" label="New category" density="compact" hide-details style="min-width: 200px" />
        <div class="d-flex ga-1" role="radiogroup" aria-label="Colour">
          <v-btn v-for="c in PALETTE" :key="c" icon size="x-small" :color="c" :aria-label="c" :aria-checked="newColor === c" role="radio"
            :variant="newColor === c ? 'outlined' : 'flat'" @click="newColor = c" />
        </div>
        <v-btn type="submit" color="primary" :loading="add.isPending.value" :disabled="!newName.trim()">Add</v-btn>
      </v-form>
      <v-list density="compact">
        <v-list-item v-for="(c, i) in cats.data.value ?? []" :key="c.id" :class="{ 'text-disabled': c.archived }">
          <template #prepend><v-icon :color="c.color">mdi-circle</v-icon></template>
          <v-text-field v-if="editing === c.id" v-model="editName" density="compact" hide-details autofocus
            @keyup.enter="patch.mutate({ id: c.id, body: { name: editName } })" @keyup.escape="editing = null" />
          <v-list-item-title v-else>{{ c.name }}<span v-if="c.archived"> (archived)</span></v-list-item-title>
          <template #append>
            <v-menu>
              <template #activator="{ props }"><v-btn v-bind="props" icon="mdi-palette-outline" variant="text" size="small" aria-label="Colour" /></template>
              <div class="d-flex flex-wrap ga-1 pa-2 bg-surface" style="max-width: 200px">
                <v-btn v-for="p in PALETTE" :key="p" icon size="x-small" :color="p" :aria-label="p" @click="patch.mutate({ id: c.id, body: { color: p } })" />
              </div>
            </v-menu>
            <v-btn icon="mdi-pencil-outline" variant="text" size="small" aria-label="Rename" @click="startEdit(c)" />
            <v-btn icon="mdi-arrow-up" variant="text" size="small" aria-label="Move up" :disabled="i === 0" @click="move(i, -1)" />
            <v-btn icon="mdi-arrow-down" variant="text" size="small" aria-label="Move down" :disabled="i === (cats.data.value?.length ?? 0) - 1" @click="move(i, 1)" />
            <v-btn :icon="c.archived ? 'mdi-archive-arrow-up-outline' : 'mdi-archive-outline'" variant="text" size="small"
              :aria-label="c.archived ? 'Unarchive' : 'Archive'" @click="patch.mutate({ id: c.id, body: { archived: !c.archived } })" />
            <v-btn v-if="!c.inUse" icon="mdi-delete-outline" variant="text" size="small" aria-label="Delete" @click="remove.mutate(c.id)" />
          </template>
        </v-list-item>
      </v-list>
    </v-card-text>
  </v-card>
</template>
