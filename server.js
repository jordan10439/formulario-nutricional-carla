/* ================================================================
   CARLA GUERRERO NUTRICIONISTA  ·  server.js
   Backend Express + PostgreSQL
   ================================================================ */

require('dotenv').config();
const express    = require('express');
const { Pool }   = require('pg');
const session    = require('express-session');
const path       = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

/* ── DATABASE ──────────────────────────────────────────────────── */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS submissions (
      id          SERIAL PRIMARY KEY,
      nombre      VARCHAR(120),
      apellido    VARCHAR(120),
      email       VARCHAR(250),
      telefono    VARCHAR(30),
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      data        JSONB NOT NULL,
      reviewed    BOOLEAN DEFAULT FALSE,
      reviewed_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_submissions_created ON submissions(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_submissions_reviewed ON submissions(reviewed);
  `);
  /* Migrate existing tables that lack the reviewed columns */
  await pool.query(`
    ALTER TABLE submissions ADD COLUMN IF NOT EXISTS reviewed    BOOLEAN DEFAULT FALSE;
    ALTER TABLE submissions ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
  `);
  console.log('✅ Base de datos lista');
}

/* ── MIDDLEWARE ────────────────────────────────────────────────── */
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret:            process.env.SESSION_SECRET || 'carla-nutricionista-2024',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge:   24 * 60 * 60 * 1000,          // 24 h
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  }
}));

/* Serve public static files (form, styles, script, logo) */
app.use(express.static(path.join(__dirname), {
  index: 'index.html'
}));

/* ── AUTH MIDDLEWARE ────────────────────────────────────────────── */
function requireAdmin(req, res, next) {
  if (req.session?.isAdmin) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ success: false, message: 'No autorizado' });
  }
  res.redirect('/admin/login');
}

/* ================================================================
   PUBLIC API
   ================================================================ */

/**
 * POST /api/submissions
 * Recibe el formulario completo y lo guarda en la BD.
 */
app.post('/api/submissions', async (req, res) => {
  try {
    const data = req.body;
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ success: false, message: 'Datos inválidos' });
    }

    const nombre   = (data.nombre   || '').toString().trim().slice(0, 120);
    const apellido = (data.apellido || '').toString().trim().slice(0, 120);
    const email    = (data.email    || '').toString().trim().slice(0, 250);
    const tel      = data.telefono ? `+569${data.telefono}` : null;

    await pool.query(
      `INSERT INTO submissions (nombre, apellido, email, telefono, data)
       VALUES ($1, $2, $3, $4, $5)`,
      [nombre || null, apellido || null, email || null, tel, JSON.stringify(data)]
    );

    res.json({ success: true, message: 'Ficha guardada correctamente' });

  } catch (err) {
    console.error('Error guardando submission:', err);
    res.status(500).json({ success: false, message: 'Error al guardar la ficha. Intenta nuevamente.' });
  }
});

/* ================================================================
   ADMIN ROUTES
   ================================================================ */

/* GET /admin/login — formulario de acceso */
app.get('/admin/login', (req, res) => {
  if (req.session?.isAdmin) return res.redirect('/admin');
  const error = req.query.error === '1';
  res.send(adminLoginHTML(error));
});

/* POST /admin/login — autenticación */
app.post('/admin/login', (req, res) => {
  const password = (req.body.password || '').trim();
  const correct  = process.env.ADMIN_PASSWORD || '';

  if (!correct) {
    return res.send(adminLoginHTML(false, '⚠️ ADMIN_PASSWORD no está configurada en el servidor.'));
  }

  if (password === correct) {
    req.session.isAdmin = true;
    res.redirect('/admin');
  } else {
    res.redirect('/admin/login?error=1');
  }
});

/* GET /admin/logout */
app.get('/admin/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin/login');
});

/* GET /admin — dashboard principal */
app.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

/* ── ADMIN API (protected) ─────────────────────────────────────── */

/* GET /api/submissions — lista todas las fichas */
app.get('/api/submissions', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, nombre, apellido, email, telefono, reviewed,
              to_char(created_at AT TIME ZONE 'America/Santiago', 'DD/MM/YYYY HH24:MI') AS fecha,
              to_char(created_at AT TIME ZONE 'America/Santiago', 'YYYY-MM-DD') AS fecha_iso,
              created_at
       FROM submissions
       ORDER BY created_at DESC
       LIMIT 1000`
    );
    res.json({ success: true, submissions: result.rows });
  } catch (err) {
    console.error('Error listando submissions:', err);
    res.status(500).json({ success: false, message: 'Error al obtener fichas' });
  }
});

