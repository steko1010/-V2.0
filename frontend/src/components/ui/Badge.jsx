import { expiryInfo } from '../../util/fmt';

// 状态徽章（迁移自 common.js 的 statusBadge/docBadge/expiryBadge）
export function StatusBadge({ v }) {
  const cls = { 绿区: 'done', 黄区: 'test', 红区: 'dead' }[v] || '';
  return <span className={'badge ' + cls}>{v || '-'}</span>;
}

export function DocBadge({ v }) {
  const cls = { 有: 'doc-yes', 无: 'doc-no', 待补: 'doc-pending' }[v] || '';
  return <span className={'badge ' + cls}>{v || '-'}</span>;
}

export function ExpiryBadge({ row }) {
  const info = expiryInfo(row);
  if (!info) return <span className="badge">-</span>;
  if (row.status !== '绿区') return <span className="badge">{row.cert_expire_date}</span>;
  if (info.expired) return <span className="badge badge-danger">已过期 {Math.abs(info.days)}天</span>;
  if (info.expiring) return <span className="badge badge-warn">{info.days}天后到期</span>;
  return <span className="badge">{row.cert_expire_date}</span>;
}
