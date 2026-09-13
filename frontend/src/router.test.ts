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

  it('exposes canonical and name-alias public profile routes with noindex metadata', () => {
    const canonical = router.getRoutes().find((route) => route.path === '/profiles/:uuid');
    const alias = router.getRoutes().find((route) => route.path === '/profiles/name/:name');

    expect(canonical).toMatchObject({ meta: { noindex: true, publicProfile: true } });
    expect(alias).toMatchObject({ meta: { noindex: true, publicProfile: true } });
  });
});
