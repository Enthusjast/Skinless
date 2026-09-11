<script setup lang="ts">
import { ArrowRight, Gamepad2, LockKeyhole, Zap } from 'lucide-vue-next';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
</script>

<template>
  <section class="hero">
    <p class="eyebrow">CLOUDFLARE · YGGDRASIL · 0.1</p>
    <h1>Minecraft 外置登录与皮肤管理</h1>
    <p class="hero-copy">在一个地方管理 Minecraft 登录身份、皮肤和披风。</p>
    <div class="hero-actions">
      <RouterLink :to="auth.isAuthenticated ? '/dashboard' : '/register'" class="button button-primary">{{ auth.isAuthenticated ? '打开工作台' : '创建账号' }}<ArrowRight :size="17" aria-hidden="true" /></RouterLink>
      <RouterLink v-if="!auth.isAuthenticated" to="/login" class="button button-ghost">已有账号，登录</RouterLink>
    </div>
    <div class="hero-meta" aria-label="服务特性摘要"><span><i class="status-dot" />全球边缘运行</span><span><i class="status-dot" />私有纹理存储</span><span><i class="status-dot" />兼容 Authlib Injector</span></div>
  </section>
  <section class="feature-grid" aria-label="服务特点">
    <article class="feature-card"><span class="feature-icon"><Zap :size="20" aria-hidden="true" /></span><span class="feature-index">01 / FAST</span><h2>轻量快速</h2><p>运行在 Cloudflare 全球边缘，启动器登录和纹理请求都保持低延迟。</p></article>
    <article class="feature-card"><span class="feature-icon"><LockKeyhole :size="20" aria-hidden="true" /></span><span class="feature-index">02 / PRIVATE</span><h2>你的纹理</h2><p>图片存储在私有对象存储中，只有游戏纹理请求会拿到必要的 PNG。</p></article>
    <article class="feature-card"><span class="feature-icon"><Gamepad2 :size="20" aria-hidden="true" /></span><span class="feature-index">03 / READY</span><h2>外置登录</h2><p>兼容 Authlib Injector、HMCL、PCL2 等常见外置登录客户端。</p></article>
  </section>
</template>
