import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SkinViewer3D from './SkinViewer3D.vue';

const mocks = vi.hoisted(() => ({
  instances: [] as unknown[],
  failLoad: false,
}));

vi.mock('skinview3d', () => ({
  SkinViewer: class MockSkinViewer {
    options: Record<string, unknown>;
    controls = { enablePan: false, enableRotate: false, enableZoom: false };
    playerWrapper = { rotation: { y: 0 } };
    zoom = 0.9;
    loadSkin = vi.fn(async () => {
      if (mocks.failLoad) throw new Error('texture failed');
    });
    loadCape = vi.fn(async () => {
      if (mocks.failLoad) throw new Error('cape failed');
    });
    resetCameraPose = vi.fn();
    render = vi.fn();
    dispose = vi.fn();

    constructor(options: Record<string, unknown>) {
      this.options = options;
      mocks.instances.push(this);
    }
  },
}));

type MockViewer = {
  options: Record<string, unknown>;
  controls: { enablePan: boolean; enableRotate: boolean; enableZoom: boolean };
  playerWrapper: { rotation: { y: number } };
  zoom: number;
  loadSkin: ReturnType<typeof vi.fn>;
  loadCape: ReturnType<typeof vi.fn>;
  resetCameraPose: ReturnType<typeof vi.fn>;
  render: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
};

describe('SkinViewer3D', () => {
  beforeEach(() => {
    mocks.instances.length = 0;
    mocks.failLoad = false;
  });

  it('loads the selected model and cape with static, controllable defaults', async () => {
    const wrapper = mount(SkinViewer3D, {
      props: { skinUrl: '/textures/skin', capeUrl: '/textures/cape', model: 'slim' },
    });
    await flushPromises();
    await flushPromises();

    const instance = mocks.instances[0] as MockViewer;
    expect(wrapper.find('.skin-viewer-canvas').exists()).toBe(true);
    expect(wrapper.find('.skin-viewer-controls').exists()).toBe(true);
    expect(instance.options).toMatchObject({ enableControls: true });
    expect(instance.loadSkin).toHaveBeenCalledWith('/textures/skin', { model: 'slim' });
    expect(instance.loadCape).toHaveBeenCalledWith('/textures/cape');
    expect(instance.controls).toMatchObject({
      enablePan: false,
      enableRotate: true,
      enableZoom: true,
    });

    await wrapper.get('[aria-label="向右旋转"]').trigger('click');
    await wrapper.get('[aria-label="放大"]').trigger('click');
    await wrapper.get('[aria-label="重置 3D 预览视角"]').trigger('click');
    expect(instance.playerWrapper.rotation.y).toBeGreaterThan(0);
    expect(instance.zoom).toBeGreaterThan(0.9);
    expect(instance.resetCameraPose).toHaveBeenCalledOnce();
  });

  it('emits a 2D fallback when WebGL or texture loading fails and can retry', async () => {
    mocks.failLoad = true;
    const wrapper = mount(SkinViewer3D, {
      props: { skinUrl: '/textures/skin', capeUrl: null, model: 'classic' },
    });
    await flushPromises();
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toContain('3D 预览暂不可用');
    expect(wrapper.emitted('fallback')).toEqual([['3D 预览暂不可用，已切换到 2D 预览。']]);

    mocks.failLoad = false;
    await wrapper.get('button').trigger('click');
    await flushPromises();
    await flushPromises();
    expect(wrapper.find('.skin-viewer-controls').exists()).toBe(true);
  });
});
