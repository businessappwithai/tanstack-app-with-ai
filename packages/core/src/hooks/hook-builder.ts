import type { Hook, HookContext, HookLifecycle } from "../types/hook.types";
import { globalHookRegistry } from "./hook-registry";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class HookBuilder<T = any> {
  private hook: Partial<Hook<T>> = {
    priority: 100,
  };

  forEntity(entityName: string): this {
    this.entityName = entityName;
    return this;
  }

  on(lifecycle: HookLifecycle): this {
    this.hook.lifecycle = lifecycle;
    return this;
  }

  named(name: string): this {
    this.hook.name = name;
    return this;
  }

  withPriority(priority: number): this {
    this.hook.priority = priority;
    return this;
  }

  // matches Hook.execute — see hook.types.ts.
  execute(fn: (context: HookContext<T>) => Promise<void | T>): this {
    this.hook.execute = fn;
    return this;
  }

  register(): void {
    if (!this.entityName || !this.hook.lifecycle || !this.hook.execute) {
      throw new Error("Hook must have entity, lifecycle, and execute function");
    }

    globalHookRegistry.register(this.entityName, this.hook as Hook<T>);
  }

  private entityName?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createHook<T = any>(): HookBuilder<T> {
  return new HookBuilder<T>();
}
