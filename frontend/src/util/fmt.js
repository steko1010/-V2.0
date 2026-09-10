// ---------- 格式化 / 到期判断工具（迁移自 common.js） ----------

export function fmtDate(d) {
  if (!d) return '-';
  return d;
}

// 认证到期剩余天数（返回 null | { days, expired, expiring }）
export function expiryInfo(row) {
  if (!row || !row.cert_expire_date) return null;
  const today = new Date();
  const exp = new Date(row.cert_expire_date + 'T00:00:00');
  const days = Math.ceil((exp - today) / 86400000);
  return { days, expired: days < 0, expiring: days >= 0 && days <= 90 };
}
