import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { ChatOpenAI } from '@langchain/openai';
import type { Embeddings } from '@langchain/core/embeddings';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { Config } from './config.js';

export function createEmbeddings(config: Config): Embeddings {
  return new GoogleGenerativeAIEmbeddings({
    model: config.embedModel,
    apiKey: config.geminiApiKey,
    maxRetries: 5,
  });
}

/**
 * Generation via OpenRouter (OpenAI-compatible). Model and base URL are config, so models are
 * swapped by env — that is the provider-agnostic seam (Bedrock was blocked by the NUS org SCP).
 */
export function createChatModel(config: Config): BaseChatModel {
  return new ChatOpenAI({
    model: config.genModel,
    apiKey: config.openRouterApiKey,
    temperature: 0,
    maxTokens: 512,
    maxRetries: 3,
    configuration: { baseURL: config.openRouterBaseUrl },
  });
}
