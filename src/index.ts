/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import { fal } from '@fal-ai/client';

// Define the expected environment variables/secrets
interface Env {
	/**
	 * Comma-separated list of Fal AI API keys for redundancy.
	 * Example: "key1,key2,key3"
	 * Configure this secret in your Cloudflare dashboard or wrangler.jsonc.
	 */
	FAL_KEY: string;
	/**
	 * Comma-separated list of allowed API keys for client authentication.
	 * Example: "clientkey1,clientkey2,verysecretkey"
	 * Configure this secret in your Cloudflare dashboard or wrangler.jsonc.
	 */
	API_KEY: string;
	/**
	 * Comma-separated list of allowed origins for CORS.
	 * Example: "https://example.com,https://app.example.com"
	 * If not set, defaults to '*' (all origins).
	 * Configure this secret in your Cloudflare dashboard or wrangler.jsonc.
	 */
	ALLOWED_ORIGINS?: string;
}

// OpenAI Request/Response Types (Simplified)
export interface OpenAIMessage {
	role: 'system' | 'user' | 'assistant';
	content: string | null;
}

interface OpenAIChatCompletionRequest {
	model: string;
	messages: OpenAIMessage[];
	stream?: boolean;
	// We can add other OpenAI parameters here if needed, but keep them simple for now
	// e.g., max_tokens, temperature, etc.
	reasoning_effort?: 'low' | 'medium' | 'high'; // New param compatible with OpenAI reasoning
}

// Type for supported Fal Model IDs based on the constant array
// This ensures type safety when passing to the fal client
type FalModelId = typeof FAL_SUPPORTED_MODELS[number];

interface FalInput {
	model: FalModelId; // Use the specific type
	prompt: string;
	system_prompt?: string;
	reasoning?: boolean;
	// Fal-specific parameters can be added here if needed
}

// Payload for fal.stream or fal.subscribe
interface FalPayload {
    input: FalInput;
    // Add other stream/subscribe options if needed
}

// Simple type for log entries in the stream
interface LogEntry {
	message: string;
	level?: string; // Optional level property
}

// Type for Fal Stream Event Data
interface FalStreamEventData {
    output: string;
    reasoning?: any; // Or a more specific type if known
    partial?: boolean;
    error?: any; // Or a more specific type if known
    logs?: LogEntry[];
}

// Type for Fal Stream Event (passed in iterator)
interface FalStreamEvent {
	output: string;
    reasoning?: any; // Or a more specific type if known
    partial?: boolean;
    error?: any; // Or a more specific type if known
    logs?: LogEntry[];
	// Other potential properties from the stream event can be added here
}

// Type for Fal Subscribe Result
interface FalSubscribeResult {
	data: FalStreamEventData; // Assuming subscribe result structure matches stream event data
	requestId: string;
	// Other potential top-level properties can be added here
}

// === Global Definitions ===
export const SYSTEM_PROMPT_LIMIT = 4800;

const FAL_SUPPORTED_MODELS = [
	"anthropic/claude-3.7-sonnet",
	"anthropic/claude-3.5-sonnet",
	"anthropic/claude-3-5-haiku",
	"anthropic/claude-3-haiku",
	"google/gemini-pro-1.5",
	"google/gemini-flash-1.5",
	"google/gemini-flash-1.5-8b",
	"google/gemini-2.0-flash-001",
	"meta-llama/llama-3.2-1b-instruct",
	"meta-llama/llama-3.2-3b-instruct",
	"meta-llama/llama-3.1-8b-instruct",
	"meta-llama/llama-3.1-70b-instruct",
	"openai/gpt-4o-mini",
	"openai/gpt-4o",
	"deepseek/deepseek-r1",
	"meta-llama/llama-4-maverick",
	"meta-llama/llama-4-scout"
] as const; // Use 'as const' for stricter type checking

// Helper function to get owner from model ID
const getOwner = (modelId: string): string => {
	if (modelId && modelId.includes('/')) {
		return modelId.split('/')[0];
	}
	return 'https://fal.ai'; // Default owner
};

