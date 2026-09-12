import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api';
import RegisterView from './RegisterView.vue';

const { registerStart, registerVerify, registerResend, push } = vi.hoisted(() => ({
  registerStart: vi.fn(),
  registerVerify: vi.fn(),
  registerResend: vi.fn(),
  push: vi.fn(),
}));

vi.mock('../stores/auth', () => ({
  useAuthStore: () => ({
    registerStart,
    registerVerify,
    registerResend,
  }),
}));

vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
}));

function mountRegister() {
  return mount(RegisterView, {
    global: {
      stubs: {
        RouterLink: { template: '<a><slot /></a>' },
      },
    },
  });
}

async function fillDetails(wrapper: ReturnType<typeof mount>) {
  await wrapper.get('#name').setValue('PlayerOne');
  await wrapper.get('#email').setValue('player@example.com');
  await wrapper.get('#password').setValue('correct-password');
  await wrapper.get('#confirm-password').setValue('correct-password');
}

beforeEach(() => {
  registerStart.mockResolvedValue({
    challengeId: 'challenge-1',
    expiresAt: Date.now() + 10 * 60 * 1000,
    resendAfter: Date.now() + 60 * 1000,
  });
  registerVerify.mockResolvedValue({ user: {} });
  registerResend.mockResolvedValue({
    challengeId: 'challenge-1',
    expiresAt: Date.now() + 10 * 60 * 1000,
    resendAfter: Date.now() + 60 * 1000,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('RegisterView verified two-step flow', () => {
  it('starts registration, exposes the code step, and verifies with keyboard-friendly controls', async () => {
    const wrapper = mountRegister();
    await fillDetails(wrapper);
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(registerStart).toHaveBeenCalledWith(
      'player@example.com',
      'correct-password',
      'PlayerOne',
      '',
    );
    expect(wrapper.get('#verification-code').attributes()).toMatchObject({
      autocomplete: 'one-time-code',
      inputmode: 'numeric',
      maxlength: '6',
    });
    expect(wrapper.text()).toContain('验证码已发送');
    const resend = wrapper.findAll('button').find((button) => button.text().includes('秒后可重发'));
    expect((resend?.element as HTMLButtonElement | undefined)?.disabled).toBe(true);

    await wrapper.get('#verification-code').setValue('731042');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(registerVerify).toHaveBeenCalledWith('challenge-1', '731042');
    expect(push).toHaveBeenCalledWith({ path: '/login', query: { registered: '1' } });
  });

  it('shows exact field errors and loading state for start failures', async () => {
    let resolveStart!: () => void;
    registerStart.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveStart = resolve;
        }),
    );
    const wrapper = mountRegister();
    await fillDetails(wrapper);
    const submit = wrapper.get('form').get('button[type="submit"]');
    const pending = wrapper.get('form').trigger('submit');
    await flushPromises();
    expect((submit.element as HTMLButtonElement).disabled).toBe(true);
    resolveStart();
    await pending;

    registerStart.mockRejectedValueOnce(
      new ApiError(400, 'A valid email address is required.', 'invalid_email'),
    );
    await wrapper.get('#email').setValue('invalid');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.get('#email-error').text()).toBe('请输入有效的邮箱地址。');
  });
});
