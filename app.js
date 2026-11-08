/* =====================================================
   FELIX LAB COMMUNITY HUB — app.js
   ===================================================== */

/* ============ State ============ */
let sb = null;
let session = null;
let profile = null;
let activeTab = 'home';
const liked = new Set();
let postsById = {};
let rtChannel = null;

/* Kredensial rilis (UILTIN — jangan dibagikan supaya tidak ditimpa) */
const DEFAULT_URL = 'https://bsydwicfqlfzrglvcwyf.supabase.co';
const DEFAULT_KEY = 'sb_publishable_ntfn_HEdWfyLNlWTKJ50OQ_ews-Flh0';

/* Gaya avatar dicebear yang bisa dipilih user */
const AVATAR_STYLES = ['bottts', 'bottts-neutral', 'avataaars', 'big-smile', 'fun-emoji', 'identicon', 'thumbs', 'adventurer', 'micah', 'notionists'];
/* backgroundColor=… : bot SVG banyak yang body-nya GELAP → di dark mode nyatu
   dengan kartu hitam. Kasih latar honey sesuai gaya zine = selalu terbaca */
const dicebear = (style, seed) => `https://api.dicebear.com/7.x/${style}/svg?seed=${seed || 'user'}&backgroundColor=ffd84d,ffdf7e,ffe9a3,ffd9b3`;

/* ============ Init ============ */
document.addEventListener('DOMContentLoaded', () => {
    applyTheme(savedTheme());
    /* Banner cookie cuma MUNCUL SEKALI: sekali tersaji, tanda fx_banner
       terpasang — tidak mengganggu setiap kali memuat ulang.
       Pengguna tetap bisa berubah pikiran kapanpun di Setelan ⚙️ */
    if (!consentMode() && !getCookie('fx_banner')) {
        setCookie('fx_banner', '1');
        document.getElementById('consentBar').classList.remove('hidden');
    }
    try {
        matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
            if (savedTheme() === 'auto') applyTheme('auto');
        });
    } catch (e) {}

    // semua tombol [data-tab] mengganti tab
    document.querySelectorAll('[data-tab]').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // klik area gelap = tutup modal; ESC = tutup semua
    document.querySelectorAll('.overlay').forEach(ov => {
        ov.addEventListener('click', (e) => { if (e.target === ov) closeModal(ov.id); });
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') document.querySelectorAll('.overlay.open').forEach(ov => closeModal(ov.id));
    });

    renderAuthBar();
    updatePermBadge();
    initDb();
});

/* ============ Supabase (kredensial sudah tertanam — tanpa inputan) ============ */
async function initDb() {
    setConn('connecting');
    if (!window.supabase) { setConn('off'); return; }
    try {
        sb = window.supabase.createClient(DEFAULT_URL, DEFAULT_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
        const { error } = await sb.from('profiles').select('id').limit(1);
        if (error) throw error;
        setConn('on');
        let lastAuth = null, authTimer = null;
        sb.auth.onAuthStateChange((ev, s) => {
            // TOKEN_REFRESHED muncul tiap beberapa menit — abaikan biar nggak re-render
            if (ev === 'TOKEN_REFRESHED') return;
            if (ev === lastAuth && !s) return;
            clearTimeout(authTimer);
            authTimer = setTimeout(async () => {
                session = s;
                if (s?.user) await loadProfile(s.user);
                else profile = null;
                renderAuthBar();
                updatePermBadge();
                if (feedLoaded.community) loadFeed('community');
                if (feedLoaded.news) loadFeed('news');
                lastAuth = ev;
            }, 80);
        });
        const { data } = await sb.auth.getSession();
        session = data.session;
        if (session?.user) await loadProfile(session.user);
        renderAuthBar();
        updatePermBadge();
        await loadFeed('community');   // feed utama: load ini doang saat startup
        await loadResources();
        setupRealtime();
    } catch (e) {
        console.error(e);
        setConn('off');
        toast('Koneksi gagal: ' + (e.message || e), true);
    }
}

function setConn(state) {
    const el = document.getElementById('connPill');
    if (!el) return;
    if (state === 'on')        { el.className = 'status-strip ok';   el.textContent = '● live'; }
    else if (state === 'connecting') { el.className = 'status-strip warn'; el.textContent = 'connecting'; }
    else                       { el.className = 'status-strip off';  el.textContent = 'offline'; }
}

async function loadProfile(user) {
    if (!sb) return;
    try {
        const { data, error } = await sb.from('profiles').select('*').eq('id', user.id).single();
        if (error || !data) {
            profile = {
                id: user.id,
                username: (user.user_metadata && user.user_metadata.username) || user.email.split('@')[0],
                display_name: (user.user_metadata && user.user_metadata.display_name) || (user.user_metadata && user.user_metadata.username) || user.email.split('@')[0],
                avatar_url: (user.user_metadata && user.user_metadata.avatar_url) || dicebear('bottts', user.id),
                role: 'user', badge_type: null
            };
        } else profile = data;
    } catch (e) { console.error(e); }
}

function me() {
    if (!session?.user) return null;
    const u = session.user;
    const p = profile || {};
    return {
        id: u.id,
        username: p.username || u.user_metadata?.username || u.email.split('@')[0],
        name: p.display_name || u.user_metadata?.display_name || u.user_metadata?.username || u.email.split('@')[0],
        avatar: p.avatar_url || u.user_metadata?.avatar_url || dicebear('bottts', u.id),
        role: p.role || 'user',
        badge: p.badge_type || null,
        official: p.role === 'admin' || p.badge_type === 'blue',
        verified: p.badge_type === 'green'
    };
}
function isOfficial() { const u = me(); return !!u && u.official; }
function isVerified() { const u = me(); return !!u && (u.official || u.verified); }
function canPost() { return isVerified(); }

/* ============ UI helpers ============ */
function toast(msg, err = false) {
    const el = document.getElementById('toast');
    const ic = document.getElementById('toastIcon');
    document.getElementById('toastMsg').textContent = msg;
    el.className = err ? 'toast err' : 'toast';
    ic.className = err ? 'fa-solid fa-circle-exclamation' : 'fa-solid fa-circle-check';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.add('hidden'), 3000);
}
function copyLink(txt, msg) {
    const t = document.createElement('input'); t.value = txt;
    document.body.appendChild(t); t.select(); document.execCommand('copy'); document.body.removeChild(t);
    toast(msg || 'Disalin');
}
/* ============ Cookie helpers (Local-object 365 hari, SameSite=Lax) ============ */
function setCookie(name, val) {
    document.cookie = `${name}=${encodeURIComponent(val)}; max-age=31536000; path=/; SameSite=Lax`;
}
function getCookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
}
function delCookie(name) { document.cookie = `${name}=; max-age=0; path=/; SameSite=Lax`; }

/* ============ Tema (dark/light/auto — disimpan COOKIE, SELALU) ============
   FILOSOFI SIMPEL (fix "bridak berantakan"):
   - Tema itu cookie FUNGSIONAL, persis YouTube: kamu memilih → diingat. Poin.
   - fx_consent cuma CATATAN jawaban di banner (cookie wajib, biar nggak ditanya ulang).
   - Nggak ada drama "cookie ditolak → setelan hilang". Hapus preferensi = reset total. */
const THEME_KEY = 'fx_theme';
function savedTheme() {
    const c = getCookie('fx_theme');
    if (c) return c;
    const legacy = localStorage.getItem(THEME_KEY);         // migrasi setting lama → cookie
    if (legacy) { setCookie('fx_theme', legacy); localStorage.removeItem(THEME_KEY); return legacy; }
    return 'auto';
}
function systemDark() { return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches; }
function applyTheme(t, persist = true) {
    if (persist) setCookie('fx_theme', t);   // cookie fungsional — selalu disimpan
    const dark = t === 'dark' || (t === 'auto' && systemDark());
    document.body.classList.toggle('theme-dark', dark);
    document.querySelectorAll('.set-opt').forEach(b => b.classList.toggle('on', b.dataset.mode === t));
}
function setTheme(t) {
    document.body.classList.add('theme-fade');
    applyTheme(t);
    toast(t === 'auto' ? 'Tema ikut setting HP' : t === 'dark' ? 'Dark mode menyala 🌙' : 'Light mode siang terang ☀️');
    setTimeout(() => document.body.classList.remove('theme-fade'), 500);
}
function openSettings() {
    applyTheme(savedTheme(), true);
    // label status di modal — jujur & simpel
    const st = document.getElementById('consentStatus');
    if (st) {
        const mode = consentMode();
        const stx = mode === '1' ? 'diterima' : mode === '0' ? 'ditolak' : 'belum dipilih';
        st.innerHTML = '<i class="fa-solid fa-cookie-bite"></i> Temamu selalu diingat lewat cookie fungsional (365 hari). Jawaban banner cookie: <b>' + stx + '</b>.';
    }
    openModal('settingsModal');
}

/* ============ Consent ============
   '' belum diputuskan → banner tampil (SEKALI, tanda fx_banner)
   '1' diterima        → dicatat
   '0' ditolak         → dicatat (cookie teknis tetap dipakai biar web jalan) */
