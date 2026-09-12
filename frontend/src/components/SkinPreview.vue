<script setup lang="ts">
import { computed } from 'vue';
import { API_BASE_URL } from '../api';

type TextureRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type TextureLayer = {
  name: 'base' | 'outer';
  x: number;
  y: number;
};

type TexturePart = {
  key: string;
  row: 'head' | 'body' | 'legs';
  className: string;
  base: TextureRect;
  layers: TextureLayer[];
};

const props = defineProps<{
  skinHash: string | null;
  capeHash?: string | null;
  model: 'classic' | 'slim';
  skinPreviewUrl?: string | null;
  capePreviewUrl?: string | null;
}>();

const scale = 6;
const textureSize = 64;
const capeDisplayWidth = 192;
const capeDisplayHeight = 96;

const skinUrl = computed(
  () =>
    props.skinPreviewUrl || (props.skinHash ? `${API_BASE_URL}/textures/${props.skinHash}` : ''),
);
const capeUrl = computed(
  () =>
    props.capePreviewUrl || (props.capeHash ? `${API_BASE_URL}/textures/${props.capeHash}` : ''),
);
const hasSkin = computed(() => Boolean(skinUrl.value));
const hasCape = computed(() => Boolean(capeUrl.value));
const hasUnsavedPreview = computed(() => Boolean(props.skinPreviewUrl || props.capePreviewUrl));
const modelLabel = computed(() => (props.model === 'slim' ? 'Slim' : 'Classic'));
const previewLabel = computed(() => {
  const capeLabel = hasCape.value ? '有披风' : '无披风';
  const emptyState = !hasSkin.value && !hasCape.value;
  const saveLabel = hasUnsavedPreview.value || emptyState ? '未保存' : '已保存';
  if (!hasSkin.value) return `暂无皮肤预览，模型 ${modelLabel.value}，${saveLabel}，${capeLabel}`;
  return `${modelLabel.value} 皮肤预览，${hasUnsavedPreview.value ? '未保存' : '已保存'}，${capeLabel}`;
});

function textureViewBox(rect: TextureRect): string {
  return `${rect.x} ${rect.y} ${rect.width} ${rect.height}`;
}

function texturePart(
  key: string,
  row: TexturePart['row'],
  className: string,
  base: TextureRect,
  outer: TextureRect,
): TexturePart {
  return {
    key,
    row,
    className,
    base,
    layers: [
      { name: 'base', x: 0, y: 0 },
      { name: 'outer', x: base.x - outer.x, y: base.y - outer.y },
    ],
  };
}

const textureParts = computed<TexturePart[]>(() => {
  const armWidth = props.model === 'slim' ? 3 : 4;
  return [
    texturePart(
      'head',
      'head',
      'skin-head',
      { x: 8, y: 8, width: 8, height: 8 },
      {
        x: 40,
        y: 8,
        width: 8,
        height: 8,
      },
    ),
    texturePart(
      'right-arm',
      'body',
      'skin-limb skin-right-arm',
      {
        x: 44,
        y: 20,
        width: armWidth,
        height: 12,
      },
      {
        x: 44,
        y: 36,
        width: armWidth,
        height: 12,
      },
    ),
    texturePart(
      'body',
      'body',
      'skin-body',
      { x: 20, y: 20, width: 8, height: 12 },
      {
        x: 20,
        y: 36,
        width: 8,
        height: 12,
      },
    ),
    texturePart(
      'left-arm',
      'body',
      'skin-limb skin-left-arm',
      {
        x: 36,
        y: 52,
        width: armWidth,
        height: 12,
      },
      {
        x: 52,
        y: 52,
        width: armWidth,
        height: 12,
      },
    ),
    texturePart(
      'right-leg',
      'legs',
      'skin-leg skin-right-leg',
      {
        x: 4,
        y: 20,
        width: 4,
        height: 12,
      },
      {
        x: 4,
        y: 36,
        width: 4,
        height: 12,
      },
    ),
    texturePart(
      'left-leg',
      'legs',
      'skin-leg skin-left-leg',
      {
        x: 20,
        y: 52,
        width: 4,
        height: 12,
      },
      {
        x: 4,
        y: 52,
        width: 4,
        height: 12,
      },
    ),
  ];
});

