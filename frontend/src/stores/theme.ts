import { defineStore } from 'pinia';

export type Theme = 'light' | 'dark';

const THEME_KEY = 'skinless.theme';

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export const useThemeStore = defineStore('theme', {
  state: () => ({
    theme: 'dark' as Theme,
    initialized: false,
  }),
  getters: {
    isDark: (state) => state.theme === 'dark',
  },
  actions: {
    initialize() {
      if (this.initialized) return;
      const saved = localStorage.getItem(THEME_KEY);
      this.theme = saved === 'light' || saved === 'dark' ? saved : systemTheme();
      this.initialized = true;
      applyTheme(this.theme);
    },
    toggle() {
      this.theme = this.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem(THEME_KEY, this.theme);
      applyTheme(this.theme);
    },
  },
});
