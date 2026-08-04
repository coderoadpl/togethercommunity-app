# Neon gardener

This owner-operated launchd agent stamps a TTL on unexpired `preview/*` branches created by the Neon Vercel integration. Neon deletes those branches after the TTL. The default TTL is 72 hours, and `main` plus `preview/staging` are protected by name.

## Install

Install [Bun](https://bun.sh/) and keep this repository at `~/repositories/together-wt-gardener`. Then create the local environment file:

```sh
mkdir -p "$HOME/.config/neon-gardener"
touch "$HOME/.config/neon-gardener/env"
chmod 600 "$HOME/.config/neon-gardener/env"
```

Add these values to `~/.config/neon-gardener/env`, using a project-scoped API key created in the Neon Console:

```sh
export NEON_API_KEY='replace-with-project-scoped-key'
export NEON_PROJECT_ID='replace-with-project-id'
export TTL_HOURS='72'
export PROTECTED='main,preview/staging'
```

Run a one-off dry run from the repository root:

```sh
DRY_RUN=true tools/neon-gardener/run.sh
```

Install and load the agent:

```sh
mkdir -p "$HOME/Library/LaunchAgents"
cp tools/neon-gardener/com.coderoad.neon-gardener.plist "$HOME/Library/LaunchAgents/"
launchctl load "$HOME/Library/LaunchAgents/com.coderoad.neon-gardener.plist"
```

The agent runs immediately when loaded and every six hours afterward.

## Security

The Neon API key lives **only** in `~/.config/neon-gardener/env`. Never commit it to this repository and never put it in GitHub secrets.
