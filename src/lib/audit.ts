// Lightweight tamper-evident-ish audit log for sensitive operations.
// Best-effort — failures here never break the user-visible request. The log is bounded
// to ~5000 most-recent rows so it can't grow unboundedly.

import { getDb } from "./db";

const MAX_ROWS = 5000;

export interface AuditEvent {
  event: string;                  // dotted name e.g. 'profile.delete'
  target_type?: string | null;    // 'profile' | 'session' | 'folder' | 'backup'
  target_id?: number | null;
  target_label?: string | null;
  details?: Record<string, unknown> | null;
}

export function audit(e: AuditEvent): void {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO audit_log (event, target_type, target_id, target_label, details)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      e.event,
      e.target_type ?? null,
      e.target_id ?? null,
      e.target_label ?? null,
      e.details ? JSON.stringify(e.details) : null,
    );

    // Trim opportunistically (only when over by a margin to avoid every-write churn).
    const count = db.prepare('SELECT COUNT(*) as n FROM audit_log').get() as { n: number };
    if (count.n > MAX_ROWS + 100) {
      db.prepare(`
        DELETE FROM audit_log WHERE id IN (
          SELECT id FROM audit_log ORDER BY at DESC, id DESC LIMIT -1 OFFSET ?
        )
      `).run(MAX_ROWS);
    }
  } catch (err) {
    console.warn('audit write failed:', err);
  }
}

export interface AuditRow {
  id: number;
  event: string;
  target_type: string | null;
  target_id: number | null;
  target_label: string | null;
  details: string | null;
  at: string;
}

export function listAudit(limit = 200): AuditRow[] {
  try {
    const db = getDb();
    return db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(Math.min(Math.max(1, limit), 1000)) as AuditRow[];
  } catch {
    return [];
  }
}
