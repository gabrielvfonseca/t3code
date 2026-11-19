import * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import { tokenizeCliArgs } from "@t3tools/shared/cliArgs";

import type { FrontalSettings } from "../settings.ts";
import { frontalPermissionMode } from "./protocol.ts";

export const FRONTAL_DEFAULT_MODEL = "default";

export function buildFrontalLaunchArgs(
  settings: FrontalSettings,
  input: {
    readonly runtimeMode: ProviderAdapter.ProviderAdapterV2RuntimePolicy["runtimeMode"];
    readonly model: string;
    readonly prompt: string;
  },
): ReadonlyArray<string> {
  const extra = tokenizeCliArgs(settings.launchArgs);
  const reserved = new Set([
    "prompt",
    "--output-format",
    "--permission-mode",
    "--model",
    "--provider",
    "--resume",
    "--dangerously-skip-permissions",
    "--allowedTools",
  ]);
  if (extra.some((arg) => reserved.has(arg) || reserved.has(arg.split("=", 1)[0]!))) {
    throw new Error("Frontal launch arguments may not override T3's prompt or permission flags.");
  }
  return [
    ...extra,
    "--output-format",
    "json",
    "--permission-mode",
    frontalPermissionMode(input.runtimeMode, settings.defaultPermissionMode),
    ...(settings.provider ? ["--provider", settings.provider] : []),
    ...(input.model && input.model !== FRONTAL_DEFAULT_MODEL ? ["--model", input.model] : []),
    "prompt",
    input.prompt,
  ];
}
