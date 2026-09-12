<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RefreshCw, ShieldCheck, X } from 'lucide-vue-next';
import {
  formatApiError,
  getSessions,
  revokeOtherSessions,
  revokeSession,
  type WebSession,
} from '../api';

const sessions = ref<WebSession[]>([]);
const loading = ref(true);
const error = ref('');
const actionError = ref('');
const actionMessage = ref('');
const revokingSessionId = ref<string | null>(null);
const revokingOthers = ref(false);

const otherSessions = computed(() => sessions.value.filter((session) => !session.current));

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

async function loadSessions() {
  loading.value = true;
  error.value = '';
  try {
    sessions.value = (await getSessions()).sessions;
  } catch (cause) {
    error.value = formatApiError(cause, '无法加载登录会话。');
  } finally {
    loading.value = false;
  }
}

async function revokeOne(session: WebSession) {
  revokingSessionId.value = session.id;
  actionError.value = '';
  actionMessage.value = '';
  try {
    await revokeSession(session.id);
    sessions.value = sessions.value.filter((candidate) => candidate.id !== session.id);
    actionMessage.value = '设备会话已退出。';
  } catch (cause) {
    actionError.value = formatApiError(cause, '撤销会话失败。');
  } finally {
    revokingSessionId.value = null;
  }
}

async function revokeOthers() {
  if (otherSessions.value.length === 0) return;
  revokingOthers.value = true;
  actionError.value = '';
  actionMessage.value = '';
  try {
    await revokeOtherSessions();
    sessions.value = sessions.value.filter((session) => session.current);
    actionMessage.value = '其他设备已退出。';
  } catch (cause) {
    actionError.value = formatApiError(cause, '撤销其他会话失败。');
  } finally {
    revokingOthers.value = false;
  }
}

onMounted(loadSessions);
</script>

<template>
  <div class="session-management" aria-labelledby="sessions-heading">
    <div class="session-panel-header">
      <div>
        <h3 id="sessions-heading">登录会话</h3>
        <p class="section-description">查看已登录设备，及时退出不再使用的会话。</p>
      </div>
      <ShieldCheck :size="19" class="section-icon" aria-hidden="true" />
    </div>
    <div class="session-actions">
      <button
        class="button button-ghost button-small"
        type="button"
        :disabled="loading || revokingOthers || otherSessions.length === 0"
        @click="revokeOthers"
      >
        <X :size="15" aria-hidden="true" />撤销其他会话
      </button>
      <button
        class="icon-button"
        type="button"
        aria-label="刷新登录会话"
        title="刷新"
        :disabled="loading || revokingOthers || revokingSessionId !== null"
        @click="loadSessions"
      >
        <RefreshCw :size="16" :class="{ spinning: loading }" aria-hidden="true" />
      </button>
    </div>

    <div v-if="loading" class="session-loading" role="status" aria-busy="true">
      正在加载登录会话…
    </div>
    <div v-else-if="error" class="session-error">
      <p class="form-error" role="alert">{{ error }}</p>
      <button class="button button-ghost button-small" type="button" @click="loadSessions">
        重试
      </button>
    </div>
    <p v-else-if="sessions.length === 0" class="empty-state">暂无登录会话。</p>
    <ul v-else class="session-list">
      <li v-for="session in sessions" :key="session.id" class="session-list-item">
        <div class="session-details">
          <div class="session-device">
            <strong>{{ session.deviceLabel }}</strong>
            <span v-if="session.current" class="status-badge">当前设备</span>
          </div>
          <p>创建于 {{ formatTimestamp(session.createdAt) }}</p>
          <p>最近使用 {{ formatTimestamp(session.lastUsedAt) }}</p>
        </div>
        <button
          v-if="!session.current"
          class="text-button danger"
          type="button"
          :aria-label="`撤销 ${session.deviceLabel} 的会话`"
          :disabled="revokingOthers || revokingSessionId !== null"
          @click="revokeOne(session)"
        >
          {{ revokingSessionId === session.id ? '退出中…' : '撤销' }}
        </button>
      </li>
    </ul>
    <p v-if="actionMessage" class="form-success" role="status">{{ actionMessage }}</p>
    <p v-if="actionError" class="form-error" role="alert">{{ actionError }}</p>
  </div>
</template>
