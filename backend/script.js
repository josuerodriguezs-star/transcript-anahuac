(function () {
  "use strict";

  const filasAlumnos = document.getElementById("filas-alumnos");
  const btnAgregar = document.getElementById("btn-agregar-alumno");
  const form = document.getElementById("form-actividad");
  const pantallaEspera = document.getElementById("pantalla-espera");
  const contadorEspera = document.getElementById("espera-contador");
  const mensajeError = document.getElementById("mensaje-error");

  let contadorFilas = 0;
  let intervaloTimer = null;

  function crearFilaAlumno() {
    contadorFilas += 1;
    const fila = document.createElement("div");
    fila.className = "roster-row";
    fila.dataset.filaId = String(contadorFilas);

    fila.innerHTML = `
      <input type="text" name="alumno_nombre" placeholder="Nombre del alumno">
      <input type="text" name="alumno_link" placeholder="https://chatgpt.com/share/...">
      <input type="text" name="alumno_fecha" placeholder="Opcional">
      <button type="button" class="btn-quitar" aria-label="Quitar alumno">×</button>
    `;

    fila.querySelector(".btn-quitar").addEventListener("click", () => {
      fila.remove();
    });

    filasAlumnos.appendChild(fila);
  }

  btnAgregar.addEventListener("click", crearFilaAlumno);

  // Arranca con tres filas vacías, para que se sienta como una lista
  // lista para llenar en vez de un formulario en blanco.
  crearFilaAlumno();
  crearFilaAlumno();
  crearFilaAlumno();

  function leerAlumnos() {
    const filas = Array.from(filasAlumnos.querySelectorAll(".roster-row"));
    return filas
      .map((fila) => {
        const nombre = fila.querySelector('[name="alumno_nombre"]').value.trim();
        const link = fila.querySelector('[name="alumno_link"]').value.trim();
        const fecha = fila.querySelector('[name="alumno_fecha"]').value.trim();
        return { nombre, link, fecha_envio: fecha };
      })
      .filter((a) => a.nombre || a.link);
  }

  function mostrarError(texto) {
    mensajeError.textContent = texto;
    mensajeError.hidden = false;
  }

  function limpiarError() {
    mensajeError.hidden = true;
    mensajeError.textContent = "";
  }

  function iniciarContador() {
    const inicio = Date.now();
    intervaloTimer = setInterval(() => {
      const segundos = Math.floor((Date.now() - inicio) / 1000);
      const mm = String(Math.floor(segundos / 60)).padStart(2, "0");
      const ss = String(segundos % 60).padStart(2, "0");
      contadorEspera.textContent = `Tiempo transcurrido: ${mm}:${ss}`;
    }, 1000);
  }

  function detenerContador() {
    if (intervaloTimer) {
      clearInterval(intervaloTimer);
      intervaloTimer = null;
    }
  }

  function extraerNombreArchivo(response, fallback) {
    const disposicion = response.headers.get("Content-Disposition") || "";
    const match = disposicion.match(/filename="?([^"]+)"?/);
    return match ? match[1] : fallback;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    limpiarError();

    const datos = new FormData(form);
    const alumnos = leerAlumnos();

    if (alumnos.length === 0) {
      mostrarError("Agrega al menos un alumno con nombre y link antes de generar.");
      return;
    }

    const sinLink = alumnos.filter((a) => a.nombre && !a.link);
    if (sinLink.length > 0) {
      mostrarError(`Falta el link de: ${sinLink.map((a) => a.nombre).join(", ")}`);
      return;
    }

    const payload = {
      carpeta_drive_id: datos.get("carpeta_drive_id").trim(),
      curso: datos.get("curso").trim(),
      clave_materia: datos.get("clave_materia").trim(),
      programa: datos.get("programa").trim(),
      arranque: datos.get("arranque").trim(),
      actividad_nombre: datos.get("actividad_nombre").trim(),
      actividad_numero: datos.get("actividad_numero").trim(),
      fecha_limite: datos.get("fecha_limite").trim(),
      alumnos: alumnos,
    };

    form.hidden = true;
    pantallaEspera.hidden = false;
    iniciarContador();

    try {
      const response = await fetch(`${API_BASE_URL}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        let detalle = `El servidor respondió con error (${response.status}).`;
        try {
          const cuerpo = await response.json();
          if (cuerpo.detail) detalle = cuerpo.detail;
        } catch (_) {
          /* la respuesta no traía JSON, usamos el mensaje genérico */
        }
        throw new Error(detalle);
      }

      const blob = await response.blob();
      const nombreArchivo = extraerNombreArchivo(response, "transcripts.zip");

      const url = URL.createObjectURL(blob);
      const enlace = document.createElement("a");
      enlace.href = url;
      enlace.download = nombreArchivo;
      document.body.appendChild(enlace);
      enlace.click();
      enlace.remove();
      URL.revokeObjectURL(url);

      detenerContador();
      pantallaEspera.hidden = true;
      form.hidden = false;
    } catch (error) {
      detenerContador();
      pantallaEspera.hidden = true;
      form.hidden = false;
      mostrarError(
        `No se pudo completar la extracción: ${error.message}. Revisa el Sheet de la actividad — las filas que sí se procesaron quedan guardadas ahí aunque el resto falle.`
      );
    }
  });
})();
