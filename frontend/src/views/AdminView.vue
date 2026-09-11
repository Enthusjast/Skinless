<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ApiError, getAdminUsers, updateUserRole, type AdminUser } from '../api';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const users = ref<AdminUser[]>([]);
const loading = ref(true);
const error = ref('');
const updating = ref<string | null>(null);

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
  <section class="dashboard-heading"><div><p class="eyebrow">ADMINISTRATION</p><h1>用户管理</h1><p>查看账号和调整基础角色权限。</p></div><span class="profile-chip">{{ users.length }} 个账号</span></section>
  <section class="panel table-panel">
    <div v-if="loading" class="loading-state">正在加载用户…</div>
    <p v-else-if="error" class="form-error" role="alert">{{ error }}</p>
    <div v-else class="table-wrap">
      <table><thead><tr><th>游戏名</th><th>邮箱</th><th>注册时间</th><th>角色</th></tr></thead><tbody>
        <tr v-for="user in users" :key="user.id"><td><strong>{{ user.profile.name }}</strong><small class="table-id">{{ user.profile.id }}</small></td><td>{{ user.email }}</td><td>{{ new Date(user.createdAt).toLocaleDateString('zh-CN') }}</td><td><select :value="user.role" :disabled="updating === user.id" @change="changeRole(user, $event)"><option value="user">user</option><option value="admin">admin</option></select></td></tr>
      </tbody></table>
      <p v-if="users.length === 0" class="empty-state">还没有用户。</p>
    </div>
  </section>
</template>
