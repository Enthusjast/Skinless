<script setup lang="ts">
import { KeyRound, ShieldCheck } from 'lucide-vue-next';
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { formatApiError } from '../api';
import AccountDeletion from '../components/AccountDeletion.vue';
import EmailChangeForm from '../components/EmailChangeForm.vue';
import SessionManagement from '../components/SessionManagement.vue';
import UiCard from '../components/common/UiCard.vue';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const router = useRouter();
const passwordForm = ref({ current: '', next: '' });
const passwordMessage = ref('');
const passwordError = ref('');
const passwordBusy = ref(false);

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
  <UiCard as="section" class="panel password-panel security-page-card">
    <div class="workspace-section-heading">
      <div>
        <p class="eyebrow">01 / PASSWORD</p>
        <h2>修改密码</h2>
      </div>
      <ShieldCheck :size="20" class="section-icon" aria-hidden="true" />
    </div>
    <p class="section-description">修改密码后，当前登录设备会退出，需要重新登录。</p>
    <form class="inline-form" @submit.prevent="changePassword">
      <div class="field">
        <label for="current-password">当前密码</label>
        <input
          id="current-password"
          v-model="passwordForm.current"
          type="password"
          autocomplete="current-password"
          required
        />
      </div>
      <div class="field">
        <label for="new-password">新密码</label>
        <input
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
</template>
