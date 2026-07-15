import { useMutation } from "@tanstack/react-query"
import { apiFetch } from "@/lib/apiClient"
import { API_ENDPOINTS } from "@/lib/apiEndpoints"

export interface GeneratedAiImage {
  mimeType: string
  /** base64-encoded image bytes */
  data: string
}

export interface GenerateAiImagesInput {
  prompt: string
  count?: number
  aspectRatio?: string
}

export async function generateAiImages(input: GenerateAiImagesInput): Promise<GeneratedAiImage[]> {
  const res = await apiFetch<{ images: GeneratedAiImage[] }>(API_ENDPOINTS.AI_IMAGES_GENERATE, {
    method: "POST",
    body: JSON.stringify(input),
  })
  return res.images
}

export function useGenerateAiImagesMutation() {
  return useMutation({ mutationFn: generateAiImages })
}
