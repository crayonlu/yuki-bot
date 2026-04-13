import type { ImageModelConfig } from "@bot/shared"

export type ImagePresetMode = "sync" | "async"

export type BuiltinImagePreset = {
  id: string
  endpoint: string
  mode: ImagePresetMode
}

export const BUILTIN_IMAGE_PRESETS: BuiltinImagePreset[] = [
  {
    id: "seedream-5.0-lite",
    endpoint: "https://api.ppio.com/v3/seedream-5.0-lite",
    mode: "sync"
  },
  {
    id: "jimeng-3.1",
    endpoint: "https://api.ppio.com/v3/async/jimeng-txt2img-v3.1",
    mode: "async"
  },
  {
    id: "qwen-image-txt2img",
    endpoint: "https://api.ppio.com/v3/async/qwen-image-txt2img",
    mode: "async"
  },
  {
    id: "z-image-turbo",
    endpoint: "https://api.ppio.com/v3/async/z-image-turbo",
    mode: "async"
  },
  {
    id: "z-image-turbo-lora",
    endpoint: "https://api.ppio.com/v3/async/z-image-turbo-lora",
    mode: "async"
  }
]

export const BUILTIN_IMAGE_CONFIGS: ImageModelConfig[] = BUILTIN_IMAGE_PRESETS.map((item) => ({
  id: item.id,
  endpoint: item.endpoint
}))

export const getImagePresetMode = (modelId: string): ImagePresetMode =>
  BUILTIN_IMAGE_PRESETS.find((item) => item.id === modelId)?.mode ?? "sync"
