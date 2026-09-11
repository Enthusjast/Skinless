<script setup lang="ts">
import { computed } from 'vue';
import { API_BASE_URL } from '../api';

const props = defineProps<{
  skinHash: string | null;
  model: 'classic' | 'slim';
}>();

const scale = 6;
const textureUrl = computed(() => props.skinHash ? `${API_BASE_URL}/textures/${props.skinHash}` : '');

function partStyle(x: number, y: number, width: number, height: number) {
  return {
    width: `${width * scale}px`,
    height: `${height * scale}px`,
    backgroundImage: `url(${textureUrl.value})`,
    backgroundSize: `${64 * scale}px ${64 * scale}px`,
    backgroundPosition: `-${x * scale}px -${y * scale}px`,
  };
}
</script>

<template>
  <div class="preview-card" role="img" :aria-label="skinHash ? `${model === 'slim' ? 'Slim' : 'Classic'} 皮肤预览` : '暂无皮肤预览'">
    <div class="preview-heading"><span>LIVE PREVIEW</span><small>{{ model === 'slim' ? 'ALEX / SLIM' : 'STEVE / CLASSIC' }}</small></div>
    <div v-if="skinHash" class="skin-stage" aria-label="皮肤 2D 预览">
      <div class="skin-row skin-head-row"><div class="texture-part skin-head" :style="partStyle(8, 8, 8, 8)" /></div>
      <div class="skin-row skin-body-row">
        <div class="texture-part skin-limb" :style="partStyle(44, 20, 4, 12)" />
        <div class="texture-part skin-body" :style="partStyle(20, 20, 8, 12)" />
        <div class="texture-part skin-limb" :style="partStyle(36, 52, 4, 12)" />
      </div>
      <div class="skin-row skin-legs-row">
        <div class="texture-part skin-leg" :style="partStyle(4, 20, 4, 12)" />
        <div class="texture-part skin-leg" :style="partStyle(20, 52, 4, 12)" />
      </div>
    </div>
    <div v-else class="preview-empty"><span class="empty-cube">+</span><p>上传皮肤后<br />在这里查看预览</p></div>
  </div>
</template>
