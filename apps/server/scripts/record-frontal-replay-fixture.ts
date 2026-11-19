// @effect-diagnostics nodeBuiltinImport:off globalConsole:off
// Records the currently supported one-shot Frontal surface. It intentionally captures process
// boundaries rather than inventing streamed tool frames that Frontal's JSON mode does not emit.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

const valueAfter = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
};

const scenario = valueAfter("--scenario") ?? "simple";
const prompt = valueAfter("--prompt") ?? "Reply with exactly: frontal replay ok";
const binary = process.env.T3_FRONTAL_BIN ?? "frontal-code";
const model = process.env.T3_FRONTAL_REPLAY_MODEL;
const version = process.env.T3_FRONTAL_REPLAY_VERSION ?? "unknown";
const output = NodePath.resolve(
  valueAfter("--out") ??
    `src/orchestration-v2/testkit/fixtures/${scenario}/frontal_transcript.ndjson`,
);
const args = ["--output-format", "json", ...(model ? ["--model", model] : []), "prompt", prompt];

const result = await new Promise<{
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}>((resolveResult, reject) => {
  const child = NodeChildProcess.spawn(binary, args, { stdio: ["pipe", "pipe", "pipe"] });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  child.once("error", reject);
  child.once("close", (code, signal) =>
    resolveResult({
      code,
      signal,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
    }),
  );
  child.stdin.end();
});

const entries = [
  {
    type: "transcript_start",
    provider: "frontal",
    protocol: "one-shot-json",
    version,
    scenario,
    metadata: {
      generatedBy: "record-frontal-replay-fixture",
      model: model ?? "default",
    },
  },
  { type: "stdout", value: result.stdout },
  { type: "stderr", value: result.stderr },
  { type: "process_exit", code: result.code, signal: result.signal },
];
await NodeFSP.mkdir(NodePath.dirname(output), { recursive: true });
await NodeFSP.writeFile(output, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
console.log(`Recorded Frontal transcript at ${output}`);
