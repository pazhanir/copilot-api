import {
  type ChatCompletionResponse,
  type ChatCompletionsPayload,
  type ContentPart,
  type Message,
  type Tool,
} from "~/services/copilot/create-chat-completions"

import {
  type ResponsesFunctionCallItem,
  type ResponsesFunctionCallOutputItem,
  type ResponsesFunctionCallOutputItemResponse,
  type ResponsesMessageItem,
  type ResponsesMessageOutputItem,
  type ResponsesOutputItem,
  type ResponsesPayload,
  type ResponsesResponse,
  type ResponsesTool,
} from "./responses-types"
import {
  generateId,
  mapFinishReasonToStatus,
  translateModelName,
} from "./utils"

// --- Request Translation ---

export function translateToOpenAI(
  payload: ResponsesPayload,
): ChatCompletionsPayload {
  const messages = translateInputToMessages(payload.input, payload.instructions)

  return {
    model: translateModelName(payload.model),
    messages,
    max_tokens: payload.max_output_tokens,
    stop: payload.stop,
    stream: payload.stream,
    temperature: payload.temperature,
    top_p: payload.top_p,
    tools: translateTools(payload.tools),
    tool_choice: translateToolChoice(payload.tool_choice),
  }
}

function translateInputToMessages(
  input: ResponsesPayload["input"],
  instructions?: string,
): Array<Message> {
  const messages: Array<Message> = []

  if (instructions) {
    messages.push({ role: "system", content: instructions })
  }

  if (typeof input === "string") {
    messages.push({ role: "user", content: input })
    return messages
  }

  // Track function calls so we can pair them with assistant messages
  let pendingToolCalls: Array<ResponsesFunctionCallItem> = []

  for (const item of input) {
    switch (item.type) {
      case "message": {
        // Flush any pending tool calls as an assistant message before this message
        if (pendingToolCalls.length > 0) {
          messages.push({
            role: "assistant",
            content: null,
            tool_calls: pendingToolCalls.map((tc) => ({
              id: tc.call_id,
              type: "function",
              function: { name: tc.name, arguments: tc.arguments },
            })),
          })
          pendingToolCalls = []
        }
        messages.push(translateMessageItem(item))
        break
      }
      case "function_call": {
        pendingToolCalls.push(item)
        break
      }
      case "function_call_output": {
        // Flush pending tool calls before the output
        if (pendingToolCalls.length > 0) {
          messages.push({
            role: "assistant",
            content: null,
            tool_calls: pendingToolCalls.map((tc) => ({
              id: tc.call_id,
              type: "function",
              function: { name: tc.name, arguments: tc.arguments },
            })),
          })
          pendingToolCalls = []
        }
        messages.push(translateFunctionCallOutput(item))
        break
      }
      default: {
        break
      }
    }
  }

  // Flush remaining tool calls
  if (pendingToolCalls.length > 0) {
    messages.push({
      role: "assistant",
      content: null,
      tool_calls: pendingToolCalls.map((tc) => ({
        id: tc.call_id,
        type: "function",
        function: { name: tc.name, arguments: tc.arguments },
      })),
    })
  }

  return messages
}

function translateMessageItem(item: ResponsesMessageItem): Message {
  let role: Message["role"]
  switch (item.role) {
    case "developer": {
      role = "developer"
      break
    }
    case "system": {
      role = "system"
      break
    }
    case "assistant": {
      role = "assistant"
      break
    }
    default: {
      role = "user"
    }
  }

  if (typeof item.content === "string") {
    return { role, content: item.content }
  }

  const parts: Array<ContentPart> = item.content.map((part) => {
    if (part.type === "input_text") {
      return { type: "text", text: part.text }
    }
    // input_image
    return { type: "image_url", image_url: { url: part.image_url } }
  })

  return { role, content: parts }
}

function translateFunctionCallOutput(
  item: ResponsesFunctionCallOutputItem,
): Message {
  return {
    role: "tool",
    tool_call_id: item.call_id,
    content: item.output,
  }
}

function translateTools(tools?: Array<ResponsesTool>): Array<Tool> | undefined {
  if (!tools || tools.length === 0) return undefined
  const valid = tools.filter((tool) => tool.name && tool.name.length > 0)
  if (valid.length === 0) return undefined
  return valid.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))
}

function translateToolChoice(
  toolChoice: ResponsesPayload["tool_choice"],
): ChatCompletionsPayload["tool_choice"] {
  if (!toolChoice) return undefined
  if (typeof toolChoice === "string") {
    if (toolChoice === "required") return "required"
    return toolChoice
  }
  return { type: "function", function: { name: toolChoice.name } }
}

// --- Response Translation ---

export function translateToResponses(
  response: ChatCompletionResponse,
  model: string,
): ResponsesResponse {
  const output: Array<ResponsesOutputItem> = []
  const choice = response.choices[0]

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (choice) {
    // Text content
    if (choice.message.content) {
      const messageItem: ResponsesMessageOutputItem = {
        type: "message",
        id: generateId("msg"),
        role: "assistant",
        content: [{ type: "output_text", text: choice.message.content }],
        status: choice.finish_reason === "length" ? "incomplete" : "completed",
      }
      output.push(messageItem)
    }

    // Tool calls
    if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
      for (const toolCall of choice.message.tool_calls) {
        const fcItem: ResponsesFunctionCallOutputItemResponse = {
          type: "function_call",
          id: generateId("fc"),
          call_id: toolCall.id,
          name: toolCall.function.name,
          arguments: toolCall.function.arguments,
          status: "completed",
        }
        output.push(fcItem)
      }
    }
  }

  const inputTokens = response.usage?.prompt_tokens ?? 0
  const outputTokens = response.usage?.completion_tokens ?? 0

  return {
    id: generateId("resp"),
    object: "response",
    created_at: response.created,
    model: response.model || model,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    status: mapFinishReasonToStatus(choice ? choice.finish_reason : "stop"),
    output,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
    },
    metadata: {},
    error: null,
  }
}
