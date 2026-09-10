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

const PAGE_SIZE = 10;
const STATUSES = ['草稿', '生效', '作废'];
const EMPTY_FORM = {
  category: '', name: '', supplier: '', process: '', control_item: '', spec: '',
  method: '', freq: '', device: '', responsible: '', status: '生效', remark: '',
};
// 批量导入模板列（与 server.js QCP_FIELDS / 导出表头一致，无备注列）
const QCP_IMPORT_FIELDS = [
  ['品类', 'category'], ['QCP 名称', 'name'], ['供应商', 'supplier'], ['工序', 'process'],
  ['控制项目', 'control_item'], ['规格要求', 'spec'], ['检验方法', 'method'],
  ['频次', 'freq'], ['检测设备', 'device'], ['责任人', 'responsible'], ['状态', 'status'],
];
const STATUS_CLS = { 草稿: 'doc-pending', 生效: 'done', 作废: 'dead' };
const CAT_CLS = { CG: 'badge-blue', FPC: 'badge-green', 背光: 'badge-amber', IC: 'badge-purple' };

// 编辑弹窗的表单字段布局（[字段, 占位]）
const FORM_ITEMS = [
  ['name', 'QCP 名称', '选填，如：贴片电阻质量控制计划'],
  ['process', '工序', '如：贴装 / 回流焊 / 来料检验'],
  ['control_item', '控制项目', '如：阻值、容值、焊点强度'],
  ['spec', '规格要求', '如：10KΩ ±1%'],
  ['method', '检验方法', '如：万用表测量 / 目视检查'],
  ['freq', '频次', '如：每批 / 每 2 小时'],
  ['device', '检测设备', '如：LCR 表 / 游标卡尺'],
  ['responsible', '责任人', '责任人或岗位'],
];

