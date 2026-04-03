# Incident Report: Foreman Unresponsive After Kafka Integration

**Date:** 2026-04-03
**Severity:** P0 — Complete outage (Foreman process fails to start)
**Duration:** Unknown — Foreman has been down since the uncommitted changes were applied
**Affected service:** Foreman (all functionality — Slack bridge, Temporal, everything)

## Summary

Foreman became completely unresponsive after a self-update that added Kafka/Redpanda bot consumer loops. The root cause was two ESM-incompatible import patterns introduced in `src/kafka.ts` that cause a fatal `SyntaxError` at module load time, preventing the entire process from starting.

## Root Cause

Two bugs in `src/kafka.ts`, both related to CommonJS/ESM interop:

### Bug 1: Named export destructuring from a CJS module

```typescript
// BROKEN — kafkajs is a CommonJS module; Node's ESM loader cannot
// destructure CompressionCodecs/CompressionTypes as named exports
import { Kafka, Producer, Admin, logLevel, CompressionTypes, CompressionCodecs } from 'kafkajs';
```

**Error at runtime:**
```
SyntaxError: Named export 'CompressionCodecs' not found. The requested module 'kafkajs'
is a CommonJS module, which may not support all module.exports as named exports.
```

KafkaJS publishes as CommonJS. Node's ESM loader can resolve _some_ named exports from CJS via static analysis, but `CompressionCodecs` and `CompressionTypes` are not statically analyzable — they're assigned dynamically. The previous version of kafka.ts only imported `Kafka`, `Producer`, `Admin`, and `logLevel`, which all resolve fine. Adding `CompressionTypes` and `CompressionCodecs` broke it.

### Bug 2: Bare `require()` in an ESM module

```typescript
// BROKEN — require() is not defined in ESM modules
const SnappyCodec = require('kafkajs-snappy');
```

Foreman's `package.json` has `"type": "module"`, so all `.js` files are treated as ESM. `require()` does not exist in ESM context. The existing codebase already handles this correctly in `slack.ts` using `createRequire(import.meta.url)`, but the new kafka.ts code used bare `require()` instead.

### Why this was fatal

`index.ts` imports from `kafka.ts` at the top level:

```typescript
import { ensureBotTopics, startBotConsumers } from './kafka.js';
```

This is a **static import** — it's resolved before any code executes. The `.catch()` handlers on `ensureBotTopics()` and `startBotConsumers()` in the async startup block cannot catch static import failures. The process dies with an uncatchable `SyntaxError` before reaching the `app.start()` call.

### Why TypeScript didn't catch it

TypeScript compiles cleanly with both bugs present. `tsc` doesn't validate CJS/ESM named export compatibility — it trusts the `.d.ts` type declarations, which do export `CompressionCodecs` as a named type. The `require()` call is also valid TypeScript. These are purely **runtime** failures that only surface when Node.js actually loads the compiled ESM output.

## Fix Applied

Replace the named import with a default import + destructure, and replace `require()` with a top-level `await import()`:

```typescript
// FIXED
import kafkajs, { type Producer, type Admin } from 'kafkajs';
const { Kafka, logLevel, CompressionTypes, CompressionCodecs } = kafkajs;

const SnappyCodec = (await import('kafkajs-snappy')).default;
CompressionCodecs[CompressionTypes.Snappy] = SnappyCodec;
```

- Default import (`import kafkajs from 'kafkajs'`) always works for CJS modules
- Runtime values are destructured from the default import
- Type-only imports (`type Producer`, `type Admin`) are erased at compile time, so they're safe as named imports
- `await import()` replaces the bare `require()` for the Snappy codec

## Timeline

1. Foreman (running as a bot) was implementing Foreman 2.0 Kafka consumer loops
2. It modified `src/kafka.ts` to add Snappy compression support and the `startBotConsumers()` function
3. It modified `src/index.ts` to wire `loadBotRegistry()`, `ensureBotTopics()`, and `startBotConsumers()` into startup
4. Changes were applied but not committed (still in working tree)
5. On next restart (or live-reload), Foreman failed to start due to the import error
6. Process became completely unresponsive — no Slack messages, no Temporal, no webhooks

## Lessons / Prevention

- **CJS/ESM interop is a runtime concern, not a compile-time one.** TypeScript won't save you. When importing from a CJS package in an ESM project, always use `import pkg from 'package'` + destructure, never named imports for non-standard exports.
- **The existing codebase had the right pattern.** `slack.ts` already used `createRequire` for CJS interop. The new code should have followed that precedent.
- **Static imports of new modules are high-risk.** If `kafka.ts` had been dynamically imported (`await import('./kafka.js')`), the failure would have been caught by the `.catch()` handlers and Foreman would have stayed up with Kafka disabled.

## Files Changed

| File | Change |
|------|--------|
| `src/kafka.ts` | Fixed CJS import pattern (default import + destructure), replaced `require()` with `await import()` |

## Verification

```
$ npx tsc          # clean compile
$ node -e "import('./dist/kafka.js').then(() => console.log('OK'))"
OK
```
