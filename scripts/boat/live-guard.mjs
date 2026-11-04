// Offline admission and bookkeeping only. No credentials, SDK, network or deletes.
import {
  constants,
  openSync,
  closeSync,
  fsyncSync,
  writeSync,
  readFileSync,
  lstatSync,
} from "node:fs";
import path from "node:path";

const fields = [
  "version",
  "runId",
  "accountId",
  "approved",
  "expiresAt",
  "machineType",
  "maxMachines",
  "maxSeconds",
  "ttlSeconds",
  "budgetUsd",
  "estimatedTotalUsd",
  "acknowledgeUnboundedCleanupCost",
];
const fail = (message) => {
  throw new Error(message);
};
const id = (value) =>
  typeof value === "string" &&
  /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value);
const integer = (value, min, max) =>
  Number.isSafeInteger(value) && value >= min && value <= max;

/** Operator approval is a prerequisite, not an authorization service or dollar cap. */
export function validateApproval(raw, now = Date.now()) {
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    Object.keys(raw).length !== fields.length ||
    fields.some((key) => !Object.hasOwn(raw, key)) ||
    raw.version !== 1 ||
    raw.approved !== true ||
    !id(raw.accountId) ||
    typeof raw.runId !== "string" ||
    !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(raw.runId) ||
    raw.machineType !== "small" ||
    !integer(raw.maxMachines, 1, 2) ||
    !integer(raw.maxSeconds, 60, 600) ||
    !integer(raw.ttlSeconds, 60, 300) ||
    !Number.isFinite(raw.budgetUsd) ||
    raw.budgetUsd <= 0 ||
    !Number.isFinite(raw.estimatedTotalUsd) ||
    raw.estimatedTotalUsd <= 0 ||
    raw.estimatedTotalUsd > raw.budgetUsd ||
    raw.acknowledgeUnboundedCleanupCost !== true ||
    !Number.isFinite(now) ||
    typeof raw.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(raw.expiresAt)) ||
    Date.parse(raw.expiresAt) <= now ||
    Date.parse(raw.expiresAt) > now + 3600000
  )
    fail("Invalid live approval");
  return structuredClone(raw);
}

function apply(state, event) {
  const next = structuredClone(state);
  if (event.type === "reserved") {
    if (next.creations.length >= next.approval.maxMachines)
      fail("Machine count exhausted");
    if (next.creations.some((item) => item.providerId === null))
      fail("Creation unresolved");
    if (
      event.intentId !== `${next.approval.runId}:${next.creations.length + 1}`
    )
      fail("Invalid intent");
    if (event.kind !== "create" && event.kind !== "fork")
      fail("Invalid creation kind");
    if (
      event.kind === "fork" &&
      !next.creations.some(
        (item) =>
          item.providerId === event.parentId &&
          item.cleanup === "not-requested",
      )
    )
      fail("Fork parent must be owned");
    if (event.kind === "create" && event.parentId !== null)
      fail("Invalid parent");
    next.creations.push({
      intentId: event.intentId,
      kind: event.kind,
      parentId: event.parentId,
      providerId: null,
      deletionJobId: null,
      cleanup: "not-requested",
    });
  } else if (event.type === "created") {
    const item = next.creations.find(
      (item) => item.intentId === event.intentId,
    );
    if (
      !item ||
      item.providerId !== null ||
      !id(event.providerId) ||
      next.creations.some((item) => item.providerId === event.providerId)
    )
      fail("Invalid owned creation result");
    item.providerId = event.providerId;
  } else {
    const item = next.creations.find(
      (item) => item.providerId === event.providerId,
    );
    if (!item || !id(event.providerId)) fail("Cleanup target must be owned");
    if (event.type === "deleting") {
      if (item.cleanup !== "not-requested") fail("Deletion already requested");
      item.cleanup = "pending";
    } else if (event.type === "deletionAccepted") {
      if (
        item.cleanup !== "pending" ||
        item.deletionJobId !== null ||
        !id(event.jobId)
      )
        fail("Invalid deletion job");
      item.deletionJobId = event.jobId;
    } else if (event.type === "deleted") {
      if (
        item.cleanup !== "pending" ||
        !id(event.jobId) ||
        item.deletionJobId !== event.jobId
      )
        fail("Unverified deletion job");
      item.cleanup = "vm-deleted-snapshots-unverified";
    } else fail("Invalid inventory event");
  }
  return next;
}

function privateDirectory(file) {
  const info = lstatSync(path.dirname(file));
  if (!info.isDirectory() || info.uid !== process.getuid() || info.mode & 0o077)
    fail("Inventory requires an owned private directory");
}

/** Exclusive new inventory. Existing runs can only be inspected, never resumed here. */
export function createInventory(file, rawApproval, clock = Date.now) {
  const startedAt = clock();
  const approval = validateApproval(rawApproval, startedAt);
  privateDirectory(file);
  let fd = openSync(
    file,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  let state = { approval, startedAt, creations: [] };
  let lastNow = startedAt;
  const deadline = Math.min(
    Date.parse(approval.expiresAt),
    startedAt + approval.maxSeconds * 1000,
  );
  function open() {
    if (fd === null) fail("Inventory closed");
  }
  function close() {
    if (fd !== null) {
      const handle = fd;
      fd = null;
      closeSync(handle);
    }
  }
  function append(event) {
    open();
    try {
      const bytes = Buffer.from(`${JSON.stringify(event)}\n`);
      let offset = 0;
      while (offset < bytes.length) {
        const written = writeSync(fd, bytes, offset, bytes.length - offset);
        if (written <= 0) fail("Inventory write failed");
        offset += written;
      }
      fsyncSync(fd);
    } catch {
      close();
      fail("Inventory persistence failed; stop native work");
    }
  }
  try {
    append({ type: "header", approval, startedAt });
    const directory = openSync(path.dirname(file), constants.O_RDONLY);
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  } catch (error) {
    close();
    throw error;
  }
  function record(event) {
    open();
    const next = apply(state, event);
    append(event);
    state = next;
  }
  return {
    reserve(accountId, kind, parentId = null) {
      open();
      if (accountId !== approval.accountId) fail("Test account mismatch");
      const now = clock();
      if (!Number.isFinite(now) || now < lastNow || now >= deadline)
        fail("Admission deadline reached");
      lastNow = now;
      const intentId = `${approval.runId}:${state.creations.length + 1}`;
      record({ type: "reserved", intentId, kind, parentId });
      return intentId;
    },
    created(intentId, providerId) {
      record({ type: "created", intentId, providerId });
    },
    deleting(providerId) {
      record({ type: "deleting", providerId });
    },
    deletionAccepted(providerId, jobId) {
      record({ type: "deletionAccepted", providerId, jobId });
    },
    // Caller must first validate native job kind, targetId, ID and completed status.
    deleted(providerId, jobId) {
      record({ type: "deleted", providerId, jobId });
    },
    close,
  };
}

/** Local inspection only. A malformed/truncated journal never means clean teardown. */
export function readInventory(file) {
  try {
    const info = lstatSync(file);
    if (!info.isFile() || info.size > 65536) fail("Invalid inventory");
    const text = readFileSync(file, "utf8");
    if (!text.endsWith("\n")) fail("Truncated inventory");
    const [header, ...events] = text
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line));
    if (header.type !== "header") fail("Invalid inventory header");
    const approval = validateApproval(header.approval, header.startedAt);
    let state = { approval, startedAt: header.startedAt, creations: [] };
    for (const event of events) state = apply(state, event);
    return state;
  } catch {
    fail("Inventory unreadable or invalid; cleanup remains unresolved");
  }
}
