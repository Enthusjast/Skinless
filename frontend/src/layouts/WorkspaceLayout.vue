<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { LayoutDashboard, LogOut, Menu, Palette, Shield, UserRound, X } from 'lucide-vue-next';
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';
import PageHeader from '../components/common/PageHeader.vue';
import ThemeToggle from '../components/ThemeToggle.vue';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const sidebarOpen = ref(false);
const userMenuOpen = ref(false);
const userMenu = ref<HTMLElement | null>(null);

const pageTitle = computed(() => String(route.meta.title ?? '工作台'));
const pageEyebrow = computed(() => String(route.meta.eyebrow ?? 'SKINLESS WORKSPACE'));

function closeMenus() {
  sidebarOpen.value = false;
  userMenuOpen.value = false;
}

function onDocumentClick(event: MouseEvent) {
  if (userMenu.value && !userMenu.value.contains(event.target as Node)) userMenuOpen.value = false;
}

async function logout() {
  await auth.logout();
  closeMenus();
  await router.push('/');
}

onMounted(() => document.addEventListener('click', onDocumentClick));
onUnmounted(() => document.removeEventListener('click', onDocumentClick));
</script>

<template>
  <div class="workspace-shell">
    <a class="skip-link" href="#workspace-content">跳到主要内容</a>
    <aside class="workspace-sidebar" :class="{ open: sidebarOpen }" aria-label="工作台导航">
      <div class="workspace-brand-row">
        <RouterLink to="/" class="brand" aria-label="返回 Skinless 首页">Skinless<span>.</span></RouterLink>
        <button class="icon-button sidebar-close" type="button" aria-label="关闭导航" @click="sidebarOpen = false"><X :size="18" aria-hidden="true" /></button>
      </div>
      <div class="workspace-user-panel">
        <span class="workspace-avatar">{{ auth.profile?.name?.slice(0, 1).toUpperCase() }}</span>
        <div><strong>{{ auth.profile?.name }}</strong><span>{{ auth.user?.role === 'admin' ? '管理员' : '玩家账号' }}</span></div>
      </div>
      <nav class="workspace-nav" aria-label="工作台菜单">
        <p class="workspace-nav-label">用户中心</p>
        <RouterLink class="workspace-nav-link" to="/dashboard" :class="{ active: route.path === '/dashboard' && !route.hash }" @click="sidebarOpen = false">
          <LayoutDashboard :size="18" aria-hidden="true" /><span>仪表盘</span>
        </RouterLink>
        <RouterLink class="workspace-nav-link" to="/dashboard#appearance" :class="{ active: route.hash === '#appearance' }" @click="sidebarOpen = false">
          <Palette :size="18" aria-hidden="true" /><span>角色外观</span>
        </RouterLink>
        <RouterLink class="workspace-nav-link" to="/dashboard#security" :class="{ active: route.hash === '#security' }" @click="sidebarOpen = false">
          <UserRound :size="18" aria-hidden="true" /><span>账户安全</span>
        </RouterLink>
        <template v-if="auth.isAdmin">
          <p class="workspace-nav-label workspace-nav-label-spaced">管理</p>
          <RouterLink class="workspace-nav-link" to="/admin" :class="{ active: route.path === '/admin' }" @click="sidebarOpen = false">
            <Shield :size="18" aria-hidden="true" /><span>用户管理</span>
          </RouterLink>
        </template>
      </nav>
      <div class="workspace-sidebar-footer">
        <span>SKINLESS / 0.1</span>
        <RouterLink to="/" @click="sidebarOpen = false">返回首页</RouterLink>
        <button class="workspace-logout" type="button" @click="logout"><LogOut :size="14" aria-hidden="true" />退出</button>
      </div>
    </aside>
    <div v-if="sidebarOpen" class="workspace-scrim" aria-hidden="true" @click="sidebarOpen = false" />
    <div class="workspace-main-shell">
      <header class="workspace-topbar">
        <div class="workspace-topbar-left">
          <button class="icon-button sidebar-toggle" type="button" aria-label="打开导航" :aria-expanded="sidebarOpen" @click="sidebarOpen = true"><Menu :size="20" aria-hidden="true" /></button>
          <div class="workspace-breadcrumb"><span>工作台</span><span aria-hidden="true">/</span><strong>{{ pageTitle }}</strong></div>
        </div>
        <div class="workspace-topbar-actions">
          <ThemeToggle />
          <div ref="userMenu" class="workspace-user-menu-wrap">
            <button class="workspace-user-trigger" type="button" :aria-expanded="userMenuOpen" @click.stop="userMenuOpen = !userMenuOpen">
              <span class="avatar-dot">{{ auth.profile?.name?.slice(0, 1).toUpperCase() }}</span><span>{{ auth.profile?.name }}</span>
            </button>
            <div v-if="userMenuOpen" class="workspace-user-menu" role="menu">
              <RouterLink to="/dashboard#security" role="menuitem" @click="userMenuOpen = false">账户安全</RouterLink>
              <button type="button" role="menuitem" @click="logout"><LogOut :size="16" aria-hidden="true" />退出登录</button>
            </div>
          </div>
        </div>
      </header>
      <main id="workspace-content" class="workspace-content" tabindex="-1">
        <PageHeader :eyebrow="pageEyebrow" :title="pageTitle" :description="String(route.meta.description ?? '')" />
        <RouterView />
      </main>
    </div>
  </div>
</template>
