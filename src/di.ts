/**
 * Lightweight DI Container + @Module() decorators (Nest-inspired)
 */

import { createPlugin, type AsiPlugin } from "./plugin";

/** A class constructor type. */
export type ClassType<T = unknown> = new (...args: any[]) => T;

/** What a provider can be registered under (class, string or symbol). */
export type InjectionToken<T = unknown> = ClassType<T> | string | symbol;

/** Provider lifetime: singleton (shared) or transient (new per resolve). */
export type ProviderScope = "singleton" | "transient";

/** Provider backed by a pre-built value. */
export interface ValueProvider<T = unknown> {
  provide: InjectionToken<T>;
  useValue: T;
}

/** Provider backed by a class instantiation. */
export interface ClassProvider<T = unknown> {
  provide: InjectionToken<T>;
  useClass: ClassType<T>;
  inject?: InjectionToken[];
  scope?: ProviderScope;
}

/** Provider backed by a factory function. */
export interface FactoryProvider<T = unknown> {
  provide: InjectionToken<T>;
  useFactory: (...deps: unknown[]) => T | Promise<T>;
  inject?: InjectionToken[];
  scope?: ProviderScope;
}

/** Union of all provider forms (value / class / factory). */
export type Provider<T = unknown> =
  | ClassType<T>
  | ValueProvider<T>
  | ClassProvider<T>
  | FactoryProvider<T>;

/** Module metadata (imports, providers, exports). */
export interface ModuleMetadata {
  imports?: ModuleType[];
  providers?: Provider[];
  exports?: InjectionToken[];
}

/** A module is a class with `@Module` metadata. */
export type ModuleType<T = unknown> = ClassType<T>;

/** Decorator options for `@Injectable`. */
export interface InjectableOptions {
  scope?: ProviderScope;
}

interface InjectableMetadata {
  scope?: ProviderScope;
}

type NormalizedProvider = {
  token: InjectionToken;
  scope: ProviderScope;
  kind: "value" | "class" | "factory";
  useValue?: unknown;
  useClass?: ClassType;
  useFactory?: (...deps: unknown[]) => unknown | Promise<unknown>;
  inject?: InjectionToken[];
  instance?: unknown;
  instancePromise?: Promise<unknown>;
};

const moduleMetadata = new WeakMap<ModuleType, ModuleMetadata>();
const injectableMetadata = new WeakMap<ClassType, InjectableMetadata>();

function getInjectTokens(target: ClassType): InjectionToken[] {
  const inject = (target as unknown as { inject?: InjectionToken[] }).inject;
  return Array.isArray(inject) ? inject : [];
}

function normalizeProvider(provider: Provider): NormalizedProvider {
  if (typeof provider === "function") {
    const injectable = injectableMetadata.get(provider);
    return {
      token: provider,
      kind: "class",
      useClass: provider,
      inject: getInjectTokens(provider),
      scope: injectable?.scope ?? "singleton",
    };
  }

  if ("useValue" in provider) {
    return {
      token: provider.provide,
      kind: "value",
      useValue: provider.useValue,
      scope: "singleton",
      instance: provider.useValue,
    };
  }

  if ("useClass" in provider) {
    const injectable = injectableMetadata.get(provider.useClass);
    return {
      token: provider.provide,
      kind: "class",
      useClass: provider.useClass,
      inject: provider.inject ?? getInjectTokens(provider.useClass),
      scope: provider.scope ?? injectable?.scope ?? "singleton",
    };
  }

  const factoryScope = provider.scope ?? "singleton";
  return {
    token: provider.provide,
    kind: "factory",
    useFactory: provider.useFactory,
    inject: provider.inject ?? [],
    scope: factoryScope,
  };
}

/** Dependency injection container — providers, resolution and scopes. */
export class DIContainer {
  private providers = new Map<InjectionToken, NormalizedProvider>();

  register(provider: Provider): this {
    const normalized = normalizeProvider(provider);
    this.providers.set(normalized.token, normalized);
    return this;
  }

  registerMany(providers: Provider[]): this {
    for (const provider of providers) {
      this.register(provider);
    }
    return this;
  }

  has(token: InjectionToken): boolean {
    return this.providers.has(token);
  }

