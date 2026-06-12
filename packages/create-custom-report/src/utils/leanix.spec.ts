import type { PromptResult } from '..';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { generate as uuid } from 'short-uuid';
import { generateLeanIXFiles } from './leanix';

let targetDir = '';
const testId = uuid();

beforeAll(async () => {
  targetDir = await mkdtemp(`${tmpdir()}${sep}`);
  await writeFile(join(targetDir, 'package.json'), JSON.stringify({ testId }));
});

it('it updates package.json with leanix metadata', async () => {
  const result: PromptResult = {
    targetDir,
    packageName: uuid(),
    author: uuid(),
    description: uuid(),
    id: uuid(),
    title: uuid()
  };
  await generateLeanIXFiles({ targetDir, result });
  const packageJson = await readFile(join(targetDir, 'package.json')).then(
    (buffer) => JSON.parse(buffer.toString())
  );

  expect(packageJson).toMatchObject({
    name: result.packageName,
    version: '0.0.0',
    author: result.author,
    description: result.description
  });
});

it('v2: omits id from leanixReport in package.json', async () => {
  const result: PromptResult = {
    targetDir,
    packageName: uuid(),
    author: uuid(),
    description: uuid(),
    title: uuid(),
    host: uuid(),
    apitoken: uuid(),
    proxyURL: uuid()
  };
  await generateLeanIXFiles({ targetDir, result, isV2: true });
  const packageJson = await readFile(join(targetDir, 'package.json')).then(
    (buffer) => JSON.parse(buffer.toString())
  );

  expect(packageJson?.leanixReport?.id).toBeUndefined();
  expect(packageJson?.leanixReport?.title).toEqual(result.title);
  expect(packageJson?.leanixReport?.uploadVersion).toEqual(2);
});
