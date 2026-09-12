import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api';
import PasswordResetView from './PasswordResetView.vue';

const { startPasswordReset, verifyPasswordReset, resendPasswordReset, push } = vi.hoisted(() => ({
  startPasswordReset: vi.fn(),
  verifyPasswordReset: vi.fn(),
  resendPasswordReset: vi.fn(),
  push: vi.fn(),
}));

vi.mock('../stores/auth', () => ({
  useAuthStore: () => ({
    startPasswordReset,
    verifyPasswordReset,
    resendPasswordReset,
  }),
}));

vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
}));

function mountView() {
  return mount(PasswordResetView, {
    global: {
      stubs: {
        RouterLink: { template: '<a><slot /></a>' },
      },
    },
  });
}

beforeEach(() => {
  startPasswordReset.mockResolvedValue({
    message: 'If an account exists for this email, a password reset code has been sent.',
    challengeId: 'reset-1',
    expiresAt: Date.now() + 10 * 60 * 1000,
    resendAfter: Date.now() + 60 * 1000,
  });
  verifyPasswordReset.mockResolvedValue(undefined);
  resendPasswordReset.mockResolvedValue({
    message: 'If an account exists for this email, a password reset code has been sent.',
    challengeId: 'reset-1',
    expiresAt: Date.now() + 10 * 60 * 1000,
    resendAfter: Date.now() + 60 * 1000,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('PasswordResetView', () => {
  it('shows the code and new-password step after a generic reset start', async () => {
    const wrapper = mountView();
    await wrapper.get('#email').setValue('player@example.com');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(startPasswordReset).toHaveBeenCalledWith('player@example.com');
    expect(wrapper.get('#verification-code').attributes()).toMatchObject({
      autocomplete: 'one-time-code',
      inputmode: 'numeric',
      maxlength: '6',
    });
    expect(wrapper.text()).toContain('验证码已发送');
    const resend = wrapper.findAll('button').find((button) => button.text().includes('秒后可重发'));
    expect((resend?.element as HTMLButtonElement | undefined)?.disabled).toBe(true);

    await wrapper.get('#verification-code').setValue('731042');
    await wrapper.get('#new-password').setValue('updated-password');
    await wrapper.get('#confirm-password').setValue('updated-password');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(verifyPasswordReset).toHaveBeenCalledWith('reset-1', '731042', 'updated-password');
    expect(push).toHaveBeenCalledWith({ path: '/login', query: { reset: '1' } });
  });

  it('shows the exact verification error and preserves loading semantics', async () => {
    let resolveStart!: (value: unknown) => void;
    startPasswordReset.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStart = resolve;
        }),
    );
    const wrapper = mountView();
    await wrapper.get('#email').setValue('player@example.com');
    const pending = wrapper.get('form').trigger('submit');
    await flushPromises();
    expect((wrapper.get('button[type="submit"]').element as HTMLButtonElement).disabled).toBe(true);
    resolveStart({
      message: 'If an account exists for this email, a password reset code has been sent.',
      challengeId: 'reset-1',
      expiresAt: Date.now() + 10 * 60 * 1000,
      resendAfter: Date.now() + 60 * 1000,
    });
    await pending;
    await flushPromises();

    verifyPasswordReset.mockRejectedValueOnce(
      new ApiError(
        400,
        'The verification code is invalid or expired.',
        'invalid_verification_code',
      ),
    );
    await wrapper.get('#verification-code').setValue('000000');
    await wrapper.get('#new-password').setValue('updated-password');
    await wrapper.get('#confirm-password').setValue('updated-password');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(wrapper.get('#verification-code-error').text()).toBe('验证码无效或已过期。');
  });
});