const headParts = computed(() => textureParts.value.filter((part) => part.row === 'head'));
const bodyParts = computed(() => textureParts.value.filter((part) => part.row === 'body'));
const legParts = computed(() => textureParts.value.filter((part) => part.row === 'legs'));
</script>

<template>
  <div class="preview-card" role="img" :aria-label="previewLabel">
    <div class="preview-heading">
      <span>LIVE PREVIEW</span
      ><small>{{ model === 'slim' ? 'ALEX / SLIM' : 'STEVE / CLASSIC' }}</small>
    </div>
    <div
      v-if="hasSkin || hasCape"
      class="skin-stage"
      :aria-label="hasSkin ? '皮肤 2D 预览' : '披风 2D 预览'"
    >
      <div v-if="hasSkin" class="skin-row skin-head-row">
        <svg
          v-for="part in headParts"
          :key="part.key"
          class="texture-part"
          :class="part.className"
          :data-part="part.key"
          :width="part.base.width * scale"
          :height="part.base.height * scale"
          :viewBox="textureViewBox(part.base)"
          aria-hidden="true"
          focusable="false"
          shape-rendering="crispEdges"
        >
          <image
            v-for="layer in part.layers"
            :key="layer.name"
            class="texture-layer"
            :class="`texture-layer-${layer.name}`"
            :data-layer="layer.name"
            :href="skinUrl"
            :x="layer.x"
            :y="layer.y"
            :width="textureSize"
            :height="textureSize"
            preserveAspectRatio="none"
          />
        </svg>
      </div>
      <div v-if="hasSkin" class="skin-row skin-body-row">
        <svg
          v-for="part in bodyParts"
          :key="part.key"
          class="texture-part"
          :class="part.className"
          :data-part="part.key"
          :width="part.base.width * scale"
          :height="part.base.height * scale"
          :viewBox="textureViewBox(part.base)"
          aria-hidden="true"
          focusable="false"
          shape-rendering="crispEdges"
        >
          <image
            v-for="layer in part.layers"
            :key="layer.name"
            class="texture-layer"
            :class="`texture-layer-${layer.name}`"
            :data-layer="layer.name"
            :href="skinUrl"
            :x="layer.x"
            :y="layer.y"
            :width="textureSize"
            :height="textureSize"
            preserveAspectRatio="none"
          />
        </svg>
      </div>
      <div v-if="hasSkin" class="skin-row skin-legs-row">
        <svg
          v-for="part in legParts"
          :key="part.key"
          class="texture-part"
          :class="part.className"
          :data-part="part.key"
          :width="part.base.width * scale"
          :height="part.base.height * scale"
          :viewBox="textureViewBox(part.base)"
          aria-hidden="true"
          focusable="false"
          shape-rendering="crispEdges"
        >
          <image
            v-for="layer in part.layers"
            :key="layer.name"
            class="texture-layer"
            :class="`texture-layer-${layer.name}`"
            :data-layer="layer.name"
            :href="skinUrl"
            :x="layer.x"
            :y="layer.y"
            :width="textureSize"
            :height="textureSize"
            preserveAspectRatio="none"
          />
        </svg>
      </div>
      <div v-if="hasCape" class="cape-preview" aria-label="披风预览">
        <svg
          class="cape-texture"
          :width="capeDisplayWidth"
          :height="capeDisplayHeight"
          viewBox="0 0 64 32"
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
          focusable="false"
          shape-rendering="crispEdges"
        >
          <image :href="capeUrl" width="64" height="32" preserveAspectRatio="xMidYMid meet" />
        </svg>
        <span>披风</span>
      </div>
    </div>
    <div v-else class="preview-empty">
      <span class="empty-cube">+</span>
      <p>上传皮肤后<br />在这里查看预览</p>
    </div>
  </div>
</template>
