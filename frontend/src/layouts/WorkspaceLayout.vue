<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  ImagePlus,
  LayoutDashboard,
  LogOut,
  Menu,
  Palette,
  Settings2,
  Shield,
  UserRound,
  X,
} from 'lucide-vue-next';
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';
import PageHeader from '../components/common/PageHeader.vue';
import ThemeToggle from '../components/ThemeToggle.vue';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const sidebarOpen = ref(false);
const userMenuOpen = ref(false);
const sidebar = ref<HTMLElement | null>(null);
const sidebarToggle = ref<HTMLButtonElement | null>(null);
const userMenu = ref<HTMLElement | null>(null);
const userMenuTrigger = ref<HTMLButtonElement | null>(null);

const pageTitle = computed(() => String(route.meta.title ?? '工作台'));
const pageEyebrow = computed(() => String(route.meta.eyebrow ?? 'SKINLESS WORKSPACE'));

function closeMenus() {
  sidebarOpen.value = false;
  userMenuOpen.value = false;
}

function closeSidebar() {
  sidebarOpen.value = false;
}

function closeUserMenu() {
  userMenuOpen.value = false;
}

function openSidebar(event: MouseEvent) {
  sidebarToggle.value = event.currentTarget as HTMLButtonElement;
  sidebarOpen.value = true;
}

function toggleUserMenu(event: MouseEvent) {
  userMenuTrigger.value = event.currentTarget as HTMLButtonElement;
  userMenuOpen.value = !userMenuOpen.value;
}

function onDocumentClick(event: MouseEvent) {
  if (userMenu.value && !userMenu.value.contains(event.target as Node)) userMenuOpen.value = false;
}

async function logout() {
  await auth.logout();
  closeMenus();
  await router.push('/');
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return;
  if (userMenuOpen.value) {
    event.preventDefault();
    closeUserMenu();
    void nextTick(() =>
      (
        userMenuTrigger.value ??
        userMenu.value?.querySelector<HTMLButtonElement>('.workspace-user-trigger')
      )?.focus(),
    );
    return;
  }
  if (sidebarOpen.value) {
    event.preventDefault();
    closeSidebar();
    void nextTick(() =>
      (
        sidebarToggle.value ?? document.querySelector<HTMLButtonElement>('.sidebar-toggle')
      )?.focus(),
    );
  }
}

watch(sidebarOpen, async (open) => {
  if (!open) return;
  await nextTick();
  sidebar.value?.querySelector<HTMLElement>('.sidebar-close, a, button')?.focus();
});

watch(userMenuOpen, async (open) => {
  if (!open) return;
  await nextTick();
  userMenu.value?.querySelector<HTMLElement>('a, button')?.focus();
});

onMounted(() => {
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('keydown', onDocumentKeydown);
});
onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick);
  document.removeEventListener('keydown', onDocumentKeydown);
});
</script>

