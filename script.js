/* ================================================================
   SCRIPT.JS  v3  —  Carla Guerrero Nutricionista
   ================================================================ */

let currentStep = 1;
const TOTAL = 4;

const STEP_ICONS = {
  1:`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  2:`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>`,
  3:`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3v7"/></svg>`,
  4:`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="m4.93 4.93 4.24 4.24"/><path d="m14.83 9.17 4.24-4.24"/><path d="m14.83 14.83 4.24 4.24"/><path d="m9.17 14.83-4.24 4.24"/><circle cx="12" cy="12" r="4"/></svg>`
};
const CHECK_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;

/* ── INIT ───────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  initChips();
  initToggles();
  initCirugiaToggle();
  initUrine();
  initPhoneField();
  initInputFeedback();
  initUpload();
  updateProgress(1);
});

/* ── PHONE FIELD (Chile +56 9) ──────────────────────────────── */
function initPhoneField() {
  const phone = document.getElementById('telefono');
  if (!phone) return;

  // Only allow digits
  phone.addEventListener('input', () => {
    phone.value = phone.value.replace(/\D/g, '').slice(0, 8);
  });

  // Prevent non-numeric key input
  phone.addEventListener('keydown', (e) => {
    const allowed = ['Backspace','Delete','Tab','ArrowLeft','ArrowRight','Home','End'];
    if (!allowed.includes(e.key) && !/^\d$/.test(e.key)) {
      e.preventDefault();
    }
  });

  // Paste handler — strip non-digits
  phone.addEventListener('paste', (e) => {
    e.preventDefault();
    const pasted = (e.clipboardData || window.clipboardData).getData('text');
    const digits = pasted.replace(/\D/g, '').slice(0, 8);
    phone.value = digits;
  });
}

/* ── STEP NAVIGATION ────────────────────────────────────────── */
function goToStep(target) {
  if (target > currentStep && !validateStep(currentStep)) return;

  const from = currentStep;

  // Update dot states
  const fromDot    = document.querySelector(`.step[data-step="${from}"]`);
  const targetDot  = document.querySelector(`.step[data-step="${target}"]`);
  const fromBubble = document.getElementById(`circle-${from}`);
  const targetBubble = document.getElementById(`circle-${target}`);

  if (target > from) {
    fromDot.classList.remove('active');
    fromDot.classList.add('completed');
    fromBubble.innerHTML = CHECK_SVG;
    const line = document.getElementById(`line-${from}`);
    if (line) line.style.width = '100%';
  } else {
    targetDot.classList.remove('completed');
    targetBubble.innerHTML = STEP_ICONS[target];
    const line = document.getElementById(`line-${target}`);
    if (line) line.style.width = '0%';
  }

  targetDot.classList.add('active');
  targetDot.classList.remove('completed');
  targetBubble.innerHTML = STEP_ICONS[target];

  // Swap sections
  const fromEl   = document.getElementById(`step-${from}`);
  const targetEl = document.getElementById(`step-${target}`);
  fromEl.classList.remove('active');
  fromEl.style.display = 'none';
  targetEl.style.display = 'block';
  targetEl.classList.add('active');

  currentStep = target;
  updateProgress(target);

  // Scroll to stepper top
  const stepper = document.querySelector('.stepper-card');
  if (stepper) {
    const y = stepper.getBoundingClientRect().top + window.scrollY - 16;
    window.scrollTo({ top: y, behavior: 'smooth' });
  }
}

/* ── PROGRESS BAR ───────────────────────────────────────────── */
function updateProgress(step) {
  const pct = ((step - 1) / (TOTAL - 1)) * 100;
  const fill = document.getElementById('progressFill');
  if (fill) fill.style.width = pct + '%';
}

