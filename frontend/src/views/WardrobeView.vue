<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  Pencil,
  Save,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-vue-next';
import {
  applyWardrobeTexture,
  deleteWardrobeTexture,
  formatApiError,
  getWardrobe,
  renameWardrobeTexture,
  uploadWardrobeTexture,
  type WardrobeTexture,
  type WardrobeTextureType,
} from '../api';
import { useAuthStore } from '../stores/auth';

type Filter = 'all' | WardrobeTextureType;

const PAGE_SIZE = 20;
const auth = useAuthStore();
const textures = ref<WardrobeTexture[]>([]);
const filter = ref<Filter>('all');
const offset = ref(0);
const total = ref(0);
const hasMore = ref(false);
const quota = ref({ used: 0, limit: 50 });
const loading = ref(true);
const error = ref('');
const busyId = ref<string | null>(null);
const editingId = ref<string | null>(null);
const editingName = ref('');
const targetProfileId = ref(auth.defaultProfileId ?? auth.profile?.id ?? '');
const uploadType = ref<WardrobeTextureType>('skin');
const uploadModel = ref<'classic' | 'slim'>(auth.profile?.skinModel ?? 'classic');
const uploadName = ref('');
const uploadFile = ref<File | null>(null);
const uploadBusy = ref(false);
const uploadError = ref('');
const uploadSuccess = ref('');

const profiles = computed(() => auth.availableProfiles);
const selectedProfile = computed(
  () =>
    profiles.value.find((profile) => profile.id === targetProfileId.value) ??
    profiles.value[0] ??
    null,
);
const pageNumber = computed(() => Math.floor(offset.value / PAGE_SIZE) + 1);
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));

function selectedType(): WardrobeTextureType | undefined {
  return filter.value === 'all' ? undefined : filter.value;
}

async function loadWardrobe() {
  loading.value = true;
  error.value = '';
  try {
    const response = await getWardrobe({
      type: selectedType(),
      limit: PAGE_SIZE,
      offset: offset.value,
    });
    textures.value = response.textures;
    total.value = response.total;
    hasMore.value = response.hasMore;
    quota.value = response.quota;
  } catch (cause) {
    error.value = formatApiError(cause, '加载纹理衣柜失败。');
  } finally {
    loading.value = false;
  }
}

function changeFilter(value: Filter) {
  filter.value = value;
}

function previousPage() {
  if (offset.value === 0 || loading.value) return;
  offset.value = Math.max(0, offset.value - PAGE_SIZE);
  void loadWardrobe();
}

function nextPage() {
  if (!hasMore.value || loading.value) return;
  offset.value += PAGE_SIZE;
  void loadWardrobe();
}

function startRename(texture: WardrobeTexture) {
  editingId.value = texture.id;
  editingName.value = texture.name;
  error.value = '';
}

function cancelRename() {
  editingId.value = null;
  editingName.value = '';
}

async function saveRename(texture: WardrobeTexture) {
  const name = editingName.value.trim();
  if (!name || busyId.value) return;
  busyId.value = texture.id;
  error.value = '';
  try {
    const response = await renameWardrobeTexture(texture.id, name);
    const index = textures.value.findIndex((candidate) => candidate.id === texture.id);
    if (index >= 0) textures.value[index] = response.texture;
    cancelRename();
  } catch (cause) {
    error.value = formatApiError(cause, '重命名纹理失败。');
  } finally {
    busyId.value = null;
  }
}

function updateProfile(profile: typeof selectedProfile.value) {
  if (!profile) return;
  const index = auth.profiles.findIndex((candidate) => candidate.id === profile.id);
  if (index >= 0) auth.profiles[index] = profile;
  if (auth.user?.profile.id === profile.id) auth.user.profile = profile;
}

async function applyTexture(texture: WardrobeTexture) {
  const profile = selectedProfile.value;
  if (!profile || busyId.value) return;
  busyId.value = texture.id;
  error.value = '';
  try {
    const response = await applyWardrobeTexture(texture.id, profile.id);
    updateProfile(response.profile);
  } catch (cause) {
    error.value = formatApiError(cause, '应用纹理失败。');
  } finally {
    busyId.value = null;
  }
}

async function removeTexture(texture: WardrobeTexture) {
  if (busyId.value) return;
  busyId.value = texture.id;
  error.value = '';
  try {
    await deleteWardrobeTexture(texture.id);
    const nextTotal = Math.max(0, total.value - 1);
    const nextOffset = nextTotal > 0 ? Math.floor((nextTotal - 1) / PAGE_SIZE) * PAGE_SIZE : 0;
    offset.value = Math.min(offset.value, nextOffset);
    await loadWardrobe();
  } catch (cause) {
    error.value = formatApiError(cause, '删除纹理失败。');
  } finally {
    busyId.value = null;
  }
}

