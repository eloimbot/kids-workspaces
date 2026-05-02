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
const defaultExternalProtocol = process.env.APP_PROTOCOL
  || (process.env.HTTPS_ENABLED === "true" ? "https" : "http");

function shouldUseSudo(options = {}) {
  return dockerUseSudo || Boolean(options.sudoPassword);
}

function resolveDockerInvocation(args, options = {}) {
  if (shouldUseSudo(options)) {
    const sudoArgs = options.sudoPassword
      ? ["-S", "-p", ""]
      : (dockerSudoNonInteractive ? ["-n"] : ["-S", "-p", ""]);

    return {
      command: "sudo",
      args: [...sudoArgs, dockerCommand, ...args],
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

async function runStreamingCommand(command, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: "pipe",
    });
    let stdout = "";
    let stderr = "";

    const handleChunk = (streamName, chunk) => {
      const text = chunk.toString();

      if (streamName === "stdout") {
        stdout += text;
        options.onStdout?.(text);
      } else {
        stderr += text;
        options.onStderr?.(text);
      }
    };

    child.stdout.on("data", (chunk) => handleChunk("stdout", chunk));
    child.stderr.on("data", (chunk) => handleChunk("stderr", chunk));
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
    const invocation = resolveDockerInvocation(args, options);
    const result = await runCommand(invocation.command, invocation.args, {
      stdin: shouldUseSudo(options) && options.sudoPassword ? `${options.sudoPassword}\n` : undefined,
    });

    return result.stdout.trim();
  } catch (error) {
    if (error.code === "ENOENT") {
      throw httpError(
        shouldUseSudo(options)
          ? "No encontre sudo o docker en PATH. Revisa DOCKER_USE_SUDO, DOCKER_BIN y tu entorno."
          : "Docker no esta disponible en PATH. Instala Docker Desktop o ajusta tu PATH.",
        500,
      );
    }

    const details = error.stderr?.trim() || error.message;
    const sudoPasswordRequired =
      shouldUseSudo(options)
      && /sudo:.*password|a password is required|sudoers|not allowed to execute/i.test(details);
    const dockerSocketPermissionDenied =
      !shouldUseSudo(options)
      && /permission denied while trying to connect to the docker api|got permission denied while trying to connect to the docker daemon socket|permission denied.*\/var\/run\/docker\.sock/i.test(details);

    if (sudoPasswordRequired || dockerSocketPermissionDenied) {
      throw httpError(
        "Docker requiere permisos sudo para continuar.",
        401,
        "SUDO_PASSWORD_REQUIRED",
      );
    }
    throw httpError(`Docker fallo: ${details}`, 500);
  }
}

