/* ================================================================
   CARLA GUERRERO NUTRICIONISTA  ·  server.js
   ================================================================ */

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer  = require('multer');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

/* Trust Railway / Render / Heroku reverse proxies */
app.set('trust proxy', 1);

/* ── BODY PARSERS ─────────────────────────────────────────────── */
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

/* ── SESSION ─────────────────────────────────────────────────── */
app.use(session({
  secret:            process.env.SESSION_SECRET || 'carla-dev-secret-2024',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge:   24 * 60 * 60 * 1000,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  }
}));

/* ── STATIC FILES (public form) ──────────────────────────────── */
/* Pre-create the static handler once, not on every request */
const staticHandler = express.static(path.join(__dirname), { index: 'index.html' });

app.use((req, res, next) => {
  /* Let /admin* and /api* and /health fall through to route handlers */
  if (
    req.path === '/admin' ||
    req.path.startsWith('/admin/') ||
    req.path.startsWith('/api/') ||
    req.path === '/health'
  ) return next();
  staticHandler(req, res, next);
});

/* ── DATABASE (lazy init) ─────────────────────────────────────── */
let pool    = null;
let dbReady = false;
let dbError = null;

function getPool() {
  if (!pool) {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
  }
  return pool;
}

async function initDB() {
  const db = getPool();
  await db.query(`
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
    CREATE INDEX IF NOT EXISTS idx_sub_created  ON submissions(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sub_reviewed ON submissions(reviewed);
  `);
  /* Safe migration for existing tables */
  await db.query(`
    ALTER TABLE submissions ADD COLUMN IF NOT EXISTS reviewed    BOOLEAN DEFAULT FALSE;
    ALTER TABLE submissions ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
  `);
  /* Attachments table */
  await db.query(`
    CREATE TABLE IF NOT EXISTS attachments (
      id            SERIAL PRIMARY KEY,
      submission_id INTEGER REFERENCES submissions(id) ON DELETE CASCADE,
      filename      VARCHAR(255),
      mimetype      VARCHAR(100),
      size          INTEGER,
      data          BYTEA,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_att_submission ON attachments(submission_id);
  `);
  /* Consultas / expediente clínico */
  await db.query(`
    CREATE TABLE IF NOT EXISTS consultas (
      id            SERIAL PRIMARY KEY,
      submission_id INTEGER REFERENCES submissions(id) ON DELETE CASCADE,
      titulo        VARCHAR(200) NOT NULL DEFAULT 'Consulta',
      data          JSONB        NOT NULL DEFAULT '{}',
      created_at    TIMESTAMPTZ  DEFAULT NOW(),
      updated_at    TIMESTAMPTZ  DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_consultas_submission ON consultas(submission_id);
  `);
}

/* ── MULTER (memory storage, max 8 MB per file, 5 files) ──────── */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/pdf',
      'image/jpeg', 'image/jpg', 'image/png',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Formato no permitido. Use PDF, JPG, PNG o Word.'));
  }
});

/* ── HEALTH (always responds, even without DB) ──────────────── */
app.get('/health', (_req, res) => {
  res.json({
    status : dbReady ? 'ok' : (dbError ? 'db_error' : 'starting'),
    db     : dbReady ? 'connected' : (dbError || 'connecting…'),
    port   : PORT,
    env    : process.env.NODE_ENV || 'development',
    ts     : new Date().toISOString()
  });
});

/* ── AUTH MIDDLEWARE ─────────────────────────────────────────── */
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