function onUploadFile(event: Event) {
  uploadFile.value = (event.target as HTMLInputElement).files?.[0] ?? null;
  uploadError.value = '';
  uploadSuccess.value = '';
}

async function uploadTexture() {
  if (!uploadFile.value || !uploadName.value.trim() || uploadBusy.value) return;
  uploadBusy.value = true;
  uploadError.value = '';
  uploadSuccess.value = '';
  try {
    const response = await uploadWardrobeTexture(
      uploadType.value,
      uploadFile.value,
      uploadName.value.trim(),
      uploadModel.value,
    );
    quota.value = response.quota;
    uploadName.value = '';
    uploadFile.value = null;
    uploadSuccess.value = response.reused ? '已使用已有纹理。' : '已保存到纹理衣柜。';
    await loadWardrobe();
  } catch (cause) {
    uploadError.value = formatApiError(cause, '上传纹理失败。');
  } finally {
    uploadBusy.value = false;
  }
}

watch(filter, () => {
  offset.value = 0;
  void loadWardrobe();
});

watch(
  () => auth.defaultProfileId,
  (value) => {
    if (value) targetProfileId.value = value;
  },
);

watch(uploadType, (value) => {
  if (value === 'skin') uploadModel.value = selectedProfile.value?.skinModel ?? 'classic';
});

onMounted(() => void loadWardrobe());
</script>

