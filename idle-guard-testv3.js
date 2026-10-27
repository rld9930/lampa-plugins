/*
 * Lampa plugin: Idle Guard
 * "Продолжить просмотр?"
 *
 * Следит за активностью пульта / мыши / Magic Remote, пока открыт плеер.
 * Если пользователь долго ничего не нажимает — показывает через Lampa.Modal
 * диалог "Продолжить просмотр?" с обратным отсчётом. Если ответа нет или
 * выбран "Нет" — закрывает плеер и переходит на главный экран либо закрывает
 * приложение (настраивается).
 *
 * ES5: var, function, без стрелок и шаблонных строк — для старых webOS/Tizen.
 *
 * v1.1.1 (с исправлениями интерфейса настроек):
 *   - Исправлен баг с пустым экраном и возвратом назад в меню настроек:
 *     применены статичные строковые ключи для селектов и единый try/catch.
 *   - exitApp(): не доверяем window.close() молча — проверка через setTimeout
 *   - finish(): переименовано close_succeeded → close_attempted; fallback
 *               проверяет реальное состояние плеера
 *   - idleSeconds()/answerSeconds(): валидация против разрешённых значений
 *   - window.idleguard_cleanup: защита от повторной инициализации
 *   - closeDialog(): надёжнее восстановление фокуса (player_on ? 'player' : ...)
 *   - init(): более надёжная проверка "плеер уже открыт при старте"
 */

