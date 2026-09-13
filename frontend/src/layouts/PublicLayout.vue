<script setup lang="ts">
import { LogOut, Menu, X } from 'lucide-vue-next';
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { RouterLink, RouterView, useRouter } from 'vue-router';
import ThemeToggle from '../components/ThemeToggle.vue';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const router = useRouter();
const menuOpen = ref(false);
const menu = ref<HTMLElement | null>(null);
const lastMenuTrigger = ref<HTMLElement | null>(null);

function toggleMenu(event: MouseEvent) {
  lastMenuTrigger.value = event.currentTarget as HTMLElement;
  menuOpen.value = !menuOpen.value;
}

function closeMenu() {
  menuOpen.value = false;
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !menuOpen.value) return;
  event.preventDefault();
  closeMenu();
  void nextTick(() => lastMenuTrigger.value?.focus());
}

function onDocumentClick(event: MouseEvent) {
  const target = event.target as Node;
  if (menuOpen.value && !menu.value?.contains(target) && !lastMenuTrigger.value?.contains(target)) {
    closeMenu();
  }
}

watch(menuOpen, async (open) => {
  if (!open) return;
  await nextTick();
  menu.value?.querySelector<HTMLElement>('a, button')?.focus();
});

async function logout() {
  await auth.logout();
  closeMenu();
  await router.push('/');
}

onMounted(() => document.addEventListener('keydown', onDocumentKeydown));
onMounted(() => document.addEventListener('click', onDocumentClick));
onUnmounted(() => {
  document.removeEventListener('keydown', onDocumentKeydown);
  document.removeEventListener('click', onDocumentClick);
});
</script>

<template>
  <div class="public-shell">
    <a class="skip-link" href="#main-content">跳到主要内容</a>
    <header class="public-header">
      <RouterLink to="/" class="brand" aria-label="Skinless 首页"
        >Skinless<span>.</span></RouterLink
      >
      <nav class="public-nav" aria-label="公共导航">
        <RouterLink class="public-nav-link" to="/">首页</RouterLink>
        <RouterLink v-if="auth.isAuthenticated" class="public-nav-link" to="/dashboard"
          >工作台</RouterLink
        >
        <RouterLink v-if="!auth.isAuthenticated" class="public-nav-link" to="/login"
          >登录</RouterLink
        >
        <RouterLink v-if="!auth.isAuthenticated" class="public-nav-cta" to="/register"
          >创建账号</RouterLink
        >
        <button
          v-if="auth.isAuthenticated"
          class="public-menu-trigger"
          type="button"
          :aria-expanded="menuOpen"
          aria-controls="public-menu"
          aria-haspopup="true"
          @click="toggleMenu"
        >
          <span class="avatar-dot">{{ auth.profile?.name?.slice(0, 1).toUpperCase() }}</span>
          <span class="public-menu-name">{{ auth.profile?.name }}</span>
          <Menu :size="16" aria-hidden="true" />
        </button>
      </nav>
      <ThemeToggle />
      <button
        class="mobile-menu-button icon-button"
        type="button"
        :aria-label="menuOpen ? '关闭导航' : '打开导航'"
        :aria-expanded="menuOpen"
        aria-controls="public-menu"
        @click="toggleMenu"
      >
        <X v-if="menuOpen" :size="20" aria-hidden="true" />
        <Menu v-else :size="20" aria-hidden="true" />
      </button>
    </header>
    <nav
      v-if="menuOpen"
      id="public-menu"
      ref="menu"
      class="public-mobile-menu"
      aria-label="移动端导航"
      @click.stop
    >
      <template v-if="auth.isAuthenticated">
        <RouterLink to="/dashboard" @click="closeMenu">打开工作台</RouterLink>
        <button type="button" @click="logout">
          <LogOut :size="16" aria-hidden="true" />退出登录
        </button>
      </template>
      <template v-else>
        <RouterLink to="/" @click="closeMenu">首页</RouterLink>
        <RouterLink to="/login" @click="closeMenu">登录</RouterLink>
        <RouterLink to="/register" @click="closeMenu">创建账号</RouterLink>
      </template>
    </nav>
    <main id="main-content" class="public-main" tabindex="-1">
      <RouterView />
    </main>
    <footer class="public-footer">
      <span
        >Powered by
        <a
          class="public-footer-link"
          href="https://github.com/Enthusjast/Skinless"
          target="_blank"
          rel="noreferrer noopener"
          >Skinless</a
        ></span
      >
    </footer>
  </div>
</template>
