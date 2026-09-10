import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { apiDelete, apiGet, apiPost, apiPut } from '../api/client';
import { useAuth } from '../stores/auth';
import { useMeta } from '../stores/meta';
import { confirmDialog, toast } from '../stores/ui';
import Modal from '../components/ui/Modal';
import Pagination from '../components/ui/Pagination';
import { ExportButton, ImportModal } from '../components/ui/ImportExport';
import { StatusBadge } from '../components/ui/Badge';
import SupplierSelect from '../components/ui/SupplierSelect';

// 图表按需懒加载（看板子界面才拉取 echarts chunk）
const EChart = lazy(() => import('../components/charts/EChart'));

function ChartView({ option }) {
  return (
    <Suspense fallback={<div style={{ height: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: 13 }}>图表加载中…</div>}>
      <EChart option={option} />
    </Suspense>
  );
}

const PAGE_SIZE = 10;
const MOD_COLORS = { 绿区: '#10b981', 黄区: '#f59e0b', 红区: '#ef4444' };
const SUP_COLORS = { 合作中: '#10b981', 暂停: '#f59e0b', 淘汰: '#ef4444' };

function gradeBadge(status) {
  const cls = { 合作中: 'done', 暂停: 'doc-pending', 淘汰: 'dead' }[status] || '';
  return <span className={'badge ' + cls}>{status || '-'}</span>;
}

// ---------- ECharts option 构造（迁移自 selection.js 各 renderCharts） ----------
function donutOption(rows, colors) {
  return {
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: { bottom: 0, textStyle: { fontSize: 12 } },
    series: [{
      type: 'pie', radius: ['38%', '65%'], center: ['50%', '45%'],
      itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
      label: { formatter: '{b}\n{c}', fontSize: 12 },
      data: rows.map((s) => ({ name: s.name, value: s.value, itemStyle: { color: colors[s.name] } })),
    }],
  };
}
function hbarOption(rows, color, fontSize = 12) {
  return {
    tooltip: {},
    grid: { left: 8, right: 20, top: 30, bottom: 30, containLabel: true },
    xAxis: { type: 'value', axisLabel: { fontSize: 11 }, splitLine: { lineStyle: { color: '#f1f5f9' } } },
    yAxis: { type: 'category', data: rows.map((c) => c.name), axisLabel: { fontSize } },
    series: [{
      type: 'bar', barMaxWidth: 26,
      data: rows.map((c) => c.value),
      itemStyle: { color, borderRadius: [0, 6, 6, 0] },
      label: { show: true, position: 'right', fontSize: 11 },
    }],
  };
}

