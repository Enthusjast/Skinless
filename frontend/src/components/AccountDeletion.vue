<script setup lang="ts">
import { AlertTriangle, Trash2 } from 'lucide-vue-next';
import { reactive, ref } from 'vue';
import { ApiError, formatApiError } from '../api';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const ACCOUNT_DELETION_CONFIRMATION = 'DELETE';
const auth = useAuthStore();
const router = useRouter();
const form = reactive({ currentPassword: '', confirmation: '' });
const error = ref('');
const busy = ref(false);

function errorMessage(cause: unknown): string {
  if (cause instanceof ApiError) {
    const messages: Record<string, string> = {
      current_password_required: '请输入当前密码。',
      current_password_incorrect: '当前密码不正确。',
      account_deletion_confirmation_required: `请输入 ${ACCOUNT_DELETION_CONFIRMATION} 以确认。`,
      account_deletion_already_pending: '该账号已经在等待删除。',
      admin_deletion_not_allowed: '管理员账号暂不支持自助删除。',
      account_restore_rate_limited: '操作过于频繁，请稍后再试。',
      mail_not_configured: '邮箱服务尚未配置，请联系管理员。',
      mail_delivery_failed: '恢复验证码发送失败，请稍后重试。',
    };
    return messages[cause.code ?? ''] ?? formatApiError(cause, '删除请求失败，请稍后重试。');
  }
  return formatApiError(cause, '删除请求失败，请稍后重试。');
}

async function submit() {
  error.value = '';
  if (form.confirmation !== ACCOUNT_DELETION_CONFIRMATION) {
    error.value = `请输入 ${ACCOUNT_DELETION_CONFIRMATION} 以确认。`;
    return;
  }

  const email = auth.user?.email ?? '';
  busy.value = true;
  try {
    await auth.requestAccountDeletion(form.currentPassword, form.confirmation);
    auth.clearSession();
    await router.push({ path: '/restore-account', query: { email, pending: '1' } });
  } catch (cause) {
    error.value = errorMessage(cause);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section v-if="!auth.isAdmin" class="danger-zone" aria-labelledby="account-deletion-heading">
    <div class="workspace-section-heading">
      <div>
        <p class="eyebrow">DANGER ZONE</p>
        <h3 id="account-deletion-heading">删除账号</h3>
      </div>
      <AlertTriangle :size="19" class="danger-zone-icon" aria-hidden="true" />
    </div>
    <p class="section-description">
      账号会立即退出所有登录会话（包括网页登录和 Minecraft 协议会话）。你有 7
      天时间使用邮箱中的恢复验证码撤销删除；期限结束后，Profile、衣柜和纹理引用将永久删除，R2
      纹理对象会在后台清理。
    </p>
    <form class="danger-zone-form" @submit.prevent="submit">
      <div class="field">
        <label for="delete-account-password">当前密码</label>
        <input
          id="delete-account-password"
          v-model="form.currentPassword"
          type="password"
          autocomplete="current-password"
          required
        />
      </div>
      <div class="field">
        <label for="delete-account-confirmation">输入 DELETE 确认</label>
        <input
          id="delete-account-confirmation"
          v-model="form.confirmation"
          type="text"
          autocomplete="off"
          spellcheck="false"
          required
        />
      </div>
      <button class="button button-danger" type="submit" :disabled="busy">
        <Trash2 :size="16" aria-hidden="true" />{{ busy ? '提交中…' : '申请删除账号' }}
      </button>
    </form>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
  </section>
</template>
