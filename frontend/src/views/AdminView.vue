<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
  Ban,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Filter,
  MoreHorizontal,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Ticket,
  Trash2,
  Users,
  X,
} from 'lucide-vue-next';
import {
  createAdminInvite,
  deleteAdminUser,
  getAdminAuditLogs,
  formatApiError,
  getAdminInvites,
  getAdminSettings,
  getAdminUsers,
  revokeAdminUserSessions,
  revokeAdminInvite,
  updateAdminSettings,
  updateAdminUserStatus,
  updateUserRole,
  type AdminInvite,
  type AdminAuditLog,
  type AdminRegistrationSettings,
  type AdminUser,
  type AdminUserStatus,
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
const inviteUsePreset = ref<'1' | '5' | '10' | '20' | 'custom'>('1');
const inviteExpiryPreset = ref<'24h' | '7d' | '30d' | '365d' | 'custom'>('30d');
const inviteExpiresAt = ref('');
const inviteNote = ref('');
const createdInviteCode = ref('');
const inviteCopied = ref(false);
const revokingInvite = ref<string | null>(null);
const openMenuUserId = ref<string | null>(null);
const actionUser = ref<AdminUser | null>(null);
const userAction = ref<UserAction | null>(null);
const actionConfirmation = ref('');
const actionModalError = ref('');
const actionRunning = ref(false);
const userActionSuccess = ref('');
const auditLogs = ref<AdminAuditLog[]>([]);
const auditLoading = ref(true);
const auditError = ref('');
const auditAction = ref('');
const auditActor = ref('');
const auditTarget = ref('');
const auditDateFrom = ref('');
const auditDateTo = ref('');
const auditOffset = ref(0);
const auditHasMore = ref(false);
const AUDIT_PAGE_SIZE = 25;

type UserAction = 'disable' | 'enable' | 'revoke_sessions' | 'delete' | 'demote';

const auditActionOptions = [
  ['admin.user.role.update', '管理员角色变更'],
  ['admin.user.status.update', '账号状态变更'],
  ['admin.user.sessions.revoke', '管理员撤销会话'],
  ['admin.user.delete', '管理员删除账号'],
  ['admin.invite.create', '创建邀请码'],
  ['admin.invite.revoke', '撤销邀请码'],
  ['admin.settings.update', '更新管理设置'],
  ['admin.registration_mode.update', '更新注册模式'],
  ['account.deletion.request', '请求删除账号'],
  ['account.deletion.restore', '恢复账号'],
  ['account.deletion.finalize', '完成账号删除'],
  ['account.password.change', '修改密码'],
  ['account.password.reset', '重置密码'],
  ['account.email.change', '修改邮箱'],
] as const;

const filteredUsers = computed(() =>
  users.value.filter((user) => {
    const matchesRole = roleFilter.value === 'all' || user.role === roleFilter.value;
    const searchable = `${user.email} ${user.profile.name}`.toLowerCase();
    return matchesRole && searchable.includes(query.value.trim().toLowerCase());
  }),
);

const adminCount = computed(
  () => users.value.filter((user) => user.role === 'admin' && user.status === 'active').length,
);

function statusLabel(status: AdminUserStatus): string {
  if (status === 'disabled') return '已禁用';
  if (status === 'pending_deletion') return '待删除';
  return '正常';
}

function statusClass(status: AdminUserStatus): string {
  if (status === 'disabled') return 'admin-status-disabled';
  if (status === 'pending_deletion') return 'admin-status-pending';
  return 'admin-status-active';
}

const requiredConfirmation = computed(() => {
  if (userAction.value === 'disable') return 'DISABLE';
  if (userAction.value === 'demote') return 'DEMOTE';
  if (userAction.value === 'revoke_sessions') return 'REVOKE';
  if (userAction.value === 'delete') return 'DELETE';
  return '';
});

const actionTitle = computed(() => {
  if (userAction.value === 'disable') return '禁用账号';
  if (userAction.value === 'enable') return '启用账号';
  if (userAction.value === 'demote') return '移除管理员角色';
  if (userAction.value === 'revoke_sessions') return '撤销全部会话';
  if (userAction.value === 'delete') return '永久删除账号';
  return '确认操作';
});

const actionDescription = computed(() => {
  const name = actionUser.value?.profile.name ?? '此账号';
  if (userAction.value === 'disable') return `禁用 ${name} 后，该账号将无法登录或创建新会话。`;
  if (userAction.value === 'enable') return `重新启用 ${name} 后，该账号可以再次登录。`;
  if (userAction.value === 'demote') return `移除 ${name} 的管理员角色后，该账号将失去管理权限。`;
  if (userAction.value === 'revoke_sessions')
    return `撤销 ${name} 的全部会话、协议令牌和服务器加入状态。`;
  if (userAction.value === 'delete')
    return `永久删除 ${name} 的账号、Profile 和私人纹理记录。此操作无法撤销。`;
  return '';
});

function toggleUserMenu(userId: string): void {
  openMenuUserId.value = openMenuUserId.value === userId ? null : userId;
}

function startUserAction(user: AdminUser, action: UserAction): void {
  openMenuUserId.value = null;
  actionUser.value = user;
  userAction.value = action;
  actionConfirmation.value = '';
  actionModalError.value = '';
  userActionSuccess.value = '';
}

function closeUserAction(): void {
  if (actionRunning.value) return;
  actionUser.value = null;
  userAction.value = null;
  actionConfirmation.value = '';
  actionModalError.value = '';
}

async function confirmUserAction(): Promise<void> {
  const user = actionUser.value;
  const action = userAction.value;
  if (!user || !action || actionRunning.value) return;
  const expected = requiredConfirmation.value;
  if (expected && actionConfirmation.value.trim() !== expected) {
    actionModalError.value = `请输入 ${expected} 以确认此操作。`;
    return;
  }

  actionRunning.value = true;
  actionModalError.value = '';
  try {
    let message = '';
    if (action === 'disable') {
      await updateAdminUserStatus(user.id, 'disabled', expected);
      message = `${user.profile.name} 已禁用。`;
    } else if (action === 'enable') {
      await updateAdminUserStatus(user.id, 'active');
      message = `${user.profile.name} 已启用。`;
    } else if (action === 'demote') {
      await updateUserRole(user.id, 'user', expected);
      message = `${user.profile.name} 已移除管理员角色。`;
    } else if (action === 'revoke_sessions') {
      await revokeAdminUserSessions(user.id, expected);
      message = `${user.profile.name} 的全部会话已撤销。`;
    } else {
      await deleteAdminUser(user.id, expected);
      message = `${user.profile.name} 已永久删除。`;
    }
    await loadUsers();
    userActionSuccess.value = message;
    actionRunning.value = false;
    closeUserAction();
  } catch (cause) {
    actionModalError.value = formatApiError(cause, '账号操作失败。');
  } finally {
    actionRunning.value = false;
  }
}

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
  if (role === 'user' && user.role === 'admin') {
    startUserAction(user, 'demote');
    return;
  }
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

const inviteExpiryDurations: Record<Exclude<typeof inviteExpiryPreset.value, 'custom'>, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '365d': 365 * 24 * 60 * 60 * 1000,
};

