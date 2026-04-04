/**
 * ui-claude.ts — WebSocket-based Architect agent session
 *
 * Bridges the Claude Agent SDK to a WebSocket connection for the Foreman UI.
 * Each WS connection is one conversation session. Messages stream back as
 * typed events; tool approvals pause the SDK loop until the browser responds.
 */

import { WebSocket } from 'ws';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { AUTO_APPROVE_TOOLS } from './types.js';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { App } from '@slack/bolt';
import { getState, setSessionId } from './session.js';
import { createCanvasMcpServer } from './mcp-canvas.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

// ── Types ──────────────────────────────────────────────────────────────────────

interface PendingApproval {
  resolve: (approved: boolean) => void;
}

interface ActiveSession {
  ws: WebSocket;
  pendingApprovals: Map<string, PendingApproval>;
  abortController: AbortController;
  sessionId: string | null;
}

// ── State ──────────────────────────────────────────────────────────────────────

// Active WebSocket connections keyed by sessionId
const activeSessions = new Map<string, ActiveSession>();

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Send a typed event to the browser */
function send(ws: WebSocket, event: object): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(event));
  }
}

const ARCHITECT_SYSTEM_PROMPT =
  'You are Foreman, the Architect — the orchestrating intelligence of the Foreman multi-agent system. ' +
  'You have full Claude Code capabilities: file system access, bash execution, web fetch, and more. ' +
  'You can read and modify code, run commands, and direct other agents. ' +
  'Be concise and direct. When using tools, explain what you are doing briefly.';

// ── Agent Loop ─────────────────────────────────────────────────────────────────

async function runAgentSession(
  ws: WebSocket,
  pendingApprovals: Map<string, PendingApproval>,
  userMessage: string,
  sessionEntry: ActiveSession,
  app?: App
): Promise<void> {
  const abortController = sessionEntry.abortController;

  const canUseTool = async (
    toolName: string,
    input: Record<string, unknown>
  ): Promise<
    | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
    | { behavior: 'deny'; message: string }
  > => {
    // Auto-approve read-only tools
    const baseName = toolName.replace(/^mcp__[^_]+__/, '');
    if (AUTO_APPROVE_TOOLS.has(toolName) || AUTO_APPROVE_TOOLS.has(baseName)) {
      return { behavior: 'allow', updatedInput: input };
    }

    // Pause for browser approval
    const toolId = crypto.randomUUID();
    send(ws, {
      type: 'tool_approval',
      toolId,
      name: toolName,
      input,
    });

    return new Promise<{ behavior: 'allow'; updatedInput?: Record<string, unknown> } | { behavior: 'deny'; message: string }>((resolve) => {
      pendingApprovals.set(toolId, {
        resolve: (approved: boolean) => {
          if (approved) {
            resolve({ behavior: 'allow', updatedInput: input });
          } else {
            resolve({ behavior: 'deny', message: 'User denied this action via Foreman UI' });
          }
        },
      });
    });
  };

  const mcpServers: Record<string, any> = {};
  if (app) {
    mcpServers['foreman-toolbelt'] = createCanvasMcpServer('ui:architect', app);
  }

  const queryOptions: Parameters<typeof query>[0] = {
    prompt: userMessage,
    options: {
      model: 'claude-sonnet-4-6',
      cwd: REPO_ROOT,
      abortController,
      settingSources: ['user', 'project'],
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: ARCHITECT_SYSTEM_PROMPT,
      },
      canUseTool,
      ...(Object.keys(mcpServers).length > 0 ? { mcpServers } : {}),
      stderr: (data: string) => {
        console.error('[architect ws] stderr:', data);
      },
    },
  };

  // Resume if we have a prior session ID
  if (sessionEntry.sessionId) {
    (queryOptions.options as any).resume = sessionEntry.sessionId;
  }

  const q = query(queryOptions);

  try {
    for await (const message of q) {
      if (message.type === 'system' && message.subtype === 'init') {
        sessionEntry.sessionId = message.session_id;
        setSessionId('ui:architect', message.session_id);
      }

      if (message.type === 'assistant') {
        // Stream text content
        const content = message.message?.content ?? [];
        for (const block of content) {
          if (block.type === 'text' && block.text) {
            send(ws, { type: 'token', content: block.text });
          }
          if (block.type === 'tool_use') {
            // Notify UI that a tool was invoked (after approval)
            send(ws, {
              type: 'tool_result',
              name: block.name,
              input: block.input,
            });
          }
        }
      }

      if (message.type === 'result') {
        if (message.subtype === 'success') {
          send(ws, { type: 'done', content: message.result });
        } else {
          send(ws, {
            type: 'error',
            content: `Error (${message.subtype}): ${(message.errors || []).join(', ')}`,
          });
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    send(ws, { type: 'error', content: msg });
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Handle an incoming WebSocket connection for the Architect.
 * Each connection is one conversation session.
 */
export async function handleArchitectConnection(ws: WebSocket, app?: App): Promise<void> {
  const sessionId = crypto.randomUUID();
  const pendingApprovals = new Map<string, PendingApproval>();
  const abortController = new AbortController();

  // Restore persisted session so the Architect remembers prior conversations
  const persistedSessionId = getState('ui:architect').sessionId;

  const sessionEntry: ActiveSession = {
    ws,
    pendingApprovals,
    abortController,
    sessionId: persistedSessionId, // restored from disk; null on first ever launch
  };

  activeSessions.set(sessionId, sessionEntry);

  send(ws, { type: 'connected', sessionId });

  ws.on('message', async (data) => {
    let msg: any;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      send(ws, { type: 'error', content: 'Invalid JSON message' });
      return;
    }

    if (msg.type === 'message') {
      await runAgentSession(ws, pendingApprovals, msg.content, sessionEntry, app);
    }

    if (msg.type === 'approve') {
      const pending = pendingApprovals.get(msg.toolId);
      if (pending) {
        pending.resolve(msg.approved === true);
        pendingApprovals.delete(msg.toolId);
      }
    }
  });

  ws.on('close', () => {
    activeSessions.delete(sessionId);
    abortController.abort();
  });
}
