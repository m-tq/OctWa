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
  
  // Read manifest version
  const manifestContent = await fs.readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestContent);
  const version = manifest.version || '0.0.0';
  
  // Read provider.js
  let providerContent = await fs.readFile(providerSrc, 'utf8');
  
  // Replace PROVIDER_VERSION value
  // Matches: const PROVIDER_VERSION = 'x.x.x'; or const PROVIDER_VERSION = "x.x.x";
  providerContent = providerContent.replace(
    /const PROVIDER_VERSION = ['"][^'"]+['"]/,
    `const PROVIDER_VERSION = '${version}'`
  );
  
  // Write to dist
  await ensureDir(distDir);
  await fs.writeFile(providerDest, providerContent, 'utf8');
  
  process.stdout.write(`Injected version ${version} into provider.js\n`);
}

/**
 * Inject environment variables into background.js
 */
async function injectEnvToBackground(extDir, distDir, env) {
  const backgroundSrc = path.join(extDir, 'background.js');
  const backgroundDest = path.join(distDir, 'background.js');
  
  // Read background.js
  let content = await fs.readFile(backgroundSrc, 'utf8');
  
  // Construct ETH RPC URL from Infura API key
  const infuraApiKey = env.VITE_INFURA_API_KEY;
  const ethRpcUrl = infuraApiKey 
    ? `https://sepolia.infura.io/v3/${infuraApiKey}`
    : 'https://ethereum-sepolia-rpc.publicnode.com'; // Fallback to public RPC
  
  // Environment variables to inject (with defaults)
  const envVars = {
    '__VITE_OCTRA_RPC_URL__': env.VITE_OCTRA_RPC_URL || 'https://octra.network',
    '__VITE_ETH_RPC_URL__': ethRpcUrl,
    '__VITE_USDC_CONTRACT__': env.VITE_USDC_CONTRACT || '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    '__VITE_USDC_DECIMALS__': env.VITE_USDC_DECIMALS || '6',
  };
  
  // Replace placeholders with actual values
  for (const [placeholder, value] of Object.entries(envVars)) {
    content = content.replace(new RegExp(placeholder, 'g'), value);
  }
  
  // Write to dist
  await ensureDir(distDir);
  await fs.writeFile(backgroundDest, content, 'utf8');
  
  process.stdout.write(`Injected env variables into background.js (ETH RPC: ${infuraApiKey ? 'Infura' : 'Public'})\n`);
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const distDir = path.join(root, 'dist');
  const extDir = path.join(root, 'extensionFiles');
  
  // Load environment variables
  const env = await loadEnv(path.join(root, '.env'));

  await ensureDir(distDir);

  // Files to copy (excluding provider.js and background.js - handled separately)
  const files = [
    'manifest.json',
    'popup.html',
    'content.js',
    'octra-sdk.js'
  ];

  for (const f of files) {
    const src = path.join(extDir, f);
    if (await exists(src)) {
      await copyFile(src, distDir);
    }
  }

  // Inject version and copy provider.js
  await injectVersionToProvider(extDir, distDir);
  
  // Inject env variables and copy background.js
  await injectEnvToBackground(extDir, distDir, env);

  process.stdout.write('Extension files copied to dist\n');
}

main().catch(err => {
  process.stderr.write(String(err) + '\n');
  process.exit(1);
});
