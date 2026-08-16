import { brandUrl, button, escapeHtml, logoMarkup } from "./brand";

/**
 * "The time is Thursday at two."
 *
 * The one moment a poll has an answer. Everything before this is people
 * marking a grid; without this email they have to go back and check whether
 * anyone ever decided, which is exactly the chore a poll was meant to remove.
 *
 * It goes to people who may have no account here — a public poll asks for a
 * name and an address and nothing more — so it explains itself and links to
 * the poll rather than to an app they cannot open.
 */
export function getPollDecidedHtml(
  participantName: string,
  pollTitle: string,
  when: string,
  pollUrl: string,
) {
  return `
  <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
  <html dir="ltr" lang="en">
    <head>
      <meta content="width=device-width" name="viewport" />
      <meta content="text/html; charset=UTF-8" http-equiv="Content-Type" />
      <meta name="x-apple-disable-message-reformatting" />
      <meta content="IE=edge" http-equiv="X-UA-Compatible" />
      <meta
        content="telephone=no,address=no,email=no,date=no,url=no"
        name="format-detection" />
    </head>
    <body style="background-color:#050507;padding-top:0;padding-bottom:0">
      <table
        border="0"
        width="100%"
        cellpadding="0"
        cellspacing="0"
        role="presentation"
        align="center">
        <tbody>
          <tr>
            <td
              style="font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;font-size:14px;min-height:100%;line-height:155%;background-color:#050507;padding-top:48px;padding-bottom:48px">
              <table
                align="center"
                width="100%"
                border="0"
                cellpadding="0"
                cellspacing="0"
                role="presentation"
                style="max-width:600px;background-color:#0e0e12;width:100%;margin-top:48px;margin-bottom:48px;padding-top:40px;padding-right:40px;padding-bottom:40px;padding-left:40px;border-radius:12px;border-width:1px;border-color:#1f1f26;border-style:solid">
                <tbody>
                  <tr style="width:100%">
                    <td>
                      ${logoMarkup()}<h1
                        style="margin:0;padding:0;font-size:26px;line-height:1.44em;padding-top:0.389em;font-weight:700;color:#ffffff;margin-bottom:16px">
                        ${escapeHtml(pollTitle)} has a time
                      </h1>
                      <p
                        style="margin:0;padding:0;font-size:1em;padding-top:0.5em;padding-bottom:0.5em;color:#d4d4dc;line-height:160%">
                        Hi ${escapeHtml(participantName)}, the answers are in.
                      </p>
                      <p
                        style="margin:0;padding:0;font-size:20px;padding-top:0.5em;padding-bottom:0.5em;color:#ffffff;line-height:150%">
                        ${escapeHtml(when)}
                      </p>
                      ${button(pollUrl, "See the poll")}
                      <p
                        style="margin:0;padding:0;font-size:12px;padding-top:0.5em;padding-bottom:0.5em;color:#6b6b75;line-height:160%">
                        You are getting this because you answered this poll.
                      </p>
                      <table
                        align="center"
                        width="100%"
                        border="0"
                        cellpadding="0"
                        cellspacing="0"
                        role="presentation"
                        class="node-footer"
                        style="font-size:0.8em;padding-top:24px">
                        <tbody>
                          <tr>
                            <td>
                              <p
                                style="margin:0;padding:0;font-size:12px;padding-top:0.5em;padding-bottom:0.5em;color:#6b6b75;line-height:160%">
                                <a
                                  href="${brandUrl()}"
                                  rel="noopener noreferrer nofollow"
                                  style="color:#C8553D;text-decoration-line:none;text-decoration:underline"
                                  target="_blank"
                                  >Musubi</a><br /><br />© ${new Date().getFullYear()} FRGTN
                              </p>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </td>
                  </tr>
                </tbody>
              </table>
            </td>
          </tr>
        </tbody>
      </table>
    </body>
  </html>`;
}
