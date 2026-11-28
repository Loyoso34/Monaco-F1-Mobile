// Localisation: English and Turkish. Every visible string in the game comes from here.
//
// * Static text: elements carry data-i18n="key" (textContent), data-i18n-html="key" (markup)
//   or data-i18n-aria="key" (aria-label); apply() rewrites them all.
// * Dynamic text: code calls t('key', { vars }) and registers a re-render with onLang(fn), so a
//   language switch updates everything on screen at once - no reload.
// * The choice is saved in localStorage; the first visit follows the device language.
// * <html lang> follows the language, so CSS text-transform: uppercase uses the Turkish rules
//   (i -> İ, ı -> I).
// Proper names stay as they are: Monaco's corner names (Sainte Dévote, Beau Rivage, Casino,
// Mirabeau, Portier, Tabac, La Rascasse, Anthony Noghès...), the team and the driver.
const KEY = 'f1-27.lang';
export const LANGS = ['tr', 'en'];

const STR = {
  en: {
    'doc.title': 'F1-27 · Monaco Time Trial',
    'ld.event': 'MONACO GRAND PRIX<i></i>TIME TRIAL',
    'ld.loading': 'Loading',
    'ld.engine': 'Loading engine', 'ld.car': 'Loading car', 'ld.circuit': 'Loading circuit',
    'ld.build': 'Building circuit', 'ld.monaco': 'Building Monaco', 'ld.rb20': 'Preparing the RB20',
    'ld.shaders': 'Compiling shaders', 'ld.almost': 'Almost there', 'ld.ready': 'Ready',
    'menu.title': 'MONACO<span>GRAND PRIX · TIME TRIAL</span>',
    'menu.best': 'Personal best  {t}', 'menu.first': 'Set your first lap around Monaco',
    'menu.drive': 'Drive', 'menu.settings': 'Settings', 'menu.lang': 'Language',
    'cine.turn': 'Turn {n}',
    'cine.devote': 'Sainte Dévote', 'cine.hairpin': 'Fairmont Hairpin', 'cine.harbour': 'Port Hercule', 'cine.harbourSub': 'Tabac · Swimming Pool',
    'hud.outLap': 'OUT LAP', 'hud.lap': 'LAP {n}', 'hud.invalid': ' · INVALID', 'hud.last': 'LAST', 'hud.best': 'BEST', 'hud.kmh': 'KM/H',
    'hud.cam': 'Change camera', 'hud.pause': 'Pause', 'hud.tapAudio': 'Tap to enable sound',
    'cam.cockpit': 'COCKPIT', 'cam.tcam': 'T-CAM', 'cam.chase': 'CHASE',
    'ctl.steer': 'STEER', 'ctl.brake': 'BRAKE', 'ctl.throttle': 'THROTTLE',
    'msg.lapStarted': 'Lap started', 'msg.pb': 'Personal best  {t}', 'msg.lap': 'Lap  {t}',
    'msg.cut': 'Lap invalid — corner cut.', 'msg.reset': 'Lap invalid — car reset.', 'msg.notCounted': 'Lap not counted — corner cut',
    'pause.title': 'Paused', 'pause.sub': 'The lap timer is frozen.', 'pause.focus': 'Paused while the app was in the background. The lap timer is frozen.',
    'pause.resume': 'Resume', 'pause.restart': 'Quick Restart', 'pause.reset': 'Reset Car', 'pause.settings': 'Settings', 'pause.menu': 'Return to Menu',
    'crash.title': 'Car undriveable', 'crash.cell': '{r}. The survival cell is intact.',
    'dmg.Heavy impact': 'Heavy impact',
    'dmg.Suspension failure – a wheel has come off': 'Suspension failure – a wheel has come off',
    'dmg.Gearbox and rear crash structure destroyed': 'Gearbox and rear crash structure destroyed',
    'dmg.Heavy frontal impact': 'Heavy frontal impact',
    'set.title': 'Settings', 'set.steer': 'Steering sensitivity', 'set.master': 'Master volume', 'set.engine': 'Engine volume', 'set.fx': 'Effects volume',
    'set.camera': 'Camera', 'set.cockpit': 'Cockpit', 'set.tcam': 'T-Cam', 'set.chase': 'Chase',
    'set.gfx': 'Graphics', 'set.auto': 'Auto', 'set.high': 'High', 'set.medium': 'Medium', 'set.low': 'Low',
    'set.assists': 'Driving assists', 'set.standard': 'Standard', 'set.off': 'Off', 'set.on': 'On', 'set.fps': 'Show FPS', 'set.lang': 'Language',
    'set.clear': 'Clear best lap', 'set.cleared': 'Best lap cleared', 'set.done': 'Done',
    'rot.title': 'Rotate your phone to play.', 'rot.sub': 'F1-27 is played in landscape with two thumbs.',
    'err.error': 'Error: {m}', 'err.start': 'Could not start: {m}',
    'bench.title': 'F1-27 benchmark', 'aria.view': 'Monaco 3D view',
  },
  tr: {
    'doc.title': 'F1-27 · Monako Zamana Karşı',
    'ld.event': 'MONAKO GRAND PRİX’Sİ<i></i>ZAMANA KARŞI',
    'ld.loading': 'Yükleniyor',
    'ld.engine': 'Motor yükleniyor', 'ld.car': 'Araç yükleniyor', 'ld.circuit': 'Pist yükleniyor',
    'ld.build': 'Pist oluşturuluyor', 'ld.monaco': 'Monako oluşturuluyor', 'ld.rb20': 'RB20 hazırlanıyor',
    'ld.shaders': 'Gölgelendiriciler derleniyor', 'ld.almost': 'Neredeyse hazır', 'ld.ready': 'Hazır',
    'menu.title': 'MONAKO<span>GRAND PRİX · ZAMANA KARŞI</span>',
    'menu.best': 'Kişisel rekor  {t}', 'menu.first': 'Monako’daki ilk turunu tamamla',
    'menu.drive': 'Piste Çık', 'menu.settings': 'Ayarlar', 'menu.lang': 'Dil',
    'cine.turn': '{n}. Viraj',
    'cine.devote': 'Sainte Dévote', 'cine.hairpin': 'Fairmont Firketesi', 'cine.harbour': 'Port Hercule', 'cine.harbourSub': 'Tabac · Swimming Pool',
    'hud.outLap': 'ÇIKIŞ TURU', 'hud.lap': 'TUR {n}', 'hud.invalid': ' · GEÇERSİZ', 'hud.last': 'SON', 'hud.best': 'EN İYİ', 'hud.kmh': 'KM/S',
    'hud.cam': 'Kamerayı değiştir', 'hud.pause': 'Duraklat', 'hud.tapAudio': 'Sesi açmak için dokun',
    'cam.cockpit': 'KOKPİT', 'cam.tcam': 'T-CAM', 'cam.chase': 'TAKİP',
    'ctl.steer': 'DİREKSİYON', 'ctl.brake': 'FREN', 'ctl.throttle': 'GAZ',
    'msg.lapStarted': 'Tur başladı', 'msg.pb': 'Kişisel rekor  {t}', 'msg.lap': 'Tur  {t}',
    'msg.cut': 'Tur geçersiz — viraj kesildi.', 'msg.reset': 'Tur geçersiz — araç piste geri alındı.', 'msg.notCounted': 'Tur sayılmadı — viraj kesildi',
    'pause.title': 'Duraklatıldı', 'pause.sub': 'Tur süresi durduruldu.', 'pause.focus': 'Uygulama arka plandayken oyun duraklatıldı. Tur süresi durduruldu.',
    'pause.resume': 'Devam Et', 'pause.restart': 'Baştan Başla', 'pause.reset': 'Aracı Piste Al', 'pause.settings': 'Ayarlar', 'pause.menu': 'Ana Menüye Dön',
    'crash.title': 'Araç sürülemez durumda', 'crash.cell': '{r}. Güvenlik hücresi sağlam.',
    'dmg.Heavy impact': 'Şiddetli çarpışma',
    'dmg.Suspension failure – a wheel has come off': 'Süspansiyon arızası – bir tekerlek koptu',
    'dmg.Gearbox and rear crash structure destroyed': 'Şanzıman ve arka darbe yapısı parçalandı',
    'dmg.Heavy frontal impact': 'Şiddetli önden çarpışma',
    'set.title': 'Ayarlar', 'set.steer': 'Direksiyon hassasiyeti', 'set.master': 'Ana ses', 'set.engine': 'Motor sesi', 'set.fx': 'Efekt sesi',
    'set.camera': 'Kamera', 'set.cockpit': 'Kokpit', 'set.tcam': 'T-Cam', 'set.chase': 'Takip',
    'set.gfx': 'Grafik', 'set.auto': 'Otomatik', 'set.high': 'Yüksek', 'set.medium': 'Orta', 'set.low': 'Düşük',
    'set.assists': 'Sürüş yardımları', 'set.standard': 'Standart', 'set.off': 'Kapalı', 'set.on': 'Açık', 'set.fps': 'FPS göster', 'set.lang': 'Dil',
    'set.clear': 'En iyi turu sil', 'set.cleared': 'En iyi tur silindi', 'set.done': 'Tamam',
    'rot.title': 'Oynamak için telefonunu yan çevir.', 'rot.sub': 'F1-27 yatay ekranda, iki başparmakla oynanır.',
    'err.error': 'Hata: {m}', 'err.start': 'Oyun başlatılamadı: {m}',
    'bench.title': 'F1-27 performans testi', 'aria.view': 'Monako 3B görünüm',
  },
};

