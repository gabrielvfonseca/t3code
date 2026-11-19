export interface FrontalJsonSummary {
  readonly message: string;
  readonly model?: string;
  readonly iterations?: number;
  readonly usage?: {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
    readonly cache_creation_input_tokens?: number;
    readonly cache_read_input_tokens?: number;
  };
  readonly estimated_cost?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function parseFrontalJsonOutput(stdout: string): FrontalJsonSummary {
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error("Frontal Code returned no JSON output.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (cause) {
    throw new Error("Frontal Code returned invalid JSON output.", { cause });
  }
  if (!isRecord(parsed) || typeof parsed.message !== "string") {
    throw new Error("Frontal Code JSON output did not contain a message.");
  }
  return parsed as unknown as FrontalJsonSummary;
}

export function frontalPermissionMode(
  runtimeMode: "approval-required" | "auto-accept-edits" | "auto" | "full-access",
  configured: "read-only" | "workspace-write" | "prompt" | "danger-full-access",
): "read-only" | "workspace-write" | "prompt" | "danger-full-access" {
  if (runtimeMode === "approval-required") return "prompt";
  if (runtimeMode === "auto-accept-edits") return "workspace-write";
  if (runtimeMode === "full-access") return "danger-full-access";
  return configured;
}

export function renderFrontalPrompt(
  history: ReadonlyArray<{ readonly role: "user" | "assistant"; readonly text: string }>,
  context: ReadonlyArray<{ readonly key: string; readonly text: string }> | undefined,
  message: string,
): string {
  const sections: string[] = [];
  if (history.length > 0) {
    sections.push(
      "Previous conversation (continue from this context):\n" +
        history.map((entry) => `${entry.role}: ${entry.text}`).join("\n\n"),
    );
  }
  if (context && context.length > 0) {
    sections.push(
      "T3 context:\n" + context.map((entry) => `${entry.key}: ${entry.text}`).join("\n\n"),
    );
  }
  sections.push(message);
  return sections.join("\n\n");
}
