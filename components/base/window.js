const remote = require("electron").remote;

window.addEventListener("DOMContentLoaded", (event) => {
  document.getElementById("close-window").addEventListener("click", (event) => {
    console.log("Testing");
    var window = remote.getCurrentWindow();
    window.close();
  });
  document.getElementById("minimize-window").addEventListener("click", (event) => {
    var window = remote.getCurrentWindow();
    window.minimize();
  });
});