export default function Qcps() {
  const hasPerm = useAuth((s) => s.hasPerm);
  const categories = useMeta((s) => s.categories);
  const ensureMeta = useMeta((s) => s.ensure);

  const [tab, setTab] = useState('list');
  const [keyword, setKeyword] = useState('');
  const [filters, setFilters] = useState({ keyword: '', status: '', category: '' });
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [checked, setChecked] = useState(() => new Set());
  const [stats, setStats] = useState(null);
  const [dirRefreshing, setDirRefreshing] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // 目录计数（含历史未维护中类的品类）
  const catCountMap = useMemo(
    () => new Map(((stats || {}).byCategory || []).map((r) => [r.name, r.processCount])),
    [stats],
  );
  const dirItems = useMemo(() => {
    const items = [{ name: '' }];
    (categories || []).forEach((c) => items.push({ name: c }));
    const seen = new Set(items.map((i) => i.name));
    for (const name of catCountMap.keys()) {
      if (name && !seen.has(name)) { items.push({ name }); seen.add(name); }
    }
    return items;
  }, [categories, catCountMap]);

  const load = useCallback(async (p = 1, f = filters) => {
    const qs = new URLSearchParams({ page: p, pageSize: PAGE_SIZE });
    if (f.keyword) qs.set('keyword', f.keyword);
    if (f.status) qs.set('status', f.status);
    if (f.category) qs.set('category', f.category);
    try {
      const data = await apiGet('/api/qcps?' + qs.toString());
      setRows(data.items || []);
      setTotal(data.total || 0);
      setPage(data.page || p);
      setChecked(new Set());
    } catch (e) { toast(e.message, 'error'); }
  }, [filters]);

  const loadStats = useCallback(async () => {
    try { setStats(await apiGet('/api/qcps/stats')); } catch (e) { /* 目录/图表刷新失败不阻塞 */ }
  }, []);

  useEffect(() => { ensureMeta().catch(() => {}); }, [ensureMeta]);
  useEffect(() => { load(1); loadStats(); }, [load, loadStats]);

  const pageIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const allChecked = pageIds.length > 0 && pageIds.every((id) => checked.has(id));

  const afterMutate = () => { load(page); loadStats(); };

  const doQuery = (e) => { if (e) e.preventDefault(); apply({ ...filters, keyword: keyword.trim() }); };
  const resetAll = () => { setKeyword(''); apply({ keyword: '', status: '', category: '' }); };
  const apply = (f) => { setFilters(f); load(1, f); };
  const selectDir = (name) => { if (filters.category !== name) apply({ ...filters, category: name }); };
  const refreshDir = async () => {
    setDirRefreshing(true);
    try { await ensureMeta(); } catch (e) { /* 保留现状 */ }
    await loadStats();
    setDirRefreshing(false);
  };

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
  const openAdd = (preCategory) => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, category: preCategory || filters.category || '' });
    setModalOpen(true);
  };
  const openEdit = (row) => {
    setEditingId(row.id);
    setForm({
      category: row.category || '', name: row.name || '', supplier: row.supplier || '',
      process: row.process || '', control_item: row.control_item || '', spec: row.spec || '',
      method: row.method || '', freq: row.freq || '', device: row.device || '',
      responsible: row.responsible || '', status: row.status || '生效', remark: row.remark || '',
    });
    setModalOpen(true);
  };
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    const payload = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, String(v == null ? '' : v).trim()]));
    if (!Object.values(payload).some((v) => v !== '')) { toast('请至少填写一项内容', 'error'); return; }
    setBusy(true);
    try {
      if (editingId) { await apiPut('/api/qcps/' + editingId, payload); toast('修改成功', 'success'); }
      else { await apiPost('/api/qcps', payload); toast('新增成功', 'success'); }
      setModalOpen(false);
      afterMutate();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  const removeOne = async (id) => {
    if (!await confirmDialog('确定删除该 QCP 吗？')) return;
    try {
      await apiDelete('/api/qcps/' + id);
      toast('已删除', 'success');
      if (rows.length === 1 && page > 1) load(page - 1); else load(page);
      loadStats();
    } catch (e) { toast(e.message, 'error'); }
  };

  const batchDelete = async () => {
    const ids = [...checked];
    if (!ids.length) { toast('请先勾选要删除的 QCP', 'error'); return; }
    if (!await confirmDialog(`确定删除选中的 ${ids.length} 条 QCP？`)) return;
    let ok = 0;
    try {
      for (const id of ids) { const res = await fetch(`/api/qcps/${id}`, { method: 'DELETE' }); if (res.ok) ok++; }
      toast(`已删除 ${ok} 条`, ok === ids.length ? 'success' : 'error');
      if (rows.length === ids.length && page > 1) load(page - 1); else load(page);
      loadStats();
    } catch (e) { toast(e.message, 'error'); }
  };

  const can = (code) => hasPerm(code);
  const st = stats || {};
  const activeTab = (name) => { setTab(name); if (name === 'analysis') loadStats(); };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>关键工艺</h1>
          <div className="desc">关键工艺：工序、控制项目、规格要求与检验方法</div>
        </div>
      </div>

      <div className="sub-tabs">
        <button className={'sub-tab' + (tab === 'list' ? ' active' : '')} onClick={() => activeTab('list')}>📋 一、QCP</button>
        <button className={'sub-tab' + (tab === 'analysis' ? ' active' : '')} onClick={() => activeTab('analysis')}>📊 二、分析看板</button>
      </div>

      {tab === 'list' && (
        <section className="sub-panel active">
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, margin: '0 0 12px', flexWrap: 'wrap' }}>
              {can('action:import') && <button className="btn" onClick={() => setImportOpen(true)}>📥 批量导入</button>}
              {can('action:export') && <ExportButton api="qcps" entity="QCP" />}
              {can('action:delete') && <button className="btn btn-danger" onClick={batchDelete}>🗑 批量删除</button>}
              {can('action:create') && <button className="btn btn-primary" onClick={() => openAdd()}>＋ 新增 QCP</button>}
            </div>

            <div className="cat-layout">
              {/* 左侧：品类目录（物料中类） */}
              <aside className="cat-dir">
                <div className="cat-dir-head">
                  <span>🗂 品类目录</span>
                  <button className="cat-dir-refresh" title="刷新目录" disabled={dirRefreshing} onClick={refreshDir}>↻</button>
                </div>
                <div>
                  {dirItems.map((it) => {
                    const { name } = it;
                    const label = name || '全部 QCP';
                    const cnt = name ? (catCountMap.get(name) || 0) : (st.total || 0);
                    return (
                      <div
                        key={label}
                        className={'cat-dir-item' + (filters.category === name ? ' active' : '')}
                        title={label}
                        onClick={() => selectDir(name)}
                      >
                        <span className="cat-ico">{name ? '📁' : '🗂'}</span>
                        <span className="cat-txt">{label}</span>
                        <span className="cat-cnt">{cnt}</span>
                        {name && can('action:create') && (
                          <span
                            className="cat-add"
                            title={'新增到此目录：' + name}
                            onClick={(e) => { e.stopPropagation(); openAdd(name); }}
                          >＋</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </aside>

              {/* 右侧：当前目录下的 QCP 列表 */}
              <div className="cat-main">
                <form className="toolbar" onSubmit={doQuery}>
                  <input className="search-input" placeholder="搜索工序 / 控制项目 / 规格..." value={keyword} onChange={(e) => setKeyword(e.target.value)} />
                  <select value={filters.status} onChange={(e) => apply({ ...filters, status: e.target.value })}>
                    <option value="">全部状态</option>
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <button type="submit" className="btn">查询</button>
                  <button type="button" className="btn" onClick={resetAll}>重置</button>
                </form>

                <div className="table-wrap">
                  <table className="data-table" style={rows.length ? undefined : { display: 'none' }}>
                    <thead>
                      <tr>
                        <th style={{ width: 36 }}><input type="checkbox" checked={allChecked} onChange={toggleAll} title="全选本页" /></th>
                        <th>品类</th><th>工序</th><th>控制项目</th><th>检验方法</th><th>频次</th><th>检测设备</th><th>责任人</th><th>状态</th><th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((q) => (
                        <tr key={q.id}>
                          <td><input type="checkbox" checked={checked.has(q.id)} onChange={() => toggleOne(q.id)} /></td>
                          <td><span className={'badge ' + (CAT_CLS[q.category] || 'badge-gray')}>{q.category || '-'}</span></td>
                          <td>{q.process || '-'}</td>
                          <td>{q.control_item || '-'}</td>
                          <td>{q.method || '-'}</td>
                          <td>{q.freq || '-'}</td>
                          <td>{q.device || '-'}</td>
                          <td>{q.responsible || '-'}</td>
                          <td><span className={'badge ' + (STATUS_CLS[q.status] || '')}>{q.status || '-'}</span></td>
                          <td>
                            <div className="actions">
                              {can('action:edit') && <button className="btn btn-sm" onClick={() => openEdit(q)}>编辑</button>}
                              {can('action:delete') && <button className="btn btn-sm btn-danger" onClick={() => removeOne(q.id)}>删除</button>}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!rows.length && (
                    <div className="empty">
                      <div className="big">📝</div>
                      <div>该目录下暂无 QCP，点击右上角「＋ 新增 QCP」或目录行上的「＋」录入</div>
                    </div>
                  )}
                </div>
                <Pagination page={page} total={total} pageSize={PAGE_SIZE} onGo={load} />
              </div>
            </div>
          </div>
        </section>
      )}

      {tab === 'analysis' && (
        <section className="sub-panel active">
          <div className="card">
            <div className="card-title">QCP 分析 · 按品类</div>
            <div className="chart-grid">
              <div className="card chart-wide">
                <div className="card-title">按品类 · 工序数量</div>
                <BarList
                  rows={(st.byCategory || []).map((r) => ({ name: r.name, value: r.processCount, hint: '工序' }))}
                  color="#7c3aed"
                />
              </div>
            </div>
          </div>
          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-title">QCP 分析</div>
            <div className="chart-grid">
              <div className="card chart-wide">
                <div className="card-title">按工序</div>
                <BarList rows={st.byProcess || []} color="#16a34a" />
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 新增/编辑弹窗 */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? '编辑 QCP' : '新增 QCP'}
        wide
        footer={
          <>
            <button className="btn" onClick={() => setModalOpen(false)}>取消</button>
            <button className="btn btn-primary" disabled={busy} onClick={save}>保存</button>
          </>
        }
      >
        <div className="form-grid">
          <div className="form-item half">
            <label>品类</label>
            <select value={form.category} onChange={(e) => setField('category', e.target.value)}>
              <option value="">请选择</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          {FORM_ITEMS.map(([field, label, ph]) => (
            <div className="form-item half" key={field}>
              <label>{label}</label>
              <input value={form[field]} onChange={(e) => setField(field, e.target.value)} placeholder={ph} />
            </div>
          ))}
          <div className="form-item half">
            <label>供应商</label>
            <SupplierSelect value={form.supplier} onChange={(v) => setField('supplier', v)} />
          </div>
          <div className="form-item half">
            <label>状态</label>
            <select value={form.status} onChange={(e) => setField('status', e.target.value)}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="form-item full">
            <label>备注</label>
            <textarea value={form.remark} onChange={(e) => setField('remark', e.target.value)} placeholder="备注信息" />
          </div>
        </div>
      </Modal>

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        cfg={{ api: 'qcps', entity: 'QCP', fields: QCP_IMPORT_FIELDS }}
        onDone={afterMutate}
      />
    </>
  );
}
