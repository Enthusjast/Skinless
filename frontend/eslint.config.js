import skipFormatting from '@vue/eslint-config-prettier/skip-formatting';
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript';
import pluginVue from 'eslint-plugin-vue';

export default defineConfigWithVueTs(
  {
    name: 'skinless/files-to-lint',
    files: ['**/*.{ts,tsx,vue}'],
  },
  {
    name: 'skinless/files-to-ignore',
    ignores: ['dist/**', 'coverage/**'],
  },
  pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,
  skipFormatting,
);
