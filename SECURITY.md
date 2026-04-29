# Security & Supply Chain Attack Mitigation

This document outlines the security practices adopted in this project to protect against supply chain attacks — both for maintainers and for anyone who clones this repository.

---

## What Is a Supply Chain Attack?

A supply chain attack occurs when a malicious actor compromises a third-party dependency that your project trusts, rather than attacking your code directly. Common vectors include:

- **Dependency hijacking** — a maintainer's account is taken over and a malicious update is published
- **Typosquatting** — a package with a name similar to a popular one is published to trick developers into installing it
- **Malicious version updates** — a previously safe package introduces harmful code in a new release
- **Build tool compromise** — the build pipeline itself is tampered with to inject code at compile time

Because this project is a **cryptocurrency wallet extension** that handles private keys, the risk surface is significantly higher than a typical web application. Every dependency is a potential attack vector.

---

## Protections in Place

### 1. `package-lock.json` Is Committed to the Repository

The `package-lock.json` file records the **exact resolved version and SHA-512 integrity hash** of every installed package and its transitive dependencies. This file is intentionally committed to the repository and must never be added to `.gitignore`.

When someone installs dependencies using `npm ci`, npm will:

1. Install the **exact** versions recorded in the lock file — no version range resolution
2. **Verify the integrity hash** of every package against the lock file
3. **Abort the installation** if any hash does not match

This means that even if a package is compromised on the npm registry after the lock file was generated, the installation will fail rather than silently pulling in the malicious version.

### 2. `save-exact=true` in `.npmrc`

The `.npmrc` file at the root of this project contains:

```
save-exact=true
```

This setting ensures that whenever a new package is installed via `npm install <package>`, npm saves the **exact version** (e.g., `1.0.3`) rather than a version range with a caret or tilde prefix (e.g., `^1.0.3`). This prevents unintended version drift when the lock file is regenerated or when contributors add new dependencies.

### 3. Critical Cryptographic Dependencies Are Pinned

The packages that directly handle cryptographic operations are pinned to exact versions in `package.json`:

| Package | Version | Purpose |
|---------|---------|---------|
| `tweetnacl` | `1.0.3` | Ed25519 signing and key operations |
| `bip39` | `3.1.0` | Mnemonic seed phrase generation |
| `buffer` | `6.0.3` | Binary data handling for crypto primitives |

These packages are not expressed as version ranges and will not be automatically updated.

### 4. Regular Vulnerability Audits

This project uses `npm audit` to scan for known vulnerabilities in the dependency tree against the npm advisory database.

**Audit history:**

| Date | Vulnerabilities Found | Action Taken |
|------|-----------------------|--------------|
| 2026-04-29 | 1 moderate — `postcss < 8.5.10` (GHSA-qx2v-qp2m-jg93, XSS via unescaped `</style>`) | Updated to `8.5.12` via `npm audit fix` |

**Current status:** `0 vulnerabilities` across 464 audited packages.

---

## Instructions for Contributors and Cloners

### Always Use `npm ci` Instead of `npm install`

```bash
# ✅ Correct — strict install, verifies all integrity hashes
npm ci

# ❌ Avoid — resolves version ranges, may bypass lock file
npm install
```

`npm ci` is the safe installation method. It reads exclusively from `package-lock.json`, verifies every package hash, and will throw an error if the lock file is out of sync with `package.json`. This guarantees that you install the exact same dependency tree that was audited and tested.

### Never Delete or Regenerate `package-lock.json` Without Review

Regenerating the lock file (e.g., by deleting it and running `npm install`) will re-resolve all version ranges and fetch the latest matching versions from the registry. This can silently introduce unaudited or compromised packages. If a lock file regeneration is necessary, the resulting diff must be reviewed carefully before committing.

### Verify Before Adding New Dependencies

Before adding any new package, consider:

1. **Is it necessary?** Every additional dependency expands the attack surface.
2. **Is it actively maintained?** Check the repository for recent activity and open issues.
3. **How many transitive dependencies does it bring?** Use `npm install --dry-run` or tools like [Bundlephobia](https://bundlephobia.com) to assess the footprint.
4. **Does it have a history of security incidents?**

---

## Running an Audit Yourself

```bash
# Check for known vulnerabilities
npm audit

# Automatically fix vulnerabilities where a safe upgrade exists
npm audit fix

# View a detailed report
npm audit --json
```

---

## Recommended Further Hardening

- **Enable GitHub Dependabot** — automatically opens pull requests when a dependency has a known vulnerability. Add `.github/dependabot.yml` to the repository to activate it.
- **Enable GitHub secret scanning** — detects accidentally committed private keys or tokens.
- **Review dependency diffs in pull requests** — any change to `package-lock.json` in a PR should be inspected, not just the `package.json` changes.
- **Use `npm ci` in CI/CD pipelines** — never use `npm install` in automated build or deployment workflows.
