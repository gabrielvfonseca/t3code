import { type CustomModelSetting, type ServerProviderModel } from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as ChildProcess from "effect/process/ChildProcess";
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import {
  buildServerProvider,
  isCommandMissingCause,
  parseCliVersionResult,
  providerModelsFromSettings,
  providerProbeEnvironment,
  resolveProviderProbeTimeoutMs,
  spawnAndCollect,
  type ServerProviderDraft,
} from "@t3tools/provider-core/server/snapshotProbe";
import type { FrontalSettings } from "../settings.ts";
import { FRONTAL_PROVIDER } from "./adapter.ts";

const MODEL_CAPABILITIES = createModelCapabilities({ optionDescriptors: [] });
const DEFAULT_MODEL: ServerProviderModel = {
  slug: "default",
  name: "Frontal Code default",
  isCustom: false,
  capabilities: MODEL_CAPABILITIES,
};
const PRESENTATION = {
  displayName: "Frontal Code",
  showInteractionModeToggle: false,
  supportedRuntimeModes: ["approval-required", "auto-accept-edits", "full-access"],
  reportsContextWindow: false,
} as const;

function models(settings: FrontalSettings): ReadonlyArray<ServerProviderModel> {
  return providerModelsFromSettings(
    [DEFAULT_MODEL],
    settings.customModels as ReadonlyArray<CustomModelSetting>,
    MODEL_CAPABILITIES,
  );
}

function snapshot(
  settings: FrontalSettings,
  checkedAt: string,
  probe: Parameters<typeof buildServerProvider>[0]["probe"],
): ServerProviderDraft {
  return buildServerProvider({
    driver: FRONTAL_PROVIDER,
    presentation: PRESENTATION,
    enabled: settings.enabled,
    checkedAt,
    models: models(settings),
    probe,
  });
}

export const buildInitialFrontalProviderSnapshot = (
  settings: FrontalSettings,
): Effect.Effect<ServerProviderDraft> =>
  Effect.map(DateTime.now, (now) =>
    snapshot(settings, DateTime.formatIso(now), {
      installed: settings.enabled,
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      message: settings.enabled
        ? "Checking Frontal Code CLI availability..."
        : "Frontal Code is disabled in T3 Code settings.",
    }),
  );

const runVersion = Effect.fn("FrontalProviderStatus.runVersion")(function* (
  settings: FrontalSettings,
  environment: NodeJS.ProcessEnv,
) {
  const command = settings.binaryPath || "frontal-code";
  const resolved = yield* resolveSpawnCommand(command, ["--version"], { env: environment });
  return yield* spawnAndCollect(
    command,
    ChildProcess.make(resolved.command, resolved.args, {
      env: environment,
      shell: resolved.shell,
    }),
  );
});

export const checkFrontalProviderStatus = Effect.fn("checkFrontalProviderStatus")(function* (
  settings: FrontalSettings,
  environment: NodeJS.ProcessEnv,
): Effect.fn.Return<ServerProviderDraft, never, ChildProcessSpawner.ChildProcessSpawner> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  if (!settings.enabled) {
    return snapshot(settings, checkedAt, {
      installed: false,
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      message: "Frontal Code is disabled in T3 Code settings.",
    });
  }

  const result = yield* runVersion(settings, providerProbeEnvironment(environment)).pipe(
    Effect.timeoutOption(resolveProviderProbeTimeoutMs("frontal", 10_000, environment)),
    Effect.result,
  );
  if (Result.isFailure(result)) {
    const missing = isCommandMissingCause(result.failure);
    return snapshot(settings, checkedAt, {
      installed: !missing,
      version: null,
      status: "error",
      auth: { status: "unknown" },
      message: missing
        ? "Frontal Code is not installed or not on PATH. Set its binary path in provider settings."
        : "Failed to run `frontal-code --version`.",
    });
  }
  if (Option.isNone(result.success)) {
    return snapshot(settings, checkedAt, {
      installed: true,
      version: null,
      status: "error",
      auth: { status: "unknown" },
      message: "Frontal Code is installed but timed out while running `--version`.",
    });
  }
  const versionResult = result.success.value;
  const version = parseCliVersionResult(versionResult);
  if (versionResult.code !== 0) {
    return snapshot(settings, checkedAt, {
      installed: true,
      version,
      status: "error",
      auth: { status: "unknown" },
      message: "Frontal Code is installed but its version command failed.",
    });
  }
  return snapshot(settings, checkedAt, {
    installed: true,
    version,
    status: "ready",
    auth: { status: "unknown" },
    message: "Frontal Code is installed. Authentication is checked when a turn starts.",
  });
});
