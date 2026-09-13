<script setup lang="ts">
import { CircleAlert, CircleCheck, CircleX, Copy, RefreshCw } from 'lucide-vue-next';
import { computed, onMounted, ref } from 'vue';
import { formatApiError, getDiagnostics, type LauncherDiagnostics } from '../api';
import UiCard from '../components/common/UiCard.vue';

type CopyKey =
  | 'auth-server'
  | 'java-agent'
  | 'launcher-steps'
  | 'server-steps'
  | 'profile-id'
  | 'profile-name'
  | 'profile-texture';
type CheckState = 'success' | 'warning' | 'failure';

const diagnostics = ref<LauncherDiagnostics | null>(null);
const loading = ref(true);
const error = ref('');
const copyFeedback = ref<Partial<Record<CopyKey, 'success' | 'failure'>>>({});
const copyTimers = new Map<CopyKey, number>();

const launcherSteps =
  '启动器：选择“外置登录（Authlib Injector）”，认证服务器填写上面的地址，再使用 Skinless 注册邮箱和密码登录。';
const serverSteps = (authServerUrl: string) =>
  `服务端：将 -javaagent:authlib-injector.jar=${authServerUrl} 加入 Java 启动参数，并在 server.properties 中设置 online-mode=false。`;

const checks = computed(() => {
  const current = diagnostics.value;
  if (!current) return [];

  const check = (
    key: string,
    label: string,
    passed: boolean,
    detail: string,
    repair: string,
    failure = false,
  ) => ({
    key,
    label,
    state: (passed ? 'success' : failure ? 'failure' : 'warning') as CheckState,
    detail,
    repair,
  });

  return [
    check(
      'metadata',
      '元信息端点',
      current.metadataReachable,
      current.metadataReachable ? '可访问' : '无法访问',
      '确认 Worker 已部署，并检查认证服务器地址是否指向当前站点。',
      true,
    ),
    check(
      'public-key',
      '公钥配置',
      current.publicKeyConfigured,
      current.publicKeyConfigured ? '已配置' : '未配置',
      '如需签名纹理，请在 Worker 中配置 Yggdrasil 公钥和私钥。',
    ),
    check(
      'texture-domain',
      '纹理域名',
      current.textureDomainConfigured,
      current.textureDomainConfigured ? '已配置' : '使用当前站点回退值',
      '为生产部署配置 SKIN_DOMAIN，并确认纹理路径可由同一站点提供。',
    ),
    check(
      'profile',
      '当前 Profile',
      current.profileAvailable,
      current.profileAvailable ? `可用：${current.profile.name ?? '未命名'}` : '不可用',
      '确认账号有一个可用的默认 Profile。',
      true,
    ),
    check(
      'texture',
      '当前皮肤纹理',
      current.textureAvailable,
      current.textureAvailable ? '可访问' : '未找到可用纹理',
      '上传一张有效皮肤，或确认 R2 中仍保留当前纹理对象。',
    ),
    check(
      'same-origin',
      '同源会话',
      current.sameOrigin,
      current.sameOrigin ? '已启用' : '存在跨源配置',
      '让前端与 API 使用同一域名，并保持浏览器端 API 地址为空。',
    ),
    check(
      'ip-binding',
      '进服 IP 绑定',
      current.ipBindingEnabled,
      current.ipBindingEnabled ? '已启用' : '未启用（可选）',
      '如需严格匹配进服来源，在管理员设置中启用 IP 绑定。',
    ),
  ];
});

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

        <div class="setup-copy-row setup-copy-row-multiline">
          <p class="setup-copy-text">{{ launcherSteps }}</p>
          <button
            class="copy-id-button"
            type="button"
            data-copy="launcher-steps"
            aria-label="复制启动器配置步骤"
            @click="copyValue('launcher-steps', launcherSteps)"
          >
            <Copy :size="15" aria-hidden="true" />复制步骤
          </button>
          <span
            v-if="copyFeedback['launcher-steps']"
            class="setup-copy-feedback"
            :class="{ 'is-failure': copyFeedback['launcher-steps'] === 'failure' }"
            data-copy-feedback="launcher-steps"
            role="status"
            aria-live="polite"
          >
            {{
              copyFeedback['launcher-steps'] === 'success'
                ? '已复制'
                : copyFeedback['launcher-steps'] === 'failure'
                  ? '复制失败，请手动复制。'
                  : ''
            }}
          </span>
        </div>

        <div class="setup-copy-row setup-copy-row-multiline">
          <p class="setup-copy-text">{{ serverSteps(diagnostics.authServerUrl) }}</p>
          <button
            class="copy-id-button"
            type="button"
            data-copy="server-steps"
            aria-label="复制服务端配置步骤"
            @click="copyValue('server-steps', serverSteps(diagnostics.authServerUrl))"
          >
            <Copy :size="15" aria-hidden="true" />复制步骤
          </button>
          <span
            v-if="copyFeedback['server-steps']"
            class="setup-copy-feedback"
            :class="{ 'is-failure': copyFeedback['server-steps'] === 'failure' }"
            data-copy-feedback="server-steps"
            role="status"
            aria-live="polite"
          >
            {{
              copyFeedback['server-steps'] === 'success'
                ? '已复制'
                : copyFeedback['server-steps'] === 'failure'
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

    <UiCard as="section" class="setup-panel" aria-labelledby="setup-check-title">
      <div class="workspace-section-heading">
        <div>
          <p class="eyebrow">DEPLOYMENT CHECKS</p>
          <h2 id="setup-check-title">部署检查</h2>
        </div>
        <span class="setup-check-summary"
          >{{ checks.filter((check) => check.state === 'success').length }} /
          {{ checks.length }} 正常</span
        >
      </div>
      <div class="setup-check-list">
        <article
          v-for="check in checks"
          :key="check.key"
          class="setup-check-row"
          :class="`is-${check.state}`"
        >
          <span class="setup-check-icon" aria-hidden="true">
            <CircleCheck v-if="check.state === 'success'" :size="18" />
            <CircleAlert v-else-if="check.state === 'warning'" :size="18" />
            <CircleX v-else :size="18" />
          </span>
          <div>
            <strong>{{ check.label }}</strong>
            <p>{{ check.detail }}</p>
            <small v-if="check.state !== 'success'">建议：{{ check.repair }}</small>
          </div>
        </article>
      </div>
    </UiCard>
  </div>
</template>
