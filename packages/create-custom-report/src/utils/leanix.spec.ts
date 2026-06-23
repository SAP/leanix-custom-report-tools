import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { generate as uuid } from 'short-uuid';
import { generatePackageJson } from './leanix';

let targetDir = '';
const testId = uuid();

beforeAll(async () => {
  targetDir = await mkdtemp(`${tmpdir()}${sep}`);
  await writeFile(join(targetDir, 'package.json'), JSON.stringify({ testId }));
});

it('updates package.json with leanix metadata', async () => {
  const result = {
    targetDir,
    packageName: uuid(),
    description: uuid(),
    title: uuid()
  };
  await generatePackageJson({ targetDir, result });
  const packageJson = await readFile(join(targetDir, 'package.json')).then(
    (buffer) => JSON.parse(buffer.toString())
  );

  expect(packageJson).toMatchObject({
    name: result.packageName,
    version: '0.0.0',
    description: result.description
  });
  expect(packageJson?.leanixReport?.title).toEqual(result.title);
});
