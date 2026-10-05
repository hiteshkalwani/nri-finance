<script setup lang="ts">
import { computed } from 'vue'
import { safeColor, tint } from '../lib/color'

/**
 * Small tinted circle for a category: its emoji icon when set, otherwise the uppercase first
 * letter of its name — spec §5's display rule. Purely decorative: the category name is always
 * rendered next to it by the caller, so this is `aria-hidden`.
 *
 * `category.color` may not be valid `#RRGGBB` CSS (v1-imported colours pass through as stored —
 * packages/contracts/src/categories.ts), so the tint/text colour go through lib/color's helpers,
 * which fall back to a neutral theme colour rather than rendering an untinted/uncoloured avatar.
 */
const props = withDefaults(defineProps<{ category: { name: string; color: string; icon: string | null }; size?: number }>(), { size: 32 })

const display = computed(() => props.category.icon ?? props.category.name.charAt(0).toUpperCase())
</script>

<template>
  <span
    class="category-avatar text-label-medium"
    aria-hidden="true"
    :style="{
      width: `${size}px`,
      height: `${size}px`,
      lineHeight: `${size}px`,
      fontSize: `${Math.round(size * 0.5)}px`,
      backgroundColor: tint(category.color),
      color: safeColor(category.color),
    }"
  >{{ display }}</span>
</template>

<style scoped>
.category-avatar {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-weight: 600;
}
</style>
