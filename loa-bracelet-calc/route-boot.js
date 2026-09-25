/* route-boot.js — calls routeBoot() (the inline ROUTES script in index.html)
 * once every app module has initialised.
 *
 * It was an inline script. Now the app scripts load with `defer`, and an inline
 * script runs while the page is still parsing, BEFORE any deferred file, so the
 * boot moved into this file, LAST in the deferred list. Deferred files run in
 * page order after parsing and before DOMContentLoaded: a module that inits at
 * once has done so by now, and a listener added here fires after any
 * DOMContentLoaded listener a module added before it. Either way the addressed
 * tab activates exactly as a click just after load would. */
(function () {
  "use strict";
  var me = document.currentScript;
  if (document.readyState === "loading" || (me && me.defer)) {
    document.addEventListener("DOMContentLoaded", routeBoot);
  } else {
    routeBoot();
  }
})();
