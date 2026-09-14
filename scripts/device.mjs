import { resolve } from "node:path";

export function makeDevice(directory) {
  const asset = (name) => directory ? resolve(directory, `midijourney-${name}.js`) : `midijourney-${name}.js`;
  const box = (id, maxclass, rect, extra = {}) => ({ box: { id, maxclass, patching_rect: rect, ...extra } });
  const obj = (id, text, rect, extra) => box(id, "newobj", rect, { text, ...extra });
  const line = (a, ao, b, bi = 0) => ({ patchline: { source: [a, ao], destination: [b, bi] } });
  const base = { fileversion: 1, appversion: { major: 9, minor: 1, revision: 5, architecture: "x64", modernui: 1 },
    classnamespace: "box", rect: [180, 80, 760, 620], openinpresentation: 1, default_fontsize: 12,
    toolbarvisible: 0, enablehscroll: 0, enablevscroll: 0, bglocked: 1, boxes: [], lines: [] };
  const window = { ...base, title: "MIDI Journey", boxes: [
    obj("in", "inlet", [820, 0, 40, 22]), obj("out", "outlet", [820, 35, 40, 22]),
    box("web", "jweb", [0, 0, 760, 620], { varname: "browser", presentation: 1, presentation_rect: [0, 0, 760, 620], rendermode: 1 }),
    obj("load", "loadbang", [820, 80, 60, 22]),
    box("config", "message", [820, 110, 300, 22], { text: "window flags grow, window flags float, window flags nomenu, window size 180 80 940 700, window constrain 420 320 1800 1400, window exec" }),
    obj("patcher", "thispatcher", [820, 150, 70, 22]),
    box("one", "message", [820, 185, 30, 22], { text: "1" }),
    obj("clock", "qmetro 200", [820, 220, 75, 22]),
    box("size", "message", [820, 255, 110, 22], { text: "window getsize" }),
    obj("route", "route window", [820, 290, 90, 22]),
    obj("size-route", "route size", [820, 325, 65, 22]),
    obj("resize", "prepend resize", [820, 360, 95, 22]),
    obj("controller", `js ${asset("window")}`, [820, 395, 250, 22]),
  ], lines: [line("in", 0, "web"), line("web", 0, "out"), line("load", 0, "config"), line("config", 0, "patcher"),
    line("load", 0, "one"), line("one", 0, "clock"), line("clock", 0, "size"), line("size", 0, "patcher"),
    line("patcher", 0, "route"), line("route", 0, "size-route"), line("size-route", 0, "resize"), line("resize", 0, "controller")] };
  return { patcher: { ...base, rect: [100, 100, 950, 650], devicewidth: 176,
    description: "MIDI Journey — persistent AI MIDI creation. Place one device on Main.",
    tags: "MIDI, generative, Pollinations", minimum_live_version: "12.0.0", minimum_max_version: "9.1.5", boxes: [
    box("title", "comment", [20, 0, 160, 20], { text: "MIDI Journey", fontsize: 14, fontface: 1, presentation: 1, presentation_rect: [10, 8, 156, 22] }),
    box("open", "textbutton", [20, 25, 156, 40], { text: "Open", texton: "Open", mode: 0, fontsize: 15, rounded: 6, presentation: 1, presentation_rect: [10, 35, 156, 42] }),
    box("label", "comment", [20, 75, 160, 20], { varname: "device-status", text: "Starting…", fontsize: 11, presentation: 1, presentation_rect: [10, 83, 156, 20] }),
    box("retry", "textbutton", [20, 105, 156, 24], { varname: "device-retry", hidden: 1, text: "Retry", texton: "Retry", mode: 0, presentation: 1, presentation_rect: [10, 108, 156, 24] }),
    box("popen", "message", [230, 20, 45, 22], { text: "open" }),
    obj("pcontrol", "pcontrol", [230, 55, 60, 22]),
    obj("window", "p MIDI Journey", [230, 100, 180, 22], { patcher: window }),
    obj("bridge", `js ${asset("bridge")}`, [230, 170, 300, 22]),
    obj("defer", "deferlow", [230, 135, 60, 22]),
    obj("live", "live.thisdevice", [20, 170, 95, 22]),
    obj("open-delay", "delay 1000", [20, 305, 80, 22]),
    box("init", "message", [20, 205, 35, 22], { text: "init" }),
    obj("server", `node.script ${asset("server")} @autostart 1 @watch 0`, [230, 260, 550, 22]),
    box("start", "message", [20, 260, 40, 22], { text: "start" }),
    obj("route", "route uiurl clipboard_response panel", [230, 300, 240, 22]), obj("read", "prepend read", [230, 335, 90, 22]),
    obj("panel", `js ${asset("panel")}`, [600, 335, 200, 22]),
    obj("clipboard-response", "prepend response", [440, 335, 110, 22]),
    obj("audioin", "plugin~", [20, 370, 60, 22]), obj("audioout", "plugout~", [20, 410, 60, 22]),
  ], lines: [line("open", 0, "popen"), line("popen", 0, "pcontrol"), line("pcontrol", 0, "window"),
    line("window", 0, "defer"), line("defer", 0, "bridge"), line("bridge", 0, "window"), line("bridge", 1, "server"),
    line("live", 0, "init"), line("init", 0, "bridge"), line("live", 0, "open-delay"), line("open-delay", 0, "popen"), line("retry", 0, "start"), line("start", 0, "server"),
    line("server", 0, "route"), line("route", 0, "read"), line("read", 0, "window"),
    line("route", 1, "clipboard-response"), line("clipboard-response", 0, "window"),
    line("route", 2, "panel"),
    line("audioin", 0, "audioout", 0), line("audioin", 1, "audioout", 1)] } };
}
