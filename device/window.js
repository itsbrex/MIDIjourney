autowatch = 0;
inlets = 1;
outlets = 0;
var previous = "";
function resize(left, top, right, bottom) {
  var width = Math.max(320, right - left);
  var height = Math.max(240, bottom - top);
  var signature = width + ":" + height;
  if (signature === previous) return;
  previous = signature;
  var browser = this.patcher.getnamed("browser");
  browser.message("presentation_rect", 0, 0, width, height);
  browser.message("patching_rect", 0, 0, width, height);
}
