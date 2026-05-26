import consola from "consola"
import { events } from "fetch-event-stream"

import type {
  ResponsesPayload,
  ResponsesResponse,
} from "~/routes/responses/responses-types"

import { copilotHeaders, copilotBaseUrl } from "~/lib/api-config"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"

const MAX_RETRIES = 3
const TIMEOUT_MS = 120_000

export const createResponses = async (payload: ResponsesPayload) => {
  if (!state.copilotToken) throw new Error("Copilot token not found")

  const headers: Record<string, string> = {
    ...copilotHeaders(state),
  }

  let lastError: unknown

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

      const response = await fetch(`${copilotBaseUrl(state)}/responses`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      })

      clearTimeout(timeout)

      if (!response.ok) {
        const errorBody = await response.text()
        consola.error("Failed to create responses:", errorBody)
        consola.error(
          "Request payload was:",
          JSON.stringify(payload).slice(0, 500),
        )
        throw new HTTPError("Failed to create responses", response)
      }

      if (payload.stream) {
        return events(response)
      }

      return (await response.json()) as ResponsesResponse
    } catch (error) {
      lastError = error

      // Don't retry on HTTP errors (4xx), only on network/timeout issues
      if (error instanceof HTTPError) throw error

      consola.warn(
        `Responses request failed (attempt ${attempt + 1}/${MAX_RETRIES}):`,
        error instanceof Error ? error.message : error,
      )

      if (attempt < MAX_RETRIES - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 * (attempt + 1)),
        )
      }
    }
  }

  throw lastError
}
