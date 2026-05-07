import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file manually
async function loadEnv(envPath) {
  try {
    const content = await fs.readFile(envPath, 'utf8');
    const env = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      // Remove quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) || 
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    }
    return env;
  } catch {
    return {};
  }
}

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

/**
 * Read version from manifest.json and inject into provider.js
 */
async function injectVersionToProvider(extDir, distDir) {
  const manifestPath = path.join(extDir, 'manifest.json');
  const providerSrc = path.join(extDir, 'provider.js');
  const providerDest = path.join(distDir, 'provider.js');
  
  const manifestContent = await fs.readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestContent);
  const version = manifest.version || '0.0.0';
  
  let providerContent = await fs.readFile(providerSrc, 'utf8');
  providerContent = providerContent.replace(
    /const PROVIDER_VERSION = ['"][^'"]+['"]/,
    `const PROVIDER_VERSION = '${version}'`
  );
  
  await ensureDir(distDir);
  await fs.writeFile(providerDest, providerContent, 'utf8');
  process.stdout.write(`Injected version ${version} into provider.js\n`);
}

/**
 * Inject environment variables into background.js.
 *
 * Placeholders replaced:
 *   __VITE_OCTRA_RPC_URL__      — default Octra node URL
 *   __VITE_INFURA_API_KEY__     — Infura Project ID (from VITE_INFURA_API_KEY in .env)
 *   __VITE_ETHERSCAN_API_KEY__  — Etherscan API key (from VITE_ETHERSCAN_API_KEY in .env)
 *
 * Keys from .env are the build-time defaults. Users can override them at runtime
 * via Wallet Settings → EVM API Keys (stored in chrome.storage.local).
 */
async function injectEnvToBackground(extDir, distDir, env) {
  const backgroundSrc  = path.join(extDir, 'background.js');
  const backgroundDest = path.join(distDir, 'background.js');
  
  let content = await fs.readFile(backgroundSrc, 'utf8');
  
  const infuraKey    = env.VITE_INFURA_API_KEY    || '';
  const etherscanKey = env.VITE_ETHERSCAN_API_KEY || '';
  const octraRpc     = env.VITE_OCTRA_RPC_URL     || 'http://46.101.86.250:8080';

  const envVars = {
    '__VITE_OCTRA_RPC_URL__':     octraRpc,
    '__VITE_INFURA_API_KEY__':    infuraKey,
    '__VITE_ETHERSCAN_API_KEY__': etherscanKey,
  };
  
  for (const [placeholder, value] of Object.entries(envVars)) {
    // Escape special regex chars in placeholder before using as pattern
    const escaped = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    content = content.replace(new RegExp(escaped, 'g'), value);
  }
  
  await ensureDir(distDir);
  await fs.writeFile(backgroundDest, content, 'utf8');
  
  process.stdout.write(
    `Injected env into background.js` +
    ` (Octra RPC: ${octraRpc},` +
    ` Infura: ${infuraKey ? 'set' : 'not set'},` +
    ` Etherscan: ${etherscanKey ? 'set' : 'not set'})\n`
  );
}

async function main() {
  const root    = path.resolve(__dirname, '..');
  const distDir = path.join(root, 'dist');
  const extDir  = path.join(root, 'extensionFiles');
  
  const env = await loadEnv(path.join(root, '.env'));

  await ensureDir(distDir);

  const files = [
    'manifest.json',
    'popup.html',
    'content.js',
    'core.js',
    'octra-sdk.js'
  ];

  for (const f of files) {
    const src = path.join(extDir, f);
    if (await exists(src)) {
      await copyFile(src, distDir);
    }
  }

  await injectVersionToProvider(extDir, distDir);
  await injectEnvToBackground(extDir, distDir, env);

  process.stdout.write('Extension files copied to dist\n');
}

main().catch(err => {
  process.stderr.write(String(err) + '\n');
  process.exit(1);
});
