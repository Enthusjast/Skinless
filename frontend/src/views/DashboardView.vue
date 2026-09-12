<script setup lang="ts">
import { Copy, KeyRound, ShieldCheck } from 'lucide-vue-next';
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { formatApiError } from '../api';
import EmailChangeForm from '../components/EmailChangeForm.vue';
import AccountDeletion from '../components/AccountDeletion.vue';
import UiCard from '../components/common/UiCard.vue';
import SessionManagement from '../components/SessionManagement.vue';
import ProfileManagement from '../components/ProfileManagement.vue';
import SkinPreview from '../components/SkinPreview.vue';
import SkinUploader from '../components/SkinUploader.vue';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const router = useRouter();
const passwordForm = ref({ current: '', next: '' });
const passwordMessage = ref('');
const passwordError = ref('');
const passwordBusy = ref(false);
const profile = computed(() => auth.profile);
const selectedModel = ref<'classic' | 'slim'>(auth.profile?.skinModel ?? 'classic');
const copied = ref(false);
const temporarySkinPreview = ref<string | null>(null);
const temporaryCapePreview = ref<string | null>(null);

watch(
  () => profile.value?.id,
  () => {
    selectedModel.value = profile.value?.skinModel ?? 'classic';
    temporarySkinPreview.value = null;
    temporaryCapePreview.value = null;
    copied.value = false;
  },
);

function setAssetPreview(asset: 'skin' | 'cape', url: string | null) {
  if (asset === 'skin') temporarySkinPreview.value = url;
  else temporaryCapePreview.value = url;
}

function clearAssetPreview(asset: 'skin' | 'cape') {
  setAssetPreview(asset, null);
}

async function copyProfileId() {
  if (!profile.value?.id) return;
  await navigator.clipboard?.writeText(profile.value.id);
  copied.value = true;
  window.setTimeout(() => {
    copied.value = false;
  }, 1800);
}

async function changePassword() {
  passwordBusy.value = true;
  passwordMessage.value = '';
  passwordError.value = '';
  try {
    await auth.updatePassword(passwordForm.value.current, passwordForm.value.next);
    passwordForm.value = { current: '', next: '' };
    await router.push({ path: '/login', query: { changed: '1' } });
  } catch (cause) {
    passwordError.value = formatApiError(cause, '修改失败。');
  } finally {
    passwordBusy.value = false;
  }
}
</script>

<template>
  <ProfileManagement />
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
      <span class="status-badge"><i class="status-dot" />已连接</span
      ><button
        class="copy-id-button"
        type="button"
        :aria-label="copied ? 'Profile ID 已复制' : '复制 Profile ID'"
        @click="copyProfileId"
      >
        <Copy :size="15" aria-hidden="true" />{{ copied ? '已复制' : '复制 Profile ID' }}</button
      ><code>{{ profile?.id }}</code>
    </div>
  </section>
  <div class="dashboard-grid">
    <div class="dashboard-main">
      <UiCard as="section" id="appearance" class="panel model-panel">
        <div class="workspace-section-heading">
          <div>
            <p class="eyebrow">01 / APPEARANCE</p>
            <h2>你的角色</h2>
          </div>
          <span class="section-caption">选择模型后上传对应纹理</span>
        </div>
        <div class="model-choice">
          <label :class="{ selected: selectedModel === 'classic' }"
            ><input v-model="selectedModel" value="classic" type="radio" name="model" />
            <span><strong>Classic</strong><small>Steve · 粗手臂</small></span></label
          >
          <label :class="{ selected: selectedModel === 'slim' }"
            ><input v-model="selectedModel" value="slim" type="radio" name="model" />
            <span><strong>Slim</strong><small>Alex · 细手臂</small></span></label
          >
        </div>
        <p class="model-note">模型选择会在下一次皮肤上传时保存。</p>
      </UiCard>
      <SkinUploader
        v-if="profile"
        asset="skin"
        :current-hash="profile.skinHash"
        :model="selectedModel"
        @preview="setAssetPreview('skin', $event)"
        @updated="clearAssetPreview('skin')"
      />
      <SkinUploader
        v-if="profile"
        asset="cape"
        :current-hash="profile.capeHash"
        :model="selectedModel"
        @preview="setAssetPreview('cape', $event)"
        @updated="clearAssetPreview('cape')"
      />
      <UiCard as="section" id="security" class="panel password-panel">
        <div class="workspace-section-heading">
          <div>
            <p class="eyebrow">02 / ACCOUNT SECURITY</p>
            <h2>账户安全</h2>
          </div>
          <ShieldCheck :size="20" class="section-icon" aria-hidden="true" />
        </div>
        <p class="section-description">修改密码后，当前登录设备会退出，需要重新登录。</p>
        <form class="inline-form" @submit.prevent="changePassword">
          <div class="field">
            <label for="current-password">当前密码</label
            ><input
              id="current-password"
              v-model="passwordForm.current"
              type="password"
              autocomplete="current-password"
              required
            />
          </div>
          <div class="field">
            <label for="new-password">新密码</label
            ><input
              id="new-password"
              v-model="passwordForm.next"
              type="password"
              autocomplete="new-password"
              minlength="8"
              required
            />
          </div>
          <button class="button button-primary button-small" type="submit" :disabled="passwordBusy">
            <KeyRound :size="16" aria-hidden="true" />{{ passwordBusy ? '保存中…' : '更新密码' }}
          </button>
        </form>
        <p v-if="passwordMessage" class="form-success" role="status">{{ passwordMessage }}</p>
        <p v-if="passwordError" class="form-error" role="alert">{{ passwordError }}</p>
        <EmailChangeForm />
        <SessionManagement />
        <AccountDeletion />
      </UiCard>
    </div>
    <aside class="dashboard-side">
      <SkinPreview
        v-if="profile"
        :skin-hash="profile.skinHash"
        :cape-hash="profile.capeHash"
        :skin-preview-url="temporarySkinPreview"
        :cape-preview-url="temporaryCapePreview"
        :model="selectedModel"
      />
    </aside>
  </div>
</template>
