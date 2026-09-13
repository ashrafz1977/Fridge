/* Loaded only by fridge.html, the page the server serves. Its presence
   is how fridge.js knows to talk to the API rather than to the artifact
   database or to localStorage. A separate file rather than an inline
   script because the server's Content-Security-Policy allows no inline
   script at all. */
window.FRIDGE_MODE = "api";
