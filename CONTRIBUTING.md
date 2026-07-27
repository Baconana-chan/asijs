# Contributing to AsiJS

🎉 First off, thanks for taking the time to contribute!

## Code of Conduct

This project is committed to providing a welcoming and inclusive experience for everyone.

## How Can I Contribute?

### Reporting Bugs

- Check if the bug has already been reported in [Issues](https://github.com/Baconana-chan/asijs/issues)
- Use a clear and descriptive title
- Include steps to reproduce, expected behavior, and actual behavior
- Include code samples and environment details (Bun version, OS, etc.)

### Suggesting Features

- Open an issue with the label `enhancement`
- Explain why the feature would be useful
- Include code examples of how it would work

### Submitting Pull Requests

1. Fork the repo and create your branch from `main`
2. Install dependencies: `bun install`
3. Make your changes
4. Run tests: `bun test`
5. Run typecheck: `bun run typecheck`
6. Make sure all benchmarks still pass: `bun run bench`
7. Submit the PR

## Development Setup

```bash
git clone https://github.com/Baconana-chan/asijs.git
cd asijs
bun install
bun run dev
```

## Project Structure

```
asijs/
├── src/              # Framework source code
│   ├── asi.ts        # Core Asi class
│   ├── router.ts     # Trie/Radix router
│   ├── context.ts    # Request context
│   ├── plugin.ts     # Plugin system
│   ├── plugins/      # Built-in plugins (cors, static)
│   └── ...           # Other modules
├── test/             # Tests (mirrors src/)
├── bench/            # Performance benchmarks
├── packages/         # Sub-packages (VS Code, ESLint, OTel)
├── docs/             # Documentation site (VitePress)
└── examples/         # Example projects
```

## Coding Guidelines

### TypeScript

- Strict mode is enabled — no `any` unless absolutely necessary
- Prefer `interface` over `type` for public APIs
- Use `const` over `let` whenever possible
- Document public exports with JSDoc

### Testing

- Every module in `src/` should have a corresponding test in `test/`
- Use `bun:test` for testing
- Tests should be isolated and not depend on external services
- Aim for >90% coverage on new code

### Plugin Development

See [PLUGIN_DEV_GUIDE.md](PLUGIN_DEV_GUIDE.md) for the complete guide.

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add GPS plugin
fix: handle null body in POST request
docs: update API reference
test: add rate limiter e2e tests
```

## Release Process

1. Update `CHANGELOG.md`
2. Update version in `package.json`
3. Tag the release: `git tag v1.x.x`
4. Push: `git push --tags`
5. CI will auto-publish to npm and JSR

## Questions?

Open a [Discussion](https://github.com/Baconana-chan/asijs/discussions) or ask in the issues.
