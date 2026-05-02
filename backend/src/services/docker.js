import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { findTemplateById } from "./templates.js";

const managedLabel = "kids.workspace.managed=true";
const publicBaseUrl = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
const defaultAppHost = process.env.APP_HOST || "localhost";
const sessionProxyHost = process.env.SESSION_PROXY_HOST || defaultAppHost;
const dockerUseSudo = process.env.DOCKER_USE_SUDO === "true";
const dockerCommand = process.env.DOCKER_BIN || "docker";
const dockerSudoNonInteractive = process.env.DOCKER_SUDO_NON_INTERACTIVE !== "false";

function resolveDockerInvocation(args) {
  if (dockerUseSudo) {
    return {
      command: "sudo",
      args: [
        ...(dockerSudoNonInteractive ? ["-n"] : ["-S", "-p", ""]),
        dockerCommand,
        ...args,
      ],
    };
  }

  return {
    command: dockerCommand,
    args,
  };
}

function httpError(message, statusCode = 500, code = undefined) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) {
    error.code = code;
  }
  return error;
}

async function runCommand(command, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: "pipe",
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const error = new Error(stderr || `Command failed with exit code ${code}`);
      error.code = code;
      error.stderr = stderr;
      error.stdout = stdout;
      reject(error);
    });

    if (options.stdin) {
      child.stdin.write(options.stdin);
    }

    child.stdin.end();
  });
}

async function runDocker(args, options = {}) {
  try {
    const invocation = resolveDockerInvocation(args);
    const result = await runCommand(invocation.command, invocation.args, {
      stdin: dockerUseSudo && options.sudoPassword ? `${options.sudoPassword}\n` : undefined,
    });

    return result.stdout.trim();
  } catch (error) {
    if (error.code === "ENOENT") {
      throw httpError(
        dockerUseSudo
          ? "No encontre sudo o docker en PATH. Revisa DOCKER_USE_SUDO, DOCKER_BIN y tu entorno."
          : "Docker no esta disponible en PATH. Instala Docker Desktop o ajusta tu PATH.",
        500,
      );
    }

    const details = error.stderr?.trim() || error.message;
    if (dockerUseSudo && /sudo:.*password|a password is required|sudoers|not allowed to execute/i.test(details)) {
      throw httpError(
        "Docker requiere contrasena sudo para continuar.",
        401,
        "SUDO_PASSWORD_REQUIRED",
      );
    }
    throw httpError(`Docker fallo: ${details}`, 500);
  }
}

async function tryRunDocker(args, options = {}) {
  try {
    return await runDocker(args, options);
  } catch (_error) {
    return null;
  }
}

export async function probeDocker(options = {}) {
  try {
    await runDocker(["version", "--format", "{{.Server.Version}}"], options);
    return true;
  } catch (_error) {
    return false;
  }
}

function buildSessionName(templateId) {
  const suffix = crypto.randomBytes(3).toString("hex");
  return `kids-${templateId}-${suffix}`;
}

function buildWorkspacePath(sessionName, template) {
  const basePath = `/workspaces/${sessionName}`;
  const nestedPath = template?.urlPath && template.urlPath !== "/" ? template.urlPath : "";
  return nestedPath ? `${basePath}${nestedPath}` : `${basePath}/`;
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "").replace(/\/$/, "");
}

function resolveBaseUrl(baseUrl) {
  return normalizeBaseUrl(baseUrl) || publicBaseUrl || `http://${defaultAppHost}:${process.env.PORT || 3000}`;
}

function resolveDirectHost(baseUrl) {
  try {
    return new URL(resolveBaseUrl(baseUrl)).hostname;
  } catch (_error) {
    return defaultAppHost;
  }
}

function buildPublicUrl(sessionName, template, baseUrl) {
  const path = buildWorkspacePath(sessionName, template);
  return `${resolveBaseUrl(baseUrl)}${path}`;
}

function buildLocalProxyUrl(sessionName, template, baseUrl) {
  const resolvedBaseUrl = resolveBaseUrl(baseUrl);

  try {
    const parsed = new URL(resolvedBaseUrl);
    return `${parsed.protocol}//${parsed.host}${buildWorkspacePath(sessionName, template)}`;
  } catch (_error) {
    return `http://${sessionProxyHost}:${process.env.PORT || 3000}${buildWorkspacePath(sessionName, template)}`;
  }
}

function buildDockerArgs(template, sessionName, owner) {
  const containerPort = Number(template.containerPort || 3000);
  const protocol = template.protocol === "https" ? "https" : "http";
  const args = [
    "run",
    "-d",
    "--name",
    sessionName,
    "--label",
    managedLabel,
    "--label",
    `kids.workspace.template=${template.id}`,
    "--label",
    `kids.workspace.ownerId=${owner.id}`,
    "--label",
    `kids.workspace.ownerEmail=${owner.email}`,
    "--label",
    `kids.workspace.ownerName=${owner.name}`,
    "--label",
    `kids.workspace.protocol=${protocol}`,
    "--label",
    `kids.workspace.internalPort=${containerPort}`,
    "--shm-size",
    template.shmSize || "1gb",
    "-p",
    `127.0.0.1::${containerPort}`,
  ];

  for (const [key, value] of Object.entries(template.env ?? {})) {
    args.push("-e", `${key}=${value}`);
  }

  for (const volume of template.volumes ?? []) {
    args.push("-v", volume);
  }

  args.push(template.image);
  return args;
}