function consentMode()     { return getCookie('fx_consent'); }
function consentGiven()    { return consentMode() === '1'; }
function consentRejected() { return consentMode() === '0'; }
function acceptConsent() {
    const first = !consentMode();
    setCookie('fx_consent', '1');
    document.getElementById('consentBar').classList.add('hidden');
    if (first) toast('Tercatat! Makasih 🍪');
}
function rejectConsent() {
    const first = !consentMode();
    setCookie('fx_consent', '0');
    document.getElementById('consentBar').classList.add('hidden');
    if (first) toast('Tercatat — cookie teknis tetap dipakai biar web jalan.');
}
function openPrivacy() { openModal('privacyModal'); }
function resetMySettings() {
    if (!confirm('Hapus semua preferensi (tema & izin cookie) di perangkat ini?')) return;
    delCookie('fx_theme'); delCookie('fx_consent'); delCookie('fx_banner');
    localStorage.removeItem(THEME_KEY);
    // visual balik ke "ikut sistem" TANPA re-nge-set cookie (bug lama: hapus tapi langsung keisi lagi)
    document.body.classList.remove('theme-fade');
    document.body.classList.toggle('theme-dark', systemDark());
    document.querySelectorAll('.set-opt').forEach(b => b.classList.toggle('on', b.dataset.mode === 'auto'));
    document.getElementById('consentBar').classList.remove('hidden');
    toast('Preferensi bersih — kembali ke default');
}
function esc(s) { if (s == null) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
/* kunci rate-limit per-aksi (klik dobel / spam) — cegah request kembar
   yang bikin dobel data + bikin jaringan macet di jaringan HP lemah */
const tapGate = new Map();
function gateTap(key, ms) {
    const now = Date.now();
    if (now - (tapGate.get(key) || 0) < ms) return false;
    tapGate.set(key, now);
    return true;
}
/* buat argumen string di dalam onclick="…" : buang karakter yang bikin JS string pecah */
function jsArg(s) { return String(s ?? '').replace(/['"\\=`]/g, ''); }
function ago(iso) {
    if (!iso) return '';
    const d = (Date.now() - new Date(iso).getTime()) / 1000;
    if (d < 60) return 'baru!';
    if (d < 3600) return Math.floor(d/60) + 'm lalu';
    if (d < 86400) return Math.floor(d/3600) + 'j lalu';
    return new Date(iso).toLocaleDateString('id-ID', { day:'2-digit', month:'short' });
}
/* badge = IKON lingkaran-check sederhana ala YouTube — biru = official, hijau = verified.
   tanpa kapsul teks miring (yang dulu bikin layout goyang/glitch di font besar-kecil) */
function badgeMark(p) {
    if (!p) return '';
    if (p.role === 'admin' || p.badge_type === 'blue')
        return '<span class="badge b-blue" title="Official — staff Felix Lab"><i class="fa-solid fa-circle-check"></i></span>';
    if (p.badge_type === 'green')
        return '<span class="badge b-green" title="Verified"><i class="fa-solid fa-circle-check"></i></span>';
    return '';
}
function openModal(id) { document.getElementById(id).classList.add('open'); document.body.style.overflow = 'hidden'; }
function closeModal(id) {
    document.getElementById(id).classList.remove('open');
    document.body.style.overflow = '';
    // HEMAT STORAGE: modal resource ditutup tapi file temp belum disimpan → hapus dari bucket
    if (id === 'resourceModal' && resFile?.tmp) {
        sb?.storage.from('files').remove([resFile.path]).catch(() => {});
        resFile = null;
    }
}

function switchTab(tab) {
    activeTab = tab;
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    document.getElementById('tab-' + tab)?.classList.remove('hidden');
    document.querySelectorAll('.tabbtn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    closeCaret();
    if (sb) {
        if (tab === 'resources') {
            if (!resLoaded) loadResources();           // sudah pernah load → jangan refetch/re-animate
        }
        else if ((tab === 'news' || tab === 'community') && !feedLoaded[tab]) loadFeed(tab);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* menu user (dropdown) */
function closeCaret() { document.getElementById('userCaret')?.classList.remove('open'); }
document.addEventListener('click', (ev) => {
    if (!ev.target.closest('.authbar-slot')) closeCaret();
});

/* ============ File helpers (unduh + format ukuran) ============ */
function fmtBytes(n) {
    if (!n && n !== 0) return '';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
}
/* ============ HEMAT STORAGE: kompres gambar SEBELUM upload ============
   1 foto HP was-was 3-5MB → kalau tiap upload masuk bucket apa adanya,
   kuota Supabase (1GB) bisa tinggal sisa segelintir upload.
   Canvas memampatkan jadi WebP kecil (±80-200KB). Gagal/kegedean → file asli. */
function compressImage(file, maxDim, quality) {
    return new Promise((resolve) => {
        if (!file.type.startsWith('image/') || file.type === 'image/gif') return resolve(file);
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            const sc = Math.min(1, maxDim / Math.max(img.width, img.height));
            const cv = document.createElement('canvas');
            cv.width = Math.max(1, Math.round(img.width * sc));
            cv.height = Math.max(1, Math.round(img.height * sc));
            const cx = cv.getContext('2d');
            cx.drawImage(img, 0, 0, cv.width, cv.height);
            const finish = (blob, q) => {
                if (!blob) return resolve(file);
                if (blob.size > 900 * 1024 && q > 0.5) {          // masih gede → turunkan mutu lagi
                    cv.toBlob(b => finish(b, q - 0.2), 'image/webp', q - 0.2);
                    return;
                }
                if (blob.size < file.size) {
                    const ext = blob.type.includes('webp') ? 'webp' : 'jpg';
                    const out = new File([blob], (file.name.replace(/\.[^.]+$/, '') || 'image') + '.' + ext, { type: blob.type });
                    resolve(out);
                } else resolve(file);                              // kompres malah gede → pakai asli
            };
            cv.toBlob(b => finish(b, quality), 'image/webp', quality);
        };
        img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
        img.src = url;
    });
}
/* unduh via blob supaya browser tidak buka tab, cukup simpan langsung */
async function downloadFile(bucket, path, name) {
    if (!sb) { toast('Layanan lagi bermasalah', true); return; }
    if (!path) return;
    toast('Mengunduh ' + (name || 'file') + '…');
    try {
        const { data, error } = await sb.storage.from(bucket).download(path);
        if (error) throw error;
        const url = URL.createObjectURL(data);
        const a = document.createElement('a');
        a.href = url;
        a.download = name || path.split('/').pop() || 'file';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        toast('Selesai! Cek folder unduhan.');
    } catch (e) {
        console.error(e);
        toast(e.message || 'Gagal mengunduh', true);
    }
}
/* chip lampiran generik = nama + ukuran + tombol unduh (noDl = tanpa tombol unduh) */
function fileChipHtml(bucket, path, name, size, removableId, noDl) {
    const nm = jsArg(name || path.split('/').pop());
    let right = '';
    if (removableId) right = `<button type="button" class="att-x" onclick="clearAttach('${esc(removableId)}')" title="Hapus lampiran"><i class="fa-solid fa-xmark"></i></button>`;
    else if (!noDl) right = `<button type="button" class="att-dl" onclick="downloadFile('${jsArg(bucket)}','${jsArg(path)}','${nm}')" title="Unduh"><i class="fa-solid fa-download"></i></button>`;
    return `
    <span class="att-name"><i class="fa-solid fa-file"></i> ${esc(name || path.split('/').pop())}</span>
    <span class="att-size mono">${fmtBytes(size)}</span>${right}`;
}

/* ============ Resources (bikin konten lewat aplikasi) ============ */
const RES_TAGS = ['SHADER', 'MOD', 'SCRIPT', 'APP', 'LAINNYA'];
let resById = {};   // cache baris by id — biar edit tak perlu rapal DOM
let resCache = [];  // cache baris lengkap buat filter pencarian
let resLoaded = false; // resources sudah pernah didapat → re-render jadi quiet

function renderResGrid(query) {
    const grid = document.getElementById('resourceGrid');
    if (!resCache.length) {
        grid.innerHTML = `<div class="empty"><i class="fa-solid fa-box-open"></i><span>Belum ada resource${isOfficial() ? ' — tambah lewat tombol di atas!' : ', datang lagi nanti ya.'}</span></div>`;
        return;
    }
    const kw = (query || '').trim().toLowerCase();
    const list = kw
        ? resCache.filter(r => `${r.title || ''} ${r.description || ''} ${r.tag || ''}`.toLowerCase().includes(kw))
        : resCache;
    grid.innerHTML = list.map(r => resCardHtml(r)).join('')
        || `<div class="empty"><i class="fa-solid fa-magnifying-glass"></i><span>Nggak ada resource yang cocok dengan “${esc(kw)}”.</span></div>`;
}

function resCardHtml(r) {
    const admin = isOfficial();
    const acts = admin ? `
        <div class="res-acts">
            <button type="button" class="res-act" onclick="editResource('${jsArg(r.id)}')" title="Edit"><i class="fa-solid fa-pen"></i></button>
            <button type="button" class="res-act del" onclick="deleteResource('${jsArg(r.id)}')" title="Hapus"><i class="fa-solid fa-trash-can"></i></button>
        </div>` : '';
    const fileBlock = r.file_path
        ? `<div class="res-file">${fileChipHtml('files', r.file_path, r.file_name, r.file_size)}</div>
           <button type="button" class="btn btn-ink sm w-full" onclick="downloadFile('files','${jsArg(r.file_path)}','${jsArg(r.file_name || '')}')">
               <i class="fa-solid fa-file-arrow-down"></i> Unduh${r.file_size ? ` · ${fmtBytes(r.file_size)}` : ''}
           </button>`
        : `<button type="button" class="btn btn-ghost sm w-full" onclick="copyLink('${jsArg(r.url)}','Tautan disalin — lempar ke grup!')">
               <i class="fa-solid fa-link"></i> Salin tautan
           </button>`;
    return `
    <div class="card res-card" data-rid="${esc(r.id)}">
        <div class="res-top">
            <span class="res-tag">${esc(r.tag || 'LAINNYA')}</span>
            <div class="res-tools">${acts}</div>
        </div>
        <h3>${esc(r.title)}</h3>
        <p>${esc(r.description || '')}</p>
        <div class="rate-row" data-rr="${esc(r.id)}">
            <span class="rate-stat"><i class="fa-solid fa-star"></i> <b>${r._n ? (Math.round(r._sum / r._n * 10) / 10) : '—'}</b> <span>(${r._n || 0} rating)</span></span>
            <span class="rate-stars">${[1,2,3,4,5].map(k =>
                `<button type="button" class="rate-star ${((r._mine||0) >= k) ? 'on' : ''}" data-n="${k}" onclick="rateResource('${jsArg(r.id)}',${k})" title="beri ${k} bintang"><i class="fa-${((r._mine||0) >= k) ? 'solid' : 'regular'} fa-star"></i></button>`
            ).join('')}</span>
        </div>
        ${fileBlock}
    </div>`;
}
function renderResourceAdminBtn() {
    document.getElementById('resourceAdminBtn').innerHTML = isOfficial()
        ? '<button type="button" class="btn btn-ink sm" onclick="openResourceModal()"><i class="fa-solid fa-plus"></i> Tambah resource</button>'
        : '';
}
async function loadResources() {
    const grid = document.getElementById('resourceGrid');
    const quiet = resLoaded;          // re-render → tanpa animasi ulang
    resLoaded = true;
    grid.classList.toggle('quiet', quiet);
    renderResourceAdminBtn();
    if (!sb) {
        grid.innerHTML = `<div class="empty"><i class="fa-solid fa-plug-circle-exclamation"></i><span>Layanan lagi bermasalah — tarik ke refresh nanti ya.</span></div>`;
        return;
    }
    grid.innerHTML = '<div class="loader-line">mengambil resource…</div>';
    try {
        const { data, error } = await sb.from('resources').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        if (!data || !data.length) {
            resCache = [];
            resById = {};
            renderResGrid('');
            return;
        }
        resCache = data;
        resById = {};
        data.forEach(r => { resById[r.id] = r; });
        // rating bintang: rerata + jumlah + punyaku — 1 query untuk semua resource
        try {
            const uid = session?.user?.id;
            const { data: rr, error: rrErr } = await sb.from('resource_ratings')
                .select('resource_id,stars,user_id').in('resource_id', data.map(x => x.id));
            if (!rrErr && rr) {
                const bag = {}, mineMap = {};
                rr.forEach(x => {
                    const b = bag[x.resource_id] || { sum: 0, n: 0 };
                    b.sum += x.stars; b.n++;
                    bag[x.resource_id] = b;
                    if (uid && x.user_id === uid) mineMap[x.resource_id] = x.stars;
                });
                data.forEach(r => {
                    const b = bag[r.id];
                    r._sum = b?.sum || 0;
                    r._n = b?.n || 0;
                    r._mine = mineMap[r.id] || 0;
                });
            }
        } catch (e2) { console.warn('rating:', e2.message); }
        renderResGrid(document.getElementById('resSearch')?.value || '');
    } catch (e) {
        console.warn(e);
        resCache = [];
        resById = {};
        grid.innerHTML = `<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><span>Resource lagi nggak bisa diambil — coba lagi nanti.</span></div>`;
    }
}
function openResourceModal() {
    if (!isOfficial()) return;
    document.getElementById('rId').value = '';
    document.getElementById('rTitle').value = '';
    document.getElementById('rUrl').value = '';
    document.getElementById('rDesc').value = '';
    resFile = null;
    renderResFileChip();
    pickResTag('SHADER');
    document.querySelector('#resourceModal .modal-title').textContent = 'Bagi file ke komunitas';
    openModal('resourceModal');
}
/* upload file resource (admin, tipe apa saja) ke bucket 'files' */
let resFile = null; // {path, name, size}
async function uploadResourceFile(input) {
    const file = input?.files?.[0];
    if (!file) return;
    input.value = '';
    if (!sb) { toast('Layanan lagi bermasalah', true); return; }
    if (file.size > 50 * 1024 * 1024) { toast('File terlalu besar (maks 50MB)', true); return; }
    const u = session.user;
    toast('Mengunggah ' + file.name + '…');
    try {
        const safe = (file.name || 'file.bin').replace(/[^\w.\-]+/g, '_');
        const path = `${u.id}/res-${Date.now()}-${safe}`;
        const { error } = await sb.storage.from('files').upload(path, file, {
            contentType: file.type || undefined,
            cacheControl: '3600'
        });
        if (error) throw error;
        // hapus file temp yang sebelumnya dipilih (ganti file) biar bucket nggak numpuk
        if (resFile?.tmp) sb.storage.from('files').remove([resFile.path]).catch(() => {});
        resFile = { path, name: file.name, size: file.size, tmp: true };
        renderResFileChip();
        toast('File terunggah! Klik Simpan resource.');
    } catch (e) {
        console.error(e);
        toast((e.message || 'Upload gagal') , true);
    }
}
function renderResFileChip() {
    const box = document.getElementById('rFileChip');
    if (!resFile) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    box.classList.remove('hidden');
    box.innerHTML = fileChipHtml('files', resFile.path, resFile.name, resFile.size, null, true) +
        `<button type="button" class="att-x" onclick="clearResFile()" title="Batal"><i class="fa-solid fa-xmark"></i></button>`;
}
function clearResFile() {
    // hapus hanya file temp YANG BARU di-upload (bukan file lama milik resource yang diedit)
    if (resFile?.tmp) sb.storage.from('files').remove([resFile.path]).catch(() => {});
    resFile = null; renderResFileChip();
}
function renderResourceTagOpts(selected) {
    document.getElementById('rTagWrap').innerHTML = RES_TAGS.map(t =>
        `<button type="button" class="tag-opt ${t === selected ? 'on' : ''}" onclick="pickResTag('${t}')">${t}</button>`
    ).join('');
}
function pickResTag(t) {
    document.getElementById('rTag').value = t;
    renderResourceTagOpts(t);
}
function editResource(id) {
    const r = resById[id];
    if (!r) return;
    document.getElementById('rId').value = r.id;
    document.getElementById('rTitle').value = r.title || '';
    document.getElementById('rDesc').value = r.description || '';
    document.getElementById('rUrl').value = r.url || '';
    // file lama ikut tersimpan biar tidak hilang saat simpan
    resFile = r.file_path ? { path: r.file_path, name: r.file_name || r.file_path.split('/').pop(), size: r.file_size || 0 } : null;
    renderResFileChip();
    pickResTag(r.tag || 'LAINNYA');
    document.querySelector('#resourceModal .modal-title').textContent = 'Edit resource';
    openModal('resourceModal');
}
async function saveResource() {
    if (!sb) { toast('Layanan lagi bermasalah', true); return; }
    if (!isOfficial()) { toast('Khusus admin', true); return; }
    const id = document.getElementById('rId').value;
    const title = document.getElementById('rTitle').value.trim();
    const url = document.getElementById('rUrl').value.trim();
    const desc = document.getElementById('rDesc').value.trim();
    const tag = document.getElementById('rTag').value;
    if (!title) { toast('Judul wajib diisi', true); return; }
    if (!url && !resFile) { toast('Isi URL **atau** upload file dulu', true); return; }
    const oldFilePath = id ? resById[id]?.file_path : null;   // file lama milik resource yang diedit
    try {
        let error;
        const base = {
            title,
            description: desc,
            url,
            tag,
            file_path: resFile?.path || null,
            file_name: resFile?.name || null,
            file_size: resFile?.size || null
        };
        if (id) {
            ({ error } = await sb.from('resources').update(base).eq('id', id));
        } else {
            ({ error } = await sb.from('resources').insert({ ...base, created_by: me()?.id }));
        }
        if (error) throw error;
        // HEMAT STORAGE: file lama sudah tidak direferensikan DB → hapus dari bucket
        if (oldFilePath && resFile?.path !== oldFilePath) {
            sb.storage.from('files').remove([oldFilePath]).catch(() => {});
        }
        resFile = null;   // sudah tersimpan — jangan disentuh pembersih temp di closeModal
        closeModal('resourceModal');
        toast(id ? 'Resource di-update' : 'Resource ditambahkan');
        await loadResources();
    } catch (e) {
        toast((e.message || 'Gagal simpan'), true);
    }
}
async function deleteResource(id) {
    if (!sb || !isOfficial()) return;
    if (!confirm('Hapus resource ini? Yakin? Tidak bisa dibatalkan.')) return;
    try {
        const oldPath = resById[id]?.file_path;
        const { error } = await sb.from('resources').delete().eq('id', id);
        if (error) throw error;
        // HEMAT STORAGE: filenya ikut dibersihkan — kalau hanya baris DB yang dihapus,
        // file 50MB di bucket tetap nginap sampai akhir zaman
        if (oldPath) sb.storage.from('files').remove([oldPath]).catch(() => {});
        toast('Resource dihapus');
        await loadResources();
    } catch (e) { toast(e.message || 'Gagal hapus', true); }
}

/* ============ Auth bar ============ */
function renderAuthBar() {
    const slot = document.getElementById('authBar');
    const u = me();
    if (!sb) {
        slot.innerHTML = '';
        return;
    }
    if (!u) {
        slot.innerHTML = `
            <button type="button" class="btn btn-accent sm" onclick="openAuth('login')"><i class="fa-solid fa-right-to-bracket"></i> Masuk</button>
            <button type="button" class="btn btn-ghost sm" onclick="openAuth('signup')"><i class="fa-solid fa-user-plus"></i> Daftar</button>`;
        return;
    }
    slot.innerHTML = `
        <button type="button" class="user-chip" onclick="toggleCaret(event)">
            <img src="${esc(u.avatar)}" class="p-ava sm" alt="" onerror="this.onerror=null;this.src='assets/yt-profile.png'">
            <span class="chip-name">${esc(u.name)}</span>
            ${badgeMark({ role: u.role, badge_type: u.badge })}
            <i class="fa-solid fa-chevron-down chip-caret"></i>
        </button>
        <div id="userCaret" class="user-caret">
            <button type="button" onclick="closeCaret(); openProfileModal()"><i class="fa-solid fa-user-pen"></i> Edit profil &amp; foto</button>
            <button type="button" onclick="closeCaret(); openSettings()"><i class="fa-solid fa-gear"></i> Pengaturan &amp; tema</button>
            ${u.official ? '<button type="button" onclick="closeCaret(); openAdmin()"><i class="fa-solid fa-gavel"></i> Moderasi verified</button>' : ''}
            <hr class="uc-hr">
            <button type="button" class="danger" onclick="closeCaret(); signOut()"><i class="fa-solid fa-right-from-bracket"></i> Log out</button>
        </div>`;
}
function toggleCaret(ev) {
    ev.stopPropagation();
    document.getElementById('userCaret')?.classList.toggle('open');
}

/* ============ Modal Auth ============ */
function openAuth(mode = 'login') {
    document.getElementById('authBody').innerHTML = `
        <p class="modal-kicker">RUANG MEMBERS</p>
        <h3 class="modal-title">${mode === 'login' ? 'Balik lagi?' : 'Baru kesini?'}</h3>
        <div class="auth-tabs">
            <button type="button" class="auth-tab ${mode==='login'?'active':''}" onclick="openAuth('login')">Masuk</button>
            <button type="button" class="auth-tab ${mode==='signup'?'active':''}" onclick="openAuth('signup')">Daftar</button>
        </div>
        <button type="button" class="btn btn-ghost w-full" onclick="signInWithGoogle()">
            <img src="assets/google_icon_bg.png" class="btn-ico" alt=""> Lanjut dengan Google
        </button>
        <div class="pf-or"><span>atau email</span></div>
        ${mode === 'signup' ? `
            <label class="field-lbl">Username</label>
            <input id="auUser" type="text" maxlength="20" placeholder="misal: felix_fan_2008" onkeydown="if(event.key==='Enter'){event.preventDefault();document.getElementById('auEmail').focus()}">
            <label class="field-lbl">Nama tampilan (opsional)</label>
            <input id="auDisplay" type="text" maxlength="24" placeholder="yang muncul di feed">` : ''}
        <label class="field-lbl">Email</label>
        <input id="auEmail" type="email" autocomplete="email" onkeydown="if(event.key==='Enter'){event.preventDefault();document.getElementById('auPass').focus()}">
        <label class="field-lbl">Password</label>
        <input id="auPass" type="password" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}" onkeydown="if(event.key==='Enter'){event.preventDefault();doAuth()}">
        <button type="button" class="btn btn-accent w-full" onclick="doAuth()" style="margin-top:8px">
            <i class="fa-solid ${mode === 'login' ? 'fa-right-to-bracket' : 'fa-user-plus'}"></i> ${mode === 'login' ? 'Masuk' : 'Gabung'}
        </button>
        <p class="auth-note">Akun baru otomatis dapet avatar bot — bisa diganti lewat chip profilmu.</p>`;
    openModal('authModal');
}
/* OAuth Google — provider harus sudah diaktifkan di dashboard Supabase sebelum rilis */
async function signInWithGoogle() {
    if (!sb) { toast('Koneksi database lagi bermasalah', true); return; }
    try {
        const { error } = await sb.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: location.origin + location.pathname }
        });
        if (error) throw error;
        closeModal('authModal');
    } catch (e) {
        console.error(e);
        toast((e.message || 'Login Google gagal') + ' — coba email biasa.', true);
    }
}
function authMode() {
    return document.getElementById('auUser') ? 'signup' : 'login';
}
async function doAuth() {
    if (!sb) { toast('Layanan lagi bermasalah', true); return; }
    const email = document.getElementById('auEmail').value.trim();
    const pass = document.getElementById('auPass').value;
    if (!email || !pass) { toast('Email & password wajib', true); return; }
    if (authMode() === 'signup' && pass.length < 8) {
        toast('Password minimal 8 karakter — biar susah ditebak 🔒', true); return;
    }
    try {
        if (authMode() === 'login') {
            const { error } = await sb.auth.signInWithPassword({ email, password: pass });
            if (error) throw error;
            toast('Selamat datang kembali!');
        } else {
            const user = document.getElementById('auUser').value.trim() || email.split('@')[0];
            const display = document.getElementById('auDisplay')?.value.trim() || user;
            const { error } = await sb.auth.signUp({ email, password: pass, options: { data: { username: user, display_name: display, avatar_url: dicebear('bottts', user) } } });
            if (error) throw error;
            toast('Terdaftar! Cek email untuk konfirmasi.');
        }
        closeModal('authModal');
    } catch (e) { toast(e.message || 'Auth gagal', true); }
}
async function signOut() {
    if (sb) await sb.auth.signOut();
    closeCaret();
    closeModal('profileModal');
    toast('Sampai jumpa!');
}

/* ============ Modal Profil ============ */
/* fallback foto profil: kalau link mati, pakai maskot lokal */
function fxPfErr(el) { el.onerror = null; el.src = 'assets/yt-profile.png'; }
function setPfAvatar(url) {
    const el = document.getElementById('pfAvatarPreview');
    el.onerror = fxPfErr;           // reset handler biar error berikutnya juga tertangani
    el.src = url;
}
function openProfileModal() {
    const u = me();
    if (!u) { openAuth('login'); return; }
    setPfAvatar(u.avatar);
    document.getElementById('pfAvatar').value = u.avatar;
    document.getElementById('pfName').value = u.name;
    document.getElementById('pfNamePreview').innerHTML = `${esc(u.name)} ${badgeMark({ role: u.role, badge_type: u.badge })}`;
    document.getElementById('pfMeta').textContent = '@' + u.username + ' • ' + u.role;
    renderAvatarPicker(u.avatar);
    openModal('profileModal');
}
function renderAvatarPicker(current) {
    const seed = session?.user?.id || 'user';
    document.getElementById('pfAvatarPicker').innerHTML = AVATAR_STYLES.map(st => {
        const url = dicebear(st, seed);
        return `<div class="pg-dot ${current === url ? 'on' : ''}" onclick="pickAvatar('${st}')" title="${st}"><img src="${url}" alt="" onerror="this.onerror=null;this.src='assets/yt-profile.png'"></div>`;
    }).join('');
}
function pickAvatar(style) {
    const url = dicebear(style, session?.user?.id || 'user');
    document.getElementById('pfAvatar').value = url;
    setPfAvatar(url);
    renderAvatarPicker(url);
}

/* Upload foto profil custom ke Supabase Storage (bucket: avatars)
   HEMAT STORAGE: foto DIPERPATKAN dulu jadi 'avatar.<ext>' (SATU slot per user,
   upsert = menimpa berkas lama). Kalau tidak, setiap penggantian yang diunggah
   berukuran MB → pengguna yang sering mengganti foto bisa memakan puluhan MB, segera diganti. */
async function uploadPfAvatar(input) {
    const file = input?.files?.[0];
    if (!file) return;
    input.value = '';
    if (!sb) { toast('Layanan lagi bermasalah', true); return; }
    if (!file.type.startsWith('image/')) { toast('File harus gambar (JPG/PNG/WebP)', true); return; }
    if (file.size > 10 * 1024 * 1024) { toast('Foto terlalu besar (maks 10MB) — kompres dulu ya', true); return; }
    const u = session.user;
    toast('Memampatkan foto…');
    try {
        const img = await compressImage(file, 512, 0.82);   // avatar = wajah mini, 512px lebih dari cukup
        const ext = (img.name.split('.').pop() || 'jpg').toLowerCase().replace(/jpeg/, 'jpg');
        const path = `${u.id}/avatar.${ext}`;              // path deterministik = SELALU nulis 1 file itu
        toast('Mengunggah foto…');
        const { error } = await sb.storage.from('avatars').upload(path, img, {
            contentType: img.type,
            cacheControl: '3600',
            upsert: true                                   // timpa file lama = storage nggak numpuk
        });
        if (error) throw error;
        const { data } = sb.storage.from('avatars').getPublicUrl(path);
        const url = data.publicUrl + '?v=' + Date.now();   // cache-bust biar browser muat versi baru
        document.getElementById('pfAvatar').value = url;
        setPfAvatar(url);
        renderAvatarPicker('__custom__');
        toast('Foto siap! Klik Simpan untuk aktif.');
    } catch (e) {
        console.error(e);
        toast(e.message || 'Upload gagal (pastikan bucket "avatars" sudah dibuat)', true);
    }
}
async function saveProfile() {
    if (!sb || !session?.user) return;
    const u = session.user;
    const name = document.getElementById('pfName').value.trim();
    const avatar = document.getElementById('pfAvatar').value.trim();
    if (!name) { toast('Nama tidak boleh kosong', true); return; }
    const oldUrl = u.avatar || '';
    try {
        const { error } = await sb.from('profiles').update({ display_name: name, avatar_url: avatar || null }).eq('id', u.id);
        if (error) throw error;
        await loadProfile(u);
        renderAuthBar();
        updatePermBadge();
        closeModal('profileModal');
        toast('Profil terpasang!');
        // HEMAT STORAGE + anti-lag:
        // - kartu feed cukup dibikin segera via renderAuthBar (nggak refetch 2 feed cuma gara2 ganti nama)
        // - foto lama yang diganti (file di bucket avatars milikmu sendiri) dihapus biar nggak jadi sampah
        const o = oldUrl.indexOf('/object/public/avatars/');
        if (o > -1 && avatar !== oldUrl) {
            const oldPath = decodeURIComponent(oldUrl.split('?')[0].split('/object/public/avatars/')[1]);
            if (oldPath && oldPath.startsWith(u.id + '/') && !oldPath.startsWith(u.id + '/avatar.')) {
                sb.storage.from('avatars').remove([oldPath]).catch(() => { /* \u6e0c */ });
            }
        }
    } catch (e) { toast(e.message || 'Gagal update profil', true); }
}

/* ============ Permissions UI ============ */
function updatePermBadge() {
    const el = document.getElementById('permBadge');
    const box = document.getElementById('createPostBox');
    document.getElementById('createNewsBtn').innerHTML = isOfficial()
        ? '<button type="button" class="btn btn-ink sm" onclick="openModal(\'newsModal\')"><i class="fa-solid fa-pen-nib"></i> Tulis news</button>'
        : '';

    if (isVerified()) {
        el.className = 'perm-badge ok';
        el.innerHTML = '<i class="fa-solid fa-circle-check"></i> kamu bisa posting';
        box.classList.remove('off');
    } else {
        el.className = 'perm-badge warn';
        el.innerHTML = '<i class="fa-solid fa-lock"></i> posting khusus verified';
        box.classList.add('off');
    }
    const u = me();
    document.getElementById('cpAvatar').src = u ? u.avatar : dicebear('bottts', 'Guest');
    renderResourceAdminBtn();
}

/* ============ Feeds ============ */
/* PAGINASI: 12 post per halaman — feed tidak pernah menumpuk 100+ kartu
   (penyebab lag #1 versi lama: satu fetch = SEMUA post sejak senjakala) */
const FEED_PAGE = 12;
const feedPageState = { news: 0, community: 0 };
/* state filter tab community: pencarian + urutan */
const cmState = { q: '', sort: 'like' };
function setCmSearch(v) {
    cmState.q = (v || '').trim();
    clearTimeout(cmState._t);
    cmState._t = setTimeout(() => loadFeed('community'), 280); // debounce
}
function setCmSort(s) {
    cmState.sort = s;
    document.getElementById('cmSortLike').classList.toggle('on', s === 'like');
    document.getElementById('cmSortNew').classList.toggle('on', s === 'new');
    loadFeed('community');
}
/* builder query feed yang dipakai halaman 1 & halaman berikutnya — sumber sama, nggak dobel logika */
function feedQuery(type, offset) {
    let q = sb.from('posts').select('*, profiles(*)').eq('type', type);
    if (type === 'community') {
        if (cmState.q) {
            const kw = cmState.q.replace(/[%(),*"']/g, ''); // karakter yang merusak or-filter ilike
            if (kw) q = q.or(`content.ilike.%${kw}%,title.ilike.%${kw}%`);
        }
        q = cmState.sort === 'like'
            ? q.order('likes_count', { ascending: false }).order('created_at', { ascending: false })
            : q.order('created_at', { ascending: false });
    } else {
        // news: selalu terbaru paling atas
        q = q.order('created_at', { ascending: false });
    }
    return q.range(offset, offset + FEED_PAGE - 1);   // pagination beneran di server
}
/* hitung jumlah komentar untuk SEMBILAN post sekaligus — bukan ambil isi komennya */
async function loadCommentCounts(ids) {
    const counts = {};
    if (!sb || !ids.length) return counts;
    try {
        const { data: cc } = await sb.from('comments').select('post_id').in('post_id', ids);
        (cc || []).forEach(r => { counts[r.post_id] = (counts[r.post_id] || 0) + 1; });
    } catch (e) { console.warn(e); }
    return counts;
}
function feedMoreBtn(type, retry) {
    return `<div class="feed-more"><button type="button" class="btn btn-ghost w-full" onclick="loadMoreFeed('${type}')" title="Ambil ${FEED_PAGE} konten berikutnya">
        <i class="fa-solid ${retry ? 'fa-rotate' : 'fa-circle-down'}"></i> ${retry ? 'Coba ambil lagi' : 'Muat lebih banyak'}</button></div>`;
}
async function loadFeed(type) {
    const box = type === 'news' ? document.getElementById('newsFeed') : document.getElementById('communityFeed');
    if (!sb) {
        box.innerHTML = `<div class="empty"><i class="fa-solid fa-plug-circle-exclamation"></i><span>Layanan lagi bermasalah — tarik ke refresh nanti ya.</span></div>`;
        return;
    }
    const quiet = feedLoaded[type];   // re-render (realtime/search) → tanpa animasi ulang
    feedLoaded[type] = true;
    box.classList.toggle('quiet', quiet);
    box.innerHTML = '<div class="loader-line">mengambil konten…</div>';
    try {
        feedPageState[type] = 0;
        const { data, error } = await feedQuery(type, 0);
        if (error) throw error;
        const ids = (data || []).map(p => p.id);
        // angka komentar dobel-cek di atas (bukan isi komentarnya — itu lazy)
        const counts = await loadCommentCounts(ids);
        await fetchMyLikes(ids);
        let html = '';
        (data || []).forEach(p => {
            p._cCount = counts[p.id] || 0;
            postsById[p.id] = p;
            html += postCard(p, p.profiles || {}, type);
        });
        const emptyMsg = type === 'news'
            ? 'Belum ada news. Sepi sekali.'
            : cmState.q
                ? `Nggak ada post yang cocok dengan “${esc(cmState.q)}”.`
                : 'Belum ada yang posting. Jadi yang pertama (kalau sudah verified)!';
        // kalau baris kembali sebanyak FEED_PAGE → kemungkinan masih ada → taruh tombol
        box.innerHTML = html
            ? html + ((data || []).length === FEED_PAGE ? feedMoreBtn(type) : '')
            : `<div class="empty"><i class="fa-solid fa-feather"></i><span>${emptyMsg}</span></div>`;
    } catch (e) {
        console.error(e);
        box.innerHTML = `<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><span>${esc(e.message)}</span></div>`;
    }
}
/* halaman berikutnya — DI-APPEND ke bawah, kartu yang ada tidak disentuh
   (ini beda besar dari versi lama yang ngerender ulang semuanya tiap load) */
async function loadMoreFeed(type) {
    const box = type === 'news' ? document.getElementById('newsFeed') : document.getElementById('communityFeed');
    if (!sb || !feedLoaded[type]) return;
    box.querySelector('.feed-more')?.remove();
    try {
        const offset = feedPageState[type] + FEED_PAGE;
        const { data, error } = await feedQuery(type, offset);
        if (error) throw error;
        const rows = data || [];
        feedPageState[type] = offset;
        const counts = await loadCommentCounts(rows.map(p => p.id));
        await fetchMyLikes(rows.map(p => p.id));
        let html = '';
        rows.forEach(p => {
            p._cCount = counts[p.id] || 0;
            postsById[p.id] = p;
            html += postCard(p, p.profiles || {}, type);
        });
        if (html) box.insertAdjacentHTML('beforeend', html);
        if (rows.length === FEED_PAGE) box.insertAdjacentHTML('beforeend', feedMoreBtn(type));
    } catch (e) {
        console.error(e);
        toast('Gagal memuat halaman berikutnya', true);
        box.insertAdjacentHTML('beforeend', feedMoreBtn(type, true));
    }
}
/* state lazy: feed yang sudah pernah dimuat */
const feedLoaded = { news: false, community: false };
async function fetchMyLikes(ids) {
    const u = me();
    if (!u || !ids.length || !sb) return;
    try {
        const { data } = await sb.from('likes').select('post_id').eq('user_id', u.id).in('post_id', ids);
        (data || []).forEach(l => liked.add(l.post_id));
    } catch (e) { console.error(e); }
}
/* ============ Komentar: accordion + lazy-load ============
   default TERTUTUP, cuma SATU yang bisa terbuka, komentar diambil
   belakangan (sekali per post) — feed nggak berat, nggak lag */
const cmOpen = new Set();
function cmtCountEl(pid) {
    return document.querySelector(`[data-pid="${pid}"] .cmt-count`);
}
function bumpCount(pid, delta) {
    const el = cmtCountEl(pid);
    if (!el) return;
    const n = Math.max(0, (parseInt(el.textContent) || 0) + delta);
    el.textContent = n;
}
async function toggleComments(pid) {
    const sec = document.getElementById('csec-' + pid);
    if (!sec) return;
    const wasOpen = !sec.classList.contains('hidden');
    // accordion: tutup semua yang lain dulu
    cmOpen.clear();
    document.querySelectorAll('.c-sec:not(.hidden)').forEach(el => {
        if (el !== sec) {
            el.classList.add('hidden');
            const inner = el.parentElement?.querySelector('.cmt-toggle');
            inner?.classList.remove('on');
        }
    });
    const btn = document.querySelector(`[data-pid="${pid}"] .cmt-toggle`);
    if (wasOpen) {
        sec.classList.add('hidden');
        cmOpen.delete(pid);
        btn?.classList.remove('on');
        return;
    }
    sec.classList.remove('hidden');
    cmOpen.add(pid);
    btn?.classList.add('on');
    if (sec.dataset.loaded === '1') return; // sudah pernah diambil — langsung tampil
    sec.dataset.loaded = '1';
    const feedEl = sec.querySelector('.c-feed');
    feedEl.innerHTML = '<div class="loader-line">ngambil komentar…</div>';
    try {
        const { data, error } = await sb.from('comments').select('*, profiles(*)')
            .eq('post_id', pid).order('created_at', { ascending: true });
        if (error) throw error;
        let html = '';
        (data || []).forEach(c => {
            html += commentHtml(c, c.profiles || {}, ago(c.created_at));
        });
        feedEl.innerHTML = html || '<p class="c-empty">Jadi yang pertama komentar…</p>';
        // reaksi (Discord-style) untuk SEMUA komentar di post ini — 1 query
        rxFor((data || []).map(c => c.id));
        // sinkron jumlah dengan hasil nyata
        const el = cmtCountEl(pid);
        if (el) el.textContent = (data || []).length;
    } catch (e) {
        console.error(e);
        feedEl.innerHTML = `<p class="c-empty">${esc(e.message || 'Gagal ambil komentar')}</p>`;
        sec.dataset.loaded = '';
    }
}
function openComments(pid) {
    const sec = document.getElementById('csec-' + pid);
    if (sec && sec.classList.contains('hidden')) toggleComments(pid);
}
function commentHtml(c, cp, when) {    return `
    <div class="cmt-row" data-cid="${esc(c.id || '')}">
        <div class="cmt-top">
            <img src="${esc(cp.avatar_url || dicebear('bottts', c.user_id))}" class="p-ava sm" alt="" onerror="this.onerror=null;this.src='assets/yt-profile.png'">
            <span class="p-name">${esc(cp.display_name || cp.username || 'User')} ${badgeMark(cp)}</span>
            <span class="cmt-time">${when}</span>
        </div>
        <p class="cmt-txt">${esc(c.content)}</p>
        ${c.file_path ? `<div class="c-attach">${fileChipHtml('attachments', c.file_path, c.file_name, c.file_size)}</div>` : ''}
        <div class="rx-row">
            <button type="button" class="rx-add" onclick="openRxTray('${jsArg(c.id)}', this)" title="Beri reaksi"><i class="fa-regular fa-face-smile"></i></button>
            <span class="rx-chips" data-rx="${esc(c.id || '')}"></span>
        </div>
    </div>`;
}
/* ============ Reaksi ala Discord ============
   emoji di komentar: 👍 😂 🔥 😮 — 1 baris DB per (komentar, user, emoji).
   counter diambil SEKALI per buka-komentar (1 query utk semua komentar) → hemat API. */
const R_EMOJIS = ['👍', '😂', '🔥', '😮'];
const rxCounts = new Map();   // cid → { emoji: jumlah }
const rxMine   = new Map();   // cid → Set(emoji milikku)
async function rxFor(ids) {
    if (!sb || !ids.length) return;
    try {
        const uid = session?.user?.id;
        const { data, error } = await sb.from('comment_reactions').select('comment_id,emoji,user_id').in('comment_id', ids);
        if (error) throw error;
        (data || []).forEach(r => {
            const bag = rxCounts.get(r.comment_id) || {};
            bag[r.emoji] = (bag[r.emoji] || 0) + 1;
            rxCounts.set(r.comment_id, bag);
            if (uid && r.user_id === uid) {
                const mine = rxMine.get(r.comment_id) || new Set();
                mine.add(r.emoji);
                rxMine.set(r.comment_id, mine);
            }
        });
        ids.forEach(renderRx);
    } catch (e) { console.warn('rx:', e.message); }
}
function renderRx(cid) {
    const el = document.querySelector(`[data-rx="${CSS.escape(cid)}"]`);
    if (!el) return;
    const bag = rxCounts.get(cid) || {};
    const mine = rxMine.get(cid) || new Set();
    el.innerHTML = R_EMOJIS.filter(e => bag[e]).map(e =>
        `<button type="button" class="rx-chip ${mine.has(e) ? 'on' : ''}" onclick="toggleRx('${jsArg(cid)}','${e}')" title="reaksi ${e}">${e}<b>${bag[e]}</b></button>`
    ).join('');
}
function openRxTray(cid, btn) {
    const tray = document.getElementById('rx-tray');
    if (!tray) return;
    if (tray.open && tray.dataset.cid === cid) { tray.close(); return; }
    tray.dataset.cid = cid;
    tray.innerHTML = R_EMOJIS.map(e =>
        `<button type="button" onclick="toggleRx('${jsArg(cid)}','${e}',true)" title="${e}">${e}</button>`
    ).join('');
    const r = btn.getBoundingClientRect();
    tray.style.top = Math.min(r.bottom + window.scrollY + 6, window.innerHeight + window.scrollY - 90) + 'px';
    tray.style.left = Math.max(14, Math.min(r.left + window.scrollX, window.innerWidth - 150)) + 'px';
    tray.show();
    clearTimeout(tray._t);
    tray._t = setTimeout(() => tray.close(), 6000);
}
function closeRxTray() { document.getElementById('rx-tray')?.close(); }
document.addEventListener('click', ev => {
    const t = document.getElementById('rx-tray');
    if (t?.open && !t.contains(ev.target) && !ev.target.closest('.rx-add')) t.close();
});
async function toggleRx(cid, emoji, fromTray) {
    if (!sb) { toast('Layanan lagi bermasalah', true); return; }
    if (!session?.user) { closeRxTray(); openAuth('login'); return; }
    if (!R_EMOJIS.includes(emoji)) return;
    if (!gateTap('rx:' + cid + emoji, 350)) return;
    const mine = rxMine.get(cid) || new Set();
    const bag = rxCounts.get(cid) || {};
    const had = mine.has(emoji);
    // optimistic toggle
    if (had) { mine.delete(emoji); bag[emoji] = Math.max(0, (bag[emoji] || 1) - 1); if (!bag[emoji]) delete bag[emoji]; }
    else { mine.add(emoji); bag[emoji] = (bag[emoji] || 0) + 1; }
    rxMine.set(cid, mine); rxCounts.set(cid, bag); renderRx(cid);
    try {
        if (had) {
            await sb.from('comment_reactions').delete()
                .eq('comment_id', cid).eq('user_id', session.user.id).eq('emoji', emoji);
        } else {
            await sb.from('comment_reactions').upsert({ comment_id: cid, user_id: session.user.id, emoji });
        }
    } catch (e) {
        // rollback kalau server nolak
        if (had) { mine.add(emoji); bag[emoji] = (bag[emoji] || 0) + 1; }
        else { mine.delete(emoji); bag[emoji] = Math.max(0, (bag[emoji] || 1) - 1); if (!bag[emoji]) delete bag[emoji]; }
        rxMine.set(cid, mine); rxCounts.set(cid, bag); renderRx(cid);
        toast(e.message || 'Reaksi gagal', true);
    }
    if (fromTray) closeRxTray();
}
/* ============ Rating bintang resource (1-5, ala play store) ============ */
async function rateResource(rid, n) {
    if (!sb) { toast('Layanan lagi bermasalah', true); return; }
    if (!session?.user) { openAuth('login'); return; }
    if (!gateTap('rate:' + rid, 350)) return;
    const r = resById[rid];
    if (!r) return;
    n = Math.min(5, Math.max(1, parseInt(n, 10) || 0));
    const prev = r._mine || 0;
    const next = prev === n ? 0 : n;      // klik bintang yang sama = hapus rating
    // optimistic update (simpan SUM biar rerata hitung pas)
    r._sum = (r._sum || 0) - prev + next;
    r._n   = (r._n || 0) - (prev ? 1 : 0) + (next ? 1 : 0);
    r._mine = next;
    renderRate(rid);
    try {
        if (next) {
            await sb.from('resource_ratings').upsert({ resource_id: rid, user_id: session.user.id, stars: n });
            toast('Makasih! Kamu kasih ' + '⭐'.repeat(n) + ' ke resource ini');
        } else {
            await sb.from('resource_ratings').delete().eq('resource_id', rid).eq('user_id', session.user.id);
            toast('Rating kamu dihapus');
        }
    } catch (e) {
        // rollback
        r._sum = r._sum + prev - next;
        r._n   = r._n - (next ? 1 : 0) + (prev ? 1 : 0);
        r._mine = prev;
        renderRate(rid);
        toast(e.message || 'Gagal menyimpan rating', true);
    }
}
function renderRate(rid) {
    const r = resById[rid];
    const row = document.querySelector(`[data-rr="${CSS.escape(rid)}"]`);
    if (!row || !r) return;
    const avg = r._n ? Math.round(r._sum / r._n * 10) / 10 : 0;
    const stat = row.querySelector('.rate-stat');
    if (stat) stat.innerHTML = `<i class="fa-solid fa-star"></i> <b>${avg || '—'}</b> <span>(${r._n} rating)</span>`;
    row.querySelectorAll('.rate-star').forEach(b => {
        const k = parseInt(b.dataset.n, 10);
        const on = (r._mine || 0) >= k;
        b.classList.toggle('on', on);
        b.innerHTML = `<i class="fa-${on ? 'solid' : 'regular'} fa-star"></i>`;
    });
}
/* kalau gambar gagal dimuat (link mati / host blokir referrer) tampilkan placeholder rapi, bukan ikon rusak */
function imgFail(el) {
    const ph = document.createElement('div');
    ph.className = 'img-fail';
    ph.innerHTML = '<i class="fa-solid fa-image"></i><span>gambar gagal dimuat</span>';
    el.replaceWith(ph);
}
function postCard(p, pr, type) {
    const u = me();
    const lk = liked.has(p.id);
    const avatar = pr.avatar_url || dicebear('bottts', p.user_id);
    const name = pr.display_name || pr.username || 'User';
    const uname = pr.username || 'user';
    const imgUrl = typeof p.image_url === 'string' ? p.image_url.trim() : '';
    const imgOk = /^https?:\/\//i.test(imgUrl);
    const img = imgOk
        ? `<img src="${esc(imgUrl)}" class="p-img" loading="lazy" alt="" referrerpolicy="no-referrer" onerror="imgFail(this)">`
        : '';
    const title = p.title ? `<h3 class="p-title">${esc(p.title)}</h3>` : '';
    const cWrite = u
        ? `<div class="c-write">
               <input id="ci-${p.id}" type="text" maxlength="300" placeholder="balas dengan santai…" onkeydown="if(event.key==='Enter'){event.preventDefault(); addComment('${p.id}')}">
               <button type="button" class="btn btn-ghost sm" title="Lampirkan file (maks 20MB)" onclick="document.getElementById('caf-${p.id}').click()"><i class="fa-solid fa-paperclip"></i></button>
               <input id="caf-${p.id}" type="file" class="hidden" onchange="attachCommentFile('${p.id}', this)">
               <button type="button" class="btn btn-ink sm" onclick="addComment('${p.id}')"><i class="fa-solid fa-paper-plane"></i></button>
           </div>
           <div id="cslot-${p.id}" class="c-attach"></div>`
        : `<p class="c-login-note">kamu belum masuk — <a href="#" style="color:var(--accent-d);font-weight:700" onclick="event.preventDefault();openAuth('login')">masuk dulu</a> buat komentar.</p>`;
    return `
    <article class="card post-card" data-pid="${p.id}">
        <div class="p-head">
            <img src="${esc(avatar)}" class="p-ava lg" alt="" onerror="this.onerror=null;this.src='assets/yt-profile.png'">
            <div class="p-who">
                <div class="p-name">${esc(name)} ${badgeMark(pr)}</div>
                <div class="p-handle mono">@${esc(uname)} · ${ago(p.created_at)}</div>
            </div>
            ${type === 'news' ? '<span class="p-tag">NEWS</span>' : ''}
        </div>
        ${title}
        <p class="p-body">${esc(p.content)}</p>
        ${img}
        <div class="p-foot">
            <button type="button" class="chip-act like-btn ${lk ? 'on' : ''}" onclick="toggleLike('${p.id}')">
                <i class="${lk ? 'fa-solid' : 'fa-regular'} fa-heart hrt"></i> <span class="like-count">${p.likes_count || 0}</span>
            </button>
            <button type="button" class="chip-act cmt-toggle" onclick="toggleComments('${p.id}')" title="Buka/tutup komentar">
                <i class="fa-regular fa-comment"></i> <span class="cmt-count">${p._cCount || 0}</span>
                <i class="fa-solid fa-chevron-down chip-chev"></i>
            </button>
            <button type="button" class="chip-act" onclick="sharePost('${p.id}')">
                <i class="fa-solid fa-share-nodes"></i> Share
            </button>
        </div>
        <div class="c-sec hidden" id="csec-${p.id}">
            <div class="c-feed"></div>
            ${cWrite}
        </div>
    </article>`;
}

async function toggleLike(pid) {
    if (!sb) { toast('Layanan lagi bermasalah', true); return; }
    if (!gateTap('like:' + pid, 700)) return;   // klik dobel = request kembar = lag + race
    const u = me();
    if (!u) { openAuth('login'); return; }
    const isLiked = liked.has(pid);
    const art = document.querySelector(`[data-pid="${pid}"]`);
    const btn = art?.querySelector('.like-btn');
    const span = art?.querySelector('.like-count');
    const cur = parseInt(span?.textContent || '0', 10) || 0;
    if (isLiked) { liked.delete(pid); if (span) span.textContent = Math.max(cur - 1, 0); }
    else { liked.add(pid); if (span) span.textContent = cur + 1; }
    if (btn) {
        btn.classList.toggle('on', !isLiked);
        const ic = btn.querySelector('i');
        if (ic) ic.className = `${!isLiked ? 'fa-solid' : 'fa-regular'} fa-heart hrt`;
    }
    try {
        if (isLiked) {
            const { error } = await sb.from('likes').delete().eq('post_id', pid).eq('user_id', u.id);
            if (error) throw error;
        } else {
            const { error } = await sb.from('likes').insert({ post_id: pid, user_id: u.id });
            if (error) throw error;
        }
    } catch (e) {
        if (isLiked) liked.add(pid); else liked.delete(pid);
        toast(e.message || 'Gagal like', true);
        // state sudah dikembalikan (optimistic rollback) — NGGAK perlu re-render feed penuh
    }
}
async function addComment(pid) {
    if (!sb) { toast('Layanan lagi bermasalah', true); return; }
    if (!gateTap('cmt:' + pid, 900)) return;    // ketuk 2× Enter → komentar dobel
    const u = me();
    if (!u) { openAuth('login'); return; }
    const inp = document.getElementById('ci-' + pid);
    const val = inp?.value.trim();
    const att = pendingAttach[pid];
    if (!val && !att) { toast('Isi komentarnya (atau lampir file) dulu', true); return; }
    try {
        const payload = { post_id: pid, user_id: u.id, content: val || '(lampiran)' };
        if (att) {
            payload.file_path = att.path;
            payload.file_name = att.name;
            payload.file_size = att.size;
        }
        const { data, error } = await sb.from('comments').insert(payload).select('*, profiles(*)').single();
        if (error) throw error;
        if (data) {
            // buka dulu kalau masih tertutup, lalu sisipkan realtime (anti-dobel lewat data-cid)
            openComments(pid);
            const feedEl = document.querySelector(`#csec-${pid} .c-feed`);
            if (feedEl && !document.querySelector(`[data-cid="${data.id}"]`)) {
                document.querySelector(`#csec-${pid} .c-empty`)?.remove();
                const wrap = document.createElement('div');
                wrap.innerHTML = commentHtml(data, data.profiles || {}, 'baru!');
                feedEl.appendChild(wrap.firstElementChild);
            }
            bumpCount(pid, 1);
        }
        if (inp) inp.value = '';
        pendingAttach[pid] = null;
        renderAttachChip(pid);
        toast('Komentar terkirim');
    } catch (e) {
        toast((e.message || 'Gagal komentar'), true);
    }
}
/* lampiran komentar — upload ke bucket 'attachments', folder per-user */
const pendingAttach = {}; // pid -> {path, name, size}
async function attachCommentFile(pid, input) {
    const file = input?.files?.[0];
    if (!file) return;
    input.value = '';
    if (!sb) { toast('Layanan lagi bermasalah', true); return; }
    if (file.size > 20 * 1024 * 1024) { toast('Lampiran maks 20MB', true); return; }
    const u = session.user;
    try {
        let toUpload = file;
        if (file.type.startsWith('image/') && file.type !== 'image/gif') {
            toast('Memampatkan lampiran…');
            toUpload = await compressImage(file, 1280, 0.8);   // screenshot dibukukan 1280px webp — hemat puluhan KB/MB
        }
        toast('Mengunggah lampiran…');
        const safe = (toUpload.name || file.name || 'file.bin').replace(/[^\w.\-]+/g, '_');
        const path = `${u.id}/cmt-${Date.now()}-${safe}`;
        const { error } = await sb.storage.from('attachments').upload(path, toUpload, {
            contentType: toUpload.type || file.type || undefined,
            cacheControl: '3600'
        });
        if (error) throw error;
        // tmp:true → kalau user batal / ganti lampiran, FILE DIHAPUS (nggak jadi sampah bucket)
        if (pendingAttach[pid]?.tmp) sb.storage.from('attachments').remove([pendingAttach[pid].path]).catch(() => {});
        pendingAttach[pid] = { path, name: file.name, size: toUpload.size, tmp: true };
        renderAttachChip(pid);
        toast('Lampiran siap! Kirim komentarmu.');
    } catch (e) {
        console.error(e);
        toast((e.message || 'Upload lampiran gagal'), true);
    }
}
function renderAttachChip(pid) {
    const slot = document.getElementById('cslot-' + pid);
    if (!slot) return;
    const att = pendingAttach[pid];
    if (!att) { slot.innerHTML = ''; return; }
    slot.innerHTML = `<div class="att-chip">${fileChipHtml('attachments', att.path, att.name, att.size, null, true)}
        <button type="button" class="att-x" onclick="clearAttach('${esc(pid)}')" title="Batal"><i class="fa-solid fa-xmark"></i></button></div>`;
}
function clearAttach(pid) {
    // HEMAT STORAGE: lampiran yang dibatalkan = file temp di bucket, langsung dihapus
    if (pendingAttach[pid]?.tmp) sb.storage.from('attachments').remove([pendingAttach[pid].path]).catch(() => {});
    pendingAttach[pid] = null;
    const slot = document.getElementById('cslot-' + pid);
    if (slot) slot.innerHTML = '';
}
async function sharePost(pid) {
    const p = postsById[pid];
    const txt = p ? p.content : 'Felix Lab post';
    const url = p ? `${location.origin}${location.pathname}#post-${pid}` : location.href;
    if (navigator.share) { try { await navigator.share({ title: 'Felix Lab', text: txt, url }); } catch (e) {} }
    else { try { await navigator.clipboard.writeText(txt + '\n' + url); toast('Disalin'); } catch (e) { copyLink(url, 'URL disalin'); } }
}

/* ============ Create posts ============ */
async function createPost() {
    if (!sb) { toast('Layanan lagi bermasalah', true); return; }
    if (!gateTap('create-post', 2500)) return;  // jaringan lambat: tombol dobel POST → dobel konten
    const u = me();
    if (!u) { openAuth('login'); return; }
    if (!canPost()) { toast('Posting butuh status verified', true); return; }
    const content = document.getElementById('postText').value.trim();
    const image = document.getElementById('postImage').value.trim();
    if (!content) { toast('Isinya belum ada, nih', true); return; }
    try {
        const { error } = await sb.from('posts').insert({ user_id: u.id, type: 'community', title: null, content, image_url: image || null });
        if (error) throw error;
        document.getElementById('postText').value = '';
        document.getElementById('postImage').value = '';
        toast('Posting terkirim!');
        await loadFeed('community');
    } catch (e) { toast(e.message || 'Gagal posting', true); }
}
async function publishNews() {
    if (!sb) { toast('Layanan lagi bermasalah', true); return; }
    const u = me();
    if (!u || !isOfficial()) { toast('Hanya official yang boleh nulis news', true); return; }
    const title = document.getElementById('newsTitle').value.trim();
    const content = document.getElementById('newsContent').value.trim();
    const image = document.getElementById('newsImage').value.trim();
    if (!title || !content) { toast('Judul & isi wajib diisi', true); return; }
    try {
        const { error } = await sb.from('posts').insert({ user_id: u.id, type: 'news', title, content, image_url: image || null });
        if (error) throw error;
        closeModal('newsModal');
        toast('News terbit!');
        await loadFeed('news');
    } catch (e) { toast(e.message || 'Gagal publikasi', true); }
}

/* ============ Admin ============ */
async function openAdmin() {
    if (!isOfficial()) return;
    openModal('adminModal');
    const list = document.getElementById('adminList');
    list.innerHTML = '<div class="loader-line">mengumpulkan anggota…</div>';
    try {
        const { data, error } = await sb.from('profiles').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        if (!data || !data.length) {
            list.innerHTML = `<div class="empty"><i class="fa-solid fa-ghost"></i><span>Belum ada anggota.</span></div>`;
            return;
        }
        list.innerHTML = data.map(u => {
            const adminRole = u.role === 'admin';
            const blue = u.role === 'admin' || u.badge_type === 'blue';
            const green = u.badge_type === 'green';
            // Admin (role admin) sudah punya centang biru bawaan → sediakan toggle hijau.
            const actions = adminRole
                ? `<span class="admin-lbl">OFFICIAL</span>
                   <button type="button" class="admin-act give ${green ? 'cur' : ''}" onclick="toggleBadge('${u.id}', '${green ? 'none' : 'green'}')">
                       <i class="fa-solid ${green ? 'fa-xmark' : 'fa-check'}"></i> Hijau
                   </button>`
                : `<div class="admin-acts">
                       <button type="button" class="admin-act blue ${u.badge_type === 'blue' ? 'cur' : ''}" onclick="toggleBadge('${u.id}','blue')" title="Bisa tulis news">
                           <i class="fa-solid fa-certificate"></i> Biru
                       </button>
                       <button type="button" class="admin-act give ${u.badge_type === 'green' ? 'cur' : ''}" onclick="toggleBadge('${u.id}','green')" title="Bisa posting community">
                           <i class="fa-solid fa-check"></i> Hijau
                       </button>
                       ${u.badge_type ? `<button type="button" class="admin-act take" onclick="toggleBadge('${u.id}','none')" title="Lepas centang"><i class="fa-solid fa-eraser"></i></button>` : ''}
                   </div>`;
            return `
            <div class="admin-row">
                <div class="admin-ro-who">
                    <img src="${esc(u.avatar_url || dicebear('bottts', u.id))}" class="p-ava md" alt="" onerror="this.onerror=null;this.src='assets/yt-profile.png'">
                    <div>
                        <span class="p-name">${esc(u.display_name || u.username)} ${badgeMark(u)}</span>
                        <div class="admin-handle mono">@${esc(u.username)} · ${u.role}</div>
                    </div>
                </div>
                ${blue ? '<span class="badge b-blue"><i class="fa-solid fa-circle-check"></i> official</span>' : ''}
                ${actions}
            </div>`;
        }).join('');
    } catch (e) {
        list.innerHTML = `<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><span>${esc(e.message)}</span></div>`;
    }
}
/* beri/lepas centang biru atau hijau. next: 'blue' | 'green' | null */
async function toggleBadge(uid, next) {
    if (!sb) return;
    const val = next === 'none' ? null : next;
    const label = val === 'blue' ? 'centang BIRU' : val === 'green' ? 'centang HIJAU' : 'centang dilepas';
    try {
        const { error } = await sb.from('profiles').update({ badge_type: val }).eq('id', uid);
        if (error) throw error;
        toast(label);
        await openAdmin();
    } catch (e) { toast(e.message || 'Gagal update badge', true); }
}

/* ============ Realtime ============ */
function setupRealtime() {
    if (!sb || rtChannel) return;
    rtChannel = sb.channel('fx_realtime')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posts' }, (pl) => {
            const t = pl.new?.type;
            // feed yang belum pernah dibuka tidak perlu refetch
            if ((t === 'news' || t === 'community') && feedLoaded[t]) loadFeed(t);
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comments' }, async (pl) => {
            const c = pl.new;
            if (!c?.id) return;
            const isMine = session?.user && c.user_id === session.user.id;
            if (!cmOpen.has(c.post_id)) {
                // feed comment tertutup: cukup majukan angka (komentar diambil lazy kalau dibuka)
                if (!isMine) bumpCount(c.post_id, 1);
                return;
            }
            // anti-dobel: komentar own (optimis) / duplikat realtime langsung skip
            if (document.querySelector(`[data-cid="${c.id}"]`)) return;
            const feedEl = document.querySelector(`#csec-${c.post_id} .c-feed`);
            if (!feedEl) return;
            let pr = null;
            try { const { data } = await sb.from('profiles').select('*').eq('id', c.user_id).single(); pr = data; } catch (e) {}
            document.querySelector(`#csec-${c.post_id} .c-empty`)?.remove();
            feedEl?.insertAdjacentHTML('beforeend', commentHtml(c, pr || {}, 'baru!'));
            if (!isMine) bumpCount(c.post_id, 1);
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
            if (document.getElementById('adminModal').classList.contains('open')) openAdmin();
            renderAuthBar();
        })
        .subscribe(st => { if (st === 'SUBSCRIBED') setConn('on'); });
}