(function () {
    'use strict'

    function startIdleGuard() {
        // Defensive: если предыдущая инкарнация как-то жива — зачищаем.
        if (window.idleguard_cleanup) {
            try { window.idleguard_cleanup() } catch (e) {}
        }

        window.idleguard_ready = true

        var LOG = 'IdleGuard'

        // ── Константы ─────────────────────────────────────────────────
        var TICK_MS           = 500       // период главного тика
        var POINTER_THRESHOLD = 8         // px: меньший сдвиг = дрожание аэромыши
        var SLEEP_GAP_MS      = 30000     // скачок времени (ТВ спал) — новая сессия
        var EXIT_FALLBACK_MS  = 2000      // страховка, если Player:destroy не придёт
        var TEST_IDLE_SEC     = 30        // тестовый режим: бездействие до диалога
        var CLOSE_CHECK_MS    = 300       // проверка window.close() через N мс

        var IDLE_VALUES_SEC   = [900, 1800, 3600, 5400, 7200]
        var ANSWER_VALUES_SEC = [10, 20, 30, 60]

        // ── Состояние ─────────────────────────────────────────────────
        var tick_timer      = null
        var player_on       = false
        var dialog_open     = false
        var dialog_body     = null
        var dialog_deadline = 0
        var prev_ctrl       = 'player'
        var last_activity   = 0
        var last_tick       = 0
        var pointer         = { x: null, y: null }
        var hud             = null
        var hud_last        = ''
        var exiting         = false

        // ── Логирование ───────────────────────────────────────────────
        function log() {
            var args = Array.prototype.slice.call(arguments)
            args.unshift(LOG)
            try { console.log.apply(console, args) } catch (e) {}
        }

        function tr(key) {
            try { return Lampa.Lang.translate(key) } catch (e) { return key }
        }

        // ── Валидация настроек ────────────────────────────────────────
        function validateChoice(value, allowed, def) {
            var n = parseInt(String(value), 10)
            if (isNaN(n)) return def
            for (var i = 0; i < allowed.length; i++) {
                if (allowed[i] === n) return n
            }
            return def
        }

        // ── Чтение настроек ───────────────────────────────────────────
        function isEnabled()  { return String(Lampa.Storage.field('idleguard_enabled')) === 'true' }
        function isTestMode() { return String(Lampa.Storage.field('idleguard_test'))    === 'true' }

        function idleSeconds() {
            if (isTestMode()) return TEST_IDLE_SEC
            return validateChoice(
                Lampa.Storage.field('idleguard_timeout'),
                IDLE_VALUES_SEC,
                3600
            )
        }

        function answerSeconds() {
            return validateChoice(
                Lampa.Storage.field('idleguard_answer'),
                ANSWER_VALUES_SEC,
                20
            )
        }

        function getAction() {
            return String(Lampa.Storage.field('idleguard_action')) === 'app' ? 'app' : 'main'
        }

        // ── Утилиты ───────────────────────────────────────────────────
        function pad(n) { return (n < 10 ? '0' : '') + n }

        function formatClock(sec) {
            sec = Math.max(0, sec)
            return pad(Math.floor(sec / 60)) + ':' + pad(sec % 60)
        }

        function markActivity() { last_activity = Date.now() }

        // ── Локализация ───────────────────────────────────────────────
        function registerLang() {
            Lampa.Lang.add({
                idleguard_title:       { ru: 'Автовыход при бездействии', en: 'Idle auto-exit' },
                idleguard_enabled:     { ru: 'Включить', en: 'Enable' },
                idleguard_enabled_d:   {
                    ru: 'Спрашивать «Продолжить просмотр?» при долгом бездействии пульта',
                    en: 'Ask "Continue watching?" after long remote inactivity'
                },
                idleguard_timeout:     { ru: 'Бездействие до вопроса', en: 'Idle time before prompt' },
                idleguard_timeout_d:   {
                    ru: 'Сколько ждать без нажатий, прежде чем показать вопрос',
                    en: 'How long to wait without input before showing the prompt'
                },
                idleguard_answer:      { ru: 'Время на ответ', en: 'Time to answer' },
                idleguard_answer_d:    {
                    ru: 'Сколько ждать ответа, прежде чем выполнить действие',
                    en: 'How long to wait for an answer before acting'
                },
                idleguard_action:      { ru: 'Если ответа нет', en: 'If no answer' },
                idleguard_action_main: { ru: 'Выйти на главный экран', en: 'Return to main screen' },
                idleguard_action_app:  { ru: 'Закрыть приложение', en: 'Close the app' },
                idleguard_min:         { ru: 'мин', en: 'min' },
                idleguard_sec:         { ru: 'сек', en: 'sec' },
                idleguard_test:        { ru: 'Тестовый режим', en: 'Test mode' },
                idleguard_test_d:      {
                    ru: 'Вопрос появляется через 30 секунд бездействия. Для отладки',
                    en: 'Prompt appears after 30 seconds of inactivity. For debugging'
                },
                idleguard_question:    { ru: 'Продолжить просмотр?', en: 'Continue watching?' },
                idleguard_text_main:   { ru: 'Возврат на главный экран', en: 'Returning to main screen' },
                idleguard_text_app:    { ru: 'Приложение будет закрыто', en: 'The app will close' },
                idleguard_yes:         { ru: 'Да, продолжить', en: 'Yes, continue' },
                idleguard_no:          { ru: 'Нет, выйти', en: 'No, exit' },
                idleguard_exit_fail:   {
                    ru: 'Не удалось закрыть приложение на этой платформе',
                    en: 'Could not close the app on this platform'
                }
            })
        }

        // ── Настройки ─────────────────────────────────────────────────
        function onSettingChange() {
            log('settings changed')
            markActivity()
            if (!isEnabled() && dialog_open) closeDialog(true)
        }

        function registerSettings() {
            if (!Lampa.SettingsApi) return

            var timeouts = {
                '900':  '15 '  + tr('idleguard_min'),
                '1800': '30 '  + tr('idleguard_min'),
                '3600': '60 '  + tr('idleguard_min'),
                '5400': '90 '  + tr('idleguard_min'),
                '7200': '120 ' + tr('idleguard_min')
            }

            var answers = {
                '10': '10 ' + tr('idleguard_sec'),
                '20': '20 ' + tr('idleguard_sec'),
                '30': '30 ' + tr('idleguard_sec'),
                '60': '60 ' + tr('idleguard_sec')
            }

            var actions = {
                'main': tr('idleguard_action_main'),
                'app':  tr('idleguard_action_app')
            }

            try {
                Lampa.SettingsApi.addComponent({
                    component: 'idleguard',
                    name: tr('idleguard_title'),
                    icon: '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                          '<circle cx="24" cy="24" r="20" stroke="currentColor" stroke-width="3"/>' +
                          '<path d="M24 13v11l8 5" stroke="currentColor" stroke-width="3" ' +
                                'stroke-linecap="round" stroke-linejoin="round"/>' +
                          '</svg>'
                })

                Lampa.SettingsApi.addParam({
                    component: 'idleguard',
                    param: { name: 'idleguard_enabled', type: 'trigger', default: true },
                    field: { name: tr('idleguard_enabled'), description: tr('idleguard_enabled_d') },
                    onChange: onSettingChange
                })

                Lampa.SettingsApi.addParam({
                    component: 'idleguard',
                    param: { name: 'idleguard_timeout', type: 'select', values: timeouts, default: '3600' },
                    field: { name: tr('idleguard_timeout'), description: tr('idleguard_timeout_d') },
                    onChange: onSettingChange
                })

                Lampa.SettingsApi.addParam({
                    component: 'idleguard',
                    param: { name: 'idleguard_answer', type: 'select', values: answers, default: '20' },
                    field: { name: tr('idleguard_answer'), description: tr('idleguard_answer_d') },
                    onChange: onSettingChange
                })

                Lampa.SettingsApi.addParam({
                    component: 'idleguard',
                    param: { name: 'idleguard_action', type: 'select', values: actions, default: 'main' },
                    field: { name: tr('idleguard_action') },
                    onChange: onSettingChange
                })

                Lampa.SettingsApi.addParam({
                    component: 'idleguard',
                    param: { name: 'idleguard_test', type: 'trigger', default: false },
                    field: { name: tr('idleguard_test'), description: tr('idleguard_test_d') },
                    onChange: onSettingChange
                })

                log('settings registered successfully')
            } catch (e) {
                log('registerSettings error:', e)
            }
        }

        // ── CSS ───────────────────────────────────────────────────────
        var CSS =
            '.idleguard{text-align:center;padding:1em 1em .5em}' +
            '.idleguard__icon{display:flex;justify-content:center;margin-bottom:.4em;opacity:.85}' +
            '.idleguard__icon svg{width:3em;height:3em;color:currentColor}' +
            '.idleguard__title{font-size:1.8em;font-weight:600;margin:.3em 0 .2em}' +
            '.idleguard__text{font-size:1.05em;opacity:.6;margin-bottom:.5em}' +
            '.idleguard__timer{font-size:2.8em;font-weight:600;margin:.2em 0 .4em;' +
                'font-variant-numeric:tabular-nums}' +
            '.idleguard-hud{position:fixed;left:.6em;bottom:.6em;z-index:100000;' +
                'padding:.3em .7em;border-radius:.4em;background:rgba(0,0,0,.75);' +
                'color:#ffd54f;font-size:.9em;pointer-events:none;' +
                'font-variant-numeric:tabular-nums}'

        function injectCss() {
            if ($('#idleguard-style').length) return
            $('body').append('<style id="idleguard-style">' + CSS + '</style>')
        }

        // ── Диалог ────────────────────────────────────────────────────
        function showDialog() {
            if (dialog_open || !player_on) return

            dialog_open     = true
            dialog_deadline = Date.now() + answerSeconds() * 1000

            try {
                var cur = Lampa.Controller.enabled()
                prev_ctrl = cur && cur.name ? cur.name : 'player'
            } catch (e) { prev_ctrl = 'player' }

            var action   = getAction()
            var subtitle = tr(action === 'app' ? 'idleguard_text_app' : 'idleguard_text_main')

            dialog_body = $(
                '<div class="idleguard">' +
                    '<div class="idleguard__icon">' +
                        '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                            '<circle cx="24" cy="24" r="20" stroke="currentColor" ' +
                                'stroke-opacity=".85" stroke-width="3"/>' +
                            '<rect x="17" y="15" width="5" height="18" rx="2" fill="currentColor"/>' +
                            '<rect x="26" y="15" width="5" height="18" rx="2" fill="currentColor"/>' +
                        '</svg>' +
                    '</div>' +
                    '<div class="idleguard__title">' + tr('idleguard_question') + '</div>' +
                    '<div class="idleguard__text">' + subtitle + '</div>' +
                    '<div class="idleguard__timer">' + formatClock(answerSeconds()) + '</div>' +
                '</div>'
            )

            log('showing dialog, answer time:', answerSeconds(), 'sec')

            Lampa.Modal.open({
                title:  '',
                html:   dialog_body,
                size:   'medium',
                align:  'center',
                buttons: [
                    { name: tr('idleguard_yes'), onSelect: keepWatching },
                    { name: tr('idleguard_no'),  onSelect: finish }
                ],
                // Back = безопасный ответ "продолжить"
                onBack: keepWatching
            })
        }

        function updateDialogTimer(remaining_sec) {
            if (!dialog_body) return
            dialog_body.find('.idleguard__timer').text(formatClock(remaining_sec))
        }

        function closeDialog(restore_focus) {
            if (!dialog_open) return
            dialog_open     = false
            dialog_body     = null
            dialog_deadline = 0

            try { Lampa.Modal.close() } catch (e) { log('Modal.close error:', e) }

            if (restore_focus) {
                try {
                    // Диалог показывается только при player_on === true,
                    // поэтому надёжнее вернуть фокус прямо в плеер.
                    var target = player_on ? 'player' : (prev_ctrl || 'content')
                    Lampa.Controller.toggle(target)
                } catch (e) {
                    log('toggle error:', e)
                }
            }
        }

        function keepWatching() {
            log('user continues watching')
            closeDialog(true)
            markActivity()
        }

        // ── Выход ─────────────────────────────────────────────────────
        function finish() {
            if (exiting) return
            exiting = true

            var action = getAction()
            log('idle timeout, action:', action)

            closeDialog(false)

            var done = false
            function afterClose() {
                if (done) return
                done = true
                try { Lampa.Player.listener.remove('destroy', afterClose) } catch (e) {}

                player_on = false
                exiting   = false

                if (action === 'app') exitApp()
                else                  goMain()
            }

            var close_attempted = false
            try {
                if (Lampa.Player && typeof Lampa.Player.close === 'function') {
                    Lampa.Player.listener.follow('destroy', afterClose)
                    Lampa.Player.close()
                    close_attempted = true
                }
            } catch (e) { log('Player.close failed:', e) }

            if (close_attempted) {
                setTimeout(function () {
                    if (done) return

                    var still_open = false
                    try {
                        if (Lampa.Player && typeof Lampa.Player.opened === 'function') {
                            still_open = Lampa.Player.opened() === true
                        }
                        if (!still_open) {
                            var ctrl = Lampa.Controller.enabled()
                            still_open = ctrl && ctrl.name === 'player'
                        }
                    } catch (e) {}

                    if (still_open) {
                        log('WARNING: player still open after', EXIT_FALLBACK_MS, 'ms — forcing proceed')
                    }

                    afterClose()
                }, EXIT_FALLBACK_MS)
            }
            else {
                afterClose()
            }
        }

        function exitApp() {
            log('closing app')

            // Samsung Tizen
            if (window.tizen && tizen.application && tizen.application.getCurrentApplication) {
                try {
                    tizen.application.getCurrentApplication().exit()
                    log('tizen exit called'); return
                } catch (e) { log('tizen exit failed:', e) }
            }

            // LG webOS
            if (window.PalmSystem && typeof PalmSystem.platformBack === 'function') {
                try { PalmSystem.platformBack(); log('PalmSystem exit'); return }
                catch (e) { log('PalmSystem exit failed:', e) }
            }
            if (window.webOS && typeof webOS.platformBack === 'function') {
                try { webOS.platformBack(); log('webOS exit'); return }
                catch (e) { log('webOS exit failed:', e) }
            }

            // Lampa API
            if (Lampa.Platform && typeof Lampa.Platform.exit === 'function') {
                try { Lampa.Platform.exit(); log('Lampa.Platform.exit'); return }
                catch (e) { log('Lampa exit failed:', e) }
            }

            // Browser fallback
            try { window.close() } catch (e) { log('window.close threw:', e) }

            setTimeout(function () {
                log('app still alive after window.close, showing error')
                try { Lampa.Noty.show(tr('idleguard_exit_fail'), { style: 'error' }) } catch (e) {}
                goMain()
            }, CLOSE_CHECK_MS)
        }

        function goMain() {
            try {
                var source = String(Lampa.Storage.field('source') || 'tmdb')
                Lampa.Activity.push({
                    url:       '',
                    title:     source.toUpperCase(),
                    component: 'main',
                    source:    source,
                    page:      1
                })
                log('navigated to main')
            } catch (e) { log('goMain error:', e) }
        }

        // ── HUD (только тестовый режим) ───────────────────────────────
        function updateHud() {
            if (!isTestMode()) {
                if (hud) { hud.remove(); hud = null; hud_last = '' }
                return
            }

            if (!hud) {
                hud = $('<div class="idleguard-hud"></div>')
                $('body').append(hud)
            }

            var text
            if (dialog_open) {
                var rem = Math.max(0, Math.ceil((dialog_deadline - Date.now()) / 1000))
                text = 'Exit ' + formatClock(rem)
            }
            else if (player_on && isEnabled()) {
                var elapsed = Date.now() - last_activity
                var rem2    = Math.max(0, Math.ceil(idleSeconds() - elapsed / 1000))
                text = 'Dialog ' + formatClock(rem2)
            }
            else { text = 'standby' }

            var full = 'IdleGuard TEST · ' + text
            if (full !== hud_last) { hud.text(full); hud_last = full }
        }

        // ── Главный тик ───────────────────────────────────────────────
        function tick() {
            var now = Date.now()
            var gap = now - last_tick
            last_tick = now

            if (exiting) return

            if (gap > SLEEP_GAP_MS) {
                log('sleep gap detected:', gap, 'ms')
                last_activity = now
                if (dialog_open) closeDialog(true)
                updateHud(); return
            }

            if (!isEnabled()) {
                if (dialog_open) closeDialog(true)
                last_activity = now
                updateHud(); return
            }

            if (dialog_open) {
                var remaining = Math.ceil((dialog_deadline - now) / 1000)
                if (remaining <= 0) { finish(); return }
                updateDialogTimer(remaining)
            }
            else if (player_on && (now - last_activity >= idleSeconds() * 1000)) {
                showDialog()
            }

            updateHud()
        }

        // ── Активность ────────────────────────────────────────────────
        function onPointerMove(e) {
            if (dialog_open || !player_on) return
            var x = e.clientX, y = e.clientY
            if (pointer.x === null) { pointer.x = x; pointer.y = y; return }
            if (Math.abs(x - pointer.x) + Math.abs(y - pointer.y) >= POINTER_THRESHOLD) {
                pointer.x = x; pointer.y = y
                markActivity()
            }
        }

        function onPointerAction() {
            if (!dialog_open && player_on) markActivity()
        }

        // ── Подписки ──────────────────────────────────────────────────
        function bindListeners() {
            Lampa.Keypad.listener.follow('keydown', function () {
                if (!dialog_open && player_on) markActivity()
            })

            window.addEventListener('mousemove',   onPointerMove,   true)
            window.addEventListener('mousedown',   onPointerAction, true)
            window.addEventListener('wheel',       onPointerAction, true)
            window.addEventListener('touchstart',  onPointerAction, true)
            window.addEventListener('touchmove',   onPointerAction, true)
            window.addEventListener('pointerdown', onPointerAction, true)

            document.addEventListener('visibilitychange', function () {
                if (!document.hidden && !dialog_open) markActivity()
            })

            Lampa.Player.listener.follow('start', function () {
                player_on = true
                markActivity()
                log('player started')
            })

            Lampa.Player.listener.follow('destroy', function () {
                player_on = false
                if (dialog_open) closeDialog(false)
                log('player destroyed')
            })
        }

        // ── Старт ─────────────────────────────────────────────────────
        function init() {
            registerLang()
            registerSettings()
            injectCss()
            bindListeners()

            last_activity = Date.now()
            last_tick     = Date.now()
            tick_timer    = setInterval(tick, TICK_MS)

            window.idleguard_cleanup = function () {
                try { clearInterval(tick_timer) } catch (e) {}
                tick_timer = null
                if (hud) { try { hud.remove() } catch (e) {} hud = null; hud_last = '' }
                if (dialog_open) closeDialog(false)
            }

            try {
                var opened = false
                if (Lampa.Player && typeof Lampa.Player.opened === 'function') {
                    opened = Lampa.Player.opened() === true
                }
                if (!opened) {
                    var ctrl = Lampa.Controller.enabled()
                    opened = ctrl && ctrl.name === 'player'
                }
                if (opened) {
                    player_on = true
                    log('player already open at startup')
                }
            } catch (e) {
                log('startup player detection failed:', e)
            }

            log('init, app_version:', Lampa.Manifest.app_version)
        }

        if (window.appready) init()
        else Lampa.Listener.follow('app', function (e) { if (e.type == 'ready') init() })
    }

    if (!window.idleguard_ready) startIdleGuard()
})()