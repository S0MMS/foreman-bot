import { type Application, type Response } from 'express';
import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { getAllBots, getRosterTree } from './bots.js';
import { callBotByName } from './kafka.js';
import { getCanvases, createCanvas, updateCanvas, deleteCanvas } from './canvases.js';
import { setRosterOverride, addCustomFolder, removeCustomFolder } from './roster-overrides.js';
import { getState, setModel, setName, setAutoApprove, clearSession } from './session.js';
import { MODEL_ALIASES } from './types.js';
import { getAllBotStatuses, onBotStatusChange } from './bot-status.js';

/** Build a grouped tool/MCP summary for /f session */
/** Build structured tool data for /f session */
function getToolData(): {
  builtins: string[];
  foreman: Record<string, string[]>;
  cloudMcps: string[];
} {
  const builtins = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Agent', 'Skill', 'TodoWrite', 'NotebookEdit'];

  const foreman: Record<string, string[]> = {
    Canvas: ['Append', 'Create', 'Delete', 'DeleteElementById', 'FindSection', 'List', 'Read', 'ReadById', 'UpdateElementById'],
    Jira: ['AddComment', 'AssignTicket', 'CreateTicket', 'DeleteComment', 'DeleteTicket', 'GetFieldOptions', 'GetTransitions', 'ReadTicket', 'Search', 'SetField', 'TransitionTicket', 'UpdateComment', 'UpdateTicket'],
    Confluence: ['CreatePage', 'ReadPage', 'Search', 'UpdatePage'],
    GitHub: ['CreatePR', 'ListPRs', 'ReadIssue', 'ReadPR', 'Search'],
    Slack: ['PostMessage', 'ReadChannel'],
    Diagram: ['Create'],
    System: ['GetCurrentChannel', 'LaunchApp', 'SelfReboot', 'TriggerBitrise'],
  };

  let cloudMcps: string[] = [];
  try {
    const cachePath = join(homedir(), '.claude', 'mcp-needs-auth-cache.json');
    const cache = JSON.parse(readFileSync(cachePath, 'utf-8'));
    cloudMcps = Object.keys(cache)
      .filter(k => k.startsWith('claude.ai '))
      .map(k => k.replace('claude.ai ', ''));
  } catch {
    // No cache file
  }

  return { builtins, foreman, cloudMcps };
}

// SSE clients: botName → Set of Response objects
const sseClients = new Map<string, Set<Response>>();

/** Push an event to all SSE clients watching a bot */
export function pushUiEvent(botName: string, event: object): void {
  const clients = sseClients.get(botName);
  if (!clients) return;
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) {
    try { res.write(data); } catch { clients.delete(res); }
  }
}

