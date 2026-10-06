import { cpSync, chmodSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

cpSync('./templates/', './dist/templates/', { recursive: true, dereference: true });

function chmodR(p) {
  chmodSync(p, 0o755);
  if (statSync(p).isDirectory()) {
    for (const name of readdirSync(p)) chmodR(join(p, name));
  }
}
chmodR('./dist');
