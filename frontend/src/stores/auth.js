import { create } from 'zustand';
import { apiGet, apiPost } from '../api/client';

// 当前登录用户 / 会话（对应 common.js 的 window.currentUser 与 /api/me）
// user 结构：{ id, username, display_name, status, is_super, roles, permissions, scopes, isSuper }
export const useAuth = create((set, get) => ({
  user: null,     // null = 未登录
  loaded: false,  // 首次 /api/me 是否已完成
  initing: false,

  async init() {
    if (get().loaded || get().initing) return;
    set({ initing: true });
    try {
      const d = await apiGet('/api/me');
      set({ user: d.user || null });
    } catch {
      set({ user: null });
    } finally {
      set({ loaded: true, initing: false });
    }
  },

  async login(username, password) {
    const d = await apiPost('/api/login', { username, password });
    set({ user: d.user });
  },

  async logout() {
    try { await fetch('/api/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
    set({ user: null });
  },

  hasPerm(code) {
    const u = get().user;
    if (!u) return false;
    if (u.isSuper) return true;
    return (u.permissions || []).includes(code);
  },

  roleText() {
    const u = get().user;
    if (!u) return '';
    if (u.isSuper) return '超级管理员';
    return (u.roles || []).map((r) => r.name).join(' / ') || '用户';
  },
}));
