<script setup lang="ts">
defineProps<{ title: string }>()
</script>

<template>
  <div class="d-flex align-center flex-wrap ga-4 mb-4">
    <h1 class="text-h5 font-weight-bold">{{ title }}</h1>
    <!-- `flex-wrap`: a page whose action row doesn't drop anything on phone (RemitPage's cycle
         pill + "Record transfer", unlike Dashboard/Accounts which hide a button on `xs`) can
         still overflow a narrow viewport otherwise — wrapping is a no-op wherever it already fits. -->
    <div class="d-flex align-center flex-wrap ga-2 ml-auto">
      <slot />
    </div>
  </div>
</template>
