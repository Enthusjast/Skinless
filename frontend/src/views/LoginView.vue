<script setup lang="ts">
import { reactive, ref } from 'vue';
import { Eye, EyeOff, LockKeyhole } from 'lucide-vue-next';
import { useRoute, useRouter } from 'vue-router';
import { formatApiError } from '../api';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();
const form = reactive({ email: '', password: '' });
const error = ref('');
const showPassword = ref(false);
const notice = ref(
  route.query.pending === '1'
    ? '删除申请已提交。请在 7 天内使用邮箱中的恢复验证码撤销删除。'
    : route.query.restored === '1'
      ? '账号已恢复，请重新登录。'
      : route.query.changed === '1'
        ? '密码已更新，请使用新密码登录。'
        : route.query.reset === '1'
          ? '密码已重置，现在可以使用新密码登录。'
          : route.query.registered === '1'
            ? '账号创建成功，现在可以登录了。'
            : '',
);

async function submit() {
  error.value = '';
  try {
    await auth.login(form.email, form.password);
    const candidate =
      typeof route.query.redirect === 'string' ? route.query.redirect : '/dashboard';
    const redirect =
      candidate.startsWith('/') && !candidate.startsWith('//') ? candidate : '/dashboard';
    await router.push(redirect);
  } catch (cause) {
    error.value = formatApiError(cause, '登录失败，请稍后重试。');
  }
}
</script>

<template>
  <section class="auth-layout">
    <div class="auth-intro">
      <p class="eyebrow">WELCOME BACK</p>
      <h1>登录 Minecraft 身份</h1>
      <p>登录后管理 Minecraft profile、皮肤和披风。</p>
    </div>
    <section class="auth-card">
      <p class="eyebrow">SIGN IN</p>
      <h2>登录账号</h2>
      <p>使用注册邮箱连接你的 Minecraft 身份。</p>
      <form @submit.prevent="submit">
        <div class="field">
          <label for="email">邮箱地址</label
          ><input
            id="email"
            v-model="form.email"
            type="email"
            autocomplete="email"
            placeholder="you@example.com"
            required
          />
        </div>
        <div class="field">
          <label for="password">密码</label>
          <div class="password-field">
            <input
              id="password"
              v-model="form.password"
              :type="showPassword ? 'text' : 'password'"
              autocomplete="current-password"
              placeholder="输入密码"
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
        </div>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <p v-if="notice" class="form-success" role="status">{{ notice }}</p>
        <button class="button button-primary" type="submit" :disabled="auth.loading">
          <LockKeyhole :size="17" aria-hidden="true" />{{ auth.loading ? '登录中…' : '登录' }}
        </button>
      </form>
      <div class="auth-links">
        <RouterLink to="/forgot-password" class="auth-link">忘记密码 ?</RouterLink>
        <RouterLink to="/register" class="auth-link">还没有账户 ? 立即注册</RouterLink>
      </div>
    </section>
  </section>
</template>
