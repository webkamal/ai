import { jsonSchema } from '@ai-sdk/ui-utils';
import assert from 'node:assert';
import { z } from 'zod';
import { setTestTracer } from '../telemetry/get-tracer';
import { MockLanguageModelV1 } from '../test/mock-language-model-v1';
import { MockTracer } from '../test/mock-tracer';
import { generateText } from './generate-text';
import { GenerateTextResult } from './generate-text-result';
import { StepResult } from './step-result';
import { getEffectiveAbortSignal } from '../../util/get-effective-abort-signal';

const dummyResponseValues = {
  rawCall: { rawPrompt: 'prompt', rawSettings: {} },
  finishReason: 'stop' as const,
  usage: { promptTokens: 10, completionTokens: 20 },
};

describe('result.text', () => {
  it('should generate text', async () => {
    const result = await generateText({
      model: new MockLanguageModelV1({
        doGenerate: async ({ prompt, mode }) => {
          assert.deepStrictEqual(mode, {
            type: 'regular',
            tools: undefined,
            toolChoice: undefined,
          });
          assert.deepStrictEqual(prompt, [
            { role: 'user', content: [{ type: 'text', text: 'prompt' }] },
          ]);

          return {
            ...dummyResponseValues,
            text: `Hello, world!`,
          };
        },
      }),
      prompt: 'prompt',
    });

    assert.deepStrictEqual(result.text, 'Hello, world!');
  });
});

describe('result.toolCalls', () => {
  it('should contain tool calls', async () => {
    const result = await generateText({
      model: new MockLanguageModelV1({
        doGenerate: async ({ prompt, mode }) => {
          assert.deepStrictEqual(mode, {
            type: 'regular',
            toolChoice: { type: 'required' },
            tools: [
              {
                type: 'function',
                name: 'tool1',
                description: undefined,
                parameters: {
                  $schema: 'http://json-schema.org/draft-07/schema#',
                  additionalProperties: false,
                  properties: { value: { type: 'string' } },
                  required: ['value'],
                  type: 'object',
                },
              },
              {
                type: 'function',
                name: 'tool2',
                description: undefined,
                parameters: {
                  $schema: 'http://json-schema.org/draft-07/schema#',
                  additionalProperties: false,
                  properties: { somethingElse: { type: 'string' } },
                  required: ['somethingElse'],
                  type: 'object',
                },
              },
            ],
          });
          assert.deepStrictEqual(prompt, [
            { role: 'user', content: [{ type: 'text', text: 'test-input' }] },
          ]);

          return {
            ...dummyResponseValues,
            toolCalls: [
              {
                toolCallType: 'function',
                toolCallId: 'call-1',
                toolName: 'tool1',
                args: `{ "value": "value" }`,
              },
            ],
          };
        },
      }),
      tools: {
        tool1: {
          parameters: z.object({ value: z.string() }),
        },
        // 2nd tool to show typing:
        tool2: {
          parameters: z.object({ somethingElse: z.string() }),
        },
      },
      toolChoice: 'required',
      prompt: 'test-input',
    });

    // test type inference
    if (result.toolCalls[0].toolName === 'tool1') {
      assertType<string>(result.toolCalls[0].args.value);
    }

    assert.deepStrictEqual(result.toolCalls, [
      {
        type: 'tool-call',
        toolCallId: 'call-1',
        toolName: 'tool1',
        args: { value: 'value' },
      },
    ]);
  });
});

describe('result.toolResults', () => {
  it('should contain tool results', async () => {
    const result = await generateText({
      model: new MockLanguageModelV1({
        doGenerate: async ({ prompt, mode }) => {
          assert.deepStrictEqual(mode, {
            type: 'regular',
            toolChoice: { type: 'auto' },
            tools: [
              {
                type: 'function',
                name: 'tool1',
                description: undefined,
                parameters: {
                  $schema: 'http://json-schema.org/draft-07/schema#',
                  additionalProperties: false,
                  properties: { value: { type: 'string' } },
                  required: ['value'],
                  type: 'object',
                },
              },
            ],
          });
          assert.deepStrictEqual(prompt, [
            { role: 'user', content: [{ type: 'text', text: 'test-input' }] },
          ]);

          return {
            ...dummyResponseValues,
            toolCalls: [
              {
                toolCallType: 'function',
                toolCallId: 'call-1',
                toolName: 'tool1',
                args: `{ "value": "value" }`,
              },
            ],
          };
        },
      }),
      tools: {
        tool1: {
          parameters: z.object({ value: z.string() }),
          execute: async args => {
            assert.deepStrictEqual(args, { value: 'value' });
            return 'result1';
          },
        },
      },
      prompt: 'test-input',
    });

    // test type inference
    if (result.toolResults[0].toolName === 'tool1') {
      assertType<string>(result.toolResults[0].result);
    }

    assert.deepStrictEqual(result.toolResults, [
      {
        toolCallId: 'call-1',
        toolName: 'tool1',
        args: { value: 'value' },
        result: 'result1',
      },
    ]);
  });
});

