<script setup lang="ts">
import { RouterLink, RouterView, useRouter } from 'vue-router';
import { useAuthStore } from './stores/auth';

const auth = useAuthStore();
const router = useRouter();

async function logout() {
  await auth.logout();
  await router.push('/');
}
</script>

<template>
  <div class="app-shell">
    <header class="site-header">
      <RouterLink to="/" class="brand">Skinless<span>.</span></RouterLink>
      <nav class="site-nav" aria-label="主导航">
        <template v-if="auth.isAuthenticated">
          <RouterLink to="/dashboard">仪表盘</RouterLink>
          <RouterLink v-if="auth.isAdmin" to="/admin">管理</RouterLink>
          <button class="nav-button" type="button" @click="logout">退出</button>
        </template>
        <template v-else>
          <RouterLink to="/login">登录</RouterLink>
          <RouterLink to="/register" class="nav-cta">注册</RouterLink>
        </template>
      </nav>
    </header>
    <main class="page-container">
      <RouterView />
    </main>
    <footer class="site-footer">轻量、开放、属于你的 Minecraft 皮肤身份。</footer>
  </div>
</template>
