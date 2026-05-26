// Models that only work via /v1/responses on OpenAI but not via /chat/completions on Copilot
const MODEL_MAP: Record<string, string> = {
  // "gpt-5.5": "gpt-5.4",  // Uncomment if gpt-5.5 doesn't work
  // "gpt-5.5-mini": "gpt-5.4-mini",
}

export function translateModelName(model: string): string {
  return MODEL_MAP[model] ?? model
}

export function generateId(prefix: string): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
  let result = ""
  for (let i = 0; i < 24; i++) {
    result += chars[Math.floor(Math.random() * chars.length)]
  }
  return `${prefix}_${result}`
}

export function mapFinishReasonToStatus(
  finishReason: string | null,
): "completed" | "incomplete" | "failed" {
  switch (finishReason) {
    case "length": {
      return "incomplete"
    }
    case "content_filter": {
      return "failed"
    }
    default: {
      return "completed"
    }
  }
}
