import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProfileManagement from './ProfileManagement.vue';
import { useAuthStore } from '../stores/auth';

const firstProfile = {
  id: 'profile-1',
  name: 'PlayerOne',
  skinHash: null,
  capeHash: null,
  skinModel: 'classic' as const,
};

const secondProfile = {
  id: 'profile-2',
  name: 'SecondPlayer',
  skinHash: 'skin-2',
  capeHash: null,
  skinModel: 'slim' as const,
};

beforeEach(() => {
  setActivePinia(createPinia());
  const auth = useAuthStore();
  auth.user = {
    id: 'user-1',
    email: 'player@example.com',
    role: 'user',
    createdAt: 1,
    updatedAt: 1,
    profile: firstProfile,
  };
  auth.profiles = [firstProfile, secondProfile];
  auth.defaultProfileId = firstProfile.id;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ProfileManagement', () => {
  it('shows UUIDs and a clear selected state, then switches the default profile', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          user: { ...useAuthStore().user, profile: secondProfile },
          profiles: [firstProfile, secondProfile],
          defaultProfileId: secondProfile.id,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const wrapper = mount(ProfileManagement);
    expect(wrapper.get('[data-profile-id="profile-1"]').attributes('aria-pressed')).toBe('true');
    expect(wrapper.get('[data-profile-id="profile-2"]').attributes('aria-pressed')).toBe('false');
    expect(wrapper.text()).toContain('profile-1');
    expect(wrapper.text()).toContain('profile-2');

    await wrapper.get('[data-profile-id="profile-2"]').trigger('click');
    await flushPromises();

    expect(wrapper.get('[data-profile-id="profile-1"]').attributes('aria-pressed')).toBe('false');
    expect(wrapper.get('[data-profile-id="profile-2"]').attributes('aria-pressed')).toBe('true');
  });
});
