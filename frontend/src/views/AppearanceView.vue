<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useAuthStore } from '../stores/auth';
import UiCard from '../components/common/UiCard.vue';
import ProfileManagement from '../components/ProfileManagement.vue';
import SkinPreview from '../components/SkinPreview.vue';
import SkinUploader from '../components/SkinUploader.vue';

const auth = useAuthStore();
const profile = computed(() => auth.profile);
const selectedModel = ref<'classic' | 'slim'>(auth.profile?.skinModel ?? 'classic');
const temporarySkinPreview = ref<string | null>(null);
const temporaryCapePreview = ref<string | null>(null);

watch(
  () => profile.value?.id,
  () => {
    selectedModel.value = profile.value?.skinModel ?? 'classic';
    temporarySkinPreview.value = null;
    temporaryCapePreview.value = null;
  },
);

function setAssetPreview(asset: 'skin' | 'cape', url: string | null) {
  if (asset === 'skin') temporarySkinPreview.value = url;
  else temporaryCapePreview.value = url;
}

function clearAssetPreview(asset: 'skin' | 'cape') {
  setAssetPreview(asset, null);
}
</script>

<template>
  <ProfileManagement />
  <div class="appearance-grid">
    <div class="appearance-main">
      <UiCard as="section" class="panel model-panel">
        <div class="workspace-section-heading">
          <div>
            <p class="eyebrow">01 / MODEL</p>
            <h2>模型选择</h2>
          </div>
          <span class="section-caption">上传皮肤前选择对应模型</span>
        </div>
        <div class="model-choice">
          <label :class="{ selected: selectedModel === 'classic' }">
            <input v-model="selectedModel" value="classic" type="radio" name="model" />
            <span><strong>Classic</strong><small>Steve · 粗手臂</small></span>
          </label>
          <label :class="{ selected: selectedModel === 'slim' }">
            <input v-model="selectedModel" value="slim" type="radio" name="model" />
            <span><strong>Slim</strong><small>Alex · 细手臂</small></span>
          </label>
        </div>
        <p class="model-note">模型选择会在下一次皮肤上传时保存。</p>
      </UiCard>
      <SkinUploader
        v-if="profile"
        asset="skin"
        :current-hash="profile.skinHash"
        :model="selectedModel"
        @preview="setAssetPreview('skin', $event)"
        @updated="clearAssetPreview('skin')"
      />
      <SkinUploader
        v-if="profile"
        asset="cape"
        :current-hash="profile.capeHash"
        :model="selectedModel"
        @preview="setAssetPreview('cape', $event)"
        @updated="clearAssetPreview('cape')"
      />
    </div>
    <aside class="appearance-side">
      <SkinPreview
        v-if="profile"
        :skin-hash="profile.skinHash"
        :cape-hash="profile.capeHash"
        :skin-preview-url="temporarySkinPreview"
        :cape-preview-url="temporaryCapePreview"
        :model="selectedModel"
      />
    </aside>
  </div>
</template>