/**
 * 将 OpenAI 格式的消息转换为 Fal AI 格式的 prompt 和 system_prompt
 * 
 * 核心逻辑：倒序遍历 messages，至多取 3 条 user/assistant 消息放到 prompt 部分，
 * chat_history 最多包含 2 条消息（user + assistant），最后一个用户消息是最新提问，不属于对话历史
 * 
 * @param messages - OpenAI 格式的消息数组
 * @returns 包含 system_prompt、prompt 和可选错误信息的对象
 * 
 * @example
 * // 基本用法：系统消息 + 用户消息
 * const messages = [
 *   { role: 'system', content: 'You are a helpful assistant.' },
 *   { role: 'user', content: 'Hello, how are you?' }
 * ];
 * const result = convertMessagesToFalPrompt(messages);
 * // result.system_prompt: 'You are a helpful assistant.'
 * // result.prompt: 'Hello, how are you?'
 * 
 * @example
 * // 多轮对话：最后一条是用户消息
 * const messages = [
 *   { role: 'system', content: 'You are helpful.' },
 *   { role: 'user', content: 'What is AI?' },
 *   { role: 'assistant', content: 'AI is artificial intelligence.' },
 *   { role: 'user', content: 'Tell me more.' }
 * ];
 * const result = convertMessagesToFalPrompt(messages);
 * // result.system_prompt: 'You are helpful.\n<chat_history>'
 * // result.prompt: 'What is AI?\nAssistant: AI is artificial intelligence.\n</chat_history>\nTell me more.'
 * 
 * @example
 * // 多轮对话：最后一条不是用户消息
 * const messages = [
 *   { role: 'user', content: 'Hello' },
 *   { role: 'assistant', content: 'Hi there!' }
 * ];
 * const result = convertMessagesToFalPrompt(messages);
 * // result.system_prompt: '<chat_history>\nHuman: Hello\nAssistant: Hi there!\n</chat_history>'
 * // result.prompt: ''
 * 
 * @description
 * 实现逻辑：
 * 1. **系统消息处理**：只使用最后一个非空系统消息，如果超出 SYSTEM_PROMPT_LIMIT 则返回错误
 * 2. **消息过滤**：自动过滤空内容消息（null、undefined、空字符串或纯空格）
 * 3. **倒序遍历**：取最后 3 条消息，根据最后一条消息类型分两种情况：
 * 
 *    **情况 A - 最后一条是用户消息**：
 *    - 取倒数第 3、第 2 条作为 chat_history（最多 2 条：user + assistant）
 *    - system_prompt: `系统消息\n<chat_history>`
 *    - prompt: `<user message>\nAssistant: <assistant message>\n</chat_history>\n<最新用户消息>`
 * 
 *    **情况 B - 最后一条不是用户消息**：
 *    - 取最后 2 条消息作为 chat_history，放在 system_prompt 中
 *    - system_prompt: `系统消息\n<chat_history>\nHuman: <user message>\nAssistant: <assistant message>\n</chat_history>`
 *    - prompt: `""`（空字符串）
 * 
 * 4. **格式约定**：
 *    - prompt 中会自动拼接 Human 消息，所以 user 消息不需要 "Human:" 前缀
 *    - system_prompt 中的 user 消息需要 "Human:" 前缀
 *    - assistant 消息始终使用 "Assistant:" 前缀
 * 
 * @note
 * - 字符限制：系统消息长度不能超过 SYSTEM_PROMPT_LIMIT (4800) 字符
 * - 消息数量：最多处理最近的 3 条对话消息（倒数第 1、2、3 条）
 * - 历史限制：chat_history 最多包含 2 条消息，避免 prompt 过长
 * - 错误处理：系统消息超限时返回错误，其他情况尽力处理
 */
