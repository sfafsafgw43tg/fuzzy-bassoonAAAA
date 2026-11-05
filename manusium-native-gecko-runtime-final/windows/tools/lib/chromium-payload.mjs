import fs from 'node:fs';
import path from 'node:path';

// Keep the full runtime output (DLLs, locale/resource packs and helper binaries),
// but never ship Ninja's multi-GB object trees as part of the browser payload.
export function copyChromiumPayload(buildDir, destination) {
  fs.mkdirSync(destination, { recursive: true });
  fs.cpSync(buildDir, destination, {
    recursive: true,
    dereference: false,
    filter: (file) => {
      const relative = path.relative(buildDir, file);
      if (!relative) return true;
      const parts = relative.split(path.sep);
      if (['obj', 'gen', '.cipd'].includes(parts[0])) return false;
      return !/(?:\.(?:obj|o|lib|a|pdb|ilk|exp|ninja|rsp|stamp|d)|\.ninja_(?:log|deps))$/i.test(file)
        && !['args.gn', 'build.ninja.d'].includes(path.basename(file));
    },
  });
}
