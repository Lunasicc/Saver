import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_MERCHANT_RULES, normalizeForMatch } from './categorize.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');

/**
 * Optional, user-specific keyword rules (e.g. your local cafe or gym) that
 * are seeded alongside the built-in ones. The file lives in the gitignored
 * data folder so personal spending habits never end up in the repository.
 *
 * Format: [{ "pattern": "City Gym", "merchant": "City Gym", "category": "Health" }]
 */
export function customRulesPath() {
  return process.env.CUSTOM_RULES_PATH || path.join(DATA_DIR, 'custom-rules.json');
}

export function loadCustomRules() {
  // Keep test runs hermetic unless a test explicitly opts in.
  if (process.env.NODE_ENV === 'test' && !process.env.CUSTOM_RULES_PATH) return [];
  const file = customRulesPath();
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (!Array.isArray(parsed)) throw new Error('expected a JSON array');
    return parsed
      .map((r) => ({
        pattern: normalizeForMatch(r?.pattern),
        merchant: String(r?.merchant || r?.pattern || '').trim(),
        category: String(r?.category || '').trim(),
      }))
      .filter((r) => r.pattern && r.merchant && r.category);
  } catch (err) {
    console.warn(`Ignoring ${file}: ${err.message}`);
    return [];
  }
}

/** Custom rules come first so they win over a built-in rule with the same pattern. */
export function getSeedRules() {
  return [...loadCustomRules(), ...DEFAULT_MERCHANT_RULES];
}
