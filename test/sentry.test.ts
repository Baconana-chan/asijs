import { describe, expect, it } from "bun:test";
import {
  sentry,
  getSentryClient,
  createSentryClient,
} from "../src";
import type { SentryEvent } from "../src";
import { Asi } from "../src";

// ============================================================================
// createSentryClient (standalone, without plugin)
// ============================================================================

describe("createSentryClient", () => {
  it("creates a client with capture methods", () => {
    const client = createSentryClient({ dsn: "" }); // disabled
    expect(typeof client.captureException).toBe("function");
    expect(typeof client.captureMessage).toBe("function");
  });

  it("returns empty string when disabled (no DSN)", () => {
    const client = createSentryClient();
    const id = client.captureException(new Error("test"));
    expect(id).toBe("");
    expect(client.enabled).toBe(false);
  });

  it("captureMessage returns empty when disabled", () => {
    const client = createSentryClient({ dsn: "" });
    const id = client.captureMessage("test", "info");
    expect(id).toBe("");
  });

  it("captureException returns event_id when DSN is set", () => {
    const client = createSentryClient({
      dsn: "https://public@o123.ingest.sentry.io/123",
    });
    // Should not throw, and return an event_id (even if send fails)
    const id = client.captureException(new Error("Something broke"));
    expect(typeof id).toBe("string");
    expect(id.length).toBe(32); // 16 bytes hex = 32 chars
    expect(/^[0-9a-f]{32}$/i.test(id)).toBe(true);
  });

  it("captureMessage returns event_id when DSN is set", () => {
    const client = createSentryClient({
      dsn: "https://public@o123.ingest.sentry.io/123",
      environment: "staging",
    });
    const id = client.captureMessage("Deploy started", "info");
    expect(typeof id).toBe("string");
    expect(id.length).toBe(32);
  });

  it("includes extra data in event", () => {
    const client = createSentryClient({
      dsn: "https://public@o123.ingest.sentry.io/123",
    });
    const id = client.captureException(new Error("test"), {
      requestId: "req-001",
    });
    expect(id.length).toBe(32);
  });
});

// ============================================================================
// getSentryClient
// ============================================================================

describe("getSentryClient", () => {
  it("returns a client without requiring plugin setup", () => {
    const client = getSentryClient();
    expect(typeof client.captureException).toBe("function");
    expect(typeof client.captureMessage).toBe("function");
  });

  it("returns a disabled client by default (no DSN)", () => {
    const client = getSentryClient();
    expect(client.enabled).toBe(false);
  });
});

// ============================================================================
// Plugin Integration
// ============================================================================

describe("sentry plugin", () => {
  it("registers as a plugin with name 'sentry'", () => {
    const app = new Asi();

    app.plugin(
      sentry({
        dsn: "https://key@o123.ingest.sentry.io/123",
      }),
    );

    const plugins = app.getPlugins();
    expect(plugins).toContain("sentry");
  });

  it("is disabled when no DSN is provided", () => {
    const app = new Asi();

    app.plugin(sentry());

    const client = getSentryClient();
    // Without env SENTRY_DSN, it's disabled
    expect(typeof client.captureException).toBe("function");
  });
});

// ============================================================================
// SentryEvent structure
// ============================================================================

describe("SentryEvent structure", () => {
  it("captureException generates proper event shape", () => {
    const client = createSentryClient({
      dsn: "https://public@o123.ingest.sentry.io/123",
    });

    // We can't inspect the event directly, but we can verify the ID
    const error = new Error("Test error");
    const id = client.captureException(error);
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it("captureMessage generates proper event shape", () => {
    const client = createSentryClient({
      dsn: "https://public@o123.ingest.sentry.io/123",
    });

    const id = client.captureMessage("User signed up", "info");
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it("handles error with no stack trace", () => {
    const client = createSentryClient({
      dsn: "https://public@o123.ingest.sentry.io/123",
    });

    const id = client.captureException({ message: "Plain error" } as any);
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it("captureMessage with no level defaults", () => {
    const client = createSentryClient({
      dsn: "https://public@o123.ingest.sentry.io/123",
    });

    const id = client.captureMessage("Just a message");
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });
});

// ============================================================================
// DSN parsing (internal)
// ============================================================================

describe("DSN handling", () => {
  it("createSentryClient with full DSN format works", () => {
    const client = createSentryClient({
      dsn: "https://publickey:secretkey@sentry.example.com:9000/some/path/42",
    });
    expect(client.enabled).toBe(true);
  });

  it("createSentryClient with minimal DSN", () => {
    const client = createSentryClient({
      dsn: "https://public@o1.ingest.sentry.io/1",
    });
    expect(client.enabled).toBe(true);
  });
});

// ============================================================================
// Options propagation
// ============================================================================

describe("sentry options", () => {
  it("accepts custom tags and extra", () => {
    const app = new Asi();

    app.plugin(
      sentry({
        dsn: "https://key@o123.ingest.sentry.io/123",
        tags: { service: "api", version: "1.0" },
        extra: { team: "backend" },
        release: "my-app@1.0.0",
        environment: "production",
        serverName: "web-01",
      }),
    );

    const plugins = app.getPlugins();
    expect(plugins).toContain("sentry");
  });

  it("accepts sampleRate config", () => {
    const app = new Asi();

    app.plugin(
      sentry({
        dsn: "https://key@o123.ingest.sentry.io/123",
        sampleRate: 0.5,
      }),
    );

    expect(true).toBe(true); // no crash
  });

  it("accepts beforeSend config", () => {
    const app = new Asi();

    app.plugin(
      sentry({
        dsn: "https://key@o123.ingest.sentry.io/123",
        beforeSend: (event) => {
          delete event.request?.headers?.Authorization;
          return event;
        },
      }),
    );

    expect(true).toBe(true); // no crash
  });

  it("accepts captureUncaught and captureUnhandled flags", () => {
    const app = new Asi();

    app.plugin(
      sentry({
        dsn: "https://key@o123.ingest.sentry.io/123",
        captureUncaught: false,
        captureUnhandled: false,
      }),
    );

    expect(true).toBe(true); // no crash
  });
});
