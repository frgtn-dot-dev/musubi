import { auth } from "@musubi/auth";


export async function getGoogleCalendarList(accessToken: string) {
  const res = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
    }
  });

  if (!res.ok) throw new Error(`Google ${res.status} ${res.statusText}`)

  const data = await res.json();

  console.log(data);
}


export async function getGoogleAccessToken(userID: string) {
  const { accessToken } = await auth.api.getAccessToken({
    body: { providerId: "google", userId: userID },
  });

  return accessToken;
}
