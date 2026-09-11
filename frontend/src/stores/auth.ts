import { defineStore } from 'pinia';
import {
  authenticate,
  changePassword,
  deleteAsset,
  getUserProfile,
  invalidate,
  register,
  uploadAsset,
  type ApiProfile,
  type ApiUser,
} from '../api';

const SESSION_KEY = 'skinless.session';

interface StoredSession {
  token: string;
  clientToken: string;
}

function newClientToken(): string {
  return crypto.randomUUID();
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: null as string | null,
    clientToken: null as string | null,
    user: null as ApiUser | null,
    initialized: false,
    loading: false,
  }),
  getters: {
    isAuthenticated: (state) => Boolean(state.token && state.user),
    isAdmin: (state) => state.user?.role === 'admin',
    profile: (state): ApiProfile | null => state.user?.profile ?? null,
  },
  actions: {
    persist() {
      if (!this.token || !this.clientToken) return;
      localStorage.setItem(SESSION_KEY, JSON.stringify({ token: this.token, clientToken: this.clientToken } satisfies StoredSession));
    },
    clearSession() {
      this.token = null;
      this.clientToken = null;
      this.user = null;
      localStorage.removeItem(SESSION_KEY);
    },
    async initialize() {
      if (this.initialized) return;
      this.initialized = true;
      const stored = localStorage.getItem(SESSION_KEY);
      if (!stored) return;
      try {
        const session = JSON.parse(stored) as StoredSession;
        if (!session.token || !session.clientToken) throw new Error('Invalid stored session');
        this.token = session.token;
        this.clientToken = session.clientToken;
        this.user = (await getUserProfile(session.token)).user;
      } catch {
        this.clearSession();
      }
    },
    async login(email: string, password: string) {
      this.loading = true;
      try {
        const clientToken = newClientToken();
        const session = await authenticate(email, password, clientToken);
        this.token = session.accessToken;
        this.clientToken = session.clientToken;
        this.persist();
        this.user = (await getUserProfile(session.accessToken)).user;
      } catch (cause) {
        this.clearSession();
        throw cause;
      } finally {
        this.loading = false;
      }
    },
    async register(email: string, password: string, name: string) {
      return register(email, password, name);
    },
    async logout() {
      const token = this.token;
      const clientToken = this.clientToken;
      this.clearSession();
      if (token && clientToken) {
        try {
          await invalidate(token, clientToken);
        } catch {
          // The local session is already cleared; an expired token needs no cleanup.
        }
      }
    },
    async updatePassword(currentPassword: string, newPassword: string) {
      if (!this.token) throw new Error('Not authenticated');
      await changePassword(this.token, currentPassword, newPassword);
      this.clearSession();
    },
    async upload(asset: 'skin' | 'cape', file: Blob, model: 'classic' | 'slim') {
      if (!this.token || !this.user) throw new Error('Not authenticated');
      const result = await uploadAsset(this.token, asset, file, model);
      this.user.profile = result.profile;
      return result;
    },
    async removeAsset(asset: 'skin' | 'cape') {
      if (!this.token || !this.user) throw new Error('Not authenticated');
      await deleteAsset(this.token, asset);
      if (asset === 'skin') this.user.profile.skinHash = null;
      else this.user.profile.capeHash = null;
    },
  },
});
