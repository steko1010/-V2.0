import { create } from 'zustand';
import { apiGet } from '../api/client';

// 元数据缓存（对应 /api/meta）：状态枚举、分类/供应商下拉、文档状态
export const useMeta = create((set, get) => ({
  statuses: [],
  docStatuses: [],
  categories: [],
  suppliers: [],
  loaded: false,

  async ensure() {
    if (get().loaded) return;
    await get().load();
  },

  async load() {
    const m = await apiGet('/api/meta');
    set({
      statuses: m.statuses || [],
      docStatuses: m.docStatuses || [],
      categories: m.categories || [],
      suppliers: m.suppliers || [],
      loaded: true,
    });
  },

  async refresh() {
    await get().load();
  },
}));
