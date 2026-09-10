import { useMeta } from '../../stores/meta';

// 供应商下拉选择：选项统一来源于「供应商信息 › 一、供应商信息」（/api/meta 的 suppliers）。
// 记录中已有、但不在供应商信息表里的历史值会保留为一条附加选项，避免编辑时被静默改掉。
export default function SupplierSelect({ value, onChange, required = false, placeholder = '请选择供应商' }) {
  const suppliers = useMeta((s) => s.suppliers);
  const list = suppliers || [];
  const cur = value || '';
  const orphan = cur && !list.includes(cur) ? cur : '';

  return (
    <select value={cur} required={required} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {orphan && <option value={orphan}>{orphan}（不在供应商信息中）</option>}
      {list.map((s) => <option key={s} value={s}>{s}</option>)}
    </select>
  );
}
