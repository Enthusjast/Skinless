<script setup lang="ts">
import { ArrowLeft, KeyRound, Mail, RefreshCw } from 'lucide-vue-next';
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ApiError, formatApiError } from '../api';
import TurnstileWidget from '../components/TurnstileWidget.vue';
import { useAuthStore } from '../stores/auth';

type ResetStep = 'email' | 'verify';

const auth = useAuthStore();
const router = useRouter();
const form = reactive({ email: '', newPassword: '', confirm: '' });
const step = ref<ResetStep>('email');
const challengeId = ref('');
const code = ref('');
const error = ref('');
const success = ref('');
const fieldError = reactive({ email: '', code: '', newPassword: '', confirm: '' });
const busy = ref(false);
const resendBusy = ref(false);
const expiresAt = ref(0);
const resendAt = ref(0);
const clock = ref(Date.now());
const codeInput = ref<HTMLInputElement | null>(null);
const turnstileToken = ref('');
const turnstileWidget = ref<{ reset?: () => void } | null>(null);
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
      password_too_short: '密码至少需要 8 个字符。',
      password_too_long: '密码不能超过 256 个字符。',
      invalid_verification_code: '验证码无效或已过期。',
      verification_attempts_exhausted: '验证码尝试次数已用完，请重新发送。',
      resend_cooldown: '请稍候再重新发送验证码。',
      password_reset_rate_limited: '重置请求过于频繁，请稍后再试。',
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
    if (cause.code === 'invalid_email') fieldError.email = message;
    else if (cause.code === 'password_too_short' || cause.code === 'password_too_long') {
      fieldError.newPassword = message;
    } else if (
      cause.code === 'invalid_verification_code' ||
      cause.code === 'verification_attempts_exhausted'
    ) {
      fieldError.code = message;
    } else {
      error.value = message;
    }
  } else {
    error.value = message;
  }
}

async function submitEmail() {
  clearFeedback();
  busy.value = true;
  try {
    const response = await auth.startPasswordReset(form.email, turnstileToken.value || undefined);
    challengeId.value = response.challengeId;
    code.value = '';
    form.newPassword = '';
    form.confirm = '';
    expiresAt.value = response.expiresAt;
    resendAt.value = response.resendAfter;
    step.value = 'verify';
    success.value = '如果账号存在，验证码已发送到你的邮箱。';
    await nextTick();
    codeInput.value?.focus();
  } catch (cause) {
    setFieldError(cause, '重置请求失败，请稍后重试。');
  } finally {
    turnstileToken.value = '';
    turnstileWidget.value?.reset?.();
    busy.value = false;
  }
}

async function submitCode() {
  clearFeedback();
  if (!/^\d{6}$/.test(code.value)) {
    fieldError.code = '请输入 6 位数字验证码。';
    return;
  }
  if (form.newPassword.length < 8) {
    fieldError.newPassword = '密码至少需要 8 个字符。';
    return;
  }
  if (form.newPassword !== form.confirm) {
    fieldError.confirm = '两次输入的密码不一致。';
    return;
  }
  busy.value = true;
  try {
    await auth.verifyPasswordReset(challengeId.value, code.value, form.newPassword);
    success.value = '密码已重置，正在前往登录…';
    await router.push({ path: '/login', query: { reset: '1' } });
  } catch (cause) {
    setFieldError(cause, '密码重置失败，请稍后重试。');
  } finally {
    busy.value = false;
  }
}

async function resendCode() {
  if (!challengeId.value || resendBusy.value || resendRemaining.value > 0) return;
  clearFeedback();
  resendBusy.value = true;
  try {
    const response = await auth.resendPasswordReset(
      challengeId.value,
      turnstileToken.value || undefined,
    );
    expiresAt.value = response.expiresAt;
    resendAt.value = response.resendAfter;
    code.value = '';
    success.value = '新的验证码已发送。';
    await nextTick();
    codeInput.value?.focus();
  } catch (cause) {
    setFieldError(cause, '验证码发送失败，请稍后重试。');
  } finally {
    turnstileToken.value = '';
    turnstileWidget.value?.reset?.();
    resendBusy.value = false;
  }
}

