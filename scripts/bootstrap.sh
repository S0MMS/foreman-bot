#!/usr/bin/env zsh
#
# bootstrap.sh — Set up Foreman from scratch
#
# Creates the foreman bot account, all channels, sidebar categories,
# and writes config files. Run after `docker compose up -d`.
#
# Usage:
#   ./scripts/bootstrap.sh
#
# Prerequisites:
#   - Docker containers running (docker compose up -d)
#   - Mattermost admin credentials (created during first Mattermost login)
#
# The script is idempotent — safe to run multiple times.

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────

MM_URL="${MM_URL:-http://localhost:8065}"
CONFIG_DIR="$HOME/.foreman"
CONFIG_FILE="$CONFIG_DIR/config.json"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REGISTRY_FILE="$REPO_ROOT/config/channel-registry.yaml"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log()  { echo -e "${GREEN}[bootstrap]${NC} $*"; }
warn() { echo -e "${YELLOW}[bootstrap]${NC} $*"; }
err()  { echo -e "${RED}[bootstrap]${NC} $*" >&2; }

# ── Wait for Mattermost ──────────────────────────────────────────────────────

log "Waiting for Mattermost at $MM_URL..."
for i in $(seq 1 30); do
  if curl -sf "$MM_URL/api/v4/system/ping" > /dev/null 2>&1; then
    log "Mattermost is ready."
    break
  fi
  if [ "$i" -eq 30 ]; then
    err "Mattermost not ready after 30 attempts. Is docker compose up?"
    exit 1
  fi
  sleep 2
done

# ── Get admin credentials ────────────────────────────────────────────────────

# Check if config already exists with admin token
if [ -f "$CONFIG_FILE" ]; then
  EXISTING_ADMIN_TOKEN=$(python3 -c "import json; d=json.load(open('$CONFIG_FILE')); print(d.get('mattermostAdminToken',''))" 2>/dev/null || echo "")
  if [ -n "$EXISTING_ADMIN_TOKEN" ]; then
    # Verify token still works
    if curl -sf -H "Authorization: Bearer $EXISTING_ADMIN_TOKEN" "$MM_URL/api/v4/users/me" > /dev/null 2>&1; then
      log "Using existing admin token from config.json"
      ADMIN_TOKEN="$EXISTING_ADMIN_TOKEN"
    else
      warn "Existing admin token is invalid. Need new credentials."
      EXISTING_ADMIN_TOKEN=""
    fi
  fi
fi

if [ -z "${ADMIN_TOKEN:-}" ]; then
  echo ""
  echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
  echo -e "${BLUE}  Mattermost Admin Setup${NC}"
  echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
  echo ""
  echo "  If this is a fresh Mattermost install, you need to create an"
  echo "  admin account first:"
  echo ""
  echo "    1. Open $MM_URL in your browser"
  echo "    2. Create your admin account"
  echo "    3. Create a team (any name works)"
  echo ""
  echo "  Then generate a personal access token:"
  echo ""
  echo "    1. Click your avatar → Profile"
  echo "    2. Security → Personal Access Tokens"
  echo "    3. Create a token with 'admin' description"
  echo ""
  read -rp "  Paste your admin access token: " ADMIN_TOKEN
  echo ""

  # Verify token
  if ! curl -sf -H "Authorization: Bearer $ADMIN_TOKEN" "$MM_URL/api/v4/users/me" > /dev/null 2>&1; then
    err "Invalid token. Please check and try again."
    exit 1
  fi
  log "Admin token verified."
fi

# Get admin user info
ADMIN_USER=$(curl -sf -H "Authorization: Bearer $ADMIN_TOKEN" "$MM_URL/api/v4/users/me")
ADMIN_USER_ID=$(echo "$ADMIN_USER" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
ADMIN_USERNAME=$(echo "$ADMIN_USER" | python3 -c "import sys,json; print(json.load(sys.stdin)['username'])")
log "Admin user: $ADMIN_USERNAME ($ADMIN_USER_ID)"

# ── Get or create team ────────────────────────────────────────────────────────

TEAMS=$(curl -sf -H "Authorization: Bearer $ADMIN_TOKEN" "$MM_URL/api/v4/teams")
TEAM_ID=$(echo "$TEAMS" | python3 -c "import sys,json; teams=json.load(sys.stdin); print(teams[0]['id'] if teams else '')")

if [ -z "$TEAM_ID" ]; then
  err "No teams found. Please create a team in Mattermost first."
  exit 1
fi
TEAM_NAME=$(echo "$TEAMS" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['display_name'])")
log "Using team: $TEAM_NAME ($TEAM_ID)"

# ── Helper functions ──────────────────────────────────────────────────────────

mm_api() {
  local method="$1" endpoint="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -sf -X "$method" -H "Authorization: Bearer $ADMIN_TOKEN" \
      -H "Content-Type: application/json" "$MM_URL/api/v4$endpoint" -d "$body"
  else
    curl -sf -X "$method" -H "Authorization: Bearer $ADMIN_TOKEN" \
      -H "Content-Type: application/json" "$MM_URL/api/v4$endpoint"
  fi
}

create_bot() {
  local username="$1" display_name="$2" description="${3:-}"
  # Check if bot exists
  local existing
  existing=$(mm_api GET "/bots?per_page=200" | python3 -c "
import sys,json
bots = json.load(sys.stdin)
for b in bots:
    if b['username'] == '$username':
        print(b['user_id'])
        break
" 2>/dev/null || echo "")

  if [ -n "$existing" ]; then
    log "  Bot '$username' already exists (user_id: $existing)" >&2
    echo "$existing"
    return
  fi

  local result
  result=$(mm_api POST "/bots" "{\"username\":\"$username\",\"display_name\":\"$display_name\",\"description\":\"$description\"}")
  local user_id
  user_id=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin)['user_id'])")
  log "  Created bot '$username' (user_id: $user_id)" >&2
  echo "$user_id"
}

