// OpenAI Responses API Types

// --- Request Types ---

export interface ResponsesPayload {
  model: string
  input: string | Array<ResponsesInputItem>
  instructions?: string
  tools?: Array<ResponsesTool>
  tool_choice?:
    | "auto"
    | "none"
    | "required"
    | { type: "function"; name: string }
  temperature?: number
  top_p?: number
  max_output_tokens?: number
  stop?: Array<string>
  stream?: boolean
  metadata?: Record<string, string>
  previous_response_id?: string
  truncation?: "auto" | "disabled"
  store?: boolean
}

export type ResponsesInputItem =
  | ResponsesMessageItem
  | ResponsesFunctionCallItem
  | ResponsesFunctionCallOutputItem

export interface ResponsesMessageItem {
  type: "message"
  role: "user" | "assistant" | "system" | "developer"
  content: string | Array<ResponsesContentPart>
}

export interface ResponsesFunctionCallItem {
  type: "function_call"
  id: string
  call_id: string
  name: string
  arguments: string
}

export interface ResponsesFunctionCallOutputItem {
  type: "function_call_output"
  call_id: string
  output: string
}

export type ResponsesContentPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string }

export interface ResponsesTool {
  type: "function"
  name: string
  description?: string
  parameters: Record<string, unknown>
  strict?: boolean
}

// --- Response Types ---

export interface ResponsesResponse {
  id: string
  object: "response"
  created_at: number
  model: string
  status: "completed" | "incomplete" | "failed"
  output: Array<ResponsesOutputItem>
  usage: {
    input_tokens: number
    output_tokens: number
    total_tokens: number
  }
  metadata: Record<string, string>
  error: { code: string; message: string } | null
}

export type ResponsesOutputItem =
  | ResponsesMessageOutputItem
  | ResponsesFunctionCallOutputItemResponse

export interface ResponsesMessageOutputItem {
  type: "message"
  id: string
  role: "assistant"
  content: Array<ResponsesOutputContentPart>
  status: "completed" | "incomplete"
}

export interface ResponsesFunctionCallOutputItemResponse {
  type: "function_call"
  id: string
  call_id: string
  name: string
  arguments: string
  status: "completed"
}

export type ResponsesOutputContentPart = { type: "output_text"; text: string }

// --- Streaming Event Types ---

export interface ResponsesStreamState {
  responseId: string
  model: string
  outputIndex: number
  currentTextContent: string
  currentFunctionArgs: Record<
    number,
    { name: string; callId: string; args: string; outputIndex: number }
  >
  messageItemId: string
  messageStarted: boolean
  outputItems: Array<ResponsesOutputItem>
  inputTokens: number
  outputTokens: number
}

export type ResponsesStreamEvent =
  | { type: "response.created"; response: ResponsesResponse }
  | { type: "response.in_progress"; response: ResponsesResponse }
  | { type: "response.completed"; response: ResponsesResponse }
  | {
      type: "response.output_item.added"
      output_index: number
      item: ResponsesOutputItem
    }
  | {
      type: "response.output_item.done"
      output_index: number
      item: ResponsesOutputItem
    }
  | {
      type: "response.content_part.added"
      output_index: number
      content_index: number
      part: ResponsesOutputContentPart
    }
  | {
      type: "response.content_part.done"
      output_index: number
      content_index: number
      part: ResponsesOutputContentPart
    }
  | {
      type: "response.output_text.delta"
      output_index: number
      content_index: number
      delta: string
    }
  | {
      type: "response.output_text.done"
      output_index: number
      content_index: number
      text: string
    }
  | {
      type: "response.function_call_arguments.delta"
      output_index: number
      delta: string
    }
  | {
      type: "response.function_call_arguments.done"
      output_index: number
      arguments: string
    }
