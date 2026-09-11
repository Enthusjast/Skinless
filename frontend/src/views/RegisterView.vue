<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ApiError } from '../api';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const router = useRouter();
const form = reactive({ name: '', email: '', password: '', confirm: '' });
const error = ref('');
const success = ref('');
const busy = ref(false);

async function submit() {
  error.value = '';
  success.value = '';
  if (form.password !== form.confirm) {
    error.value = '两次输入的密码不一致。';
    return;
  }
  busy.value = true;
  try {
    await auth.register(form.email, form.password, form.name);
    success.value = '账号创建成功，正在前往登录…';
    await router.push({ path: '/login', query: { registered: '1' } });
  } catch (cause) {
    error.value = cause instanceof ApiError || cause instanceof Error ? cause.message : '注册失败，请稍后重试。';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="auth-card">
    <p class="eyebrow">START HERE</p>
    <h1>创建账号</h1>
    <p>创建一个游戏身份，把喜欢的皮肤带进服务器。</p>
    <form @submit.prevent="submit">
      <div class="field"><label for="name">游戏名</label><input id="name" v-model="form.name" type="text" autocomplete="nickname" minlength="3" maxlength="16" required /></div>
      <div class="field"><label for="email">邮箱</label><input id="email" v-model="form.email" type="email" autocomplete="email" required /></div>
      <div class="field"><label for="password">密码</label><input id="password" v-model="form.password" type="password" autocomplete="new-password" minlength="8" required /></div>
      <div class="field"><label for="confirm-password">确认密码</label><input id="confirm-password" v-model="form.confirm" type="password" autocomplete="new-password" minlength="8" required /></div>
      <p v-if="success" class="form-success" role="status">{{ success }}</p>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <button class="button button-primary" type="submit" :disabled="busy">{{ busy ? '创建中…' : '注册' }}</button>
    </form>
    <RouterLink to="/login" class="auth-link">已有账号？返回登录</RouterLink>
  </section>
</template>
