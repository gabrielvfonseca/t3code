import { assert, describe, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { FrontalSettings } from "../settings.ts";
import { buildFrontalLaunchArgs } from "./launch.ts";

const decodeSettings = Schema.decodeSync(FrontalSettings);
const settings = (overrides: Partial<FrontalSettings> = {}): FrontalSettings =>
  decodeSettings({ ...overrides });

describe("Frontal launch arguments", () => {
  it("does not send T3's default model sentinel to Frontal", () => {
    assert.deepStrictEqual(
      buildFrontalLaunchArgs(settings({ provider: "openai" }), {
        runtimeMode: "approval-required",
        model: "default",
        prompt: "hello",
      }),
      [
        "--output-format",
        "json",
        "--permission-mode",
        "prompt",
        "--provider",
        "openai",
        "prompt",
        "hello",
      ],
    );
  });

  it("passes an explicit model and maps full access to Frontal's native mode", () => {
    assert.deepStrictEqual(
      buildFrontalLaunchArgs(settings(), {
        runtimeMode: "full-access",
        model: "openai/gpt-5",
        prompt: "edit the file",
      }),
      [
        "--output-format",
        "json",
        "--permission-mode",
        "danger-full-access",
        "--model",
        "openai/gpt-5",
        "prompt",
        "edit the file",
      ],
    );
  });

  it("rejects launch arguments that could bypass T3's controls", () => {
    assert.throws(
      () =>
        buildFrontalLaunchArgs(settings({ launchArgs: "--model=unsafe" }), {
          runtimeMode: "approval-required",
          model: "default",
          prompt: "hello",
        }),
      /may not override T3/,
    );
  });
});
