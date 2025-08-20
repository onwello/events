module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.spec.ts'],
  testPathIgnorePatterns: [
    'redis-integration-tests.spec.ts',
    'redis-publishing.spec.ts', 
    'redis-basic-test.spec.ts'
  ],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  rootDir: '.',
}; 