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
    expect(wrapper.text()).toContain('元信息端点');
    expect(wrapper.text()).toContain('PlayerOne');
  });

  it('reports successful feedback for every copy action', async () => {
    const wrapper = mount(SetupView);
    await flushPromises();

    const copyCases = [
      ['auth-server', diagnostics.authServerUrl],
      ['java-agent', diagnostics.javaAgentArgument],
      [
        'launcher-steps',
        '启动器：选择“外置登录（Authlib Injector）”，认证服务器填写上面的地址，再使用 Skinless 注册邮箱和密码登录。',
      ],
      [
        'server-steps',
        `服务端：将 -javaagent:authlib-injector.jar=${diagnostics.authServerUrl} 加入 Java 启动参数，并在 server.properties 中设置 online-mode=false。`,
      ],
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
