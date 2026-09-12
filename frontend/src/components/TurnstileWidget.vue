<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { TURNSTILE_SITE_KEY } from '../api';
import { loadTurnstileScript } from '../utils/turnstile';

const props = withDefaults(
  defineProps<{
    siteKey?: string;
    action?: string;
  }>(),
  {
    siteKey: TURNSTILE_SITE_KEY,
    action: 'account-recovery',
  },
);

const emit = defineEmits<{
  token: [token: string];
  expired: [];
  error: [];
}>();

const container = ref<HTMLElement | null>(null);
let widgetId: string | number | null = null;
let unmounted = false;

async function renderWidget() {
  if (!props.siteKey || !container.value) return;
  try {
    await loadTurnstileScript();
    if (unmounted || !container.value || !window.turnstile) return;
    widgetId = window.turnstile.render(container.value, {
      sitekey: props.siteKey,
      action: props.action,
      callback: (token) => emit('token', token),
      'expired-callback': () => emit('expired'),
      'error-callback': () => emit('error'),
    });
  } catch {
    emit('error');
  }
}

function reset() {
  if (widgetId !== null) window.turnstile?.reset(widgetId);
}

defineExpose({ reset });

onMounted(() => {
  void renderWidget();
});

onUnmounted(() => {
  unmounted = true;
  if (widgetId !== null) window.turnstile?.remove?.(widgetId);
  widgetId = null;
});
</script>

<template>
  <div v-if="siteKey" ref="container" class="turnstile-widget" data-turnstile-widget />
</template>
