/**
 * JDK Entertainment - Google Calendar Module
 * Handles calendar synchronization and "Add to Calendar" links
 */

/**
 * Generate a Google Calendar link for a specific event
 * @param {Object} event - Event object from database
 * @returns {string} - Google Calendar URL
 */
export function generateGoogleCalendarLink(event) {
    if (!event) return '';

    const baseUrl = 'https://www.google.com/calendar/render?action=TEMPLATE';

    // Format dates for Google Calendar (YYYYMMDDTHHMMSSZ)
    // We assume the event date is a single day. If no time is provided, we use a default.
    const dateObj = new Date(event.date);
    const dateFormatted = dateObj.toISOString().replace(/-|:|\.\d+/g, '');

    // Default time if not specified (e.g., 10:00 to 12:00)
    let startTime = '100000';
    let endTime = '120000';

    if (event.time) {
        // Simple parser for "HH:mm - HH:mm" format
        const times = event.time.split(' - ');
        if (times[0]) {
            startTime = times[0].replace(':', '').padEnd(6, '0');
        }
        if (times[1]) {
            endTime = times[1].replace(':', '').padEnd(6, '0');
        }
    }

    const start = `${dateFormatted.slice(0, 8)}T${startTime}Z`;
    // For end date, we same day but different time
    const end = `${dateFormatted.slice(0, 8)}T${endTime}Z`;

    const params = new URLSearchParams({
        text: `[JDK] ${event.title}`,
        details: `${event.description}\n\nLokasi: ${event.location}\nLink: ${window.location.origin}/events`,
        location: event.location || 'JDK Entertainment Center',
        dates: `${start}/${end}`
    });

    return `${baseUrl}&${params.toString()}`;
}

/**
 * Sync event to personal JDK Calendar (Requires OAuth/API Key)
 * For now, we use a simpler approach of providing a link to "Subscribe" or "Add"
 */
export function syncToJDKCalendar(event) {
    const link = generateGoogleCalendarLink(event);
    window.open(link, '_blank');
}
