autowatch = 0;
inlets = 1;
outlets = 0;
function ready() {
  this.patcher.getnamed("device-status").message("set", "Ready");
  this.patcher.getnamed("device-retry").hidden = 1;
}
function unavailable() {
  this.patcher.getnamed("device-status").message("set", "Connection unavailable");
  this.patcher.getnamed("device-retry").hidden = 0;
}
