import {
  LanguageModelV1,
  LanguageModelV1FinishReason,
  LanguageModelV1StreamPart,
} from '@ai-sdk/provider';
import {
  combineHeaders,
  createEventSourceResponseHandler,
  createJsonResponseHandler,
  ParseResult,
  postJsonToApi,
} from '@ai-sdk/provider-utils';
import { openaiFailedResponseHandler } from '../openai-error';
import { z } from 'zod';
import { OpenAIConfig } from '../openai-config';
import { convertToOpenAIResponsesMessages } from './convert-to-openai-responses-messages';
import { OpenAIResponsesModelId } from './openai-responses-settings';

export class OpenAIResponsesLanguageModel implements LanguageModelV1 {
  readonly specificationVersion = 'v1';
  readonly defaultObjectGenerationMode = 'json';

  readonly modelId: OpenAIResponsesModelId;

  private readonly config: OpenAIConfig;

  constructor(
    modelId: OpenAIResponsesModelId,
    // settings: OpenAIChatSettings,
    config: OpenAIConfig,
  ) {
    this.modelId = modelId;
    // this.settings = settings;
    this.config = config;
  }

  get provider(): string {
    return this.config.provider;
  }

  private getArgs({ prompt }: Parameters<LanguageModelV1['doGenerate']>[0]) {
    return {
      args: {
        model: this.modelId,
        input: convertToOpenAIResponsesMessages({ prompt }),
      },
      warnings: [],
    };
  }

  async doGenerate(
    options: Parameters<LanguageModelV1['doGenerate']>[0],
  ): Promise<Awaited<ReturnType<LanguageModelV1['doGenerate']>>> {
    const { args: body, warnings } = this.getArgs(options);

    const {
      responseHeaders,
      value: response,
      rawValue: rawResponse,
    } = await postJsonToApi({
      url: this.config.url({
        path: '/responses',
        modelId: this.modelId,
      }),
      headers: combineHeaders(this.config.headers(), options.headers),
      body,
      failedResponseHandler: openaiFailedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler(
        z.object({
          id: z.string(),
          created_at: z.number(),
          model: z.string(),
          output: z.array(
            z.object({
              type: z.literal('message'),
              role: z.literal('assistant'),
              content: z.array(
                z.object({
                  type: z.literal('output_text'),
                  text: z.string(),
                }),
              ),
            }),
          ),
          usage: z.object({
            input_tokens: z.number(),
            output_tokens: z.number(),
          }),
        }),
      ),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    });

    return {
      // TODO what if there are multiple text parts / messages:
      text: response.output[0].content[0].text,
      finishReason: 'stop',
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
      },
      rawCall: {
        rawPrompt: body, // TODO
        rawSettings: {}, // TODO
      },
      rawResponse: {
        headers: responseHeaders,
        body: rawResponse,
      },
      request: {
        body: JSON.stringify(body),
      },
      response: {
        id: response.id,
        timestamp: new Date(response.created_at * 1000),
        modelId: response.model,
      },
    };
  }

  async doStream(
    options: Parameters<LanguageModelV1['doStream']>[0],
  ): Promise<Awaited<ReturnType<LanguageModelV1['doStream']>>> {
    const { args: body, warnings } = this.getArgs(options);

    const { responseHeaders, value: response } = await postJsonToApi({
      url: this.config.url({
        path: '/responses',
        modelId: this.modelId,
      }),
      headers: combineHeaders(this.config.headers(), options.headers),
      body: {
        ...body,
        stream: true,
      },
      failedResponseHandler: openaiFailedResponseHandler,
      successfulResponseHandler: createEventSourceResponseHandler(
        openaiResponsesChunkSchema,
      ),
      abortSignal: options.abortSignal,
      fetch: this.config.fetch,
    });

    let finishReason: LanguageModelV1FinishReason = 'unknown';
    let usage: { promptTokens: number; completionTokens: number } = {
      promptTokens: NaN,
      completionTokens: NaN,
    };

    return {
      stream: response.pipeThrough(
        new TransformStream<
          ParseResult<z.infer<typeof openaiResponsesChunkSchema>>,
          LanguageModelV1StreamPart
        >({
          transform(chunk, controller) {
            // handle failed chunk parsing / validation:
            if (!chunk.success) {
              finishReason = 'error';
              controller.enqueue({ type: 'error', error: chunk.error });
              return;
            }

            const value = chunk.value;

            if (isTextDeltaChunk(value)) {
              controller.enqueue({
                type: 'text-delta',
                textDelta: value.delta,
              });

              return;
            }

            if (isResponseCompletedChunk(value)) {
              finishReason = 'stop';
              usage = {
                promptTokens: value.response.usage.input_tokens,
                completionTokens: value.response.usage.output_tokens,
              };

              return;
            }
          },

          flush(controller) {
            controller.enqueue({
              type: 'finish',
              finishReason: 'stop',
              usage,
            });
          },
        }),
      ),
      rawCall: {
        rawPrompt: body, // TODO
        rawSettings: {}, // TODO
      },
      rawResponse: { headers: responseHeaders },
      request: { body: JSON.stringify(body) },
      warnings,
    };
  }
}

const textDeltaChunkSchema = z.object({
  type: z.literal('response.output_text.delta'),
  delta: z.string(),
});

const responseCompletedChunkSchema = z.object({
  type: z.literal('response.completed'),
  response: z.object({
    usage: z.object({
      input_tokens: z.number(),
      output_tokens: z.number(),
    }),
  }),
});

const openaiResponsesChunkSchema = z.union([
  textDeltaChunkSchema,
  responseCompletedChunkSchema,
  z.object({ type: z.string() }).passthrough(), // fallback for unknown chunks
]);

function isTextDeltaChunk(
  chunk: z.infer<typeof openaiResponsesChunkSchema>,
): chunk is z.infer<typeof textDeltaChunkSchema> {
  return chunk.type === 'response.output_text.delta';
}

function isResponseCompletedChunk(
  chunk: z.infer<typeof openaiResponsesChunkSchema>,
): chunk is z.infer<typeof responseCompletedChunkSchema> {
  return chunk.type === 'response.completed';
}