function initial() {
  try { const s = localStorage.getItem(KEY); if (LANGS.includes(s)) return s; } catch {}
  const q = new URLSearchParams(location.search).get('lang');
  if (LANGS.includes(q)) return q;
  const nav = (navigator.languages && navigator.languages[0]) || navigator.language || 'en';
  return /^tr\b/i.test(nav) ? 'tr' : 'en';
}

let lang = initial();
const listeners = new Set();

export function getLang() { return lang; }
export function t(key, vars) {
  let s = STR[lang][key] ?? STR.en[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
  return s;
}
// damage reasons come from the physics in English; show them in the current language
export function tReason(r) { return STR[lang]['dmg.' + r] ?? r; }
export function onLang(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function apply(root = document) {
  document.documentElement.lang = lang;
  document.title = t('doc.title');
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
  root.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
  root.querySelectorAll('[data-lang]').forEach((el) => {
    const on = el.dataset.lang === lang;
    el.classList.toggle('on', on); el.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

export function setLang(l) {
  if (!LANGS.includes(l)) return;
  lang = l;
  try { localStorage.setItem(KEY, l); } catch {}
  apply();
  for (const fn of listeners) { try { fn(l); } catch (e) { console.error(e); } }
}

// the static page is localised as soon as this module loads (before the 3D scene is built)
apply();
