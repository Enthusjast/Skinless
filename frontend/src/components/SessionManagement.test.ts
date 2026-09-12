import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearCsrfToken, setCsrfToken } from '../api';
import SessionManagement from './SessionManagement.vue';

const sessions = [
  {
    id: 'current-session',
    deviceLabel: 'Chrome on macOS',
    createdAt: 1_700_000_000_000,
    lastUsedAt: 1_700_000_100_000,
    current: true,
  },
  {
    id: 'phone-session',
    deviceLabel: 'Chrome on Android',
    createdAt: 1_700_000_000_000,
    lastUsedAt: 1_700_000_200_000,
    current: false,
  },
];

const sessionResponse = {
  sessions: sessions.map((session) => ({
    ...session,
    ip: '203.0.113.10',
    token: 'refresh-secret',
    userAgent: 'Mozilla/5.0 (Linux; Android 14)',
  })),
};

afterEach(() => {
  vi.unstubAllGlobals();
  clearCsrfToken();
});

describe('SessionManagement', () => {
  it('lists safe session metadata and revokes one non-current session', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(sessionResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    setCsrfToken('csrf-token');

    const wrapper = mount(SessionManagement);
    await flushPromises();

    expect(wrapper.text()).toContain('Chrome on macOS');
    expect(wrapper.text()).toContain('Chrome on Android');
    expect(wrapper.text()).toContain('当前设备');
    expect(wrapper.text()).not.toContain('203.0.113.10');
    expect(wrapper.text()).not.toContain('Mozilla/5.0');
    expect(wrapper.text()).not.toContain('refresh-secret');

    await wrapper.get('[aria-label="撤销 Chrome on Android 的会话"]').trigger('click');
    await flushPromises();

    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/auth/sessions/phone-session');
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ credentials: 'same-origin', method: 'DELETE' }),
    );
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('X-CSRF-Token')).toBe(
      'csrf-token',
    );
    expect(wrapper.text()).not.toContain('Chrome on Android');
  });

  it('revokes all other sessions while keeping the current device listed', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(sessionResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    setCsrfToken('csrf-token');

    const wrapper = mount(SessionManagement);
    await flushPromises();
    await wrapper.get('button').trigger('click');
    await flushPromises();

    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/auth/sessions?scope=other');
    expect(wrapper.text()).toContain('Chrome on macOS');
    expect(wrapper.text()).not.toContain('Chrome on Android');
  });
});
