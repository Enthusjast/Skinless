import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api';
import RestoreAccountView from './RestoreAccountView.vue';

const { restoreAccount, push } = vi.hoisted(() => ({
  restoreAccount: vi.fn(),
  push: vi.fn(),
}));

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return { ...actual, restoreAccount };
});

vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
  useRoute: () => ({ query: { email: 'player@example.com' } }),
}));

beforeEach(() => {
  restoreAccount.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('RestoreAccountView', () => {
  it('restores an account and sends the user back to login', async () => {
    const wrapper = mount(RestoreAccountView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    });
    await wrapper.get('#restore-email').setValue('player@example.com');
    await wrapper.get('#restore-code').setValue('731042');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(restoreAccount).toHaveBeenCalledWith('player@example.com', '731042');
    expect(push).toHaveBeenCalledWith({ path: '/login', query: { restored: '1' } });
  });

  it('shows a generic error for missing or expired restore codes', async () => {
    restoreAccount.mockRejectedValueOnce(
      new ApiError(
        400,
        'The verification code is invalid or expired.',
        'invalid_verification_code',
      ),
    );
    const wrapper = mount(RestoreAccountView, {
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    });
    await wrapper.get('#restore-email').setValue('player@example.com');
    await wrapper.get('#restore-code').setValue('000000');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toBe('恢复验证码无效或已过期。');
  });
});
