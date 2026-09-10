// 批量导入去重（唯一正确口径）：
//   同一对象（项目 / 专项 / 物料...）**允许**存在多条记录——一个项目会有多条风险点、多条信息，
//   必须逐条保留；只有「所有导入列内容完全一致」的行才视为重复，合并保留第一条。
// 不做「项目名称相同就合并」这类主键级合并，避免把真实的多条信息吞掉。
export function dedupeImportRows(rows, fields) {
  const cols = (fields || []).map(([, field]) => field);
  const seen = new Set();
  const list = [];
  rows.forEach((row) => {
    const key = cols.map((f) => String(row[f] == null ? '' : row[f]).trim()).join('\u0001');
    if (seen.has(key)) return;   // 内容完全重复 → 合并掉
    seen.add(key);
    list.push(row);
  });
  return { rows: list, removed: rows.length - list.length };
}
