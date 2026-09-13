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
  it('shows loading and diagnostic states', async () => {
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
    expect(wrapper.text()).toContain('认证服务器地址');
    expect(wrapper.text()).toContain('PlayerOne');
  });

  it('reports successful feedback for every copy action', async () => {
    const wrapper = mount(SetupView);
    await flushPromises();

    const copyCases = [
      ['auth-server', diagnostics.authServerUrl],
      ['java-agent', diagnostics.javaAgentArgument],
      ['profile-id', diagnostics.profile.id],
      ['profile-name', diagnostics.profile.name],
      ['profile-texture', diagnostics.profile.textureUrl],
    ] as const;

    for (const [key, value] of copyCases) {
      await wrapper.get(`[data-copy="${key}"]`).trigger('click');
      await flushPromises();
      expect(writeText).toHaveBeenLastCalledWith(value);
      expect(wrapper.get(`[data-copy-feedback="${key}"]`).text()).toContain('已复制');
    }

    expect(writeText).toHaveBeenCalledTimes(copyCases.length);
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

  it('does not render the deployment checks or setup instruction paragraphs', async () => {
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

    expect(wrapper.find('#setup-check-title').exists()).toBe(false);
    expect(wrapper.findAll('.setup-check-row')).toHaveLength(0);
    expect(wrapper.text()).not.toContain('部署检查');
    expect(wrapper.text()).not.toContain('启动器：选择');
    expect(wrapper.text()).not.toContain('服务端：将');
  });
});
