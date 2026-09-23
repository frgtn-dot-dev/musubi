import { runMicrosoftRsvpIntegration } from "./microsoft_rsvp_integration.fixture";

// Run the complete public/queue/worker/recovery/privacy-fence matrix against a
// provider-expanded occurrence, including its occurrence -> exception response.
void runMicrosoftRsvpIntegration(true).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => process.exit());