  async resolve<T = unknown>(token: InjectionToken<T>): Promise<T> {
    const provider = this.providers.get(token);
    if (!provider) {
      throw new Error(`DI provider not found for token: ${String(token)}`);
    }

    if (provider.kind === "value") {
      return provider.useValue as T;
    }

    if (provider.scope === "singleton") {
      if (provider.instance !== undefined) {
        return provider.instance as T;
      }

      if (!provider.instancePromise) {
        provider.instancePromise = this.instantiate(provider);
      }

      const instance = await provider.instancePromise;
      provider.instance = instance;
      provider.instancePromise = undefined;
      return instance as T;
    }

    return (await this.instantiate(provider)) as T;
  }

  private async instantiate(provider: NormalizedProvider): Promise<unknown> {
    const deps: unknown[] = [];
    const inject = provider.inject ?? [];

    for (const token of inject) {
      deps.push(await this.resolve(token));
    }

    if (provider.kind === "class") {
      const Target = provider.useClass as ClassType;
      return new Target(...deps);
    }

    return (provider.useFactory as (...deps: unknown[]) => unknown)(...deps);
  }

  clone(): DIContainer {
    const child = new DIContainer();

    for (const [token, provider] of this.providers.entries()) {
      const copy: NormalizedProvider = {
        ...provider,
        instance: provider.kind === "value" ? provider.instance : undefined,
        instancePromise: undefined,
      };
      child.providers.set(token, copy);
    }

    return child;
  }
}

/** `@Module({ imports, providers, exports })` class decorator. */
export function Module(metadata: ModuleMetadata): ClassDecorator {
  return (target) => {
    moduleMetadata.set(target as unknown as ModuleType, metadata);
  };
}

/** `@Injectable({ scope })` class decorator. */
export function Injectable(options: InjectableOptions = {}): ClassDecorator {
  return (target) => {
    injectableMetadata.set(target as unknown as ClassType, {
      scope: options.scope,
    });
  };
}

/** Read `@Module` metadata attached to a class. */
export function getModuleMetadata(target: ModuleType): ModuleMetadata {
  return moduleMetadata.get(target) ?? {};
}

/** Options for creating a DI container (providers, scope defaults). */
export interface CreateContainerOptions {
  providers?: Provider[];
}

/**
 * Build a DI container from a root @Module class.
 * Imports are flattened recursively.
 */
export function createContainerFromModule(
  rootModule: ModuleType,
  options: CreateContainerOptions = {},
): DIContainer {
  const container = new DIContainer();
  const visited = new Set<ModuleType>();

  const loadModule = (moduleClass: ModuleType) => {
    if (visited.has(moduleClass)) return;
    visited.add(moduleClass);

    const metadata = getModuleMetadata(moduleClass);

    if (metadata.imports) {
      for (const imported of metadata.imports) {
        loadModule(imported);
      }
    }

    if (metadata.providers) {
      container.registerMany(metadata.providers);
    }
  };

  loadModule(rootModule);

  if (options.providers?.length) {
    container.registerMany(options.providers);
  }

  return container;
}

/** Options for the DI plugin (state key for the root container). */
export interface ModulePluginOptions {
  /** State key to store root container */
  containerKey?: string;
  /** ctx.store key with per-request container */
  storeKey?: string;
  /** Create isolated container per request */
  isolated?: boolean;
  /** Extra providers merged on top of module providers */
  providers?: Provider[];
  /** Plugin name */
  name?: string;
}

/**
 * Asi plugin for module-based DI.
 */
export function modulePlugin(
  rootModule: ModuleType,
  options: ModulePluginOptions = {},
): AsiPlugin {
  const containerKey = options.containerKey ?? "di";
  const storeKey = options.storeKey ?? "di";
  const isolated = options.isolated ?? false;
  const pluginName = options.name ?? "di:module";

  return createPlugin({
    name: pluginName,
    setup(app) {
      const rootContainer = createContainerFromModule(rootModule, {
        providers: options.providers,
      });

      app.setState(containerKey, rootContainer);

      app.onBeforeHandle((ctx) => {
        ctx.store[storeKey] = isolated ? rootContainer.clone() : rootContainer;
      });
    },
  });
}
