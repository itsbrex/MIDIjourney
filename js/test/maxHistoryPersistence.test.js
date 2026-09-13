const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { CONFIG } = require("../config.js");

const root = path.resolve(__dirname, "../..");

function readPatcher(name) {
  return JSON.parse(
    fs.readFileSync(path.join(root, "patchers", name), "utf8"),
  ).patcher;
}

function readSourceDevice() {
  const buffer = fs.readFileSync(path.join(root, "MIDIjourney.source.amxd"));
  assert.equal(buffer.subarray(0, 4).toString("ascii"), "ampf");
  assert.equal(buffer.subarray(24, 28).toString("ascii"), "ptch");
  assert.equal(buffer.readUInt32LE(28), buffer.length - 32);
  return JSON.parse(buffer.subarray(32).toString("utf8").replace(/\0+$/, ""));
}

function boxById(patcher, id) {
  return patcher.boxes.find(({ box }) => box.id === id)?.box;
}

function hasLine(
  patcher,
  sourceId,
  destinationId,
  sourceOutlet = 0,
  destinationInlet = 0,
) {
  return patcher.lines.some(({ patchline }) => {
    const { source, destination } = patchline;
    return (
      source[0] === sourceId &&
      source[1] === sourceOutlet &&
      destination[0] === destinationId &&
      destination[1] === destinationInlet
    );
  });
}

function lineBy(
  patcher,
  sourceId,
  destinationId,
  sourceOutlet = 0,
  destinationInlet = 0,
) {
  return patcher.lines
    .map(({ patchline }) => patchline)
    .find(
      ({ source, destination }) =>
        source[0] === sourceId &&
        source[1] === sourceOutlet &&
        destination[0] === destinationId &&
        destination[1] === destinationInlet,
    );
}

