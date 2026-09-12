<script setup lang="ts">
import { ArrowLeft, MailCheck, RefreshCw } from 'lucide-vue-next';
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue';
import { ApiError, formatApiError } from '../api';
import { useAuthStore } from '../stores/auth';

type EmailStep = 'details' | 'verify';

const auth = useAuthStore();
const form = reactive({ currentPassword: '', newEmail: '' });
const step = ref<EmailStep>('details');
const challengeId = ref('');
const targetEmail = ref('');
const code = ref('');
const error = ref('');
const success = ref('');
const fieldError = reactive({ currentPassword: '', newEmail: '', code: '' });
const busy = ref(false);
const resendBusy = ref(false);
const expiresAt = ref(0);
const resendAt = ref(0);
const clock = ref(Date.now());
const codeInput = ref<HTMLInputElement | null>(null);
let countdownTimer: ReturnType<typeof setInterval> | undefined;

const resendRemaining = computed(() =>
  Math.max(0, Math.ceil((resendAt.value - clock.value) / 1000)),
);
const codeRemaining = computed(() =>
  Math.max(0, Math.ceil((expiresAt.value - clock.value) / 1000)),
);

function clearFeedback() {
  error.value = '';
  success.value = '';
  for (const key of Object.keys(fieldError) as Array<keyof typeof fieldError>) fieldError[key] = '';
}

function errorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof ApiError) {
    const messages: Record<string, string> = {
      invalid_email: '请输入有效的邮箱地址。',
      current_password_incorrect: '当前密码不正确。',
      email_in_use: '该邮箱地址已被使用。',
      invalid_verification_code: '验证码无效或已过期。',
      verification_attempts_exhausted: '验证码尝试次数已用完，请重新发送。',
      resend_cooldown: '请稍候再重新发送验证码。',
      email_change_rate_limited: '邮箱变更请求过于频繁，请稍后再试。',
      mail_not_configured: '邮箱服务尚未配置，请联系管理员。',
      mail_delivery_failed: '验证码发送失败，请稍后重试。',
    };
    return messages[cause.code ?? ''] ?? formatApiError(cause, fallback);
  }
  return formatApiError(cause, fallback);
}

function setFieldError(cause: unknown, fallback: string) {
  const message = errorMessage(cause, fallback);
  if (cause instanceof ApiError) {
    if (cause.code === 'invalid_email' || cause.code === 'email_in_use')
      fieldError.newEmail = message;
    else if (cause.code === 'current_password_incorrect') fieldError.currentPassword = message;
    else if (
      cause.code === 'invalid_verification_code' ||
      cause.code === 'verification_attempts_exhausted'
    )
      fieldError.code = message;
    else error.value = message;
  } else {
    error.value = message;
  }
}

async function submitDetails() {
  clearFeedback();
  busy.value = true;
  try {
    const response = await auth.startEmailChange(form.currentPassword, form.newEmail);
    challengeId.value = response.challengeId;
    targetEmail.value = response.email;
    code.value = '';
    expiresAt.value = response.expiresAt;
    resendAt.value = response.resendAfter;
    step.value = 'verify';
    success.value = `验证码已发送至 ${response.email}。`;
    await nextTick();
    codeInput.value?.focus();
  } catch (cause) {
    setFieldError(cause, '邮箱变更请求失败，请稍后重试。');
  } finally {
    busy.value = false;
  }
}

async function submitCode() {
  clearFeedback();
  if (!/^\d{6}$/.test(code.value)) {
    fieldError.code = '请输入 6 位数字验证码。';
    return;
  }
  busy.value = true;
  try {
    await auth.completeEmailChange(challengeId.value, code.value, form.currentPassword);
    success.value = '邮箱已更新。';
  } catch (cause) {
    setFieldError(cause, '邮箱变更失败，请稍后重试。');
  } finally {
    busy.value = false;
  }
}

async function resendCode() {
  if (!challengeId.value || resendBusy.value || resendRemaining.value > 0) return;
  clearFeedback();
  resendBusy.value = true;
  try {
    const response = await auth.resendEmailChange(challengeId.value);
    targetEmail.value = response.email;
    expiresAt.value = response.expiresAt;
    resendAt.value = response.resendAfter;
    code.value = '';
    success.value = '新的验证码已发送。';
    await nextTick();
    codeInput.value?.focus();
  } catch (cause) {
    setFieldError(cause, '验证码发送失败，请稍后重试。');
  } finally {
    resendBusy.value = false;
  }
}

