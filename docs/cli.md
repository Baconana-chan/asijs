# CLI Reference

AsiJS ships a single CLI binary (`asi` / `asijs`). Install it with `bunx asijs <command>` or run it from a project's `node_modules/.bin`.

```bash
bunx asijs <command> [options]
```

All commands support `--help` / `-h`. Global flags: `--version` / `-v` prints the installed version.

---

## create

Create a new AsiJS project. Also available as `init` / `new`, and through `bun create asijs <name>`.

```bash
bunx asijs create <project-name> [options]
bun create asijs <project-name> [options]
```

| Option | Description |
|---|---|
| `-t, --template <name>` | Use a specific template (see below) |
| `-h, --help` | Show help |

**Templates:**

| Template | Description |
|---|---|
| `minimal` | Minimal setup with basic routing |
| `api` | REST API with validation, CORS, and OpenAPI |
| `full` | Full-stack app (JSX, WebSocket, scheduler, and more) |

**Examples:**

```bash
bunx asijs create my-app
bunx asijs create my-api -t api
```

---

## dev

Start workspace dev mode with hot-reload.

```bash
bunx asijs dev [options]
```

| Option | Description |
|---|---|
| `--inspect` | Show DevTools links (dashboard, REPL, analyze, doctor) |
| `-p, --port <port>` | Base port for sub-apps (default: `3000`) |

---

## build

Production build for SPA/SSR apps — bundles client and server.

```bash
bunx asijs build [options]
```

| Option | Description |
|---|---|
| `--client <path>` | Client entry point (default: `src/client.tsx`) |
| `--server <path>` | Server entry point (default: `src/index.ts`) |
| `--outdir <path>` | Output directory (default: `dist`) |
| `--no-minify` | Skip minification |

**Example:**

```bash
bunx asijs build --client src/client.tsx --outdir build
```

---

## inspect

Inspect the project: routes, plugins, middleware, bundle size.

```bash
bunx asijs inspect [options]
```

| Option | Description |
|---|---|
| `-r, --routes` | Show routes table |
| `-p, --plugins` | Show plugins and middleware |
| `-s, --size` | Show bundle size analysis |
| `-v, --verbose` | Detailed route info (handler, line number) |

**Examples:**

```bash
bunx asijs inspect
bunx asijs inspect --routes --verbose
bunx asijs inspect --plugins
bunx asijs inspect --size
```

---

## generate

Code generation scaffold. Also available as `g`.

```bash
bunx asijs generate <type> <name>
```

| Type | Description |
|---|---|
| `route <path>` | Generate a new route file in `src/routes/` |
| `action <name>` | Generate a server action in `src/actions/` |
| `plugin <name>` | Generate a plugin scaffold in `src/plugins/` |
| `app <name>` | Generate a sub-app |

---

## migrate

Migrate an existing project from another framework (Elysia / Hono / Fastify).

```bash
bunx asijs migrate <path> [options]
```

| Option | Description |
|---|---|
| `-f, --from <framework>` | Source framework (`elysia` \| `hono` \| `fastify`) |
| `--dry-run` | Show changes without writing |
| `-v, --verbose` | Detailed transformation logs |

**Examples:**

```bash
bunx asijs migrate ./src --from elysia
bunx asijs migrate ./app.ts --from hono --dry-run -v
bunx asijs migrate . --from fastify
```

The CLI auto-detects the framework when `--from` is omitted. See the [Migration Guide](/migration/) for details on the codemod and manual adjustments.

---

## integrate

Auto-detect the framework in a directory and run the migration codemod.

```bash
bunx asijs integrate <path> [options]
```

Accepts the same flags as `migrate`.

---

## template

Install a template into the current directory (without creating a new project).

```bash
bunx asijs template <name>
```

---

## repl

Interactive REPL — create routes, test requests, inspect state.

```bash
bunx asijs repl [options]
```

