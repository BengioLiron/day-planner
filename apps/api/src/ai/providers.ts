import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, type LanguageModel, type ToolSet } from "ai";
import type { AiConnection } from "@planner/core";

/**
 * Bring your own model: one function turns the user's provider, model id and
 * key into a model object. Everything else (prompts, schemas, parsing) is
 * shared, so GPT, Claude and Gemini behave the same way in the app.
 */
export function modelFor(conn: AiConnection): LanguageModel {
  switch (conn.provider) {
    case "openai":
      return createOpenAI({ apiKey: conn.apiKey })(conn.model);
    case "anthropic":
      return createAnthropic({ apiKey: conn.apiKey })(conn.model);
    case "google":
      return createGoogleGenerativeAI({ apiKey: conn.apiKey })(conn.model);
  }
}

/**
 * Each provider's own web search (and page reading, where offered). They run
 * on the provider's side with the user's key; no other service is involved.
 * They are used in a separate request from the app's own tools, because some
 * providers don't allow built-in search and app tools in the same request.
 */
export function researchToolsFor(conn: AiConnection): ToolSet {
  switch (conn.provider) {
    case "openai":
      return { web_search: createOpenAI({ apiKey: conn.apiKey }).tools.webSearch({}) };
    case "anthropic": {
      const tools = createAnthropic({ apiKey: conn.apiKey }).tools;
      return {
        web_search: tools.webSearch_20260318({ maxUses: 5 }),
        web_fetch: tools.webFetch_20260318({ maxUses: 4 }),
      };
    }
    case "google": {
      const tools = createGoogleGenerativeAI({ apiKey: conn.apiKey }).tools;
      return { google_search: tools.googleSearch({}), url_context: tools.urlContext({}) };
    }
  }
}

/** A tiny request that proves the key and model id work before they are saved. */
export async function testConnection(conn: AiConnection): Promise<void> {
  await generateText({
    model: modelFor(conn),
    prompt: "Reply with the word OK.",
    maxOutputTokens: 16,
    abortSignal: AbortSignal.timeout(20_000),
  });
}

/**
 * Speech-to-text slot for v1.1 voice input. The planner already routes every
 * input through toPlannerText(), so enabling voice means implementing this
 * (e.g. OpenAI transcription or Gemini audio input) and nothing else.
 */
export async function transcribeAudio(
  _conn: AiConnection,
  _audio: { mimeType: string; base64: string },
): Promise<string> {
  throw Object.assign(new Error("Voice input arrives in v1.1."), { status: 501 });
}