describe('result.providerMetadata', () => {
  it('should contain provider metadata', async () => {
    const result = await generateText({
      model: new MockLanguageModelV1({
        doGenerate: async () => ({
          ...dummyResponseValues,
          providerMetadata: {
            anthropic: {
              cacheCreationInputTokens: 10,
              cacheReadInputTokens: 20,
            },
          },
        }),
      }),
      prompt: 'test-input',
    });

    assert.deepStrictEqual(result.experimental_providerMetadata, {
      anthropic: {
        cacheCreationInputTokens: 10,
        cacheReadInputTokens: 20,
      },
    });
  });
});

describe('result.responseMessages', () => {
  it('should contain assistant response message when there are no tool calls', async () => {
    const result = await generateText({
      model: new MockLanguageModelV1({
        doGenerate: async () => ({
          ...dummyResponseValues,
          text: 'Hello, world!',
        }),
      }),
      prompt: 'test-input',
    });

    expect(result.responseMessages).toMatchSnapshot();
  });

  it('should contain assistant response message and tool message when there are tool calls with results', async () => {
    const result = await generateText({
      model: new MockLanguageModelV1({
        doGenerate: async () => ({
          ...dummyResponseValues,
          text: 'Hello, world!',
          toolCalls: [
            {
              toolCallType: 'function',
              toolCallId: 'call-1',
              toolName: 'tool1',
              args: `{ "value": "value" }`,
            },
          ],
          toolResults: [
            {
              toolCallId: 'call-1',
              toolName: 'tool1',
              args: { value: 'value' },
              result: 'result1',
            },
          ],
        }),
      }),
      tools: {
        tool1: {
          parameters: z.object({ value: z.string() }),
          execute: async args => {
            assert.deepStrictEqual(args, { value: 'value' });
            return 'result1';
          },
        },
      },
      prompt: 'test-input',
    });

    expect(result.responseMessages).toMatchSnapshot();
  });
});

