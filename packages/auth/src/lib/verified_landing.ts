/**
 * Where the browser goes after the verification link is followed.
 *
 * Better Auth defaults the callback to "/", which on a full-stack deployment is
 * the calendar — the best possible ending, since the same click also signs the
 * person in. On an API-only server "/" is nothing, so the default is swapped for
 * a page this API serves itself, which hands off to the app. A callback the
 * caller chose deliberately is left alone.
 */
export function withVerifiedLanding(url: string) {
  return url.replace(/([?&]callbackURL=)(%2F|\/)?$/, "$1%2Femail-verified");
}
