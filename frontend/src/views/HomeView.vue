<script setup lang="ts">
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
</script>

<template>
  <section class="hero hero-minimal">
    <h1>Skinless</h1>
    <div class="hero-actions">
      <RouterLink :to="auth.isAuthenticated ? '/dashboard' : '/login'" class="button button-primary">进入工作台</RouterLink>
    </div>
  </section>
</template>
