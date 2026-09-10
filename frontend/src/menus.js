import { useAuth } from './stores/auth';

// 侧边栏菜单定义（对应旧版 PAGE_MENU_ORDER / db.js 中 page:* 菜单权限）
// perm：所需菜单权限码；to：SPA 内路由路径；label：菜单显示名；icon：可选
export const MENUS = [
  { perm: 'page:prestudy', to: '/prestudy', label: '项目' },
  { perm: 'page:selection', to: '/selection', label: '选型' },
  { perm: 'page:audits', to: '/audits', label: '稽核' },
  { perm: 'page:index', to: '/materials', label: '物料汇总表' },
  { perm: 'page:projects', to: '/projects', label: 'BOM信息' },
  { perm: 'page:suppliers', to: '/suppliers', label: '供应商信息' },
  { perm: 'page:qcps', to: '/qcps', label: '关键工艺' },
  { perm: 'page:admin', to: '/admin', label: '系统管理' },
];

// 登录后 / 无权限时的默认落地页：仍固定为物料汇总表，
// 不随侧边栏顺序变化（侧边栏顺序 ≠ 默认首页），无该权限时再回退到首个可访问菜单
const DEFAULT_MENU_PERM = 'page:index';

// 当前用户可访问的菜单
export function accessibleMenus() {
  return MENUS.filter((m) => useAuth.getState().hasPerm(m.perm));
}

// 首个可访问页面路径（对应 common.js 的 firstAccessiblePage）
export function firstAccessiblePath() {
  const menus = accessibleMenus();
  const hit = menus.find((m) => m.perm === DEFAULT_MENU_PERM) || menus[0];
  return hit ? hit.to : '/login';
}
