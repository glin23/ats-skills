import { join } from 'node:path';
import { atsHome } from './paths.mjs';

// Run artefacts — the scored job list, what each form was actually filled with,
// which personal questions went unanswered. They used to default to a shared
// /tmp/mrweirdo-onboard, reachable only through a switch of their own that no
// skill and no script ever set: moving MRWEIRDO_HOME moved the profile, the
// resume and the database, and left all of the above behind in a world-readable
// directory that the next person's run would then read back. They live inside
// the home now, so one switch moves everything.
export const onboardTmpDirName = 'run-tmp';

export function onboardTmpDir() {
  return process.env.MRWEIRDO_ONBOARD_TMP_DIR || join(atsHome(), onboardTmpDirName);
}

export function onboardTmpPath(...parts) {
  return join(onboardTmpDir(), ...parts);
}
