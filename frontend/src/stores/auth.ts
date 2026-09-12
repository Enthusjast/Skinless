import { defineStore } from 'pinia';
import {
  changePassword,
  completeEmailChange,
  createProfile,
  clearCsrfToken,
  deleteAsset,
  deleteProfile,
  getProfiles,
  getUserProfile,
  login as loginWithCookies,
  logout as logoutWithCookies,
  renameProfile,
  requestAccountDeletion,
  resendEmailChange,
  resendPasswordReset,
  resendRegistration,
  startEmailChange,
  startPasswordReset,
  startRegistration,
  setCsrfToken,
  setDefaultProfile,
  uploadAsset,
  verifyPasswordReset,
  verifyRegistration,
  type ApiProfile,
  type ApiUser,
  type ProfileCollection,
} from '../api';

const SESSION_KEY = 'skinless.session';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null as ApiUser | null,
    profiles: [] as ApiProfile[],
    defaultProfileId: null as string | null,
    initialized: false,
    loading: false,
  }),
  getters: {
    isAuthenticated: (state) => Boolean(state.user),
    isAdmin: (state) => state.user?.role === 'admin',
    profile: (state): ApiProfile | null => state.user?.profile ?? null,
    availableProfiles: (state): ApiProfile[] =>
      state.profiles.length > 0 && state.user
        ? state.profiles
        : state.user?.profile
          ? [state.user.profile]
          : [],
  },
  actions: {
    syncProfileState(response: { user: ApiUser } & Partial<ProfileCollection>) {
      this.user = response.user;
      this.profiles = response.profiles?.length
        ? response.profiles
        : response.user.profile
          ? [response.user.profile]
          : [];
      this.defaultProfileId = response.defaultProfileId ?? response.user.profile?.id ?? null;
    },
    clearSession() {
      this.user = null;
      this.profiles = [];
      this.defaultProfileId = null;
      clearCsrfToken();
      localStorage.removeItem(SESSION_KEY);
    },
    async initialize() {
      if (this.initialized) return;
      this.initialized = true;
      localStorage.removeItem(SESSION_KEY);
      try {
        this.syncProfileState(await getUserProfile());
      } catch {
        this.clearSession();
      }
    },
    async login(email: string, password: string, turnstileToken?: string) {
      this.loading = true;
      try {
        const session = await loginWithCookies(email, password, turnstileToken);
        setCsrfToken(session.csrfToken);
        this.syncProfileState(session);
      } catch (cause) {
        this.clearSession();
        throw cause;
      } finally {
        this.loading = false;
      }
    },
    async registerStart(
      email: string,
      password: string,
      name: string,
      inviteCode?: string,
      turnstileToken?: string,
    ) {
      return startRegistration(email, password, name, inviteCode, turnstileToken);
    },
    async registerVerify(challengeId: string, code: string) {
      return verifyRegistration(challengeId, code);
    },
    async registerResend(challengeId: string) {
      return resendRegistration(challengeId);
    },
    async startPasswordReset(email: string, turnstileToken?: string) {
      return startPasswordReset(email, turnstileToken);
    },
    async verifyPasswordReset(challengeId: string, code: string, newPassword: string) {
      return verifyPasswordReset(challengeId, code, newPassword);
    },
    async resendPasswordReset(challengeId: string, turnstileToken?: string) {
      return resendPasswordReset(challengeId, turnstileToken);
    },
    async startEmailChange(currentPassword: string, newEmail: string, turnstileToken?: string) {
      if (!this.user) throw new Error('Not authenticated');
      return startEmailChange(currentPassword, newEmail, turnstileToken);
    },
    async resendEmailChange(challengeId: string, turnstileToken?: string) {
      if (!this.user) throw new Error('Not authenticated');
      return resendEmailChange(challengeId, turnstileToken);
    },
    async completeEmailChange(challengeId: string, code: string, currentPassword: string) {
      if (!this.user) throw new Error('Not authenticated');
      const response = await completeEmailChange(challengeId, code, currentPassword);
      this.user = response.user;
      return response.user;
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
    async requestAccountDeletion(currentPassword: string, confirmation: string) {
      if (!this.user) throw new Error('Not authenticated');
      return requestAccountDeletion(currentPassword, confirmation);
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
    async loadProfiles() {
      const collection = await getProfiles();
      this.applyProfileCollection(collection);
      return collection;
    },
    applyProfileCollection(collection: ProfileCollection) {
      this.profiles = collection.profiles;
      this.defaultProfileId = collection.defaultProfileId;
    },
    async createProfile(name: string) {
      if (!this.user) throw new Error('Not authenticated');
      const result = await createProfile(name);
      this.applyProfileCollection(result);
      return result.profile;
    },
    async renameProfile(profileId: string, name: string) {
      if (!this.user) throw new Error('Not authenticated');
      const result = await renameProfile(profileId, name);
      this.applyProfileCollection(result);
      if (this.user.profile.id === profileId) this.user.profile = result.profile;
      return result.profile;
    },
    async deleteProfile(profileId: string) {
      if (!this.user) throw new Error('Not authenticated');
      await deleteProfile(profileId);
      this.syncProfileState(await getUserProfile());
    },
    async setDefaultProfile(profileId: string) {
      if (!this.user) throw new Error('Not authenticated');
      const result = await setDefaultProfile(profileId);
      this.syncProfileState(result);
      return result.user.profile;
    },
  },
});
