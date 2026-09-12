import { mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import ThemeToggle from './ThemeToggle.vue';
import { useThemeStore } from '../stores/theme';

describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.removeProperty('color-scheme');
  });

  it('persists the selected theme and exposes it in the document', async () => {
    localStorage.setItem('skinless.theme', 'dark');
    const pinia = createPinia();
    useThemeStore(pinia).initialize();
    const wrapper = mount(ThemeToggle, {
      global: {
        plugins: [pinia],
      },
    });

    const toggle = wrapper.get('button');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(toggle.attributes('aria-label')).toBe('切换到浅色主题');

    await toggle.trigger('click');

    expect(localStorage.getItem('skinless.theme')).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.style.colorScheme).toBe('light');
    expect(toggle.attributes('aria-label')).toBe('切换到深色主题');
  });
});
