import httpProxy from "http-proxy";

const proxy = httpProxy.createProxyServer({
  ws: true,
  xfwd: true,
  changeOrigin: true,
  secure: false,
});

proxy.on("error", (error, req, res) => {
  if (res?.writeHead) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: `No pude conectar con la sesion: ${error.message}`,
      }),
    );
  }
});

function normalizeWorkspacePath(url, workspaceName) {
  const sourceUrl = url || "/";
  const prefix = `/workspaces/${workspaceName}`;

  if (!sourceUrl.startsWith(prefix)) {
    return sourceUrl;
  }

  const nextPath = sourceUrl.slice(prefix.length) || "/";
  return nextPath.startsWith("/") ? nextPath : `/${nextPath}`;
}

export function proxyHttpRequest(req, res, target, workspaceName) {
  req.url = normalizeWorkspacePath(req.originalUrl || req.url, workspaceName);

  proxy.web(req, res, {
    target,
    ignorePath: false,
  });
}

export function proxyWsRequest(req, socket, head, target) {
  proxy.ws(req, socket, head, { target });
}
