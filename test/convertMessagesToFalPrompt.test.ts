/**
 * convertMessagesToFalPrompt 函数单元测试
 * 
 * 核心逻辑：倒序遍历messages，至多取3条user/assistant消息放到prompt部分
 * 
 * 实现逻辑：
 * 1. 分离系统消息和对话消息，只使用最后一个非空系统消息
 * 2. 倒序遍历，取最后3条消息，根据最后一条消息类型分两种情况：
 *    a. 最后一条消息是user消息：取倒数第3、第2条作为chat_history（最多2条：user+assistant），
 *       格式为 "<user message>\nAssistant: <assistant message>\n</chat_history>\n<最新用户消息>"
 *    b. 最后一条消息不是user消息：取最后2条消息作为chat_history，放在system_prompt中，
 *       格式为 "<user message>\nAssistant: <assistant message>\n</chat_history>"
 * 3. prompt中会自动拼接Human消息，所以chat_history最多包含2条：user和assistant
 * 4. 最后一个用户消息是最新提问，不属于对话历史
 * 5. 系统消息如果超出SYSTEM_PROMPT_LIMIT则直接返回错误
 * 6. 只有非空内容的消息才会被处理
 */

import { describe, it, expect } from 'vitest';
import { convertMessagesToFalPrompt, OpenAIMessage, SYSTEM_PROMPT_LIMIT } from '../src/index';