/* GET /api/submissions/:id — detalle de una ficha */
app.get('/api/submissions/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (isNaN(Number(id))) return res.status(400).json({ success: false });

    const result = await pool.query(
      `SELECT id, nombre, apellido, email, telefono, reviewed, reviewed_at,
              to_char(created_at AT TIME ZONE 'America/Santiago', 'DD/MM/YYYY HH24:MI') AS fecha,
              data
       FROM submissions WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Ficha no encontrada' });
    }
    res.json({ success: true, submission: result.rows[0] });

  } catch (err) {
    console.error('Error obteniendo submission:', err);
    res.status(500).json({ success: false });
  }
});

/* PATCH /api/submissions/:id/review — marcar revisada o no revisada */
app.patch('/api/submissions/:id/review', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { reviewed } = req.body;
    if (isNaN(Number(id))) return res.status(400).json({ success: false });

    await pool.query(
      `UPDATE submissions
       SET reviewed = $1, reviewed_at = $2
       WHERE id = $3`,
      [Boolean(reviewed), reviewed ? new Date() : null, id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Error actualizando reviewed:', err);
    res.status(500).json({ success: false });
  }
});

/* DELETE /api/submissions/:id — eliminar ficha */
app.delete('/api/submissions/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (isNaN(Number(id))) return res.status(400).json({ success: false });
    await pool.query('DELETE FROM submissions WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

/* GET /api/stats — totales rápidos */
app.get('/api/stats', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*)                                                             AS total,
        COUNT(*) FILTER (WHERE reviewed = FALSE)                            AS sin_revisar,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')   AS hoy,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')     AS semana
      FROM submissions
    `);
    res.json({ success: true, stats: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

/* ================================================================
   INLINE ADMIN LOGIN PAGE
   ================================================================ */
function adminLoginHTML(error, msg) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Acceso · Carla Guerrero Nutricionista</title>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,700;1,600&family=DM+Sans:wght@400;600;700&display=swap" rel="stylesheet"/>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'DM Sans',sans-serif;background:#FAF7F2;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
    .card{background:#fff;border-radius:24px;padding:52px 44px;max-width:420px;width:100%;box-shadow:0 24px 80px rgba(30,20,12,.12);text-align:center;border:1px solid rgba(180,150,130,.18)}
    .logo{width:120px;height:auto;margin:0 auto 28px;display:block;mix-blend-mode:multiply}
    h1{font-family:'Cormorant Garamond',serif;font-size:2rem;font-weight:700;color:#0E0A06;margin-bottom:6px}
    .sub{font-size:.85rem;color:#3D2D24;margin-bottom:32px;letter-spacing:.04em}
    label{display:block;font-size:.78rem;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:#2A1F18;margin-bottom:6px;text-align:left}
    input[type=password]{width:100%;padding:14px 18px;border:1.5px solid rgba(180,150,130,.35);border-radius:10px;font-family:'DM Sans',sans-serif;font-size:1rem;color:#1C1410;background:#FDFAF6;transition:.25s;outline:none;margin-bottom:18px}
    input[type=password]:focus{border-color:#C96848;box-shadow:0 0 0 4px rgba(201,104,72,.12)}
    .error-msg{background:#FFF0ED;border:1px solid rgba(201,104,72,.25);border-radius:8px;padding:10px 14px;font-size:.85rem;color:#A84830;margin-bottom:18px;text-align:left}
    .warn-msg{background:#FBF3E0;border:1px solid rgba(196,144,58,.25);border-radius:8px;padding:10px 14px;font-size:.85rem;color:#8A6030;margin-bottom:18px;text-align:left}
    button{width:100%;padding:15px;border:none;border-radius:99px;background:linear-gradient(135deg,#C96848,#A84830);color:#fff;font-family:'DM Sans',sans-serif;font-size:1rem;font-weight:700;cursor:pointer;transition:.25s;box-shadow:0 8px 28px rgba(201,104,72,.32)}
    button:hover{transform:translateY(-2px);box-shadow:0 14px 40px rgba(201,104,72,.42)}
    .back{display:block;margin-top:22px;font-size:.82rem;color:#7A6058;text-decoration:none;transition:.2s}
    .back:hover{color:#C96848}
  </style>
</head>
<body>
  <div class="card">
    <img src="/logo.png" class="logo" alt="Logo"/>
    <h1>Área Privada</h1>
    <p class="sub">Carla Guerrero · Nutricionista</p>

    ${error ? '<div class="error-msg">❌ Contraseña incorrecta. Intenta nuevamente.</div>' : ''}
    ${msg   ? `<div class="warn-msg">${msg}</div>` : ''}

    <form method="POST" action="/admin/login">
      <label for="pwd">Contraseña</label>
      <input type="password" id="pwd" name="password" placeholder="••••••••" required autofocus/>
      <button type="submit">Ingresar al Dashboard</button>
    </form>
    <a href="/" class="back">← Volver al formulario público</a>
  </div>
</body>
</html>`;
}

/* ================================================================
   BOOT
   ================================================================ */
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🌿 Servidor corriendo en http://localhost:${PORT}`);
    console.log(`📋 Dashboard admin: http://localhost:${PORT}/admin`);
    console.log(`📝 Formulario público: http://localhost:${PORT}/\n`);
  });
}).catch(err => {
  console.error('❌ Error iniciando servidor:', err.message);
  process.exit(1);
});