watch(inviteUsePreset, (preset) => {
  if (preset !== 'custom') inviteUseLimit.value = Number(preset);
});

function inviteExpiry(): number | null {
  if (inviteExpiryPreset.value === 'custom') {
    if (!inviteExpiresAt.value) return null;
    const parsed = Date.parse(inviteExpiresAt.value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return Date.now() + inviteExpiryDurations[inviteExpiryPreset.value];
}

async function copyInviteCode() {
  if (!createdInviteCode.value) return;
  try {
    await navigator.clipboard?.writeText(createdInviteCode.value);
    inviteCopied.value = true;
    window.setTimeout(() => {
      inviteCopied.value = false;
    }, 1800);
  } catch {
    inviteCopied.value = false;
  }
}

async function createInvite() {
  if (!auth.isAuthenticated || inviteCreating.value) return;
  inviteCreating.value = true;
  inviteMessage.value = '';
  inviteActionError.value = '';
  createdInviteCode.value = '';
  inviteCopied.value = false;
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
    inviteUsePreset.value = '1';
    inviteExpiryPreset.value = '30d';
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

function auditFilters() {
  return {
    limit: AUDIT_PAGE_SIZE,
    offset: auditOffset.value,
    ...(auditAction.value ? { action: auditAction.value } : {}),
    ...(auditActor.value.trim() ? { actorUserId: auditActor.value.trim() } : {}),
    ...(auditTarget.value.trim() ? { targetUserId: auditTarget.value.trim() } : {}),
    ...(auditDateFrom.value ? { from: auditDateFrom.value } : {}),
    ...(auditDateTo.value ? { to: auditDateTo.value } : {}),
  };
}

async function loadAuditLogs(reset = false): Promise<void> {
  if (!auth.isAuthenticated) return;
  if (reset) auditOffset.value = 0;
  auditLoading.value = true;
  auditError.value = '';
  try {
    const response = await getAdminAuditLogs(auditFilters());
    auditLogs.value = response.logs;
    auditOffset.value = response.offset;
    auditHasMore.value = response.hasMore;
  } catch (cause) {
    auditError.value = formatApiError(cause, '无法加载审计日志。');
  } finally {
    auditLoading.value = false;
  }
}

function submitAuditFilters(): void {
  void loadAuditLogs(true);
}

function nextAuditPage(): void {
  if (auditLoading.value || !auditHasMore.value) return;
  auditOffset.value += AUDIT_PAGE_SIZE;
  void loadAuditLogs();
}

function previousAuditPage(): void {
  if (auditLoading.value || auditOffset.value === 0) return;
  auditOffset.value = Math.max(0, auditOffset.value - AUDIT_PAGE_SIZE);
  void loadAuditLogs();
}

function auditResultLabel(result: AdminAuditLog['result']): string {
  return result === 'success' ? '成功' : '失败';
}

onMounted(() => {
  void Promise.all([loadUsers(), loadSettings(), loadInvites(), loadAuditLogs()]);
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
            <select id="invite-use-limit" v-model="inviteUsePreset" name="invite-use-limit">
              <option value="1">1</option>
              <option value="5">5</option>
              <option value="10">10</option>
              <option value="20">20</option>
              <option value="custom">自定义</option>
            </select>
            <input
              v-if="inviteUsePreset === 'custom'"
              id="invite-use-limit-custom"
              v-model.number="inviteUseLimit"
              name="invite-use-limit-custom"
              type="number"
              min="1"
              max="1000"
              placeholder="输入次数"
            />
          </div>
          <div class="field">
            <label for="invite-expires-preset">过期时间</label>
            <select
              id="invite-expires-preset"
              v-model="inviteExpiryPreset"
              name="invite-expires-preset"
            >
              <option value="24h">24 Hours</option>
              <option value="7d">7 Days</option>
              <option value="30d">30 Days</option>
              <option value="365d">365 Days</option>
              <option value="custom">自定义</option>
            </select>
            <input
              v-if="inviteExpiryPreset === 'custom'"
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
      <div
        v-if="createdInviteCode"
        data-state="invite-created"
        class="admin-secret-callout"
        role="status"
      >
        <span class="admin-secret-main"
          >本次邀请码（只显示一次）：<code>{{ createdInviteCode }}</code></span
        >
        <button
          class="copy-id-button"
          type="button"
          data-action="copy-invite"
          :aria-label="inviteCopied ? '邀请码已复制' : '复制邀请码'"
          @click="copyInviteCode"
        >
          <Check v-if="inviteCopied" :size="15" aria-hidden="true" />
          <Copy v-else :size="15" aria-hidden="true" />
          {{ inviteCopied ? '已复制' : '复制' }}
        </button>
      </div>
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

  <UiCard as="section" class="panel admin-audit-panel">
    <div class="workspace-section-heading">
      <div>
        <p class="eyebrow">SECURITY HISTORY</p>
        <h2>管理员审计日志</h2>
        <p class="section-description">只读查看账号与管理操作。敏感凭据和原始请求信息不会显示。</p>
      </div>
      <ShieldCheck class="section-icon" :size="20" aria-hidden="true" />
    </div>
    <form class="admin-audit-filters" @submit.prevent="submitAuditFilters">
      <div class="field">
        <label for="audit-action">操作</label>
        <select id="audit-action" v-model="auditAction" name="audit-action">
          <option value="">全部操作</option>
          <option v-for="[value, label] in auditActionOptions" :key="value" :value="value">
            {{ label }}
          </option>
        </select>
      </div>
      <div class="field">
        <label for="audit-actor">操作者 ID</label>
        <input id="audit-actor" v-model="auditActor" name="audit-actor" type="text" />
      </div>
      <div class="field">
        <label for="audit-target">目标 ID</label>
        <input id="audit-target" v-model="auditTarget" name="audit-target" type="text" />
      </div>
      <div class="field">
        <label for="audit-date-from">开始日期</label>
        <input id="audit-date-from" v-model="auditDateFrom" name="audit-date-from" type="date" />
      </div>
      <div class="field">
        <label for="audit-date-to">结束日期</label>
        <input id="audit-date-to" v-model="auditDateTo" name="audit-date-to" type="date" />
      </div>
      <button class="button button-ghost button-small" type="submit" :disabled="auditLoading">
        <Filter :size="15" aria-hidden="true" />筛选
      </button>
    </form>
    <div v-if="auditLoading" data-state="audit-loading" class="admin-control-loading" role="status">
      正在加载审计日志…
    </div>
    <div v-else-if="auditError" data-state="audit-error" class="admin-error-state">
      <p class="form-error" role="alert">{{ auditError }}</p>
      <button class="button button-ghost button-small" type="button" @click="loadAuditLogs()">
        <RefreshCw :size="16" aria-hidden="true" />重试
      </button>
    </div>
    <div
      v-else-if="auditLogs.length === 0"
      data-state="audit-empty"
      class="empty-state admin-empty-state"
    >
      还没有匹配的审计记录。
    </div>
    <div v-else class="admin-audit-results">
      <div class="admin-table-desktop">
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>操作</th>
              <th>结果</th>
              <th>操作者</th>
              <th>目标</th>
              <th>请求 ID</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="log in auditLogs" :key="log.id" :data-audit-id="log.id">
              <td>{{ new Date(log.createdAt).toLocaleString('zh-CN') }}</td>
              <td>
                <code>{{ log.action }}</code>
              </td>
              <td>
                <span
                  :class="log.result === 'success' ? 'admin-audit-success' : 'admin-audit-failure'"
                >
                  {{ auditResultLabel(log.result) }}
                </span>
              </td>
              <td>{{ log.actorUserId ?? '系统' }}</td>
              <td>{{ log.targetUserId ?? log.targetResource ?? '—' }}</td>
              <td>
                <code>{{ log.requestId }}</code>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="admin-audit-cards">
        <article
          v-for="log in auditLogs"
          :key="`card-${log.id}`"
          class="admin-audit-card"
          :data-audit-id="log.id"
        >
          <div class="admin-audit-card-heading">
            <code>{{ log.action }}</code>
            <span :class="log.result === 'success' ? 'admin-audit-success' : 'admin-audit-failure'">
              {{ auditResultLabel(log.result) }}
            </span>
          </div>
          <span>{{ new Date(log.createdAt).toLocaleString('zh-CN') }}</span>
          <span>操作者：{{ log.actorUserId ?? '系统' }}</span>
          <span>目标：{{ log.targetUserId ?? log.targetResource ?? '—' }}</span>
        </article>
      </div>
      <div v-if="auditHasMore || auditOffset > 0" class="admin-audit-pagination">
        <button
          class="button button-ghost button-small"
          type="button"
          :disabled="auditLoading || auditOffset === 0"
          data-state="audit-previous"
          @click="previousAuditPage"
        >
          <ChevronLeft :size="15" aria-hidden="true" />上一页
        </button>
        <span>第 {{ Math.floor(auditOffset / AUDIT_PAGE_SIZE) + 1 }} 页</span>
        <button
          class="button button-ghost button-small"
          type="button"
          :disabled="auditLoading || !auditHasMore"
          data-state="audit-next"
          @click="nextAuditPage"
        >
          下一页<ChevronRight :size="15" aria-hidden="true" />
        </button>
      </div>
    </div>
  </UiCard>

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
      <p
        v-if="userActionSuccess"
        data-state="user-action-success"
        class="admin-feedback form-success"
        role="status"
        aria-live="polite"
      >
        {{ userActionSuccess }}
      </p>
      <div class="admin-table-desktop">
        <table>
          <thead>
            <tr>
              <th>游戏名</th>
              <th>邮箱</th>
              <th>注册时间</th>
              <th>角色</th>
              <th>状态</th>
              <th>操作</th>
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
              <td>
                <span
                  class="admin-status-badge"
                  :class="statusClass(user.status)"
                  :data-status="user.status"
                >
                  <span class="admin-status-dot" aria-hidden="true" />{{ statusLabel(user.status) }}
                </span>
              </td>
              <td>
                <div class="admin-action-menu-wrap">
                  <button
                    class="icon-button"
                    type="button"
                    data-action="open-user-actions"
                    :aria-label="`打开 ${user.profile.name} 的账号操作`"
                    :aria-expanded="openMenuUserId === user.id"
                    @click.stop="toggleUserMenu(user.id)"
                  >
                    <MoreHorizontal :size="18" aria-hidden="true" />
                  </button>
                  <div v-if="openMenuUserId === user.id" class="admin-action-menu" role="menu">
                    <button
                      v-if="user.status === 'active'"
                      type="button"
                      role="menuitem"
                      data-action="disable-user"
                      @click="startUserAction(user, 'disable')"
                    >
                      禁用账号
                    </button>
                    <button
                      v-else-if="user.status === 'disabled'"
                      type="button"
                      role="menuitem"
                      data-action="enable-user"
                      @click="startUserAction(user, 'enable')"
                    >
                      启用账号
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      data-action="revoke-user-sessions"
                      @click="startUserAction(user, 'revoke_sessions')"
                    >
                      撤销全部会话
                    </button>
                    <button
                      class="is-danger"
                      type="button"
                      role="menuitem"
                      data-action="delete-user"
                      @click="startUserAction(user, 'delete')"
                    >
                      <Trash2 :size="15" aria-hidden="true" />永久删除
                    </button>
                  </div>
                </div>
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
            <span
              class="admin-status-badge"
              :class="statusClass(user.status)"
              :data-status="user.status"
            >
              <span class="admin-status-dot" aria-hidden="true" />{{ statusLabel(user.status) }}
            </span>
            <div class="admin-action-menu-wrap">
              <button
                class="icon-button"
                type="button"
                data-action="open-user-actions"
                :aria-label="`打开 ${user.profile.name} 的账号操作`"
                :aria-expanded="openMenuUserId === user.id"
                @click.stop="toggleUserMenu(user.id)"
              >
                <MoreHorizontal :size="18" aria-hidden="true" />
              </button>
              <div v-if="openMenuUserId === user.id" class="admin-action-menu" role="menu">
                <button
                  v-if="user.status === 'active'"
                  type="button"
                  role="menuitem"
                  data-action="disable-user"
                  @click="startUserAction(user, 'disable')"
                >
                  禁用账号
                </button>
                <button
                  v-else-if="user.status === 'disabled'"
                  type="button"
                  role="menuitem"
                  data-action="enable-user"
                  @click="startUserAction(user, 'enable')"
                >
                  启用账号
                </button>
                <button
                  type="button"
                  role="menuitem"
                  data-action="revoke-user-sessions"
                  @click="startUserAction(user, 'revoke_sessions')"
                >
                  撤销全部会话
                </button>
                <button
                  class="is-danger"
                  type="button"
                  role="menuitem"
                  data-action="delete-user"
                  @click="startUserAction(user, 'delete')"
                >
                  <Trash2 :size="15" aria-hidden="true" />永久删除
                </button>
              </div>
            </div>
          </div>
        </article>
      </div>
      <p v-if="filteredUsers.length === 0" class="empty-state">
        {{ users.length === 0 ? '还没有用户。' : '没有匹配的用户。' }}
      </p>
    </div>
  </UiCard>

  <div v-if="actionUser && userAction" class="admin-modal-backdrop" @click.self="closeUserAction">
    <section
      class="admin-confirmation-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-confirmation-title"
    >
      <div class="admin-confirmation-heading">
        <div>
          <p class="eyebrow">ACCOUNT CONTROL</p>
          <h2 id="admin-confirmation-title">{{ actionTitle }}</h2>
        </div>
        <button
          class="icon-button"
          type="button"
          aria-label="关闭确认窗口"
          :disabled="actionRunning"
          @click="closeUserAction"
        >
          <X :size="18" aria-hidden="true" />
        </button>
      </div>
      <p class="admin-confirmation-description">{{ actionDescription }}</p>
      <label v-if="requiredConfirmation" class="field admin-confirmation-field">
        <span
          >请输入 <code>{{ requiredConfirmation }}</code> 继续</span
        >
        <input
          v-model="actionConfirmation"
          name="admin-confirmation"
          type="text"
          autocomplete="off"
          :placeholder="requiredConfirmation"
          @keyup.enter="confirmUserAction"
        />
      </label>
      <p v-if="actionModalError" class="form-error" role="alert">{{ actionModalError }}</p>
      <div class="admin-confirmation-actions">
        <button
          class="button button-ghost"
          type="button"
          :disabled="actionRunning"
          @click="closeUserAction"
        >
          取消
        </button>
        <button
          class="button"
          :class="userAction === 'delete' ? 'button-danger' : 'button-primary'"
          type="button"
          data-action="confirm-user-action"
          :disabled="
            actionRunning ||
            Boolean(requiredConfirmation && actionConfirmation.trim() !== requiredConfirmation)
          "
          @click="confirmUserAction"
        >
          {{ actionRunning ? '处理中…' : actionTitle }}
        </button>
      </div>
    </section>
  </div>
</template>
