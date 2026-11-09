/**
 * 基础层：极简模式路由
 * 支持 :param 路径参数；把匹配结果挂到 req.params，handler 只关心业务。
 */
function compile(pattern) {
  const names = [];
  const source = pattern
    .replace(/\/:([^/]+)/g, (_, name) => {
      names.push(name);
      return '/([^/]+)';
    })
    .replace(/\//g, '\\/');
  return { regex: new RegExp(`^${source}$`), names };
}

export function createRouter(routes) {
  const compiled = routes.map((route) => ({ ...route, ...compile(route.pattern) }));

  return async function dispatch(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    for (const route of compiled) {
      if (route.method !== req.method) continue;
      const match = route.regex.exec(pathname);
      if (!match) continue;
      req.params = {};
      route.names.forEach((name, i) => {
        req.params[name] = decodeURIComponent(match[i + 1]);
      });
      try {
        return await route.handler(req, res);
      } catch {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end('{"error":"internal error"}');
      }
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{"error":"not found"}');
  };
}
