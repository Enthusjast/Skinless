import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AccountDeletion from './AccountDeletion.vue';

const { requestAccountDeletion, clearSession, push } = vi.hoisted(() => ({
  requestAccountDeletion: vi.fn(),
  clearSession: vi.fn(),
  push: vi.fn(),
}));

vi.mock('../stores/auth', () => ({
  useAuthStore: () => ({
    user: { email: 'player@example.com' },
    requestAccountDeletion,
    clearSession,
  }),
}));

vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
}));

beforeEach(() => {
  requestAccountDeletion.mockResolvedValue({
    challengeId: 'restore-1',
    deletionAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    status: 'pending_deletion',
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('AccountDeletion', () => {
  it('requires typed confirmation and current password, then clears the session', async () => {
    const wrapper = mount(AccountDeletion);

    expect(wrapper.text()).toContain('7 天');
    expect(wrapper.text()).toContain('所有登录会话');
    await wrapper.get('#delete-account-password').setValue('correct-password');
    await wrapper.get('#delete-account-confirmation').setValue('DELETE');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(requestAccountDeletion).toHaveBeenCalledWith('correct-password', 'DELETE');
    expect(clearSession).toHaveBeenCalledOnce();
    expect(push).toHaveBeenCalledWith({
      path: '/restore-account',
      query: { email: 'player@example.com', pending: '1' },
    });
  });

  it('keeps the danger-zone form busy while the deletion request is pending', async () => {
    let resolveRequest!: (value: unknown) => void;
    requestAccountDeletion.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const wrapper = mount(AccountDeletion);
    await wrapper.get('#delete-account-password').setValue('correct-password');
    await wrapper.get('#delete-account-confirmation').setValue('DELETE');
    const pending = wrapper.get('form').trigger('submit');
    await flushPromises();
    expect((wrapper.get('button[type="submit"]').element as HTMLButtonElement).disabled).toBe(true);

    resolveRequest({
      challengeId: 'restore-1',
      deletionAt: Date.now(),
      status: 'pending_deletion',
    });
    await pending;
    await flushPromises();
    expect(clearSession).toHaveBeenCalledOnce();
  });
});
