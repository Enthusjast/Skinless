<template>
  <section class="hero">
    <p class="eyebrow">CLOUDFLARE · YGGDRASIL</p>
    <h1>让你的角色，<em>真正属于你。</em></h1>
    <p class="hero-copy">Skinless 是一个轻量的 Minecraft 外置登录与皮肤服务。注册一个账号，把自己的皮肤带进每一场冒险。</p>
    <div class="hero-actions">
      <RouterLink to="/register" class="button button-primary">创建账号</RouterLink>
      <RouterLink to="/login" class="button button-ghost">已有账号，登录</RouterLink>
    </div>
  </section>
  <section class="feature-grid" aria-label="服务特点">
    <article class="feature-card"><span class="feature-index">01</span><h2>轻量快速</h2><p>运行在 Cloudflare 全球边缘，启动器登录和纹理请求都保持低延迟。</p></article>
    <article class="feature-card"><span class="feature-index">02</span><h2>你的纹理</h2><p>图片存储在私有对象存储中，只有游戏纹理请求会拿到必要的 PNG。</p></article>
    <article class="feature-card"><span class="feature-index">03</span><h2>外置登录</h2><p>兼容 Authlib Injector、HMCL、PCL2 等常见外置登录客户端。</p></article>
  </section>
</template>
