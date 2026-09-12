import { defineStore } from 'pinia';
import {
  changePassword,
  clearCsrfToken,
  deleteAsset,
  getUserProfile,
  login as loginWithCookies,
  logout as logoutWithCookies,
  register,
  setCsrfToken,
  uploadAsset,
  type ApiProfile,
  type ApiUser,
} from '../api';

const SESSION_KEY = 'skinless.session';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null as ApiUser | null,
    initialized: false,
    loading: false,
  }),
  getters: {
    isAuthenticated: (state) => Boolean(state.user),
    isAdmin: (state) => state.user?.role === 'admin',
    profile: (state): ApiProfile | null => state.user?.profile ?? null,
  },
  actions: {
    clearSession() {
      this.user = null;
      clearCsrfToken();
      localStorage.removeItem(SESSION_KEY);
    },
    async initialize() {
      if (this.initialized) return;
      this.initialized = true;
      localStorage.removeItem(SESSION_KEY);
      try {
        this.user = (await getUserProfile()).user;
      } catch {
        this.clearSession();
      }
    },
    async login(email: string, password: string) {
      this.loading = true;
      try {
        const session = await loginWithCookies(email, password);
        setCsrfToken(session.csrfToken);
        this.user = session.user;
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
      const request = logoutWithCookies();
      this.clearSession();
      await request.catch(() => undefined);
    },
    async updatePassword(currentPassword: string, newPassword: string) {
      if (!this.user) throw new Error('Not authenticated');
      await changePassword(currentPassword, newPassword);
      this.clearSession();
    },
    async upload(
      asset: 'skin' | 'cape',
      file: Blob,
      model: 'classic' | 'slim',
      clientHash?: string,
    ) {
      if (!this.user) throw new Error('Not authenticated');
      const result = await uploadAsset(asset, file, model, clientHash);
      this.user.profile = result.profile;
      return result;
    },
    async removeAsset(asset: 'skin' | 'cape') {
      if (!this.user) throw new Error('Not authenticated');
      await deleteAsset(asset);
      if (asset === 'skin') this.user.profile.skinHash = null;
      else this.user.profile.capeHash = null;
    },
  },
});
