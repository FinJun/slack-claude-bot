# slack-claude-bot

Chat with Claude Code directly from Slack. A production-grade Slack bot that manages Claude Code sessions, enabling secure collaboration on coding tasks without leaving Slack.

## Features

- **Session Management** — Start, stop, and monitor Claude Code sessions from Slack with per-user limits
- **Thread-based Conversations** — Each session creates a dedicated thread for focused collaboration
- **Multi-user Support** — Isolated sessions per user with per-user API key management
- **Security-First Design**
  - AES-256-GCM encryption for stored API keys
  - Automatic API key leak detection and revocation
  - Tool execution policies (allow/deny bash, file writes, network requests)
  - Bash command filtering for dangerous patterns
- **Cost & Rate Limiting** — Per-session budget tracking, configurable idle timeouts, rate limiting
- **Interactive Controls** — In-thread buttons to stop sessions, cancel tasks, or view costs
- **Persistent State** — SQLite database for sessions and user credentials

## Prerequisites

- **Node.js** 18.0.0 or later
- **Slack workspace** with admin permissions to create a custom app
- **Anthropic API key** (or existing `claude login` session on the server)

## Quick Start

### 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and click **Create New App**
2. Choose **From scratch**, enter `slack-claude-bot` as the app name, and select your workspace
3. In the app settings:

**Socket Mode:**
- Go to **Socket Mode** (left sidebar) and toggle it **On**
- Copy the generated **App-Level Token** (starts with `xapp-`)

**OAuth Scopes:**
- Go to **OAuth & Permissions** → **Scopes**
- Add these bot token scopes:
  - `chat:write` — Post and update messages
  - `commands` — Handle slash commands
  - `app_mentions:read` — Respond to @mentions
  - `channels:history` — Read channel history (for key leak detection)

**Slash Commands:**
- Go to **Slash Commands** → **Create New Command**
- Create the `/claude` command:
  - Command: `/claude`
  - Request URL: Can be any URL (not used in Socket Mode)
  - Short description: `Manage Claude Code sessions`

**Event Subscriptions:**
- Go to **Event Subscriptions** and toggle **On**
- Request URL: Can be any URL (not used in Socket Mode)
- Subscribe to these bot events:
  - `message.channels` — Messages in channels
  - `message.im` — Direct messages
  - `app_mention` — Bot mentions
- Save

**Install the App:**
- Go to **Install App** (left sidebar)
- Click **Install to Workspace**
- Copy the **Bot User OAuth Token** (starts with `xoxb-`)

4. Go to **Basic Information** and copy the **Signing Secret**

### 2. Configure Environment

Create a `.env` file in the project root (or copy from `.env.example`):

```bash
# Slack App Tokens (from setup above)
SLACK_BOT_TOKEN=xoxb-your-bot-token-here
SLACK_SIGNING_SECRET=your-signing-secret-here
SLACK_APP_TOKEN=xapp-your-app-token-here

# Anthropic API (optional — if empty, uses "claude login" session)
ANTHROPIC_API_KEY=sk-ant-your-api-key

# Session Configuration
MAX_SESSIONS_PER_USER=3
SESSION_IDLE_TIMEOUT_MS=1800000
MAX_BUDGET_USD=5.0
MAX_TURNS=50

# Security
ALLOWED_DIRECTORIES=/home/user/projects,/home/user/experiments
SANDBOX_ENABLED=true

# Logging
LOG_LEVEL=info
```

