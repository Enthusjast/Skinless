import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SetupView from './SetupView.vue';

const { getDiagnostics } = vi.hoisted(() => ({
  getDiagnostics: vi.fn(),
}));

vi.mock('../api', () => ({
  formatApiError: (cause: unknown, fallback: string) =>
    cause instanceof Error ? cause.message : fallback,
  getDiagnostics,
}));

const diagnostics = {
  version: '2.1.0',
  authServerUrl: 'https://skin.example.com/api/yggdrasil',
  javaAgentArgument: '-javaagent:authlib-injector.jar=https://skin.example.com/api/yggdrasil',
  metadataUrl: 'https://skin.example.com/api/yggdrasil',
  metadataReachable: true,
  publicKeyConfigured: true,
  textureDomainConfigured: true,
  profileAvailable: true,
  textureAvailable: true,
  sameOrigin: true,
  ipBindingEnabled: false,
  profile: {
    id: 'profile-1',
    name: 'PlayerOne',
    textureUrl: 'https://skin.example.com/textures/skin-hash',
  },
};

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  getDiagnostics.mockReset();
  getDiagnostics.mockResolvedValue(diagnostics);
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
});

afterEach(() => vi.restoreAllMocks());

describe('SetupView', () => {
  it('shows loading and diagnostic states, then reports successful copies', async () => {
    let resolveDiagnostics!: (value: typeof diagnostics) => void;
    getDiagnostics.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveDiagnostics = resolve;
        }),
    );
    const wrapper = mount(SetupView);

    expect(wrapper.get('[data-state="loading"]').text()).toContain('正在检查');
    resolveDiagnostics(diagnostics);
    await flushPromises();

    expect(wrapper.get('[data-state="ready"]')).toBeTruthy();
    expect(wrapper.text()).toContain('元信息端点');
    expect(wrapper.text()).toContain('PlayerOne');

    await wrapper.get('[data-copy="auth-server"]').trigger('click');
    expect(writeText).toHaveBeenCalledWith(diagnostics.authServerUrl);
    expect(wrapper.get('[data-copy-feedback="auth-server"]').text()).toContain('已复制');
  });

  it('shows a copy failure and retries a failed diagnostics request', async () => {
    getDiagnostics.mockRejectedValueOnce(new Error('network down'));
    const wrapper = mount(SetupView);
    await flushPromises();

    expect(wrapper.get('[data-state="error"]')).toBeTruthy();
    expect(wrapper.get('[role="alert"]').text()).toContain('network down');

    getDiagnostics.mockResolvedValueOnce(diagnostics);
    await wrapper.get('[data-action="retry-diagnostics"]').trigger('click');
    await flushPromises();
    expect(getDiagnostics).toHaveBeenCalledTimes(2);

    writeText.mockRejectedValueOnce(new Error('clipboard unavailable'));
    await wrapper.get('[data-copy="profile-texture"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-copy-feedback="profile-texture"]').text()).toContain('复制失败');
  });

  it('separates required failures from repairable warnings', async () => {
    getDiagnostics.mockResolvedValueOnce({
      ...diagnostics,
      metadataReachable: false,
      publicKeyConfigured: false,
      profileAvailable: false,
      textureAvailable: false,
      sameOrigin: false,
    });
    const wrapper = mount(SetupView);
    await flushPromises();

    expect(wrapper.findAll('.setup-check-row.is-failure')).toHaveLength(2);
    expect(wrapper.findAll('.setup-check-row.is-warning').length).toBeGreaterThan(2);
    expect(wrapper.text()).toContain('确认 Worker 已部署');
    expect(wrapper.text()).toContain('让前端与 API 使用同一域名');
  });
});
