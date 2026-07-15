import { describe, it, expect } from "bun:test";
import {
  Asi,
  Module,
  Injectable,
  createContainerFromModule,
  modulePlugin,
  type DIContainer,
} from "../src";

@Injectable()
class LoggerService {
  logs: string[] = [];

  log(message: string): void {
    this.logs.push(message);
  }
}

@Injectable()
class UsersService {
  static inject = [LoggerService];

  constructor(private logger: LoggerService) {}

  all(): string[] {
    this.logger.log("users.all");
    return ["alice", "bob"];
  }
}

@Module({
  providers: [LoggerService, UsersService],
})
class UsersModule {}

describe("DI / Module decorators", () => {
  it("createContainerFromModule() should resolve class providers with dependencies", async () => {
    const container = createContainerFromModule(UsersModule);

    const users = await container.resolve<UsersService>(UsersService);
    const logger = await container.resolve<LoggerService>(LoggerService);

    expect(users.all()).toEqual(["alice", "bob"]);
    expect(logger.logs).toEqual(["users.all"]);
  });

  it("should resolve value/factory providers", async () => {
    @Module({
      providers: [
        { provide: "prefix", useValue: "hello" },
        {
          provide: "message",
          useFactory: (prefix: string) => `${prefix}-world`,
          inject: ["prefix"],
        },
      ],
    })
    class FactoryModule {}

    const container = createContainerFromModule(FactoryModule);
    const message = await container.resolve<string>("message");
    expect(message).toBe("hello-world");
  });

  it("modulePlugin() should expose container in app.state and ctx.store", async () => {
    const app = new Asi();
    await app.plugin(modulePlugin(UsersModule));

    const root = app.state<DIContainer>("di");
    expect(root).toBeDefined();

    app.get("/users", async (ctx) => {
      const requestContainer = ctx.store.di as DIContainer;
      const users = await requestContainer.resolve<UsersService>(UsersService);
      return users.all();
    });

    const res = await app.handle(new Request("http://localhost/users"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(["alice", "bob"]);
  });

  it("modulePlugin({ isolated: true }) should create per-request containers", async () => {
    let created = 0;

    @Injectable()
    class RequestIdService {
      id = ++created;
    }

    @Module({
      providers: [RequestIdService],
    })
    class IsolatedModule {}

    const app = new Asi();
    await app.plugin(modulePlugin(IsolatedModule, { isolated: true }));

    app.get("/id", async (ctx) => {
      const requestContainer = ctx.store.di as DIContainer;
      const svc = await requestContainer.resolve<RequestIdService>(
        RequestIdService,
      );
      return { id: svc.id };
    });

    const res1 = await app.handle(new Request("http://localhost/id"));
    const res2 = await app.handle(new Request("http://localhost/id"));

    const body1 = await res1.json();
    const body2 = await res2.json();

    expect(body1.id).not.toBe(body2.id);
  });
});

