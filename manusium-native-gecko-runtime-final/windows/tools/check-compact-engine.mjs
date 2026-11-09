// Security gate: require the latest patch of a currently supported Electron major.
// Fails closed on network errors. Does not download another engine.
import fs from 'node:fs';
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const pinned = pkg.devDependencies.electron;
if (!/^\d+\.\d+\.\d+$/.test(pinned)) throw new Error('Electron must be exactly pinned');
const response = await fetch('https://registry.npmjs.org/-/package/electron/dist-tags', { signal: AbortSignal.timeout(30000) });
if (!response.ok) throw new Error(`Cannot verify Electron release status: ${response.status}`);
const tags = await response.json();
const major = Number(pinned.split('.')[0]);
const latestMajor = Number(String(tags.latest).split('.')[0]);
if (major > latestMajor || latestMajor - major >= 3 || tags[`${major}-x-y`] !== pinned) throw new Error(`Electron ${pinned} is outdated or unsupported. Latest patch: ${tags[`${major}-x-y`]}; latest stable: ${tags.latest}. Update the lockfile and rerun all release tests.`);
console.log(`Electron ${pinned}: current patch on supported major; latest stable ${tags.latest}`);
