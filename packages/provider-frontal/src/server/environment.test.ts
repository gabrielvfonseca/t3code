import { assert, describe, it } from "@effect/vitest";

import { makeFrontalEnvironment } from "./environment.ts";

describe("Frontal process environment", () => {
  it("removes ambient provider credentials before applying instance values", () => {
    const environment = makeFrontalEnvironment(
      {
        PATH: "/bin",
        KEEP_FOR_CLI: "yes",
        FRONTAL_API_KEY: "ambient-secret",
        OPENAI_API_KEY: "ambient-openai-secret",
        AWS_PROFILE: "ambient-profile",
      },
      [
        { name: "FRONTAL_API_KEY", value: "instance-secret" },
        { name: "FRONTAL_BASE_URL", value: "https://frontal.example/v1" },
      ],
    );

    assert.deepStrictEqual(environment, {
      PATH: "/bin",
      KEEP_FOR_CLI: "yes",
      FRONTAL_API_KEY: "instance-secret",
      FRONTAL_BASE_URL: "https://frontal.example/v1",
    });
  });

  it("does not turn unresolved secret references into child-process variables", () => {
    const environment = makeFrontalEnvironment(
      { PATH: "/bin", FRONTAL_API_KEY: "ambient-secret" },
      [{ name: "FRONTAL_API_KEY", value: undefined }],
    );

    assert.deepStrictEqual(environment, { PATH: "/bin" });
  });
});