async function runDockerStreaming(args, options = {}) {
  try {
    const invocation = resolveDockerInvocation(args, options);
    return await runStreamingCommand(invocation.command, invocation.args, {
      stdin: shouldUseSudo(options) && options.sudoPassword ? `${options.sudoPassword}\n` : undefined,
      onStdout: options.onStdout,
      onStderr: options.onStderr,
    });
  } catch (error) {
    if (error.code === "ENOENT") {
      throw httpError(
        shouldUseSudo(options)
          ? "No encontre sudo o docker en PATH. Revisa DOCKER_USE_SUDO, DOCKER_BIN y tu entorno."
          : "Docker no esta disponible en PATH. Instala Docker Desktop o ajusta tu PATH.",
        500,
      );
    }

    const details = error.stderr?.trim() || error.message;
    const sudoPasswordRequired =
      shouldUseSudo(options)
      && /sudo:.*password|a password is required|sudoers|not allowed to execute/i.test(details);
    const dockerSocketPermissionDenied =
      !shouldUseSudo(options)
      && /permission denied while trying to connect to the docker api|got permission denied while trying to connect to the docker daemon socket|permission denied.*\/var\/run\/docker\.sock/i.test(details);

    if (sudoPasswordRequired || dockerSocketPermissionDenied) {
      throw httpError(
        "Docker requiere permisos sudo para continuar.",
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
  } catch (error) {
    if (error.code === "SUDO_PASSWORD_REQUIRED") {
      throw error;
    }

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

export async function listLocalImages(options = {}) {
  const stdout = await runDocker(["image", "ls", "--format", "{{.Repository}}:{{.Tag}}"], options);

  return new Set(
    stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  );
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
  return normalizeBaseUrl(baseUrl) || publicBaseUrl || `${defaultExternalProtocol}://${defaultAppHost}:${process.env.PORT || 3000}`;
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
    return `${defaultExternalProtocol}://${sessionProxyHost}:${process.env.PORT || 3000}${buildWorkspacePath(sessionName, template)}`;
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

  await runDocker(args, options);

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

  const row = await getSessionRow(name, true, {
    sudoPassword: user?.sudoPassword,
  });

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

function normalizePullLine(line) {
  return String(line || "").replace(/\u001b\[[0-9;]*m/g, "").replace(/\r/g, "").trim();
}

function parseProgressNumber(value) {
  const match = String(value || "").trim().match(/^([\d.]+)\s*([KMGT]?B)$/i);

  if (!match) {
    return null;
  }

  const units = {
    B: 1,
    KB: 1024,
    MB: 1024 ** 2,
    GB: 1024 ** 3,
    TB: 1024 ** 4,
  };

  return Number(match[1]) * (units[match[2].toUpperCase()] || 1);
}

function summarizePullProgress(layers) {
  const values = [...layers.values()];

  if (!values.length) {
    return {
      progress: 8,
      message: "Preparing image download",
    };
  }

  const total = values.reduce((sum, layer) => sum + layer.progress, 0);
  const completed = values.filter((layer) => layer.progress >= 1).length;
  const percent = Math.max(5, Math.min(99, Math.round((total / values.length) * 100)));

  return {
    progress: percent,
    message: `Downloading image layers (${completed}/${values.length})`,
  };
}

function updateLayerState(layers, line) {
  const layerMatch = line.match(/^([a-z0-9]+):\s+(.+)$/i);

  if (!layerMatch) {
    if (/status:\s+(downloaded newer image|image is up to date)/i.test(line)) {
      return {
        progress: 100,
        message: line,
      };
    }

    if (/pulling from/i.test(line)) {
      return {
        progress: 4,
        message: line,
      };
    }

    return null;
  }

  const [, layerId, rawStatus] = layerMatch;
  const status = rawStatus.trim();
  const state = layers.get(layerId) ?? { progress: 0 };

  if (/already exists|pull complete/i.test(status)) {
    state.progress = 1;
  } else if (/waiting/i.test(status)) {
    state.progress = Math.max(state.progress, 0.05);
  } else if (/pulling fs layer/i.test(status)) {
    state.progress = Math.max(state.progress, 0.12);
  } else if (/verifying checksum/i.test(status)) {
    state.progress = Math.max(state.progress, 0.72);
  } else if (/download complete/i.test(status)) {
    state.progress = Math.max(state.progress, 0.62);
  } else if (/extracting\s+\[.*\]\s+([\d.]+\s*[KMGT]?B)\/([\d.]+\s*[KMGT]?B)/i.test(status)) {
    const match = status.match(/extracting\s+\[.*\]\s+([\d.]+\s*[KMGT]?B)\/([\d.]+\s*[KMGT]?B)/i);
    const current = parseProgressNumber(match?.[1]);
    const total = parseProgressNumber(match?.[2]);

    if (current && total) {
      state.progress = Math.max(state.progress, 0.62 + Math.min(current / total, 1) * 0.32);
    } else {
      state.progress = Math.max(state.progress, 0.8);
    }
  } else if (/downloading\s+\[.*\]\s+([\d.]+\s*[KMGT]?B)\/([\d.]+\s*[KMGT]?B)/i.test(status)) {
    const match = status.match(/downloading\s+\[.*\]\s+([\d.]+\s*[KMGT]?B)\/([\d.]+\s*[KMGT]?B)/i);
    const current = parseProgressNumber(match?.[1]);
    const total = parseProgressNumber(match?.[2]);

    if (current && total) {
      state.progress = Math.max(state.progress, 0.12 + Math.min(current / total, 1) * 0.48);
    } else {
      state.progress = Math.max(state.progress, 0.32);
    }
  }

  layers.set(layerId, state);
  return summarizePullProgress(layers);
}

export async function pullImage(image, options = {}) {
  const layers = new Map();
  let buffer = "";

  const processChunk = (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const rawLine of lines) {
      const line = normalizePullLine(rawLine);

      if (!line) {
        continue;
      }

      const update = updateLayerState(layers, line);

      if (update) {
        options.onProgress?.(update);
      }
    }
  };

  options.onProgress?.({
    progress: 2,
    message: "Starting image download",
  });

  await runDockerStreaming(["pull", image], {
    sudoPassword: options.sudoPassword,
    onStdout: processChunk,
    onStderr: processChunk,
  });

  if (buffer.trim()) {
    const update = updateLayerState(layers, normalizePullLine(buffer));
    if (update) {
      options.onProgress?.(update);
    }
  }

  options.onProgress?.({
    progress: 100,
    message: "Image downloaded",
  });
}
