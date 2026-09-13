<script setup lang="ts">
import { Check, Download, Pencil, Plus, Trash2, X } from 'lucide-vue-next';
import { computed, ref } from 'vue';
import { formatApiError } from '../api';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const profiles = computed(() => auth.availableProfiles);
const newName = ref('');
const editingId = ref<string | null>(null);
const editingName = ref('');
const busyId = ref<string | null>(null);
const formBusy = ref(false);
const error = ref('');
const success = ref('');
const importProfileId = ref<string | null>(null);
const importUsername = ref('');
const importingProfileId = ref<string | null>(null);
const newImportUsername = ref('');
const importingNewProfile = ref(false);

function startRename(profileId: string, name: string) {
  editingId.value = profileId;
  editingName.value = name;
  importProfileId.value = null;
  error.value = '';
}

function cancelRename() {
  editingId.value = null;
  editingName.value = '';
}

function startImport(profileId: string) {
  editingId.value = null;
  importProfileId.value = profileId;
  importUsername.value = '';
  error.value = '';
  success.value = '';
}

function cancelImport() {
  importProfileId.value = null;
  importUsername.value = '';
}

async function importIntoProfile(profileId: string) {
  if (!importUsername.value.trim() || importingProfileId.value) return;
  importingProfileId.value = profileId;
  error.value = '';
  success.value = '';
  try {
    const profile = await auth.importOfficialProfile(importUsername.value.trim(), profileId);
    success.value = `已将正版账号 ${profile.name} 导入到该 Profile。`;
    cancelImport();
  } catch (cause) {
    error.value = formatApiError(cause, '正版账号导入失败，请稍后重试。');
  } finally {
    importingProfileId.value = null;
  }
}

async function importAsNewProfile() {
  if (!newImportUsername.value.trim() || importingNewProfile.value) return;
  importingNewProfile.value = true;
  error.value = '';
  success.value = '';
  try {
    const profile = await auth.importOfficialProfile(newImportUsername.value.trim());
    newImportUsername.value = '';
    success.value = `已添加正版账号 ${profile.name}。`;
  } catch (cause) {
    error.value = formatApiError(cause, '正版账号导入失败，请稍后重试。');
  } finally {
    importingNewProfile.value = false;
  }
}

async function selectProfile(profileId: string) {
  if (profileId === auth.defaultProfileId || busyId.value) return;
  busyId.value = profileId;
  error.value = '';
  try {
    await auth.setDefaultProfile(profileId);
  } catch (cause) {
    error.value = formatApiError(cause, '切换 Profile 失败。');
  } finally {
    busyId.value = null;
  }
}

async function createProfile() {
  if (!newName.value.trim() || formBusy.value) return;
  formBusy.value = true;
  error.value = '';
  try {
    await auth.createProfile(newName.value.trim());
    newName.value = '';
  } catch (cause) {
    error.value = formatApiError(cause, '创建 Profile 失败。');
  } finally {
    formBusy.value = false;
  }
}

async function saveRename() {
  if (!editingId.value || !editingName.value.trim() || formBusy.value) return;
  formBusy.value = true;
  error.value = '';
  try {
    await auth.renameProfile(editingId.value, editingName.value.trim());
    cancelRename();
  } catch (cause) {
    error.value = formatApiError(cause, '重命名 Profile 失败。');
  } finally {
    formBusy.value = false;
  }
}

async function removeProfile(profileId: string) {
  if (profiles.value.length <= 1 || busyId.value) return;
  busyId.value = profileId;
  error.value = '';
  try {
    await auth.deleteProfile(profileId);
  } catch (cause) {
    error.value = formatApiError(cause, '删除 Profile 失败。');
  } finally {
    busyId.value = null;
  }
}
</script>

