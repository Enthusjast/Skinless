<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router';
</script>

<template>
  <div class="app-shell">
    <header class="site-header">
      <RouterLink to="/" class="brand">Skinless<span>.</span></RouterLink>
      <nav class="site-nav" aria-label="主导航">
        <RouterLink to="/login">登录</RouterLink>
        <RouterLink to="/register" class="nav-cta">注册</RouterLink>
      </nav>
    </header>
    <main class="page-container">
      <RouterView />
    </main>
    <footer class="site-footer">轻量、开放、属于你的 Minecraft 皮肤身份。</footer>
  </div>
</template>