See [Configuration](#configuration) for detailed variable descriptions.

### 3. Install & Run

```bash
npm install
npm run dev
```

The bot will start in Socket Mode and log:
```
Starting slack-claude-bot
Database initialised
SessionManager initialised
Bolt app started (Socket Mode)
```

Once running, test it in Slack:

```
/claude help
```

## Usage

### Slash Commands

#### `/claude start <project-dir> [description...]`

Start a new Claude session for a project.

```
/claude start /path/to/myproject
/claude start /home/user/api-server "Refactor authentication flow"
```

Creates a new thread with a header showing:
- Session ID
- Project directory
- Description (if provided)
- Current status
- Started time

Claude will begin analyzing the project. Reply in the thread to interact with Claude.

#### `/claude list`

Show all active sessions for you.

```
/claude list
```

Displays a table of sessions with:
- Session ID (copy to clipboard for `/claude stop`)
- Project directory
- Status (active, stopped, error)
- Messages exchanged
- Cost so far

#### `/claude stop <session-id>`

Gracefully stop a session.

```
/claude stop abc-123-def
```

#### `/claude auth <api-key>`

Register your personal Anthropic API key (DM only).

```
/claude auth sk-ant-xxxxxxxxxxxxxxx
```

**Note:** This command only works in DMs for security. If a server-level key is configured, it's used as a fallback, but your personal key takes priority.

#### `/claude whoami`

Show your authentication status and key registration date.

```
/claude whoami
```

Returns:
```
✅ 認証済み (sk-ant-...xxxx) | 登録日: 2026-03-18
```

#### `/claude revoke`

Delete your stored API key and stop all active sessions.

```
/claude revoke
```

#### `/claude help`

Show all available commands and options.

```
/claude help
```

### In-Thread Commands

While chatting in a session thread, mention the bot with these commands:

- `@bot /cancel` — Cancel the current Claude task (interrupt)
- `@bot /cost` — Show token usage and cost so far
- `@bot /history` — Show a summary of the conversation
- `@bot /policy` — Display the current security policy
- `@bot /files` — List files accessed in this session

### Thread Interactions

**Stop Session Button**
- Appears in the thread header and end-of-session message
- Gracefully stops the session

**Cancel Task Button**
- Appears during active processing
- Interrupts the current Claude task

## Architecture

### Directory Structure

```
slack-claude-bot/
├── src/
│   ├── index.ts                    # Entry point & lifecycle management
│   ├── app.ts                      # Slack Bolt app factory
│   ├── config.ts                   # Configuration validation (Zod schema)
│   ├── claude/                     # Claude Code SDK integration
│   │   ├── streaming-client.ts     # SDK client initialization
│   │   ├── message-handler.ts      # Process SDK responses
│   │   └── response-formatter.ts   # Format messages for Slack
│   ├── slack/
│   │   ├── commands/
│   │   │   ├── claude.ts           # /claude command dispatcher
│   │   │   └── auth.ts             # auth, whoami, revoke handlers
│   │   ├── events/
│   │   │   ├── message.ts          # Thread message routing
│   │   │   ├── app-mention.ts      # In-thread @bot commands
│   │   │   └── key-leak-detector.ts # API key exposure detection
│   │   ├── actions/
│   │   │   └── buttons.ts          # Interactive button handlers
│   │   └── formatters/
│   │       ├── blocks.ts           # Slack block formatting
│   │       └── session-info.ts     # Session header formatting
│   ├── sessions/
│   │   ├── slack-session.ts        # Per-thread Claude session
│   │   ├── session-manager.ts      # Global session registry
│   │   ├── session-types.ts        # TypeScript types
│   │   ├── session-lifecycle.ts    # State machine
│   │   └── message-stream.ts       # User input queue
│   ├── security/
│   │   ├── tool-policy.ts          # Tool permission engine
│   │   ├── bash-filter.ts          # Bash command validation
│   │   └── sandbox-config.ts       # SDK sandbox options
│   ├── db/
│   │   ├── database.ts             # SQLite initialization
│   │   ├── migrations/             # Schema migrations
│   │   └── queries/
│   │       ├── sessions.ts         # Session persistence
│   │       └── users.ts            # User & API key storage
│   ├── utils/
│   │   ├── crypto.ts               # AES-256-GCM encryption
│   │   ├── logger.ts               # Structured logging
│   │   ├── errors.ts               # Custom error types
│   │   └── message-splitter.ts     # Slack message size handling
│   └── monitoring/
│       └── rate-limiter.ts         # Global rate limiting
├── tests/                          # Vitest unit tests
├── package.json
├── tsconfig.json
└── README.md
```

### Key Components

**SlackSession** (`src/sessions/slack-session.ts`)
- One session per thread
- Manages the Claude Code SDK query loop
- Buffers user messages via MessageQueue
- Tracks costs and turn count
- Implements idle timeout

**SessionManager** (`src/sessions/session-manager.ts`)
- Global registry of live sessions
- Enforces per-user session limits
- Resolves API keys (per-user or server-level)
- Routes messages to sessions

**MessageHandler** (`src/slack/events/message.ts`)
- Listens for thread messages
- Routes to the appropriate session
- Applies rate limiting

**Key Leak Detector** (`src/slack/events/key-leak-detector.ts`)
- Monitors all messages for `sk-ant-` API keys
- Auto-deletes exposed messages
- DMsthe user to rotate their key
- Auto-revokes stored keys

## Security Model

### API Key Management

- **Per-User Keys:** Users register their own keys via `/claude auth` (DM only), encrypted with AES-256-GCM
- **Server-Level Key:** Optional fallback via `ANTHROPIC_API_KEY` environment variable
- **Default:** If neither is available, Claude CLI session (`claude login`) is used
- **Leak Detection:** Automatic detection of `sk-ant-*` patterns in Slack messages with message deletion and key revocation

### Tool Policy

By default, Claude has restricted permissions:

- **Read Tools** (allowed by default): File reads, codebase exploration, searches
- **Write Tools** (disabled by default): File creation and modification
- **Bash Tool** (disabled by default): Command execution
- **Network Tools** (allowed): Web searches and API calls

Override via the `permissionMode` option in session creation or configure in `src/security/sandbox-config.ts`.

### Bash Filtering

When bash is enabled, commands are validated against:

1. **Always-blocked patterns:**
   - Fork bombs
   - Catastrophic deletes (`rm -rf /`)
   - Disk formatting (`mkfs`, `dd`)
   - Kernel/boot overwrites

2. **Configurable blocks:**
   - Sudo/su usage
   - Sensitive path access (`/etc/shadow`, `/root/`, `~/.ssh/`, etc.)
   - Custom regex patterns

3. **Allowlist mode:** If configured, only allow commands matching specific patterns

### Encryption

- **Algorithm:** AES-256-GCM
- **Key:** 32-byte key from `ENCRYPTION_KEY` (auto-generated if not set)
- **Storage:** Encrypted data + IV + auth tag stored in SQLite
- **Decryption:** Only occurs when resolving API keys for sessions

## Configuration

### Environment Variables

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `SLACK_BOT_TOKEN` | string | **required** | Bot User OAuth Token (`xoxb-*`) |
| `SLACK_SIGNING_SECRET` | string | **required** | App Signing Secret |
| `SLACK_APP_TOKEN` | string | **required** | App-Level Token (`xapp-*`) |
| `ANTHROPIC_API_KEY` | string | `''` | Optional server-level API key fallback |
| `ENCRYPTION_KEY` | string | auto-generated | 64-char hex AES-256 key for API key encryption |
| `MAX_SESSIONS_PER_USER` | number | `3` | Max active sessions per user |
| `SESSION_IDLE_TIMEOUT_MS` | number | `1800000` | 30 minutes of inactivity before auto-stop |
| `MAX_BUDGET_USD` | number | `5.0` | Per-session cost limit (stops session if exceeded) |
| `MAX_TURNS` | number | `50` | Max conversation turns per session |
| `ALLOWED_DIRECTORIES` | string | `''` | Comma-separated whitelist of project directories |
| `SANDBOX_ENABLED` | string | `'true'` | Enable Claude Code sandbox restrictions |
| `LOG_LEVEL` | string | `'info'` | Log level: `debug`, `info`, `warn`, `error` |

### Example Configuration for Development

```bash
SLACK_BOT_TOKEN=xoxb-your-dev-token
SLACK_SIGNING_SECRET=your-dev-secret
SLACK_APP_TOKEN=xapp-your-dev-token
ANTHROPIC_API_KEY=sk-ant-your-key
MAX_SESSIONS_PER_USER=5
SESSION_IDLE_TIMEOUT_MS=3600000
MAX_BUDGET_USD=10.0
LOG_LEVEL=debug
```

## Deployment

### Production with PM2

1. **Build the project:**
   ```bash
   npm run build
   ```

2. **Install PM2 globally:**
   ```bash
   npm install -g pm2
   ```

3. **Create `ecosystem.config.js`:**
   ```javascript
   module.exports = {
     apps: [
       {
         name: 'slack-claude-bot',
         script: './dist/index.js',
         instances: 1,
         exec_mode: 'fork',
         env: {
           NODE_ENV: 'production',
           LOG_LEVEL: 'info',
         },
         env_file: '.env',
         error_file: './logs/error.log',
         out_file: './logs/out.log',
         log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
         max_memory_restart: '512M',
         autorestart: true,
         watch: false,
       },
     ],
   };
   ```

4. **Start the app:**
   ```bash
   pm2 start ecosystem.config.js
   pm2 save
   pm2 startup
   ```

5. **Monitor:**
   ```bash
   pm2 logs slack-claude-bot
   pm2 status
   ```

### Docker Deployment

Create a `Dockerfile`:

```dockerfile
FROM node:22-alpine

WORKDIR /app

# Copy source and dependencies
COPY package*.json ./
RUN npm ci --only=production

COPY . .

# Build TypeScript
RUN npm run build

# Create logs directory
RUN mkdir -p logs

# Run with socket mode (no external HTTP server needed)
CMD ["node", "dist/index.js"]
```

Build and run:

```bash
docker build -t slack-claude-bot .
docker run --env-file .env slack-claude-bot
```

## Development

### Build

```bash
npm run build
```

Compiles TypeScript to `dist/` with source maps.

### Development Mode

```bash
npm run dev
```

Runs the app with auto-reload using `tsx watch`.

### Tests

```bash
npm test
npm run test:watch
```

Runs Vitest unit tests.

### Linting

```bash
npm run lint
```

Runs ESLint on `src/`.

### Type Checking

```bash
npm run typecheck
```

Runs TypeScript compiler in no-emit mode.

## Troubleshooting

### Bot Not Responding

1. Check Socket Mode is enabled in Slack app settings
2. Verify tokens are correct (copy-paste, not truncated)
3. Check logs: `npm run dev` should show connection messages
4. Ensure the Slack app has `chat:write` and `commands` scopes

### API Key Not Working

1. Verify key format (should start with `sk-ant-`)
2. Use `/claude whoami` to confirm registration
3. Check server logs for decryption errors
4. Ensure `ENCRYPTION_KEY` is consistent (if restarting the app)

### Session Not Creating

1. Check database: `ls -la data/`
2. Verify `ALLOWED_DIRECTORIES` is set (if required)
3. Check project directory exists and is readable
4. Look for per-user session limit: `/claude list` shows active sessions

### High Costs

1. Use `/claude list` to see cost breakdown per session
2. Set `MAX_BUDGET_USD` to a lower value to auto-stop expensive sessions
3. Check `MAX_TURNS` — too high allows runaway conversations

## License

MIT

---

**Questions?** Check the source code comments for detailed explanations of each module, or open an issue on the repository.
