# Welcome to Foreman

Foreman is a multi-agent platform that lets you talk to AI bots and orchestrate them into workflows.

## What is a Workspace?

A workspace is a task container. It groups together:

- **Bots** — AI agents assigned to this task
- **Documents** — Markdown files, notes, specs
- **Workflows** — FlowSpec `.flow` files that orchestrate bots
- **Diagrams** — Mermaid `.mmd` files

Everything in a workspace lives in a single directory on disk. All bots in the workspace share access to these files.

## How to Use This Workspace

1. Click on the **helper** bot in this workspace to start chatting
2. Browse the files in the tab bar above — each file is a canvas
3. Create new files by adding them to the workspace directory

## Key Concepts

- **Global bots** live in `bots.yaml` and are available everywhere
- **Workspace bots** are defined in `workspace.yaml` and scoped to this workspace
- **Canvases** are just files on disk — `.md`, `.flow`, `.yaml`, `.txt`, images
- **Slug** — the directory name (e.g. `getting-started`) is the workspace identifier
