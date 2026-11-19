const FRONTAL_CREDENTIAL_ENVIRONMENT = [
  "FRONTAL_API_KEY",
  "FRONTAL_BASE_URL",
  "FRONTAL_AUTH_TOKEN",
  "OPENAI_API_KEY",
  "XAI_API_KEY",
  "XAI_BASE_URL",
  "BEDROCK_API_KEY",
  "BEDROCK_BASE_URL",
  "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_BASE_URL",
  "OLLAMA_BASE_URL",
  "OLLAMA_MODEL",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_PROFILE",
  "AWS_REGION",
] as const;

export function makeFrontalEnvironment(
  base: NodeJS.ProcessEnv,
  configured: ReadonlyArray<{ readonly name: string; readonly value: unknown }>,
): NodeJS.ProcessEnv {
  const environment = { ...base };
  for (const name of FRONTAL_CREDENTIAL_ENVIRONMENT) delete environment[name];
  for (const variable of configured) {
    if (typeof variable.value === "string") environment[variable.name] = variable.value;
  }
  return environment;
}