export function convertMessagesToFalPrompt(messages: OpenAIMessage[]): { system_prompt: string; prompt: string; error?: string } {
	// 第一步：过滤空内容消息，分离系统消息和对话消息
	const filtered_messages: OpenAIMessage[] = [];
	let system_message_content = "";
	
	for (const message of messages) {
		const content = (message.content === null || message.content === undefined) ? "" : String(message.content).trim();
		if (content.length > 0) {
			if (message.role === 'system') {
				system_message_content = content; // 只保留最后一个非空系统消息
			} else {
				filtered_messages.push({
					...message,
					content: content
				});
			}
		}
	}
	
	// 检查系统消息长度限制
	if (system_message_content.length > SYSTEM_PROMPT_LIMIT) {
		return {
			system_prompt: "",
			prompt: "",
			error: `System message too long: ${system_message_content.length} characters exceeds limit of ${SYSTEM_PROMPT_LIMIT} characters`
		};
	}
	
	// 如果没有对话消息，直接返回
	if (filtered_messages.length === 0) {
		return {
			system_prompt: system_message_content,
			prompt: ""
		};
	}
	
	// 第二步：倒序遍历messages，至多取3条user/assistant消息放到prompt部分
	const prompt_messages = filtered_messages.slice(-3); // 取最后3条消息
	const remaining_messages = filtered_messages.slice(0, -3); // 剩余的消息
	
	// 第三步：构建prompt部分
	let prompt_parts: string[] = [];
	
	for (const message of prompt_messages) {
		if (message.role === 'user') {
			prompt_parts.push(String(message.content));
		} else if (message.role === 'assistant') {
			prompt_parts.push(`Assistant: ${String(message.content)}`);
		}
	}
	
	const final_prompt = prompt_parts.join('\n');
	
	// 第四步：构建system_prompt部分
	let system_prompt_parts: string[] = [];
	
	// 添加系统消息（如果存在）
	if (system_message_content.length > 0) {
		system_prompt_parts.push(system_message_content);
	}
	
	// 添加剩余的对话消息
	for (const message of remaining_messages) {
		if (message.role === 'user') {
			system_prompt_parts.push(`Human: ${String(message.content)}`);
		} else if (message.role === 'assistant') {
			system_prompt_parts.push(`Assistant: ${String(message.content)}`);
		}
	}
	
	let final_system_prompt = system_prompt_parts.join('\n');
	
	// 第五步：检查system_prompt字符限制并截断
	if (final_system_prompt.length > SYSTEM_PROMPT_LIMIT) {
		// 优先保留系统消息，然后从最新的对话开始截断
		const system_part = system_message_content;
		let remaining_space = SYSTEM_PROMPT_LIMIT - system_part.length - 1; // -1 for newline
		
		if (remaining_space <= 0) {
			final_system_prompt = system_part;
		} else {
			const conversation_parts: string[] = [];
			
			// 倒序添加剩余对话，确保不超过字符限制
			for (let i = remaining_messages.length - 1; i >= 0; i--) {
				const message = remaining_messages[i];
				let message_text = "";
				
				if (message.role === 'user') {
					message_text = `Human: ${String(message.content)}`;
				} else if (message.role === 'assistant') {
					message_text = `Assistant: ${String(message.content)}`;
				}
				
				if (message_text.length + 1 <= remaining_space) { // +1 for newline
					conversation_parts.unshift(message_text);
					remaining_space -= (message_text.length + 1);
				} else {
					break; // 无法添加更多消息
				}
			}
			
			if (system_part.length > 0 && conversation_parts.length > 0) {
				final_system_prompt = system_part + '\n' + conversation_parts.join('\n');
			} else if (system_part.length > 0) {
				final_system_prompt = system_part;
			} else {
				final_system_prompt = conversation_parts.join('\n');
			}
		}
	}
	
	return {
		system_prompt: final_system_prompt,
		prompt: final_prompt
	};
}

// Type guard to check if a string is a valid FalModelId
function isValidFalModelId(modelId: string): modelId is FalModelId {
	return (FAL_SUPPORTED_MODELS as readonly string[]).includes(modelId);
}

// === CORS Utilities ===
// Default CORS headers
function getCorsHeaders(): HeadersInit {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, DELETE, PATCH',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Max-Age': '86400', // Cache preflight for 1 day
    };
}

// Create a response with CORS headers included
function createCorsResponse(body: string | null, options: ResponseInit): Response {
    const corsHeaders = getCorsHeaders();
    const headers = { ...options.headers, ...corsHeaders };
    
    return new Response(body, {
        ...options,
        headers
    });
}

/**
 * Attempts a Fal API request (stream or subscribe) with key rotation on failure.
 * @param falKeys Array of Fal API keys.
 * @param falPayload Payload for the fal request.
 * @param stream Whether to use streaming.
 * @param modelToReport The original model name requested by the user for reporting.
 * @param ctx ExecutionContext for streaming requests.
 * @returns For stream=true: { readable: ReadableStream }. For stream=false: FalSubscribeResult.
 * @throws Throws an error if all keys fail or if a non-retryable error occurs.
 */
