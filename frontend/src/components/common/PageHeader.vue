<script setup lang="ts">
import type { Component } from 'vue';

withDefaults(defineProps<{
  title: string;
  description?: string;
  eyebrow?: string;
  icon?: Component;
}>(), {
  description: '',
  eyebrow: '',
  icon: undefined,
});
</script>

<template>
  <header class="page-header">
    <div class="page-header-content">
      <span v-if="icon" class="page-header-icon" aria-hidden="true"><component :is="icon" :size="21" /></span>
      <div class="page-header-text">
        <p v-if="eyebrow" class="eyebrow">{{ eyebrow }}</p>
        <h1>{{ title }}</h1>
        <p v-if="description" class="page-header-description">{{ description }}</p>
      </div>
    </div>
    <div v-if="$slots.actions" class="page-header-actions"><slot name="actions" /></div>
  </header>
</template>