| Option | Description |
|---|---|
| `-p, --port <port>` | Start test server on port (default: `3001`) |
| `-s, --silent` | Less verbose output |
| `-l, --preload <file>` | Preload a source file |

**Example:**

```bash
bunx asijs repl --port 8080
```

---

## plugin

Manage plugins from the official registry.

```bash
bunx asijs plugin <action> [name] [options]
```

| Action | Description |
|---|---|
| `search [query]` | Search plugins in the official registry |
| `install <name>` | Install a plugin from npm |
| `remove <name>` / `uninstall <name>` | Remove a plugin |
| `list` | List installed plugins |
| `create <name>` | Scaffold a new plugin project |
| `awesome` | Show all available plugins |

**Plugin `create` options:**

| Option | Description |
|---|---|
| `--with-tests, -t` | Include test file template |
| `--desc <text>` | Plugin description |

**Examples:**

```bash
bunx asijs plugin search cors
bunx asijs plugin install cors
bunx asijs plugin create my-plugin --with-tests
bunx asijs plugin list
bunx asijs plugin awesome
```

---

## analyze

Static analysis of the project: dead routes, duplicate middleware, missing validation, bottlenecks, path shadowing.

```bash
bunx asijs analyze [options]
```

Also available as `a`.

| Option | Description |
|---|---|
| `-i, --info` | Include info-level findings (default: off) |
| `--json` | Output as JSON |
| `--cwd <path>` | Analyze a specific directory |

**Example:**

```bash
bunx asijs analyze --info --json
```

---

## doctor

Project diagnostics: config health, dependencies, TypeScript strict mode, security issues, secrets in code.

```bash
bunx asijs doctor [options]
```

| Option | Description |
|---|---|
| `--json` | Output as JSON |
| `--cwd <path>` | Diagnose a specific directory |

---

## upgrade

Check for and apply AsiJS updates, including a breaking-changes codemod.

```bash
bunx asijs upgrade [options]
```

| Option | Description |
|---|---|
| `--dry-run` | Show planned changes without writing |
| `--codemod` | Run breaking-changes codemod after upgrading |
| `--offline` | Skip the npm registry lookup |

**Examples:**

```bash
bunx asijs upgrade --dry-run
bunx asijs upgrade --codemod
```

---

## db

Database layer: migrations, seeding, and a Studio GUI.

```bash
bunx asijs db <action> [options]
```

| Action | Description |
|---|---|
| `migrate` | Apply migrations. `--create "name"` scaffolds a new migration, `--down` rolls back, `--status` shows applied/pending |
| `seed [file]` | Run a seed file |
| `studio` | Start a database Studio GUI (`--port N`, default: `5500`) |

**Shared options:**

| Option | Description |
|---|---|
| `--url <url>` | Connection string (or `DATABASE_URL` env var) |
| `--migrations-dir <dir>` | Migration directory (default: `./migrations`) |

**Examples:**

```bash
bunx asijs db migrate
bunx asijs db migrate --create "add users table"
bunx asijs db migrate --down
bunx asijs db migrate --status
bunx asijs db seed seed.ts
bunx asijs db studio --port 5500
```

---

## Full command summary

| Command | Purpose |
|---|---|
| `create` / `init` / `new` | Create a new project |
| `dev` | Workspace dev mode with hot-reload |
| `build` | Production build (SPA/SSR) |
| `inspect` | Routes, plugins, middleware, bundle size |
| `generate` / `g` | Scaffold routes, actions, plugins, sub-apps |
| `migrate` | Codemod from Elysia / Hono / Fastify |
| `integrate` | Auto-detect framework and migrate |
| `template` | Install a template into the current dir |
| `repl` | Interactive REPL |
| `plugin` | Plugin registry (search/install/remove/list/create) |
| `analyze` / `a` | Static analysis |
| `doctor` | Project diagnostics |
| `upgrade` | Self-update + breaking-changes codemod |
| `db` | Migrations, seeding, Studio GUI |
