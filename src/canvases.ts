import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import crypto from 'crypto';

const PATH = join(homedir(), '.foreman', 'canvases.json');

export interface Canvas {
  id: string;
  title: string;
  type: 'markdown' | 'mermaid' | 'code' | 'csv';
  content: string;
  createdAt: string;
  updatedAt: string;
}

type Store = Record<string, Canvas[]>;

function load(): Store {
  try { return JSON.parse(readFileSync(PATH, 'utf-8')); } catch { return {}; }
}

function save(store: Store): void {
  writeFileSync(PATH, JSON.stringify(store, null, 2));
}

export function getCanvases(botName: string): Canvas[] {
  return load()[botName] ?? [];
}

export function createCanvas(botName: string, title: string, type: Canvas['type'], content = ''): Canvas {
  const store = load();
  const canvas: Canvas = { id: crypto.randomUUID(), title, type, content, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  store[botName] = [...(store[botName] ?? []), canvas];
  save(store);
  return canvas;
}

export function updateCanvas(botName: string, id: string, updates: Partial<Pick<Canvas, 'title' | 'content'>>): Canvas | null {
  const store = load();
  const list = store[botName] ?? [];
  const idx = list.findIndex(c => c.id === id);
  if (idx === -1) return null;
  list[idx] = { ...list[idx], ...updates, updatedAt: new Date().toISOString() };
  store[botName] = list;
  save(store);
  return list[idx];
}

export function deleteCanvas(botName: string, id: string): boolean {
  const store = load();
  const list = store[botName] ?? [];
  const filtered = list.filter(c => c.id !== id);
  if (filtered.length === list.length) return false;
  store[botName] = filtered;
  save(store);
  return true;
}
