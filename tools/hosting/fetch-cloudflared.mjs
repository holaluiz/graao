// Downloads the official Cloudflare Tunnel connector for Windows x64 into apps/host/resources/bin (bundled by the
// installer, Apache-2.0) and refuses anything whose SHA-256 differs from the pinned release digest. On Windows it also
// prints the Authenticode signer. Bump VERSION and SHA256 together (GitHub release asset digest).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '2026.9.3';
const SHA256 = 'f096265ec2fcbe9bb6e2d64268db167ced3fcbb83d894bdb9e2fcdb26f2ea7e2';
const URL_EXE = `https://github.com/cloudflare/cloudflared/releases/download/${VERSION}/cloudflared-windows-amd64.exe`;
const URL_LICENSE = `https://raw.githubusercontent.com/cloudflare/cloudflared/${VERSION}/LICENSE`;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const bin = join(root, 'apps/host/resources/bin');
const out = join(bin, 'cloudflared.exe');
const sha = (b) => createHash('sha256').update(b).digest('hex');

mkdirSync(bin, { recursive: true });
mkdirSync(join(root, 'apps/host/resources/licenses'), { recursive: true });
if (existsSync(out) && sha(readFileSync(out)) === SHA256) {
  console.log(`cloudflared ${VERSION} already present (sha256 ok)`);
} else {
  const res = await fetch(URL_EXE);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const body = Buffer.from(await res.arrayBuffer());
  const got = sha(body);
  if (got !== SHA256) throw new Error(`sha256 mismatch: expected ${SHA256}, got ${got}`);
  writeFileSync(`${out}.part`, body);
  renameSync(`${out}.part`, out);
  console.log(`cloudflared ${VERSION} → ${out} (${(body.length / 1048576).toFixed(1)} MB, sha256 ok)`);
}
const lic = await fetch(URL_LICENSE);
if (lic.ok) writeFileSync(join(root, 'apps/host/resources/licenses/cloudflared-LICENSE.txt'), `cloudflared ${VERSION} — https://github.com/cloudflare/cloudflared\n\n${await lic.text()}`);
if (process.platform === 'win32') {
  const sig = execFileSync('powershell.exe', ['-NoProfile', '-Command', `$s = Get-AuthenticodeSignature -LiteralPath '${out}'; "$($s.Status) | $($s.SignerCertificate.Subject)"`]).toString().trim();
  console.log(`Authenticode: ${sig}`);
  if (!sig.startsWith('Valid')) throw new Error('cloudflared.exe is not validly signed');
}
