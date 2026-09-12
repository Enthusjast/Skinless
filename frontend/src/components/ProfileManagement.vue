<script setup lang="ts">
import { Check, Pencil, Plus, Trash2 } from 'lucide-vue-next';
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

function startRename(profileId: string, name: string) {
  editingId.value = profileId;
  editingName.value = name;
  error.value = '';
}

function cancelRename() {
  editingId.value = null;
  editingName.value = '';
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
    <p v-if="profiles.length >= 5" class="section-caption profile-limit-note">
      已达到五个 Profile 的上限。
    </p>
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
  </section>
</template>
