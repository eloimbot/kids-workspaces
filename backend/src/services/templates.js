import crypto from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const templatesPath = path.resolve(__dirname, "../../data/templates.json");
const catalogPath = path.resolve(__dirname, "../../data/linuxserver-catalog.json");
const officialImagesPath = path.resolve(__dirname, "../../data/linuxserver-images.json");

function httpError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export async function loadTemplates() {
  const raw = await readFile(templatesPath, "utf8");
  return JSON.parse(raw);
}

export async function loadLinuxServerCatalog() {
  const [rawCatalog, rawOfficialImages, templates] = await Promise.all([
    readFile(catalogPath, "utf8"),
    readFile(officialImagesPath, "utf8"),
    loadTemplates(),
  ]);
  const curatedEntries = JSON.parse(rawCatalog);
  const officialImages = JSON.parse(rawOfficialImages);
  const installedImages = new Set(templates.map((template) => template.image));
  const installedIds = new Set(templates.map((template) => template.id));
  const curatedById = new Map(curatedEntries.map((item) => [item.catalogId || item.id, item]));

  return officialImages.map((slug) => {
    const curated = curatedById.get(slug);
    const item = curated ?? {
      catalogId: slug,
      id: slug,
      name: humanizeSlug(slug),
      description: `Imagen oficial de LinuxServer.io para ${humanizeSlug(slug)}.`,
      image: `lscr.io/linuxserver/${slug}:latest`,
      category: inferCategory(slug),
      containerPort: 3000,
      protocol: "http",
      urlPath: "/",
      shmSize: "1gb",
      thumbnail: "",
      env: {
        TZ: "America/Los_Angeles",
        PUID: "1000",
        PGID: "1000",
      },
    };

    return {
      ...item,
      installed: installedImages.has(item.image) || installedIds.has(item.id),
    };
  });
}

export async function findTemplateById(templateId) {
  const templates = await loadTemplates();
  return templates.find((template) => template.id === templateId) ?? null;
}

async function writeTemplates(templates) {
  await writeFile(templatesPath, JSON.stringify(templates, null, 2));
}

function normalizeTemplateId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeCategory(value) {
  return String(value || "custom").trim().toLowerCase() || "custom";
}

function normalizeLinuxServerImage(image) {
  const normalized = String(image || "").trim();

  if (!normalized.startsWith("lscr.io/linuxserver/")) {
    throw httpError("La imagen debe empezar con lscr.io/linuxserver/.", 400);
  }

  return normalized;
}

export async function createTemplate(input) {
  const templates = await loadTemplates();
  const providedId = normalizeTemplateId(input.id);
  const name = String(input.name || "").trim();
  const description = String(input.description || "").trim();
  const image = normalizeLinuxServerImage(input.image);
  const category = normalizeCategory(input.category);
  const containerPort = Number(input.containerPort || 3000);
  const protocol = input.protocol === "https" ? "https" : "http";
  const urlPath = String(input.urlPath || "/").trim() || "/";
  const shmSize = String(input.shmSize || "1gb").trim() || "1gb";
  const thumbnail = String(input.thumbnail || "").trim();
  const env = typeof input.env === "object" && input.env ? input.env : {};

  if (!name) {
    throw httpError("El nombre es obligatorio.", 400);
  }

  if (!description) {
    throw httpError("La descripcion es obligatoria.", 400);
  }

  if (!Number.isFinite(containerPort) || containerPort <= 0) {
    throw httpError("containerPort debe ser un numero valido.", 400);
  }

  const id = providedId || `tpl-${crypto.randomBytes(4).toString("hex")}`;

  if (templates.some((template) => template.id === id)) {
    throw httpError("Ya existe una plantilla con ese id.", 409);
  }

  if (templates.some((template) => template.image === image)) {
    throw httpError("Esa imagen ya existe en el catalogo.", 409);
  }

  const template = {
    id,
    name,
    description,
    image,
    containerPort,
    protocol,
    urlPath,
    shmSize,
    category,
    thumbnail,
    env,
  };

  templates.push(template);
  await writeTemplates(templates);
  return template;
}

export async function installCatalogTemplate(catalogId) {
  const catalog = await loadLinuxServerCatalog();
  const item = catalog.find((entry) => entry.catalogId === catalogId);

  if (!item) {
    throw httpError("No encontre esa app en la tienda linuxserver.io.", 404);
  }

  return createTemplate({
    id: item.id,
    name: item.name,
    description: item.description,
    image: item.image,
    category: item.category,
    containerPort: item.containerPort,
    protocol: item.protocol,
    urlPath: item.urlPath,
    shmSize: item.shmSize,
    thumbnail: item.thumbnail,
    env: item.env,
  });
}

function humanizeSlug(slug) {
  return String(slug)
    .split(/[-.]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function inferCategory(slug) {
  const browserSlugs = new Set([
    "brave",
    "chrome",
    "chromium",
    "firefox",
    "librewolf",
    "msedge",
    "mullvad-browser",
    "opera",
    "ungoogled-chromium",
    "vivaldi",
    "zen",
  ]);
  const desktopSlugs = new Set([
    "webtop",
    "budge",
    "dolphin",
    "filezilla",
    "github-desktop",
    "kali-linux",
    "libreoffice",
    "openshot",
    "thunderbird",
    "vlc",
    "vscode",
    "vscodium",
    "vscodium-web",
    "winegui",
    "wireshark",
    "wps-office",
  ]);
  const devSlugs = new Set([
    "code-server",
    "openvscode-server",
    "pycharm",
    "python",
    "intellij-idea",
    "mysql-workbench",
    "lsio-api",
  ]);

  if (browserSlugs.has(slug)) {
    return "browser";
  }

  if (desktopSlugs.has(slug)) {
    return "desktop";
  }

  if (devSlugs.has(slug)) {
    return "dev";
  }

  return "app";
}