export function registerUiRoutes(app: Application): void {
  // Roster tree for left nav
  app.get('/api/roster', (_req, res) => {
    res.json(getRosterTree());
  });

  // Create a new (possibly empty) folder
  app.post('/api/roster/folders', (req, res) => {
    const { folder } = req.body as { folder: string };
    if (!folder || !folder.trim()) { res.status(400).json({ error: 'folder name required' }); return; }
    addCustomFolder(folder.trim());
    res.json({ ok: true, folder: folder.trim() });
  });

  // Delete a custom folder
  app.delete('/api/roster/folders/*folderPath', (req, res) => {
    const folderPath = (req.params.folderPath as unknown as string[]).join('/');
    removeCustomFolder(folderPath);
    res.json({ ok: true, folder: folderPath });
  });

  // Move a bot to a different folder (drag-and-drop)
  app.patch('/api/roster/:botName', (req, res) => {
    const { botName } = req.params;
    const { folder } = req.body as { folder: string };
    if (!folder) { res.status(400).json({ error: 'folder required' }); return; }
    setRosterOverride(botName, folder);
    res.json({ ok: true, botName, folder });
  });

  // Bot statuses (snapshot)
  app.get('/api/bots/status', (_req, res) => {
    res.json(getAllBotStatuses());
  });

  // SSE stream for bot status changes — browser subscribes once
  app.get('/api/bots/status/stream', (_req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Send current snapshot immediately
    const snapshot = getAllBotStatuses();
    res.write(`data: ${JSON.stringify({ type: 'snapshot', statuses: snapshot })}\n\n`);

    const unsubscribe = onBotStatusChange((botName, status) => {
      try { res.write(`data: ${JSON.stringify({ type: 'status_change', botName, status })}\n\n`); } catch { /* client gone */ }
    });

    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 30000);
    res.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  // List all bots
  app.get('/api/bots', (_req, res) => {
    const bots = getAllBots().map(({ name, definition }) => ({
      name,
      type: definition.type,
      provider: (definition as any).provider ?? null,
      model: (definition as any).model ?? null,
    }));
    res.json(bots);
  });

  // Chat with a bot (non-streaming)
  app.post('/api/chat', async (req, res) => {
    const { botName, message } = req.body as { botName: string; message: string };
    if (!botName || !message) { res.status(400).json({ error: 'botName and message required' }); return; }
    try {
      const response = await callBotByName(botName, message);
      res.json({ response });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // SSE stream — browser connects once and listens for canvas updates etc.
  app.get('/api/events', (req, res) => {
    const botName = (req.query.botName as string) ?? '_global';
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    if (!sseClients.has(botName)) sseClients.set(botName, new Set());
    sseClients.get(botName)!.add(res);

    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 30000);
    res.on('close', () => {
      clearInterval(heartbeat);
      sseClients.get(botName)?.delete(res);
    });
  });

  // Canvas CRUD
  app.get('/api/canvas/:botName', (req, res) => {
    res.json(getCanvases(req.params.botName));
  });

  app.post('/api/canvas/:botName', (req, res) => {
    const { title, type, content } = req.body;
    if (!title || !type) { res.status(400).json({ error: 'title and type required' }); return; }
    const canvas = createCanvas(req.params.botName, title, type, content ?? '');
    pushUiEvent(req.params.botName, { type: 'canvas_created', canvas });
    res.json(canvas);
  });

  app.put('/api/canvas/:botName/:id', (req, res) => {
    const canvas = updateCanvas(req.params.botName, req.params.id, req.body);
    if (!canvas) { res.status(404).json({ error: 'Canvas not found' }); return; }
    pushUiEvent(req.params.botName, { type: 'canvas_updated', canvas });
    res.json(canvas);
  });

  app.delete('/api/canvas/:botName/:id', (req, res) => {
    const ok = deleteCanvas(req.params.botName, req.params.id);
    if (!ok) { res.status(404).json({ error: 'Canvas not found' }); return; }
    pushUiEvent(req.params.botName, { type: 'canvas_deleted', canvasId: req.params.id });
    res.json({ ok: true });
  });

  // /cc session control commands for the UI Architect
  app.post('/api/command', (req, res) => {
    const { command } = req.body as { command: string };
    if (!command) { res.status(400).json({ error: 'command required' }); return; }

    const parts = command.replace(/^\/cc\s+/, '').trim().split(/\s+/);
    const cmd = parts[0]?.toLowerCase();
    const arg = parts.slice(1).join(' ');

    const CHANNEL = 'ui:architect';

    if (cmd === 'session') {
      const s = getState(CHANNEL);
      res.json({
        type: 'session_info',
        session: {
          channel: CHANNEL,
          model: s.model,
          name: s.name ?? null,
          cwd: s.cwd,
          autoApprove: s.autoApprove,
          sessionId: s.sessionId ? s.sessionId.slice(0, 8) + '...' : null,
        },
        tools: getToolData(),
      });
      return;
    }

    if (cmd === 'model') {
      if (!arg) { res.json({ response: `Current model: ${getState(CHANNEL).model}` }); return; }
      const resolved = MODEL_ALIASES[arg] ?? arg;
      setModel(CHANNEL, resolved);
      res.json({ response: `Model set to: ${resolved}` });
      return;
    }

    if (cmd === 'name') {
      if (!arg) { res.json({ response: `Current name: ${getState(CHANNEL).name ?? '(none)'}` }); return; }
      setName(CHANNEL, arg);
      res.json({ response: `Name set to: ${arg}` });
      return;
    }

    if (cmd === 'auto-approve') {
      const on = arg === 'on';
      const off = arg === 'off';
      if (!on && !off) { res.json({ response: `Auto-approve is: ${getState(CHANNEL).autoApprove ? 'on' : 'off'}` }); return; }
      setAutoApprove(CHANNEL, on);
      res.json({ response: `Auto-approve: ${on ? 'on' : 'off'}` });
      return;
    }

    if (cmd === 'new') {
      clearSession(CHANNEL);
      res.json({ response: 'Session cleared. Next message starts a fresh conversation.' });
      return;
    }

    res.json({ response: `Unknown command: /cc ${cmd}\n\nAvailable: session, model, name, auto-approve, new, stop` });
  });
}
