import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function copyFile(src, destDir) {
  await ensureDir(destDir);
  const dest = path.join(destDir, path.basename(src));
  await fs.copyFile(src, dest);
}

async function copyDir(srcDir, destDir) {
  await ensureDir(destDir);
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else if (entry.isFile()) {
      await ensureDir(path.dirname(destPath));
      await fs.copyFile(srcPath, destPath);
    }
  }
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const distDir = path.join(root, 'dist');
  const extDir = path.join(root, 'extensionFiles');

  await ensureDir(distDir);

  const files = [
    'manifest.json',
    'background.js',
    'popup.html',
    'content.js',
    'provider.js',
    'octra-sdk.js'
  ];

  for (const f of files) {
    const src = path.join(extDir, f);
    if (await exists(src)) {
      await copyFile(src, distDir);
    }
  }

  const iconsSrc = path.join(extDir, 'icons');
  if (await exists(iconsSrc)) {
    await copyDir(iconsSrc, path.join(distDir, 'icons'));
  }

  process.stdout.write('Extension files copied to dist\n');
}

main().catch(err => {
  process.stderr.write(String(err) + '\n');
  process.exit(1);
});
