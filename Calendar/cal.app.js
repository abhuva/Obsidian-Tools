      var CALENDAR_API_BASE = window.CALENDAR_API_BASE || window.location.origin;
      var THEME_CACHE_KEY = 'calendar-theme-bootstrap-v1';
      var CALENDAR_UI_SETTINGS_KEY = 'calendar-ui-settings-v1';
      var CALENDAR_FOCUS_DATE_KEY = 'calendar-focus-date-v1';
      var MONTH_WIDTH_PERCENT_MIN = 20;
      var MONTH_WIDTH_PERCENT_MAX = 50;
      var TIMEGRID_ROW_HEIGHT_MIN = 16;
      var TIMEGRID_ROW_HEIGHT_MAX = 48;
      var calendarApiToken = '';
      var ROUNDNESS_MIN = 0;
      var ROUNDNESS_MAX = 24;
      var isCreateFlowActive = false;
      var isDayActionFlowActive = false;
      var closeActiveEventPreview = null;
      var focusedDate = loadFocusedDate();
      var calendarUiSettings = loadCalendarUiSettings();
      applyGlobalRoundness(calendarUiSettings.roundness);
      applyTimeGridRowHeight(calendarUiSettings.timeGridRowHeight);

      /**
       * Is Http Context.
       * @returns {*} Returns whether the condition is met.
       */
      function isHttpContext() {
        return window.location.protocol === 'http:' || window.location.protocol === 'https:';
      }

      /**
       * Load Calendar Ui Settings.
       * @returns {*} Returns calendar ui settings.
       */
      function loadCalendarUiSettings() {
        var defaults = {
          showSocietyBadges: true,
          showRecurringBadge: true,
          showGoogleEvents: false,
          createGoogleEvents: false,
          showNextcloudEvents: false,
          createNextcloudEvents: false,
          nextcloudDisabledCalendars: {},
          showEventPreviewOnClick: true,
          showVacationTexture: true,
          multiMonthMinWidth: 30,
          roundness: 8,
          timeGridRowHeight: 26
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
          if (safeWidth < MONTH_WIDTH_PERCENT_MIN || safeWidth > MONTH_WIDTH_PERCENT_MAX) {
            safeWidth = defaults.multiMonthMinWidth;
          }
          var parsedRoundness = Number(parsed.roundness);
          var safeRoundness = Number.isFinite(parsedRoundness) ? Math.round(parsedRoundness) : defaults.roundness;
          if (safeRoundness < ROUNDNESS_MIN) safeRoundness = ROUNDNESS_MIN;
          if (safeRoundness > ROUNDNESS_MAX) safeRoundness = ROUNDNESS_MAX;
          var parsedRowHeight = Number(parsed.timeGridRowHeight);
          var safeRowHeight = Number.isFinite(parsedRowHeight) ? Math.round(parsedRowHeight) : defaults.timeGridRowHeight;
          if (safeRowHeight < TIMEGRID_ROW_HEIGHT_MIN) safeRowHeight = TIMEGRID_ROW_HEIGHT_MIN;
          if (safeRowHeight > TIMEGRID_ROW_HEIGHT_MAX) safeRowHeight = TIMEGRID_ROW_HEIGHT_MAX;
          return {
            showSocietyBadges: parsed.showSocietyBadges !== false,
            showRecurringBadge: parsed.showRecurringBadge !== false,
            showGoogleEvents: parsed.showGoogleEvents === true,
            createGoogleEvents: parsed.createGoogleEvents === true,
            showNextcloudEvents: parsed.showNextcloudEvents === true,
            createNextcloudEvents: parsed.createNextcloudEvents === true,
            nextcloudDisabledCalendars: parsed.nextcloudDisabledCalendars && typeof parsed.nextcloudDisabledCalendars === 'object'
              ? parsed.nextcloudDisabledCalendars
              : {},
            showEventPreviewOnClick: parsed.showEventPreviewOnClick !== false,
            showVacationTexture: parsed.showVacationTexture !== false,
            multiMonthMinWidth: safeWidth,
            roundness: safeRoundness,
            timeGridRowHeight: safeRowHeight
          };
        } catch (error) {
          return defaults;
        }
      }

      /**
       * Load Focused Date.
       * @returns {*} Returns focused date.
       */
      function loadFocusedDate() {
        var raw = '';
        try {
          raw = String(localStorage.getItem(CALENDAR_FOCUS_DATE_KEY) || '').trim();
        } catch (error) {
          return '';
        }
        return normalizeIsoDate(raw);
      }

      /**
       * Persist Focused Date.
       * @param {*}
       * @returns {*} Returns the function result.
       */
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

      /**
       * Apply Global Roundness.
       * @param {*}
       * @returns {*} Returns the function result.
       */
      function applyGlobalRoundness(roundness) {
        var parsed = Number(roundness);
        var safe = Number.isFinite(parsed) ? Math.round(parsed) : 8;
        if (safe < ROUNDNESS_MIN) safe = ROUNDNESS_MIN;
        if (safe > ROUNDNESS_MAX) safe = ROUNDNESS_MAX;
        document.documentElement.style.setProperty('--cal-radius', String(safe) + 'px');
      }

      /**
       * Apply Time Grid Row Height.
       * @param {*}
       * @returns {*} Returns the function result.
       */
      function applyTimeGridRowHeight(rowHeightPx) {
        var parsed = Number(rowHeightPx);
        var safe = Number.isFinite(parsed) ? Math.round(parsed) : 26;
        if (safe < TIMEGRID_ROW_HEIGHT_MIN) safe = TIMEGRID_ROW_HEIGHT_MIN;
        if (safe > TIMEGRID_ROW_HEIGHT_MAX) safe = TIMEGRID_ROW_HEIGHT_MAX;
        var root = document.documentElement;
        root.style.setProperty('--cal-timegrid-slot-height', String(safe) + 'px');
        if (safe <= 22) {
          root.setAttribute('data-timegrid-density', 'compact');
        } else {
          root.setAttribute('data-timegrid-density', 'normal');
        }
      }

      /**
       * Derive Time Grid Event Heights.
       * @param {*}
       * @returns {*} Returns the function result.
       */
      function deriveTimeGridEventHeights(rowHeightPx) {
        var parsed = Number(rowHeightPx);
        var safe = Number.isFinite(parsed) ? Math.round(parsed) : 26;
        if (safe < TIMEGRID_ROW_HEIGHT_MIN) safe = TIMEGRID_ROW_HEIGHT_MIN;
        if (safe > TIMEGRID_ROW_HEIGHT_MAX) safe = TIMEGRID_ROW_HEIGHT_MAX;
        var eventMinHeight = Math.max(8, Math.round(safe * 0.55));
        var eventShortHeight = Math.max(eventMinHeight + 2, Math.round(safe * 0.85));
        return {
          eventMinHeight: eventMinHeight,
          eventShortHeight: eventShortHeight
        };
      }

      /**
       * Persist Calendar Ui Settings.
       * @returns {*} Returns the function result.
       */
      function persistCalendarUiSettings() {
        try {
          localStorage.setItem(CALENDAR_UI_SETTINGS_KEY, JSON.stringify(calendarUiSettings));
        } catch (error) {
          // noop
        }
      }

      /**
       * Current Theme Css Var Snapshot.
       * @returns {*} Returns the function result.
       */
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

      /**
       * Persist Theme Bootstrap Cache.
       * @param {*}
       * @returns {*} Returns the function result.
       */
      function persistThemeBootstrapCache(vars) {
        try {
          localStorage.setItem(THEME_CACHE_KEY, JSON.stringify({ vars: vars || {} }));
        } catch (error) {
          // noop
        }
      }

      /**
       * Apply Mirrored Theme Vars.
       * @param {*}
       * @returns {*} Returns the function result.
       */
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

      /**
       * Fetch Obsidian Theme Snapshot.
       * @returns {*} Returns obsidian theme snapshot.
       */
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

      /**
       * Apply Calendar Theme.
       * @returns {*} Returns the function result.
       */
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

      /**
       * Escape Html.
       * @param {*}
       * @returns {*} Returns the function result.
       */
      function escapeHtml(value) {
        return String(value || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');
      }

      /**
       * Get Event Society.
       * @param {*}
       * @returns {*} Returns event society.
       */
      function getEventSociety(event) {
        var sourcePath = String(event && event.extendedProps && event.extendedProps.sourcePath || '').toUpperCase();
        if (sourcePath.indexOf(' TOHU ') >= 0 || sourcePath.indexOf('/TOHU ') >= 0) return 'tohu';
        if (sourcePath.indexOf(' NICA ') >= 0 || sourcePath.indexOf('/NICA ') >= 0) return 'nica';
        return '';
      }

      /**
       * Normalize Iso Date.
       * @param {*}
       * @returns {*} Returns iso date.
       */
      function normalizeIsoDate(input) {
        if (!input) return '';
        var asString = String(input);
        if (/^\d{4}-\d{2}-\d{2}$/.test(asString)) return asString;
        var match = asString.match(/^(\d{4}-\d{2}-\d{2})/);
        return match && match[1] ? match[1] : '';
      }

      /**
       * Is Nextcloud Calendar Enabled.
       * @param {*}
       * @returns {*} Returns whether the condition is met.
       */
      function isNextcloudCalendarEnabled(calendarId) {
        var id = String(calendarId || '').trim();
        if (!id) return true;
        var disabled = calendarUiSettings && calendarUiSettings.nextcloudDisabledCalendars;
        if (!disabled || typeof disabled !== 'object') return true;
        return disabled[id] !== true;
      }

      /**
       * Filter Nextcloud Events By Visibility.
       * @param {*}
       * @returns {*} Returns the function result.
       */
      function filterNextcloudEventsByVisibility(events) {
        var input = Array.isArray(events) ? events : [];
        return input.filter(function(event) {
          var props = event && event.extendedProps ? event.extendedProps : {};
          var id = String(props.nextcloudCalendarId || '').trim();
          return isNextcloudCalendarEnabled(id);
        });
      }

      /**
       * Apply Vacation Texture Setting.
       * @param {*}
       * @returns {*} Returns the function result.
       */
      function applyVacationTextureSetting(enabled) {
        document.body.setAttribute('data-vacation-texture', enabled ? 'on' : 'off');
      }

      /**
       * Month Width Percent To Px.
       * @param {*}
       * @param {*}
       * @returns {*} Returns the function result.
       */
      function monthWidthPercentToPx(percent, calendarEl) {
        var parsed = Number(percent);
        var safe = Number.isFinite(parsed) ? Math.round(parsed) : 30;
        if (safe < MONTH_WIDTH_PERCENT_MIN) safe = MONTH_WIDTH_PERCENT_MIN;
        if (safe > MONTH_WIDTH_PERCENT_MAX) safe = MONTH_WIDTH_PERCENT_MAX;
        var referenceWidth = calendarEl && calendarEl.clientWidth ? calendarEl.clientWidth : (window.innerWidth || 1200);
        var px = Math.round(referenceWidth * (safe / 100));
        if (px < 120) px = 120;
        return px;
      }

      /**
       * Parse Coordinates Value.
       * @param {*}
       * @returns {*} Returns coordinates value.
       */
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

      /**
       * Get Event Coordinates.
       * @param {*}
       * @returns {*} Returns event coordinates.
       */
      function getEventCoordinates(event) {
        var value = event && event.extendedProps ? event.extendedProps.coordinates : null;
        return parseCoordinatesValue(value);
      }

      /**
       * To Local Iso Date.
       * @param {*}
       * @returns {*} Returns local iso date.
       */
      function toLocalIsoDate(date) {
        if (!(date instanceof Date)) return '';
        var year = date.getFullYear();
        var month = String(date.getMonth() + 1).padStart(2, '0');
        var day = String(date.getDate()).padStart(2, '0');
        return String(year) + '-' + month + '-' + day;
      }

      /**
       * Shift Iso Date Safe.
       * @param {*}
       * @param {*}
       * @returns {*} Returns the function result.
       */
      function shiftIsoDateSafe(isoDate, deltaDays) {
        var normalized = normalizeIsoDate(isoDate);
        if (!normalized) return '';
        return shiftIsoDate(normalized, deltaDays);
      }

      /**
       * Build Vacation Day Set.
       * @param {*}
       * @returns {*} Returns vacation day set.
       */
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

      /**
       * Event Class Names Hook.
       * @param {*}
       * @returns {*} Returns the function result.
       */
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

      /**
       * Event Content Hook.
       * @param {*}
       * @returns {*} Returns the function result.
       */
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

      /**
       * Event Did Mount Hook.
       * @param {*}
       * @returns {*} Returns the function result.
       */
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

      /**
       * Day Cell Class Names Hook.
       * @param {*}
       * @param {*}
       * @returns {*} Returns the function result.
       */
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

      /**
       * Day Header Class Names Hook.
       * @param {*}
       * @returns {*} Returns the function result.
       */
      function dayHeaderClassNamesHook(arg) {
        var classes = [];
        var date = arg && arg.date;
        if (!(date instanceof Date)) return classes;
        var iso = toLocalIsoDate(date);
        if (focusedDate && iso === focusedDate) classes.push('day-focused');
        return classes;
      }

      /**
       * Update Focused Date Decorations.
       * @param {*}
       * @returns {*} Returns the function result.
       */
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

      /**
       * Set Focused Date.
       * @param {*}
       * @param {*}
       * @param {*}
       * @param {*}
       * @returns {*} Returns the function result.
       */
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

      /**
       * Focus Calendar On Today.
       * @param {*}
       * @param {*}
       * @returns {*} Returns the function result.
       */
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

      /**
       * Mount Calendar Settings Popover.
       * @param {*}
       * @param {*}
       * @returns {*} Returns the function result.
       */
      function mountCalendarSettingsPopover(calendarEl, calendar) {
        var panel = document.getElementById('calendar-label-settings');
        var societyToggle = document.getElementById('toggle-society-badges');
        var recurringToggle = document.getElementById('toggle-recurring-badge');
        var googleCreateToggle = document.getElementById('toggle-google-create-events');
        var nextcloudCreateToggle = document.getElementById('toggle-nextcloud-create-events');
        var googleOauthConnect = document.getElementById('google-oauth-connect');
        var googleOauthDisconnect = document.getElementById('google-oauth-disconnect');
        var eventPreviewToggle = document.getElementById('toggle-event-preview');
        var vacationTextureToggle = document.getElementById('toggle-vacation-texture');
        var googleStatus = document.getElementById('setting-google-status');
        var nextcloudStatus = document.getElementById('setting-nextcloud-status');
        var nextcloudCalendarsWrap = document.getElementById('setting-nextcloud-calendars');
        var nextcloudCalendarsList = document.getElementById('setting-nextcloud-calendars-list');
        var monthWidthSlider = document.getElementById('setting-month-width');
        var monthWidthValue = document.getElementById('setting-month-width-value');
        var roundnessSlider = document.getElementById('setting-roundness');
        var roundnessValue = document.getElementById('setting-roundness-value');
        var rowHeightSlider = document.getElementById('setting-timegrid-row-height');
        var rowHeightValue = document.getElementById('setting-timegrid-row-height-value');
        if (!panel || !societyToggle || !recurringToggle || !googleCreateToggle || !nextcloudCreateToggle || !googleOauthConnect || !googleOauthDisconnect || !eventPreviewToggle || !vacationTextureToggle || !googleStatus || !nextcloudStatus || !nextcloudCalendarsWrap || !nextcloudCalendarsList || !monthWidthSlider || !monthWidthValue || !roundnessSlider || !roundnessValue || !rowHeightSlider || !rowHeightValue) return;

        /**
         * Update Google Status Text.
         * @returns {*} Returns the function result.
         */
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
          if (window.googleCalendarState.oauthWritable) {
            googleStatus.textContent = 'Google source active (OAuth write enabled).';
            googleStatus.classList.remove('is-error');
            return;
          }
          if (window.googleCalendarState.oauthConnected) {
            googleStatus.textContent = 'Google source active (OAuth connected, read-only scope).';
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

        /**
         * Update Nextcloud Status Text.
         * @returns {*} Returns the function result.
         */
        function updateNextcloudStatusText() {
          if (window.nextcloudCalendarState && window.nextcloudCalendarState.lastError) {
            nextcloudStatus.textContent = 'Nextcloud load error: ' + window.nextcloudCalendarState.lastError;
            nextcloudStatus.classList.add('is-error');
            return;
          }
          if (!window.nextcloudCalendarState || !window.nextcloudCalendarState.configured) {
            nextcloudStatus.textContent = 'Nextcloud source not configured (.env CalDAV vars missing).';
            nextcloudStatus.classList.remove('is-error');
            return;
          }
          if (window.nextcloudCalendarState.enabled) {
            nextcloudStatus.textContent = 'Nextcloud source active (CalDAV read/write).';
          } else {
            nextcloudStatus.textContent = 'Nextcloud source available (currently disabled).';
          }
          nextcloudStatus.classList.remove('is-error');
        }

        /**
         * Render Nextcloud Calendar Checks.
         * @returns {*} Returns nextcloud calendar checks.
         */
        function renderNextcloudCalendarChecks() {
          var calendars = window.nextcloudCalendarState && Array.isArray(window.nextcloudCalendarState.calendars)
            ? window.nextcloudCalendarState.calendars
            : [];
          nextcloudCalendarsList.innerHTML = '';
          if (!calendars.length) {
            nextcloudCalendarsWrap.hidden = true;
            return;
          }
          nextcloudCalendarsWrap.hidden = false;
          calendars.forEach(function(cal) {
            var id = String(cal && cal.id || '').trim();
            if (!id) return;
            var labelText = String(cal && (cal.slug || cal.id) || id).trim();
            var row = document.createElement('label');
            row.className = 'calendar-settings-popover__check';
            var input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = isNextcloudCalendarEnabled(id);
            input.addEventListener('change', function() {
              if (!calendarUiSettings.nextcloudDisabledCalendars || typeof calendarUiSettings.nextcloudDisabledCalendars !== 'object') {
                calendarUiSettings.nextcloudDisabledCalendars = {};
              }
              if (input.checked) {
                delete calendarUiSettings.nextcloudDisabledCalendars[id];
              } else {
                calendarUiSettings.nextcloudDisabledCalendars[id] = true;
              }
              persistCalendarUiSettings();
              if (typeof window.refreshNextcloudEvents === 'function') {
                window.refreshNextcloudEvents(calendar);
              }
            });
            var text = document.createElement('span');
            text.textContent = labelText;
            row.appendChild(input);
            row.appendChild(text);
            nextcloudCalendarsList.appendChild(row);
          });
        }

        /**
         * Sync Inputs.
         * @returns {*} Returns the function result.
         */
        function syncInputs() {
          societyToggle.checked = calendarUiSettings.showSocietyBadges !== false;
          recurringToggle.checked = calendarUiSettings.showRecurringBadge !== false;
          googleCreateToggle.checked = calendarUiSettings.createGoogleEvents === true;
          nextcloudCreateToggle.checked = calendarUiSettings.createNextcloudEvents === true;
          eventPreviewToggle.checked = calendarUiSettings.showEventPreviewOnClick !== false;
          vacationTextureToggle.checked = calendarUiSettings.showVacationTexture !== false;
          googleCreateToggle.disabled = !(window.googleCalendarState && window.googleCalendarState.oauthWritable === true);
          nextcloudCreateToggle.disabled = !(window.nextcloudCalendarState && window.nextcloudCalendarState.writable === true);
          googleOauthDisconnect.disabled = !(window.googleCalendarState && window.googleCalendarState.oauthConnected === true);
          updateGoogleStatusText();
          updateNextcloudStatusText();
          renderNextcloudCalendarChecks();
          monthWidthSlider.value = String(calendarUiSettings.multiMonthMinWidth || 30);
          monthWidthValue.textContent = String(calendarUiSettings.multiMonthMinWidth || 30) + ' %';
          roundnessSlider.value = String(calendarUiSettings.roundness || 0);
          roundnessValue.textContent = String(calendarUiSettings.roundness || 0) + ' px';
          rowHeightSlider.value = String(calendarUiSettings.timeGridRowHeight || 26);
          rowHeightValue.textContent = String(calendarUiSettings.timeGridRowHeight || 26) + ' px';
          updateSourceToggleButtons(calendarEl);
        }

        /**
         * Close Panel.
         * @returns {*} Returns the function result.
         */
        function closePanel() {
          panel.classList.remove('is-open');
          panel.setAttribute('aria-hidden', 'true');
        }

        /**
         * Open Panel.
         * @returns {*} Returns panel.
         */
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

        /**
         * Toggle Panel.
         * @returns {*} Returns ggle panel.
         */
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
        googleCreateToggle.addEventListener('change', function() {
          calendarUiSettings.createGoogleEvents = Boolean(googleCreateToggle.checked);
          persistCalendarUiSettings();
        });
        nextcloudCreateToggle.addEventListener('change', function() {
          calendarUiSettings.createNextcloudEvents = Boolean(nextcloudCreateToggle.checked);
          persistCalendarUiSettings();
        });
        googleOauthConnect.addEventListener('click', function() {
          var connectUrl = new URL('/api/google-oauth/start', CALENDAR_API_BASE).toString();
          window.open(connectUrl, '_blank', 'noopener');
          var attempts = 0;
          var pollId = window.setInterval(async function() {
            attempts += 1;
            try {
              var status = await fetchGoogleOAuthStatus();
              if (window.googleCalendarState) {
                window.googleCalendarState.oauthConnected = status && status.connected === true;
                window.googleCalendarState.oauthWritable = status && status.writable === true;
              }
              syncInputs();
              if (window.googleCalendarState && window.googleCalendarState.oauthConnected) {
                window.clearInterval(pollId);
                if (calendarUiSettings.showGoogleEvents === true && typeof window.setGoogleEventsEnabled === 'function') {
                  window.setGoogleEventsEnabled(calendar, true);
                }
              }
            } catch (error) {
              if (attempts >= 60) {
                window.clearInterval(pollId);
              }
              console.warn('Could not refresh Google OAuth status:', error.message);
            }
            if (attempts >= 60) {
              window.clearInterval(pollId);
            }
          }, 2000);
        });
        googleOauthDisconnect.addEventListener('click', async function() {
          try {
            var disconnectUrl = new URL('/api/google-oauth/disconnect', CALENDAR_API_BASE).toString();
            var response = await fetch(disconnectUrl, { method: 'POST', headers: mutationHeaders(), body: '{}' });
            if (!response.ok) {
              var text = await response.text();
              throw new Error(text || 'Could not disconnect Google OAuth');
            }
            if (window.googleCalendarState) {
              window.googleCalendarState.oauthConnected = false;
              window.googleCalendarState.oauthWritable = false;
            }
            calendarUiSettings.createGoogleEvents = false;
            persistCalendarUiSettings();
            syncInputs();
            if (calendarUiSettings.showGoogleEvents === true && typeof window.setGoogleEventsEnabled === 'function') {
              window.setGoogleEventsEnabled(calendar, true);
            }
          } catch (error) {
            alert('Google disconnect failed: ' + error.message);
          }
        });
        eventPreviewToggle.addEventListener('change', function() {
          calendarUiSettings.showEventPreviewOnClick = Boolean(eventPreviewToggle.checked);
          persistCalendarUiSettings();
          if (!calendarUiSettings.showEventPreviewOnClick) {
            closeEventPreviewPopover();
          }
        });
        vacationTextureToggle.addEventListener('change', function() {
          calendarUiSettings.showVacationTexture = Boolean(vacationTextureToggle.checked);
          persistCalendarUiSettings();
          applyVacationTextureSetting(calendarUiSettings.showVacationTexture !== false);
        });
        monthWidthSlider.addEventListener('input', function() {
          var parsed = Number(monthWidthSlider.value);
          if (!Number.isFinite(parsed)) return;
          if (parsed < MONTH_WIDTH_PERCENT_MIN) parsed = MONTH_WIDTH_PERCENT_MIN;
          if (parsed > MONTH_WIDTH_PERCENT_MAX) parsed = MONTH_WIDTH_PERCENT_MAX;
          parsed = Math.round(parsed);
          calendarUiSettings.multiMonthMinWidth = parsed;
          monthWidthValue.textContent = String(parsed) + ' %';
          persistCalendarUiSettings();
          calendar.setOption('multiMonthMinWidth', monthWidthPercentToPx(parsed, calendarEl));
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
        rowHeightSlider.addEventListener('input', function() {
          var parsed = Number(rowHeightSlider.value);
          if (!Number.isFinite(parsed)) return;
          if (parsed < TIMEGRID_ROW_HEIGHT_MIN) parsed = TIMEGRID_ROW_HEIGHT_MIN;
          if (parsed > TIMEGRID_ROW_HEIGHT_MAX) parsed = TIMEGRID_ROW_HEIGHT_MAX;
          parsed = Math.round(parsed);
          calendarUiSettings.timeGridRowHeight = parsed;
          rowHeightValue.textContent = String(parsed) + ' px';
          applyTimeGridRowHeight(parsed);
          var heights = deriveTimeGridEventHeights(parsed);
          calendar.setOption('eventMinHeight', heights.eventMinHeight);
          calendar.setOption('eventShortHeight', heights.eventShortHeight);
          persistCalendarUiSettings();
          calendar.updateSize();
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

      /**
       * Collect Google Color Options.
       * @param {*}
       * @returns {*} Returns the function result.
       */
      function collectGoogleColorOptions(calendar) {
        var colorById = {};
        if (!calendar || typeof calendar.getEvents !== 'function') return [];
        calendar.getEvents().forEach(function(event) {
          if (!isGoogleEvent(event)) return;
          var props = event && event.extendedProps ? event.extendedProps : {};
          var colorId = String(props.googleColorId || '').trim();
          if (!colorId) return;
          if (colorById[colorId]) return;
          colorById[colorId] = {
            id: colorId,
            background: String(props.googleBackgroundColor || event.backgroundColor || '').trim(),
            text: String(props.googleTextColor || event.textColor || '').trim()
          };
        });
        return Object.keys(colorById)
          .sort(function(a, b) {
            var an = Number(a);
            var bn = Number(b);
            if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
            return String(a).localeCompare(String(b));
          })
          .map(function(id) { return colorById[id]; });
      }

      /**
       * Render Nextcloud Create Calendar Radios.
       * @param {*}
       * @returns {*} Returns nextcloud create calendar radios.
       */
      function renderNextcloudCreateCalendarRadios(container) {
        var wrap = container;
        if (!wrap) return '';
        wrap.innerHTML = '';
        var calendars = window.nextcloudCalendarState && Array.isArray(window.nextcloudCalendarState.calendars)
          ? window.nextcloudCalendarState.calendars
          : [];
        var defaultId = String(window.nextcloudCalendarState && window.nextcloudCalendarState.defaultCreateCalendarId || '').trim();
        var selectedId = '';
        calendars.forEach(function(cal, index) {
          var id = String(cal && cal.id || '').trim();
          if (!id) return;
          var labelText = String(cal && (cal.slug || cal.id) || id).trim();
          var row = document.createElement('label');
          row.className = 'event-modal__radio';
          var input = document.createElement('input');
          input.type = 'radio';
          input.name = 'create-event-nextcloud-calendar';
          input.value = id;
          if ((defaultId && id === defaultId) || (!defaultId && !selectedId && index === 0)) {
            input.checked = true;
            selectedId = id;
          }
          var text = document.createElement('span');
          text.textContent = labelText;
          row.appendChild(input);
          row.appendChild(text);
          wrap.appendChild(row);
        });
        if (!selectedId && calendars[0] && calendars[0].id) {
          selectedId = String(calendars[0].id).trim();
          var first = wrap.querySelector('input[type="radio"][name="create-event-nextcloud-calendar"]');
          if (first) first.checked = true;
        }
        if (!selectedId) {
          var hint = document.createElement('p');
          hint.className = 'event-modal__hint';
          hint.textContent = 'No Nextcloud calendars available.';
          wrap.appendChild(hint);
        }
        return selectedId;
      }

      /**
       * Show Create Event Dialog.
       * @param {*}
       * @returns {*} Returns the function result.
       */
      function showCreateEventDialog(calendar) {
        return new Promise(function(resolve) {
          var modal = document.getElementById('create-event-modal');
          var input = document.getElementById('create-event-title');
          var tabsWrap = document.getElementById('create-event-tabs');
          var mdTab = document.getElementById('create-event-tab-md');
          var googleTab = document.getElementById('create-event-tab-google');
          var nextcloudTab = document.getElementById('create-event-tab-nextcloud');
          var mdPanel = document.getElementById('create-event-panel-md');
          var googlePanel = document.getElementById('create-event-panel-google');
          var nextcloudPanel = document.getElementById('create-event-panel-nextcloud');
          var googleColorSelect = document.getElementById('create-event-google-color');
          var googleColorHint = document.getElementById('create-event-google-color-hint');
          var nextcloudRadios = document.getElementById('create-event-nextcloud-calendars');
          var nextcloudCalendarHint = document.getElementById('create-event-nextcloud-calendar-hint');
          var createGoogleBtn = document.getElementById('create-event-confirm-google');
          var createNextcloudBtn = document.getElementById('create-event-confirm-nextcloud');
          var createMdBtn = document.getElementById('create-event-confirm-md');
          var cancelBtn = document.getElementById('create-event-cancel');
          if (!modal || !input || !tabsWrap || !mdTab || !googleTab || !nextcloudTab || !mdPanel || !googlePanel || !nextcloudPanel || !googleColorSelect || !googleColorHint || !nextcloudRadios || !nextcloudCalendarHint || !createGoogleBtn || !createNextcloudBtn || !createMdBtn || !cancelBtn) {
            resolve(null);
            return;
          }

          var done = false;
          var activeTab = 'md';
          var activeTabs = ['md'];
          var nextcloudSelectedId = '';

          /**
           * Read Selected Nextcloud Calendar Id.
           * @returns {*} Returns selected nextcloud calendar id.
           */
          function readSelectedNextcloudCalendarId() {
            var selected = modal.querySelector('input[name="create-event-nextcloud-calendar"]:checked');
            return String(selected && selected.value || nextcloudSelectedId || '').trim();
          }
          /**
           * Get Selected Google Color Id.
           * @returns {*} Returns selected google color id.
           */
          function getSelectedGoogleColorId() {
            return String(googleColorSelect.value || '').trim();
          }
          /**
           * Set Active Tab.
           * @param {*}
           * @returns {*} Returns the function result.
           */
          function setActiveTab(target) {
            var targetTab = String(target || '').trim().toLowerCase();
            if (activeTabs.indexOf(targetTab) < 0) return;
            activeTab = targetTab;
            var all = [
              { key: 'md', tab: mdTab, panel: mdPanel },
              { key: 'google', tab: googleTab, panel: googlePanel },
              { key: 'nextcloud', tab: nextcloudTab, panel: nextcloudPanel }
            ];
            all.forEach(function(entry) {
              var selected = entry.key === activeTab;
              entry.tab.classList.toggle('is-active', selected);
              entry.tab.setAttribute('aria-selected', selected ? 'true' : 'false');
              entry.panel.classList.toggle('is-active', selected);
              entry.panel.hidden = !selected;
            });
          }

          /**
           * Cleanup.
           * @returns {*} Returns the function result.
           */
          function cleanup() {
            modal.classList.remove('is-open');
            mdTab.removeEventListener('click', onTabMd);
            googleTab.removeEventListener('click', onTabGoogle);
            nextcloudTab.removeEventListener('click', onTabNextcloud);
            createGoogleBtn.removeEventListener('click', onCreateGoogle);
            createNextcloudBtn.removeEventListener('click', onCreateNextcloud);
            createMdBtn.removeEventListener('click', onCreateMd);
            cancelBtn.removeEventListener('click', onCancel);
            input.removeEventListener('keydown', onKeyDown);
            modal.removeEventListener('mousedown', onBackdropPointer);
          }
          /**
           * Finish.
           * @param {*}
           * @returns {*} Returns the function result.
           */
          function finish(value) {
            if (done) return;
            done = true;
            cleanup();
            resolve(value);
          }
          /**
           * On Create Google.
           * @returns {*} Returns the function result.
           */
          function onCreateGoogle() {
            var title = input.value.trim();
            if (!title) {
              input.focus();
              return;
            }
            finish({ title: title, target: 'google', googleColorId: getSelectedGoogleColorId() });
          }
          /**
           * On Create Md.
           * @returns {*} Returns the function result.
           */
          function onCreateMd() {
            var title = input.value.trim();
            if (!title) {
              input.focus();
              return;
            }
            finish({ title: title, target: 'md' });
          }
          /**
           * On Create Nextcloud.
           * @returns {*} Returns the function result.
           */
          function onCreateNextcloud() {
            var title = input.value.trim();
            if (!title) {
              input.focus();
              return;
            }
            finish({ title: title, target: 'nextcloud', nextcloudCalendarId: readSelectedNextcloudCalendarId() });
          }
          /**
           * On Tab Md.
           * @returns {*} Returns the function result.
           */
          function onTabMd() {
            setActiveTab('md');
          }
          /**
           * On Tab Google.
           * @returns {*} Returns the function result.
           */
          function onTabGoogle() {
            setActiveTab('google');
          }
          /**
           * On Tab Nextcloud.
           * @returns {*} Returns the function result.
           */
          function onTabNextcloud() {
            setActiveTab('nextcloud');
          }
          /**
           * On Cancel.
           * @returns {*} Returns the function result.
           */
          function onCancel() {
            finish(null);
          }
          /**
           * On Backdrop Pointer.
           * @param {*}
           * @returns {*} Returns the function result.
           */
          function onBackdropPointer(event) {
            if (event.target === modal) {
              finish(null);
            }
          }
          /**
           * On Key Down.
           * @param {*}
           * @returns {*} Returns the function result.
           */
          function onKeyDown(event) {
            if (event.key === 'Enter') {
              event.preventDefault();
              if (activeTab === 'google') {
                onCreateGoogle();
                return;
              }
              if (activeTab === 'nextcloud') {
                onCreateNextcloud();
                return;
              }
              onCreateMd();
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              onCancel();
            }
          }

          input.value = '';
          var canCreateGoogle = isGoogleWriteEnabled() && calendarUiSettings.createGoogleEvents === true;
          var canCreateNextcloud = isNextcloudWriteEnabled() && calendarUiSettings.createNextcloudEvents === true;
          activeTabs = ['md'];
          if (canCreateGoogle) activeTabs.push('google');
          if (canCreateNextcloud) activeTabs.push('nextcloud');
          googleTab.hidden = !canCreateGoogle;
          googleTab.disabled = !canCreateGoogle;
          nextcloudTab.hidden = !canCreateNextcloud;
          nextcloudTab.disabled = !canCreateNextcloud;
          tabsWrap.hidden = activeTabs.length <= 1;

          createGoogleBtn.disabled = !canCreateGoogle;
          createNextcloudBtn.disabled = !canCreateNextcloud;

          var googleColorOptions = collectGoogleColorOptions(calendar);
          googleColorSelect.innerHTML = '';
          var defaultOption = document.createElement('option');
          defaultOption.value = '';
          defaultOption.textContent = 'Default calendar color';
          googleColorSelect.appendChild(defaultOption);
          googleColorOptions.forEach(function(item) {
            var option = document.createElement('option');
            option.value = String(item.id || '');
            var bg = String(item.background || '').trim();
            var suffix = bg ? ' (' + bg + ')' : '';
            option.textContent = 'Color ' + String(item.id || '') + suffix;
            googleColorSelect.appendChild(option);
          });
          var googleColorsRequireVisibleEvents = canCreateGoogle && calendarUiSettings.showGoogleEvents !== true;
          var googleNoColorsLoaded = canCreateGoogle && calendarUiSettings.showGoogleEvents === true && googleColorOptions.length === 0;
          googleColorSelect.disabled = !canCreateGoogle || googleColorsRequireVisibleEvents || googleNoColorsLoaded;
          if (googleColorsRequireVisibleEvents) {
            googleColorHint.textContent = 'Enable "Show Google events" in settings to use existing Google colors.';
            googleColorHint.hidden = false;
          } else if (googleNoColorsLoaded) {
            googleColorHint.textContent = 'No Google colors loaded yet.';
            googleColorHint.hidden = false;
          } else {
            googleColorHint.textContent = '';
            googleColorHint.hidden = true;
          }

          nextcloudSelectedId = renderNextcloudCreateCalendarRadios(nextcloudRadios);
          var nextcloudNeedsVisibleEvents = canCreateNextcloud && calendarUiSettings.showNextcloudEvents !== true;
          var nextcloudRadioInputs = nextcloudRadios.querySelectorAll('input[name="create-event-nextcloud-calendar"]');
          nextcloudRadioInputs.forEach(function(inputEl) {
            inputEl.disabled = nextcloudNeedsVisibleEvents;
          });
          if (nextcloudNeedsVisibleEvents) {
            nextcloudCalendarHint.textContent = 'Enable "Show Nextcloud events" in settings to select calendars.';
            nextcloudCalendarHint.hidden = false;
          } else {
            nextcloudCalendarHint.textContent = '';
            nextcloudCalendarHint.hidden = true;
          }
          setActiveTab('md');

          modal.classList.add('is-open');
          mdTab.addEventListener('click', onTabMd);
          googleTab.addEventListener('click', onTabGoogle);
          nextcloudTab.addEventListener('click', onTabNextcloud);
          createGoogleBtn.addEventListener('click', onCreateGoogle);
          createNextcloudBtn.addEventListener('click', onCreateNextcloud);
          createMdBtn.addEventListener('click', onCreateMd);
          cancelBtn.addEventListener('click', onCancel);
          input.addEventListener('keydown', onKeyDown);
          modal.addEventListener('mousedown', onBackdropPointer);
          setTimeout(function() { input.focus(); }, 0);
        });
      }

      /**
       * Get Anchor Point From Native Event.
       * @param {*}
       * @returns {*} Returns anchor point from native event.
       */
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

      /**
       * Place Day Action Menu.
       * @param {*}
       * @param {*}
       * @returns {*} Returns the function result.
       */
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

      /**
       * Close Event Preview Popover.
       * @returns {*} Returns the function result.
       */
      function closeEventPreviewPopover() {
        if (typeof closeActiveEventPreview === 'function') {
          closeActiveEventPreview();
        }
      }

      /**
       * Place Event Preview Popover.
       * @param {*}
       * @param {*}
       * @returns {*} Returns the function result.
       */
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

      /**
       * Format Iso Date For Preview.
       * @param {*}
       * @returns {*} Returns iso date for preview.
       */
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

      /**
       * Format Time For Preview.
       * @param {*}
       * @returns {*} Returns time for preview.
       */
      function formatTimeForPreview(date) {
        if (!(date instanceof Date)) return '';
        return new Intl.DateTimeFormat(undefined, {
          hour: '2-digit',
          minute: '2-digit'
        }).format(date);
      }

      /**
       * Format Event Date For Preview.
       * @param {*}
       * @returns {*} Returns event date for preview.
       */
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

      /**
       * Render Simple Markdown Text.
       * @param {*}
       * @returns {*} Returns simple markdown text.
       */
      function renderSimpleMarkdownText(markdownText) {
        var escaped = escapeHtml(markdownText || '');
        escaped = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');
        escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        escaped = escaped.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        return escaped;
      }

      /**
       * Render Preview Markdown Block.
       * @param {*}
       * @returns {*} Returns preview markdown block.
       */
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

      /**
       * Render Google Event Preview Block.
       * @param {*}
       * @returns {*} Returns google event preview block.
       */
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

      /**
       * Render Nextcloud Event Preview Block.
       * @param {*}
       * @returns {*} Returns nextcloud event preview block.
       */
      function renderNextcloudEventPreviewBlock(event) {
        var props = event && event.extendedProps ? event.extendedProps : {};
        var description = String(props.nextcloudDescription || '').trim();
        var location = String(props.nextcloudLocation || '').trim();
        var calendarLabel = String(props.nextcloudCalendarLabel || props.nextcloudCalendarId || '').trim();
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

      /**
       * Fetch Event Preview.
       * @param {*}
       * @returns {*} Returns event preview.
       */
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

      /**
       * Show Event Preview Popover.
       * @param {*}
       * @param {*}
       * @returns {*} Returns the function result.
       */
      async function showEventPreviewPopover(event, anchorPoint) {
        var popover = document.getElementById('event-preview-popover');
        var closeButton = document.getElementById('event-preview-close');
        var titleNode = document.getElementById('event-preview-title');
        var dateNode = document.getElementById('event-preview-date');
        var bodyNode = document.getElementById('event-preview-body');
        var openMapButton = document.getElementById('event-preview-open-map');
        var editExternalButton = document.getElementById('event-preview-edit-google');
        var deleteExternalButton = document.getElementById('event-preview-delete-google');
        var openNoteButton = document.getElementById('event-preview-open-note');
        var defaultOpenButtonLabel = 'Open note in new tab';
        if (!popover || !closeButton || !titleNode || !dateNode || !bodyNode || !openNoteButton) {
          await openEventNote(event);
          return;
        }

        closeEventPreviewPopover();
        var closed = false;
        /**
         * Cleanup.
         * @returns {*} Returns the function result.
         */
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
          if (editExternalButton) {
            editExternalButton.removeEventListener('click', onEditGoogleTitle);
            editExternalButton.removeEventListener('click', onEditNextcloudTitle);
          }
          if (deleteExternalButton) {
            deleteExternalButton.removeEventListener('click', onDeleteGoogleEvent);
            deleteExternalButton.removeEventListener('click', onDeleteNextcloudEvent);
          }
          openNoteButton.removeEventListener('click', onOpenNote);
          openNoteButton.removeEventListener('click', onOpenExternalLink);
          document.removeEventListener('mousedown', onOutsidePointer);
          document.removeEventListener('keydown', onKeyDown);
          if (closeActiveEventPreview === cleanup) {
            closeActiveEventPreview = null;
          }
        }
        /**
         * On Close.
         * @returns {*} Returns the function result.
         */
        function onClose() {
          cleanup();
        }
        /**
         * On Outside Pointer.
         * @param {*}
         * @returns {*} Returns the function result.
         */
        function onOutsidePointer(pointerEvent) {
          if (popover.contains(pointerEvent.target)) return;
          cleanup();
        }
        /**
         * On Key Down.
         * @param {*}
         * @returns {*} Returns the function result.
         */
        function onKeyDown(keyEvent) {
          if (keyEvent.key === 'Escape') {
            keyEvent.preventDefault();
            cleanup();
          }
        }
        /**
         * On Open External Link.
         * @returns {*} Returns the function result.
         */
        async function onOpenExternalLink() {
          var props = event && event.extendedProps ? event.extendedProps : {};
          var externalLink = String(props.googleHtmlLink || props.nextcloudUrl || '').trim();
          if (!externalLink) return;
          window.open(externalLink, '_blank', 'noopener,noreferrer');
          cleanup();
        }
        /**
         * On Open Note.
         * @returns {*} Returns the function result.
         */
        async function onOpenNote() {
          try {
            await openEventNote(event);
            cleanup();
          } catch (error) {
            alert('Open note failed: ' + error.message);
          }
        }
        /**
         * On Open Map.
         * @returns {*} Returns the function result.
         */
        async function onOpenMap() {
          cleanup();
          try {
            await openEventMap(event, eventCoordinates);
          } catch (error) {
            alert('Open map failed: ' + error.message);
          }
        }
        /**
         * On Edit Google Title.
         * @returns {*} Returns the function result.
         */
        async function onEditGoogleTitle() {
          var currentTitle = String(event && event.title || '').trim();
          var nextTitle = window.prompt('New title', currentTitle);
          if (nextTitle == null) return;
          var trimmed = String(nextTitle || '').trim();
          if (!trimmed) return;
          try {
            var schedule = toEventPersistPayload(event);
            var updated = await updateGoogleCalendarEvent(event, {
              title: trimmed,
              start: schedule.start,
              end: schedule.end,
              allDay: schedule.allDay
            });
            applyGoogleEventResponse(event, updated);
            titleNode.textContent = String(trimmed);
            if (updated && updated.extendedProps && updated.extendedProps.googleDescription) {
              bodyNode.innerHTML = renderGoogleEventPreviewBlock(updated);
            }
          } catch (error) {
            alert('Google rename failed: ' + error.message);
          }
        }
        /**
         * On Delete Google Event.
         * @returns {*} Returns the function result.
         */
        async function onDeleteGoogleEvent() {
          var okay = window.confirm('Delete this Google event?');
          if (!okay) return;
          try {
            await deleteGoogleCalendarEvent(event);
            cleanup();
            event.remove();
          } catch (error) {
            alert('Google delete failed: ' + error.message);
          }
        }
        /**
         * On Edit Nextcloud Title.
         * @returns {*} Returns the function result.
         */
        async function onEditNextcloudTitle() {
          var currentTitle = String(event && event.title || '').trim();
          var nextTitle = window.prompt('New title', currentTitle);
          if (nextTitle == null) return;
          var trimmed = String(nextTitle || '').trim();
          if (!trimmed) return;
          try {
            var schedule = toEventPersistPayload(event);
            var updated = await updateNextcloudCalendarEvent(event, {
              title: trimmed,
              start: schedule.start,
              end: schedule.end,
              allDay: schedule.allDay
            });
            applyNextcloudEventResponse(event, updated);
            titleNode.textContent = String(trimmed);
            bodyNode.innerHTML = renderNextcloudEventPreviewBlock(updated);
          } catch (error) {
            alert('Nextcloud rename failed: ' + error.message);
          }
        }
        /**
         * On Delete Nextcloud Event.
         * @returns {*} Returns the function result.
         */
        async function onDeleteNextcloudEvent() {
          var okay = window.confirm('Delete this Nextcloud event?');
          if (!okay) return;
          try {
            await deleteNextcloudCalendarEvent(event);
            cleanup();
            event.remove();
          } catch (error) {
            alert('Nextcloud delete failed: ' + error.message);
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
        if (editExternalButton) {
          editExternalButton.hidden = true;
          editExternalButton.disabled = true;
          editExternalButton.textContent = 'Rename';
        }
        if (deleteExternalButton) {
          deleteExternalButton.hidden = true;
          deleteExternalButton.disabled = true;
          deleteExternalButton.textContent = 'Delete';
        }

        popover.classList.add('is-open');
        popover.setAttribute('aria-hidden', 'false');
        placeEventPreviewPopover(popover, anchorPoint || null);
        closeButton.addEventListener('click', onClose);
        if (openMapButton) {
          openMapButton.addEventListener('click', onOpenMap);
        }
        var googleEvent = isGoogleEvent(event);
        var nextcloudEvent = isNextcloudEvent(event);
        var hasGoogleLink = Boolean(String(event && event.extendedProps && event.extendedProps.googleHtmlLink || '').trim());
        var hasNextcloudLink = Boolean(String(event && event.extendedProps && event.extendedProps.nextcloudUrl || '').trim());
        if (googleEvent || nextcloudEvent) {
          openNoteButton.textContent = 'Open event in new tab';
          openNoteButton.disabled = googleEvent ? !hasGoogleLink : !hasNextcloudLink;
          openNoteButton.addEventListener('click', onOpenExternalLink);
          var externalWritable = googleEvent ? isGoogleWriteEnabled() : isNextcloudWriteEnabled();
          if (editExternalButton) {
            editExternalButton.hidden = !externalWritable;
            editExternalButton.disabled = !externalWritable;
            editExternalButton.textContent = 'Rename';
            if (externalWritable) {
              editExternalButton.addEventListener('click', googleEvent ? onEditGoogleTitle : onEditNextcloudTitle);
            }
          }
          if (deleteExternalButton) {
            deleteExternalButton.hidden = !externalWritable;
            deleteExternalButton.disabled = !externalWritable;
            deleteExternalButton.textContent = 'Delete';
            if (externalWritable) {
              deleteExternalButton.addEventListener('click', googleEvent ? onDeleteGoogleEvent : onDeleteNextcloudEvent);
            }
          }
        } else {
          openNoteButton.addEventListener('click', onOpenNote);
        }
        document.addEventListener('mousedown', onOutsidePointer);
        document.addEventListener('keydown', onKeyDown);
        closeActiveEventPreview = cleanup;

        if (googleEvent) {
          bodyNode.innerHTML = renderGoogleEventPreviewBlock(event);
          placeEventPreviewPopover(popover, anchorPoint || null);
          return;
        }
        if (nextcloudEvent) {
          bodyNode.innerHTML = renderNextcloudEventPreviewBlock(event);
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

      /**
       * Show Day Action Dialog.
       * @param {*}
       * @returns {*} Returns the function result.
       */
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

          /**
           * Cleanup.
           * @returns {*} Returns the function result.
           */
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

          /**
           * Finish.
           * @param {*}
           * @returns {*} Returns the function result.
           */
          function finish(value) {
            if (done) return;
            done = true;
            cleanup();
            resolve(value);
          }

          /**
           * On Focus.
           * @returns {*} Returns the function result.
           */
          function onFocus() { finish('focus'); }
          /**
           * On Create.
           * @returns {*} Returns the function result.
           */
          function onCreate() { finish('create'); }
          /**
           * On Outside Pointer.
           * @param {*}
           * @returns {*} Returns the function result.
           */
          function onOutsidePointer(event) {
            if (modal.contains(event.target)) return;
            finish(null);
          }
          /**
           * On Key Down.
           * @param {*}
           * @returns {*} Returns the function result.
           */
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

      /**
       * Shift Iso Date.
       * @param {*}
       * @param {*}
       * @returns {*} Returns the function result.
       */
      function shiftIsoDate(isoDate, deltaDays) {
        if (!isoDate) return null;
        var parts = isoDate.split('-').map(Number);
        var utcDate = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
        utcDate.setUTCDate(utcDate.getUTCDate() + deltaDays);
        return utcDate.toISOString().slice(0, 10);
      }

      /**
       * To Inclusive End Date.
       * @param {*}
       * @returns {*} Returns inclusive end date.
       */
      function toInclusiveEndDate(exclusiveEndDate) {
        return shiftIsoDate(exclusiveEndDate, -1);
      }

      /**
       * Is Iso Date Only.
       * @param {*}
       * @returns {*} Returns whether the condition is met.
       */
      function isIsoDateOnly(value) {
        return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
      }

      /**
       * Normalize Calendar Date Like.
       * @param {*}
       * @returns {*} Returns calendar date like.
       */
      function normalizeCalendarDateLike(value) {
        var raw = String(value || '').trim();
        if (!raw) return '';
        return raw.replace(' ', 'T');
      }

      /**
       * Local Iso Date Key.
       * @param {*}
       * @returns {*} Returns the function result.
       */
      function localIsoDateKey(date) {
        if (!(date instanceof Date)) return '';
        var y = date.getFullYear();
        var m = String(date.getMonth() + 1).padStart(2, '0');
        var d = String(date.getDate()).padStart(2, '0');
        return y + '-' + m + '-' + d;
      }

      /**
       * Allow Recurring Timed Edit.
       * @param {*}
       * @param {*}
       * @returns {*} Returns the function result.
       */
      function allowRecurringTimedEdit(dropInfo, draggedEvent) {
        if (!draggedEvent || draggedEvent.allDay) return true;
        var props = draggedEvent.extendedProps || {};
        if (!props.isRecurring || props.isRecurringOverride) return true;
        var recurrenceDaysCount = Number(props.recurrenceDaysCount);
        if (Number.isFinite(recurrenceDaysCount) && recurrenceDaysCount <= 0) return true;

        var originalStartDay = localIsoDateKey(draggedEvent.start);
        var originalEndDay = localIsoDateKey(draggedEvent.end || draggedEvent.start);
        var nextStartDay = localIsoDateKey(dropInfo && dropInfo.start ? dropInfo.start : null);
        var nextEndDay = localIsoDateKey(dropInfo && dropInfo.end ? dropInfo.end : (dropInfo && dropInfo.start ? dropInfo.start : null));

        if (!originalStartDay || !nextStartDay) return false;
        if (originalStartDay !== nextStartDay) return false;
        if (originalEndDay && nextEndDay && originalEndDay !== nextEndDay) return false;
        return true;
      }

      /**
       * To Event Persist Payload.
       * @param {*}
       * @returns {*} Returns event persist payload.
       */
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

      /**
       * To Create Payload.
       * @param {*}
       * @param {*}
       * @param {*}
       * @returns {*} Returns create payload.
       */
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

      /**
       * Save Event Dates.
       * @param {*}
       * @returns {*} Returns the function result.
       */
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

      /**
       * Open Event Note.
       * @param {*}
       * @returns {*} Returns event note.
       */
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

      /**
       * Open Event Map.
       * @param {*}
       * @param {*}
       * @returns {*} Returns event map.
       */
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

      /**
       * Create Event.
       * @param {*}
       * @param {*}
       * @param {*}
       * @param {*}
       * @returns {*} Returns event.
       */
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

      /**
       * Rebuild Events And Reload.
       * @param {*}
       * @returns {*} Returns the function result.
       */
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

      /**
       * Fetch Calendar Filters.
       * @returns {*} Returns calendar filters.
       */
      async function fetchCalendarFilters() {
        var filtersUrl = new URL('/api/calendar/filters', CALENDAR_API_BASE).toString();
        var response = await fetch(filtersUrl, { method: 'GET' });
        if (!response.ok) {
          var text = await response.text();
          throw new Error(text || 'Could not load calendar filters');
        }
        return response.json();
      }

      /**
       * Fetch Google Calendar Config.
       * @returns {*} Returns google calendar config.
       */
      async function fetchGoogleCalendarConfig() {
        var configUrl = new URL('/api/google-calendar/config', CALENDAR_API_BASE).toString();
        var response = await fetch(configUrl, { method: 'GET' });
        if (!response.ok) {
          var text = await response.text();
          throw new Error(text || 'Could not load Google Calendar config');
        }
        return response.json();
      }

      /**
       * Fetch Nextcloud Calendar Config.
       * @returns {*} Returns nextcloud calendar config.
       */
      async function fetchNextcloudCalendarConfig() {
        var configUrl = new URL('/api/nextcloud-calendar/config', CALENDAR_API_BASE).toString();
        var response = await fetch(configUrl, { method: 'GET' });
        if (!response.ok) {
          var text = await response.text();
          throw new Error(text || 'Could not load Nextcloud Calendar config');
        }
        return response.json();
      }

      /**
       * Fetch Google OAuth Status.
       * @returns {*} Returns google oauth status.
       */
      async function fetchGoogleOAuthStatus() {
        var statusUrl = new URL('/api/google-oauth/status', CALENDAR_API_BASE).toString();
        var response = await fetch(statusUrl, { method: 'GET' });
        if (!response.ok) {
          var text = await response.text();
          throw new Error(text || 'Could not load Google OAuth status');
        }
        return response.json();
      }

      /**
       * Fetch Google Calendar Events.
       * @param {*}
       * @param {*}
       * @returns {*} Returns google calendar events.
       */
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

      /**
       * Fetch Nextcloud Calendar Events.
       * @param {*}
       * @param {*}
       * @returns {*} Returns nextcloud calendar events.
       */
      async function fetchNextcloudCalendarEvents(start, end) {
        var eventsUrl = new URL('/api/nextcloud-calendar/events', CALENDAR_API_BASE);
        eventsUrl.searchParams.set('start', String(start || ''));
        eventsUrl.searchParams.set('end', String(end || ''));
        var response = await fetch(eventsUrl.toString(), { method: 'GET' });
        if (!response.ok) {
          var text = await response.text();
          throw new Error(text || 'Could not load Nextcloud Calendar events');
        }
        var payload = await response.json();
        return payload && Array.isArray(payload.events) ? payload.events : [];
      }

      /**
       * To Google Calendar Event Payload.
       * @param {*}
       * @param {*}
       * @param {*}
       * @param {*}
       * @param {*}
       * @param {*}
       * @returns {*} Returns google calendar event payload.
       */
      function toGoogleCalendarEventPayload(title, start, end, allDay, calendarId, colorId) {
        var schedule = toCreatePayload(start, end, allDay);
        return {
          calendarId: String(calendarId || (window.googleCalendarState && window.googleCalendarState.defaultCreateCalendarId) || '').trim(),
          title: String(title || '').trim(),
          start: schedule.start,
          end: schedule.end,
          allDay: schedule.allDay,
          colorId: String(colorId || '').trim()
        };
      }

      /**
       * To Nextcloud Calendar Event Payload.
       * @param {*}
       * @param {*}
       * @param {*}
       * @param {*}
       * @param {*}
       * @returns {*} Returns nextcloud calendar event payload.
       */
      function toNextcloudCalendarEventPayload(title, start, end, allDay, calendarId) {
        var schedule = toCreatePayload(start, end, allDay);
        return {
          calendarId: String(calendarId || (window.nextcloudCalendarState && window.nextcloudCalendarState.defaultCreateCalendarId) || '').trim(),
          title: String(title || '').trim(),
          start: schedule.start,
          end: schedule.end,
          allDay: schedule.allDay
        };
      }

      /**
       * To Full Calendar Google Event.
       * @param {*}
       * @param {*}
       * @returns {*} Returns full calendar google event.
       */
      function toFullCalendarGoogleEvent(rawEvent, fallbackCalendarId) {
        if (!rawEvent || typeof rawEvent !== 'object') return null;
        var start = String(rawEvent.start && (rawEvent.start.dateTime || rawEvent.start.date) || '').trim();
        if (!start) return null;
        var end = String(rawEvent.end && (rawEvent.end.dateTime || rawEvent.end.date) || '').trim();
        var allDay = Boolean(rawEvent.start && rawEvent.start.date && !rawEvent.start.dateTime);
        var calendarId = String(rawEvent.organizer && rawEvent.organizer.email || fallbackCalendarId || '').trim();
        var eventId = String(rawEvent.id || '').trim();
        return {
          id: 'gcal:' + calendarId + ':' + eventId,
          title: String(rawEvent.summary || '(No title)').trim(),
          start: start,
          end: end || undefined,
          allDay: allDay,
          editable: isGoogleWriteEnabled(),
          backgroundColor: String(rawEvent.backgroundColor || '').trim() || undefined,
          borderColor: String(rawEvent.backgroundColor || '').trim() || undefined,
          textColor: String(rawEvent.foregroundColor || '').trim() || undefined,
          extendedProps: {
            externalSource: 'google',
            googleCalendarId: calendarId,
            googleEventId: eventId,
            googleColorId: String(rawEvent.colorId || '').trim(),
            googleBackgroundColor: String(rawEvent.backgroundColor || '').trim(),
            googleTextColor: String(rawEvent.foregroundColor || '').trim(),
            googleHtmlLink: String(rawEvent.htmlLink || '').trim(),
            googleDescription: String(rawEvent.description || '').trim(),
            googleLocation: String(rawEvent.location || '').trim(),
            googleCalendarSummary: String(rawEvent.organizer && (rawEvent.organizer.displayName || rawEvent.organizer.email) || calendarId).trim()
          }
        };
      }

      /**
       * Create Google Calendar Event.
       * @param {*}
       * @param {*}
       * @param {*}
       * @param {*}
       * @param {*}
       * @returns {*} Returns google calendar event.
       */
      async function createGoogleCalendarEvent(title, start, end, allDay, colorId) {
        if (!isHttpContext()) {
          throw new Error('Calendar is not running on http(s). Open the preview server URL.');
        }
        var payload = toGoogleCalendarEventPayload(title, start, end, allDay, '', colorId);
        if (!payload.calendarId) throw new Error('Missing Google target calendar');
        var createUrl = new URL('/api/google-calendar/events/create', CALENDAR_API_BASE).toString();
        var response = await fetch(createUrl, {
          method: 'POST',
          headers: mutationHeaders(),
          body: JSON.stringify(payload)
        });
        if (!response.ok) {
          var text = await response.text();
          throw new Error(text || 'Could not create Google event');
        }
        var out = await response.json();
        return { event: toFullCalendarGoogleEvent(out && out.event, payload.calendarId) };
      }

      /**
       * Update Google Calendar Event.
       * @param {*}
       * @param {*}
       * @returns {*} Returns the function result.
       */
      async function updateGoogleCalendarEvent(event, payload) {
        var props = event && event.extendedProps ? event.extendedProps : {};
        var calendarId = String(props.googleCalendarId || '').trim();
        var eventId = String(props.googleEventId || '').trim();
        if (!calendarId || !eventId) throw new Error('Missing Google event identifiers');
        var updateUrl = new URL('/api/google-calendar/events/update', CALENDAR_API_BASE).toString();
        var response = await fetch(updateUrl, {
          method: 'POST',
          headers: mutationHeaders(),
          body: JSON.stringify({
            calendarId: calendarId,
            eventId: eventId,
            title: payload && payload.title ? payload.title : String(event && event.title || ''),
            start: payload && payload.start,
            end: payload && payload.end,
            allDay: Boolean(payload && payload.allDay)
          })
        });
        if (!response.ok) {
          var text = await response.text();
          throw new Error(text || 'Could not update Google event');
        }
        var out = await response.json();
        return toFullCalendarGoogleEvent(out && out.event, calendarId);
      }

      /**
       * Delete Google Calendar Event.
       * @param {*}
       * @returns {*} Returns the function result.
       */
      async function deleteGoogleCalendarEvent(event) {
        var props = event && event.extendedProps ? event.extendedProps : {};
        var calendarId = String(props.googleCalendarId || '').trim();
        var eventId = String(props.googleEventId || '').trim();
        if (!calendarId || !eventId) throw new Error('Missing Google event identifiers');
        var deleteUrl = new URL('/api/google-calendar/events/delete', CALENDAR_API_BASE).toString();
        var response = await fetch(deleteUrl, {
          method: 'POST',
          headers: mutationHeaders(),
          body: JSON.stringify({ calendarId: calendarId, eventId: eventId })
        });
        if (!response.ok) {
          var text = await response.text();
          throw new Error(text || 'Could not delete Google event');
        }
      }

      /**
       * Create Nextcloud Calendar Event.
       * @param {*}
       * @param {*}
       * @param {*}
       * @param {*}
       * @param {*}
       * @returns {*} Returns nextcloud calendar event.
       */
      async function createNextcloudCalendarEvent(title, start, end, allDay, calendarId) {
        if (!isHttpContext()) {
          throw new Error('Calendar is not running on http(s). Open the preview server URL.');
        }
        var payload = toNextcloudCalendarEventPayload(title, start, end, allDay, calendarId);
        if (!payload.calendarId) throw new Error('Missing Nextcloud target calendar');
        var createUrl = new URL('/api/nextcloud-calendar/events/create', CALENDAR_API_BASE).toString();
        var response = await fetch(createUrl, {
          method: 'POST',
          headers: mutationHeaders(),
          body: JSON.stringify(payload)
        });
        if (!response.ok) {
          var text = await response.text();
          throw new Error(text || 'Could not create Nextcloud event');
        }
        var out = await response.json();
        return { event: out && out.event ? out.event : null };
      }

      /**
       * Update Nextcloud Calendar Event.
       * @param {*}
       * @param {*}
       * @returns {*} Returns the function result.
       */
      async function updateNextcloudCalendarEvent(event, payload) {
        var props = event && event.extendedProps ? event.extendedProps : {};
        var calendarId = String(props.nextcloudCalendarId || '').trim();
        var href = String(props.nextcloudHref || '').trim();
        if (!calendarId || !href) throw new Error('Missing Nextcloud event identifiers');
        var updateUrl = new URL('/api/nextcloud-calendar/events/update', CALENDAR_API_BASE).toString();
        var response = await fetch(updateUrl, {
          method: 'POST',
          headers: mutationHeaders(),
          body: JSON.stringify({
            calendarId: calendarId,
            href: href,
            etag: String(props.nextcloudEtag || '').trim(),
            title: payload && payload.title ? payload.title : String(event && event.title || ''),
            start: payload && payload.start,
            end: payload && payload.end,
            allDay: Boolean(payload && payload.allDay)
          })
        });
        if (!response.ok) {
          var text = await response.text();
          throw new Error(text || 'Could not update Nextcloud event');
        }
        var out = await response.json();
        return out && out.event ? out.event : null;
      }

      /**
       * Delete Nextcloud Calendar Event.
       * @param {*}
       * @returns {*} Returns the function result.
       */
      async function deleteNextcloudCalendarEvent(event) {
        var props = event && event.extendedProps ? event.extendedProps : {};
        var calendarId = String(props.nextcloudCalendarId || '').trim();
        var href = String(props.nextcloudHref || '').trim();
        if (!calendarId || !href) throw new Error('Missing Nextcloud event identifiers');
        var deleteUrl = new URL('/api/nextcloud-calendar/events/delete', CALENDAR_API_BASE).toString();
        var response = await fetch(deleteUrl, {
          method: 'POST',
          headers: mutationHeaders(),
          body: JSON.stringify({
            calendarId: calendarId,
            href: href,
            etag: String(props.nextcloudEtag || '').trim()
          })
        });
        if (!response.ok) {
          var text = await response.text();
          throw new Error(text || 'Could not delete Nextcloud event');
        }
      }

      /**
       * Apply Google Event Response.
       * @param {*}
       * @param {*}
       * @returns {*} Returns the function result.
       */
      function applyGoogleEventResponse(targetEvent, replacement) {
        if (!targetEvent || !replacement) return;
        if (replacement.title) targetEvent.setProp('title', replacement.title);
        if (replacement.backgroundColor) {
          targetEvent.setProp('backgroundColor', replacement.backgroundColor);
          targetEvent.setProp('borderColor', replacement.borderColor || replacement.backgroundColor);
        }
        if (replacement.textColor) {
          targetEvent.setProp('textColor', replacement.textColor);
        }
        if (replacement.start) {
          targetEvent.setDates(replacement.start, replacement.end || null, { allDay: Boolean(replacement.allDay) });
        }
      }

      /**
       * Apply Nextcloud Event Response.
       * @param {*}
       * @param {*}
       * @returns {*} Returns the function result.
       */
      function applyNextcloudEventResponse(targetEvent, replacement) {
        if (!targetEvent || !replacement) return;
        if (replacement.title) targetEvent.setProp('title', replacement.title);
        if (replacement.backgroundColor) {
          targetEvent.setProp('backgroundColor', replacement.backgroundColor);
          targetEvent.setProp('borderColor', replacement.borderColor || replacement.backgroundColor);
        }
        if (replacement.textColor) {
          targetEvent.setProp('textColor', replacement.textColor);
        }
        if (replacement.start) {
          targetEvent.setDates(replacement.start, replacement.end || null, { allDay: Boolean(replacement.allDay) });
        }
        if (replacement.extendedProps && typeof replacement.extendedProps === 'object') {
          Object.keys(replacement.extendedProps).forEach(function(key) {
            targetEvent.setExtendedProp(key, replacement.extendedProps[key]);
          });
        }
      }

      /**
       * Fetch Calendar Session Token.
       * @returns {*} Returns calendar session token.
       */
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

      /**
       * Mutation Headers.
       * @returns {*} Returns the function result.
       */
      function mutationHeaders() {
        if (!calendarApiToken) {
          throw new Error('Missing session token. Reload the calendar page.');
        }
        return {
          'Content-Type': 'application/json',
          'X-Calendar-Token': calendarApiToken
        };
      }

      /**
       * Create Filter Select.
       * @param {*}
       * @returns {*} Returns filter select.
       */
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

      /**
       * Mount Filter Dropdown.
       * @param {*}
       * @returns {*} Returns the function result.
       */
      async function mountFilterDropdown(calendarEl) {
        try {
          var meta = await fetchCalendarFilters();
          if (!meta || !meta.filters || !meta.filters.length) return;

          var leftToolbarChunk = calendarEl.closest('body').querySelector('.fc-header-toolbar .fc-toolbar-chunk');
          if (!leftToolbarChunk) return;

          var controls = createFilterSelect(meta);
          var toolbarRoot = calendarEl.closest('body');
          var googleButton = toolbarRoot ? toolbarRoot.querySelector('.fc-googleSourceToggle-button') : null;
          var refreshButton = toolbarRoot ? toolbarRoot.querySelector('.fc-refreshCalendar-button') : null;
          if (googleButton && googleButton.parentElement) {
            googleButton.insertAdjacentElement('beforebegin', controls.wrap);
          } else if (refreshButton && refreshButton.parentElement) {
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

      /**
       * On Event Date Change.
       * @param {*}
       * @returns {*} Returns the function result.
       */
      async function onEventDateChange(info) {
        if (isExternalReadOnlyEvent(info.event)) {
          info.revert();
          return;
        }
        try {
          if (isGoogleEvent(info.event)) {
            var schedule = toEventPersistPayload(info.event);
            var updatedGoogle = await updateGoogleCalendarEvent(info.event, {
              title: String(info.event && info.event.title || ''),
              start: schedule.start,
              end: schedule.end,
              allDay: schedule.allDay
            });
            applyGoogleEventResponse(info.event, updatedGoogle);
          } else if (isNextcloudEvent(info.event)) {
            var nextcloudSchedule = toEventPersistPayload(info.event);
            var updatedNextcloud = await updateNextcloudCalendarEvent(info.event, {
              title: String(info.event && info.event.title || ''),
              start: nextcloudSchedule.start,
              end: nextcloudSchedule.end,
              allDay: nextcloudSchedule.allDay
            });
            applyNextcloudEventResponse(info.event, updatedNextcloud);
          } else {
            await saveEventDates(info.event);
          }
        } catch (error) {
          info.revert();
          alert('Saving failed: ' + error.message);
        }
      }

      /**
       * On Event Click.
       * @param {*}
       * @returns {*} Returns the function result.
       */
      async function onEventClick(info) {
        if (isGoogleEvent(info.event) || isNextcloudEvent(info.event)) {
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

      /**
       * Create Event For Dates.
       * @param {*}
       * @param {*}
       * @param {*}
       * @param {*}
       * @returns {*} Returns event for dates.
       */
      async function createEventForDates(calendar, start, end, allDay) {
        if (isCreateFlowActive) return;
        isCreateFlowActive = true;
        var createChoice = await showCreateEventDialog(calendar);
        try {
          if (!createChoice || !createChoice.title) return;
          var trimmedTitle = String(createChoice.title || '').trim();
          if (!trimmedTitle) {
            return;
          }

          var target = String(createChoice.target || '').trim().toLowerCase();
          var createOnGoogle = target === 'google';
          var createOnNextcloud = target === 'nextcloud';
          if (createOnGoogle && !isGoogleWriteEnabled()) {
            throw new Error('Google write is not enabled. Connect OAuth with write scope first.');
          }
          if (createOnNextcloud && !isNextcloudWriteEnabled()) {
            throw new Error('Nextcloud write is not enabled. Configure CalDAV in .env.local first.');
          }
          var result = createOnGoogle
            ? await createGoogleCalendarEvent(trimmedTitle, start, end, allDay, createChoice.googleColorId)
            : (createOnNextcloud
              ? await createNextcloudCalendarEvent(trimmedTitle, start, end, allDay, createChoice.nextcloudCalendarId)
              : await createEvent(trimmedTitle, start, end, allDay));
          if (result && result.event) {
            calendar.addEvent(result.event);
          }
        } catch (error) {
          alert('Create event failed: ' + error.message);
        } finally {
          isCreateFlowActive = false;
        }
      }

      /**
       * On Date Select.
       * @param {*}
       * @returns {*} Returns the function result.
       */
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

      /**
       * On Date Click.
       * @param {*}
       * @returns {*} Returns the function result.
       */
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

      /**
       * Is External Read Only Event.
       * @param {*}
       * @returns {*} Returns whether the condition is met.
       */
      function isExternalReadOnlyEvent(event) {
        var source = String(event && event.extendedProps && event.extendedProps.externalSource || '').toLowerCase();
        if (source === 'google') {
          return !(window.googleCalendarState && window.googleCalendarState.oauthWritable === true);
        }
        if (source === 'nextcloud') {
          return !(window.nextcloudCalendarState && window.nextcloudCalendarState.writable === true);
        }
        return false;
      }

      /**
       * Is Google Event.
       * @param {*}
       * @returns {*} Returns whether the condition is met.
       */
      function isGoogleEvent(event) {
        var source = String(event && event.extendedProps && event.extendedProps.externalSource || '').toLowerCase();
        return source === 'google';
      }

      /**
       * Is Google Write Enabled.
       * @returns {*} Returns whether the condition is met.
       */
      function isGoogleWriteEnabled() {
        return Boolean(window.googleCalendarState && window.googleCalendarState.oauthWritable === true);
      }

      /**
       * Is Nextcloud Event.
       * @param {*}
       * @returns {*} Returns whether the condition is met.
       */
      function isNextcloudEvent(event) {
        var source = String(event && event.extendedProps && event.extendedProps.externalSource || '').toLowerCase();
        return source === 'nextcloud';
      }

      /**
       * Is Nextcloud Write Enabled.
       * @returns {*} Returns whether the condition is met.
       */
      function isNextcloudWriteEnabled() {
        return Boolean(window.nextcloudCalendarState && window.nextcloudCalendarState.writable === true);
      }

      /**
       * Create Google Event Source.
       * @returns {*} Returns google event source.
       */
      function createGoogleEventSource() {
        return {
          id: 'google',
          editable: isGoogleWriteEnabled(),
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

      /**
       * Create Nextcloud Event Source.
       * @returns {*} Returns nextcloud event source.
       */
      function createNextcloudEventSource() {
        return {
          id: 'nextcloud',
          editable: isNextcloudWriteEnabled(),
          events: function(fetchInfo, successCallback, failureCallback) {
            fetchNextcloudCalendarEvents(fetchInfo && fetchInfo.startStr, fetchInfo && fetchInfo.endStr)
              .then(function(events) {
                if (window.nextcloudCalendarState) {
                  window.nextcloudCalendarState.lastError = '';
                }
                successCallback(filterNextcloudEventsByVisibility(events));
              })
              .catch(function(error) {
                if (window.nextcloudCalendarState) {
                  window.nextcloudCalendarState.lastError = String(error && error.message || error || 'Unknown error');
                }
                console.warn('Nextcloud Calendar fetch failed:', error && error.message ? error.message : error);
                failureCallback(error);
              });
          }
        };
      }

      /**
       * Set Google Events Enabled.
       * @param {*}
       * @param {*}
       * @returns {*} Returns the function result.
       */
      function setGoogleEventsEnabled(calendar, enabled) {
        if (!calendar || !window.googleCalendarState || !window.googleCalendarState.configured) return;
        var source = calendar.getEventSourceById('google');
        if (enabled) {
          if (source) source.remove();
          calendar.addEventSource(createGoogleEventSource());
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

      /**
       * Set Nextcloud Events Enabled.
       * @param {*}
       * @param {*}
       * @returns {*} Returns the function result.
       */
      function setNextcloudEventsEnabled(calendar, enabled) {
        if (!calendar || !window.nextcloudCalendarState || !window.nextcloudCalendarState.configured) return;
        var source = calendar.getEventSourceById('nextcloud');
        if (enabled) {
          if (source) source.remove();
          calendar.addEventSource(createNextcloudEventSource());
          window.nextcloudCalendarState.enabled = true;
        } else {
          if (source) {
            source.remove();
          }
          window.nextcloudCalendarState.enabled = false;
          window.nextcloudCalendarState.lastError = '';
        }
      }
      window.setNextcloudEventsEnabled = setNextcloudEventsEnabled;

      /**
       * Update Source Toggle Buttons.
       * @param {*}
       * @returns {*} Returns the function result.
       */
      function updateSourceToggleButtons(calendarEl) {
        var root = calendarEl && typeof calendarEl.closest === 'function' ? calendarEl.closest('body') : document.body;
        if (!root) return;
        var googleBtn = root.querySelector('.fc-googleSourceToggle-button');
        var nextcloudBtn = root.querySelector('.fc-nextcloudSourceToggle-button');
        var googleConfigured = Boolean(window.googleCalendarState && window.googleCalendarState.configured);
        var googleConnected = Boolean(window.googleCalendarState && window.googleCalendarState.oauthConnected === true);
        var googleHasError = Boolean(window.googleCalendarState && window.googleCalendarState.lastError);
        var nextcloudConfigured = Boolean(window.nextcloudCalendarState && window.nextcloudCalendarState.configured);
        var nextcloudHasError = Boolean(window.nextcloudCalendarState && window.nextcloudCalendarState.lastError);
        var googleEnabled = googleConfigured && calendarUiSettings.showGoogleEvents === true;
        var nextcloudEnabled = nextcloudConfigured && calendarUiSettings.showNextcloudEvents === true;
        var googleReady = googleConfigured && googleConnected && !googleHasError;
        var nextcloudReady = nextcloudConfigured && !nextcloudHasError;

        if (googleBtn) {
          googleBtn.disabled = !googleConfigured;
          googleBtn.classList.toggle('state-error', !googleReady);
          googleBtn.classList.toggle('state-off', googleReady && !googleEnabled);
          googleBtn.classList.toggle('state-on', googleReady && googleEnabled);
          googleBtn.setAttribute('title', !googleReady ? 'Google not connected' : (googleEnabled ? 'Google events on' : 'Google events off'));
          googleBtn.setAttribute('aria-pressed', googleEnabled ? 'true' : 'false');
        }
        if (nextcloudBtn) {
          nextcloudBtn.disabled = !nextcloudConfigured;
          nextcloudBtn.classList.toggle('state-error', !nextcloudReady);
          nextcloudBtn.classList.toggle('state-off', nextcloudReady && !nextcloudEnabled);
          nextcloudBtn.classList.toggle('state-on', nextcloudReady && nextcloudEnabled);
          nextcloudBtn.setAttribute('title', !nextcloudReady ? 'Nextcloud not connected' : (nextcloudEnabled ? 'Nextcloud events on' : 'Nextcloud events off'));
          nextcloudBtn.setAttribute('aria-pressed', nextcloudEnabled ? 'true' : 'false');
        }
      }

      /**
       * Refresh Nextcloud Events.
       * @param {*}
       * @returns {*} Returns the function result.
       */
      function refreshNextcloudEvents(calendar) {
        if (!calendar) return;
        var source = calendar.getEventSourceById('nextcloud');
        if (source) {
          source.refetch();
        }
      }
      window.refreshNextcloudEvents = refreshNextcloudEvents;

      document.addEventListener('DOMContentLoaded', async function() {
        await applyCalendarTheme();
        applyVacationTextureSetting(calendarUiSettings.showVacationTexture !== false);
        var calendarEl = document.getElementById('calendar');
        var calendarEvents = window.CALENDAR_EVENTS || [];
        var vacationDays = buildVacationDaySet(calendarEvents);
        window.googleCalendarState = {
          configured: false,
          enabled: false,
          lastError: '',
          oauthConnected: false,
          oauthWritable: false,
          defaultCreateCalendarId: ''
        };
        window.nextcloudCalendarState = {
          configured: false,
          enabled: false,
          writable: false,
          lastError: '',
          defaultCreateCalendarId: '',
          calendars: []
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
            window.googleCalendarState.oauthConnected = Boolean(googleConfig && googleConfig.oauth && googleConfig.oauth.connected);
            window.googleCalendarState.oauthWritable = Boolean(googleConfig && googleConfig.oauth && googleConfig.oauth.writable);
            window.googleCalendarState.defaultCreateCalendarId = String(googleConfig && googleConfig.defaultCreateCalendarId || '').trim();
          } catch (error) {
            console.warn('Could not load Google Calendar config:', error.message);
            window.googleCalendarState.configured = false;
            window.googleCalendarState.lastError = String(error && error.message || error || 'Unknown error');
          }
        }
        if (isHttpContext()) {
          try {
            var nextcloudConfig = await fetchNextcloudCalendarConfig();
            window.nextcloudCalendarState.configured = Boolean(nextcloudConfig && nextcloudConfig.enabled);
            window.nextcloudCalendarState.writable = Boolean(nextcloudConfig && nextcloudConfig.writable);
            window.nextcloudCalendarState.defaultCreateCalendarId = String(nextcloudConfig && nextcloudConfig.defaultCreateCalendarId || '').trim();
            window.nextcloudCalendarState.calendars = Array.isArray(nextcloudConfig && nextcloudConfig.calendars)
              ? nextcloudConfig.calendars
              : [];
          } catch (error) {
            console.warn('Could not load Nextcloud Calendar config:', error.message);
            window.nextcloudCalendarState.configured = false;
            window.nextcloudCalendarState.lastError = String(error && error.message || error || 'Unknown error');
            window.nextcloudCalendarState.calendars = [];
          }
        }
        var eventSources = [{ id: 'local', events: calendarEvents }];
        var multiMonthMinWidth = monthWidthPercentToPx(Number(calendarUiSettings.multiMonthMinWidth || 30), calendarEl);
        var timeGridEventHeights = deriveTimeGridEventHeights(Number(calendarUiSettings.timeGridRowHeight || 26));
        var lastViewType = '';
        var isApplyingFocusOnViewChange = false;
        var calendar = new FullCalendar.Calendar(calendarEl, {
          initialView: 'multiMonthYear',
          height: '100%',
          scrollTime: '08:00:00',
          eventMinHeight: timeGridEventHeights.eventMinHeight,
          eventShortHeight: timeGridEventHeights.eventShortHeight,
          multiMonthMinWidth: multiMonthMinWidth,
          firstDay: 1,
          fixedWeekCount: false,
          dayMaxEvents: false,
          dayMaxEventRows: false,
          customButtons: {
            refreshCalendar: {
              text: '',
              hint: 'Refresh calendar',
              click: async function() {
                var buttonEl = calendarEl.closest('body').querySelector('.fc-refreshCalendar-button');
                if (!buttonEl || buttonEl.disabled) return;
                buttonEl.disabled = true;
                buttonEl.classList.add('is-loading');
                try {
                  await rebuildEventsAndReload();
                } catch (error) {
                  alert('Refresh failed: ' + error.message);
                  buttonEl.disabled = false;
                  buttonEl.classList.remove('is-loading');
                }
              }
            },
            focusToday: {
              text: '',
              hint: 'Today',
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
            googleSourceToggle: {
              text: '',
              hint: 'Toggle Google events',
              click: function() {
                if (!window.googleCalendarState || !window.googleCalendarState.configured) return;
                calendarUiSettings.showGoogleEvents = !(calendarUiSettings.showGoogleEvents === true);
                persistCalendarUiSettings();
                setGoogleEventsEnabled(calendar, calendarUiSettings.showGoogleEvents);
                updateSourceToggleButtons(calendarEl);
              }
            },
            nextcloudSourceToggle: {
              text: '',
              hint: 'Toggle Nextcloud events',
              click: function() {
                if (!window.nextcloudCalendarState || !window.nextcloudCalendarState.configured) return;
                calendarUiSettings.showNextcloudEvents = !(calendarUiSettings.showNextcloudEvents === true);
                persistCalendarUiSettings();
                setNextcloudEventsEnabled(calendar, calendarUiSettings.showNextcloudEvents);
                updateSourceToggleButtons(calendarEl);
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
            left: 'prev,next focusToday refreshCalendar googleSourceToggle nextcloudSourceToggle printCalendar calendarSettings',
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
          eventStartEditable: true,
          eventDurationEditable: true,
          eventResizableFromStart: true,
          selectable: true,
          selectMinDistance: 0,
          eventSources: eventSources,
          eventDataTransform: function(eventData) {
            var next = Object.assign({}, eventData || {});
            if (typeof next.editable === 'undefined') next.editable = true;
            if (typeof next.startEditable === 'undefined') next.startEditable = true;
            if (typeof next.durationEditable === 'undefined') next.durationEditable = true;
            return next;
          },
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
        if (window.nextcloudCalendarState.configured && calendarUiSettings.showNextcloudEvents === true) {
          setNextcloudEventsEnabled(calendar, true);
        }
        updateSourceToggleButtons(calendarEl);
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
        window.addEventListener('resize', function() {
          var nextWidth = monthWidthPercentToPx(Number(calendarUiSettings.multiMonthMinWidth || 30), calendarEl);
          calendar.setOption('multiMonthMinWidth', nextWidth);
        });
        mountFilterDropdown(calendarEl);
        mountCalendarSettingsPopover(calendarEl, calendar);

      });



