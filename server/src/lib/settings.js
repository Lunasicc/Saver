import { db } from '../db/index.js';

const selectSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
const upsertSetting = db.prepare(
  `INSERT INTO settings (key, value) VALUES (?, ?)
   ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
);
const deleteSettingStmt = db.prepare('DELETE FROM settings WHERE key = ?');

export function getSetting(key, fallback = '') {
  return selectSetting.get(key)?.value ?? fallback;
}

export function setSetting(key, value) {
  upsertSetting.run(key, String(value));
}

export function deleteSetting(key) {
  deleteSettingStmt.run(key);
}