export default function Selection() {
  const hasPerm = useAuth((s) => s.hasPerm);
  const meta = useMeta(useShallow((s) => ({ statuses: s.statuses, categories: s.categories, suppliers: s.suppliers })));
  const ensureMeta = useMeta((s) => s.ensure);

  const [tab, setTab] = useState('candidates');

  // ---------- 候选供应商（AVL 清单） ----------
  const [candAll, setCandAll] = useState([]);
  const [candKeyword, setCandKeyword] = useState('');
  const [candCat, setCandCat] = useState('');
  const [candStatus, setCandStatus] = useState('');
  const [candPage, setCandPage] = useState(1);

  // ---------- 三四级物料清单 ----------
  const [keyword, setKeyword] = useState('');
  const [filters, setFilters] = useState({ category: '', status: '', supplier: '' });
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [checked, setChecked] = useState(() => new Set());
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ name: '', supplier: '', model: '', status: '' });
  const [busy, setBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // ---------- 看板 ----------
  const [matStats, setMatStats] = useState(null);
  const [supStats, setSupStats] = useState(null);
  const [boardSup, setBoardSup] = useState([]);

  const loadMats = useCallback(async (p = 1, f = filters, kw = keyword) => {
    const qs = new URLSearchParams({ page: p, pageSize: PAGE_SIZE, keyword: kw.trim(), ...f });
    try {
      const data = await apiGet('/api/materials?' + qs.toString());
      setRows(data.items || []);
      setTotal(data.total || 0);
      setPage(p);
      setChecked(new Set());
    } catch (e) { toast(e.message, 'error'); }
  }, [filters, keyword]);

  const loadCands = useCallback(async () => {
    try {
      const data = await apiGet('/api/suppliers');
      setCandAll(data.items || []);
    } catch (e) { toast(e.message, 'error'); }
  }, []);

  const loadStats = useCallback(async () => {
    try { setMatStats(await apiGet('/api/stats')); } catch (e) { toast(e.message, 'error'); }
  }, []);
  const loadSupBoard = useCallback(async () => {
    try {
      const [st, list] = await Promise.all([apiGet('/api/suppliers/stats'), apiGet('/api/suppliers')]);
      setSupStats(st);
      setBoardSup((list.items || []).slice(0, 20));
    } catch (e) { toast(e.message, 'error'); }
  }, []);

  useEffect(() => { ensureMeta().catch(() => {}); }, [ensureMeta]);
  useEffect(() => { loadMats(1); loadCands(); }, [loadMats, loadCands]);

  const applyMats = (e) => {
    if (e) e.preventDefault();
    const f = { ...filters };
    setFilters(f); loadMats(1, f, keyword);
  };
  const resetMats = () => {
    setKeyword('');
    setFilters({ category: '', status: '', supplier: '' });
    loadMats(1, { category: '', status: '', supplier: '' }, '');
  };

  // ---------- 候选筛选（全量拉取后前端过滤，原实现即如此） ----------
  const candCats = useMemo(() => {
    const cats = (meta.categories || []).slice();
    const extra = [...new Set(candAll.map((s) => s.material_type).filter(Boolean))].filter((c) => !cats.includes(c));
    return [...cats, ...extra];
  }, [meta.categories, candAll]);
  const candStatuses = useMemo(() => [...new Set(candAll.map((s) => s.status).filter(Boolean))].sort(), [candAll]);

  const filteredCands = useMemo(() => {
    const kw = candKeyword.trim().toLowerCase();
    return candAll.filter((s) => {
      if (candCat && s.material_type !== candCat) return false;
      if (candStatus && s.status !== candStatus) return false;
      if (kw && !String(s.name || '').toLowerCase().includes(kw)) return false;
      return true;
    });
  }, [candAll, candKeyword, candCat, candStatus]);
  const candTotalPages = Math.max(1, Math.ceil(filteredCands.length / PAGE_SIZE));
  const safeCandPage = Math.min(candPage, candTotalPages);
  const candSlice = filteredCands.slice((safeCandPage - 1) * PAGE_SIZE, safeCandPage * PAGE_SIZE);

  const applyCands = () => { setCandPage(1); };
  const resetCands = () => { setCandKeyword(''); setCandCat(''); setCandStatus(''); setCandPage(1); };

  const pageIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const allChecked = pageIds.length > 0 && pageIds.every((id) => checked.has(id));
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

  // ---------- 物料 新增/编辑 ----------
  const openAdd = () => { setEditingId(null); setForm({ name: '', supplier: '', model: '', status: meta.statuses[0] || '黄区' }); setModalOpen(true); };
  const openEdit = (r) => { setEditingId(r.id); setForm({ name: r.name || '', supplier: r.supplier || '', model: r.model || '', status: r.status || '' }); setModalOpen(true); };

  const saveMaterial = async () => {
    if (!form.name.trim()) { toast('物料品类不能为空', 'error'); return; }
    setBusy(true);
    try {
      const body = { name: form.name.trim(), supplier: form.supplier.trim(), model: form.model.trim(), status: form.status };
      if (editingId) { await apiPut('/api/materials/' + editingId, body); toast('已保存', 'success'); }
      else { await apiPost('/api/materials', body); toast('新增成功', 'success'); setPage(1); }
      setModalOpen(false);
      loadMats(editingId ? page : 1);
      ensureMeta().catch(() => {});
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  const removeMaterial = async (id) => {
    if (!await confirmDialog('确定删除该物料吗？删除后不可恢复。')) return;
    try {
      await apiDelete('/api/materials/' + id);
      toast('已删除', 'success');
      loadMats(page);
      ensureMeta().catch(() => {});
    } catch (e) { toast(e.message, 'error'); }
  };

  const batchDelete = async () => {
    const ids = [...checked];
    if (!ids.length) { toast('请先勾选要删除的物料', 'error'); return; }
    if (!await confirmDialog(`确定删除选中的 ${ids.length} 条物料？删除后不可恢复。`)) return;
    let ok = 0;
    try {
      for (const id of ids) { const res = await fetch(`/api/materials/${id}`, { method: 'DELETE' }); if (res.ok) ok++; }
      toast(`已删除 ${ok} 条`, ok === ids.length ? 'success' : 'error');
      loadMats(page);
      ensureMeta().catch(() => {});
    } catch (e) { toast(e.message, 'error'); }
  };

  // ---------- 看板 Tab ----------
  const openBoard = () => {
    setTab('board');
    loadStats();
    loadSupBoard();
  };
  const refreshBoard = () => { loadStats(); loadSupBoard(); };
  const can = (code) => hasPerm(code);

  const ms = matStats || {};
  const ss = supStats || {};
  const byName = (rows, name) => ((rows || []).find((r) => r.name === name) || {}).value || 0;

  const matChart = useMemo(() => ({
    status: donutOption(ms.byStatus || [], MOD_COLORS),
    category: hbarOption(ms.byCategory || [], '#3b82f6'),
    supplier: hbarOption(ms.bySupplier || [], '#10b981'),
  }), [ms]);
  const supChart = useMemo(() => ({
    status: donutOption(ss.byStatus || [], SUP_COLORS),
    category: hbarOption(ss.byCategory || [], '#8b5cf6'),
  }), [ss]);

  const exportQuery = () => new URLSearchParams({ keyword: keyword.trim(), category: filters.category, status: filters.status, supplier: filters.supplier });

  const StatCards = ({ items }) => (
    <div className="stat-grid">
      {items.map(([label, value, hint, accent]) => (
        <div className={'stat-card ' + (accent || '')} key={label}>
          <div className="label">{label}</div>
          <div className="value">{value}</div>
          <div className="hint">{hint}</div>
        </div>
      ))}
    </div>
  );
  const SupBadge = gradeBadge;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>选型</h1>
          <div className="desc">物料汇总、选型查重与整体看板</div>
        </div>
      </div>

      <div className="sub-tabs">
        <button className={'sub-tab' + (tab === 'candidates' ? ' active' : '')} onClick={() => setTab('candidates')}>🏭 一、供应商AVL清单</button>
        <button className={'sub-tab' + (tab === 'materials' ? ' active' : '')} onClick={() => setTab('materials')}>📋 二、三四级物料清单</button>
        <button className={'sub-tab' + (tab === 'board' ? ' active' : '')} onClick={openBoard}>📊 三、分析看板</button>
      </div>

      {/* 子界面一：候选供应商 */}
      {tab === 'candidates' && (
        <section className="sub-panel active">
          <div className="card">
            <div className="card-title">供应商AVL清单</div>
            <form className="toolbar" onSubmit={(e) => { e.preventDefault(); applyCands(); }}>
              <input className="search-input" placeholder="搜索供应商..." value={candKeyword} onChange={(e) => setCandKeyword(e.target.value)} />
              <select value={candCat} onChange={(e) => { setCandCat(e.target.value); setCandPage(1); }}>
                <option value="">全部物料品类</option>
                {candCats.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={candStatus} onChange={(e) => { setCandStatus(e.target.value); setCandPage(1); }}>
                <option value="">全部状态</option>
                {candStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <button type="submit" className="btn">查询</button>
              <button type="button" className="btn" onClick={resetCands}>重置</button>
            </form>
            <div className="table-wrap">
              <table className="data-table" style={candSlice.length ? undefined : { display: 'none' }}>
                <thead>
                  <tr><th>供应商</th><th>物料品类</th><th>状态</th><th>工厂地址</th><th>产品类型</th></tr>
                </thead>
                <tbody>
                  {candSlice.map((s) => (
                    <tr key={s.id}>
                      <td><b>{s.name}</b></td>
                      <td>{s.material_type || '-'}</td>
                      <td>{SupBadge(s.status)}</td>
                      <td className="spec" title={s.address || ''}>{s.address || '-'}</td>
                      <td className="spec" title={s.product_type || ''}>{s.product_type || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!candSlice.length && (
                <div className="empty">
                  <div className="big">🏭</div>
                  <div>暂无候选供应商，请先到「供应商信息」页面录入</div>
                </div>
              )}
            </div>
            <Pagination page={safeCandPage} total={filteredCands.length} pageSize={PAGE_SIZE} onGo={setCandPage} />
          </div>
        </section>
      )}

      {/* 子界面二：三四级物料清单 */}
      {tab === 'materials' && (
        <section className="sub-panel active">
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, margin: '0 0 12px', flexWrap: 'wrap' }}>
              {can('action:import') && <button className="btn" onClick={() => setImportOpen(true)}>📥 批量导入</button>}
              {can('action:export') && <ExportButton api="materials" entity="物料" label="📤 Excel 导出" filename="物料台账" query={exportQuery()} />}
              {can('action:delete') && <button className="btn btn-danger" onClick={batchDelete}>🗑 批量删除</button>}
              {can('action:create') && <button className="btn btn-primary" onClick={openAdd}>＋ 新增物料</button>}
            </div>
            <form className="toolbar" onSubmit={applyMats}>
              <input className="search-input" placeholder="搜索编码 / 物料品类 / 型号 / 供应商..." value={keyword} onChange={(e) => setKeyword(e.target.value)} />
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
              <button type="button" className="btn" onClick={resetMats}>重置</button>
            </form>
            <div className="table-wrap">
              <table className="data-table" style={rows.length ? undefined : { display: 'none' }}>
                <thead>
                  <tr>
                    <th style={{ width: 36 }}><input type="checkbox" checked={allChecked} onChange={toggleAll} title="全选本页" /></th>
                    <th>编码</th><th>物料品类</th><th>型号规格</th><th>分类</th><th>供应商</th><th>认证状态</th><th>操作</th>
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
                      <td><StatusBadge v={r.status} /></td>
                      <td>
                        <div className="actions">
                          {can('action:edit') && <button className="btn btn-sm" onClick={() => openEdit(r)}>编辑</button>}
                          {can('action:delete') && <button className="btn btn-sm btn-danger" onClick={() => removeMaterial(r.id)}>删除</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!rows.length && (
                <div className="empty">
                  <div className="big">📭</div>
                  <div>暂无物料数据，点击上方「新增物料」开始录入</div>
                </div>
              )}
            </div>
            <Pagination page={page} total={total} pageSize={PAGE_SIZE} onGo={(p) => loadMats(p)} />
          </div>
        </section>
      )}

      {/* 子界面三：看板 */}
      {tab === 'board' && (
        <section className="sub-panel active">
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
            <button className="btn" onClick={refreshBoard}>🔄 刷新</button>
          </div>

          <div className="board-section">
            <div className="board-section-title">一、供应商看板</div>
            <StatCards items={[
              ['供应商总数', ss.total ?? '-', '已录入供应商合计', 'accent-blue'],
              ['合作中', byName(ss.byStatus, '合作中'), '当前合作供应商', 'accent-green'],
              ['暂停', byName(ss.byStatus, '暂停'), '合作暂停中', 'accent-amber'],
              ['淘汰', byName(ss.byStatus, '淘汰'), '已淘汰供应商', 'accent-red'],
              ['物料品类数', (ss.byCategory || []).length, '覆盖的物料品类', ''],
            ]} />
            <div className="chart-grid">
              <div className="card">
                <div className="card-title">供应商状态分布</div>
                {(ss.byStatus || []).length ? <ChartView option={supChart.status} /> : <div className="empty"><div className="big">📭</div><div>暂无数据</div></div>}
              </div>
              <div className="card">
                <div className="card-title">供应商物料品类分布</div>
                {(ss.byCategory || []).length ? <ChartView option={supChart.category} /> : <div className="empty"><div className="big">📭</div><div>暂无数据</div></div>}
              </div>
            </div>
            <div className="card">
              <div className="card-title">供应商列表</div>
              <div className="table-wrap">
                <table className="data-table" style={boardSup.length ? undefined : { display: 'none' }}>
                  <thead>
                    <tr><th>供应商</th><th>物料品类</th><th>状态</th><th>工厂地址</th><th>产品类型</th></tr>
                  </thead>
                  <tbody>
                    {boardSup.map((s) => (
                      <tr key={s.id}>
                        <td><b>{s.name}</b></td>
                        <td>{s.material_type || '-'}</td>
                        <td>{SupBadge(s.status)}</td>
                        <td className="spec" title={s.address || ''}>{s.address || '-'}</td>
                        <td className="spec" title={s.product_type || ''}>{s.product_type || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!boardSup.length && (
                  <div className="empty"><div className="big">📭</div><div>暂无供应商数据</div></div>
                )}
              </div>
            </div>
          </div>

          <div className="board-section">
            <div className="board-section-title">二、物料看板</div>
            <StatCards items={[
              ['物料总数', ms.total ?? '-', '已入库物料合计', 'accent-blue'],
              ['绿区', ms.certOk ?? '-', '认证有效期内', 'accent-green'],
              ['黄区', ms.inProgress ?? '-', '认证流程中 / 需关注', 'accent-amber'],
              ['红区', (ms.expired || []).length, '已过期 / 失效 / 淘汰', 'accent-red'],
              ['90天内到期', (ms.expiring || []).length, '需安排重新认证', ''],
            ]} />
            <div className="chart-grid">
              <div className="card">
                <div className="card-title">认证状态分布</div>
                {(ms.byStatus || []).length ? <ChartView option={matChart.status} /> : <div className="empty"><div className="big">📭</div><div>暂无数据</div></div>}
              </div>
              <div className="card">
                <div className="card-title">物料分类分布</div>
                {(ms.byCategory || []).length ? <ChartView option={matChart.category} /> : <div className="empty"><div className="big">📭</div><div>暂无数据</div></div>}
              </div>
              <div className="card">
                <div className="card-title">供应商 TOP10</div>
                {(ms.bySupplier || []).length ? <ChartView option={matChart.supplier} /> : <div className="empty"><div className="big">📭</div><div>暂无数据</div></div>}
              </div>
            </div>
            <div className="card">
              <div className="card-title">最近新增物料</div>
              <div className="table-wrap">
                <table className="data-table" style={(ms.recent || []).length ? undefined : { display: 'none' }}>
                  <thead>
                    <tr><th>编码</th><th>物料品类</th><th>型号</th><th>状态</th><th>申请人</th><th>录入时间</th></tr>
                  </thead>
                  <tbody>
                    {(ms.recent || []).map((r) => (
                      <tr key={r.id}>
                        <td className="code-cell">{r.code}</td>
                        <td><b>{r.name}</b></td>
                        <td>{r.model}</td>
                        <td><StatusBadge v={r.status} /></td>
                        <td>{r.applied_by}</td>
                        <td>{r.created_at}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!(ms.recent || []).length && (
                  <div className="empty"><div className="big">📭</div><div>暂无数据</div></div>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 新增/编辑物料弹窗 */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? '编辑物料' : '新增物料'}
        footer={
          <>
            <button className="btn" onClick={() => setModalOpen(false)}>取消</button>
            <button className="btn btn-primary" disabled={busy} onClick={saveMaterial}>保存</button>
          </>
        }
      >
        <div className="form-grid">
          <div className="form-item half">
            <label>物料品类<span className="req">*</span></label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="必填" />
          </div>
          <div className="form-item half">
            <label>供应商</label>
            <SupplierSelect value={form.supplier} onChange={(v) => setForm({ ...form, supplier: v })} />
          </div>
          <div className="form-item half">
            <label>规格型号</label>
            <input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="如：0805-10K-1%" />
          </div>
          <div className="form-item half">
            <label>认证状态</label>
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              {(meta.statuses || []).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
      </Modal>

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        cfg={{
          api: 'materials',
          entity: '物料',
          requiredLabel: '物料品类',
          fields: [
            ['编码', 'code'], ['物料品类', 'name'], ['型号规格', 'model'], ['分类', 'category'],
            ['供应商', 'supplier'], ['制造商', 'manufacturer'], ['认证状态', 'status'],
          ],
        }}
        onDone={() => { loadMats(page); ensureMeta().catch(() => {}); }}
      />
    </>
  );
}
