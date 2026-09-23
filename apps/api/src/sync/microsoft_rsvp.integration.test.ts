import { runMicrosoftRsvpIntegration } from "./microsoft_rsvp_integration.fixture";

void runMicrosoftRsvpIntegration().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => process.exit());
