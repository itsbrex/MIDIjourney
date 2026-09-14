const test = require("node:test");
const assert = require("node:assert/strict");
const { PollinationsError } = require("@pollinations/sdk");
const {
  PollinationsMidiClient,
  chatWithRetries,
  classifyGenerationError,
} = require("../pollinationsClient.js");

function createHarness(responseOverride) {
  const calls = [];
  const response =
    responseOverride ||
    {
      model: "openai",
      choices: [
        {
          message: {
            content: JSON.stringify({
              title: "Broken Beat",
              explanation: "A syncopated drum pattern.",
              key: null,
              duration: 4,
              notes: [
                { pitch: 36, start_time: 0, duration: 0.25, velocity: 110 },
                { pitch: 38, start_time: 1.5, duration: 0.25, velocity: 96 },
              ],
            }),
          },
        },
      ],
      usage: { total_tokens: 100 },
    };
  const client = {
    chat: async (...args) => {
      calls.push(args);
      return response;
    },
    textModels: async () => [
      { name: "midijourney", description: "Music model", context_length: 32000 },
    ],
  };
  const auth = { requireClient: () => client };
  return { auth, calls, response };
}

test("generates strict structured MIDI and removes legacy API keys", async () => {
  const { auth, calls } = createHarness();
  const events = [];
  const generator = new PollinationsMidiClient({ auth, onEvent: (event) => events.push(event) });
  const result = await generator.generate({
    promptText: "Create broken beat drums",
    duration: 4,
    temperature: 0.8,
    gptModel: "openai",
    history: [],
    historyStatus: true,
    apiKey: "must-not-survive",
  });

  assert.equal(result.notes.length, 2);
  assert.equal(result.apiKey, undefined);
  assert.equal(result.history.length, 2);
  assert.equal(calls[0][0][0].role, "system");
  assert.equal(calls[0][1].responseFormat.type, "json_schema");
  assert.equal(events.at(-1).type, "generation_completed");
  assert.equal(result.explanation, "A syncopated drum pattern.\n\nModel: openai");
});

test("appends the response model to explanation and display history without changing request context", async () => {
  const { auth, calls, response } = createHarness();
  response.model = "openai/gpt-6-astra";
  const generator = new PollinationsMidiClient({ auth });
  const result = await generator.generate({ promptText: "Create MIDI", gptModel: "openai" });
  assert.equal(calls[0][1].model, "openai");
  assert.equal(result.explanation, "A syncopated drum pattern.\n\nModel: openai/gpt-6-astra");
  assert.match(result.history[1].content, /explanation: >-\n  A syncopated drum pattern\.  Model: openai\/gpt-6-astra\nnotation:/);
  assert.equal(JSON.parse(result.history[1].contextContent).explanation, "A syncopated drum pattern.");

  response.model = "another-serving-model";
  const next = await generator.generate({ promptText: "Continue", history: result.history, historyStatus: true });
  assert.equal(next.explanation, "A syncopated drum pattern.\n\nModel: another-serving-model");
  assert.match(next.history[1].content, /Model: openai\/gpt-6-astra/);
  assert.match(next.history[3].content, /Model: another-serving-model/);
  assert.ok(calls[1][0].every(message => !message.content.includes("Model: ")));
});

test("missing or malformed response model is not misrepresented as the requested model", async () => {
  const { auth, response } = createHarness();
  const generator = new PollinationsMidiClient({ auth });
  for (const model of [undefined, null, "", " \n ", 42, { name: "not-a-model-string" }]) {
    response.model = model;
    const result = await generator.generate({ promptText: "Create MIDI", gptModel: "openai" });
    assert.equal(result.explanation, "A syncopated drum pattern.\n\nModel: not reported");
    assert.match(result.history[1].content, /Model: not reported/);
  }
});

