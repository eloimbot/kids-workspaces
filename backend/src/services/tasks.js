import crypto from "node:crypto";

const jobs = new Map();
const jobTtlMs = 1000 * 60 * 30;

function cleanupJobs() {
  const now = Date.now();

  for (const [id, job] of jobs.entries()) {
    if (now - job.updatedAt > jobTtlMs) {
      jobs.delete(id);
    }
  }
}

function sanitizeJob(job) {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    progress: job.progress,
    message: job.message,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    ownerId: job.ownerId,
    templateId: job.templateId,
    data: job.data ?? null,
    code: job.code ?? null,
    error: job.error ?? null,
  };
}

export function createJob({ type, ownerId, templateId = null, message = "Queued" }) {
  cleanupJobs();

  const job = {
    id: crypto.randomBytes(10).toString("hex"),
    type,
    ownerId,
    templateId,
    status: "pending",
    progress: 0,
    message,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    data: null,
    code: null,
    error: null,
  };

  jobs.set(job.id, job);
  return sanitizeJob(job);
}

export function updateJob(id, patch = {}) {
  const job = jobs.get(id);

  if (!job) {
    return null;
  }

  Object.assign(job, patch, { updatedAt: Date.now() });
  return sanitizeJob(job);
}

export function completeJob(id, data = null, message = "Completed") {
  return updateJob(id, {
    status: "completed",
    progress: 100,
    message,
    data,
    error: null,
    code: null,
  });
}

export function failJob(id, error) {
  return updateJob(id, {
    status: "failed",
    message: error?.message || "Job failed",
    error: error?.message || "Job failed",
    code: error?.code || null,
  });
}

export function getJob(id) {
  cleanupJobs();

  const job = jobs.get(id);
  return job ? sanitizeJob(job) : null;
}

export function canAccessJob(job, user) {
  if (!job || !user) {
    return false;
  }

  return user.role === "admin" || job.ownerId === user.id;
}
