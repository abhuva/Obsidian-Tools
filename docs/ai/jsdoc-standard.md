# JSDoc Standard (Tools)

## Goal
Use JSDoc to make function contracts explicit for humans, IDEs, and AI agents.

## What Must Be Documented
- Exported functions and exported classes in `*.js` and `*.mjs`.
- Internal helper functions with non-obvious behavior or side effects.
- Public module entry points used across files.

## Minimum Required Tags (Enforced)
- Function summary line (imperative, precise).
- `@returns` when function returns a value.

## Recommended Tags (Not Strictly Enforced)
- `@param` for each parameter (name + type + intent).
- `@throws` when a function intentionally throws.

## Recommended Tags
- `@typedef` for shared object shapes.
- `@property` for nested config objects.
- `@example` for tricky APIs.

## Style Rules
- Keep summaries short and factual.
- Describe behavior and constraints, not implementation trivia.
- Prefer concrete types over `*`.
- Keep comments synchronized with code changes.

## Example
```js
/**
 * Builds effective UI settings by merging defaults with local overrides.
 * @param {object} defaults - Versioned defaults from settings.default.json.
 * @param {object} local - Local overrides from settings.local.json.
 * @returns {object} Validated merged settings object.
 */
function buildEffectiveSettings(defaults, local) {
  // ...
}
```

## Rollout Policy
- Phase 1: JSDoc checks run as warnings while backfilling existing files.
- Phase 2: missing/incomplete JSDoc checks run as errors.
- Current state: Phase 2 active (enforced in `Tools/eslint.config.js`).
