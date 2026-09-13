import { createPinia, setActivePinia } from 'pinia';
import { defineComponent } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { useAuthStore } from '../stores/auth';
import AppearanceView from './AppearanceView.vue';

const UiCardStub = defineComponent({ template: '<div><slot /></div>' });
const ProfileManagementStub = defineComponent({
  name: 'ProfileManagement',
  template: '<div class="profile-management-stub" />',
});
const SkinUploaderStub = defineComponent({
  name: 'SkinUploader',
  props: {
    asset: { type: String, required: true },
    currentHash: { type: String, default: null },
    model: { type: String, required: true },
  },
  emits: ['preview', 'updated'],
  template:
    '<button class="uploader-stub" :data-asset="asset" type="button" @click="$emit(\'preview\', `blob:${asset}`)">{{ asset }}</button>',
});
const SkinPreviewStub = defineComponent({
  name: 'SkinPreview',
  props: {
    skinHash: { type: String, default: null },
    capeHash: { type: String, default: null },
    skinPreviewUrl: { type: String, default: null },
    capePreviewUrl: { type: String, default: null },
    model: { type: String, required: true },
  },
  template:
    '<div class="preview-stub" :data-skin-hash="skinHash || \'\'" :data-skin-preview="skinPreviewUrl || \'\'" :data-cape-preview="capePreviewUrl || \'\'" />',
});

beforeEach(() => {
  setActivePinia(createPinia());
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
      skinHash: 'saved-skin',
      capeHash: null,
      skinModel: 'classic',
    },
  };
  auth.profiles = [auth.user.profile];
  auth.defaultProfileId = auth.user.profile.id;
});

function mountAppearance() {
  return mount(AppearanceView, {
    global: {
      stubs: {
        UiCard: UiCardStub,
        ProfileManagement: ProfileManagementStub,
        SkinUploader: SkinUploaderStub,
        SkinPreview: SkinPreviewStub,
      },
    },
  });
}

describe('AppearanceView', () => {
  it('keeps upload previews local to the appearance page', async () => {
    const wrapper = mountAppearance();
    const skinUploader = wrapper.find('[data-asset="skin"]');

    await skinUploader.trigger('click');
    await flushPromises();

    expect(wrapper.get('.preview-stub').attributes('data-skin-preview')).toBe('blob:skin');
    expect(wrapper.get('.preview-stub').attributes('data-skin-hash')).toBe('saved-skin');
  });

  it('renders profile management, model selection and both upload targets', () => {
    const wrapper = mountAppearance();

    expect(wrapper.find('.profile-management-stub').exists()).toBe(true);
    expect(wrapper.findAll('.uploader-stub')).toHaveLength(2);
    expect(wrapper.findAll('input[type="radio"]')).toHaveLength(2);
  });
});
