<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue';
import { ArrowLeft, Check, Eye, EyeOff, MailCheck, RefreshCw, UserPlus } from 'lucide-vue-next';
import { useRouter } from 'vue-router';
import { ApiError, formatApiError } from '../api';
import { useAuthStore } from '../stores/auth';

type RegistrationStep = 'details' | 'verify';

const auth = useAuthStore();
const router = useRouter();
const form = reactive({ name: '', email: '', password: '', confirm: '', inviteCode: '' });
const step = ref<RegistrationStep>('details');
const challengeId = ref('');
const code = ref('');
const error = ref('');
const success = ref('');
const fieldError = reactive({
  email: '',
  password: '',
  confirm: '',
  name: '',
  inviteCode: '',
  code: '',
});
const busy = ref(false);
const resendBusy = ref(false);
const expiresAt = ref(0);
const resendAt = ref(0);
const clock = ref(Date.now());
const showPassword = ref(false);
const showConfirm = ref(false);
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
      password_too_short: '密码至少需要 8 个字符。',
      password_too_long: '密码不能超过 256 个字符。',
      invalid_profile_name: '游戏名必须为 3–16 位字母、数字或下划线。',
      invite_required: '请输入有效的邀请码。',
      invalid_invite: '邀请码无效、已过期或已用完。',
      invalid_verification_code: '验证码无效或已过期。',
      verification_attempts_exhausted: '验证码尝试次数已用完，请重新发送。',
      resend_cooldown: '请稍候再重新发送验证码。',
      registration_closed: '当前暂不开放注册。',
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
    else if (cause.code === 'password_too_short' || cause.code === 'password_too_long')
      fieldError.password = message;
    else if (cause.code === 'invalid_profile_name') fieldError.name = message;
    else if (cause.code === 'invite_required' || cause.code === 'invalid_invite')
      fieldError.inviteCode = message;
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
  if (form.password !== form.confirm) {
    fieldError.confirm = '两次输入的密码不一致。';
    return;
  }
  busy.value = true;
  try {
    const response = await auth.registerStart(
      form.email,
      form.password,
      form.name,
      form.inviteCode,
    );
    challengeId.value = response.challengeId;
    expiresAt.value = response.expiresAt;
    resendAt.value = response.resendAfter;
    step.value = 'verify';
    success.value = '验证码已发送到你的邮箱，请在 10 分钟内完成验证。';
    await nextTick();
    codeInput.value?.focus();
  } catch (cause) {
    setFieldError(cause, '注册请求失败，请稍后重试。');
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
    await auth.registerVerify(challengeId.value, code.value);
    success.value = '邮箱验证成功，账号已创建，正在前往登录…';
    await router.push({ path: '/login', query: { registered: '1' } });
  } catch (cause) {
    setFieldError(cause, '验证码验证失败，请稍后重试。');
  } finally {
    busy.value = false;
  }
}