<template>
  <div class="workspace-shell">
    <a class="skip-link" href="#workspace-content">跳到主要内容</a>
    <aside
      id="workspace-sidebar"
      ref="sidebar"
      class="workspace-sidebar"
      :class="{ open: sidebarOpen }"
      aria-label="工作台导航"
    >
      <div class="workspace-brand-row">
        <RouterLink to="/" class="brand" aria-label="返回 Skinless 首页"
          >Skinless<span>.</span></RouterLink
        >
        <button
          class="icon-button sidebar-close"
          type="button"
          aria-label="关闭导航"
          @click="closeSidebar"
        >
          <X :size="18" aria-hidden="true" />
        </button>
      </div>
      <div class="workspace-user-panel">
        <span class="workspace-avatar">{{ auth.profile?.name?.slice(0, 1).toUpperCase() }}</span>
        <div>
          <strong>{{ auth.profile?.name }}</strong
          ><span>{{ auth.user?.role === 'admin' ? '管理员' : '玩家账号' }}</span>
        </div>
      </div>
      <nav class="workspace-nav" aria-label="工作台菜单">
        <p class="workspace-nav-label">用户中心</p>
        <RouterLink
          class="workspace-nav-link"
          to="/dashboard"
          :class="{ active: route.path === '/dashboard' && !route.hash }"
          @click="closeSidebar"
        >
          <LayoutDashboard :size="18" aria-hidden="true" /><span>仪表盘</span>
        </RouterLink>
        <RouterLink
          class="workspace-nav-link"
          to="/dashboard#appearance"
          :class="{ active: route.hash === '#appearance' }"
          @click="closeSidebar"
        >
          <Palette :size="18" aria-hidden="true" /><span>角色外观</span>
        </RouterLink>
        <RouterLink
          class="workspace-nav-link"
          to="/dashboard/wardrobe"
          :class="{ active: route.path === '/dashboard/wardrobe' }"
          @click="closeSidebar"
        >
          <ImagePlus :size="18" aria-hidden="true" /><span>纹理衣柜</span>
        </RouterLink>
        <RouterLink
          class="workspace-nav-link"
          to="/dashboard#security"
          :class="{ active: route.hash === '#security' }"
          @click="closeSidebar"
        >
          <UserRound :size="18" aria-hidden="true" /><span>账户安全</span>
        </RouterLink>
        <RouterLink
          class="workspace-nav-link"
          to="/dashboard/setup"
          :class="{ active: route.path === '/dashboard/setup' }"
          @click="closeSidebar"
        >
          <Settings2 :size="18" aria-hidden="true" /><span>启动器设置</span>
        </RouterLink>
        <template v-if="auth.isAdmin">
          <p class="workspace-nav-label workspace-nav-label-spaced">管理</p>
          <RouterLink
            class="workspace-nav-link"
            to="/admin"
            :class="{ active: route.path === '/admin' }"
            @click="closeSidebar"
          >
            <Shield :size="18" aria-hidden="true" /><span>用户管理</span>
          </RouterLink>
        </template>
      </nav>
      <div class="workspace-sidebar-footer">
        <span>SKINLESS / 0.1</span>
        <RouterLink to="/" @click="closeSidebar">返回首页</RouterLink>
        <button class="workspace-logout" type="button" @click="logout">
          <LogOut :size="14" aria-hidden="true" />退出
        </button>
      </div>
    </aside>
    <div v-if="sidebarOpen" class="workspace-scrim" aria-hidden="true" @click="closeSidebar" />
    <div class="workspace-main-shell">
      <header class="workspace-topbar">
        <div class="workspace-topbar-left">
          <button
            ref="sidebarToggle"
            class="icon-button sidebar-toggle"
            type="button"
            aria-label="打开导航"
            :aria-expanded="sidebarOpen"
            aria-controls="workspace-sidebar"
            @click="openSidebar"
          >
            <Menu :size="20" aria-hidden="true" />
          </button>
          <div class="workspace-breadcrumb">
            <span>工作台</span><span aria-hidden="true">/</span><strong>{{ pageTitle }}</strong>
          </div>
        </div>
        <div class="workspace-topbar-actions">
          <ThemeToggle />
          <div ref="userMenu" class="workspace-user-menu-wrap">
            <button
              class="workspace-user-trigger"
              type="button"
              :aria-expanded="userMenuOpen"
              aria-controls="workspace-user-menu"
              aria-haspopup="menu"
              @click.stop="toggleUserMenu"
            >
              <span class="avatar-dot">{{ auth.profile?.name?.slice(0, 1).toUpperCase() }}</span
              ><span>{{ auth.profile?.name }}</span>
            </button>
            <div
              v-if="userMenuOpen"
              id="workspace-user-menu"
              class="workspace-user-menu"
              role="menu"
              @click.stop
            >
              <RouterLink to="/dashboard#security" role="menuitem" @click="closeUserMenu"
                >账户安全</RouterLink
              >
              <button type="button" role="menuitem" @click="logout">
                <LogOut :size="16" aria-hidden="true" />退出登录
              </button>
            </div>
          </div>
        </div>
      </header>
      <main id="workspace-content" class="workspace-content" tabindex="-1">
        <PageHeader
          :eyebrow="pageEyebrow"
          :title="pageTitle"
          :description="String(route.meta.description ?? '')"
        />
        <RouterView />
      </main>
    </div>
  </div>
</template>
