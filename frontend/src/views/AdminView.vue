<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Ban, RefreshCw, Save, Search, ShieldCheck, Ticket, Users } from 'lucide-vue-next';
import {
  createAdminInvite,
  formatApiError,
  getAdminInvites,
  getAdminSettings,
  getAdminUsers,
  revokeAdminInvite,
  updateAdminSettings,
  updateUserRole,
  type AdminInvite,
  type AdminRegistrationSettings,
  type AdminUser,
  type RegistrationMode,
} from '../api';
import UiCard from '../components/common/UiCard.vue';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const users = ref<AdminUser[]>([]);
const loading = ref(true);
const error = ref('');
const updating = ref<string | null>(null);
const query = ref('');
const roleFilter = ref<'all' | 'user' | 'admin'>('all');
const actionMessage = ref('');
const actionError = ref('');
const settings = ref<AdminRegistrationSettings | null>(null);
const settingsLoading = ref(true);
const settingsError = ref('');
const settingsSaving = ref(false);
const settingsMessage = ref('');
const settingsActionError = ref('');
const registrationMode = ref<RegistrationMode>('open');
const maxProfilesPerUser = ref(5);
const maxTexturesPerUser = ref(50);
const enforceJoinIp = ref(false);
const invites = ref<AdminInvite[]>([]);
const invitesLoading = ref(true);
const invitesError = ref('');
const inviteCreating = ref(false);
const inviteActionError = ref('');
const inviteMessage = ref('');
const inviteUseLimit = ref(1);
const inviteExpiresAt = ref('');
const inviteNote = ref('');
const createdInviteCode = ref('');
const revokingInvite = ref<string | null>(null);

const filteredUsers = computed(() =>
  users.value.filter((user) => {
    const matchesRole = roleFilter.value === 'all' || user.role === roleFilter.value;
    const searchable = `${user.email} ${user.profile.name}`.toLowerCase();
    return matchesRole && searchable.includes(query.value.trim().toLowerCase());
  }),
);

const adminCount = computed(() => users.value.filter((user) => user.role === 'admin').length);

async function loadUsers() {
  if (!auth.isAuthenticated) return;
  loading.value = true;
  error.value = '';
  try {
    users.value = (await getAdminUsers()).users;
  } catch (cause) {
    error.value = formatApiError(cause, '无法加载用户。');
  } finally {
    loading.value = false;
  }
}

async function changeRole(user: AdminUser, event: Event) {
  if (!auth.isAuthenticated) return;
  const role = (event.target as HTMLSelectElement).value as 'user' | 'admin';
  updating.value = user.id;
  actionMessage.value = '';
  actionError.value = '';
  try {
    await updateUserRole(user.id, role);
    user.role = role;
    actionMessage.value = `${user.profile.name} 的角色已更新。`;
  } catch (cause) {
    actionError.value = formatApiError(cause, '角色更新失败。');
    await loadUsers();
  } finally {
    updating.value = null;
  }
}

function applySettings(value: AdminRegistrationSettings): void {
  settings.value = value;
  registrationMode.value = value.registrationMode;
  maxProfilesPerUser.value = value.maxProfilesPerUser;
  maxTexturesPerUser.value = value.maxTexturesPerUser;
  enforceJoinIp.value = value.enforceJoinIp;
}

async function loadSettings() {
  if (!auth.isAuthenticated) return;
  settingsLoading.value = true;
  settingsError.value = '';
  try {
    applySettings((await getAdminSettings()).settings);
  } catch (cause) {
    settingsError.value = formatApiError(cause, '无法加载注册设置。');
  } finally {
    settingsLoading.value = false;
  }
}

async function saveSettings() {
  if (!auth.isAuthenticated || settingsSaving.value) return;
  settingsSaving.value = true;
  settingsMessage.value = '';
  settingsActionError.value = '';
  try {
    const response = await updateAdminSettings({
      registrationMode: registrationMode.value,
      maxProfilesPerUser: maxProfilesPerUser.value,
      maxTexturesPerUser: maxTexturesPerUser.value,
      enforceJoinIp: enforceJoinIp.value,
    });
    applySettings(response.settings);
    settingsMessage.value = '注册设置已保存。';
  } catch (cause) {
    settingsActionError.value = formatApiError(cause, '注册设置保存失败。');
  } finally {
    settingsSaving.value = false;
  }
}

