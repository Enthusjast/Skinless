import { createPinia, setActivePinia } from 'pinia';
import { defineComponent } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../stores/auth';
import DashboardView from './DashboardView.vue';

const UiCardStub = defineComponent({
  template: '<div><slot /></div>',
});

const RouterLinkStub = defineComponent({
  props: { to: { type: [String, Object], required: true } },
  template: '<a :href="typeof to === \'string\' ? to : String(to.path)"><slot /></a>',
});

beforeEach(() => {
  setActivePinia(createPinia());
  const auth = useAuthStore();
  auth.user = {
    id: 'user',
    email: 'user@example.com',
    role: 'user',
    createdAt: 0,
    updatedAt: 0,
    profile: {
      id: 'profile',
      name: 'Steve',
      skinHash: 'saved-skin',
      capeHash: null,
      skinModel: 'classic',
    },
  };
  auth.profiles = [auth.user.profile];
  auth.defaultProfileId = auth.user.profile.id;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mountDashboard() {
  return mount(DashboardView, {
    global: {
      stubs: {
        UiCard: UiCardStub,
        RouterLink: RouterLinkStub,
      },
    },
  });
}

describe('DashboardView overview', () => {
  it('shows account state and quick actions without detail forms', () => {
    const wrapper = mountDashboard();

    expect(wrapper.get('.profile-summary-main h2').text()).toBe('Steve');
    expect(wrapper.get('.overview-asset-status strong').text()).toBe('已设置');
    expect(wrapper.findAll('.quick-action-card')).toHaveLength(4);
    expect(wrapper.find('a[href="/dashboard/appearance"]').exists()).toBe(true);
    expect(wrapper.find('a[href="/dashboard/security"]').exists()).toBe(true);
    expect(wrapper.find('.upload-card').exists()).toBe(false);
    expect(wrapper.find('#current-password').exists()).toBe(false);
    expect(wrapper.find('.profile-management').exists()).toBe(false);
  });

  it('refreshes overview state when the default profile changes', async () => {
    const secondProfile = {
      id: 'profile-2',
      name: 'SecondPlayer',
      skinHash: 'second-skin',
      capeHash: 'second-cape',
      skinModel: 'slim' as const,
    };
    const auth = useAuthStore();
    auth.profiles = [auth.user!.profile, secondProfile];
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          user: { ...auth.user, profile: secondProfile },
          profiles: [auth.user!.profile, secondProfile],
          defaultProfileId: secondProfile.id,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const wrapper = mountDashboard();

    await auth.setDefaultProfile(secondProfile.id);
    await flushPromises();

    expect(wrapper.get('.profile-summary-main h2').text()).toBe('SecondPlayer');
    expect(wrapper.get('.overview-context-list').text()).toContain('Slim');
    expect(wrapper.get('.overview-asset-status strong').text()).toBe('已设置');
  });
});
