import os from 'node:os';
import { ForgeBridgeError } from '../core/errors.js';
import type { ExecutionProfile, ForgeBridgeConfig } from '../core/config.js';

export type ProcessPriorityPolicy = 'normal' | 'below_normal';

export type EffectiveExecutionPolicy = {
  profile: ExecutionProfile;
  backgroundMode: boolean;
  foregroundAllowed: boolean;
  forceHeadlessBrowser: boolean;
  suppressNotifications: boolean;
  maxParallelJobs: number;
  maxCpuConcurrency: number;
  maxBrowserInstances: number;
  processPriority: ProcessPriorityPolicy;
};

export class ExecutionPolicy {
  readonly #config: ForgeBridgeConfig['execution'];

  constructor(config: ForgeBridgeConfig['execution']) {
    this.#config = config;
  }

  setProfile(profile: ExecutionProfile): void {
    this.#config.profile = profile;
    this.#config.backgroundMode = profile !== 'normal';
  }

  setBackgroundMode(enabled: boolean): void {
    this.#config.backgroundMode = enabled;
    if (enabled && this.#config.profile === 'normal') this.#config.profile = 'background';
    if (!enabled) this.#config.profile = 'normal';
  }

  current(): EffectiveExecutionPolicy {
    const gaming = this.#config.profile === 'gaming';
    const backgroundMode = this.#config.backgroundMode || this.#config.profile !== 'normal';
    return {
      profile: this.#config.profile,
      backgroundMode,
      foregroundAllowed: !backgroundMode && this.#config.profile === 'normal',
      forceHeadlessBrowser: backgroundMode,
      suppressNotifications: gaming,
      maxParallelJobs: gaming ? this.#config.gaming.maxParallelJobs : this.#config.maxParallelJobs,
      maxCpuConcurrency: gaming
        ? this.#config.gaming.maxCpuConcurrency
        : this.#config.maxCpuConcurrency,
      maxBrowserInstances: gaming
        ? this.#config.gaming.maxBrowserInstances
        : this.#config.maxBrowserInstances,
      processPriority: gaming ? this.#config.gaming.processPriority : this.#config.processPriority,
    };
  }

  browserHeadless(configuredHeadless: boolean): boolean {
    return configuredHeadless || this.current().forceHeadlessBrowser;
  }

  applyProcessPriority(processId: number | undefined): void {
    if (!processId || this.current().processPriority !== 'below_normal') return;
    try {
      os.setPriority(processId, os.constants.priority.PRIORITY_BELOW_NORMAL);
    } catch {
      // Priority changes are best-effort because containers and restricted accounts may deny them.
    }
  }
}

export class ResourceGovernor {
  readonly #policy: ExecutionPolicy;
  #activeCpuTasks = 0;

  constructor(policy: ExecutionPolicy) {
    this.#policy = policy;
  }

  acquireCpuSlot(): () => void {
    const limit = this.#policy.current().maxCpuConcurrency;
    if (this.#activeCpuTasks >= limit) {
      throw new ForgeBridgeError(
        'resource_limit',
        `The execution profile allows at most ${limit} concurrent process tasks`,
        { limit, active: this.#activeCpuTasks, profile: this.#policy.current().profile },
        true,
      );
    }
    this.#activeCpuTasks += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#activeCpuTasks = Math.max(0, this.#activeCpuTasks - 1);
    };
  }

  status(): { activeCpuTasks: number; limit: number } {
    return {
      activeCpuTasks: this.#activeCpuTasks,
      limit: this.#policy.current().maxCpuConcurrency,
    };
  }
}
