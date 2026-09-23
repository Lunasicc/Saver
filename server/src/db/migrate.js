// Schema and default category seeding now run automatically whenever the db
// module is imported (see src/db/index.js). This script exists so `npm run
// seed` still works as an explicit "set up my database" step, e.g. before
// first running the server.
import { db } from './index.js';

console.log('✔ Database ready at server/data/budget.sqlite');
db.close();
