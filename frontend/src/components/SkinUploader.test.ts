import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEXTURE_DIMENSION_INSTRUCTIONS } from '../utils/textureValidation';
import SkinUploader from './SkinUploader.vue';

beforeEach(() => {
  setActivePinia(createPinia());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SkinUploader', () => {
  it('rejects an invalid selection and shows the exact repair instruction', async () => {
    class FakeImage {
      naturalWidth = 128;
      naturalHeight = 128;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('Image', FakeImage);
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:texture'),
      revokeObjectURL: vi.fn(),
    });

    const wrapper = mount(SkinUploader, {
      props: { asset: 'skin', currentHash: null, model: 'classic' },
    });
    const input = wrapper.get('input[type="file"]');
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [new File(['png'], 'wrong-size.png', { type: 'image/png' })],
    });

    await input.trigger('change');
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toBe(TEXTURE_DIMENSION_INSTRUCTIONS.skin);
    expect(wrapper.find('.file-name').exists()).toBe(false);
  });
});
