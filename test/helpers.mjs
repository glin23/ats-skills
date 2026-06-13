import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function onboardTestEnv(home, extra = {}) {
  return {
    ...process.env,
    MRWEIRDO_HOME: home,
    MRWEIRDO_DB_PATH: join(home, 'jobs.db'),
    MRWEIRDO_REPO_ROOT: process.cwd(),
    MRWEIRDO_ONBOARD_TMP_DIR: join(home, 'run-tmp'),
    ...extra,
  };
}

export function makeOnboardTestHome(prefix) {
  const home = mkdtempSync(join(tmpdir(), prefix));
  return {
    home,
    dbPath: join(home, 'jobs.db'),
    env: onboardTestEnv(home),
  };
}
