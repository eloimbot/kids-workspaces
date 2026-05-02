import crypto from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const usersPath = path.resolve(__dirname, "../../data/users.json");

function httpError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function readUsers() {
  const raw = await readFile(usersPath, "utf8");
  return JSON.parse(raw);
}

async function writeUsers(users) {
  await writeFile(usersPath, JSON.stringify(users, null, 2));
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function sanitizeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };
}

export async function listUsers() {
  const users = await readUsers();
  return users.map(sanitizeUser);
}

export async function findUserByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  const users = await readUsers();
  return users.find((user) => user.email === normalizedEmail) ?? null;
}

export async function authenticateUser(email, password) {
  const user = await findUserByEmail(email);

  if (!user) {
    throw httpError("Usuario o contrasena incorrectos.", 401);
  }

  const providedHash = hashPassword(password, user.passwordSalt);

  if (providedHash !== user.passwordHash) {
    throw httpError("Usuario o contrasena incorrectos.", 401);
  }

  return sanitizeUser(user);
}

export async function createUser({ name, email, password, role }) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedRole = role === "admin" ? "admin" : "manager";

  if (!name || !normalizedEmail || !password) {
    throw httpError("name, email y password son obligatorios.", 400);
  }

  const users = await readUsers();
  const existingUser = users.find((user) => user.email === normalizedEmail);

  if (existingUser) {
    throw httpError("Ya existe un usuario con ese email.", 409);
  }

  const passwordSalt = crypto.randomBytes(16).toString("hex");
  const passwordHash = hashPassword(password, passwordSalt);
  const user = {
    id: `usr_${crypto.randomBytes(5).toString("hex")}`,
    name: String(name).trim(),
    email: normalizedEmail,
    role: normalizedRole,
    passwordSalt,
    passwordHash,
  };

  users.push(user);
  await writeUsers(users);
  return sanitizeUser(user);
}

export function canManageAllSessions(user) {
  return user?.role === "admin";
}
