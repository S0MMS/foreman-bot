# Welcome to Foreman

You're all set. Every channel in the sidebar is an AI bot — just type a message and it responds.

## Quick Orientation

**General channels** — `#alice`, `#bob`, `#charlie`, `#thought-pad` are general-purpose Claude assistants. Use them for brainstorming, code questions, or anything.

**Model channels** — `#claude`, `#gemini`, `#gpt` give you raw access to each provider's model.

**FlowSpec Tutorial** — `#flowspec-engineer` can help you write multi-bot workflows. Start with:
```
/f run flows/flowspec-tutorial.flow
```

## Useful Commands

| Command | What it does |
|---|---|
| `/f model opus` | Switch this channel to a different model |
| `/f model gemini:gemini-2.5-flash` | Switch to a completely different provider |
| `/f new` | Reset the conversation (fresh start) |
| `/f session` | Show what model and session this channel is using |
| `/f auto-approve off` | Require approval before the bot edits files or runs commands |

## Adding More API Keys

Gemini and OpenAI channels work out of the box if keys were provided during setup. If not, any channel missing a key will tell you how to add one.

## Need Help?

Ask `#flowspec-engineer` how to write workflows, or check the full README in the repo: `README.md`