describe('options.maxSteps', () => {
  describe('2 steps', () => {
    let result: GenerateTextResult<any>;
    let onStepFinishResults: StepResult<any>[];

    beforeEach(async () => {
      onStepFinishResults = [];

      let responseCount = 0;
      result = await generateText({
        model: new MockLanguageModelV1({
          doGenerate: async ({ prompt, mode }) => {
            switch (responseCount++) {
              case 0:
                expect(mode).toStrictEqual({
                  type: 'regular',
                  toolChoice: { type: 'auto' },
                  tools: [
                    {
                      type: 'function',
                      name: 'tool1',
                      description: undefined,
                      parameters: {
                        $schema: 'http://json-schema.org/draft-07/schema#',
                        additionalProperties: false,
                        properties: { value: { type: 'string' } },
                        required: ['value'],
                        type: 'object',
                      },
                    },
                  ],
                });

                expect(prompt).toStrictEqual([
                  {
                    role: 'user',
                    content: [{ type: 'text', text: 'test-input' }],
                  },
                ]);

                return {
                  ...dummyResponseValues,
                  toolCalls: [
                    {
                      toolCallType: 'function',
                      toolCallId: 'call-1',
                      toolName: 'tool1',
                      args: `{ "value": "value" }`,
                    },
                  ],
                  toolResults: [
                    {
                      toolCallId: 'call-1',
                      toolName: 'tool1',
                      args: { value: 'value' },
                      result: 'result1',
                    },
                  ],
                  finishReason: 'tool-calls',
                  usage: {
                    completionTokens: 5,
                    promptTokens: 10,
                    totalTokens: 15,
                  },
                  response: {
                    id: 'test-id-1-from-model',
                    timestamp: new Date(0),
                    modelId: 'test-response-model-id',
                  },
                };
              case 1:
                expect(mode).toStrictEqual({
                  type: 'regular',
                  toolChoice: { type: 'auto' },
                  tools: [
                    {
                      type: 'function',
                      name: 'tool1',
                      description: undefined,
                      parameters: {
                        $schema: 'http://json-schema.org/draft-07/schema#',
                        additionalProperties: false,
                        properties: { value: { type: 'string' } },
                        required: ['value'],
                        type: 'object',
                      },
                    },
                  ],
                });

                expect(prompt).toStrictEqual([
                  {
                    role: 'user',
                    content: [
                      {
                        type: 'text',
                        text: 'test-input',
                      },
                    ],
                  },
                  {
                    role: 'assistant',
                    content: [
                      {
                        type: 'tool-call',
                        toolCallId: 'call-1',
                        toolName: 'tool1',
                        args: { value: 'value' },
                        providerMetadata: undefined,
                      },
                    ],
                    providerMetadata: undefined,
                  },
                  {
                    role: 'tool',
                    content: [
                      {
                        type: 'tool-result',
                        toolCallId: 'call-1',
                        toolName: 'tool1',
                        result: 'result1',
                        providerMetadata: undefined,
                      },
                    ],
                    providerMetadata: undefined,
                  },
                ]);
                return {
                  ...dummyResponseValues,
                  text: 'Hello, world!',
                  response: {
                    id: 'test-id-2-from-model',
                    timestamp: new Date(10000),
                    modelId: 'test-response-model-id',
                  },
                  rawResponse: {
                    headers: {
                      'custom-response-header': 'response-header-value',
                    },
                  },
                };
              default:
                throw new Error(`Unexpected response count: ${responseCount}`);
            }
          },
        }),
        tools: {
          tool1: {
            parameters: z.object({ value: z.string() }),
            execute: async (args: any) => {
              assert.deepStrictEqual(args, { value: 'value' });
              return 'result1';
            },
          },
        },
        prompt: 'test-input',
        maxSteps: 3,
        onStepFinish: async event => {
          onStepFinishResults.push(event);
        },
      });
    });

    it('result.text should return text from last step', async () => {
      assert.deepStrictEqual(result.text, 'Hello, world!');
    });

    it('result.toolCalls should return empty tool calls from last step', async () => {
      assert.deepStrictEqual(result.toolCalls, []);
    });

    it('result.toolResults should return empty tool results from last step', async () => {
      assert.deepStrictEqual(result.toolResults, []);
    });

    it('result.responseMessages should contain response messages from all steps', () => {
      expect(result.responseMessages).toMatchSnapshot();
    });

    it('result.usage should sum token usage', () => {
      assert.deepStrictEqual(result.usage, {
        completionTokens: 25,
        promptTokens: 20,
        totalTokens: 45,
      });
    });

    it('result.steps should contain all steps', () => {
      expect(result.steps).toMatchSnapshot();
    });

    it('onStepFinish should be called for each step', () => {
      expect(onStepFinishResults).toMatchSnapshot();
    });
  });
});

describe('result.response', () => {
  it('should contain response information', async () => {
    const result = await generateText({
      model: new MockLanguageModelV1({
        doGenerate: async ({ prompt, mode }) => {
          assert.deepStrictEqual(mode, {
            type: 'regular',
            tools: undefined,
            toolChoice: undefined,
          });
          assert.deepStrictEqual(prompt, [
            { role: 'user', content: [{ type: 'text', text: 'prompt' }] },
          ]);

          return {
            ...dummyResponseValues,
            text: `Hello, world!`,
            response: {
              id: 'test-id-from-model',
              timestamp: new Date(10000),
              modelId: 'test-response-model-id',
            },
            rawResponse: {
              headers: {
                'custom-response-header': 'response-header-value',
              },
            },
          };
        },
      }),
      prompt: 'prompt',
    });

    expect(result.response).toStrictEqual({
      id: 'test-id-from-model',
      timestamp: new Date(10000),
      modelId: 'test-response-model-id',
      headers: {
        'custom-response-header': 'response-header-value',
      },
    });
  });
});

