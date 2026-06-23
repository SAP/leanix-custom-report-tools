// Test helper — primes prompts.inject() before the CLI starts.
// Loaded via `node --import ./test-helpers/inject-prompts.mjs dist/index.cjs ...`.
// Answers are passed as a JSON array in the __TEST_PROMPTS_INJECT env var.
//
// This works because the `prompts` package is CJS, so Node's CJS module cache
// is shared between this ESM helper's static import and the bundled CLI's
// runtime `require('prompts')` — both resolve to the same module instance,
// and inject()'s queue is shared.
import prompts from 'prompts';
prompts.inject(JSON.parse(process.env.__TEST_PROMPTS_INJECT));