<template>
  <section class="wardrobe-toolbar panel" aria-labelledby="wardrobe-toolbar-title">
    <div class="wardrobe-toolbar-heading">
      <div>
        <p class="eyebrow">PRIVATE COLLECTION</p>
        <h2 id="wardrobe-toolbar-title">纹理衣柜</h2>
      </div>
      <span class="wardrobe-quota" aria-label="纹理配额">{{ quota.used }} / {{ quota.limit }}</span>
    </div>
    <div class="wardrobe-toolbar-controls">
      <div class="field">
        <label for="texture-filter">类型</label>
        <select
          id="texture-filter"
          name="texture-filter"
          :value="filter"
          @change="changeFilter(($event.target as HTMLSelectElement).value as Filter)"
        >
          <option value="all">全部纹理</option>
          <option value="skin">皮肤</option>
          <option value="cape">披风</option>
        </select>
      </div>
      <div class="field">
        <label for="target-profile">应用到 Profile</label>
        <select id="target-profile" v-model="targetProfileId" name="target-profile">
          <option v-for="profile in profiles" :key="profile.id" :value="profile.id">
            {{ profile.name }} · {{ profile.skinModel === 'slim' ? 'Slim' : 'Classic' }}
          </option>
        </select>
      </div>
    </div>
  </section>

  <section class="wardrobe-upload panel" aria-labelledby="wardrobe-upload-title">
    <div class="workspace-section-heading">
      <div>
        <p class="eyebrow">SAVE TEXTURE</p>
        <h2 id="wardrobe-upload-title">添加到衣柜</h2>
      </div>
      <ImagePlus :size="20" class="section-icon" aria-hidden="true" />
    </div>
    <div class="wardrobe-upload-fields">
      <div class="field">
        <label for="upload-texture-type">类型</label>
        <select id="upload-texture-type" v-model="uploadType">
          <option value="skin">皮肤</option>
          <option value="cape">披风</option>
        </select>
      </div>
      <div class="field">
        <label for="upload-texture-name">名称</label>
        <input
          id="upload-texture-name"
          v-model="uploadName"
          maxlength="64"
          placeholder="例如：冒险服"
        />
      </div>
      <div v-if="uploadType === 'skin'" class="field">
        <label for="upload-texture-model">模型</label>
        <select id="upload-texture-model" v-model="uploadModel">
          <option value="classic">Classic</option>
          <option value="slim">Slim</option>
        </select>
      </div>
      <label class="wardrobe-file-picker">
        <span
          ><UploadCloud :size="17" aria-hidden="true" />{{ uploadFile?.name ?? '选择 PNG' }}</span
        >
        <input type="file" accept="image/png" @change="onUploadFile" />
      </label>
      <button
        class="button button-primary button-small"
        type="button"
        data-action="upload-texture"
        :disabled="uploadBusy || !uploadFile || !uploadName.trim()"
        @click="uploadTexture"
      >
        {{ uploadBusy ? '保存中…' : '保存纹理' }}
      </button>
    </div>
    <p v-if="uploadSuccess" class="form-success" role="status">{{ uploadSuccess }}</p>
    <p v-if="uploadError" class="form-error" role="alert">{{ uploadError }}</p>
  </section>

  <section class="wardrobe-list" aria-live="polite">
    <div v-if="loading" class="panel wardrobe-state" data-state="loading">加载纹理衣柜…</div>
    <div v-else-if="error" class="panel wardrobe-state wardrobe-error-state">
      <p class="form-error" role="alert">{{ error }}</p>
      <button
        class="button button-ghost button-small"
        type="button"
        data-action="retry-wardrobe"
        @click="loadWardrobe"
      >
        重试
      </button>
    </div>
    <div v-else-if="textures.length === 0" class="panel wardrobe-state" data-state="empty">
      <span class="empty-cube" aria-hidden="true">◆</span>
      <p>还没有保存的纹理。上传一张 PNG，它会留在你的私人衣柜里。</p>
    </div>
    <div v-else class="wardrobe-grid">
      <article
        v-for="texture in textures"
        :key="texture.id"
        class="wardrobe-card panel"
        :data-texture-id="texture.id"
      >
        <div class="wardrobe-card-preview">
          <img :src="texture.previewUrl" :alt="`${texture.name} 预览`" />
          <span class="wardrobe-type-badge">{{ texture.type === 'skin' ? '皮肤' : '披风' }}</span>
        </div>
        <div class="wardrobe-card-body">
          <form
            v-if="editingId === texture.id"
            class="wardrobe-name-form"
            @submit.prevent="saveRename(texture)"
          >
            <label class="visually-hidden" :for="`texture-name-${texture.id}`">纹理名称</label>
            <input
              :id="`texture-name-${texture.id}`"
              v-model="editingName"
              name="texture-name"
              maxlength="64"
              required
            />
            <button
              class="icon-button"
              type="button"
              data-action="save-texture"
              :disabled="busyId === texture.id"
              aria-label="保存名称"
              @click="saveRename(texture)"
            >
              <Save :size="16" aria-hidden="true" />
            </button>
            <button
              class="icon-button"
              type="button"
              :disabled="busyId === texture.id"
              aria-label="取消重命名"
              @click="cancelRename"
            >
              <X :size="16" aria-hidden="true" />
            </button>
          </form>
          <div v-else class="wardrobe-card-heading">
            <div>
              <h3>{{ texture.name }}</h3>
              <p>
                <template v-if="texture.width !== null && texture.height !== null">
                  {{ texture.width }} × {{ texture.height }}
                </template>
                <template v-else>尺寸未知</template>
                ·
                {{ texture.model ? texture.model : '通用' }}
              </p>
            </div>
            <button
              class="icon-button"
              type="button"
              data-action="edit-texture"
              aria-label="编辑名称"
              @click="startRename(texture)"
            >
              <Pencil :size="16" aria-hidden="true" />
            </button>
          </div>
          <div class="wardrobe-card-actions">
            <button
              class="button button-primary button-small"
              type="button"
              data-action="apply-texture"
              :disabled="busyId === texture.id || !selectedProfile"
              @click="applyTexture(texture)"
            >
              <Check :size="16" aria-hidden="true" />{{
                busyId === texture.id ? '处理中…' : '应用'
              }}
            </button>
            <button
              class="text-button danger"
              type="button"
              data-action="delete-texture"
              :disabled="busyId === texture.id"
              @click="removeTexture(texture)"
            >
              <Trash2 :size="15" aria-hidden="true" />删除
            </button>
          </div>
        </div>
      </article>
    </div>
  </section>

  <nav
    v-if="!loading && !error && total > PAGE_SIZE"
    class="wardrobe-pagination"
    aria-label="纹理衣柜分页"
  >
    <button
      class="button button-ghost button-small"
      type="button"
      data-action="previous-page"
      :disabled="offset === 0 || loading"
      @click="previousPage"
    >
      <ChevronLeft :size="16" aria-hidden="true" />上一页
    </button>
    <span>第 {{ pageNumber }} / {{ pageCount }} 页</span>
    <button
      class="button button-ghost button-small"
      type="button"
      data-action="next-page"
      :disabled="!hasMore || loading"
      @click="nextPage"
    >
      下一页<ChevronRight :size="16" aria-hidden="true" />
    </button>
  </nav>
</template>
