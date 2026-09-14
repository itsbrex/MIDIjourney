const SYSTEM_PROMPT = require("./systemPrompt");
const { PollinationsError } = require("@pollinations/sdk");
const { CONFIG } = require("./config.js");
const {
  MIDI_CLIP_RESPONSE_SCHEMA,
  MidiValidationError,
  parseMidiClipResponse,
} = require("./encoding/midiClip.js");
const { appendHistory, buildContext, buildRequest, explanationWithModel } = require("./history.js");
const { stripSensitiveFields } = require("./sanitize.js");

function generationAbortError() {
  return Object.assign(new Error("Generation canceled."), {
    code: "CANCELED",
    name: "AbortError",
  });
}

function raceWithAbort(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(generationAbortError());

  return new Promise((resolve, reject) => {
    const abort = () => reject(generationAbortError());
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise).then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

function isRetryableGenerationError(error) {
  if (error?.name === "AbortError" || error?.code === "CANCELED" || error?.status === 499) {
    return false;
  }
  return (
    error instanceof PollinationsError &&
    (error.status === 408 || error.status === 429 || error.status >= 500)
  );
}

function retryDelayMs(error, attempt) {
  const providerDelay = Number(error?.retryAfter);
  if (Number.isFinite(providerDelay) && providerDelay > 0) {
    return Math.min(providerDelay * 1000, 5000);
  }
  return Math.min(250 * 2 ** attempt, 1000);
}

function waitWithAbort(milliseconds, signal) {
  if (signal?.aborted) return Promise.reject(generationAbortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, milliseconds);
    function done() {
      signal?.removeEventListener("abort", abort);
      resolve();
    }
    function abort() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(generationAbortError());
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

async function chatWithRetries(client, messages, options) {
  const attempts = Math.max(1, Number(CONFIG.maxRetries) || 1);
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await raceWithAbort(client.chat(messages, options), options.signal);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts - 1 || !isRetryableGenerationError(error)) throw error;
      await waitWithAbort(retryDelayMs(error, attempt), options.signal);
    }
  }
  throw lastError;
}

function classifyGenerationError(error) {
  if (error?.name === "AbortError" || error?.code === "CANCELED") {
    return { code: "CANCELED", message: "Generation canceled." };
  }
  if (error instanceof MidiValidationError) {
    return { code: error.code, message: error.message, details: error.details };
  }
  if (error instanceof PollinationsError) {
    if (error.status === 401) {
      return { code: "AUTHORIZATION_REQUIRED", message: "Reconnect to Pollinations." };
    }
    if (error.status === 402) {
      return { code: "INSUFFICIENT_POLLEN", message: "Your Pollinations balance is too low." };
    }
    if (error.status === 429) {
      return { code: "RATE_LIMITED", message: "Pollinations is busy. Please try again shortly." };
    }
    if (error.status === 400 || error.status === 404) {
      return {
        code: "INVALID_PROVIDER_REQUEST",
        message: "The selected Pollinations model could not accept this MIDI request.",
      };
    }
    if (error.status === 403) {
      return {
        code: "PERMISSION_DENIED",
        message: "This Pollinations connection is not authorized to generate MIDI.",
      };
    }
    if (error.status === 408) {
      return { code: "PROVIDER_TIMEOUT", message: "Pollinations took too long to respond." };
    }
    if (error.status >= 500) {
      return { code: "PROVIDER_UNAVAILABLE", message: "Pollinations is temporarily unavailable." };
    }
    return {
      code: error.code || "POLLINATIONS_ERROR",
      message: "Pollinations could not generate MIDI.",
    };
  }
  return {
    code: error?.code || "GENERATION_ERROR",
    message: error?.message || "MIDI generation failed.",
  };
}

function normalizeModel(model) {
  if (typeof model !== "string") return CONFIG.defaultModel;
  const trimmed = model.trim();
  if (
    !trimmed ||
    trimmed.toLowerCase() === "midijourney" ||
    /^(?:gpt-|o1(?:-|$)|o3(?:-|$)|o4(?:-|$))/i.test(trimmed)
  ) {
    return CONFIG.defaultModel;
  }
  return trimmed.slice(0, 100);
}

function normalizeTemperature(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return CONFIG.defaultTemperature;
  return Math.min(Math.max(number, 0), 2);
}

