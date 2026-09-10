import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../stores/auth';
import { firstAccessiblePath } from '../menus';

export default function Login() {
  const user = useAuth((s) => s.user);
  const login = useAuth((s) => s.login);
  const navigate = useNavigate();
  const location = useLocation();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // 已登录则直接进入首个可访问页
  if (user) return <Navigate to={firstAccessiblePath()} replace />;

  const doLogin = async () => {
    if (!username.trim() || !password) { setErr('请输入账号与密码'); return; }
    setErr(''); setBusy(true);
    try {
      await login(username.trim(), password);
      const rp = new URLSearchParams(location.search).get('redirect');
      let target = rp ? decodeURIComponent(rp).replace(/^\/app/, '') : firstAccessiblePath();
      if (!target.startsWith('/')) target = '/' + target;
      navigate(target, { replace: true });
    } catch (e) {
      setErr(e.message || '登录失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-body">
      <div className="login-wrap">
        <div className="login-card">
          <div className="login-head">
            <div className="logo">料</div>
            <h1>物料开发认证管理系统</h1>
            <div className="sub">Material Cert Manager</div>
          </div>
          <div className="modal-body" style={{ padding: '16px 32px 8px' }}>
            <div className="form-item">
              <input
                value={username}
                placeholder="账号"
                autoComplete="username"
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className="form-item">
              <input
                type="password"
                value={password}
                placeholder="密码"
                autoComplete="current-password"
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') doLogin(); }}
              />
            </div>
            <div className="err-msg">{err}</div>
          </div>
          <div className="login-foot">
            <button className="login-btn" disabled={busy} onClick={doLogin}>
              {busy ? '登录中...' : '登 录'}
            </button>
            <div className="login-hint">默认管理员账号：admin / admin123</div>
          </div>
        </div>
      </div>
    </div>
  );
}
