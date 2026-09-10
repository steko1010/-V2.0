// ---------- 请求封装（迁移自 public/js/common.js 的 api 系列） ----------
// 401 自动跳登录并携带 redirect；其余错误抛出后端 message

function redirectToLogin() {
  if (location.pathname.endsWith('/login')) return;
  const cur = location.pathname + location.search;
  location.replace('/app/login?redirect=' + encodeURIComponent(cur));
}

export async function request(path, { method = 'GET', body } = {}) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch {
    throw new Error('网络异常，请检查后端服务是否运行');
  }
  if (res.status === 401) {
    redirectToLogin();
    throw new Error('未登录');
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* 非 JSON 响应（如文件流） */ }
  if (!res.ok) {
    throw new Error((data && data.message) || `请求失败 (${res.status})`);
  }
  return data;
}

export const apiGet = (p) => request(p);
export const apiPost = (p, body) => request(p, { method: 'POST', body });
export const apiPut = (p, body) => request(p, { method: 'PUT', body });
export const apiDelete = (p, body) =>
  request(p, { method: 'DELETE', body: body === undefined ? undefined : body });