function destinationsFrom(patcher, sourceId, sourceOutlet = 0) {
  return patcher.lines
    .map(({ patchline }) => patchline)
    .filter(
      ({ source }) =>
        source[0] === sourceId && source[1] === sourceOutlet,
    )
    .map(({ destination }) => destination)
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

test("stores at most 100 history messages in a per-device Live Set parameter", () => {
  const patcher = readPatcher("mj_bp_historyControl.maxpat");
  const historyDict = boxById(patcher, "obj-history-set-dict");
  const historyPattr = boxById(patcher, "obj-history-set-pattr");

  assert.equal(CONFIG.maxHistoryMessages, 100);

  assert.equal(
    historyDict.text,
    "dict #0_midijourneySetHistory @quiet 1",
  );
  assert.equal(historyDict.varname, "midijourneySetHistoryDict");
  assert.match(historyPattr.text, /@bindto midijourneySetHistoryDict/);
  assert.match(historyPattr.text, /@parameter_enable 1/);
  assert.match(historyPattr.text, /@autorestore 0/);
  assert.match(historyPattr.text, /@thru 0/);
  assert.equal(historyPattr.saved_object_attributes.parameter_enable, 1);
  assert.equal(
    historyPattr.saved_attribute_attributes.valueof.parameter_type,
    3,
  );
  assert.equal(
    historyPattr.saved_attribute_attributes.valueof.parameter_invisible,
    1,
  );
  assert.deepEqual(patcher.parameters["obj-history-set-pattr"], [
    "midijourneySetHistory",
    "Set History",
    0,
  ]);

  assert.equal(
    boxById(patcher, "obj-history-store-unpack").text,
    "dict.unpack history: @legacy 0",
  );
  assert.equal(
    boxById(patcher, "obj-history-store-slice").text,
    `array.slice -${CONFIG.maxHistoryMessages}`,
  );
  assert.ok(
    hasLine(
      patcher,
      "obj-112",
      "obj-history-store-unpack",
      1,
      0,
    ),
  );
  assert.ok(
    hasLine(
      patcher,
      "obj-history-store-unpack",
      "obj-history-store-array",
    ),
  );
  assert.ok(
    hasLine(
      patcher,
      "obj-history-store-array",
      "obj-history-store-slice",
    ),
  );
  assert.ok(
    hasLine(
      patcher,
      "obj-history-store-slice",
      "obj-history-store-pack",
    ),
  );
  assert.ok(
    hasLine(
      patcher,
      "obj-history-store-pack",
      "obj-history-set-pattr",
    ),
  );
});

test("exposes the stored history Blob through the source device parameter map", () => {
  const source = readSourceDevice();
  const parameterPath = "obj-45::obj-276::obj-history-set-pattr";

  assert.deepEqual(source.patcher.parameters[parameterPath], [
    "midijourneySetHistory",
    "Set History",
    0,
  ]);
  assert.deepEqual(
    source.patcher.parameters.parameter_overrides[parameterPath],
    {
      parameter_invisible: 1,
      parameter_longname: "midijourneySetHistory",
    },
  );
});

test("restores history after device initialization without using the UI echo inlet", () => {
  const patcher = readPatcher("mj_bp_historyControl.maxpat");

  assert.ok(
    hasLine(
      patcher,
      "obj-history-restore-ready",
      "obj-history-restore-defer",
    ),
  );
  assert.ok(
    hasLine(
      patcher,
      "obj-history-restore-defer",
      "obj-history-set-pattr",
    ),
  );
  assert.ok(
    hasLine(
      patcher,
      "obj-history-set-pattr",
      "obj-history-restore-filter",
    ),
  );
  assert.equal(
    boxById(patcher, "obj-history-restore-filter").text,
    "routepass dictionary",
  );
  assert.equal(
    boxById(patcher, "obj-history-restore-trigger").text,
    "t l l l",
  );
  assert.equal(
    boxById(patcher, "obj-6").text,
    "dict.unpack history: @legacy 0",
  );
  assert.equal(boxById(patcher, "obj-135").text, "array.length");
  assert.deepEqual(boxById(patcher, "obj-135").outlettype, ["int"]);

  // Trigger outlets fire right-to-left: update start first, silently set the
  // history display's backing dict second, and only then refresh its UI list.
  assert.ok(
    hasLine(
      patcher,
      "obj-history-restore-trigger",
      "obj-history-restore-tag",
      2,
      0,
    ),
  );
  assert.ok(
    hasLine(
      patcher,
      "obj-history-restore-tag",
      "obj-112",
      0,
      1,
    ),
  );
  assert.deepEqual(destinationsFrom(patcher, "obj-history-restore-tag"), [
    ["obj-112", 1],
  ]);
  assert.ok(
    hasLine(
      patcher,
      "obj-history-restore-trigger",
      "obj-58",
      1,
      1,
    ),
  );
  assert.ok(
    hasLine(
      patcher,
      "obj-history-restore-trigger",
      "obj-6",
      0,
      0,
    ),
  );
  assert.equal(
    hasLine(
      patcher,
      "obj-history-restore-trigger",
      "obj-58",
      1,
      0,
    ),
    false,
  );
  assert.deepEqual(
    destinationsFrom(patcher, "obj-history-restore-trigger", 1),
    [["obj-58", 1]],
  );
  assert.deepEqual(
    destinationsFrom(patcher, "obj-history-restore-trigger", 0),
    [["obj-6", 0]],
  );
  assert.equal(
    hasLine(
      patcher,
      "obj-history-restore-trigger",
      "obj-65",
      0,
      0,
    ),
    false,
  );
});

test("rebuilds bounded history anchors and keeps empty history out of slider setup", () => {
  const patcher = readPatcher("mj_bp_historyControl.maxpat");
  const anchor = boxById(patcher, "obj-5");
  const formatter = boxById(patcher, "obj-134").patcher;

  assert.deepEqual(anchor.addpoints, []);
  assert.equal(anchor.domain, 1);
  assert.equal(boxById(patcher, "obj-86").text, "split 0 2");
  assert.ok(hasLine(patcher, "obj-86", "obj-121", 0, 0));
  assert.ok(hasLine(patcher, "obj-86", "obj-93", 1, 0));

  assert.equal(boxById(formatter, "obj-48").text, "/ 2");
  assert.equal(
    boxById(formatter, "obj-history-anchor-clip").text,
    "clip 0 50",
  );
  assert.equal(boxById(formatter, "obj-47").text, "t i i b");
  assert.equal(
    boxById(formatter, "obj-46").text,
    "expr max(1\\, $i1 - 1)",
  );
  assert.equal(
    boxById(formatter, "obj-history-anchor-uzi").text,
    "uzi 1 0",
  );
  assert.ok(
    hasLine(formatter, "obj-47", "obj-history-anchor-clear", 2, 0),
  );
  assert.ok(
    hasLine(formatter, "obj-47", "obj-history-anchor-nonzero", 1, 0),
  );
  assert.ok(hasLine(formatter, "obj-47", "obj-46", 0, 0));
  assert.ok(
    hasLine(
      formatter,
      "obj-history-anchor-nonzero",
      "obj-history-anchor-uzi",
      1,
      0,
    ),
  );
  assert.ok(
    hasLine(formatter, "obj-history-anchor-uzi", "obj-15", 2, 0),
  );
});

test("intercepts restored history and silently replaces only the history key", () => {
  const patcher = readPatcher("mj_bp_start.maxpat");

  assert.equal(
    boxById(patcher, "obj-history-restore-route").text,
    "route restoreHistory",
  );
  assert.equal(
    boxById(patcher, "obj-history-restore-unpack").text,
    "dict.unpack history: @legacy 0",
  );
  assert.equal(
    boxById(patcher, "obj-history-restore-replace").text,
    "prepend replace history",
  );
  assert.ok(
    hasLine(patcher, "obj-7", "obj-history-restore-route", 0, 0),
  );
  assert.deepEqual(
    destinationsFrom(patcher, "obj-history-restore-route", 0),
    [["obj-history-restore-unpack", 0]],
  );
  assert.ok(
    hasLine(
      patcher,
      "obj-history-restore-route",
      "obj-history-restore-unpack",
      0,
      0,
    ),
  );
  assert.ok(
    hasLine(
      patcher,
      "obj-history-restore-unpack",
      "obj-history-restore-replace",
    ),
  );
  assert.ok(
    hasLine(
      patcher,
      "obj-history-restore-replace",
      "obj-22",
      0,
      1,
    ),
  );
  assert.ok(
    hasLine(
      patcher,
      "obj-history-restore-route",
      "obj-19",
      1,
      0,
    ),
  );
  assert.equal(hasLine(patcher, "obj-7", "obj-19", 0, 0), false);
  assert.equal(
    hasLine(
      patcher,
      "obj-history-restore-replace",
      "obj-22",
      0,
      0,
    ),
    false,
  );
  assert.deepEqual(
    destinationsFrom(patcher, "obj-history-restore-replace"),
    [["obj-22", 1]],
  );
  assert.equal(
    hasLine(
      patcher,
      "obj-history-restore-route",
      "obj-2",
      0,
      0,
    ),
    false,
  );
});

test("clearing history empties persistence before forwarding clearHistory", () => {
  const patcher = readPatcher("mj_bp_historyControl.maxpat");
  const clearTrigger = boxById(patcher, "obj-4");

  assert.equal(clearTrigger.text, "t b b b");
  assert.equal(clearTrigger.numoutlets, 3);
  const clearArray = boxById(patcher, "obj-history-clear-array");
  assert.equal(clearArray.text, "array");
  assert.equal(clearArray.maxclass, "newobj");
  assert.equal(clearArray.numoutlets, 3);
  assert.ok(hasLine(patcher, "obj-4", "obj-121", 2, 0));
  assert.ok(
    hasLine(patcher, "obj-4", "obj-history-clear-array", 1, 0),
  );
  assert.ok(hasLine(patcher, "obj-4", "obj-31", 0, 0));
  assert.ok(
    hasLine(
      patcher,
      "obj-history-clear-array",
      "obj-history-store-array",
    ),
  );
  assert.ok(
    hasLine(patcher, "obj-history-clear-array", "obj-135", 0, 0),
  );
  assert.equal(
    lineBy(
      patcher,
      "obj-history-clear-array",
      "obj-135",
      0,
      0,
    ).order,
    0,
  );
  assert.ok(
    hasLine(patcher, "obj-history-store-pack", "obj-58", 0, 1),
  );

  const start = readPatcher("mj_bp_start.maxpat");
  assert.ok(hasLine(start, "obj-13", "obj-8", 0, 0));
  assert.equal(lineBy(start, "obj-13", "obj-8").order, 0);
  assert.equal(lineBy(start, "obj-13", "obj-16").order, 1);
  assert.ok(hasLine(start, "obj-8", "obj-23", 0, 0));
  assert.equal(lineBy(start, "obj-8", "obj-23").order, 0);
  assert.ok(hasLine(start, "obj-8", "obj-19", 0, 1));
  assert.equal(lineBy(start, "obj-8", "obj-19", 0, 1).order, 1);
  assert.ok(hasLine(start, "obj-28", "obj-23", 1, 0));
});

test("routes disconnect cancellation back into the Create UI without entering the clip pipeline", () => {
  const node = readPatcher("mj_nodeJS.maxpat");
  const outputRoute = boxById(node, "obj-268");
  const cancelOutput = boxById(node, "obj-cancel-output");
  const nodeScript = boxById(node, "obj-273");
  const statusMessage = boxById(
    node,
    "obj-pollinations-command-status",
  );
  const loadendRoute = boxById(
    node,
    "obj-pollinations-loadend-route",
  );
  const loadendSuccess = boxById(
    node,
    "obj-pollinations-loadend-success",
  );
  const loadendDelay = boxById(
    node,
    "obj-pollinations-loadend-delay",
  );

  assert.equal(
    outputRoute.text,
    "route result processing error auth cancel",
  );
  assert.equal(outputRoute.numoutlets, 6);
  assert.equal(cancelOutput.text, "cancel");
  assert.equal(cancelOutput.hidden, 1);
  assert.ok(hasLine(node, outputRoute.id, cancelOutput.id, 4, 0));
  assert.ok(hasLine(node, cancelOutput.id, "obj-2", 0, 0));
  assert.deepEqual(destinationsFrom(node, outputRoute.id, 4), [
    [cancelOutput.id, 0],
  ]);
  assert.deepEqual(destinationsFrom(node, outputRoute.id, 5), []);
  assert.deepEqual(destinationsFrom(node, cancelOutput.id), [["obj-2", 0]]);
  assert.equal(loadendRoute.text, "route loadend");
  assert.equal(loadendSuccess.text, "sel success");
  assert.equal(loadendDelay.text, "delay 250");
  assert.ok(hasLine(node, nodeScript.id, loadendRoute.id, 1, 0));
  assert.ok(hasLine(node, loadendRoute.id, loadendSuccess.id, 0, 0));
  assert.ok(hasLine(node, loadendSuccess.id, loadendDelay.id, 0, 0));
  assert.ok(hasLine(node, loadendDelay.id, statusMessage.id, 0, 0));

  const source = readSourceDevice();
  const journey = source.patcher.boxes.find(
    ({ box }) => box.maxclass === "newobj" && box.text === "p midiJourney",
  )?.box?.patcher;
  assert.ok(journey);
  const route = boxById(journey, "obj-pollinations-auth-route");
  const authPrepend = boxById(
    journey,
    "obj-pollinations-auth-prepend",
  );
  const sharedOutput = journey.boxes.find(
    ({ box }) => box.maxclass === "outlet" && box.index === 2,
  )?.box;
  const cancelMessage = boxById(
    journey,
    "obj-pollinations-cancel-message",
  );
  const start = journey.boxes.find(
    ({ box }) =>
      box.maxclass === "bpatcher" && box.name === "mj_bp_start.maxpat",
  )?.box;
  assert.ok(start);

  assert.equal(route.text, "route auth cancel");
  assert.equal(route.numinlets, 3);
  assert.equal(route.numoutlets, 3);
  assert.equal(authPrepend.text, "prepend auth");
  assert.ok(sharedOutput);
  assert.equal(cancelMessage.text, "cancel");
  assert.ok(hasLine(journey, route.id, cancelMessage.id, 1, 0));
  assert.ok(hasLine(journey, cancelMessage.id, start.id, 0, 0));
  assert.ok(hasLine(journey, route.id, "obj-22", 2, 0));
  assert.equal(hasLine(journey, route.id, "obj-22", 1, 0), false);
  assert.deepEqual(destinationsFrom(journey, route.id, 0), [
    [authPrepend.id, 0],
  ]);
  assert.deepEqual(destinationsFrom(journey, authPrepend.id), [
    [sharedOutput.id, 0],
  ]);
  assert.deepEqual(destinationsFrom(journey, route.id, 1), [
    [cancelMessage.id, 0],
  ]);
  assert.deepEqual(destinationsFrom(journey, route.id, 2), [["obj-22", 0]]);
  assert.deepEqual(destinationsFrom(journey, cancelMessage.id), [[start.id, 0]]);
});
