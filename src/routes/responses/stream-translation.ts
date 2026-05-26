import { type ChatCompletionChunk } from "~/services/copilot/create-chat-completions"

import {
  type ResponsesFunctionCallOutputItemResponse,
  type ResponsesMessageOutputItem,
  type ResponsesResponse,
  type ResponsesStreamEvent,
  type ResponsesStreamState,
} from "./responses-types"
import { generateId, mapFinishReasonToStatus } from "./utils"

export function createInitialStreamState(model: string): ResponsesStreamState {
  return {
    responseId: generateId("resp"),
    model,
    outputIndex: 0,
    currentTextContent: "",
    currentFunctionArgs: {},
    messageItemId: generateId("msg"),
    messageStarted: false,
    outputItems: [],
    inputTokens: 0,
    outputTokens: 0,
  }
}

export function buildResponseObject(
  state: ResponsesStreamState,
  status: "completed" | "incomplete" | "failed" = "completed",
): ResponsesResponse {
  return {
    id: state.responseId,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    model: state.model,
    status,
    output: state.outputItems,
    usage: {
      input_tokens: state.inputTokens,
      output_tokens: state.outputTokens,
      total_tokens: state.inputTokens + state.outputTokens,
    },
    metadata: {},
    error: null,
  }
}

function closeOpenTextBlock(
  state: ResponsesStreamState,
  events: Array<ResponsesStreamEvent>,
): void {
  if (!state.currentTextContent || state.outputItems.length === 0) return
  const lastItem = state.outputItems.at(-1)
  if (lastItem?.type !== "message") return

  lastItem.content = [{ type: "output_text", text: state.currentTextContent }]
  events.push(
    {
      type: "response.output_text.done",
      output_index: state.outputIndex,
      content_index: 0,
      text: state.currentTextContent,
    },
    {
      type: "response.content_part.done",
      output_index: state.outputIndex,
      content_index: 0,
      part: { type: "output_text", text: state.currentTextContent },
    },
    {
      type: "response.output_item.done",
      output_index: state.outputIndex,
      item: lastItem,
    },
  )
  state.outputIndex++
  state.currentTextContent = ""
}

// eslint-disable-next-line complexity, max-lines-per-function
export function translateChunkToResponsesEvents(
  chunk: ChatCompletionChunk,
  state: ResponsesStreamState,
): Array<ResponsesStreamEvent> {
  const events: Array<ResponsesStreamEvent> = []

  if (chunk.choices.length === 0) return events

  const choice = chunk.choices[0]
  const { delta } = choice

  // Track usage
  if (chunk.usage) {
    state.inputTokens = chunk.usage.prompt_tokens
    state.outputTokens = chunk.usage.completion_tokens
  }

  // Emit response.created and response.in_progress on first chunk
  if (!state.messageStarted) {
    state.model = chunk.model || state.model
    const resp = buildResponseObject(state, "incomplete")
    events.push(
      { type: "response.created", response: { ...resp } },
      { type: "response.in_progress", response: { ...resp } },
    )
    state.messageStarted = true
  }

  // Text content delta
  if (delta.content) {
    if (
      state.outputItems.length === 0
      || state.outputItems.at(-1)?.type !== "message"
    ) {
      // Start a new message output item
      const messageItem: ResponsesMessageOutputItem = {
        type: "message",
        id: state.messageItemId,
        role: "assistant",
        content: [{ type: "output_text", text: "" }],
        status: "completed",
      }
      state.outputItems.push(messageItem)

      events.push(
        {
          type: "response.output_item.added",
          output_index: state.outputIndex,
          item: messageItem,
        },
        {
          type: "response.content_part.added",
          output_index: state.outputIndex,
          content_index: 0,
          part: { type: "output_text", text: "" },
        },
      )
    }

    state.currentTextContent += delta.content
    events.push({
      type: "response.output_text.delta",
      output_index: state.outputIndex,
      content_index: 0,
      delta: delta.content,
    })
  }

  // Tool call deltas
  if (delta.tool_calls) {
    for (const toolCall of delta.tool_calls) {
      if (toolCall.id && toolCall.function?.name) {
        // Close text message item if open
        closeOpenTextBlock(state, events)

        // New function call item
        const fcItem: ResponsesFunctionCallOutputItemResponse = {
          type: "function_call",
          id: generateId("fc"),
          call_id: toolCall.id,
          name: toolCall.function.name,
          arguments: "",
          status: "completed",
        }
        state.outputItems.push(fcItem)
        state.currentFunctionArgs[toolCall.index] = {
          name: toolCall.function.name,
          callId: toolCall.id,
          args: "",
          outputIndex: state.outputIndex,
        }

        events.push({
          type: "response.output_item.added",
          output_index: state.outputIndex,
          item: fcItem,
        })
      }

      if (toolCall.function?.arguments) {
        const tracked = state.currentFunctionArgs[toolCall.index]
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (tracked) {
          tracked.args += toolCall.function.arguments
          events.push({
            type: "response.function_call_arguments.delta",
            output_index: tracked.outputIndex,
            delta: toolCall.function.arguments,
          })
        }
      }
    }
  }

  // Finish
  if (choice.finish_reason) {
    // Close open text message
    closeOpenTextBlock(state, events)

    // Close open function calls
    for (const [, tracked] of Object.entries(state.currentFunctionArgs)) {
      const fcItem = state.outputItems.find(
        (item): item is ResponsesFunctionCallOutputItemResponse =>
          item.type === "function_call" && item.call_id === tracked.callId,
      )
      if (fcItem) {
        fcItem.arguments = tracked.args
        events.push(
          {
            type: "response.function_call_arguments.done",
            output_index: tracked.outputIndex,
            arguments: tracked.args,
          },
          {
            type: "response.output_item.done",
            output_index: tracked.outputIndex,
            item: fcItem,
          },
        )
      }
    }

    const status = mapFinishReasonToStatus(choice.finish_reason)
    const finalResponse = buildResponseObject(state, status)
    events.push({ type: "response.completed", response: finalResponse })
  }

  return events
}
