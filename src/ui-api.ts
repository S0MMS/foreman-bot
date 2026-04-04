import { type Application, type Response } from 'express';
import { getAllBots, getRosterTree } from './bots.js';
import { callBotByName } from './kafka.js';
import { getCanvases, createCanvas, updateCanvas, deleteCanvas } from './canvases.js';
import { setRosterOverride, addCustomFolder, removeCustomFolder } from './roster-overrides.js';

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
}
