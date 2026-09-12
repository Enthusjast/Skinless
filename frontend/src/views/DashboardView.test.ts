import { createPinia, setActivePinia } from 'pinia';
import { defineComponent } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../stores/auth';
import DashboardView from './DashboardView.vue';

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const UiCardStub = defineComponent({
  template: '<div><slot /></div>',
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

const ProfileManagementStub = defineComponent({
  name: 'ProfileManagement',
  template: '<div class="profile-management-stub" />',
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DashboardView preview wiring', () => {
  it('shows a selected preview immediately and restores the saved hash when cleared', async () => {
    const wrapper = mount(DashboardView, {
      global: {
        stubs: {
          UiCard: UiCardStub,
          SkinUploader: SkinUploaderStub,
          SkinPreview: SkinPreviewStub,
          ProfileManagement: ProfileManagementStub,
          SessionManagement: true,
        },
      },
    });
    const uploader = wrapper.findComponent(SkinUploaderStub);
    const preview = wrapper.get('.preview-stub');

    await uploader.trigger('click');
    await flushPromises();

    expect(preview.attributes('data-skin-preview')).toBe('blob:skin');
    expect(preview.attributes('data-skin-hash')).toBe('saved-skin');

    uploader.vm.$emit('preview', null);
    await flushPromises();

    expect(preview.attributes('data-skin-preview')).toBe('');
    expect(preview.attributes('data-skin-hash')).toBe('saved-skin');
  });

  it('refreshes the active upload and preview targets after switching the default profile', async () => {
    const secondProfile = {
      id: 'profile-2',
      name: 'SecondPlayer',
      skinHash: 'second-skin',
      capeHash: 'second-cape',
      skinModel: 'slim' as const,
    };
    const auth = useAuthStore();
    auth.profiles = [auth.user!.profile, secondProfile];
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          user: { ...auth.user, profile: secondProfile },
          profiles: [auth.user!.profile, secondProfile],
          defaultProfileId: secondProfile.id,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const wrapper = mount(DashboardView, {
      global: {
        stubs: {
          UiCard: UiCardStub,
          SkinUploader: SkinUploaderStub,
          SkinPreview: SkinPreviewStub,
          ProfileManagement: ProfileManagementStub,
          SessionManagement: true,
        },
      },
    });

    await auth.setDefaultProfile(secondProfile.id);
    await flushPromises();

    const uploaders = wrapper.findAllComponents(SkinUploaderStub);
    expect(uploaders[0]?.props('currentHash')).toBe('second-skin');
    expect(wrapper.get('.preview-stub').attributes('data-skin-hash')).toBe('second-skin');
    expect(wrapper.get('.preview-stub').attributes('data-cape-preview')).toBe('');
  });
});
