<script setup lang="ts">
defineProps<{ title: string }>()
</script>

<template>
  <div class="d-flex align-center flex-wrap ga-4 mb-4">
    <h1 class="text-h5 font-weight-bold">{{ title }}</h1>
    <div class="d-flex align-center ga-2 ml-auto">
      <slot />
    </div>
  </div>
</template>