get_bot_token() {
  local bot_user_id="$1" bot_username="$2"
  # Check if we already have a token in config
  if [ -f "$CONFIG_FILE" ]; then
    local existing_token
    existing_token=$(python3 -c "
import json
d = json.load(open('$CONFIG_FILE'))
tokens = d.get('mattermostBotTokens', {})
print(tokens.get('$bot_username', ''))
" 2>/dev/null || echo "")
    if [ -n "$existing_token" ]; then
      # Verify token works
      if curl -sf -H "Authorization: Bearer $existing_token" "$MM_URL/api/v4/users/me" > /dev/null 2>&1; then
        echo "$existing_token"
        return
      fi
    fi
  fi

  # Create new token
  local result
  result=$(mm_api POST "/users/$bot_user_id/tokens" "{\"description\":\"foreman-bootstrap\"}")
  local token
  token=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
  echo "$token"
}

create_channel() {
  local name="$1" display_name="$2" purpose="${3:-}"
  # Check if channel exists
  local existing
  existing=$(mm_api GET "/teams/$TEAM_ID/channels/name/$name" 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")

  if [ -n "$existing" ]; then
    log "  Channel '#$name' already exists ($existing)" >&2
    echo "$existing"
    return
  fi

  local result
  result=$(mm_api POST "/channels" "{\"team_id\":\"$TEAM_ID\",\"name\":\"$name\",\"display_name\":\"$display_name\",\"type\":\"O\",\"purpose\":\"$purpose\"}")
  local channel_id
  channel_id=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
  log "  Created channel '#$name' ($channel_id)" >&2
  echo "$channel_id"
}

add_to_channel() {
  local channel_id="$1" user_id="$2"
  mm_api POST "/channels/$channel_id/members" "{\"user_id\":\"$user_id\"}" > /dev/null 2>&1 || true
}

# ── Create foreman bot ────────────────────────────────────────────────────────

echo ""
log "Setting up foreman bot..."
FOREMAN_USER_ID=$(create_bot "foreman" "Foreman" "Foreman AI agent bridge")
FOREMAN_TOKEN=$(get_bot_token "$FOREMAN_USER_ID" "foreman")
log "  Foreman bot token acquired"

# Add foreman to team
mm_api POST "/teams/$TEAM_ID/members" "{\"team_id\":\"$TEAM_ID\",\"user_id\":\"$FOREMAN_USER_ID\"}" > /dev/null 2>&1 || true

# ── Create channels ──────────────────────────────────────────────────────────

echo ""
log "Creating channels..."

# Declare channels: name|display_name|purpose
CHANNELS=(
  "thought-pad|thought-pad|Brainstorming and rubber duck debugging"
  "alice|alice|General-purpose Claude assistant"
  "bob|bob|Pragmatic problem-solver"
  "charlie|charlie|Creative thinker and communicator"
  "flowspec-engineer|flowspec-engineer|Help writing and debugging .flow files"
  "gemini|gemini|Google Gemini assistant"
  "openai|openai|OpenAI GPT assistant"
  "flowbot-01|flowbot-01|FlowSpec tutorial bot 1"
  "flowbot-02|flowbot-02|FlowSpec tutorial bot 2"
  "flowbot-03|flowbot-03|FlowSpec tutorial bot 3"
)

# Track channel IDs for registry
typeset -A CHANNEL_IDS

for entry in "${CHANNELS[@]}"; do
  IFS='|' read -r name display purpose <<< "$entry"
  channel_id=$(create_channel "$name" "$display" "$purpose")
  CHANNEL_IDS[$name]="$channel_id"
  # Add foreman bot and admin user to channel
  add_to_channel "$channel_id" "$FOREMAN_USER_ID"
  add_to_channel "$channel_id" "$ADMIN_USER_ID"
done

# ── Write channel-registry.yaml ──────────────────────────────────────────────

echo ""
log "Writing channel-registry.yaml..."

# Preserve existing entries from registry
EXISTING_SLACK=""
EXISTING_MM_EXTRA=""
if [ -f "$REGISTRY_FILE" ]; then
  # Extract slack section
  EXISTING_SLACK=$(python3 -c "
import yaml
with open('$REGISTRY_FILE') as f:
    data = yaml.safe_load(f) or {}
slack = data.get('slack', {})
if slack:
    print('slack:')
    for k, v in slack.items():
        print(f'  {k}: {v}')
" 2>/dev/null || echo "")

  # Extract mattermost entries NOT in our bootstrap list
  BOOTSTRAP_NAMES="thought-pad alice bob charlie flowspec-engineer gemini openai flowbot-01 flowbot-02 flowbot-03"
  EXISTING_MM_EXTRA=$(python3 -c "
import yaml
with open('$REGISTRY_FILE') as f:
    data = yaml.safe_load(f) or {}
mm = data.get('mattermost', {})
bootstrap = set('$BOOTSTRAP_NAMES'.split())
for k, v in mm.items():
    if k not in bootstrap:
        print(f'  {k}: {v}')
" 2>/dev/null || echo "")
fi

cat > "$REGISTRY_FILE" << YAML
# channel-registry.yaml — Where each bot lives, per transport
#
# FlowSpec uses this file to dispatch workflows to the right channels.
# Bot names here must match the names used in .flow files (e.g. "assign flowbot-01").
#
# Format:
#   <transport>:
#     <bot-name>: <channel-id>

${EXISTING_SLACK}
mattermost:
YAML

for entry in "${CHANNELS[@]}"; do
  IFS='|' read -r name display purpose <<< "$entry"
  echo "  $name: ${CHANNEL_IDS[$name]}" >> "$REGISTRY_FILE"
done

# Append preserved non-bootstrap mattermost entries
if [ -n "$EXISTING_MM_EXTRA" ]; then
  echo "$EXISTING_MM_EXTRA" >> "$REGISTRY_FILE"
fi

log "  Written to $REGISTRY_FILE"

# ── Write config.json ────────────────────────────────────────────────────────

echo ""
log "Writing config.json..."

mkdir -p "$CONFIG_DIR"

if [ -f "$CONFIG_FILE" ]; then
  # Update existing config — preserve all existing keys
  python3 -c "
import json

with open('$CONFIG_FILE') as f:
    config = json.load(f)

config['mattermostUrl'] = '$MM_URL'
config['mattermostAdminToken'] = '$ADMIN_TOKEN'
config['mattermostTeamId'] = '$TEAM_ID'

tokens = config.get('mattermostBotTokens', {})
tokens['foreman'] = '$FOREMAN_TOKEN'
config['mattermostBotTokens'] = tokens

with open('$CONFIG_FILE', 'w') as f:
    json.dump(config, f, indent=2)
    f.write('\n')
"
  log "  Updated existing $CONFIG_FILE"
else
  cat > "$CONFIG_FILE" << JSON
{
  "mattermostUrl": "$MM_URL",
  "mattermostAdminToken": "$ADMIN_TOKEN",
  "mattermostTeamId": "$TEAM_ID",
  "mattermostBotTokens": {
    "foreman": "$FOREMAN_TOKEN"
  },
  "defaultCwd": "$REPO_ROOT"
}
JSON
  log "  Created $CONFIG_FILE"
fi

# ── Create sidebar categories ────────────────────────────────────────────────

echo ""
log "Creating sidebar categories for $ADMIN_USERNAME..."

create_category() {
  local display_name="$1"
  shift
  local channel_ids=("$@")

  # Build JSON array of channel IDs
  local ids_json="["
  local first=true
  for cid in "${channel_ids[@]}"; do
    if [ "$first" = true ]; then first=false; else ids_json+=","; fi
    ids_json+="\"$cid\""
  done
  ids_json+="]"

  mm_api POST "/users/$ADMIN_USER_ID/teams/$TEAM_ID/channels/categories" \
    "{\"user_id\":\"$ADMIN_USER_ID\",\"team_id\":\"$TEAM_ID\",\"display_name\":\"$display_name\",\"type\":\"custom\",\"channel_ids\":$ids_json}" > /dev/null 2>&1 || true
  log "  Category: $display_name"
}

create_category "General" \
  "${CHANNEL_IDS[thought-pad]}" \
  "${CHANNEL_IDS[alice]}" \
  "${CHANNEL_IDS[bob]}" \
  "${CHANNEL_IDS[charlie]}"

create_category "Specialists" \
  "${CHANNEL_IDS[flowspec-engineer]}" \
  "${CHANNEL_IDS[gemini]}" \
  "${CHANNEL_IDS[openai]}"

create_category "FlowSpec Tutorial" \
  "${CHANNEL_IDS[flowbot-01]}" \
  "${CHANNEL_IDS[flowbot-02]}" \
  "${CHANNEL_IDS[flowbot-03]}"

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Bootstrap complete!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo "  Channels created:"
for entry in "${CHANNELS[@]}"; do
  IFS='|' read -r name display purpose <<< "$entry"
  echo "    #$name — $purpose"
done
echo ""
echo "  Next steps:"
echo "    1. Build Foreman:  npm run build"
echo "    2. Start Foreman:  node dist/index.js"
echo "    3. Open Mattermost: $MM_URL"
echo "    4. DM the 'foreman' bot for the Architect"
echo "    5. Try a channel: message #alice or #thought-pad"
echo "    6. Run the tutorial: /f run flows/flowspec-tutorial.flow"
echo ""
