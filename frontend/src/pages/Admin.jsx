import { useCallback, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { apiDelete, apiGet, apiPost, apiPut } from '../api/client';
import { useAuth } from '../stores/auth';
import { useMeta } from '../stores/meta';
import { confirmDialog, toast } from '../stores/ui';
import Modal from '../components/ui/Modal';
import Pagination from '../components/ui/Pagination';
import { ExportButton, ImportModal } from '../components/ui/ImportExport';

const BUILTIN_ROLE_LABELS = { admin: '管理员', editor: '编辑员', readonly: '只读' };
const builtinRoleLabel = (code) => BUILTIN_ROLE_LABELS[code] || '内置管理员';
const CAT_PAGE_SIZE = 20;
const CAT_IMPORT_FIELDS = [['物料大类', 'big'], ['物料中类', 'mid'], ['物料小类', 'small']];

const kindBadge = (kind) => (
  <span className={'badge ' + (kind === 'menu' ? 'cert' : 'test')}>{kind === 'menu' ? '菜单' : '操作'}</span>
);

export default function Admin() {
  const can = useAuth((s) => s.hasPerm);
  const meta = useMeta(useShallow((s) => ({ categories: s.categories })));
  const ensureMeta = useMeta((s) => s.ensure);

  const [tab, setTab] = useState(() => new URLSearchParams(location.search).get('tab') || 'users');

  // ---------- 用户 / 角色 / 权限 ----------
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [perms, setPerms] = useState([]);
  const [userModal, setUserModal] = useState({ open: false, editingId: null, username: '', password: '', displayName: '', status: '启用', isSuper: '0', roleIds: [], catScope: [], supplierText: '', busy: false, catOptions: [] });
  const [roleModal, setRoleModal] = useState({ open: false, editingId: null, code: '', name: '', description: '', codes: new Set(), busy: false });
  const [viewPerm, setViewPerm] = useState({ open: false, name: '', owned: new Set() });

  // ---------- 品类 ----------
  const [catRows, setCatRows] = useState([]);
  const [catTotal, setCatTotal] = useState(0);
  const [catPage, setCatPage] = useState(1);
  const [catKw, setCatKw] = useState('');
  const [selectedCat, setSelectedCat] = useState(() => new Set());
  const [catModal, setCatModal] = useState({ open: false, editingId: null, big: '', mid: '', small: '', busy: false });
  const [importOpen, setImportOpen] = useState(false);

  const loadUsers = useCallback(async () => {
    try { const d = await apiGet('/api/users'); setUsers(d.items || []); } catch (e) { toast(e.message, 'error'); }
  }, []);
  const loadRoles = useCallback(async () => {
    try { const d = await apiGet('/api/roles'); setRoles(d.items || []); } catch (e) { toast(e.message, 'error'); }
  }, []);
  const loadPerms = useCallback(async () => {
    try { const d = await apiGet('/api/permissions'); setPerms(d.items || []); } catch (e) { toast(e.message, 'error'); }
  }, []);
  const loadCats = useCallback(async (p = catPage, kw = catKw) => {
    try {
      const d = await apiGet('/api/material-categories?' + new URLSearchParams({ page: p, pageSize: CAT_PAGE_SIZE, keyword: kw }));
      if (!(d.items || []).length && p > 1) { setCatPage(p - 1); return loadCats(p - 1, kw); }
      setCatRows(d.items || []);
      setCatTotal(d.total || 0);
      setCatPage(d.page || p);
    } catch (e) { toast(e.message, 'error'); }
  }, [catPage, catKw]);

  useEffect(() => { ensureMeta().catch(() => {}); }, [ensureMeta]);
  useEffect(() => { loadUsers(); loadRoles(); }, [loadUsers, loadRoles]);
  useEffect(() => {
    if (tab === 'perms' || tab === 'roles') loadPerms();
    if (tab === 'categories') loadCats(1, catKw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const switchTab = (name) => { setTab(name); if (name === 'users') loadUsers(); };

  // ---------- 用户操作 ----------
  const openUserModal = async (id) => {
    if (!(meta.categories || []).length) await ensureMeta().catch(() => {});
    const catOptions = (meta.categories || []).slice();
    const u = id ? (users || []).find((x) => x.id === id) : null;
    let catScope = [];
    let supplierText = '';
    let roleIds = [];
    if (u) {
      const roleNames = String(u.roles || '').split(',').filter(Boolean);
      roleIds = (roles || []).filter((r) => roleNames.includes(r.name)).map((r) => r.id);
      const scopes = u.scopes || { categories: [], suppliers: [] };
      catScope = scopes.categories || [];
      supplierText = (scopes.suppliers || []).join('\n');
      catScope.forEach((c) => { if (!catOptions.includes(c)) catOptions.push(c); });
    }
    setUserModal({
      open: true, editingId: id || null,
      username: u ? u.username : '', password: '', displayName: u ? u.display_name || '' : '',
      status: u ? u.status || '启用' : '启用', isSuper: u && u.is_super ? '1' : '0',
      roleIds, catScope, supplierText, busy: false, catOptions,
    });
  };
  const closeUserModal = () => setUserModal((m) => ({ ...m, open: false }));
  const setUser = (patch) => setUserModal((m) => ({ ...m, ...patch }));
  const toggleArr = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const saveUser = async () => {
    const m = userModal;
    if (!m.username.trim()) { toast('请输入账号', 'error'); return; }
    if (!m.editingId && !m.password) { toast('请输入密码', 'error'); return; }
    const body = {
      username: m.username.trim(), status: m.status, display_name: m.displayName.trim(),
      is_super: m.isSuper === '1' ? 1 : 0, role_ids: m.roleIds,
      scopes: { categories: m.catScope, suppliers: m.supplierText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) },
    };
    if (m.password) body.password = m.password;
    setUser({ busy: true });
    try {
      if (m.editingId) { await apiPut('/api/users/' + m.editingId, body); toast('修改成功', 'success'); }
      else { await apiPost('/api/users', body); toast('新增成功', 'success'); }
      closeUserModal();
      loadUsers();
      loadRoles();
    } catch (e) { toast(e.message, 'error'); } finally { setUser({ busy: false }); }
  };
  const deleteUser = async (u) => {
    if (!await confirmDialog(`确定删除用户「${u.username}」吗？`)) return;
    try { await apiDelete('/api/users/' + u.id); toast('已删除', 'success'); loadUsers(); } catch (e) { toast(e.message, 'error'); }
  };

  // ---------- 角色操作 ----------
  const menuPerms = perms.filter((p) => p.kind === 'menu');
  const actPerms = perms.filter((p) => p.kind === 'action');

  const openRoleModal = async (id) => {
    if (!perms.length) await loadPerms();
    const r = id ? (roles || []).find((x) => x.id === id) : null;
    let codes = new Set();
    if (r) {
      const d = await apiGet('/api/roles/' + id + '/permissions');
      codes = new Set(d.items || []);
    }
    setRoleModal({
      open: true, editingId: id || null, code: r ? (r.built_in ? builtinRoleLabel(r.code) : r.code) : '',
      name: r ? r.name : '', description: r ? r.description || '' : '', codes, busy: false,
    });
  };
  const closeRoleModal = () => setRoleModal((m) => ({ ...m, open: false }));
  const setRole = (patch) => setRoleModal((m) => ({ ...m, ...patch }));

  const toggleCode = (code) => {
    const codes = new Set(roleModal.codes);
    if (codes.has(code)) codes.delete(code);
    else {
      // 品类为管理员专属菜单：需同时持有「系统管理」
      if (code === 'page:categories' && !codes.has('page:admin')) { toast('品类为管理员专属菜单，需同时勾选「系统管理」', 'error'); return; }
      codes.add(code);
    }
    setRoleModal((m) => ({ ...m, codes }));
  };

  const saveRole = async () => {
    const m = roleModal;
    if (!m.code.trim() || !m.name.trim()) { toast('账号与姓名必填', 'error'); return; }
    const permission_codes = [...m.codes];
    const body = { name: m.name.trim(), description: m.description.trim(), permission_codes };
    setRole({ busy: true });
    try {
      if (m.editingId) { await apiPut('/api/roles/' + m.editingId, body); toast('修改成功', 'success'); }
      else { await apiPost('/api/roles', { code: m.code.trim(), ...body }); toast('新增成功', 'success'); }
      closeRoleModal();
      loadRoles();
    } catch (e) { toast(e.message, 'error'); } finally { setRole({ busy: false }); }
  };
  const deleteRole = async (r) => {
    const msg = r.built_in
      ? `确定删除内置角色「${r.name}」吗？\n删除后，该角色用户将被解除关联，且重启服务也不会自动恢复。`
      : `确定删除角色「${r.name}」吗？`;
    if (!await confirmDialog(msg)) return;
    try { await apiDelete('/api/roles/' + r.id); toast('已删除', 'success'); loadRoles(); } catch (e) { toast(e.message, 'error'); }
  };
  const viewRolePerms = async (r) => {
    const d = await apiGet('/api/roles/' + r.id + '/permissions');
    setViewPerm({ open: true, name: r.name, owned: new Set(d.items || []) });
  };

  // ---------- 品类操作 ----------
  const applyCatFilter = () => { setSelectedCat(new Set()); setCatPage(1); loadCats(1, catKw); };
  const resetCats = () => { setCatKw(''); setSelectedCat(new Set()); setCatPage(1); loadCats(1, ''); };

  const catPageIds = useMemo(() => catRows.map((r) => r.id), [catRows]);
  const allCatChecked = catPageIds.length > 0 && catPageIds.every((id) => selectedCat.has(id));
  const toggleAllCat = () => {
    const next = new Set(selectedCat);
    if (allCatChecked) catPageIds.forEach((id) => next.delete(id));
    else catPageIds.forEach((id) => next.add(id));
    setSelectedCat(next);
  };
  const toggleCat = (id) => {
    const next = new Set(selectedCat);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedCat(next);
  };

  const bulkDeleteCats = async () => {
    const ids = [...selectedCat];
    if (!ids.length) return;
    if (!await confirmDialog(`确定删除选中的 ${ids.length} 个品类吗？删除后不可恢复。`)) return;
    try {
      const res = await fetch('/api/material-categories/batch', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }),
      });
      if (!res.ok) { let m = '删除失败'; try { m = (await res.json()).message || m; } catch (e) { /* ignore */ } throw new Error(m); }
      const data = await res.json().catch(() => ({}));
      setSelectedCat(new Set());
      toast(`已删除 ${data.deleted || ids.length} 个品类`, 'success');
      loadCats();
    } catch (e) { toast(e.message, 'error'); }
  };

  const openAddCat = () => setCatModal({ open: true, editingId: null, big: '', mid: '', small: '', busy: false });
  const openEditCat = (r) => setCatModal({ open: true, editingId: r.id, big: r.big || '', mid: r.mid || '', small: r.small || '', busy: false });
  const closeCatModal = () => setCatModal((m) => ({ ...m, open: false }));

  const saveCat = async () => {
    if (!catModal.big.trim()) { toast('物料大类不能为空', 'error'); return; }
    const body = { big: catModal.big.trim(), mid: catModal.mid.trim(), small: catModal.small.trim() };
    setCatModal((m) => ({ ...m, busy: true }));
    try {
      if (catModal.editingId) { await apiPut('/api/material-categories/' + catModal.editingId, body); toast('已保存', 'success'); }
      else { await apiPost('/api/material-categories', body); toast('新增成功', 'success'); setCatPage(1); }
      closeCatModal();
      loadCats(catModal.editingId ? catPage : 1);
      ensureMeta().catch(() => {});
    } catch (e) { toast(e.message, 'error'); } finally { setCatModal((m) => ({ ...m, busy: false })); }
  };
  const deleteCat = async (r) => {
    const path = [r.big, r.mid, r.small].filter(Boolean).join(' / ');
    if (!await confirmDialog(`确定删除品类「${path}」吗？删除后不可恢复。`)) return;
    try {
      await apiDelete('/api/material-categories/' + r.id);
      setSelectedCat((s) => { const n = new Set(s); n.delete(r.id); return n; });
      toast('已删除', 'success');
      loadCats();
    } catch (e) { toast(e.message, 'error'); }
  };

  const permOpt = (p) => (
    <label key={p.code} style={{ flex: '0 0 30%' }}>
      <input type="checkbox" checked={viewPerm.owned.has(p.code)} disabled /> {p.name}{' '}
      <code style={{ fontSize: 11, color: '#9ca3af' }}>{p.code}</code>
    </label>
  );

  // 角色列表「描述」列：描述 + 菜单/操作权限摘要（对齐旧版 renderRoleDesc）
  const roleDesc = (r) => {
    const permMap = new Map(perms.map((p) => [p.code, p]));
    const owned = (r.permissions || []).map((c) => permMap.get(c)).filter(Boolean);
    const menus = owned.filter((p) => p.kind === 'menu');
    const acts = owned.filter((p) => p.kind === 'action');
    const chip = (p) => (
      <span key={p.code} style={{ marginRight: 12, whiteSpace: 'nowrap' }}>
        {p.name} <code style={{ fontSize: 11, color: '#6b7280' }}>{p.code}</code>
      </span>
    );
    const body = [];
    if (r.description) body.push(<div key="d">{r.description}</div>);
    if (menus.length) body.push(<div key="m">菜单权限：{menus.map(chip)}</div>);
    if (acts.length) body.push(<div key="a">操作权限：{acts.map(chip)}</div>);
    return body.length ? <div style={{ lineHeight: 1.9 }}>{body}</div> : '-';
  };
  const setCat = (patch) => setCatModal((m) => ({ ...m, ...patch }));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>系统管理</h1>
          <div className="desc">品类、用户、角色、权限码、数据范围等系统基础配置的统一管理</div>
        </div>
      </div>

      <div className="sub-tabs">
        <button className={'sub-tab' + (tab === 'users' ? ' active' : '')} onClick={() => switchTab('users')}>用户</button>
        <button className={'sub-tab' + (tab === 'roles' ? ' active' : '')} onClick={() => switchTab('roles')}>角色</button>
        <button className={'sub-tab' + (tab === 'perms' ? ' active' : '')} onClick={() => switchTab('perms')}>权限码</button>
        <button className={'sub-tab' + (tab === 'categories' ? ' active' : '')} onClick={() => switchTab('categories')}>品类</button>
      </div>

      {tab === 'users' && (
        <section className="sub-panel active">
          <div className="card">
            <div className="toolbar" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" onClick={() => openUserModal()}>＋ 新增用户</button>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>账号</th><th>姓名</th><th>状态</th><th>超管</th><th>角色</th><th>数据范围</th><th>创建时间</th><th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const scopeTxt = u.is_super
                      ? <span className="badge done">全部</span>
                      : `${(u.scopes && u.scopes.categories || []).length}品类 / ${(u.scopes && u.scopes.suppliers || []).length}供应商`;
                    return (
                      <tr key={u.id}>
                        <td>
                          <b>{u.username}</b>
                          {!!u.is_super && <span className="badge badge-purple">超管</span>}
                        </td>
                        <td>{u.display_name || '-'}</td>
                        <td>{u.status === '启用' ? <span className="badge done">启用</span> : <span className="badge dead">停用</span>}</td>
                        <td>{u.is_super ? '是' : '否'}</td>
                        <td>{u.roles || '-'}</td>
                        <td>{scopeTxt}</td>
                        <td>{u.created_at || '-'}</td>
                        <td>
                          <div className="actions">
                            <button className="btn btn-sm" onClick={() => openUserModal(u.id)}>编辑</button>
                            <button className="btn btn-sm btn-danger" onClick={() => deleteUser(u)}>删除</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!users.length && (
                <div className="empty"><div className="big">👤</div><div>暂无用户</div></div>
              )}
            </div>
          </div>
        </section>
      )}

      {tab === 'roles' && (
        <section className="sub-panel active">
          <div className="card">
            <div className="toolbar" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" onClick={() => openRoleModal()}>＋ 新增角色</button>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>账号</th><th>姓名</th><th>描述</th><th>内置</th><th>权限数</th><th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {roles.map((r) => (
                    <tr key={r.id}>
                      <td>
                        {r.built_in
                          ? <span className="badge badge-purple">{builtinRoleLabel(r.code)}</span>
                          : <code>{r.code}</code>}
                      </td>
                      <td><b>{r.name}</b></td>
                      <td>{roleDesc(r)}</td>
                      <td>{r.built_in ? <span className="badge done">内置</span> : <span className="badge">自定义</span>}</td>
                      <td><a href="#" onClick={(e) => { e.preventDefault(); viewRolePerms(r); }}>查看权限</a></td>
                      <td>
                        <div className="actions">
                          <button className="btn btn-sm" onClick={() => openRoleModal(r.id)}>编辑</button>
                          <button className="btn btn-sm btn-danger" onClick={() => deleteRole(r)}>删除</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!roles.length && (
                <div className="empty"><div className="big">🎭</div><div>暂无角色</div></div>
              )}
            </div>
          </div>
        </section>
      )}

      {tab === 'perms' && (
        <section className="sub-panel active">
          <div className="card">
            <div className="card-title">系统权限码（内置）</div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>类型</th><th>权限码</th><th>名称</th></tr>
                </thead>
                <tbody>
                  {perms.map((p) => (
                    <tr key={p.code}>
                      <td>{kindBadge(p.kind)}</td>
                      <td><code>{p.code}</code></td>
                      <td>{p.name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!perms.length && (
                <div className="empty"><div className="big">🔑</div><div>暂无权限码</div></div>
              )}
            </div>
          </div>
        </section>
      )}

      {tab === 'categories' && (
        <section className="sub-panel active">
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, margin: '0 0 12px', flexWrap: 'wrap' }}>
              {can('action:import') && <button className="btn" onClick={() => setImportOpen(true)}>📥 批量导入</button>}
              {can('action:export') && <ExportButton api="material-categories" entity="品类" label="📤 批量导出" />}
              {can('action:delete') && (
                <button className="btn btn-danger" disabled={!selectedCat.size} onClick={bulkDeleteCats}>
                  {selectedCat.size ? `🗑 批量删除(${selectedCat.size})` : '🗑 批量删除'}
                </button>
              )}
              {can('action:create') && <button className="btn btn-primary" onClick={openAddCat}>＋ 新增品类</button>}
            </div>

            <form className="toolbar" onSubmit={(e) => { e.preventDefault(); applyCatFilter(); }}>
              <input
                className="search-input"
                placeholder="搜索物料大类 / 中类 / 小类..."
                value={catKw}
                onChange={(e) => setCatKw(e.target.value)}
              />
              <button type="submit" className="btn">查询</button>
              <button type="button" className="btn" onClick={resetCats}>重置</button>
            </form>

            <div className="table-wrap">
              {catRows.length ? (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: 36 }}><input type="checkbox" checked={allCatChecked} onChange={toggleAllCat} title="全选当前页" /></th>
                      <th>物料大类</th><th>物料中类</th><th>物料小类</th>
                      <th style={{ width: 140 }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {catRows.map((r) => (
                      <tr key={r.id}>
                        <td><input type="checkbox" checked={selectedCat.has(r.id)} onChange={() => toggleCat(r.id)} /></td>
                        <td><b>{r.big}</b></td>
                        <td>{r.mid || '-'}</td>
                        <td>{r.small || '-'}</td>
                        <td>
                          <div className="actions">
                            {can('action:edit') && <button className="btn btn-sm" onClick={() => openEditCat(r)}>编辑</button>}
                            {can('action:delete') && <button className="btn btn-sm btn-danger" onClick={() => deleteCat(r)}>删除</button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="empty">
                  <div className="big">🏷️</div>
                  <div>暂无品类，点击上方「新增品类」开始录入</div>
                </div>
              )}
            </div>
            <Pagination page={catPage} total={catTotal} pageSize={CAT_PAGE_SIZE} onGo={(p) => loadCats(p, catKw)} />
          </div>
        </section>
      )}

      {/* 用户弹窗 */}
      <Modal
        open={userModal.open}
        onClose={closeUserModal}
        title={userModal.editingId ? '编辑用户' : '新增用户'}
        wide
        footer={
          <>
            <button className="btn" onClick={closeUserModal}>取消</button>
            <button className="btn btn-primary" disabled={userModal.busy} onClick={saveUser}>
              {userModal.busy ? '保存中...' : '保存'}
            </button>
          </>
        }
      >
        <div className="form-grid">
          <div className="form-item half">
            <label>账号{!userModal.editingId && <span className="req">*</span>}</label>
            <input value={userModal.username} onChange={(e) => setUser({ username: e.target.value })} placeholder="修改账号或姓名将同步更新同名角色" autoComplete="off" />
          </div>
          <div className="form-item half">
            <label>密码{!userModal.editingId && <span className="req">*</span>}</label>
            <input type="password" value={userModal.password} onChange={(e) => setUser({ password: e.target.value })} placeholder="编辑时留空表示不修改" autoComplete="new-password" />
          </div>
          <div className="form-item half">
            <label>显示姓名</label>
            <input value={userModal.displayName} onChange={(e) => setUser({ displayName: e.target.value })} />
          </div>
          <div className="form-item half">
            <label>状态</label>
            <select value={userModal.status} onChange={(e) => setUser({ status: e.target.value })}>
              <option>启用</option><option>停用</option>
            </select>
          </div>
          <div className="form-item half">
            <label>是否超管</label>
            <select value={userModal.isSuper} onChange={(e) => setUser({ isSuper: e.target.value })}>
              <option value="0">否</option><option value="1">是</option>
            </select>
          </div>
          <div className="form-item full">
            <label>角色（可多选）</label>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              {(roles || []).length ? roles.map((r) => (
                <label key={r.id}>
                  <input
                    type="checkbox"
                    checked={userModal.roleIds.includes(r.id)}
                    onChange={() => setUser({ roleIds: toggleArr(userModal.roleIds, r.id) })}
                  /> {r.name}
                </label>
              )) : <span style={{ color: '#9ca3af', fontSize: 12 }}>暂无角色</span>}
            </div>
          </div>
          <div className="form-item half">
            <label>品类可见范围（第三层）</label>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              {userModal.catOptions.length ? userModal.catOptions.map((c) => (
                <label key={c}>
                  <input
                    type="checkbox"
                    checked={userModal.catScope.includes(c)}
                    onChange={() => setUser({ catScope: toggleArr(userModal.catScope, c) })}
                  /> {c}
                </label>
              )) : <span style={{ color: '#9ca3af', fontSize: 12 }}>暂无品类数据</span>}
            </div>
          </div>
          <div className="form-item full">
            <label>供应商可见范围（第三层，每行一个）</label>
            <textarea rows="3" value={userModal.supplierText} onChange={(e) => setUser({ supplierText: e.target.value })} placeholder="每行一个供应商" />
          </div>
        </div>
      </Modal>

      {/* 角色弹窗 */}
      <Modal
        open={roleModal.open}
        onClose={closeRoleModal}
        title={roleModal.editingId ? '编辑角色' : '新增角色'}
        footer={
          <>
            <button className="btn" onClick={closeRoleModal}>取消</button>
            <button className="btn btn-primary" disabled={roleModal.busy} onClick={saveRole}>
              {roleModal.busy ? '保存中...' : '保存'}
            </button>
          </>
        }
      >
        <div className="form-grid">
          <div className="form-item half">
            <label>账号<span className="req">*</span></label>
            <input value={roleModal.code} disabled={!!roleModal.editingId} onChange={(e) => setRole({ code: e.target.value })} placeholder="例如：zhangsan" />
          </div>
          <div className="form-item half">
            <label>姓名<span className="req">*</span></label>
            <input value={roleModal.name} onChange={(e) => setRole({ name: e.target.value })} />
          </div>
          <div className="form-item full">
            <label>描述</label>
            <input value={roleModal.description} onChange={(e) => setRole({ description: e.target.value })} />
          </div>
          <div className="form-item full">
            <label>权限（可多选）</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, maxHeight: 280, overflow: 'auto', padding: 8, border: '1px solid #e5e7eb', borderRadius: 6 }}>
              <div style={{ flex: '1 1 100%', fontWeight: 600, color: '#374151' }}>菜单权限</div>
              {menuPerms.map((p) => (
                <label key={p.code} style={{ flex: '0 0 30%' }}>
                  <input type="checkbox" checked={roleModal.codes.has(p.code)} onChange={() => toggleCode(p.code)} /> {p.name}{' '}
                  <code style={{ fontSize: 11, color: '#9ca3af' }}>{p.code}</code>
                </label>
              ))}
              <div style={{ flex: '1 1 100%', fontWeight: 600, color: '#374151', marginTop: 8 }}>操作权限</div>
              {actPerms.map((p) => (
                <label key={p.code} style={{ flex: '0 0 30%' }}>
                  <input type="checkbox" checked={roleModal.codes.has(p.code)} onChange={() => toggleCode(p.code)} /> {p.name}{' '}
                  <code style={{ fontSize: 11, color: '#9ca3af' }}>{p.code}</code>
                </label>
              ))}
            </div>
          </div>
        </div>
      </Modal>

      {/* 角色权限查看弹窗 */}
      <Modal
        open={viewPerm.open}
        onClose={() => setViewPerm((m) => ({ ...m, open: false }))}
        title={`角色「${viewPerm.name}」权限`}
        footer={
          <button className="btn btn-primary" onClick={() => setViewPerm((m) => ({ ...m, open: false }))}>关闭</button>
        }
      >
        <div className="form-grid">
          <div className="form-item full">
            <label>菜单权限</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, maxHeight: 200, overflow: 'auto', padding: 8, border: '1px solid #e5e7eb', borderRadius: 6 }}>
              {menuPerms.length ? menuPerms.map(permOpt) : <span style={{ color: '#9ca3af', fontSize: 12 }}>（无菜单权限）</span>}
            </div>
          </div>
          <div className="form-item full">
            <label>操作权限</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, maxHeight: 200, overflow: 'auto', padding: 8, border: '1px solid #e5e7eb', borderRadius: 6 }}>
              {actPerms.length ? actPerms.map(permOpt) : <span style={{ color: '#9ca3af', fontSize: 12 }}>（无操作权限）</span>}
            </div>
          </div>
        </div>
      </Modal>

      {/* 品类新增/编辑弹窗 */}
      <Modal
        open={catModal.open}
        onClose={closeCatModal}
        title={catModal.editingId ? '编辑品类' : '新增品类'}
        wide
        footer={
          <>
            <button className="btn" onClick={closeCatModal}>取消</button>
            <button className="btn btn-primary" disabled={catModal.busy} onClick={saveCat}>
              {catModal.busy ? '保存中...' : '保存'}
            </button>
          </>
        }
      >
        <div className="form-grid">
          <div className="form-section">品类信息</div>
          <div className="form-item half">
            <label>物料大类<span className="req">*</span></label>
            <input value={catModal.big} onChange={(e) => setCat({ big: e.target.value })} placeholder="如：显示屏 / 结构件 / 电子料" />
          </div>
          <div className="form-item half">
            <label>物料中类</label>
            <input value={catModal.mid} onChange={(e) => setCat({ mid: e.target.value })} placeholder="如：盖板玻璃 / FPC 软板（选填）" />
          </div>
          <div className="form-item half">
            <label>物料小类</label>
            <input value={catModal.small} onChange={(e) => setCat({ small: e.target.value })} placeholder="如：CG / FPC（选填）" />
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '0 4px' }}>完整品类路径示例：显示屏 → 盖板玻璃 → CG</div>
        </div>
      </Modal>

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        cfg={{ api: 'material-categories', entity: '品类', requiredLabel: '物料大类', fields: CAT_IMPORT_FIELDS }}
        onDone={() => { setSelectedCat(new Set()); loadCats(catPage, catKw); }}
      />
    </>
  );
}
