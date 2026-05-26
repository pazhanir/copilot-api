import type { Context } from "hono"

import consola from "consola"
import { streamSSE } from "hono/streaming"

import { awaitApproval } from "~/lib/approval"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import { createResponses } from "~/services/copilot/create-responses"

import {
  type ResponsesPayload,
  type ResponsesResponse,
} from "./responses-types"

export async function handleResponses(c: Context) {
  await checkRateLimit(state)

  const payload = await c.req.json<ResponsesPayload>()
  consola.info(`Responses API model: ${payload.model}`)
  consola.debug(
    "Responses API request payload:",
    JSON.stringify(payload).slice(-400),
  )

  // Filter out tools with empty names
  if (payload.tools) {
    payload.tools = payload.tools.filter(
      (tool) => tool.name && tool.name.length > 0,
    )
  }

  if (state.manualApprove) await awaitApproval()

  const response = await createResponses(payload)

  if (isNonStreaming(response)) {
    consola.debug("Non-streaming response")
    return c.json(response)
  }

  consola.debug("Streaming response")
  return streamSSE(c, async (stream) => {
    for await (const rawEvent of response) {
      if (rawEvent.data === "[DONE]") break
      if (!rawEvent.data) continue

      consola.debug("Responses stream event:", rawEvent.data.slice(-200))
      await stream.writeSSE({
        event: rawEvent.event ?? undefined,
        data: rawEvent.data,
      })
    }
  })
}

const isNonStreaming = (
  response: Awaited<ReturnType<typeof createResponses>>,
): response is ResponsesResponse => Object.hasOwn(response as object, "output")