/* ── VALIDATION ─────────────────────────────────────────────── */
function validateStep(step) {
  let valid = true;
  let first = null;

  function setErr(id, msg) {
    const el = document.getElementById(id);
    if (!el) { valid = false; return; }
    el.classList.add('error');
    // For phone, mark the wrapper too
    if (id === 'telefono') {
      el.closest('.phone-wrap')?.classList.add('error');
    }
    const span = document.getElementById(`error-${id}`);
    if (span) span.textContent = msg;
    if (!first) first = el;
    valid = false;
  }

  function clrErr(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('error');
    el.closest('.phone-wrap')?.classList.remove('error');
    const span = document.getElementById(`error-${id}`);
    if (span) span.textContent = '';
  }

  if (step === 1) {
    ['nombre','apellido','edad','fechaNacimiento','telefono','email'].forEach(clrErr);

    const nombre   = document.getElementById('nombre')?.value.trim() ?? '';
    const apellido = document.getElementById('apellido')?.value.trim() ?? '';
    const edad     = document.getElementById('edad')?.value ?? '';
    const fecha    = document.getElementById('fechaNacimiento')?.value ?? '';
    const tel      = document.getElementById('telefono')?.value ?? '';
    const email    = document.getElementById('email')?.value.trim() ?? '';

    if (!nombre)                           setErr('nombre',          'Por favor ingresa tu nombre.');
    if (!apellido)                         setErr('apellido',        'Por favor ingresa tu apellido.');
    if (!edad || +edad < 1 || +edad > 120) setErr('edad',           'Ingresa una edad válida (1-120).');
    if (!fecha)                            setErr('fechaNacimiento', 'Selecciona tu fecha de nacimiento.');
    if (!tel || !/^\d{8}$/.test(tel))      setErr('telefono',       'Ingresa los 8 dígitos de tu número.');
    if (!email || !isEmail(email))         setErr('email',           'Ingresa un correo electrónico válido.');
  }

  if (step === 2) {
    ['motivacion','objetivo'].forEach(clrErr);

    const motiv = document.getElementById('motivacion')?.value.trim() ?? '';
    const obj   = document.getElementById('objetivo')?.value ?? '';

    if (!motiv) setErr('motivacion', 'Cuéntame qué te motivó a consultar.');
    if (!obj)   setErr('objetivo',   'Selecciona al menos un objetivo.');
  }

  if (first) {
    first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    first.focus();
  }
  return valid;
}

function isEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }

/* ── CHIPS ──────────────────────────────────────────────────── */
function initChips() {
  // Objetivo
  setupChips('objetivoChips', 'objetivo', true, () => {
    const val = document.getElementById('objetivo').value;
    const el  = document.getElementById('objetivoOtro');
    if (el) el.style.display = val.includes('otro') ? 'block' : 'none';
  });
  // Tipo alimentación
  setupChips('tipoChips', 'tipoAlimentacion', true);
}

function setupChips(groupId, hiddenId, multi, cb) {
  const group  = document.getElementById(groupId);
  const hidden = document.getElementById(hiddenId);
  if (!group || !hidden) return;
  const selected = new Set();

  group.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const v = chip.dataset.value;
      if (multi) {
        chip.classList.toggle('active');
        chip.classList.contains('active') ? selected.add(v) : selected.delete(v);
        hidden.value = [...selected].join(',');
      } else {
        group.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        hidden.value = v;
      }
      // Clear error
      const err = document.getElementById(`error-${hiddenId}`);
      if (err && hidden.value) err.textContent = '';
      if (cb) cb();
    });
  });
}

/* ── TOGGLES ────────────────────────────────────────────────── */
function initToggles() {
  [['tieneMed','detalleMed'],['tieneSup','detalleSup'],['tieneSupDep','detalleSupDep'],['tieneEnfermedad','detalleEnfermedad']].forEach(([name, id]) => {
    document.querySelectorAll(`input[name="${name}"]`).forEach(r => {
      r.addEventListener('change', () => {
        const el = document.getElementById(id);
        if (el) el.style.display = (r.value === 'si' && r.checked) ? 'block' : 'none';
      });
    });
  });
}

