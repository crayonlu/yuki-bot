import type { ImageModelConfig } from "@bot/shared"

export type ImagePresetMode = "sync" | "async"

export type BuiltinImagePreset = {
  id: string
  endpoint: string
  mode: ImagePresetMode
  supportsReferenceImage: boolean
  referenceImageRequired: boolean
}

export const BUILTIN_IMAGE_PRESETS: BuiltinImagePreset[] = [
  {
    id: "seedream-5.0-lite",
    endpoint: "https://api.ppio.com/v3/seedream-5.0-lite",
    mode: "sync",
    supportsReferenceImage: true,
    referenceImageRequired: false
  },
  {
    id: "jimeng-3.1",
    endpoint: "https://api.ppio.com/v3/async/jimeng-txt2img-v3.1",
    mode: "async",
    supportsReferenceImage: false,
    referenceImageRequired: false
  },
  {
    id: "qwen-image-txt2img",
    endpoint: "https://api.ppio.com/v3/async/qwen-image-txt2img",
    mode: "async",
    supportsReferenceImage: false,
    referenceImageRequired: false
  },
  {
    id: "qwen-image-edit",
    endpoint: "https://api.ppio.com/v3/async/qwen-image-edit",
    mode: "async",
    supportsReferenceImage: true,
    referenceImageRequired: true
  },
  {
    id: "z-image-turbo",
    endpoint: "https://api.ppio.com/v3/async/z-image-turbo",
    mode: "async",
    supportsReferenceImage: false,
    referenceImageRequired: false
  },
  {
    id: "z-image-turbo-lora",
    endpoint: "https://api.ppio.com/v3/async/z-image-turbo-lora",
    mode: "async",
    supportsReferenceImage: false,
    referenceImageRequired: false
  }
]

export const BUILTIN_IMAGE_CONFIGS: ImageModelConfig[] = BUILTIN_IMAGE_PRESETS.map((item) => ({
  id: item.id,
  endpoint: item.endpoint
}))

export const getImagePresetMode = (modelId: string): ImagePresetMode =>
  BUILTIN_IMAGE_PRESETS.find((item) => item.id === modelId)?.mode ?? "sync"

export const supportsReferenceImage = (modelId: string): boolean =>
  BUILTIN_IMAGE_PRESETS.find((item) => item.id === modelId)?.supportsReferenceImage ?? false

export const requiresReferenceImage = (modelId: string): boolean =>
  BUILTIN_IMAGE_PRESETS.find((item) => item.id === modelId)?.referenceImageRequired ?? false
