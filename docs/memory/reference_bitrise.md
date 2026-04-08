---
name: Bitrise MFP Configuration
description: Bitrise CI/CD config for the MFP iOS app — app slug, workflow IDs, and API usage
type: reference
---

# Bitrise MFP iOS

- **App Slug:** `7916357224a87a89`
- **API Base URL:** `https://api.bitrise.io/v0.1/apps/7916357224a87a89/builds`
- **Auth header format:** `Authorization: bitpat_YOUR_TOKEN` (NOT Bearer, NOT token prefix)
- **Known Workflow IDs:**
  - `TestFlightAndS3` — builds and pushes to TestFlight

## Trigger a build via curl
```bash
curl -s -X POST \
  "https://api.bitrise.io/v0.1/apps/7916357224a87a89/builds" \
  -H "Authorization: bitpat_YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"hook_info":{"type":"bitrise"},"build_params":{"branch":"BRANCH_NAME","workflow_id":"TestFlightAndS3"}}'
```

## Token Storage
- The Bitrise Personal Access Token has been regenerated (old token was exposed in chat during BURGER VIEW session)
- The new token is stored in `~/.foreman/config.json` under the key `bitriseToken` — do NOT hardcode it anywhere
- `bitriseAppSlug` is also stored in `~/.foreman/config.json`
- Both fields are typed in `ForemanConfig` in `/Users/chris.shreve/claude-slack-bridge/src/config.ts`

## /cc bitrise Command
- **Implemented in:** `/Users/chris.shreve/claude-slack-bridge/src/slack.ts`
- **Usage:** `/cc bitrise <workflow>` (e.g. `/cc bitrise TestFlightAndS3`)
- **Behavior:**
  - Reads `bitriseToken` and `bitriseAppSlug` from `~/.foreman/config.json`
  - Detects the current git branch from the session's `cwd`
  - Triggers a Bitrise build via the API using the detected branch and specified workflow

## Notes
- Personal Access Tokens are generated at bitrise.io → Account Settings → Security
