// 分页条（迁移自 materials.js 的 renderPagination 算法）
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
