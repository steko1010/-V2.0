import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../stores/auth';
import { MENUS } from '../../menus';

export default function AppLayout() {
  const user = useAuth((s) => s.user);
  const roleText = useAuth((s) => s.roleText);
  const logout = useAuth((s) => s.logout);
  const navigate = useNavigate();

  // 权限菜单过滤：勾选了哪个页面权限就显示哪个菜单（超管全部显示）
  const menus = MENUS.filter((m) => {
    const { hasPerm } = useAuth.getState();
    return user && hasPerm(m.perm);
  });

  const onLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand" onClick={() => navigate('/')}>
          <div className="logo">料</div>
          <div>
            <div className="name">物料认证管理</div>
            <div className="sub">Material Cert</div>
          </div>
        </div>
        <nav className="nav">
          {menus.map((m) => (
            <NavLink
              key={m.perm}
              to={m.to}
              className={({ isActive }) => (isActive ? 'active' : undefined)}
            >
              {m.label}
            </NavLink>
          ))}
        </nav>
        <div className="user-bar">
          <div className="ub-info">
            <div className="ub-name" title={user.username}>{user.display_name || user.username}</div>
            <div className="ub-roles">{roleText()}</div>
          </div>
          <button className="btn btn-sm ub-logout" onClick={onLogout}>注销</button>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
