import { useCallback, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { apiDelete, apiGet, apiPost, apiPut } from '../api/client';
import { useAuth } from '../stores/auth';
import { useMeta } from '../stores/meta';
import { confirmDialog, toast } from '../stores/ui';
import Modal from '../components/ui/Modal';
import Pagination from '../components/ui/Pagination';
import { DocBadge, ExpiryBadge, StatusBadge } from '../components/ui/Badge';
import SupplierSelect from '../components/ui/SupplierSelect';

const PAGE_SIZE = 10;
const EMPTY_FORM = { name: '', supplier: '', model: '', status: '' };

export default function Materials() {
  const hasPerm = useAuth((s) => s.hasPerm);
  const metaLoaded = useMeta((s) => s.loaded);
  const meta = useMeta(useShallow((s) => ({ statuses: s.statuses, suppliers: s.suppliers, categories: s.categories })));

  const [keyword, setKeyword] = useState('');
  const [filters, setFilters] = useState({ keyword: '', category: '', status: '', supplier: '' });
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [checked, setChecked] = useState(() => new Set());
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  const ensureMeta = useMeta((s) => s.ensure);
  const refreshMeta = useMeta((s) => s.refresh);

  const load = useCallback(async (p = 1, f = filters) => {
    const qs = new URLSearchParams({ page: p, pageSize: PAGE_SIZE, ...f });
    try {
      const data = await apiGet('/api/materials?' + qs.toString());
      setRows(data.items || []);
      setTotal(data.total || 0);
      setPage(p);
      setChecked(new Set());
    } catch (e) { toast(e.message, 'error'); }
  }, [filters]);

  useEffect(() => { ensureMeta().catch(() => {}); }, [ensureMeta]);
  useEffect(() => { load(1); }, [load]);

  const pageIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const allChecked = pageIds.length > 0 && pageIds.every((id) => checked.has(id));

  const applyFilters = (e) => { if (e) e.preventDefault(); const f = { keyword: keyword.trim(), category: filters.category, status: filters.status, supplier: filters.supplier }; setFilters(f); load(1, f); };
  const goPage = (p) => load(p);

  const toggleAll = () => {
    const next = new Set(checked);
    if (allChecked) pageIds.forEach((id) => next.delete(id));
    else pageIds.forEach((id) => next.add(id));
    setChecked(next);
  };
  const toggleOne = (id) => {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id); else next.add(id);
    setChecked(next);
  };

  // ---------- 弹窗表单 ----------
  const openAdd = () => { setEditingId(null); setForm({ ...EMPTY_FORM, status: meta.statuses[0] || '黄区' }); setModalOpen(true); };
  const openEdit = (row) => { setEditingId(row.id); setForm({ name: row.name || '', supplier: row.supplier || '', model: row.model || '', status: row.status || '' }); setModalOpen(true); };

  const save = async () => {
    if (!form.name.trim()) { toast('物料名称不能为空', 'error'); return; }
    setBusy(true);
    try {
      const body = { name: form.name.trim(), supplier: form.supplier.trim(), model: form.model.trim(), status: form.status };
      if (editingId) { await apiPut(`/api/materials/${editingId}`, body); toast('已保存', 'success'); }
      else { await apiPost('/api/materials', body); toast('新增成功', 'success'); }
      setModalOpen(false);
      await load(editingId ? page : 1);
      refreshMeta().catch(() => {});
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  const removeOne = async (id) => {
    if (!await confirmDialog('确定删除该物料吗？删除后不可恢复。')) return;
    try { await apiDelete(`/api/materials/${id}`); toast('已删除', 'success'); await load(page); refreshMeta().catch(() => {}); }
    catch (e) { toast(e.message, 'error'); }
  };

  const batchDelete = async () => {
    const ids = [...checked];
    if (!ids.length) { toast('请先勾选要删除的物料', 'error'); return; }
    if (!await confirmDialog(`确定删除选中的 ${ids.length} 条物料？删除后不可恢复。`)) return;
    let ok = 0;
    try {
      for (const id of ids) { const res = await fetch(`/api/materials/${id}`, { method: 'DELETE' }); if (res.ok) ok++; }
      toast(`已删除 ${ok} 条`, ok === ids.length ? 'success' : 'error');
      await load(page); refreshMeta().catch(() => {});
    } catch (e) { toast(e.message, 'error'); }
  };

  const can = (code) => hasPerm(code);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>物料汇总表</h1>
          <div className="desc">物料开发与认证信息总览，支持搜索、筛选与编辑</div>
        </div>
        {can('action:delete') && (
          <button className="btn btn-danger" onClick={batchDelete}>🗑 批量删除</button>
        )}
        {can('action:create') && (
          <button className="btn btn-primary" onClick={openAdd}>＋ 新增物料</button>
        )}
      </div>

      <div className="card">
        <form className="toolbar" onSubmit={applyFilters}>
          <input
            className="search-input"
            placeholder="搜索编码 / 名称 / 型号 / 供应商..."
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <select value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })}>
            <option value="">全部分类</option>
            {(meta.categories || []).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
            <option value="">全部状态</option>
            {(meta.statuses || []).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={filters.supplier} onChange={(e) => setFilters({ ...filters, supplier: e.target.value })}>
            <option value="">全部供应商</option>
            {(meta.suppliers || []).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button type="submit" className="btn">查询</button>
          <button type="button" className="btn" onClick={() => { setKeyword(''); setFilters({ keyword: '', category: '', status: '', supplier: '' }); load(1, { keyword: '', category: '', status: '', supplier: '' }); }}>重置</button>
        </form>

        <div className="table-wrap">
          <table className="data-table" style={rows.length ? undefined : { display: 'none' }}>
            <thead>
              <tr>
                <th style={{ width: 36 }}><input type="checkbox" checked={allChecked} onChange={toggleAll} title="全选本页" /></th>
                <th>编码</th><th>物料名称</th><th>型号规格</th><th>分类</th>
                <th>供应商</th><th>制造商</th><th>认证状态</th><th>认证到期</th>
                <th>ROHS</th><th>REACH</th><th>申请人</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><input type="checkbox" checked={checked.has(r.id)} onChange={() => toggleOne(r.id)} /></td>
                  <td className="code-cell">{r.code}</td>
                  <td><b>{r.name}</b></td>
                  <td>{r.model}</td>
                  <td>{r.category}</td>
                  <td>{r.supplier}</td>
                  <td>{r.manufacturer}</td>
                  <td><StatusBadge v={r.status} /></td>
                  <td><ExpiryBadge row={r} /></td>
                  <td><DocBadge v={r.rohs} /></td>
                  <td><DocBadge v={r.reach} /></td>
                  <td>{r.applied_by}</td>
                  <td>
                    <div className="actions">
                      {can('action:edit') && <button className="btn btn-sm" onClick={() => openEdit(r)}>编辑</button>}
                      {can('action:delete') && <button className="btn btn-sm btn-danger" onClick={() => removeOne(r.id)}>删除</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && (
            <div className="empty">
              <div className="big">📭</div>
              <div>暂无物料数据，点击右上角「新增物料」开始录入</div>
            </div>
          )}
        </div>
        <Pagination page={page} total={total} pageSize={PAGE_SIZE} onGo={goPage} />
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? '编辑物料' : '新增物料'}
        footer={
          <>
            <button className="btn" onClick={() => setModalOpen(false)}>取消</button>
            <button className="btn btn-primary" disabled={busy} onClick={save}>保存</button>
          </>
        }
      >
        <div className="form-grid">
          <div className="form-item">
            <label>物料名称<span className="req">*</span></label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="必填" />
          </div>
          <div className="form-item">
            <label>供应商</label>
            <SupplierSelect value={form.supplier} onChange={(v) => setForm({ ...form, supplier: v })} />
          </div>
          <div className="form-item">
            <label>规格型号</label>
            <input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="如：0805-10K-1%" />
          </div>
          <div className="form-item">
            <label>认证状态</label>
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              {(meta.statuses || []).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
      </Modal>
    </>
  );
}