async function tryFalRequest(
    falKeys: string[],
    falPayload: FalPayload,
    stream: boolean,
    modelToReport: string, // Pass the original model name
    ctx?: ExecutionContext
): Promise<{ readable: ReadableStream } | FalSubscribeResult> {
    let lastError: any = null;

    if (falKeys.length === 0) {
        throw new Error("No Fal API keys configured.");
    }

    for (let i = 0; i < falKeys.length; i++) {
        const key = falKeys[i];
        console.log(`Attempting Fal request with key index ${i}`);
        try {
            // Configure the client with the current key for this attempt
            fal.config({ credentials: key });

            if (stream && ctx) {
                // --- Stream Handling ---
                console.log(`Initiating fal.stream with key index ${i}... Payload:`, JSON.stringify(falPayload, null, 2));
                const falStream = await fal.stream("fal-ai/any-llm", falPayload as any); // Use the prepared payload object
                console.log(`fal.stream initiated successfully with key index ${i}.`);

                // Set up the response stream
                const { readable, writable } = new TransformStream();
                const writer = writable.getWriter();
                const encoder = new TextEncoder();

                // Start background processing for the stream events
                const streamProcessing = (async () => {
                    try {
                        let previousOutput = '';
                        for await (const event of falStream) {
                           // console.log(`Fal Stream Event (Key ${i}):`, event); // Verbose logging
                            const currentOutput = (event && typeof event.output === 'string') ? event.output : '';
                            const isPartial = (event && typeof event.partial === 'boolean') ? event.partial : true; // Assume partial if not specified
                            const errorInfo = (event && event.error) ? event.error : null;
                            const logs = (event && Array.isArray((event as any).logs)) ? (event as any).logs : [];
                            const reasoningData = (event && event.reasoning) ? event.reasoning : null;
                            logs.forEach((log: LogEntry) => console.log(`[Fal Log - Key ${i}] ${log.message}`));

                            if (errorInfo) {
                                console.error(`Error received in fal stream event (Key ${i}):`, errorInfo);
                                const errorChunk = { id: `chatcmpl-${Date.now()}-error`, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: modelToReport, choices: [{ index: 0, delta: {}, finish_reason: "error", logprobs: null, message: { role: 'assistant', content: `Fal Stream Error: ${JSON.stringify(errorInfo)}` } }] };
                                await writer.write(encoder.encode(`data: ${JSON.stringify(errorChunk)}\n\n`));
                                throw new Error(`Fal Stream Error: ${JSON.stringify(errorInfo)}`); // Throw to stop processing this stream
                            }

                            let deltaContent = '';
                            if (currentOutput.startsWith(previousOutput)) {
                                deltaContent = currentOutput.substring(previousOutput.length);
                            } else if (currentOutput.length > 0) {
                                console.warn(`Fal stream output mismatch (Key ${i}). Sending full current output as delta.`);
                                deltaContent = currentOutput;
                                previousOutput = ''; // Reset
                            }
                            if (currentOutput.length > 0) {
                                previousOutput = currentOutput;
                            }

                            if (deltaContent || reasoningData || !isPartial) {
                                const choice = {
                                    index: 0,
                                    delta: { content: deltaContent },
                                    finish_reason: isPartial === false ? "stop" : null,
                                    logprobs: null,
                                    ...(reasoningData && { reasoning: [{ index: 0, content: reasoningData }] })
                                };
                                const openAIChunk = {
                                    id: `chatcmpl-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`,
                                    object: "chat.completion.chunk",
                                    created: Math.floor(Date.now() / 1000),
                                    model: modelToReport, // Report the originally requested model
                                    choices: [choice]
                                };
                                await writer.write(encoder.encode(`data: ${JSON.stringify(openAIChunk)}\n\n`));
                            }
                        }
                        console.log(`Fal stream iteration finished successfully (Key ${i}).`);
                        await writer.write(encoder.encode(`data: [DONE]\n\n`));

                    } catch (streamError: any) {
                        console.error(`Error during fal stream processing (Key ${i}):`, streamError);
                         try {
                            // Attempt to write an error chunk to the client stream
                            const errorDetails = (streamError instanceof Error) ? streamError.message : JSON.stringify(streamError);
							const errorChunk = { error: { message: "Stream processing error", type: "proxy_error", param: null, code: null, details: errorDetails } };
							await writer.write(encoder.encode(`data: ${JSON.stringify(errorChunk)}\n\n`));
                            // Always attempt to send DONE, even after error chunk
							await writer.write(encoder.encode(`data: [DONE]\n\n`));
                        } catch (writeError) {
                            console.error(`Error writing final stream error message (Key ${i}):`, writeError);
                        }
                        // Do not re-throw here, as the initial response has already been sent.
                        // The error is reported within the stream itself.
                    } finally {
                        try {
                            console.log(`Closing stream writer (Key ${i})...`);
                            await writer.close();
                            console.log(`Stream writer closed (Key ${i}).`);
                        } catch (closeError) {
                            console.error(`Error closing stream writer (Key ${i}):`, closeError);
                        }
                    }
                })();

                ctx.waitUntil(streamProcessing); // Allow background processing

                // Return the readable stream immediately for the client
                return { readable }; // Indicate success for this key attempt

            } else {
                // --- Non-Stream Handling ---
                console.log(`Executing fal.subscribe with key index ${i}... Payload:`, JSON.stringify(falPayload, null, 2));
                const result = await fal.subscribe("fal-ai/any-llm", falPayload as any) as FalSubscribeResult;
                console.log(`fal.subscribe successful with key index ${i}.`);

                // Log any embedded logs or errors from the non-stream result
                if (result?.data?.logs && Array.isArray(result.data.logs)) {
                    result.data.logs.forEach((log: LogEntry) => console.log(`[Fal Log - Key ${i}] ${log.message}`));
                }
                 if (result?.data?.error) {
                    // Treat error within data as failure for this key
                    console.error(`Fal-ai returned an error in non-stream mode (Key ${i}):`, result.data.error);
                    throw new Error(`Fal error in response data: ${JSON.stringify(result.data.error)}`);
                }

                return result; // Return successful result
            }

        } catch (error: any) {
            lastError = error; // Store the error from this attempt
            console.warn(`Fal request attempt failed for key index ${i}:`, error.message || error);

            // Check if the error suggests a key-specific issue (e.g., auth, rate limit, server error)
            // Fal client might throw custom errors or HTTP status codes might be attached.
            // This check might need refinement based on actual errors thrown by @fal-ai/client.
            // Assuming status property exists for HTTP errors.
            const status = error?.status || error?.response?.status;
            const isRetryableError = status === 401 || status === 403 || status === 429 || (status >= 500 && status < 600) || error.message?.includes('authentication') || error.message?.includes('rate limit');


            if (isRetryableError && (i < falKeys.length - 1)) {
                console.log(`Error is potentially key-related or transient (status: ${status}). Trying next key.`);
                continue; // Try the next key
            } else {
                console.error(`Non-retryable error (status: ${status}) or final key attempt failed for key index ${i}.`);
                throw error; // Re-throw the error if it's not retryable or it's the last key
            }
        }
    }

    // If the loop finishes without returning/throwing successfully, it means all keys failed.
    console.error("All Fal API key attempts failed.");
    // Throw the last recorded error
    throw new Error(`All Fal API key attempts failed. Last error: ${lastError?.message || lastError}`);
}

