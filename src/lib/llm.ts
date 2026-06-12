import OpenAI from "openai";
import { LLM_MODEL } from "@/lib/config";

let client: OpenAI | null = null;
let model: string | null = null;
let reasoningEffort: "none" | "minimal" = "none";

function init(): void {
  const vertexKey = process.env.VERTEX_API_KEY;
  const vertexProject = process.env.VERTEX_PROJECT_NUMBER;
  if (vertexKey && vertexProject) {
    // Vertex AI express mode. Auth is x-goog-api-key only — the SDK's default
    // Authorization: Bearer header gets a 401, so it must be stripped.
    // Models must be addressed as "google/<model>".
    client = new OpenAI({
      apiKey: vertexKey,
      baseURL: `https://aiplatform.googleapis.com/v1beta1/projects/${vertexProject}/locations/global/endpoints/openapi`,
      defaultHeaders: { "x-goog-api-key": vertexKey, Authorization: null },
    });
    model = `google/${LLM_MODEL}`;
    // Vertex rejects reasoning_effort:"none" (AI Studio-only value).
    reasoningEffort = "minimal";
    return;
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Neither VERTEX_API_KEY+VERTEX_PROJECT_NUMBER nor GEMINI_API_KEY is set");
  }
  client = new OpenAI({
    apiKey,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
  });
  model = LLM_MODEL;
}

export function getLLM(): OpenAI {
  if (!client) init();
  return client!;
}

export function getLLMModel(): string {
  if (!model) init();
  return model!;
}

export function getLLMReasoningEffort(): "none" | "minimal" {
  if (!client) init();
  return reasoningEffort;
}
