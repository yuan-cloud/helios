// Utilities for storing and retrieving visualization layout snapshots via the
// StorageWorkerClient. These helpers sanitize payloads before persisting them to
// SQLite (OPFS-backed) and provide thin wrappers for common operations.

export const LAYOUT_SNAPSHOT_VERSION = 1;

function toFiniteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function normalizeNodeEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const id =
    typeof entry.id === "string" && entry.id.trim().length > 0
      ? entry.id
      : entry.fqName || entry.name || null;
  if (!id) {
    return null;
  }
  return {
    id,
    x: toFiniteOrNull(entry.x),
    y: toFiniteOrNull(entry.y),
    z: toFiniteOrNull(entry.z),
    fx: toFiniteOrNull(entry.fx),
    fy: toFiniteOrNull(entry.fy),
    fz: toFiniteOrNull(entry.fz),
  };
}

export function normalizeLayoutSnapshot(nodes) {
  if (!Array.isArray(nodes)) {
    return [];
  }
  const normalized = [];
  nodes.forEach((entry) => {
    const normalizedEntry = normalizeNodeEntry(entry);
    if (normalizedEntry) {
      normalized.push(normalizedEntry);
    }
  });
  return normalized;
}

export async function saveLayoutSnapshot(client, params = {}) {
  if (!client || typeof client.saveLayoutSnapshot !== "function") {
    throw new TypeError("Storage client with saveLayoutSnapshot method is required.");
  }
  const {
    graphKey,
    graphHash = null,
    snapshot = [],
    metadata = null,
    layoutVersion = LAYOUT_SNAPSHOT_VERSION,
  } = params;

  const normalizedSnapshot = normalizeLayoutSnapshot(snapshot);
  return client.saveLayoutSnapshot({
    graphKey,
    graphHash,
    layout: normalizedSnapshot,
    metadata,
    layoutVersion,
    nodeCount: normalizedSnapshot.length,
  });
}

export async function loadLayoutSnapshot(client, graphKey) {
  if (!client || typeof client.loadLayoutSnapshot !== "function") {
    throw new TypeError("Storage client with loadLayoutSnapshot method is required.");
  }
  if (!graphKey || typeof graphKey !== "string") {
    throw new TypeError("graphKey must be a non-empty string.");
  }
  const result = await client.loadLayoutSnapshot(graphKey);
  if (!result || !Array.isArray(result.layout)) {
    return null;
  }
  
  // Validate layout version - return null if version mismatch to trigger regeneration
  const layoutVersion = result.layoutVersion ?? result.layout_version ?? null;
  if (layoutVersion !== null && layoutVersion !== LAYOUT_SNAPSHOT_VERSION) {
    console.warn(
      `[Layout] Snapshot version mismatch for ${graphKey}: stored ${layoutVersion}, expected ${LAYOUT_SNAPSHOT_VERSION}. Layout will be regenerated.`
    );
    // Clear incompatible snapshot
    await deleteLayoutSnapshot(client, graphKey);
    return null;
  }
  
  return {
    ...result,
    layout: normalizeLayoutSnapshot(result.layout),
  };
}

export async function deleteLayoutSnapshot(client, graphKey) {
  if (!client || typeof client.deleteLayoutSnapshot !== "function") {
    throw new TypeError("Storage client with deleteLayoutSnapshot method is required.");
  }
  if (!graphKey || typeof graphKey !== "string") {
    throw new TypeError("graphKey must be a non-empty string.");
  }
  return client.deleteLayoutSnapshot(graphKey);
}

export async function listLayoutSnapshots(client, options = {}) {
  if (!client || typeof client.listLayoutSnapshots !== "function") {
    throw new TypeError("Storage client with listLayoutSnapshots method is required.");
  }
  return client.listLayoutSnapshots(options);
}


