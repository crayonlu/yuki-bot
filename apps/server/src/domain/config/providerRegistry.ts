import type { ProviderPreset } from "@bot/shared";

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o-mini", "gpt-4.1-mini"]
  },
];

export const findProviderById = (id: string) =>
  PROVIDER_PRESETS.find((provider) => provider.id === id);
