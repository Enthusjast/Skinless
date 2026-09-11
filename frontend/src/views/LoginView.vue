<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ApiError } from '../api';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();
const form = reactive({ email: '', password: '' });
const error = ref('');

async function submit() {
  error.value = '';
  try {
    await auth.login(form.email, form.password);
    const candidate = typeof route.query.redirect === 'string' ? route.query.redirect : '/dashboard';
    const redirect = candidate.startsWith('/') && !candidate.startsWith('//') ? candidate : '/dashboard';
    await router.push(redirect);
  } catch (cause) {
    error.value = cause instanceof ApiError || cause instanceof Error ? cause.message : '登录失败，请稍后重试。';
  }
}
</script>

<template>
  <section class="auth-card">
    <p class="eyebrow">WELCOME BACK</p>
    <h1>登录</h1>
    <p>使用你的 Skinless 账号连接 Minecraft。</p>
    <form @submit.prevent="submit">
      <div class="field"><label for="email">邮箱</label><input id="email" v-model="form.email" type="email" autocomplete="email" required /></div>
      <div class="field"><label for="password">密码</label><input id="password" v-model="form.password" type="password" autocomplete="current-password" required /></div>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <button class="button button-primary" type="submit" :disabled="auth.loading">{{ auth.loading ? '登录中…' : '登录' }}</button>
    </form>
    <RouterLink to="/register" class="auth-link">还没有账号？立即注册</RouterLink>
  </section>
</template>
