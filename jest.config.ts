import type { Config } from '@jest/types';

const config: Config.InitialOptions = {
  verbose: true,
  testEnvironment: 'node',
  transform: {
    '^.+\\.m?[tj]sx?$': [
      'babel-jest',
      {
        tsconfig: '<rootDir>/tsconfig.json'
      }
    ]
  },
  testPathIgnorePatterns: ['<rootDir>/node_modules/'],
  moduleNameMapper: {
    '^open$': '<rootDir>/packages/core/src/__mocks__/open.ts'
  },
  projects: [
    {
      displayName: '@lxr/core',
      testMatch: ['<rootDir>/packages/core/src/**/*.spec.ts'],
      transformIgnorePatterns: []
    },
    {
      displayName: 'leanix-custom-report-cli',
      testMatch: ['<rootDir>/packages/leanix-custom-report-cli/src/**/*.spec.ts'],
      transformIgnorePatterns: []
    },
    {
      displayName: 'create-custom-report',
      testMatch: ['<rootDir>/packages/create-custom-report/src/**/*.spec.ts'],
      transformIgnorePatterns: []
    }
  ]
};
export default config;
