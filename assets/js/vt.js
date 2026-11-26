// Transition entre l'accueil et les séances : chargé dans l'en-tête (avant le premier affichage)
// pour qu'une transition annulée par le navigateur reste silencieuse.
(function () {
  function quiet(vt) { if (vt) ["ready", "finished", "updateCallbackDone"].forEach(function (k) { if (vt[k]) vt[k].catch(function () {}); }); }
  window.addEventListener("pagereveal", function (e) { quiet(e.viewTransition); });
  window.addEventListener("pageswap", function (e) { quiet(e.viewTransition); });
})();
