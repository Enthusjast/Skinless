<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import type { SkinViewer } from 'skinview3d';

const props = defineProps<{
  skinUrl: string;
  capeUrl?: string | null;
  model: 'classic' | 'slim';
}>();

const emit = defineEmits<{
  fallback: [message: string];
}>();

const canvas = ref<HTMLCanvasElement | null>(null);
const viewer = shallowRef<SkinViewer | null>(null);
const status = ref<'loading' | 'ready' | 'error'>('loading');
const errorMessage = ref('');
let requestId = 0;
let mounted = false;

const viewerLabel = () =>
  `${props.model === 'slim' ? 'Slim' : 'Classic'} 皮肤 3D 预览，拖动旋转，滚轮缩放`;

function disposeViewer() {
  viewer.value?.dispose();
  viewer.value = null;
}

async function loadViewer() {
  const currentRequest = ++requestId;
  status.value = 'loading';
  errorMessage.value = '';
  disposeViewer();

  try {
    const library = await import('skinview3d');
    if (currentRequest !== requestId || !mounted || !canvas.value) return;

    const instance = new library.SkinViewer({
      canvas: canvas.value,
      width: 360,
      height: 410,
      pixelRatio: 'match-device',
      enableControls: true,
    });
    instance.autoRotate = false;
    instance.controls.enablePan = false;
    instance.controls.enableRotate = true;
    instance.controls.enableZoom = true;
    instance.controls.enableDamping = !window.matchMedia?.('(prefers-reduced-motion: reduce)')
      .matches;
    viewer.value = instance;

    await instance.loadSkin(props.skinUrl, {
      model: props.model === 'slim' ? 'slim' : 'default',
    });
    if (props.capeUrl) await instance.loadCape(props.capeUrl);

    if (currentRequest !== requestId || !mounted) {
      instance.dispose();
      return;
    }
    status.value = 'ready';
  } catch (cause) {
    if (currentRequest !== requestId || !mounted) return;
    disposeViewer();
    status.value = 'error';
    errorMessage.value = cause instanceof Error ? cause.message : '3D 预览加载失败。';
    emit('fallback', '3D 预览暂不可用，已切换到 2D 预览。');
  }
}

function retry() {
  void loadViewer();
}

function resetCamera() {
  viewer.value?.resetCameraPose();
  viewer.value?.render();
}

function rotate(direction: -1 | 1) {
  if (!viewer.value) return;
  viewer.value.playerWrapper.rotation.y += direction * (Math.PI / 12);
  viewer.value.render();
}

function adjustZoom(direction: -1 | 1) {
  if (!viewer.value) return;
  viewer.value.zoom = Math.min(1.15, Math.max(0.55, viewer.value.zoom + direction * 0.08));
  viewer.value.render();
}

watch(
  () => [props.skinUrl, props.capeUrl, props.model],
  () => {
    if (mounted) void loadViewer();
  },
);

onMounted(() => {
  mounted = true;
  void loadViewer();
});

onBeforeUnmount(() => {
  mounted = false;
  requestId += 1;
  disposeViewer();
});
</script>

<template>
  <section class="skin-viewer-3d" aria-label="3D 预览区域">
    <canvas
      ref="canvas"
      v-show="status === 'ready'"
      class="skin-viewer-canvas"
      role="img"
      :aria-label="viewerLabel()"
      aria-describedby="skin-viewer-3d-help"
      tabindex="0"
      width="360"
      height="410"
    />
    <div v-if="status === 'loading'" class="skin-viewer-state" role="status" aria-live="polite">
      <span class="loading-indicator" aria-hidden="true" />
      <p>正在加载 3D 预览…</p>
    </div>
    <div v-else-if="status === 'error'" class="skin-viewer-state skin-viewer-error" role="alert">
      <p>3D 预览暂不可用。</p>
      <small v-if="errorMessage">可以继续使用 2D 预览。</small>
      <button class="button button-ghost button-small" type="button" @click="retry">
        重试 3D 预览
      </button>
    </div>
    <template v-else-if="status === 'ready'">
      <div class="skin-viewer-controls" role="group" aria-label="3D 预览控制">
        <button
          class="icon-button"
          type="button"
          aria-label="向左旋转"
          title="向左旋转"
          @click="rotate(-1)"
        >
          ←
        </button>
        <button
          class="icon-button"
          type="button"
          aria-label="缩小"
          title="缩小"
          @click="adjustZoom(-1)"
        >
          −
        </button>
        <button
          class="button button-ghost button-small"
          type="button"
          aria-label="重置 3D 预览视角"
          @click="resetCamera"
        >
          重置视角
        </button>
        <button
          class="icon-button"
          type="button"
          aria-label="放大"
          title="放大"
          @click="adjustZoom(1)"
        >
          +
        </button>
        <button
          class="icon-button"
          type="button"
          aria-label="向右旋转"
          title="向右旋转"
          @click="rotate(1)"
        >
          →
        </button>
      </div>
      <p id="skin-viewer-3d-help" class="skin-viewer-help">
        拖动模型旋转，滚轮缩放；也可以使用上方按钮。
      </p>
    </template>
  </section>
</template>
