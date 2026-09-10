import { create } from 'zustand';

// 全局轻量 UI 状态：toast 提示 + 命令式确认框（对应 common.js 的 toast/confirmDialog）
let seq = 0;
let timer = null;

export const useUi = create((set, get) => ({
  toast: null, // { msg, type }
  confirm: null, // { msg, title, resolve }

  showToast(msg, type = 'info', duration = 2600) {
    clearTimeout(timer);
    set({ toast: { msg, type } });
    timer = setTimeout(() => set({ toast: null }), duration);
  },

  confirmDialog(msg, title = '请确认') {
    return new Promise((resolve) => set({ confirm: { msg, title, resolve } }));
  },

  resolveConfirm(v) {
    const c = get().confirm;
    if (!c) return;
    c.resolve(!!v);
    set({ confirm: null });
  },
}));

// 模块内可脱离组件直接调用
export const toast = (msg, type, duration) => useUi.getState().showToast(msg, type, duration);
export const confirmDialog = (msg, title) => useUi.getState().confirmDialog(msg, title);
