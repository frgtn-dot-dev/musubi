import { z } from "zod";
import { ProviderEventWriteError } from "../event_write";
// OAuth account IDs are application-specific subjects, not Graph object IDs.
// Both Graph reads use the token captured for that exact OAuth credential row.
export const graphIdentitySchema = z.object({ oauthAccountID: z.string().min(1), graphUserID: z.string().min(1), calendarID: z.string().min(1), selfAddress: z.email() }).strict();
export type GraphIdentity = z.infer<typeof graphIdentitySchema>;
export async function verifiedGraphIdentity(get: (url: string) => Promise<unknown>, oauthAccountID: string, calendarID: string): Promise<GraphIdentity> {
  const user = z.object({ id: z.string().min(1), mail: z.email().nullable(), userPrincipalName: z.string() }).parse(await get("https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName"));
  const selfAddress = z.email().parse(user.mail ?? user.userPrincipalName).toLowerCase();
  const calendar = z.object({ id: z.literal(calendarID), isDefaultCalendar: z.literal(true), canEdit: z.literal(true), owner: z.object({ address: z.email() }) }).parse(await get("https://graph.microsoft.com/v1.0/me/calendar?$select=id,isDefaultCalendar,canEdit,owner"));
  if (calendar.owner.address.toLowerCase() !== selfAddress) throw new ProviderEventWriteError("provider-conflict");
  return graphIdentitySchema.parse({ oauthAccountID, graphUserID: user.id, calendarID, selfAddress });
}
