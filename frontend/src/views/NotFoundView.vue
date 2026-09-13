<script setup lang="ts">
import { ArrowLeft, LayoutDashboard } from 'lucide-vue-next';
import { RouterLink } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
</script>

<template>
  <section class="not-found-page" aria-labelledby="not-found-title">
    <p class="eyebrow">404 / NOT FOUND</p>
    <h1 id="not-found-title">页面不存在</h1>
    <p>这个地址没有对应的页面。你可以返回首页，或继续前往工作台。</p>
    <div class="not-found-actions">
      <RouterLink class="button button-primary" to="/">
        <ArrowLeft :size="17" aria-hidden="true" />返回首页
      </RouterLink>
      <RouterLink v-if="auth.isAuthenticated" class="button button-ghost" to="/dashboard">
        <LayoutDashboard :size="17" aria-hidden="true" />进入工作台
      </RouterLink>
    </div>
  </section>
</template>
