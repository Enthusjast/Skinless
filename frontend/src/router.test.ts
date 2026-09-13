import { describe, expect, it } from 'vitest';
import router from './router';

describe('workspace routes', () => {
  it('exposes the authenticated launcher setup route with Chinese-first metadata', () => {
    const setupRoute = router.getRoutes().find((route) => route.path === '/dashboard/setup');

    expect(setupRoute).toMatchObject({
      path: '/dashboard/setup',
      meta: {
        requiresAuth: true,
        title: '启动器设置',
        description: '复制启动器参数并检查当前部署。',
      },
    });
  });

  it('exposes dedicated appearance and security workspace routes', () => {
    const appearance = router.getRoutes().find((route) => route.path === '/dashboard/appearance');
    const security = router.getRoutes().find((route) => route.path === '/dashboard/security');

    expect(appearance).toMatchObject({
      path: '/dashboard/appearance',
      meta: { title: '角色外观', description: '管理 Profile、模型和皮肤纹理。' },
    });
    expect(security).toMatchObject({
      path: '/dashboard/security',
      meta: { title: '账户安全', description: '管理密码、邮箱、会话和账号生命周期。' },
    });
  });

  it('exposes canonical and name-alias public profile routes with noindex metadata', () => {
    const canonical = router.getRoutes().find((route) => route.path === '/profiles/:uuid');
    const alias = router.getRoutes().find((route) => route.path === '/profiles/name/:name');

    expect(canonical).toMatchObject({ meta: { noindex: true, publicProfile: true } });
    expect(alias).toMatchObject({ meta: { noindex: true, publicProfile: true } });
  });

  it('provides a public fallback route for unknown paths', () => {
    const fallback = router.getRoutes().find((route) => route.path === '/:pathMatch(.*)*');

    expect(fallback).toMatchObject({ path: '/:pathMatch(.*)*', meta: { title: '页面不存在' } });
  });
});