// === Main Fetch Handler ===
export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;
		const method = request.method;

		// Handle CORS preflight requests (OPTIONS)
		if (method === 'OPTIONS') {
			 return new Response(null, { 
                status: 204,
                headers: getCorsHeaders()
             });
		}

        let falKeys: string[] = [];

		// --- Authentication & Fal Key Parsing --- (Run for all relevant endpoints)
		if (path.startsWith('/v1/')) { // Only process /v1 routes
			// --- Worker Authentication ---
			const authHeader = request.headers.get('Authorization');
			const apiKeysString = env.API_KEY;

			if (!apiKeysString) {
				console.error("API_KEY secret is not set.");
				return createCorsResponse(
                    JSON.stringify({ error: { message: 'Server configuration error: API Key secret missing.', type: 'server_error' } }), 
                    { status: 500, headers: { 'Content-Type': 'application/json' } }
                );
			}

			const allowedApiKeys = apiKeysString.split(',').map(k => k.trim()).filter(k => k.length > 0);
			if (allowedApiKeys.length === 0) {
				console.error("API_KEY secret is set but contains no valid keys after parsing.");
				return createCorsResponse(
                    JSON.stringify({ error: { message: 'Server configuration error: No valid API Keys found in secret.', type: 'server_error' } }), 
                    { status: 500, headers: { 'Content-Type': 'application/json' } }
                );
			}

			const providedApiKey = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;

			if (!providedApiKey || !allowedApiKeys.includes(providedApiKey)) {
				console.error(`Worker auth failed. Header: ${authHeader ? 'Present' : 'Missing'}, Key check: Provided key "${providedApiKey}" not in allowed list.`);
				return createCorsResponse(
                    JSON.stringify({ error: { message: 'Incorrect API key provided.', type: 'invalid_request_error', param: null, code: 'invalid_api_key'} }), 
                    { status: 401, headers: { 'Content-Type': 'application/json' } }
                );
			}

			// --- Parse Fal Keys ---
			if (!env.FAL_KEY) {
				console.error("FAL_KEY secret is not set.");
				return createCorsResponse(
                    JSON.stringify({ error: { message: 'Server configuration error: Fal Key missing.', type: 'server_error'} }), 
                    { status: 500, headers: { 'Content-Type': 'application/json' } }
                );
			}
            falKeys = env.FAL_KEY.split(',').map(k => k.trim()).filter(k => k.length > 0);
            if (falKeys.length === 0) {
                console.error("FAL_KEY secret is set but contains no valid keys after parsing.");
				return createCorsResponse(
                    JSON.stringify({ error: { message: 'Server configuration error: No valid Fal Keys found.', type: 'server_error'} }), 
                    { status: 500, headers: { 'Content-Type': 'application/json' } }
                );
            }
            console.log(`Found ${falKeys.length} Fal API key(s).`);
            // Note: fal.config() is now called inside tryFalRequest for each attempt

		} else if (path === '/') {
			// Allow root path without auth
		} else {
			// Any other path is Not Found
			return createCorsResponse(
                JSON.stringify({ error: { message: `Invalid path: ${path}`, type: 'invalid_request_error'} }), 
                { status: 404, headers: { 'Content-Type': 'application/json' } }
            );
		}

		// --- Routing ---

		// GET /v1/models
		if (method === 'GET' && path === '/v1/models') {
			try {
				const modelsData = FAL_SUPPORTED_MODELS.map(modelId => ({
					id: modelId,
					object: "model",
					created: Math.floor(Date.now() / 1000),
					owned_by: getOwner(modelId)
				}));
				return createCorsResponse(
                    JSON.stringify({ object: "list", data: modelsData }), 
                    { headers: { 'Content-Type': 'application/json' } }
                );
			} catch (error: any) {
				console.error("Error processing GET /v1/models:", error);
				return createCorsResponse(
                    JSON.stringify({ error: { message: `Failed to retrieve model list: ${error.message}`, type: 'server_error'} }), 
                    { status: 500, headers: { 'Content-Type': 'application/json' } }
                );
			}
		}

		// POST /v1/chat/completions
		if (method === 'POST' && path === '/v1/chat/completions') {
			let requestBody: OpenAIChatCompletionRequest;
			try {
				requestBody = await request.json();
			} catch (error) {
				return createCorsResponse(
                    JSON.stringify({ error: { message: 'Invalid JSON request body', type: 'invalid_request_error'} }), 
                    { status: 400, headers: { 'Content-Type': 'application/json' } }
                );
			}

			const { model: requestedModel, messages, stream = false, reasoning_effort } = requestBody;

			if (!requestedModel || !messages || !Array.isArray(messages) || messages.length === 0) {
				return createCorsResponse(
                    JSON.stringify({ error: { message: 'Missing or invalid parameters: model and messages array are required.', type: 'invalid_request_error'} }), 
                    { status: 400, headers: { 'Content-Type': 'application/json' } }
                );
			}

			// Validate and determine the model to use
			let modelToUse: FalModelId;
			if (isValidFalModelId(requestedModel)) {
				modelToUse = requestedModel;
			} else {
				console.error(`Error: Requested model '${requestedModel}' is not supported.`);
				return createCorsResponse(
                    JSON.stringify({
                        error: {
                            message: `The model \`${requestedModel}\` does not exist or is not supported by this endpoint.`,
                            type: 'invalid_request_error',
                            param: 'model',
                            code: 'model_not_found'
                        }
                    }), 
                    { status: 400, headers: { 'Content-Type': 'application/json' } }
                );
			}

			const shouldRequestReasoning = !!reasoning_effort && ['low', 'medium', 'high'].includes(reasoning_effort);

			try {
				const convertResult = convertMessagesToFalPrompt(messages);
				
				// Check for conversion error
				if (convertResult.error) {
					return createCorsResponse(
						JSON.stringify({ error: { message: convertResult.error, type: 'invalid_request_error' } }), 
						{ status: 400, headers: { 'Content-Type': 'application/json' } }
					);
				}

				const { prompt, system_prompt } = convertResult;
				const falInput: FalInput = {
					model: modelToUse,
					prompt: prompt,
					reasoning: shouldRequestReasoning,
				};
				if (system_prompt) {
					falInput.system_prompt = system_prompt;
				}

                // Prepare the final payload for Fal
                const falPayload: FalPayload = { input: falInput };

				console.log(`Preparing request for fal-ai/any-llm. Model: ${falInput.model}, Stream: ${stream}, Reasoning Effort: ${reasoning_effort ?? 'none'} -> Fal Reasoning: ${falInput.reasoning}`);

                // Use the tryFalRequest function with key rotation
                const result = await tryFalRequest(falKeys, falPayload, stream, requestedModel, ctx);

				if (stream) {
                    // --- Stream Handling ---
                    // tryFalRequest handles the stream setup internally if successful
                    // We just need to return the response with the readable stream
                    if ('readable' in result) {
                        // For streaming responses, we need to add CORS headers but keep the stream
                        const corsHeaders = getCorsHeaders();
                        return new Response(result.readable, {
                            headers: {
                                'Content-Type': 'text/event-stream; charset=utf-8',
                                'Cache-Control': 'no-cache',
                                'Connection': 'keep-alive',
                                ...corsHeaders
                            }
                        });
                    } else {
                         // This case should theoretically not happen if stream=true and no error was thrown
                         console.error("tryFalRequest returned unexpected result for stream=true");
                         throw new Error("Internal server error during stream setup.");
                    }

				} else {
					// --- Non-Stream Handling ---
                    // tryFalRequest returns the FalSubscribeResult directly if successful
					const falResult = result as FalSubscribeResult; // Type assertion

					// Log the raw result for debugging (optional)
					// console.log("Raw non-stream result from fal-ai:", JSON.stringify(falResult, null, 2));

					// Access properties correctly from the data object returned by tryFalRequest
                    const outputContent = falResult?.data?.output ?? "";
                    const reasoningData = falResult?.data?.reasoning;
                    const reqId = falResult?.requestId || Date.now().toString();

					const openAIResponse = {
						id: `chatcmpl-${reqId}`,
						object: "chat.completion",
						created: Math.floor(Date.now() / 1000),
						model: requestedModel, // Report the originally requested model
						choices: [{
							index: 0,
							message: {
								role: "assistant",
								content: outputContent
							},
							finish_reason: "stop",
							logprobs: null,
							...(reasoningData && { reasoning: [{ index: 0, content: reasoningData }] })
						}],
						usage: { prompt_tokens: null, completion_tokens: null, total_tokens: null },
						system_fingerprint: null,
					};
					return createCorsResponse(
                        JSON.stringify(openAIResponse), 
                        { headers: { 'Content-Type': 'application/json' } }
                    );
				}
			} catch (error: any) {
                // Catch errors from tryFalRequest (e.g., all keys failed) or other processing errors
				console.error("Error during Fal request processing or after retries:", error);
                const errorMessage = (error instanceof Error) ? error.message : JSON.stringify(error);
				return createCorsResponse(
                    JSON.stringify({ error: { message: `Error processing request: ${errorMessage}`, type: 'server_error' } }), 
                    { status: 500, headers: { 'Content-Type': 'application/json' } }
                );
			}
		}

		// Default response for root path or other unhandled routes
		return createCorsResponse(
            JSON.stringify({ status: 'ok', message: 'Fal AI-powered OpenAI Proxy API' }), 
            { headers: { 'Content-Type': 'application/json' } }
        );
	}
};