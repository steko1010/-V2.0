import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiDelete, apiGet, apiPost, apiPut } from '../api/client';
import { useAuth } from '../stores/auth';
import { useMeta } from '../stores/meta';
import { confirmDialog, toast } from '../stores/ui';
import Modal from '../components/ui/Modal';
import Pagination from '../components/ui/Pagination';
import { ExportButton, ImportModal } from '../components/ui/ImportExport';
import SupplierSelect from '../components/ui/SupplierSelect';
import BarList from '../components/charts/BarList';
import TrendChart from '../components/charts/TrendChart';

const PAGE_SIZE = 10;
const RESULTS = ['合格', '有条件合格', '不合格'];
const EMPTY_FORM = { material_type: '', audit_date: '', supplier: '', auditor: '', scope: '', result: '合格' };
// 批量导入模板列（中文列名 ↔ 后端字段，与 server.js AUDIT_FIELDS 对应）
const AUDIT_FIELDS = [
  ['物料品类', 'material_type'], ['时间', 'audit_date'], ['供应商', 'supplier'],
  ['稽核内容', 'scope'], ['稽核结果', 'result'], ['稽核人员', 'auditor'],
];

const RESULT_CLS = { 合格: 'done', 有条件合格: 'cert', 不合格: 'dead' };
const MTL_CLS = { FPC: 'done', CG: 'cert', 背光: 'doc-yes', IC: 'badge-purple' };

function findVal(rows, name) {
  return ((rows || []).find((r) => r.name === name) || {}).value || 0;
}