async function resendCode() {
  if (!challengeId.value || resendBusy.value || resendRemaining.value > 0) return;
  clearFeedback();
  resendBusy.value = true;
  try {
    const response = await auth.registerResend(challengeId.value);
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
  <section class="auth-layout">
    <div class="auth-intro">
      <p class="eyebrow">START HERE</p>
      <h1>创建 Minecraft 账号</h1>
      <p>验证邮箱后即可设置游戏名、上传皮肤和披风。</p>
      <div class="auth-checklist">
        <span><Check :size="17" aria-hidden="true" />一个账号，最多五个 Minecraft profile</span
        ><span><Check :size="17" aria-hidden="true" />浏览器处理图片，上传更轻量</span
        ><span><Check :size="17" aria-hidden="true" />随时切换 Classic / Slim 模型</span>
      </div>
      <div class="auth-visual" aria-hidden="true"><span v-for="index in 24" :key="index" /></div>
    </div>
    <section class="auth-card">
      <p class="eyebrow">{{ step === 'details' ? 'CREATE ACCOUNT' : 'VERIFY EMAIL' }}</p>
      <h2>{{ step === 'details' ? '创建账号' : '验证邮箱' }}</h2>
      <p v-if="step === 'details'">填写资料，我们会向你的邮箱发送一次性验证码。</p>
      <p v-else>验证码已发送至 {{ form.email }}，完成验证后才会创建账号。</p>

      <form v-if="step === 'details'" @submit.prevent="submitDetails">
        <div class="field">
          <label for="name">游戏名</label>
          <input
            id="name"
            v-model="form.name"
            type="text"
            autocomplete="nickname"
            minlength="3"
            maxlength="16"
            placeholder="Steve_01"
            :aria-invalid="Boolean(fieldError.name)"
            :aria-describedby="fieldError.name ? 'name-error' : 'name-help'"
            required
          />
          <small id="name-help">3–16 位字母、数字或下划线</small>
          <small v-if="fieldError.name" id="name-error" class="form-error">{{
            fieldError.name
          }}</small>
        </div>
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
        <div class="field">
          <label for="invite-code">邀请码（如有）</label>
          <input
            id="invite-code"
            v-model="form.inviteCode"
            type="text"
            autocomplete="off"
            placeholder="仅限邀请模式需要"
            :aria-invalid="Boolean(fieldError.inviteCode)"
            :aria-describedby="fieldError.inviteCode ? 'invite-code-error' : undefined"
          />
          <small v-if="fieldError.inviteCode" id="invite-code-error" class="form-error">{{
            fieldError.inviteCode
          }}</small>
        </div>
        <div class="field">
          <label for="password">密码</label>
          <div class="password-field">
            <input
              id="password"
              v-model="form.password"
              :type="showPassword ? 'text' : 'password'"
              autocomplete="new-password"
              minlength="8"
              placeholder="至少 8 个字符"
              :aria-invalid="Boolean(fieldError.password)"
              :aria-describedby="fieldError.password ? 'password-error' : undefined"
              required
            /><button
              class="icon-button password-toggle"
              type="button"
              :aria-label="showPassword ? '隐藏密码' : '显示密码'"
              @click="showPassword = !showPassword"
            >
              <EyeOff v-if="showPassword" :size="17" aria-hidden="true" /><Eye
                v-else
                :size="17"
                aria-hidden="true"
              />
            </button>
          </div>
          <small v-if="fieldError.password" id="password-error" class="form-error">{{
            fieldError.password
          }}</small>
        </div>
        <div class="field">
          <label for="confirm-password">确认密码</label>
          <div class="password-field">
            <input
              id="confirm-password"
              v-model="form.confirm"
              :type="showConfirm ? 'text' : 'password'"
              autocomplete="new-password"
              placeholder="再次输入密码"
              :aria-invalid="Boolean(fieldError.confirm)"
              :aria-describedby="fieldError.confirm ? 'confirm-error' : undefined"
              required
            /><button
              class="icon-button password-toggle"
              type="button"
              :aria-label="showConfirm ? '隐藏确认密码' : '显示确认密码'"
              @click="showConfirm = !showConfirm"
            >
              <EyeOff v-if="showConfirm" :size="17" aria-hidden="true" /><Eye
                v-else
                :size="17"
                aria-hidden="true"
              />
            </button>
          </div>
          <small v-if="fieldError.confirm" id="confirm-error" class="form-error">{{
            fieldError.confirm
          }}</small>
        </div>
        <p v-if="success" class="form-success" role="status" aria-live="polite">{{ success }}</p>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <button class="button button-primary" type="submit" :disabled="busy">
          <MailCheck :size="17" aria-hidden="true" />{{ busy ? '发送中…' : '发送验证码' }}
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
        <p v-if="success" class="form-success" role="status" aria-live="polite">{{ success }}</p>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <button class="button button-primary" type="submit" :disabled="busy">
          <UserPlus :size="17" aria-hidden="true" />{{ busy ? '验证中…' : '验证并创建账号' }}
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
            <ArrowLeft :size="15" aria-hidden="true" />返回修改资料
          </button>
        </div>
      </form>
      <RouterLink to="/login" class="auth-link">已有账号？返回登录</RouterLink>
    </section>
  </section>
</template>
