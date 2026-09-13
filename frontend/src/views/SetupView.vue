<script setup lang="ts">
import { CircleX, Copy, RefreshCw } from 'lucide-vue-next';
import { onMounted, ref } from 'vue';
import { formatApiError, getDiagnostics, type LauncherDiagnostics } from '../api';
import UiCard from '../components/common/UiCard.vue';

type CopyKey = 'auth-server' | 'java-agent' | 'profile-id' | 'profile-name' | 'profile-texture';

const diagnostics = ref<LauncherDiagnostics | null>(null);
const loading = ref(true);
const error = ref('');
const copyFeedback = ref<Partial<Record<CopyKey, 'success' | 'failure'>>>({});
const copyTimers = new Map<CopyKey, number>();

function setCopyFeedback(key: CopyKey, state: 'success' | 'failure') {
  const existingTimer = copyTimers.get(key);
  if (existingTimer !== undefined) window.clearTimeout(existingTimer);
  copyFeedback.value[key] = state;
  copyTimers.set(
    key,
    window.setTimeout(() => {
      delete copyFeedback.value[key];
      copyTimers.delete(key);
    }, 1800),
  );
}

async function copyValue(key: CopyKey, value: string | null | undefined) {
  if (!value) {
    setCopyFeedback(key, 'failure');
    return;
  }

  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(value);
    setCopyFeedback(key, 'success');
  } catch {
    setCopyFeedback(key, 'failure');
  }
}

async function loadDiagnostics() {
  loading.value = true;
  error.value = '';
  try {
    diagnostics.value = await getDiagnostics();
  } catch (cause) {
    diagnostics.value = null;
    error.value = formatApiError(cause, '诊断信息加载失败，请重试。');
  } finally {
    loading.value = false;
  }
}

onMounted(loadDiagnostics);
</script>

