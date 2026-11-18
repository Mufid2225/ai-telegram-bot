import { isAppsScriptConfigured, requestAppsScript } from "./sheets.js";

/**
 * Google Calendar client backed by the shared Google Apps Script Web App (`CalendarApp`).
 */
export function createCalendarService(config, fetchImpl = fetch) {
  const request = (action, payload = {}) => requestAppsScript(config, action, payload, fetchImpl);

  return {
    isConfigured: () => isAppsScriptConfigured(config),
    listCalendars: () => request("calendar_list_calendars"),
    listEvents: (params = {}) => request("calendar_list_events", params),
    createEvent: (params = {}) => request("calendar_create_event", params),
    updateEvent: (params = {}) => request("calendar_update_event", params),
    deleteEvent: (params = {}) => request("calendar_delete_event", params),
  };
}
