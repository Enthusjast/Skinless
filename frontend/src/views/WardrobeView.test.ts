import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WardrobeView from './WardrobeView.vue';
import { useAuthStore } from '../stores/auth';
import type { WardrobeTexture } from '../api';

const {
  getWardrobe,
  renameWardrobeTexture,
  deleteWardrobeTexture,
  uploadWardrobeTexture,
  applyWardrobeTexture,
} = vi.hoisted(() => ({
  getWardrobe: vi.fn(),
  renameWardrobeTexture: vi.fn(),
  deleteWardrobeTexture: vi.fn(),
  uploadWardrobeTexture: vi.fn(),
  applyWardrobeTexture: vi.fn(),
}));

vi.mock('../api', () => ({
  API_BASE_URL: '',
  formatApiError: (cause: unknown, fallback: string) =>
    cause instanceof Error ? cause.message : fallback,
  getWardrobe,
  renameWardrobeTexture,
  deleteWardrobeTexture,
  uploadWardrobeTexture,
  applyWardrobeTexture,
}));

const profiles = [
  { id: 'profile-1', name: 'Steve', skinHash: null, capeHash: null, skinModel: 'classic' as const },
  { id: 'profile-2', name: 'Alex', skinHash: null, capeHash: null, skinModel: 'slim' as const },
];

const texture: WardrobeTexture = {
  id: 'texture-1',
  hash: 'a'.repeat(64),
  type: 'skin' as const,
  name: 'Classic skin',
  model: 'classic' as const,
  width: 64,
  height: 64,
  size: 2048,
  createdAt: 1,
  updatedAt: 1,
  previewUrl: '/textures/a.png',
};

function page(
  textures: WardrobeTexture[] = [texture],
  total = textures.length,
  offset = 0,
  hasMore = offset + textures.length < total,
) {
  return {
    textures,
    total,
    limit: 20,
    offset,
    hasMore,
    quota: { used: total, limit: 50 },
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  const auth = useAuthStore();
  const testProfiles = profiles.map((profile) => ({ ...profile }));
  auth.user = {
    id: 'user-1',
    email: 'player@example.com',
    role: 'user',
    createdAt: 1,
    updatedAt: 1,
    profile: testProfiles[0]!,
  };
  auth.profiles = testProfiles;
  auth.defaultProfileId = testProfiles[0]!.id;
  getWardrobe.mockResolvedValue(page());
  renameWardrobeTexture.mockResolvedValue({ texture: { ...texture, name: 'Renamed skin' } });
  deleteWardrobeTexture.mockResolvedValue(undefined);
  uploadWardrobeTexture.mockResolvedValue({
    texture,
    quota: { used: 1, limit: 50 },
    reused: false,
  });
  applyWardrobeTexture.mockResolvedValue({
    profile: { ...testProfiles[0]!, skinHash: texture.hash },
  });
});

afterEach(() => vi.clearAllMocks());