function backToDetails() {
  clearFeedback();
  step.value = 'details';
}

onMounted(() => {
  countdownTimer = setInterval(() => {
    clock.value = Date.now();
  }, 1000);
});

onUnmounted(() => {
  if (countdownTimer) clearInterval(countdownTimer);
});
</script>

<template>
  <div class="email-change-form" aria-labelledby="email-change-heading">
    <div class="workspace-section-heading">
      <div>
        <p class="eyebrow">EMAIL ADDRESS</p>
        <h3 id="email-change-heading">变更邮箱</h3>
      </div>
      <MailCheck :size="19" class="section-icon" aria-hidden="true" />
    </div>
    <p class="section-description">
      当前邮箱：{{ auth.user?.email }}。变更邮箱需要当前密码和新邮箱验证码。
    </p>

    <form v-if="step === 'details'" class="inline-form" @submit.prevent="submitDetails">
      <div class="field">
        <label for="email-current-password">当前密码</label>
        <input
          id="email-current-password"
          v-model="form.currentPassword"
          type="password"
          autocomplete="current-password"
          required
          :aria-invalid="Boolean(fieldError.currentPassword)"
          :aria-describedby="
            fieldError.currentPassword ? 'email-current-password-error' : undefined
          "
        />
        <small
          v-if="fieldError.currentPassword"
          id="email-current-password-error"
          class="form-error"
          >{{ fieldError.currentPassword }}</small
        >
      </div>
      <div class="field">
        <label for="new-email">新邮箱地址</label>
        <input
          id="new-email"
          v-model="form.newEmail"
          type="email"
          autocomplete="email"
          placeholder="new@example.com"
          required
          :aria-invalid="Boolean(fieldError.newEmail)"
          :aria-describedby="fieldError.newEmail ? 'new-email-error' : undefined"
        />
        <small v-if="fieldError.newEmail" id="new-email-error" class="form-error">{{
          fieldError.newEmail
        }}</small>
      </div>
      <button class="button button-primary button-small" type="submit" :disabled="busy">
        <MailCheck :size="16" aria-hidden="true" />{{ busy ? '发送中…' : '发送验证码' }}
      </button>
    </form>

    <form v-else class="inline-form email-change-verify-form" @submit.prevent="submitCode">
      <div class="field">
        <label for="email-change-code">新邮箱验证码</label>
        <input
          id="email-change-code"
          ref="codeInput"
          v-model="code"
          type="text"
          inputmode="numeric"
          autocomplete="one-time-code"
          pattern="[0-9]{6}"
          maxlength="6"
          placeholder="000000"
          required
          :aria-invalid="Boolean(fieldError.code)"
          :aria-describedby="fieldError.code ? 'email-change-code-error' : 'email-change-code-help'"
        />
        <small id="email-change-code-help"
          >验证码剩余 {{ Math.ceil(codeRemaining / 60000) }} 分钟有效，发送至
          {{ targetEmail }}</small
        >
        <small v-if="fieldError.code" id="email-change-code-error" class="form-error">{{
          fieldError.code
        }}</small>
      </div>
      <button class="button button-primary button-small" type="submit" :disabled="busy">
        <MailCheck :size="16" aria-hidden="true" />{{ busy ? '保存中…' : '确认变更' }}
      </button>
      <div class="registration-actions">
        <button
          class="text-button"
          type="button"
          :disabled="busy || resendBusy || resendRemaining > 0"
          @click="resendCode"
        >
          <RefreshCw :size="15" aria-hidden="true" />
          {{
            resendBusy
              ? '发送中…'
              : resendRemaining > 0
                ? resendRemaining + ' 秒后可重发'
                : '重新发送验证码'
          }}
        </button>
        <button class="text-button" type="button" :disabled="busy" @click="backToDetails">
          <ArrowLeft :size="15" aria-hidden="true" />返回修改邮箱
        </button>
      </div>
    </form>
    <p v-if="success" class="form-success" role="status" aria-live="polite">{{ success }}</p>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
  </div>
</template>
