import crypto from "node:crypto";

const sessionLifetimeSeconds = 60 * 60 * 12;
const sessions = new Map();

function cleanupExpiredSessions() {
  const now = Date.now();

  for (const [token, session] of sessions.entries()) {
    if (session.expiresAt <= now) {
      sessions.delete(token);
    }
  }
}

export function createWebSession(user) {
  cleanupExpiredSessions();

  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, {
    user,
    expiresAt: Date.now() + sessionLifetimeSeconds * 1000,
  });

  return {
    token,
    maxAgeSeconds: sessionLifetimeSeconds,
  };
}

export function getWebSession(token) {
  cleanupExpiredSessions();

  if (!token) {
    return null;
  }

  const session = sessions.get(token);

  if (!session) {
    return null;
  }

  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }

  return session;
}

export function destroyWebSession(token) {
  if (token) {
    sessions.delete(token);
  }
}