/* POST /api/submissions — save form + optional file attachments */
app.post('/api/submissions', upload.array('adjuntos', 5), async (req, res) => {
  if (!dbReady) {
    return res.status(503).json({ success: false, message: 'Base de datos no disponible aún. Intenta en unos segundos.' });
  }
  try {
    /* Form data comes as multipart; the JSON fields are in req.body */
    const data     = req.body;
    const nombre   = (data.nombre   || '').toString().trim().slice(0, 120);
    const apellido = (data.apellido || '').toString().trim().slice(0, 120);
    const email    = (data.email    || '').toString().trim().slice(0, 250);
    const tel      = data.telefono  ? `+569${data.telefono}` : null;

    const db = getPool();
    const result = await db.query(
      `INSERT INTO submissions (nombre, apellido, email, telefono, data)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [nombre || null, apellido || null, email || null, tel, JSON.stringify(data)]
    );
    const submissionId = result.rows[0].id;

    /* Save attachments if any */
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        await db.query(
          `INSERT INTO attachments (submission_id, filename, mimetype, size, data)
           VALUES ($1, $2, $3, $4, $5)`,
          [submissionId, file.originalname, file.mimetype, file.size, file.buffer]
        );
      }
    }

    res.json({ success: true, message: 'Ficha guardada correctamente' });
  } catch (err) {
    console.error('Error guardando submission:', err.message);
    /* Multer validation errors */
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, message: 'Un archivo supera el tamaño máximo de 8 MB.' });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ success: false, message: 'Máximo 5 archivos permitidos.' });
    }
    res.status(500).json({ success: false, message: err.message || 'Error al guardar la ficha.' });
  }
});

/* GET /api/submissions/:id/attachments — list files for a submission */
app.get('/api/submissions/:id/attachments', requireAdmin, async (req, res) => {
  if (!dbReady) return res.json({ success: true, attachments: [] });
  try {
    const { id } = req.params;
    if (isNaN(Number(id))) return res.status(400).json({ success: false });
    const r = await getPool().query(
      `SELECT id, filename, mimetype, size,
              to_char(created_at AT TIME ZONE 'America/Santiago','DD/MM/YYYY HH24:MI') AS fecha
       FROM attachments WHERE submission_id = $1 ORDER BY id`,
      [id]
    );
    res.json({ success: true, attachments: r.rows });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

/* GET /api/attachments/:id/download — stream file to browser */
app.get('/api/attachments/:id/download', requireAdmin, async (req, res) => {
  if (!dbReady) return res.status(503).json({ success: false });
  try {
    const { id } = req.params;
    if (isNaN(Number(id))) return res.status(400).json({ success: false });
    const r = await getPool().query(
      `SELECT filename, mimetype, size, data FROM attachments WHERE id = $1`,
      [id]
    );
    if (!r.rows.length) return res.status(404).json({ success: false });
    const file = r.rows[0];
    res.setHeader('Content-Type', file.mimetype);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.filename)}"`);
    res.setHeader('Content-Length', file.size);
    res.send(file.data);
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

/* ================================================================
   ADMIN ROUTES
   ================================================================ */

/* GET /admin/login */
app.get('/admin/login', (req, res) => {
  if (req.session?.isAdmin) return res.redirect('/admin');
  res.send(loginHTML(req.query.error === '1', null));
});

/* POST /admin/login */
app.post('/admin/login', (req, res) => {
  const password = (req.body.password || '').trim();
  const correct  = process.env.ADMIN_PASSWORD || '';

  if (!correct) {
    return res.send(loginHTML(false, '⚠️ ADMIN_PASSWORD no está configurada.'));
  }
  if (password !== correct) {
    return res.redirect('/admin/login?error=1');
  }

  req.session.isAdmin = true;
  req.session.save(err => {
    if (err) {
      console.error('Session save error:', err);
      return res.send(loginHTML(false, '⚠️ Error de sesión. Intenta nuevamente.'));
    }
    res.redirect('/admin');
  });
});

/* GET /admin/logout */
app.get('/admin/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

/* GET /admin — dashboard */
app.get('/admin', requireAdmin, (_req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

/* ── PROTECTED API ───────────────────────────────────────────── */

app.get('/api/submissions', requireAdmin, async (req, res) => {
  if (!dbReady) return res.status(503).json({ success: false, message: 'DB no disponible' });
  try {
    const r = await getPool().query(`
      SELECT id, nombre, apellido, email, telefono, reviewed,
             to_char(created_at AT TIME ZONE 'America/Santiago','DD/MM/YYYY HH24:MI') AS fecha,
             to_char(created_at AT TIME ZONE 'America/Santiago','YYYY-MM-DD')         AS fecha_iso,
             created_at
      FROM submissions ORDER BY created_at DESC LIMIT 1000`);
    res.json({ success: true, submissions: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/submissions/:id', requireAdmin, async (req, res) => {
  if (!dbReady) return res.status(503).json({ success: false, message: 'DB no disponible' });
  try {
    const { id } = req.params;
    if (isNaN(Number(id))) return res.status(400).json({ success: false });
    const r = await getPool().query(`
      SELECT id, nombre, apellido, email, telefono, reviewed, reviewed_at,
             to_char(created_at AT TIME ZONE 'America/Santiago','DD/MM/YYYY HH24:MI') AS fecha,
             data
      FROM submissions WHERE id = $1`, [id]);
    if (!r.rows.length) return res.status(404).json({ success: false });
    res.json({ success: true, submission: r.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

app.patch('/api/submissions/:id/review', requireAdmin, async (req, res) => {
  if (!dbReady) return res.status(503).json({ success: false });
  try {
    const { id } = req.params;
    const { reviewed } = req.body;
    if (isNaN(Number(id))) return res.status(400).json({ success: false });
    await getPool().query(
      `UPDATE submissions SET reviewed=$1, reviewed_at=$2 WHERE id=$3`,
      [Boolean(reviewed), reviewed ? new Date() : null, id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

app.delete('/api/submissions/:id', requireAdmin, async (req, res) => {
  if (!dbReady) return res.status(503).json({ success: false });
  try {
    const { id } = req.params;
    if (isNaN(Number(id))) return res.status(400).json({ success: false });
    await getPool().query('DELETE FROM submissions WHERE id=$1', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

app.get('/api/stats', requireAdmin, async (req, res) => {
  if (!dbReady) return res.json({ success: true, stats: { total: 0, sin_revisar: 0, hoy: 0, semana: 0 } });
  try {
    const r = await getPool().query(`
      SELECT
        COUNT(*)                                                           AS total,
        COUNT(*) FILTER (WHERE reviewed = FALSE)                          AS sin_revisar,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') AS hoy,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')   AS semana
      FROM submissions`);
    res.json({ success: true, stats: r.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

/* ================================================================
   CONSULTAS — EXPEDIENTE CLÍNICO
   ================================================================ */

/* GET /api/submissions/:id/consultas — lista de consultas del paciente */
app.get('/api/submissions/:id/consultas', requireAdmin, async (req, res) => {
  if (!dbReady) return res.json({ success: true, consultas: [] });
  try {
    const { id } = req.params;
    if (isNaN(Number(id))) return res.status(400).json({ success: false });
    const r = await getPool().query(`
      SELECT id, titulo,
             to_char(created_at AT TIME ZONE 'America/Santiago','DD/MM/YYYY HH24:MI') AS fecha_creacion,
             to_char(updated_at  AT TIME ZONE 'America/Santiago','DD/MM/YYYY HH24:MI') AS fecha_edicion
      FROM consultas WHERE submission_id = $1
      ORDER BY created_at ASC`, [id]);
    res.json({ success: true, consultas: r.rows });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

/* POST /api/submissions/:id/consultas — nueva consulta */
app.post('/api/submissions/:id/consultas', requireAdmin, async (req, res) => {
  if (!dbReady) return res.status(503).json({ success: false });
  try {
    const { id } = req.params;
    if (isNaN(Number(id))) return res.status(400).json({ success: false });
    const { titulo = 'Consulta', data = {} } = req.body;
    const r = await getPool().query(
      `INSERT INTO consultas (submission_id, titulo, data) VALUES ($1,$2,$3) RETURNING id`,
      [id, titulo.slice(0,200), JSON.stringify(data)]
    );
    res.json({ success: true, id: r.rows[0].id });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

/* GET /api/consultas/:id — datos completos de una consulta */
app.get('/api/consultas/:id', requireAdmin, async (req, res) => {
  if (!dbReady) return res.status(503).json({ success: false });
  try {
    const { id } = req.params;
    if (isNaN(Number(id))) return res.status(400).json({ success: false });
    const r = await getPool().query(
      `SELECT id, submission_id, titulo, data,
              to_char(created_at AT TIME ZONE 'America/Santiago','DD/MM/YYYY HH24:MI') AS fecha_creacion,
              to_char(updated_at  AT TIME ZONE 'America/Santiago','DD/MM/YYYY HH24:MI') AS fecha_edicion
       FROM consultas WHERE id = $1`, [id]);
    if (!r.rows.length) return res.status(404).json({ success: false });
    res.json({ success: true, consulta: r.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

/* PUT /api/consultas/:id — actualizar consulta */
app.put('/api/consultas/:id', requireAdmin, async (req, res) => {
  if (!dbReady) return res.status(503).json({ success: false });
  try {
    const { id } = req.params;
    if (isNaN(Number(id))) return res.status(400).json({ success: false });
    const { titulo, data } = req.body;
    await getPool().query(
      `UPDATE consultas SET titulo=$1, data=$2, updated_at=NOW() WHERE id=$3`,
      [titulo.slice(0,200), JSON.stringify(data), id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

/* POST /api/consultas/:id/duplicate — duplicar consulta */
app.post('/api/consultas/:id/duplicate', requireAdmin, async (req, res) => {
  if (!dbReady) return res.status(503).json({ success: false });
  try {
    const { id } = req.params;
    if (isNaN(Number(id))) return res.status(400).json({ success: false });
    const orig = await getPool().query(
      `SELECT submission_id, titulo, data FROM consultas WHERE id=$1`, [id]);
    if (!orig.rows.length) return res.status(404).json({ success: false });
    const { submission_id, titulo, data } = orig.rows[0];
    const newTitle = titulo.endsWith('(copia)') ? titulo : `${titulo} (copia)`;
    const r = await getPool().query(
      `INSERT INTO consultas (submission_id, titulo, data) VALUES ($1,$2,$3) RETURNING id`,
      [submission_id, newTitle.slice(0,200), JSON.stringify(data)]
    );
    res.json({ success: true, id: r.rows[0].id });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

/* ================================================================
   LOGIN PAGE HTML
   ================================================================ */
function loginHTML(error, msg) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Acceso · Carla Guerrero Nutricionista</title>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@700&family=DM+Sans:wght@400;600;700&display=swap" rel="stylesheet"/>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'DM Sans',sans-serif;background:#FAF7F2;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
    .card{background:#fff;border-radius:24px;padding:52px 44px;max-width:420px;width:100%;box-shadow:0 24px 80px rgba(30,20,12,.12);text-align:center;border:1px solid rgba(180,150,130,.18)}
    .logo{width:110px;height:auto;margin:0 auto 28px;display:block;mix-blend-mode:multiply}
    h1{font-family:'Cormorant Garamond',serif;font-size:2rem;font-weight:700;color:#0E0A06;margin-bottom:6px}
    .sub{font-size:.85rem;color:#3D2D24;margin-bottom:32px}
    label{display:block;font-size:.75rem;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:#2A1F18;margin-bottom:6px;text-align:left}
    input[type=password]{width:100%;padding:14px 18px;border:1.5px solid rgba(180,150,130,.35);border-radius:10px;font-family:'DM Sans',sans-serif;font-size:1rem;color:#1C1410;background:#FDFAF6;transition:.25s;outline:none;margin-bottom:18px}
    input[type=password]:focus{border-color:#C96848;box-shadow:0 0 0 4px rgba(201,104,72,.12)}
    .err{background:#FFF0ED;border:1px solid rgba(201,104,72,.25);border-radius:8px;padding:10px 14px;font-size:.84rem;color:#A84830;margin-bottom:18px;text-align:left}
    .warn{background:#FBF3E0;border:1px solid rgba(196,144,58,.25);border-radius:8px;padding:10px 14px;font-size:.84rem;color:#8A6030;margin-bottom:18px;text-align:left}
    button{width:100%;padding:15px;border:none;border-radius:99px;background:linear-gradient(135deg,#C96848,#A84830);color:#fff;font-family:'DM Sans',sans-serif;font-size:1rem;font-weight:700;cursor:pointer;transition:.25s;box-shadow:0 8px 28px rgba(201,104,72,.32)}
    button:hover{transform:translateY(-2px);box-shadow:0 14px 40px rgba(201,104,72,.4)}
    .back{display:block;margin-top:22px;font-size:.82rem;color:#7A6058;text-decoration:none}
    .back:hover{color:#C96848}
  </style>
</head>
<body>
  <div class="card">
    <img src="/logo.png" class="logo" alt="Logo"/>
    <h1>Área Privada</h1>
    <p class="sub">Carla Guerrero · Nutricionista</p>
    ${error ? '<div class="err">❌ Contraseña incorrecta. Intenta nuevamente.</div>' : ''}
    ${msg   ? `<div class="warn">${msg}</div>` : ''}
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
   BOOT — listen FIRST, then connect DB
   ================================================================ */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🌿 Servidor listo en 0.0.0.0:${PORT}`);
  console.log(`   NODE_ENV  : ${process.env.NODE_ENV || 'development'}`);
  console.log(`   DB URL    : ${process.env.DATABASE_URL ? '✅ configurada' : '❌ NO configurada'}`);
  console.log(`   /health   : http://localhost:${PORT}/health\n`);

  if (!process.env.DATABASE_URL) {
    console.warn('⚠️  DATABASE_URL no está definida. El servidor responde pero la BD no está disponible.');
    return;
  }

  initDB()
    .then(() => {
      dbReady = true;
      console.log('✅ Base de datos conectada y lista.\n');
    })
    .catch(err => {
      dbError = err.message;
      console.error('❌ Error DB:', err.message);
    });
});