describe('convertMessagesToFalPrompt', () => {
	// === 基础测试用例 ===
	
	it('应该正确处理只有系统消息的情况', () => {
		const messages: OpenAIMessage[] = [
			{ role: 'system', content: 'You are a helpful assistant.' }
		];

		const result = convertMessagesToFalPrompt(messages);

		expect(result.system_prompt).toBe('You are a helpful assistant.');
		expect(result.prompt).toBe('');
		expect(result.error).toBeUndefined();
	});

	it('应该正确处理空消息数组', () => {
		const messages: OpenAIMessage[] = [];

		const result = convertMessagesToFalPrompt(messages);

		expect(result.system_prompt).toBe('');
		expect(result.prompt).toBe('');
		expect(result.error).toBeUndefined();
	});

	it('应该正确处理只有用户消息的情况', () => {
		const messages: OpenAIMessage[] = [
			{ role: 'user', content: 'Hello, how are you?' }
		];

		const result = convertMessagesToFalPrompt(messages);

		expect(result.system_prompt).toBe('');
		expect(result.prompt).toBe('Hello, how are you?');
		expect(result.error).toBeUndefined();
	});

	it('应该正确处理最后一条消息不是用户消息的情况', () => {
		const messages: OpenAIMessage[] = [
			{ role: 'user', content: 'Hello' },
			{ role: 'assistant', content: 'Hi there!' }
		];

		const result = convertMessagesToFalPrompt(messages);

		// 倒序遍历至多取3条user/assistant消息放到prompt：Hi there! + Hello
		// 但最后一条消息不是用户消息，按照要求格式处理
		expect(result.system_prompt).toBe('');
		expect(result.prompt).toBe('Hello\nAssistant: Hi there!');
		expect(result.error).toBeUndefined();
	});

	it('应该正确处理有系统消息但最后一条不是用户消息的情况', () => {
		const messages: OpenAIMessage[] = [
			{ role: 'system', content: 'You are a helpful assistant.' },
			{ role: 'user', content: 'Hello' },
			{ role: 'assistant', content: 'Hi there!' }
		];

		const result = convertMessagesToFalPrompt(messages);

		// 倒序遍历至多取3条user/assistant消息放到prompt：Hi there! + Hello
		// 剩余的messages放到system_prompt：system
		// 但最后一条消息不是用户消息，按照要求格式处理
		expect(result.system_prompt).toBe('You are a helpful assistant.');
		expect(result.prompt).toBe('Hello\nAssistant: Hi there!');
		expect(result.error).toBeUndefined();
	});

	// === 核心逻辑测试用例 ===
	
	it('应该正确处理系统消息+用户消息', () => {
		const messages: OpenAIMessage[] = [
			{ role: 'system', content: 'You are a helpful assistant.' },
			{ role: 'user', content: 'What is 2+2?' }
		];

		const result = convertMessagesToFalPrompt(messages);

		expect(result.system_prompt).toBe('You are a helpful assistant.');
		expect(result.prompt).toBe('What is 2+2?');
		expect(result.error).toBeUndefined();
	});

	it('应该正确处理三条消息（用户+助手+用户）- 核心逻辑', () => {
		const messages: OpenAIMessage[] = [
			{ role: 'system', content: 'You are a helpful assistant.' },
			{ role: 'user', content: 'What is 2+2?' },
			{ role: 'assistant', content: '2+2 equals 4.' },
			{ role: 'user', content: 'What about 3+3?' }
		];

		const result = convertMessagesToFalPrompt(messages);

		// 倒序遍历至多取3条user/assistant消息放到prompt：What about 3+3? + 2+2 equals 4. + What is 2+2?
		// 剩余的messages放到system_prompt：system
		expect(result.system_prompt).toBe('You are a helpful assistant.');
		// prompt包含倒序的最后3条消息
		expect(result.prompt).toBe('What is 2+2?\nAssistant: 2+2 equals 4.\nWhat about 3+3?');
		expect(result.error).toBeUndefined();
	});

	it('应该正确处理多条消息，历史对话放在prompt中', () => {
		const messages: OpenAIMessage[] = [
			{ role: 'system', content: 'You are a helpful assistant.' },
			{ role: 'user', content: 'First question' },
			{ role: 'assistant', content: 'First answer' },
			{ role: 'user', content: 'Second question' },
			{ role: 'assistant', content: 'Second answer' },
			{ role: 'user', content: 'Third question' }
		];

		const result = convertMessagesToFalPrompt(messages);

		// 倒序遍历至多取3条user/assistant消息放到prompt：Third question + Second answer + Second question
		// 剩余的messages放到system_prompt：system + First question + First answer
		expect(result.system_prompt).toBe('You are a helpful assistant.\nHuman: First question\nAssistant: First answer');

		// prompt包含倒序的最后3条消息
		expect(result.prompt).toBe('Second question\nAssistant: Second answer\nThird question');
		expect(result.error).toBeUndefined();
	});

	it('应该正确处理null content', () => {
		const messages: OpenAIMessage[] = [
			{ role: 'system', content: null },
			{ role: 'user', content: null },
			{ role: 'assistant', content: null },
			{ role: 'user', content: 'Hello' }
		];

		const result = convertMessagesToFalPrompt(messages);

		// 空消息被过滤后，只剩下最后一条有效的用户消息
		expect(result.system_prompt).toBe('');
		expect(result.prompt).toBe('Hello');
		expect(result.error).toBeUndefined();
	});

	// === 系统消息处理测试 ===
	
	it('应该只使用最后一个系统消息', () => {
		const messages: OpenAIMessage[] = [
			{ role: 'system', content: 'First system message' },
			{ role: 'system', content: 'Second system message' },
			{ role: 'user', content: 'Hello' }
		];

		const result = convertMessagesToFalPrompt(messages);

		expect(result.system_prompt).toBe('Second system message');
		expect(result.prompt).toBe('Hello');
		expect(result.error).toBeUndefined();
	});

	it('应该在系统消息超出限制时返回错误', () => {
		const longSystemMessage = 'a'.repeat(SYSTEM_PROMPT_LIMIT + 100);
		const messages: OpenAIMessage[] = [
			{ role: 'system', content: longSystemMessage },
			{ role: 'user', content: 'Hello' }
		];

		const result = convertMessagesToFalPrompt(messages);

		expect(result.system_prompt).toBe('');
		expect(result.prompt).toBe('');
		expect(result.error).toContain('System message too long');
		expect(result.error).toContain(`${longSystemMessage.length} characters exceeds limit of ${SYSTEM_PROMPT_LIMIT}`);
	});

	// === 字符限制测试用例 ===
	
	it('应该正确处理system_prompt在限值内的情况', () => {
		// 创建一个接近但不超过 4800 字符限制的系统消息
		const systemMessage = 'You are a helpful assistant. '.repeat(150); // 约 4200 字符
		const messages: OpenAIMessage[] = [
			{ role: 'system', content: systemMessage },
			{ role: 'user', content: 'Hello' },
			{ role: 'assistant', content: 'Hi there!' },
			{ role: 'user', content: 'How are you?' }
		];

		const result = convertMessagesToFalPrompt(messages);

		// 验证没有错误，且系统消息被正确处理
		expect(result.error).toBeUndefined();
		expect(result.system_prompt).toBe(systemMessage.trim());
		expect(result.system_prompt.length).toBeLessThanOrEqual(SYSTEM_PROMPT_LIMIT);
		
		// 倒序遍历至多取3条user/assistant消息放到prompt：How are you? + Hi there! + Hello
		expect(result.prompt).toBe('Hello\nAssistant: Hi there!\nHow are you?');
	});

	it('应该正确截断历史消息，选取最后一个assistant，截断 user 消息以适应字符限制', () => {
		// 创建会导致 system_prompt 超过限制的大量历史消息
		const systemMessage = 'You are a helpful assistant.';
		const longMessage = 'This is a very long message that will help us test the truncation behavior. '.repeat(50); // 约 4000 字符
		
		const messages: OpenAIMessage[] = [
			{ role: 'system', content: systemMessage },
			{ role: 'user', content: longMessage },
			{ role: 'assistant', content: longMessage },
			{ role: 'user', content: longMessage },
			{ role: 'assistant', content: longMessage },
			{ role: 'user', content: 'Second question' },
			{ role: 'assistant', content: 'Second answer' },
			{ role: 'user', content: 'Final question' }
		];

		const result = convertMessagesToFalPrompt(messages);

		// 验证没有错误
		expect(result.error).toBeUndefined();
		
		// 验证system_prompt不超过限制
		expect(result.system_prompt.length).toBeLessThanOrEqual(SYSTEM_PROMPT_LIMIT);
		
		// 倒序遍历至多取3条user/assistant消息放到prompt：Final question + Second answer + Second question
		// 剩余的messages放到system_prompt：system + longMessage(user) + longMessage(assistant) + longMessage(user) + longMessage(assistant)
		// 但由于字符限制，system_prompt会被截断，优先保留系统消息
		expect(result.system_prompt).toContain('You are a helpful assistant.');
		// 由于longMessage太长，可能只能包含系统消息和部分assistant消息
		expect(result.system_prompt).toContain('Assistant:');
		
		// prompt包含倒序的最后3条消息
		expect(result.prompt).toBe('Second question\nAssistant: Second answer\nFinal question');
	});

	it('应该在多个系统消息超出限制时仍然只检查最后一个', () => {
		const shortSystemMessage = 'Short system message';
		const longSystemMessage = 'a'.repeat(SYSTEM_PROMPT_LIMIT + 100);
		
		const messages: OpenAIMessage[] = [
			{ role: 'system', content: shortSystemMessage },
			{ role: 'system', content: longSystemMessage }, // 这个会覆盖前面的
			{ role: 'user', content: 'Hello' }
		];

		const result = convertMessagesToFalPrompt(messages);

		expect(result.error).toContain('System message too long');
		expect(result.system_prompt).toBe('');
		expect(result.prompt).toBe('');
	});

	it('应该正确处理复杂的多轮对话场景', () => {
		// 测试真实的多轮对话场景
		const systemMessage = 'You are a helpful AI assistant that provides detailed explanations.';
		const user1 = 'Can you explain how machine learning works?';
		const assistant1 = 'Machine learning is a subset of artificial intelligence that enables computers to learn and improve from experience without being explicitly programmed.';
		const user2 = 'What are the main types of machine learning?';
		const assistant2 = 'There are three main types: supervised learning, unsupervised learning, and reinforcement learning.';
		const user3 = 'Can you give me an example of supervised learning?';
		
		const messages: OpenAIMessage[] = [
			{ role: 'system', content: systemMessage },
			{ role: 'user', content: user1 },
			{ role: 'assistant', content: assistant1 },
			{ role: 'user', content: user2 },
			{ role: 'assistant', content: assistant2 },
			{ role: 'user', content: user3 }
		];

		const result = convertMessagesToFalPrompt(messages);

		// 验证基本正确性
		expect(result.error).toBeUndefined();
		expect(result.system_prompt.length).toBeLessThanOrEqual(SYSTEM_PROMPT_LIMIT);
		
		// 倒序遍历至多取3条user/assistant消息放到prompt：user3 + assistant2 + user2
		// 剩余的messages放到system_prompt：system + user1 + assistant1
		expect(result.system_prompt).toBe(`${systemMessage}\nHuman: ${user1}\nAssistant: ${assistant1}`);
		
		// prompt包含倒序的最后3条消息
		const expectedPrompt = `${user2}\nAssistant: ${assistant2}\n${user3}`;
		expect(result.prompt).toBe(expectedPrompt);
	});

	// === 空内容和异常情况测试 ===

	it('应该正确处理空字符串内容', () => {
		const messages: OpenAIMessage[] = [
			{ role: 'system', content: '' },
			{ role: 'user', content: '' },
			{ role: 'assistant', content: '' },
			{ role: 'user', content: 'Final message' }
		];

		const result = convertMessagesToFalPrompt(messages);

		// 空字符串消息被过滤后，只剩下最后一条有效的用户消息
		expect(result.error).toBeUndefined();
		expect(result.system_prompt).toBe('');
		expect(result.prompt).toBe('Final message');
	});

	it('应该正确处理只有assistant消息结尾的情况', () => {
		const messages: OpenAIMessage[] = [
			{ role: 'user', content: 'Question' },
			{ role: 'assistant', content: 'Answer' }
		];

		const result = convertMessagesToFalPrompt(messages);

		// 倒序遍历至多取3条user/assistant消息放到prompt：Answer + Question
		// 最后一条消息不是用户消息，按照要求格式处理
		expect(result.system_prompt).toBe('');
		expect(result.prompt).toBe('Question\nAssistant: Answer');
		expect(result.error).toBeUndefined();
	});

	it('应该过滤掉空内容消息', () => {
		const messages: OpenAIMessage[] = [
			{ role: 'system', content: 'You are a helpful assistant.' },
			{ role: 'user', content: 'First question' },
			{ role: 'assistant', content: '' }, // 空字符串，应该被过滤
			{ role: 'user', content: null }, // null，应该被过滤
			{ role: 'assistant', content: '   ' }, // 只有空格，应该被过滤
			{ role: 'user', content: 'Final question' }
		];

		const result = convertMessagesToFalPrompt(messages);

		// 空的assistant消息被过滤后，只剩下2条用户消息：First question 和 Final question
		expect(result.system_prompt).toBe('You are a helpful assistant.');
		// 倒序遍历至多取3条消息，这里只有2条：Final question + First question
		expect(result.prompt).toBe('First question\nFinal question');
		expect(result.error).toBeUndefined();
	});
}); 