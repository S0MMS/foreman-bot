import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { SessionState } from "./types.js";
import { DEFAULT_MODEL } from "./types.js";

const PERSIST_DIR = join(homedir(), ".foreman");
const PERSIST_FILE = join(PERSIST_DIR, "sessions.json");
const LEGACY_FILE = join(PERSIST_DIR, "session.json");

const sessions = new Map<string, SessionState>();

function createDefaultState(): SessionState {
  return {
    sessionId: null,
    name: null,
    ownerId: null,
    cwd: process.env.CLAUDE_CWD || process.cwd(),
    model: DEFAULT_MODEL,
    adapter: "anthropic",
    plugins: [],
    canvasFileId: null,
    autoApprove: false,
    moderator: false,
    isRunning: false,
    abortController: null,
    pendingApproval: null,
  };
}

function save(): void {
  try {
    mkdirSync(PERSIST_DIR, { recursive: true });
    const persisted: Record<string, object> = {};
    for (const [channelId, state] of sessions) {
      persisted[channelId] = {
        sessionId: state.sessionId,
        name: state.name,
        ownerId: state.ownerId,
        cwd: state.cwd,
        model: state.model,
        adapter: state.adapter,
        plugins: state.plugins,
        autoApprove: state.autoApprove,
        moderator: state.moderator,
      };
    }
    writeFileSync(PERSIST_FILE, JSON.stringify(persisted, null, 2));
  } catch (err) {
    console.error("[session] Failed to persist sessions:", err);
  }
}

export function loadSessions(): void {
  // Try new multi-channel format first
  try {
    const data = JSON.parse(readFileSync(PERSIST_FILE, "utf8")) as Record<string, any>;
    for (const [channelId, saved] of Object.entries(data)) {
      const state = createDefaultState();
      state.sessionId = saved.sessionId ?? null;
      state.name = saved.name ?? null;
      state.ownerId = saved.ownerId ?? null;
      state.cwd = saved.cwd ?? state.cwd;
      state.model = saved.model ?? DEFAULT_MODEL;
      state.adapter = saved.adapter ?? "anthropic";
      state.plugins = saved.plugins ?? [];
      state.autoApprove = saved.autoApprove ?? false;
      state.moderator = saved.moderator ?? false;
      sessions.set(channelId, state);
    }
    console.log(`[session] Loaded ${sessions.size} channel session(s)`);
    return;
  } catch {
    // No multi-channel file yet
  }

  // Migrate from legacy single-session format
  try {
    if (existsSync(LEGACY_FILE)) {
      const data = JSON.parse(readFileSync(LEGACY_FILE, "utf8"));
      if (data.sessionId || data.cwd || data.model || data.plugins?.length) {
        const state = createDefaultState();
        state.sessionId = data.sessionId ?? null;
        state.cwd = data.cwd ?? state.cwd;
        state.model = data.model ?? DEFAULT_MODEL;
        state.plugins = data.plugins ?? [];
        // Store under a "default" key — will be re-keyed on first message
        sessions.set("_legacy", state);
        console.log(`[session] Migrated legacy session: ${state.sessionId?.slice(0, 8) ?? "none"}...`);
        save(); // Write new format
      }
    }
  } catch {
    // No legacy session either — fresh start
  }
}

export function getState(channelId: string): SessionState {
  let state = sessions.get(channelId);
  if (!state) {
    state = createDefaultState();
    sessions.set(channelId, state);
  }
  return state;
}

export function getAllChannels(): string[] {
  return Array.from(sessions.keys());
}

export function setSessionId(channelId: string, id: string | null): void {
  getState(channelId).sessionId = id;
  save();
}

export function setName(channelId: string, name: string): void {
  getState(channelId).name = name;
  save();
}

export function setOwner(channelId: string, ownerId: string): void {
  getState(channelId).ownerId = ownerId;
  save();
}

export function setCwd(channelId: string, cwd: string): void {
  getState(channelId).cwd = cwd;
  save();
}

export function setModel(channelId: string, model: string): void {
  getState(channelId).model = model;
  save();
}

export function setAdapter(channelId: string, adapter: string): void {
  getState(channelId).adapter = adapter;
  save();
}

export function addPlugin(channelId: string, path: string): void {
  const state = getState(channelId);
  if (!state.plugins.includes(path)) {
    state.plugins.push(path);
    save();
  }
}

export function getPlugins(channelId: string): string[] {
  return getState(channelId).plugins;
}

export function setCanvasFileId(channelId: string, fileId: string | null): void {
  getState(channelId).canvasFileId = fileId;
}

export function setRunning(channelId: string, running: boolean): void {
  const state = getState(channelId);
  state.isRunning = running;
  if (!running) {
    state.abortController = null;
  }
}

export function setAbortController(channelId: string, controller: AbortController | null): void {
  getState(channelId).abortController = controller;
}

export function setAutoApprove(channelId: string, enabled: boolean): void {
  getState(channelId).autoApprove = enabled;
  save();
}

export function setModerator(channelId: string, enabled: boolean): void {
  getState(channelId).moderator = enabled;
  save();
}

export function setPendingApproval(channelId: string, pending: SessionState["pendingApproval"]): void {
  getState(channelId).pendingApproval = pending;
}

export function clearSession(channelId: string): void {
  const state = getState(channelId);
  state.sessionId = null;
  state.model = DEFAULT_MODEL;
  state.plugins = [];
  state.isRunning = false;
  state.abortController = null;
  state.pendingApproval = null;
  save();
}

export function getAllChannelIds(): string[] {
  return Array.from(sessions.keys()).filter(id => id !== "_legacy");
}

export function deleteSession(channelId: string): void {
  sessions.delete(channelId);
  save();
}

