<script setup lang="ts">
import { computed } from 'vue';
import { API_BASE_URL } from '../api';

const props = defineProps<{
  skinHash: string | null;
  model: 'classic' | 'slim';
}>();

const scale = 6;
const textureSize = 64;
const textureUrl = computed(() =>
  props.skinHash ? `${API_BASE_URL}/textures/${props.skinHash}` : '',
);

function textureViewBox(x: number, y: number, width: number, height: number) {
  return `${x} ${y} ${width} ${height}`;
}
</script>

<template>
  <div
    class="preview-card"
    role="img"
    :aria-label="skinHash ? `${model === 'slim' ? 'Slim' : 'Classic'} 皮肤预览` : '暂无皮肤预览'"
  >
    <div class="preview-heading">
      <span>LIVE PREVIEW</span
      ><small>{{ model === 'slim' ? 'ALEX / SLIM' : 'STEVE / CLASSIC' }}</small>
    </div>
    <div v-if="skinHash" class="skin-stage" aria-label="皮肤 2D 预览">
      <div class="skin-row skin-head-row">
        <svg
          class="texture-part skin-head"
          :width="8 * scale"
          :height="8 * scale"
          :viewBox="textureViewBox(8, 8, 8, 8)"
          aria-hidden="true"
          focusable="false"
        >
          <image
            :href="textureUrl"
            :width="textureSize"
            :height="textureSize"
            preserveAspectRatio="none"
          />
        </svg>
      </div>
      <div class="skin-row skin-body-row">
        <svg
          class="texture-part skin-limb"
          :width="(model === 'slim' ? 3 : 4) * scale"
          :height="12 * scale"
          :viewBox="textureViewBox(44, 20, model === 'slim' ? 3 : 4, 12)"
          aria-hidden="true"
          focusable="false"
        >
          <image
            :href="textureUrl"
            :width="textureSize"
            :height="textureSize"
            preserveAspectRatio="none"
          />
        </svg>
        <svg
          class="texture-part skin-body"
          :width="8 * scale"
          :height="12 * scale"
          :viewBox="textureViewBox(20, 20, 8, 12)"
          aria-hidden="true"
          focusable="false"
        >
          <image
            :href="textureUrl"
            :width="textureSize"
            :height="textureSize"
            preserveAspectRatio="none"
          />
        </svg>
        <svg
          class="texture-part skin-limb"
          :width="(model === 'slim' ? 3 : 4) * scale"
          :height="12 * scale"
          :viewBox="textureViewBox(36, 52, model === 'slim' ? 3 : 4, 12)"
          aria-hidden="true"
          focusable="false"
        >
          <image
            :href="textureUrl"
            :width="textureSize"
            :height="textureSize"
            preserveAspectRatio="none"
          />
        </svg>
      </div>
      <div class="skin-row skin-legs-row">
        <svg
          class="texture-part skin-leg"
          :width="4 * scale"
          :height="12 * scale"
          :viewBox="textureViewBox(4, 20, 4, 12)"
          aria-hidden="true"
          focusable="false"
        >
          <image
            :href="textureUrl"
            :width="textureSize"
            :height="textureSize"
            preserveAspectRatio="none"
          />
        </svg>
        <svg
          class="texture-part skin-leg"
          :width="4 * scale"
          :height="12 * scale"
          :viewBox="textureViewBox(20, 52, 4, 12)"
          aria-hidden="true"
          focusable="false"
        >
          <image
            :href="textureUrl"
            :width="textureSize"
            :height="textureSize"
            preserveAspectRatio="none"
          />
        </svg>
      </div>
    </div>
    <div v-else class="preview-empty">
      <span class="empty-cube">+</span>
      <p>上传皮肤后<br />在这里查看预览</p>
    </div>
  </div>
</template>
