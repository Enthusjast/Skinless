import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminView from './AdminView.vue';
import { useAuthStore } from '../stores/auth';

const {
  createAdminInvite,
  getAdminInvites,
  getAdminAuditLogs,
  getAdminSettings,
  getAdminUsers,
  deleteAdminUser,
  revokeAdminUserSessions,
  revokeAdminInvite,
  updateAdminSettings,
  updateAdminUserStatus,
  updateUserRole,
} = vi.hoisted(() => ({
  createAdminInvite: vi.fn(),
  deleteAdminUser: vi.fn(),
  getAdminAuditLogs: vi.fn(),
  getAdminInvites: vi.fn(),
  getAdminSettings: vi.fn(),
  getAdminUsers: vi.fn(),
  revokeAdminUserSessions: vi.fn(),
  revokeAdminInvite: vi.fn(),
  updateAdminSettings: vi.fn(),
  updateAdminUserStatus: vi.fn(),
  updateUserRole: vi.fn(),
}));

vi.mock('../api', () => ({
  formatApiError: (cause: unknown, fallback: string) =>
    cause instanceof Error ? cause.message : fallback,
  createAdminInvite,
  deleteAdminUser,
  getAdminAuditLogs,
  getAdminInvites,
  getAdminSettings,
  getAdminUsers,
  revokeAdminUserSessions,
  revokeAdminInvite,
  updateAdminSettings,
  updateAdminUserStatus,
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

const managedUser = {
  id: 'user-1',
  email: 'player@example.com',
  role: 'user' as const,
  status: 'active' as const,
  deletionRequestedAt: null,
  createdAt: 2,
  updatedAt: 2,
  profile: {
    id: 'profile-user-1',
    name: 'PlayerOne',
    skinHash: null,
    capeHash: null,
    skinModel: 'classic' as const,
  },
};

const auditLog = {
  id: 'audit-1',
  actorUserId: 'admin-1',
  targetUserId: 'user-1',
  targetResource: 'user:user-1',
  action: 'admin.user.status.update',
  result: 'success' as const,
  requestId: 'request-1',
  metadata: { password: 'must-not-render' },
  createdAt: 3,
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
  getAdminAuditLogs.mockResolvedValue({ logs: [], limit: 25, offset: 0, hasMore: false });
  updateAdminSettings.mockResolvedValue({
    settings: { ...settings, registrationMode: 'invite', enforceJoinIp: true },
  });
  createAdminInvite.mockResolvedValue({ invite: { ...invite, code: 'secret-code' } });
  revokeAdminInvite.mockResolvedValue({ invite: { ...invite, revokedAt: 2 } });
  updateAdminUserStatus.mockResolvedValue({ user: { ...managedUser, status: 'disabled' } });
  revokeAdminUserSessions.mockResolvedValue(undefined);
  deleteAdminUser.mockResolvedValue(undefined);
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

    await wrapper.get('select[name="invite-use-limit"]').setValue('10');
    await wrapper.get('select[name="invite-expires-preset"]').setValue('custom');
    await wrapper.get('input[name="invite-expires-at"]').setValue('2030-01-01T00:00');
    await wrapper.get('textarea[name="invite-note"]').setValue('Launch group');
    await wrapper.get('form.admin-invite-form').trigger('submit');
    await flushPromises();
    expect(createAdminInvite).toHaveBeenCalledWith({
      useLimit: 10,
      expiresAt: Date.parse('2030-01-01T00:00'),
      note: 'Launch group',
    });
    expect(wrapper.get('[data-state="invite-created"]').text()).toContain('secret-code');

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    await wrapper.get('[data-action="copy-invite"]').trigger('click');
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith('secret-code');
    expect(wrapper.get('[data-action="copy-invite"]').text()).toContain('已复制');

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

describe('AdminView audit logs', () => {
  it('renders read-only logs without metadata and reloads with action, actor, target, and date filters', async () => {
    getAdminAuditLogs
      .mockResolvedValueOnce({ logs: [{ ...auditLog }], limit: 25, offset: 0, hasMore: true })
      .mockResolvedValueOnce({ logs: [], limit: 25, offset: 0, hasMore: false });
    const wrapper = mount(AdminView);
    await flushPromises();

    expect(wrapper.get('[data-audit-id="audit-1"]').text()).toContain('admin.user.status.update');
    expect(wrapper.text()).not.toContain('must-not-render');
    expect(wrapper.find('[data-state="audit-next"]').exists()).toBeTruthy();

    await wrapper.get('select[name="audit-action"]').setValue('admin.user.status.update');
    await wrapper.get('input[name="audit-actor"]').setValue('admin-1');
    await wrapper.get('input[name="audit-target"]').setValue('user-1');
    await wrapper.get('input[name="audit-date-from"]').setValue('2026-09-01');
    await wrapper.get('input[name="audit-date-to"]').setValue('2026-09-13');
    await wrapper.get('form.admin-audit-filters').trigger('submit');
    await flushPromises();

    expect(getAdminAuditLogs).toHaveBeenLastCalledWith({
      limit: 25,
      offset: 0,
      action: 'admin.user.status.update',
      actorUserId: 'admin-1',
      targetUserId: 'user-1',
      from: '2026-09-01',
      to: '2026-09-13',
    });
    expect(wrapper.find('[data-state="audit-empty"]').exists()).toBeTruthy();
  });

  it('shows audit loading and error states', async () => {
    let rejectAudit!: (cause: Error) => void;
    getAdminAuditLogs.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectAudit = reject;
        }),
    );
    const wrapper = mount(AdminView);
    expect(wrapper.get('[data-state="audit-loading"]')).toBeTruthy();

    rejectAudit(new Error('audit unavailable'));
    await flushPromises();
    expect(wrapper.get('[data-state="audit-error"]').text()).toContain('audit unavailable');
  });
});

describe('AdminView account controls', () => {
  it('requires typed confirmation, shows status, and refreshes the row after disabling', async () => {
    getAdminUsers
      .mockResolvedValueOnce({ users: [{ ...managedUser }] })
      .mockResolvedValueOnce({ users: [{ ...managedUser, status: 'disabled' }] });

    const wrapper = mount(AdminView);
    await flushPromises();

    expect(wrapper.get('[data-status="active"]').text()).toContain('正常');
    await wrapper.get('[data-action="open-user-actions"]').trigger('click');
    await wrapper.get('[data-action="disable-user"]').trigger('click');

    const confirm = wrapper.get('[data-action="confirm-user-action"]');
    expect((confirm.element as HTMLButtonElement).disabled).toBe(true);
    await wrapper.get('input[name="admin-confirmation"]').setValue('DISABLE');
    expect((confirm.element as HTMLButtonElement).disabled).toBe(false);
    await confirm.trigger('click');
    await flushPromises();

    expect(updateAdminUserStatus).toHaveBeenCalledWith('user-1', 'disabled', 'DISABLE');
    expect(getAdminUsers).toHaveBeenCalledTimes(2);
    expect(wrapper.get('[data-status="disabled"]').text()).toContain('已禁用');
    expect(wrapper.get('[data-state="user-action-success"]').text()).toContain('已禁用');
  });

  it('requires typed confirmation and exposes loading and success state while deleting', async () => {
    getAdminUsers
      .mockResolvedValueOnce({ users: [{ ...managedUser }] })
      .mockResolvedValueOnce({ users: [] });
    let finishDelete!: () => void;
    deleteAdminUser.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishDelete = resolve;
        }),
    );

    const wrapper = mount(AdminView);
    await flushPromises();
    await wrapper.get('[data-action="open-user-actions"]').trigger('click');
    await wrapper.get('[data-action="delete-user"]').trigger('click');
    const confirm = wrapper.get('[data-action="confirm-user-action"]');
    expect((confirm.element as HTMLButtonElement).disabled).toBe(true);
    await wrapper.get('input[name="admin-confirmation"]').setValue('DELETE');
    await confirm.trigger('click');
    expect(confirm.text()).toContain('处理中…');
    expect((confirm.element as HTMLButtonElement).disabled).toBe(true);

    finishDelete();
    await flushPromises();
    expect(deleteAdminUser).toHaveBeenCalledWith('user-1', 'DELETE');
    expect(wrapper.get('[data-state="user-action-success"]').text()).toContain('已永久删除');
    expect(wrapper.text()).toContain('还没有用户');
  });

  it('keeps the confirmation dialog open and shows a failed deletion', async () => {
    getAdminUsers.mockResolvedValueOnce({ users: [{ ...managedUser }] });
    deleteAdminUser.mockRejectedValueOnce(new Error('delete unavailable'));

    const wrapper = mount(AdminView);
    await flushPromises();
    await wrapper.get('[data-action="open-user-actions"]').trigger('click');
    await wrapper.get('[data-action="delete-user"]').trigger('click');
    await wrapper.get('input[name="admin-confirmation"]').setValue('DELETE');
    await wrapper.get('[data-action="confirm-user-action"]').trigger('click');
    await flushPromises();

    expect(deleteAdminUser).toHaveBeenCalledWith('user-1', 'DELETE');
    expect(wrapper.get('.admin-confirmation-modal [role="alert"]').text()).toContain(
      'delete unavailable',
    );
    expect(wrapper.get('[data-action="confirm-user-action"]')).toBeTruthy();
  });

  it('keeps the confirmation dialog open and shows a failed session revocation', async () => {
    getAdminUsers.mockResolvedValueOnce({ users: [{ ...managedUser }] });
    revokeAdminUserSessions.mockRejectedValueOnce(new Error('session revoke failed'));

    const wrapper = mount(AdminView);
    await flushPromises();
    await wrapper.get('[data-action="open-user-actions"]').trigger('click');
    await wrapper.get('[data-action="revoke-user-sessions"]').trigger('click');
    await wrapper.get('input[name="admin-confirmation"]').setValue('REVOKE');
    await wrapper.get('[data-action="confirm-user-action"]').trigger('click');
    await flushPromises();

    expect(revokeAdminUserSessions).toHaveBeenCalledWith('user-1', 'REVOKE');
    expect(wrapper.get('.admin-confirmation-modal [role="alert"]').text()).toContain(
      'session revoke failed',
    );
    expect(wrapper.get('[data-action="confirm-user-action"]')).toBeTruthy();
  });

  it('revokes all sessions with typed confirmation and reports loading and success', async () => {
    getAdminUsers
      .mockResolvedValueOnce({ users: [{ ...managedUser }] })
      .mockResolvedValueOnce({ users: [{ ...managedUser }] });
    let finishRevoke!: () => void;
    revokeAdminUserSessions.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishRevoke = resolve;
        }),
    );

    const wrapper = mount(AdminView);
    await flushPromises();
    await wrapper.get('[data-action="open-user-actions"]').trigger('click');
    await wrapper.get('[data-action="revoke-user-sessions"]').trigger('click');
    await wrapper.get('input[name="admin-confirmation"]').setValue('REVOKE');
    const confirm = wrapper.get('[data-action="confirm-user-action"]');
    await confirm.trigger('click');
    expect(confirm.text()).toContain('处理中…');

    finishRevoke();
    await flushPromises();
    expect(revokeAdminUserSessions).toHaveBeenCalledWith('user-1', 'REVOKE');
    expect(wrapper.get('[data-state="user-action-success"]').text()).toContain('全部会话已撤销');
  });

  it('enables a disabled account without confirmation and reports loading and success', async () => {
    const disabledUser = { ...managedUser, status: 'disabled' as const };
    getAdminUsers
      .mockResolvedValueOnce({ users: [disabledUser] })
      .mockResolvedValueOnce({ users: [{ ...managedUser }] });
    let finishEnable!: () => void;
    updateAdminUserStatus.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishEnable = resolve;
        }),
    );

    const wrapper = mount(AdminView);
    await flushPromises();
    await wrapper.get('[data-action="open-user-actions"]').trigger('click');
    await wrapper.get('[data-action="enable-user"]').trigger('click');
    const confirm = wrapper.get('[data-action="confirm-user-action"]');
    expect((confirm.element as HTMLButtonElement).disabled).toBe(false);
    await confirm.trigger('click');
    expect(confirm.text()).toContain('处理中…');

    finishEnable();
    await flushPromises();
    expect(updateAdminUserStatus).toHaveBeenCalledWith('user-1', 'active');
    expect(wrapper.get('[data-state="user-action-success"]').text()).toContain('已启用');
  });

  it('demotes an administrator through typed confirmation and reports loading and success', async () => {
    const managedAdmin = { ...managedUser, role: 'admin' as const };
    getAdminUsers
      .mockResolvedValueOnce({ users: [managedAdmin] })
      .mockResolvedValueOnce({ users: [{ ...managedUser }] });
    let finishDemote!: () => void;
    updateUserRole.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishDemote = resolve;
        }),
    );

    const wrapper = mount(AdminView);
    await flushPromises();
    const roleSelect = wrapper.findAll('select[aria-label="修改 PlayerOne 的角色"]')[0];
    await roleSelect.setValue('user');
    await wrapper.get('input[name="admin-confirmation"]').setValue('DEMOTE');
    const confirm = wrapper.get('[data-action="confirm-user-action"]');
    await confirm.trigger('click');
    expect(confirm.text()).toContain('处理中…');

    finishDemote();
    await flushPromises();
    expect(updateUserRole).toHaveBeenCalledWith('user-1', 'user', 'DEMOTE');
    expect(wrapper.get('[data-state="user-action-success"]').text()).toContain('移除管理员角色');
  });
});