test("model attribution survives a maximum-length explanation and remains single-line metadata", async () => {
  const { auth, response } = createHarness();
  response.model = "  provider/model\nversion\t1  ";
  const clip = JSON.parse(response.choices[0].message.content);
  clip.explanation = "x".repeat(1000);
  response.choices[0].message.content = JSON.stringify(clip);
  const result = await new PollinationsMidiClient({ auth }).generate({ promptText: "Create MIDI" });
  assert.equal(result.explanation, `${clip.explanation}\n\nModel: provider/model version 1`);
  assert.ok(result.history[1].content.includes(`${clip.explanation}  Model: provider/model version 1`));
  assert.equal(JSON.parse(result.history[1].contextContent).explanation.length, 1000);
});

test("maps legacy model selections to the Pollinations default", async () => {
  const { auth, calls } = createHarness();
  const generator = new PollinationsMidiClient({ auth });
  for (const model of ["midijourney", "gpt-3.5-turbo-0613", "gpt-4o", "o1-mini"]) {
    await generator.generate({ promptText: "Create a melody", gptModel: model });
  }
  assert.deepEqual(
    calls.map((call) => call[1].model),
    ["openai", "openai", "openai", "openai"],
  );
});

test("removed dropdown modelChoice cannot override the existing request model", async () => {
  const { auth, calls } = createHarness();
  const client = auth.requireClient();
  client.textModels = () => { assert.fail("generation must not query the removed selector's model catalog"); };
  const generator = new PollinationsMidiClient({ auth });
  for (const modelChoice of [undefined, "auto", "openai/gpt-6-astra", "not-in-menu"]) {
    await generator.generate({ promptText: "A melody", modelChoice, gptModel: "openai" });
    const [messages, options] = calls.at(-1);
    assert.equal(options.model, "openai");
    assert.equal(options.responseFormat.type, "json_schema");
    assert.equal(options.maxTokens, 12000);
    assert.equal(Object.hasOwn(JSON.parse(messages.at(-1).content), "modelChoice"), false);
  }
});

test("rejects invalid provider MIDI before it reaches Max", async () => {
  const { auth } = createHarness({
    choices: [
      {
        message: {
          content: JSON.stringify({
            title: "Bad",
            explanation: "",
            key: null,
            duration: 4,
            notes: [{ pitch: 200, start_time: 0, duration: 1, velocity: 100 }],
          }),
        },
      },
    ],
  });
  const generator = new PollinationsMidiClient({ auth });
  await assert.rejects(() => generator.generate({ promptText: "Create MIDI" }), {
    code: "INVALID_MIDI_RESPONSE",
  });
});

test("an older canceled generation cannot clear the newer operation", async () => {
  const signals = [];
  const client = {
    chat: async (_messages, options) => {
      signals.push(options.signal);
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener(
          "abort",
          () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          { once: true },
        );
      });
    },
  };
  const generator = new PollinationsMidiClient({
    auth: { requireClient: () => client },
  });

  const first = generator.generate({ promptText: "First request" });
  const firstRejection = assert.rejects(first, { code: "CANCELED" });
  const second = generator.generate({ promptText: "Second request" });

  await firstRejection;
  generator.cancel();

  assert.equal(signals.length, 2);
  assert.equal(signals[1].aborted, true);
  await assert.rejects(second, { code: "CANCELED" });
});

test("a stale 401 arriving after cancellation cannot invalidate the current session", async () => {
  let requestCount = 0;
  let rejectFirst;
  const invalidations = [];
  const events = [];
  const client = {
    chat: async (_messages, options) => {
      requestCount += 1;
      if (requestCount === 1) {
        return new Promise((_resolve, reject) => {
          rejectFirst = reject;
        });
      }
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener(
          "abort",
          () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          { once: true },
        );
      });
    },
  };
  const generator = new PollinationsMidiClient({
    auth: {
      requireClient: () => client,
      invalidate: async (error) => invalidations.push(error),
    },
    onEvent: (event) => events.push(event),
  });

  const first = generator.generate({ promptText: "First request" });
  const firstRejection = assert.rejects(first, { code: "CANCELED" });
  const second = generator.generate({ promptText: "Second request" });
  const secondRejection = assert.rejects(second, { code: "CANCELED" });
  rejectFirst(new PollinationsError("private detail", "unauthorized", 401));

  await firstRejection;
  assert.deepEqual(invalidations, []);
  assert.equal(events.filter((event) => event.error?.code === "AUTHORIZATION_REQUIRED").length, 0);

  generator.cancel();
  await secondRejection;
  assert.deepEqual(invalidations, []);
});

