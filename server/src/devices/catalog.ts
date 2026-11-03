/**
 * Справочник предустановленных пакетов Android TV / Mi TV Stick.
 * level:
 *   safe     — можно удалять, система работает (теряется только эта функция)
 *   caution  — удаление отключит заметную функцию (голос, Chromecast и т.п.)
 *   critical — без пакета стик может не загрузиться или станет неуправляемым
 * Удаление идёт через `pm uninstall -k --user 0`, поэтому любой пакет можно вернуть.
 */
export type Level = 'safe' | 'caution' | 'critical';
export interface CatalogEntry {
  level: Level;
  label: string;
  note?: string;
}

const C = (level: Level, label: string, note?: string): CatalogEntry => ({ level, label, note });

const EXACT: Record<string, CatalogEntry> = {
  // --- не трогать ---
  android: C('critical', 'Ядро системы'),
  'com.android.systemui': C('critical', 'Системный интерфейс'),
  'com.android.settings': C('critical', 'Настройки'),
  'com.android.tv.settings': C('critical', 'Настройки ТВ'),
  'com.google.android.tvlauncher': C('critical', 'Главный экран', 'Без лаунчера ТВ загрузится в пустой экран'),
  'com.google.android.apps.tv.launcherx': C('critical', 'Главный экран Google TV'),
  'com.android.bluetooth': C('critical', 'Bluetooth', 'Через него работает пульт'),
  'com.google.android.tv.remote.service': C('critical', 'Сервис пульта'),
  'com.google.android.gms': C('critical', 'Сервисы Google Play', 'Без них не работают Play Маркет, YouTube и вход в аккаунт'),
  'com.google.android.gsf': C('critical', 'Google Services Framework'),
  'com.android.shell': C('critical', 'Shell', 'Нужен для ADB: после удаления панель потеряет доступ'),
  'com.android.packageinstaller': C('critical', 'Установщик пакетов'),
  'com.google.android.packageinstaller': C('critical', 'Установщик пакетов'),
  'com.android.permissioncontroller': C('critical', 'Разрешения'),
  'com.google.android.permissioncontroller': C('critical', 'Разрешения'),
  'com.google.android.leanback.ime': C('critical', 'Экранная клавиатура', 'Без неё нельзя ввести пароль Wi‑Fi'),
  'com.google.android.tungsten.setupwraith': C('critical', 'Мастер первой настройки', 'Нужен после сброса'),
  'com.android.networkstack': C('critical', 'Сеть'),
  'com.google.android.networkstack': C('critical', 'Сеть'),
  'com.android.wifi.resources': C('critical', 'Wi‑Fi'),
  'com.android.inputdevices': C('critical', 'Устройства ввода'),
  'com.android.externalstorage': C('critical', 'Хранилище'),
  'com.android.keychain': C('critical', 'Сертификаты'),
  'com.android.tv.provision': C('critical', 'Инициализация ТВ'),
  'com.android.se': C('critical', 'Защищённый элемент'),
  'com.android.location.fused': C('critical', 'Системная геолокация'),

  // --- осторожно: пропадёт заметная функция ---
  'com.android.vending': C('caution', 'Google Play Маркет', 'Не будет установки и обновлений из Play'),
  'com.google.android.katniss': C('caution', 'Google Ассистент / голосовой поиск', 'Перестанет работать кнопка микрофона'),
  'com.google.android.apps.mediashell': C('caution', 'Chromecast built-in', 'Перестанет работать трансляция с телефона'),
  'com.google.android.tv.frameworkpackagestubs': C('caution', 'Заглушки системных intent', 'Некоторые приложения могут падать при открытии ссылок'),
  'com.google.android.partnersetup': C('caution', 'Настройки партнёра Google'),
  'com.google.android.webview': C('caution', 'Android System WebView', 'Нужен приложениям, которые показывают веб-страницы'),
  'com.android.providers.downloads': C('caution', 'Менеджер загрузок', 'Нужен для скачивания обновлений и APK'),
  'com.google.android.tvrecommendations': C('caution', 'Рекомендации', 'Пропадут каналы и рекомендации на главном экране'),

  // --- можно удалять ---
  'com.google.android.play.games': C('safe', 'Google Play Игры'),
  'com.google.android.videos': C('safe', 'Google Play Фильмы'),
  'com.google.android.music': C('safe', 'Google Play Музыка (закрыт)'),
  'com.google.android.youtube.tvmusic': C('safe', 'YouTube Music'),
  'com.google.android.youtube.tv': C('safe', 'YouTube', 'Если смотришь YouTube через SmartTube и т.п.'),
  'com.google.android.youtube.tvkids': C('safe', 'YouTube Kids'),
  'com.netflix.ninja': C('safe', 'Netflix'),
  'com.amazon.amazonvideo.livingroom': C('safe', 'Prime Video'),
  'com.disney.disneyplus': C('safe', 'Disney+'),
  'com.spotify.tv.android': C('safe', 'Spotify'),
  'com.google.android.leanbacklauncher.recommendations': C('safe', 'Рекомендации старого лаунчера'),
  'com.google.android.feedback': C('safe', 'Отправка отзывов Google'),
  'com.google.android.speech.pumpkin': C('safe', 'Офлайн-распознавание речи'),
  'com.google.android.marvin.talkback': C('safe', 'TalkBack (для незрячих)'),
  'com.google.android.backdrop': C('safe', 'Заставка «Фоновый режим»'),
  'com.google.android.apps.tv.dreamx': C('safe', 'Заставка Google TV'),
  'com.android.dreams.basic': C('safe', 'Простая заставка'),
  'com.android.printspooler': C('safe', 'Печать'),
  'com.google.android.syncadapters.calendar': C('safe', 'Синхронизация календаря'),
  'com.google.android.syncadapters.contacts': C('safe', 'Синхронизация контактов'),
  'com.google.android.tts': C('safe', 'Синтез речи Google'),
  'com.android.egg': C('safe', 'Пасхалка Android'),
  'com.google.android.apps.tv.launcherx.coreservices': C('caution', 'Сервисы Google TV лаунчера'),
};

const PREFIXES: [string, CatalogEntry][] = [
  ['com.android.providers.', C('critical', 'Системный провайдер данных')],
  ['com.android.server.', C('critical', 'Системный сервис')],
  ['com.google.android.ext.', C('critical', 'Системный модуль')],
  ['com.android.overlay.', C('critical', 'Оверлей системы')],
  ['com.google.android.overlay.', C('critical', 'Оверлей системы')],
  ['com.android.internal.', C('critical', 'Внутренний пакет системы')],
];

export function classify(pkg: string): CatalogEntry | undefined {
  return EXACT[pkg] ?? PREFIXES.find(([p]) => pkg.startsWith(p))?.[1];
}
