<script setup lang="ts">
withDefaults(defineProps<{
  hoverable?: boolean;
  as?: 'article' | 'section' | 'div';
}>(), {
  hoverable: false,
  as: 'article',
});
</script>

<template>
  <component :is="as" class="ui-card" :class="{ 'is-hoverable': hoverable }">
    <header v-if="$slots.header" class="ui-card-header"><slot name="header" /></header>
    <slot />
  </component>
</template>