function initCirugiaToggle() {
  document.querySelectorAll('input[name="tieneCirugia"]').forEach(r => {
    r.addEventListener('change', () => {
      const ta = document.getElementById('cirugia');
      if (!ta) return;
      if (r.value === 'si' && r.checked) { ta.style.display = 'block'; ta.focus(); }
      else if (r.value === 'no' && r.checked) { ta.style.display = 'none'; ta.value = ''; }
    });
  });
}

/* ── URINE ──────────────────────────────────────────────────── */
function initUrine() {
  const btns   = document.querySelectorAll('.urine-btn');
  const hidden = document.getElementById('colorOrina');
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      btns.forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      if (hidden) hidden.value = btn.dataset.val;
    });
  });
}

/* ── FILE UPLOAD (drag-and-drop + preview) ──────────────── */
let selectedFiles = []; // maintain own list so we can remove individual files

function fileIcon(mime) {
  if (mime === 'application/pdf') return '📄';
  if (mime.startsWith('image/'))   return '🖼️';
  return '📝'; // Word / generic
}

function formatBytes(bytes) {
  if (bytes < 1024)       return bytes + ' B';
  if (bytes < 1024*1024)  return (bytes/1024).toFixed(1) + ' KB';
  return (bytes/1024/1024).toFixed(1) + ' MB';
}

function renderFileList() {
  const list = document.getElementById('fileList');
  if (!list) return;
  list.innerHTML = '';
  selectedFiles.forEach((file, idx) => {
    const li = document.createElement('li');
    li.className = 'file-item';
    li.innerHTML = `
      <span class="file-item-icon">${fileIcon(file.type)}</span>
      <span class="file-item-name" title="${file.name}">${file.name}</span>
      <span class="file-item-size">${formatBytes(file.size)}</span>
      <button type="button" class="file-item-remove" aria-label="Eliminar" data-idx="${idx}">×</button>
    `;
    li.querySelector('.file-item-remove').addEventListener('click', () => {
      selectedFiles.splice(idx, 1);
      renderFileList();
    });
    list.appendChild(li);
  });
}

function addFiles(newFiles) {
  const MAX = 5;
  const MAX_BYTES = 8 * 1024 * 1024;
  for (const file of newFiles) {
    if (selectedFiles.length >= MAX) {
      alert('Máximo 5 archivos permitidos.'); break;
    }
    if (file.size > MAX_BYTES) {
      alert(`«${file.name}» supera el límite de 8 MB.`); continue;
    }
    const allowed = ['application/pdf','image/jpeg','image/jpg','image/png',
      'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (!allowed.includes(file.type)) {
      alert(`Formato no permitido: «${file.name}». Use PDF, JPG, PNG o Word.`); continue;
    }
    selectedFiles.push(file);
  }
  renderFileList();
}

function initUpload() {
  const zone  = document.getElementById('uploadZone');
  const input = document.getElementById('adjuntosInput');
  if (!zone || !input) return;

  /* Click anywhere on zone → open picker */
  zone.addEventListener('click', (e) => {
    if (e.target.classList.contains('upload-link')) return; // handled by onclick
    input.click();
  });

  /* File input change */
  input.addEventListener('change', () => {
    if (input.files.length) addFiles(Array.from(input.files));
    input.value = ''; // reset so same file can be re-added after removal
  });

  /* Drag and drop */
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('drag-over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    if (e.dataTransfer.files.length) addFiles(Array.from(e.dataTransfer.files));
  });
}

/* ── INPUT FEEDBACK ─────────────────────────────────────────── */
function initInputFeedback() {
  document.querySelectorAll('.field-input,.field-textarea,.field-select').forEach(el => {
    el.addEventListener('input', () => {
      if (el.classList.contains('error') && el.value.trim()) {
        el.classList.remove('error');
        el.closest('.phone-wrap')?.classList.remove('error');
        const span = document.getElementById(`error-${el.id}`);
        if (span) span.textContent = '';
      }
    });
  });
}

