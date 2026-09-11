<script setup lang="ts">
import { LogOut, Menu, X } from 'lucide-vue-next';
import { ref } from 'vue';
import { RouterLink, RouterView, useRouter } from 'vue-router';
import ThemeToggle from '../components/ThemeToggle.vue';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const router = useRouter();
const menuOpen = ref(false);

async function logout() {
  await auth.logout();
  menuOpen.value = false;
  await router.push('/');
}
</script>

<template>
  <div class="public-shell">
    <a class="skip-link" href="#main-content">跳到主要内容</a>
    <header class="public-header">
      <RouterLink to="/" class="brand" aria-label="Skinless 首页">Skinless<span>.</span></RouterLink>
      <nav class="public-nav" aria-label="公共导航">
        <RouterLink class="public-nav-link" to="/">首页</RouterLink>
        <RouterLink v-if="auth.isAuthenticated" class="public-nav-link" to="/dashboard">工作台</RouterLink>
        <RouterLink v-if="!auth.isAuthenticated" class="public-nav-link" to="/login">登录</RouterLink>
        <RouterLink v-if="!auth.isAuthenticated" class="public-nav-cta" to="/register">创建账号</RouterLink>
        <button v-if="auth.isAuthenticated" class="public-menu-trigger" type="button" :aria-expanded="menuOpen" @click="menuOpen = !menuOpen">
          <span class="avatar-dot">{{ auth.profile?.name?.slice(0, 1).toUpperCase() }}</span>
          <span class="public-menu-name">{{ auth.profile?.name }}</span>
          <Menu :size="16" aria-hidden="true" />
        </button>
        <ThemeToggle />
      </nav>
      <button class="mobile-menu-button icon-button" type="button" aria-label="打开导航" :aria-expanded="menuOpen" @click="menuOpen = !menuOpen">
        <X v-if="menuOpen" :size="20" aria-hidden="true" />
        <Menu v-else :size="20" aria-hidden="true" />
      </button>
    </header>
    <div v-if="menuOpen && auth.isAuthenticated" class="public-user-menu" role="menu">
      <RouterLink to="/dashboard" role="menuitem" @click="menuOpen = false">打开工作台</RouterLink>
      <button type="button" role="menuitem" @click="logout"><LogOut :size="16" aria-hidden="true" />退出登录</button>
    </div>
    <main id="main-content" class="public-main" tabindex="-1">
      <RouterView />
    </main>
    <footer class="public-footer">
      <span>Skinless · Minecraft 外置登录与皮肤身份</span>
      <span>轻量、开放、属于你的角色。</span>
    </footer>
  </div>
</template>
