import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from './stores/auth';
import PublicLayout from './layouts/PublicLayout.vue';
import WorkspaceLayout from './layouts/WorkspaceLayout.vue';

const router = createRouter({
  history: createWebHistory(),
  scrollBehavior(to, _from, savedPosition) {
    if (savedPosition) return savedPosition;
    if (to.hash) return { el: to.hash, behavior: 'smooth' };
    return { top: 0 };
  },
  routes: [
    {
      path: '/',
      component: PublicLayout,
      children: [
        { path: '', component: () => import('./views/HomeView.vue') },
        { path: 'login', component: () => import('./views/LoginView.vue') },
        { path: 'register', component: () => import('./views/RegisterView.vue') },
        { path: 'forgot-password', component: () => import('./views/PasswordResetView.vue') },
        { path: 'reset-password', component: () => import('./views/PasswordResetView.vue') },
        { path: 'restore-account', component: () => import('./views/RestoreAccountView.vue') },
        {
          path: 'profiles/name/:name',
          component: () => import('./views/PublicProfileView.vue'),
          meta: { noindex: true, publicProfile: true, title: '公开 Profile' },
        },
        {
          path: 'profiles/:uuid',
          component: () => import('./views/PublicProfileView.vue'),
          meta: { noindex: true, publicProfile: true, title: '公开 Profile' },
        },
        {
          path: ':pathMatch(.*)*',
          component: () => import('./views/NotFoundView.vue'),
          meta: { title: '页面不存在' },
        },
      ],
    },
    {
      path: '/',
      component: WorkspaceLayout,
      meta: { requiresAuth: true },
      children: [
        {
          path: 'dashboard',
          component: () => import('./views/DashboardView.vue'),
          meta: {
            title: '仪表盘',
            eyebrow: 'PLAYER DASHBOARD',
            description: '管理你的游戏身份、纹理资产和账户安全。',
          },
        },
        {
          path: 'dashboard/appearance',
          component: () => import('./views/AppearanceView.vue'),
          meta: {
            title: '角色外观',
            eyebrow: 'CHARACTER APPEARANCE',
            description: '管理 Profile、模型和皮肤纹理。',
          },
        },
        {
          path: 'dashboard/security',
          component: () => import('./views/SecurityView.vue'),
          meta: {
            title: '账户安全',
            eyebrow: 'ACCOUNT SECURITY',
            description: '管理密码、邮箱、会话和账号生命周期。',
          },
        },
        {
          path: 'dashboard/wardrobe',
          component: () => import('./views/WardrobeView.vue'),
          meta: {
            title: '纹理衣柜',
            eyebrow: 'PRIVATE WARDROBE',
            description: '保存、预览并将私人皮肤和披风应用到任意 Profile。',
          },
        },
        {
          path: 'dashboard/setup',
          component: () => import('./views/SetupView.vue'),
          meta: {
            requiresAuth: true,
            title: '启动器设置',
            eyebrow: 'LAUNCHER SETUP',
            description: '复制启动器参数并检查当前部署。',
          },
        },
        {
          path: 'admin',
          component: () => import('./views/AdminView.vue'),
          meta: {
            requiresAuth: true,
            requiresAdmin: true,
            title: '用户管理',
            eyebrow: 'ADMINISTRATION',
            description: '查看账号并调整基础角色权限。',
          },
        },
      ],
    },
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  await auth.initialize();
  if (to.path === '/dashboard' && to.hash === '#appearance') {
    return { path: '/dashboard/appearance', query: to.query };
  }
  if (to.path === '/dashboard' && to.hash === '#security') {
    return { path: '/dashboard/security', query: to.query };
  }
  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { path: '/login', query: { redirect: to.fullPath } };
  }
  if (to.meta.requiresAdmin && !auth.isAdmin) return '/dashboard';
  if ((to.path === '/login' || to.path === '/register') && auth.isAuthenticated)
    return '/dashboard';
  return true;
});

router.afterEach((to) => {
  const robotsMeta = document.head.querySelector('meta[name="robots"]');
  if (to.meta.noindex) {
    const meta = robotsMeta ?? document.head.appendChild(document.createElement('meta'));
    meta.setAttribute('name', 'robots');
    meta.setAttribute('content', 'noindex, nofollow');
    document.title = `${String(to.meta.title ?? '公开 Profile')} · Skinless`;
  } else {
    robotsMeta?.remove();
  }
  window.requestAnimationFrame(() => {
    document.querySelector<HTMLElement>('#main-content, #workspace-content')?.focus();
  });
});

export default router;
