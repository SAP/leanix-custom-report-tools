// Test helper — primes prompts.inject() before the CLI starts.
// Loaded via `node --require ./test-helpers/inject-prompts.cjs dist/index.cjs ...`.
// Answers are passed as a JSON array in the __TEST_PROMPTS_INJECT env var.
//
// This works because the CLI bundle calls `require('prompts')` at runtime
// (not statically inlined), so the bundled code and this preload resolve
// to the same module instance, and inject()'s queue is shared.
const prompts = require('prompts');
prompts.inject(JSON.parse(process.env.__TEST_PROMPTS_INJECT));