describe('options.headers', () => {
  it('should pass headers to model', async () => {
    const result = await generateText({
      model: new MockLanguageModelV1({
        doGenerate: async ({ headers }) => {
          assert.deepStrictEqual(headers, {
            'custom-request-header': 'request-header-value',
          });

          return {
            ...dummyResponseValues,
            text: 'Hello, world!',
          };
        },
      }),
      prompt: 'test-input',
      headers: { 'custom-request-header': 'request-header-value' },
    });

    assert.deepStrictEqual(result.text, 'Hello, world!');
  });
});

describe('options.providerMetadata', () => {
  it('should pass provider metadata to model', async () => {
    const result = await generateText({
      model: new MockLanguageModelV1({
        doGenerate: async ({ providerMetadata }) => {
          expect(providerMetadata).toStrictEqual({
            aProvider: { someKey: 'someValue' },
          });

          return { ...dummyResponseValues, text: 'provider metadata test' };
        },
      }),
      prompt: 'test-input',
      experimental_providerMetadata: {
        aProvider: { someKey: 'someValue' },
      },
    });

    expect(result.text).toStrictEqual('provider metadata test');
  });
});

describe('telemetry', () => {
  let tracer: MockTracer;

  beforeEach(() => {
    tracer = new MockTracer();
    setTestTracer(tracer);
  });

  afterEach(() => {
    setTestTracer(undefined);
  });

  it('should not record any telemetry data when not explicitly enabled', async () => {
    await generateText({
      model: new MockLanguageModelV1({
        doGenerate: async ({}) => ({
          ...dummyResponseValues,
          text: `Hello, world!`,
        }),
      }),
      prompt: 'prompt',
    });

    expect(tracer.jsonSpans).toMatchSnapshot();
  });

  it('should record telemetry data when enabled', async () => {
    await generateText({
      model: new MockLanguageModelV1({
        doGenerate: async ({}) => ({
          ...dummyResponseValues,
          text: `Hello, world!`,
          response: {
            id: 'test-id-from-model',
            timestamp: new Date(10000),
            modelId: 'test-response-model-id',
          },
        }),
      }),
      prompt: 'prompt',
      topK: 0.1,
      topP: 0.2,
      frequencyPenalty: 0.3,
      presencePenalty: 0.4,
      temperature: 0.5,
      stopSequences: ['stop'],
      headers: {
        header1: 'value1',
        header2: 'value2',
      },
      experimental_telemetry: {
        isEnabled: true,
        functionId: 'test-function-id',
        metadata: {
          test1: 'value1',
          test2: false,
        },
      },
    });

    expect(tracer.jsonSpans).toMatchSnapshot();
  });

  it('should record successful tool call', async () => {
    await generateText({
      model: new MockLanguageModelV1({
        doGenerate: async ({}) => ({
          ...dummyResponseValues,
          toolCalls: [
            {
              toolCallType: 'function',
              toolCallId: 'call-1',
              toolName: 'tool1',
              args: `{ "value": "value" }`,
            },
          ],
        }),
      }),
      tools: {
        tool1: {
          parameters: z.object({ value: z.string() }),
          execute: async () => 'result1',
        },
      },
      prompt: 'test-input',
      experimental_telemetry: {
        isEnabled: true,
      },
      _internal: {
        generateId: () => 'test-id',
        currentDate: () => new Date(0),
      },
    });

    expect(tracer.jsonSpans).toMatchSnapshot();
  });

  it('should not record telemetry inputs / outputs when disabled', async () => {
    await generateText({
      model: new MockLanguageModelV1({
        doGenerate: async ({}) => ({
          ...dummyResponseValues,
          toolCalls: [
            {
              toolCallType: 'function',
              toolCallId: 'call-1',
              toolName: 'tool1',
              args: `{ "value": "value" }`,
            },
          ],
        }),
      }),
      tools: {
        tool1: {
          parameters: z.object({ value: z.string() }),
          execute: async () => 'result1',
        },
      },
      prompt: 'test-input',
      experimental_telemetry: {
        isEnabled: true,
        recordInputs: false,
        recordOutputs: false,
      },
      _internal: {
        generateId: () => 'test-id',
        currentDate: () => new Date(0),
      },
    });

    expect(tracer.jsonSpans).toMatchSnapshot();
  });
});

