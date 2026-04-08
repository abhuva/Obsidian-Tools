      var CALENDAR_API_BASE = window.CALENDAR_API_BASE || window.location.origin;
      var THEME_CACHE_KEY = 'calendar-theme-bootstrap-v1';
      var CALENDAR_UI_SETTINGS_KEY = 'calendar-ui-settings-v1';
      var CALENDAR_FOCUS_DATE_KEY = 'calendar-focus-date-v1';
      var calendarApiToken = '';
      var ROUNDNESS_MIN = 0;
      var ROUNDNESS_MAX = 24;
      var isCreateFlowActive = false;
      var isDayActionFlowActive = false;
      var closeActiveEventPreview = null;
      var focusedDate = loadFocusedDate();
      var calendarUiSettings = loadCalendarUiSettings();
      applyGlobalRoundness(calendarUiSettings.roundness);

      function isHttpContext() {
        return window.location.protocol === 'http:' || window.location.protocol === 'https:';
      }

      function loadCalendarUiSettings() {
        var defaults = {
          showSocietyBadges: true,
          showRecurringBadge: true,
          showGoogleEvents: false,
          showEventPreviewOnClick: true,
          multiMonthMinWidth: 300,
          roundness: 8
        };
        var raw = null;
        try {
          raw = localStorage.getItem(CALENDAR_UI_SETTINGS_KEY);
        } catch (error) {
          return defaults;
        }
        if (!raw) return defaults;
        try {
          var parsed = JSON.parse(raw);
          if (!parsed || typeof parsed !== 'object') return defaults;
          var parsedWidth = Number(parsed.multiMonthMinWidth);
          var safeWidth = Number.isFinite(parsedWidth) ? Math.round(parsedWidth) : defaults.multiMonthMinWidth;
          if (safeWidth < 220) safeWidth = 220;
          if (safeWidth > 520) safeWidth = 520;
          var parsedRoundness = Number(parsed.roundness);
          var safeRoundness = Number.isFinite(parsedRoundness) ? Math.round(parsedRoundness) : defaults.roundness;
          if (safeRoundness < ROUNDNESS_MIN) safeRoundness = ROUNDNESS_MIN;
          if (safeRoundness > ROUNDNESS_MAX) safeRoundness = ROUNDNESS_MAX;
          return {
            showSocietyBadges: parsed.showSocietyBadges !== false,
            showRecurringBadge: parsed.showRecurringBadge !== false,
            showGoogleEvents: parsed.showGoogleEvents === true,
            showEventPreviewOnClick: parsed.showEventPreviewOnClick !== false,
            multiMonthMinWidth: safeWidth,
            roundness: safeRoundness
          };
        } catch (error) {
          return defaults;
        }
      }

      function loadFocusedDate() {
        var raw = '';
        try {
          raw = String(localStorage.getItem(CALENDAR_FOCUS_DATE_KEY) || '').trim();
        } catch (error) {
          return '';
        }
        return normalizeIsoDate(raw);
      }

      function persistFocusedDate(value) {
        try {
          if (!value) {
            localStorage.removeItem(CALENDAR_FOCUS_DATE_KEY);
          } else {
            localStorage.setItem(CALENDAR_FOCUS_DATE_KEY, String(value));
          }
        } catch (error) {
          // noop
        }
      }

      function applyGlobalRoundness(roundness) {
        var parsed = Number(roundness);
        var safe = Number.isFinite(parsed) ? Math.round(parsed) : 8;
        if (safe < ROUNDNESS_MIN) safe = ROUNDNESS_MIN;
        if (safe > ROUNDNESS_MAX) safe = ROUNDNESS_MAX;
        document.documentElement.style.setProperty('--cal-radius', String(safe) + 'px');
      }

      function persistCalendarUiSettings() {
        try {
          localStorage.setItem(CALENDAR_UI_SETTINGS_KEY, JSON.stringify(calendarUiSettings));
        } catch (error) {
          // noop
        }
      }

      function currentThemeCssVarSnapshot() {
        var names = [
          '--cal-bg-a',
          '--cal-bg-b',
          '--cal-surface',
          '--cal-surface-strong',
          '--cal-border',
          '--cal-text',
          '--cal-text-soft',
          '--cal-accent',
          '--cal-accent-soft',
          '--cal-success',
          '--cal-danger',
          '--cal-shadow',
          '--fc-page-bg-color',
          '--fc-neutral-bg-color',
          '--fc-neutral-text-color',
          '--fc-border-color',
          '--fc-button-bg-color',
          '--fc-button-border-color',
          '--fc-button-text-color',
          '--fc-button-hover-bg-color',
          '--fc-button-hover-border-color',
          '--fc-button-active-bg-color',
          '--fc-button-active-border-color',
          '--fc-today-bg-color',
          '--fc-event-bg-color',
          '--fc-event-border-color',
          '--fc-event-text-color',
          '--fc-list-event-hover-bg-color'
        ];
        var out = {};
        var root = document.documentElement;
        names.forEach(function(name) {
          var value = root.style.getPropertyValue(name);
          if (value && String(value).trim()) out[name] = String(value).trim();
        });
        return out;
      }

      function persistThemeBootstrapCache(vars) {
        try {
          localStorage.setItem(THEME_CACHE_KEY, JSON.stringify({ vars: vars || {} }));
        } catch (error) {
          // noop
        }
      }

      function applyMirroredThemeVars(themeVars) {
        var accent = String(themeVars && themeVars.accent || '').trim();
        var accentHover = String(themeVars && themeVars.accentHover || '').trim();
        var bgPrimary = String(themeVars && themeVars.bgPrimary || '').trim();
        var bgSecondary = String(themeVars && themeVars.bgSecondary || '').trim();
        var bgMod = String(themeVars && themeVars.bgMod || '').trim();
        var border = String(themeVars && themeVars.border || '').trim();
        var text = String(themeVars && themeVars.text || '').trim();
        var textMuted = String(themeVars && themeVars.textMuted || '').trim();
        var textSuccess = String(themeVars && themeVars.textSuccess || '').trim();
        var textError = String(themeVars && themeVars.textError || '').trim();

        if (!accent || !bgPrimary || !text) return false;

        var root = document.documentElement;
        root.style.setProperty('--cal-bg-a', bgSecondary || bgPrimary);
        root.style.setProperty('--cal-bg-b', bgPrimary);
        root.style.setProperty('--cal-surface', bgPrimary);
        root.style.setProperty('--cal-surface-strong', bgMod || bgSecondary || bgPrimary);
        root.style.setProperty('--cal-border', border || 'rgba(128, 128, 128, 0.3)');
        root.style.setProperty('--cal-text', text);
        root.style.setProperty('--cal-text-soft', textMuted || text);
        root.style.setProperty('--cal-accent', accent);
        root.style.setProperty('--cal-accent-soft', accentHover || accent);
        root.style.setProperty('--cal-success', textSuccess || '#1b8e4a');
        root.style.setProperty('--cal-danger', textError || '#a42130');
        root.style.setProperty('--cal-shadow', '0 12px 30px rgba(0, 0, 0, 0.20)');

        root.style.setProperty('--fc-page-bg-color', bgPrimary);
        root.style.setProperty('--fc-neutral-bg-color', bgMod || bgSecondary || bgPrimary);
        root.style.setProperty('--fc-neutral-text-color', text);
        root.style.setProperty('--fc-border-color', border || 'rgba(128, 128, 128, 0.3)');
        root.style.setProperty('--fc-button-bg-color', accent);
        root.style.setProperty('--fc-button-border-color', accent);
        root.style.setProperty('--fc-button-text-color', '#ffffff');
        root.style.setProperty('--fc-button-hover-bg-color', accentHover || accent);
        root.style.setProperty('--fc-button-hover-border-color', accentHover || accent);
        root.style.setProperty('--fc-button-active-bg-color', accentHover || accent);
        root.style.setProperty('--fc-button-active-border-color', accentHover || accent);
        root.style.setProperty('--fc-today-bg-color', bgMod || bgSecondary || bgPrimary);
        root.style.setProperty('--fc-event-bg-color', accent);
        root.style.setProperty('--fc-event-border-color', accent);
        root.style.setProperty('--fc-event-text-color', '#ffffff');
        root.style.setProperty('--fc-list-event-hover-bg-color', bgMod || bgSecondary || bgPrimary);
        return true;
      }

      async function fetchObsidianThemeSnapshot() {
        var themeUrl = new URL('/api/obsidian/theme', CALENDAR_API_BASE).toString();
        var response = await fetch(themeUrl, { method: 'GET' });
        if (!response.ok) {
          var text = await response.text();
          throw new Error(text || 'Could not load Obsidian theme');
        }
        var payload = await response.json();
        return payload && payload.theme ? payload.theme : null;
      }

      async function applyCalendarTheme() {
        if (!isHttpContext()) return;
        try {
          var theme = await fetchObsidianThemeSnapshot();
          var mirrored = applyMirroredThemeVars(theme && theme.vars ? theme.vars : null);
          if (mirrored) {
            persistThemeBootstrapCache(currentThemeCssVarSnapshot());
          }
        } catch (error) {
          console.warn('Could not mirror Obsidian theme for calendar:', error.message);
        }
      }

      function escapeHtml(value) {
        return String(value || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');
      }

      function getEventSociety(event) {
        var sourcePath = String(event && event.extendedProps && event.extendedProps.sourcePath || '').toUpperCase();
        if (sourcePath.indexOf(' TOHU ') >= 0 || sourcePath.indexOf('/TOHU ') >= 0) return 'tohu';
        if (sourcePath.indexOf(' NICA ') >= 0 || sourcePath.indexOf('/NICA ') >= 0) return 'nica';
        return '';
      }

      function normalizeIsoDate(input) {
        if (!input) return '';
        var asString = String(input);
        if (/^\d{4}-\d{2}-\d{2}$/.test(asString)) return asString;
        var match = asString.match(/^(\d{4}-\d{2}-\d{2})/);
        return match && match[1] ? match[1] : '';
      }

      function parseCoordinatesValue(value) {
        if (value == null) return null;

        if (Array.isArray(value)) {
          if (value.length < 2) return null;
          var arrLat = Number(value[0]);
          var arrLng = Number(value[1]);
          if (!Number.isFinite(arrLat) || !Number.isFinite(arrLng)) return null;
          return { lat: arrLat, lng: arrLng };
        }

        if (typeof value === 'object') {
          var objLat = Number(value.lat != null ? value.lat : value.latitude);
          var objLng = Number(value.lng != null ? value.lng : (value.lon != null ? value.lon : (value.long != null ? value.long : value.longitude)));
          if (!Number.isFinite(objLat) || !Number.isFinite(objLng)) return null;
          return { lat: objLat, lng: objLng };
        }

        var raw = String(value || '').trim();
        if (!raw) return null;
        var match = raw.match(/(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)/);
        if (!match) return null;
        var lat = Number(match[1]);
        var lng = Number(match[2]);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return { lat: lat, lng: lng };
      }

      function getEventCoordinates(event) {
        var value = event && event.extendedProps ? event.extendedProps.coordinates : null;
        return parseCoordinatesValue(value);
      }

      function toLocalIsoDate(date) {
        if (!(date instanceof Date)) return '';
        var year = date.getFullYear();
        var month = String(date.getMonth() + 1).padStart(2, '0');
        var day = String(date.getDate()).padStart(2, '0');
        return String(year) + '-' + month + '-' + day;
      }

      function shiftIsoDateSafe(isoDate, deltaDays) {
        var normalized = normalizeIsoDate(isoDate);
        if (!normalized) return '';
        return shiftIsoDate(normalized, deltaDays);
      }

      function buildVacationDaySet(events) {
        var result = new Set();
        (events || []).forEach(function(evt) {
          if (!evt || evt.display !== 'background') return;
          var start = normalizeIsoDate(evt.start || evt.startStr);
          if (!start) return;
          var endExclusive = normalizeIsoDate(evt.end || evt.endStr);
          var endInclusive = endExclusive ? shiftIsoDateSafe(endExclusive, -1) : start;
          if (!endInclusive) endInclusive = start;

          var cursor = start;
          while (cursor && cursor <= endInclusive) {
            result.add(cursor);
            cursor = shiftIsoDateSafe(cursor, 1);
            if (!cursor) break;
          }
        });
        return result;
      }

      function eventClassNamesHook(arg) {
        var classes = [];
        var event = arg && arg.event;
        if (!event) return classes;

        if (event.display === 'background') {
          classes.push('ev-background');
        } else {
          classes.push('ev-solid');
        }

        if (event.extendedProps && event.extendedProps.isRecurring) {
          classes.push('ev-recurring');
        }
        if (event.extendedProps && event.extendedProps.isRecurringOverride) {
          classes.push('ev-recurring-override');
        }

        var society = getEventSociety(event);
        if (society) classes.push('ev-society-' + society);
        return classes;
      }

      function eventContentHook(arg) {
        var event = arg && arg.event;
        if (!event || event.display === 'background') return;
        var title = escapeHtml(event.title || '');
        var badges = [];

        var society = getEventSociety(event);
        if (calendarUiSettings.showSocietyBadges) {
          if (society === 'nica') badges.push('<span class="ev-badge ev-badge--nica">NICA</span>');
          if (society === 'tohu') badges.push('<span class="ev-badge ev-badge--tohu">TOHU</span>');
        }
        if (calendarUiSettings.showRecurringBadge && event.extendedProps && event.extendedProps.isRecurring) {
          badges.push('<span class="ev-badge ev-badge--rec">REC</span>');
        }

        var badgesHtml = badges.length ? ('<span class="ev-badges">' + badges.join('') + '</span>') : '';
        return {
          html: '<div class="ev-content">' + badgesHtml + '<span class="ev-title">' + title + '</span></div>'
        };
      }

      function eventDidMountHook(arg) {
        var event = arg && arg.event;
        var el = arg && arg.el;
        if (!event || !el || event.display === 'background') return;

        var bg = String(event.backgroundColor || event.borderColor || '').trim();
        var border = String(event.borderColor || event.backgroundColor || '').trim();
        var text = String(event.textColor || '').trim();
        if (!bg && !border) return;

        if (bg) el.style.backgroundColor = bg;
        if (border) el.style.borderColor = border;
        el.style.color = text || '#ffffff';

        if (el.classList.contains('fc-daygrid-dot-event')) {
          var dot = el.querySelector('.fc-daygrid-event-dot');
          if (dot) dot.style.display = 'none';
        }
      }

      function dayCellClassNamesHook(vacationDays, arg) {
        var classes = [];
        var date = arg && arg.date;
        if (!(date instanceof Date)) return classes;
        var day = date.getDay();
        if (day === 0 || day === 6) classes.push('day-weekend');
        var iso = toLocalIsoDate(date);
        if (vacationDays && vacationDays.has(iso)) classes.push('day-vacation');
        if (focusedDate && iso === focusedDate) classes.push('day-focused');
        return classes;
      }

      function dayHeaderClassNamesHook(arg) {
        var classes = [];
        var date = arg && arg.date;
        if (!(date instanceof Date)) return classes;
        var iso = toLocalIsoDate(date);
        if (focusedDate && iso === focusedDate) classes.push('day-focused');
        return classes;
      }

      function updateFocusedDateDecorations(calendarEl) {
        if (!calendarEl) return;
        var nodes = calendarEl.querySelectorAll('.fc-daygrid-day[data-date], .fc-col-header-cell[data-date]');
        nodes.forEach(function(node) {
          var iso = normalizeIsoDate(node.getAttribute('data-date'));
          if (focusedDate && iso === focusedDate) {
            node.classList.add('day-focused');
          } else {
            node.classList.remove('day-focused');
          }
        });
      }

      function setFocusedDate(calendar, calendarEl, nextDate, options) {
        var normalized = normalizeIsoDate(nextDate);
        if (!normalized) return;
        if (focusedDate === normalized) return;
        focusedDate = normalized;
        persistFocusedDate(focusedDate);
        updateFocusedDateDecorations(calendarEl);
        if (calendar && options && options.jumpToFocus === true) {
          calendar.gotoDate(focusedDate);
        }
      }

      function focusCalendarOnToday(calendar, calendarEl) {
        if (!calendar) return;
        var todayIso = toLocalIsoDate(new Date());
        if (!todayIso) return;
        setFocusedDate(calendar, calendarEl, todayIso, { jumpToFocus: false });
        var currentViewType = calendar.view && calendar.view.type ? String(calendar.view.type) : '';
        if (currentViewType) {
          calendar.changeView(currentViewType, todayIso);
        } else {
          calendar.gotoDate(todayIso);
        }
        updateFocusedDateDecorations(calendarEl);
      }

      function mountCalendarSettingsPopover(calendarEl, calendar) {
        var panel = document.getElementById('calendar-label-settings');
        var societyToggle = document.getElementById('toggle-society-badges');
        var recurringToggle = document.getElementById('toggle-recurring-badge');
        var googleToggle = document.getElementById('toggle-google-events');
        var eventPreviewToggle = document.getElementById('toggle-event-preview');
        var googleStatus = document.getElementById('setting-google-status');
        var monthWidthSlider = document.getElementById('setting-month-width');
        var monthWidthValue = document.getElementById('setting-month-width-value');
        var roundnessSlider = document.getElementById('setting-roundness');
        var roundnessValue = document.getElementById('setting-roundness-value');
        if (!panel || !societyToggle || !recurringToggle || !googleToggle || !eventPreviewToggle || !googleStatus || !monthWidthSlider || !monthWidthValue || !roundnessSlider || !roundnessValue) return;

        function updateGoogleStatusText() {
          if (window.googleCalendarState && window.googleCalendarState.lastError) {
            googleStatus.textContent = 'Google load error: ' + window.googleCalendarState.lastError;
            googleStatus.classList.add('is-error');
            return;
          }
          if (!window.googleCalendarState || !window.googleCalendarState.configured) {
            googleStatus.textContent = 'Google source not configured (.env key/ids missing).';
            googleStatus.classList.remove('is-error');
            return;
          }
          if (window.googleCalendarState.enabled) {
            googleStatus.textContent = 'Google source active.';
          } else {
            googleStatus.textContent = 'Google source available (currently disabled).';
          }
          googleStatus.classList.remove('is-error');
        }

        function syncInputs() {
          societyToggle.checked = calendarUiSettings.showSocietyBadges !== false;
          recurringToggle.checked = calendarUiSettings.showRecurringBadge !== false;
          googleToggle.checked = calendarUiSettings.showGoogleEvents === true;
          eventPreviewToggle.checked = calendarUiSettings.showEventPreviewOnClick !== false;
          googleToggle.disabled = !window.googleCalendarState || !window.googleCalendarState.configured;
          updateGoogleStatusText();
          monthWidthSlider.value = String(calendarUiSettings.multiMonthMinWidth || 300);
          monthWidthValue.textContent = String(calendarUiSettings.multiMonthMinWidth || 300) + ' px';
          roundnessSlider.value = String(calendarUiSettings.roundness || 0);
          roundnessValue.textContent = String(calendarUiSettings.roundness || 0) + ' px';
        }

        function closePanel() {
          panel.classList.remove('is-open');
          panel.setAttribute('aria-hidden', 'true');
        }

        function openPanel() {
          syncInputs();
          panel.classList.add('is-open');
          panel.setAttribute('aria-hidden', 'false');

          var settingsButton = calendarEl
            .closest('body')
            .querySelector('.fc-calendarSettings-button');
          if (settingsButton) {
            var rect = settingsButton.getBoundingClientRect();
            panel.style.top = (window.scrollY + rect.bottom + 6) + 'px';
            panel.style.left = (window.scrollX + rect.left) + 'px';
          }
        }

        function togglePanel() {
          if (panel.classList.contains('is-open')) {
            closePanel();
          } else {
            openPanel();
          }
        }

        window.toggleCalendarSettings = togglePanel;

        societyToggle.addEventListener('change', function() {
          calendarUiSettings.showSocietyBadges = Boolean(societyToggle.checked);
          persistCalendarUiSettings();
          calendar.rerenderEvents();
        });
        recurringToggle.addEventListener('change', function() {
          calendarUiSettings.showRecurringBadge = Boolean(recurringToggle.checked);
          persistCalendarUiSettings();
          calendar.rerenderEvents();
        });
        googleToggle.addEventListener('change', function() {
          calendarUiSettings.showGoogleEvents = Boolean(googleToggle.checked);
          persistCalendarUiSettings();
          if (typeof window.setGoogleEventsEnabled === 'function') {
            window.setGoogleEventsEnabled(calendar, calendarUiSettings.showGoogleEvents);
          }
          updateGoogleStatusText();
        });
        eventPreviewToggle.addEventListener('change', function() {
          calendarUiSettings.showEventPreviewOnClick = Boolean(eventPreviewToggle.checked);
          persistCalendarUiSettings();
          if (!calendarUiSettings.showEventPreviewOnClick) {
            closeEventPreviewPopover();
          }
        });
        monthWidthSlider.addEventListener('input', function() {
          var parsed = Number(monthWidthSlider.value);
          if (!Number.isFinite(parsed)) return;
          if (parsed < 220) parsed = 220;
          if (parsed > 520) parsed = 520;
          parsed = Math.round(parsed);
          calendarUiSettings.multiMonthMinWidth = parsed;
          monthWidthValue.textContent = String(parsed) + ' px';
          persistCalendarUiSettings();
          calendar.setOption('multiMonthMinWidth', parsed);
        });
        roundnessSlider.addEventListener('input', function() {
          var parsed = Number(roundnessSlider.value);
          if (!Number.isFinite(parsed)) return;
          if (parsed < ROUNDNESS_MIN) parsed = ROUNDNESS_MIN;
          if (parsed > ROUNDNESS_MAX) parsed = ROUNDNESS_MAX;
          parsed = Math.round(parsed);
          calendarUiSettings.roundness = parsed;
          roundnessValue.textContent = String(parsed) + ' px';
          applyGlobalRoundness(parsed);
          persistCalendarUiSettings();
        });

        document.addEventListener('click', function(event) {
          if (!panel.classList.contains('is-open')) return;
          var isInsidePanel = panel.contains(event.target);
          var isSettingsButton = event.target.closest('.fc-calendarSettings-button');
          if (isInsidePanel || isSettingsButton) return;
          closePanel();
        });
        document.addEventListener('keydown', function(event) {
          if (event.key === 'Escape') closePanel();
        });
      }

      function showCreateEventDialog() {
        return new Promise(function(resolve) {
          var modal = document.getElementById('create-event-modal');
          var input = document.getElementById('create-event-title');
          var createBtn = document.getElementById('create-event-confirm');
          var cancelBtn = document.getElementById('create-event-cancel');
          if (!modal || !input || !createBtn || !cancelBtn) {
            resolve(null);
            return;
          }

          var done = false;
          function cleanup() {
            modal.classList.remove('is-open');
            createBtn.removeEventListener('click', onCreate);
            cancelBtn.removeEventListener('click', onCancel);
            input.removeEventListener('keydown', onKeyDown);
          }
          function finish(value) {
            if (done) return;
            done = true;
            cleanup();
            resolve(value);
          }
          function onCreate() {
            var title = input.value.trim();
            if (!title) {
              input.focus();
              return;
            }
            finish(title);
          }
          function onCancel() {
            finish(null);
          }
          function onKeyDown(event) {
            if (event.key === 'Enter') {
              event.preventDefault();
              onCreate();
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              onCancel();
            }
          }

          input.value = '';
          modal.classList.add('is-open');
          createBtn.addEventListener('click', onCreate);
          cancelBtn.addEventListener('click', onCancel);
          input.addEventListener('keydown', onKeyDown);
          setTimeout(function() { input.focus(); }, 0);
        });
      }

      function getAnchorPointFromNativeEvent(nativeEvent) {
        if (!nativeEvent) return null;
        var clientX = Number(nativeEvent.clientX);
        var clientY = Number(nativeEvent.clientY);
        if (Number.isFinite(clientX) && Number.isFinite(clientY)) {
          return { x: clientX, y: clientY };
        }
        var target = nativeEvent.target;
        if (target && typeof target.getBoundingClientRect === 'function') {
          var rect = target.getBoundingClientRect();
          return {
            x: rect.left + (rect.width / 2),
            y: rect.top + (rect.height / 2)
          };
        }
        return null;
      }

      function placeDayActionMenu(menu, anchorPoint) {
        if (!menu) return;
        var margin = 10;
        var viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
        var viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
        var fallbackX = Math.max(margin, Math.round(viewportWidth / 2));
        var fallbackY = Math.max(margin, Math.round(viewportHeight / 2));
        var rawX = anchorPoint && Number.isFinite(Number(anchorPoint.x)) ? Number(anchorPoint.x) : fallbackX;
        var rawY = anchorPoint && Number.isFinite(Number(anchorPoint.y)) ? Number(anchorPoint.y) : fallbackY;
        var menuWidth = menu.offsetWidth || 220;
        var menuHeight = menu.offsetHeight || 100;

        var left = Math.round(rawX + 6);
        var top = Math.round(rawY + 6);
        if (left + menuWidth > viewportWidth - margin) left = viewportWidth - menuWidth - margin;
        if (top + menuHeight > viewportHeight - margin) top = viewportHeight - menuHeight - margin;
        if (left < margin) left = margin;
        if (top < margin) top = margin;

        menu.style.left = String(left) + 'px';
        menu.style.top = String(top) + 'px';
      }

      function closeEventPreviewPopover() {
        if (typeof closeActiveEventPreview === 'function') {
          closeActiveEventPreview();
        }
      }

      function placeEventPreviewPopover(popover, anchorPoint) {
        if (!popover) return;
        var margin = 10;
        var viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
        var viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
        var fallbackX = Math.max(margin, Math.round(viewportWidth / 2));
        var fallbackY = Math.max(margin, Math.round(viewportHeight / 2));
        var rawX = anchorPoint && Number.isFinite(Number(anchorPoint.x)) ? Number(anchorPoint.x) : fallbackX;
        var rawY = anchorPoint && Number.isFinite(Number(anchorPoint.y)) ? Number(anchorPoint.y) : fallbackY;
        var popoverWidth = popover.offsetWidth || 360;
        var popoverHeight = popover.offsetHeight || 240;

        var left = Math.round(rawX + 10);
        var top = Math.round(rawY + 10);
        if (left + popoverWidth > viewportWidth - margin) left = Math.round(rawX - popoverWidth - 10);
        if (top + popoverHeight > viewportHeight - margin) top = Math.round(rawY - popoverHeight - 10);
        if (left < margin) left = margin;
        if (top < margin) top = margin;

        popover.style.left = String(left) + 'px';
        popover.style.top = String(top) + 'px';
      }

      function formatIsoDateForPreview(isoDate) {
        var normalized = normalizeIsoDate(isoDate);
        if (!normalized) return '';
        var parts = normalized.split('-').map(Number);
        if (parts.length !== 3) return normalized;
        var localDate = new Date(parts[0], parts[1] - 1, parts[2]);
        return new Intl.DateTimeFormat(undefined, {
          weekday: 'short',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).format(localDate);
      }

      function formatTimeForPreview(date) {
        if (!(date instanceof Date)) return '';
        return new Intl.DateTimeFormat(undefined, {
          hour: '2-digit',
          minute: '2-digit'
        }).format(date);
      }

      function formatEventDateForPreview(event) {
        if (!event) return '';
        if (event.allDay) {
          var startIso = normalizeIsoDate(event.startStr || localIsoDateKey(event.start));
          var endIso = event.endStr ? normalizeIsoDate(toInclusiveEndDate(event.endStr)) : startIso;
          if (!startIso) return '';
          var startLabel = formatIsoDateForPreview(startIso);
          if (endIso && endIso !== startIso) {
            return startLabel + ' - ' + formatIsoDateForPreview(endIso);
          }
          return startLabel;
        }

        var startDate = event.start instanceof Date ? event.start : null;
        var endDate = event.end instanceof Date ? event.end : null;
        if (!startDate) return '';

        var startDateLabel = formatIsoDateForPreview(localIsoDateKey(startDate));
        if (!endDate) return startDateLabel + ' ' + formatTimeForPreview(startDate);
        var sameDay = localIsoDateKey(startDate) === localIsoDateKey(endDate);
        if (sameDay) {
          return startDateLabel + ' ' + formatTimeForPreview(startDate) + ' - ' + formatTimeForPreview(endDate);
        }
        return (
          formatIsoDateForPreview(localIsoDateKey(startDate)) +
          ' ' +
          formatTimeForPreview(startDate) +
          ' - ' +
          formatIsoDateForPreview(localIsoDateKey(endDate)) +
          ' ' +
          formatTimeForPreview(endDate)
        );
      }

      function renderSimpleMarkdownText(markdownText) {
        var escaped = escapeHtml(markdownText || '');
        escaped = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');
        escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        escaped = escaped.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        return escaped;
      }

      function renderPreviewMarkdownBlock(markdownBlock) {
        var raw = String(markdownBlock || '').trim();
        if (!raw) {
          return '<p class="event-preview-popover__empty">No preview content in note body.</p>';
        }

        var lines = raw.split(/\r?\n/);
        var isCallout = lines.length > 0 && /^\s*>/.test(lines[0]);
        if (!isCallout) {
          var plain = renderSimpleMarkdownText(raw).replace(/\r?\n/g, '<br />');
          return '<p>' + plain + '</p>';
        }

        var unwrapped = lines.map(function(line) {
          return String(line || '').replace(/^\s*>\s?/, '');
        });
        var firstLine = String(unwrapped[0] || '').trim();
        var match = firstLine.match(/^\[!([A-Za-z0-9_-]+)\][+-]?\s*(.*)$/);
        var label = 'Note';
        var contentLines = unwrapped;
        if (match) {
          label = String(match[2] || '').trim() || String(match[1] || 'Note');
          contentLines = unwrapped.slice(1);
        }
        var content = renderSimpleMarkdownText(contentLines.join('\n').trim()).replace(/\r?\n/g, '<br />');
        if (!content) {
          content = '<span class="event-preview-popover__empty">No callout body.</span>';
        }
        return (
          '<div class="event-preview-callout">' +
          '<div class="event-preview-callout__label">' +
          escapeHtml(label) +
          '</div>' +
          '<p class="event-preview-callout__text">' +
          content +
          '</p>' +
          '</div>'
        );
      }

      function renderGoogleEventPreviewBlock(event) {
        var props = event && event.extendedProps ? event.extendedProps : {};
        var description = String(props.googleDescription || '').trim();
        var location = String(props.googleLocation || '').trim();
        var calendarLabel = String(props.googleCalendarSummary || props.googleCalendarId || '').trim();
        var parts = [];

        if (description) {
          parts.push('<p>' + renderSimpleMarkdownText(description).replace(/\r?\n/g, '<br />') + '</p>');
        } else {
          parts.push('<p class="event-preview-popover__empty">No description provided.</p>');
        }

        if (location) {
          parts.push('<p><strong>Location:</strong> ' + escapeHtml(location) + '</p>');
        }

        if (calendarLabel) {
          parts.push('<p><strong>Calendar:</strong> ' + escapeHtml(calendarLabel) + '</p>');
        }

        return parts.join('');
      }

      async function fetchEventPreview(sourcePath) {
        if (!isHttpContext()) {
          throw new Error('Calendar is not running on http(s). Open the preview server URL.');
        }
        var previewUrl = new URL('/api/events/preview', CALENDAR_API_BASE);
        previewUrl.searchParams.set('sourcePath', String(sourcePath || '').trim());
        var response = await fetch(previewUrl.toString(), { method: 'GET' });
        if (!response.ok) {
          var text = await response.text();
          throw new Error(text || 'Could not load event preview');
        }
        return response.json();
      }

      async function showEventPreviewPopover(event, anchorPoint) {
        var popover = document.getElementById('event-preview-popover');
        var closeButton = document.getElementById('event-preview-close');
        var titleNode = document.getElementById('event-preview-title');
        var dateNode = document.getElementById('event-preview-date');
        var bodyNode = document.getElementById('event-preview-body');
        var openMapButton = document.getElementById('event-preview-open-map');
        var openNoteButton = document.getElementById('event-preview-open-note');
        var defaultOpenButtonLabel = 'Open note in new tab';
        if (!popover || !closeButton || !titleNode || !dateNode || !bodyNode || !openNoteButton) {
          await openEventNote(event);
          return;
        }

        closeEventPreviewPopover();
        var closed = false;
        function cleanup() {
          if (closed) return;
          closed = true;
          popover.classList.remove('is-open');
          popover.setAttribute('aria-hidden', 'true');
          popover.style.left = '';
          popover.style.top = '';
          closeButton.removeEventListener('click', onClose);
          if (openMapButton) {
            openMapButton.removeEventListener('click', onOpenMap);
          }
          openNoteButton.removeEventListener('click', onOpenNote);
          openNoteButton.removeEventListener('click', onOpenExternalLink);
          document.removeEventListener('mousedown', onOutsidePointer);
          document.removeEventListener('keydown', onKeyDown);
          if (closeActiveEventPreview === cleanup) {
            closeActiveEventPreview = null;
          }
        }
        function onClose() {
          cleanup();
        }
        function onOutsidePointer(pointerEvent) {
          if (popover.contains(pointerEvent.target)) return;
          cleanup();
        }
        function onKeyDown(keyEvent) {
          if (keyEvent.key === 'Escape') {
            keyEvent.preventDefault();
            cleanup();
          }
        }
        async function onOpenExternalLink() {
          var externalLink = String(event && event.extendedProps && event.extendedProps.googleHtmlLink || '').trim();
          if (!externalLink) return;
          window.open(externalLink, '_blank', 'noopener,noreferrer');
          cleanup();
        }
        async function onOpenNote() {
          try {
            await openEventNote(event);
            cleanup();
          } catch (error) {
            alert('Open note failed: ' + error.message);
          }
        }
        async function onOpenMap() {
          cleanup();
          try {
            await openEventMap(event, eventCoordinates);
          } catch (error) {
            alert('Open map failed: ' + error.message);
          }
        }

        titleNode.textContent = String(event && event.title || 'Event');
        dateNode.textContent = formatEventDateForPreview(event);
        bodyNode.innerHTML = '<p class="event-preview-popover__loading">Loading preview...</p>';
        openNoteButton.disabled = false;
        openNoteButton.textContent = defaultOpenButtonLabel;
        var eventCoordinates = getEventCoordinates(event);
        if (openMapButton) {
          openMapButton.hidden = !eventCoordinates;
          openMapButton.disabled = !eventCoordinates;
        }

        popover.classList.add('is-open');
        popover.setAttribute('aria-hidden', 'false');
        placeEventPreviewPopover(popover, anchorPoint || null);
        closeButton.addEventListener('click', onClose);
        if (openMapButton) {
          openMapButton.addEventListener('click', onOpenMap);
        }
        var isGoogleEvent = isExternalReadOnlyEvent(event);
        var hasGoogleLink = Boolean(String(event && event.extendedProps && event.extendedProps.googleHtmlLink || '').trim());
        if (isGoogleEvent) {
          openNoteButton.textContent = 'Open event in new tab';
          openNoteButton.disabled = !hasGoogleLink;
          openNoteButton.addEventListener('click', onOpenExternalLink);
        } else {
          openNoteButton.addEventListener('click', onOpenNote);
        }
        document.addEventListener('mousedown', onOutsidePointer);
        document.addEventListener('keydown', onKeyDown);
        closeActiveEventPreview = cleanup;

        if (isGoogleEvent) {
          bodyNode.innerHTML = renderGoogleEventPreviewBlock(event);
          placeEventPreviewPopover(popover, anchorPoint || null);
          return;
        }

        var sourcePath = String(event && event.extendedProps && event.extendedProps.sourcePath || '').trim();
        if (!sourcePath) {
          bodyNode.innerHTML = '<p class="event-preview-popover__error">No source note path available.</p>';
          openNoteButton.disabled = true;
          placeEventPreviewPopover(popover, anchorPoint || null);
          return;
        }

        try {
          var payload = await fetchEventPreview(sourcePath);
          if (closed) return;
          if (payload && payload.title) {
            titleNode.textContent = String(payload.title);
          }
          bodyNode.innerHTML = renderPreviewMarkdownBlock(payload && payload.previewMarkdown || '');
          placeEventPreviewPopover(popover, anchorPoint || null);
        } catch (error) {
          if (closed) return;
          bodyNode.innerHTML = '<p class="event-preview-popover__error">' + escapeHtml(error.message) + '</p>';
          placeEventPreviewPopover(popover, anchorPoint || null);
        }
      }

      function showDayActionDialog(anchorPoint) {
        return new Promise(function(resolve) {
          var modal = document.getElementById('day-action-modal');
          var focusBtn = document.getElementById('day-action-focus');
          var createBtn = document.getElementById('day-action-create');
          if (!modal || !focusBtn || !createBtn) {
            resolve(null);
            return;
          }

          var done = false;

          function cleanup() {
            modal.classList.remove('is-open');
            modal.setAttribute('aria-hidden', 'true');
            modal.style.left = '';
            modal.style.top = '';
            focusBtn.removeEventListener('click', onFocus);
            createBtn.removeEventListener('click', onCreate);
            document.removeEventListener('mousedown', onOutsidePointer);
            document.removeEventListener('keydown', onKeyDown);
          }

          function finish(value) {
            if (done) return;
            done = true;
            cleanup();
            resolve(value);
          }

          function onFocus() { finish('focus'); }
          function onCreate() { finish('create'); }
          function onOutsidePointer(event) {
            if (modal.contains(event.target)) return;
            finish(null);
          }
          function onKeyDown(event) {
            if (event.key === 'Escape') {
              event.preventDefault();
              finish(null);
            }
          }

          modal.classList.add('is-open');
          modal.setAttribute('aria-hidden', 'false');
          placeDayActionMenu(modal, anchorPoint || null);
          focusBtn.addEventListener('click', onFocus);
          createBtn.addEventListener('click', onCreate);
          document.addEventListener('mousedown', onOutsidePointer);
          document.addEventListener('keydown', onKeyDown);
          setTimeout(function() { focusBtn.focus(); }, 0);
        });
      }

      function shiftIsoDate(isoDate, deltaDays) {
        if (!isoDate) return null;
        var parts = isoDate.split('-').map(Number);
        var utcDate = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
        utcDate.setUTCDate(utcDate.getUTCDate() + deltaDays);
        return utcDate.toISOString().slice(0, 10);
      }

      function toInclusiveEndDate(exclusiveEndDate) {
        return shiftIsoDate(exclusiveEndDate, -1);
      }

      function isIsoDateOnly(value) {
        return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
      }

      function normalizeCalendarDateLike(value) {
        var raw = String(value || '').trim();
        if (!raw) return '';
        return raw.replace(' ', 'T');
      }

      function localIsoDateKey(date) {
        if (!(date instanceof Date)) return '';
        var y = date.getFullYear();
        var m = String(date.getMonth() + 1).padStart(2, '0');
        var d = String(date.getDate()).padStart(2, '0');
        return y + '-' + m + '-' + d;
      }

      function allowRecurringTimedEdit(dropInfo, draggedEvent) {
        if (!draggedEvent || draggedEvent.allDay) return true;
        var props = draggedEvent.extendedProps || {};
        if (!props.isRecurring || props.isRecurringOverride) return true;

        var originalStartDay = localIsoDateKey(draggedEvent.start);
        var originalEndDay = localIsoDateKey(draggedEvent.end || draggedEvent.start);
        var nextStartDay = localIsoDateKey(dropInfo && dropInfo.start ? dropInfo.start : null);
        var nextEndDay = localIsoDateKey(dropInfo && dropInfo.end ? dropInfo.end : (dropInfo && dropInfo.start ? dropInfo.start : null));

        if (!originalStartDay || !nextStartDay) return false;
        if (originalStartDay !== nextStartDay) return false;
        if (originalEndDay && nextEndDay && originalEndDay !== nextEndDay) return false;
        return true;
      }

      function toEventPersistPayload(event) {
        if (event && event.allDay) {
          var startDate = normalizeCalendarDateLike(event.startStr);
          var endDate = event.endStr ? shiftIsoDate(normalizeCalendarDateLike(event.endStr), -1) : startDate;
          return { start: startDate, end: endDate, allDay: true };
        }

        var start = normalizeCalendarDateLike(event && event.startStr ? event.startStr : '');
        var end = normalizeCalendarDateLike(event && event.endStr ? event.endStr : '') || start;
        return { start: start, end: end, allDay: false };
      }

      function toCreatePayload(start, end, allDay) {
        var normalizedStart = normalizeCalendarDateLike(start);
        var normalizedEnd = normalizeCalendarDateLike(end) || normalizedStart;
        if (allDay) {
          var allDayStart = isIsoDateOnly(normalizedStart) ? normalizedStart : normalizeIsoDate(normalizedStart);
          var allDayEnd = isIsoDateOnly(normalizedEnd) ? normalizedEnd : normalizeIsoDate(normalizedEnd);
          return { start: allDayStart || normalizedStart, end: allDayEnd || normalizedEnd, allDay: true };
        }
        return { start: normalizedStart, end: normalizedEnd, allDay: false };
      }

      async function saveEventDates(event) {
        var sourcePath = event.extendedProps && event.extendedProps.sourcePath;
        if (!sourcePath) throw new Error('Missing sourcePath for event');
        if (!isHttpContext()) {
          throw new Error('Calendar is not running on http(s). Open the preview server URL.');
        }

        var schedule = toEventPersistPayload(event);
        var eventProps = event.extendedProps || {};
        var recurringSeriesEdit = Boolean(eventProps.isRecurring && !eventProps.isRecurringOverride && !event.allDay);
        var updateUrl = new URL('/api/events/update-dates', CALENDAR_API_BASE).toString();
        var response = await fetch(updateUrl, {
          method: 'POST',
          headers: mutationHeaders(),
          body: JSON.stringify({
            sourcePath: sourcePath,
            start: schedule.start,
            end: schedule.end,
            allDay: schedule.allDay,
            recurringSeriesEdit: recurringSeriesEdit
          })
        });

        if (!response.ok) {
          var text = await response.text();
          throw new Error((text || 'Could not save event') + ' (path: ' + sourcePath + ')');
        }
      }

      async function openEventNote(event) {
        var sourcePath = event.extendedProps && event.extendedProps.sourcePath;
        if (!sourcePath) throw new Error('Missing sourcePath for event');
        if (!isHttpContext()) {
          throw new Error('Calendar is not running on http(s). Open the preview server URL.');
        }

        var openUrl = new URL('/api/events/open-note', CALENDAR_API_BASE).toString();
        var response = await fetch(openUrl, {
          method: 'POST',
          headers: mutationHeaders(),
          body: JSON.stringify({ sourcePath: sourcePath })
        });

        if (!response.ok) {
          var text = await response.text();
          throw new Error((text || 'Could not open note') + ' (path: ' + sourcePath + ')');
        }
      }

      async function openEventMap(event, coordinates) {
        if (!isHttpContext()) {
          throw new Error('Calendar is not running on http(s). Open the preview server URL.');
        }

        var mapUrl = new URL('/api/events/open-map', CALENDAR_API_BASE).toString();
        var sourcePath = String(event && event.extendedProps && event.extendedProps.sourcePath || '').trim();
        var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        var timeoutId = 0;
        try {
          if (controller) {
            timeoutId = window.setTimeout(function() {
              try { controller.abort(); } catch (error) { /* noop */ }
            }, 10000);
          }

          var response = await fetch(mapUrl, {
            method: 'POST',
            headers: mutationHeaders(),
            signal: controller ? controller.signal : undefined,
            body: JSON.stringify({
              sourcePath: sourcePath,
              coordinates: coordinates && Number.isFinite(coordinates.lat) && Number.isFinite(coordinates.lng)
                ? { lat: coordinates.lat, lng: coordinates.lng }
                : null
            })
          });

          if (!response.ok) {
            var text = await response.text();
            throw new Error(text || 'Could not open map view');
          }
        } catch (error) {
          if (error && error.name === 'AbortError') {
            throw new Error('Map request timed out. Please try again.');
          }
          throw error;
        } finally {
          if (timeoutId) {
            window.clearTimeout(timeoutId);
          }
        }
      }

      async function createEvent(title, start, end, allDay) {
        if (!isHttpContext()) {
          throw new Error('Calendar is not running on http(s). Open the preview server URL.');
        }

        var schedule = toCreatePayload(start, end, allDay);
        var createUrl = new URL('/api/events/create', CALENDAR_API_BASE).toString();
        var response = await fetch(createUrl, {
          method: 'POST',
          headers: mutationHeaders(),
          body: JSON.stringify({
            title: title,
            start: schedule.start,
            end: schedule.end,
            allDay: schedule.allDay
          })
        });

        if (!response.ok) {
          var text = await response.text();
          throw new Error(text || 'Could not create event');
        }

        return response.json();
      }

      async function rebuildEventsAndReload(payload) {
        if (!isHttpContext()) {
          throw new Error('Calendar is not running on http(s). Open the preview server URL.');
        }

        var rebuildUrl = new URL('/api/events/rebuild', CALENDAR_API_BASE).toString();
        var response = await fetch(rebuildUrl, {
          method: 'POST',
          headers: mutationHeaders(),
          body: JSON.stringify(payload || {})
        });
        if (!response.ok) {
          var text = await response.text();
          throw new Error(text || 'Could not rebuild events');
        }
        window.location.reload();
      }

      async function fetchCalendarFilters() {
        var filtersUrl = new URL('/api/calendar/filters', CALENDAR_API_BASE).toString();
        var response = await fetch(filtersUrl, { method: 'GET' });
        if (!response.ok) {
          var text = await response.text();
          throw new Error(text || 'Could not load calendar filters');
        }
        return response.json();
      }

      async function fetchGoogleCalendarConfig() {
        var configUrl = new URL('/api/google-calendar/config', CALENDAR_API_BASE).toString();
        var response = await fetch(configUrl, { method: 'GET' });
        if (!response.ok) {
          var text = await response.text();
          throw new Error(text || 'Could not load Google Calendar config');
        }
        return response.json();
      }

      async function fetchGoogleCalendarEvents(start, end) {
        var eventsUrl = new URL('/api/google-calendar/events', CALENDAR_API_BASE);
        eventsUrl.searchParams.set('start', String(start || ''));
        eventsUrl.searchParams.set('end', String(end || ''));
        var response = await fetch(eventsUrl.toString(), { method: 'GET' });
        if (!response.ok) {
          var text = await response.text();
          throw new Error(text || 'Could not load Google Calendar events');
        }
        var payload = await response.json();
        return payload && Array.isArray(payload.events) ? payload.events : [];
      }

      async function fetchCalendarSessionToken() {
        var sessionUrl = new URL('/api/session', CALENDAR_API_BASE).toString();
        var response = await fetch(sessionUrl, { method: 'GET' });
        if (!response.ok) {
          var text = await response.text();
          throw new Error(text || 'Could not initialize calendar session');
        }
        var payload = await response.json();
        var token = payload && payload.token ? String(payload.token).trim() : '';
        if (!token) {
          throw new Error('Session token missing from server response');
        }
        return token;
      }

      function mutationHeaders() {
        if (!calendarApiToken) {
          throw new Error('Missing session token. Reload the calendar page.');
        }
        return {
          'Content-Type': 'application/json',
          'X-Calendar-Token': calendarApiToken
        };
      }

      function createFilterSelect(meta) {
        var wrap = document.createElement('span');
        wrap.className = 'calendar-filter-wrap';

        var select = document.createElement('select');
        select.className = 'calendar-filter-select';
        select.setAttribute('aria-label', 'Calendar filter');

        var filters = (meta && meta.filters) || [];
        var currentPath = meta && meta.current && meta.current.path ? meta.current.path : '';
        var currentView = meta && meta.current && meta.current.view ? meta.current.view : 'Tabelle';

        filters.forEach(function(filter) {
          var option = document.createElement('option');
          option.value = String(filter.path || '');
          option.textContent = String(filter.title || filter.path || 'Unnamed Base');
          option.dataset.baseView = String(filter.view || 'Tabelle');
          if (option.value === currentPath && option.dataset.baseView === currentView) {
            option.selected = true;
          }
          select.appendChild(option);
        });

        wrap.appendChild(select);
        return { wrap: wrap, select: select };
      }

      async function mountFilterDropdown(calendarEl) {
        try {
          var meta = await fetchCalendarFilters();
          if (!meta || !meta.filters || !meta.filters.length) return;

          var leftToolbarChunk = calendarEl.closest('body').querySelector('.fc-header-toolbar .fc-toolbar-chunk');
          if (!leftToolbarChunk) return;

          var controls = createFilterSelect(meta);
          var refreshButton = calendarEl.closest('body').querySelector('.fc-refreshCalendar-button');
          if (refreshButton && refreshButton.parentElement) {
            refreshButton.insertAdjacentElement('afterend', controls.wrap);
          } else {
            leftToolbarChunk.appendChild(controls.wrap);
          }

          controls.select.addEventListener('change', async function(event) {
            var selectedOption = event.target.options[event.target.selectedIndex];
            var basePath = selectedOption ? selectedOption.value : '';
            var baseView = selectedOption ? selectedOption.dataset.baseView : 'Tabelle';
            if (!basePath) return;

            controls.select.disabled = true;
            try {
              await rebuildEventsAndReload({ basePath: basePath, baseView: baseView });
            } catch (error) {
              alert('Filter change failed: ' + error.message);
              controls.select.disabled = false;
            }
          });
        } catch (error) {
          console.warn('Could not mount filter dropdown:', error.message);
        }
      }

      async function onEventDateChange(info) {
        if (isExternalReadOnlyEvent(info.event)) {
          info.revert();
          return;
        }
        try {
          await saveEventDates(info.event);
        } catch (error) {
          info.revert();
          alert('Saving failed: ' + error.message);
        }
      }

      async function onEventClick(info) {
        if (isExternalReadOnlyEvent(info.event)) {
          try {
            var externalAnchor = getAnchorPointFromNativeEvent(info.jsEvent);
            await showEventPreviewPopover(info.event, externalAnchor);
          } catch (error) {
            alert('Event preview failed: ' + error.message);
          }
          return;
        }

        if (calendarUiSettings.showEventPreviewOnClick === false) {
          try {
            await openEventNote(info.event);
          } catch (error) {
            alert('Open note failed: ' + error.message);
          }
          return;
        }

        try {
          var anchor = getAnchorPointFromNativeEvent(info.jsEvent);
          await showEventPreviewPopover(info.event, anchor);
        } catch (error) {
          alert('Event preview failed: ' + error.message);
        }
      }

      async function createEventForDates(calendar, start, end, allDay) {
        if (isCreateFlowActive) return;
        isCreateFlowActive = true;
        var title = await showCreateEventDialog();
        try {
          if (title == null) return;
          var trimmedTitle = title.trim();
          if (!trimmedTitle) {
            return;
          }

          var result = await createEvent(trimmedTitle, start, end, allDay);
          if (result && result.event) {
            calendar.addEvent(result.event);
          }
        } catch (error) {
          alert('Create event failed: ' + error.message);
        } finally {
          isCreateFlowActive = false;
        }
      }

      async function onDateSelect(info) {
        closeEventPreviewPopover();
        info.view.calendar.unselect();
        if (isDayActionFlowActive) return;
        if (!info) return;

        var viewType = info && info.view && info.view.type ? String(info.view.type) : '';
        if (viewType === 'timeGridDay' || viewType === 'timeGridWeek') {
          var timedAllDay = Boolean(info.allDay);
          var timedStart = info.startStr;
          var timedEnd = info.endStr || info.startStr;
          if (timedAllDay && info.endStr) {
            timedEnd = toInclusiveEndDate(info.endStr);
          }
          await createEventForDates(info.view.calendar, timedStart, timedEnd, timedAllDay);
          return;
        }

        if (!info.allDay) return;

        var startDate = normalizeIsoDate(info.startStr);
        if (!startDate) return;
        var endDate = startDate;
        if (info.endStr) {
          var inclusive = toInclusiveEndDate(info.endStr);
          endDate = normalizeIsoDate(inclusive) || startDate;
        }

        isDayActionFlowActive = true;
        try {
          if (startDate !== endDate) {
            await createEventForDates(info.view.calendar, startDate, endDate, true);
            return;
          }
          var selectAnchor = getAnchorPointFromNativeEvent(info.jsEvent);
          var action = await showDayActionDialog(selectAnchor);
          if (action === 'focus') {
            setFocusedDate(info.view.calendar, document.getElementById('calendar'), startDate, { jumpToFocus: false });
          } else if (action === 'create') {
            await createEventForDates(info.view.calendar, startDate, endDate, true);
          }
        } finally {
          isDayActionFlowActive = false;
        }
      }

      async function onDateClick(info) {
        closeEventPreviewPopover();
        var viewType = info && info.view && info.view.type ? String(info.view.type) : '';
        if (viewType === 'timeGridDay' || viewType === 'timeGridWeek') {
          var timedDate = info && info.dateStr ? String(info.dateStr) : '';
          if (!timedDate) return;
          await createEventForDates(info.view.calendar, timedDate, timedDate, false);
          return;
        }

        if (!info.allDay) return;
        if (isDayActionFlowActive) return;
        var dateStr = normalizeIsoDate(info.dateStr);
        if (!dateStr) return;

        isDayActionFlowActive = true;
        try {
          var clickAnchor = getAnchorPointFromNativeEvent(info.jsEvent);
          var action = await showDayActionDialog(clickAnchor);
          if (action === 'focus') {
            setFocusedDate(info.view.calendar, document.getElementById('calendar'), dateStr, { jumpToFocus: false });
          } else if (action === 'create') {
            await createEventForDates(info.view.calendar, dateStr, dateStr, true);
          }
        } finally {
          isDayActionFlowActive = false;
        }
      }

      function isExternalReadOnlyEvent(event) {
        var source = String(event && event.extendedProps && event.extendedProps.externalSource || '').toLowerCase();
        return source === 'google';
      }

      function createGoogleEventSource() {
        return {
          id: 'google',
          editable: false,
          events: function(fetchInfo, successCallback, failureCallback) {
            fetchGoogleCalendarEvents(fetchInfo && fetchInfo.startStr, fetchInfo && fetchInfo.endStr)
              .then(function(events) {
                if (window.googleCalendarState) {
                  window.googleCalendarState.lastError = '';
                }
                successCallback(events);
              })
              .catch(function(error) {
                if (window.googleCalendarState) {
                  window.googleCalendarState.lastError = String(error && error.message || error || 'Unknown error');
                }
                console.warn('Google Calendar fetch failed:', error && error.message ? error.message : error);
                failureCallback(error);
              });
          }
        };
      }

      function setGoogleEventsEnabled(calendar, enabled) {
        if (!calendar || !window.googleCalendarState || !window.googleCalendarState.configured) return;
        var source = calendar.getEventSourceById('google');
        if (enabled) {
          if (!source) {
            calendar.addEventSource(createGoogleEventSource());
          } else {
            source.refetch();
          }
          window.googleCalendarState.enabled = true;
        } else {
          if (source) {
            source.remove();
          }
          window.googleCalendarState.enabled = false;
          window.googleCalendarState.lastError = '';
        }
      }
      window.setGoogleEventsEnabled = setGoogleEventsEnabled;

      document.addEventListener('DOMContentLoaded', async function() {
        await applyCalendarTheme();
        var calendarEl = document.getElementById('calendar');
        var calendarEvents = window.CALENDAR_EVENTS || [];
        var vacationDays = buildVacationDaySet(calendarEvents);
        window.googleCalendarState = {
          configured: false,
          enabled: false,
          lastError: ''
        };

        if (isHttpContext()) {
          try {
            calendarApiToken = await fetchCalendarSessionToken();
          } catch (error) {
            console.warn('Could not initialize calendar API session:', error.message);
            calendarApiToken = '';
          }
        }

        if (isHttpContext()) {
          try {
            var googleConfig = await fetchGoogleCalendarConfig();
            window.googleCalendarState.configured = Boolean(googleConfig && googleConfig.enabled);
          } catch (error) {
            console.warn('Could not load Google Calendar config:', error.message);
            window.googleCalendarState.configured = false;
            window.googleCalendarState.lastError = String(error && error.message || error || 'Unknown error');
          }
        }
        var eventSources = [{ id: 'local', events: calendarEvents }];
        var multiMonthMinWidth = Number(calendarUiSettings.multiMonthMinWidth || 300);
        var lastViewType = '';
        var isApplyingFocusOnViewChange = false;
        var calendar = new FullCalendar.Calendar(calendarEl, {
          initialView: 'multiMonthYear',
          height: '100%',
          multiMonthMinWidth: multiMonthMinWidth,
          firstDay: 1,
          fixedWeekCount: false,
          dayMaxEvents: false,
          dayMaxEventRows: false,
          customButtons: {
            refreshCalendar: {
              text: 'Refresh',
              click: async function() {
                var buttonEl = calendarEl.closest('body').querySelector('.fc-refreshCalendar-button');
                if (!buttonEl || buttonEl.disabled) return;
                buttonEl.disabled = true;
                buttonEl.textContent = 'Refreshing...';
                try {
                  await rebuildEventsAndReload();
                } catch (error) {
                  alert('Refresh failed: ' + error.message);
                  buttonEl.disabled = false;
                  buttonEl.textContent = 'Refresh';
                }
              }
            },
            focusToday: {
              text: 'Today',
              click: function() {
                focusCalendarOnToday(calendar, calendarEl);
              }
            },
            printCalendar: {
              text: '',
              hint: 'Print or save current view as PDF',
              click: function() {
                calendar.updateSize();
                setTimeout(function() {
                  window.print();
                }, 0);
              }
            },
            calendarSettings: {
              text: '',
              hint: 'Calendar settings',
              click: function() {
                if (typeof window.toggleCalendarSettings === 'function') {
                  window.toggleCalendarSettings();
                }
              }
            }
          },
          headerToolbar: {
            left: 'prev,next focusToday refreshCalendar printCalendar calendarSettings',
            center: 'title',
            right: 'timeGridDay,timeGridWeek,dayGridMonth,multiMonthYear'
          },
          views: {
            timeGridDay: {
              dayMaxEvents: false,
              dayMaxEventRows: false
            },
            timeGridWeek: {
              dayMaxEvents: false,
              dayMaxEventRows: false
            },
            dayGridMonth: {
              dayMaxEvents: false,
              dayMaxEventRows: false,
              eventDisplay: 'block'
            },
            dayGridWeek: {
              dayMaxEvents: false,
              dayMaxEventRows: false
            },
            multiMonthYear: {
              dayMaxEvents: false,
              dayMaxEventRows: false,
              eventDisplay: 'block'
            }
          },
          editable: true,
          selectable: true,
          selectMinDistance: 0,
          eventSources: eventSources,
          eventClassNames: eventClassNamesHook,
          eventContent: eventContentHook,
          eventDidMount: eventDidMountHook,
          dayCellClassNames: function(arg) {
            return dayCellClassNamesHook(vacationDays, arg);
          },
          dayHeaderClassNames: dayHeaderClassNamesHook,
          eventClick: onEventClick,
          dateClick: onDateClick,
          select: onDateSelect,
          eventAllow: allowRecurringTimedEdit,
          eventDrop: onEventDateChange,
          eventResize: onEventDateChange,
          datesSet: function(arg) {
            var currentViewType = arg && arg.view && arg.view.type ? String(arg.view.type) : '';
            var viewChanged = Boolean(lastViewType) && currentViewType !== lastViewType;
            if (viewChanged && focusedDate && !isApplyingFocusOnViewChange) {
              var currentAnchor = toLocalIsoDate(arg && arg.view ? arg.view.currentStart : null);
              if (currentAnchor !== focusedDate) {
                isApplyingFocusOnViewChange = true;
                lastViewType = currentViewType;
                calendar.gotoDate(focusedDate);
                isApplyingFocusOnViewChange = false;
                updateFocusedDateDecorations(calendarEl);
                return;
              }
            }
            lastViewType = currentViewType;
            updateFocusedDateDecorations(calendarEl);
          }
        });
        calendar.render();
        updateFocusedDateDecorations(calendarEl);
        if (window.googleCalendarState.configured && calendarUiSettings.showGoogleEvents === true) {
          setGoogleEventsEnabled(calendar, true);
        }
        window.addEventListener('beforeprint', function() {
          document.body.setAttribute('data-print-view', calendar.view && calendar.view.type ? calendar.view.type : '');
          calendar.setOption('height', 'auto');
          calendar.updateSize();
        });
        window.addEventListener('afterprint', function() {
          document.body.removeAttribute('data-print-view');
          calendar.setOption('height', '100%');
          calendar.updateSize();
        });
        mountFilterDropdown(calendarEl);
        mountCalendarSettingsPopover(calendarEl, calendar);

      });