/* ── SUBMIT ─────────────────────────────────────────────────── */
document.getElementById('nutritionForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!validateStep(4)) return;

  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.innerHTML = `<svg class="spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Enviando...`;

  try {
    /* Build multipart FormData so files + fields go in one request */
    const form    = document.getElementById('nutritionForm');
    const rawForm = new FormData(form);
    const fd      = new FormData();

    /* Copy all text/radio/select fields */
    rawForm.forEach((val, key) => {
      if (key !== 'adjuntos') fd.append(key, val);
    });

    /* Add chip/hidden fields */
    ['objetivo','tipoAlimentacion','colorOrina'].forEach(id => {
      const el = document.getElementById(id);
      if (el) fd.set(id, el.value);
    });

    /* Attach files from selectedFiles array */
    selectedFiles.forEach(file => fd.append('adjuntos', file, file.name));

    const res = await fetch('/api/submissions', {
      method: 'POST',
      body:   fd          // browser sets multipart/form-data + boundary automatically
    });

    const json = await res.json();

    if (!res.ok || !json.success) {
      throw new Error(json.message || 'Error al enviar la ficha.');
    }

    // Show success
    document.getElementById('successOverlay').classList.add('visible');
    document.body.style.overflow = 'hidden';

  } catch (err) {
    alert('❌ ' + (err.message || 'Ocurrió un error. Por favor intenta nuevamente.'));
    btn.disabled = false;
    btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 2L11 13"/><path d="M22 2L15 22l-4-9-9-4 20-7z"/></svg> Enviar mi Ficha Nutricional`;
  }
});


/* ── RESET ──────────────────────────────────────────────────── */
function resetForm() {
  document.getElementById('nutritionForm').reset();
  document.getElementById('successOverlay').classList.remove('visible');
  document.body.style.overflow = '';

  // Reset chips
  document.querySelectorAll('.chip.active').forEach(c => c.classList.remove('active'));
  ['objetivo','tipoAlimentacion'].forEach(id => { const e = document.getElementById(id); if(e) e.value=''; });
  const oo = document.getElementById('objetivoOtro'); if(oo) oo.style.display='none';

  // Reset urine
  document.querySelectorAll('.urine-btn.selected').forEach(b => b.classList.remove('selected'));
  const co = document.getElementById('colorOrina'); if(co) co.value='';

  // Reset reveal blocks
  ['detalleMed','detalleSup','detalleSupDep'].forEach(id => { const e=document.getElementById(id); if(e) e.style.display='none'; });
  const cir = document.getElementById('cirugia'); if(cir){ cir.style.display='none'; cir.value=''; }

  // Reset file list
  selectedFiles = [];
  renderFileList();

  // Reset stepper
  for (let i=1;i<=TOTAL;i++) {
    const dot = document.querySelector(`.step[data-step="${i}"]`);
    const bub = document.getElementById(`circle-${i}`);
    if(dot){ dot.classList.remove('active','completed'); }
    if(bub) bub.innerHTML = STEP_ICONS[i];
    const line = document.getElementById(`line-${i}`);
    if(line) line.style.width = '0%';
  }

  // Reset sections
  document.querySelectorAll('.form-card').forEach(s => { s.classList.remove('active'); s.style.display='none'; });

  currentStep = 1;
  document.querySelector('.step[data-step="1"]').classList.add('active');
  const s1 = document.getElementById('step-1');
  s1.style.display='block'; s1.classList.add('active');
  updateProgress(1);

  const btn = document.getElementById('submitBtn');
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 2L11 13"/><path d="M22 2L15 22l-4-9-9-4 20-7z"/></svg> Enviar mi Ficha Nutricional`;
  }

  window.scrollTo({ top:0, behavior:'smooth' });
}

/* ── PREVENT ENTER SUBMIT ───────────────────────────────────── */
document.addEventListener('keydown', e => {
  if (e.key==='Enter' && e.target.tagName!=='TEXTAREA' && e.target.tagName!=='BUTTON') {
    e.preventDefault();
  }
});
