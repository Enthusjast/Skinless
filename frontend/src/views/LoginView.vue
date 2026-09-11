<template>
  <section class="auth-card">
    <p class="eyebrow">WELCOME BACK</p>
    <h1>登录</h1>
    <p>使用你的 Skinless 账号连接 Minecraft。</p>
    <form @submit.prevent>
      <div class="field"><label for="email">邮箱</label><input id="email" type="email" autocomplete="email" required /></div>
      <div class="field"><label for="password">密码</label><input id="password" type="password" autocomplete="current-password" required /></div>
      <button class="button button-primary" type="submit">登录</button>
    </form>
    <RouterLink to="/register" class="auth-link">还没有账号？立即注册</RouterLink>
  </section>
</template>
