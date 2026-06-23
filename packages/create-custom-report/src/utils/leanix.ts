import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function generatePackageJson(params: {
  targetDir: string;
  result: {
    packageName: string;
    description?: string;
    title?: string;
  };
}): Promise<void> {
  const { targetDir, result } = params;
  const { description, title, packageName } = result;

  const pkg = JSON.parse(
    await readFile(join(targetDir, 'package.json'), 'utf-8')
  );

  // Strip ordered fields so we can re-emit them in canonical order at the top
  const {
    name: _name,
    version: _version,
    description: _description,
    leanixReport: _leanixReport,
    ...rest
  } = pkg;

  const merged = {
    name: packageName,
    version: '0.0.0',
    description,
    leanixReport: {
      title,
      aiAssisted: false,
      defaultConfig: {}
    },
    ...rest
  };
  await writeFile(
    join(targetDir, 'package.json'),
    JSON.stringify(merged, null, 2) + '\n'
  );
}
