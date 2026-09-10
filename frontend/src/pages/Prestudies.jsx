import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost, apiPut, apiDelete } from '../api/client';
import { useAuth } from '../stores/auth';
import { useMeta } from '../stores/meta';
import { confirmDialog, toast } from '../stores/ui';
import Modal from '../components/ui/Modal';
import Pagination from '../components/ui/Pagination';
import { ExportButton, ImportModal } from '../components/ui/ImportExport';
import SupplierSelect from '../components/ui/SupplierSelect';
import BarList from '../components/charts/BarList';

const PAGE_SIZE = 10;
const EMPTY_FORM = {
  category: '', supplier: '', topic: '', risk: '', progress: '',
  milestone_lx: '', milestone_p1: '', milestone_p2: '', milestone_p3: '', status: '', owner: '',
};
const IMPORT_FIELDS = [
  ['物料品类', 'category'], ['供应商', 'supplier'], ['专项名称', 'topic'], ['风险', 'risk'],
  ['立项', 'milestone_lx'], ['P1', 'milestone_p1'], ['P2', 'milestone_p2'], ['P3', 'milestone_p3'],
  ['状态', 'status'], ['责任人', 'owner'],
];
// 「一、在研项目」的列 = 风险清单表头（含供应商 / 进度措施），导入模板与导出列均与之一致
const RISK_FIELDS = [
  ['物料品类', 'category'], ['供应商', 'supplier'], ['项目名称', 'topic'],
  ['立项', 'milestone_lx'], ['P1', 'milestone_p1'], ['P2', 'milestone_p2'], ['P3', 'milestone_p3'],
  ['风险', 'risk'], ['进度措施', 'progress'], ['状态', 'status'], ['责任人', 'owner'],
];
const ACCENT_CLS = ['accent-blue', 'accent-green', 'accent-amber', 'accent-red'];
// 「一、在研项目」与「二、预研专项」是两份独立清单，共用 prestudies 表、靠 kind 区分：
//   kind = 'research' → 在研项目（风险清单，一行 = 一个风险点，导入时逐行保留，不做合并）
//   kind = ''         → 预研专项
// 查询 / 新增 / 导入都按当前标签页带上 kind，两个清单互不串数据。
const KIND_RESEARCH = 'research';
const KIND_PRESTUDY = '';

// —— 「在研项目风险」判定：在研/进行中的专项（排除已完结、暂停等），且有风险描述 ——
const IN_RESEARCH_MARKS = ['在研', '进行', '研发', '推进'];
const CLOSED_MARKS = ['完成', '结项', '暂停', '搁置', '终止', '取消', '关闭', '风险'];
function isInResearch(row) {
  const s = String(row && row.status || '').trim();
  if (!s) return false;
  if (CLOSED_MARKS.some((k) => s.includes(k))) return false;
  return IN_RESEARCH_MARKS.some((k) => s.includes(k));
}
function hasRiskDesc(row) {
  return String(row && row.risk || '').trim().length > 0;
}

function PreBadge({ cat }) {
  const map = {
    CG: ['CG', 'badge-blue'], FPC: ['FPC', 'badge-green'],
    背光: ['背光', 'badge-amber'], IC: ['IC', 'badge-purple'],
  };
  const [label, cls] = map[cat] || [cat || '-', 'badge-gray'];
  return <span className={'badge ' + cls}>{label}</span>;
}

