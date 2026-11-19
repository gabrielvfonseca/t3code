import { ProviderDriverKind } from "@t3tools/contracts";
import { defineProviderClient } from "@t3tools/provider-core/client";

import { FrontalSettings } from "./settings.ts";

export const frontalClient = defineProviderClient({
  driverKind: ProviderDriverKind.make("frontal"),
  label: "Frontal Code",
  featured: false,
  badgeLabel: "Early Access",
  settingsSchema: FrontalSettings,
  environmentFields: [
    {
      name: "FRONTAL_API_KEY",
      label: "Frontal API key",
      description: "Optional. Used by the Frontal gateway when configured.",
      placeholder: "Paste API key",
      sensitive: true,
    },
    {
      name: "FRONTAL_BASE_URL",
      label: "Frontal base URL",
      description: "Optional gateway URL override.",
      placeholder: "https://ai.frontal.dev/v1",
    },
    {
      name: "FRONTAL_AUTH_TOKEN",
      label: "Frontal auth token",
      description: "Optional saved-login token for Anthropic-compatible access.",
      placeholder: "Paste auth token",
      sensitive: true,
    },
    {
      name: "OPENAI_API_KEY",
      label: "OpenAI API key",
      description: "Used when Frontal is configured for OpenAI.",
      placeholder: "Paste API key",
      sensitive: true,
    },
    {
      name: "XAI_API_KEY",
      label: "xAI API key",
      description: "Used when Frontal is configured for xAI.",
      placeholder: "Paste API key",
      sensitive: true,
    },
    {
      name: "XAI_BASE_URL",
      label: "xAI base URL",
      description: "Optional xAI-compatible endpoint override.",
      placeholder: "https://api.x.ai/v1",
    },
    {
      name: "BEDROCK_API_KEY",
      label: "Bedrock API key",
      description: "Used when Frontal is configured for Bedrock-compatible access.",
      placeholder: "Paste API key",
      sensitive: true,
    },
    {
      name: "BEDROCK_BASE_URL",
      label: "Bedrock base URL",
      description: "Optional Bedrock-compatible endpoint override.",
      placeholder: "https://bedrock-runtime...",
    },
    {
      name: "AZURE_OPENAI_API_KEY",
      label: "Azure OpenAI API key",
      description: "Used when Frontal is configured for Azure OpenAI.",
      placeholder: "Paste API key",
      sensitive: true,
    },
    {
      name: "AZURE_OPENAI_BASE_URL",
      label: "Azure OpenAI base URL",
      description: "Optional Azure OpenAI endpoint override.",
      placeholder: "https://...openai.azure.com",
    },
    {
      name: "OLLAMA_BASE_URL",
      label: "Ollama base URL",
      description: "Optional local Ollama endpoint.",
      placeholder: "http://localhost:11434",
    },
    {
      name: "OLLAMA_MODEL",
      label: "Ollama default model",
      description: "Optional model used when Frontal selects Ollama without a model override.",
      placeholder: "llama2",
    },
  ],
  icon: {
    viewBox: "0 0 24 24",
    fill: { light: "#111827", dark: "#F9FAFB" },
    paths: [
      {
        d: "M4 4h4l4 6 4-6h4l-6 8 6 8h-4l-4-6-4 6H4l6-8z",
      },
    ],
  },
});