async function loadInvites() {
  if (!auth.isAuthenticated) return;
  invitesLoading.value = true;
  invitesError.value = '';
  try {
    invites.value = (await getAdminInvites()).invites.map((invite) => withoutInviteCode(invite));
  } catch (cause) {
    invitesError.value = formatApiError(cause, '无法加载邀请码。');
  } finally {
    invitesLoading.value = false;
  }
}

function withoutInviteCode(invite: AdminInvite): AdminInvite {
  const redacted = { ...invite };
  delete redacted.code;
  return redacted;
}

function inviteExpiry(): number | null {
  if (!inviteExpiresAt.value) return null;
  const parsed = Date.parse(inviteExpiresAt.value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function createInvite() {
  if (!auth.isAuthenticated || inviteCreating.value) return;
  inviteCreating.value = true;
  inviteMessage.value = '';
  inviteActionError.value = '';
  createdInviteCode.value = '';
  try {
    const response = await createAdminInvite({
      useLimit: inviteUseLimit.value,
      expiresAt: inviteExpiry(),
      note: inviteNote.value,
    });
    createdInviteCode.value = response.invite.code ?? '';
    invites.value.unshift(withoutInviteCode(response.invite));
    inviteMessage.value = '邀请码已创建，请在离开前复制它。';
    inviteUseLimit.value = 1;
    inviteExpiresAt.value = '';
    inviteNote.value = '';
  } catch (cause) {
    inviteActionError.value = formatApiError(cause, '邀请码创建失败。');
  } finally {
    inviteCreating.value = false;
  }
}

async function revokeInvite(invite: AdminInvite) {
  if (!auth.isAuthenticated || invite.revokedAt || revokingInvite.value) return;
  revokingInvite.value = invite.id;
  inviteMessage.value = '';
  inviteActionError.value = '';
  try {
    const response = await revokeAdminInvite(invite.id);
    const index = invites.value.findIndex((candidate) => candidate.id === invite.id);
    if (index >= 0) invites.value[index] = withoutInviteCode(response.invite);
    inviteMessage.value = '邀请码已撤销。';
  } catch (cause) {
    inviteActionError.value = formatApiError(cause, '邀请码撤销失败。');
  } finally {
    revokingInvite.value = null;
  }
}

onMounted(() => {
  void Promise.all([loadUsers(), loadSettings(), loadInvites()]);
});
</script>

<template>
  <section class="admin-control-grid">
    <UiCard as="section" class="panel admin-control-card">
      <div class="workspace-section-heading">
        <div>
          <p class="eyebrow">REGISTRATION POLICY</p>
          <h2>注册设置</h2>
          <p class="section-description">控制注册入口、账号配额和服务器加入时的 IP 绑定策略。</p>
        </div>
        <Save class="section-icon" :size="20" aria-hidden="true" />
      </div>
      <div
        v-if="settingsLoading"
        data-state="settings-loading"
        class="admin-control-loading"
        role="status"
      >
        正在加载注册设置…
      </div>
      <div v-else-if="settingsError" data-state="settings-error" class="admin-error-state">
        <p class="form-error" role="alert">{{ settingsError }}</p>
        <button
          class="button button-ghost button-small"
          type="button"
          data-action="reload-registration-settings"
          @click="loadSettings"
        >
          <RefreshCw :size="16" aria-hidden="true" />重试
        </button>
      </div>
      <form v-else class="admin-settings-form" @submit.prevent="saveSettings">
        <div class="admin-form-grid">
          <div class="field">
            <label for="registration-mode">注册模式</label>
            <select id="registration-mode" v-model="registrationMode" name="registration-mode">
              <option value="open">开放注册</option>
              <option value="invite">仅限邀请码</option>
              <option value="closed">关闭注册</option>
            </select>
          </div>
          <div class="field">
            <label for="max-profiles-per-user">每个账号的 Profile 上限</label>
            <input
              id="max-profiles-per-user"
              v-model.number="maxProfilesPerUser"
              name="max-profiles-per-user"
              type="number"
              min="1"
              max="50"
            />
          </div>
          <div class="field">
            <label for="max-textures-per-user">每个账号的纹理上限</label>
            <input
              id="max-textures-per-user"
              v-model.number="maxTexturesPerUser"
              name="max-textures-per-user"
              type="number"
              min="1"
              max="500"
            />
          </div>
          <label class="admin-checkbox-field">
            <input v-model="enforceJoinIp" name="enforce-join-ip" type="checkbox" />
            <span>
              <strong>绑定加入 IP</strong>
              <small>为后续注册流程保留更严格的会话约束。</small>
            </span>
          </label>
        </div>
        <div class="admin-form-actions">
          <button
            class="button button-primary"
            type="submit"
            data-action="save-registration-settings"
            :disabled="settingsSaving"
          >
            <Save :size="16" aria-hidden="true" />{{ settingsSaving ? '保存中…' : '保存设置' }}
          </button>
        </div>
        <p v-if="settingsMessage" class="form-success" role="status">{{ settingsMessage }}</p>
        <p v-if="settingsActionError" class="form-error" role="alert">{{ settingsActionError }}</p>
      </form>
    </UiCard>

    <UiCard as="section" class="panel admin-control-card">
      <div class="workspace-section-heading">
        <div>
          <p class="eyebrow">INVITE ACCESS</p>
          <h2>邀请码</h2>
          <p class="section-description">
            创建可撤销、可限次和可过期的邀请码。完整密钥只显示一次。
          </p>
        </div>
        <Ticket class="section-icon" :size="20" aria-hidden="true" />
      </div>
      <form class="admin-invite-form" @submit.prevent="createInvite">
        <div class="admin-form-grid admin-invite-fields">
          <div class="field">
            <label for="invite-use-limit">可使用次数</label>
            <input
              id="invite-use-limit"
              v-model.number="inviteUseLimit"
              name="invite-use-limit"
              type="number"
              min="1"
              max="1000"
            />
          </div>
          <div class="field">
            <label for="invite-expires-at">过期时间（可选）</label>
            <input
              id="invite-expires-at"
              v-model="inviteExpiresAt"
              name="invite-expires-at"
              type="datetime-local"
            />
          </div>
          <div class="field admin-invite-note">
            <label for="invite-note">备注</label>
            <textarea
              id="invite-note"
              v-model="inviteNote"
              name="invite-note"
              rows="2"
              placeholder="例如：内测群"
            ></textarea>
          </div>
        </div>
        <div class="admin-form-actions">
          <button
            class="button button-primary"
            type="submit"
            data-action="create-invite"
            :disabled="inviteCreating"
          >
            <Ticket :size="16" aria-hidden="true" />{{ inviteCreating ? '创建中…' : '创建邀请码' }}
          </button>
        </div>
      </form>
      <p
        v-if="createdInviteCode"
        data-state="invite-created"
        class="admin-secret-callout"
        role="status"
      >
        本次邀请码（只显示一次）：<code>{{ createdInviteCode }}</code>
      </p>
      <p v-if="inviteMessage" class="form-success" role="status">{{ inviteMessage }}</p>
      <p v-if="inviteActionError" class="form-error" role="alert">{{ inviteActionError }}</p>
      <div v-if="invitesLoading" class="admin-control-loading" role="status">正在加载邀请码…</div>
      <div v-else-if="invitesError" class="admin-error-state">
        <p class="form-error" role="alert">{{ invitesError }}</p>
        <button class="button button-ghost button-small" type="button" @click="loadInvites">
          <RefreshCw :size="16" aria-hidden="true" />重试
        </button>
      </div>
      <div v-else-if="invites.length > 0" class="admin-invite-list">
        <article
          v-for="invite in invites"
          :key="invite.id"
          class="admin-invite-item"
          :data-invite-id="invite.id"
        >
          <div class="admin-invite-main">
            <code>{{ invite.codePrefix }}••••••</code>
            <span v-if="invite.note">{{ invite.note }}</span>
          </div>
          <div class="admin-invite-meta">
            <span>{{ invite.useCount }} / {{ invite.useLimit }} 次</span>
            <span>{{
              invite.expiresAt ? new Date(invite.expiresAt).toLocaleString('zh-CN') : '永不过期'
            }}</span>
            <span :class="invite.revokedAt ? 'admin-invite-revoked' : 'admin-invite-active'">
              {{ invite.revokedAt ? '已撤销' : '可用' }}
            </span>
            <button
              class="button button-danger button-small"
              type="button"
              data-action="revoke-invite"
              :disabled="Boolean(invite.revokedAt) || revokingInvite === invite.id"
              @click="revokeInvite(invite)"
            >
              <Ban :size="15" aria-hidden="true" />{{
                revokingInvite === invite.id ? '撤销中…' : '撤销'
              }}
            </button>
          </div>
        </article>
      </div>
      <p v-else class="empty-state admin-empty-state">还没有邀请码。</p>
    </UiCard>
  </section>

  <section class="admin-stats" aria-label="用户统计">
    <UiCard as="article" class="stat-card"
      ><span class="stat-icon"><Users :size="18" aria-hidden="true" /></span
      ><strong>{{ users.length }}</strong
      ><span>全部账号</span></UiCard
    >
    <UiCard as="article" class="stat-card"
      ><span class="stat-icon"><ShieldCheck :size="18" aria-hidden="true" /></span
      ><strong>{{ adminCount }}</strong
      ><span>管理员</span></UiCard
    >
  </section>
  <UiCard as="section" class="panel table-panel">
    <div
      v-if="loading"
      class="admin-skeleton"
      role="status"
      aria-label="正在加载用户列表"
      aria-busy="true"
    >
      <span v-for="index in 5" :key="index" />
    </div>
    <div v-else-if="error" class="admin-error-state">
      <p class="form-error" role="alert">{{ error }}</p>
      <button class="button button-ghost button-small" type="button" @click="loadUsers">
        <RefreshCw :size="16" aria-hidden="true" />重试
      </button>
    </div>
    <div v-else class="table-wrap">
      <div class="admin-toolbar">
        <label class="search-field"
          ><Search :size="17" aria-hidden="true" /><span class="visually-hidden">搜索用户</span
          ><input v-model="query" type="search" placeholder="搜索游戏名或邮箱" /></label
        ><select v-model="roleFilter" class="role-filter" aria-label="按角色筛选">
          <option value="all">全部角色</option>
          <option value="user">普通用户</option>
          <option value="admin">管理员</option></select
        ><button
          class="icon-button"
          type="button"
          aria-label="刷新用户列表"
          title="刷新"
          :disabled="loading"
          @click="loadUsers"
        >
          <RefreshCw :size="17" :class="{ spinning: loading }" aria-hidden="true" />
        </button>
      </div>
      <p v-if="actionMessage" class="admin-feedback form-success" role="status" aria-live="polite">
        {{ actionMessage }}
      </p>
      <p v-if="actionError" class="admin-feedback form-error" role="alert">{{ actionError }}</p>
      <div class="admin-table-desktop">
        <table>
          <thead>
            <tr>
              <th>游戏名</th>
              <th>邮箱</th>
              <th>注册时间</th>
              <th>角色</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="user in filteredUsers" :key="user.id">
              <td>
                <strong>{{ user.profile.name }}</strong
                ><small class="table-id">{{ user.profile.id }}</small>
              </td>
              <td>{{ user.email }}</td>
              <td>{{ new Date(user.createdAt).toLocaleDateString('zh-CN') }}</td>
              <td>
                <select
                  :value="user.role"
                  :disabled="updating === user.id"
                  :aria-label="`修改 ${user.profile.name} 的角色`"
                  @change="changeRole(user, $event)"
                >
                  <option value="user">user</option>
                  <option value="admin">admin</option>
                </select>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="admin-user-cards">
        <article v-for="user in filteredUsers" :key="`card-${user.id}`" class="admin-user-card">
          <div>
            <strong>{{ user.profile.name }}</strong
            ><span>{{ user.email }}</span>
          </div>
          <div class="admin-user-card-meta">
            <span>{{ new Date(user.createdAt).toLocaleDateString('zh-CN') }}</span
            ><select
              :value="user.role"
              :disabled="updating === user.id"
              :aria-label="`修改 ${user.profile.name} 的角色`"
              @change="changeRole(user, $event)"
            >
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
          </div>
        </article>
      </div>
      <p v-if="filteredUsers.length === 0" class="empty-state">
        {{ users.length === 0 ? '还没有用户。' : '没有匹配的用户。' }}
      </p>
    </div>
  </UiCard>
</template>
