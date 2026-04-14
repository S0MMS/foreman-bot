#!/usr/bin/env zsh
#
# bootstrap.sh — Set up Foreman from scratch
#
# Auto-creates admin account (fresh install), foreman bot, all channels,
# sidebar categories, and writes config files. No browser interaction needed
# on a fresh Docker Compose install.
#
# Usage:
#   ANTHROPIC_API_KEY=sk-ant-... ./scripts/bootstrap.sh
#
# Environment variables (read from env, or existing config.json):
#   ANTHROPIC_API_KEY  — required for Claude bots
#   GEMINI_API_KEY     — optional, for Gemini bots
#   OPENAI_API_KEY     — optional, for GPT bots
#
# Prerequisites:
#   - Docker containers running (docker compose up -d)
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

# ── Collect API keys from environment ────────────────────────────────────────

ANTHROPIC_KEY="${ANTHROPIC_API_KEY:-}"
GEMINI_KEY="${GEMINI_API_KEY:-}"
OPENAI_KEY="${OPENAI_API_KEY:-}"

# Also check existing config for keys
if [ -f "$CONFIG_FILE" ]; then
  [ -z "$ANTHROPIC_KEY" ] && ANTHROPIC_KEY=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE')).get('anthropicApiKey',''))" 2>/dev/null || echo "")
  [ -z "$GEMINI_KEY" ] && GEMINI_KEY=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE')).get('geminiApiKey',''))" 2>/dev/null || echo "")
  [ -z "$OPENAI_KEY" ] && OPENAI_KEY=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE')).get('openaiApiKey',''))" 2>/dev/null || echo "")
fi

echo ""
log "API Keys:"
if [ -n "$ANTHROPIC_KEY" ]; then
  log "  Anthropic: ${ANTHROPIC_KEY:0:10}...  ✓"
else
  warn "  Anthropic: not set (required for Claude bots)"
  warn "  Set ANTHROPIC_API_KEY and re-run, or add to ~/.foreman/config.json later"
fi
if [ -n "$GEMINI_KEY" ]; then
  log "  Gemini:    ${GEMINI_KEY:0:10}...  ✓"
else
  warn "  Gemini:    not set (optional — gemini channels will show setup instructions)"
fi
if [ -n "$OPENAI_KEY" ]; then
  log "  OpenAI:    ${OPENAI_KEY:0:10}...  ✓"
else
  warn "  OpenAI:    not set (optional — gpt channels will show setup instructions)"
fi

# ── Get admin credentials ────────────────────────────────────────────────────

