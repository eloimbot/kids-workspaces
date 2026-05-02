import { execFile } from "node:child_process";
import { promisify } from "node:util";
import crypto from "node:crypto";
import { findTemplateById } from "./templates.js";

const execFileAsync = promisify(execFile);
const managedLabel = "kids.workspace.managed=true";
const appHost = process.env.APP_HOST || "localhost";
const publicBaseUrl = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
const sessionProxyHost = process.env.SESSION_PROXY_HOST || appHost;

function httpError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function runDocker(args) {
  try {
    const result = await execFileAsync("docker", args, {
      windowsHide: true,
    });

    return result.stdout.trim();
  } catch (error) {
    if (error.code === "ENOENT") {
      throw httpError(
        "Docker no esta disponible en PATH. Instala Docker Desktop o ajusta tu PATH.",
        500,
      );
    }

    const details = error.stderr?.trim() || error.message;
    throw httpError(`Docker fallo: ${details}`, 500);
  }
}

async function tryRunDocker(args) {
  try {
    return await runDocker(args);
  } catch (_error) {
    return null;
  }
}

export async function probeDocker() {
  try {
    await runDocker(["version", "--format", "{{.Server.Version}}"]);
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

function buildPublicUrl(sessionName, template) {
  const path = buildWorkspacePath(sessionName, template);
  return publicBaseUrl ? `${publicBaseUrl}${path}` : `http://${appHost}:${process.env.PORT || 3000}${path}`;
}

function buildLocalProxyUrl(sessionName, template) {
  return `http://${sessionProxyHost}:${process.env.PORT || 3000}${buildWorkspacePath(sessionName, template)}`;
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

function mapSessionRow(row) {
  const hostPort = parseHostPort(row.Ports);
  const templateId = parseTemplateId(row.Labels);
  const proxyPath = `/workspaces/${row.Names}/`;
  const protocol = parseLabelValue(row.Labels, "kids.workspace.protocol=") || "http";
  const internalPort = Number(parseLabelValue(row.Labels, "kids.workspace.internalPort=") || 3000);

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
    url: publicBaseUrl ? `${publicBaseUrl}${proxyPath}` : buildLocalProxyUrl(row.Names, null),
    localUrl: hostPort ? `${protocol}://${appHost}:${hostPort}` : null,
    proxyPath,
  };
}

async function getSessionRow(name, includeStopped = false) {
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
  const stdout = await tryRunDocker(args);

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
  ]);

  if (!stdout) {
    return [];
  }

  const sessions = stdout.split(/\r?\n/).map((line) => mapSessionRow(JSON.parse(line)));

  if (options.includeAll || user?.role === "admin") {
    return sessions;
  }

  return sessions.filter((session) => session.ownerId === user?.id);
}

export async function createSession(templateId, owner) {
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

  const row = await getSessionRow(sessionName);
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
    url: buildPublicUrl(sessionName, template),
    localUrl: `${template.protocol === "https" ? "https" : "http"}://${appHost}:${hostPort}${template.urlPath || "/"}`,
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

  await runDocker(["rm", "-f", name]);
}

export async function getSessionTarget(name, user) {
  if (!name) {
    return null;
  }

  const row = await getSessionRow(name);

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
