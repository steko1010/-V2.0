// 分页条（迁移自 materials.js 的 renderPagination 算法）
import { useEffect, useMemo, useState } from 'react';

// 全站列表统一每页行数
export const PAGE_SIZE = 10;

/**
 * 客户端分页：数据已全量在前端时（拉全量 + 前端筛选），按页切片。
 * items     —— 已完成筛选/排序的完整列表
 * resetKeys —— 变化时回到第 1 页（筛选条件、当前标签页等）
 */
export function usePageSlice(items, { pageSize = PAGE_SIZE, resetKeys = [] } = {}) {
  const list = Array.isArray(items) ? items : [];
  const [page, setPage] = useState(1);
  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);

  // 数据变少导致页码越界时自动回退到最后一页
  useEffect(() => { if (page !== safePage) setPage(safePage); }, [page, safePage]);

  // 筛选条件 / 标签页变化时回到第 1 页
  const resetSig = JSON.stringify(resetKeys);
  useEffect(() => { setPage(1); }, [resetSig]);

  const pageItems = useMemo(
    () => list.slice((safePage - 1) * pageSize, safePage * pageSize),
    [list, safePage, pageSize]
  );

  return { page: safePage, setPage, total, totalPages, pageItems, offset: (safePage - 1) * pageSize };
}

export default function Pagination({ page, total, pageSize, onGo }) {
  if (!total) return null;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pages = [];
  const push = (p, label, cls = '') => {
    pages.push(
      p === page ? (
        <button key={label + p} className={cls} disabled>{label}</button>
      ) : (
        <button key={label + p} className={cls} onClick={() => onGo(p)}>{label}</button>
      )
    );
  };
  push(1, '«');
  const start = Math.max(2, page - 2);
  const end = Math.min(totalPages - 1, page + 2);
  for (let i = start; i <= end; i++) push(i, i, i === page ? 'current' : '');
  push(totalPages, '»');

  return (
    <div className="pagination">
      <span>共 {total} 条 · 第 {page}/{totalPages} 页</span>
      {pages}
    </div>
  );
}