export default function Prestudies() {
  const hasPerm = useAuth((s) => s.hasPerm);
  const categories = useMeta((s) => s.categories);
  const ensureMeta = useMeta((s) => s.ensure);

  const [tab, setTab] = useState('risk');
  const [keyword, setKeyword] = useState('');
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [checked, setChecked] = useState(() => new Set());
  const [stats, setStats] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [riskAll, setRiskAll] = useState([]);      // 在研风险视图：全量预研专项
  const [riskLoading, setRiskLoading] = useState(false);
  // 「一、在研项目」筛选条件（数据源为全量 riskAll，客户端过滤）
  const [riskKw, setRiskKw] = useState('');
  const [riskCat, setRiskCat] = useState('');
  const [riskStatus, setRiskStatus] = useState('');
  const [riskOwner, setRiskOwner] = useState('');
  const [exporting, setExporting] = useState(false);
  const [statsKind, setStatsKind] = useState('prestudy');   // 看板统计范围：'prestudy' | 'research' | 'all'

  const load = useCallback(async (p = 1, kw = keyword) => {
    const qs = new URLSearchParams({ page: p, pageSize: PAGE_SIZE, kind: KIND_PRESTUDY });
    if (kw.trim()) qs.set('keyword', kw.trim());
    try {
      const data = await apiGet('/api/prestudies?' + qs.toString());
      setRows(data.items || []);
      setTotal(data.total || 0);
      setPage(data.page || p);
      setChecked(new Set());
    } catch (e) { toast(e.message, 'error'); }
  }, [keyword]);

  const loadStats = useCallback(async (kind = KIND_PRESTUDY) => {
    const qs = new URLSearchParams({ kind });
    try { setStats(await apiGet('/api/prestudies/stats?' + qs.toString())); } catch (e) { /* 看板失败不阻塞 */ }
  }, []);

  // 拉取全部在研项目风险点（自动翻页），供「一、在研项目」清单在客户端筛选与统计
  const loadRiskAll = useCallback(async () => {
    setRiskLoading(true);
    try {
      const collected = [];
      let total = Infinity;
      let cursor = 1;
      let tries = 0;
      while (collected.length < total && tries++ < 500) {
        const data = await apiGet(`/api/prestudies?page=${cursor}&pageSize=100&kind=${KIND_RESEARCH}`);
        total = data.total || 0;
        const items = data.items || [];
        collected.push(...items);
        if (!items.length) break;
        cursor = Math.floor(collected.length / (data.pageSize || 100)) + 1;
      }
      setRiskAll(collected);
    } catch (e) { toast(e.message, 'error'); } finally { setRiskLoading(false); }
  }, []);

  useEffect(() => { ensureMeta().catch(() => {}); }, [ensureMeta]);
  useEffect(() => { load(1); loadStats(); loadRiskAll(); }, [load, loadStats, loadRiskAll]);

  const doQuery = (e) => { if (e) e.preventDefault(); load(1, keyword); };
  const resetAll = () => { setKeyword(''); load(1, ''); };
  const activeTab = (name) => {
    setTab(name);
    setChecked(new Set());
    if (name === 'dashboard') loadStats(statsKind);
    if (name === 'risk') loadRiskAll();
  };

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
  const afterMutate = (p) => { load(p || page); loadStats(statsKind); loadRiskAll(); };

  const openAdd = () => { setEditingId(null); setForm(EMPTY_FORM); setModalOpen(true); };
  const openEdit = (r) => {
    setEditingId(r.id);
    setForm({
      category: r.category || '', supplier: r.supplier || '', topic: r.topic || '',
      risk: r.risk || '', progress: r.progress || '',
      milestone_lx: r.milestone_lx || '', milestone_p1: r.milestone_p1 || '',
      milestone_p2: r.milestone_p2 || '', milestone_p3: r.milestone_p3 || '',
      status: r.status || '', owner: r.owner || '',
    });
    setModalOpen(true);
  };
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    const payload = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, String(v == null ? '' : v).trim()]));
    if (!payload.topic) { toast((isRiskTab ? '项目名称' : '专项名称') + '不能为空', 'error'); return; }
    if (!payload.category) { toast('请选择物料品类', 'error'); return; }
    setBusy(true);
    try {
      if (editingId) { await apiPut('/api/prestudies/' + editingId, payload); toast('保存成功', 'success'); }
      else {
        // 新增时按当前标签页决定归属清单（编辑不调整归属，记录不会在清单间跳动）
        payload.kind = isRiskTab ? KIND_RESEARCH : KIND_PRESTUDY;
        await apiPost('/api/prestudies', payload);
        toast('保存成功', 'success');
      }
      setModalOpen(false);
      afterMutate();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  const removeOne = async (id) => {
    if (!await confirmDialog('确定删除该预研专项？')) return;
    try {
      await apiDelete('/api/prestudies/' + id);
      toast('已删除', 'success');
      if (rows.length === 1 && page > 1) load(page - 1); else load(page);
      loadStats();
      loadRiskAll();
    } catch (e) { toast(e.message, 'error'); }
  };

  // 批量删除：两个标签页共用（label 决定提示文案，done 在删除后刷新列表）
  const doBatchDelete = async (label, done) => {
    const ids = [...checked];
    if (!ids.length) { toast(`请先勾选要删除的${label}`, 'error'); return; }
    if (!await confirmDialog(`确定删除选中的 ${ids.length} 个${label}？`)) return;
    let ok = 0;
    try {
      for (const id of ids) { const res = await fetch(`/api/prestudies/${id}`, { method: 'DELETE' }); if (res.ok) ok++; }
      toast(`已删除 ${ok} 条`, ok === ids.length ? 'success' : 'error');
      done(ids.length);
    } catch (e) { toast(e.message, 'error'); }
  };
  const batchDelete = () => doBatchDelete('预研专项', (n) => afterMutate(rows.length === n && page > 1 ? page - 1 : page));
  const batchDeleteRisk = () => doBatchDelete('在研项目', () => afterMutate());

  const can = (code) => hasPerm(code);
  // 「一、在研项目」与「二、预研专项」共用同一个弹窗：
  // 字段名与顺序按当前所在列表的列来，保证「点击编辑」后看到的内容与列表逐列一致。
  const isRiskTab = tab === 'risk';
  const topicLabel = isRiskTab ? '项目名称' : '专项名称';
  const st = stats || {};
  const find = (rows, name) => ((rows || []).find((r) => r.name === name) || {}).value || 0;
  // 清单数据源 = 全部预研专项：新增 / 编辑 / 导入后立即可见，
  // 不再按「在研 + 有风险」做隐式过滤（否则状态为已完成或未填状态的记录会凭空消失）
  const inResearchRows = useMemo(() => riskAll.filter(isInResearch), [riskAll]);
  const riskBoardRows = useMemo(() => inResearchRows.filter(hasRiskDesc), [inResearchRows]);

  // 筛选下拉选项：品类取自元数据并合并数据中已出现的值；状态 / 责任人取自全量清单数据
  const riskCatOptions = useMemo(() => {
    const set = new Set([...(categories || []), ...riskAll.map((r) => r.category).filter(Boolean)]);
    return [...set].sort((a, b) => a.localeCompare(b, 'zh'));
  }, [categories, riskAll]);
  const riskStatusOptions = useMemo(
    () => [...new Set(riskAll.map((r) => r.status).filter(Boolean))].sort(), [riskAll]);
  const riskOwnerOptions = useMemo(
    () => [...new Set(riskAll.map((r) => r.owner).filter(Boolean))].sort(), [riskAll]);

  // 客户端筛选：关键词（项目名称 / 风险 / 进度措施 / 供应商 / 责任人）+ 品类 + 状态 + 责任人
  const riskFiltered = useMemo(() => {
    const kw = riskKw.trim().toLowerCase();
    return riskAll.filter((r) => {
      if (riskCat && r.category !== riskCat) return false;
      if (riskStatus && r.status !== riskStatus) return false;
      if (riskOwner && r.owner !== riskOwner) return false;
      if (kw) {
        const hay = [r.topic, r.risk, r.progress, r.supplier, r.owner]
          .map((v) => String(v || '')).join(' ').toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
  }, [riskAll, riskKw, riskCat, riskStatus, riskOwner]);
  const riskFilterActive = !!(riskKw.trim() || riskCat || riskStatus || riskOwner);
  const riskIds = useMemo(() => riskFiltered.map((r) => r.id), [riskFiltered]);
  const riskAllChecked = riskIds.length > 0 && riskIds.every((id) => checked.has(id));
  const toggleAllRisk = () => {
    const next = new Set(checked);
    if (riskAllChecked) riskIds.forEach((id) => next.delete(id));
    else riskIds.forEach((id) => next.add(id));
    setChecked(next);
  };
  const submitRiskQuery = (e) => { if (e) e.preventDefault(); setChecked(new Set()); loadRiskAll(); };
  const resetRiskQuery = () => {
    setRiskKw(''); setRiskCat(''); setRiskStatus(''); setRiskOwner('');
    setChecked(new Set());
    loadRiskAll();
  };
  // 导出当前筛选结果：列与「风险清单」表头一致（含供应商 / 进度措施）
  const exportRisk = async () => {
    if (!riskFiltered.length) { toast('当前没有可导出的在研项目', 'error'); return; }
    setExporting(true);
    try {
      const XLSX = await import('xlsx');
      const heads = RISK_FIELDS.map(([label]) => label);
      const aoa = [heads, ...riskFiltered.map((r) => RISK_FIELDS.map(([, f]) => (r[f] == null ? '' : r[f])))];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = heads.map((h) => ({ wch: Math.max(12, Math.min(36, String(h).length * 2 + 8)) }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '在研项目');
      const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
      const url = URL.createObjectURL(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `在研项目_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('导出成功', 'success');
    } catch (e) { toast('导出失败：' + e.message, 'error'); } finally { setExporting(false); }
  };
  const riskKpi = [
    ['在研专项', inResearchRows.length, '状态含在研 / 进行 / 研发 / 推进'],
    ['已登记风险', riskBoardRows.length, '在研且风险描述非空'],
    ['风险登记率', inResearchRows.length ? `${Math.round((riskBoardRows.length / inResearchRows.length) * 100)}%` : '0%', '有风险在研 ÷ 在研专项总数'],
  ];
  // 看板统计范围文案（两份清单独立统计，不混在一起）
  const statsRangeLabel = statsKind === 'research'
    ? '在研项目风险清单'
    : (statsKind === 'all' ? '两份清单合计' : '全部预研专项');
  const kpi = [
    [statsKind === 'research' ? '风险点总数' : '专项总数', st.total || 0, statsRangeLabel],
    ['进行中', find(st.byStatus, '进行中') + find(st.byStatus, '研发中') + find(st.byStatus, '推进中'), '正在推进'],
    ['已完成', find(st.byStatus, '已完成') + find(st.byStatus, '完成') + find(st.byStatus, '结项'), '已结项'],
    ['暂停/搁置', find(st.byStatus, '暂停') + find(st.byStatus, '搁置') + find(st.byStatus, '风险'), '暂停或风险状态'],
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>项目</h1>
        </div>
      </div>

      <div className="sub-tabs">
        <button className={'sub-tab' + (tab === 'risk' ? ' active' : '')} onClick={() => activeTab('risk')}>🚨 一、在研项目</button>
        <button className={'sub-tab' + (tab === 'list' ? ' active' : '')} onClick={() => activeTab('list')}>📋 二、预研专项</button>
        <button className={'sub-tab' + (tab === 'dashboard' ? ' active' : '')} onClick={() => activeTab('dashboard')}>📊 三、分析看板</button>
      </div>

      {tab === 'risk' && (
        <section className="sub-panel active">
          <div className="stat-grid">
            {riskKpi.map(([label, value, hint], i) => (
              <div className={'stat-card ' + ACCENT_CLS[i]} key={label}>
                <div className="label">{label}</div>
                <div className="value">{value}</div>
                <div className="hint">{hint}</div>
              </div>
            ))}
          </div>
          <div className="card">
            <div className="card-title">
              <span>风险清单</span>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {can('action:import') && <button className="btn" onClick={() => setImportOpen(true)}>📥 批量导入</button>}
                {can('action:export') && <button className="btn" disabled={exporting} onClick={exportRisk}>{exporting ? '导出中...' : '📤 批量导出'}</button>}
                {can('action:delete') && <button className="btn btn-danger" onClick={batchDeleteRisk}>🗑 批量删除</button>}
                {can('action:create') && <button className="btn btn-primary" onClick={openAdd}>＋ 新增项目</button>}
              </div>
            </div>
            <form className="toolbar" onSubmit={submitRiskQuery}>
              <input className="search-input" placeholder="搜索项目名称 / 风险 / 进度措施 / 供应商 / 责任人" value={riskKw} onChange={(e) => setRiskKw(e.target.value)} />
              <select value={riskCat} onChange={(e) => setRiskCat(e.target.value)}>
                <option value="">全部物料品类</option>
                {riskCatOptions.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={riskStatus} onChange={(e) => setRiskStatus(e.target.value)}>
                <option value="">全部状态</option>
                {riskStatusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={riskOwner} onChange={(e) => setRiskOwner(e.target.value)}>
                <option value="">全部责任人</option>
                {riskOwnerOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <button type="submit" className="btn">查询</button>
              <button type="button" className="btn" onClick={resetRiskQuery}>重置</button>
            </form>
            <div className="table-wrap">
              <table className="data-table" style={(riskFiltered.length || riskLoading) ? undefined : { display: 'none' }}>
                <thead>
                  <tr>
                    <th style={{ width: 36 }}><input type="checkbox" checked={riskAllChecked} onChange={toggleAllRisk} title="全选" /></th>
                    <th>序号</th><th>物料品类</th><th>供应商</th><th>项目名称</th><th>立项</th><th>P1</th><th>P2</th><th>P3</th><th>风险</th><th>进度措施</th><th>状态</th><th>责任人</th><th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {riskLoading && !riskFiltered.length && (
                    <tr><td colSpan={14}>风险数据加载中...</td></tr>
                  )}
                  {riskFiltered.map((r, i) => (
                    <tr key={r.id}>
                      <td><input type="checkbox" checked={checked.has(r.id)} onChange={() => toggleOne(r.id)} /></td>
                      <td>{i + 1}</td>
                      <td><PreBadge cat={r.category} /></td>
                      <td>{r.supplier || '-'}</td>
                      <td><b>{r.topic}</b></td>
                      <td>{r.milestone_lx || '-'}</td>
                      <td>{r.milestone_p1 || '-'}</td>
                      <td>{r.milestone_p2 || '-'}</td>
                      <td>{r.milestone_p3 || '-'}</td>
                      <td className="spec" title={r.risk || ''}>{r.risk || '-'}</td>
                      <td className="spec" title={r.progress || ''}>{r.progress || '-'}</td>
                      <td>{r.status || '-'}</td>
                      <td>{r.owner || '-'}</td>
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
              {!riskLoading && !riskFiltered.length && (
                <div className="empty">
                  <div className="big">{riskFilterActive ? '🔍' : '📋'}</div>
                  <div>{riskFilterActive ? '没有符合筛选条件的项目，可点击「重置」查看全部' : '暂无项目，点击「新增项目」手动录入'}</div>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {tab === 'list' && (
        <section className="sub-panel active">
          <div className="card">
            <div className="card-title">
              {can('action:import') && <button className="btn" onClick={() => setImportOpen(true)}>📥 批量导入</button>}
              {can('action:export') && <ExportButton api="prestudies" entity="预研专项" />}
              {can('action:delete') && <button className="btn btn-danger" onClick={batchDelete}>🗑 批量删除</button>}
              {can('action:create') && <button className="btn btn-primary" onClick={openAdd}>＋ 新增专项</button>}
            </div>
            <form className="toolbar" onSubmit={doQuery}>
              <input className="search-input" placeholder="搜索物料品类 / 供应商 / 专项名称 / 风险 / 立项 / P1 / P2 / P3 / 状态 / 责任人" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
              <button type="submit" className="btn">查询</button>
              <button type="button" className="btn" onClick={resetAll}>重置</button>
            </form>
            <div className="table-wrap">
              <table className="data-table" style={rows.length ? undefined : { display: 'none' }}>
                <thead>
                  <tr>
                    <th style={{ width: 36 }}><input type="checkbox" checked={allChecked} onChange={toggleAll} title="全选本页" /></th>
                    <th>序号</th><th>物料品类</th><th>供应商</th><th>专项名称</th><th>立项</th><th>P1</th><th>P2</th><th>P3</th><th>风险</th><th>状态</th><th>责任人</th><th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.id}>
                      <td><input type="checkbox" checked={checked.has(r.id)} onChange={() => toggleOne(r.id)} /></td>
                      <td>{(page - 1) * PAGE_SIZE + i + 1}</td>
                      <td><PreBadge cat={r.category} /></td>
                      <td>{r.supplier || '-'}</td>
                      <td><b>{r.topic}</b></td>
                      <td>{r.milestone_lx || '-'}</td>
                      <td>{r.milestone_p1 || '-'}</td>
                      <td>{r.milestone_p2 || '-'}</td>
                      <td>{r.milestone_p3 || '-'}</td>
                      <td className="spec" title={r.risk || ''}>{r.risk || '-'}</td>
                      <td>{r.status || '-'}</td>
                      <td>{r.owner || '-'}</td>
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
                  <div className="big">🔬</div>
                  <div>暂无预研专项，点击「新增专项」手动录入</div>
                </div>
              )}
            </div>
            <Pagination page={page} total={total} pageSize={PAGE_SIZE} onGo={load} />
          </div>
        </section>
      )}

      {tab === 'dashboard' && (
        <section className="sub-panel active">
          <div className="stat-grid">
            {kpi.map(([label, value, hint], i) => (
              <div className={'stat-card ' + ACCENT_CLS[i]} key={label}>
                <div className="label">{label}</div>
                <div className="value">{value}</div>
                <div className="hint">{hint}</div>
              </div>
            ))}
          </div>
          <div className="card">
            <div className="card-title">
              <span>{statsKind === 'research' ? '在研项目风险分析' : '专项分析'}</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>统计范围</span>
                <select value={statsKind} onChange={(e) => { setStatsKind(e.target.value); loadStats(e.target.value); }}>
                  <option value="prestudy">预研专项</option>
                  <option value="research">在研项目（风险清单）</option>
                  <option value="all">全部</option>
                </select>
              </div>
            </div>

            <div className="chart-grid">
              {/* 按项目问题个数：同一项目允许多条风险点，逐条计数（占满整行） */}
              <div className="card grid-wide">
                <div className="card-title">
                  <span>按项目问题个数</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                    {statsRangeLabel}：共 {st.projectTotal || 0} 个项目、{st.issueTotal || 0} 个问题，按问题数从高到低（Top 15）
                  </span>
                </div>
                <BarList rows={st.byTopic || []} color="#dc2626" />
              </div>
              <div className="card"><div className="card-title">按物料品类</div><BarList rows={st.byCategory || []} color="#2563eb" /></div>
              <div className="card"><div className="card-title">按供应商</div><BarList rows={st.bySupplier || []} color="#0891b2" /></div>
              <div className="card"><div className="card-title">按责任人</div><BarList rows={st.byOwner || []} color="#7c3aed" /></div>
              <div className="card"><div className="card-title">按状态</div><BarList rows={st.byStatus || []} color="#16a34a" /></div>
            </div>
          </div>
        </section>
      )}

      {/* 新增/编辑弹窗 */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={(editingId ? '编辑' : '新增') + (isRiskTab ? '在研项目' : '预研专项')}
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
            <select value={form.category} onChange={(e) => setField('category', e.target.value)}>
              <option value="">请选择</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="form-item half">
            <label>供应商</label>
            <SupplierSelect value={form.supplier} onChange={(v) => setField('supplier', v)} />
          </div>
          <div className="form-item half">
            <label>{topicLabel}<span className="req">*</span></label>
            <input value={form.topic} onChange={(e) => setField('topic', e.target.value)} placeholder={topicLabel} />
          </div>
          <div className="form-item half">
            <label>立项</label>
            <input value={form.milestone_lx} onChange={(e) => setField('milestone_lx', e.target.value)} placeholder="如：26/7/30" />
          </div>
          <div className="form-item half">
            <label>P1</label>
            <input value={form.milestone_p1} onChange={(e) => setField('milestone_p1', e.target.value)} placeholder="如：26/11/6 装机" />
          </div>
          <div className="form-item half">
            <label>P2</label>
            <input value={form.milestone_p2} onChange={(e) => setField('milestone_p2', e.target.value)} placeholder="如：26/12/28 装机" />
          </div>
          <div className="form-item half">
            <label>P3</label>
            <input value={form.milestone_p3} onChange={(e) => setField('milestone_p3', e.target.value)} placeholder="如：27/1/23 装机" />
          </div>
          <div className="form-item full">
            <label>风险</label>
            <textarea value={form.risk} onChange={(e) => setField('risk', e.target.value)} placeholder="风险描述" />
          </div>
          {isRiskTab && (
            <div className="form-item full">
              <label>进度措施</label>
              <textarea value={form.progress} onChange={(e) => setField('progress', e.target.value)} placeholder="进度措施 / 应对措施" />
            </div>
          )}
          <div className="form-item half">
            <label>状态</label>
            <input value={form.status} onChange={(e) => setField('status', e.target.value)} placeholder="如：进行中 / 已完成 / 暂停" />
          </div>
          <div className="form-item half">
            <label>责任人</label>
            <input value={form.owner} onChange={(e) => setField('owner', e.target.value)} placeholder="责任人姓名" />
          </div>
        </div>
      </Modal>

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        cfg={isRiskTab
          ? { api: 'prestudies', entity: '在研项目', requiredLabel: '项目名称', fields: RISK_FIELDS, extraBody: { kind: KIND_RESEARCH } }
          : { api: 'prestudies', entity: '预研专项', requiredLabel: '专项名称', fields: IMPORT_FIELDS, extraBody: { kind: KIND_PRESTUDY } }}
        onDone={afterMutate}
      />
    </>
  );
}
