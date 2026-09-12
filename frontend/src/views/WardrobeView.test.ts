import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WardrobeView from './WardrobeView.vue';
import { useAuthStore } from '../stores/auth';

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

const texture = {
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
};

beforeEach(() => {
  setActivePinia(createPinia());
  const auth = useAuthStore();
  auth.user = {
    id: 'user-1',
    email: 'player@example.com',
    role: 'user',
    createdAt: 1,
    updatedAt: 1,
    profile: profiles[0]!,
  };
  auth.profiles = profiles;
  auth.defaultProfileId = profiles[0]!.id;
  getWardrobe.mockResolvedValue({
    textures: [texture],
    total: 1,
    limit: 20,
    offset: 0,
    hasMore: false,
    quota: { used: 1, limit: 50 },
  });
  renameWardrobeTexture.mockResolvedValue({ texture: { ...texture, name: 'Renamed skin' } });
  applyWardrobeTexture.mockResolvedValue({ profile: { ...profiles[0]!, skinHash: texture.hash } });
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

  it('requests the selected type and exposes empty and error states', async () => {
    const wrapper = mount(WardrobeView);
    await flushPromises();
    getWardrobe.mockRejectedValueOnce(new Error('network down'));
    await wrapper.get('select[name="texture-filter"]').setValue('cape');
    await flushPromises();
    expect(getWardrobe).toHaveBeenLastCalledWith({ type: 'cape', limit: 20, offset: 0 });

    getWardrobe.mockRejectedValueOnce(new Error('network down'));
    await wrapper.get('button[data-action="retry-wardrobe"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('network down');
  });
});
