import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../stores/auth';
import { TEXTURE_CORRUPT_INSTRUCTION } from '../utils/textureValidation';
import SkinUploader from './SkinUploader.vue';

const normalizeTextureFileMock = vi.hoisted(() => vi.fn());

vi.mock('../utils/textureValidation', async () => {
  const actual = await vi.importActual<typeof import('../utils/textureValidation')>(
    '../utils/textureValidation',
  );
  return { ...actual, normalizeTextureFile: normalizeTextureFileMock };
});

beforeEach(() => {
  setActivePinia(createPinia());
  normalizeTextureFileMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SkinUploader', () => {
  it('shows the normalized selection to the parent and submits that file', async () => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:normalized'),
      revokeObjectURL: vi.fn(),
    });

    const sourceFile = new File(['source'], 'source.png', { type: 'image/png' });
    const normalizedFile = new File(['normalized'], 'source.png', { type: 'image/png' });
    normalizeTextureFileMock.mockResolvedValue({
      ok: true,
      file: normalizedFile,
      width: 64,
      height: 64,
      sourceWidth: 64,
      sourceHeight: 32,
      legacyConverted: true,
    });

    const wrapper = mount(SkinUploader, {
      props: { asset: 'skin', currentHash: null, model: 'classic' },
    });
    const auth = useAuthStore();
    auth.user = {
      id: 'user',
      email: 'user@example.com',
      role: 'user',
      createdAt: 0,
      updatedAt: 0,
      profile: {
        id: 'profile',
        name: 'Steve',
        skinHash: null,
        capeHash: null,
        skinModel: 'classic',
      },
    };
    const upload = vi.spyOn(auth, 'upload').mockResolvedValue({
      hash: 'uploaded-hash',
      profile: auth.user.profile,
    });

    const input = wrapper.get('input[type="file"]');
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [sourceFile],
    });

    await input.trigger('change');
    await flushPromises();

    expect(normalizeTextureFileMock).toHaveBeenCalledWith(sourceFile, 'skin');
    expect(wrapper.get('.upload-thumb').attributes('src')).toBe('blob:normalized');
    expect(wrapper.emitted('preview')).toEqual([[null], ['blob:normalized']]);

    await wrapper.get('button.button-primary').trigger('click');
    await flushPromises();

    expect(upload).toHaveBeenCalledWith('skin', normalizedFile, 'classic');
    expect(wrapper.emitted('updated')).toEqual([['uploaded-hash']]);
    expect(wrapper.emitted('preview')).toEqual([[null], ['blob:normalized'], [null]]);
  });

  it('shows exact repair guidance when normalization fails and keeps saved state untouched', async () => {
    normalizeTextureFileMock.mockResolvedValue({
      ok: false,
      code: 'corrupt_png',
      message: TEXTURE_CORRUPT_INSTRUCTION,
    });

    const wrapper = mount(SkinUploader, {
      props: { asset: 'skin', currentHash: 'saved-hash', model: 'classic' },
    });
    const input = wrapper.get('input[type="file"]');
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [new File(['broken'], 'broken.png', { type: 'image/png' })],
    });

    await input.trigger('change');
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toBe(TEXTURE_CORRUPT_INSTRUCTION);
    expect(wrapper.find('.file-name').exists()).toBe(false);
    expect(wrapper.find('.upload-thumb').exists()).toBe(false);
    expect(wrapper.emitted('updated')).toBeUndefined();
    expect(wrapper.emitted('preview')).toEqual([[null]]);
  });
});