describe('tools with custom schema', () => {
  it('should contain tool calls', async () => {
    const result = await generateText({
      model: new MockLanguageModelV1({
        doGenerate: async ({ prompt, mode }) => {
          assert.deepStrictEqual(mode, {
            type: 'regular',
            toolChoice: { type: 'required' },
            tools: [
              {
                type: 'function',
                name: 'tool1',
                description: undefined,
                parameters: {
                  additionalProperties: false,
                  properties: { value: { type: 'string' } },
                  required: ['value'],
                  type: 'object',
                },
              },
              {
                type: 'function',
                name: 'tool2',
                description: undefined,
                parameters: {
                  additionalProperties: false,
                  properties: { somethingElse: { type: 'string' } },
                  required: ['somethingElse'],
                  type: 'object',
                },
              },
            ],
          });
          assert.deepStrictEqual(prompt, [
            { role: 'user', content: [{ type: 'text', text: 'test-input' }] },
          ]);

          return {
            ...dummyResponseValues,
            toolCalls: [
              {
                toolCallType: 'function',
                toolCallId: 'call-1',
                toolName: 'tool1',
                args: `{ "value": "value" }`,
              },
            ],
          };
        },
      }),
      tools: {
        tool1: {
          parameters: jsonSchema<{ value: string }>({
            type: 'object',
            properties: { value: { type: 'string' } },
            required: ['value'],
            additionalProperties: false,
          }),
        },
        // 2nd tool to show typing:
        tool2: {
          parameters: jsonSchema<{ somethingElse: string }>({
            type: 'object',
            properties: { somethingElse: { type: 'string' } },
            required: ['somethingElse'],
            additionalProperties: false,
          }),
        },
      },
      toolChoice: 'required',
      prompt: 'test-input',
      _internal: {
        generateId: () => 'test-id',
        currentDate: () => new Date(0),
      },
    });

    // test type inference
    if (result.toolCalls[0].toolName === 'tool1') {
      assertType<string>(result.toolCalls[0].args.value);
    }

    assert.deepStrictEqual(result.toolCalls, [
      {
        type: 'tool-call',
        toolCallId: 'call-1',
        toolName: 'tool1',
        args: { value: 'value' },
      },
    ]);
  });
});



describe('result.text.timeout', () => {
  const createDelayedModel = (delay: number) => new MockLanguageModelV1({
    doGenerate: async ({ abortSignal }) => {
      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          resolve({
            ...dummyResponseValues,
            text: `Completed after ${delay}ms`,
          });
        }, delay);

        if (abortSignal?.aborted) {
          clearTimeout(timeoutId);
          reject(new Error('AbortError'));
        }

        abortSignal?.addEventListener('abort', () => {
          clearTimeout(timeoutId);
          reject(new Error('AbortError'));
        });
      });
    },
  });

  const runWithTimeout = async (delay: number, timeout: number | undefined) => {
    const startTime = Date.now();
    try {
      const result = await generateText({
        model: createDelayedModel(delay),
        prompt: 'prompt',
        timeout: timeout,
      });
      const duration = Date.now() - startTime;
      return { success: true, result, duration };
    } catch (error) {
      const duration = Date.now() - startTime;
      return { success: false, error, duration };
    }
  };

  it('should timeout when response takes too long', async () => {
    const { success, error, duration } = await runWithTimeout(200, 100);
    assert(!success, 'Expected timeout, but got success');
    assert(duration >= 100 && duration < 200, `Unexpected duration for timeout: ${duration}ms`);
    assert(error instanceof Error && /timeout|abort/i.test(error.message), 'Expected timeout or abort error');
  });

  it('should complete just before timeout', async () => {
    const { success, result, duration } = await runWithTimeout(95, 100);
    assert(success, 'Expected success, but got timeout');
    assert(duration < 150, `Generation took too long: ${duration}ms`);
    assert.strictEqual(result?.text, 'Completed after 95ms');
  });

  it('should complete well before timeout', async () => {
    const { success, result, duration } = await runWithTimeout(50, 100);
    assert(success, 'Expected success, but got timeout');
    assert(duration < 100, `Generation took too long: ${duration}ms`);
    assert.strictEqual(result?.text, 'Completed after 50ms');
  });

  it('should handle very short timeouts', async () => {
    const { success, error, duration } = await runWithTimeout(50, 1);
    assert(!success, 'Expected timeout, but got success');
    assert(duration >= 1 && duration < 100, `Unexpected duration for timeout: ${duration}ms`);
    assert(error instanceof Error && /timeout|abort/i.test(error.message), 'Expected timeout or abort error');
  });

  it('should not timeout with no specified timeout', async () => {
    const { success, result, duration } = await runWithTimeout(500, undefined);
    assert(success, 'Expected success, but got timeout');
    assert(duration >= 500 && duration < 600, `Unexpected duration: ${duration}ms`);
    assert.strictEqual(result?.text, 'Completed after 500ms');
  });

  it('should treat zero timeout as no timeout', async () => {
    const delay = 50; // ms
    const { success, result, duration } = await runWithTimeout(delay, 0);
    
    assert(success, 'Expected success with zero timeout (treated as no timeout)');
    assert(duration >= delay && duration < delay + 50, `Unexpected duration: ${duration}ms`);
    assert.strictEqual(result?.text, `Completed after ${delay}ms`);
  });
  it('should behave the same with zero timeout and undefined timeout', async () => {
    const delay = 100; // ms
    const zeroTimeoutResult = await runWithTimeout(delay, 0);
    const noTimeoutResult = await runWithTimeout(delay, undefined);

    assert(zeroTimeoutResult.success && noTimeoutResult.success, 'Both should succeed');
    assert.strictEqual(zeroTimeoutResult?.result?.text, noTimeoutResult?.result?.text, 'Results should be the same');
    assert(Math.abs(zeroTimeoutResult.duration - noTimeoutResult.duration) < 20, 'Durations should be similar');
  });

  it('should allow long operations with zero timeout', async () => {
    const delay = 500; // ms
    const { success, result, duration } = await runWithTimeout(delay, 0);
    
    assert(success, 'Expected success with zero timeout on long operation');
    assert(duration >= delay && duration < delay + 100, `Unexpected duration: ${duration}ms`);
    assert.strictEqual(result?.text, `Completed after ${delay}ms`);
  });

});


