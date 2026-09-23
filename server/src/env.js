// Loads server/.env regardless of the directory the app was started from.
// Imported first by index.js so every other module sees the variables.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.env') });