test("retries a transient provider failure outside the SDK", async () => {
  let calls = 0;
  const expected = { choices: [{ message: { content: "{}" } }] };
  const client = {
    chat: async () => {
      calls += 1;
      if (calls === 1) {
        throw new PollinationsError(
          "private detail",
          "temporary",
          503,
          undefined,
          undefined,
          0.001,
        );
      }
      return expected;
    },
  };

  assert.equal(
    await chatWithRetries(client, [{ role: "user", content: "MIDI" }], {
      signal: new AbortController().signal,
    }),
    expected,
  );
  assert.equal(calls, 2);
});

test("canceling an app-owned retry delay prevents another provider call", async () => {
  let calls = 0;
  const controller = new AbortController();
  const client = {
    chat: async () => {
      calls += 1;
      throw new PollinationsError(
        "private detail",
        "busy",
        429,
        undefined,
        undefined,
        30,
      );
    },
  };

  const request = chatWithRetries(client, [{ role: "user", content: "MIDI" }], {
    signal: controller.signal,
  });
  const rejected = assert.rejects(request, { code: "CANCELED" });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();

  await rejected;
  assert.equal(calls, 1);
});

test("invalidates authorization when generation is rejected with 401", async () => {
  const invalidations = [];
  const auth = {
    requireClient: () => ({
      chat: async () => {
        throw new PollinationsError("private detail", "unauthorized", 401);
      },
    }),
    invalidate: async (error) => invalidations.push(error),
  };
  const generator = new PollinationsMidiClient({ auth });

  await assert.rejects(() => generator.generate({ promptText: "Create MIDI" }), {
    code: "AUTHORIZATION_REQUIRED",
  });
  assert.deepEqual(invalidations, [
    { code: "AUTHORIZATION_REQUIRED", message: "Reconnect to Pollinations." },
  ]);
});

test("returns safe model metadata", async () => {
  const { auth } = createHarness();
  const generator = new PollinationsMidiClient({ auth });
  assert.deepEqual(await generator.models(), [
    {
      name: "midijourney",
      description: "Music model",
      tier: null,
      contextLength: 32000,
      supportsSystemMessages: true,
    },
  ]);
});

test("maps provider failures to actionable safe categories", () => {
  assert.equal(
    classifyGenerationError(new PollinationsError("private detail", "unauthorized", 401)).code,
    "AUTHORIZATION_REQUIRED",
  );
  assert.equal(
    classifyGenerationError(new PollinationsError("private detail", "balance", 402)).code,
    "INSUFFICIENT_POLLEN",
  );
  assert.equal(
    classifyGenerationError(new PollinationsError("private detail", "rate", 429)).code,
    "RATE_LIMITED",
  );
  assert.equal(
    classifyGenerationError(new PollinationsError("private detail", "bad", 400)).code,
    "INVALID_PROVIDER_REQUEST",
  );
  assert.equal(
    classifyGenerationError(new PollinationsError("private detail", "denied", 403)).code,
    "PERMISSION_DENIED",
  );
  assert.equal(
    classifyGenerationError(new PollinationsError("private detail", "server", 503)).code,
    "PROVIDER_UNAVAILABLE",
  );
  assert.deepEqual(classifyGenerationError({ name: "AbortError" }), {
    code: "CANCELED",
    message: "Generation canceled.",
  });
});