describe('result.text.timeout.abortsignal', () => {

  const runWithTimeoutAndSignal = async (delay: number, timeout: number | undefined, abortSignal?: AbortSignal) => {
    const startTime = Date.now();
    try {
      const { signal: effectiveAbortSignal, clearTimeout: clearEffectiveTimeout } = getEffectiveAbortSignal(abortSignal, timeout);
      
      const result = await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          resolve({
            ...dummyResponseValues,
            text: `Completed after ${delay}ms`,
          });
        }, delay);

        effectiveAbortSignal?.addEventListener('abort', () => {
          clearTimeout(timeoutId);
          reject(new Error('AbortError'));
        });

        if (effectiveAbortSignal?.aborted) {
          clearTimeout(timeoutId);
          reject(new Error('AbortError'));
        }
      });

      clearEffectiveTimeout();
      const duration = Date.now() - startTime;
      return { success: true, result, duration };
    } catch (error) {
      const duration = Date.now() - startTime;
      return { success: false, error, duration };
    }
  };

  it('should use provided abort signal when no timeout is set', async () => {
    const abortController = new AbortController();
    setTimeout(() => abortController.abort(), 50);

    const { success, error, duration } = await runWithTimeoutAndSignal(200, undefined, abortController.signal);

    assert(!success, 'Expected abort, but got success');
    assert(duration < 100, `Abort took too long: ${duration}ms`);
    assert(error instanceof Error && error.message === 'AbortError', 'Expected AbortError');
  });

  it('should use abort signal when both timeout and abort signal are provided', async () => {
    const abortController = new AbortController();
    setTimeout(() => abortController.abort(), 50);

    const { success, error, duration } = await runWithTimeoutAndSignal(200, 100, abortController.signal);

    assert(!success, 'Expected abort, but got success');
    assert(duration < 100, `Abort took too long: ${duration}ms`);
    assert(error instanceof Error && error.message === 'AbortError', 'Expected AbortError');
  });


  it('should handle immediate abort', async () => {
    const abortController = new AbortController();
    abortController.abort(); // Abort immediately

    const { success, error, duration } = await runWithTimeoutAndSignal(200, undefined, abortController.signal);

    assert(!success, 'Expected immediate abort, but got success');
    assert(duration < 50, `Abort took too long: ${duration}ms`);
    assert(error instanceof Error && error.message === 'AbortError', 'Expected AbortError');
  });
});