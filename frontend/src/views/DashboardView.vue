<script setup lang="ts">
import { computed, ref } from 'vue';
import { ApiError } from '../api';
import SkinPreview from '../components/SkinPreview.vue';
import SkinUploader from '../components/SkinUploader.vue';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const passwordForm = ref({ current: '', next: '' });
const passwordMessage = ref('');
const passwordError = ref('');
const passwordBusy = ref(false);
const profile = computed(() => auth.profile);
const selectedModel = ref<'classic' | 'slim'>(auth.profile?.skinModel ?? 'classic');

async function changePassword() {
  passwordBusy.value = true;
  passwordMessage.value = '';
  passwordError.value = '';
  try {
    await auth.updatePassword(passwordForm.value.current, passwordForm.value.next);
    passwordForm.value = { current: '', next: '' };
    passwordMessage.value = '密码已更新，请重新登录。';
  } catch (cause) {
    passwordError.value = cause instanceof ApiError || cause instanceof Error ? cause.message : '修改失败。';
  } finally {
    passwordBusy.value = false;
  }
}
</script>

<template>
  <section class="dashboard-heading">
    <div><p class="eyebrow">PLAYER DASHBOARD</p><h1>你好，{{ profile?.name }}</h1><p>管理你的游戏身份和纹理资产。</p></div>
    <span class="profile-chip">{{ auth.user?.email }}</span>
  </section>
  <div class="dashboard-grid">
    <div class="dashboard-main">
      <section class="panel model-panel">
        <div class="panel-heading"><div><p class="eyebrow">APPEARANCE</p><h2>你的角色</h2></div><span class="mono-id">{{ profile?.id }}</span></div>
        <div class="model-choice">
          <label :class="{ selected: selectedModel === 'classic' }"><input v-model="selectedModel" value="classic" type="radio" name="model" /> <span><strong>Classic</strong><small>Steve · 粗手臂</small></span></label>
          <label :class="{ selected: selectedModel === 'slim' }"><input v-model="selectedModel" value="slim" type="radio" name="model" /> <span><strong>Slim</strong><small>Alex · 细手臂</small></span></label>
        </div>
        <p class="model-note">模型选择会在下一次皮肤上传时保存。</p>
      </section>
      <SkinUploader v-if="profile" asset="skin" :current-hash="profile.skinHash" :model="selectedModel" />
      <SkinUploader v-if="profile" asset="cape" :current-hash="profile.capeHash" :model="selectedModel" />
      <section class="panel password-panel">
        <div class="panel-heading"><div><p class="eyebrow">ACCOUNT SECURITY</p><h2>修改密码</h2></div></div>
        <form class="inline-form" @submit.prevent="changePassword">
          <div class="field"><label for="current-password">当前密码</label><input id="current-password" v-model="passwordForm.current" type="password" autocomplete="current-password" required /></div>
          <div class="field"><label for="new-password">新密码</label><input id="new-password" v-model="passwordForm.next" type="password" autocomplete="new-password" minlength="8" required /></div>
          <button class="button button-primary button-small" type="submit" :disabled="passwordBusy">{{ passwordBusy ? '保存中…' : '更新密码' }}</button>
        </form>
        <p v-if="passwordMessage" class="form-success" role="status">{{ passwordMessage }}</p>
        <p v-if="passwordError" class="form-error" role="alert">{{ passwordError }}</p>
      </section>
    </div>
    <aside class="dashboard-side"><SkinPreview v-if="profile" :skin-hash="profile.skinHash" :model="selectedModel" /></aside>
  </div>
</template>
