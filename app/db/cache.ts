import { getD1 } from ".";
export { operationCacheKey, stableSerialize } from "../lib/operation-cache";

type CacheRow = {
  payload_json: string;
  created_at: string;
  expires_at: string;
};

export type OperationCacheHit<T> = {
  payload: T;
  createdAt: string;
  expiresAt: string;
};

export async function ensureOperationCacheTable() {
  const d1 = getD1();
  await d1.batch([
    d1.prepare(`CREATE TABLE IF NOT EXISTS operation_cache (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      contract_version TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_accessed_at TEXT NOT NULL
    )`),
    d1.prepare("CREATE INDEX IF NOT EXISTS operation_cache_kind_idx ON operation_cache (kind)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS operation_cache_expires_idx ON operation_cache (expires_at)"),
  ]);
}

export async function readOperationCache<T>(id: string): Promise<OperationCacheHit<T> | null> {
  try {
    await ensureOperationCacheTable();
    const d1 = getD1();
    const row = await d1.prepare(`SELECT payload_json, created_at, expires_at
      FROM operation_cache WHERE id = ?`).bind(id).first<CacheRow>();
    if (!row) return null;
    const now = new Date();
    if (new Date(row.expires_at).getTime() <= now.getTime()) {
      await d1.prepare("DELETE FROM operation_cache WHERE id = ?").bind(id).run();
      return null;
    }
    await d1.prepare("UPDATE operation_cache SET last_accessed_at = ? WHERE id = ?")
      .bind(now.toISOString(), id)
      .run();
    return {
      payload: JSON.parse(row.payload_json) as T,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  } catch {
    // Cache failure must never block the underlying research operation.
    return null;
  }
}

export async function writeOperationCache(
  id: string,
  kind: string,
  contractVersion: string,
  payload: unknown,
  ttlMilliseconds: number,
) {
  try {
    await ensureOperationCacheTable();
    const d1 = getD1();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMilliseconds);
    await d1.prepare(`INSERT INTO operation_cache (
        id, kind, contract_version, payload_json, created_at, expires_at, last_accessed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        kind = excluded.kind,
        contract_version = excluded.contract_version,
        payload_json = excluded.payload_json,
        created_at = excluded.created_at,
        expires_at = excluded.expires_at,
        last_accessed_at = excluded.last_accessed_at`)
      .bind(
        id,
        kind,
        contractVersion,
        JSON.stringify(payload),
        now.toISOString(),
        expiresAt.toISOString(),
        now.toISOString(),
      )
      .run();
    return { createdAt: now.toISOString(), expiresAt: expiresAt.toISOString() };
  } catch {
    return null;
  }
}
