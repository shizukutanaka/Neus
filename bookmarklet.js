/**
 * Neus Bookmarklet
 *
 * This file is for documentation/distribution purposes.
 * The actual bookmarklet URL is generated dynamically in-app
 * from the deployed origin (SOURCES → BOOKMARKLET button).
 *
 * Usage:
 *   1. Open Neus in your browser
 *   2. Go to SOURCES → BOOKMARKLET
 *   3. Drag the generated link to your bookmark bar
 *
 * Manual installation (replace YOUR_NEUS_URL):
 */

// Minified source (replace YOUR_NEUS_URL with your deployed URL):
// javascript:(function(){var u=encodeURIComponent(location.href),ti=encodeURIComponent(document.title);window.open('YOUR_NEUS_URL?share_url='+u+'&share_title='+ti,'_blank')})()

/**
 * How it works:
 * 1. Captures current tab URL + title
 * 2. Opens Neus with share_url and share_title query params
 * 3. Neus's ShareTarget.handle() detects params, ingests as InformationEvent
 * 4. URL params are cleaned from history immediately (history.replaceState)
 * 5. New event appears in INBOX with source type 'share'
 */

export {};
