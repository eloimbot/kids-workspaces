import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  authenticateUser,
  createUser,
  listUsers,
} from "./services/auth.js";
import {
  createTemplate,
  installCatalogTemplate,
  loadLinuxServerCatalog,
  loadTemplates,
} from "./services/templates.js";
import {
  createSession,
  deleteSession,
  getSessionTarget,
  listSessions,
  probeDocker,
} from "./services/docker.js";
import { proxyHttpRequest, proxyWsRequest } from "./services/proxy.js";
import {
  createWebSession,
  destroyWebSession,
  getWebSession,
  setWebSessionSudoPassword,
} from "./services/webSessions.js";
import { buildCookie, parseCookies } from "./utils/cookies.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendPath = path.resolve(__dirname, "../../frontend/public");
const sessionCookieName = "kids_workspace_session";

const app = express();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";

app.set("trust proxy", true);
app.use(express.json());
app.use((req, _res, next) => {
  const cookies = parseCookies(req.headers.cookie);
  const sessionToken = cookies[sessionCookieName];
  const session = getWebSession(sessionToken);

  req.sessionToken = sessionToken || null;
  req.currentUser = session?.user ?? null;
  req.currentWebSession = session ?? null;
  next();
});
app.use(express.static(frontendPath));

function getRequestBaseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) {
    return process.env.PUBLIC_BASE_URL;
  }

  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol = Array.isArray(forwardedProto)
    ? forwardedProto[0]
    : (forwardedProto || req.protocol || "http");
  const requestHost = req.headers["x-forwarded-host"] || req.get("host");

  return `${protocol}://${requestHost}`;
}

function requireAuth(req, _res, next) {
  if (!req.currentUser) {
    next(Object.assign(new Error("Necesitas iniciar sesion."), { statusCode: 401 }));
    return;
  }

  next();
}

function requireAdmin(req, _res, next) {
  if (!req.currentUser) {
    next(Object.assign(new Error("Necesitas iniciar sesion."), { statusCode: 401 }));
    return;
  }

  if (req.currentUser.role !== "admin") {
    next(Object.assign(new Error("Solo administradores pueden hacer esto."), { statusCode: 403 }));
    return;
  }

  next();
}

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const { email, password } = req.body ?? {};
    const user = await authenticateUser(email, password);
    const session = createWebSession(user);

    res.setHeader("Set-Cookie", buildCookie(sessionCookieName, session.token, session.maxAgeSeconds));
    res.json({ user });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/logout", (req, res) => {
  destroyWebSession(req.sessionToken);
  res.setHeader("Set-Cookie", buildCookie(sessionCookieName, "", 0));
  res.status(204).send();
});

app.get("/api/auth/me", (req, res) => {
  if (!req.currentUser) {
    res.status(401).json({ error: "No hay sesion activa." });
    return;
  }

  res.json({ user: req.currentUser });
});

