import * as fs from 'node:fs';

/** Replace the active emulator source contents without renaming the target path. */
export function replaceActiveSource(tempPath: string, activePath: string): void {
  if (!fs.existsSync(tempPath)) throw new Error(`Prepared source is missing: ${tempPath}`);
  fs.copyFileSync(tempPath, activePath);
}
