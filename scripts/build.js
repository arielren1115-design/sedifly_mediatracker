// Bundles src/ into dist/ for Apps Script. `--dev` also generates dist/DevProps.js from dev.properties.json.
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function runBuild({ dev = false } = {}) {
  const dist = path.join(root, 'dist');
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });
  await build({
    entryPoints: [path.join(root, 'src/index.js')],
    outfile: path.join(dist, 'Code.js'),
    bundle: true,
    format: 'iife',
    globalName: 'App',
    target: 'es2020',
    legalComments: 'none',
  });
  cpSync(path.join(root, 'src/entrypoints.js'), path.join(dist, 'Entrypoints.js'));
  cpSync(path.join(root, 'src/appsscript.json'), path.join(dist, 'appsscript.json'));
  if (dev) {
    const file = path.join(root, 'dev.properties.json');
    if (!existsSync(file)) throw new Error('dev.properties.json not found (copy dev.properties.example.json)');
    const props = JSON.parse(readFileSync(file, 'utf8'));
    writeFileSync(
      path.join(dist, 'DevProps.js'),
      `// DEV ONLY, generated from dev.properties.json. Run once in the editor, then it is safe to ignore.\n` +
        `function seedDevProperties() {\n  PropertiesService.getScriptProperties().setProperties(${JSON.stringify(props, null, 2)}, false);\n}\n`,
    );
  }
  return dist;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dist = await runBuild({ dev: process.argv.includes('--dev') });
  console.log(`Built ${dist}`);
}
