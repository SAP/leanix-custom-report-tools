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
  projects: [
    {
      displayName: '@lxr/core',
      testMatch: ['<rootDir>/packages/core/src/**/*.spec.ts'],
      transformIgnorePatterns: []
    },
    {
      displayName: 'vite-plugin',
      testMatch: ['<rootDir>/packages/vite-plugin/src/**/*.spec.ts']
    },
    {
      displayName: 'create-custom-report',
      testMatch: ['<rootDir>/packages/create-custom-report/src/**/*.spec.ts'],
      transformIgnorePatterns: []
    }
  ]
};
export default config;
