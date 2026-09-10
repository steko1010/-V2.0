import { useEffect } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './stores/auth';
import { firstAccessiblePath } from './menus';
import AppLayout from './components/layout/AppLayout';
import ToastHost from './components/ui/ToastHost';
import ConfirmHost from './components/ui/ConfirmHost';
import Login from './pages/Login';
import Materials from './pages/Materials';
import Audits from './pages/Audits';
import Qcps from './pages/Qcps';
import Prestudies from './pages/Prestudies';
import Selection from './pages/Selection';
import Projects from './pages/Projects';
import Suppliers from './pages/Suppliers';
import Admin from './pages/Admin';

// 会话鉴权守卫：未加载完成时等待；未登录跳登录页
function RequireAuth() {
  const user = useAuth((s) => s.user);
  const loaded = useAuth((s) => s.loaded);
  const location = useLocation();

  if (!loaded) {
    return (
      <div className="route-loading">
        <div className="spinner" />
        <div>加载会话中...</div>
      </div>
    );
  }
  if (!user) {
    const cur = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={'/login?redirect=' + cur} replace />;
  }
  return <Outlet />;
}

// 页面权限守卫：无当前页面权限则跳转到首个可访问页面
function PermPage({ perm, children }) {
  const hasPerm = useAuth((s) => s.hasPerm);
  if (!hasPerm(perm)) return <Navigate to={firstAccessiblePath()} replace />;
  return children;
}

export default function App() {
  useEffect(() => { useAuth.getState().init(); }, []);

  return (
    <>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<RequireAuth />}>
          <Route element={<AppLayout />}>
            <Route index element={<Navigate to={firstAccessiblePath()} replace />} />
            <Route
              path="/materials"
              element={<PermPage perm="page:index"><Materials /></PermPage>}
            />
            <Route
              path="/prestudy"
              element={
                <PermPage perm="page:prestudy">
                  <Prestudies />
                </PermPage>
              }
            />
            <Route
              path="/selection"
              element={
                <PermPage perm="page:selection">
                  <Selection />
                </PermPage>
              }
            />
            <Route
              path="/audits"
              element={
                <PermPage perm="page:audits">
                  <Audits />
                </PermPage>
              }
            />
            <Route
              path="/projects"
              element={
                <PermPage perm="page:projects">
                  <Projects />
                </PermPage>
              }
            />
            <Route
              path="/suppliers"
              element={
                <PermPage perm="page:suppliers">
                  <Suppliers />
                </PermPage>
              }
            />
            <Route
              path="/qcps"
              element={
                <PermPage perm="page:qcps">
                  <Qcps />
                </PermPage>
              }
            />
            <Route
              path="/admin"
              element={
                <PermPage perm="page:admin">
                  <Admin />
                </PermPage>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Route>
      </Routes>
      <ToastHost />
      <ConfirmHost />
    </>
  );
}
