<script setup lang="ts">
import { KeyRound } from 'lucide-vue-next';
import { reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ApiError, formatApiError, restoreAccount } from '../api';

const route = useRoute();
const router = useRouter();
const form = reactive({
  email: typeof route.query.email === 'string' ? route.query.email : '',
  code: '',
});
const error = ref('');
const busy = ref(false);

function errorMessage(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.code === 'invalid_verification_code') return '恢复验证码无效或已过期。';
    if (cause.code === 'verification_attempts_exhausted') return '尝试次数已用完，请联系管理员。';
    if (cause.code === 'account_restore_rate_limited') return '操作过于频繁，请稍后再试。';
    return formatApiError(cause, '账号恢复失败，请稍后重试。');
  }
  return formatApiError(cause, '账号恢复失败，请稍后重试。');
}

async function submit() {
  error.value = '';
  if (!/^\d{6}$/.test(form.code)) {
    error.value = '请输入 6 位数字恢复验证码。';
    return;
  }
  busy.value = true;
  try {
    await restoreAccount(form.email, form.code);
    await router.push({ path: '/login', query: { restored: '1' } });
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="auth-layout">
    <div class="auth-intro">
      <p class="eyebrow">ACCOUNT RECOVERY</p>
      <h1>恢复待删除账号</h1>
      <p>在 7 天恢复期内输入邮箱收到的验证码，账号会恢复为可登录状态。</p>
    </div>
    <section class="auth-card">
      <p class="eyebrow">RESTORE ACCOUNT</p>
      <h2>输入恢复验证码</h2>
      <p>验证码只在删除申请后的 7 天内有效，错误尝试次数有限。</p>
      <form @submit.prevent="submit">
        <div class="field">
          <label for="restore-email">账号邮箱</label>
          <input
            id="restore-email"
            v-model="form.email"
            type="email"
            autocomplete="email"
            required
          />
        </div>
        <div class="field">
          <label for="restore-code">6 位恢复验证码</label>
          <input
            id="restore-code"
            v-model="form.code"
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            pattern="[0-9]{6}"
            maxlength="6"
            placeholder="000000"
            required
          />
        </div>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <button class="button button-primary" type="submit" :disabled="busy">
          <KeyRound :size="17" aria-hidden="true" />{{ busy ? '恢复中…' : '恢复账号' }}
        </button>
      </form>
      <RouterLink to="/login" class="auth-link">返回登录</RouterLink>
    </section>
  </section>
</template>
