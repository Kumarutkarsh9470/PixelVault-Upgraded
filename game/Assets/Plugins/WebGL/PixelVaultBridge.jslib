// Unity -> page events. Each event is dispatched on window as
// "pixelvault:<type>" with the parsed JSON payload as event.detail.
mergeInto(LibraryManager.library, {
  PV_Emit: function (typePtr, jsonPtr) {
    var type = UTF8ToString(typePtr);
    var json = UTF8ToString(jsonPtr);
    var detail;
    try {
      detail = JSON.parse(json);
    } catch (e) {
      detail = json;
    }
    window.dispatchEvent(new CustomEvent("pixelvault:" + type, { detail: detail }));
  },
});
