import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api';
import EmailChangeForm from './EmailChangeForm.vue';

const { startEmailChange, completeEmailChange, resendEmailChange } = vi.hoisted(() => ({
  startEmailChange: vi.fn(),
  completeEmailChange: vi.fn(),
  resendEmailChange: vi.fn(),
}));

vi.mock('../stores/auth', () => ({
  useAuthStore: () => ({
    user: { email: 'player@example.com' },
    startEmailChange,
    completeEmailChange,
    resendEmailChange,
  }),
}));

beforeEach(() => {
  startEmailChange.mockResolvedValue({
    challengeId: 'email-1',
    email: 'new@example.com',
    expiresAt: Date.now() + 10 * 60 * 1000,
    resendAfter: Date.now() + 60 * 1000,
  });
  completeEmailChange.mockResolvedValue({ email: 'new@example.com' });
  resendEmailChange.mockResolvedValue({
    challengeId: 'email-1',
    email: 'new@example.com',
    expiresAt: Date.now() + 10 * 60 * 1000,
    resendAfter: Date.now() + 60 * 1000,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('EmailChangeForm', () => {
  it('verifies the new email and shows success after the code is accepted', async () => {
    const wrapper = mount(EmailChangeForm, {
      global: {
        stubs: {
          TurnstileWidget: {
            template:
              '<button data-turnstile-test type="button" @click="$emit(\'token\', \'widget-token\')">Turnstile</button>',
          },
        },
      },
    });
    await wrapper.get('#email-current-password').setValue('correct-password');
    await wrapper.get('#new-email').setValue('new@example.com');
    await wrapper.get('[data-turnstile-test]').trigger('click');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(startEmailChange).toHaveBeenCalledWith(
      'correct-password',
      'new@example.com',
      'widget-token',
    );
    expect(wrapper.get('#email-change-code')).toBeTruthy();
    const resend = wrapper.findAll('button').find((button) => button.text().includes('秒后可重发'));
    expect((resend?.element as HTMLButtonElement | undefined)?.disabled).toBe(true);

    await wrapper.get('#email-change-code').setValue('042731');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(completeEmailChange).toHaveBeenCalledWith('email-1', '042731', 'correct-password');
    expect(wrapper.text()).toContain('邮箱已更新');
  });

  it('shows the current-password error and keeps it on the first step', async () => {
    startEmailChange.mockRejectedValueOnce(
      new ApiError(403, 'The current password is incorrect.', 'current_password_incorrect'),
    );
    const wrapper = mount(EmailChangeForm);
    await wrapper.get('#email-current-password').setValue('wrong-password');
    await wrapper.get('#new-email').setValue('new@example.com');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(wrapper.get('#email-current-password-error').text()).toBe('当前密码不正确。');
    expect(wrapper.find('#email-change-code').exists()).toBe(false);
  });
});
