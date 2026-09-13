import { createMemoryHistory, createRouter } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import { useAuthStore } from '../stores/auth';
import WorkspaceLayout from './WorkspaceLayout.vue';

describe('WorkspaceLayout navigation', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('shows the authenticated launcher setup entry and marks it active', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: defineComponent({ template: '<div />' }) },
        { path: '/dashboard', component: defineComponent({ template: '<div />' }) },
        { path: '/dashboard/wardrobe', component: defineComponent({ template: '<div />' }) },
        { path: '/dashboard/setup', component: defineComponent({ template: '<div />' }) },
        { path: '/admin', component: defineComponent({ template: '<div />' }) },
      ],
    });
    await router.push('/dashboard/setup');
    await router.isReady();

    const auth = useAuthStore();
    auth.user = {
      id: 'user-1',
      email: 'player@example.com',
      role: 'user',
      createdAt: 1,
      updatedAt: 1,
      profile: {
        id: 'profile-1',
        name: 'PlayerOne',
        skinHash: null,
        capeHash: null,
        skinModel: 'classic',
      },
    };

    const wrapper = mount(WorkspaceLayout, {
      global: {
        plugins: [router],
        stubs: {
          PageHeader: true,
          ThemeToggle: true,
          RouterView: true,
        },
      },
    });

    const setupLink = wrapper.get('a[href="/dashboard/setup"]');
    expect(setupLink.text()).toContain('启动器设置');
    expect(setupLink.classes()).toContain('active');
  });
});
