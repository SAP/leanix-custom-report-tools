import openapiTS, { astToString } from 'openapi-typescript';
import ts from 'typescript';
import { writeFileSync } from 'node:fs';

const BLOB = ts.factory.createTypeReferenceNode('Blob');

const ast = await openapiTS(
  new URL('https://eu.leanix.net/services/reports/v1/docs/openapi.json'),
  {
    transform(schemaObject) {
      if (schemaObject.format === 'binary') {
        return BLOB;
      }
    }
  }
);

writeFileSync('src/generated/reports-service.d.ts', astToString(ast));
console.log('Generated src/generated/reports-service.d.ts');