export default function Audits() {
  const hasPerm = useAuth((s) => s.hasPerm);
  const categories = useMeta((s) => s.categories);
  const ensureMeta = useMeta((s) => s.ensure);

  const [tab, setTab] = useState('audits');
  const [keyword, setKeyword] = useState('');
  const [filters, setFilters] = useState({ keyword: '', materialType: '', result: '' });
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [checked, setChecked] = useState(() => new Set());
  const [stats, setStats] = useState(null);
  // 问题个数趋势粒度：year=年度趋势 / month=月度趋势
  const [trendMode, setTrendMode] = useState('year');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(async (p = 1, f = filters) => {
    const qs = new URLSearchParams({ page: p, pageSize: PAGE_SIZE, ...f });
    try {
      const data = await apiGet('/api/audits?' + qs.toString());
      setRows(data.items || []);
      setTotal(data.total || 0);
      setPage(data.page || p);
      setChecked(new Set());
    } catch (e) { toast(e.message, 'error'); }
  }, [filters]);

  const loadStats = useCallback(async () => {
    try { setStats(await apiGet('/api/audits/stats')); } catch (e) { toast(e.message, 'error'); }
  }, []);

  useEffect(() => { ensureMeta().catch(() => {}); }, [ensureMeta]);
  useEffect(() => { load(1); loadStats(); }, [load, loadStats]);

  const pageIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const allChecked = pageIds.length > 0 && pageIds.every((id) => checked.has(id));

  const afterMutate = () => { load(page); loadStats(); };

  const doQuery = (e) => { if (e) e.preventDefault(); const f = { keyword: keyword.trim(), materialType: filters.materialType, result: filters.result }; setFilters(f); load(1, f); };
  const resetAll = () => { setKeyword(''); const f = { keyword: '', materialType: '', result: '' }; setFilters(f); load(1, f); };

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
  const openAdd = () => { setEditingId(null); setForm({ ...EMPTY_FORM }); setModalOpen(true); };
  const openEdit = (row) => {
    setEditingId(row.id);
    setForm({
      material_type: row.material_type || '',
      audit_date: row.audit_date || '',
      supplier: row.supplier || '',
      auditor: row.auditor || '',
      scope: row.scope || '',
      result: row.result || '合格',
    });
    setModalOpen(true);
  };

  const save = async () => {
    if (!form.material_type) { toast('请选择物料品类', 'error'); return; }
    if (!form.supplier.trim()) { toast('稽核供应商不能为空', 'error'); return; }
    setBusy(true);
    try {
      const body = {
        material_type: form.material_type,
        audit_date: form.audit_date,
        supplier: form.supplier.trim(),
        auditor: form.auditor.trim(),
        scope: form.scope.trim(),
        result: form.result,
      };
      if (editingId) { await apiPut('/api/audits/' + editingId, body); toast('修改成功', 'success'); }
      else { await apiPost('/api/audits', body); toast('新增成功', 'success'); }
      setModalOpen(false);
      afterMutate();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  const removeOne = async (id) => {
    if (!await confirmDialog('确定删除该稽核记录吗？')) return;
    try {
      await apiDelete('/api/audits/' + id);
      toast('已删除', 'success');
      if (rows.length === 1 && page > 1) load(page - 1); else load(page);
      loadStats();
    } catch (e) { toast(e.message, 'error'); }
  };

  const batchDelete = async () => {
    const ids = [...checked];
    if (!ids.length) { toast('请先勾选要删除的稽核记录', 'error'); return; }
    if (!await confirmDialog(`确定删除选中的 ${ids.length} 条稽核记录？`)) return;
    let ok = 0;
    try {
      for (const id of ids) { const res = await fetch(`/api/audits/${id}`, { method: 'DELETE' }); if (res.ok) ok++; }
      toast(`已删除 ${ok} 条`, ok === ids.length ? 'success' : 'error');
      if (rows.length === ids.length && page > 1) load(page - 1); else load(page);
      loadStats();
    } catch (e) { toast(e.message, 'error'); }
  };

  const can = (code) => hasPerm(code);
  const activeTab = (name) => { setTab(name); if (name === 'dashboard') loadStats(); };

  // 看板数据
  const st = stats || {};
  const bySupplier = (st.bySupplier || []).slice(0, 8);
  const isMonthTrend = trendMode === 'month';
  const trend = (isMonthTrend ? st.issueTrendMonth : st.issueTrend) || {};

  return (
    <>
      <div className="page-head">
        <div>
          <h1>稽核</h1>
          <div className="desc">供应商稽核记录：计划、执行结果、得分与整改跟踪</div>
        </div>
      </div>

      <div className="sub-tabs">
        <button className={'sub-tab' + (tab === 'audits' ? ' active' : '')} onClick={() => activeTab('audits')}>📋 一、稽核</button>
        <button className={'sub-tab' + (tab === 'dashboard' ? ' active' : '')} onClick={() => activeTab('dashboard')}>📊 二、分析看板</button>
      </div>

      {tab === 'audits' && (
        <section className="sub-panel active">
          <div className="stat-grid">
            <div className="stat-card accent-blue"><div className="label">稽核总数</div><div className="value">{(st.total || 0)}</div><div className="hint">全部稽核记录</div></div>
            <div className="stat-card accent-green"><div className="label">合格</div><div className="value">{findVal(st.byResult, '合格') + findVal(st.byResult, '有条件合格')}</div><div className="hint">已判定合格</div></div>
            <div className="stat-card accent-red"><div className="label">不合格</div><div className="value">{findVal(st.byResult, '不合格')}</div><div className="hint">需重点跟进</div></div>
          </div>

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, margin: '0 0 12px', flexWrap: 'wrap' }}>
              {can('action:import') && <button className="btn" onClick={() => setImportOpen(true)}>📥 批量导入</button>}
              {can('action:export') && <ExportButton api="audits" entity="稽核记录" />}
              {can('action:delete') && <button className="btn btn-danger" onClick={batchDelete}>🗑 批量删除</button>}
              {can('action:create') && <button className="btn btn-primary" onClick={openAdd}>＋ 新增稽核</button>}
            </div>

            <form className="toolbar" onSubmit={doQuery}>
              <select value={filters.materialType} onChange={(e) => setFilters({ ...filters, materialType: e.target.value })}>
                <option value="">全部物料品类</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <input className="search-input" placeholder="搜索供应商 / 稽核人员 / 内容..." value={keyword} onChange={(e) => setKeyword(e.target.value)} />
              <select value={filters.result} onChange={(e) => setFilters({ ...filters, result: e.target.value })}>
                <option value="">全部结果</option>
                {RESULTS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <button type="submit" className="btn">查询</button>
              <button type="button" className="btn" onClick={resetAll}>重置</button>
            </form>

            <div className="table-wrap">
              <table className="data-table" style={rows.length ? undefined : { display: 'none' }}>
                <thead>
                  <tr>
                    <th style={{ width: 36 }}><input type="checkbox" checked={allChecked} onChange={toggleAll} title="全选本页" /></th>
                    <th>物料品类</th><th>时间</th><th>供应商</th><th>稽核内容</th><th>稽核结果</th><th>稽核人员</th><th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => (
                    <tr key={a.id}>
                      <td><input type="checkbox" checked={checked.has(a.id)} onChange={() => toggleOne(a.id)} /></td>
                      <td>{a.material_type ? <span className={'badge ' + (MTL_CLS[a.material_type] || '')}>{a.material_type}</span> : '-'}</td>
                      <td>{a.audit_date || '-'}</td>
                      <td><b>{a.supplier}</b></td>
                      <td className="flow-cell" title={a.scope}>{a.scope || '-'}</td>
                      <td><span className={'badge ' + (RESULT_CLS[a.result] || '')}>{a.result || '-'}</span></td>
                      <td>{a.auditor || '-'}</td>
                      <td>
                        <div className="actions">
                          {can('action:edit') && <button className="btn btn-sm" onClick={() => openEdit(a)}>编辑</button>}
                          {can('action:delete') && <button className="btn btn-sm btn-danger" onClick={() => removeOne(a.id)}>删除</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!rows.length && (
                <div className="empty">
                  <div className="big">🔎</div>
                  <div>暂无稽核记录，点击右上角「新增稽核」开始录入</div>
                </div>
              )}
            </div>
            <Pagination page={page} total={total} pageSize={PAGE_SIZE} onGo={load} />
          </div>
        </section>
      )}

      {tab === 'dashboard' && (
        <section className="sub-panel active">
          <div className="card">
            <div className="card-title">稽核看板</div>
            <div className="chart-grid">
              <div className="card">
                <div className="card-title">供应商稽核次数</div>
                <BarList rows={bySupplier.map((i) => ({ name: i.name, value: i.count }))} color="#0d9488" />
              </div>
              <div className="card">
                <div className="card-title">问题个数</div>
                <BarList rows={bySupplier.map((i) => ({ name: i.name, value: i.issueCount }))} color="#d97706" />
              </div>
              <div className="card chart-wide">
                <div className="card-title">稽核结果分布</div>
                <BarList rows={st.byResult || []} color="#2563eb" />
              </div>
              <div className="card chart-wide">
                <div className="card-title">
                  <span>问题个数趋势</span>
                  <div className="seg-tabs">
                    <button type="button" className={isMonthTrend ? '' : 'active'} onClick={() => setTrendMode('year')}>年度趋势</button>
                    <button type="button" className={isMonthTrend ? 'active' : ''} onClick={() => setTrendMode('month')}>月度趋势</button>
                  </div>
                </div>
                <TrendChart labels={isMonthTrend ? (trend.months || []) : (trend.years || [])} series={trend.series} />
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 新增/编辑弹窗 */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? '编辑稽核' : '新增稽核'}
        footer={
          <>
            <button className="btn" onClick={() => setModalOpen(false)}>取消</button>
            <button className="btn btn-primary" disabled={busy} onClick={save}>保存</button>
          </>
        }
      >
        <div className="form-grid">
          <div className="form-item half">
            <label>物料品类<span className="req">*</span></label>
            <select value={form.material_type} onChange={(e) => setForm({ ...form, material_type: e.target.value })}>
              <option value="">请选择</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="form-item half">
            <label>时间</label>
            <input type="date" value={form.audit_date} onChange={(e) => setForm({ ...form, audit_date: e.target.value })} />
          </div>
          <div className="form-item half">
            <label>供应商<span className="req">*</span></label>
            <SupplierSelect value={form.supplier} onChange={(v) => setForm({ ...form, supplier: v })} placeholder="请选择供应商（必填）" />
          </div>
          <div className="form-item half">
            <label>稽核人员</label>
            <input value={form.auditor} onChange={(e) => setForm({ ...form, auditor: e.target.value })} placeholder="稽核负责人" />
          </div>
          <div className="form-item full">
            <label>稽核内容</label>
            <textarea value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })} placeholder="如：质量管理体系 / 生产过程稽核 / 来料检验" />
          </div>
          <div className="form-item half">
            <label>稽核结果</label>
            <select value={form.result} onChange={(e) => setForm({ ...form, result: e.target.value })}>
              {RESULTS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </div>
      </Modal>

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        cfg={{ api: 'audits', entity: '稽核', fields: AUDIT_FIELDS, requiredLabel: '供应商' }}
        onDone={afterMutate}
      />
    </>
  );
}
