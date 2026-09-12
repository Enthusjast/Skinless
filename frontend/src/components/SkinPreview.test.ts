import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import SkinPreview from './SkinPreview.vue';

describe('SkinPreview', () => {
  it('renders CSP-compatible base and outer layers for slim geometry', () => {
    const wrapper = mount(SkinPreview, {
      props: { skinHash: 'abc123', capeHash: null, model: 'slim' },
    });
    const parts = wrapper.findAll('svg.texture-part');

    expect(wrapper.findAll('[style]')).toHaveLength(0);
    expect(parts).toHaveLength(6);
    expect(wrapper.findAll('image.texture-layer-base')).toHaveLength(6);
    expect(wrapper.findAll('image.texture-layer-outer')).toHaveLength(6);
    expect(parts[0].attributes()).toMatchObject({
      width: '48',
      height: '48',
      viewBox: '8 8 8 8',
    });
    expect(parts[0].find('image.texture-layer-base').attributes()).toMatchObject({
      x: '0',
      y: '0',
      href: '/textures/abc123',
      width: '64',
      height: '64',
    });
    expect(parts[0].find('image.texture-layer-outer').attributes()).toMatchObject({
      x: '-32',
      y: '0',
      href: '/textures/abc123',
    });
    expect(parts[1].attributes()).toMatchObject({
      width: '18',
      height: '72',
      viewBox: '44 20 3 12',
    });
    expect(parts[1].find('image.texture-layer-outer').attributes()).toMatchObject({
      x: '0',
      y: '-16',
    });
    expect(wrapper.get('.preview-card').attributes('aria-label')).toContain('Slim');
    expect(wrapper.get('.preview-card').attributes('aria-label')).toContain('已保存');
    expect(wrapper.get('.preview-card').attributes('aria-label')).toContain('无披风');
  });

  it('keeps classic limb geometry distinct and renders every outer front layer', () => {
    const wrapper = mount(SkinPreview, {
      props: { skinHash: 'abc123', capeHash: null, model: 'classic' },
    });

    expect(wrapper.findAll('svg.texture-part')[1].attributes()).toMatchObject({
      width: '24',
      height: '72',
      viewBox: '44 20 4 12',
    });
    expect(wrapper.findAll('svg.texture-part')[3].attributes()).toMatchObject({
      width: '24',
      height: '72',
      viewBox: '36 52 4 12',
    });
    expect(wrapper.findAll('image.texture-layer-outer')).toHaveLength(6);
    expect(wrapper.find('[data-part="body"] .texture-layer-outer').attributes()).toMatchObject({
      x: '0',
      y: '-16',
    });
    expect(wrapper.find('[data-part="left-leg"] .texture-layer-outer').attributes()).toMatchObject({
      x: '16',
      y: '0',
    });
  });

  it('renders a cape without changing its two-to-one aspect ratio', () => {
    const wrapper = mount(SkinPreview, {
      props: { skinHash: 'skin-hash', capeHash: 'cape-hash', model: 'classic' },
    });

    expect(wrapper.find('.cape-preview').exists()).toBe(true);
    expect(wrapper.get('.cape-texture').attributes()).toMatchObject({
      viewBox: '0 0 64 32',
      width: '192',
      height: '96',
    });
    expect(wrapper.get('.cape-texture image').attributes()).toMatchObject({
      href: '/textures/cape-hash',
      width: '64',
      height: '32',
      preserveAspectRatio: 'xMidYMid meet',
    });
    expect(wrapper.get('.preview-card').attributes('aria-label')).toContain('有披风');
  });

  it('keeps the empty state accessible when no saved skin or cape exists', () => {
    const wrapper = mount(SkinPreview, {
      props: { skinHash: null, capeHash: null, model: 'classic' },
    });

    expect(wrapper.find('.preview-empty').exists()).toBe(true);
    expect(wrapper.get('.preview-card').attributes('aria-label')).toContain('暂无皮肤预览');
    expect(wrapper.get('.preview-card').attributes('aria-label')).toContain('未保存');
    expect(wrapper.get('.preview-card').attributes('aria-label')).toContain('无披风');
  });

  it('uses a selected normalized preview and marks the card unsaved', () => {
    const wrapper = mount(SkinPreview, {
      props: {
        skinHash: 'saved-hash',
        capeHash: null,
        skinPreviewUrl: 'blob:normalized-skin',
        model: 'slim',
      },
    });

    expect(wrapper.find('image.texture-layer-base').attributes('href')).toBe(
      'blob:normalized-skin',
    );
    expect(wrapper.get('.preview-card').attributes('aria-label')).toContain('未保存');
  });
});
