// Deep links into the Mini App. Pure: usable from the bot, pages and tests.
//
// Groups can't show web_app buttons, so their links use the Mini App's direct
// link, t.me/<bot>/app?startapp=<param>. Telegram allows only [A-Za-z0-9_-] in
// start_param, so a route like "admin/grants" travels as "admin__grants".

const ROUTE = /^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/;
const PARAM = /^[a-z0-9-]+(?:__[a-z0-9-]+)*$/;

/** "admin/grants" -> "admin__grants"; null if it isn't a plain route. */
export function routeToStartParam(route: string): string | null {
  const r = route.replace(/^\/?(?:tg\/?)?/, "");
  if (!r) return "";
  return ROUTE.test(r) ? r.replaceAll("/", "__") : null;
}

/** "admin__grants" -> "/tg/admin/grants"; anything else -> "/tg". */
export function startParamToPath(param: string | null | undefined): string {
  if (!param || !PARAM.test(param)) return "/tg";
  return `/tg/${param.replaceAll("__", "/")}`;
}

/** t.me direct link that opens the Mini App (registered with BotFather as short name "app") at `route`. */
export function miniAppLink(botUsername: string, route = ""): string {
  const base = `https://t.me/${botUsername.replace(/^@/, "")}/app`;
  const param = routeToStartParam(route);
  return param ? `${base}?startapp=${param}` : base;
}

/** The Mini App's own URL, for web_app buttons in private chats and the menu button. */
export function miniAppUrl(appUrl: string, route = ""): string {
  const r = route.replace(/^\/?(?:tg\/?)?/, "");
  return `${appUrl.replace(/\/+$/, "")}/tg${r ? `/${r}` : ""}`;
}
