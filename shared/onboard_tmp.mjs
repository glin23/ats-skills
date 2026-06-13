import { join } from 'node:path';

export const DEFAULT_ONBOARD_TMP_DIR = '/tmp/mrweirdo-onboard';

export function onboardTmpDir() {
  return process.env.MRWEIRDO_ONBOARD_TMP_DIR || DEFAULT_ONBOARD_TMP_DIR;
}

export function onboardTmpPath(...parts) {
  return join(onboardTmpDir(), ...parts);
}
