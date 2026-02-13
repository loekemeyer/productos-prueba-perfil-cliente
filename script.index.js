function openMayorista(){
  // Oculta todo el home
  document.querySelectorAll("section, footer").forEach(el => el.style.display = "none");

  // Muestra solo la pantalla de desarrollo
  const dev = document.getElementById("enDesarrollo");
  if (dev) dev.style.display = "flex";

  window.scrollTo(0, 0);
}

document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("btnMayorista");
  if (btn) btn.addEventListener("click", openMayorista);
});

document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("btnMayorista");
  if (!btn) return;

  btn.addEventListener("click", () => {
    window.location.href = "mayorista.html";
  });
});