function backToEmail() {
  clearFeedback();
  step.value = 'email';
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
  <section class="auth-layout">
    <div class="auth-intro">
      <p class="eyebrow">ACCOUNT RECOVERY</p>
      <h1>找回账号密码</h1>
      <p>通过注册邮箱验证身份，然后设置新的登录密码。</p>
    </div>
    <section class="auth-card">
      <p class="eyebrow">{{ step === 'email' ? 'FORGOT PASSWORD' : 'VERIFY EMAIL' }}</p>
      <h2>{{ step === 'email' ? '重置密码' : '输入验证码' }}</h2>
      <p v-if="step === 'email'">输入邮箱，我们会发送一次性验证码。</p>
      <p v-else>验证码已发送至 {{ form.email }}，请在 10 分钟内完成重置。</p>
      <TurnstileWidget
        ref="turnstileWidget"
        @token="turnstileToken = $event"
        @expired="turnstileToken = ''"
        @error="turnstileToken = ''"
      />

      <form v-if="step === 'email'" @submit.prevent="submitEmail">
        <div class="field">
          <label for="email">邮箱地址</label>
          <input
            id="email"
            v-model="form.email"
            type="email"
            autocomplete="email"
            placeholder="you@example.com"
            :aria-invalid="Boolean(fieldError.email)"
            :aria-describedby="fieldError.email ? 'email-error' : undefined"
            required
          />
          <small v-if="fieldError.email" id="email-error" class="form-error">{{
            fieldError.email
          }}</small>
        </div>
        <p v-if="success" class="form-success" role="status" aria-live="polite">{{ success }}</p>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <button class="button button-primary" type="submit" :disabled="busy">
          <Mail :size="17" aria-hidden="true" />{{ busy ? '发送中…' : '发送验证码' }}
        </button>
      </form>

      <form v-else @submit.prevent="submitCode">
        <div class="field">
          <label for="verification-code">6 位验证码</label>
          <input
            id="verification-code"
            ref="codeInput"
            v-model="code"
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            pattern="[0-9]{6}"
            maxlength="6"
            placeholder="000000"
            :aria-invalid="Boolean(fieldError.code)"
            :aria-describedby="
              fieldError.code ? 'verification-code-error' : 'verification-code-help'
            "
            required
          />
          <small id="verification-code-help"
            >验证码剩余 {{ Math.ceil(codeRemaining / 60000) }} 分钟有效</small
          >
          <small v-if="fieldError.code" id="verification-code-error" class="form-error">{{
            fieldError.code
          }}</small>
        </div>
        <div class="field">
          <label for="new-password">新密码</label>
          <input
            id="new-password"
            v-model="form.newPassword"
            type="password"
            autocomplete="new-password"
            minlength="8"
            placeholder="至少 8 个字符"
            :aria-invalid="Boolean(fieldError.newPassword)"
            :aria-describedby="fieldError.newPassword ? 'new-password-error' : undefined"
            required
          />
          <small v-if="fieldError.newPassword" id="new-password-error" class="form-error">{{
            fieldError.newPassword
          }}</small>
        </div>
        <div class="field">
          <label for="confirm-password">确认新密码</label>
          <input
            id="confirm-password"
            v-model="form.confirm"
            type="password"
            autocomplete="new-password"
            placeholder="再次输入新密码"
            :aria-invalid="Boolean(fieldError.confirm)"
            :aria-describedby="fieldError.confirm ? 'confirm-password-error' : undefined"
            required
          />
          <small v-if="fieldError.confirm" id="confirm-password-error" class="form-error">{{
            fieldError.confirm
          }}</small>
        </div>
        <p v-if="success" class="form-success" role="status" aria-live="polite">{{ success }}</p>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <button class="button button-primary" type="submit" :disabled="busy">
          <KeyRound :size="17" aria-hidden="true" />{{ busy ? '重置中…' : '重置密码' }}
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
          <button class="text-button" type="button" :disabled="busy" @click="backToEmail">
            <ArrowLeft :size="15" aria-hidden="true" />返回修改邮箱
          </button>
        </div>
      </form>
      <RouterLink to="/login" class="auth-link">返回登录</RouterLink>
    </section>
  </section>
</template>
