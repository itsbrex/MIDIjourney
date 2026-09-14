import { resolve } from "node:path";

export function makeDevice(directory) {
  const box = (id, maxclass, rect, extra = {}) => ({ box: { id, maxclass, patching_rect: rect, ...extra } });
  const obj = (id, text, rect, extra) => box(id, "newobj", rect, { text, ...extra });
  const line = (a, ao, b, bi = 0) => ({ patchline: { source: [a, ao], destination: [b, bi] } });
  const base = { fileversion: 1, appversion: { major: 9, minor: 1, revision: 5, architecture: "x64", modernui: 1 },
    classnamespace: "box", rect: [180, 80, 760, 620], openinpresentation: 1, default_fontsize: 12,
    toolbarvisible: 0, enablehscroll: 0, enablevscroll: 0, bglocked: 1, boxes: [], lines: [] };
  const window = { ...base, title: "MIDIjourney Persistent", boxes: [
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
    obj("controller", `js ${resolve(directory, "window.js")}`, [820, 395, 250, 22]),
  ], lines: [line("in", 0, "web"), line("web", 0, "out"), line("load", 0, "config"), line("config", 0, "patcher"),
    line("load", 0, "one"), line("one", 0, "clock"), line("clock", 0, "size"), line("size", 0, "patcher"),
    line("patcher", 0, "route"), line("route", 0, "size-route"), line("size-route", 0, "resize"), line("resize", 0, "controller")] };
  return { patcher: { ...base, rect: [100, 100, 950, 650], devicewidth: 200, boxes: [
    box("open", "textbutton", [20, 20, 180, 50], { text: "Open MIDIjourney", texton: "Open MIDIjourney", mode: 0, presentation: 1, presentation_rect: [10, 10, 180, 48] }),
    box("label", "comment", [20, 75, 180, 20], { text: "Persistent web preview", presentation: 1, presentation_rect: [10, 62, 180, 20] }),
    box("retry", "textbutton", [20, 105, 180, 28], { text: "Retry connection", texton: "Retry connection", mode: 0, presentation: 1, presentation_rect: [10, 90, 180, 28] }),
    box("popen", "message", [230, 20, 45, 22], { text: "open" }),
    obj("pcontrol", "pcontrol", [230, 55, 60, 22]),
    obj("window", "p MIDIjourney Persistent", [230, 100, 180, 22], { patcher: window }),
    obj("bridge", `js ${resolve(directory, "bridge.js")}`, [230, 170, 300, 22]),
    obj("defer", "deferlow", [230, 135, 60, 22]),
    obj("live", "live.thisdevice", [20, 170, 95, 22]),
    obj("open-delay", "delay 1000", [20, 305, 80, 22]),
    box("init", "message", [20, 205, 35, 22], { text: "init" }),
    obj("server", `node.script ${resolve(directory, "server.js")} @autostart 1 @watch 0`, [230, 260, 550, 22]),
    box("start", "message", [20, 260, 40, 22], { text: "start" }),
    obj("route", "route uiurl clipboard_response", [230, 300, 200, 22]), obj("read", "prepend read", [230, 335, 90, 22]),
    obj("clipboard-response", "prepend response", [440, 335, 110, 22]),
    obj("audioin", "plugin~", [20, 370, 60, 22]), obj("audioout", "plugout~", [20, 410, 60, 22]),
  ], lines: [line("open", 0, "popen"), line("popen", 0, "pcontrol"), line("pcontrol", 0, "window"),
    line("window", 0, "defer"), line("defer", 0, "bridge"), line("bridge", 0, "window"), line("bridge", 1, "server"),
    line("live", 0, "init"), line("init", 0, "bridge"), line("live", 0, "open-delay"), line("open-delay", 0, "popen"), line("retry", 0, "start"), line("start", 0, "server"),
    line("server", 0, "route"), line("route", 0, "read"), line("read", 0, "window"),
    line("route", 1, "clipboard-response"), line("clipboard-response", 0, "window"),
    line("audioin", 0, "audioout", 0), line("audioin", 1, "audioout", 1)] } };
}
