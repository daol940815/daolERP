/** 근태 엔진 등 순수 로직 단위 테스트 (기획서 5.2 — 테스트 우선) */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testMatch: ['**/*.spec.ts'],
  moduleNameMapper: {
    '^@daolerp/shared$': '<rootDir>/../../../packages/shared/src/index.ts',
  },
};
