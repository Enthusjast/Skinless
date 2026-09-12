import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import SkinPreview from './SkinPreview.vue';

describe('SkinPreview', () => {
  it('uses CSP-compatible SVG attributes for texture geometry and URLs', () => {
    const wrapper = mount(SkinPreview, {
      props: { skinHash: 'abc123', model: 'slim' },
    });
    const parts = wrapper.findAll('svg.texture-part');

    expect(wrapper.findAll('[style]')).toHaveLength(0);
    expect(parts).toHaveLength(6);
    expect(parts[0].attributes()).toMatchObject({
      width: '48',
      height: '48',
      viewBox: '8 8 8 8',
    });
    expect(parts[1].attributes()).toMatchObject({
      width: '18',
      height: '72',
      viewBox: '44 20 3 12',
    });
    expect(parts[1].get('image').attributes()).toMatchObject({
      href: '/textures/abc123',
      width: '64',
      height: '64',
    });
    expect(wrapper.get('.preview-card').attributes('aria-label')).toBe('Slim 皮肤预览');
  });

  it('keeps classic limb geometry distinct from slim geometry', () => {
    const wrapper = mount(SkinPreview, {
      props: { skinHash: 'abc123', model: 'classic' },
    });

    expect(wrapper.findAll('svg.texture-part')[1].attributes()).toMatchObject({
      width: '24',
      height: '72',
      viewBox: '44 20 4 12',
    });
  });
});