app.post("/api/auth/sudo-password", requireAuth, async (req, res, next) => {
  try {
    const { password } = req.body ?? {};

    if (!password) {
      res.status(400).json({ error: "password is required" });
      return;
    }

    const dockerReady = await probeDocker({ sudoPassword: password });

    if (!dockerReady) {
      res.status(401).json({
        error: "La contrasena sudo no funciono o Docker sigue inaccesible.",
        code: "SUDO_PASSWORD_INVALID",
      });
      return;
    }

    setWebSessionSudoPassword(req.sessionToken, password);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.get("/api/health", async (req, res, next) => {
  try {
    const templates = await loadTemplates();
    const dockerReady = await probeDocker({
      sudoPassword: req.currentWebSession?.sudoPassword,
    });

    res.json({
      ok: true,
      service: "kids-workspaces",
      templates: templates.length,
      dockerReady,
      publicBaseUrl: process.env.PUBLIC_BASE_URL || null,
      authRequired: true,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/templates", requireAuth, async (_req, res, next) => {
  try {
    const templates = await loadTemplates();
    res.json({ items: templates });
  } catch (error) {
    next(error);
  }
});

app.post("/api/templates", requireAdmin, async (req, res, next) => {
  try {
    const template = await createTemplate(req.body ?? {});
    res.status(201).json({ template });
  } catch (error) {
    next(error);
  }
});

app.get("/api/catalog/linuxserver", requireAdmin, async (_req, res, next) => {
  try {
    const items = await loadLinuxServerCatalog();
    res.json({ items });
  } catch (error) {
    next(error);
  }
});

app.post("/api/catalog/linuxserver/:catalogId/install", requireAdmin, async (req, res, next) => {
  try {
    const template = await installCatalogTemplate(req.params.catalogId);
    res.status(201).json({ template });
  } catch (error) {
    next(error);
  }
});

app.get("/api/sessions", requireAuth, async (req, res, next) => {
  try {
    const sessions = await listSessions(req.currentUser, {
      baseUrl: getRequestBaseUrl(req),
      sudoPassword: req.currentWebSession?.sudoPassword,
    });
    res.json({ items: sessions });
  } catch (error) {
    next(error);
  }
});

app.post("/api/sessions", requireAuth, async (req, res, next) => {
  try {
    const { templateId } = req.body ?? {};

    if (!templateId) {
      res.status(400).json({ error: "templateId is required" });
      return;
    }

    const session = await createSession(templateId, req.currentUser, {
      baseUrl: getRequestBaseUrl(req),
      sudoPassword: req.currentWebSession?.sudoPassword,
    });
    res.status(201).json(session);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/sessions/:name", requireAuth, async (req, res, next) => {
  try {
    await deleteSession(req.params.name, {
      ...req.currentUser,
      sudoPassword: req.currentWebSession?.sudoPassword,
    });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.get("/api/users", requireAdmin, async (_req, res, next) => {
  try {
    const users = await listUsers();
    res.json({ items: users });
  } catch (error) {
    next(error);
  }
});

app.post("/api/users", requireAdmin, async (req, res, next) => {
  try {
    const user = await createUser(req.body ?? {});
    res.status(201).json({ user });
  } catch (error) {
    next(error);
  }
});

app.use("/workspaces/:name", requireAuth, async (req, res, next) => {
  try {
    const target = await getSessionTarget(req.params.name, {
      ...req.currentUser,
      sudoPassword: req.currentWebSession?.sudoPassword,
    });

    if (!target) {
      res.status(404).json({ error: "Workspace no encontrado" });
      return;
    }

    req.workspaceTarget = target;
    next();
  } catch (error) {
    next(error);
  }
});

app.use("/workspaces/:name", (req, res) => {
  proxyHttpRequest(req, res, req.workspaceTarget, req.params.name);
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(frontendPath, "index.html"));
});

app.use((error, _req, res, _next) => {
  const status = error.statusCode || 500;
  res.status(status).json({
    code: error.code || null,
    error: error.message || "Unexpected server error",
  });
});

const server = http.createServer(app);

server.on("upgrade", async (req, socket, head) => {
  try {
    const cookies = parseCookies(req.headers.cookie);
    const session = getWebSession(cookies[sessionCookieName]);

    if (!session?.user) {
      socket.destroy();
      return;
    }

    const match = req.url?.match(/^\/workspaces\/([^/]+)(\/.*)?$/);

    if (!match) {
      socket.destroy();
      return;
    }

    const name = decodeURIComponent(match[1]);
    const target = await getSessionTarget(name, {
      ...session.user,
      sudoPassword: session.sudoPassword,
    });

    if (!target) {
      socket.destroy();
      return;
    }

    proxyWsRequest(req, socket, head, target);
  } catch (_error) {
    socket.destroy();
  }
});

server.listen(port, host, () => {
  console.log(`Kids Workspaces running on http://${host}:${port}`);
});