<template>
  <div v-if="loading" class="setup-state" data-state="loading" role="status" aria-live="polite">
    <RefreshCw :size="20" class="spinning" aria-hidden="true" />
    <p>正在检查当前部署…</p>
  </div>

  <section
    v-else-if="error"
    class="setup-state setup-error-state"
    data-state="error"
    aria-labelledby="setup-error-title"
  >
    <CircleX :size="24" aria-hidden="true" />
    <h2 id="setup-error-title">暂时无法读取诊断信息</h2>
    <p role="alert">{{ error }}</p>
    <p class="setup-repair">请确认登录状态有效，然后重试。</p>
    <button
      class="button button-primary"
      type="button"
      data-action="retry-diagnostics"
      @click="loadDiagnostics"
    >
      <RefreshCw :size="16" aria-hidden="true" />重试
    </button>
  </section>

  <div v-else-if="diagnostics" class="setup-page" data-state="ready">
    <UiCard as="section" class="setup-panel" aria-labelledby="setup-copy-title">
      <div class="workspace-section-heading">
        <div>
          <p class="eyebrow">LAUNCHER SETUP</p>
          <h2 id="setup-copy-title">连接参数</h2>
        </div>
        <span class="setup-version">版本 {{ diagnostics.version }}</span>
      </div>
      <p class="section-description">复制下面的地址和参数，完成启动器或服务端配置。</p>
      <div class="setup-copy-list">
        <div class="setup-copy-row">
          <div class="setup-copy-value">
            <span>认证服务器地址</span>
            <code>{{ diagnostics.authServerUrl }}</code>
          </div>
          <button
            class="copy-id-button"
            type="button"
            data-copy="auth-server"
            aria-label="复制认证服务器地址"
            @click="copyValue('auth-server', diagnostics.authServerUrl)"
          >
            <Copy :size="15" aria-hidden="true" />复制
          </button>
          <span
            v-if="copyFeedback['auth-server']"
            class="setup-copy-feedback"
            :class="{ 'is-failure': copyFeedback['auth-server'] === 'failure' }"
            data-copy-feedback="auth-server"
            role="status"
            aria-live="polite"
          >
            {{
              copyFeedback['auth-server'] === 'success'
                ? '已复制'
                : copyFeedback['auth-server'] === 'failure'
                  ? '复制失败，请手动复制。'
                  : ''
            }}
          </span>
        </div>

        <div class="setup-copy-row">
          <div class="setup-copy-value">
            <span>Java Agent 参数</span>
            <code>{{ diagnostics.javaAgentArgument }}</code>
          </div>
          <button
            class="copy-id-button"
            type="button"
            data-copy="java-agent"
            aria-label="复制 Java Agent 参数"
            @click="copyValue('java-agent', diagnostics.javaAgentArgument)"
          >
            <Copy :size="15" aria-hidden="true" />复制
          </button>
          <span
            v-if="copyFeedback['java-agent']"
            class="setup-copy-feedback"
            :class="{ 'is-failure': copyFeedback['java-agent'] === 'failure' }"
            data-copy-feedback="java-agent"
            role="status"
            aria-live="polite"
          >
            {{
              copyFeedback['java-agent'] === 'success'
                ? '已复制'
                : copyFeedback['java-agent'] === 'failure'
                  ? '复制失败，请手动复制。'
                  : ''
            }}
          </span>
        </div>
      </div>
    </UiCard>

    <UiCard as="section" class="setup-panel" aria-labelledby="setup-profile-title">
      <div class="workspace-section-heading">
        <div>
          <p class="eyebrow">CURRENT PROFILE</p>
          <h2 id="setup-profile-title">当前 Profile</h2>
        </div>
        <span
          class="setup-profile-state"
          :class="diagnostics.profileAvailable ? 'is-good' : 'is-warning'"
        >
          {{ diagnostics.profileAvailable ? '可用' : '不可用' }}
        </span>
      </div>
      <div class="setup-profile-grid">
        <div class="setup-copy-row">
          <div class="setup-copy-value">
            <span>Profile UUID</span>
            <code>{{ diagnostics.profile.id ?? '暂无' }}</code>
          </div>
          <button
            v-if="diagnostics.profile.id"
            class="copy-id-button"
            type="button"
            data-copy="profile-id"
            aria-label="复制当前 Profile UUID"
            @click="copyValue('profile-id', diagnostics.profile.id)"
          >
            <Copy :size="15" aria-hidden="true" />复制
          </button>
          <span
            v-if="copyFeedback['profile-id']"
            class="setup-copy-feedback"
            :class="{ 'is-failure': copyFeedback['profile-id'] === 'failure' }"
            data-copy-feedback="profile-id"
            role="status"
            aria-live="polite"
          >
            {{
              copyFeedback['profile-id'] === 'success'
                ? '已复制'
                : copyFeedback['profile-id'] === 'failure'
                  ? '复制失败，请手动复制。'
                  : ''
            }}
          </span>
        </div>
        <div class="setup-copy-row">
          <div class="setup-copy-value">
            <span>Profile 名称</span>
            <code>{{ diagnostics.profile.name ?? '暂无' }}</code>
          </div>
          <button
            v-if="diagnostics.profile.name"
            class="copy-id-button"
            type="button"
            data-copy="profile-name"
            aria-label="复制当前 Profile 名称"
            @click="copyValue('profile-name', diagnostics.profile.name)"
          >
            <Copy :size="15" aria-hidden="true" />复制
          </button>
          <span
            v-if="copyFeedback['profile-name']"
            class="setup-copy-feedback"
            :class="{ 'is-failure': copyFeedback['profile-name'] === 'failure' }"
            data-copy-feedback="profile-name"
            role="status"
            aria-live="polite"
          >
            {{
              copyFeedback['profile-name'] === 'success'
                ? '已复制'
                : copyFeedback['profile-name'] === 'failure'
                  ? '复制失败，请手动复制。'
                  : ''
            }}
          </span>
        </div>
        <div class="setup-copy-row">
          <div class="setup-copy-value">
            <span>当前纹理 URL</span>
            <code>{{ diagnostics.profile.textureUrl ?? '暂无皮肤纹理' }}</code>
          </div>
          <button
            v-if="diagnostics.profile.textureUrl"
            class="copy-id-button"
            type="button"
            data-copy="profile-texture"
            aria-label="复制当前纹理 URL"
            @click="copyValue('profile-texture', diagnostics.profile.textureUrl)"
          >
            <Copy :size="15" aria-hidden="true" />复制
          </button>
          <span
            v-if="copyFeedback['profile-texture']"
            class="setup-copy-feedback"
            :class="{ 'is-failure': copyFeedback['profile-texture'] === 'failure' }"
            data-copy-feedback="profile-texture"
            role="status"
            aria-live="polite"
          >
            {{
              copyFeedback['profile-texture'] === 'success'
                ? '已复制'
                : copyFeedback['profile-texture'] === 'failure'
                  ? '复制失败，请手动复制。'
                  : ''
            }}
          </span>
        </div>
      </div>
    </UiCard>
  </div>
</template>
