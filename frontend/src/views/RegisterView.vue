<script setup lang="ts">
import { reactive, ref } from 'vue';
import { Check, Eye, EyeOff, UserPlus } from 'lucide-vue-next';
import { useRouter } from 'vue-router';
import { formatApiError } from '../api';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const router = useRouter();
const form = reactive({ name: '', email: '', password: '', confirm: '' });
const error = ref('');
const success = ref('');
const busy = ref(false);
const showPassword = ref(false);
const showConfirm = ref(false);

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
    error.value = formatApiError(cause, '注册失败，请稍后重试。');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="auth-layout">
    <div class="auth-intro">
      <p class="eyebrow">START HERE</p>
      <h1>创建 Minecraft 账号</h1>
      <p>创建账号后可设置游戏名、上传皮肤和披风。</p>
      <div class="auth-checklist">
        <span><Check :size="17" aria-hidden="true" />一个账号，一个 Minecraft profile</span
        ><span><Check :size="17" aria-hidden="true" />浏览器处理图片，上传更轻量</span
        ><span><Check :size="17" aria-hidden="true" />随时切换 Classic / Slim 模型</span>
      </div>
      <div class="auth-visual" aria-hidden="true"><span v-for="index in 24" :key="index" /></div>
    </div>
    <section class="auth-card">
      <p class="eyebrow">CREATE ACCOUNT</p>
      <h2>创建账号</h2>
      <p>只需要一个邮箱和你喜欢的游戏名。</p>
      <form @submit.prevent="submit">
        <div class="field">
          <label for="name">游戏名</label
          ><input
            id="name"
            v-model="form.name"
            type="text"
            autocomplete="nickname"
            minlength="3"
            maxlength="16"
            placeholder="Steve_01"
            required
          /><small>3–16 位字母、数字或下划线</small>
        </div>
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
              autocomplete="new-password"
              minlength="8"
              placeholder="至少 8 个字符"
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
        <div class="field">
          <label for="confirm-password">确认密码</label>
          <div class="password-field">
            <input
              id="confirm-password"
              v-model="form.confirm"
              :type="showConfirm ? 'text' : 'password'"
              autocomplete="new-password"
              placeholder="再次输入密码"
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
        </div>
        <p v-if="success" class="form-success" role="status">{{ success }}</p>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <button class="button button-primary" type="submit" :disabled="busy">
          <UserPlus :size="17" aria-hidden="true" />{{ busy ? '创建中…' : '创建账号' }}
        </button>
      </form>
      <RouterLink to="/login" class="auth-link">已有账号？返回登录</RouterLink>
    </section>
  </section>
</template>
