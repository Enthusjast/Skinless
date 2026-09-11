<script setup lang="ts">
import { ref } from 'vue';
import { ApiError } from '../api';
import { useAuthStore } from '../stores/auth';

const props = defineProps<{
  asset: 'skin' | 'cape';
  currentHash: string | null;
  model: 'classic' | 'slim';
}>();

const emit = defineEmits<{ updated: [hash: string | null] }>();
const auth = useAuthStore();
const fileInput = ref<HTMLInputElement | null>(null);
const selectedFile = ref<File | null>(null);
const busy = ref(false);
const error = ref('');
const success = ref('');

function chooseFile() {
  fileInput.value?.click();
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  selectedFile.value = input.files?.[0] ?? null;
  error.value = '';
  success.value = '';
}

function resizeTexture(file: File): Promise<Blob> {
  const targetWidth = props.asset === 'skin' ? 64 : 64;
  const targetHeight = props.asset === 'skin' ? 64 : 32;
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const context = canvas.getContext('2d');
      if (!context) {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('浏览器不支持 Canvas。'));
        return;
      }
      context.imageSmoothingEnabled = false;
      context.clearRect(0, 0, targetWidth, targetHeight);
      context.drawImage(image, 0, 0, targetWidth, targetHeight);
      URL.revokeObjectURL(objectUrl);
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('无法生成 PNG。')), 'image/png');
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('无法读取图片文件。'));
    };
    image.src = objectUrl;
  });
}

async function upload() {
  if (!selectedFile.value) return;
  busy.value = true;
  error.value = '';
  success.value = '';
  try {
    const normalized = await resizeTexture(selectedFile.value);
    const result = await auth.upload(props.asset, normalized, props.model);
    emit('updated', result.hash);
    selectedFile.value = null;
    if (fileInput.value) fileInput.value.value = '';
    success.value = '已上传并保存。';
  } catch (cause) {
    error.value = cause instanceof ApiError || cause instanceof Error ? cause.message : '上传失败，请稍后重试。';
  } finally {
    busy.value = false;
  }
}

async function remove() {
  busy.value = true;
  error.value = '';
  success.value = '';
  try {
    await auth.removeAsset(props.asset);
    emit('updated', null);
    success.value = '已移除。';
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '移除失败，请稍后重试。';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <article class="upload-card">
    <div class="upload-card-header">
      <div><p class="eyebrow">{{ asset === 'skin' ? 'CHARACTER TEXTURE' : 'OPTIONAL ACCESSORY' }}</p><h3>{{ asset === 'skin' ? '皮肤' : '披风' }}</h3></div>
      <span class="upload-status" :class="{ 'is-ready': currentHash }">{{ currentHash ? '已设置' : '未设置' }}</span>
    </div>
    <p class="upload-help">{{ asset === 'skin' ? '支持任意图片，浏览器会处理为 64 × 64 PNG。' : '支持任意图片，浏览器会处理为 64 × 32 PNG。' }}</p>
    <input ref="fileInput" class="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp" @change="onFileChange" />
    <div class="upload-actions">
      <button class="button button-ghost button-small" type="button" :disabled="busy" @click="chooseFile">{{ selectedFile ? '重新选择' : '选择图片' }}</button>
      <button v-if="selectedFile" class="button button-primary button-small" type="button" :disabled="busy" @click="upload">{{ busy ? '处理中…' : '上传' }}</button>
      <button v-if="currentHash" class="text-button danger" type="button" :disabled="busy" @click="remove">移除</button>
    </div>
    <p v-if="selectedFile" class="file-name">{{ selectedFile.name }}</p>
    <p v-if="success" class="form-success" role="status">{{ success }}</p>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
  </article>
</template>