ADMIN_USERNAME="foreman-admin"
ADMIN_EMAIL="admin@foreman.local"
ADMIN_PASSWORD=""

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
  log "Setting up Mattermost admin account..."

  # Check if any users exist — if not, this is a fresh install and we can auto-create
  USER_COUNT=$(curl -sf "$MM_URL/api/v4/users/stats" 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('total_users_count',0))" 2>/dev/null || echo "0")

  if [ "$USER_COUNT" = "0" ]; then
    # Fresh install — auto-create admin account
    ADMIN_PASSWORD=$(python3 -c "import secrets,string; print('F0r3man!' + secrets.token_hex(8))")
    log "  Fresh Mattermost install detected — creating admin account..."

    CREATE_RESULT=$(curl -sf -X POST "$MM_URL/api/v4/users" \
      -H "Content-Type: application/json" \
      -d "{\"email\":\"$ADMIN_EMAIL\",\"username\":\"$ADMIN_USERNAME\",\"password\":\"$ADMIN_PASSWORD\"}" 2>/dev/null || echo "")

    if [ -z "$CREATE_RESULT" ]; then
      err "Failed to create admin account. Is Mattermost running?"
      exit 1
    fi

    ADMIN_USER_ID_CREATED=$(echo "$CREATE_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")
    if [ -z "$ADMIN_USER_ID_CREATED" ]; then
      err "Failed to create admin account: $CREATE_RESULT"
      exit 1
    fi

    # Promote to system admin
    curl -sf -X PUT "$MM_URL/api/v4/users/$ADMIN_USER_ID_CREATED/roles" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer placeholder" \
      -d '{"roles":"system_admin system_user"}' > /dev/null 2>&1 || true

    # Login to get a session token
    LOGIN_RESULT=$(curl -sf -D - -X POST "$MM_URL/api/v4/users/login" \
      -H "Content-Type: application/json" \
      -d "{\"login_id\":\"$ADMIN_USERNAME\",\"password\":\"$ADMIN_PASSWORD\"}" 2>/dev/null || echo "")

    SESSION_TOKEN=$(echo "$LOGIN_RESULT" | grep -i "^token:" | tr -d '[:space:]' | cut -d: -f2)

    if [ -z "$SESSION_TOKEN" ]; then
      err "Failed to login as admin. Create account manually at $MM_URL"
      exit 1
    fi

    # Generate a personal access token using the session
    PAT_RESULT=$(curl -sf -X POST "$MM_URL/api/v4/users/$ADMIN_USER_ID_CREATED/tokens" \
      -H "Authorization: Bearer $SESSION_TOKEN" \
      -H "Content-Type: application/json" \
      -d '{"description":"foreman-bootstrap"}' 2>/dev/null || echo "")

    ADMIN_TOKEN=$(echo "$PAT_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null || echo "")

    if [ -z "$ADMIN_TOKEN" ]; then
      err "Failed to generate admin access token. Create account manually at $MM_URL"
      exit 1
    fi

    log "  Admin account created: $ADMIN_USERNAME"
    log "  Admin password: $ADMIN_PASSWORD (save this!)"
  else
    # Users exist — try to log in with known credentials, or ask for token
    log "  Existing Mattermost install detected ($USER_COUNT users)"

    # Try login with default credentials (from a previous setup run)
    LOGIN_RESULT=$(curl -sf -D - -X POST "$MM_URL/api/v4/users/login" \
      -H "Content-Type: application/json" \
      -d "{\"login_id\":\"$ADMIN_USERNAME\",\"password\":\"${FOREMAN_ADMIN_PASSWORD:-notset}\"}" 2>/dev/null || echo "")

    SESSION_TOKEN=$(echo "$LOGIN_RESULT" | grep -i "^token:" | tr -d '[:space:]' | cut -d: -f2)

    if [ -n "$SESSION_TOKEN" ]; then
      # Get user ID from session
      ADMIN_USER_INFO=$(curl -sf -H "Authorization: Bearer $SESSION_TOKEN" "$MM_URL/api/v4/users/me" 2>/dev/null || echo "")
      ADMIN_USER_ID_CREATED=$(echo "$ADMIN_USER_INFO" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")

      # Generate a personal access token
      PAT_RESULT=$(curl -sf -X POST "$MM_URL/api/v4/users/$ADMIN_USER_ID_CREATED/tokens" \
        -H "Authorization: Bearer $SESSION_TOKEN" \
        -H "Content-Type: application/json" \
        -d '{"description":"foreman-bootstrap"}' 2>/dev/null || echo "")

      ADMIN_TOKEN=$(echo "$PAT_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null || echo "")
    fi

    if [ -z "${ADMIN_TOKEN:-}" ]; then
      echo ""
      echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
      echo -e "${BLUE}  Mattermost Admin Token Needed${NC}"
      echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
      echo ""
      echo "  Open $MM_URL → Your Avatar → Profile → Security"
      echo "  → Personal Access Tokens → Create Token"
      echo ""
      read -rp "  Paste your admin access token: " ADMIN_TOKEN
      echo ""

      if ! curl -sf -H "Authorization: Bearer $ADMIN_TOKEN" "$MM_URL/api/v4/users/me" > /dev/null 2>&1; then
        err "Invalid token. Please check and try again."
        exit 1
      fi
      log "  Admin token verified."
    fi
  fi
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
  log "No teams found — creating 'Foreman' team..."
  TEAM_RESULT=$(curl -sf -X POST "$MM_URL/api/v4/teams" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"foreman","display_name":"Foreman","type":"O"}')
  TEAM_ID=$(echo "$TEAM_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
  if [ -z "$TEAM_ID" ]; then
    err "Failed to create team."
    exit 1
  fi
  log "  Created team 'Foreman' ($TEAM_ID)"
fi
TEAM_NAME=$(echo "$TEAMS" | python3 -c "import sys,json; teams=json.load(sys.stdin); print(teams[0]['display_name'] if teams else 'Foreman')")
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
  # FLOWSPEC TUTORIAL
  "flowspec-engineer|flowspec-engineer|FlowSpec specialist — helps write .flow files"
  "flowbot-01|flowbot-01|FlowSpec tutorial bot 1"
  "flowbot-02|flowbot-02|FlowSpec tutorial bot 2"
  "flowbot-03|flowbot-03|FlowSpec tutorial bot 3"
  # TECHOPS-2187
  "claude-worker|claude-worker|TECHOPS-2187 Claude worker"
  "gemini-worker|gemini-worker|TECHOPS-2187 Gemini worker"
  "gpt-worker|gpt-worker|TECHOPS-2187 GPT worker"
  "claude-judge|claude-judge|TECHOPS-2187 synthesis judge"
  "techops-2187|techops-2187|TECHOPS-2187 report/coordination channel"
  # PYTHIA
  "pythia-claude-worker|pythia-claude-worker|Pythia Claude research worker"
  "pythia-gemini-worker|pythia-gemini-worker|Pythia Gemini research worker"
  "pythia-gpt-worker|pythia-gpt-worker|Pythia GPT research worker"
  "pythia-claude-judge|pythia-claude-judge|Pythia synthesis judge"
  "pythia-gemini-verifier|pythia-gemini-verifier|Pythia independent verifier"
  "pythia-collator|pythia-collator|Pythia research briefing collator"
  # MODELS
  "claude|claude|Anthropic Claude Opus — raw model access"
  "gemini|gemini|Google Gemini — raw model access"
  "gpt|gpt|OpenAI GPT — raw model access"
  # GENERAL
  "foreman-onboarding|foreman-onboarding|Developer onboarding guide and quick reference"
  "thought-pad|thought-pad|Brainstorming and rubber duck debugging"
  "alice|alice|General-purpose Claude assistant"
  "bob|bob|Pragmatic problem-solver"
  "charlie|charlie|Creative thinker and communicator"
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
  BOOTSTRAP_NAMES="flowspec-engineer flowbot-01 flowbot-02 flowbot-03 claude-worker gemini-worker gpt-worker claude-judge techops-2187 pythia-claude-worker pythia-gemini-worker pythia-gpt-worker pythia-claude-judge pythia-gemini-verifier pythia-collator claude gemini gpt foreman-onboarding thought-pad alice bob charlie"
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

# Build config with API keys + Mattermost settings
python3 -c "
import json, os

config = {}
if os.path.exists('$CONFIG_FILE'):
    with open('$CONFIG_FILE') as f:
        config = json.load(f)

config['mattermostUrl'] = '$MM_URL'
config['mattermostAdminToken'] = '$ADMIN_TOKEN'
config['mattermostTeamId'] = '$TEAM_ID'
config['defaultCwd'] = '$REPO_ROOT'

tokens = config.get('mattermostBotTokens', {})
tokens['foreman'] = '$FOREMAN_TOKEN'
config['mattermostBotTokens'] = tokens

# API keys — set from env if available, preserve existing if not
anthropic_key = '$ANTHROPIC_KEY'
gemini_key = '$GEMINI_KEY'
openai_key = '$OPENAI_KEY'

if anthropic_key:
    config['anthropicApiKey'] = anthropic_key
if gemini_key:
    config['geminiApiKey'] = gemini_key
if openai_key:
    config['openaiApiKey'] = openai_key

with open('$CONFIG_FILE', 'w') as f:
    json.dump(config, f, indent=2)
    f.write('\n')
"
log "  Written to $CONFIG_FILE"

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

  # Check if category already exists
  local existing_id
  existing_id=$(mm_api GET "/users/$ADMIN_USER_ID/teams/$TEAM_ID/channels/categories" 2>/dev/null | python3 -c "
import sys, json
data = json.load(sys.stdin)
cats = data.get('categories', data) if isinstance(data, dict) else data
for c in cats:
    if c.get('display_name') == '$display_name' and c.get('type') == 'custom':
        print(c['id'])
        break
" 2>/dev/null || echo "")

  if [ -n "$existing_id" ]; then
    # Update existing category with current channel list
    mm_api PUT "/users/$ADMIN_USER_ID/teams/$TEAM_ID/channels/categories/$existing_id" \
      "{\"id\":\"$existing_id\",\"user_id\":\"$ADMIN_USER_ID\",\"team_id\":\"$TEAM_ID\",\"display_name\":\"$display_name\",\"type\":\"custom\",\"channel_ids\":$ids_json}" > /dev/null 2>&1 || true
    log "  Category: $display_name (updated)"
  else
    mm_api POST "/users/$ADMIN_USER_ID/teams/$TEAM_ID/channels/categories" \
      "{\"user_id\":\"$ADMIN_USER_ID\",\"team_id\":\"$TEAM_ID\",\"display_name\":\"$display_name\",\"type\":\"custom\",\"channel_ids\":$ids_json}" > /dev/null 2>&1 || true
    log "  Category: $display_name (created)"
  fi
}

create_category "FlowSpec Tutorial" \
  "${CHANNEL_IDS[flowspec-engineer]}" \
  "${CHANNEL_IDS[flowbot-01]}" \
  "${CHANNEL_IDS[flowbot-02]}" \
  "${CHANNEL_IDS[flowbot-03]}"

create_category "TECHOPS-2187" \
  "${CHANNEL_IDS[claude-worker]}" \
  "${CHANNEL_IDS[gemini-worker]}" \
  "${CHANNEL_IDS[gpt-worker]}" \
  "${CHANNEL_IDS[claude-judge]}" \
  "${CHANNEL_IDS[techops-2187]}"

create_category "Pythia" \
  "${CHANNEL_IDS[pythia-claude-worker]}" \
  "${CHANNEL_IDS[pythia-gemini-worker]}" \
  "${CHANNEL_IDS[pythia-gpt-worker]}" \
  "${CHANNEL_IDS[pythia-claude-judge]}" \
  "${CHANNEL_IDS[pythia-gemini-verifier]}" \
  "${CHANNEL_IDS[pythia-collator]}"

create_category "Models" \
  "${CHANNEL_IDS[claude]}" \
  "${CHANNEL_IDS[gemini]}" \
  "${CHANNEL_IDS[gpt]}"

create_category "General" \
  "${CHANNEL_IDS[foreman-onboarding]}" \
  "${CHANNEL_IDS[thought-pad]}" \
  "${CHANNEL_IDS[alice]}" \
  "${CHANNEL_IDS[bob]}" \
  "${CHANNEL_IDS[charlie]}"

# ── Post pointer to #foreman-onboarding in town-square ───────────────────────

echo ""
log "Posting onboarding pointer to #town-square..."

TOWN_SQUARE_ID=$(mm_api GET "/teams/$TEAM_ID/channels/name/town-square" 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")

if [ -n "$TOWN_SQUARE_ID" ]; then
  add_to_channel "$TOWN_SQUARE_ID" "$FOREMAN_USER_ID"

  # Only post if Foreman hasn't already posted here (idempotent on re-runs)
  FOREMAN_ALREADY_POSTED=$(mm_api GET "/channels/$TOWN_SQUARE_ID/posts?per_page=50" 2>/dev/null | python3 -c "
import sys, json
data = json.load(sys.stdin)
posts = data.get('posts', {})
print('yes' if any(p.get('user_id') == '$FOREMAN_USER_ID' for p in posts.values()) else '')
" 2>/dev/null || echo "")

  if [ -z "$FOREMAN_ALREADY_POSTED" ]; then
    POINTER_MSG="👋 **Welcome to Foreman!** Head to ~foreman-onboarding for the full setup guide, quick-start commands, and everything you need to get up and running."
    curl -sf -X POST "$MM_URL/api/v4/posts" \
      -H "Authorization: Bearer $FOREMAN_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"channel_id\":\"$TOWN_SQUARE_ID\",\"message\":$(printf '%s' "$POINTER_MSG" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))")}" > /dev/null 2>&1 || true
    log "  Pointer posted to #town-square"
  else
    log "  #town-square already has a Foreman post — skipping"
  fi
else
  warn "  #town-square not found — skipping pointer"
fi

# ── Post ONBOARDING.md to #foreman-onboarding ────────────────────────────────

echo ""
log "Posting ONBOARDING.md to #foreman-onboarding..."

ONBOARDING_CHANNEL_ID="${CHANNEL_IDS[foreman-onboarding]:-}"
ONBOARDING_FILE="$REPO_ROOT/ONBOARDING.md"

if [ -n "$ONBOARDING_CHANNEL_ID" ] && [ -f "$ONBOARDING_FILE" ]; then
  # Only post if Foreman hasn't already posted here (idempotent on re-runs)
  ONBOARDING_ALREADY_POSTED=$(mm_api GET "/channels/$ONBOARDING_CHANNEL_ID/posts?per_page=10" 2>/dev/null | python3 -c "
import sys, json
data = json.load(sys.stdin)
posts = data.get('posts', {})
print('yes' if any(p.get('user_id') == '$FOREMAN_USER_ID' for p in posts.values()) else '')
" 2>/dev/null || echo "")

  if [ -n "$ONBOARDING_ALREADY_POSTED" ]; then
    log "  #foreman-onboarding already has a Foreman post — skipping"
  else
    ONBOARDING_TMP=$(mktemp)
    python3 -c "
import json
with open('$ONBOARDING_FILE') as f:
    content = f.read()
with open('$ONBOARDING_TMP', 'w') as f:
    json.dump({'channel_id': '$ONBOARDING_CHANNEL_ID', 'message': content}, f)
"
    ONBOARDING_RESULT=$(curl -sf -X POST "$MM_URL/api/v4/posts" \
      -H "Authorization: Bearer $FOREMAN_TOKEN" \
      -H "Content-Type: application/json" \
      --data-binary "@$ONBOARDING_TMP" 2>/dev/null || echo "")
    rm -f "$ONBOARDING_TMP"

    ONBOARDING_POST_ID=$(printf '%s' "$ONBOARDING_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")

    if [ -n "$ONBOARDING_POST_ID" ]; then
      curl -sf -X POST "$MM_URL/api/v4/posts/$ONBOARDING_POST_ID/pin" \
        -H "Authorization: Bearer $ADMIN_TOKEN" > /dev/null 2>&1 || true
      log "  ONBOARDING.md posted and pinned in #foreman-onboarding"
    else
      warn "  Could not post ONBOARDING.md (non-fatal)"
    fi
  fi
else
  warn "  Skipping onboarding post — channel or file not found"
fi

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
if [ -n "$ADMIN_PASSWORD" ]; then
  echo ""
  echo -e "  ${YELLOW}Mattermost login credentials (save these!):${NC}"
  echo "    Username: $ADMIN_USERNAME"
  echo "    Password: $ADMIN_PASSWORD"
fi
echo ""
echo "  API keys:"
[ -n "$ANTHROPIC_KEY" ] && echo -e "    Anthropic: ${GREEN}configured${NC}" || echo -e "    Anthropic: ${YELLOW}not set — set ANTHROPIC_API_KEY${NC}"
[ -n "$GEMINI_KEY" ]    && echo -e "    Gemini:    ${GREEN}configured${NC}" || echo -e "    Gemini:    ${YELLOW}not set (optional)${NC}"
[ -n "$OPENAI_KEY" ]    && echo -e "    OpenAI:    ${GREEN}configured${NC}" || echo -e "    OpenAI:    ${YELLOW}not set (optional)${NC}"
echo ""
echo "  Next steps:"
echo "    1. npm start"
echo "    2. Open $MM_URL"
echo "    3. Login as $ADMIN_USERNAME"
echo "    4. Check #foreman-onboarding for the pinned setup guide"
echo "    5. Message any channel — #alice, #claude, #gemini, #gpt, etc."
echo ""
echo -e "  ${BLUE}New to Foreman? Read ONBOARDING.md for the full guide.${NC}"
echo ""
