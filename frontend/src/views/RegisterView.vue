<template>
  <section class="auth-card">
    <p class="eyebrow">START HERE</p>
    <h1>创建账号</h1>
    <p>创建一个游戏身份，把喜欢的皮肤带进服务器。</p>
    <form @submit.prevent>
      <div class="field"><label for="name">游戏名</label><input id="name" type="text" autocomplete="nickname" required /></div>
      <div class="field"><label for="email">邮箱</label><input id="email" type="email" autocomplete="email" required /></div>
      <div class="field"><label for="password">密码</label><input id="password" type="password" autocomplete="new-password" required /></div>
      <button class="button button-primary" type="submit">注册</button>
    </form>
    <RouterLink to="/login" class="auth-link">已有账号？返回登录</RouterLink>
  </section>
</template>
