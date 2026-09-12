import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminView from './AdminView.vue';
import { useAuthStore } from '../stores/auth';

const {
  createAdminInvite,
  getAdminInvites,
  getAdminSettings,
  getAdminUsers,
  revokeAdminInvite,
  updateAdminSettings,
  updateUserRole,
} = vi.hoisted(() => ({
  createAdminInvite: vi.fn(),
  getAdminInvites: vi.fn(),
  getAdminSettings: vi.fn(),
  getAdminUsers: vi.fn(),
  revokeAdminInvite: vi.fn(),
  updateAdminSettings: vi.fn(),
  updateUserRole: vi.fn(),
}));

vi.mock('../api', () => ({
  formatApiError: (cause: unknown, fallback: string) =>
    cause instanceof Error ? cause.message : fallback,
  createAdminInvite,
  getAdminInvites,
  getAdminSettings,
  getAdminUsers,
  revokeAdminInvite,
  updateAdminSettings,
  updateUserRole,
}));

const settings = {
  registrationMode: 'open' as const,
  maxProfilesPerUser: 5,
  maxTexturesPerUser: 50,
  enforceJoinIp: false,
  createdAt: 1,
  updatedAt: 1,
};

const invite = {
  id: 'invite-1',
  codePrefix: 'abcd1234',
  createdBy: 'admin-1',
  useCount: 0,
  useLimit: 2,
  expiresAt: null,
  note: 'Launch group',
  revokedAt: null,
  createdAt: 1,
  updatedAt: 1,
};

beforeEach(() => {
  setActivePinia(createPinia());
  const auth = useAuthStore();
  auth.user = {
    id: 'admin-1',
    email: 'admin@example.com',
    role: 'admin',
    createdAt: 1,
    updatedAt: 1,
    profile: {
      id: 'profile-1',
      name: 'Admin',
      skinHash: null,
      capeHash: null,
      skinModel: 'classic',
    },
  };
  auth.profiles = [auth.user.profile];
  getAdminUsers.mockResolvedValue({ users: [] });
  getAdminSettings.mockResolvedValue({ settings: { ...settings } });
  getAdminInvites.mockResolvedValue({ invites: [{ ...invite }] });
  updateAdminSettings.mockResolvedValue({
    settings: { ...settings, registrationMode: 'invite', enforceJoinIp: true },
  });
  createAdminInvite.mockResolvedValue({ invite: { ...invite, code: 'secret-code' } });
  revokeAdminInvite.mockResolvedValue({ invite: { ...invite, revokedAt: 2 } });
});

afterEach(() => vi.clearAllMocks());

describe('AdminView registration controls', () => {
  it('loads settings and invites, saves settings, creates a one-time code, and revokes it', async () => {
    const wrapper = mount(AdminView);
    await flushPromises();

    expect(
      (wrapper.get('select[name="registration-mode"]').element as HTMLSelectElement).value,
    ).toBe('open');
    expect(wrapper.get('[data-invite-id="invite-1"]').text()).toContain('abcd1234');
    expect(wrapper.text()).not.toContain('secret-code');

    await wrapper.get('select[name="registration-mode"]').setValue('invite');
    await wrapper.get('input[name="max-profiles-per-user"]').setValue('7');
    await wrapper.get('input[name="max-textures-per-user"]').setValue('80');
    await wrapper.get('input[name="enforce-join-ip"]').setValue(true);
    await wrapper.get('form.admin-settings-form').trigger('submit');
    await flushPromises();
    expect(updateAdminSettings).toHaveBeenCalledWith({
      registrationMode: 'invite',
      maxProfilesPerUser: 7,
      maxTexturesPerUser: 80,
      enforceJoinIp: true,
    });

    await wrapper.get('input[name="invite-use-limit"]').setValue('2');
    await wrapper.get('textarea[name="invite-note"]').setValue('Launch group');
    await wrapper.get('form.admin-invite-form').trigger('submit');
    await flushPromises();
    expect(createAdminInvite).toHaveBeenCalledWith({
      useLimit: 2,
      expiresAt: null,
      note: 'Launch group',
    });
    expect(wrapper.get('[data-state="invite-created"]').text()).toContain('secret-code');

    await wrapper.get('[data-action="revoke-invite"]').trigger('click');
    await flushPromises();
    expect(revokeAdminInvite).toHaveBeenCalledWith('invite-1');
  });

  it('shows a loading state before settings resolve and an error state when loading fails', async () => {
    getAdminSettings.mockReset();
    let rejectSettings!: (cause: Error) => void;
    getAdminSettings.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectSettings = reject;
        }),
    );
    const wrapper = mount(AdminView);
    expect(wrapper.get('[data-state="settings-loading"]')).toBeTruthy();
    rejectSettings(new Error('settings unavailable'));
    await flushPromises();
    expect(wrapper.get('[data-state="settings-error"]').text()).toContain('settings unavailable');

    getAdminSettings.mockResolvedValue({ settings: { ...settings } });
    await wrapper.get('[data-action="reload-registration-settings"]').trigger('click');
    await flushPromises();
    expect(
      (wrapper.get('select[name="registration-mode"]').element as HTMLSelectElement).value,
    ).toBe('open');
  });
});
