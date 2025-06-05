---
description: 
globs: 
alwaysApply: true
---
# FAL OpenAI CF Proxy Testing Rules

## Testing Framework & Conventions

### Test File Naming
- All test files must use `.test.ts` suffix
- Test files should be located in the `test/` directory

### Testing Standards

#### Character Limit Testing
- **Production Character Limits**: 
  - `SYSTEM_PROMPT_LIMIT = 4800` 
  - **Note**: The actual character length limit is 5000, but 4800 is used with pre-reserved redundancy space
  - **No prompt character limit**: The `prompt` part does not have character restrictions

#### Test Implementation Guidelines
- **Use Source Functions**: Always import and test the actual functions from [src/index.ts](mdc:src/index.ts) rather than implementing duplicate test versions
- **Character Limit Testing**: Use smaller test limits (100, 500, 1000) to simulate character overflow scenarios without using actual production limits
- **Edge Case Coverage**: Include tests for:
  - Empty messages
  - Null content handling
  - System message overflow
  - Message truncation scenarios
  - Boundary conditions

#### Core Function Testing: convertMessagesToFalPrompt

The main function [convertMessagesToFalPrompt](mdc:src/index.ts) implements V3 logic with these characteristics:

1. **System Message Handling**:
   - Only the last system message is used
   - System message length is validated against SYSTEM_PROMPT_LIMIT
   - Returns error if system message exceeds limit

2. **Message Distribution**:
   - **prompt**: Contains last 3 message records (previous user + assistant + current user)  
   - **system_prompt**: Contains system message + earlier chat history (if any)
   - Older messages are truncated if they exceed character limits

3. **Test Coverage Requirements**:
   - Basic message handling (system, user, assistant combinations)
   - Multi-turn conversation scenarios  
   - Character limit enforcement with small test values
   - Null content and edge cases
   - Message truncation behavior

#### Example Test Pattern
```typescript
// Use small limits for testing character overflow
it('应该处理字符限制测试', () => {
  const TEST_LIMIT = 100; // Small test limit
  const longMessage = 'a'.repeat(TEST_LIMIT + 10);
  // Test character overflow handling...
});
```

### Function Import Pattern
Always import from the main source file:
```typescript
import { convertMessagesToFalPrompt, OpenAIMessage, SYSTEM_PROMPT_LIMIT } from '../src/index';
```

### Cloudflare Worker Context
- Framework: Cloudflare Worker + TypeScript
- Configuration: Use `wrangler.jsonc` format for all Cloudflare configurations
- Test environment: Vitest with Cloudflare Workers runtime

## Character Limit Philosophy
- Production limits are set at 4800 to provide safety buffer below the actual 5000 character limit
- Tests should verify truncation and error handling without using production limit values
- Focus on correctness of limit enforcement rather than specific numeric values
