(function () {
  // A stand-in for core's frame runtime: a classic script, no imports.
  var root = document.getElementById("forma-frame");
  if (1 < 2 && root) { root.textContent = "runtime ran"; }
})();