<template>
  <section class="panel profile-management" aria-labelledby="profile-management-title">
    <div class="workspace-section-heading">
      <div>
        <p class="eyebrow">PROFILES</p>
        <h2 id="profile-management-title">玩家 Profiles</h2>
      </div>
      <span class="section-caption">{{ profiles.length }} / 5</span>
    </div>
    <p class="section-description">选择默认 Profile，或为同一个账号管理不同的游戏角色。</p>

    <div class="profile-management-list">
      <article
        v-for="profile in profiles"
        :key="profile.id"
        class="profile-management-item"
        :class="{ selected: auth.defaultProfileId === profile.id }"
      >
        <button
          class="profile-card-button"
          type="button"
          :data-profile-id="profile.id"
          :aria-pressed="auth.defaultProfileId === profile.id"
          :disabled="busyId !== null"
          @click="selectProfile(profile.id)"
        >
          <span class="profile-card-avatar">{{ profile.name.slice(0, 1).toUpperCase() }}</span>
          <span class="profile-card-copy">
            <strong>{{ profile.name }}</strong>
            <small>{{ auth.defaultProfileId === profile.id ? '当前默认' : '设为默认' }}</small>
          </span>
          <Check v-if="auth.defaultProfileId === profile.id" :size="17" aria-hidden="true" />
        </button>
        <code class="profile-management-id">{{ profile.id }}</code>
        <form
          v-if="importProfileId === profile.id"
          class="profile-import-form"
          @submit.prevent="importIntoProfile(profile.id)"
        >
          <label class="visually-hidden" :for="`import-${profile.id}`">正版用户名</label>
          <input
            :id="`import-${profile.id}`"
            v-model="importUsername"
            minlength="3"
            maxlength="16"
            pattern="[A-Za-z0-9_]{3,16}"
            placeholder="输入正版用户名"
            required
          />
          <button class="text-button" type="submit" :disabled="importingProfileId !== null">
            <Download :size="14" aria-hidden="true" />
            {{ importingProfileId === profile.id ? '导入中…' : '覆盖导入' }}
          </button>
          <button
            class="text-button"
            type="button"
            :disabled="importingProfileId !== null"
            @click="cancelImport"
          >
            <X :size="14" aria-hidden="true" />取消
          </button>
        </form>
        <form
          v-if="editingId === profile.id"
          class="profile-inline-form"
          @submit.prevent="saveRename"
        >
          <label class="visually-hidden" :for="`rename-${profile.id}`">新的 Profile 名称</label>
          <input :id="`rename-${profile.id}`" v-model="editingName" maxlength="16" required />
          <button class="text-button" type="submit" :disabled="formBusy">保存</button>
          <button class="text-button" type="button" :disabled="formBusy" @click="cancelRename">
            取消
          </button>
        </form>
        <div v-else class="profile-management-actions">
          <button
            class="text-button"
            type="button"
            :disabled="busyId !== null"
            @click="startRename(profile.id, profile.name)"
          >
            <Pencil :size="14" aria-hidden="true" />重命名
          </button>
          <button
            class="text-button"
            type="button"
            :disabled="busyId !== null || importingProfileId !== null"
            @click="startImport(profile.id)"
          >
            <Download :size="14" aria-hidden="true" />导入正版
          </button>
          <button
            class="text-button danger"
            type="button"
            :disabled="profiles.length <= 1 || busyId !== null"
            @click="removeProfile(profile.id)"
          >
            <Trash2 :size="14" aria-hidden="true" />删除
          </button>
        </div>
      </article>
    </div>

    <form v-if="profiles.length < 5" class="profile-create-form" @submit.prevent="createProfile">
      <div class="field">
        <label for="new-profile-name">新 Profile 名称</label>
        <input
          id="new-profile-name"
          v-model="newName"
          name="name"
          minlength="3"
          maxlength="16"
          pattern="[A-Za-z0-9_]{3,16}"
          placeholder="例如 Alex_02"
          required
        />
      </div>
      <button
        class="button button-ghost button-small"
        type="submit"
        :disabled="formBusy || !newName.trim()"
      >
        <Plus :size="16" aria-hidden="true" />{{ formBusy ? '保存中…' : '添加 Profile' }}
      </button>
    </form>
    <form
      v-if="profiles.length < 5"
      class="profile-import-form profile-import-create-form"
      @submit.prevent="importAsNewProfile"
    >
      <div class="field">
        <label for="official-profile-name">从正版账号导入</label>
        <input
          id="official-profile-name"
          v-model="newImportUsername"
          minlength="3"
          maxlength="16"
          pattern="[A-Za-z0-9_]{3,16}"
          placeholder="输入正版用户名"
          required
        />
        <small>查找正版用户名，并创建一个包含官方皮肤和披风的新 Profile。</small>
      </div>
      <button
        class="button button-ghost button-small"
        type="submit"
        :disabled="importingNewProfile || !newImportUsername.trim()"
      >
        <Download :size="16" aria-hidden="true" />{{
          importingNewProfile ? '查找并导入…' : '查找并添加'
        }}
      </button>
    </form>
    <p v-if="profiles.length >= 5" class="section-caption profile-limit-note">
      已达到五个 Profile 的上限。
    </p>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <p v-if="success" class="form-success" role="status">{{ success }}</p>
  </section>
</template>