describe('WardrobeView', () => {
  it('loads cards, shows quota, edits a name, and applies to the selected profile', async () => {
    const wrapper = mount(WardrobeView);
    await flushPromises();

    expect(wrapper.get('[data-texture-id="texture-1"]')).toBeTruthy();
    expect(wrapper.text()).toContain('1 / 50');
    expect(wrapper.text()).toContain('Classic skin');

    await wrapper.get('[data-action="edit-texture"]').trigger('click');
    const input = wrapper.get('input[name="texture-name"]');
    await input.setValue('Renamed skin');
    await wrapper.get('[data-action="save-texture"]').trigger('click');
    await flushPromises();
    expect(renameWardrobeTexture).toHaveBeenCalledWith('texture-1', 'Renamed skin');

    await wrapper.get('select[name="target-profile"]').setValue('profile-2');
    await wrapper.get('[data-action="apply-texture"]').trigger('click');
    await flushPromises();
    expect(applyWardrobeTexture).toHaveBeenCalledWith('texture-1', 'profile-2');
  });

  it('shows the loading state until the first page resolves', async () => {
    let resolvePage!: (value: ReturnType<typeof page>) => void;
    getWardrobe.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePage = resolve;
        }),
    );

    const wrapper = mount(WardrobeView);
    expect(wrapper.get('[data-state="loading"]')).toBeTruthy();

    resolvePage(page([], 0, 0, false));
    await flushPromises();
    expect(wrapper.get('[data-state="empty"]')).toBeTruthy();
  });

  it('labels legacy textures with unknown metadata', async () => {
    getWardrobe.mockResolvedValueOnce(
      page([{ ...texture, width: null, height: null, size: null }]),
    );
    const wrapper = mount(WardrobeView);
    await flushPromises();

    expect(wrapper.text()).toContain('尺寸未知');
    expect(wrapper.text()).not.toContain('null × null');
  });

  it('shows an empty state for an empty page and an error state with retry', async () => {
    getWardrobe.mockResolvedValueOnce(page([], 0, 0, false));
    const wrapper = mount(WardrobeView);
    await flushPromises();
    expect(wrapper.get('[data-state="empty"]')).toBeTruthy();

    getWardrobe.mockRejectedValueOnce(new Error('network down'));
    await wrapper.get('select[name="texture-filter"]').setValue('cape');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('network down');
  });

  it('requests the selected type and navigates between pages', async () => {
    const firstPage = page([texture], 21, 0, true);
    const secondTexture = { ...texture, id: 'texture-21', name: 'Later skin' };
    const secondPage = page([secondTexture], 21, 20, false);
    getWardrobe.mockReset();
    getWardrobe.mockImplementation(({ offset = 0 }: { offset?: number }) =>
      Promise.resolve(offset === 20 ? secondPage : firstPage),
    );

    const wrapper = mount(WardrobeView);
    await flushPromises();

    await wrapper.get('select[name="texture-filter"]').setValue('cape');
    await flushPromises();
    expect(getWardrobe).toHaveBeenLastCalledWith({ type: 'cape', limit: 20, offset: 0 });

    await wrapper.get('button[data-action="next-page"]').trigger('click');
    await flushPromises();
    expect(getWardrobe).toHaveBeenLastCalledWith({ type: 'cape', limit: 20, offset: 20 });
    expect(wrapper.text()).toContain('第 2 / 2 页');

    await wrapper.get('button[data-action="previous-page"]').trigger('click');
    await flushPromises();
    expect(getWardrobe).toHaveBeenLastCalledWith({ type: 'cape', limit: 20, offset: 0 });
    expect(wrapper.text()).toContain('第 1 / 2 页');
  });

  it('refreshes the current page after deleting from the middle of a three-page collection', async () => {
    const firstPage = page([texture], 45, 0, true);
    const pageTwoTexture = { ...texture, id: 'texture-21', name: 'Page two skin' };
    const pageTwo = page([pageTwoTexture], 45, 20, true);
    const refreshedPageTwoTexture = { ...texture, id: 'texture-41', name: 'Shifted skin' };
    const refreshedPageTwo = page([refreshedPageTwoTexture], 44, 20, true);
    const pageThreeTexture = { ...texture, id: 'texture-45', name: 'Page three skin' };
    const pageThree = page([pageThreeTexture], 44, 40, false);
    getWardrobe.mockReset();
    getWardrobe
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(pageTwo)
      .mockResolvedValueOnce(refreshedPageTwo)
      .mockResolvedValueOnce(pageThree)
      .mockResolvedValueOnce(refreshedPageTwo);

    const wrapper = mount(WardrobeView);
    await flushPromises();
    await wrapper.get('button[data-action="next-page"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('第 2 / 3 页');

    await wrapper.get('button[data-action="delete-texture"]').trigger('click');
    await flushPromises();

    expect(deleteWardrobeTexture).toHaveBeenCalledWith('texture-21');
    expect(getWardrobe).toHaveBeenNthCalledWith(3, { type: undefined, limit: 20, offset: 20 });
    expect(wrapper.get('[data-texture-id="texture-41"]')).toBeTruthy();
    expect(wrapper.find('[data-texture-id="texture-21"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('44 / 50');
    expect(wrapper.text()).toContain('第 2 / 3 页');

    await wrapper.get('button[data-action="next-page"]').trigger('click');
    await flushPromises();
    expect(getWardrobe).toHaveBeenLastCalledWith({ type: undefined, limit: 20, offset: 40 });
    expect(wrapper.get('[data-texture-id="texture-45"]')).toBeTruthy();
    expect(wrapper.text()).toContain('第 3 / 3 页');

    await wrapper.get('button[data-action="previous-page"]').trigger('click');
    await flushPromises();
    expect(getWardrobe).toHaveBeenLastCalledWith({ type: undefined, limit: 20, offset: 20 });
    expect(wrapper.get('[data-texture-id="texture-41"]')).toBeTruthy();
    expect(wrapper.text()).toContain('第 2 / 3 页');
  });

  it('reloads the previous valid page after deleting its only later-page item', async () => {
    const firstPage = page([texture], 21, 0, true);
    const laterTexture = { ...texture, id: 'texture-21', name: 'Later skin' };
    const laterPage = page([laterTexture], 21, 20, false);
    const reloadedFirstPage = page([texture], 20, 0, false);
    getWardrobe.mockReset();
    getWardrobe
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(laterPage)
      .mockResolvedValueOnce(reloadedFirstPage);

    const wrapper = mount(WardrobeView);
    await flushPromises();
    await wrapper.get('button[data-action="next-page"]').trigger('click');
    await flushPromises();
    await wrapper.get('button[data-action="delete-texture"]').trigger('click');
    await flushPromises();

    expect(deleteWardrobeTexture).toHaveBeenCalledWith('texture-21');
    expect(getWardrobe).toHaveBeenLastCalledWith({ type: undefined, limit: 20, offset: 0 });
    expect(wrapper.get('[data-texture-id="texture-1"]')).toBeTruthy();
    expect(wrapper.find('nav[aria-label="纹理衣柜分页"]').exists()).toBe(false);
  });

  it('uploads a selected file and reloads the collection', async () => {
    const wrapper = mount(WardrobeView);
    await flushPromises();
    const file = new File(['png'], 'adventure.png', { type: 'image/png' });
    const input = wrapper.get('input[type="file"]');
    Object.defineProperty(input.element, 'files', { configurable: true, value: [file] });
    await input.trigger('change');
    await wrapper.get('#upload-texture-name').setValue('Adventure skin');

    await wrapper.get('[data-action="upload-texture"]').trigger('click');
    await flushPromises();

    expect(uploadWardrobeTexture).toHaveBeenCalledWith('skin', file, 'Adventure skin', 'classic');
    expect(getWardrobe).toHaveBeenCalledTimes(2);
    expect(wrapper.get('[role="status"]').text()).toContain('已保存');
  });
});
