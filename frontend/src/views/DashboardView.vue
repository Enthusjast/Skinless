<script setup lang="ts">
import {
  CheckCircle2,
  ChevronRight,
  Copy,
  ImagePlus,
  Palette,
  Settings2,
  ShieldCheck,
} from 'lucide-vue-next';
import { computed, ref } from 'vue';
import { RouterLink } from 'vue-router';
import UiCard from '../components/common/UiCard.vue';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const profile = computed(() => auth.profile);
const copied = ref(false);
const profileCount = computed(() => auth.availableProfiles.length);
const modelLabel = computed(() => (profile.value?.skinModel === 'slim' ? 'Slim' : 'Classic'));

async function copyProfileId() {
  if (!profile.value?.id) return;
  await navigator.clipboard?.writeText(profile.value.id);
  copied.value = true;
  window.setTimeout(() => {
    copied.value = false;
  }, 1800);
}
</script>

<template>
  <section class="profile-summary-card">
    <div class="profile-summary-main">
      <span class="profile-avatar-large">{{ profile?.name?.slice(0, 1).toUpperCase() }}</span>
      <div>
        <p class="eyebrow">ACTIVE PROFILE</p>
        <h2>{{ profile?.name }}</h2>
        <p>{{ auth.user?.email }}</p>
      </div>
    </div>
    <div class="profile-summary-meta">
      <span class="status-badge"><i class="status-dot" />已连接</span>
      <button
        class="copy-id-button"
        type="button"
        :aria-label="copied ? 'Profile ID 已复制' : '复制 Profile ID'"
        @click="copyProfileId"
      >
        <Copy :size="15" aria-hidden="true" />{{ copied ? '已复制' : '复制 Profile ID' }}
      </button>
      <code>{{ profile?.id }}</code>
    </div>
  </section>

  <div class="dashboard-overview">
    <div class="dashboard-overview-main">
      <UiCard as="section" class="overview-assets-panel" aria-labelledby="asset-status-title">
        <div class="workspace-section-heading">
          <div>
            <p class="eyebrow">CURRENT STATE</p>
            <h2 id="asset-status-title">当前状态</h2>
          </div>
          <span class="section-caption">{{ profileCount }} 个 Profile</span>
        </div>
        <div class="overview-asset-grid">
          <div class="overview-asset-status">
            <span class="overview-asset-icon"><Palette :size="18" aria-hidden="true" /></span>
            <div>
              <small>皮肤</small><strong>{{ profile?.skinHash ? '已设置' : '未设置' }}</strong>
            </div>
            <CheckCircle2 v-if="profile?.skinHash" :size="17" aria-hidden="true" />
          </div>
          <div class="overview-asset-status">
            <span class="overview-asset-icon"><ImagePlus :size="18" aria-hidden="true" /></span>
            <div>
              <small>披风</small><strong>{{ profile?.capeHash ? '已设置' : '未设置' }}</strong>
            </div>
            <CheckCircle2 v-if="profile?.capeHash" :size="17" aria-hidden="true" />
          </div>
          <div class="overview-asset-status">
            <span class="overview-asset-icon"><Settings2 :size="18" aria-hidden="true" /></span>
            <div>
              <small>默认模型</small><strong>{{ modelLabel }}</strong>
            </div>
          </div>
        </div>
      </UiCard>

      <section class="quick-actions" aria-labelledby="quick-actions-title">
        <div class="workspace-section-heading">
          <div>
            <p class="eyebrow">QUICK ACTIONS</p>
            <h2 id="quick-actions-title">快速操作</h2>
          </div>
        </div>
        <div class="quick-action-grid">
          <RouterLink class="quick-action-card" to="/dashboard/appearance">
            <span class="quick-action-icon"><Palette :size="19" aria-hidden="true" /></span>
            <span class="quick-action-copy"
              ><strong>角色外观</strong><small>管理 Profile、模型和纹理</small></span
            >
            <ChevronRight :size="18" aria-hidden="true" />
          </RouterLink>
          <RouterLink class="quick-action-card" to="/dashboard/wardrobe">
            <span class="quick-action-icon"><ImagePlus :size="19" aria-hidden="true" /></span>
            <span class="quick-action-copy"
              ><strong>纹理衣柜</strong><small>保存并应用皮肤与披风</small></span
            >
            <ChevronRight :size="18" aria-hidden="true" />
          </RouterLink>
          <RouterLink class="quick-action-card" to="/dashboard/security">
            <span class="quick-action-icon"><ShieldCheck :size="19" aria-hidden="true" /></span>
            <span class="quick-action-copy"
              ><strong>账户安全</strong><small>密码、邮箱和登录会话</small></span
            >
            <ChevronRight :size="18" aria-hidden="true" />
          </RouterLink>
          <RouterLink class="quick-action-card" to="/dashboard/setup">
            <span class="quick-action-icon"><Settings2 :size="19" aria-hidden="true" /></span>
            <span class="quick-action-copy"
              ><strong>启动器设置</strong><small>检查连接参数和服务状态</small></span
            >
            <ChevronRight :size="18" aria-hidden="true" />
          </RouterLink>
        </div>
      </section>
    </div>

    <UiCard as="section" class="overview-context-panel" aria-labelledby="context-title">
      <p class="eyebrow">WORKSPACE STATUS</p>
      <h2 id="context-title">工作区已就绪</h2>
      <p>从这里开始管理你的 Minecraft 身份。详细设置会在对应页面中展开。</p>
      <dl class="overview-context-list">
        <div>
          <dt>默认模型</dt>
          <dd>{{ modelLabel }}</dd>
        </div>
        <div>
          <dt>Profile 数量</dt>
          <dd>{{ profileCount }}</dd>
        </div>
        <div>
          <dt>账户状态</dt>
          <dd>已连接</dd>
        </div>
      </dl>
      <RouterLink class="button button-ghost button-small" to="/dashboard/setup">
        查看连接设置<ChevronRight :size="16" aria-hidden="true" />
      </RouterLink>
    </UiCard>
  </div>
</template>
