<script setup lang="ts">
import { Copy, Download, RefreshCw } from 'lucide-vue-next';
import { onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import SkinPreview from '../components/SkinPreview.vue';
import {
  ApiError,
  formatApiError,
  getPublicProfileById,
  getPublicProfileByName,
  type PublicProfile,
} from '../api';

const PROFILE_ID_PATTERN = /^[0-9a-f]{32}$/i;

const route = useRoute();
const router = useRouter();
const profile = ref<PublicProfile | null>(null);
const loading = ref(true);
const notFound = ref(false);
const error = ref('');
const copyFeedback = ref('');

function routeIdentifier(): string {
  const value = route.params.uuid ?? route.params.name;
  return typeof value === 'string' ? value.trim() : '';
}

function isNotFound(cause: unknown): boolean {
  return cause instanceof ApiError && cause.status === 404;
}

async function loadProfile(): Promise<void> {
  const identifier = routeIdentifier();
  loading.value = true;
  notFound.value = false;
  error.value = '';
  profile.value = null;
  copyFeedback.value = '';

  if (!identifier) {
    notFound.value = true;
    loading.value = false;
    return;
  }

  try {
    if (PROFILE_ID_PATTERN.test(identifier)) {
      profile.value = await getPublicProfileById(identifier);
      document.title = `${profile.value.name} · Skinless`;
    } else {
      const alias = await getPublicProfileByName(identifier);
      if (!alias) {
        notFound.value = true;
      } else {
        await router.replace(`/profiles/${alias.id}`);
      }
    }
  } catch (cause) {
    if (isNotFound(cause)) notFound.value = true;
    else error.value = formatApiError(cause, '暂时无法读取这个公开 Profile。');
  } finally {
    loading.value = false;
  }
}

async function copyUuid(): Promise<void> {
  if (!profile.value) return;
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
    await navigator.clipboard.writeText(profile.value.id);
    copyFeedback.value = '已复制 UUID';
  } catch {
    copyFeedback.value = '复制失败，请手动选择 UUID';
  }
}

onMounted(() => void loadProfile());
watch(
  () => [route.params.uuid, route.params.name],
  ([nextUuid, nextName], [previousUuid, previousName]) => {
    if (nextUuid !== previousUuid || nextName !== previousName) void loadProfile();
  },
);
</script>

<template>
  <section class="public-profile-page" aria-labelledby="public-profile-title">
    <div v-if="loading" class="panel public-profile-state" data-state="loading" aria-live="polite">
      <RefreshCw :size="20" class="public-profile-state-icon" aria-hidden="true" />
      <p>正在加载公开 Profile…</p>
    </div>

    <div v-else-if="notFound" class="panel public-profile-state" data-state="not-found">
      <span class="empty-cube" aria-hidden="true">?</span>
      <h1 id="public-profile-title">找不到这个 Profile</h1>
      <p>链接可能已失效，或者这个账号已经不再公开。</p>
    </div>

    <div
      v-else-if="error"
      class="panel public-profile-state public-profile-error"
      data-state="error"
    >
      <h1 id="public-profile-title">暂时无法加载</h1>
      <p role="alert">{{ error }}</p>
      <button
        class="button button-ghost"
        type="button"
        data-action="retry-profile"
        @click="loadProfile"
      >
        <RefreshCw :size="16" aria-hidden="true" />重试
      </button>
    </div>

    <div v-else-if="profile" class="public-profile-content" data-state="ready">
      <header class="public-profile-heading">
        <div>
          <p class="eyebrow">PUBLIC PROFILE</p>
          <h1 id="public-profile-title">{{ profile.name }}</h1>
          <p>可分享的 Minecraft 游戏身份</p>
        </div>
        <span class="public-profile-badge">只读</span>
      </header>

      <div class="public-profile-grid">
        <div class="public-profile-main">
          <section
            class="panel public-profile-identity"
            aria-labelledby="public-profile-details-title"
          >
            <div class="panel-heading">
              <div>
                <p class="eyebrow">PROFILE DETAILS</p>
                <h2 id="public-profile-details-title">基本信息</h2>
              </div>
            </div>
            <dl class="public-profile-details">
              <div>
                <dt>UUID</dt>
                <dd class="public-profile-uuid-row">
                  <code>{{ profile.id }}</code>
                  <button
                    class="copy-id-button"
                    type="button"
                    data-action="copy-uuid"
                    aria-label="复制 Profile UUID"
                    @click="copyUuid"
                  >
                    <Copy :size="14" aria-hidden="true" />复制
                  </button>
                </dd>
              </div>
              <div>
                <dt>模型</dt>
                <dd>{{ profile.model === 'slim' ? 'Slim' : 'Classic' }}</dd>
              </div>
            </dl>
            <p v-if="copyFeedback" class="form-success" role="status">{{ copyFeedback }}</p>
          </section>

          <section
            class="panel public-profile-assets"
            aria-labelledby="public-profile-assets-title"
          >
            <div class="panel-heading">
              <div>
                <p class="eyebrow">TEXTURE ASSETS</p>
                <h2 id="public-profile-assets-title">当前纹理</h2>
              </div>
            </div>
            <div class="public-profile-asset-list">
              <div class="public-profile-asset-row">
                <div>
                  <strong>皮肤</strong>
                  <span>{{ profile.skin ? '当前皮肤 PNG' : '尚未设置皮肤' }}</span>
                </div>
                <a
                  v-if="profile.skin"
                  class="button button-ghost button-small"
                  :href="profile.skin.url"
                  :download="`${profile.name}-skin.png`"
                  data-download="skin"
                >
                  <Download :size="16" aria-hidden="true" />下载皮肤
                </a>
                <span v-else class="public-profile-asset-missing">暂无</span>
              </div>
              <div class="public-profile-asset-row">
                <div>
                  <strong>披风</strong>
                  <span>{{ profile.cape ? '当前披风 PNG' : '尚未设置披风' }}</span>
                </div>
                <a
                  v-if="profile.cape"
                  class="button button-ghost button-small"
                  :href="profile.cape.url"
                  :download="`${profile.name}-cape.png`"
                  data-download="cape"
                >
                  <Download :size="16" aria-hidden="true" />下载披风
                </a>
                <span v-else class="public-profile-asset-missing">暂无</span>
              </div>
            </div>
          </section>
        </div>

        <SkinPreview
          :skin-hash="null"
          :cape-hash="null"
          :skin-preview-url="profile.skin?.url ?? null"
          :cape-preview-url="profile.cape?.url ?? null"
          :model="profile.model"
        />
      </div>
    </div>
  </section>
</template>