class PollinationsMidiClient {
  constructor({ auth, onEvent = () => {} } = {}) {
    if (!auth) throw new Error("PollinationsMidiClient requires an auth manager.");
    this.auth = auth;
    this.onEvent = onEvent;
    this.abortController = null;
  }

  async generate(input) {
    this.cancel();
    const abortController = new AbortController();
    this.abortController = abortController;
    const startedAt = Date.now();

    try {
      const client = this.auth.requireClient();
      const safeInput = stripSensitiveFields(input);
      const request = buildRequest(safeInput);
      const messages = [
        { role: "system", content: SYSTEM_PROMPT },
        ...buildContext(safeInput.history, Boolean(safeInput.historyStatus)),
        { role: "user", content: JSON.stringify(request) },
      ];
      const model = normalizeModel(safeInput.gptModel || safeInput.model);
      const temperature = normalizeTemperature(safeInput.temperature);
      this.onEvent({ type: "generation_started", model });

      const response = await chatWithRetries(client, messages, {
        model,
        temperature,
        maxTokens: 12000,
        responseFormat: {
          type: "json_schema",
          json_schema: {
            name: "midi_clip",
            description: "A complete MIDI clip for Ableton Live",
            strict: true,
            schema: MIDI_CLIP_RESPONSE_SCHEMA,
          },
        },
        signal: abortController.signal,
      });

      if (abortController.signal.aborted || this.abortController !== abortController) {
        throw Object.assign(new Error("Generation canceled."), { name: "AbortError" });
      }

      const content = response?.choices?.[0]?.message?.content;
      const clip = parseMidiClipResponse(content);
      // Use response metadata, not the requested alias or model-generated prose.
      // Missing metadata stays explicitly unknown; it must not imply a model ran.
      const reportedModel = response.model ?? null;
      const result = {
        ...safeInput,
        history: appendHistory(safeInput.history, request, clip, reportedModel),
        title: clip.title,
        explanation: explanationWithModel(clip.explanation, reportedModel),
        key: clip.key,
        duration: clip.duration,
        notes: clip.notes,
      };
      this.onEvent({
        type: "generation_completed",
        model: response.model || model,
        durationMs: Date.now() - startedAt,
        usage: response.usage || null,
      });
      this.clearCurrentOperation(abortController);
      return result;
    } catch (error) {
      const wasCurrentOperation = this.abortController === abortController;
      this.clearCurrentOperation(abortController);
      // A superseded request is canceled regardless of the provider error
      // that happens to arrive later. Otherwise an old 401 can invalidate the
      // authorization used by a newer request and surface a stale error in UI.
      const safeError =
        abortController.signal.aborted || !wasCurrentOperation
          ? { code: "CANCELED", message: "Generation canceled." }
          : classifyGenerationError(error);
      if (safeError.code === "AUTHORIZATION_REQUIRED" && wasCurrentOperation) {
        await this.invalidateAuthorization(safeError);
      }
      this.onEvent({ type: "generation_failed", error: safeError });
      throw Object.assign(new Error(safeError.message), safeError);
    }
  }

  clearCurrentOperation(abortController) {
    if (this.abortController === abortController) this.abortController = null;
  }

  async invalidateAuthorization(error) {
    try {
      if (typeof this.auth.invalidate === "function") {
        await this.auth.invalidate(error);
      } else if (typeof this.auth.disconnect === "function") {
        await this.auth.disconnect();
      }
    } catch {
      // Keep the original authorization error actionable even if local
      // credential cleanup fails; the auth manager reports its own safe state.
    }
  }

  cancel() {
    const abortController = this.abortController;
    if (!abortController) return;
    abortController.abort();
    this.clearCurrentOperation(abortController);
  }

  async models() {
    const client = this.auth.requireClient();
    const models = await client.textModels();
    return models.map((model) => ({
      name: model.name,
      description: model.description || "",
      tier: model.tier || null,
      contextLength: model.context_length || null,
      supportsSystemMessages: model.supportsSystemMessages !== false,
    }));
  }
}

exports.PollinationsMidiClient = PollinationsMidiClient;
exports.chatWithRetries = chatWithRetries;
exports.classifyGenerationError = classifyGenerationError;
exports.isRetryableGenerationError = isRetryableGenerationError;
exports.normalizeModel = normalizeModel;
exports.normalizeTemperature = normalizeTemperature;
exports.raceWithAbort = raceWithAbort;
