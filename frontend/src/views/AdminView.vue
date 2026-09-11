<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RefreshCw, Search, ShieldCheck, Users } from 'lucide-vue-next';
import { ApiError, getAdminUsers, updateUserRole, type AdminUser } from '../api';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const users = ref<AdminUser[]>([]);
const loading = ref(true);
const error = ref('');
const updating = ref<string | null>(null);
const query = ref('');
const roleFilter = ref<'all' | 'user' | 'admin'>('all');

const filteredUsers = computed(() => users.value.filter((user) => {
  const matchesRole = roleFilter.value === 'all' || user.role === roleFilter.value;
  const searchable = `${user.email} ${user.profile.name}`.toLowerCase();
  return matchesRole && searchable.includes(query.value.trim().toLowerCase());
}));

const adminCount = computed(() => users.value.filter((user) => user.role === 'admin').length);

async function loadUsers() {
  if (!auth.token) return;
  loading.value = true;
  error.value = '';
  try {
    users.value = (await getAdminUsers(auth.token)).users;
  } catch (cause) {
    error.value = cause instanceof ApiError || cause instanceof Error ? cause.message : '无法加载用户。';
  } finally {
    loading.value = false;
  }
}

async function changeRole(user: AdminUser, event: Event) {
  if (!auth.token) return;
  const role = (event.target as HTMLSelectElement).value as 'user' | 'admin';
  updating.value = user.id;
  try {
    await updateUserRole(auth.token, user.id, role);
    user.role = role;
  } catch (cause) {
    error.value = cause instanceof ApiError || cause instanceof Error ? cause.message : '角色更新失败。';
    await loadUsers();
  } finally {
    updating.value = null;
  }
}

onMounted(loadUsers);
</script>

<template>
  <section class="admin-stats" aria-label="用户统计">
    <article class="stat-card"><span class="stat-icon"><Users :size="18" aria-hidden="true" /></span><strong>{{ users.length }}</strong><span>全部账号</span></article>
    <article class="stat-card"><span class="stat-icon"><ShieldCheck :size="18" aria-hidden="true" /></span><strong>{{ adminCount }}</strong><span>管理员</span></article>
  </section>
  <section class="panel table-panel">
    <div v-if="loading" class="admin-skeleton" aria-label="正在加载用户列表" aria-busy="true"><span v-for="index in 5" :key="index" /></div>
    <div v-else-if="error" class="admin-error-state"><p class="form-error" role="alert">{{ error }}</p><button class="button button-ghost button-small" type="button" @click="loadUsers"><RefreshCw :size="16" aria-hidden="true" />重试</button></div>
    <div v-else class="table-wrap">
      <div class="admin-toolbar"><label class="search-field"><Search :size="17" aria-hidden="true" /><span class="visually-hidden">搜索用户</span><input v-model="query" type="search" placeholder="搜索游戏名或邮箱" /></label><select v-model="roleFilter" class="role-filter" aria-label="按角色筛选"><option value="all">全部角色</option><option value="user">普通用户</option><option value="admin">管理员</option></select><button class="icon-button" type="button" aria-label="刷新用户列表" title="刷新" :disabled="loading" @click="loadUsers"><RefreshCw :size="17" :class="{ spinning: loading }" aria-hidden="true" /></button></div>
      <div class="admin-table-desktop"><table><thead><tr><th>游戏名</th><th>邮箱</th><th>注册时间</th><th>角色</th></tr></thead><tbody>
        <tr v-for="user in filteredUsers" :key="user.id"><td><strong>{{ user.profile.name }}</strong><small class="table-id">{{ user.profile.id }}</small></td><td>{{ user.email }}</td><td>{{ new Date(user.createdAt).toLocaleDateString('zh-CN') }}</td><td><select :value="user.role" :disabled="updating === user.id" :aria-label="`修改 ${user.profile.name} 的角色`" @change="changeRole(user, $event)"><option value="user">user</option><option value="admin">admin</option></select></td></tr>
      </tbody></table></div>
      <div class="admin-user-cards">
        <article v-for="user in filteredUsers" :key="`card-${user.id}`" class="admin-user-card"><div><strong>{{ user.profile.name }}</strong><span>{{ user.email }}</span></div><div class="admin-user-card-meta"><span>{{ new Date(user.createdAt).toLocaleDateString('zh-CN') }}</span><select :value="user.role" :disabled="updating === user.id" :aria-label="`修改 ${user.profile.name} 的角色`" @change="changeRole(user, $event)"><option value="user">user</option><option value="admin">admin</option></select></div></article>
      </div>
      <p v-if="filteredUsers.length === 0" class="empty-state">{{ users.length === 0 ? '还没有用户。' : '没有匹配的用户。' }}</p>
    </div>
  </section>
</template>