function parseHostPort(portsValue) {
  const hostPortMatch = portsValue?.match(/:(\d+)->/);
  return hostPortMatch ? Number(hostPortMatch[1]) : null;
}

function parseTemplateId(labelsValue) {
  return labelsValue
    ?.split(",")
    .find((label) => label.startsWith("kids.workspace.template="))
    ?.split("=")[1] || null;
}

function parseLabelValue(labelsValue, prefix) {
  return labelsValue
    ?.split(",")
    .find((label) => label.startsWith(prefix))
    ?.slice(prefix.length) || null;
}

function mapSessionRow(row, baseUrl) {
  const hostPort = parseHostPort(row.Ports);
  const templateId = parseTemplateId(row.Labels);
  const proxyPath = `/workspaces/${row.Names}/`;
  const protocol = parseLabelValue(row.Labels, "kids.workspace.protocol=") || "http";
  const internalPort = Number(parseLabelValue(row.Labels, "kids.workspace.internalPort=") || 3000);
  const directHost = resolveDirectHost(baseUrl);

  return {
    id: row.ID,
    name: row.Names,
    image: row.Image,
    templateId,
    ownerId: parseLabelValue(row.Labels, "kids.workspace.ownerId="),
    ownerEmail: parseLabelValue(row.Labels, "kids.workspace.ownerEmail="),
    ownerName: parseLabelValue(row.Labels, "kids.workspace.ownerName="),
    protocol,
    internalPort,
    state: row.State,
    status: row.Status,
    hostPort,
    url: buildLocalProxyUrl(row.Names, null, baseUrl),
    localUrl: hostPort ? `${protocol}://${directHost}:${hostPort}` : null,
    proxyPath,
  };
}

async function getSessionRow(name, includeStopped = false, options = {}) {
  const command = includeStopped ? "ps" : "ps";
  const args = [
    command,
    ...(includeStopped ? ["-a"] : []),
    "--filter",
    `name=^/${name}$`,
    "--filter",
    `label=${managedLabel}`,
    "--format",
    "{{json .}}",
  ];
  const stdout = await tryRunDocker(args, options);

  if (!stdout) {
    return null;
  }

  return JSON.parse(stdout.split(/\r?\n/)[0]);
}

export async function listSessions(user, options = {}) {
  const stdout = await tryRunDocker([
    "ps",
    "-a",
    "--filter",
    `label=${managedLabel}`,
    "--format",
    "{{json .}}",
  ], options);

  if (!stdout) {
    return [];
  }

  const sessions = stdout
    .split(/\r?\n/)
    .map((line) => mapSessionRow(JSON.parse(line), options.baseUrl));

  if (options.includeAll || user?.role === "admin") {
    return sessions;
  }

  return sessions.filter((session) => session.ownerId === user?.id);
}

export async function createSession(templateId, owner, options = {}) {
  const template = await findTemplateById(templateId);

  if (!template) {
    throw httpError(`Template no encontrado: ${templateId}`, 404);
  }

  if (!owner?.id) {
    throw httpError("No hay usuario autenticado para crear la sesion.", 401);
  }

  const sessionName = buildSessionName(template.id);
  const args = buildDockerArgs(template, sessionName, owner);

  await runDocker(args);

  const row = await getSessionRow(sessionName, false, options);
  const hostPort = row ? parseHostPort(row.Ports) : null;

  if (!hostPort) {
    throw httpError("La sesion se creo, pero no pude resolver su puerto publicado.", 500);
  }

  return {
    name: sessionName,
    templateId: template.id,
    image: template.image,
    ownerId: owner.id,
    ownerName: owner.name,
    protocol: template.protocol === "https" ? "https" : "http",
    internalPort: Number(template.containerPort || 3000),
    hostPort,
    proxyPath: buildWorkspacePath(sessionName, template),
    url: buildPublicUrl(sessionName, template, options.baseUrl),
    localUrl: `${template.protocol === "https" ? "https" : "http"}://${resolveDirectHost(options.baseUrl)}:${hostPort}${template.urlPath || "/"}`,
  };
}

export async function deleteSession(name, user) {
  if (!name) {
    throw httpError("Session name is required", 400);
  }

  const row = await getSessionRow(name, true);

  if (!row) {
    throw httpError("Sesion no encontrada.", 404);
  }

  const session = mapSessionRow(row);

  if (user?.role !== "admin" && session.ownerId !== user?.id) {
    throw httpError("No tienes permisos para detener esta sesion.", 403);
  }

  await runDocker(["rm", "-f", name], {
    sudoPassword: user?.sudoPassword,
  });
}

export async function getSessionTarget(name, user) {
  if (!name) {
    return null;
  }

  const row = await getSessionRow(name, false, {
    sudoPassword: user?.sudoPassword,
  });

  if (!row) {
    return null;
  }

  const session = mapSessionRow(row);

  if (user?.role !== "admin" && session.ownerId !== user?.id) {
    return null;
  }

  const hostPort = parseHostPort(row.Ports);

  if (!hostPort) {
    return null;
  }

  return `${session.protocol || "http"}://${sessionProxyHost}:${hostPort}`;
}
