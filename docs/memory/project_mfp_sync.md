---
name: MFP Sync Replacement
description: Architecture decisions and constraints for replacing MFP's custom sync layer
type: project
---

## Decision: QueryEnvoy is out

QueryEnvoy will no longer be used. All sync/architecture thinking should exclude it as an option. It is being abandoned, not migrated to.

## Backend constraint

MFP's entire backend runs on AWS. This opens up AWS-native solutions without any cloud migration concern.

## Current sync state

Three sync mechanisms in parallel (being retired left-to-right):
1. **Sync V1** — binary protocol, DELETE+CREATE semantics, race conditions
2. **Sync V2** — REST/JSON token-based incremental sync
3. **QueryEnvoy** — KMM GraphQL SDK (ABANDONED)

## Status: Exploring — 2 options under consideration (see dev-ideas.md #11)

## Two options under consideration (see dev-ideas.md #11 for full details)

### Option A: PowerSync (bidirectional) + Apollo Client + Postgres bridge
PowerSync is **bidirectional** — not sync-down only. Both reads and writes go through local SQLite; PowerSync queues writes and uploads them automatically when online.

```
iOS SQLite  ←──  PowerSync  ←──→  Postgres (1 of 16)  ←──→  MySQL shard
     ↕
Apollo Client (@client resolvers — GraphQL wrapper over local SQLite)
```

- PowerSync syncs to Postgres (its native target), not MySQL directly
- A backend process bridges each Postgres shard → MySQL shard
- Apollo Client is a local GraphQL layer only — not connected to AppSync
- MySQL remains source of truth

### Option B: AWS Amplify DataStore + AppSync
- Amplify manages its own local DB (replaces existing SQLite)
- AppSync handles GraphQL + sync; Lambda bridges to MySQL
- Cleanest dev experience but highest migration cost

## Key unknowns

- PowerSync Swift SDK reached GA in early 2025 — production readiness at MFP scale TBD
- PowerSync performance across 16 shards with large concurrent user base
- Amplify DataStore SQLite migration scope (~60 tables)
