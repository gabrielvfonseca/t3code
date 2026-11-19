import { assert, describe, it } from "@effect/vitest";

import { frontalPermissionMode, parseFrontalJsonOutput, renderFrontalPrompt } from "./protocol.ts";

describe("Frontal JSON protocol", () => {
  it("parses the final one-shot summary", () => {
    assert.deepStrictEqual(
      parseFrontalJsonOutput(
        JSON.stringify({
          message: "Done",
          model: "claude-sonnet",
          iterations: 2,
          usage: { input_tokens: 4, output_tokens: 7 },
        }),
      ),
      {
        message: "Done",
        model: "claude-sonnet",
        iterations: 2,
        usage: { input_tokens: 4, output_tokens: 7 },
      },
    );
  });

  it("rejects output without a final message", () => {
    assert.throws(() => parseFrontalJsonOutput('{"tool_uses":[]}'), /did not contain a message/);
  });

  it("maps T3 modes without claiming live approvals", () => {
    assert.strictEqual(frontalPermissionMode("approval-required", "danger-full-access"), "prompt");
    assert.strictEqual(frontalPermissionMode("auto-accept-edits", "prompt"), "workspace-write");
    assert.strictEqual(frontalPermissionMode("full-access", "read-only"), "danger-full-access");
  });

  it("renders bounded-session history as synthetic prompt context", () => {
    assert.strictEqual(
      renderFrontalPrompt(
        [
          { role: "user", text: "Hi" },
          { role: "assistant", text: "Hello" },
        ],
        [{ key: "workspace", text: "/repo" }],
        "Continue",
      ),
      "Previous conversation (continue from this context):\nuser: Hi\n\nassistant: Hello\n\nT3 context:\nworkspace: /repo\n\nContinue",
    );
  });
});
