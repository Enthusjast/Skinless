import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api';
import PublicProfileView from './PublicProfileView.vue';

const { getPublicProfileById, getPublicProfileByName } = vi.hoisted(() => ({
  getPublicProfileById: vi.fn(),
  getPublicProfileByName: vi.fn(),
}));
const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
const route = vi.hoisted(() => ({ params: { uuid: 'a'.repeat(32) }, meta: { noindex: true } }));

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return { ...actual, getPublicProfileById, getPublicProfileByName };
});

vi.mock('vue-router', () => ({
  useRoute: () => route,
  useRouter: () => ({ replace }),
}));

const profile = {
  id: 'a'.repeat(32),
  name: 'PlayerOne',
  model: 'slim' as const,
  skin: { url: '/textures/skin-hash', metadata: { model: 'slim' as const } },
  cape: { url: '/textures/cape-hash' },
};

beforeEach(() => {
  getPublicProfileById.mockReset();
  getPublicProfileByName.mockReset();
  replace.mockReset();
  route.params = { uuid: profile.id };
  getPublicProfileById.mockResolvedValue(profile);
  getPublicProfileByName.mockResolvedValue(null);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

afterEach(() => vi.restoreAllMocks());

describe('PublicProfileView', () => {
  it('shows the public profile, no account metadata, downloads, and keyboard controls', async () => {
    const wrapper = mount(PublicProfileView, {
      global: { stubs: { SkinPreview: true } },
    });
    await flushPromises();

    expect(wrapper.get('[data-state="ready"]')).toBeTruthy();
    expect(wrapper.text()).toContain('PlayerOne');
    expect(wrapper.text()).toContain(profile.id);
    expect(wrapper.text()).not.toContain('email');
    expect(wrapper.text()).not.toContain('管理员');
    expect(wrapper.get('[data-download="skin"]')).toMatchObject({ element: expect.anything() });
    expect(wrapper.get('[data-download="skin"]').attributes('href')).toBe(profile.skin.url);
    expect(wrapper.get('[data-download="skin"]').attributes('download')).toBe('PlayerOne-skin.png');
    expect(wrapper.get('[data-download="cape"]').attributes('href')).toBe(profile.cape.url);
    expect(wrapper.get('[data-action="copy-uuid"]').attributes('type')).toBe('button');
    expect(wrapper.get('[data-action="copy-uuid"]').attributes('aria-label')).toContain('UUID');
  });

  it('redirects a name alias to the UUID page', async () => {
    route.params = { uuid: 'PlayerOne' };
    getPublicProfileById.mockRejectedValueOnce(
      new ApiError(404, 'Profile not found.', 'profile_not_found'),
    );
    getPublicProfileByName.mockResolvedValueOnce(profile);

    mount(PublicProfileView, { global: { stubs: { SkinPreview: true } } });
    await flushPromises();

    expect(getPublicProfileByName).toHaveBeenCalledWith('PlayerOne');
    expect(replace).toHaveBeenCalledWith(`/profiles/${profile.id}`);
  });

  it('renders not-found, error, and missing-asset states', async () => {
    getPublicProfileById.mockRejectedValueOnce(
      new ApiError(404, 'Profile not found.', 'profile_not_found'),
    );
    const missing = mount(PublicProfileView, { global: { stubs: { SkinPreview: true } } });
    await flushPromises();
    expect(missing.get('[data-state="not-found"]')).toBeTruthy();

    getPublicProfileById.mockRejectedValueOnce(new Error('network down'));
    const failed = mount(PublicProfileView, { global: { stubs: { SkinPreview: true } } });
    await flushPromises();
    expect(failed.get('[data-state="error"]')).toBeTruthy();

    getPublicProfileById.mockResolvedValueOnce({ ...profile, skin: null, cape: null });
    const empty = mount(PublicProfileView, { global: { stubs: { SkinPreview: true } } });
    await flushPromises();
    expect(empty.get('[data-state="ready"]')).toBeTruthy();
    expect(empty.find('[data-download="skin"]').exists()).toBe(false);
    expect(empty.find('[data-download="cape"]').exists()).toBe(false);
    expect(empty.text()).toContain('尚未设置皮肤');
  });
});
