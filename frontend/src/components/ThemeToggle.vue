<script setup lang="ts">
import { Moon, Sun } from 'lucide-vue-next';
import { useThemeStore } from '../stores/theme';

const theme = useThemeStore();
</script>

<template>
  <button
    class="icon-button theme-toggle"
    type="button"
    :aria-label="theme.isDark ? '切换到浅色主题' : '切换到深色主题'"
    :title="theme.isDark ? '切换到浅色主题' : '切换到深色主题'"
    @click="theme.toggle"
  >
    <Sun v-if="theme.isDark" :size="18" :stroke-width="1.8" aria-hidden="true" />
    <Moon v-else :size="18" :stroke-width="1.8" aria-hidden="true" />
  </button>
</template>
