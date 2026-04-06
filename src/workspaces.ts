import { readdirSync, readFileSync, statSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, extname } from 'path';
import { parse as parseYaml } from 'yaml';

const WORKSPACES_DIR = join(process.cwd(), 'workspaces');

/** Convert a display name to a filesystem-safe slug */
export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export interface WorkspaceBot {
  name: string;
  type: string;
  provider?: string;
  model?: string;
  system_prompt?: string;
}

export interface WorkspaceMeta {
  slug: string;
  name: string;
  description?: string;
  bots: WorkspaceBot[];
}

export interface WorkspaceFile {
  name: string;
  ext: string;
  size: number;
}

/** List all workspaces (directories with a workspace.yaml) */
export function listWorkspaces(): WorkspaceMeta[] {
  if (!existsSync(WORKSPACES_DIR)) return [];

  return readdirSync(WORKSPACES_DIR)
    .filter(entry => {
      const dir = join(WORKSPACES_DIR, entry);
      return statSync(dir).isDirectory() && existsSync(join(dir, 'workspace.yaml'));
    })
    .map(slug => {
      const yamlPath = join(WORKSPACES_DIR, slug, 'workspace.yaml');
      const parsed = parseYaml(readFileSync(yamlPath, 'utf-8'));
      return {
        slug,
        name: parsed.name ?? slug,
        description: parsed.description ?? undefined,
        bots: (parsed.bots ?? []) as WorkspaceBot[],
      };
    });
}

/** Get a single workspace by slug */
export function getWorkspace(slug: string): WorkspaceMeta | null {
  const dir = join(WORKSPACES_DIR, slug);
  const yamlPath = join(dir, 'workspace.yaml');
  if (!existsSync(yamlPath)) return null;

  const parsed = parseYaml(readFileSync(yamlPath, 'utf-8'));
  return {
    slug,
    name: parsed.name ?? slug,
    description: parsed.description ?? undefined,
    bots: (parsed.bots ?? []) as WorkspaceBot[],
  };
}

/** List files in a workspace (excludes workspace.yaml) */
export function listWorkspaceFiles(slug: string): WorkspaceFile[] {
  const dir = join(WORKSPACES_DIR, slug);
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter(f => f !== 'workspace.yaml' && !statSync(join(dir, f)).isDirectory())
    .map(f => ({
      name: f,
      ext: extname(f),
      size: statSync(join(dir, f)).size,
    }));
}

/** Read a file from a workspace */
export function readWorkspaceFile(slug: string, filename: string): string | null {
  // Prevent path traversal
  if (filename.includes('..') || filename.includes('/')) return null;

  const filePath = join(WORKSPACES_DIR, slug, filename);
  if (!existsSync(filePath)) return null;

  return readFileSync(filePath, 'utf-8');
}

/** Create a new workspace */
export function createWorkspace(displayName: string, description?: string): WorkspaceMeta {
  const slug = slugify(displayName);
  const dir = join(WORKSPACES_DIR, slug);

  if (!existsSync(WORKSPACES_DIR)) mkdirSync(WORKSPACES_DIR, { recursive: true });
  mkdirSync(dir, { recursive: true });

  const yaml = [
    `name: "${displayName}"`,
    description ? `description: "${description}"` : null,
    `bots: []`,
  ].filter(Boolean).join('\n') + '\n';

  writeFileSync(join(dir, 'workspace.yaml'), yaml);

  return { slug, name: displayName, description, bots: [] };
}
