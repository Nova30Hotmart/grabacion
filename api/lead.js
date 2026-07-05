// =====================================================================
//  api/lead.js  ·  Función serverless (Vercel) para Comunidades Hotmart
// ---------------------------------------------------------------------
//  Recibe los datos que envía la página (index.html) cuando alguien
//  desbloquea la grabación y los registra en Brevo.
//
//  IMPORTANTE sobre privacidad:
//   - De las cuentas del listado SOLO llega el NOMBRE (nada de tier ni
//     facturación real: eso nunca sale del Excel ni viaja a la página).
//   - De los prospectos llega su CORREO y lo que ellos mismos declaran
//     (si ya tienen cuenta y su rango de facturación). Es autoreportado.
//
//  La llave de Brevo vive en una variable de entorno de Vercel,
//  NUNCA en el código ni en la página.
// =====================================================================

const BREVO_URL = "https://api.brevo.com/v3/contacts";

// IDs numéricos de tus listas en Brevo (opcional pero recomendado).
// Se leen de variables de entorno para no tocar el código.
const LIST_PROSPECTOS = Number(process.env.BREVO_LIST_PROSPECTOS || 0); // los que dejan correo
const LIST_ASISTENTES = Number(process.env.BREVO_LIST_ASISTENTES || 0); // cuentas del listado

module.exports = async function handler(req, res) {
  // CORS (por si la página vive en un subdominio distinto al de la función)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false });

  const d = typeof req.body === "string" ? safeParse(req.body) : (req.body || {});
  const { tipo, cuenta, correo, tieneCuenta, facturacion, evento } = d;

  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    // Sin llave configurada no bloqueamos al usuario: solo lo dejamos ver la grabación.
    console.error("[lead] Falta BREVO_API_KEY");
    return res.status(200).json({ ok: true, stored: false });
  }

  // ---- Armamos el contacto según de dónde viene ----
  let body;

  if (correo) {
    // PROSPECTO — se identifica por su correo
    body = {
      email: String(correo).trim().toLowerCase(),
      attributes: {
        ORIGEN: "prospecto",
        EVENTO: evento || "",
        TIENE_CUENTA: tieneCuenta || "",   // "Sí" / "No" (autoreportado)
        FACTURACION: facturacion || ""      // rango autoreportado por el prospecto
      },
      updateEnabled: true,                  // si ya existe, lo actualiza en vez de duplicar
      ...(LIST_PROSPECTOS ? { listIds: [LIST_PROSPECTOS] } : {})
    };
  } else if (cuenta) {
    // CUENTA DEL LISTADO — solo tenemos el nombre, sin correo.
    // Se registra usando un identificador externo (ext_id) hecho con el nombre.
    body = {
      //ext_id: slug(cuenta),
      attributes: {
        ORIGEN: "cuenta",
        CUENTA: cuenta,
        EVENTO: evento || ""
      },
      updateEnabled: true,
      ...(LIST_ASISTENTES ? { listIds: [LIST_ASISTENTES] } : {}),

      // ── Si tu cuenta de Brevo NO permite contactos sin correo, borra la
      //    línea "ext_id" de arriba y descomenta esta, que genera un correo
      //    técnico con tu propio dominio (nunca llega a una persona real):
      email: `${slug(cuenta)}@cuenta.hotmartcomunidades.com`
    };
  } else {
    return res.status(400).json({ ok: false, error: "Sin datos" });
  }

  // ---- Enviamos a Brevo ----
  try {
    const r = await fetch(BREVO_URL, {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json",
        "accept": "application/json"
      },
      body: JSON.stringify(body)
    });

    // 201 = creado · 204 = actualizado (ambos OK)
    if (!r.ok) {
      const txt = await r.text();
      console.error("[lead] Brevo respondió", r.status, txt);
      // No bloqueamos al usuario aunque Brevo falle: igual ve la grabación.
      return res.status(200).json({ ok: true, stored: false });
    }
    return res.status(200).json({ ok: true, stored: true });
  } catch (e) {
    console.error("[lead] Error llamando a Brevo:", e);
    return res.status(200).json({ ok: true, stored: false });
  }
}

// nombre "GRUPO CICLO LLC" -> "grupo-ciclo-llc"
function slug(s) {
  return String(s)
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
