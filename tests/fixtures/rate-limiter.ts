import { RateLimiterDurableObject } from '../../src/durable-objects/rate-limiter';

class TestStorage implements Pick<DurableObjectStorage, 'transaction'> {
  private value: unknown;
  private queue = Promise.resolve();

  transaction<T>(callback: (transaction: DurableObjectTransaction) => Promise<T>): Promise<T> {
    const run = this.queue.then(() => callback({
      get: async <V>() => this.value as V | undefined,
      put: async <V>(_key: string, value: V) => {
        this.value = value;
      },
      delete: async () => {
        this.value = undefined;
        return true;
      },
    } as unknown as DurableObjectTransaction));
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }
}

export function createTestRateLimiterNamespace(): DurableObjectNamespace {
  const objects = new Map<string, RateLimiterDurableObject>();

  return {
    idFromName(name: string): DurableObjectId {
      return { toString: () => name } as DurableObjectId;
    },
    get(id: DurableObjectId): DurableObjectStub {
      const name = id.toString();
      let object = objects.get(name);
      if (!object) {
        object = new RateLimiterDurableObject(
          { storage: new TestStorage() } as unknown as ConstructorParameters<typeof RateLimiterDurableObject>[0],
          {},
        );
        objects.set(name, object);
      }

      return {
        fetch: (input: RequestInfo | URL, init?: RequestInit) => {
          const request = input instanceof Request ? input : new Request(input, init);
          return object!.fetch(request);
        },
      } as DurableObjectStub;
    },
  } as DurableObjectNamespace;
}
