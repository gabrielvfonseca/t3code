import {
  CustomModelSetting,
  makeBinaryPathSetting,
  makeProviderSettingsSchema,
  TrimmedString,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const FrontalSettings = makeProviderSettingsSchema(
  {
    enabled: Schema.Boolean.pipe(
      Schema.withDecodingDefault(Effect.succeed(false)),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
    binaryPath: makeBinaryPathSetting("frontal-code").pipe(
      Schema.annotateKey({
        title: "Binary path",
        description: "Path to the Frontal Code CLI (frontal-code or code).",
        providerSettingsForm: { placeholder: "frontal-code", clearWhenEmpty: "omit" },
      }),
    ),
    homePath: TrimmedString.pipe(
      Schema.withDecodingDefault(Effect.succeed("")),
      Schema.annotateKey({
        title: "Frontal home path",
        description: "Optional isolated FRONTAL_CODE_HOME directory.",
        providerSettingsForm: { placeholder: "~/.frontal-code", clearWhenEmpty: "omit" },
      }),
    ),
    configPath: TrimmedString.pipe(
      Schema.withDecodingDefault(Effect.succeed("")),
      Schema.annotateKey({
        title: "Config path",
        description: "Optional isolated FRONTAL_CODE_CONFIG_HOME directory.",
        providerSettingsForm: { placeholder: "~/.frontal-code", clearWhenEmpty: "omit" },
      }),
    ),
    provider: TrimmedString.pipe(
      Schema.withDecodingDefault(Effect.succeed("")),
      Schema.annotateKey({
        title: "Provider override",
        description: "Optional Frontal provider name, such as anthropic, openai, or xai.",
        providerSettingsForm: { placeholder: "anthropic", clearWhenEmpty: "omit" },
      }),
    ),
    launchArgs: TrimmedString.pipe(
      Schema.withDecodingDefault(Effect.succeed("")),
      Schema.annotateKey({
        title: "Launch arguments",
        description: "Additional safe arguments passed to Frontal Code before each prompt.",
        providerSettingsForm: { clearWhenEmpty: "omit" },
      }),
    ),
    defaultPermissionMode: Schema.Literals([
      "read-only",
      "workspace-write",
      "prompt",
      "danger-full-access",
    ]).pipe(
      Schema.withDecodingDefault(Effect.succeed("prompt" as const)),
      Schema.annotateKey({
        title: "Default permission mode",
        description: "The native Frontal sandbox used for one-shot turns.",
        providerSettingsForm: {
          control: "select",
          options: [
            { value: "prompt", label: "Prompt (safe default)" },
            { value: "read-only", label: "Read only" },
            { value: "workspace-write", label: "Workspace write" },
            { value: "danger-full-access", label: "Danger full access" },
          ],
        },
      }),
    ),
    customModels: Schema.Array(CustomModelSetting).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
  },
  {
    order: [
      "binaryPath",
      "homePath",
      "configPath",
      "provider",
      "launchArgs",
      "defaultPermissionMode",
    ],
  },
);

export type FrontalSettings = typeof FrontalSettings.Type;
